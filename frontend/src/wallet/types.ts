/**
 * Wallet state machine types (ethers v6 / EIP-1193), implementing the
 * resilience states from docs/07-Resilience-and-Error-Handling.md R5:
 *
 *   no-provider  → MetaMask not installed
 *   idle         → installed, not connected (also how a *locked* wallet reads:
 *                  eth_accounts is empty until the user unlocks via connect)
 *   connecting   → awaiting the eth_requestAccounts prompt
 *   connected    → an account is authorized (network may still be wrong)
 */
export type WalletStatus = 'no-provider' | 'idle' | 'connecting' | 'connected'

export type WalletErrorKind =
  | 'rejected'
  | 'pending'
  | 'switch-rejected'
  | 'unknown'

export interface WalletError {
  kind: WalletErrorKind
  message: string
}

export interface WalletContextValue {
  status: WalletStatus
  account: string | null
  chainId: number | null
  /** true only when connected AND on Sepolia (11155111). */
  isCorrectNetwork: boolean
  error: WalletError | null
  connect: () => Promise<void>
  /**
   * App-side reset back to idle (clears account, chainId, role, error). Does
   * NOT call MetaMask — a site can't force MetaMask to revoke access; that's
   * done by the user in MetaMask → Connected sites.
   */
  disconnect: () => void
  switchToSepolia: () => Promise<void>
  clearError: () => void
}
