import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Deploys CertificateRegistry. The constructor takes no arguments; the deploying
// account (the network's first signer / the SEPOLIA_PRIVATE_KEY wallet) becomes the
// DEFAULT_ADMIN_ROLE holder and can then grant ISSUER_ROLE to institutions.
export default buildModule("CertificateRegistryModule", (m) => {
  const certificateRegistry = m.contract("CertificateRegistry");

  return { certificateRegistry };
});
