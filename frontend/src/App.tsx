import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { Footer } from './components/Footer'
import { VerifierPage } from './pages/VerifierPage'
import { WalletPage } from './pages/WalletPage'
import { IssuerPage } from './pages/IssuerPage'
import { AdminPage } from './pages/AdminPage'

/**
 * App shell + routing.
 *
 *   /        → public verifier (wallet-free, home)      — Phase 5
 *   /issuer  → issuer dashboard (issuer OR admin gated) — Phase 6
 *   /admin   → role management (DEFAULT_ADMIN_ROLE)     — Phase 6
 *   /wallet  → wallet + role read                       — Phase 4 (preserved)
 *
 * {@link AppShell} provides the sidebar (Phase 8) and is shared by every route.
 * Route gating is UNCHANGED: /issuer and /admin still mount RequireIssuer /
 * RequireAdmin, so hiding a nav link never substitutes for a real check.
 */
function App() {
  return (
    <AppShell>
      <div className="flex min-h-full flex-col">
        <div className="flex-1">
          <Routes>
            <Route path="/" element={<VerifierPage />} />
            <Route path="/issuer" element={<IssuerPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/wallet" element={<WalletPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        <Footer />
      </div>
    </AppShell>
  )
}

export default App
