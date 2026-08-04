// Role governance writes (Phase 6, admin panel) — granting and revoking
// ISSUER_ROLE through the UI instead of Etherscan's Write Contract tab.
//
// These are OpenZeppelin AccessControl functions, confirmed from
// blockchain/exports/CertificateRegistry.json:
//   nonpayable grantRole(bytes32 role, address account)
//   nonpayable revokeRole(bytes32 role, address account)
//   view       hasRole(bytes32 role, address account) -> bool
//   view       ISSUER_ROLE() -> bytes32
//   view       DEFAULT_ADMIN_ROLE() -> bytes32
//
// The role IDENTIFIER is always read from the contract, never hardcoded. It is
// a keccak256 constant, so a literal would look stable — but pinning it here
// would silently desynchronize if the contract ever renamed the role, and the
// resulting grantRole would write a role nobody checks. Reading it costs one
// view call and cannot drift.
//
// Reads of an address's CURRENT roles deliberately reuse `readWalletRoles`
// from lib/contract.ts unchanged: it already reads both role IDs from the
// contract and both `hasRole` results, for any address — not just the
// connected one. One role-read path across the whole app.

import {
  BrowserProvider,
  Contract,
  isAddress,
  getAddress,
  type ContractTransactionResponse,
  type Eip1193Provider,
} from 'ethers'
import {
  CERTIFICATE_REGISTRY_ABI,
  CERTIFICATE_REGISTRY_ADDRESS,
} from '../contract'

/**
 * Plain-language revert text for the ADMIN surface. Passed to
 * `classifyIssueError` as overrides, because the same
 * AccessControlUnauthorizedAccount error means something different here
 * ("you aren't an administrator") than it does when issuing ("you aren't an
 * issuer") — one shared message would be wrong on one of the two screens.
 */
export const ADMIN_REVERT_MESSAGES: Record<string, string> = {
  AccessControlUnauthorizedAccount:
    "This wallet doesn't hold administrator rights on the registry, so it can't change roles. Only an administrator can grant or revoke the issuer role.",
}

/** Build a signer-backed contract from the injected wallet. */
async function connect(ethereum: Eip1193Provider): Promise<Contract> {
  const provider = new BrowserProvider(ethereum)
  const signer = await provider.getSigner()
  return new Contract(
    CERTIFICATE_REGISTRY_ADDRESS,
    CERTIFICATE_REGISTRY_ABI,
    signer,
  )
}

/**
 * Validate and normalize an address the admin typed.
 *
 * `getAddress` returns the EIP-55 checksummed form, which is what gets shown
 * back — a checksum mismatch is the cheapest available guard against a
 * mistyped address, and role grants go to whatever address you name.
 */
export function normalizeAddress(input: string): string | null {
  const trimmed = input.trim()
  if (!isAddress(trimmed)) return null
  return getAddress(trimmed)
}

/**
 * Grant ISSUER_ROLE to `account`.
 *
 * Note on idempotency: AccessControl's `_grantRole` is a no-op when the
 * account already holds the role — the transaction SUCCEEDS, emits no
 * RoleGranted event, and still costs gas. The UI therefore reads the current
 * status first and says so, rather than letting an admin pay for nothing and
 * read the success as a change.
 */
export async function grantIssuerRole(
  ethereum: Eip1193Provider,
  account: string,
): Promise<ContractTransactionResponse> {
  const contract = await connect(ethereum)
  const issuerRole = (await contract.ISSUER_ROLE()) as string
  return (await contract.grantRole(
    issuerRole,
    account,
  )) as ContractTransactionResponse
}

/**
 * Revoke ISSUER_ROLE from `account`.
 *
 * Same idempotency caveat as {@link grantIssuerRole} — revoking a role the
 * account doesn't hold succeeds silently and emits nothing.
 *
 * This panel only ever touches ISSUER_ROLE, never DEFAULT_ADMIN_ROLE, so no
 * action here can strip the last administrator and leave the registry
 * ungovernable. Losing your own issuer role is recoverable (an admin can
 * re-grant it); losing the last admin role would not be.
 */
export async function revokeIssuerRole(
  ethereum: Eip1193Provider,
  account: string,
): Promise<ContractTransactionResponse> {
  const contract = await connect(ethereum)
  const issuerRole = (await contract.ISSUER_ROLE()) as string
  return (await contract.revokeRole(
    issuerRole,
    account,
  )) as ContractTransactionResponse
}

/* ------------------------------------------------------------------ */
/* Locally tracked addresses                                           */
/* ------------------------------------------------------------------ */

const TRACKED_KEY = 'cvd.admin.trackedAddresses'

/**
 * Addresses this browser has granted/revoked or looked up.
 *
 * This exists ONLY because the deployed contract uses plain `AccessControl`,
 * which cannot enumerate role members (no getRoleMember/getRoleMemberCount in
 * the ABI — verified). It is a local convenience list, never an authority:
 * only ADDRESSES are stored, never their roles, so every status shown is read
 * live from the chain. A cleared browser loses the list, not any information
 * that matters — the chain remains the source of truth.
 */
export function loadTrackedAddresses(): string[] {
  try {
    const raw = localStorage.getItem(TRACKED_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((a): a is string => typeof a === 'string' && isAddress(a))
  } catch {
    return []
  }
}

export function saveTrackedAddress(address: string): string[] {
  const existing = loadTrackedAddresses()
  const next = existing.includes(address) ? existing : [address, ...existing]
  try {
    localStorage.setItem(TRACKED_KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable/full (private mode) — the list is a convenience only.
  }
  return next
}

export function forgetTrackedAddress(address: string): string[] {
  const next = loadTrackedAddresses().filter((a) => a !== address)
  try {
    localStorage.setItem(TRACKED_KEY, JSON.stringify(next))
  } catch {
    // As above — losing the local list costs nothing on-chain.
  }
  return next
}
