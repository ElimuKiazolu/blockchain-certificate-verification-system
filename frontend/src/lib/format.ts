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
