import { useWallet } from '../wallet/context'
import { shortenAddress } from '../lib/format'
import { useRoleRead } from '../wallet/useRoleRead'
import { SEPOLIA_NETWORK } from '../contract'

/**
 * The sidebar's wallet affordance, on a dark navy panel.
 *
 * Every wallet state from docs/07 R5 stays distinct — missing / connecting /
 * connected / wrong-network — and connecting is ALWAYS reachable: a
 * disconnected visitor sees the button right here, so the public verifier
 * never becomes a dead end for someone who needs to sign in as an issuer.
 *
 * Connected, it offers "Switch" (MetaMask's account picker, see
 * `switchAccount`) alongside "Disconnect" (app-side reset). Switch exists
 * because plain reconnecting cannot change account once permission is granted.
 */
export function WalletControl({ compact = false }: { compact?: boolean }) {
  const {
    status,
    account,
    isCorrectNetwork,
    error,
    connect,
    switchAccount,
    disconnect,
    switchToSepolia,
    clearError,
  } = useWallet()
  const { state: role } = useRoleRead()

  if (status === 'no-provider') {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noreferrer"
        className="block rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-white/15"
      >
        Install MetaMask
      </a>
    )
  }

  if (status === 'connected' && account) {
    return (
      <div className="rounded-xl border border-white/15 bg-white/[0.07] p-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              isCorrectNetwork ? 'bg-emerald-400' : 'bg-amber-400'
            }`}
            aria-hidden="true"
          />
          <span
            className="truncate font-mono text-sm text-white"
            title={account}
          >
            {shortenAddress(account)}
          </span>
        </div>

        {/* The role itself is stated in the sidebar's role card; only the
            states that card can't express are surfaced here — a wrong network,
            an in-flight read, or a read that FAILED (which must never be
            mistaken for "no role", docs/07 §3). */}
        {!compact && (
          <p className="mt-1 pl-4 text-xs text-brand-200">
            {!isCorrectNetwork
              ? `Wrong network — switch to ${SEPOLIA_NETWORK.name}`
              : role.status === 'loading'
                ? 'Checking role…'
                : role.status === 'error'
                  ? "Role unknown — couldn't reach the registry"
                  : ''}
          </p>
        )}

        {!isCorrectNetwork && (
          <button
            type="button"
            onClick={() => void switchToSepolia()}
            className="mt-2 w-full rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-600"
          >
            Switch to {SEPOLIA_NETWORK.name}
          </button>
        )}

        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={() => void switchAccount()}
            className="flex-1 rounded-lg border border-white/20 px-2.5 py-1.5 text-xs font-medium text-brand-100 transition-colors hover:bg-white/10"
          >
            Switch
          </button>
          <button
            type="button"
            onClick={disconnect}
            className="flex-1 rounded-lg border border-white/20 px-2.5 py-1.5 text-xs font-medium text-brand-100 transition-colors hover:bg-white/10"
          >
            Disconnect
          </button>
        </div>

        {error && (
          <p className="mt-2 flex items-start justify-between gap-2 text-xs text-amber-200">
            <span>{error.message}</span>
            <button
              type="button"
              onClick={clearError}
              className="shrink-0 font-semibold underline"
            >
              OK
            </button>
          </p>
        )}
      </div>
    )
  }

  const connecting = status === 'connecting'
  return (
    <div>
      <button
        type="button"
        onClick={() => void connect()}
        disabled={connecting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-brand-900 shadow-sm transition-colors hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {connecting && (
          <span
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-900/30 border-t-brand-900"
            aria-hidden="true"
          />
        )}
        {connecting ? 'Connecting…' : 'Connect Wallet'}
      </button>
      {!compact && (
        <p className="mt-2 text-xs leading-relaxed text-brand-200">
          Only needed to issue or administer. Verifying a certificate needs no
          wallet at all.
        </p>
      )}
      {error && (
        <p className="mt-2 flex items-start justify-between gap-2 text-xs text-amber-200">
          <span>{error.message}</span>
          <button
            type="button"
            onClick={clearError}
            className="shrink-0 font-semibold underline"
          >
            OK
          </button>
        </p>
      )}
    </div>
  )
}
