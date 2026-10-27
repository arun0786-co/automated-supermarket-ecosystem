import { existsSync, readFileSync } from 'fs';
import { ethers } from 'ethers';

// connection to the hardhat node (or besu in stage C), shared by all routes
export const provider = new ethers.JsonRpcProvider(process.env.CHAIN_RPC || 'http://localhost:8545');

// signer is the deployer account, which owns both contracts.
// the fallback is hardhat's public test account #0, never use it on a real chain
export const signer = new ethers.Wallet(
  process.env.DEPLOYER_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  provider,
);

// written by scripts/deploy.ts. env vars win so a deployed chain can be targeted directly
const DEPLOYMENTS = 'deployments/localhost.json';
const deployed: Record<string, string> = existsSync(DEPLOYMENTS) ? JSON.parse(readFileSync(DEPLOYMENTS, 'utf8')) : {};

// without these every route would fail on first use, so stop early
function contractAddress(name: string): string {
  const value = process.env[name] || deployed[name];
  if (!value) throw new Error(`${name} is not set, run npm run deploy:local first`);
  return value;
}

export const tokenAddress = contractAddress('SPMT_TOKEN_ADDRESS');
export const checkoutAddress = contractAddress('CHECKOUT_ADDRESS');
