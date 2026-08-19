import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  SEPOLIA_CHAIN_ID,
  SEPOLIA_CHAIN_ID_HEX,
  SEPOLIA_NETWORK,
} from '../contract'
import {
  getEthereum,
  getErrorMessage,
  getProviderErrorCode,
  PROVIDER_ERROR,
  type EthereumProvider,
} from './ethereum'
import { WalletContext } from './context'
import type { WalletContextValue, WalletStatus } from './types'

/**
 * The wallet state machine (see ./types for the state model). Talks to MetaMask
 * over raw EIP-1193 for connect/switch (reliable error codes), tracks Sepolia
 * via chainId, and reacts live to accountsChanged / chainChanged — no reload.
 */
function parseChainId(hex: unknown): number | null {
  if (typeof hex !== 'string') return null
  const parsed = Number.parseInt(hex, 16)
  return Number.isNaN(parsed) ? null : parsed
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>('idle')
  const [account, setAccount] = useState<string | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [error, setError] = useState<WalletContextValue['error']>(null)

  const clearError = useCallback(() => setError(null), [])

  // App-side disconnect: reset to idle. MetaMask stays "connected" to the site
  // (only the user can revoke that in Connected sites) — but our app forgets
  // the account, so the role read clears and the UI returns to "Connect Wallet".
  const disconnect = useCallback(() => {
    setAccount(null)
    setChainId(null)
    setStatus('idle')
    setError(null)
  }, [])

  // Initial detection (silent — never prompts) + live event wiring.
  useEffect(() => {
    const eth = getEthereum()
    if (!eth) {
      setStatus('no-provider')
      return
    }

    let cancelled = false

    async function init(provider: EthereumProvider) {
      try {
        const [accounts, chainHex] = await Promise.all([
          provider.request({ method: 'eth_accounts' }) as Promise<string[]>,
          provider.request({ method: 'eth_chainId' }) as Promise<string>,
        ])
        if (cancelled) return
        setChainId(parseChainId(chainHex))
        if (accounts.length > 0) {
          setAccount(accounts[0])
          setStatus('connected')
        } else {
          setStatus('idle')
        }
      } catch {
        if (!cancelled) setStatus('idle')
      }
    }

    void init(eth)

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = (args[0] as string[] | undefined) ?? []
      if (accounts.length > 0) {
        setAccount(accounts[0])
        setStatus('connected')
        setError(null)
      } else {
        // Disconnected or wallet locked.
        setAccount(null)
        setStatus('idle')
      }
    }
    const handleChainChanged = (...args: unknown[]) => {
      setChainId(parseChainId(args[0]))
    }

    eth.on?.('accountsChanged', handleAccountsChanged)
    eth.on?.('chainChanged', handleChainChanged)

    return () => {
      cancelled = true
      eth.removeListener?.('accountsChanged', handleAccountsChanged)
      eth.removeListener?.('chainChanged', handleChainChanged)
    }
  }, [])

  const connect = useCallback(async () => {
    const eth = getEthereum()
    if (!eth) {
      setStatus('no-provider')
      return
    }
    setStatus('connecting')
    setError(null)
    try {
      const accounts = (await eth.request({
        method: 'eth_requestAccounts',
      })) as string[]
      const chainHex = (await eth.request({ method: 'eth_chainId' })) as string
      setChainId(parseChainId(chainHex))
      if (accounts.length > 0) {
        setAccount(accounts[0])
        setStatus('connected')
      } else {
        setStatus('idle')
      }
    } catch (err) {
      const code = getProviderErrorCode(err)
      if (code === PROVIDER_ERROR.USER_REJECTED) {
        setError({
          kind: 'rejected',
          message:
            'You declined the connection request. Click Connect Wallet to try again.',
        })
      } else if (code === PROVIDER_ERROR.REQUEST_PENDING) {
        setError({
          kind: 'pending',
          message:
            'A connection request is already open — check the MetaMask extension.',
        })
      } else {
        setError({ kind: 'unknown', message: getErrorMessage(err) })
      }
      // Fall back to whatever we were before the attempt.
      setStatus(account ? 'connected' : 'idle')
    }
  }, [account])

  /**
   * Force MetaMask's account-selection dialog.
   *
   * `eth_requestAccounts` is a no-op once the site is already authorized — it
   * resolves instantly with the SAME account, which is why "connect" alone
   * can't switch users. `wallet_requestPermissions` re-prompts the picker, so
   * the user can genuinely choose a different account (e.g. moving from an
   * issuer wallet to the admin wallet).
   *
   * Only ever shows accounts in THIS visitor's own MetaMask; the result is
   * held in memory for the session and never persisted.
   */
  const switchAccount = useCallback(async () => {
    const eth = getEthereum()
    if (!eth) {
      setStatus('no-provider')
      return
    }
    setError(null)
    try {
      await eth.request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }],
      })
      const accounts = (await eth.request({
        method: 'eth_accounts',
      })) as string[]
      const chainHex = (await eth.request({ method: 'eth_chainId' })) as string
      setChainId(parseChainId(chainHex))
      if (accounts.length > 0) {
        setAccount(accounts[0])
        setStatus('connected')
      } else {
        setAccount(null)
        setStatus('idle')
      }
    } catch (err) {
      const code = getProviderErrorCode(err)
      if (code === PROVIDER_ERROR.USER_REJECTED) {
        setError({
          kind: 'rejected',
          message:
            'You closed the account picker — still using the previously selected account.',
        })
      } else if (code === PROVIDER_ERROR.REQUEST_PENDING) {
        setError({
          kind: 'pending',
          message:
            'A MetaMask request is already open — check the extension window.',
        })
      } else {
        // Some wallets don't implement wallet_requestPermissions. Fall back to
        // a plain connect so the control never becomes a dead end.
        await connect()
      }
    }
  }, [connect])

  const switchToSepolia = useCallback(async () => {
    const eth = getEthereum()
    if (!eth) return
    setError(null)
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
      })
      // Success surfaces via the chainChanged event.
    } catch (err) {
      const code = getProviderErrorCode(err)
      if (code === PROVIDER_ERROR.UNRECOGNIZED_CHAIN) {
        // Sepolia isn't in MetaMask yet — offer to add it.
        try {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: SEPOLIA_CHAIN_ID_HEX,
                chainName: SEPOLIA_NETWORK.name,
                nativeCurrency: {
                  name: 'Sepolia Ether',
                  symbol: 'ETH',
                  decimals: 18,
                },
                rpcUrls: ['https://rpc.sepolia.org'],
                blockExplorerUrls: [SEPOLIA_NETWORK.blockExplorerUrl],
              },
            ],
          })
        } catch (addErr) {
          const addCode = getProviderErrorCode(addErr)
          setError(
            addCode === PROVIDER_ERROR.USER_REJECTED
              ? {
                  kind: 'switch-rejected',
                  message: 'You declined adding the Sepolia network.',
                }
              : { kind: 'unknown', message: getErrorMessage(addErr) },
          )
        }
      } else if (code === PROVIDER_ERROR.USER_REJECTED) {
        setError({
          kind: 'switch-rejected',
          message:
            'You declined the network switch. Switch to Sepolia to continue.',
        })
      } else {
        setError({ kind: 'unknown', message: getErrorMessage(err) })
      }
    }
  }, [])

  const value = useMemo<WalletContextValue>(
    () => ({
      status,
      account,
      chainId,
      isCorrectNetwork: chainId === SEPOLIA_CHAIN_ID,
      error,
      connect,
      switchAccount,
      disconnect,
      switchToSepolia,
      clearError,
    }),
    [
      status,
      account,
      chainId,
      error,
      connect,
      switchAccount,
      disconnect,
      switchToSepolia,
      clearError,
    ],
  )

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  )
}
