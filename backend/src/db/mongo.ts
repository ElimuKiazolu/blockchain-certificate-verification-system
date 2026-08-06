// MongoDB connection + the certificate index's shape.
//
// ── WHAT THIS DATABASE IS ─────────────────────────────────────────────────
// A CACHE. Every document here is derived from on-chain events and contract
// state, and the whole collection can be dropped and rebuilt by replaying the
// chain (lib/chainSync.ts). Nothing is authoritative, nothing originates here,
// and no verification path reads it — the public verifier talks to the chain
// directly and keeps working with this database offline (CLAUDE.md; docs/05).
//
// If the index and the chain ever disagree, the chain is right by definition.
// That is why every list row the UI renders carries the certHash, so a viewer
// can always re-verify against the chain rather than trusting this copy.

import { MongoClient, type Collection, type Db } from 'mongodb'
import { config, isMongoConfigured } from '../config.js'

/** One indexed certificate. Mirrors docs/05 `certificates`, trimmed to what the chain actually provides. */
export interface CertificateDoc {
  /** bytes32 hash — the on-chain identity, and this collection's unique key. */
  certHash: string
  /** 'single' = its own on-chain record; 'batch' = a Merkle root commitment. */
  type: 'single' | 'batch'
  issuerAddress: string
  ipfsCID: string | null
  recipientName: string | null
  courseTitle: string | null
  issuedAt: Date
  expiresAt: Date | null
  revoked: boolean
  revokedAt: Date | null
  revokedBy: string | null
  /** Set for `batch` rows: the Merkle root committed on-chain. */
  merkleRoot: string | null
  txHash: string
  blockNumber: number
  /** When this row was last refreshed from the chain — cache metadata, not truth. */
  syncedAt: Date
}

let client: MongoClient | null = null
let db: Db | null = null

/**
 * Connect lazily and reuse. Returns null when Mongo isn't configured OR can't
 * be reached — callers degrade rather than throw, so a dead database never
 * takes the server (or issuance, or verification) down with it.
 */
export async function getDb(): Promise<Db | null> {
  if (!isMongoConfigured()) return null
  if (db) return db

  try {
    client = new MongoClient(config.mongoUri, {
      serverSelectionTimeoutMS: 8_000,
    })
    await client.connect()
    db = client.db(config.mongoDbName)
    await ensureIndexes(db)
    console.log(`[mongo] connected to database "${config.mongoDbName}"`)
    return db
  } catch (err) {
    // Never log the URI — it contains credentials.
    console.error(
      '[mongo] connection failed:',
      err instanceof Error ? err.message : String(err),
    )
    client = null
    db = null
    return null
  }
}

export async function getCertificates(): Promise<Collection<CertificateDoc> | null> {
  const database = await getDb()
  return database ? database.collection<CertificateDoc>('certificates') : null
}

/**
 * Indexes matching how the API actually queries: unique on certHash (which is
 * what makes re-syncing idempotent), issuer for "my certificates", and a text
 * index for the recipient/course search.
 */
async function ensureIndexes(database: Db): Promise<void> {
  const certificates = database.collection<CertificateDoc>('certificates')
  await certificates.createIndex({ certHash: 1 }, { unique: true })
  await certificates.createIndex({ issuerAddress: 1, issuedAt: -1 })
  await certificates.createIndex({ recipientName: 'text', courseTitle: 'text' })
}

export async function closeMongo(): Promise<void> {
  await client?.close()
  client = null
  db = null
}
