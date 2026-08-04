import { Link, NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'

/**
 * Institutional header — a deep navy "portal" bar. Serif wordmark for
 * authority; the shield reads "trust at a glance" (docs/04 §2). Sticky, so the
 * identity stays present as you scroll a result.
 */
export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-brand-800 bg-brand-900 text-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5 sm:px-6">
        <Link
          to="/"
          className="group flex items-center gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-300"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-white/10 ring-1 ring-white/15">
            <svg
              className="h-5 w-5 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-serif text-lg font-semibold tracking-tight text-white">
              Certificate Verification
            </span>
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-brand-200">
              On-chain registry
            </span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <HeaderNavLink to="/">Verify</HeaderNavLink>
          <HeaderNavLink to="/issuer">Issuer</HeaderNavLink>
          <HeaderNavLink to="/wallet">Wallet</HeaderNavLink>
        </nav>
      </div>
    </header>
  )
}

/** One consistent nav link style, active-state aware (react-router v7 NavLink). */
function HeaderNavLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `inline-flex min-h-11 items-center rounded-md px-3 py-2 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 ${
          isActive
            ? 'bg-white/10 text-white'
            : 'text-brand-100 hover:bg-white/5 hover:text-white'
        }`
      }
    >
      {children}
    </NavLink>
  )
}
