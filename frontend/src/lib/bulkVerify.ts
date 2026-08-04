// Bulk batch verification (Phase 6, Slice 3c) — check an ENTIRE cohort
// against the chain in one action, instead of stepping through members one at
// a time as Slice 3b requires.
//
// This module WRAPS 3b's per-member call; it does not reimplement it. Every
// row goes through the same `verifyBatchCertificate` from readClient.ts, with
// the same frozen field order/types and the same verbatim values (notably
// ipfsCID — see the field-fidelity note in batchVerify.ts). Bulk mode changes
// how many times that call is made and how results are aggregated, nothing
// about what a single verification means.
//
// ── The rule that matters most at scale ───────────────────────────────────
// A read that FAILS (RPC error, timeout, rate limit) is NOT a verdict. Across
// 200 rows it would be catastrophic to render a flaky RPC as 200 "NOT FOUND"
// certificates — a registrar could conclude a whole cohort was forged. So an
// exception is captured as a THIRD outcome kind, `unchecked`, kept separate
// from every verdict in the types, the summary, the table and the report
// (docs/07 §3: "couldn't check" ≠ "checked, doesn't exist").

import Papa from 'papaparse'
import { dateInputToExpiresAt } from './format'
import { parseBatchBundle, type BatchCertificateInput } from './batchVerify'
import { verifyBatchCertificate, type CertStatus } from './readClient'

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/

export interface BulkParseResult {
  members: BatchCertificateInput[]
  /** A fatal problem — nothing can be verified until it's fixed. */
  error: string | null
  /** Non-fatal observations worth showing before a run (e.g. mixed roots). */
  warnings: string[]
}

/**
 * Parse a whole-cohort input in either format Slice 3a produces: the JSON
 * bundle (array of records) or the CSV export.
 *
 * Format is chosen by content, not by trusting a file extension: a JSON
 * document starts with `[` or `{`, anything else is treated as CSV.
 */
export function parseBulkInput(text: string): BulkParseResult {
  const trimmed = text.trim()
  if (!trimmed) {
    return { members: [], error: 'That file is empty.', warnings: [] }
  }

  const result = trimmed.startsWith('[') || trimmed.startsWith('{')
    ? parseJsonBundle(trimmed)
    : parseMembersCsv(trimmed)

  if (result.error) return result
  return { ...result, warnings: [...result.warnings, ...checkRootConsistency(result.members)] }
}

function parseJsonBundle(text: string): BulkParseResult {
  const parsed = parseBatchBundle(text)
  if (parsed.error) return { members: [], error: parsed.error, warnings: [] }
  return { members: parsed.records, error: null, warnings: [] }
}

/**
 * Parse the Slice 3a CSV export. Columns:
 *   recipientName, courseTitle, expiresAt, certHash, ipfsCID, proof, root
 *
 * Two columns need care on the way back in:
 *
 * `proof` is written by 3a as `JSON.stringify(string[])`, so it parses back
 * with JSON.parse. A whitespace/semicolon-separated list is also accepted, so
 * a registrar who reformatted the column in a spreadsheet isn't stuck.
 *
 * `expiresAt` is written by 3a as a YYYY-MM-DD date, NOT unix seconds — and
 * expiry is part of the hashed leaf, so it has to come back exactly. That
 * round-trip is lossless because every expiry originates from
 * `dateInputToExpiresAt` (UTC midnight) and 3a formats it back with
 * `toISOString()` (also UTC); verified against the on-chain fixture bundle.
 * A raw integer is also accepted so a hand-built CSV carrying exact seconds
 * (which a date column could only represent to the day) still verifies.
 */
function parseMembersCsv(text: string): BulkParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  })

  if (parsed.data.length === 0) {
    return {
      members: [],
      error: 'No rows found in that CSV. Expected a header row plus one row per certificate.',
      warnings: [],
    }
  }

  const required = ['recipientName', 'courseTitle', 'certHash', 'proof', 'root']
  const headers = parsed.meta.fields ?? []
  const missing = required.filter((column) => !headers.includes(column))
  if (missing.length > 0) {
    return {
      members: [],
      error: `That CSV is missing required column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}. Expected the report exported when the batch was issued.`,
      warnings: [],
    }
  }

  const members: BatchCertificateInput[] = []
  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i]
    const rowNumber = i + 2 // +1 header, +1 for 1-based rows
    const member = readCsvRow(row)
    if (typeof member === 'string') {
      return { members: [], error: `Row ${rowNumber}: ${member}`, warnings: [] }
    }
    members.push(member)
  }

  return { members, error: null, warnings: [] }
}

