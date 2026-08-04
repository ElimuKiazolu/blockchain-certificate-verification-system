import { useState, type ReactNode } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { SEPOLIA_NETWORK } from '../contract'
import { shortenHash } from '../lib/format'

/**
 * The "confirmed" view — the milestone moment (docs/03 B2: "a QR
 * (verification URL) is generated"). Shows the cert hash, the tx on
 * Etherscan, and a QR that drops straight into the Phase-5 public verifier
 * (its Scan mode already extracts a hash from a `?hash=` URL param — see
 * src/lib/readClient.ts extractCertHash).
 */
interface IssuedCertificateCardProps {
  certHash: string
  txHash: string
  recipientName: string
  courseTitle: string
  onIssueAnother: () => void
}

export function IssuedCertificateCard({
  certHash,
  txHash,
  recipientName,
  courseTitle,
  onIssueAnother,
}: IssuedCertificateCardProps) {
  const [copied, setCopied] = useState(false)
  const verifyUrl = `${window.location.origin}/?hash=${certHash}`
  const txUrl = `${SEPOLIA_NETWORK.blockExplorerUrl}/tx/${txHash}`

  const copyHash = async () => {
    try {
      await navigator.clipboard.writeText(certHash)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access denied/unavailable — the hash is still visible and
      // selectable, so this is a nicety, not a blocker.
    }
  }

  return (
    <div className="animate-verdict rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm sm:p-8">
      <div className="flex items-start gap-4 sm:gap-5">
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm"
          aria-hidden="true"
        >
          <ShieldCheckIcon />
        </span>
        <div className="min-w-0">
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wider text-emerald-800 ring-1 ring-emerald-200">
            Confirmed
          </span>
          <h2 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-emerald-900">
            Certificate issued
          </h2>
          <p className="mt-1 text-slate-600">
            <strong>{recipientName}</strong> · {courseTitle} is now recorded
            on-chain and can be verified by anyone.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          <Row label="Certificate hash">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-slate-800" title={certHash}>
                {shortenHash(certHash)}
              </span>
              <button
                type="button"
                onClick={() => void copyHash()}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </Row>
          <Row label="Transaction">
            <a
              href={txUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm font-mono text-sm text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400"
            >
              {shortenHash(txHash)} ↗
            </a>
          </Row>
          <Row label="Verify link">
            <a
              href="/"
              className="rounded-sm text-sm text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400"
            >
              Open the public verifier →
            </a>
          </Row>
        </div>

        <div className="flex flex-col items-center gap-2 justify-self-center sm:justify-self-end">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <QRCodeSVG
              value={verifyUrl}
              size={128}
              level="M"
              marginSize={0}
              title="Scan to verify this certificate"
            />
          </div>
          <p className="max-w-[9rem] text-center text-xs text-slate-500">
            Scan to verify — print or attach to the certificate.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onIssueAnother}
        className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        Issue another certificate
      </button>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[0.7rem] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}

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
