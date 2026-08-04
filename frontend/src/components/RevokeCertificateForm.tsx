import { useCallback, useRef, useState, type ChangeEvent } from 'react'
import type { ContractTransactionResponse } from 'ethers'
import { hashFile } from '../lib/fileHash'
import {
  isValidCertHash,
  verifyByHash,
  verifyBatchCertificate,
  type VerifyResult,
} from '../lib/readClient'
import { parseBulkInput } from '../lib/bulkVerify'
import type { BatchCertificateInput } from '../lib/batchVerify'
import {
  classifyIssueError,
  revokeCertificate,
  revokeBatchCertificate,
  type IssueError,
} from '../lib/issuerWrite'
import { getEthereum } from '../wallet/ethereum'
import { SEPOLIA_NETWORK } from '../contract'
import { formatDate, shortenAddress, shortenHash } from '../lib/format'
import {
  FailedBanner,
  PendingBanner,
  RejectedBanner,
  Spinner,
} from './WriteStateBanners'

/**
 * Certificate revocation (docs/03 B4). Revocation is a WRITE, so it runs the
 * same explicit state machine as issuance — awaiting-signature → pending →
 * confirmed, with rejected and reverted as distinct branches — reusing the
 * shared banners in WriteStateBanners.tsx.
 *
 * Two paths, mirroring issuance:
 *   • single — a certHash (pasted, or a file's SHA-256) → revokeCertificate
 *   • batch  — a bundle member's fields + proof → revokeBatchCertificate,
 *              which re-proves Merkle membership before revoking.
 *
 * Revocation is irreversible and destructive, so nothing is submitted blind:
 * the certificate is READ from the chain first and its real details are shown
 * for confirmation. Already-revoked and not-found are caught here rather than
 * spending gas on a guaranteed revert (the contract reverts on both anyway —
 * this is a courtesy, not the guard).
 *
 * No revocation REASON is collected: the contract has no field for one
 * (`CertificateRevoked(certHash, revokedBy, timestamp)`), so asking for one
 * would imply a permanence the chain wouldn't actually record.
 */

type RevokeMode = 'single' | 'batch'

/** What the pre-revoke read found. Its own machine — a read, not the write. */
type TargetState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'loaded'; result: VerifyResult; certHash: string }
  | { status: 'error'; message: string }

type RevokeState =
  | { status: 'idle' }
  | { status: 'awaiting-signature' }
  | { status: 'pending'; txHash: string }
  | { status: 'confirmed'; txHash: string; certHash: string; recipientName: string }
  | { status: 'rejected' }
  | { status: 'failed'; message: string }

