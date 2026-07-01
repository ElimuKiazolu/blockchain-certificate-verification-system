import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Exports the CertificateRegistry ABI (and deployed address, when a deployment
// exists) to exports/CertificateRegistry.json — the single integration boundary the
// frontend (Phase 4) imports. Run after `npx hardhat compile`; the address is filled
// in once a deploy has run. Reads only build output — never touches secrets or the
// network.

const ARTIFACT = "artifacts/contracts/CertificateRegistry.sol/CertificateRegistry.json";
const OUT_DIR = "exports";
const OUT_FILE = join(OUT_DIR, "CertificateRegistry.json");
const DEPLOYMENTS_DIR = "ignition/deployments";
const ADDRESS_KEY = "CertificateRegistryModule#CertificateRegistry";

if (!existsSync(ARTIFACT)) {
  console.error(`Artifact not found at ${ARTIFACT}. Run "npx hardhat compile" first.`);
  process.exit(1);
}

const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));

// Find a deployed address if one exists. Prefer Sepolia (chain-11155111), else the
// first deployment found. Absent before the first real deploy — ABI still exports.
let address: string | null = null;
let chainId: number | null = null;

if (existsSync(DEPLOYMENTS_DIR)) {
  const chainDirs = readdirSync(DEPLOYMENTS_DIR)
    .filter((d) => d.startsWith("chain-"))
    .sort((a, b) => (a === "chain-11155111" ? -1 : b === "chain-11155111" ? 1 : 0));

  for (const dir of chainDirs) {
    const file = join(DEPLOYMENTS_DIR, dir, "deployed_addresses.json");
    if (existsSync(file)) {
      const map = JSON.parse(readFileSync(file, "utf8"));
      if (map[ADDRESS_KEY]) {
        address = map[ADDRESS_KEY];
        chainId = Number(dir.replace("chain-", ""));
        break;
      }
    }
  }
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  OUT_FILE,
  JSON.stringify(
    { contractName: "CertificateRegistry", address, chainId, abi: artifact.abi },
    null,
    2,
  ) + "\n",
);

console.log(`Exported ABI (${artifact.abi.length} entries) to ${OUT_FILE}`);
console.log(
  address
    ? `  address: ${address} (chainId ${chainId})`
    : "  address: not deployed yet (ABI-only export; re-run after deploying)",
);
