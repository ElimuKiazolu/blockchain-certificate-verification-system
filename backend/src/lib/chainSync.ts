// Rebuild the certificate index from the chain.
//
// THIS IS THE MECHANISM THAT MAKES THE DATABASE DISPOSABLE. Drop the
// collection and run a sync: every row comes back, because every row is
// derived from on-chain events plus contract state. Nothing in Mongo
// originates off-chain, so nothing can be lost by losing Mongo (docs/05).
//
// On-demand rather than a persistent listener (a websocket subscription would
// add a always-on process that silently misses events whenever it's down, and
// would still need this backfill to recover). A re-runnable backfill is both
// simpler and strictly more honest about what it guarantees.
//
// ── WHY EVENTS ALONE AREN'T ENOUGH ────────────────────────────────────────
// Confirmed from the ABI, the events are LEANER than the records we index:
//   CertificateIssued(indexed bytes32 certHash, indexed address issuer,
//                     string ipfsCID, uint64 issuedAt)
//   CertificateRevoked(indexed bytes32 certHash, indexed address revokedBy,
//                      uint64 revokedAt)
//   BatchIssued(indexed bytes32 merkleRoot, indexed address issuer,
//               uint64 issuedAt)
// None of them carries recipientName, courseTitle or expiresAt. Those live in
// contract STATE, so each issuance event is followed by a read of the public
// `certificates(bytes32)` getter. Still entirely chain-derived — just events
// for discovery and state for detail.

import { readFileSync } from 'node:fs'
import { Contract, JsonRpcProvider, type EventLog } from 'ethers'
import { config } from '../config.js'
import { getCertificates, type CertificateDoc } from '../db/mongo.js'

interface ContractExport {
  address: string
  abi: unknown[]
  chainId?: number
}

let cachedExport: ContractExport | null = null

/** ABI + address from the Hardhat export — the single integration boundary. */
function loadContractExport(): ContractExport {
  if (cachedExport) return cachedExport
  const raw = readFileSync(config.contractExportPath, 'utf8')
  const parsed = JSON.parse(raw) as ContractExport
  if (!parsed.address || !Array.isArray(parsed.abi)) {
    throw new Error(
      `Contract export at ${config.contractExportPath} has no address/abi. Run "npm run export-abi" in blockchain/.`,
    )
  }
  cachedExport = parsed
  return parsed
}

export interface SyncResult {
  fromBlock: number
  toBlock: number
  chunks: number
  singleIssued: number
  batchIssued: number
  revocations: number
  /** Revocations whose certHash isn't an indexed row — batch members (see below). */
  revocationsUnmatched: number
  upserted: number
  durationMs: number
}

export class SyncError extends Error {
  readonly status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = 'SyncError'
    this.status = status
  }
}