export function RevokeCertificateForm() {
  const [mode, setMode] = useState<RevokeMode>('single')
  const [target, setTarget] = useState<TargetState>({ status: 'empty' })
  const [revokeState, setRevokeState] = useState<RevokeState>({ status: 'idle' })

  // Single-cert inputs
  const [hashInput, setHashInput] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [inputError, setInputError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Batch inputs
  const [members, setMembers] = useState<BatchCertificateInput[]>([])
  const [selected, setSelected] = useState(0)
  const [bundleName, setBundleName] = useState<string | null>(null)
  const bundleInputRef = useRef<HTMLInputElement>(null)

  const isBusy =
    revokeState.status === 'awaiting-signature' ||
    revokeState.status === 'pending'

  /** Read the single certificate that a hash points at, before revoking it. */
  const loadSingle = useCallback(async (certHash: string) => {
    setTarget({ status: 'loading' })
    setRevokeState({ status: 'idle' })
    try {
      const result = await verifyByHash(certHash)
      setTarget({ status: 'loaded', result, certHash })
    } catch (err) {
      setTarget({
        status: 'error',
        message: err instanceof Error ? err.message : 'Something went wrong.',
      })
    }
  }, [])

  /** Same, for one member of a batch — re-proved on-chain against its root. */
  const loadBatchMember = useCallback(async (member: BatchCertificateInput) => {
    setTarget({ status: 'loading' })
    setRevokeState({ status: 'idle' })
    try {
      const result = await verifyBatchCertificate(member)
      setTarget({ status: 'loaded', result, certHash: member.certHash })
    } catch (err) {
      setTarget({
        status: 'error',
        message: err instanceof Error ? err.message : 'Something went wrong.',
      })
    }
  }, [])

  function switchMode(next: RevokeMode) {
    if (next === mode) return
    setMode(next)
    setTarget({ status: 'empty' })
    setRevokeState({ status: 'idle' })
    setInputError(null)
  }

  function onHashSubmit() {
    const trimmed = hashInput.trim()
    if (!isValidCertHash(trimmed)) {
      setInputError(
        'Enter a valid certificate hash: 0x followed by 64 hexadecimal characters.',
      )
      return
    }
    setInputError(null)
    setFileName(null)
    void loadSingle(trimmed)
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setInputError(null)
    try {
      const hash = await hashFile(file)
      setHashInput(hash)
      setFileName(file.name)
      void loadSingle(hash)
    } catch (err) {
      setInputError(
        err instanceof Error ? err.message : 'Could not hash this file.',
      )
    }
  }

  async function onBundleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const parsed = parseBulkInput(await file.text())
    if (parsed.error) {
      setInputError(parsed.error)
      setMembers([])
      setBundleName(null)
      return
    }
    setInputError(null)
    setMembers(parsed.members)
    setBundleName(file.name)
    setSelected(0)
    setTarget({ status: 'empty' })
  }

  function applyError(err: unknown) {
    const classified: IssueError = classifyIssueError(err)
    if (classified.kind === 'rejected') {
      setRevokeState({ status: 'rejected' })
    } else {
      setRevokeState({ status: 'failed', message: classified.message })
    }
  }

  async function onRevoke() {
    if (target.status !== 'loaded') return
    const eth = getEthereum()
    if (!eth) {
      setRevokeState({
        status: 'failed',
        message: 'MetaMask provider unavailable.',
      })
      return
    }

    const member = mode === 'batch' ? members[selected] : undefined
    const recipientName =
      target.result.certificate?.recipientName ?? member?.recipientName ?? ''

    setRevokeState({ status: 'awaiting-signature' })
    let tx: ContractTransactionResponse
    try {
      tx =
        member !== undefined
          ? // Verbatim fields + proof; the contract recomputes the leaf.
            await revokeBatchCertificate(eth, {
              root: member.root,
              certHash: member.certHash,
              ipfsCID: member.ipfsCID,
              recipientName: member.recipientName,
              courseTitle: member.courseTitle,
              expiresAt: member.expiresAt,
              proof: member.proof,
            })
          : await revokeCertificate(eth, target.certHash)
    } catch (err) {
      applyError(err)
      return
    }

    setRevokeState({ status: 'pending', txHash: tx.hash })
    try {
      await tx.wait()
      setRevokeState({
        status: 'confirmed',
        txHash: tx.hash,
        certHash: target.certHash,
        recipientName,
      })
    } catch (err) {
      applyError(err)
    }
  }

  function resetAll() {
    setTarget({ status: 'empty' })
    setRevokeState({ status: 'idle' })
    setHashInput('')
    setFileName(null)
    setInputError(null)
    setMembers([])
    setBundleName(null)
    setSelected(0)
  }

  if (revokeState.status === 'confirmed') {
    return (
      <RevokedCard
        txHash={revokeState.txHash}
        certHash={revokeState.certHash}
        recipientName={revokeState.recipientName}
        onDone={resetAll}
      />
    )
  }

  const status = target.status === 'loaded' ? target.result.status : null
  const canRevoke = status === 'VALID' || status === 'EXPIRED'

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="font-serif text-xl font-semibold text-brand-900">
        Revoke a certificate
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
        Revoking marks a certificate invalid on the {SEPOLIA_NETWORK.name}{' '}
        registry. The record is preserved, not deleted — the verifier will
        report it as <strong>REVOKED</strong> from then on. This writes to the
        chain, costs gas, and <strong>cannot be undone</strong>.
      </p>

      {revokeState.status === 'pending' && (
        <PendingBanner txHash={revokeState.txHash} />
      )}
      {revokeState.status === 'rejected' && (
        <RejectedBanner
          message="You closed or rejected the wallet prompt — nothing was revoked. The certificate is unchanged."
          onDismiss={() => setRevokeState({ status: 'idle' })}
        />
      )}
      {revokeState.status === 'failed' && (
        <FailedBanner
          title="Couldn't revoke this certificate"
          message={revokeState.message}
          onDismiss={() => setRevokeState({ status: 'idle' })}
        />
      )}

      <div className="mt-5 inline-flex rounded-lg border border-slate-300 bg-slate-50 p-1 text-sm">
        <ModeButton
          active={mode === 'single'}
          disabled={isBusy}
          onClick={() => switchMode('single')}
        >
          Single certificate
        </ModeButton>
        <ModeButton
          active={mode === 'batch'}
          disabled={isBusy}
          onClick={() => switchMode('batch')}
        >
          Batch member
        </ModeButton>
      </div>

      <fieldset disabled={isBusy} className="mt-5 space-y-4 disabled:opacity-60">
        {mode === 'single' ? (
          <div>
            <label
              htmlFor="revoke-hash"
              className="block text-sm font-semibold text-slate-800"
            >
              Certificate hash
            </label>
            <div className="mt-1.5 flex flex-col gap-2.5 sm:flex-row">
              <input
                id="revoke-hash"
                type="text"
                value={hashInput}
                onChange={(e) => setHashInput(e.target.value)}
                placeholder="0x…"
                spellCheck={false}
                autoComplete="off"
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
              />
              <button
                type="button"
                onClick={onHashSubmit}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:bg-slate-50"
              >
                Look up
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Or{' '}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="font-semibold text-brand-600 hover:underline"
              >
                upload the certificate file
              </button>{' '}
              — its SHA-256 is the on-chain identifier.
              {fileName && (
                <span className="ml-1 text-slate-600">({fileName})</span>
              )}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              onChange={(e) => void onFileChange(e)}
              className="sr-only"
              aria-label="Certificate file to revoke"
            />
          </div>
        ) : (
          <div>
            <span className="block text-sm font-semibold text-slate-800">
              Batch bundle
            </span>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => bundleInputRef.current?.click()}
                className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:bg-slate-50"
              >
                Choose bundle (.json or .csv)
              </button>
              {bundleName && (
                <span className="text-sm text-slate-500">{bundleName}</span>
              )}
            </div>
            <input
              ref={bundleInputRef}
              type="file"
              accept=".json,application/json,.csv,text/csv"
              onChange={(e) => void onBundleChange(e)}
              className="sr-only"
              aria-label="Batch bundle file"
            />
            <p className="mt-2 text-xs text-slate-500">
              The same bundle issued with the cohort. Revoking a batch member
              re-proves its Merkle membership on-chain, so every field must
              match what was issued.
            </p>

            {members.length > 0 && (
              <label className="mt-3 block">
                <span className="text-sm font-semibold text-slate-800">
                  Certificate to revoke ({members.length} in this bundle)
                </span>
                <select
                  value={selected}
                  onChange={(e) => {
                    setSelected(Number(e.target.value))
                    setTarget({ status: 'empty' })
                  }}
                  className="mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
                >
                  {members.map((member, i) => (
                    <option key={`${member.certHash}-${i}`} value={i}>
                      {member.recipientName} — {member.courseTitle}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void loadBatchMember(members[selected])}
                  className="mt-2.5 inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:bg-slate-50"
                >
                  Look up
                </button>
              </label>
            )}
          </div>
        )}

        {inputError && <p className="text-sm text-red-600">{inputError}</p>}

        {/* Pre-revoke confirmation: what exactly is about to be invalidated. */}
        {target.status === 'loading' && (
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <Spinner /> Looking up this certificate on {SEPOLIA_NETWORK.name}…
          </p>
        )}

        {target.status === 'error' && (
          <div className="rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 text-sm">
            <p className="font-semibold text-orange-900">
              Couldn&apos;t check this certificate
            </p>
            <p className="mt-0.5 text-orange-800">
              We couldn&apos;t reach the registry, so we can&apos;t show you
              what would be revoked. This is a connection problem —{' '}
              <strong>not</strong> a sign the certificate is missing. Revoking
              is irreversible, so it stays disabled until the lookup succeeds.
            </p>
            <p className="mt-2 font-mono text-xs break-words text-orange-700/80">
              {target.message}
            </p>
            <button
              type="button"
              onClick={() =>
                mode === 'batch'
                  ? void loadBatchMember(members[selected])
                  : void loadSingle(hashInput.trim())
              }
              className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
            >
              Retry lookup
            </button>
          </div>
        )}

        {target.status === 'loaded' && (
          <TargetPreview
            result={target.result}
            certHash={target.certHash}
            batchRoot={mode === 'batch' ? members[selected]?.root : undefined}
          />
        )}

        {canRevoke && (
          <button
            type="button"
            onClick={() => void onRevoke()}
            disabled={isBusy}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {revokeState.status === 'awaiting-signature' && <Spinner light />}
            {revokeState.status === 'awaiting-signature'
              ? 'Confirm in your wallet…'
              : revokeState.status === 'pending'
                ? 'Waiting for confirmation…'
                : 'Revoke this certificate'}
          </button>
        )}
      </fieldset>
    </div>
  )
}

