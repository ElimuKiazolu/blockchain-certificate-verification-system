// Server entry point (Phase 7, Slice 1).
//
// A deliberately thin IPFS-pinning proxy. It is NOT authoritative for anything:
// the chain remains the source of truth, and the public verifier must keep
// working with this process stopped (CLAUDE.md architecture invariants).

import { config, isPinataConfigured } from './config.js'
import { createApp } from './app.js'

const app = createApp()

app.listen(config.port, () => {
  console.log(
    `[backend] listening on http://localhost:${config.port} (health: /api/health)`,
  )
  console.log(`[backend] allowed origins: ${config.corsOrigins.join(', ')}`)
  console.log(`[backend] gateway: ${config.pinataGateway}`)

  if (isPinataConfigured()) {
    // Confirm configuration WITHOUT revealing any part of the credential.
    console.log('[backend] Pinata: configured — uploads enabled')
  } else {
    console.warn(
      '[backend] Pinata: NOT configured — uploads will return 503.\n' +
        '          Copy backend/.env.example to backend/.env, set PINATA_JWT, and restart.',
    )
  }
})
