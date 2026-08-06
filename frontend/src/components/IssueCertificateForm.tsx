import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from 'react'
import type { ContractTransactionResponse } from 'ethers'
import { hashFile } from '../lib/fileHash'
import {
  checkBackendHealth,
  uploadCertificateFile,
} from '../lib/backendClient'
import { verifyByHash } from '../lib/readClient'
import { dateInputToExpiresAt, shortenHash } from '../lib/format'
import {
  classifyIssueError,
  issueCertificate,
  type IssueError,
} from '../lib/issuerWrite'
import { getEthereum } from '../wallet/ethereum'
import { SEPOLIA_NETWORK } from '../contract'
import { IssuedCertificateCard } from './IssuedCertificateCard'
import {
  FailedBanner,
  PendingBanner,
  RejectedBanner,
  Spinner,
} from './WriteStateBanners'

/**
 * Single-certificate issuance — the first on-chain WRITE from the frontend
 * (Phase 6, Slice 2). Rendered only when the connected wallet holds
 * ISSUER_ROLE specifically (checked by the parent, IssuerDashboard — the
 * contract enforces onlyRole(ISSUER_ROLE) too, as defense in depth).
 *
 * File hashing reuses src/lib/fileHash.ts UNCHANGED from the Phase-5
 * verifier — the file's SHA-256 IS the certHash, so issuing and verifying
 * must use the identical function or issued certs would never verify.
 *
 * Every write-side state is explicit (docs/07): idle → awaiting-signature →
 * pending (with tx hash) → confirmed, with rejected/failed as distinct,
 * recoverable branches. Nothing hangs; a revert never looks like a rejection
 * and vice versa.
 *
 * PHASE 7 adds the file's other half. Selecting a file now does two separate
 * things, and the distinction matters:
 *
 *   SHA-256 (here, in the browser) → certHash — what the document IS.
 *   Pinning  (backend → Pinata)    → CID      — where a copy LIVES.
 *
 * The hash never leaves the browser; only the bytes go to the backend, which
 * holds the Pinata credential the browser must never see. The real CID then
 * replaces what used to be a hardcoded placeholder.
 *
 * Ordering is a correctness requirement, not a preference: the file is pinned
 * BEFORE the transaction is offered, and a pin failure blocks issuance
 * entirely (docs/07 R6). Recording a certificate that points at a file which
 * was never stored would be worse than issuing nothing.
 *
 * File preparation is tracked SEPARATELY from the write state below, so
 * "storing the file" can never be confused with "waiting for the chain".
 */

type FilePrepState =
  | { status: 'idle' }
  | { status: 'hashing'; fileName: string }
  | { status: 'pinning'; fileName: string; hash: string }
  | {
      status: 'ready'
      fileName: string
      hash: string
      cid: string
      gatewayUrl: string
      duplicate: boolean
    }
  | { status: 'hash-failed'; message: string }
  /** Hashed fine, but the file is NOT stored — issuance stays blocked. */
  | { status: 'pin-failed'; fileName: string; hash: string; message: string }

type DuplicateCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'clear' }
  | { status: 'exists' }
  | { status: 'unknown' }

type IssueState =
  | { status: 'idle' }
  | { status: 'awaiting-signature' }
  | { status: 'pending'; txHash: string }
  | {
      status: 'confirmed'
      txHash: string
      certHash: string
      recipientName: string
      courseTitle: string
    }
  | { status: 'rejected' }
  | { status: 'failed'; message: string }