/**
 * What the chain says about the certificate right now. Doubles as the guard:
 * REVOKED and NOT_FOUND explain why there's nothing to do, and the caller
 * only renders the revoke button for VALID/EXPIRED.
 */
function TargetPreview({
  result,
  certHash,
  batchRoot,
}: {
  result: VerifyResult
  certHash: string
  batchRoot?: string
}) {
  const cert = result.certificate

  if (result.status === 'NOT_FOUND') {
    return (
      <div className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm">
        <p className="font-semibold text-slate-800">Nothing to revoke</p>
        <p className="mt-0.5 text-slate-600">
          No certificate matching this is recorded on-chain
          {batchRoot
            ? ' under that batch root — check the bundle is the one issued for this cohort.'
            : '. Check the hash, or the file you uploaded.'}
        </p>
      </div>
    )
  }

  if (result.status === 'REVOKED') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm">
        <p className="font-semibold text-red-900">Already revoked</p>
        <p className="mt-0.5 text-red-800">
          This certificate has already been revoked and shows as REVOKED on the
          verifier. No further action is needed.
        </p>
        {cert && (
          <p className="mt-1 text-red-800">
            {cert.recipientName} — {cert.courseTitle}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="text-sm font-semibold text-amber-900">
        You are about to revoke this certificate
      </p>
      <p className="mt-0.5 text-sm text-amber-800">
        Currently <strong>{result.status}</strong>. Confirm these are the right
        details before continuing — revocation is permanent.
      </p>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Row label="Recipient" value={cert?.recipientName || '—'} />
        <Row label="Course / title" value={cert?.courseTitle || '—'} />
        <Row
          label="Issued by"
          value={cert ? shortenAddress(cert.issuer) : '—'}
          mono
        />
        <Row label="Issued" value={cert ? formatDate(cert.issuedAt) : '—'} />
        <Row
          label="Expiry"
          value={cert?.expiresAt ? formatDate(cert.expiresAt) : 'No expiry'}
        />
        <Row label="Certificate" value={shortenHash(certHash)} mono />
        {batchRoot && (
          <Row label="Batch root" value={shortenHash(batchRoot)} mono />
        )}
      </dl>
    </div>
  )
}

function RevokedCard({
  txHash,
  certHash,
  recipientName,
  onDone,
}: {
  txHash: string
  certHash: string
  recipientName: string
  onDone: () => void
}) {
  const txUrl = `${SEPOLIA_NETWORK.blockExplorerUrl}/tx/${txHash}`
  return (
    <div className="animate-verdict rounded-2xl border border-red-200 bg-red-50/60 p-6 shadow-sm sm:p-8">
      <div className="flex items-start gap-4 sm:gap-5">
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-sm"
          aria-hidden="true"
        >
          <svg
            className="h-7 w-7"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="m6 6 12 12" />
          </svg>
        </span>
        <div className="min-w-0">
          <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wider text-red-800 ring-1 ring-red-200">
            Confirmed
          </span>
          <h2 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-red-900">
            Certificate revoked
          </h2>
          <p className="mt-1 text-slate-600">
            {recipientName ? `${recipientName}'s certificate` : 'This certificate'}{' '}
            is now recorded as revoked. Anyone verifying it will see{' '}
            <strong>REVOKED</strong> — the record is preserved, not deleted.
          </p>
        </div>
      </div>

      <dl className="mt-6 space-y-3 text-sm">
        <div>
          <dt className="font-mono text-[0.7rem] font-medium uppercase tracking-wide text-slate-400">
            Certificate
          </dt>
          <dd className="mt-0.5 font-mono text-slate-800" title={certHash}>
            {shortenHash(certHash)}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[0.7rem] font-medium uppercase tracking-wide text-slate-400">
            Transaction
          </dt>
          <dd className="mt-0.5">
            <a
              href={txUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-brand-600 hover:underline"
            >
              {shortenHash(txHash)} ↗
            </a>
          </dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={onDone}
        className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
      >
        Revoke another
      </button>
    </div>
  )
}

function Row({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <dt className="font-mono text-[0.7rem] font-medium uppercase tracking-wide text-amber-700/70">
        {label}
      </dt>
      <dd
        className={`mt-0.5 break-words text-amber-950 ${mono ? 'font-mono text-xs' : ''}`}
      >
        {value}
      </dd>
    </div>
  )
}

function ModeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        active
          ? 'bg-white text-brand-900 shadow-sm'
          : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  )
}
