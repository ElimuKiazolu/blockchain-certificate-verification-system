import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { network } from "hardhat";

// LIVE Sepolia write: issues ONE Merkle batch and saves the per-student JSON
// bundle that Phase 6 Slice 3b's batch verifier will consume.
//
// Why this exists: 3a's bundle is produced by a browser download after a
// MetaMask-signed batchIssue, so there was no committed fixture to build 3b
// against. This script reproduces that exact artifact headlessly.
//
// It deliberately imports the REAL frontend Merkle module rather than
// re-implementing the tree, so the fixture cannot drift from what the UI
// produces. The leaf encoding is the Phase-2 frozen one; see merkle.ts.
//
// Usage:
//   npx hardhat run scripts/issue-batch-fixture.ts --network sepolia
//     -> preflight only: builds the tree offline, reads role/balance/root
//        state, simulates the call. Sends NOTHING.
//   CONFIRM=yes npx hardhat run scripts/issue-batch-fixture.ts --network sepolia
//     -> actually sends batchIssue(root), then writes the bundle and
//        re-verifies every row on-chain.
//
// The cohort below is fully deterministic (fixed names, courses, expiries and
// ISSUED_ON), so the preflight run and the live run compute the SAME root.
// If that root has already been issued, bump BATCH_NONCE.

import { buildMerkleTree, attachProofs } from "../../frontend/src/lib/merkle.ts";
import { dateInputToExpiresAt } from "../../frontend/src/lib/format.ts";
import type { CohortRow } from "../../frontend/src/lib/cohortValidation.ts";

const EXPORT_FILE = "exports/CertificateRegistry.json";
const OUTPUT_ROOT = "batch-outputs";

/** Mirrors IPFS_PLACEHOLDER in frontend/src/lib/cohortValidation.ts (Phase 7 wires real CIDs). */
const IPFS_PLACEHOLDER = "PENDING_IPFS_PHASE7";

/** Bump this if the computed root has already been issued on-chain. */
const BATCH_NONCE = "1";
const BATCH_LABEL = "Class of 2026 - Semester I";
const ISSUED_ON = "2026-08-03";

/** Status enum ordering from CertificateRegistry.sol. */
const STATUS = ["NOT_FOUND", "VALID", "EXPIRED", "REVOKED"] as const;

interface CohortSpec {
  slug: string;
  recipientName: string;
  courseTitle: string;
  /** YYYY-MM-DD, or "" for never expires. */
  expiresOn: string;
  /** What the on-chain verdict should be right after issuance. */
  expectedStatus: (typeof STATUS)[number];
}

// Four rows chosen so 3b can exercise more than the happy path from one batch:
// two VALID, one already-past expiry (EXPIRED), and a spare VALID row kept as
// the revocation candidate if a REVOKED fixture is wanted later.
const COHORT: CohortSpec[] = [
  {
    slug: "amara-osei",
    recipientName: "Amara Osei",
    courseTitle: "BSc Computer Engineering",
    expiresOn: "",
    expectedStatus: "VALID",
  },
  {
    slug: "bilal-rahman",
    recipientName: "Bilal Rahman",
    courseTitle: "BSc Computer Engineering",
    expiresOn: "2030-06-30",
    expectedStatus: "VALID",
  },
  {
    slug: "chidi-okafor",
    recipientName: "Chidi Okafor",
    courseTitle: "MSc Computer Science",
    expiresOn: "2024-12-31",
    expectedStatus: "EXPIRED",
  },
  {
    slug: "dami-fola",
    recipientName: "Dami Fola",
    courseTitle: "MSc Computer Science",
    expiresOn: "",
    expectedStatus: "VALID",
  },
];

/**
 * The certificate document itself. Its SHA-256 IS the on-chain certHash, so
 * these files make the verifier's file-upload path testable, not just paste.
 * Deterministic content => deterministic hashes => deterministic root.
 */
