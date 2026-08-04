import type { ReactNode } from 'react'
import type { CertStatus, VerifyResult } from '../lib/readClient'
import { CERTIFICATE_REGISTRY_ADDRESS, SEPOLIA_NETWORK } from '../contract'
import { formatDate, shortenAddress, shortenHash } from '../lib/format'

/**
 * The verdict IS the interface (docs/04 §5). Each of the four on-chain states
 * gets a distinct color + filled "seal" medallion + status badge + plain line;
 * status colors are used ONLY here so they carry meaning. NOT_FOUND is neutral
 * slate — a real answer, not an alarm. A read/RPC failure is a *different*
 * component (ReadErrorNotice, orange, square icon), never this one, so
 * "couldn't check" can never look like NOT FOUND.
 */
interface VerdictConfig {
  badge: string
  label: string
  tagline: string
  card: string // banner border + tint
  medallion: string // filled seal background
  heading: string // heading text color
  badgeClass: string // status pill styling
  Icon: () => ReactNode
}

const VERDICTS: Record<CertStatus, VerdictConfig> = {
  VALID: {
    badge: 'Verified',
    label: 'Valid certificate',
    tagline: 'This certificate is authentic and recorded on-chain.',
    card: 'border-emerald-200 bg-emerald-50/60',
    medallion: 'bg-emerald-600',
    heading: 'text-emerald-900',
    badgeClass: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
    Icon: ShieldCheckIcon,
  },
  EXPIRED: {
    badge: 'Expired',
    label: 'Certificate expired',
    tagline: 'This certificate was genuine but has passed its expiry date.',
    card: 'border-amber-200 bg-amber-50/60',
    medallion: 'bg-amber-500',
    heading: 'text-amber-900',
    badgeClass: 'bg-amber-100 text-amber-800 ring-amber-200',
    Icon: ClockIcon,
  },
  REVOKED: {
    badge: 'Revoked',
    label: 'Certificate revoked',
    tagline: 'This certificate was revoked by the issuer and is no longer valid.',
    card: 'border-red-200 bg-red-50/60',
    medallion: 'bg-red-600',
    heading: 'text-red-900',
    badgeClass: 'bg-red-100 text-red-800 ring-red-200',
    Icon: RevokedIcon,
  },
  NOT_FOUND: {
    badge: 'Not on record',
    label: 'No certificate found',
    tagline: 'No certificate matching this hash is recorded on-chain.',
    card: 'border-slate-300 bg-slate-50',
    medallion: 'bg-slate-500',
    heading: 'text-slate-800',
    badgeClass: 'bg-slate-200 text-slate-700 ring-slate-300',
    Icon: QuestionIcon,
  },
}

interface VerdictResultProps {
  result: VerifyResult
  checkedHash: string
  onReset: () => void
  /**
   * Present only for a BATCH certificate (Phase 6, Slice 3b): the certificate
   * was proven to be a member of this Merkle root rather than looked up by
   * hash. Optional and purely additive — single-cert rendering is unchanged.
   */
  batch?: { root: string }
}

