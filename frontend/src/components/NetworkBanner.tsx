import { useWallet } from '../wallet/context'
import { SEPOLIA_NETWORK } from '../contract'

/**
 * Amber "wrong network" banner (docs/04 §6, docs/07 R5). Shows only when a
 * wallet is connected but not on Sepolia, and offers a one-click switch.
 */
export function NetworkBanner() {
  const { status, isCorrectNetwork, switchToSepolia } = useWallet()

  if (status !== 'connected' || isCorrectNetwork) return null

  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-6 py-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
        <span>
          Wrong network. This app reads from{' '}
          <strong>{SEPOLIA_NETWORK.name}</strong>. Contract reads are paused
          until you switch.
        </span>
        <button
          type="button"
          onClick={switchToSepolia}
          className="self-start rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-700 sm:self-auto"
        >
          Switch to {SEPOLIA_NETWORK.name}
        </button>
      </div>
    </div>
  )
}
