import { expect } from "chai";
import { network } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

// Hardhat 3: get an ethers v6 instance and the network time helpers from a
// fresh in-process connection (mirrors test/Counter.ts).
const { ethers, networkHelpers } = await network.create();

// FROZEN Merkle leaf encoding (Phase 2 Slice 2). The field type ordering below is
// the single source of truth shared by the JS issuer (StandardMerkleTree) and the
// Solidity verifier; it must never change without re-issuing every batch.
const LEAF_TYPES = ["bytes32", "string", "string", "string", "uint64"] as const;

// A batch leaf row: [certHash, ipfsCID, recipientName, courseTitle, expiresAt].
type LeafRow = [string, string, string, string, bigint];

// Reconstruct a leaf with the EXACT bytes Solidity will use:
//   keccak256(bytes.concat(keccak256(abi.encode(...)))) — the double hash that
// OpenZeppelin's StandardMerkleTree also produces. Used to prove JS == Solidity.
function solidityLeaf(row: LeafRow): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode([...LEAF_TYPES], row);
  return ethers.keccak256(ethers.keccak256(encoded));
}

// Mirrors the Solidity `Status` enum. ethers v6 returns enums as `bigint`.
const Status = {
  NOT_FOUND: 0n,
  VALID: 1n,
  EXPIRED: 2n,
  REVOKED: 3n,
} as const;

