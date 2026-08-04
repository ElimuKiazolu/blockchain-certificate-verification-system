import { type ReactNode } from 'react'
import { RoleGate, type AuthorizedContext, type RoleGateCopy } from './RoleGate'

/**
 * Role gate for the issuer dashboard (Phase 6). Renders `children` ONLY when a
 * wallet is connected, on Sepolia, and holds `ISSUER_ROLE` or
 * `DEFAULT_ADMIN_ROLE` — read live on-chain.
 *
 * The gate states (connect / wrong-network / loading / read-error / denied /
 * authorized) live in {@link RoleGate}, shared with the admin panel so both
 * surfaces behave identically — notably that a failed read is retryable, never
 * a denial. This file supplies only the predicate and the issuer wording.
 *
 * Because the gate guarantees authorization, downstream write code never has
 * to re-check. It stays deliberately broader than the contract: `IssuerDashboard`
 * re-checks `isIssuer` for issuing specifically, since an admin without
 * ISSUER_ROLE may revoke but not issue.
 */
const ISSUER_COPY: RoleGateCopy = {
  noProviderTitle: 'MetaMask is required',
  noProviderBody:
    'Issuing certificates is done from a wallet with issuer permissions. Install MetaMask, then connect the wallet your institution was authorized with.',
  connectBody:
    'The issuer dashboard requires a wallet. Connect the institutional wallet that holds issuer permissions to continue.',
  wrongNetworkBody:
    'The issuer dashboard reads and writes to the Sepolia test network. Your wallet is connected to a different network.',
  unauthorizedTitle: "This wallet isn't authorized to issue",
  unauthorizedBody:
    "The connected address doesn't hold issuer or administrator permissions on the registry, so it can't issue certificates.",
  unauthorizedHelp:
    'To get access, ask your system administrator to grant this address the issuer role. Already have an authorized wallet? Switch accounts in MetaMask.',
}

interface RequireIssuerProps {
  children: (auth: AuthorizedContext) => ReactNode
}

export function RequireIssuer({ children }: RequireIssuerProps) {
  return (
    <RoleGate
      copy={ISSUER_COPY}
      authorize={(data) => data.isAdmin || data.isIssuer}
    >
      {children}
    </RoleGate>
  )
}
