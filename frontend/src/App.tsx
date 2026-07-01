import { Header } from './components/Header'
import { Footer } from './components/Footer'

/**
 * App shell — Phase 4, Slice 1 (foundation only).
 *
 * Header + main content container + footer. No routing yet; the three future
 * surfaces (public verifier, issuer dashboard, admin — see
 * docs/03-User-Journeys-v2.md) are previewed below so the shell anticipates
 * them. Wallet connection and live contract reads arrive in Slice 2.
 */

type Surface = {
  title: string
  description: string
  phase: string
}

const surfaces: Surface[] = [
  {
    title: 'Public Verifier',
    description:
      'Verify a certificate by QR or file upload — no account, no wallet. VALID / EXPIRED / REVOKED / NOT FOUND at a glance.',
    phase: 'Phase 5',
  },
  {
    title: 'Issuer Dashboard',
    description:
      'Institutions issue single or Merkle-batch certificates, generate QR codes, and revoke — wallet + issuer role gated.',
    phase: 'Phase 6–7',
  },
  {
    title: 'Admin Panel',
    description:
      'System owner grants and revokes the issuer role for institutions, with full on-chain visibility.',
    phase: 'Phase 6–7',
  },
]

function App() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <Header />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <span className="inline-flex items-center rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          Phase 4 · Frontend foundation
        </span>

        <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Tamper-proof academic certificates, verifiable in seconds.
        </h1>
        <p className="mt-3 max-w-2xl text-base text-slate-600">
          The blockchain is the single source of truth. This is the application
          shell; wallet connection and live on-chain reads are wired next.
        </p>

        <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {surfaces.map((surface) => (
            <article
              key={surface.title}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">
                  {surface.title}
                </h2>
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                  {surface.phase}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {surface.description}
              </p>
            </article>
          ))}
        </section>
      </main>

      <Footer />
    </div>
  )
}

export default App
