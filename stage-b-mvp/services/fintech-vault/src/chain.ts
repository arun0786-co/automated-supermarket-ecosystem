import { ethers } from 'ethers';

// connection to the hardhat node (or besu in stage C), shared by all routes
export const provider = new ethers.JsonRpcProvider(process.env.CHAIN_RPC || 'http://localhost:8545');

// signer is the deployer account, which owns both contracts.
// the fallback is hardhat's public test account #0, never use it on a real chain
export const signer = new ethers.Wallet(
  process.env.DEPLOYER_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  provider,
);

// printed by scripts/deploy.ts. without them every route would fail on first use, so stop early
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set, run npm run deploy:local and copy the addresses`);
  return value;
}

export const tokenAddress = requireEnv('SPMT_TOKEN_ADDRESS');
export const checkoutAddress = requireEnv('CHECKOUT_ADDRESS');
