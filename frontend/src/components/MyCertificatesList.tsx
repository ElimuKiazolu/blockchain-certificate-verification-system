import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  IndexUnavailableError,
  certificateStatus,
  listCertificates,
  syncIndex,
  type CertificateStatus,
  type IndexedCertificate,
} from '../lib/indexClient'
import { ipfsUrl, isRetrievableCid } from '../lib/backendClient'
import { formatDate, shortenHash } from '../lib/format'
import { SEPOLIA_NETWORK } from '../contract'
import { Spinner } from './WriteStateBanners'

/**
 * "My issued certificates" (Phase 7, Slice 2) — a fast, searchable list of the
 * connected issuer's certificates, served from the MongoDB index.
 *
 * The index is a CACHE of on-chain events, so this screen is a convenience and
 * says so. Two consequences are deliberate:
 *
 *   • Every row links to the public verifier by certHash. The list tells you
 *     what exists; the verifier tells you what is TRUE. A viewer never has to
 *     trust this cache for anything that matters.
 *   • When the index is unreachable the panel degrades to an explicit
 *     "listing unavailable" notice that states issuing and verifying still
 *     work — it never renders an empty list, which would falsely imply the
 *     issuer has no certificates (docs/07 §3, R9/R10).
 *
 * "Sync from chain" replays contract events into the index, which is also how
 * the database is rebuilt from scratch.
 */

type ListState =
  | { status: 'loading' }
  | { status: 'ready'; items: IndexedCertificate[]; total: number }
  | { status: 'unavailable'; message: string }

type SyncState =
  | { status: 'idle' }
  | { status: 'syncing' }
  | { status: 'done'; message: string }
  | { status: 'failed'; message: string }

const STATUS_STYLES: Record<CertificateStatus, string> = {
  VALID: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  EXPIRED: 'bg-amber-100 text-amber-800 ring-amber-200',
  REVOKED: 'bg-red-100 text-red-800 ring-red-200',
}

const STATUS_LABELS: Record<CertificateStatus, string> = {
  VALID: 'Valid',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
}

