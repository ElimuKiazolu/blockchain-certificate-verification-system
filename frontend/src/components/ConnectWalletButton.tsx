import { useWallet } from '../wallet/context'
import { shortenAddress } from '../lib/format'

/**
 * Header wallet affordance. Renders per wallet state (docs/07 R5):
 *   no-provider → "Install MetaMask" link
 *   idle        → "Connect Wallet" button (prompts MetaMask)
 *   connecting  → disabled, "Connecting…"
 *   connected   → address pill (green dot = on Sepolia, amber = wrong network)
 *
 * Rejected / pending / wrong-network messaging is surfaced in the WalletCard.
 */
export function ConnectWalletButton() {
  const { status, account, isCorrectNetwork, connect, disconnect } = useWallet()

  if (status === 'no-provider') {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noreferrer"
        className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
      >
        Install MetaMask
      </a>
    )
  }

  if (status === 'connected' && account) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
          <span
            className={`h-2 w-2 rounded-full ${
              isCorrectNetwork ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
            aria-hidden="true"
          />
          <span className="font-mono">{shortenAddress(account)}</span>
        </span>
        <button
          type="button"
          onClick={disconnect}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
        >
          Disconnect
        </button>
      </div>
    )
  }

  const connecting = status === 'connecting'
  return (
    <button
      type="button"
      onClick={connect}
      disabled={connecting}
      className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {connecting && (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
          aria-hidden="true"
        />
      )}
      {connecting ? 'Connecting…' : 'Connect Wallet'}
    </button>
  )
}
