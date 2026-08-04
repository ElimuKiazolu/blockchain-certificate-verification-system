import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import type { ContractTransactionResponse } from 'ethers'
import { hashFile } from '../lib/fileHash'
import { getEthereum } from '../wallet/ethereum'
import {
  SEPOLIA_NETWORK,
  CERTIFICATE_REGISTRY_ADDRESS,
  SEPOLIA_CHAIN_ID,
} from '../contract'
import { shortenHash } from '../lib/format'
import {
  validateCohortRows,
  parseCohortCsv,
  SAMPLE_COHORT_CSV,
  type RawCohortFields,
  type RowIssue,
  type CohortParseResult,
} from '../lib/cohortValidation'
import { buildMerkleTree, attachProofs } from '../lib/merkle'
import {
  batchIssue,
  classifyIssueError,
  type IssueError,
} from '../lib/issuerWrite'
import {
  buildJsonBundle,
  buildCsvOutput,
  type BatchCertificateRecord,
} from '../lib/batchOutputs'
import { IssuedBatchCard } from './IssuedBatchCard'

/**
 * Merkle batch issuance — the project's distinguishing feature, in the UI
 * (Phase 6, Slice 3a). A whole cohort is committed as ONE on-chain root via
 * `batchIssue(merkleRoot)`; per-student proofs are computed in-browser and
 * distributed as downloads (never served by a backend — CLAUDE.md, docs/07
 * R8). The Merkle tree uses the FROZEN leaf encoding from src/lib/merkle.ts,
 * confirmed byte-identical to the contract via the Solidity test suite.
 *
 * Two input methods normalize into the same `CohortRow[]` (src/lib/
 * cohortValidation.ts): CSV upload (scalable) and an in-UI table (small
 * batches, optional per-row file hashing reusing fileHash.ts unchanged).
 *
 * The write itself reuses the exact 6-state machine from Slice 2's single
 * issuance (idle / awaiting-signature / pending / confirmed / rejected /
 * failed) via the same `classifyIssueError`.
 */

type Mode = 'csv' | 'table'

interface DraftRow {
  id: string
  recipientName: string
  courseTitle: string
  expiryDate: string
  certHash: string
  ipfsCID: string
  fileName?: string
  fileHashing?: boolean
  fileError?: string
}

function emptyDraftRow(): DraftRow {
  return {
    id: crypto.randomUUID(),
    recipientName: '',
    courseTitle: '',
    expiryDate: '',
    certHash: '',
    ipfsCID: '',
  }
}

function hasAnyContent(row: DraftRow): boolean {
  return Boolean(
    row.recipientName.trim() ||
      row.courseTitle.trim() ||
      row.certHash.trim() ||
      row.ipfsCID.trim() ||
      row.expiryDate.trim(),
  )
}

function toRawFields(row: DraftRow): RawCohortFields {
  return {
    recipientName: row.recipientName,
    courseTitle: row.courseTitle,
    expiresAt: row.expiryDate,
    certHash: row.certHash,
    ipfsCID: row.ipfsCID,
  }
}

type IssueState =
  | { status: 'idle' }
  | { status: 'awaiting-signature' }
  | { status: 'pending'; txHash: string }
  | {
      status: 'confirmed'
      txHash: string
      root: string
      records: BatchCertificateRecord[]
    }
  | { status: 'rejected' }
  | { status: 'failed'; message: string }

