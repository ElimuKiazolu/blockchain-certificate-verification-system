import { network } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { mkdirSync, writeFileSync } from "node:fs";

// Phase 3 gas study: compare gas-per-certificate for three issuance strategies
// across cohort sizes. Local, in-process Hardhat network only.
//
//   individual  -> N separate issueCertificate txs (sum their gas)
//   naive       -> ONE batchIssueNaive tx storing N full records (ShikkhaChain-style)
//   merkle      -> ONE batchIssue(root) tx, regardless of N (our distinguishing feature)
//
// We pin the hardfork to "cancun" (matching this project's solc evm target) and raise
// the block gas limit far above mainnet's, so the naive single-tx baseline can be
// measured for every cohort size. The reported gasUsed is the TRUE gas, not the limit.
//
// REPORT NOTES on naive-batch feasibility (the Merkle approach has neither ceiling):
//   - A real ~30M-gas block cannot hold a naive batch beyond ~N=250 (it needs ~101k
//     gas/cert, so ~300 certs already exceed a 30M block).
//   - Post-Fusaka networks add EIP-7825, a hard per-transaction gas cap of 2^24 =
//     16,777,216 gas, making a single naive batch infeasible beyond ~N=160 regardless
//     of block size. (EDR's default newer hardfork enforces this; "cancun" predates it,
//     which is why we pin it here to chart the full theoretical naive curve.)
const { ethers } = await network.create({
  override: { hardfork: "cancun", blockGasLimit: 5_000_000_000n },
});

// Same frozen leaf encoding as the contract/tests (see CertificateRegistry tests).
const LEAF_TYPES = ["bytes32", "string", "string", "string", "uint64"] as const;
const COHORT_SIZES = [1, 10, 50, 100, 250, 500];

type LeafRow = [string, string, string, string, bigint];

// Generate N synthetic certs with distinct hashes/fields for a given run.
function makeRows(n: number, salt: string): LeafRow[] {
  const rows: LeafRow[] = [];
  for (let i = 0; i < n; i++) {
    rows.push([
      ethers.keccak256(ethers.toUtf8Bytes(`${salt}-${i}`)),
      `ipfs://Qm${salt}${i}`,
      `Recipient Name ${i}`,
      `Course Title ${i % 8}`,
      0n, // never expires (expiry doesn't affect the storage-cost comparison)
    ]);
  }
  return rows;
}

async function gasOf(txPromise: Promise<any>): Promise<bigint> {
  const receipt = await (await txPromise).wait();
  return receipt.gasUsed as bigint;
}

const [deployer, issuer] = await ethers.getSigners();

// Fresh contract per measurement so cert-hash writes never collide across strategies
// and every storage write starts from clean (cold) state.
async function deployFresh() {
  const registry = await ethers.deployContract("CertificateRegistry");
  await registry.connect(deployer).grantRole(await registry.ISSUER_ROLE(), issuer.address);
  return registry;
}

type Result = { strategy: string; cohortSize: number; totalGas: bigint; gasPerCert: number };
const results: Result[] = [];

for (const n of COHORT_SIZES) {
  const rows = makeRows(n, `c${n}`);

  // 1) Individual issuance: N separate transactions.
  {
    const reg = await deployFresh();
    let total = 0n;
    for (const r of rows) {
      total += await gasOf(reg.connect(issuer).issueCertificate(r[0], r[1], r[2], r[3], r[4]));
    }
    results.push({ strategy: "individual", cohortSize: n, totalGas: total, gasPerCert: Number(total) / n });
  }

  // 2) Naive batch: one transaction, N full records.
  {
    const reg = await deployFresh();
    const certHashes = rows.map((r) => r[0]);
    const cids = rows.map((r) => r[1]);
    const names = rows.map((r) => r[2]);
    const titles = rows.map((r) => r[3]);
    const expiries = rows.map((r) => r[4]);
    const g = await gasOf(
      reg.connect(issuer).batchIssueNaive(certHashes, cids, names, titles, expiries),
    );
    results.push({ strategy: "naive", cohortSize: n, totalGas: g, gasPerCert: Number(g) / n });
  }

  // 3) Merkle batch: one transaction storing a single root.
  {
    const reg = await deployFresh();
    const tree = StandardMerkleTree.of(rows, [...LEAF_TYPES]);
    const g = await gasOf(reg.connect(issuer).batchIssue(tree.root));
    results.push({ strategy: "merkle", cohortSize: n, totalGas: g, gasPerCert: Number(g) / n });
  }

  console.log(`  measured cohort size N=${n}`);
}

// ---- Console table (flat) ----
const fmt = (x: number | bigint) => x.toLocaleString("en-US");
const pad = (s: string, w: number) => s.padStart(w);

console.log("\nGas analysis — individual vs naive batch vs Merkle batch\n");
console.log(
  `${pad("Strategy", 12)}${pad("Cohort N", 10)}${pad("Total gas", 16)}${pad("Gas / cert", 14)}`,
);
console.log("-".repeat(52));
for (const r of results) {
  console.log(
    `${pad(r.strategy, 12)}${pad(String(r.cohortSize), 10)}${pad(fmt(r.totalGas), 16)}${pad(
      fmt(Math.round(r.gasPerCert)),
      14,
    )}`,
  );
}

// ---- Console pivot: gas/cert by strategy across N (the headline) ----
console.log("\nGas per certificate (headline figure)\n");
console.log(`${pad("N", 8)}${pad("individual", 14)}${pad("naive", 14)}${pad("merkle", 14)}`);
console.log("-".repeat(50));
for (const n of COHORT_SIZES) {
  const cell = (strategy: string) => {
    const r = results.find((x) => x.strategy === strategy && x.cohortSize === n)!;
    return fmt(Math.round(r.gasPerCert));
  };
  console.log(`${pad(String(n), 8)}${pad(cell("individual"), 14)}${pad(cell("naive"), 14)}${pad(cell("merkle"), 14)}`);
}

// ---- CSV output ----
const csvLines = ["strategy,cohortSize,totalGas,gasPerCert"];
for (const r of results) {
  csvLines.push(`${r.strategy},${r.cohortSize},${r.totalGas.toString()},${Math.round(r.gasPerCert)}`);
}
mkdirSync("gas-analysis", { recursive: true });
const csvPath = "gas-analysis/gas-results.csv";
writeFileSync(csvPath, csvLines.join("\n") + "\n");
console.log(`\nWrote ${results.length} rows to ${csvPath}\n`);
