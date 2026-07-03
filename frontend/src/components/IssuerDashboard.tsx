import { describeRoles } from '../wallet/useRoleRead'
import { shortenAddress } from '../lib/format'
import type { RoleReadResult } from '../lib/contract'

/**
 * The authorized issuer dashboard shell (Phase 6, Slice 1). Rendered only
 * inside {@link RequireIssuer}, so it can assume the wallet is connected, on
 * Sepolia, and holds issuer/admin.
 *
 * This slice is gating only — the "Issue a certificate" area is a clearly
 * marked placeholder. Slice 2 replaces it with the real single-issuance form
 * (recipient / course / expiry / file → SHA-256 → the first on-chain WRITE).
 */
export function IssuerDashboard({
  data,
  account,
}: {
  data: RoleReadResult
  account: string
}) {
  return (
    <div className="space-y-6">
      {/* Authorized confirmation + which role the wallet holds. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-5 py-4">
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
            aria-hidden="true"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-semibold text-emerald-900">
              Authorized to issue certificates
            </p>
            <p
              className="font-mono text-xs text-emerald-700"
              title={account}
            >
              {shortenAddress(account)}
            </p>
          </div>
        </div>
        <RoleBadge data={data} />
      </div>

      {/* Placeholder "Issue a certificate" area — NOT functional this slice. */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-xl font-semibold text-brand-900">
            Issue a certificate
          </h2>
          <span className="inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-brand-600">
            Coming next
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
          Single-certificate issuance arrives in the next slice: enter the
          recipient, course, and an optional expiry, then attach the file whose
          SHA-256 becomes the on-chain certificate hash. This will be the first
          on-chain <strong>write</strong> from the app — after it confirms,
          you&apos;ll get the hash and a QR that drops straight into the public
          verifier.
        </p>

        {/* Disabled sketch of the form — signals what's coming without faking it. */}
        <div className="mt-5 space-y-3" aria-hidden="true">
          <SkeletonField label="Recipient name" />
          <SkeletonField label="Course / title" />
          <SkeletonField label="Expiry date (optional)" />
          <SkeletonField label="Certificate file" tall />
        </div>

        <button
          type="button"
          disabled
          className="mt-5 inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-slate-200 px-6 py-2.5 text-sm font-semibold text-slate-500"
          title="Available in the next slice"
        >
          Issue certificate
        </button>
        <p className="mt-2 text-xs text-slate-400">
          Disabled — no transactions are sent in this build.
        </p>
      </div>
    </div>
  )
}

function RoleBadge({ data }: { data: RoleReadResult }) {
  // Admin ramp reads as "higher" authority; issuer as operational.
  const tone = data.isAdmin
    ? 'border-brand-200 bg-brand-50 text-brand-700'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {describeRoles(data)}
    </span>
  )
}

function SkeletonField({ label, tall }: { label: string; tall?: boolean }) {
  return (
    <div>
      <span className="block text-xs font-medium text-slate-400">{label}</span>
      <div
        className={`mt-1 rounded-lg border border-dashed border-slate-200 bg-slate-50 ${
          tall ? 'h-16' : 'h-10'
        }`}
      />
    </div>
  )
}
