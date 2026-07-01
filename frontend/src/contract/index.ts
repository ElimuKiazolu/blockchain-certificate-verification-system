// The contract integration boundary for the frontend.
//
// CertificateRegistry.json is copied from blockchain/exports/ by
// scripts/sync-contract.mjs (runs on `predev` / `prebuild`). That export is
// the single source of truth for the ABI + deployed address; nothing here is
// hand-maintained. Consumers import the typed constants below — never the raw
// JSON — so the boundary stays in one place.

import registry from './CertificateRegistry.json'

/** Deployed CertificateRegistry address (live on Sepolia). */
export const CERTIFICATE_REGISTRY_ADDRESS = registry.address

/** Contract ABI — passed to ethers in Slice 2 to build a Contract instance. */
export const CERTIFICATE_REGISTRY_ABI = registry.abi

/**
 * Chain the contract is deployed to. Sourced from the export (11155111),
 * which is the Sepolia testnet.
 */
export const SEPOLIA_CHAIN_ID = registry.chainId

/** Hex form of the chain id — what MetaMask expects for network switching. */
export const SEPOLIA_CHAIN_ID_HEX = '0xaa36a7'

/** Convenience descriptor for network detection + explorer links (Slice 2+). */
export const SEPOLIA_NETWORK = {
  chainId: SEPOLIA_CHAIN_ID,
  chainIdHex: SEPOLIA_CHAIN_ID_HEX,
  name: 'Sepolia',
  blockExplorerUrl: 'https://sepolia.etherscan.io',
} as const
