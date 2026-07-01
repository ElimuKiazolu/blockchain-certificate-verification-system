import { network } from "hardhat";

// READ-ONLY signer check. Forces Sepolia account initialization (the same code path
// the deploy uses) and prints only the derived public address. Never broadcasts a
// transaction and never prints the private key.
const { ethers } = await network.connect({ network: "sepolia", chainType: "l1" });

const signers = await ethers.getSigners();
if (signers.length === 0) {
  console.error("No signers — SEPOLIA_PRIVATE_KEY did not resolve to an account.");
  process.exit(1);
}

const address = await signers[0].getAddress();
console.log("Sepolia signer resolved OK. Deployer address:", address);