export function MyCertificatesList({ account }: { account: string }) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<ListState>({ status: 'loading' })
  const [sync, setSync] = useState<SyncState>({ status: 'idle' })

  const load = useCallback(
    async (search: string) => {
      setState({ status: 'loading' })
      try {
        const page = await listCertificates({
          issuer: account,
          ...(search ? { q: search } : {}),
          limit: 100,
        })
        setState({ status: 'ready', items: page.items, total: page.total })
      } catch (err) {
        setState({
          status: 'unavailable',
          message:
            err instanceof IndexUnavailableError
              ? err.message
              : 'The certificate list could not be loaded.',
        })
      }
    },
    [account],
  )

  useEffect(() => {
    void load('')
  }, [load])

  // Debounce the search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void load(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query, load])

  async function onSync() {
    setSync({ status: 'syncing' })
    try {
      const result = await syncIndex()
      setSync({
        status: 'done',
        message: `Indexed ${result.singleIssued} certificate${result.singleIssued === 1 ? '' : 's'} and ${result.batchIssued} batch root${result.batchIssued === 1 ? '' : 's'} from blocks ${result.fromBlock}–${result.toBlock}.`,
      })
      await load(query.trim())
    } catch (err) {
      setSync({
        status: 'failed',
        message:
          err instanceof IndexUnavailableError
            ? err.message
            : 'The index could not be rebuilt.',
      })
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-semibold text-brand-900">
            My issued certificates
          </h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-600">
            Everything issued from{' '}
            <span className="font-mono text-xs">{shortenHash(account)}</span>,
            served from a searchable index of on-chain events. The blockchain
            remains the source of truth — open any row in the verifier to check
            it directly.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onSync()}
          disabled={sync.status === 'syncing'}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sync.status === 'syncing' && <Spinner />}
          {sync.status === 'syncing' ? 'Syncing…' : 'Sync from chain'}
        </button>
      </div>

      {sync.status === 'done' && (
        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          {sync.message}
        </p>
      )}
      {sync.status === 'failed' && (
        <p className="mt-4 rounded-xl border border-orange-300 bg-orange-50 px-4 py-2.5 text-sm text-orange-800">
          {sync.message}
        </p>
      )}

      <label className="mt-5 block">
        <span className="sr-only">Search certificates</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by recipient, course, or certificate hash…"
          className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
        />
      </label>

      <div className="mt-4">
        {state.status === 'loading' && (
          <p className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-10 text-sm text-slate-600">
            <Spinner /> Loading your certificates…
          </p>
        )}

        {/* Degraded, NOT empty: an unreachable index must never look like
            "you have issued nothing". */}
        {state.status === 'unavailable' && (
          <div className="rounded-xl border border-orange-300 bg-orange-50 px-4 py-4 text-sm">
            <p className="font-semibold text-orange-900">Listing unavailable</p>
            <p className="mt-0.5 text-orange-800">{state.message}</p>
            <p className="mt-2 text-orange-800">
              This affects the list only — issuing and verifying read the
              blockchain directly and are working normally.
            </p>
            <button
              type="button"
              onClick={() => void load(query.trim())}
              className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
            >
              Retry
            </button>
          </div>
        )}

        {state.status === 'ready' && state.items.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
            {query.trim() ? (
              <>Nothing matches “{query.trim()}”.</>
            ) : (
              <>
                No certificates indexed for this wallet yet. If you&apos;ve
                already issued some, choose{' '}
                <strong>Sync from chain</strong> to build the index.
              </>
            )}
          </div>
        )}

        {state.status === 'ready' && state.items.length > 0 && (
          <>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="max-h-[30rem] overflow-auto">
                <table className="w-full min-w-[40rem] border-collapse text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left">
                    <tr>
                      <Th>Recipient</Th>
                      <Th>Course / title</Th>
                      <Th>Issued</Th>
                      <Th>Status</Th>
                      <Th>Links</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.items.map((cert) => {
                      const status = certificateStatus(cert)
                      const isBatch = cert.type === 'batch'
                      return (
                        <tr key={cert.certHash} className="border-t border-slate-100">
                          <Td>
                            <span className="font-medium text-slate-800">
                              {cert.recipientName ?? (isBatch ? 'Batch cohort' : '—')}
                            </span>
                            <span
                              className="mt-0.5 block font-mono text-[0.65rem] text-slate-400"
                              title={cert.certHash}
                            >
                              {shortenHash(cert.certHash)}
                            </span>
                          </Td>
                          <Td>
                            <span className="text-slate-600">
                              {cert.courseTitle ??
                                (isBatch ? 'Merkle root (members not indexed)' : '—')}
                            </span>
                          </Td>
                          <Td>
                            <span className="text-slate-600">
                              {formatDate(
                                Math.floor(new Date(cert.issuedAt).getTime() / 1000),
                              )}
                            </span>
                          </Td>
                          <Td>
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${STATUS_STYLES[status]}`}
                            >
                              {STATUS_LABELS[status]}
                            </span>
                          </Td>
                          <Td>
                            <span className="flex flex-wrap gap-x-3 gap-y-1">
                              {!isBatch && (
                                <Link
                                  to={`/?hash=${cert.certHash}`}
                                  className="text-xs font-semibold text-brand-600 hover:underline"
                                >
                                  Verify
                                </Link>
                              )}
                              {cert.ipfsCID && isRetrievableCid(cert.ipfsCID) && (
                                <a
                                  href={ipfsUrl(cert.ipfsCID)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs font-semibold text-brand-600 hover:underline"
                                >
                                  File
                                </a>
                              )}
                              <a
                                href={`${SEPOLIA_NETWORK.blockExplorerUrl}/tx/${cert.txHash}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs font-semibold text-brand-600 hover:underline"
                              >
                                Tx ↗
                              </a>
                            </span>
                          </Td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Showing {state.items.length} of {state.total}. Statuses come from
              the index — the verifier is authoritative.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-4 py-2.5 font-mono text-[0.7rem] font-medium uppercase tracking-wide text-slate-400"
    >
      {children}
    </th>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-2.5 align-top">{children}</td>
}
