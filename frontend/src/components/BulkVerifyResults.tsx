import type { ReactNode } from 'react'
import type { CertStatus } from '../lib/readClient'
import {
  buildVerificationReportCsv,
  reportFileName,
  summarize,
  type MemberResult,
  type MemberOutcome,
} from '../lib/bulkVerify'
import { downloadTextFile } from '../lib/batchOutputs'
import {
  CERTIFICATE_REGISTRY_ADDRESS,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_NETWORK,
} from '../contract'
import { shortenHash } from '../lib/format'

/**
 * Whole-cohort results (Phase 6, Slice 3c).
 *
 * Colour semantics are inherited from VerdictResult so a row means the same
 * thing here as it does on a single verdict: emerald VALID, amber EXPIRED, red
 * REVOKED, slate NOT FOUND. "Couldn't check" reuses the ORANGE of
 * ReadErrorNotice — deliberately a non-verdict colour — and is counted in its
 * own summary tile, never folded into a failure count. A registrar reading
 * "3 couldn't be checked" must never mistake it for "3 invalid".
 */

interface OutcomeStyle {
  label: string
  pill: string
  dot: string
}

const VERDICT_STYLES: Record<CertStatus, OutcomeStyle> = {
  VALID: {
    label: 'Valid',
    pill: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
    dot: 'bg-emerald-600',
  },
  EXPIRED: {
    label: 'Expired',
    pill: 'bg-amber-100 text-amber-800 ring-amber-200',
    dot: 'bg-amber-500',
  },
  REVOKED: {
    label: 'Revoked',
    pill: 'bg-red-100 text-red-800 ring-red-200',
    dot: 'bg-red-600',
  },
  NOT_FOUND: {
    label: 'Not on record',
    pill: 'bg-slate-200 text-slate-700 ring-slate-300',
    dot: 'bg-slate-500',
  },
}

const UNCHECKED_STYLE: OutcomeStyle = {
  label: "Couldn't check",
  pill: 'bg-orange-100 text-orange-800 ring-orange-200',
  dot: 'bg-orange-500',
}

function styleFor(outcome: MemberOutcome): OutcomeStyle {
  return outcome.kind === 'unchecked'
    ? UNCHECKED_STYLE
    : VERDICT_STYLES[outcome.status]
}

interface BulkVerifyResultsProps {
  results: MemberResult[]
  /** Progress while a run is in flight; null once it has finished. */
  progress: { completed: number; total: number } | null
  onRetryUnchecked: () => void
  onReset: () => void
}