// The contract is hash-agnostic: any bytes32 works as a key. We derive one from
// a label the same way the frontend would derive a SHA-256-shaped 32-byte hash.
function makeCertHash(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

describe("CertificateRegistry", function () {
  let deployer: any; // holds DEFAULT_ADMIN_ROLE
  let issuer: any; // granted ISSUER_ROLE in beforeEach
  let outsider: any; // no roles
  let registry: any;
  let ISSUER_ROLE: string;
  let DEFAULT_ADMIN_ROLE: string;

  // Sample certificate inputs reused across tests.
  const cid = "ipfs://QmTestCertificateCID";
  const recipientName = "Alice Student";
  const courseTitle = "BSc Computer Engineering";

  beforeEach(async function () {
    [deployer, issuer, outsider] = await ethers.getSigners();
    registry = await ethers.deployContract("CertificateRegistry");
    ISSUER_ROLE = await registry.ISSUER_ROLE();
    DEFAULT_ADMIN_ROLE = await registry.DEFAULT_ADMIN_ROLE();

    // Authorize `issuer` for the issuance/verification tests below.
    await registry.connect(deployer).grantRole(ISSUER_ROLE, issuer.address);
  });

  describe("Deployment", function () {
    it("grants DEFAULT_ADMIN_ROLE to the deployer", async function () {
      expect(await registry.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.equal(true);
    });
  });

  describe("Access control", function () {
    it("reverts when an account without ISSUER_ROLE tries to issue", async function () {
      const certHash = makeCertHash("cert-unauthorized");

      await expect(
        registry
          .connect(outsider)
          .issueCertificate(certHash, cid, recipientName, courseTitle, 0n),
      )
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, ISSUER_ROLE);
    });

    it("lets an account issue once the admin grants it ISSUER_ROLE", async function () {
      const certHash = makeCertHash("cert-after-grant");

      // outsider is unauthorized until granted.
      await registry.connect(deployer).grantRole(ISSUER_ROLE, outsider.address);

      await registry
        .connect(outsider)
        .issueCertificate(certHash, cid, recipientName, courseTitle, 0n);

      const [status] = await registry.verifyCertificate(certHash);
      expect(status).to.equal(Status.VALID);
    });
  });

  describe("Issuance", function () {
    it("stores the certificate and emits CertificateIssued", async function () {
      const certHash = makeCertHash("cert-store");

      const tx = await registry
        .connect(issuer)
        .issueCertificate(certHash, cid, recipientName, courseTitle, 0n);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      const issuedAt = BigInt(block.timestamp);

      await expect(tx)
        .to.emit(registry, "CertificateIssued")
        .withArgs(certHash, issuer.address, cid, issuedAt);

      const stored = await registry.certificates(certHash);
      expect(stored.ipfsCID).to.equal(cid);
      expect(stored.issuer).to.equal(issuer.address);
      expect(stored.issuedAt).to.equal(issuedAt);
      expect(stored.expiresAt).to.equal(0n);
      expect(stored.recipientName).to.equal(recipientName);
      expect(stored.courseTitle).to.equal(courseTitle);
    });

    it("reverts CertificateAlreadyExists on a duplicate certHash", async function () {
      const certHash = makeCertHash("cert-duplicate");

      await registry
        .connect(issuer)
        .issueCertificate(certHash, cid, recipientName, courseTitle, 0n);

      await expect(
        registry
          .connect(issuer)
          .issueCertificate(certHash, cid, recipientName, courseTitle, 0n),
      )
        .to.be.revertedWithCustomError(registry, "CertificateAlreadyExists")
        .withArgs(certHash);
    });

    it("reverts EmptyCID when the IPFS CID is empty", async function () {
      const certHash = makeCertHash("cert-empty-cid");

      await expect(
        registry
          .connect(issuer)
          .issueCertificate(certHash, "", recipientName, courseTitle, 0n),
      ).to.be.revertedWithCustomError(registry, "EmptyCID");
    });
  });

  describe("Verification", function () {
    it("returns VALID with the stored record for a fresh non-expiring cert", async function () {
      const certHash = makeCertHash("cert-valid");

      await registry
        .connect(issuer)
        .issueCertificate(certHash, cid, recipientName, courseTitle, 0n);

      const [status, cert] = await registry.verifyCertificate(certHash);
      expect(status).to.equal(Status.VALID);
      expect(cert.ipfsCID).to.equal(cid);
      expect(cert.issuer).to.equal(issuer.address);
      expect(cert.expiresAt).to.equal(0n);
      expect(cert.recipientName).to.equal(recipientName);
      expect(cert.courseTitle).to.equal(courseTitle);
    });

    it("returns NOT_FOUND for an unknown certHash", async function () {
      const certHash = makeCertHash("cert-never-issued");

      const [status, cert] = await registry.verifyCertificate(certHash);
      expect(status).to.equal(Status.NOT_FOUND);
      // The record is zero-valued when not found.
      expect(cert.issuer).to.equal(ethers.ZeroAddress);
    });

    it("returns EXPIRED once the expiry timestamp has passed", async function () {
      const certHash = makeCertHash("cert-expiring");
      const now = await networkHelpers.time.latest();
      const expiresAt = now + 3600; // expires in 1 hour

      await registry
        .connect(issuer)
        .issueCertificate(certHash, cid, recipientName, courseTitle, expiresAt);

      // Still valid right after issuance, before expiry.
      let [status] = await registry.verifyCertificate(certHash);
      expect(status).to.equal(Status.VALID);

      // Advance chain time past the expiry, then re-verify.
      await networkHelpers.time.increaseTo(expiresAt + 1);
      [status] = await registry.verifyCertificate(certHash);
      expect(status).to.equal(Status.EXPIRED);
    });

    it("keeps a zero-expiry certificate VALID far into the future", async function () {
      const certHash = makeCertHash("cert-never-expires");

      await registry
        .connect(issuer)
        .issueCertificate(certHash, cid, recipientName, courseTitle, 0n);

      // Jump ~100 years forward; a 0 expiry must never flip to EXPIRED.
      await networkHelpers.time.increase(100 * 365 * 24 * 60 * 60);

      const [status] = await registry.verifyCertificate(certHash);
      expect(status).to.equal(Status.VALID);
    });

  });

  describe("Revocation", function () {
    it("lets the issuer revoke their own certificate and emits CertificateRevoked", async function () {
      const certHash = makeCertHash("cert-revoke-own");
      await registry
        .connect(issuer)
        .issueCertificate(certHash, cid, recipientName, courseTitle, 0n);

      const tx = await registry.connect(issuer).revokeCertificate(certHash);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      const revokedAt = BigInt(block.timestamp);

      await expect(tx)
        .to.emit(registry, "CertificateRevoked")
        .withArgs(certHash, issuer.address, revokedAt);

      expect(await registry.revoked(certHash)).to.equal(true);
      const [status] = await registry.verifyCertificate(certHash);
      expect(status).to.equal(Status.REVOKED);
    });

    it("lets an admin revoke another issuer's certificate", async function () {
      const certHash = makeCertHash("cert-revoke-by-admin");
      await registry
        .connect(issuer)
        .issueCertificate(certHash, cid, recipientName, courseTitle, 0n);

      await registry.connect(deployer).revokeCertificate(certHash);

      const [status] = await registry.verifyCertificate(certHash);
      expect(status).to.equal(Status.REVOKED);
    });

    it("reverts NotAuthorizedToRevoke for a non-issuer, non-admin caller", async function () {
      const certHash = makeCertHash("cert-revoke-unauthorized");
      await registry
        .connect(issuer)
        .issueCertificate(certHash, cid, recipientName, courseTitle, 0n);

      await expect(registry.connect(outsider).revokeCertificate(certHash))
        .to.be.revertedWithCustomError(registry, "NotAuthorizedToRevoke")
        .withArgs(outsider.address, certHash);
    });

    it("reverts CertificateNotFound when revoking an unknown certHash", async function () {
      const certHash = makeCertHash("cert-revoke-missing");

      await expect(registry.connect(issuer).revokeCertificate(certHash))
        .to.be.revertedWithCustomError(registry, "CertificateNotFound")
        .withArgs(certHash);
    });

    it("reverts AlreadyRevoked when revoking the same certificate twice", async function () {
      const certHash = makeCertHash("cert-revoke-twice");
      await registry
        .connect(issuer)
        .issueCertificate(certHash, cid, recipientName, courseTitle, 0n);
      await registry.connect(issuer).revokeCertificate(certHash);

      await expect(registry.connect(issuer).revokeCertificate(certHash))
        .to.be.revertedWithCustomError(registry, "AlreadyRevoked")
        .withArgs(certHash);
    });

    it("returns REVOKED even past expiry (revocation overrides expiry)", async function () {
      const certHash = makeCertHash("cert-revoke-precedence");
      const now = await networkHelpers.time.latest();
      const expiresAt = now + 3600; // expires in 1 hour

      await registry
        .connect(issuer)
        .issueCertificate(certHash, cid, recipientName, courseTitle, expiresAt);
      await registry.connect(issuer).revokeCertificate(certHash);

      // Advance past expiry: REVOKED is checked before EXPIRED, so it must win.
      await networkHelpers.time.increaseTo(expiresAt + 1);

      const [status] = await registry.verifyCertificate(certHash);
      expect(status).to.equal(Status.REVOKED);
    });
  });

  describe("Role management", function () {
    it("allows issuing after grantRole and blocks it after revokeRole", async function () {
      const certHashBefore = makeCertHash("cert-role-granted");
      const certHashAfter = makeCertHash("cert-role-revoked");

      // Grant ISSUER_ROLE to outsider -> it can now issue.
      await registry.connect(deployer).grantRole(ISSUER_ROLE, outsider.address);
      await registry
        .connect(outsider)
        .issueCertificate(certHashBefore, cid, recipientName, courseTitle, 0n);
      const [status] = await registry.verifyCertificate(certHashBefore);
      expect(status).to.equal(Status.VALID);

      // Revoke ISSUER_ROLE -> issuing reverts again.
      await registry.connect(deployer).revokeRole(ISSUER_ROLE, outsider.address);
      await expect(
        registry
          .connect(outsider)
          .issueCertificate(certHashAfter, cid, recipientName, courseTitle, 0n),
      )
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, ISSUER_ROLE);
    });

    it("reverts when a non-admin tries to grant ISSUER_ROLE", async function () {
      // `issuer` holds ISSUER_ROLE but not DEFAULT_ADMIN_ROLE; the admin of
      // ISSUER_ROLE is DEFAULT_ADMIN_ROLE by default in OZ v5.
      await expect(
        registry.connect(issuer).grantRole(ISSUER_ROLE, outsider.address),
      )
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(issuer.address, DEFAULT_ADMIN_ROLE);
    });
  });

  describe("Merkle batch", function () {
    // A small cohort with distinct rows (incl. one with an expiry).
    let rows: LeafRow[];
    let tree: StandardMerkleTree<LeafRow>;

    beforeEach(function () {
      rows = [
        [makeCertHash("batch-c1"), "ipfs://cidB1", "Dana Cohort", "BSc Computer Engineering", 0n],
        [makeCertHash("batch-c2"), "ipfs://cidB2", "Evan Cohort", "BSc Computer Engineering", 1893456000n],
        [makeCertHash("batch-c3"), "ipfs://cidB3", "Faye Cohort", "MSc Computer Science", 0n],
      ];
      tree = StandardMerkleTree.of(rows, [...LEAF_TYPES]);
    });

    // The critical result: the leaf the Solidity formula produces is byte-for-byte
    // the leaf the JS StandardMerkleTree produces. If this holds, JS-built proofs
    // verify on-chain unchanged.
    it("produces an identical leaf in JS and via the Solidity encoding (frozen leaf)", function () {
      for (const row of rows) {
        expect(solidityLeaf(row)).to.equal(tree.leafHash(row));
      }
    });

    it("batchIssue stores the root and emits BatchIssued", async function () {
      const tx = await registry.connect(issuer).batchIssue(tree.root);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      const issuedAt = BigInt(block.timestamp);

      await expect(tx)
        .to.emit(registry, "BatchIssued")
        .withArgs(tree.root, issuer.address, issuedAt);

      const stored = await registry.batchRoots(tree.root);
      expect(stored.issuer).to.equal(issuer.address);
      expect(stored.issuedAt).to.equal(issuedAt);
    });

    it("verifyBatch returns true for every cert using a Solidity-computed leaf + JS proof", async function () {
      await registry.connect(issuer).batchIssue(tree.root);

      for (let i = 0; i < rows.length; i++) {
        const leaf = solidityLeaf(rows[i]); // exact bytes the Solidity side uses
        const proof = tree.getProof(i);
        expect(await registry.verifyBatch(tree.root, leaf, proof)).to.equal(true);
      }
    });

    it("batchIssue reverts BatchRootExists for a duplicate root", async function () {
      await registry.connect(issuer).batchIssue(tree.root);

      await expect(registry.connect(issuer).batchIssue(tree.root))
        .to.be.revertedWithCustomError(registry, "BatchRootExists")
        .withArgs(tree.root);
    });

    it("batchIssue reverts EmptyRoot for a zero root", async function () {
      await expect(
        registry.connect(issuer).batchIssue(ethers.ZeroHash),
      ).to.be.revertedWithCustomError(registry, "EmptyRoot");
    });

    it("batchIssue reverts for a non-issuer caller", async function () {
      await expect(registry.connect(outsider).batchIssue(tree.root))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, ISSUER_ROLE);
    });

    it("verifyBatch returns false for a tampered leaf", async function () {
      await registry.connect(issuer).batchIssue(tree.root);

      // Same proof as row 0, but a leaf with an altered recipient name.
      const tampered = solidityLeaf([rows[0][0], rows[0][1], "Mallory", rows[0][3], rows[0][4]]);
      expect(await registry.verifyBatch(tree.root, tampered, tree.getProof(0))).to.equal(false);
    });

    it("verifyBatch returns false for a wrong proof", async function () {
      await registry.connect(issuer).batchIssue(tree.root);

      // Row 0's leaf checked against row 1's proof.
      const leaf = solidityLeaf(rows[0]);
      expect(await registry.verifyBatch(tree.root, leaf, tree.getProof(1))).to.equal(false);
    });

    it("verifyBatch returns false for an unknown (never-issued) root", async function () {
      const unknownRoot = makeCertHash("never-issued-root");
      const leaf = solidityLeaf(rows[0]);
      // Root was never batchIssue'd -> false, not a revert.
      expect(await registry.verifyBatch(unknownRoot, leaf, tree.getProof(0))).to.equal(false);
    });
  });
});
