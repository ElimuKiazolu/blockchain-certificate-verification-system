// The frontend's only contact point with the Phase-7 backend.
//
// The backend exists for exactly one reason: the Pinata JWT must never reach
// the browser (CLAUDE.md architecture invariant). So the browser posts the raw
// file here and gets back only a CID. No credential, no token, nothing secret
// is present in this file or anywhere else in the bundle.
//
// What deliberately does NOT happen here: hashing. The certificate's on-chain
// identity is a SHA-256 computed locally in src/lib/fileHash.ts, and it stays
// there. certHash proves what the document IS; the CID only says where a copy
// lives. Moving the fingerprint server-side would make verification depend on
// trusting this server — the exact property the project is built to avoid.
//
// Scope note: the PUBLIC VERIFIER never calls this module. Verification stays
// backend-free and works with this server stopped (docs/07 §3); only the
// issuer's write path needs it.

/**
 * Where the backend lives. Configurable so a deployed build can point
 * somewhere other than the dev machine — never hardcoded in a component.
 */
export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'
).replace(/\/+$/, '')

/**
 * Public IPFS read gateway. Not a secret: it only serves already-public
 * content, and the frontend needs it to turn a stored CID into a link.
 */
export const IPFS_GATEWAY = (
  import.meta.env.VITE_IPFS_GATEWAY ??
  'https://aquamarine-wooden-flamingo-507.mypinata.cloud/ipfs'
).replace(/\/+$/, '')

/** Upload can be slow on a large scan; still bounded (docs/07 R2). */
const UPLOAD_TIMEOUT_MS = 90_000

export interface UploadedFile {
  cid: string
  size: number
  /** Pinata already had this exact content — same CID, not an error. */
  duplicate: boolean
  gatewayUrl: string
}

/** Build the public URL for a stored CID. */
export function ipfsUrl(cid: string): string {
  return `${IPFS_GATEWAY}/${cid}`
}

/**
 * Certificates issued before Phase 7 carry a literal placeholder in the
 * ipfsCID field rather than a real CID. Those records are perfectly valid
 * on-chain — there just is no file to fetch — so the UI must recognise the
 * placeholder instead of rendering a link that can only 404.
 */
const PLACEHOLDER_CIDS = new Set(['PENDING_IPFS_PHASE7'])

export function isRetrievableCid(cid: string): boolean {
  const trimmed = cid.trim()
  return trimmed.length > 0 && !PLACEHOLDER_CIDS.has(trimmed)
}

/**
 * Pin a certificate file via the backend and return its CID.
 *
 * Throws with a plain-language message on every failure path. The caller MUST
 * treat a throw as "the file is not stored" and must not proceed to the
 * on-chain transaction (docs/07 R6) — a certificate pointing at a file that
 * was never stored is worse than no certificate at all.
 */
export async function uploadCertificateFile(file: File): Promise<UploadedFile> {
  const form = new FormData()
  form.append('file', file, file.name)

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/ipfs/upload`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    })
  } catch (err) {
    // Distinguish "took too long" from "couldn't reach it at all" — the second
    // is almost always "the backend isn't running", which is worth saying.
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error(
        'The upload timed out, so the file was not stored. Check the storage service and try again.',
      )
    }
    throw new Error(
      `Couldn't reach the storage service at ${API_BASE_URL}, so the file was not stored. Make sure the backend is running, then retry.`,
    )
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  const body = (await response.json()) as Partial<UploadedFile>
  if (typeof body.cid !== 'string' || body.cid.length === 0) {
    throw new Error(
      'The storage service returned no content identifier, so the file cannot be referenced. Nothing was stored.',
    )
  }

  return {
    cid: body.cid,
    size: typeof body.size === 'number' ? body.size : file.size,
    duplicate: body.duplicate === true,
    gatewayUrl:
      typeof body.gatewayUrl === 'string' ? body.gatewayUrl : ipfsUrl(body.cid),
  }
}

/** Prefer the backend's own explanation; fall back to something honest. */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown }
    if (typeof body.message === 'string' && body.message.length > 0) {
      return body.message
    }
  } catch {
    // Non-JSON body — fall through.
  }
  return `The storage service refused the upload (HTTP ${response.status}). The file was not stored.`
}

export interface BackendHealth {
  status: string
  /** 'ready' when the server can actually pin; 'not_configured' otherwise. */
  storage: string
  gateway: string
}

/**
 * Ask the backend whether pinning is available. Used to warn an issuer BEFORE
 * they fill in a form, rather than after. Returns null when the backend can't
 * be reached — the caller shows that as "unknown", never as "broken".
 */
export async function checkBackendHealth(): Promise<BackendHealth | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/health`, {
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return null
    return (await response.json()) as BackendHealth
  } catch {
    return null
  }
}
