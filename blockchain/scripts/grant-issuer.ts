import { readFileSync, existsSync } from "node:fs";
import { network } from "hardhat";

// LIVE Sepolia write: grants ISSUER_ROLE to a target address on the deployed
// CertificateRegistry, using the DEFAULT_ADMIN_ROLE signer (SEPOLIA_PRIVATE_KEY,
// resolved via configVariable/.env in hardhat.config.ts — never read or printed here).
//
// Target address comes from the ISSUER_ADDRESS env var (not hardcoded, not a CLI
// positional arg — hardhat run's own arg parsing doesn't reliably forward extras).
//
// Usage: ISSUER_ADDRESS=0x... npx hardhat run scripts/grant-issuer.ts --network sepolia

const EXPORT_FILE = "exports/CertificateRegistry.json";

if (!existsSync(EXPORT_FILE)) {
  console.error(`${EXPORT_FILE} not found. Run "npm run export-abi" after a deploy first.`);
  process.exit(1);
}

const { address, abi } = JSON.parse(readFileSync(EXPORT_FILE, "utf8"));

if (!address) {
  console.error(`${EXPORT_FILE} has no deployed address. Deploy the contract first.`);
  process.exit(1);
}

const target = process.env.ISSUER_ADDRESS;
if (!target) {
  console.error(
    "Missing target address. Set ISSUER_ADDRESS, e.g.:\n" +
      '  ISSUER_ADDRESS=0xYourAddress npx hardhat run scripts/grant-issuer.ts --network sepolia',
  );
  process.exit(1);
}

const { ethers } = await network.connect({ network: "sepolia", chainType: "l1" });

if (!ethers.isAddress(target)) {
  console.error(`ISSUER_ADDRESS "${target}" is not a valid address.`);
  process.exit(1);
}

const [signer] = await ethers.getSigners();
if (!signer) {
  console.error("No signer — SEPOLIA_PRIVATE_KEY did not resolve to an account.");
  process.exit(1);
}

const contract = new ethers.Contract(address, abi, signer);

const ISSUER_ROLE: string = await contract.ISSUER_ROLE();
console.log(`Contract:     ${address}`);
console.log(`Signer:       ${await signer.getAddress()}`);
console.log(`Target:       ${target}`);
console.log(`ISSUER_ROLE:  ${ISSUER_ROLE}`);

const already: boolean = await contract.hasRole(ISSUER_ROLE, target);
if (already) {
  console.log("Target already holds ISSUER_ROLE — nothing to do.");
  process.exit(0);
}

console.log("Submitting grantRole(ISSUER_ROLE, target)...");
const tx = await contract.grantRole(ISSUER_ROLE, target);
console.log(`Tx hash: ${tx.hash}`);
console.log("Waiting for confirmation...");
await tx.wait();

const granted: boolean = await contract.hasRole(ISSUER_ROLE, target);
console.log(`hasRole(ISSUER_ROLE, target) === ${granted}`);

if (!granted) {
  console.error("Grant did not take effect — check the transaction on Etherscan.");
  process.exit(1);
}
