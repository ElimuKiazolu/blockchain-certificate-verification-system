import { useCallback, useEffect, useState } from 'react'
import { useWallet } from './context'
import { getEthereum, getErrorMessage } from './ethereum'
import { readWalletRoles, type RoleReadResult } from '../lib/contract'

/**
 * On-chain role read as an explicit state machine (docs/07 §2), shared by the
 * `/wallet` card (Phase 4) and the `/issuer` gate (Phase 6) so there is exactly
 * ONE role-read path — no duplicated/faked logic.
 *
 * It reads only when a wallet is connected AND on Sepolia; otherwise it stays
 * `idle` (there is nothing to read yet). Critically, a read *failure* is
 * `error`, never a verdict: "couldn't check" is distinct from "no role", so the
 * issuer gate must treat an error as retryable — NOT as unauthorized.
 */
export type RoleReadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: RoleReadResult }
  | { status: 'error'; message: string }

export interface UseRoleRead {
  state: RoleReadState
  /** Re-run the read — drives the error-retry affordance. */
  retry: () => void
}

export function useRoleRead(): UseRoleRead {
  const { status, account, isCorrectNetwork } = useWallet()
  const [state, setState] = useState<RoleReadState>({ status: 'idle' })
  const [reloadKey, setReloadKey] = useState(0)

  const retry = useCallback(() => setReloadKey((k) => k + 1), [])

  const canRead = status === 'connected' && isCorrectNetwork && account !== null

  useEffect(() => {
    if (!canRead || account === null) {
      setState({ status: 'idle' })
      return
    }
    const eth = getEthereum()
    if (!eth) {
      setState({ status: 'error', message: 'MetaMask provider unavailable.' })
      return
    }

    let cancelled = false
    setState({ status: 'loading' })
    readWalletRoles(eth, account)
      .then((data) => {
        if (!cancelled) setState({ status: 'success', data })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: getErrorMessage(err) })
        }
      })

    return () => {
      cancelled = true
    }
  }, [canRead, account, reloadKey])

  return { state, retry }
}

/** Human label for a role-read result (matches the /wallet card wording). */
export function describeRoles(data: RoleReadResult): string {
  if (data.isAdmin && data.isIssuer) return 'Administrator + Issuer'
  if (data.isAdmin) return 'Administrator'
  if (data.isIssuer) return 'Issuer'
  return 'No role'
}
