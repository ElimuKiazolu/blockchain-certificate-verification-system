// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title CertificateRegistry
/// @notice On-chain source of truth for tamper-proof academic certificates.
///         This slice implements single-certificate issuance and verification
///         (with optional expiry). Certificates are keyed by an opaque
///         `bytes32 certHash` supplied by the caller; the contract is
///         hash-agnostic and never computes or interprets how the hash was
///         derived (the frontend computes a SHA-256 fingerprint off-chain).
/// @dev Access control uses OpenZeppelin v5 `AccessControl`. Revocation is
///      tracked in a dedicated `revoked` mapping (read here, written by the
///      revoke function that lands in Phase 2) so it can serve both single and
///      Merkle-batch certificates uniformly.
contract CertificateRegistry is AccessControl {
    /// @notice Role permitted to issue certificates. Held by vetted institutions.
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    /// @notice Result of a verification lookup, in precedence order of resolution.
    /// @dev NOT_FOUND is the zero value, so an unknown hash resolves correctly by default.
    enum Status {
        NOT_FOUND,
        VALID,
        EXPIRED,
        REVOKED
    }

    /// @notice Full on-chain record for a single-issued certificate.
    /// @dev `expiresAt == 0` means the certificate never expires. `issuer == address(0)`
    ///      is used as the "does not exist" sentinel.
    struct Certificate {
        string ipfsCID;
        address issuer;
        uint64 issuedAt;
        uint64 expiresAt; // 0 = never expires
        string recipientName;
        string courseTitle;
    }

    /// @notice On-chain record for a Merkle batch (cohort) issuance.
    /// @dev Only the Merkle root is stored on-chain; individual batch certificates
    ///      live in the leaves. Each cert's leaf data and proof travel with the
    ///      certificate (file + QR) so verification is self-contained.
    ///      `issuer == address(0)` is the "root not issued" sentinel.
    struct Batch {
        address issuer;
        uint64 issuedAt;
    }

    /// @notice Single-issued certificate records, keyed by certificate hash.
    mapping(bytes32 => Certificate) public certificates;

    /// @notice Issued Merkle batch roots, keyed by the root itself.
    mapping(bytes32 => Batch) public batchRoots;

    /// @notice Unified revoked-set covering both single and batch certificates.
    mapping(bytes32 => bool) public revoked;

    /// @notice Thrown when issuing a certificate whose hash is already on record.
    /// @param certHash The colliding certificate hash.
    error CertificateAlreadyExists(bytes32 certHash);

    /// @notice Thrown when the supplied IPFS CID is empty.
    error EmptyCID();

    /// @notice Thrown when acting on a certificate hash that was never issued.
    /// @param certHash The unknown certificate hash.
    error CertificateNotFound(bytes32 certHash);

    /// @notice Thrown when revoking a certificate that is already revoked.
    /// @param certHash The already-revoked certificate hash.
    error AlreadyRevoked(bytes32 certHash);

    /// @notice Thrown when the caller is neither the issuer-of-record nor an admin.
    /// @param caller The unauthorized caller.
    /// @param certHash The certificate hash the caller attempted to revoke.
    error NotAuthorizedToRevoke(address caller, bytes32 certHash);

    /// @notice Thrown when batch-issuing a Merkle root that is already on record.
    /// @param merkleRoot The colliding Merkle root.
    error BatchRootExists(bytes32 merkleRoot);

    /// @notice Thrown when batch-issuing a zero Merkle root.
    error EmptyRoot();

    /// @notice BENCHMARK-ONLY: thrown when {batchIssueNaive}'s input arrays differ in length.
    error LengthMismatch();

    /// @notice Emitted when a single certificate is issued.
    /// @param certHash The certificate hash (storage key).
    /// @param issuer The issuing address (holder of `ISSUER_ROLE`).
    /// @param ipfsCID The IPFS content identifier of the certificate file.
    /// @param issuedAt The block timestamp at issuance.
    event CertificateIssued(
        bytes32 indexed certHash,
        address indexed issuer,
        string ipfsCID,
        uint64 issuedAt
    );

    /// @notice Emitted when a certificate is revoked.
    /// @param certHash The revoked certificate hash.
    /// @param revokedBy The address that performed the revocation (issuer or admin).
    /// @param revokedAt The block timestamp at revocation.
    event CertificateRevoked(
        bytes32 indexed certHash,
        address indexed revokedBy,
        uint64 revokedAt
    );

    /// @notice Emitted when a Merkle batch (cohort) is issued.
    /// @param merkleRoot The batch's Merkle root (storage key).
    /// @param issuer The issuing address (holder of `ISSUER_ROLE`).
    /// @param issuedAt The block timestamp at issuance.
    event BatchIssued(
        bytes32 indexed merkleRoot,
        address indexed issuer,
        uint64 issuedAt
    );

    /// @notice Deploys the registry and grants the deployer the admin role.
    /// @dev Uses OZ v5 `_grantRole` (the v4 `_setupRole` was removed). The admin
    ///      can subsequently grant/revoke `ISSUER_ROLE` to institutions.
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @notice Issue a single certificate, recording its proof on-chain.
    /// @dev Restricted to `ISSUER_ROLE`. Reverts on a duplicate hash or empty CID.
    ///      The certificate is stored with the caller as issuer-of-record and the
    ///      current block timestamp as the issue time.
    /// @param certHash The certificate hash to use as the storage key.
    /// @param ipfsCID The IPFS content identifier of the certificate file (non-empty).
    /// @param recipientName The name of the certificate recipient.
    /// @param courseTitle The course or qualification title.
    /// @param expiresAt The expiry timestamp, or 0 for a certificate that never expires.
    function issueCertificate(
        bytes32 certHash,
        string calldata ipfsCID,
        string calldata recipientName,
        string calldata courseTitle,
        uint64 expiresAt
    ) external onlyRole(ISSUER_ROLE) {
        if (certificates[certHash].issuer != address(0)) {
            revert CertificateAlreadyExists(certHash);
        }
        if (bytes(ipfsCID).length == 0) {
            revert EmptyCID();
        }

        certificates[certHash] = Certificate({
            ipfsCID: ipfsCID,
            issuer: msg.sender,
            issuedAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            recipientName: recipientName,
            courseTitle: courseTitle
        });

        emit CertificateIssued(certHash, msg.sender, ipfsCID, uint64(block.timestamp));
    }

    /// @notice Revoke a previously issued certificate, permanently marking it REVOKED.
    /// @dev Authorized callers are the issuer-of-record (`certificates[certHash].issuer`)
    ///      or any holder of `DEFAULT_ADMIN_ROLE`. Revocation is irreversible (set-only;
    ///      there is no un-revoke). Reverts if the certificate is unknown or already
    ///      revoked. Writes the shared `revoked` mapping, which `verifyCertificate`
    ///      checks ahead of expiry, so REVOKED overrides EXPIRED.
    ///      Phase 2 Slice 3: batch certs verify revocation via this same mapping.
    /// @param certHash The certificate hash to revoke.
    function revokeCertificate(bytes32 certHash) external {
        Certificate storage cert = certificates[certHash];
        if (cert.issuer == address(0)) {
            revert CertificateNotFound(certHash);
        }
        if (revoked[certHash]) {
            revert AlreadyRevoked(certHash);
        }
        if (msg.sender != cert.issuer && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotAuthorizedToRevoke(msg.sender, certHash);
        }

        revoked[certHash] = true;

        emit CertificateRevoked(certHash, msg.sender, uint64(block.timestamp));
    }

    /// @notice Revoke a batch-issued certificate, marking its hash REVOKED.
    /// @dev Batch certificates have no `certificates` record (only the root is stored on
    ///      chain), so revocation must prove the cert belongs to the batch and scope
    ///      authorization to the batch's issuer-of-record. The caller therefore supplies
    ///      the cert's raw fields + Merkle proof (the same bundled data the verifier
    ///      carries); the leaf is rebuilt on-chain via the frozen encoding and checked
    ///      against the stored root. Authorized callers are the batch issuer-of-record
    ///      (`batchRoots[merkleRoot].issuer`) or any holder of `DEFAULT_ADMIN_ROLE` —
    ///      parity with single-cert revocation. Proving membership first also prevents
    ///      poisoning the shared `revoked` set with arbitrary, never-issued hashes.
    ///      Writes the same `revoked` mapping, so {verifyBatchCertificate} then reports
    ///      REVOKED (ahead of expiry). Irreversible; reverts if the root is unknown, the
    ///      proof fails, or the cert is already revoked.
    /// @param merkleRoot The batch root the certificate belongs to.
    /// @param certHash The certificate hash to revoke (the unified `revoked` key).
    /// @param ipfsCID The certificate's IPFS CID (leaf field).
    /// @param recipientName The certificate's recipient name (leaf field).
    /// @param courseTitle The certificate's course title (leaf field).
    /// @param expiresAt The certificate's expiry, 0 for never (leaf field).
    /// @param proof The Merkle proof of the cert's membership in the batch.
    function revokeBatchCertificate(
        bytes32 merkleRoot,
        bytes32 certHash,
        string calldata ipfsCID,
        string calldata recipientName,
        string calldata courseTitle,
        uint64 expiresAt,
        bytes32[] calldata proof
    ) external {
        Batch storage batch = batchRoots[merkleRoot];
        if (batch.issuer == address(0)) {
            revert CertificateNotFound(certHash);
        }

        bytes32 leaf = _computeLeaf(certHash, ipfsCID, recipientName, courseTitle, expiresAt);
        if (!MerkleProof.verify(proof, merkleRoot, leaf)) {
            revert CertificateNotFound(certHash);
        }
        if (revoked[certHash]) {
            revert AlreadyRevoked(certHash);
        }
        if (msg.sender != batch.issuer && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotAuthorizedToRevoke(msg.sender, certHash);
        }

        revoked[certHash] = true;

        emit CertificateRevoked(certHash, msg.sender, uint64(block.timestamp));
    }

    /// @notice Verify a single certificate, returning its status and record.
    /// @dev Free, wallet-less, read-only. Resolution precedence:
    ///      NOT_FOUND -> REVOKED -> EXPIRED -> VALID (revocation overrides expiry).
    /// @param certHash The certificate hash to look up.
    /// @return status The resolved verification status.
    /// @return cert The stored certificate record (zero-valued when NOT_FOUND).
    function verifyCertificate(bytes32 certHash)
        external
        view
        returns (Status status, Certificate memory cert)
    {
        cert = certificates[certHash];

        if (cert.issuer == address(0)) {
            return (Status.NOT_FOUND, cert);
        }
        if (revoked[certHash]) {
            return (Status.REVOKED, cert);
        }
        if (cert.expiresAt != 0 && block.timestamp > cert.expiresAt) {
            return (Status.EXPIRED, cert);
        }
        return (Status.VALID, cert);
    }

    /// @notice Issue a whole cohort as a single Merkle root, recording only the root.
    /// @dev Restricted to `ISSUER_ROLE`. Atomic single write. Reverts on a zero root
    ///      or a root already on record. Individual certificates are not stored on-chain;
    ///      each cert's leaf data and Merkle proof travel with the certificate and are
    ///      checked via {verifyBatch}. The cohort is pre-validated off-chain before this
    ///      is called.
    /// @param merkleRoot The Merkle root committing every certificate in the cohort.
    function batchIssue(bytes32 merkleRoot) external onlyRole(ISSUER_ROLE) {
        if (merkleRoot == bytes32(0)) {
            revert EmptyRoot();
        }
        if (batchRoots[merkleRoot].issuer != address(0)) {
            revert BatchRootExists(merkleRoot);
        }

        batchRoots[merkleRoot] = Batch({issuer: msg.sender, issuedAt: uint64(block.timestamp)});

        emit BatchIssued(merkleRoot, msg.sender, uint64(block.timestamp));
    }

    /// @notice BENCHMARK-ONLY: naive batch issuance storing N full certificate records.
    /// @dev NOT part of the production verification path. It exists solely to measure the
    ///      gas baseline (the ShikkhaChain-style approach: one transaction, but N storage
    ///      writes and N events) against the Merkle {batchIssue} for the Phase 3 gas-cost
    ///      figure. It replicates {issueCertificate}'s per-certificate storage shape and
    ///      guards in a loop, so every record it writes is a normal single-cert record.
    ///      Do not use for real issuance — prefer {issueCertificate} or {batchIssue}.
    /// @param certHashes The certificate hashes (storage keys).
    /// @param ipfsCIDs The IPFS CIDs, one per certificate (each non-empty).
    /// @param recipientNames The recipient names, one per certificate.
    /// @param courseTitles The course titles, one per certificate.
    /// @param expiresAtList The expiry timestamps (0 = never), one per certificate.
    function batchIssueNaive(
        bytes32[] calldata certHashes,
        string[] calldata ipfsCIDs,
        string[] calldata recipientNames,
        string[] calldata courseTitles,
        uint64[] calldata expiresAtList
    ) external onlyRole(ISSUER_ROLE) {
        uint256 n = certHashes.length;
        if (
            ipfsCIDs.length != n ||
            recipientNames.length != n ||
            courseTitles.length != n ||
            expiresAtList.length != n
        ) {
            revert LengthMismatch();
        }

        for (uint256 i = 0; i < n; i++) {
            bytes32 certHash = certHashes[i];
            if (certificates[certHash].issuer != address(0)) {
                revert CertificateAlreadyExists(certHash);
            }
            if (bytes(ipfsCIDs[i]).length == 0) {
                revert EmptyCID();
            }

            certificates[certHash] = Certificate({
                ipfsCID: ipfsCIDs[i],
                issuer: msg.sender,
                issuedAt: uint64(block.timestamp),
                expiresAt: expiresAtList[i],
                recipientName: recipientNames[i],
                courseTitle: courseTitles[i]
            });

            emit CertificateIssued(certHash, msg.sender, ipfsCIDs[i], uint64(block.timestamp));
        }
    }

    /// @notice Check whether a leaf belongs to an issued Merkle batch.
    /// @dev Membership-only check (full VALID/EXPIRED/REVOKED status comes from
    ///      {verifyBatchCertificate}). Returns false (does not revert) for an unknown root.
    ///      FROZEN LEAF ENCODING: the `leaf` must be produced as
    ///      `keccak256(bytes.concat(keccak256(abi.encode(
    ///          certHash, ipfsCID, recipientName, courseTitle, expiresAt))))`
    ///      with field types `[bytes32, string, string, string, uint64]`. This is
    ///      exactly the double-hashed leaf that OpenZeppelin's `StandardMerkleTree`
    ///      produces off-chain, so JS-built proofs verify here unchanged.
    /// @param merkleRoot The batch root to check membership against.
    /// @param leaf The double-hashed leaf for the certificate (see frozen encoding).
    /// @param proof The Merkle proof from the off-chain tree.
    /// @return True if the root is issued and the proof verifies the leaf; false otherwise.
    function verifyBatch(bytes32 merkleRoot, bytes32 leaf, bytes32[] calldata proof)
        public
        view
        returns (bool)
    {
        if (batchRoots[merkleRoot].issuer == address(0)) {
            return false;
        }
        return MerkleProof.verify(proof, merkleRoot, leaf);
    }

    /// @notice Verify a batch-issued certificate, returning its full 4-state status.
    /// @dev Free, wallet-less, read-only. The leaf is rebuilt ON-CHAIN from the raw
    ///      fields via the frozen encoding ({_computeLeaf}) and checked against the
    ///      stored root, so any tampering with the metadata or expiry changes the leaf
    ///      and fails membership (reported as NOT_FOUND). Resolution precedence mirrors
    ///      single-cert {verifyCertificate}: NOT_FOUND -> REVOKED -> EXPIRED -> VALID
    ///      (revocation overrides expiry). NOT_FOUND covers both an unissued root and a
    ///      cert that is not in (or was altered relative to) the batch.
    /// @param merkleRoot The batch root to verify against.
    /// @param certHash The certificate hash (the unified `revoked` key and a leaf field).
    /// @param ipfsCID The certificate's IPFS CID (leaf field).
    /// @param recipientName The certificate's recipient name (leaf field).
    /// @param courseTitle The certificate's course title (leaf field).
    /// @param expiresAt The certificate's expiry, 0 for never (leaf field).
    /// @param proof The Merkle proof of the cert's membership in the batch.
    /// @return status The resolved verification status.
    function verifyBatchCertificate(
        bytes32 merkleRoot,
        bytes32 certHash,
        string calldata ipfsCID,
        string calldata recipientName,
        string calldata courseTitle,
        uint64 expiresAt,
        bytes32[] calldata proof
    ) external view returns (Status status) {
        if (batchRoots[merkleRoot].issuer == address(0)) {
            return Status.NOT_FOUND;
        }

        bytes32 leaf = _computeLeaf(certHash, ipfsCID, recipientName, courseTitle, expiresAt);
        if (!MerkleProof.verify(proof, merkleRoot, leaf)) {
            return Status.NOT_FOUND;
        }
        if (revoked[certHash]) {
            return Status.REVOKED;
        }
        if (expiresAt != 0 && block.timestamp > expiresAt) {
            return Status.EXPIRED;
        }
        return Status.VALID;
    }

    /// @notice Rebuild a batch certificate's Merkle leaf from its raw fields.
    /// @dev FROZEN LEAF ENCODING (Phase 2 Slice 2): the double `keccak256` of the
    ///      ABI-encoded fields, in this exact order/type — `[bytes32, string, string,
    ///      string, uint64]`. This is byte-identical to what OpenZeppelin's JS
    ///      `StandardMerkleTree` produces, so off-chain-built proofs verify on-chain.
    ///      Do not change the field order or types without re-issuing every batch.
    /// @param certHash The certificate hash.
    /// @param ipfsCID The certificate's IPFS CID.
    /// @param recipientName The certificate's recipient name.
    /// @param courseTitle The certificate's course title.
    /// @param expiresAt The certificate's expiry (0 = never).
    /// @return The double-hashed Merkle leaf.
    function _computeLeaf(
        bytes32 certHash,
        string memory ipfsCID,
        string memory recipientName,
        string memory courseTitle,
        uint64 expiresAt
    ) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                keccak256(abi.encode(certHash, ipfsCID, recipientName, courseTitle, expiresAt))
            )
        );
    }
}
