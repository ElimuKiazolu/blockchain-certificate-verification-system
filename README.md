# Blockchain-Based Digital Certificate Verification System

A decentralized web application (DApp) where academic institutions issue tamper-proof digital certificates on the **Ethereum blockchain**, and anyone can verify a certificate's authenticity in seconds — with no account, no wallet, and no need to trust a central authority.

> **Final-year Major Project — Computer Engineering (Course 01CE0716), Marwadi University.**
> Smart contract deployed live on the Ethereum **Sepolia** test network.

---

## What it does

- **Issue** certificates on-chain — individually, or an entire cohort at once using **Merkle-tree batch issuance** (the project's distinguishing feature).
- **Verify** any certificate against the blockchain — wallet-free — returning one of four states: **VALID**, **EXPIRED**, **REVOKED**, or **NOT FOUND**.
- **Revoke** certificates (single or batch), with the verifier showing the full record marked as revoked.
- **Govern** issuing rights: an administrator grants or revokes an institution's permission to issue, enforced on-chain.
- **Store** the certificate document itself on **IPFS**, retrievable through the verifier.

### The headline: Merkle-tree batch issuance

Issuing certificates one by one costs gas per certificate. This system commits an **entire cohort as a single on-chain Merkle root** — one transaction for the whole group. Each student receives a Merkle proof that lets their certificate be verified as a member of that batch. A comparative gas study (see `blockchain/gas-analysis/`) shows the per-certificate cost dropping from **~124,000 gas** (individual issuance) to **~99 gas** at a cohort size of 500 — an approximately **1,250× reduction** — while remaining within Ethereum's per-transaction gas limit where naive batching fails.

---

## Architecture

The system is layered so that the **blockchain is always the source of truth**, with off-chain components acting only as convenience and cache.

| Layer | Technology | Role |
|-------|-----------|------|
| **Smart contract** | Solidity 0.8.28, Hardhat, OpenZeppelin | On-chain source of truth: issuance, verification, revocation, roles, Merkle batches |
| **Frontend** | React 19 + TypeScript + Tailwind (Vite), ethers.js v6 | Public verifier (wallet-free) + issuer/admin dashboards (via MetaMask) |
| **Backend** | Node.js + Express + TypeScript | Pins certificate files to IPFS (Pinata); serves a rebuildable index |
| **File storage** | IPFS (via Pinata) | Stores the actual certificate documents, referenced on-chain by CID |
| **Index** | MongoDB | A **rebuildable cache** of on-chain events for fast search (never the source of truth) |

**Key architectural principle:** the MongoDB index can be dropped and fully rebuilt by replaying the contract's on-chain events. If the database and the blockchain ever disagree, the blockchain wins.

### Repository structure

```
certificate-verification-dapp/
├── blockchain/     Smart contract, tests, deployment, gas study
│   ├── contracts/          CertificateRegistry.sol
│   ├── test/               Contract test suite (41 tests)
│   ├── scripts/            Deployment, ABI export, gas analysis, role/fixture helpers
│   ├── gas-analysis/       Gas study results (CSV)
│   └── exports/            Exported ABI consumed by the frontend
├── frontend/       React application (verifier + issuer + admin)
│   └── src/
│       ├── pages/          Verifier, Issuer, Admin, Wallet
│       ├── components/     UI components (dashboards, forms, verdicts)
│       ├── lib/            Verification, issuance, Merkle, hashing, clients
│       └── wallet/         MetaMask connection + on-chain role reads
└── backend/        Express service (IPFS pinning + event index)
    └── src/
        ├── routes/         IPFS upload, certificates, health
        ├── lib/            Chain sync (event replay)
        └── db/             MongoDB connection
```

---

## Live deployment

- **Smart contract (Sepolia):** [`0xCC56d18C7f286d4d0B3a84F285871e8d5FA76DF9`](https://sepolia.etherscan.io/address/0xCC56d18C7f286d4d0B3a84F285871e8d5FA76DF9)
- **Network:** Ethereum Sepolia testnet (chain ID `11155111`)

---

## Running the project locally

### Prerequisites

- **Node.js** v20+ and npm
- **MetaMask** browser extension, set to the **Sepolia** network, with a little test ETH (from a Sepolia faucet) for issuing/revoking
- Free accounts for the off-chain services (only needed to run the backend): **Pinata** (IPFS) and **MongoDB Atlas**

### 1. Install dependencies

Each part of the monorepo has its own dependencies:

```bash
cd blockchain && npm install
cd ../frontend && npm install
cd ../backend  && npm install
```

### 2. Configure environment variables

Every folder ships a `.env.example` documenting the variables it needs. Copy each to a real `.env` and fill in your own values:

```bash
cp blockchain/.env.example blockchain/.env
cp frontend/.env.example   frontend/.env
cp backend/.env.example    backend/.env
```

- `blockchain/.env` — a Sepolia RPC URL and a deployer private key (only needed if you redeploy the contract).
- `frontend/.env` — points the app at the deployed contract / backend.
- `backend/.env` — your Pinata JWT and gateway, and your MongoDB connection string.

> **Never commit a real `.env` file.** Secrets stay local; only `.env.example` (with placeholders) is tracked.

### 3. Run

**Backend** (IPFS + index API, starts on port 4000):

```bash
cd backend
npm run dev
```

**Frontend** (starts on port 5173):

```bash
cd frontend
npm run dev
```

Then open **http://localhost:5173**.

- The **public verifier** works immediately — no wallet needed.
- To **issue / revoke / administer**, connect a MetaMask wallet on Sepolia that holds the required on-chain role.

### 4. Smart-contract commands (optional)

```bash
cd blockchain
npm test                 # run the contract test suite (41 tests)
npm run gas-analysis     # reproduce the gas study
```

---

## How verification works (in brief)

1. A certificate file is hashed (SHA-256) in the browser — this hash is the certificate's on-chain identity.
2. To verify, the app recomputes the file's hash (or accepts a pasted hash / scanned QR) and reads the on-chain record directly from Ethereum through a public RPC — **no wallet required**.
3. For **batch** certificates, the app additionally supplies the certificate's Merkle proof, and the contract re-derives the leaf on-chain to confirm membership in the committed root. Any tampering with the certificate's fields makes the proof fail.
4. The result is one of four states — VALID, EXPIRED, REVOKED, NOT FOUND — read live from the chain, which remains the single source of truth.

---

## Academic context

This repository is submitted as the implementation artifact for a final-year Major Project. It demonstrates a complete, working decentralized system deployed live on a public blockchain test network, with an original engineering contribution in gas-efficient batch issuance. The `blockchain/` test suite and gas study can be run to independently verify the correctness and performance claims described above.

**Course:** 01CE0716 · **Institution:** Marwadi University, Faculty of Engineering & Technology.