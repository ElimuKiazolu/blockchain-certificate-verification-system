import { Navigate, Route, Routes } from 'react-router-dom'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { VerifierPage } from './pages/VerifierPage'
import { WalletPage } from './pages/WalletPage'
import { IssuerPage } from './pages/IssuerPage'

/**
 * App shell + routing.
 *
 *   /        → public verifier (wallet-free, home) — Phase 5
 *   /issuer  → issuer dashboard (wallet + role gated) — Phase 6
 *   /wallet  → wallet + role read                     — Phase 4 (preserved)
 *
 * Header + footer are shared; each route owns its own content container.
 */
function App() {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-slate-900">
      <Header />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<VerifierPage />} />
          <Route path="/issuer" element={<IssuerPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}

export default App
