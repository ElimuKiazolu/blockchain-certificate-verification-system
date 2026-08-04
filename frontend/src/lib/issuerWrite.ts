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
  AlreadyRevoked:
    'This certificate has already been revoked. Nothing further is needed — it already shows as REVOKED on the verifier.',
  NotAuthorizedToRevoke:
    'This wallet is not allowed to revoke this certificate. Only the issuer that recorded it, or a registry administrator, can revoke it.',
  // Thrown by revokeCertificate when the hash was never issued, and by
  // revokeBatchCertificate for BOTH an unknown root and a proof that doesn't
  // reproduce the committed leaf — so the wording has to cover all three.
  CertificateNotFound:
    'The registry has no record matching this. Either it was never issued, or — for a batch certificate — one of the details differs from what was issued (every field is part of the on-chain fingerprint).',
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

/**
 * Revoke a SINGLE-issued certificate.
 *
 * ABI (confirmed from blockchain/exports/CertificateRegistry.json):
 *   revokeCertificate(bytes32 certHash)
 *
 * Authorization is NOT a role check: the contract requires
 * `msg.sender == cert.issuer || hasRole(DEFAULT_ADMIN_ROLE, msg.sender)`.
 * So an ISSUER_ROLE wallet that did not issue this particular certificate
 * cannot revoke it, while an admin who holds no issuer role can. The UI can't
 * fully predict this, so it explains a `NotAuthorizedToRevoke` revert rather
 * than pre-blocking the button (see REVERT_MESSAGES).
 */
export async function revokeCertificate(
  ethereum: Eip1193Provider,
  certHash: string,
): Promise<ContractTransactionResponse> {
  const provider = new BrowserProvider(ethereum)
  const signer = await provider.getSigner()
  const contract = new Contract(
    CERTIFICATE_REGISTRY_ADDRESS,
    CERTIFICATE_REGISTRY_ABI,
    signer,
  )
  return (await contract.revokeCertificate(
    certHash,
  )) as ContractTransactionResponse
}

/** The fields needed to revoke one member of a Merkle batch. */
export interface RevokeBatchCertificateInput {
  root: string
  certHash: string
  ipfsCID: string
  recipientName: string
  courseTitle: string
  /** Unix seconds; 0 = never expires. */
  expiresAt: number
  proof: string[]
}

/**
 * Revoke ONE member of a Merkle batch.
 *
 * ABI (confirmed from blockchain/exports/CertificateRegistry.json):
 *   revokeBatchCertificate(bytes32 merkleRoot, bytes32 certHash,
 *     string ipfsCID, string recipientName, string courseTitle,
 *     uint64 expiresAt, bytes32[] proof)
 *
 * Identical parameter order to `verifyBatchCertificate` — the contract
 * re-proves Merkle membership with `_computeLeaf` before touching the revoked
 * set, so every field must arrive VERBATIM (notably ipfsCID; see the
 * field-fidelity note in batchVerify.ts). A single altered character makes the
 * leaf miss and reverts with CertificateNotFound rather than revoking.
 *
 * Authorization is scoped to the BATCH's issuer-of-record, or an admin.
 */
export async function revokeBatchCertificate(
  ethereum: Eip1193Provider,
  input: RevokeBatchCertificateInput,
): Promise<ContractTransactionResponse> {
  const provider = new BrowserProvider(ethereum)
  const signer = await provider.getSigner()
  const contract = new Contract(
    CERTIFICATE_REGISTRY_ADDRESS,
    CERTIFICATE_REGISTRY_ABI,
    signer,
  )
  return (await contract.revokeBatchCertificate(
    input.root,
    input.certHash,
    input.ipfsCID,
    input.recipientName,
    input.courseTitle,
    BigInt(input.expiresAt),
    input.proof,
  )) as ContractTransactionResponse
}
