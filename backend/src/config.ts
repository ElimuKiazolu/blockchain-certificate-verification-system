// Backend configuration, loaded once at startup from backend/.env.
//
// Node 20.6+ can load a .env file natively (`process.loadEnvFile`), so there is
// no dotenv dependency here — the same approach hardhat.config.ts already uses
// in blockchain/. A missing .env is not fatal: the process may be configured
// through real environment variables instead (and `npm run dev` before Elimu
// creates his .env should still start, see `isPinataConfigured`).

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ENV_PATH = resolve(process.cwd(), '.env')
if (existsSync(ENV_PATH)) {
  process.loadEnvFile(ENV_PATH)
}

function env(name: string, fallback: string): string {
  const value = process.env[name]
  return value === undefined || value.trim() === '' ? fallback : value.trim()
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  const parsed = Number(raw)
  return raw !== undefined && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : fallback
}

export const config = {
  port: positiveInt('PORT', 4000),

  /**
   * SECRET. Read here and used only to build the Authorization header for
   * Pinata. It is never returned in a response, never logged, and never
   * reaches the browser — that separation is the whole reason this backend
   * exists (CLAUDE.md: "IPFS uploads happen server-side only").
   */
  pinataJwt: env('PINATA_JWT', ''),

  /** Public read gateway. Not a secret — the frontend builds links from it. */
  pinataGateway: env(
    'PINATA_GATEWAY',
    'https://aquamarine-wooden-flamingo-507.mypinata.cloud/ipfs',
  ).replace(/\/+$/, ''),

  corsOrigins: env('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  maxUploadBytes: positiveInt('MAX_UPLOAD_MB', 10) * 1024 * 1024,

  /**
   * SECRET. MongoDB Atlas connection string — server-side only, never logged
   * and never sent to the browser. The index it points at is a CACHE: the
   * chain is authoritative and the whole database is rebuildable from events
   * (see lib/chainSync.ts).
   */
  mongoUri: env('MONGODB_URI', ''),
  mongoDbName: env('MONGODB_DB', 'certificate_registry'),

  /**
   * Where the ABI + deployed address come from. Read at RUNTIME from the
   * Hardhat export rather than copied into this package, so the contract
   * boundary stays single-sourced (CLAUDE.md architecture invariant).
   */
  contractExportPath: env(
    'CONTRACT_EXPORT_PATH',
    resolve(process.cwd(), '../blockchain/exports/CertificateRegistry.json'),
  ),

  /** RPCs used for event scanning, tried in order. */
  rpcUrls: env(
    'SEPOLIA_RPC_URLS',
    'https://ethereum-sepolia-rpc.publicnode.com,https://sepolia.drpc.org',
  )
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean),

  /**
   * First block to scan. The registry's earliest on-chain activity is block
   * 11222253 (found by scanning logs backwards); starting slightly below that
   * costs nothing and tolerates a redeploy to an earlier block.
   */
  deployBlock: positiveInt('REGISTRY_DEPLOY_BLOCK', 11_222_000),

  /**
   * Blocks per eth_getLogs call. Public RPCs cap this and differ wildly —
   * publicnode allows 50k, drpc 10k on the free plan, 1rpc only 50 — and 45k
   * requests were observed timing out even when accepted. 10k is the largest
   * size that proved reliable here.
   */
  logChunkSize: positiveInt('LOG_CHUNK_SIZE', 10_000),
} as const

/**
 * Whether pinning can actually work. Kept separate from a hard startup crash
 * on purpose: an unconfigured backend still starts and still answers
 * /api/health, so the frontend gets an explicit, explained 503 instead of a
 * bare connection-refused — which is far easier to diagnose (docs/07 §2:
 * handled errors over dead ends).
 */
export function isPinataConfigured(): boolean {
  return config.pinataJwt.length > 0
}

/**
 * Whether the index is available. Same philosophy as {@link isPinataConfigured}:
 * an unconfigured database must not stop the server. The index is a
 * convenience layer — verification never touches it — so its absence disables
 * two endpoints and nothing else.
 */
export function isMongoConfigured(): boolean {
  return config.mongoUri.length > 0
}
