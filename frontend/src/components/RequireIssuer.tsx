import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '../wallet/context'
import { useRoleRead } from '../wallet/useRoleRead'
import { ConnectWalletButton } from './ConnectWalletButton'
import { shortenAddress } from '../lib/format'
import { SEPOLIA_NETWORK } from '../contract'
import type { RoleReadResult } from '../lib/contract'

/**
 * Role gate for the issuer dashboard (Phase 6). Renders `children` ONLY when a
 * wallet is connected, on Sepolia, and holds `ISSUER_ROLE` or
 * `DEFAULT_ADMIN_ROLE` — read live on-chain via {@link useRoleRead}. Every
 * other case gets an explicit, honest state (docs/07 R5, docs/04 §6):
 *
 *   no wallet / not connected → prompt to connect (the issuer area REQUIRES a
 *                               wallet, unlike the public verifier)
 *   connected, wrong network  → require Sepolia (one-click switch)
 *   role read loading         → "checking permissions…"
 *   role read ERROR           → retry — NOT a denial. "Couldn't check" is never
 *                               rendered as "unauthorized" (couldn't-check ≠ no-role)
 *   connected, no role        → friendly "not authorized", no dead-ends
 *   connected, authorized     → children (Slice 2 can assume authorization)
 *
 * Because the gate guarantees authorization, downstream write code (Slice 2)
 * never has to re-check.
 */
interface AuthorizedContext {
  data: RoleReadResult
  account: string
}

interface RequireIssuerProps {
  children: (auth: AuthorizedContext) => ReactNode
}

export function RequireIssuer({ children }: RequireIssuerProps) {
  const { status, account, isCorrectNetwork, error, clearError, switchToSepolia } =
    useWallet()
  const { state: role, retry } = useRoleRead()

  // 1. No provider / not connected / mid-connect → require a wallet first.
  if (
    status === 'no-provider' ||
    status === 'idle' ||
    status === 'connecting' ||
    account === null
  ) {
    return (
      <ConnectGate
        variant={status === 'no-provider' ? 'no-provider' : 'idle'}
        error={error?.message}
        onDismiss={clearError}
      />
    )
  }

  // 2. Connected but on the wrong chain → require Sepolia.
  if (!isCorrectNetwork) {
    return (
      <WrongNetworkGate
        onSwitch={switchToSepolia}
        error={error?.message}
        onDismiss={clearError}
      />
    )
  }

  // 3. Reading the role. `idle` here means the read is about to start.
  if (role.status === 'idle' || role.status === 'loading') {
    return <RoleLoadingGate account={account} />
  }

  // 4. Read FAILED — this is not a decision about access. Offer retry; never
  //    fall through to "unauthorized" (docs/07 §3: couldn't-check ≠ doesn't-have).
  if (role.status === 'error') {
    return (
      <RoleErrorGate account={account} message={role.message} onRetry={retry} />
    )
  }

  // 5. Read succeeded but the wallet holds neither role → not authorized.
  if (!role.data.isAdmin && !role.data.isIssuer) {
    return <UnauthorizedGate account={account} />
  }

  // 6. Authorized (issuer or admin).
  return <>{children({ data: role.data, account })}</>
}

/* ------------------------------------------------------------------ */
/* Gate panels — one visual language, matching the Phase-5 identity.  */
/* ------------------------------------------------------------------ */

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-10">
      {children}
    </div>
  )
}

