// Client for the backend's certificate INDEX (Phase 7, Slice 2).
//
// Everything here reads a CACHE. The index is rebuilt from on-chain events and
// is never authoritative: if it disagrees with the chain, the chain is right.
// That is why the list UI shows each row's certHash and links to the verifier —
// the convenient listing and the trustworthy answer stay separate.
//
// Nothing on the verification path calls this module. If the backend or the
// database is down, listing degrades and verification is untouched.

import { API_BASE_URL } from './backendClient'

export interface IndexedCertificate {
  certHash: string
  type: 'single' | 'batch'
  issuerAddress: string
  ipfsCID: string | null
  recipientName: string | null
  courseTitle: string | null
  /** ISO strings over the wire. */
  issuedAt: string
  expiresAt: string | null
  revoked: boolean
  revokedAt: string | null
  merkleRoot: string | null
  txHash: string
  blockNumber: number
}

export interface CertificatePage {
  source: 'index'
  total: number
  limit: number
  skip: number
  items: IndexedCertificate[]
}

/** Thrown when the index can't answer. Callers render "listing unavailable". */
export class IndexUnavailableError extends Error {}

const TIMEOUT_MS = 15_000

export interface ListOptions {
  issuer?: string
  q?: string
  limit?: number
  skip?: number
}

export async function listCertificates(
  options: ListOptions = {},
): Promise<CertificatePage> {
  const params = new URLSearchParams()
  if (options.issuer) params.set('issuer', options.issuer)
  if (options.q) params.set('q', options.q)
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.skip !== undefined) params.set('skip', String(options.skip))

  const response = await request(`/api/certificates?${params.toString()}`, 'GET')
  return (await response.json()) as CertificatePage
}

export interface SyncResult {
  ok: boolean
  fromBlock: number
  toBlock: number
  singleIssued: number
  batchIssued: number
  revocations: number
  upserted: number
  durationMs: number
}

/** Rebuild the index from the chain. Idempotent, so retrying is always safe. */
export async function syncIndex(): Promise<SyncResult> {
  const response = await request('/api/index/sync', 'POST')
  return (await response.json()) as SyncResult
}

async function request(path: string, method: 'GET' | 'POST'): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new IndexUnavailableError(
      `Couldn't reach the certificate index at ${API_BASE_URL}. Make sure the backend is running.`,
    )
  }

  if (!response.ok) {
    let message = `The index returned HTTP ${response.status}.`
    try {
      const body = (await response.json()) as { message?: unknown }
      if (typeof body.message === 'string' && body.message) message = body.message
    } catch {
      // Non-JSON body — keep the generic message.
    }
    throw new IndexUnavailableError(message)
  }
  return response
}

export type CertificateStatus = 'VALID' | 'EXPIRED' | 'REVOKED'

/**
 * Status for display in the list.
 *
 * Derived from cached fields, so it is a HINT, not a verdict — deliberately
 * typed without NOT_FOUND so it can never be confused with the verifier's
 * authoritative four-state result. Anything that matters gets re-checked
 * against the chain by following the row's verify link.
 */
export function certificateStatus(cert: IndexedCertificate): CertificateStatus {
  if (cert.revoked) return 'REVOKED'
  if (cert.expiresAt && new Date(cert.expiresAt).getTime() < Date.now()) {
    return 'EXPIRED'
  }
  return 'VALID'
}
