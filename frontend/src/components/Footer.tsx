import {
  CERTIFICATE_REGISTRY_ADDRESS,
  SEPOLIA_NETWORK,
} from '../contract'
import { shortenAddress } from '../lib/format'

export function Footer() {
  const explorerUrl = `${SEPOLIA_NETWORK.blockExplorerUrl}/address/${CERTIFICATE_REGISTRY_ADDRESS}`

  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-1 px-6 py-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <span>Blockchain-based certificate verification · Course 01CE0716</span>
        {/* Renders the imported contract constants — proves the ABI/address
            boundary is wired into the frontend. */}
        <span className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full bg-emerald-500"
              aria-hidden="true"
            />
            {SEPOLIA_NETWORK.name}
          </span>
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-slate-600 underline-offset-2 hover:text-indigo-600 hover:underline"
          >
            {shortenAddress(CERTIFICATE_REGISTRY_ADDRESS)}
          </a>
        </span>
      </div>
    </footer>
  )
}