function certificateDocument(spec: CohortSpec): string {
  return [
    "CERTIFICATE OF COMPLETION",
    "",
    `Recipient:  ${spec.recipientName}`,
    `Programme:  ${spec.courseTitle}`,
    `Issued on:  ${ISSUED_ON}`,
    `Expires on: ${spec.expiresOn || "never"}`,
    `Batch:      ${BATCH_LABEL} (#${BATCH_NONCE})`,
    "",
    "Issued by Marwadi University and committed to the Ethereum Sepolia",
    "testnet as part of a Merkle batch. Verify at the public verifier by",
    "uploading this file, or by pasting the certificate hash below.",
    "",
  ].join("\n");
}

/** Client-side file fingerprint: SHA-256 of the raw bytes (mirrors lib/fileHash.ts). */
function sha256Hex(contents: string): string {
  return "0x" + createHash("sha256").update(Buffer.from(contents, "utf8")).digest("hex");
}

/** The JSON bundle record shape — mirrors BatchCertificateRecord in lib/batchOutputs.ts. */
interface BatchCertificateRecord {
  certHash: string;
  ipfsCID: string;
  recipientName: string;
  courseTitle: string;
  expiresAt: number;
  proof: string[];
  root: string;
  contractAddress: string;
  chainId: number;
}

// --- 1. Contract boundary -------------------------------------------------

if (!existsSync(EXPORT_FILE)) {
  console.error(`${EXPORT_FILE} not found. Run "npm run export-abi" after a deploy first.`);
  process.exit(1);
}

const { address, abi, chainId } = JSON.parse(readFileSync(EXPORT_FILE, "utf8"));

if (!address) {
  console.error(`${EXPORT_FILE} has no deployed address. Deploy the contract first.`);
  process.exit(1);
}

// --- 2. Build the cohort + tree entirely offline --------------------------

const documents = COHORT.map((spec) => ({ spec, contents: certificateDocument(spec) }));

const rows: CohortRow[] = documents.map(({ spec, contents }) => ({
  recipientName: spec.recipientName,
  courseTitle: spec.courseTitle,
  expiresAt: dateInputToExpiresAt(spec.expiresOn),
  certHash: sha256Hex(contents),
  ipfsCID: IPFS_PLACEHOLDER,
}));

const tree = buildMerkleTree(rows);
const provenRows = attachProofs(rows, tree);
const root: string = tree.root;

console.log(`Batch:       ${BATCH_LABEL} (#${BATCH_NONCE})`);
console.log(`Rows:        ${rows.length}`);
console.log(`Merkle root: ${root}`);
console.log("");
for (const [i, row] of provenRows.entries()) {
  console.log(
    `  [${i}] ${row.recipientName.padEnd(14)} ${row.certHash}  proof=${row.proof.length} node(s)`,
  );
}
console.log("");

// --- 3. Preflight reads ---------------------------------------------------

const { ethers } = await network.connect({ network: "sepolia", chainType: "l1" });

const [signer] = await ethers.getSigners();
if (!signer) {
  console.error("No signer - SEPOLIA_PRIVATE_KEY did not resolve to an account.");
  process.exit(1);
}

const signerAddress = await signer.getAddress();
const contract = new ethers.Contract(address, abi, signer);

const ISSUER_ROLE: string = await contract.ISSUER_ROLE();
const hasIssuerRole: boolean = await contract.hasRole(ISSUER_ROLE, signerAddress);
const balance = await ethers.provider.getBalance(signerAddress);
const existing = await contract.batchRoots(root);
const rootAlreadyIssued = existing.issuer !== ethers.ZeroAddress;

console.log(`Contract:    ${address} (chainId ${chainId})`);
console.log(`Signer:      ${signerAddress}`);
console.log(`Balance:     ${ethers.formatEther(balance)} ETH`);
console.log(`ISSUER_ROLE: ${hasIssuerRole}`);
console.log(`Root issued: ${rootAlreadyIssued}`);
console.log("");

if (!hasIssuerRole) {
  console.error(
    "Signer does not hold ISSUER_ROLE. Grant it first:\n" +
      `  ISSUER_ADDRESS=${signerAddress} npm run grant-issuer`,
  );
  process.exit(1);
}

if (rootAlreadyIssued) {
  console.error(
    `This root is already on-chain (issued by ${existing.issuer}). ` +
      "Bump BATCH_NONCE in this script to produce a fresh cohort.",
  );
  process.exit(1);
}

