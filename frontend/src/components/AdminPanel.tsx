import { useCallback, useState } from 'react'
import type { ContractTransactionResponse } from 'ethers'
import { getEthereum } from '../wallet/ethereum'
import { readWalletRoles, type RoleReadResult } from '../lib/contract'
import { classifyIssueError, type IssueError } from '../lib/issuerWrite'
import {
  ADMIN_REVERT_MESSAGES,
  forgetTrackedAddress,
  grantIssuerRole,
  loadTrackedAddresses,
  normalizeAddress,
  revokeIssuerRole,
  saveTrackedAddress,
} from '../lib/adminWrite'
import { shortenAddress } from '../lib/format'
import { CERTIFICATE_REGISTRY_ADDRESS, SEPOLIA_NETWORK } from '../contract'
import {
  FailedBanner,
  PendingBanner,
  RejectedBanner,
  Spinner,
} from './WriteStateBanners'

/**
 * Admin panel — grant and revoke ISSUER_ROLE (docs/03 C2–C3), replacing the
 * Etherscan Write-Contract workaround the dashboard used to point admins at.
 *
 * Rendered only inside RequireAdmin, so DEFAULT_ADMIN_ROLE is already
 * established. Both actions are WRITES and reuse the issuance state machine's
 * presentation (WriteStateBanners): awaiting-signature → pending → confirmed,
 * with rejected and reverted distinct.
 *
 * NOTE ON LISTING ISSUERS. The deployed contract uses plain OpenZeppelin
 * `AccessControl`, NOT `AccessControlEnumerable` — there is no
 * getRoleMember/getRoleMemberCount in the ABI (verified). A complete list of
 * issuers therefore cannot be read on-chain, and this panel does not pretend
 * otherwise: it offers an address LOOKUP plus a locally-remembered list of
 * addresses this browser has acted on. Every status shown next to those
 * addresses is read live from the chain — the list stores addresses only.
 */

/** The status of the address currently in the input. */
type LookupState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'loaded'; address: string; roles: RoleReadResult }
  /** Carries the address so Retry re-reads the same one, not the live input. */
  | { status: 'error'; address: string; message: string }

type WriteState =
  | { status: 'idle' }
  | { status: 'awaiting-signature' }
  | { status: 'pending'; txHash: string }
  | { status: 'confirmed'; txHash: string; action: RoleAction; address: string }
  | { status: 'rejected' }
  | { status: 'failed'; message: string }

type RoleAction = 'grant' | 'revoke'

