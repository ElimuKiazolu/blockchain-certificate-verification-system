import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig } from "hardhat/config";

// Load blockchain/.env into process.env so `configVariable(...)` below can resolve
// SEPOLIA_RPC_URL / SEPOLIA_PRIVATE_KEY from it. Node 22 built-in — no dotenv dep.
// configVariable also reads the encrypted Hardhat keystore first, so either source
// works (see .env.example and the deploy runbook). No-op when .env is absent
// (e.g. local-only test runs), so this never breaks the default workflow.
try {
  process.loadEnvFile();
} catch {
  // .env is optional; secrets are only needed for live network deploys.
}

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      chainId: 11155111,
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
  },
});
