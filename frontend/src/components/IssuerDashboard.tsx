import { useState } from 'react'
import { describeRoles } from '../wallet/useRoleRead'
import { shortenAddress } from '../lib/format'
import { CERTIFICATE_REGISTRY_ADDRESS } from '../contract'
import type { RoleReadResult } from '../lib/contract'
import { IssueCertificateForm } from './IssueCertificateForm'
import { BatchIssueForm } from './BatchIssueForm'
import { RevokeCertificateForm } from './RevokeCertificateForm'

/**
 * The authorized issuer dashboard shell. Rendered only inside
 * {@link RequireIssuer}, so it can assume the wallet is connected, on
 * Sepolia, and holds issuer OR admin.
 *
 * That gate is deliberately broader than what the CONTRACT allows, and the two
 * actions here differ in who may perform them:
 *
 *   ISSUE  — `issueCertificate` is `onlyRole(ISSUER_ROLE)` specifically, so an
 *            admin alone CANNOT issue (the constructor grants the deployer
 *            DEFAULT_ADMIN_ROLE only, never ISSUER_ROLE). `data.isIssuer` is
 *            re-checked before rendering the form; an admin-only wallet gets a
 *            distinct explainer rather than a form that would revert.
 *
 *   REVOKE — not a role check at all: the contract requires
 *            `msg.sender == issuer-of-record || DEFAULT_ADMIN_ROLE`. So an
 *            admin without ISSUER_ROLE genuinely CAN revoke, while an issuer
 *            can only revoke what it issued. The Revoke tab is therefore open
 *            to everyone this gate admits, and a wallet that doesn't qualify
 *            for a particular certificate learns so from the revert.
 */
export function IssuerDashboard({
  data,
  account,
}: {
  data: RoleReadResult
  account: string
}) {
  return (
    <div className="space-y-6">
      {/* Authorized confirmation + which role the wallet holds. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-5 py-4">
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
            aria-hidden="true"
          >
            <svg
              className="h-5 w-5"
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
          <div>
            <p className="text-sm font-semibold text-emerald-900">
              Authorized to access the issuer dashboard
            </p>
            <p className="font-mono text-xs text-emerald-700" title={account}>
              {shortenAddress(account)}
            </p>
          </div>
        </div>
        <RoleBadge data={data} />
      </div>

      <DashboardTabs data={data} account={account} />
    </div>
  )
}

type DashboardTab = 'issue' | 'revoke'

/**
 * Issue vs Revoke — one authenticated surface, not separate routes.
 * An admin-only wallet lands on Revoke by default, because that's the action
 * it can actually complete.
 */
function DashboardTabs({
  data,
  account,
}: {
  data: RoleReadResult
  account: string
}) {
  const [tab, setTab] = useState<DashboardTab>(
    data.isIssuer ? 'issue' : 'revoke',
  )

  return (
    <div className="space-y-5">
      <div
        role="tablist"
        aria-label="Dashboard action"
        className="inline-flex rounded-lg border border-slate-300 bg-slate-50 p-1 text-sm"
      >
        <TabButton
          active={tab === 'issue'}
          onClick={() => setTab('issue')}
          controls="dashboard-issue"
        >
          Issue
        </TabButton>
        <TabButton
          active={tab === 'revoke'}
          onClick={() => setTab('revoke')}
          controls="dashboard-revoke"
        >
          Revoke
        </TabButton>
      </div>

      {tab === 'issue' ? (
        <div id="dashboard-issue">
          {data.isIssuer ? (
            <IssuanceModes />
          ) : (
            <NeedsIssuerRolePanel account={account} />
          )}
        </div>
      ) : (
        <div id="dashboard-revoke">
          <RevokeCertificateForm />
        </div>
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  controls,
  children,
}: {
  active: boolean
  onClick: () => void
  controls: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      onClick={onClick}
      className={`rounded-md px-4 py-1.5 font-semibold transition-colors ${
        active
          ? 'bg-white text-brand-900 shadow-sm'
          : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  )
}

type IssuanceMode = 'single' | 'batch'

/** Single-cert (Slice 2) vs Merkle batch (Slice 3a) — one form visible at a time. */
function IssuanceModes() {
  const [mode, setMode] = useState<IssuanceMode>('single')

  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-lg border border-slate-300 bg-slate-50 p-1 text-sm">
        <button
          type="button"
          onClick={() => setMode('single')}
          className={`rounded-md px-3.5 py-1.5 font-semibold transition-colors ${
            mode === 'single'
              ? 'bg-white text-brand-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Single certificate
        </button>
        <button
          type="button"
          onClick={() => setMode('batch')}
          className={`rounded-md px-3.5 py-1.5 font-semibold transition-colors ${
            mode === 'batch'
              ? 'bg-white text-brand-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Batch (Merkle)
        </button>
      </div>

      {mode === 'single' ? <IssueCertificateForm /> : <BatchIssueForm />}
    </div>
  )
}

/**
 * Admin-but-not-issuer: they can SEE the dashboard, but issueCertificate
 * reverts without ISSUER_ROLE. There's no admin panel yet (that's a later
 * journey — docs/03 C2), so the self-service path today is the deployed
 * contract's own Write Contract tab on Etherscan, using the admin wallet.
 */
function NeedsIssuerRolePanel({ account }: { account: string }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-6 shadow-sm sm:p-8">
      <div className="flex items-start gap-4">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"
          aria-hidden="true"
        >
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
        </span>
        <div>
          <h2 className="font-serif text-xl font-semibold text-amber-900">
            This wallet needs ISSUER_ROLE to issue
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-700">
            <span className="font-mono" title={account}>
              {shortenAddress(account)}
            </span>{' '}
            holds <strong>administrator</strong> access, but the contract
            requires <strong>ISSUER_ROLE specifically</strong> to call{' '}
            <code className="rounded bg-white px-1 py-0.5 font-mono text-xs">
              issueCertificate
            </code>
            . Administrators aren&apos;t granted it automatically.
          </p>
          <div className="mt-4 max-w-xl rounded-xl border border-amber-200 bg-white p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-800">
              As an admin, you can grant it to yourself:
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>
                Open the contract on{' '}
                <a
                  href={`https://sepolia.etherscan.io/address/${CERTIFICATE_REGISTRY_ADDRESS}#writeContract`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-brand-600 hover:underline"
                >
                  Etherscan → Write Contract
                </a>{' '}
                and connect this same admin wallet.
              </li>
              <li>
                Copy the value from the <code>ISSUER_ROLE</code> read-only
                function (under Read Contract).
              </li>
              <li>
                Call <code>grantRole</code> with that value as{' '}
                <code>role</code> and your address as{' '}
                <code>account</code>.
              </li>
              <li>Reload this page once the transaction confirms.</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}

function RoleBadge({ data }: { data: RoleReadResult }) {
  const tone = data.isAdmin
    ? 'border-brand-200 bg-brand-50 text-brand-700'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {describeRoles(data)}
    </span>
  )
}