export function AdminPanel({ account }: { account: string }) {
  const [input, setInput] = useState('')
  const [lookup, setLookup] = useState<LookupState>({ status: 'empty' })
  const [write, setWrite] = useState<WriteState>({ status: 'idle' })
  const [inputError, setInputError] = useState<string | null>(null)
  const [tracked, setTracked] = useState<string[]>(() => loadTrackedAddresses())

  const isBusy =
    write.status === 'awaiting-signature' || write.status === 'pending'

  const runLookup = useCallback(async (address: string) => {
    setLookup({ status: 'loading' })
    const eth = getEthereum()
    if (!eth) {
      setLookup({
        status: 'error',
        address,
        message: 'MetaMask provider unavailable.',
      })
      return
    }
    try {
      // The SAME role read used by the wallet card and both gates — it takes
      // any address, so nothing new is needed to inspect a third party.
      const roles = await readWalletRoles(eth, address)
      setLookup({ status: 'loaded', address, roles })
    } catch (err) {
      setLookup({
        status: 'error',
        address,
        message: err instanceof Error ? err.message : 'Could not read roles.',
      })
    }
  }, [])

  function onLookupSubmit() {
    const address = normalizeAddress(input)
    if (!address) {
      setInputError(
        'Enter a valid Ethereum address (0x followed by 40 hexadecimal characters).',
      )
      return
    }
    setInputError(null)
    setInput(address) // show the checksummed form back
    setWrite({ status: 'idle' })
    void runLookup(address)
  }

  async function onRoleAction(action: RoleAction) {
    if (lookup.status !== 'loaded') return
    const address = lookup.address

    const eth = getEthereum()
    if (!eth) {
      setWrite({ status: 'failed', message: 'MetaMask provider unavailable.' })
      return
    }

    setWrite({ status: 'awaiting-signature' })
    let tx: ContractTransactionResponse
    try {
      tx =
        action === 'grant'
          ? await grantIssuerRole(eth, address)
          : await revokeIssuerRole(eth, address)
    } catch (err) {
      applyError(err)
      return
    }

    setWrite({ status: 'pending', txHash: tx.hash })
    try {
      await tx.wait()
      setWrite({ status: 'confirmed', txHash: tx.hash, action, address })
      setTracked(saveTrackedAddress(address))
      void runLookup(address) // reflect the new on-chain truth
    } catch (err) {
      applyError(err)
    }
  }

  function applyError(err: unknown) {
    const classified: IssueError = classifyIssueError(err, ADMIN_REVERT_MESSAGES)
    if (classified.kind === 'rejected') {
      setWrite({ status: 'rejected' })
    } else {
      setWrite({ status: 'failed', message: classified.message })
    }
  }

  const target = lookup.status === 'loaded' ? lookup : null
  const isSelf =
    target !== null && target.address.toLowerCase() === account.toLowerCase()

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="font-serif text-xl font-semibold text-brand-900">
          Manage issuer access
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
          Grant or withdraw an institution&apos;s permission to issue
          certificates on the {SEPOLIA_NETWORK.name} registry. Both actions
          write to the chain and cost gas. This panel changes{' '}
          <strong>issuer</strong> access only — it never alters administrator
          rights, so it can&apos;t lock the registry out of governance.
        </p>

        {write.status === 'pending' && <PendingBanner txHash={write.txHash} />}
        {write.status === 'rejected' && (
          <RejectedBanner
            message="You closed or rejected the wallet prompt — nothing was changed. The address's role is unchanged."
            onDismiss={() => setWrite({ status: 'idle' })}
          />
        )}
        {write.status === 'failed' && (
          <FailedBanner
            title="Couldn't change this role"
            message={write.message}
            onDismiss={() => setWrite({ status: 'idle' })}
          />
        )}
        {write.status === 'confirmed' && (
          <ConfirmedBanner
            action={write.action}
            address={write.address}
            txHash={write.txHash}
            onDismiss={() => setWrite({ status: 'idle' })}
          />
        )}

        <fieldset disabled={isBusy} className="mt-5 disabled:opacity-60">
          <label
            htmlFor="admin-address"
            className="block text-sm font-semibold text-slate-800"
          >
            Institution wallet address
          </label>
          <div className="mt-1.5 flex flex-col gap-2.5 sm:flex-row">
            <input
              id="admin-address"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onLookupSubmit()
                }
              }}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={inputError !== null}
              className={`min-h-11 min-w-0 flex-1 rounded-lg border bg-white px-3.5 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors focus:ring-4 ${
                inputError
                  ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
                  : 'border-slate-300 focus:border-brand-500 focus:ring-brand-100'
              }`}
            />
            <button
              type="button"
              onClick={onLookupSubmit}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              Check status
            </button>
          </div>
          {inputError ? (
            <p className="mt-2 text-sm text-red-600">{inputError}</p>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              The current role is read from the registry before you change
              anything, so you can see the effect of the action.
            </p>
          )}

          {lookup.status === 'loading' && (
            <p className="mt-4 flex items-center gap-2 text-sm text-slate-600">
              <Spinner /> Reading this address&apos;s roles…
            </p>
          )}

          {lookup.status === 'error' && (
            <div className="mt-4 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 text-sm">
              <p className="font-semibold text-orange-900">
                Couldn&apos;t read this address&apos;s role
              </p>
              <p className="mt-0.5 text-orange-800">
                This is a connection problem — <strong>not</strong> a statement
                that the address has no role. Its status is unknown.
              </p>
              <p className="mt-2 font-mono text-xs break-words text-orange-700/80">
                {lookup.message}
              </p>
              <button
                type="button"
                onClick={() => void runLookup(lookup.address)}
                className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
              >
                Retry
              </button>
            </div>
          )}

          {target && (
            <StatusAndActions
              address={target.address}
              roles={target.roles}
              isSelf={isSelf}
              busy={isBusy}
              awaitingSignature={write.status === 'awaiting-signature'}
              onAction={(action) => void onRoleAction(action)}
            />
          )}
        </fieldset>
      </div>

      <TrackedAddresses
        addresses={tracked}
        onSelect={(address) => {
          setInput(address)
          setInputError(null)
          setWrite({ status: 'idle' })
          void runLookup(address)
        }}
        onForget={(address) => setTracked(forgetTrackedAddress(address))}
      />
    </div>
  )
}