function readCsvRow(row: Record<string, string>): BatchCertificateInput | string {
  const root = (row.root ?? '').trim()
  const certHash = (row.certHash ?? '').trim()
  if (!BYTES32_RE.test(root)) {
    return '"root" must be 0x followed by 64 hexadecimal characters.'
  }
  if (!BYTES32_RE.test(certHash)) {
    return '"certHash" must be 0x followed by 64 hexadecimal characters.'
  }

  const proof = parseProofCell(row.proof ?? '')
  if (proof === null) {
    return '"proof" could not be read. Expected a JSON list like ["0x…","0x…"].'
  }

  const expiresAt = parseExpiresAtCell(row.expiresAt ?? '')
  if (expiresAt === null) {
    return '"expiresAt" must be a YYYY-MM-DD date, a whole number of seconds, or blank for never.'
  }

  return {
    root,
    certHash,
    // Names, titles and the CID are part of the hashed leaf — taken exactly as
    // the cell holds them. Only the hex fields above are trimmed, and only
    // because surrounding whitespace can't be part of a bytes32.
    recipientName: row.recipientName ?? '',
    courseTitle: row.courseTitle ?? '',
    ipfsCID: row.ipfsCID ?? '',
    expiresAt,
    proof,
  }
}

/** A cell holding a serialized `string[]` — JSON, or a separated list. */
function parseProofCell(cell: string): string[] | null {
  const trimmed = cell.trim()
  if (!trimmed) return [] // a single-member batch legitimately has an empty proof

  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed) && parsed.every((p) => typeof p === 'string' && BYTES32_RE.test(p))) {
        return parsed as string[]
      }
    } catch {
      return null
    }
    return null
  }

  const parts = trimmed.split(/[\s;,|]+/).filter(Boolean)
  return parts.every((p) => BYTES32_RE.test(p)) ? parts : null
}

/** Blank → 0 (never expires); all-digits → exact seconds; otherwise a date. */
function parseExpiresAtCell(cell: string): number | null {
  const trimmed = cell.trim()
  if (!trimmed) return 0
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const seconds = dateInputToExpiresAt(trimmed)
  return seconds === 0n ? null : Number(seconds)
}

/**
 * Every member of one issued bundle shares a single Merkle root. A mix means
 * files were combined by hand — worth flagging, since it changes what the
 * summary is actually saying.
 */
function checkRootConsistency(members: BatchCertificateInput[]): string[] {
  const roots = new Set(members.map((m) => m.root.toLowerCase()))
  if (roots.size <= 1) return []
  return [
    `This file mixes ${roots.size} different batch roots. That's expected only if you combined bundles by hand — each row is still checked against its own root.`,
  ]
}

/* ------------------------------------------------------------------ */
/* Throttled verification run                                          */
/* ------------------------------------------------------------------ */

/**
 * An outcome is EITHER an on-chain verdict OR an admission that we couldn't
 * reach the chain. Modelling it as a union rather than adding a fifth
 * CertStatus makes the distinction impossible to lose by accident: nothing
 * that renders a verdict can be handed an `unchecked` row.
 */
export type MemberOutcome =
  | { kind: 'verdict'; status: CertStatus }
  | { kind: 'unchecked'; message: string }

export interface MemberResult {
  /** Position in the parsed member list — stable across retries. */
  index: number
  member: BatchCertificateInput
  outcome: MemberOutcome
}

/**
 * How many verifications run at once.
 *
 * These are public Sepolia RPCs, which rate-limit; firing a 200-member cohort
 * in parallel is the reliable way to turn a healthy cohort into a wall of
 * "couldn't check". Four keeps a 200-row run to roughly 50 sequential rounds
 * while staying well inside what the endpoints tolerate. Each individual read
 * still has readClient's own 10s timeout and RPC fallback chain beneath it, so
 * one bad endpoint doesn't stall the pool.
 */
export const VERIFY_CONCURRENCY = 4

export interface VerifyRunOptions {
  concurrency?: number
  /** Called after each row settles, for live progress. */
  onProgress?: (completed: number, total: number) => void
  /** Called as each row settles, so the table can fill in incrementally. */
  onResult?: (result: MemberResult) => void
}

