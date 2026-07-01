// Read-only contract access. Builds an ethers v6 Contract from the injected
// EIP-1193 provider + the exported ABI/address, and exposes typed reads.
//
// Reads only in Phase 4 — no signer, no transactions. Every call is wrapped in
// a timeout so a slow/unreachable RPC surfaces as a handled error (retry)
// rather than an infinite spinner (docs/07 R2).

import { BrowserProvider, Contract, type Eip1193Provider } from 'ethers'
import {
  CERTIFICATE_REGISTRY_ABI,
  CERTIFICATE_REGISTRY_ADDRESS,
} from '../contract'

const READ_TIMEOUT_MS = 15_000

export type WalletRole = 'admin' | 'issuer'

export interface RoleReadResult {
  isAdmin: boolean
  isIssuer: boolean
  roles: WalletRole[]
}

/** Mirrors the on-chain enum in CertificateRegistry.sol (index = uint8 value). */
export type CertStatus = 'NOT_FOUND' | 'VALID' | 'EXPIRED' | 'REVOKED'
const CERT_STATUS_BY_INDEX: readonly CertStatus[] = [
  'NOT_FOUND', // 0
  'VALID', // 1
  'EXPIRED', // 2
  'REVOKED', // 3
]

/** Reject if the underlying read hasn't settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('The contract read timed out. Please retry.'))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      },
    )
  })
}

function getReadContract(ethereum: Eip1193Provider): Contract {
  const provider = new BrowserProvider(ethereum)
  return new Contract(
    CERTIFICATE_REGISTRY_ADDRESS,
    CERTIFICATE_REGISTRY_ABI,
    provider,
  )
}

/**
 * Read whether `account` holds the admin and/or issuer role. This is how the
 * issuer dashboard (Phase 6+) will gate access — and it proves the read pipe.
 */
export async function readWalletRoles(
  ethereum: Eip1193Provider,
  account: string,
): Promise<RoleReadResult> {
  const contract = getReadContract(ethereum)

  const [adminRole, issuerRole] = (await withTimeout(
    Promise.all([contract.DEFAULT_ADMIN_ROLE(), contract.ISSUER_ROLE()]),
    READ_TIMEOUT_MS,
  )) as [string, string]

  const [isAdmin, isIssuer] = (await withTimeout(
    Promise.all([
      contract.hasRole(adminRole, account),
      contract.hasRole(issuerRole, account),
    ]),
    READ_TIMEOUT_MS,
  )) as [boolean, boolean]

  const roles: WalletRole[] = []
  if (isAdmin) roles.push('admin')
  if (isIssuer) roles.push('issuer')
  return { isAdmin, isIssuer, roles }
}

/**
 * Resolve a certificate hash to its on-chain status. An unknown hash returns
 * NOT_FOUND — a legitimate *result*, distinct from a read error (which throws).
 * Used here to demonstrate a real single-cert read; the full verifier is Phase 5.
 */
export async function readCertificateStatus(
  ethereum: Eip1193Provider,
  certHash: string,
): Promise<CertStatus> {
  const contract = getReadContract(ethereum)
  const result = (await withTimeout(
    contract.verifyCertificate(certHash),
    READ_TIMEOUT_MS,
  )) as [bigint, unknown]
  const statusIndex = Number(result[0])
  return CERT_STATUS_BY_INDEX[statusIndex] ?? 'NOT_FOUND'
}