export function VerdictResult({
  result,
  checkedHash,
  onReset,
  batch,
}: VerdictResultProps) {
  const config = VERDICTS[result.status]
  const cert = result.certificate
  const contractUrl = `${SEPOLIA_NETWORK.blockExplorerUrl}/address/${CERTIFICATE_REGISTRY_ADDRESS}`

  return (
    <div className="space-y-4">
      {/* Verdict banner — seal + badge + label (never color alone: icon+text). */}
      <div className={`rounded-2xl border p-6 shadow-sm ${config.card}`}>
        <div className="flex items-start gap-4 sm:gap-5">
          <span
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white shadow-sm ${config.medallion}`}
            aria-hidden="true"
          >
            <config.Icon />
          </span>
          <div className="min-w-0">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wider ring-1 ${config.badgeClass}`}
            >
              {config.badge}
            </span>
            <h2
              className={`mt-2 font-serif text-2xl font-semibold tracking-tight ${config.heading}`}
            >
              {config.label}
            </h2>
            <p className="mt-1 text-slate-600">{config.tagline}</p>
          </div>
        </div>
      </div>

      {/* Batch NOT_FOUND is genuinely ambiguous — the contract returns it both
          for an unknown root and for a leaf that doesn't reproduce. Say which
          possibilities exist instead of implying "forged". */}
      {batch && result.status === 'NOT_FOUND' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          <p className="font-semibold text-slate-800">
            What this means for a batch certificate
          </p>
          <p className="mt-1">
            The registry could not match these details to the batch root
            supplied. That happens when:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>this batch was never issued on this registry, or</li>
            <li>
              the certificate isn&apos;t a member of it, or
            </li>
            <li>
              any detail — name, course, expiry, document reference — differs
              from what was issued, even by one character.
            </li>
          </ul>
          <p className="mt-2">
            Every field is part of the on-chain fingerprint, so an edited
            bundle cannot produce a match.
          </p>
        </div>
      )}

      {/* Certificate details — existing certs only (docs/04 §5). */}
      {cert && (
        <dl className="grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-2">
          <Field label="Recipient" value={cert.recipientName || '—'} />
          <Field label="Course / title" value={cert.courseTitle || '—'} />
          <Field
            label="Issuer"
            value={
              <a
                href={`${SEPOLIA_NETWORK.blockExplorerUrl}/address/${cert.issuer}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-sm font-mono text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400"
              >
                {shortenAddress(cert.issuer)}
              </a>
            }
          />
          <Field label="Issued" value={formatDate(cert.issuedAt)} />
          <Field
            label="Expiry"
            value={cert.expiresAt ? formatDate(cert.expiresAt) : 'No expiry'}
          />
          {cert.ipfsCID && (
            <Field
              label="Document"
              value={
                <a
                  href={`https://ipfs.io/ipfs/${cert.ipfsCID}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-sm text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400"
                >
                  View file (IPFS)
                </a>
              }
            />
          )}
        </dl>
      )}

      {/* On-chain proof — the trust signals, presented as credible evidence. */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-brand-900">
          <SealIcon />
          On-chain proof
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Checked live against the deployed registry — no intermediary.
        </p>
        <dl className="mt-3 space-y-2 text-sm">
          <ProofRow label="Network">
            <span className="inline-flex items-center gap-1.5 text-slate-700">
              <span
                className="h-2 w-2 rounded-full bg-emerald-500"
                aria-hidden="true"
              />
              {SEPOLIA_NETWORK.name} testnet
            </span>
          </ProofRow>
          <ProofRow label="Contract">
            <a
              href={contractUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm font-mono text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400"
            >
              {shortenAddress(CERTIFICATE_REGISTRY_ADDRESS)}
            </a>
          </ProofRow>
          <ProofRow label="Hash">
            <span className="font-mono text-slate-600" title={checkedHash}>
              {shortenHash(checkedHash)}
            </span>
          </ProofRow>
          {batch && (
            <ProofRow label="Batch root">
              <span className="font-mono text-slate-600" title={batch.root}>
                {shortenHash(batch.root)}
              </span>
            </ProofRow>
          )}
        </dl>
        {batch && (
          <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
            Batch certificate — one Merkle root commits the whole cohort.
            {cert
              ? ' The registry recomputed this certificate’s leaf from the details above and matched it against that root, so those details are what was issued.'
              : ' The proof was checked on-chain against that root.'}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onReset}
        className="rounded-sm text-sm font-semibold text-brand-600 hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400"
      >
        ← Verify another certificate
      </button>
    </div>
  )
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="bg-white px-4 py-3">
      <dt className="font-mono text-[0.7rem] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm break-words text-slate-800">{value}</dd>
    </div>
  )
}

function ProofRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3">
      <dt className="w-20 shrink-0 font-mono text-[0.7rem] uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  )
}

/* ---- Icons (inline SVG, stroke = currentColor) ---- */

function ShieldCheckIcon() {
  return (
    <svg
      className="h-7 w-7"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

function ClockIcon() {
  return (
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
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function RevokedIcon() {
  return (
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
  )
}

function QuestionIcon() {
  return (
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
      <path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3" />
      <path d="M12 17h.01" />
    </svg>
  )
}

function SealIcon() {
  return (
    <svg
      className="h-4 w-4 text-brand-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="9" r="6" />
      <path d="m9 14-1.5 7L12 19l4.5 2L15 14" />
      <path d="m9.5 9 1.7 1.7L15 7" />
    </svg>
  )
}
