// Write access to the CertificateRegistry — the FIRST on-chain write from the
// frontend (Phase 6). Uses the wallet's SIGNER (BrowserProvider.getSigner()),
// never the read-only JsonRpcProvider from readClient.ts, which has no key to
// sign with. The verifier (Phase 5) stays wallet-free and untouched by this.
//
// Error classification follows ethers v6's typed errors, verified against the
// installed ethers@6.17 type definitions (not assumed):
//   - ACTION_REJECTED  → the user declined the MetaMask prompt.
//   - CALL_EXCEPTION   → a revert. ethers auto-decodes known custom Solidity
//     errors into `.revert.name` when the Contract's ABI defines them, so
//     CertificateAlreadyExists / AccessControlUnauthorizedAccount / EmptyCID
//     surface by name, not raw hex. Most reverts (e.g. a duplicate hash) are
//     caught by MetaMask's pre-flight gas estimation BEFORE any tx hash
//     exists — that still lands here, not as a mined-then-reverted tx.

import {
  BrowserProvider,
  Contract,
  isError,
  type ContractTransactionResponse,
  type Eip1193Provider,
} from 'ethers'
import {
  CERTIFICATE_REGISTRY_ABI,
  CERTIFICATE_REGISTRY_ADDRESS,
} from '../contract'

export interface IssueCertificateInput {
  certHash: string
  ipfsCID: string
  recipientName: string
  courseTitle: string
  /** Unix seconds; 0n = never expires. */
  expiresAt: bigint
}

export type IssueErrorKind = 'rejected' | 'reverted' | 'unknown'

export interface IssueError {
  kind: IssueErrorKind
  message: string
}

/** Plain-language text for the contract's custom errors (CertificateRegistry.sol). */
const REVERT_MESSAGES: Record<string, string> = {
  CertificateAlreadyExists:
    'A certificate with this exact file hash has already been issued. Each certificate must be unique.',
  AccessControlUnauthorizedAccount:
    "This wallet doesn't currently hold the issuer role — it may have been revoked since you connected. Reconnect, or ask an administrator to grant ISSUER_ROLE.",
  EmptyCID: 'The document reference field cannot be empty.',
  BatchRootExists:
    'A batch with this exact Merkle root has already been issued — the cohort may have been submitted already.',
  EmptyRoot:
    'The computed Merkle root is empty. Add at least one valid certificate row before issuing.',
}

/** Classify a thrown error into a plain-language, user-safe message. */
export function classifyIssueError(err: unknown): IssueError {
  if (isError(err, 'ACTION_REJECTED')) {
    return {
      kind: 'rejected',
      message: 'You declined the request in your wallet.',
    }
  }
  if (isError(err, 'CALL_EXCEPTION')) {
    const name = err.revert?.name
    const message =
      (name && REVERT_MESSAGES[name]) ??
      err.reason ??
      err.shortMessage ??
      'The transaction would fail and was not sent.'
    return { kind: 'reverted', message }
  }
  return {
    kind: 'unknown',
    message: err instanceof Error ? err.message : 'Something went wrong.',
  }
}

/**
 * Send the issueCertificate transaction. The contract enforces
 * onlyRole(ISSUER_ROLE) itself; the UI checks this first too (defense in
 * depth — see RequireIssuer / IssuerDashboard), so a revert here should be
 * rare in the happy path.
 */
export async function issueCertificate(
  ethereum: Eip1193Provider,
  input: IssueCertificateInput,
): Promise<ContractTransactionResponse> {
  const provider = new BrowserProvider(ethereum)
  const signer = await provider.getSigner()
  const contract = new Contract(
    CERTIFICATE_REGISTRY_ADDRESS,
    CERTIFICATE_REGISTRY_ABI,
    signer,
  )
  return (await contract.issueCertificate(
    input.certHash,
    input.ipfsCID,
    input.recipientName,
    input.courseTitle,
    input.expiresAt,
  )) as ContractTransactionResponse
}

/**
 * Send the batchIssue transaction — commits one Merkle root for a whole
 * cohort (Phase 6, Slice 3a). Same signer/contract-building pattern as
 * {@link issueCertificate}; errors are classified with the same
 * {@link classifyIssueError} (BatchRootExists / EmptyRoot are in
 * REVERT_MESSAGES above).
 */
export async function batchIssue(
  ethereum: Eip1193Provider,
  merkleRoot: string,
): Promise<ContractTransactionResponse> {
  const provider = new BrowserProvider(ethereum)
  const signer = await provider.getSigner()
  const contract = new Contract(
    CERTIFICATE_REGISTRY_ADDRESS,
    CERTIFICATE_REGISTRY_ABI,
    signer,
  )
  return (await contract.batchIssue(merkleRoot)) as ContractTransactionResponse
}
