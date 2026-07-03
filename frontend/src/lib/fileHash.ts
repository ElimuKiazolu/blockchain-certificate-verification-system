// Client-side file fingerprinting for the "upload a file" verify mode.
//
// Convention (must match the on-chain storage key exactly — see
// CLAUDE.md "Hashing & Merkle conventions" and the contract's own docstring,
// blockchain/contracts/CertificateRegistry.sol:9-13): "Certificates are keyed
// by an opaque bytes32 certHash supplied by the caller; the contract is
// hash-agnostic... the frontend computes a SHA-256 fingerprint off-chain."
// So certHash = SHA-256(raw file bytes), taken directly as the 32-byte key —
// no keccak wrapping (that's a separate, Merkle-leaf-only concern). Computed
// here via Web Crypto, never sent anywhere.

function bytesToHex(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let hex = '0x'
  for (const byte of view) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/** True when the environment can compute a SHA-256 digest (secure context required). */
export function canHashFiles(): boolean {
  return typeof crypto !== 'undefined' && crypto.subtle !== undefined
}

/**
 * SHA-256 fingerprint of a file's raw bytes, as a bytes32 hex string
 * (0x + 64 hex chars) — the same shape verifyByHash expects.
 */
export async function hashFile(file: File): Promise<string> {
  if (!canHashFiles()) {
    throw new Error(
      'Secure hashing is unavailable in this browser context (HTTPS is required).',
    )
  }
  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch {
    throw new Error('Could not read the selected file. Please try again.')
  }
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return bytesToHex(digest)
}
