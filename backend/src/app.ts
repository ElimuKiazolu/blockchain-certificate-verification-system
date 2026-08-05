// Express app wiring. Kept separate from index.ts so the app can be imported
// (e.g. by a future test) without binding a port.

import express, { type Express, type Request, type Response } from 'express'
import cors from 'cors'
import { config } from './config.js'
import { healthRouter } from './routes/health.js'
import { ipfsRouter } from './routes/ipfs.js'

export function createApp(): Express {
  const app = express()

  // Only the configured browser origins may call this API. Requests with no
  // Origin (curl, server-to-server) are allowed through — CORS is a browser
  // protection, and blocking them would only break local testing.
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes(origin)) {
          callback(null, true)
          return
        }
        callback(new Error(`Origin ${origin} is not allowed by CORS.`))
      },
    }),
  )

  // JSON parsing for future endpoints. The upload route is multipart and is
  // handled by multer, not by this.
  app.use(express.json({ limit: '1mb' }))

  app.use('/api', healthRouter)
  app.use('/api/ipfs', ipfsRouter)

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found', message: 'No such endpoint.' })
  })

  return app
}
