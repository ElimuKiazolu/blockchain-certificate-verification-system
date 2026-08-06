import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useNavLinks } from './useNavLinks'
import { WalletControl } from './WalletControl'

/**
 * The application shell (Phase 8, Slice A) — a left sidebar with the content
 * to its right, replacing the previous top nav.
 *
 * Two widths, one component:
 *   LANDING (/)    35% — a full-height navy "hero" panel: large mark, wordmark,
 *                        positioning line, connect control, then the nav. The
 *                        verifier sits beside it, so the public function is the
 *                        first thing on screen with no wallet involved.
 *   DASHBOARDS     25% — the same panel, compacted into a functional rail so
 *                        the working surface gets the width it needs.
 *
 * Below `lg` the sidebar is not viable as a column, so it becomes a fixed top
 * bar plus a slide-over drawer. Nothing is hidden on mobile — the wallet
 * control and every visible link are in the drawer.
 *
 * Nav contents come from `useNavLinks`, which shows only what the connected
 * wallet can use. That is presentation only: RequireIssuer / RequireAdmin and
 * the contract's own role checks are untouched and remain authoritative.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation()
  const links = useNavLinks()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const isLanding = location.pathname === '/'

  // Never leave the drawer open across a navigation.
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  const sidebarWidth = isLanding
    ? 'lg:w-[35%] lg:max-w-[30rem]'
    : 'lg:w-[25%] lg:max-w-[20rem]'

  return (
    <div className="min-h-screen bg-paper text-slate-900 lg:flex">
      {/* ── Mobile top bar ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-brand-800 bg-brand-900 px-4 py-3 text-white lg:hidden">
        <Link to="/" className="flex items-center gap-2.5">
          <BrandMark className="h-8 w-8" />
          <span className="font-serif text-base font-semibold tracking-tight">
            Certificate Verification
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setDrawerOpen((open) => !open)}
          aria-expanded={drawerOpen}
          aria-controls="app-drawer"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-white/20 text-white"
        >
          <span className="sr-only">{drawerOpen ? 'Close menu' : 'Open menu'}</span>
          {drawerOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      {drawerOpen && (
        <div
          id="app-drawer"
          className="border-b border-brand-800 bg-brand-900 px-4 py-4 text-white lg:hidden"
        >
          <WalletControl compact />
          <nav className="mt-4 space-y-1">
            {links.map((link) => (
              <SidebarLink key={link.to} to={link.to} label={link.label} />
            ))}
          </nav>
        </div>
      )}

      {/* ── Sidebar (lg and up) ────────────────────────────────────── */}
      <aside
        className={`hidden shrink-0 flex-col bg-brand-900 text-white lg:sticky lg:top-0 lg:flex lg:h-screen ${sidebarWidth}`}
      >
        <div
          className={`flex h-full flex-col ${isLanding ? 'px-8 py-10 xl:px-10' : 'px-6 py-8'}`}
        >
          <Link
            to="/"
            className="flex items-center gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-300"
          >
            {/* Placeholder mark — sized generously on the landing panel so the
                3D blockchain cube can drop straight in here later. */}
            <BrandMark className={isLanding ? 'h-14 w-14' : 'h-10 w-10'} />
            <span className="flex flex-col leading-tight">
              <span
                className={`font-serif font-semibold tracking-tight text-white ${
                  isLanding ? 'text-2xl' : 'text-lg'
                }`}
              >
                Certificate Verification
              </span>
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-brand-200">
                On-chain registry
              </span>
            </span>
          </Link>

          {isLanding && (
            <div className="mt-10">
              <h2 className="text-balance font-serif text-[clamp(1.6rem,1rem+1.6vw,2.1rem)] font-semibold leading-tight text-white">
                Proof that survives the institution
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-brand-100">
                Every certificate is committed to the Ethereum blockchain, where
                it can be checked by anyone, forever — without an account, a
                login, or trusting us.
              </p>
              <ul className="mt-6 space-y-2.5">
                {[
                  'Tamper-evident by cryptography, not by policy',
                  'Verifiable with no wallet and no account',
                  'Whole cohorts committed as one Merkle root',
                ].map((point) => (
                  <li
                    key={point}
                    className="flex items-start gap-2.5 text-sm text-brand-100"
                  >
                    <CheckIcon />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={isLanding ? 'mt-10' : 'mt-8'}>
            <WalletControl />
          </div>

          <nav
            aria-label="Sections"
            className={`space-y-1 ${isLanding ? 'mt-8' : 'mt-6'}`}
          >
            {links.map((link) => (
              <SidebarLink
                key={link.to}
                to={link.to}
                label={link.label}
                hint={isLanding ? link.hint : undefined}
              />
            ))}
          </nav>

          <p className="mt-auto pt-8 text-[0.7rem] leading-relaxed text-brand-300">
            Sepolia testnet · academic project 01CE0716
          </p>
        </div>
      </aside>

      {/* ── Content ────────────────────────────────────────────────── */}
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}

function SidebarLink({
  to,
  label,
  hint,
}: {
  to: string
  label: string
  hint?: string
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `block rounded-lg px-3 py-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 ${
          isActive
            ? 'bg-white/10 text-white'
            : 'text-brand-100 hover:bg-white/5 hover:text-white'
        }`
      }
    >
      <span className="block text-sm font-medium">{label}</span>
      {hint && (
        <span className="mt-0.5 block text-xs text-brand-300">{hint}</span>
      )}
    </NavLink>
  )
}

/** Swap point for the 3D blockchain cube — keep the same box and prop. */
function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15 ${className}`}
      aria-hidden="true"
    >
      <svg
        className="h-[60%] w-[60%] text-white"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    </span>
  )
}

function CheckIcon() {
  return (
    <svg
      className="mt-0.5 h-4 w-4 shrink-0 text-brand-300"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12 5 5L20 7" />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}