export function BulkVerifyResults({
  results,
  progress,
  onRetryUnchecked,
  onReset,
}: BulkVerifyResultsProps) {
  const settled = results.filter(Boolean)
  const summary = summarize(settled)
  const running = progress !== null
  const root = settled[0]?.member.root

  function downloadReport() {
    const checkedAt = new Date()
    downloadTextFile(
      reportFileName(root ?? '0x00000000', checkedAt),
      buildVerificationReportCsv(settled, {
        checkedAt,
        contractAddress: CERTIFICATE_REGISTRY_ADDRESS,
        chainId: SEPOLIA_CHAIN_ID,
      }),
      'text/csv',
    )
  }

  return (
    <div className="space-y-4">
      {running && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 p-5">
          <div className="flex items-center gap-3">
            <span
              className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-brand-900" aria-live="polite">
              Checking {progress.completed} of {progress.total} certificates…
            </p>
          </div>
          <div
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-brand-100"
            role="progressbar"
            aria-valuenow={progress.completed}
            aria-valuemin={0}
            aria-valuemax={progress.total}
          >
            <div
              className="h-full rounded-full bg-brand-600 transition-[width] duration-300"
              style={{
                width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Headline — the three categories are never merged into one number. */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="font-serif text-2xl font-semibold tracking-tight text-brand-900">
          {running
            ? 'Verifying cohort…'
            : `${summary.valid} of ${summary.total} valid`}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {summary.failedVerdict > 0 && (
            <>
              <strong>{summary.failedVerdict}</strong> did not pass
              {summary.unchecked > 0 && ' · '}
            </>
          )}
          {summary.unchecked > 0 && (
            <>
              <strong>{summary.unchecked}</strong> couldn&apos;t be checked
              (connection problem — not a verdict)
            </>
          )}
          {summary.failedVerdict === 0 && summary.unchecked === 0 && !running && (
            <>Every certificate in this cohort is valid on {SEPOLIA_NETWORK.name}.</>
          )}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Tile label="Valid" value={summary.valid} style={VERDICT_STYLES.VALID} />
          <Tile label="Expired" value={summary.expired} style={VERDICT_STYLES.EXPIRED} />
          <Tile label="Revoked" value={summary.revoked} style={VERDICT_STYLES.REVOKED} />
          <Tile label="Not on record" value={summary.notFound} style={VERDICT_STYLES.NOT_FOUND} />
          <Tile label="Couldn't check" value={summary.unchecked} style={UNCHECKED_STYLE} />
        </div>

        {summary.unchecked > 0 && !running && (
          <div className="mt-4 rounded-xl border border-orange-300 bg-orange-50 p-4">
            <p className="text-sm font-semibold text-orange-900">
              {summary.unchecked} certificate
              {summary.unchecked === 1 ? '' : 's'} couldn&apos;t be checked
            </p>
            <p className="mt-1 text-sm text-orange-800">
              We couldn&apos;t reach the blockchain for{' '}
              {summary.unchecked === 1 ? 'this one' : 'these'}. Their status is{' '}
              <strong>unknown</strong> — not invalid, and not missing.
            </p>
            <button
              type="button"
              onClick={onRetryUnchecked}
              className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
            >
              Retry these {summary.unchecked}
            </button>
          </div>
        )}

        {!running && (
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={downloadReport}
              className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              Download report (CSV)
            </button>
            <button
              type="button"
              onClick={onReset}
              className="inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-semibold text-brand-600 hover:underline"
            >
              Check another cohort
            </button>
          </div>
        )}
      </div>

      {/* Per-row breakdown. Failures and unchecked rows first: a registrar
          needs the exceptions, not a scroll through the passing majority. */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <caption className="sr-only">
              Verification result for every certificate in the cohort
            </caption>
            <thead className="sticky top-0 bg-slate-50 text-left">
              <tr>
                <Th>Recipient</Th>
                <Th>Course / title</Th>
                <Th>Certificate</Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody>
              {(running
                ? settled // keep input order while filling, so rows don't jump
                : [...settled].sort((a, b) => rank(a.outcome) - rank(b.outcome))
              ).map((result) => {
                  const style = styleFor(result.outcome)
                  return (
                    <tr
                      key={`${result.index}-${result.member.certHash}`}
                      className="border-t border-slate-100"
                    >
                      <Td>
                        <span className="font-medium text-slate-800">
                          {result.member.recipientName || '—'}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-slate-600">
                          {result.member.courseTitle || '—'}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className="font-mono text-xs text-slate-500"
                          title={result.member.certHash}
                        >
                          {shortenHash(result.member.certHash)}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${style.pill}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${style.dot}`}
                            aria-hidden="true"
                          />
                          {style.label}
                        </span>
                        {result.outcome.kind === 'unchecked' && (
                          <span className="mt-1 block max-w-xs font-mono text-[0.65rem] break-words text-orange-700/80">
                            {result.outcome.message}
                          </span>
                        )}
                      </Td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>

      {root && (
        <p className="text-xs text-slate-500">
          Checked against batch root{' '}
          <span className="font-mono" title={root}>
            {shortenHash(root)}
          </span>{' '}
          on the {SEPOLIA_NETWORK.name} registry{' '}
          <span className="font-mono">
            {shortenHash(CERTIFICATE_REGISTRY_ADDRESS)}
          </span>
          .
        </p>
      )}
    </div>
  )
}

/** Sort order: things needing attention first, passing certificates last. */
function rank(outcome: MemberOutcome): number {
  if (outcome.kind === 'unchecked') return 0
  switch (outcome.status) {
    case 'NOT_FOUND':
      return 1
    case 'REVOKED':
      return 2
    case 'EXPIRED':
      return 3
    case 'VALID':
      return 4
  }
}

function Tile({
  label,
  value,
  style,
}: {
  label: string
  value: number
  style: OutcomeStyle
}) {
  return (
    <div
      className={`rounded-xl px-3 py-2.5 ring-1 ${style.pill} ${value === 0 ? 'opacity-50' : ''}`}
    >
      <p className="font-serif text-xl font-semibold leading-none">{value}</p>
      <p className="mt-1 text-[0.7rem] font-medium uppercase tracking-wide">
        {label}
      </p>
    </div>
  )
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th
      scope="col"
      className="px-4 py-2.5 font-mono text-[0.7rem] font-medium uppercase tracking-wide text-slate-400"
    >
      {children}
    </th>
  )
}

function Td({ children }: { children: ReactNode }) {
  return <td className="px-4 py-2.5 align-top">{children}</td>
}
