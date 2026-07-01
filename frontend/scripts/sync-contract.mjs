// Copies the deployed-contract artifact (ABI + address + chainId) from the
// blockchain package into the frontend so it can be imported as a module.
//
// blockchain/exports/CertificateRegistry.json is the SINGLE integration
// boundary between chain and frontend (see CLAUDE.md). We copy rather than
// import across the package boundary so the frontend stays a self-contained
// build unit. This runs automatically via the `predev` / `prebuild` npm
// scripts, so the frontend copy is refreshed on every dev/build.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const source = resolve(here, '../../blockchain/exports/CertificateRegistry.json')
const destDir = resolve(here, '../src/contract')
const dest = resolve(destDir, 'CertificateRegistry.json')

if (!existsSync(source)) {
  console.error(
    `[sync-contract] Missing contract export at:\n  ${source}\n` +
      `Run \`npm run export-abi\` in ../blockchain first.`,
  )
  process.exit(1)
}

mkdirSync(destDir, { recursive: true })
copyFileSync(source, dest)
console.log(`[sync-contract] Copied contract artifact -> ${dest}`)