export function BatchIssueForm() {
  const [mode, setMode] = useState<Mode>('csv')
  const [csvText, setCsvText] = useState('')
  const [csvFileName, setCsvFileName] = useState<string | null>(null)
  const [tableRows, setTableRows] = useState<DraftRow[]>([emptyDraftRow()])
  const [issueState, setIssueState] = useState<IssueState>({ status: 'idle' })
  const csvFileInputRef = useRef<HTMLInputElement>(null)

  const isBusy =
    issueState.status === 'awaiting-signature' ||
    issueState.status === 'pending'

  const cohortResult: CohortParseResult = useMemo(() => {
    if (mode === 'csv') {
      if (!csvText.trim()) return { validRows: [], issues: [], totalRows: 0 }
      return parseCohortCsv(csvText)
    }
    const rawRows = tableRows
      .map((row, i) => ({ rowNumber: i + 1, fields: toRawFields(row) }))
      .filter((_, i) => hasAnyContent(tableRows[i]))
    return validateCohortRows(rawRows)
  }, [mode, csvText, tableRows])

  const tree = useMemo(() => {
    if (cohortResult.validRows.length === 0) return null
    return buildMerkleTree(cohortResult.validRows.map((e) => e.data))
  }, [cohortResult.validRows])

  const issuesByRow = useMemo(() => {
    const map = new Map<number, RowIssue[]>()
    for (const issue of cohortResult.issues) {
      const existing = map.get(issue.row) ?? []
      existing.push(issue)
      map.set(issue.row, existing)
    }
    return map
  }, [cohortResult.issues])

  function switchMode(next: Mode) {
    if (mode === next) return
    setMode(next)
    setIssueState({ status: 'idle' })
  }

  async function onCsvFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const text = await file.text()
    setCsvText(text)
    setCsvFileName(file.name)
  }

  function updateRow(id: string, patch: Partial<DraftRow>) {
    setTableRows((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    )
  }

  function addRow() {
    setTableRows((rows) => [...rows, emptyDraftRow()])
  }

  function removeRow(id: string) {
    setTableRows((rows) =>
      rows.length > 1 ? rows.filter((row) => row.id !== id) : rows,
    )
  }

  async function attachFileToRow(id: string, file: File) {
    updateRow(id, { fileHashing: true, fileError: undefined })
    try {
      const hash = await hashFile(file)
      updateRow(id, { certHash: hash, fileName: file.name, fileHashing: false })
    } catch (err) {
      updateRow(id, {
        fileHashing: false,
        fileError:
          err instanceof Error ? err.message : 'Could not hash this file.',
      })
    }
  }

  function resetAll() {
    setCsvText('')
    setCsvFileName(null)
    setTableRows([emptyDraftRow()])
    setIssueState({ status: 'idle' })
  }

  function applyIssueError(err: unknown) {
    const classified: IssueError = classifyIssueError(err)
    if (classified.kind === 'rejected') {
      setIssueState({ status: 'rejected' })
    } else {
      setIssueState({ status: 'failed', message: classified.message })
    }
  }

  async function onIssueBatch() {
    if (!tree || cohortResult.validRows.length === 0) return
    if (cohortResult.issues.length > 0) return

    const eth = getEthereum()
    if (!eth) {
      setIssueState({
        status: 'failed',
        message: 'MetaMask provider unavailable.',
      })
      return
    }

    setIssueState({ status: 'awaiting-signature' })
    let tx: ContractTransactionResponse
    try {
      tx = await batchIssue(eth, tree.root)
    } catch (err) {
      applyIssueError(err)
      return
    }

    setIssueState({ status: 'pending', txHash: tx.hash })
    try {
      await tx.wait()
      const rows = cohortResult.validRows.map((e) => e.data)
      const proven = attachProofs(rows, tree)
      const records = buildJsonBundle(
        proven,
        tree.root,
        CERTIFICATE_REGISTRY_ADDRESS,
        SEPOLIA_CHAIN_ID,
      )
      setIssueState({
        status: 'confirmed',
        txHash: tx.hash,
        root: tree.root,
        records,
      })
    } catch (err) {
      applyIssueError(err)
    }
  }

  if (issueState.status === 'confirmed') {
    const records = issueState.records
    return (
      <IssuedBatchCard
        txHash={issueState.txHash}
        root={issueState.root}
        records={records}
        jsonBundle={JSON.stringify(records, null, 2)}
        csvOutput={buildCsvOutput(records)}
        onIssueAnother={resetAll}
      />
    )
  }

  const canIssue =
    tree !== null && cohortResult.validRows.length > 0 && cohortResult.issues.length === 0

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="font-serif text-xl font-semibold text-brand-900">
        Batch-issue a cohort (Merkle)
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
        Commit a whole cohort as <strong>one</strong> on-chain root. This
        writes to the {SEPOLIA_NETWORK.name} registry once, regardless of
        cohort size — the single MetaMask signature covers every certificate
        below.
      </p>

      {issueState.status === 'pending' && (
        <PendingBanner txHash={issueState.txHash} />
      )}
      {issueState.status === 'rejected' && (
        <RejectedBanner onDismiss={() => setIssueState({ status: 'idle' })} />
      )}
      {issueState.status === 'failed' && (
        <FailedBanner
          message={issueState.message}
          onDismiss={() => setIssueState({ status: 'idle' })}
        />
      )}

      <div className="mt-5 inline-flex rounded-lg border border-slate-300 bg-slate-50 p-1 text-sm">
        <ModeButton active={mode === 'csv'} onClick={() => switchMode('csv')} disabled={isBusy}>
          CSV upload
        </ModeButton>
        <ModeButton active={mode === 'table'} onClick={() => switchMode('table')} disabled={isBusy}>
          In-UI table
        </ModeButton>
      </div>

      <fieldset disabled={isBusy} className="mt-5 space-y-5 disabled:opacity-60">
        {mode === 'csv' ? (
          <CsvPanel
            csvText={csvText}
            csvFileName={csvFileName}
            fileInputRef={csvFileInputRef}
            onFileChange={(e) => void onCsvFileChange(e)}
            onLoadSample={() => {
              setCsvText(SAMPLE_COHORT_CSV)
              setCsvFileName('sample-cohort.csv')
            }}
            onTextChange={(text) => {
              setCsvText(text)
              setCsvFileName(null)
            }}
          />
        ) : (
          <TablePanel
            rows={tableRows}
            issuesByRow={issuesByRow}
            onUpdateRow={updateRow}
            onAddRow={addRow}
            onRemoveRow={removeRow}
            onAttachFile={(id, file) => void attachFileToRow(id, file)}
          />
        )}

        <ValidationSummary result={cohortResult} />

        {tree && (
          <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
            <p className="font-mono text-[0.7rem] font-medium uppercase tracking-wide text-brand-700">
              Computed Merkle root
            </p>
            <p className="mt-1 font-mono text-sm text-brand-900" title={tree.root}>
              {tree.root}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => void onIssueBatch()}
          disabled={!canIssue || isBusy}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {issueState.status === 'awaiting-signature' && <Spinner light />}
          {issueState.status === 'awaiting-signature'
            ? 'Confirm in your wallet…'
            : issueState.status === 'pending'
              ? 'Waiting for confirmation…'
              : `Issue batch${cohortResult.validRows.length ? ` (${cohortResult.validRows.length})` : ''}`}
        </button>
      </fieldset>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* CSV panel                                                           */
/* ------------------------------------------------------------------ */

function CsvPanel({
  csvText,
  csvFileName,
  fileInputRef,
  onFileChange,
  onLoadSample,
  onTextChange,
}: {
  csvText: string
  csvFileName: string | null
  fileInputRef: RefObject<HTMLInputElement | null>
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onLoadSample: () => void
  onTextChange: (text: string) => void
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:bg-slate-50"
        >
          Choose CSV file
        </button>
        <button
          type="button"
          onClick={onLoadSample}
          className="text-sm font-medium text-brand-600 hover:underline"
        >
          Load sample CSV
        </button>
        {csvFileName && (
          <span className="text-sm text-slate-500">{csvFileName}</span>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={onFileChange}
        className="sr-only"
        aria-label="Cohort CSV file"
      />
      <label className="mt-3 block">
        <span className="text-sm font-semibold text-slate-800">
          Or paste CSV text
        </span>
        <textarea
          value={csvText}
          onChange={(e) => onTextChange(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder={'recipientName,courseTitle,expiresAt,certHash,ipfsCID\n...'}
          className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-xs text-slate-900 shadow-sm outline-none transition-colors focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
        />
        <span className="mt-1 block text-xs text-slate-400">
          Columns: recipientName, courseTitle, expiresAt (YYYY-MM-DD or blank
          = never), certHash (0x + 64 hex), ipfsCID (optional).
        </span>
      </label>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Table panel                                                         */
/* ------------------------------------------------------------------ */

function TablePanel({
  rows,
  issuesByRow,
  onUpdateRow,
  onAddRow,
  onRemoveRow,
  onAttachFile,
}: {
  rows: DraftRow[]
  issuesByRow: Map<number, RowIssue[]>
  onUpdateRow: (id: string, patch: Partial<DraftRow>) => void
  onAddRow: () => void
  onRemoveRow: (id: string) => void
  onAttachFile: (id: string, file: File) => void
}) {
  return (
    <div className="space-y-3">
      {rows.map((row, index) => {
        const rowIssues = issuesByRow.get(index + 1) ?? []
        return (
          <div
            key={row.id}
            className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={row.recipientName}
                onChange={(e) =>
                  onUpdateRow(row.id, { recipientName: e.target.value })
                }
                placeholder="Recipient name"
                className={cellInputClass()}
              />
              <input
                value={row.courseTitle}
                onChange={(e) =>
                  onUpdateRow(row.id, { courseTitle: e.target.value })
                }
                placeholder="Course / title"
                className={cellInputClass()}
              />
              <input
                type="date"
                value={row.expiryDate}
                onChange={(e) =>
                  onUpdateRow(row.id, { expiryDate: e.target.value })
                }
                className={cellInputClass()}
              />
              <input
                value={row.ipfsCID}
                onChange={(e) => onUpdateRow(row.id, { ipfsCID: e.target.value })}
                placeholder="IPFS CID (optional)"
                spellCheck={false}
                className={`${cellInputClass()} font-mono`}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={row.certHash}
                onChange={(e) =>
                  onUpdateRow(row.id, { certHash: e.target.value })
                }
                placeholder="0x… certificate hash"
                spellCheck={false}
                className={`${cellInputClass()} flex-1 font-mono text-xs`}
              />
              <FileAttachButton
                row={row}
                onAttach={(file) => onAttachFile(row.id, file)}
              />
              <button
                type="button"
                onClick={() => onRemoveRow(row.id)}
                className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Remove
              </button>
            </div>
            {row.fileError && (
              <p className="mt-1.5 text-xs text-red-600">{row.fileError}</p>
            )}
            {rowIssues.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-red-600">
                {rowIssues.map((issue, i) => (
                  <li key={i}>{issue.message}</li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
      <button
        type="button"
        onClick={onAddRow}
        className="inline-flex min-h-11 items-center rounded-lg border border-dashed border-slate-300 bg-white px-4 py-2 text-sm font-medium text-brand-700 hover:bg-slate-50"
      >
        + Add row
      </button>
    </div>
  )
}

function FileAttachButton({
  row,
  onAttach,
}: {
  row: DraftRow
  onAttach: (file: File) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-brand-700 hover:bg-slate-50"
      >
        {row.fileHashing
          ? 'Hashing…'
          : row.fileName
            ? `File: ${row.fileName}`
            : 'Attach file'}
      </button>
      <input
        ref={ref}
        type="file"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onAttach(file)
        }}
        className="sr-only"
        aria-label={`Attach file for row`}
      />
    </>
  )
}

function cellInputClass() {
  return 'block w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100'
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function ValidationSummary({ result }: { result: CohortParseResult }) {
  if (result.totalRows === 0) return null
  const invalidCount = result.totalRows - result.validRows.length
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-sm font-medium text-slate-800">
        {result.validRows.length} valid · {invalidCount} invalid ·{' '}
        {result.totalRows} total row{result.totalRows === 1 ? '' : 's'}
      </p>
      {result.issues.length > 0 && (
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-red-600">
          {result.issues.map((issue, i) => (
            <li key={i}>
              Row {issue.row}: {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ModeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        active
          ? 'bg-white text-brand-900 shadow-sm'
          : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  )
}

function PendingBanner({ txHash }: { txHash: string }) {
  const txUrl = `${SEPOLIA_NETWORK.blockExplorerUrl}/tx/${txHash}`
  return (
    <div className="mt-4 flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
      <Spinner />
      <div className="text-sm">
        <p className="font-medium text-brand-900">
          Waiting for {SEPOLIA_NETWORK.name} to confirm…
        </p>
        <p className="mt-0.5 text-brand-700">
          This usually takes 15–60 seconds. You can keep this page open.
        </p>
        <a
          href={txUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block font-mono text-xs text-brand-600 hover:underline"
        >
          {shortenHash(txHash)} — view on Etherscan ↗
        </a>
      </div>
    </div>
  )
}

function RejectedBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <div>
        <p className="font-medium">Request declined</p>
        <p className="mt-0.5">
          You closed or rejected the wallet prompt — nothing was sent. Your
          cohort is still here; submit again when ready.
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 font-medium text-amber-700 hover:text-amber-900"
      >
        Dismiss
      </button>
    </div>
  )
}

function FailedBanner({
  message,
  onDismiss,
}: {
  message: string
  onDismiss: () => void
}) {
  return (
    <div className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <div>
        <p className="font-medium">Couldn&apos;t issue this batch</p>
        <p className="mt-0.5">{message}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 font-medium text-red-700 hover:text-red-900"
      >
        Dismiss
      </button>
    </div>
  )
}

function Spinner({ light }: { light?: boolean }) {
  const border = light
    ? 'border-white/30 border-t-white'
    : 'border-brand-200 border-t-brand-600'
  return (
    <span
      className={`inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 ${border}`}
      aria-hidden="true"
    />
  )
}
