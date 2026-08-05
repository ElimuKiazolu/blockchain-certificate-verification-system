// GET /api/health — is the backend up, and can it actually pin?
//
// Reports configuration STATUS, never the credential itself: `storage: "ready"`
// vs `"not_configured"` is enough for the frontend to warn an issuer before
// they pick a file, without leaking anything about the JWT.

import { Router, type Request, type Response } from 'express'
import { config, isPinataConfigured } from '../config.js'

export const healthRouter: Router = Router()

healthRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'certificate-registry-backend',
    storage: isPinataConfigured() ? 'ready' : 'not_configured',
    // Public read gateway — useful for the frontend to confirm it agrees with
    // the server about where files are served from.
    gateway: config.pinataGateway,
    maxUploadBytes: config.maxUploadBytes,
  })
})
