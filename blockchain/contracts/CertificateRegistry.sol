// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

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

    /// @notice Single-issued certificate records, keyed by certificate hash.
    mapping(bytes32 => Certificate) public certificates;

    /// @notice Unified revoked-set covering both single and batch certificates.
    mapping(bytes32 => bool) public revoked;

    /// @notice Thrown when issuing a certificate whose hash is already on record.
    /// @param certHash The colliding certificate hash.
    error CertificateAlreadyExists(bytes32 certHash);

    /// @notice Thrown when the supplied IPFS CID is empty.
    error EmptyCID();

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
}
