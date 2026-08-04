// Shared cohort validation for Merkle batch issuance (Phase 6, Slice 3a).
// Both input methods (CSV upload and the in-UI table) funnel through
// `validateRawRow` so a row typed by hand and a row parsed from a spreadsheet
// are held to identical rules — one normalized `CohortRow[]` either way.

import Papa from 'papaparse'
import { dateInputToExpiresAt } from './format'

/** IPFS isn't wired until Phase 7; the leaf just needs a non-empty placeholder. */
export const IPFS_PLACEHOLDER = 'PENDING_IPFS_PHASE7'

const CERT_HASH_RE = /^0x[0-9a-fA-F]{64}$/

/** A normalized, validated cohort row — the JS mirror of a Merkle leaf's fields. */
export interface CohortRow {
  recipientName: string
  courseTitle: string
  expiresAt: bigint
  certHash: string
  ipfsCID: string
}

/** A row paired with the 1-based line/position it came from, for error display. */
export interface CohortRowEntry {
  rowNumber: number
  data: CohortRow
}

export interface RowIssue {
  row: number
  message: string
}

/** Raw, string-only field values — what a CSV cell or a table input holds. */
export interface RawCohortFields {
  recipientName?: string
  courseTitle?: string
  expiresAt?: string
  certHash?: string
  ipfsCID?: string
}

/** Validate one row's raw string fields into a normalized `CohortRow`, or issues. */
export function validateRawRow(
  raw: RawCohortFields,
  rowNumber: number,
): { row: CohortRow | null; issues: RowIssue[] } {
  const issues: RowIssue[] = []
  const recipientName = (raw.recipientName ?? '').trim()
  const courseTitle = (raw.courseTitle ?? '').trim()
  const certHash = (raw.certHash ?? '').trim()
  const expiresAtRaw = (raw.expiresAt ?? '').trim()
  const ipfsCID = (raw.ipfsCID ?? '').trim() || IPFS_PLACEHOLDER

  if (!recipientName) {
    issues.push({ row: rowNumber, message: 'Recipient name is required.' })
  }
  if (!courseTitle) {
    issues.push({ row: rowNumber, message: 'Course title is required.' })
  }
  if (!certHash) {
    issues.push({ row: rowNumber, message: 'Certificate hash is required.' })
  } else if (!CERT_HASH_RE.test(certHash)) {
    issues.push({
      row: rowNumber,
      message: `Certificate hash must be 0x + 64 hex characters (got "${certHash}").`,
    })
  }

  let expiresAt = 0n
  if (expiresAtRaw) {
    expiresAt = dateInputToExpiresAt(expiresAtRaw)
    if (expiresAt === 0n) {
      issues.push({
        row: rowNumber,
        message: `Expiry date "${expiresAtRaw}" isn't a valid date (expected YYYY-MM-DD).`,
      })
    }
  }

  if (issues.length > 0) return { row: null, issues }
  return {
    row: { recipientName, courseTitle, expiresAt, certHash, ipfsCID },
    issues: [],
  }
}

/**
 * Flag certHash duplicates WITHIN the cohort (R12: caught off-chain, before any
 * write — a batch is atomic, so a duplicate anywhere means nothing is clean
 * enough to issue yet). Every row sharing a hash is flagged, not just the 2nd+.
 */
export function findDuplicates(entries: CohortRowEntry[]): RowIssue[] {
  const byHash = new Map<string, number[]>()
  for (const entry of entries) {
    const key = entry.data.certHash.toLowerCase()
    const rows = byHash.get(key) ?? []
    rows.push(entry.rowNumber)
    byHash.set(key, rows)
  }
  const issues: RowIssue[] = []
  for (const rows of byHash.values()) {
    if (rows.length < 2) continue
    for (const rowNumber of rows) {
      issues.push({
        row: rowNumber,
        message: `Duplicate certificate hash — also used by row ${rows.filter((r) => r !== rowNumber).join(', ')}.`,
      })
    }
  }
  return issues
}

export interface CohortParseResult {
  validRows: CohortRowEntry[]
  issues: RowIssue[]
  totalRows: number
}

/**
 * Validate a full set of rows (one per position) and drop cross-row
 * duplicates. The single entry point both CSV parsing and the in-UI table
 * use, so hand-typed and spreadsheet-parsed rows are held to identical rules.
 */
export function validateCohortRows(
  rawRows: { rowNumber: number; fields: RawCohortFields }[],
): CohortParseResult {
  const issues: RowIssue[] = []
  const validRows: CohortRowEntry[] = []

  for (const { rowNumber, fields } of rawRows) {
    const { row, issues: rowIssues } = validateRawRow(fields, rowNumber)
    issues.push(...rowIssues)
    if (row) validRows.push({ rowNumber, data: row })
  }

  const cleanValidRows = dropDuplicates(validRows, issues)

  return { validRows: cleanValidRows, issues, totalRows: rawRows.length }
}

/**
 * Parse a CSV with columns `recipientName, courseTitle, expiresAt, certHash`
 * (+ optional `ipfsCID`). Every row is validated; invalid rows are excluded
 * from `validRows` but reported in `issues` with their exact row number.
 */
export function parseCohortCsv(csvText: string): CohortParseResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  })

  const parseIssues: RowIssue[] = parsed.errors.map((err) => ({
    row: (err.row ?? -1) + 2,
    message: err.message,
  }))

  const rawRows = parsed.data.map((fields, i) => ({
    rowNumber: i + 2, // +1 for the header line, +1 for 1-based data rows
    fields,
  }))

  const result = validateCohortRows(rawRows)
  return { ...result, issues: [...parseIssues, ...result.issues] }
}

function dropDuplicates(
  entries: CohortRowEntry[],
  issues: RowIssue[],
): CohortRowEntry[] {
  const duplicateIssues = findDuplicates(entries)
  if (duplicateIssues.length === 0) return entries
  issues.push(...duplicateIssues)
  const duplicateRows = new Set(duplicateIssues.map((i) => i.row))
  return entries.filter((e) => !duplicateRows.has(e.rowNumber))
}

/** A sample CSV Elimu can use as-is for a manual end-to-end test (3 rows). */
export const SAMPLE_COHORT_CSV = `recipientName,courseTitle,expiresAt,certHash,ipfsCID
Amara Osei,BSc Computer Engineering,,0x1111111111111111111111111111111111111111111111111111111111111111,
Bilal Rahman,BSc Computer Engineering,2027-06-30,0x2222222222222222222222222222222222222222222222222222222222222222,
Chidi Okafor,MSc Computer Science,,0x3333333333333333333333333333333333333333333333333333333333333333,
`