/** Current on-chain status + the two actions, with idempotency + self guards. */
function StatusAndActions({
  address,
  roles,
  isSelf,
  busy,
  awaitingSignature,
  onAction,
}: {
  address: string
  roles: RoleReadResult
  isSelf: boolean
  busy: boolean
  awaitingSignature: boolean
  onAction: (action: RoleAction) => void
}) {
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="font-mono text-[0.7rem] font-medium uppercase tracking-wide text-slate-400">
        Current status
      </p>
      <p className="mt-1 font-mono text-sm text-slate-800" title={address}>
        {shortenAddress(address)}
        {isSelf && (
          <span className="ml-2 font-sans text-xs font-semibold text-brand-700">
            (this is you)
          </span>
        )}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusPill
          active={roles.isIssuer}
          on="Holds ISSUER_ROLE"
          off="Not an issuer"
        />
        {roles.isAdmin && (
          <span className="inline-flex items-center rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-semibold text-brand-800 ring-1 ring-brand-200">
            Administrator
          </span>
        )}
      </div>

      {/* Idempotency guards — grantRole/revokeRole succeed and emit nothing
          when the role is already in the requested state, so a "successful"
          transaction could otherwise read as a change that never happened. */}
      {roles.isIssuer ? (
        <p className="mt-3 text-sm text-slate-600">
          This address can already issue certificates. Granting again would
          succeed but change nothing (and still cost gas).
        </p>
      ) : (
        <p className="mt-3 text-sm text-slate-600">
          This address cannot issue certificates. Revoking would succeed but
          change nothing (and still cost gas).
        </p>
      )}

      {isSelf && roles.isIssuer && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Heads up:</strong> this is the wallet you&apos;re connected
          with. Revoking its issuer role means you&apos;ll no longer be able to
          issue certificates yourself. Your administrator rights are untouched,
          so you can grant it back at any time.
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => onAction('grant')}
          disabled={busy}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {awaitingSignature && <Spinner light />}
          Grant issuer role
        </button>
        <button
          type="button"
          onClick={() => onAction('revoke')}
          disabled={busy}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-300 bg-white px-5 py-2.5 text-sm font-semibold text-red-700 shadow-sm transition-colors hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Revoke issuer role
        </button>
      </div>
    </div>
  )
}

function StatusPill({
  active,
  on,
  off,
}: {
  active: boolean
  on: string
  off: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${
        active
          ? 'bg-emerald-100 text-emerald-800 ring-emerald-200'
          : 'bg-slate-200 text-slate-700 ring-slate-300'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-600' : 'bg-slate-500'}`}
        aria-hidden="true"
      />
      {active ? on : off}
    </span>
  )
}

function ConfirmedBanner({
  action,
  address,
  txHash,
  onDismiss,
}: {
  action: RoleAction
  address: string
  txHash: string
  onDismiss: () => void
}) {
  const txUrl = `${SEPOLIA_NETWORK.blockExplorerUrl}/tx/${txHash}`
  return (
    <div className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
      <div>
        <p className="font-medium">
          {action === 'grant' ? 'Issuer role granted' : 'Issuer role revoked'}
        </p>
        <p className="mt-0.5">
          <span className="font-mono" title={address}>
            {shortenAddress(address)}
          </span>{' '}
          {action === 'grant'
            ? 'can now issue certificates on the registry.'
            : 'can no longer issue certificates. Certificates it already issued remain valid — revoking a role is not revoking certificates.'}
        </p>
        <a
          href={txUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block font-mono text-xs text-emerald-700 hover:underline"
        >
          View transaction ↗
        </a>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 font-medium text-emerald-700 hover:text-emerald-900"
      >
        Dismiss
      </button>
    </div>
  )
}

/**
 * Addresses this browser has acted on. Explicitly NOT a member list — the
 * contract can't produce one (see the note at the top of this file) — and
 * labelled as such so it's never mistaken for authoritative.
 */
function TrackedAddresses({
  addresses,
  onSelect,
  onForget,
}: {
  addresses: string[]
  onSelect: (address: string) => void
  onForget: (address: string) => void
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="font-serif text-lg font-semibold text-brand-900">
        Recently managed addresses
      </h2>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-600">
        Remembered by this browser for convenience. This is{' '}
        <strong>not</strong> a list of everyone who holds the issuer role — the
        registry uses OpenZeppelin&apos;s standard{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">
          AccessControl
        </code>
        , which cannot enumerate role members on-chain. Select an address to
        read its live status from the registry.
      </p>

      {addresses.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          Nothing yet. Addresses you grant or revoke will appear here.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {addresses.map((address) => (
            <li
              key={address}
              className="flex flex-wrap items-center justify-between gap-3 py-2.5"
            >
              <span className="font-mono text-sm text-slate-700" title={address}>
                {shortenAddress(address)}
              </span>
              <span className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onSelect(address)}
                  className="text-sm font-semibold text-brand-600 hover:underline"
                >
                  Check status
                </button>
                <button
                  type="button"
                  onClick={() => onForget(address)}
                  className="text-sm font-medium text-slate-400 hover:text-slate-600"
                >
                  Forget
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs text-slate-500">
        Registry{' '}
        <a
          href={`${SEPOLIA_NETWORK.blockExplorerUrl}/address/${CERTIFICATE_REGISTRY_ADDRESS}#events`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-brand-600 hover:underline"
        >
          {shortenAddress(CERTIFICATE_REGISTRY_ADDRESS)}
        </a>{' '}
        — the full grant/revoke history is available on Etherscan as{' '}
        <code className="font-mono">RoleGranted</code> /{' '}
        <code className="font-mono">RoleRevoked</code> events.
      </p>
    </div>
  )
}
