import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// hardhat config for the fintech-vault service
// default network is localhost which expects a running hardhat node (npx hardhat node)
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    // CHAIN_RPC points at the hardhat-node container under docker compose
    localhost: {
      url: process.env.CHAIN_RPC || "http://127.0.0.1:8545",
      // the hardhat node holds its own accounts. a real chain like besu needs them from here,
      // and charges no gas (chapter 6)
      ...(process.env.CHAIN_MNEMONIC ? { accounts: { mnemonic: process.env.CHAIN_MNEMONIC }, gasPrice: 0 } : {}),
    },
    // hardhat in-process network for tests, no node needed
    hardhat: {
      chainId: 31337,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
