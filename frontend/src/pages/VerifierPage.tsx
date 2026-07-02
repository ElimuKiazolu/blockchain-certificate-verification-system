import {
  lazy,
  Suspense,
  useCallback,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import {
  isValidCertHash,
  verifyByHash,
  type VerifyResult,
} from '../lib/readClient'
import { VerdictResult } from '../components/VerdictResult'
import { ReadErrorNotice } from '../components/ReadErrorNotice'
import { VerifyModeTabs, type VerifyMode } from '../components/VerifyModeTabs'
import { FileUploadPanel } from '../components/FileUploadPanel'

// The QR decoder (@zxing/*) is a large dependency — code-split so
// Paste/Upload users never load it; it only fetches when Scan is selected.
const QrScannerPanel = lazy(() =>
  import('../components/QrScannerPanel').then((m) => ({
    default: m.QrScannerPanel,
  })),
)

/**
 * Public verifier (Phase 5) — wallet-free, verify by hash/file/QR.
 *
 * Explicit states (docs/07 §2): idle → loading → success(verdict) | error.
 * A read failure lands in `error` (ReadErrorNotice), never in a verdict, so a
 * network problem is never shown as NOT FOUND. This is the SAME pipeline
 * regardless of input method — paste, upload, and scan all resolve to a
 * bytes32 hash and call the identical `runVerify`. Slice 3 only adds two more
 * ways to produce that hash; the verify/verdict logic itself is unchanged
 * from Slice 1/2.
 */
type VerifyState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; result: VerifyResult; checkedHash: string }
  | { status: 'error'; message: string; checkedHash: string }

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
  const inputRef = useRef<HTMLInputElement>(null)

  const runVerify = useCallback(async (target: string) => {
    setState({ status: 'loading' })
    try {
      const result = await verifyByHash(target)
      setState({ status: 'success', result, checkedHash: target })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong.'
      setState({ status: 'error', message, checkedHash: target })
    }
  }, [])

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
    void runVerify(trimmed)
  }

  const reset = () => {
    setState({ status: 'idle' })
    setHash('')
    setValidationError(null)
  }

  const onModeChange = (next: VerifyMode) => {
    setMode(next)
    reset()
  }

  const isLoading = state.status === 'loading'

  return (
    <section className="mx-auto w-full max-w-2xl px-5 py-12 sm:px-6 sm:py-16">
      <div className="text-center">
        <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-brand-600">
          <span className="h-px w-6 bg-brand-300" aria-hidden="true" />
          Public verifier
          <span className="h-px w-6 bg-brand-300" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-balance font-serif text-[clamp(1.9rem,1.3rem+2.6vw,2.75rem)] font-semibold leading-tight tracking-tight text-brand-900">
          Verify a certificate
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-slate-600">
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
            <FileUploadPanel onHashReady={runVerify} busy={isLoading} />
          </div>
        )}

        {mode === 'scan' && (
          <div className="mt-5">
            <Suspense fallback={<QrScannerLoadingFallback />}>
              <QrScannerPanel onHashReady={runVerify} />
            </Suspense>
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
        {state.status === 'idle' && (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center text-sm text-slate-500">
            {mode === 'paste' &&
              'Enter a certificate hash above to check its status.'}
            {mode === 'upload' &&
              'Upload a certificate file above to check its status.'}
            {mode === 'scan' &&
              'Scan a certificate QR code above to check its status.'}
          </p>
        )}

        {state.status === 'loading' && (
          <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-12 text-slate-600">
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"
              aria-hidden="true"
            />
            Checking the blockchain…
          </div>
        )}

        {state.status === 'success' && (
          <div className="animate-verdict">
            <VerdictResult
              result={state.result}
              checkedHash={state.checkedHash}
              onReset={reset}
            />
          </div>
        )}

        {state.status === 'error' && (
          <div className="animate-verdict">
            <ReadErrorNotice
              message={state.message}
              onRetry={() => void runVerify(state.checkedHash)}
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
