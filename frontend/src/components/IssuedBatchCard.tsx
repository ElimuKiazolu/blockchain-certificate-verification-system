import { useMemo, useState, type ReactNode } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { SEPOLIA_NETWORK } from '../contract'
import { shortenHash } from '../lib/format'
import { downloadTextFile, type BatchCertificateRecord } from '../lib/batchOutputs'
import {
  buildCertificateQrPayload,
  QR_PAYLOAD_MAX_CHARS,
} from '../lib/batchVerify'

/**
 * The "confirmed" view for a batch issuance — one root committed for a whole
 * cohort. Distributing the JSON bundle (or CSV) is what makes each certificate
 * verifiable later: the proof travels WITH the certificate, never served by a
 * backend (CLAUDE.md; docs/07 R8's recommended mitigation).
 *
 * Slice 3b upgrades the per-student QR from a bare hash link to a FULL
 * proof-carrying payload — fields + Merkle proof + root, base64url-packed into
 * a verifier URL. Scanning one verifies that certificate on its own, with no
 * bundle file and no backend. Long cohorts mean longer proofs, so the payload
 * is size-checked per student and degrades to a hash-only link rather than
 * emitting a QR too dense to scan (see `buildCertificateQrPayload`).
 */
interface IssuedBatchCardProps {
  txHash: string
  root: string
  records: BatchCertificateRecord[]
  jsonBundle: string
  csvOutput: string
  onIssueAnother: () => void
}

export function IssuedBatchCard({
  txHash,
  root,
  records,
  jsonBundle,
  csvOutput,
  onIssueAnother,
}: IssuedBatchCardProps) {
  const [copied, setCopied] = useState(false)
  const [enlarged, setEnlarged] = useState<number | null>(null)
  const txUrl = `${SEPOLIA_NETWORK.blockExplorerUrl}/tx/${txHash}`

  const qrPayloads = useMemo(
    () =>
      records.map((record) =>
        buildCertificateQrPayload(record, window.location.origin),
      ),
    [records],
  )
  const oversized = qrPayloads.filter((p) => !p.proofCarrying).length
  const largest = qrPayloads.reduce((max, p) => Math.max(max, p.length), 0)

  const copyRoot = async () => {
    try {
      await navigator.clipboard.writeText(root)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access denied/unavailable — the root is still visible/selectable.
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
            Batch issued
          </h2>
          <p className="mt-1 text-slate-600">
            <strong>{records.length}</strong> certificate
            {records.length === 1 ? '' : 's'} committed under one Merkle root.
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <Row label="Merkle root">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-slate-800" title={root}>
              {shortenHash(root)}
            </span>
            <button
              type="button"
              onClick={() => void copyRoot()}
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
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() =>
            downloadTextFile(
              `batch-${root.slice(2, 10)}.json`,
              jsonBundle,
              'application/json',
            )
          }
          className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:bg-slate-50"
        >
          Download JSON bundle
        </button>
        <button
          type="button"
          onClick={() =>
            downloadTextFile(
              `batch-${root.slice(2, 10)}.csv`,
              csvOutput,
              'text/csv',
            )
          }
          className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:bg-slate-50"
        >
          Download CSV
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Distribute the JSON bundle (or CSV) to each student — it carries their
        Merkle proof, which the public verifier needs to check a batch
        certificate. Nothing is served by a backend.
      </p>

      <div className="mt-6">
        <p className="text-sm font-semibold text-slate-800">
          Per-student QR codes
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Each QR carries the student&apos;s details, Merkle proof and batch
          root — scanning one verifies that certificate on its own, with no
          bundle file and no server. Largest payload in this cohort:{' '}
          {largest} characters (limit {QR_PAYLOAD_MAX_CHARS}).
        </p>
        {oversized > 0 && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {oversized} certificate{oversized === 1 ? '' : 's'} in this cohort
            {oversized === 1 ? ' has' : ' have'} a proof too long to encode at
            a reliably scannable density, so{' '}
            {oversized === 1 ? 'its QR links' : 'their QRs link'} to the
            verifier by hash instead. Those students must use the JSON bundle
            to verify — it always contains the full proof.
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {records.map((record, i) => {
            const payload = qrPayloads[i]
            return (
              <div
                key={record.certHash}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-3 text-center"
              >
                {/* A proof-carrying payload needs far more modules than a bare
                    hash link, so the thumbnail is a preview: cameras need
                    roughly 2-3 screen pixels per module, which only the
                    enlarged view provides. */}
                <button
                  type="button"
                  onClick={() => setEnlarged(i)}
                  title={`Enlarge ${record.recipientName}'s QR code`}
                  className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                >
                  <QRCodeSVG
                    value={payload.value}
                    size={132}
                    level="M"
                    marginSize={2}
                    title={`Verification QR for ${record.recipientName}`}
                  />
                </button>
                <p className="max-w-full truncate text-xs font-medium text-slate-700">
                  {record.recipientName}
                </p>
                <p
                  className="font-mono text-[0.65rem] text-slate-400"
                  title={record.certHash}
                >
                  {shortenHash(record.certHash)}
                </p>
                <p
                  className={`text-[0.65rem] font-medium ${
                    payload.proofCarrying ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {payload.proofCarrying ? 'Proof included' : 'Hash only'}
                </p>
              </div>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Select a QR to enlarge it for scanning or printing.
        </p>
      </div>

      {enlarged !== null && records[enlarged] && (
        <EnlargedQr
          name={records[enlarged].recipientName}
          value={qrPayloads[enlarged].value}
          proofCarrying={qrPayloads[enlarged].proofCarrying}
          onClose={() => setEnlarged(null)}
        />
      )}

      <button
        type="button"
        onClick={onIssueAnother}
        className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        Issue another batch
      </button>
    </div>
  )
}

/**
 * Full-size QR for scanning or printing. A proof-carrying payload can run to
 * ~120 modules across; at thumbnail size that's about one screen pixel per
 * module, which no camera will resolve. 320px plus a 4-module quiet zone (the
 * QR spec's requirement) makes it reliably scannable.
 */
function EnlargedQr({
  name,
  value,
  proofCarrying,
  onClose,
}: {
  name: string
  value: string
  proofCarrying: boolean
  onClose: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Verification QR code for ${name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-full overflow-y-auto rounded-2xl bg-white p-6 text-center shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <QRCodeSVG
          value={value}
          size={320}
          level="M"
          marginSize={4}
          title={`Verification QR for ${name}`}
        />
        <p className="mt-3 font-semibold text-slate-800">{name}</p>
        <p className="mt-1 max-w-xs text-xs text-slate-500">
          {proofCarrying
            ? 'Carries the full Merkle proof — scanning this verifies the certificate on its own.'
            : 'Links to the verifier by hash only. This certificate needs its JSON bundle entry to be verified.'}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Close
        </button>
      </div>
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
