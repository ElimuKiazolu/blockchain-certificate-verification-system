import { ConnectWalletButton } from './ConnectWalletButton'

export function Header() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5">
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
        </div>
        <ConnectWalletButton />
      </div>
    </header>
  )
}
