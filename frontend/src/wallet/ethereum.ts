// EIP-1193 provider access + typing for window.ethereum (MetaMask).
//
// We talk to MetaMask through the raw EIP-1193 `request` interface for
// connection/network actions (so we get reliable MetaMask error codes like
// 4001), and hand the same object to ethers' BrowserProvider for reads.

import type { Eip1193Provider } from 'ethers'

/** MetaMask's injected provider: EIP-1193 request + the event emitter API. */
export interface EthereumProvider extends Eip1193Provider {
  isMetaMask?: boolean
  on?(event: string, handler: (...args: unknown[]) => void): void
  removeListener?(event: string, handler: (...args: unknown[]) => void): void
}

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}

/** Standard EIP-1193 / MetaMask error codes we handle explicitly. */
export const PROVIDER_ERROR = {
  USER_REJECTED: 4001,
  REQUEST_PENDING: -32002,
  UNRECOGNIZED_CHAIN: 4902,
} as const

/** The injected provider, or undefined when MetaMask isn't installed. */
export function getEthereum(): EthereumProvider | undefined {
  if (typeof window === 'undefined') return undefined
  return window.ethereum
}

/** Extract a numeric EIP-1193 error code, if present. */
export function getProviderErrorCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code: unknown }
    if (typeof code === 'number') return code
  }
  return undefined
}

/** Best-effort human-readable message from an unknown thrown value. */
export function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error as { message: unknown }
    if (typeof message === 'string' && message.length > 0) return message
  }
  return 'Something went wrong. Please try again.'
}
