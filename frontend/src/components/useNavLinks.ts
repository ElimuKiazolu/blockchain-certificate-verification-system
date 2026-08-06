import { Building2, FileSignature, ShieldCheck, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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
  /** Small grey line under the label. */
  hint: string
  Icon: LucideIcon
}

export function useNavLinks(): NavLink[] {
  const { status } = useWallet()
  const { state: role } = useRoleRead()

  const roles = role.status === 'success' ? role.data : null
  const links: NavLink[] = [
    {
      to: '/',
      label: 'Verifier',
      hint: 'Verify certificates',
      Icon: ShieldCheck,
    },
  ]

  if (roles?.isIssuer || roles?.isAdmin) {
    links.push({
      to: '/issuer',
      label: 'Issuer',
      hint: 'Issue certificates',
      Icon: FileSignature,
    })
  }
  if (roles?.isAdmin) {
    links.push({
      to: '/admin',
      label: 'Admin',
      hint: 'Manage issuer access',
      Icon: Building2,
    })
  }
  if (status === 'connected') {
    links.push({
      to: '/wallet',
      label: 'Wallet',
      hint: 'Manage wallet',
      Icon: Wallet,
    })
  }

  return links
}

/**
 * The role summary shown at the foot of the sidebar. Returns null when there
 * is nothing honest to claim — disconnected, still reading, or a failed read.
 * A failed read must never render as "no privileges" (docs/07 §3).
 */
export function useRoleSummary(): { title: string; detail: string } | null {
  const { status } = useWallet()
  const { state: role } = useRoleRead()

  if (status !== 'connected' || role.status !== 'success') return null

  const { isAdmin, isIssuer } = role.data
  if (isAdmin && isIssuer) {
    return {
      title: 'Admin + Issuer Access',
      detail: 'You can issue and revoke certificates, and manage issuer access.',
    }
  }
  if (isAdmin) {
    return {
      title: 'Admin Access',
      detail: 'You can manage issuer access and revoke any certificate.',
    }
  }
  if (isIssuer) {
    return {
      title: 'Issuer Access',
      detail: 'You can issue certificates and revoke the ones you issued.',
    }
  }
  return {
    title: 'No Registry Role',
    detail: 'This wallet can verify certificates, like any visitor.',
  }
}