function IconCircle({
  tone,
  children,
}: {
  tone: 'brand' | 'amber' | 'red' | 'slate'
  children: ReactNode
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600 ring-brand-100',
    amber: 'bg-amber-50 text-amber-600 ring-amber-100',
    red: 'bg-red-50 text-red-600 ring-red-100',
    slate: 'bg-slate-100 text-slate-500 ring-slate-200',
  } as const
  return (
    <span
      className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ring-8 ${tones[tone]}`}
      aria-hidden="true"
    >
      {children}
    </span>
  )
}

/** Reused wallet-level error strip (rejected / pending / switch-rejected). */
function WalletErrorStrip({
  message,
  onDismiss,
}: {
  message?: string
  onDismiss: () => void
}) {
  if (!message) return null
  return (
    <div className="mx-auto mt-5 flex max-w-md items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm text-amber-800">
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 font-medium text-amber-700 hover:text-amber-900"
      >
        Dismiss
      </button>
    </div>
  )
}

function ConnectGate({
  variant,
  error,
  onDismiss,
}: {
  variant: 'no-provider' | 'idle'
  error?: string
  onDismiss: () => void
}) {
  const noProvider = variant === 'no-provider'
  return (
    <Panel>
      <IconCircle tone="brand">
        <WalletIcon />
      </IconCircle>
      <h2 className="mt-4 font-serif text-xl font-semibold text-brand-900">
        {noProvider ? 'MetaMask is required' : 'Connect your wallet to continue'}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
        {noProvider
          ? 'Issuing certificates is done from a wallet with issuer permissions. Install MetaMask, then connect the wallet your institution was authorized with.'
          : 'The issuer dashboard requires a wallet. Connect the institutional wallet that holds issuer permissions to continue.'}
      </p>
      <div className="mt-6 flex justify-center">
        <ConnectWalletButton />
      </div>
      <WalletErrorStrip message={error} onDismiss={onDismiss} />
    </Panel>
  )
}

function WrongNetworkGate({
  onSwitch,
  error,
  onDismiss,
}: {
  onSwitch: () => void
  error?: string
  onDismiss: () => void
}) {
  return (
    <Panel>
      <IconCircle tone="amber">
        <NetworkIcon />
      </IconCircle>
      <h2 className="mt-4 font-serif text-xl font-semibold text-brand-900">
        Switch to {SEPOLIA_NETWORK.name} to continue
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
        The issuer dashboard reads and writes to the{' '}
        <strong>{SEPOLIA_NETWORK.name}</strong> test network. Your wallet is
        connected to a different network.
      </p>
      <div className="mt-6 flex justify-center">
        <button
          type="button"
          onClick={onSwitch}
          className="rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
        >
          Switch to {SEPOLIA_NETWORK.name}
        </button>
      </div>
      <WalletErrorStrip message={error} onDismiss={onDismiss} />
    </Panel>
  )
}

function RoleLoadingGate({ account }: { account: string }) {
  return (
    <Panel>
      <span
        className="mx-auto flex h-12 w-12 items-center justify-center"
        aria-hidden="true"
      >
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
      </span>
      <h2 className="mt-4 font-serif text-xl font-semibold text-brand-900">
        Checking your permissions…
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
        Reading the role for{' '}
        <span className="font-mono text-slate-800">
          {shortenAddress(account)}
        </span>{' '}
        from the on-chain registry.
      </p>
    </Panel>
  )
}

/**
 * A read FAILURE — deliberately distinct from "not authorized". The user's role
 * is *unknown*, not "none"; the only honest action is retry (docs/07 §3).
 */
function RoleErrorGate({
  account,
  message,
  onRetry,
}: {
  account: string
  message: string
  onRetry: () => void
}) {
  return (
    <Panel>
      <IconCircle tone="red">
        <AlertIcon />
      </IconCircle>
      <h2 className="mt-4 font-serif text-xl font-semibold text-brand-900">
        Couldn&apos;t verify your permissions
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
        {message}
      </p>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-slate-500">
        This is a network or read error — <strong>not</strong> a decision about
        your access. Your permissions for{' '}
        <span className="font-mono">{shortenAddress(account)}</span> are unknown,
        not denied.
      </p>
      <div className="mt-6 flex justify-center">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Retry
        </button>
      </div>
    </Panel>
  )
}

/** Friendly, non-scary "not authorized" — with a way forward (docs/04 §6). */
function UnauthorizedGate({ account }: { account: string }) {
  return (
    <Panel>
      <IconCircle tone="slate">
        <LockIcon />
      </IconCircle>
      <h2 className="mt-4 font-serif text-xl font-semibold text-brand-900">
        This wallet isn&apos;t authorized to issue
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
        The connected address doesn&apos;t hold issuer or administrator
        permissions on the registry, so it can&apos;t issue certificates.
      </p>
      <div className="mx-auto mt-5 max-w-md rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm">
        <p className="text-slate-500">Connected address</p>
        <p className="mt-0.5 font-mono text-slate-800" title={account}>
          {shortenAddress(account)}
        </p>
        <p className="mt-3 text-slate-600">
          To get access, ask your system administrator to grant this address the
          issuer role. Already have an authorized wallet? Switch accounts in
          MetaMask.
        </p>
      </div>
      <div className="mt-6">
        <Link
          to="/"
          className="text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline"
        >
          Verify a certificate instead →
        </Link>
      </div>
    </Panel>
  )
}

/* -------------------------------- icons -------------------------------- */

function WalletIcon() {
  return (
    <svg
      className="h-6 w-6"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2" />
      <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2Z" />
      <circle cx="16" cy="13" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function NetworkIcon() {
  return (
    <svg
      className="h-6 w-6"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg
      className="h-6 w-6"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg
      className="h-6 w-6"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  )
}
