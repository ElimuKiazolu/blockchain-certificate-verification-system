import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser'
import { extractCertHash } from '../lib/readClient'

/**
 * Scan-a-QR input mode. Decodes camera frames entirely client-side
 * (@zxing/browser) and extracts a certificate hash from either a raw hash or
 * a verification URL payload (docs/03 A1), then hands it to the SAME verify
 * pipeline as paste/upload. Camera errors and malformed payloads are
 * input-level problems — shown inline here, never as a verdict.
 */
type QrState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'scanning' }
  | { status: 'denied'; message: string }
  | { status: 'unavailable'; message: string }
  | { status: 'malformed' }

interface QrScannerPanelProps {
  onHashReady: (hash: string) => void
}

export function QrScannerPanel({ onHashReady }: QrScannerPanelProps) {
  const [state, setState] = useState<QrState>({ status: 'idle' })
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)

  const stop = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
  }, [])

  // Stop the camera whenever this panel unmounts (e.g. the user switches to
  // Paste/Upload) — never leave the stream running in the background.
  useEffect(() => stop, [stop])

  const startScanning = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({
        status: 'unavailable',
        message:
          'Camera access requires a secure connection (HTTPS) and a supported browser.',
      })
      return
    }

    setState({ status: 'starting' })
    try {
      const reader = new BrowserQRCodeReader()
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        videoRef.current ?? undefined,
        (result, _error, frameControls) => {
          if (!result) return // no code in this frame yet — keep scanning
          frameControls.stop()
          const hash = extractCertHash(result.getText())
          if (hash) {
            onHashReady(hash)
          } else {
            setState({ status: 'malformed' })
          }
        },
      )
      controlsRef.current = controls
      setState({ status: 'scanning' })
    } catch (err) {
      const name = err instanceof DOMException ? err.name : undefined
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setState({
          status: 'denied',
          message:
            'Camera access was denied. Enable camera permission for this site in your browser settings, or use Paste or Upload instead.',
        })
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setState({
          status: 'unavailable',
          message: 'No camera was found on this device. Use Paste or Upload instead.',
        })
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setState({
          status: 'unavailable',
          message: 'The camera is already in use by another application.',
        })
      } else {
        setState({
          status: 'unavailable',
          message: err instanceof Error ? err.message : 'Could not access the camera.',
        })
      }
    }
  }, [onHashReady])

  const isScanning = state.status === 'scanning'

  return (
    <div>
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-slate-300 bg-slate-900">
        {/* Video is always mounted so the ref is valid when startScanning runs;
            it's just visually hidden until a stream is attached. */}
        <video
          ref={videoRef}
          playsInline
          muted
          className={`h-full w-full object-cover ${isScanning ? 'block' : 'hidden'}`}
        />

        {isScanning && (
          <div
            className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/70"
            aria-hidden="true"
          />
        )}

        {!isScanning && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            {state.status === 'idle' && (
              <>
                <CameraIcon />
                <button
                  type="button"
                  onClick={() => void startScanning()}
                  className="inline-flex min-h-11 items-center rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-brand-800 shadow-sm transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300"
                >
                  Start camera
                </button>
                <p className="max-w-xs text-xs text-slate-300">
                  Point your camera at the certificate&apos;s QR code. Nothing is
                  uploaded — decoding happens on your device.
                </p>
              </>
            )}

            {state.status === 'starting' && (
              <p className="flex items-center gap-2 text-sm text-slate-200">
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                  aria-hidden="true"
                />
                Requesting camera access…
              </p>
            )}

            {(state.status === 'denied' || state.status === 'unavailable') && (
              <div className="max-w-xs" role="alert">
                <p className="text-sm font-medium text-white">
                  {state.status === 'denied'
                    ? 'Camera access denied'
                    : 'Camera unavailable'}
                </p>
                <p className="mt-1 text-xs text-slate-300">{state.message}</p>
                <button
                  type="button"
                  onClick={() => void startScanning()}
                  className="mt-3 text-sm font-medium text-white underline underline-offset-2 hover:text-slate-200"
                >
                  Try again
                </button>
              </div>
            )}

            {state.status === 'malformed' && (
              <div className="max-w-xs" role="alert">
                <p className="text-sm font-medium text-white">
                  That QR code isn&apos;t a certificate identifier
                </p>
                <p className="mt-1 text-xs text-slate-300">
                  We read a code, but it doesn&apos;t contain a valid on-chain
                  hash.
                </p>
                <button
                  type="button"
                  onClick={() => void startScanning()}
                  className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-white px-4 py-2 text-sm font-semibold text-brand-800 shadow-sm hover:bg-slate-100"
                >
                  Scan again
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {isScanning && (
        <button
          type="button"
          onClick={() => {
            stop()
            setState({ status: 'idle' })
          }}
          className="mt-3 text-sm font-medium text-slate-500 hover:text-slate-700 hover:underline"
        >
          Cancel
        </button>
      )}
    </div>
  )
}

function CameraIcon() {
  return (
    <svg
      className="h-8 w-8 text-slate-300"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}