/**
 * Verify every member, a few at a time. Results come back in input order
 * regardless of completion order.
 *
 * A rejected read never propagates: it becomes an `unchecked` outcome for that
 * row only, so one flaky read can't fail the run or mislabel a certificate.
 */
export async function verifyMembers(
  members: BatchCertificateInput[],
  options: VerifyRunOptions = {},
): Promise<MemberResult[]> {
  const { concurrency = VERIFY_CONCURRENCY, onProgress, onResult } = options
  const results: MemberResult[] = new Array<MemberResult>(members.length)
  let cursor = 0
  let completed = 0

  async function worker() {
    for (;;) {
      const index = cursor++
      if (index >= members.length) return
      const member = members[index]

      let outcome: MemberOutcome
      try {
        // 3b's per-member verification, untouched.
        const result = await verifyBatchCertificate(member)
        outcome = { kind: 'verdict', status: result.status }
      } catch (err) {
        outcome = {
          kind: 'unchecked',
          message: err instanceof Error ? err.message : 'The check could not be completed.',
        }
      }

      const settled: MemberResult = { index, member, outcome }
      results[index] = settled
      completed++
      onResult?.(settled)
      onProgress?.(completed, members.length)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, members.length) }, worker),
  )
  return results
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

export interface BulkSummary {
  total: number
  valid: number
  expired: number
  revoked: number
  notFound: number
  /** Rows the chain answered for, but not with VALID. */
  failedVerdict: number
  /** Rows we could not reach the chain for — NOT a verdict. */
  unchecked: number
}

export function summarize(results: MemberResult[]): BulkSummary {
  const summary: BulkSummary = {
    total: results.length,
    valid: 0,
    expired: 0,
    revoked: 0,
    notFound: 0,
    failedVerdict: 0,
    unchecked: 0,
  }

  for (const result of results) {
    if (!result) continue
    if (result.outcome.kind === 'unchecked') {
      summary.unchecked++
      continue
    }
    switch (result.outcome.status) {
      case 'VALID':
        summary.valid++
        break
      case 'EXPIRED':
        summary.expired++
        summary.failedVerdict++
        break
      case 'REVOKED':
        summary.revoked++
        summary.failedVerdict++
        break
      case 'NOT_FOUND':
        summary.notFound++
        summary.failedVerdict++
        break
    }
  }
  return summary
}

/** The label used in the results table and the downloadable report. */
export function outcomeLabel(outcome: MemberOutcome): string {
  return outcome.kind === 'unchecked' ? 'COULD_NOT_CHECK' : outcome.status
}

/* ------------------------------------------------------------------ */
/* Downloadable report                                                 */
/* ------------------------------------------------------------------ */

export interface ReportMeta {
  checkedAt: Date
  contractAddress: string
  chainId: number
}

/**
 * A saveable record of the check for the registrar's own files.
 *
 * Every row repeats the when/where (timestamp, contract, chain, root) so a
 * single line is self-describing once it's been pasted into a spreadsheet or
 * an email, and "COULD_NOT_CHECK" appears in the same `result` column as the
 * verdicts — never blank, never silently dropped, so a partial run can't be
 * mistaken for a clean one.
 */
export function buildVerificationReportCsv(
  results: MemberResult[],
  meta: ReportMeta,
): string {
  const checkedAt = meta.checkedAt.toISOString()
  const table = results
    .filter(Boolean)
    .map((result) => ({
      checkedAt,
      recipientName: result.member.recipientName,
      courseTitle: result.member.courseTitle,
      expiresAt:
        result.member.expiresAt === 0
          ? ''
          : new Date(result.member.expiresAt * 1000).toISOString().slice(0, 10),
      certHash: result.member.certHash,
      root: result.member.root,
      result: outcomeLabel(result.outcome),
      detail: result.outcome.kind === 'unchecked' ? result.outcome.message : '',
      contractAddress: meta.contractAddress,
      chainId: meta.chainId,
    }))
  return Papa.unparse(table)
}

/** Filename for the downloaded report, stamped so repeat runs don't collide. */
export function reportFileName(root: string, checkedAt: Date): string {
  const stamp = checkedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `verification-report-${root.slice(2, 10)}-${stamp}.csv`
}
