import type { ReactNode } from 'react'
import type { CertStatus, VerifyResult } from '../lib/readClient'
import { CERTIFICATE_REGISTRY_ADDRESS, SEPOLIA_NETWORK } from '../contract'
import { formatDate, shortenAddress, shortenHash } from '../lib/format'

/**
 * The verdict IS the interface (docs/04 §5). Each of the four on-chain states
 * gets a distinct color + icon + plain-language line; status colors are used
 * ONLY here so they carry meaning. NOT_FOUND is neutral slate — a real answer,
 * not an alarm. A read/RPC failure is a *different* component (ReadErrorNotice),
 * never this one, so "couldn't check" can never look like NOT FOUND.
 */
interface VerdictConfig {
  label: string
  tagline: string
  card: string // banner border + tint
  chip: string // icon circle background
  icon: string // icon stroke color
  heading: string // heading text color
  Icon: () => ReactNode
}

const VERDICTS: Record<CertStatus, VerdictConfig> = {
  VALID: {
    label: 'Valid certificate',
    tagline: 'This certificate is authentic and recorded on-chain.',
    card: 'border-emerald-200 bg-emerald-50',
    chip: 'bg-emerald-100',
    icon: 'text-emerald-700',
    heading: 'text-emerald-900',
    Icon: ShieldCheckIcon,
  },
  EXPIRED: {
    label: 'Certificate expired',
    tagline: 'This certificate was genuine but has passed its expiry date.',
    card: 'border-amber-200 bg-amber-50',
    chip: 'bg-amber-100',
    icon: 'text-amber-700',
    heading: 'text-amber-900',
    Icon: ClockIcon,
  },
  REVOKED: {
    label: 'Certificate revoked',
    tagline: 'This certificate was revoked by the issuer and is no longer valid.',
    card: 'border-red-200 bg-red-50',
    chip: 'bg-red-100',
    icon: 'text-red-700',
    heading: 'text-red-900',
    Icon: RevokedIcon,
  },
  NOT_FOUND: {
    label: 'No certificate found',
    tagline: 'No certificate matching this hash is recorded on-chain.',
    card: 'border-slate-200 bg-slate-50',
    chip: 'bg-slate-200',
    icon: 'text-slate-600',
    heading: 'text-slate-800',
    Icon: QuestionIcon,
  },
}

interface VerdictResultProps {
  result: VerifyResult
  checkedHash: string
  onReset: () => void
}

export function VerdictResult({
  result,
  checkedHash,
  onReset,
}: VerdictResultProps) {
  const config = VERDICTS[result.status]
  const cert = result.certificate
  const contractUrl = `${SEPOLIA_NETWORK.blockExplorerUrl}/address/${CERTIFICATE_REGISTRY_ADDRESS}`

  return (
    <div className="space-y-4">
      {/* Verdict banner */}
      <div className={`rounded-2xl border p-6 shadow-sm ${config.card}`}>
        <div className="flex items-start gap-4">
          <span
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${config.chip} ${config.icon}`}
            aria-hidden="true"
          >
            <config.Icon />
          </span>
          <div>
            {/* Text label pairs with the icon + color — never color alone (a11y). */}
            <h2 className={`text-2xl font-semibold tracking-tight ${config.heading}`}>
              {config.label}
            </h2>
            <p className="mt-1 text-slate-600">{config.tagline}</p>
          </div>
        </div>
      </div>

      {/* Metadata — shown for existing certs only (docs/04 §5). */}
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
                className="font-mono text-indigo-600 hover:underline"
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
                  className="text-indigo-600 hover:underline"
                >
                  View file (IPFS)
                </a>
              }
            />
          )}
        </dl>
      )}

      {/* Trust signals — present for every verdict, incl. NOT_FOUND, so it's
          clear the check was real and live on-chain. */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
        <div className="flex items-center gap-2 font-medium text-slate-600">
          <LockIcon />
          Checked live on-chain · {SEPOLIA_NETWORK.name}
        </div>
        <dl className="mt-2 space-y-1">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-slate-400">Hash</dt>
            <dd className="font-mono text-slate-600" title={checkedHash}>
              {shortenHash(checkedHash)}
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-slate-400">Contract</dt>
            <dd>
              <a
                href={contractUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-indigo-600 hover:underline"
              >
                {shortenAddress(CERTIFICATE_REGISTRY_ADDRESS)}
              </a>
            </dd>
          </div>
        </dl>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
      >
        ← Verify another certificate
      </button>
    </div>
  )
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="bg-white px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value}</dd>
    </div>
  )
}

/* ---- Icons (inline SVG, stroke = currentColor) ---- */

function ShieldCheckIcon() {
  return (
    <svg
      className="h-6 w-6"
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
      className="h-6 w-6"
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
      className="h-6 w-6"
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
      className="h-6 w-6"
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

function LockIcon() {
  return (
    <svg
      className="h-4 w-4 text-slate-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}
