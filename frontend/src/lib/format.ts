/** Shorten an address for display: 0x1234…abcd */
export function shortenAddress(address: string): string {
  if (address.length < 10) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** Shorten a 32-byte hash for display: 0x1234abcd…ef567890 */
export function shortenHash(hash: string): string {
  if (hash.length < 22) return hash
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`
}

/** Format a unix-seconds timestamp as a long, human date (e.g. 2 July 2026). */
export function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return '—'
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * Convert an HTML `<input type="date">` value (YYYY-MM-DD) to a uint64 unix
 * timestamp (seconds) at UTC midnight — matching the contract's `expiresAt`
 * convention (0 = never expires). Empty input → 0n.
 */
export function dateInputToExpiresAt(dateValue: string): bigint {
  if (!dateValue) return 0n
  const ms = Date.parse(`${dateValue}T00:00:00Z`)
  if (Number.isNaN(ms)) return 0n
  return BigInt(Math.floor(ms / 1000))
}
