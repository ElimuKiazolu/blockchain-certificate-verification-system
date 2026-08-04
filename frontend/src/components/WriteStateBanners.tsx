import { SEPOLIA_NETWORK } from '../contract'
import { shortenHash } from '../lib/format'

/**
 * The shared presentation of an on-chain WRITE's states (docs/07 §2, R3-R5).
 *
 * Every write in this app — single issuance, batch issuance, revocation —
 * runs the same state machine: idle → awaiting-signature → pending (tx hash +
 * explorer link) → confirmed, with `rejected` and `failed` as distinct,
 * recoverable branches. These banners were extracted from the Slice 2
 * issuance form so revocation reuses that machine's presentation verbatim
 * rather than growing a third near-copy, keeping the wording and the
 * rejected-vs-reverted distinction identical everywhere.
 *
 * The rejected/failed split matters: "you closed the wallet prompt" and "the
 * chain refused this" need different next steps, and must never be shown as
 * the same thing.
 */

export function Spinner({ light, small }: { light?: boolean; small?: boolean }) {
  const size = small ? 'h-3 w-3' : 'h-4 w-4'
  const border = light
    ? 'border-white/30 border-t-white'
    : 'border-brand-200 border-t-brand-600'
  return (
    <span
      className={`inline-block shrink-0 animate-spin rounded-full border-2 ${size} ${border}`}
      aria-hidden="true"
    />
  )
}

/** Submitted and waiting for confirmation — never a dead end (R3). */
export function PendingBanner({ txHash }: { txHash: string }) {
  const txUrl = `${SEPOLIA_NETWORK.blockExplorerUrl}/tx/${txHash}`
  return (
    <div className="mt-4 flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
      <Spinner />
      <div className="text-sm">
        <p className="font-medium text-brand-900">
          Waiting for {SEPOLIA_NETWORK.name} to confirm…
        </p>
        <p className="mt-0.5 text-brand-700">
          This usually takes 15–60 seconds. You can keep this page open.
        </p>
        <a
          href={txUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block font-mono text-xs text-brand-600 hover:underline"
        >
          {shortenHash(txHash)} — view on Etherscan ↗
        </a>
      </div>
    </div>
  )
}

/**
 * The user declined the wallet prompt (R5). Amber, not red: nothing failed and
 * nothing was sent — their input is intact and they can simply submit again.
 */
export function RejectedBanner({
  message = 'You closed or rejected the wallet prompt — nothing was sent. Your details are still here; submit again when ready.',
  onDismiss,
}: {
  message?: string
  onDismiss: () => void
}) {
  return (
    <div className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <div>
        <p className="font-medium">Request declined</p>
        <p className="mt-0.5">{message}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 font-medium text-amber-700 hover:text-amber-900"
      >
        Dismiss
      </button>
    </div>
  )
}

/** The chain refused the write — reason in plain words, app state unchanged (R4). */
export function FailedBanner({
  title,
  message,
  onDismiss,
}: {
  title: string
  message: string
  onDismiss: () => void
}) {
  return (
    <div className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-0.5">{message}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 font-medium text-red-700 hover:text-red-900"
      >
        Dismiss
      </button>
    </div>
  )
}
