// Verifier-side support for BATCH certificates (Phase 6, Slice 3b).
//
// This module CONSUMES the Slice 3a issuance output (src/lib/batchOutputs.ts
// `BatchCertificateRecord`) — the JSON bundle a registrar hands to students —
// and prepares it for an on-chain re-check via `verifyBatchCertificate(...)`.
// Nothing here contacts a backend: the Merkle proof travels WITH the
// certificate, which is exactly what keeps batch verification self-contained
// and alive during a backend outage (CLAUDE.md; docs/07 R8).
//
// ── CRITICAL: field fidelity ──────────────────────────────────────────────
// The on-chain leaf is
//   keccak256(keccak256(abi.encode(certHash, ipfsCID, recipientName,
//                                  courseTitle, expiresAt)))
// over the FROZEN types [bytes32, string, string, string, uint64]
// (CertificateRegistry.sol `_computeLeaf`; mirrored in src/lib/merkle.ts).
// EVERY field is hashed, so every field must reach the contract byte-for-byte
// as the bundle recorded it: no trimming, no case-folding, no "the CID looks
// like a placeholder, send empty instead" normalization.
//
// This is not theoretical. Against the live fixture batch
// (root 0xd0702955…), swapping the real ipfsCID "PENDING_IPFS_PHASE7" for ""
// flips the verdict from VALID to NOT_FOUND. Values are therefore validated
// for SHAPE only and passed through untouched.

import type { BatchCertificateRecord } from './batchOutputs'
import { CERTIFICATE_REGISTRY_ADDRESS, SEPOLIA_CHAIN_ID } from '../contract'

/**
 * The fields required to re-check a batch certificate on-chain — the
 * verification-critical subset of a Slice 3a bundle entry. `contractAddress`
 * and `chainId` are metadata: present in a full bundle, optional when someone
 * pastes a single entry by hand, and used only for the provenance warning in
 * {@link describeBundleMismatch}, never in the leaf.
 */
export interface BatchCertificateInput {
  root: string
  certHash: string
  ipfsCID: string
  recipientName: string
  courseTitle: string
  /** Unix seconds; 0 = never expires. */
  expiresAt: number
  proof: string[]
  contractAddress?: string
  chainId?: number
}

/**
 * Compile-time guarantee that whatever Slice 3a emits stays consumable here.
 * If `BatchCertificateRecord` ever loses a field or changes a type, this
 * resolves to `never` and the build fails rather than silently shipping a
 * verifier that can't read its own issuer's bundles.
 */
export type AssertConsumesSlice3aBundle =
  BatchCertificateRecord extends BatchCertificateInput ? true : never

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/

export interface BundleParseResult {
  records: BatchCertificateInput[]
  /** A precise, plain-language problem — malformed input, never a verdict (docs/07 R11). */
  error: string | null
}

/**
 * Parse a pasted/uploaded batch bundle: either the full JSON array Slice 3a
 * downloads, or a single student's entry as a bare object.
 *
 * Shape is validated strictly (a bad bundle is a user-input problem, named
 * exactly — docs/07 R11), but VALUES are never rewritten: whatever strings the
 * bundle holds are the strings that go to the contract.
 */
export function parseBatchBundle(text: string): BundleParseResult {
  const trimmed = text.trim()
  if (!trimmed) {
    return { records: [], error: 'Paste a certificate bundle, or choose a .json file.' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return {
      records: [],
      error:
        "That isn't valid JSON. Paste the certificate bundle exactly as it was issued, or upload the .json file.",
    }
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed]
  if (entries.length === 0) {
    return { records: [], error: 'That bundle is empty — it contains no certificates.' }
  }

  const records: BatchCertificateInput[] = []
  for (let i = 0; i < entries.length; i++) {
    const result = readRecord(entries[i])
    if (typeof result === 'string') {
      const where = entries.length === 1 ? 'This entry' : `Entry ${i + 1} of ${entries.length}`
      return { records: [], error: `${where} is missing or malformed: ${result}` }
    }
    records.push(result)
  }

  return { records, error: null }
}

/** Validate one entry's shape. Returns the record, or a message naming the field. */
function readRecord(value: unknown): BatchCertificateInput | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'expected a JSON object with the certificate fields.'
  }
  const raw = value as Record<string, unknown>

  for (const field of ['root', 'certHash'] as const) {
    const v = raw[field]
    if (typeof v !== 'string' || !BYTES32_RE.test(v)) {
      return `"${field}" must be 0x followed by 64 hexadecimal characters.`
    }
  }
  for (const field of ['recipientName', 'courseTitle', 'ipfsCID'] as const) {
    if (typeof raw[field] !== 'string') {
      return `"${field}" must be text (it is part of the on-chain hash, so it can't be omitted).`
    }
  }

  const expiresAt = raw.expiresAt
  if (typeof expiresAt !== 'number' || !Number.isInteger(expiresAt) || expiresAt < 0) {
    return '"expiresAt" must be a whole number of seconds (0 = never expires).'
  }

  const proof = raw.proof
  if (!Array.isArray(proof) || !proof.every((p) => typeof p === 'string' && BYTES32_RE.test(p))) {
    return '"proof" must be a list of 0x-prefixed 32-byte hashes.'
  }

  return {
    // Passed through verbatim — see the field-fidelity note at the top.
    root: raw.root as string,
    certHash: raw.certHash as string,
    ipfsCID: raw.ipfsCID as string,
    recipientName: raw.recipientName as string,
    courseTitle: raw.courseTitle as string,
    expiresAt,
    proof: proof as string[],
    contractAddress: typeof raw.contractAddress === 'string' ? raw.contractAddress : undefined,
    chainId: typeof raw.chainId === 'number' ? raw.chainId : undefined,
  }
}