/** First RPC that answers. One endpoint is used for the whole run. */
async function pickProvider(): Promise<JsonRpcProvider> {
  const { chainId } = loadContractExport()
  let lastError = 'no RPC endpoints configured'
  for (const url of config.rpcUrls) {
    try {
      const provider = new JsonRpcProvider(url, chainId, { staticNetwork: true })
      await provider.getBlockNumber()
      return provider
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }
  throw new SyncError(
    `Could not reach any Sepolia RPC endpoint, so the index can't be rebuilt right now (${lastError}). The chain is still the source of truth — verification is unaffected.`,
    503,
  )
}

/**
 * queryFilter across a large range, in chunks, with retries.
 *
 * Necessary, not defensive: public RPCs cap eth_getLogs ranges and disagree on
 * the cap (publicnode 50k, drpc 10k free, 1rpc 50), and 45k-block requests were
 * observed timing out even where accepted. Chunks are configurable via
 * LOG_CHUNK_SIZE; the default of 10k was the largest that proved reliable.
 */
async function queryInChunks(
  contract: Contract,
  eventName: string,
  fromBlock: number,
  toBlock: number,
): Promise<EventLog[]> {
  const found: EventLog[] = []
  const size = config.logChunkSize

  for (let start = fromBlock; start <= toBlock; start += size) {
    const end = Math.min(start + size - 1, toBlock)
    let attempt = 0
    for (;;) {
      try {
        const logs = await contract.queryFilter(eventName, start, end)
        found.push(...(logs.filter((l) => 'args' in l) as EventLog[]))
        break
      } catch (err) {
        attempt++
        if (attempt >= 3) {
          throw new SyncError(
            `Reading ${eventName} events for blocks ${start}-${end} failed after ${attempt} attempts: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
        await new Promise((r) => setTimeout(r, 600 * attempt))
      }
    }
  }
  return found
}

/** uint64 seconds -> Date, with 0 meaning "never expires". */
function toDate(seconds: bigint | number): Date {
  return new Date(Number(seconds) * 1000)
}

/**
 * Replay the chain into the index.
 *
 * Idempotent: every write is an upsert keyed by `certHash`, so running this
 * twice produces the same collection as running it once. That is what makes it
 * safe to call after every issuance as well as for a full rebuild.
 */
export async function syncFromChain(): Promise<SyncResult> {
  const startedAt = Date.now()
  const collection = await getCertificates()
  if (!collection) {
    throw new SyncError(
      'The certificate index is not available, so it cannot be rebuilt. This does not affect issuing or verifying — both use the chain directly.',
      503,
    )
  }

  const { address, abi } = loadContractExport()
  const provider = await pickProvider()
  const contract = new Contract(address, abi as never, provider)

  const toBlock = await provider.getBlockNumber()
  const fromBlock = config.deployBlock
  const chunks = Math.ceil((toBlock - fromBlock + 1) / config.logChunkSize)

  const [issuedLogs, batchLogs, revokedLogs] = await Promise.all([
    queryInChunks(contract, 'CertificateIssued', fromBlock, toBlock),
    queryInChunks(contract, 'BatchIssued', fromBlock, toBlock),
    queryInChunks(contract, 'CertificateRevoked', fromBlock, toBlock),
  ])

  let upserted = 0

  // ── Single certificates: event for discovery, state for the detail the
  //    event doesn't carry (recipientName / courseTitle / expiresAt).
  for (const log of issuedLogs) {
    const certHash = log.args[0] as string
    const issuer = log.args[1] as string
    const ipfsCID = log.args[2] as string
    const issuedAt = log.args[3] as bigint

    // `getFunction` rather than dynamic property access: ethers types the
    // latter loosely, and this keeps the call checked under strict mode.
    const record = (await contract.getFunction('certificates')(certHash)) as [
      string,
      string,
      bigint,
      bigint,
      string,
      string,
    ]
    const expiresAtRaw = record[3]

    const doc: Omit<CertificateDoc, 'revoked' | 'revokedAt' | 'revokedBy'> = {
      certHash,
      type: 'single',
      issuerAddress: issuer.toLowerCase(),
      ipfsCID: ipfsCID || null,
      recipientName: record[4] || null,
      courseTitle: record[5] || null,
      issuedAt: toDate(issuedAt),
      expiresAt: expiresAtRaw === 0n ? null : toDate(expiresAtRaw),
      merkleRoot: null,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      syncedAt: new Date(),
    }

    await collection.updateOne(
      { certHash },
      {
        $set: doc,
        // Only initialise revocation on insert — a later revocation pass must
        // not be undone by re-running the issuance pass.
        $setOnInsert: { revoked: false, revokedAt: null, revokedBy: null },
      },
      { upsert: true },
    )
    upserted++
  }

  // ── Batch roots. Individual members are deliberately NOT indexed: they do
  //    not exist on-chain (only the root does), their data lives in Merkle
  //    leaves held by the students, and inventing rows for them would be the
  //    index claiming knowledge the chain doesn't have. The root is keyed as
  //    its own certHash so one collection and one unique key cover both kinds.
  for (const log of batchLogs) {
    const merkleRoot = log.args[0] as string
    const issuer = log.args[1] as string
    const issuedAt = log.args[2] as bigint

    await collection.updateOne(
      { certHash: merkleRoot },
      {
        $set: {
          certHash: merkleRoot,
          type: 'batch' as const,
          issuerAddress: issuer.toLowerCase(),
          ipfsCID: null,
          recipientName: null,
          courseTitle: null,
          issuedAt: toDate(issuedAt),
          expiresAt: null,
          merkleRoot,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          syncedAt: new Date(),
        },
        $setOnInsert: { revoked: false, revokedAt: null, revokedBy: null },
      },
      { upsert: true },
    )
    upserted++
  }

  // ── Revocations, applied last so they win over the issuance pass.
  let revocationsUnmatched = 0
  for (const log of revokedLogs) {
    const certHash = log.args[0] as string
    const revokedBy = log.args[1] as string
    const revokedAt = log.args[2] as bigint

    const result = await collection.updateOne(
      { certHash },
      {
        $set: {
          revoked: true,
          revokedAt: toDate(revokedAt),
          revokedBy: revokedBy.toLowerCase(),
          syncedAt: new Date(),
        },
      },
    )
    // A revoked BATCH MEMBER has no indexed row (see above) — expected, not an
    // error. Counted so the number is visible rather than silently swallowed.
    if (result.matchedCount === 0) revocationsUnmatched++
  }

  return {
    fromBlock,
    toBlock,
    chunks,
    singleIssued: issuedLogs.length,
    batchIssued: batchLogs.length,
    revocations: revokedLogs.length,
    revocationsUnmatched,
    upserted,
    durationMs: Date.now() - startedAt,
  }
}
