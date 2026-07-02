/**
 * The read/RPC-failure state — deliberately DISTINCT from every verdict
 * (docs/07 §3: "couldn't check" ≠ NOT FOUND). It uses orange (a non-verdict
 * color — the four status colors are reserved for real verdicts), a warning
 * icon, and copy that states plainly this is a connection problem and the
 * status is *unknown*, not invalid or missing. Offers a safe retry.
 */
interface ReadErrorNoticeProps {
  message: string
  onRetry: () => void
}

export function ReadErrorNotice({ message, onRetry }: ReadErrorNoticeProps) {
  return (
    <div className="rounded-2xl border border-orange-300 bg-orange-50 p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-700"
          aria-hidden="true"
        >
          <AlertIcon />
        </span>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-orange-900">
            Couldn&apos;t verify right now
          </h2>
          <p className="mt-1 text-orange-800">
            We couldn&apos;t reach the blockchain to check this certificate.
          </p>
          <p className="mt-2 text-sm text-orange-700">
            This is a connection problem — <strong>not a verdict</strong>. The
            certificate&apos;s status is <strong>unknown</strong>, not invalid
            and not missing. Please try again.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
          >
            Retry
          </button>
          {message && (
            <p className="mt-3 text-xs text-orange-600/80">Details: {message}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function AlertIcon() {
  return (
    <svg
      className="h-6 w-6"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  )
}
