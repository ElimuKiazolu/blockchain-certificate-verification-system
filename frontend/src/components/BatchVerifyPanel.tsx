import { useRef, useState, type ChangeEvent } from 'react'
import {
  describeBundleMismatch,
  type BatchCertificateInput,
} from '../lib/batchVerify'
import { parseBulkInput } from '../lib/bulkVerify'
import { shortenHash } from '../lib/format'

/**
 * Batch-certificate input mode (Phase 6, Slice 3b) — the fourth way to reach
 * the ONE shared verify pipeline. A batch certificate isn't identified by its
 * hash alone: the per-cert data lives in the Merkle leaf, so the holder must
 * supply the fields + proof that Slice 3a bundled with their certificate.
 *
 * Everything here is input handling only. A malformed bundle is named exactly
 * and shown inline (docs/07 R11) — it never renders as a verdict, because a
 * bundle we couldn't even parse was never checked on-chain at all.
 */
interface BatchVerifyPanelProps {
  onRecordReady: (record: BatchCertificateInput) => void
  /** Slice 3c: verify every member of the loaded bundle in one run. */
  onVerifyAll: (members: BatchCertificateInput[]) => void
  busy: boolean
  /** A record recovered from a scanned QR or a ?batch= link, pre-loaded here. */
  prefill?: { records: BatchCertificateInput[]; source: string }
}

export function BatchVerifyPanel({
  onRecordReady,
  onVerifyAll,
  busy,
  prefill,
}: BatchVerifyPanelProps) {
  const [text, setText] = useState('')
  const [records, setRecords] = useState<BatchCertificateInput[]>(
    prefill?.records ?? [],
  )
  const [source, setSource] = useState<string | null>(prefill?.source ?? null)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [selected, setSelected] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Slice 3c widened this from JSON-only to "JSON bundle or 3a's CSV export",
  // normalizing both to the same member list. The single-member path below is
  // unchanged — it just reads the first/selected entry of that list.
  function load(raw: string, from: string) {
    const result = parseBulkInput(raw)
    if (result.error) {
      setError(result.error)
      setWarnings([])
      setRecords([])
      setSource(null)
      return
    }
    setError(null)
    setWarnings(result.warnings)
    setRecords(result.members)
    setSource(from)
    setSelected(0)
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      load(await file.text(), file.name)
    } catch {
      setError("That file couldn't be read. Try choosing it again.")
    }
  }

  const record = records[selected] as BatchCertificateInput | undefined
  const mismatch = record ? describeBundleMismatch(record) : null

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        >
          Choose bundle file (.json or .csv)
        </button>
        {source && <span className="text-sm text-slate-500">{source}</span>}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json,.csv,text/csv"
        onChange={(e) => void onFileChange(e)}
        className="sr-only"
        aria-label="Certificate bundle file"
      />

      <label className="mt-4 block">
        <span className="text-sm font-semibold text-slate-800">
          Or paste the bundle
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text.trim() && load(text, 'pasted bundle')}
          rows={5}
          spellCheck={false}
          placeholder={'{ "root": "0x…", "certHash": "0x…", "proof": ["0x…"], … }'}
          className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-xs text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
        />
        <span className="mt-1 block text-xs text-slate-500">
          The whole issued bundle (JSON or the CSV export), or just your own
          entry from it. The proof travels with your certificate — nothing is
          looked up on a server.
        </span>
      </label>

      {text.trim() && (
        <button
          type="button"
          onClick={() => load(text, 'pasted bundle')}
          className="mt-2 text-sm font-semibold text-brand-600 hover:underline"
        >
          Load pasted bundle
        </button>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      {warnings.map((warning) => (
        <p
          key={warning}
          className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          {warning}
        </p>
      ))}

      {/* Slice 3c: the cohort-level action. Offered first because a registrar
          checking a class wants the whole answer, not 200 single lookups —
          but the single-member path below is untouched and still available. */}
      {records.length > 1 && (
        <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="text-sm font-semibold text-brand-900">
            Verify the whole cohort
          </p>
          <p className="mt-0.5 text-sm text-brand-800">
            Check all {records.length} certificates in this bundle against the
            registry in one run, and download a report.
          </p>
          <button
            type="button"
            onClick={() => onVerifyAll(records)}
            disabled={busy}
            className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Verify all {records.length}
          </button>
        </div>
      )}

      {records.length > 1 && (
        <label className="mt-4 block">
          <span className="text-sm font-semibold text-slate-800">
            Or check just one ({records.length} in this bundle)
          </span>
          <select
            value={selected}
            onChange={(e) => setSelected(Number(e.target.value))}
            className="mt-1.5 block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
          >
            {records.map((r, i) => (
              <option key={`${r.certHash}-${i}`} value={i}>
                {r.recipientName} — {r.courseTitle}
              </option>
            ))}
          </select>
        </label>
      )}

      {mismatch && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800"
        >
          {mismatch}
        </p>
      )}

      {record && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="font-mono text-[0.7rem] font-medium uppercase tracking-wide text-slate-400">
            Ready to check
          </p>
          <dl className="mt-2 space-y-1 text-sm">
            <Row label="Recipient" value={record.recipientName || '—'} />
            <Row label="Course" value={record.courseTitle || '—'} />
            <Row label="Batch root" value={shortenHash(record.root)} mono />
            <Row
              label="Proof"
              value={`${record.proof.length} hash${record.proof.length === 1 ? '' : 'es'}`}
            />
          </dl>
          <button
            type="button"
            onClick={() => onRecordReady(record)}
            disabled={busy}
            className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && (
              <span
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
                aria-hidden="true"
              />
            )}
            {busy ? 'Checking…' : 'Verify this certificate'}
          </button>
        </div>
      )}
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
    <div className="flex flex-wrap items-baseline gap-x-3">
      <dt className="w-24 shrink-0 font-mono text-[0.7rem] uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd
        className={`min-w-0 break-words text-slate-800 ${mono ? 'font-mono text-xs' : ''}`}
      >
        {value}
      </dd>
    </div>
  )
}
