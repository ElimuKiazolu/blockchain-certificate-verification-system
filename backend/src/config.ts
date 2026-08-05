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
