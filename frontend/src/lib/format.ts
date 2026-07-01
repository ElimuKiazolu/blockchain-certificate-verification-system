/** Shorten an address for display: 0x1234…abcd */
export function shortenAddress(address: string): string {
  if (address.length < 10) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
