/// <reference types="vite/client" />

/**
 * Frontend build-time configuration. Only `VITE_`-prefixed variables are
 * exposed to the bundle by Vite — which is the safety property that matters
 * here: the Pinata JWT is deliberately NOT one of these. It lives in
 * backend/.env and is never readable from the browser.
 *
 * Both values below are optional; src/lib/backendClient.ts supplies local
 * development defaults.
 */
interface ImportMetaEnv {
  /** Base URL of the Phase-7 backend, e.g. http://localhost:4000 */
  readonly VITE_API_BASE_URL?: string
  /** Public IPFS read gateway, e.g. https://<subdomain>.mypinata.cloud/ipfs */
  readonly VITE_IPFS_GATEWAY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
