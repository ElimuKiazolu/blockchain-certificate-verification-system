// In-browser Merkle tree construction for batch issuance (Phase 6, Slice 3a).
//
// FROZEN leaf encoding (Phase 2; see blockchain/test/CertificateRegistry.ts
// LEAF_TYPES and blockchain/contracts/CertificateRegistry.sol _computeLeaf):
// keccak256(keccak256(abi.encode(certHash, ipfsCID, recipientName, courseTitle,
// expiresAt))) with types [bytes32, string, string, string, uint64], in that
// exact field order. @openzeppelin/merkle-tree's StandardMerkleTree produces
// byte-identical leaves for this same (values, types) pair — confirmed against
// the Solidity test ("produces an identical leaf in JS and via the Solidity
// encoding"). Do not reorder or retype these fields; every issued batch
// depends on this encoding staying fixed.

import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import type { CohortRow } from './cohortValidation'

export const LEAF_TYPES = [
  'bytes32',
  'string',
  'string',
  'string',
  'uint64',
] as const

/** [certHash, ipfsCID, recipientName, courseTitle, expiresAt] — leaf field order. */
export type LeafRow = [string, string, string, string, bigint]

export function toLeafRow(row: CohortRow): LeafRow {
  return [row.certHash, row.ipfsCID, row.recipientName, row.courseTitle, row.expiresAt]
}

export function buildMerkleTree(rows: CohortRow[]): StandardMerkleTree<LeafRow> {
  return StandardMerkleTree.of(rows.map(toLeafRow), [...LEAF_TYPES])
}

export interface ProvenRow extends CohortRow {
  proof: string[]
}

/**
 * Pair each row with its Merkle proof. `tree.getProof(i)` is keyed by the
 * position the row was inserted at via `StandardMerkleTree.of(rows, ...)` —
 * the same order `rows` was passed in, confirmed against the Solidity test's
 * `tree.getProof(i)` usage against its own `rows[i]`.
 */
export function attachProofs(
  rows: CohortRow[],
  tree: StandardMerkleTree<LeafRow>,
): ProvenRow[] {
  return rows.map((row, i) => ({ ...row, proof: tree.getProof(i) }))
}