if (balance === 0n) {
  console.error("Signer has 0 ETH on Sepolia - fund it before issuing.");
  process.exit(1);
}

// Simulate before spending anything: a revert surfaces here, not on-chain.
await contract.batchIssue.staticCall(root);
const gasEstimate = await contract.batchIssue.estimateGas(root);
console.log(`Simulation:  OK (estimated gas ${gasEstimate})`);

if (process.env.CONFIRM !== "yes") {
  console.log("");
  console.log("PREFLIGHT ONLY - nothing was sent. Re-run with CONFIRM=yes to issue.");
  process.exit(0);
}

// --- 4. The live write ----------------------------------------------------

console.log("");
console.log("Submitting batchIssue(root)...");
const tx = await contract.batchIssue(root);
console.log(`Tx hash: ${tx.hash}`);
console.log("Waiting for confirmation...");
const receipt = await tx.wait();
console.log(`Confirmed in block ${receipt.blockNumber} - gas used ${receipt.gasUsed}`);

// --- 5. Save the bundle + the source documents ----------------------------

const shortRoot = root.slice(2, 10);
const outputDir = join(OUTPUT_ROOT, `batch-${shortRoot}`);
const filesDir = join(outputDir, "files");
mkdirSync(filesDir, { recursive: true });

const records: BatchCertificateRecord[] = provenRows.map((row) => ({
  certHash: row.certHash,
  ipfsCID: row.ipfsCID,
  recipientName: row.recipientName,
  courseTitle: row.courseTitle,
  expiresAt: Number(row.expiresAt),
  proof: row.proof,
  root,
  contractAddress: address,
  chainId,
}));

const bundlePath = join(outputDir, `batch-${shortRoot}.json`);
writeFileSync(bundlePath, JSON.stringify(records, null, 2) + "\n", "utf8");

for (const [i, { spec, contents }] of documents.entries()) {
  writeFileSync(join(filesDir, `${spec.slug}.txt`), contents, "utf8");
  console.log(`  saved files/${spec.slug}.txt -> ${records[i].certHash}`);
}

const meta = {
  batchLabel: BATCH_LABEL,
  batchNonce: BATCH_NONCE,
  root,
  contractAddress: address,
  chainId,
  txHash: tx.hash,
  blockNumber: receipt.blockNumber,
  gasUsed: receipt.gasUsed.toString(),
  issuer: signerAddress,
  rowCount: records.length,
  expectedStatus: Object.fromEntries(
    COHORT.map((spec, i) => [records[i].certHash, spec.expectedStatus]),
  ),
};
writeFileSync(join(outputDir, "batch-meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");

console.log("");
console.log(`Bundle:      ${bundlePath}`);

// --- 6. Prove the saved bundle actually verifies on-chain -----------------

console.log("");
console.log("Verifying every saved record against the chain:");
let allMatched = true;
for (const [i, record] of records.entries()) {
  const status: bigint = await contract.verifyBatchCertificate(
    record.root,
    record.certHash,
    record.ipfsCID,
    record.recipientName,
    record.courseTitle,
    BigInt(record.expiresAt),
    record.proof,
  );
  const actual = STATUS[Number(status)];
  const expected = COHORT[i].expectedStatus;
  const ok = actual === expected;
  if (!ok) allMatched = false;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${record.recipientName.padEnd(14)} ${actual} (expected ${expected})`);
}

// A tampered field must fail membership and report NOT_FOUND, never VALID.
const tampered: bigint = await contract.verifyBatchCertificate(
  records[0].root,
  records[0].certHash,
  records[0].ipfsCID,
  records[0].recipientName + " (altered)",
  records[0].courseTitle,
  BigInt(records[0].expiresAt),
  records[0].proof,
);
const tamperedStatus = STATUS[Number(tampered)];
console.log(`  ${tamperedStatus === "NOT_FOUND" ? "OK  " : "FAIL"} tampered name -> ${tamperedStatus} (expected NOT_FOUND)`);
if (tamperedStatus !== "NOT_FOUND") allMatched = false;

if (!allMatched) {
  console.error("\nSaved bundle did NOT verify as expected - do not use it as a fixture.");
  process.exit(1);
}
console.log("\nAll records verified. Bundle is a valid 3b fixture.");
