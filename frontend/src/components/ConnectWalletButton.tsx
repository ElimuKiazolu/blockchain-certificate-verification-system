/**
 * Placeholder wallet button.
 *
 * Slice 1 (this): visually present, non-functional. Slice 2 wires MetaMask via
 * ethers v6 BrowserProvider with the full resilience states
 * (missing / locked / rejected / wrong-network — see
 * docs/07-Resilience-and-Error-Handling.md R5).
 */
export function ConnectWalletButton() {
  function handleConnect() {
    // TODO(Slice 2): connect MetaMask via ethers v6 BrowserProvider,
    // detect Sepolia (chainId 11155111), then read a known cert.
    console.info('[wallet] Connect not implemented yet — arrives in Slice 2.')
  }

  return (
    <button
      type="button"
      onClick={handleConnect}
      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
    >
      Connect Wallet
    </button>
  )
}
