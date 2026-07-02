import { CERTIFICATE_REGISTRY_ADDRESS, SEPOLIA_NETWORK } from '../contract'
import { shortenAddress } from '../lib/format'

export function Footer() {
  const explorerUrl = `${SEPOLIA_NETWORK.blockExplorerUrl}/address/${CERTIFICATE_REGISTRY_ADDRESS}`

  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-5 py-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span>
          Blockchain-based certificate verification
          <span className="mx-1.5 text-slate-300">·</span>
          Course 01CE0716
        </span>
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-600">
            <span
              className="h-1.5 w-1.5 rounded-full bg-emerald-500"
              aria-hidden="true"
            />
            {SEPOLIA_NETWORK.name} testnet
          </span>
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm font-mono text-slate-600 underline-offset-2 hover:text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400"
          >
            {shortenAddress(CERTIFICATE_REGISTRY_ADDRESS)}
          </a>
        </span>
      </div>
    </footer>
  )
}