/**
 * Warn when a bundle was issued against a DIFFERENT contract or chain than the
 * one this verifier reads. Such a bundle verifies as NOT_FOUND for a reason
 * that has nothing to do with the certificate's validity, so say so up front
 * instead of letting the user read it as "forged".
 */
export function describeBundleMismatch(record: BatchCertificateInput): string | null {
  const wrongChain = record.chainId !== undefined && record.chainId !== SEPOLIA_CHAIN_ID
  const wrongContract =
    record.contractAddress !== undefined &&
    record.contractAddress.toLowerCase() !== CERTIFICATE_REGISTRY_ADDRESS.toLowerCase()

  if (!wrongChain && !wrongContract) return null
  return (
    'This bundle was issued against a different registry ' +
    `(${wrongContract ? `contract ${record.contractAddress}` : `chain ID ${record.chainId}`}) ` +
    'than the one this verifier checks. Any result below reflects THIS registry only.'
  )
}

/* ------------------------------------------------------------------ */
/* Proof-carrying QR payload                                           */
/* ------------------------------------------------------------------ */

/**
 * Upper bound on the QR payload we're willing to emit, in characters.
 *
 * QR byte-mode capacity at error-correction level M is ~1273 chars at version
 * 25 and ~2331 at version 40. Past ~v25 the module grid gets dense enough that
 * phone cameras need a large, clean render to lock on — so we cap here rather
 * than at the format's hard limit, and fall back to a hash-only QR beyond it
 * (see `buildCertificateQrPayload`). Measured: a 500-student cohort needs 9
 * proof hashes and lands near 1.15k chars, i.e. inside this budget.
 */
export const QR_PAYLOAD_MAX_CHARS = 1200

/** Compact wire form — short keys only; VALUES stay byte-identical to the bundle. */
interface CompactBatchPayload {
  v: 1
  r: string
  h: string
  c: string
  n: string
  t: string
  e: number
  p: string[]
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(encoded: string): string {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Encode a full batch certificate (fields + proof + root) into a verifier URL.
 * base64url of a short-keyed JSON object: URL-safe without percent-encoding
 * bloat, and UTF-8 clean so non-ASCII recipient names survive the round trip
 * (`btoa` alone would throw on them).
 */
export function encodeBatchQrPayload(record: BatchCertificateInput, origin: string): string {
  const compact: CompactBatchPayload = {
    v: 1,
    r: record.root,
    h: record.certHash,
    c: record.ipfsCID,
    n: record.recipientName,
    t: record.courseTitle,
    e: record.expiresAt,
    p: record.proof,
  }
  return `${origin}/?batch=${toBase64Url(JSON.stringify(compact))}`
}

/**
 * Recover a batch certificate from a scanned QR payload or a `?batch=` link.
 * Returns null when the text isn't a batch payload at all, so the caller can
 * fall through to single-cert hash extraction. A null here means "not this
 * kind of input" — never a verdict.
 */
export function decodeBatchQrPayload(text: string): BatchCertificateInput | null {
  const encoded = extractBatchParam(text)
  if (!encoded) return null

  let json: string
  try {
    json = fromBase64Url(encoded)
  } catch {
    return null
  }

  const result = parseBatchBundle(expandCompact(json))
  if (result.error || result.records.length !== 1) return null
  return result.records[0]
}

/** Pull the `batch` parameter out of a URL, a bare query string, or a raw value. */
function extractBatchParam(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const queryStart = trimmed.indexOf('?')
  if (queryStart !== -1) {
    const params = new URLSearchParams(trimmed.slice(queryStart + 1))
    const value = params.get('batch')
    if (value) return value
  }

  // A raw base64url payload with no URL wrapper (e.g. a QR holding just the data).
  return /^[A-Za-z0-9_-]+$/.test(trimmed) && trimmed.length > 40 ? trimmed : null
}

/** Re-expand the short QR keys into the bundle field names `parseBatchBundle` validates. */
function expandCompact(json: string): string {
  let compact: unknown
  try {
    compact = JSON.parse(json)
  } catch {
    return '' // parseBatchBundle will reject this as malformed
  }
  if (typeof compact !== 'object' || compact === null) return ''
  const c = compact as Record<string, unknown>
  return JSON.stringify({
    root: c.r,
    certHash: c.h,
    ipfsCID: c.c,
    recipientName: c.n,
    courseTitle: c.t,
    expiresAt: c.e,
    proof: c.p,
  })
}

export interface CertificateQrPayload {
  value: string
  /** True when the QR carries the full proof (self-contained batch verification). */
  proofCarrying: boolean
  length: number
}

/**
 * Build the per-student QR for an issued batch certificate.
 *
 * Preferred form carries the whole proof, so a scan verifies the certificate
 * with no bundle file and no backend. If the cohort's proof is long enough to
 * push the payload past {@link QR_PAYLOAD_MAX_CHARS}, we degrade honestly to a
 * hash-only verifier link rather than emitting a QR too dense to scan — the
 * caller surfaces that, and the JSON bundle remains the complete artifact.
 */
export function buildCertificateQrPayload(
  record: BatchCertificateInput,
  origin: string,
): CertificateQrPayload {
  const full = encodeBatchQrPayload(record, origin)
  if (full.length <= QR_PAYLOAD_MAX_CHARS) {
    return { value: full, proofCarrying: true, length: full.length }
  }
  const fallback = `${origin}/?hash=${record.certHash}`
  return { value: fallback, proofCarrying: false, length: fallback.length }
}
