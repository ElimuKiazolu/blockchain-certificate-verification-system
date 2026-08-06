import { NetworkBanner } from '../components/NetworkBanner'
import { WalletCard } from '../components/WalletCard'
import { ConnectWalletButton } from '../components/ConnectWalletButton'

/**
 * Issuer / wallet route (`/wallet`) — preserves the Phase-4 foundation: live
 * MetaMask connection + on-chain role read with full resilience states. This
 * is the wallet-gated side (issuers/admins, Phase 6+); the public verifier at
 * `/` is intentionally wallet-free. The wrong-network banner is scoped here,
 * not global, so it never appears on the public verifier.
 */
export function WalletPage() {
  return (
    <>
      <NetworkBanner />
      <section className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 lg:px-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="inline-flex items-center font-mono text-xs uppercase tracking-[0.18em] text-brand-600">
              Issuer &amp; admin access
            </span>
            <h1 className="mt-3 font-serif text-3xl font-semibold tracking-tight text-brand-900 sm:text-4xl">
              Connect your wallet
            </h1>
            <p className="mt-3 max-w-2xl text-base text-slate-600">
              Institutions and administrators connect a wallet to read their
              on-chain role. Issuing and revoking certificates arrive in a later
              phase; this page currently performs reads only.
            </p>
          </div>
          <div className="pt-1">
            <ConnectWalletButton />
          </div>
        </div>

        <div className="mt-8">
          <WalletCard />
        </div>
      </section>
    </>
  )
}
