import { useWallet } from '../wallet/context'
import { useRoleRead } from '../wallet/useRoleRead'

/**
 * Which destinations the connected wallet can actually use.
 *
 * ── THIS IS CONVENIENCE, NOT SECURITY ─────────────────────────────────────
 * Hiding a link is a courtesy: it stops someone being shown a door they can't
 * open. It is NOT a permission boundary. The real gates are unchanged and
 * remain authoritative — `RequireIssuer` / `RequireAdmin` still perform their
 * own live on-chain role read on every protected route, and the contract
 * enforces `onlyRole` regardless of what any UI believes. Typing /admin by
 * hand still lands on the gate, exactly as before.
 *
 * Visibility deliberately mirrors what each gate ADMITS, so the nav can never
 * promise access the gate would refuse:
 *   Verifier — always. It's the public function and needs no wallet.
 *   Issuer   — issuer OR admin, matching RequireIssuer.
 *   Admin    — admin only, matching RequireAdmin's DEFAULT_ADMIN_ROLE check.
 *   Wallet   — once a wallet is connected, so the account view is reachable.
 *
 * A role read that is loading or FAILED shows no privileged links. That is the
 * safe direction to be wrong in: the user sees the public app and can retry at
 * the gate, which explains "couldn't check" properly rather than pretending to
 * have decided (docs/07 §3).
 */
export interface NavLink {
  to: string
  label: string
  /** Short line used in the wide hero panel. */
  hint: string
}

export function useNavLinks(): NavLink[] {
  const { status } = useWallet()
  const { state: role } = useRoleRead()

  const roles = role.status === 'success' ? role.data : null
  const links: NavLink[] = [
    { to: '/', label: 'Verifier', hint: 'Check any certificate' },
  ]

  if (roles?.isIssuer || roles?.isAdmin) {
    links.push({ to: '/issuer', label: 'Issuer', hint: 'Issue and revoke' })
  }
  if (roles?.isAdmin) {
    links.push({ to: '/admin', label: 'Admin', hint: 'Manage issuer access' })
  }
  if (status === 'connected') {
    links.push({ to: '/wallet', label: 'Wallet', hint: 'Account and roles' })
  }

  return links
}
