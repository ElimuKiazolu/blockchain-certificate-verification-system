import { NetworkBanner } from '../components/NetworkBanner'
import { ConnectWalletButton } from '../components/ConnectWalletButton'
import { RequireIssuer } from '../components/RequireIssuer'
import { IssuerDashboard } from '../components/IssuerDashboard'

/**
 * Issuer dashboard route (`/issuer`) — Phase 6.
 *
 * Wallet + role gated: {@link RequireIssuer} guards the whole dashboard, so
 * only a wallet holding ISSUER_ROLE or DEFAULT_ADMIN_ROLE (read live on-chain)
 * reaches {@link IssuerDashboard}; every other case renders an explicit gate
 * state. Reuses the Phase-4 wallet machine + role read — no duplicated wallet
 * logic. Reads only in this slice; no writes yet.
 *
 * The wrong-network banner is scoped here (as on `/wallet`), never global, so
 * it can't appear on the public verifier.
 */
export function IssuerPage() {
  return (
    <>
      <NetworkBanner />
      <section className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 lg:px-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="inline-flex items-center font-mono text-xs uppercase tracking-[0.18em] text-brand-600">
              Issuer dashboard
            </span>
            <h1 className="mt-3 font-serif text-3xl font-semibold tracking-tight text-brand-900 sm:text-4xl">
              Issue certificates
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
              Connect an authorized institutional wallet to issue tamper-proof
              certificates to the on-chain registry. Access is gated by your
              on-chain role — issuing is reserved for authorized institutions.
            </p>
          </div>
          <div className="pt-1">
            <ConnectWalletButton />
          </div>
        </div>

        <div className="mt-8">
          <RequireIssuer>
            {({ data, account }) => (
              <IssuerDashboard data={data} account={account} />
            )}
          </RequireIssuer>
        </div>
      </section>
    </>
  )
}
