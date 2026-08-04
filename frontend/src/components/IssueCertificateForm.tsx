import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from 'react'
import type { ContractTransactionResponse } from 'ethers'
import { hashFile } from '../lib/fileHash'
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
 */

/** IPFS isn't wired until Phase 7; the contract requires a non-empty CID. */
const PENDING_IPFS_PLACEHOLDER = 'PENDING_IPFS_PHASE7'

type FileHashState =
  | { status: 'idle' }
  | { status: 'hashing'; fileName: string }
  | { status: 'hashed'; fileName: string; hash: string }
  | { status: 'error'; message: string }

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
  const [ipfsCID, setIpfsCID] = useState('')
  const [fileHash, setFileHash] = useState<FileHashState>({ status: 'idle' })
  const [duplicate, setDuplicate] = useState<DuplicateCheckState>({
    status: 'idle',
  })
  const [issueState, setIssueState] = useState<IssueState>({ status: 'idle' })
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(async (file: File) => {
    setFileHash({ status: 'hashing', fileName: file.name })
    setDuplicate({ status: 'idle' })
    try {
      const hash = await hashFile(file)
      setFileHash({ status: 'hashed', fileName: file.name, hash })
      setDuplicate({ status: 'checking' })
      verifyByHash(hash)
        .then((result) =>
          setDuplicate({
            status: result.status === 'NOT_FOUND' ? 'clear' : 'exists',
          }),
        )
        .catch(() => setDuplicate({ status: 'unknown' }))
    } catch (err) {
      setFileHash({
        status: 'error',
        message:
          err instanceof Error ? err.message : 'Could not hash this file.',
      })
    }
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
    setIpfsCID('')
    setFileHash({ status: 'idle' })
    setDuplicate({ status: 'idle' })
    setIssueState({ status: 'idle' })
    setValidationError(null)
  }, [])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()

    if (fileHash.status !== 'hashed') {
      setValidationError('Attach the certificate file first.')
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
        certHash: fileHash.hash,
        ipfsCID: ipfsCID.trim() || PENDING_IPFS_PLACEHOLDER,
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
        certHash: fileHash.hash,
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
            <Field
              label="IPFS document CID (optional)"
              htmlFor="ipfs-cid"
              hint="Not wired yet — Phase 7 will pin the file automatically."
            >
              <input
                id="ipfs-cid"
                type="text"
                value={ipfsCID}
                onChange={(e) => setIpfsCID(e.target.value)}
                placeholder="Qm… (optional for now)"
                spellCheck={false}
                autoComplete="off"
                className={`${inputClass()} font-mono`}
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
              {fileHash.status === 'idle' && (
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
                </>
              )}

              {fileHash.status === 'hashing' && (
                <div className="flex items-center justify-center gap-2 text-sm text-slate-600">
                  <Spinner />
                  Hashing {fileHash.fileName}…
                </div>
              )}

              {fileHash.status === 'hashed' && (
                <div className="text-sm">
                  <p className="font-medium text-slate-800">
                    {fileHash.fileName}
                  </p>
                  <p
                    className="mt-1 font-mono text-xs text-slate-500"
                    title={fileHash.hash}
                  >
                    {shortenHash(fileHash.hash)}
                  </p>
                  <DuplicateNotice state={duplicate} />
                  <button
                    type="button"
                    onClick={() => setFileHash({ status: 'idle' })}
                    className="mt-2 text-sm font-medium text-brand-600 hover:underline"
                  >
                    Choose a different file
                  </button>
                </div>
              )}

              {fileHash.status === 'error' && (
                <div className="text-sm">
                  <p className="font-medium text-red-700">
                    Couldn&apos;t read this file.
                  </p>
                  <p className="mt-1 text-red-600">{fileHash.message}</p>
                  <button
                    type="button"
                    onClick={() => setFileHash({ status: 'idle' })}
                    className="mt-2 text-sm font-medium text-brand-600 hover:underline"
                  >
                    Try again
                  </button>
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

          <button
            type="submit"
            disabled={isBusy}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {issueState.status === 'awaiting-signature' && <Spinner light />}
            {issueState.status === 'awaiting-signature'
              ? 'Confirm in your wallet…'
              : issueState.status === 'pending'
                ? 'Waiting for confirmation…'
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

