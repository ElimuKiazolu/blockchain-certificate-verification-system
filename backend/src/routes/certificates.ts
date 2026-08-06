// The index's read + rebuild API.
//
//   GET  /api/certificates   list/search the cache
//   POST /api/index/sync     replay the chain into the cache
//
// Both are conveniences. Neither is on the verification path: the public
// verifier reads the chain directly and is unaffected if this database — or
// this whole server — is down (CLAUDE.md; docs/07 §3). Every response is
// labelled `source: 'index'` so a consumer can never mistake cached data for
// an authoritative on-chain answer.

import { Router, type Request, type Response } from 'express'
import { isMongoConfigured } from '../config.js'
import { getCertificates, type CertificateDoc } from '../db/mongo.js'
import { SyncError, syncFromChain } from '../lib/chainSync.js'

export const certificatesRouter: Router = Router()

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** 503 + explanation whenever the index isn't usable. Never a 500, never a crash. */
function indexUnavailable(res: Response): void {
  res.status(503).json({
    error: 'index_unavailable',
    message:
      'The certificate index is unavailable, so listing is temporarily off. Issuing and verifying are unaffected — both read the blockchain directly.',
  })
}

/**
 * GET /api/certificates
 *   ?issuer=0x…   only this issuer's certificates ("my certificates")
 *   ?q=…          match recipient, course, or certificate hash
 *   ?limit&skip   pagination
 */
certificatesRouter.get('/certificates', (req: Request, res: Response) => {
  void (async () => {
    if (!isMongoConfigured()) {
      indexUnavailable(res)
      return
    }
    const collection = await getCertificates()
    if (!collection) {
      indexUnavailable(res)
      return
    }

    const filter: Record<string, unknown> = {}

    const issuer = typeof req.query.issuer === 'string' ? req.query.issuer.trim() : ''
    if (issuer) filter.issuerAddress = issuer.toLowerCase()

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (q) {
      // Regex rather than $text so partial words work while typing; escaped so
      // a search box can never inject a pattern.
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const rx = new RegExp(safe, 'i')
      filter.$or = [{ recipientName: rx }, { courseTitle: rx }, { certHash: rx }]
    }

    const limit = Math.min(
      Number.parseInt(String(req.query.limit ?? ''), 10) || DEFAULT_LIMIT,
      MAX_LIMIT,
    )
    const skip = Math.max(Number.parseInt(String(req.query.skip ?? ''), 10) || 0, 0)

    try {
      const [items, total] = await Promise.all([
        collection
          .find(filter, { projection: { _id: 0 } })
          .sort({ issuedAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray(),
        collection.countDocuments(filter),
      ])
      res.json({
        source: 'index',
        total,
        limit,
        skip,
        items: items as CertificateDoc[],
      })
    } catch (err) {
      console.error('[index] query failed:', err instanceof Error ? err.message : err)
      indexUnavailable(res)
    }
  })()
})

/**
 * POST /api/index/sync — rebuild the index from on-chain events.
 *
 * Idempotent, so it is safe to call after every issuance as well as for a full
 * rebuild from an empty collection.
 */
certificatesRouter.post('/index/sync', (_req: Request, res: Response) => {
  void (async () => {
    if (!isMongoConfigured()) {
      indexUnavailable(res)
      return
    }
    try {
      const result = await syncFromChain()
      console.log(
        `[index] sync ${result.fromBlock}-${result.toBlock}: ${result.upserted} rows in ${result.durationMs}ms`,
      )
      res.json({ ok: true, ...result })
    } catch (err) {
      if (err instanceof SyncError) {
        console.error('[index] sync failed:', err.message)
        res.status(err.status).json({ error: 'sync_failed', message: err.message })
        return
      }
      console.error('[index] unexpected sync error:', err)
      res.status(500).json({
        error: 'unexpected',
        message:
          'The index could not be rebuilt because of an unexpected error. The chain is unaffected.',
      })
    }
  })()
})
