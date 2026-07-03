import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import { hashFile } from '../lib/fileHash'
import { shortenHash } from '../lib/format'

/**
 * Upload-a-file input mode. Hashes the file client-side (Web Crypto SHA-256 —
 * the system's file-fingerprint convention, see src/lib/fileHash.ts) and hands
 * the resulting hash to the SAME verify pipeline as paste/scan. Failures here
 * (no file, unreadable, hashing unsupported) are input-level problems — shown
 * inline, distinct from both a verdict and the read-error notice.
 */
type FileState =
  | { status: 'idle' }
  | { status: 'hashing'; fileName: string }
  | { status: 'hashed'; fileName: string; hash: string }
  | { status: 'error'; message: string }

interface FileUploadPanelProps {
  onHashReady: (hash: string) => void
  busy: boolean
}

export function FileUploadPanel({ onHashReady, busy }: FileUploadPanelProps) {
  const [state, setState] = useState<FileState>({ status: 'idle' })
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(
    async (file: File) => {
      setState({ status: 'hashing', fileName: file.name })
      try {
        const hash = await hashFile(file)
        setState({ status: 'hashed', fileName: file.name, hash })
        onHashReady(hash)
      } catch (err) {
        setState({
          status: 'error',
          message:
            err instanceof Error ? err.message : 'Could not hash this file.',
        })
      }
    },
    [onHashReady],
  )

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void processFile(file)
    event.target.value = '' // allow re-selecting the same file
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (file) void processFile(file)
  }

  const reset = () => {
    setState({ status: 'idle' })
    inputRef.current?.focus()
  }

  const isHashing = state.status === 'hashing'

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
        className={`rounded-xl border-2 border-dashed px-5 py-8 text-center transition-colors ${
          isDragOver
            ? 'border-brand-400 bg-brand-50'
            : 'border-slate-300 bg-slate-50'
        }`}
      >
        {state.status === 'idle' && (
          <>
            <p className="text-sm text-slate-600">
              Drag a certificate file here, or
            </p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            >
              Choose file
            </button>
            <p className="mt-2 text-xs text-slate-400">
              Hashed in your browser — the file is never uploaded anywhere.
            </p>
          </>
        )}

        {isHashing && (
          <div className="flex flex-col items-center gap-2 text-sm text-slate-600">
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"
              aria-hidden="true"
            />
            Hashing {state.fileName}…
          </div>
        )}

        {state.status === 'hashed' && (
          <div className="text-sm">
            <p className="font-medium text-slate-800">{state.fileName}</p>
            <p className="mt-1 font-mono text-xs text-slate-500" title={state.hash}>
              {shortenHash(state.hash)}
            </p>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="mt-3 text-sm font-medium text-brand-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
            >
              Choose a different file
            </button>
          </div>
        )}

        {state.status === 'error' && (
          <div className="text-sm">
            <p className="font-medium text-red-700">Couldn&apos;t read this file.</p>
            <p className="mt-1 text-red-600">{state.message}</p>
            <button
              type="button"
              onClick={reset}
              className="mt-3 text-sm font-medium text-brand-600 hover:underline"
            >
              Try again
            </button>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        onChange={onInputChange}
        className="sr-only"
        aria-label="Certificate file"
      />
    </div>
  )
}
