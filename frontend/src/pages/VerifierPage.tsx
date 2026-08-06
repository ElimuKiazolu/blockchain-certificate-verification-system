import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import {
  isValidCertHash,
  verifyByHash,
  verifyBatchCertificate,
  type VerifyResult,
} from '../lib/readClient'
import {
  decodeBatchQrPayload,
  type BatchCertificateInput,
} from '../lib/batchVerify'
import { verifyMembers, type MemberResult } from '../lib/bulkVerify'
import { VerdictResult } from '../components/VerdictResult'
import { ReadErrorNotice } from '../components/ReadErrorNotice'
import { VerifyModeTabs, type VerifyMode } from '../components/VerifyModeTabs'
import { FileUploadPanel } from '../components/FileUploadPanel'
import { BatchVerifyPanel } from '../components/BatchVerifyPanel'
import { BulkVerifyResults } from '../components/BulkVerifyResults'

// The QR decoder (@zxing/*) is a large dependency — code-split so
// Paste/Upload users never load it; it only fetches when Scan is selected.
const QrScannerPanel = lazy(() =>
  import('../components/QrScannerPanel').then((m) => ({
    default: m.QrScannerPanel,
  })),
)

/**
 * Public verifier (Phase 5, extended in Phase 6 Slice 3b) — wallet-free;
 * verify by hash / file / QR / batch proof.
 *
 * Explicit states (docs/07 §2): idle → loading → success(verdict) | error.
 * A read failure lands in `error` (ReadErrorNotice), never in a verdict, so a
 * network problem is never shown as NOT FOUND.
 *
 * ONE pipeline, two kinds of target. Paste, upload, and scan still resolve to
 * a bytes32 hash and take the single-cert path exactly as before. Slice 3b
 * adds a *batch* target — the fields + Merkle proof that Slice 3a bundled with
 * a cohort certificate — which the contract re-checks against a stored root.
 * Both land in the same state machine and the same `VerdictResult`.
 */
type VerifyTarget =
  | { kind: 'single'; hash: string }
  | { kind: 'batch'; input: BatchCertificateInput }

type VerifyState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; result: VerifyResult; target: VerifyTarget }
  | { status: 'error'; message: string; target: VerifyTarget }

/** The hash a verdict is "about", whichever path produced it. */
function targetHash(target: VerifyTarget): string {
  return target.kind === 'single' ? target.hash : target.input.certHash
}

/**
 * Whole-cohort verification (Slice 3c) is a separate state from the
 * single-verdict machine above: its answer is a table of many outcomes, not
 * one verdict, so it cannot be squeezed into `VerifyResult`. The two are
 * mutually exclusive — starting either clears the other — so the result region
 * only ever shows one answer.
 */
interface BulkState {
  results: MemberResult[]
  progress: { completed: number; total: number } | null
}

const TRUST_POINTS = [
  'No wallet or account needed',
  'Read live from Ethereum',
  'Tamper-proof by design',
]

