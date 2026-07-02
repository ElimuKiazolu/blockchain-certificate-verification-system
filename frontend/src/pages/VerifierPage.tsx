import { useCallback, useState, type FormEvent } from 'react'
import {
  isValidCertHash,
  verifyByHash,
  type VerifyResult,
} from '../lib/readClient'
import { VerdictResult } from '../components/VerdictResult'
import { ReadErrorNotice } from '../components/ReadErrorNotice'

/**
 * Public verifier (Phase 5, Slice 1) — wallet-free, verify by hash.
 *
 * Explicit states (docs/07 §2): idle → loading → success(verdict) | error.
 * A read failure lands in `error` (ReadErrorNotice), never in a verdict, so a
 * network problem is never shown as NOT FOUND.
 */
type VerifyState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; result: VerifyResult; checkedHash: string }
  | { status: 'error'; message: string; checkedHash: string }

export function VerifierPage() {
  const [hash, setHash] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [state, setState] = useState<VerifyState>({ status: 'idle' })

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

  const isLoading = state.status === 'loading'

  return (
    <section className="mx-auto w-full max-w-2xl px-6 py-14">
      <div className="text-center">
        <span className="inline-flex items-center rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          Public verifier · No wallet required
        </span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Verify a certificate
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-base text-slate-600">
          Check a certificate&apos;s authenticity directly against the
          blockchain. No account, no wallet — the result is read live from the
          Sepolia registry, the single source of truth.
        </p>
      </div>

      <form onSubmit={onSubmit} className="mt-8" noValidate>
        <label
          htmlFor="cert-hash"
          className="block text-sm font-medium text-slate-700"
        >
          Certificate hash
        </label>
        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
          <input
            id="cert-hash"
            type="text"
            value={hash}
            onChange={(e) => setHash(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={validationError !== null}
            aria-describedby={validationError ? 'cert-hash-error' : undefined}
            className={`min-w-0 flex-1 rounded-lg border bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:ring-2 ${
              validationError
                ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
                : 'border-slate-300 focus:border-indigo-400 focus:ring-indigo-100'
            }`}
          />
          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
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
          <p className="mt-2 text-sm text-slate-500">
            Paste the certificate&apos;s on-chain hash (0x + 64 hex characters).
          </p>
        )}
      </form>

      <div className="mt-8">
        {state.status === 'idle' && (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
            Enter a certificate hash above to check its status.
          </p>
        )}

        {state.status === 'loading' && (
          <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-10 text-slate-600">
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"
              aria-hidden="true"
            />
            Checking the blockchain…
          </div>
        )}

        {state.status === 'success' && (
          <VerdictResult
            result={state.result}
            checkedHash={state.checkedHash}
            onReset={reset}
          />
        )}

        {state.status === 'error' && (
          <ReadErrorNotice
            message={state.message}
            onRetry={() => void runVerify(state.checkedHash)}
          />
        )}
      </div>
    </section>
  )
}
