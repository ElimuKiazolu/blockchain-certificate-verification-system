import { type ReactNode } from 'react'
import { RoleGate, type AuthorizedContext, type RoleGateCopy } from './RoleGate'

/**
 * Role gate for the admin panel (Phase 6, final slice).
 *
 * Checks `DEFAULT_ADMIN_ROLE` SPECIFICALLY — deliberately stricter than
 * {@link RequireIssuer}, which admits issuers too. Role management is the
 * registry's governance surface: on-chain, `grantRole`/`revokeRole` are
 * restricted to the role's admin (DEFAULT_ADMIN_ROLE here), so an ISSUER_ROLE
 * wallet reaching this panel could only ever produce reverts. It is refused at
 * the gate instead, with an explanation.
 *
 * All gate states come from the shared {@link RoleGate} — including the one
 * that matters most here: a failed role read is retryable and explicitly NOT a
 * denial. Silently downgrading an RPC hiccup to "you're not an admin" would be
 * both wrong and alarming on a governance screen.
 */
const ADMIN_COPY: RoleGateCopy = {
  noProviderTitle: 'MetaMask is required',
  noProviderBody:
    'Managing roles is done from the wallet that administers the registry. Install MetaMask, then connect the administrator wallet to continue.',
  connectBody:
    'The admin panel requires a wallet. Connect the administrator wallet that deployed or governs the registry to continue.',
  wrongNetworkBody:
    'The admin panel reads and writes to the Sepolia test network. Your wallet is connected to a different network.',
  unauthorizedTitle: 'Administrator access required',
  unauthorizedBody:
    "The connected address doesn't hold administrator rights on the registry. Only an administrator can grant or revoke the issuer role.",
  unauthorizedHelp:
    'Issuer permissions alone are not enough for this screen — role management is restricted to administrators. If you administer this registry, switch to that wallet in MetaMask.',
}

interface RequireAdminProps {
  children: (auth: AuthorizedContext) => ReactNode
}

export function RequireAdmin({ children }: RequireAdminProps) {
  return (
    <RoleGate copy={ADMIN_COPY} authorize={(data) => data.isAdmin}>
      {children}
    </RoleGate>
  )
}
