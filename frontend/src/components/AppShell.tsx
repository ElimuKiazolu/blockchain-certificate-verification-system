import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useNavLinks, useRoleSummary } from './useNavLinks'
import { WalletControl } from './WalletControl'
import { BrandMark } from './BrandMark'

/**
 * The application shell — a fixed left sidebar with content to its right.
 *
 * The sidebar is 35% on EVERY route. The dashboards are not a different
 * layout, only a different sidebar *body*: the verifier adds a short hero
 * statement above the nav, and that is the sole difference. Issuer, admin and
 * wallet are byte-identical to each other.
 *
 * ── The height rule ───────────────────────────────────────────────────────
 * The panel is exactly one viewport tall and never scrolls internally:
 * `lg:h-screen` + `overflow-hidden`, with the inner column as a flex stack
 * whose only growable element is the mark. Everything else is fixed-size, so
 * the footer line lands on the bottom edge at 100% zoom instead of being
 * pushed below the fold. The mark absorbs the slack, shrinking on short
 * viewports rather than forcing a scrollbar.
 *
 * Below `lg` a column is not viable, so it becomes a sticky top bar plus a
 * drawer holding the wallet control and every visible link.
 *
 * Nav contents come from `useNavLinks`, which shows only what the connected
 * wallet can use — presentation only. RequireIssuer / RequireAdmin and the
 * contract's own checks are untouched and remain authoritative.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation()
  const links = useNavLinks()
  const roleSummary = useRoleSummary()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const isLanding = location.pathname === '/'

  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  return (
    <div className="min-h-screen bg-paper text-slate-900 lg:flex">
      {/* ── Mobile top bar ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-brand-800 bg-brand-900 px-4 py-3 text-white lg:hidden">
        <Link to="/" className="flex items-center gap-2.5">
          <BrandMark size={34} />
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
          <span className="sr-only">
            {drawerOpen ? 'Close menu' : 'Open menu'}
          </span>
          {drawerOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      {drawerOpen && (
        <div
          id="app-drawer"
          className="border-b border-brand-800 bg-brand-900 px-4 py-4 text-white lg:hidden"
        >
          <WalletControl compact />
          <SectionLabel className="mt-5">Navigation</SectionLabel>
          <nav className="mt-2 space-y-1">
            {links.map((link) => (
              <SidebarLink key={link.to} link={link} />
            ))}
          </nav>
        </div>
      )}

      {/* ── Sidebar: 35% on every route ────────────────────────────── */}
      <aside className="hidden w-full shrink-0 overflow-hidden bg-brand-900 text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[35%] lg:max-w-[30rem] lg:flex-col">
        <div className="flex h-full flex-col px-8 py-8 xl:px-10">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-300"
          >
            <BrandMark size={44} />
            <span className="flex flex-col leading-tight">
              <span className="font-serif text-lg font-semibold tracking-tight text-white">
                Certificate Verification
              </span>
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-brand-200">
                On-chain registry
              </span>
            </span>
          </Link>

          {isLanding ? (
            <>
              {/* The mark is the only growable element — it absorbs whatever
                  vertical slack the viewport has, so nothing ever overflows. */}
              <div className="flex min-h-0 flex-1 items-center justify-center py-4">
                <BrandMark size={190} />
              </div>
              <div className="shrink-0">
                <h2 className="text-balance font-serif text-2xl font-semibold leading-tight text-white">
                  Proof that outlives the institution
                </h2>
                <p className="mt-2.5 text-sm leading-relaxed text-brand-100">
                  Certificates are committed to Ethereum, where anyone can check
                  them — no account, no login, no trust in us required.
                </p>
              </div>
            </>
          ) : (
            <div className="min-h-0 flex-1" />
          )}

          <div className="mt-6 shrink-0">
            <WalletControl />
          </div>

          <div className="mt-6 shrink-0">
            <SectionLabel>Navigation</SectionLabel>
            <nav aria-label="Sections" className="mt-2 space-y-1">
              {links.map((link) => (
                <SidebarLink key={link.to} link={link} />
              ))}
            </nav>
          </div>

          {roleSummary && (
            <div className="mt-5 shrink-0 rounded-xl border border-white/15 bg-white/[0.07] px-3.5 py-3">
              <p className="text-sm font-semibold text-white">
                {roleSummary.title}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-brand-200">
                {roleSummary.detail}
              </p>
            </div>
          )}

          <p className="mt-5 shrink-0 text-[0.7rem] leading-relaxed text-brand-300">
            Sepolia testnet · academic project 01CE0716
          </p>
        </div>
      </aside>

      {/* ── Content ────────────────────────────────────────────────── */}
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}

function SectionLabel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <p
      className={`font-mono text-[0.62rem] font-medium uppercase tracking-[0.2em] text-brand-300 ${className}`}
    >
      {children}
    </p>
  )
}

/** Icon + bold label + grey sub-label; active state is a filled pill. */
function SidebarLink({ link }: { link: ReturnType<typeof useNavLinks>[number] }) {
  const { to, label, hint, Icon } = link
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 ${
          isActive
            ? 'bg-brand-600 text-white shadow-sm'
            : 'text-brand-100 hover:bg-white/[0.07] hover:text-white'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={`h-[1.15rem] w-[1.15rem] shrink-0 ${
              isActive ? 'text-white' : 'text-brand-300'
            }`}
            aria-hidden="true"
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{label}</span>
            <span
              className={`block truncate text-xs ${
                isActive ? 'text-brand-100' : 'text-brand-300'
              }`}
            >
              {hint}
            </span>
          </span>
        </>
      )}
    </NavLink>
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
