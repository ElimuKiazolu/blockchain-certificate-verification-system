// POST /api/ipfs/upload — pin one certificate file to IPFS, return its CID.
//
// This is the whole reason the backend exists: the Pinata JWT must never reach
// the browser (CLAUDE.md architecture invariant), so the browser posts the file
// here and gets back only a CID.
//
// The endpoint is deliberately narrow. It does not issue anything on-chain, it
// does not hash the file for identity (the browser owns certHash), and it does
// not store state. It pins, or it fails loudly enough that the caller knows not
// to proceed to the transaction (docs/07 R6: fail-safe writes — never record a
// CID for a file that didn't store).

import { Router, type Request, type Response } from 'express'
import multer, { MulterError } from 'multer'
import { config, isPinataConfigured } from '../config.js'
import { PinataError, pinFile } from '../lib/pinata.js'

/** Certificate documents only — a PDF or a scan/photo of one. */
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
])

// Memory storage: files are small, single-use, and must never linger on disk
// on the way to Pinata.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new UnsupportedTypeError(file.mimetype))
      return
    }
    cb(null, true)
  },
})

class UnsupportedTypeError extends Error {
  constructor(readonly mimetype: string) {
    super(`Unsupported file type: ${mimetype}`)
    this.name = 'UnsupportedTypeError'
  }
}

export const ipfsRouter: Router = Router()

ipfsRouter.post(
  '/upload',
  (_req: Request, res: Response, next) => {
    // Answer before touching the file at all when the server can't pin:
    // a clear 503 beats a confusing failure after an upload the user waited on.
    if (!isPinataConfigured()) {
      res.status(503).json({
        error: 'storage_not_configured',
        message:
          'File storage is not configured on the server, so the certificate file cannot be stored. Set PINATA_JWT in backend/.env and restart the backend.',
      })
      return
    }
    next()
  },
  (req: Request, res: Response) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        handleUploadError(err, res)
        return
      }
      void pinAndRespond(req, res)
    })
  },
)

async function pinAndRespond(req: Request, res: Response): Promise<void> {
  const file = req.file
  if (!file) {
    res.status(400).json({
      error: 'no_file',
      message: 'No file was received. Attach the certificate file and try again.',
    })
    return
  }
  if (file.size === 0) {
    res.status(400).json({
      error: 'empty_file',
      message: 'That file is empty, so there is nothing to store.',
    })
    return
  }

  try {
    const pinned = await pinFile(
      file.buffer,
      file.originalname || 'certificate',
      file.mimetype,
    )
    // Log the outcome, never the credential or the file contents.
    console.log(
      `[ipfs] pinned ${pinned.cid} (${pinned.size} bytes${pinned.duplicate ? ', already pinned' : ''})`,
    )
    res.status(201).json({
      cid: pinned.cid,
      size: pinned.size,
      duplicate: pinned.duplicate,
      gatewayUrl: `${config.pinataGateway}/${pinned.cid}`,
    })
  } catch (err) {
    if (err instanceof PinataError) {
      console.error(`[ipfs] pin failed: ${err.message}`)
      res.status(err.status).json({ error: 'pin_failed', message: err.message })
      return
    }
    console.error('[ipfs] unexpected pin error:', err)
    res.status(500).json({
      error: 'unexpected',
      message:
        'The file could not be stored because of an unexpected server error. Nothing was stored — please try again.',
    })
  }
}

/** Multer//filter failures are the caller's problem to fix — always 400. */
function handleUploadError(err: unknown, res: Response): void {
  if (err instanceof UnsupportedTypeError) {
    res.status(400).json({
      error: 'unsupported_type',
      message: `Files of type ${err.mimetype} aren't accepted. Upload a PDF, PNG, JPEG, or WebP.`,
    })
    return
  }
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({
        error: 'file_too_large',
        message: `That file is larger than the ${Math.round(config.maxUploadBytes / (1024 * 1024))} MB limit.`,
      })
      return
    }
    res.status(400).json({ error: 'upload_rejected', message: err.message })
    return
  }
  console.error('[ipfs] upload handling error:', err)
  res.status(500).json({
    error: 'unexpected',
    message: 'The upload could not be processed. Nothing was stored.',
  })
}
