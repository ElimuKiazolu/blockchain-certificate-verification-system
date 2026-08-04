// Per-student output bundles for a just-issued batch (Phase 6, Slice 3a).
//
// The proof travels WITH the certificate — never served by a backend (see
// CLAUDE.md "Hashing & Merkle conventions" + docs/07 R8's recommended
// mitigation) — so these are the two downloads a registrar distributes to
// students: a machine-readable JSON bundle (what Slice 3b's verifier will
// consume) and a human-readable CSV for non-technical staff.

import Papa from 'papaparse'
import type { ProvenRow } from './merkle'

export interface BatchCertificateRecord {
  certHash: string
  ipfsCID: string
  recipientName: string
  courseTitle: string
  expiresAt: number
  proof: string[]
  root: string
  contractAddress: string
  chainId: number
}

export function buildJsonBundle(
  rows: ProvenRow[],
  root: string,
  contractAddress: string,
  chainId: number,
): BatchCertificateRecord[] {
  return rows.map((row) => ({
    certHash: row.certHash,
    ipfsCID: row.ipfsCID,
    recipientName: row.recipientName,
    courseTitle: row.courseTitle,
    expiresAt: Number(row.expiresAt),
    proof: row.proof,
    root,
    contractAddress,
    chainId,
  }))
}

export function buildCsvOutput(records: BatchCertificateRecord[]): string {
  const table = records.map((r) => ({
    recipientName: r.recipientName,
    courseTitle: r.courseTitle,
    expiresAt: r.expiresAt === 0 ? '' : new Date(r.expiresAt * 1000).toISOString().slice(0, 10),
    certHash: r.certHash,
    ipfsCID: r.ipfsCID,
    proof: JSON.stringify(r.proof),
    root: r.root,
  }))
  return Papa.unparse(table)
}

/** Trigger a browser download for a small text blob (JSON/CSV outputs). */
export function downloadTextFile(filename: string, contents: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