export function VerifierPage() {
  const [mode, setMode] = useState<VerifyMode>('paste')
  const [hash, setHash] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [state, setState] = useState<VerifyState>({ status: 'idle' })
  const [batchPrefill, setBatchPrefill] = useState<{
    records: BatchCertificateInput[]
    source: string
    key: number
  } | null>(null)
  const [bulk, setBulk] = useState<BulkState | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const runVerify = useCallback(async (target: VerifyTarget) => {
    setBulk(null) // a single verdict replaces any cohort results on screen
    setState({ status: 'loading' })
    try {
      const result =
        target.kind === 'single'
          ? await verifyByHash(target.hash)
          : await verifyBatchCertificate(target.input)
      setState({ status: 'success', result, target })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong.'
      setState({ status: 'error', message, target })
    }
  }, [])

  // Kept as the exact `(hash: string) => void` shape the existing paste /
  // upload / scan panels already call — their behavior is untouched.
  const runVerifyHash = useCallback(
    (hash: string) => void runVerify({ kind: 'single', hash }),
    [runVerify],
  )

  const runVerifyBatch = useCallback(
    (input: BatchCertificateInput, source: string) => {
      setBatchPrefill({ records: [input], source, key: Date.now() })
      setMode('batch')
      void runVerify({ kind: 'batch', input })
    },
    [runVerify],
  )

  /**
   * Run (or re-run) a set of members. Reads are throttled inside
   * `verifyMembers`; results stream in via `onResult` so the table fills
   * progressively instead of sitting blank until the last row lands.
   *
   * `slotFor` maps a member back to its row in the on-screen table, which is
   * what lets a retry of only the unchecked rows update those rows in place.
   */
  const runBulk = useCallback(
    async (
      members: BatchCertificateInput[],
      slotFor: (memberIndex: number) => number,
      seed: MemberResult[],
    ) => {
      setState({ status: 'idle' }) // cohort results replace any single verdict
      const settled = [...seed]
      setBulk({
        results: settled,
        progress: { completed: 0, total: members.length },
      })

      await verifyMembers(members, {
        onResult: (result) => {
          const slot = slotFor(result.index)
          settled[slot] = { ...result, index: slot }
        },
        onProgress: (completed) => {
          setBulk({
            results: [...settled],
            progress:
              completed < members.length
                ? { completed, total: members.length }
                : null,
          })
        },
      })
    },
    [],
  )

  const verifyAll = useCallback(
    (members: BatchCertificateInput[]) => {
      void runBulk(members, (i) => i, [])
    },
    [runBulk],
  )

  /** Re-check only the rows whose read failed — never the settled verdicts. */
  const retryUnchecked = useCallback(() => {
    if (!bulk) return
    const pending = bulk.results.filter(
      (row) => row?.outcome.kind === 'unchecked',
    )
    if (pending.length === 0) return
    const slots = pending.map((row) => row.index)
    void runBulk(
      pending.map((row) => row.member),
      (i) => slots[i],
      bulk.results,
    )
  }, [bulk, runBulk])

  // A proof-carrying QR opened as a link (`/?batch=…`) — the common case when
  // a phone's native camera app scans it — loads and verifies on arrival.
  // Single-cert links are untouched.
  useEffect(() => {
    const encoded = new URLSearchParams(window.location.search).get('batch')
    if (!encoded) return
    const record = decodeBatchQrPayload(`?batch=${encoded}`)
    if (record) runVerifyBatch(record, 'scanned link')
  }, [runVerifyBatch])

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = hash.trim()
    if (!isValidCertHash(trimmed)) {
      setValidationError(
        'Enter a valid certificate hash: 0x followed by 64 hexadecimal characters.',
      )
      inputRef.current?.focus()
      return
    }
    setValidationError(null)
    runVerifyHash(trimmed)
  }

  const reset = () => {
    setState({ status: 'idle' })
    setHash('')
    setValidationError(null)
    setBatchPrefill(null)
    setBulk(null)
  }

  const onModeChange = (next: VerifyMode) => {
    setMode(next)
    reset()
  }

  const isLoading = state.status === 'loading'
  const isBulkRunning = bulk?.progress !== null && bulk !== null

  return (
    // Left-aligned and wider now that the sidebar hero carries the brand
    // statement — this column is the working surface, not a landing page.
    <section className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
      <div>
        <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-brand-600">
          <span className="h-px w-6 bg-brand-300" aria-hidden="true" />
          Public verifier
        </span>
        <h1 className="mt-4 text-balance font-serif text-[clamp(1.75rem,1.2rem+2vw,2.5rem)] font-semibold leading-tight tracking-tight text-brand-900">
          Verify a certificate
        </h1>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-slate-600">
          Confirm a certificate&apos;s authenticity directly against the
          blockchain — the single source of truth. No account, no wallet; the
          result is read live from the on-chain registry.
        </p>
      </div>

      {/* Verify panel — one shared card, three input modes */}
      <div className="mt-9 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <VerifyModeTabs active={mode} onChange={onModeChange} />

        {mode === 'paste' && (
          <form onSubmit={onSubmit} noValidate className="mt-5">
            <label
              htmlFor="cert-hash"
              className="block text-sm font-semibold text-slate-800"
            >
              Certificate hash
            </label>
            <div className="mt-2 flex flex-col gap-2.5 sm:flex-row">
              <input
                id="cert-hash"
                ref={inputRef}
                type="text"
                name="certificateHash"
                value={hash}
                onChange={(e) => setHash(e.target.value)}
                placeholder="0x…"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={validationError !== null}
                aria-describedby={
                  validationError ? 'cert-hash-error' : 'cert-hash-help'
                }
                className={`min-h-11 min-w-0 flex-1 rounded-xl border bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:ring-4 ${
                  validationError
                    ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
                    : 'border-slate-300 focus:border-brand-500 focus:ring-brand-100'
                }`}
              />
              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoading && (
                  <span
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
                    aria-hidden="true"
                  />
                )}
                {isLoading ? 'Checking…' : 'Verify'}
              </button>
            </div>
            {validationError ? (
              <p id="cert-hash-error" className="mt-2 text-sm text-red-600">
                {validationError}
              </p>
            ) : (
              <p id="cert-hash-help" className="mt-2 text-sm text-slate-500">
                Paste the certificate&apos;s on-chain hash (0x + 64 hex
                characters).
              </p>
            )}
          </form>
        )}

        {mode === 'upload' && (
          <div className="mt-5">
            <FileUploadPanel onHashReady={runVerifyHash} busy={isLoading} />
          </div>
        )}

        {mode === 'scan' && (
          <div className="mt-5">
            <Suspense fallback={<QrScannerLoadingFallback />}>
              <QrScannerPanel
                onHashReady={runVerifyHash}
                onBatchReady={(record) => runVerifyBatch(record, 'scanned QR')}
              />
            </Suspense>
          </div>
        )}

        {mode === 'batch' && (
          <div className="mt-5">
            <BatchVerifyPanel
              key={batchPrefill?.key ?? 'blank'}
              busy={isLoading || isBulkRunning}
              prefill={batchPrefill ?? undefined}
              onRecordReady={(record) =>
                void runVerify({ kind: 'batch', input: record })
              }
              onVerifyAll={verifyAll}
            />
          </div>
        )}
      </div>

      {/* Trust strip */}
      <ul className="mx-auto mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs text-slate-500">
        {TRUST_POINTS.map((point) => (
          <li key={point} className="inline-flex items-center gap-1.5">
            <CheckIcon />
            {point}
          </li>
        ))}
      </ul>

      {/* Result region — polite live region so verdicts are announced. */}
      <div className="mt-8" aria-live="polite">
        {/* Cohort results take over the region when a bulk run is active;
            the single-verdict states below are mutually exclusive with it. */}
        {bulk && (
          <BulkVerifyResults
            results={bulk.results}
            progress={bulk.progress}
            onRetryUnchecked={retryUnchecked}
            onReset={reset}
          />
        )}

        {!bulk && state.status === 'idle' && (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center text-sm text-slate-500">
            {mode === 'paste' &&
              'Enter a certificate hash above to check its status.'}
            {mode === 'upload' &&
              'Upload a certificate file above to check its status.'}
            {mode === 'scan' &&
              'Scan a certificate QR code above to check its status.'}
            {mode === 'batch' &&
              'Load your certificate bundle above to check its status.'}
          </p>
        )}

        {!bulk && state.status === 'loading' && (
          <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-12 text-slate-600">
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"
              aria-hidden="true"
            />
            Checking the blockchain…
          </div>
        )}

        {!bulk && state.status === 'success' && (
          <div className="animate-verdict">
            <VerdictResult
              result={state.result}
              checkedHash={targetHash(state.target)}
              onReset={reset}
              batch={
                state.target.kind === 'batch'
                  ? { root: state.target.input.root }
                  : undefined
              }
            />
          </div>
        )}

        {!bulk && state.status === 'error' && (
          <div className="animate-verdict">
            <ReadErrorNotice
              message={state.message}
              onRetry={() => void runVerify(state.target)}
            />
          </div>
        )}
      </div>
    </section>
  )
}

function QrScannerLoadingFallback() {
  return (
    <div className="flex aspect-[4/3] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-900 text-sm text-slate-300">
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
        aria-hidden="true"
      />
      Loading scanner…
    </div>
  )
}

function CheckIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 text-emerald-600"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12 5 5L20 7" />
    </svg>
  )
}