export function IssueCertificateForm() {
  const [recipientName, setRecipientName] = useState('')
  const [courseTitle, setCourseTitle] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [filePrep, setFilePrep] = useState<FilePrepState>({ status: 'idle' })
  const [duplicate, setDuplicate] = useState<DuplicateCheckState>({
    status: 'idle',
  })
  const [issueState, setIssueState] = useState<IssueState>({ status: 'idle' })
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [storageOffline, setStorageOffline] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** Kept so a failed pin can be retried without re-picking the file. */
  const selectedFileRef = useRef<File | null>(null)

  // Tell the issuer the storage service is unavailable BEFORE they fill in a
  // form and pick a file, rather than after (docs/07 §2). Advisory only — the
  // upload itself is the real check.
  useEffect(() => {
    let cancelled = false
    checkBackendHealth().then((health) => {
      if (!cancelled) setStorageOffline(health === null || health.storage !== 'ready')
    })
    return () => {
      cancelled = true
    }
  }, [])

  /** Pin an already-hashed file. Split out so it can be retried on its own. */
  const pinFile = useCallback(async (file: File, hash: string) => {
    setFilePrep({ status: 'pinning', fileName: file.name, hash })
    try {
      const uploaded = await uploadCertificateFile(file)
      setFilePrep({
        status: 'ready',
        fileName: file.name,
        hash,
        cid: uploaded.cid,
        gatewayUrl: uploaded.gatewayUrl,
        duplicate: uploaded.duplicate,
      })
      setStorageOffline(false)
    } catch (err) {
      setFilePrep({
        status: 'pin-failed',
        fileName: file.name,
        hash,
        message:
          err instanceof Error ? err.message : 'The file could not be stored.',
      })
    }
  }, [])

  const processFile = useCallback(
    async (file: File) => {
      selectedFileRef.current = file
      setFilePrep({ status: 'hashing', fileName: file.name })
      setDuplicate({ status: 'idle' })

      // 1. Fingerprint locally. This is the value that goes on-chain as the
      //    certificate's identity, and it never leaves the browser.
      let hash: string
      try {
        hash = await hashFile(file)
      } catch (err) {
        setFilePrep({
          status: 'hash-failed',
          message:
            err instanceof Error ? err.message : 'Could not hash this file.',
        })
        return
      }

      // 2. Duplicate pre-check runs in parallel — it is advisory, and must
      //    never gate or delay the pin.
      setDuplicate({ status: 'checking' })
      verifyByHash(hash)
        .then((result) =>
          setDuplicate({
            status: result.status === 'NOT_FOUND' ? 'clear' : 'exists',
          }),
        )
        .catch(() => setDuplicate({ status: 'unknown' }))

      // 3. Store the bytes. Until this succeeds there is no CID, and issuance
      //    stays blocked.
      await pinFile(file, hash)
    },
    [pinFile],
  )

  const retryPin = useCallback(() => {
    const file = selectedFileRef.current
    if (!file || filePrep.status !== 'pin-failed') return
    void pinFile(file, filePrep.hash)
  }, [filePrep, pinFile])

  const clearFile = useCallback(() => {
    selectedFileRef.current = null
    setFilePrep({ status: 'idle' })
    setDuplicate({ status: 'idle' })
  }, [])

  const onFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void processFile(file)
    event.target.value = ''
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (file) void processFile(file)
  }

  const resetForm = useCallback(() => {
    setRecipientName('')
    setCourseTitle('')
    setExpiryDate('')
    selectedFileRef.current = null
    setFilePrep({ status: 'idle' })
    setDuplicate({ status: 'idle' })
    setIssueState({ status: 'idle' })
    setValidationError(null)
  }, [])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()

    // The gate that enforces "pin before tx": only `ready` carries a CID, so
    // there is no code path from a failed/absent upload to a transaction.
    if (filePrep.status !== 'ready') {
      setValidationError(
        filePrep.status === 'pin-failed'
          ? 'This file has not been stored yet, so it cannot be issued. Retry storing it first.'
          : filePrep.status === 'pinning' || filePrep.status === 'hashing'
            ? 'Wait for the certificate file to finish preparing.'
            : 'Attach the certificate file first.',
      )
      return
    }
    if (!recipientName.trim() || !courseTitle.trim()) {
      setValidationError('Recipient name and course title are required.')
      return
    }
    setValidationError(null)

    const eth = getEthereum()
    if (!eth) {
      setIssueState({
        status: 'failed',
        message: 'MetaMask provider unavailable.',
      })
      return
    }

    setIssueState({ status: 'awaiting-signature' })
    let tx: ContractTransactionResponse
    try {
      tx = await issueCertificate(eth, {
        certHash: filePrep.hash,
        // The REAL CID, from a file already stored on IPFS (Phase 7).
        ipfsCID: filePrep.cid,
        recipientName: recipientName.trim(),
        courseTitle: courseTitle.trim(),
        expiresAt: dateInputToExpiresAt(expiryDate),
      })
    } catch (err) {
      applyIssueError(err)
      return
    }

    setIssueState({ status: 'pending', txHash: tx.hash })
    try {
      await tx.wait()
      setIssueState({
        status: 'confirmed',
        txHash: tx.hash,
        certHash: filePrep.hash,
        recipientName: recipientName.trim(),
        courseTitle: courseTitle.trim(),
      })
    } catch (err) {
      applyIssueError(err)
    }
  }

  function applyIssueError(err: unknown) {
    const classified: IssueError = classifyIssueError(err)
    if (classified.kind === 'rejected') {
      setIssueState({ status: 'rejected' })
    } else {
      setIssueState({ status: 'failed', message: classified.message })
    }
  }

  if (issueState.status === 'confirmed') {
    return (
      <IssuedCertificateCard
        certHash={issueState.certHash}
        txHash={issueState.txHash}
        recipientName={issueState.recipientName}
        courseTitle={issueState.courseTitle}
        onIssueAnother={resetForm}
      />
    )
  }

  const isBusy =
    issueState.status === 'awaiting-signature' ||
    issueState.status === 'pending'

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-xl font-semibold text-brand-900">
          Issue a certificate
        </h2>
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
        This writes to the {SEPOLIA_NETWORK.name} registry and costs gas. The
        certificate&apos;s file hash becomes its permanent on-chain identifier
        — the same hash the public verifier checks.
      </p>

      {storageOffline && filePrep.status === 'idle' && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">File storage is unavailable</p>
          <p className="mt-0.5">
            The storage service isn&apos;t reachable or isn&apos;t configured,
            so certificate files can&apos;t be stored yet — and issuing needs a
            stored file. Start the backend (
            <code className="font-mono text-xs">npm run dev</code> in{' '}
            <code className="font-mono text-xs">backend/</code>) and reload.
          </p>
        </div>
      )}

      {issueState.status === 'pending' && (
        <PendingBanner txHash={issueState.txHash} />
      )}
      {issueState.status === 'rejected' && (
        <RejectedBanner onDismiss={() => setIssueState({ status: 'idle' })} />
      )}
      {issueState.status === 'failed' && (
        <FailedBanner
          title="Couldn't issue this certificate"
          message={issueState.message}
          onDismiss={() => setIssueState({ status: 'idle' })}
        />
      )}

      <form onSubmit={(e) => void onSubmit(e)} noValidate className="mt-5">
        <fieldset disabled={isBusy} className="space-y-4 disabled:opacity-60">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Recipient name" htmlFor="recipient-name">
              <input
                id="recipient-name"
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                autoComplete="off"
                className={inputClass()}
              />
            </Field>
            <Field label="Course / title" htmlFor="course-title">
              <input
                id="course-title"
                type="text"
                value={courseTitle}
                onChange={(e) => setCourseTitle(e.target.value)}
                autoComplete="off"
                className={inputClass()}
              />
            </Field>
          </div>

          {/* The manual CID field is gone: the CID is now obtained
              automatically when the file is stored, so an editable field could
              only ever disagree with the file that was actually pinned. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Expiry date (optional)"
              htmlFor="expiry-date"
              hint="Leave blank for a certificate that never expires."
            >
              <input
                id="expiry-date"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className={inputClass()}
              />
            </Field>
          </div>

          <div>
            <span className="block text-sm font-semibold text-slate-800">
              Certificate file
            </span>
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragOver(true)
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={onDrop}
              className={`mt-1.5 rounded-xl border-2 border-dashed px-5 py-6 text-center transition-colors ${
                isDragOver
                  ? 'border-brand-400 bg-brand-50'
                  : 'border-slate-300 bg-slate-50'
              }`}
            >
              {filePrep.status === 'idle' && (
                <>
                  <p className="text-sm text-slate-600">
                    Drag the certificate file here, or
                  </p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:bg-slate-50"
                  >
                    Choose file
                  </button>
                  <p className="mt-2 text-xs text-slate-500">
                    The file is fingerprinted in your browser, then stored on
                    IPFS so anyone verifying can open the original document.
                  </p>
                </>
              )}

              {filePrep.status === 'hashing' && (
                <div className="flex items-center justify-center gap-2 text-sm text-slate-600">
                  <Spinner />
                  Fingerprinting {filePrep.fileName}…
                </div>
              )}

              {filePrep.status === 'pinning' && (
                <div className="text-sm">
                  <p className="font-medium text-slate-800">
                    {filePrep.fileName}
                  </p>
                  <p
                    className="mt-1 font-mono text-xs text-slate-500"
                    title={filePrep.hash}
                  >
                    {shortenHash(filePrep.hash)}
                  </p>
                  <p className="mt-2 flex items-center justify-center gap-2 text-slate-600">
                    <Spinner /> Storing the file on IPFS…
                  </p>
                </div>
              )}

              {filePrep.status === 'ready' && (
                <div className="text-sm">
                  <p className="font-medium text-slate-800">
                    {filePrep.fileName}
                  </p>
                  <p
                    className="mt-1 font-mono text-xs text-slate-500"
                    title={filePrep.hash}
                  >
                    {shortenHash(filePrep.hash)}
                  </p>
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-emerald-600"
                      aria-hidden="true"
                    />
                    Stored on IPFS
                    {filePrep.duplicate && ' (already pinned)'}
                  </p>
                  <p
                    className="mt-1.5 font-mono text-[0.7rem] break-all text-slate-500"
                    title={filePrep.cid}
                  >
                    {filePrep.cid}
                  </p>
                  <a
                    href={filePrep.gatewayUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-brand-600 hover:underline"
                  >
                    Preview stored file ↗
                  </a>
                  <DuplicateNotice state={duplicate} />
                  <button
                    type="button"
                    onClick={clearFile}
                    className="mt-2 block w-full text-sm font-medium text-brand-600 hover:underline"
                  >
                    Choose a different file
                  </button>
                </div>
              )}

              {filePrep.status === 'hash-failed' && (
                <div className="text-sm">
                  <p className="font-medium text-red-700">
                    Couldn&apos;t read this file.
                  </p>
                  <p className="mt-1 text-red-600">{filePrep.message}</p>
                  <button
                    type="button"
                    onClick={clearFile}
                    className="mt-2 text-sm font-medium text-brand-600 hover:underline"
                  >
                    Try again
                  </button>
                </div>
              )}

              {/* Pin failed: the certificate CANNOT be issued from here. Said
                  plainly, because the next step is deliberately unavailable. */}
              {filePrep.status === 'pin-failed' && (
                <div className="text-sm" role="alert">
                  <p className="font-medium text-red-700">
                    The file wasn&apos;t stored
                  </p>
                  <p className="mt-1 text-red-600">{filePrep.message}</p>
                  <p className="mt-2 text-xs text-slate-600">
                    Issuing is blocked until this succeeds — a certificate must
                    never point at a document that wasn&apos;t stored.
                  </p>
                  <div className="mt-3 flex flex-wrap justify-center gap-3">
                    <button
                      type="button"
                      onClick={retryPin}
                      className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                    >
                      Retry storing
                    </button>
                    <button
                      type="button"
                      onClick={clearFile}
                      className="text-sm font-medium text-brand-600 hover:underline"
                    >
                      Choose a different file
                    </button>
                  </div>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              onChange={onFileInputChange}
              className="sr-only"
              aria-label="Certificate file"
            />
          </div>

          {validationError && (
            <p className="text-sm text-red-600">{validationError}</p>
          )}

          {/* Disabled until the file is actually stored — the visible half of
              the pin-before-transaction rule enforced in onSubmit. */}
          <button
            type="submit"
            disabled={isBusy || filePrep.status !== 'ready'}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {(issueState.status === 'awaiting-signature' ||
              filePrep.status === 'pinning') && <Spinner light />}
            {issueState.status === 'awaiting-signature'
              ? 'Confirm in your wallet…'
              : issueState.status === 'pending'
                ? 'Waiting for confirmation…'
                : filePrep.status === 'pinning'
                  ? 'Storing file…'
                  : 'Issue certificate'}
          </button>
        </fieldset>
      </form>
    </div>
  )
}

function inputClass() {
  return 'mt-1.5 block w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 disabled:bg-slate-50'
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="text-sm font-semibold text-slate-800">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

function DuplicateNotice({ state }: { state: DuplicateCheckState }) {
  if (state.status === 'checking') {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
        <Spinner small /> Checking whether this file is already issued…
      </p>
    )
  }
  if (state.status === 'exists') {
    return (
      <p className="mt-1.5 text-xs font-medium text-amber-700">
        A certificate with this exact file already exists on-chain — issuing
        will be rejected as a duplicate.
      </p>
    )
  }
  // 'clear' and 'unknown' are silent: a passed pre-check is unremarkable, and
  // a failed pre-check is advisory only — the contract is the real guard.
  return null
}

