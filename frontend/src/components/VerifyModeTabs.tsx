export type VerifyMode = 'paste' | 'upload' | 'scan'

const MODES: { id: VerifyMode; label: string }[] = [
  { id: 'paste', label: 'Paste hash' },
  { id: 'upload', label: 'Upload file' },
  { id: 'scan', label: 'Scan QR' },
]

interface VerifyModeTabsProps {
  active: VerifyMode
  onChange: (mode: VerifyMode) => void
}

/** Segmented control switching between the three input methods (docs/03 A-series). */
export function VerifyModeTabs({ active, onChange }: VerifyModeTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Certificate input method"
      className="inline-flex w-full rounded-xl border border-slate-200 bg-slate-100 p-1"
    >
      {MODES.map((mode) => {
        const isActive = mode.id === active
        return (
          <button
            key={mode.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(mode.id)}
            className={`min-h-9 flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
              isActive
                ? 'bg-white text-brand-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {mode.label}
          </button>
        )
      })}
    </div>
  )
}
