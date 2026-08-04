import { NetworkBanner } from '../components/NetworkBanner'
import { ConnectWalletButton } from '../components/ConnectWalletButton'
import { RequireAdmin } from '../components/RequireAdmin'
import { AdminPanel } from '../components/AdminPanel'

/**
 * Admin panel route (`/admin`) — Phase 6, final slice.
 *
 * Gated by {@link RequireAdmin}, which requires DEFAULT_ADMIN_ROLE
 * specifically (read live on-chain) — stricter than the issuer gate, because
 * `grantRole`/`revokeRole` are restricted to the role's admin on-chain.
 * Reuses the Phase-4 wallet machine + the shared role read; no duplicated
 * wallet logic.
 *
 * The wrong-network banner is scoped here (as on `/issuer` and `/wallet`),
 * never global, so it can't appear on the public verifier.
 */
export function AdminPage() {
  return (
    <>
      <NetworkBanner />
      <section className="mx-auto w-full max-w-4xl px-5 py-12 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="inline-flex items-center font-mono text-xs uppercase tracking-[0.18em] text-brand-600">
              Administration
            </span>
            <h1 className="mt-3 font-serif text-3xl font-semibold tracking-tight text-brand-900 sm:text-4xl">
              Manage institutions
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
              Authorize an institution to issue certificates, or withdraw that
              permission. Role changes are recorded on-chain and take effect
              immediately — access here is restricted to registry
              administrators.
            </p>
          </div>
          <div className="pt-1">
            <ConnectWalletButton />
          </div>
        </div>

        <div className="mt-8">
          <RequireAdmin>
            {({ account }) => <AdminPanel account={account} />}
          </RequireAdmin>
        </div>
      </section>
    </>
  )
}
