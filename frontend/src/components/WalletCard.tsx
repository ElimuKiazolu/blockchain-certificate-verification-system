import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useWallet } from '../wallet/context'
import { getEthereum, getErrorMessage } from '../wallet/ethereum'
import { readWalletRoles, type RoleReadResult } from '../lib/contract'
import { shortenAddress } from '../lib/format'
import {
  CERTIFICATE_REGISTRY_ADDRESS,
  SEPOLIA_NETWORK,
} from '../contract'

/** Local state for the on-chain role read. */
type ReadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: RoleReadResult }
  | { status: 'error'; message: string }

function describeRoles(data: RoleReadResult): string {
  if (data.isAdmin && data.isIssuer) return 'Administrator + Issuer'
  if (data.isAdmin) return 'Administrator'
  if (data.isIssuer) return 'Issuer'
  return 'No role'
}

export function WalletCard() {
  const { status, account, chainId, isCorrectNetwork, error, clearError } =
    useWallet()
  const [read, setRead] = useState<ReadState>({ status: 'idle' })
  const [reloadKey, setReloadKey] = useState(0)

  const retry = useCallback(() => setReloadKey((k) => k + 1), [])

  const canRead = status === 'connected' && isCorrectNetwork && account !== null

  useEffect(() => {
    if (!canRead || account === null) {
      setRead({ status: 'idle' })
      return
    }
    const eth = getEthereum()
    if (!eth) {
      setRead({ status: 'error', message: 'MetaMask provider unavailable.' })
      return
    }

    let cancelled = false
    setRead({ status: 'loading' })
    readWalletRoles(eth, account)
      .then((data) => {
        if (!cancelled) setRead({ status: 'success', data })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setRead({ status: 'error', message: getErrorMessage(err) })
        }
      })

    return () => {
      cancelled = true
    }
  }, [canRead, account, reloadKey])

  const explorerUrl = `${SEPOLIA_NETWORK.blockExplorerUrl}/address/${CERTIFICATE_REGISTRY_ADDRESS}`

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">
        Wallet &amp; live contract read
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Connect MetaMask on {SEPOLIA_NETWORK.name} to read your on-chain role
        from the deployed registry.
      </p>

      {/* Wallet-level errors: rejected / pending / switch-rejected / unknown. */}
      {error && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>{error.message}</span>
          <button
            type="button"
            onClick={clearError}
            className="shrink-0 font-medium text-amber-700 hover:text-amber-900"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="mt-4 space-y-3 text-sm">
        {status === 'no-provider' && (
          <p className="text-slate-600">
            MetaMask isn&apos;t installed.{' '}
            <a
              href="https://metamask.io/download/"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-indigo-600 hover:underline"
            >
              Install it
            </a>{' '}
            to connect.
          </p>
        )}

        {status === 'idle' && (
          <p className="text-slate-600">
            Not connected. Use <strong>Connect Wallet</strong> above to begin.
          </p>
        )}

        {status === 'connecting' && (
          <p className="flex items-center gap-2 text-slate-600">
            <Spinner /> Waiting for MetaMask…
          </p>
        )}

        {status === 'connected' && account && (
          <>
            <Row label="Account">
              <span className="font-mono text-slate-800" title={account}>
                {shortenAddress(account)}
              </span>
            </Row>
            <Row label="Network">
              {isCorrectNetwork ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-700">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  {SEPOLIA_NETWORK.name}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-amber-700">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  Wrong network (chainId {chainId ?? '—'})
                </span>
              )}
            </Row>
            <Row label="Contract">
              <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-indigo-600 hover:underline"
              >
                {shortenAddress(CERTIFICATE_REGISTRY_ADDRESS)}
              </a>
            </Row>

            <div className="border-t border-slate-100 pt-3">
              {!isCorrectNetwork && (
                <p className="text-amber-700">
                  Reads are paused on the wrong network. Switch to{' '}
                  {SEPOLIA_NETWORK.name} to continue.
                </p>
              )}

              {isCorrectNetwork && read.status === 'loading' && (
                <p className="flex items-center gap-2 text-slate-600">
                  <Spinner /> Reading your role from the contract…
                </p>
              )}

              {isCorrectNetwork && read.status === 'success' && (
                <Row label="Your role">
                  <span className="font-medium text-slate-900">
                    {describeRoles(read.data)}
                  </span>
                  {read.data.roles.length === 0 && (
                    <span className="ml-2 text-slate-500">
                      (can verify, but not issue)
                    </span>
                  )}
                </Row>
              )}

              {isCorrectNetwork && read.status === 'error' && (
                <div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700">
                  <div>
                    <p className="font-medium">Couldn&apos;t read the contract.</p>
                    <p className="text-red-600">{read.message}</p>
                    <p className="mt-1 text-xs text-red-500">
                      This is a read failure — not a verdict. Your role is
                      unknown, not &ldquo;none&rdquo;.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={retry}
                    className="shrink-0 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>

            <p className="text-xs text-slate-400">
              Disconnect clears this app only. To fully revoke access, use
              MetaMask → Connected sites.
            </p>
          </>
        )}
      </div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2">
      <span className="w-24 shrink-0 text-slate-500">{label}</span>
      <span>{children}</span>
    </div>
  )
}

function Spinner() {
  return (
    <span
      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"
      aria-hidden="true"
    />
  )
}
