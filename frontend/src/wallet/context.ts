import { createContext, useContext } from 'react'
import type { WalletContextValue } from './types'

export const WalletContext = createContext<WalletContextValue | null>(null)

/** Access the wallet state machine. Must be used within <WalletProvider>. */
export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return ctx
}
