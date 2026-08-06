// Pinata pinning — the only place the JWT is used.
//
// Uses the documented REST endpoint directly via native fetch/FormData (Node
// 18+) rather than the `pinata` SDK. Deliberate: the SDK's surface has changed
// across major versions (v3 introduced a different Files API), and a thin
// HTTP call against a stable, documented contract is one less dependency whose
// upgrade could silently change what CID we put on-chain.
//
// Endpoint contract, confirmed by probing Pinata with the project's own key
// (not assumed, and not taken from the docs alone):
//   POST https://uploads.pinata.cloud/v3/files
//   Authorization: Bearer <JWT>
//   multipart/form-data: "file", plus "network" = public
//   200 -> { data: { cid, size, name, mime_type, network, created_at, … } }
//
// WHY v3 AND NOT pinFileToIPFS. The legacy endpoint is still documented, but
// this project's API key returns 403 NO_SCOPES_FOUND against it while
// succeeding on v3 — modern Pinata keys are scoped to the v3 Files API. The
// same key passes /data/testAuthentication, so this is a per-endpoint scope
// difference, not a bad credential. Verified end to end: a file uploaded here
// is retrievable through the configured gateway with the correct content type.
//
// `network: public` matters — only public files are served by the gateway that
// the frontend builds "View file" links against.

import { config } from '../config.js'

const PIN_FILE_URL = 'https://uploads.pinata.cloud/v3/files'

/** How long we wait on Pinata before giving up (docs/07 R2: no infinite waits). */
const PIN_TIMEOUT_MS = 60_000

export class PinataError extends Error {
  /** HTTP status this should surface as to our own client. */
  readonly status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = 'PinataError'
    this.status = status
  }
}

/** v3 wraps the record in `data`. */
interface PinFileResponse {
  data?: {
    cid?: string
    size?: number
    name?: string
    mime_type?: string
    network?: string
    is_duplicate?: boolean
  }
}

export interface PinnedFile {
  cid: string
  size: number
  /** True when Pinata already had this exact content — same CID, not an error. */
  duplicate: boolean
}

/**
 * Pin a file's bytes to IPFS and return its CID.
 *
 * Note what this does NOT do: it never hashes the file for identity purposes.
 * The certificate's on-chain `certHash` is a SHA-256 computed in the browser
 * (frontend/src/lib/fileHash.ts) and must stay there — the fingerprint proves
 * what the document IS, while the CID only says where a copy lives. Moving
 * hashing server-side would mean the user has to trust us for the very value
 * that makes verification trustless.
 */
export async function pinFile(
  bytes: Buffer,
  fileName: string,
  contentType: string,
): Promise<PinnedFile> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: contentType }), fileName)
  form.append('name', fileName)
  // Public network: required for the file to be readable through the gateway.
  form.append('network', 'public')

  let response: Response
  try {
    response = await fetch(PIN_FILE_URL, {
      method: 'POST',
      headers: {
        // The ONLY use of the secret. Never logged, never echoed to a client.
        Authorization: `Bearer ${config.pinataJwt}`,
      },
      body: form,
      signal: AbortSignal.timeout(PIN_TIMEOUT_MS),
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    throw new PinataError(
      timedOut
        ? 'The storage service did not respond in time. The file was not stored — please try again.'
        : 'Could not reach the storage service. The file was not stored — please check your connection and try again.',
      504,
    )
  }

  if (!response.ok) {
    // Pinata's body may carry useful detail, but it is not trusted output:
    // it is truncated, and the request (which carried the JWT) is never echoed.
    const detail = await safeErrorDetail(response)
    if (response.status === 401 || response.status === 403) {
      // 403 here is usually NOT a bad token — it's a token whose scopes don't
      // cover file uploads, which needs a different fix from "get a new key".
      const scopeIssue = detail?.includes('NO_SCOPES_FOUND') === true
      throw new PinataError(
        scopeIssue
          ? 'The storage service rejected the request: the configured API key lacks upload permission. The file was not stored — recreate the Pinata key with file upload (write) scopes.'
          : 'The storage service rejected our credentials. The file was not stored — the server needs a valid PINATA_JWT.',
        502,
      )
    }
    throw new PinataError(
      `The storage service refused the upload (HTTP ${response.status}). The file was not stored.${detail ? ` Details: ${detail}` : ''}`,
      502,
    )
  }

  const body = (await response.json()) as PinFileResponse
  const cid = body.data?.cid
  if (typeof cid !== 'string' || cid.length === 0) {
    throw new PinataError(
      'The storage service returned no content identifier, so the file cannot be referenced. Nothing was stored.',
      502,
    )
  }

  return {
    cid,
    size: typeof body.data?.size === 'number' ? body.data.size : bytes.byteLength,
    duplicate: body.data?.is_duplicate === true,
  }
}

/** Read a short, safe fragment of an error body; never throw from an error path. */
async function safeErrorDetail(response: Response): Promise<string | null> {
  try {
    const text = await response.text()
    if (!text) return null
    return text.slice(0, 200)
  } catch {
    return null
  }
}
