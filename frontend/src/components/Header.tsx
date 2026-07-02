import { Link, NavLink } from 'react-router-dom'

export function Header() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2.5">
          {/* Shield icon — "trust at a glance" (docs/04-UIUX-Brief-v2.md §2). */}
          <svg
            className="h-6 w-6 text-indigo-600"
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
          <span className="text-lg font-semibold tracking-tight text-slate-900">
            Certificate Verification
          </span>
        </Link>
        <nav className="text-sm">
          <NavLink
            to="/wallet"
            className={({ isActive }) =>
              `rounded-md px-3 py-2 font-medium transition-colors ${
                isActive
                  ? 'text-indigo-700'
                  : 'text-slate-600 hover:text-slate-900'
              }`
            }
          >
            Issuer access
          </NavLink>
        </nav>
      </div>
    </header>
  )
}
