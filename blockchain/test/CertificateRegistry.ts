import { expect } from "chai";
import { network } from "hardhat";

// Hardhat 3: get an ethers v6 instance and the network time helpers from a
// fresh in-process connection (mirrors test/Counter.ts).
const { ethers, networkHelpers } = await network.create();

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

    // TODO Phase 2: add a "returns REVOKED (overrides expiry)" test once
    // revokeCertificate exists. The contract already reads the `revoked` mapping,
    // but there is no way to set it until the Phase 2 revoke function lands.
  });
});
