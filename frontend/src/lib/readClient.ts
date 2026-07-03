// Wallet-free, read-only access to the CertificateRegistry for the public
// verifier. Uses an ethers v6 JsonRpcProvider against public Sepolia RPCs —
// deliberately NOT MetaMask/BrowserProvider — so anyone can verify a
// certificate with no wallet and no account (docs/03 A-series). Self-contained:
// this module imports nothing from the wallet code and never touches
// window.ethereum, keeping the verifier robust and independent (docs/07 §3).

import { Contract, JsonRpcProvider } from 'ethers'
import {
  CERTIFICATE_REGISTRY_ABI,
  CERTIFICATE_REGISTRY_ADDRESS,
  SEPOLIA_CHAIN_ID,
} from '../contract'

/**
 * Public Sepolia RPCs, tried in order: a primary + fallbacks (docs/07 R2).
 * All three were confirmed returning chainId 0xaa36a7. If every endpoint is
 * unreachable, verifyByHash throws — surfaced by the UI as "couldn't verify",
 * never as NOT_FOUND.
 */
const SEPOLIA_RPC_URLS = [
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://sepolia.drpc.org',
  'https://1rpc.io/sepolia',
] as const

const READ_TIMEOUT_MS = 10_000

/** Mirrors the on-chain enum in CertificateRegistry.sol (index = uint8 value). */
export type CertStatus = 'NOT_FOUND' | 'VALID' | 'EXPIRED' | 'REVOKED'
const CERT_STATUS_BY_INDEX: readonly CertStatus[] = [
  'NOT_FOUND', // 0
  'VALID', // 1
  'EXPIRED', // 2
  'REVOKED', // 3
]

export interface CertificateData {
  ipfsCID: string
  issuer: string
  issuedAt: number // unix seconds
  expiresAt: number // unix seconds, 0 = never expires
  recipientName: string
  courseTitle: string
}

export interface VerifyResult {
  status: CertStatus
  /** Present when the cert exists (VALID / EXPIRED / REVOKED); null for NOT_FOUND. */
  certificate: CertificateData | null
}

/** A certificate hash is bytes32: 0x followed by 64 hex characters. */
const CERT_HASH_RE = /^0x[0-9a-fA-F]{64}$/

export function isValidCertHash(input: string): boolean {
  return CERT_HASH_RE.test(input.trim())
}

/** Matches a bytes32 hash anywhere in a string (e.g. embedded in a URL). */
const CERT_HASH_ANYWHERE_RE = /0x[0-9a-fA-F]{64}/

/**
 * Resolve a QR payload to a certificate hash. The QR carries either the raw
 * hash or a verification URL containing it (docs/03 A1: "The QR is a
 * verification URL"). Tries, in order: (1) the whole payload is already a
 * valid hash, (2) a `hash` query param, (3) a bytes32-shaped substring
 * anywhere in the text (covers a path-embedded hash or any other shape).
 * Returns null when nothing hash-shaped is found — the caller must treat that
 * as "malformed QR," never as NOT_FOUND (a malformed payload was never
 * checked on-chain at all).
 */
export function extractCertHash(payload: string): string | null {
  const trimmed = payload.trim()
  if (isValidCertHash(trimmed)) return trimmed

  try {
    const url = new URL(trimmed)
    const param = url.searchParams.get('hash')
    if (param && isValidCertHash(param)) return param
  } catch {
    // Not a URL — fall through to the substring search below.
  }

  const match = trimmed.match(CERT_HASH_ANYWHERE_RE)
  return match ? match[0] : null
}

/** Reject if the underlying read hasn't settled within `ms` (docs/07 R2). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('The request timed out.'))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      },
    )
  })
}

// One provider+contract per RPC URL; the network is fixed (Sepolia), so we
// mark it static to skip chain-id auto-detection round-trips.
const contractCache = new Map<string, Contract>()

function getContract(rpcUrl: string): Contract {
  let contract = contractCache.get(rpcUrl)
  if (!contract) {
    const provider = new JsonRpcProvider(rpcUrl, SEPOLIA_CHAIN_ID, {
      staticNetwork: true,
    })
    contract = new Contract(
      CERTIFICATE_REGISTRY_ADDRESS,
      CERTIFICATE_REGISTRY_ABI,
      provider,
    )
    contractCache.set(rpcUrl, contract)
  }
  return contract
}

type RawVerifyResult = [
  bigint,
  [string, string, bigint, bigint, string, string],
]

function parse(raw: RawVerifyResult): VerifyResult {
  const status = CERT_STATUS_BY_INDEX[Number(raw[0])] ?? 'NOT_FOUND'
  if (status === 'NOT_FOUND') return { status, certificate: null }
  const cert = raw[1]
  return {
    status,
    certificate: {
      ipfsCID: cert[0],
      issuer: cert[1],
      issuedAt: Number(cert[2]),
      expiresAt: Number(cert[3]),
      recipientName: cert[4],
      courseTitle: cert[5],
    },
  }
}

/**
 * Verify a certificate by its on-chain hash. Tries each RPC in turn; a genuine
 * on-chain NOT_FOUND is a *result* (the contract's view never reverts), while
 * an unreachable/slow chain throws after all fallbacks fail — which the UI must
 * render as "couldn't verify", NOT as NOT_FOUND (docs/07 §3).
 */
export async function verifyByHash(certHash: string): Promise<VerifyResult> {
  const hash = certHash.trim()
  let lastError: Error = new Error('No Sepolia RPC endpoint was reachable.')
  for (const rpcUrl of SEPOLIA_RPC_URLS) {
    try {
      const contract = getContract(rpcUrl)
      const raw = (await withTimeout(
        contract.verifyCertificate(hash),
        READ_TIMEOUT_MS,
      )) as RawVerifyResult
      return parse(raw)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastError
}
