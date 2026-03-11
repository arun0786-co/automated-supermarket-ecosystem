import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import { createServer } from 'http';
import walletRoutes from './routes/wallet';
import checkoutRoutes from './routes/checkout';
import ledgerRoutes from './routes/ledger';

// fintech vault — service C backend
// sits between the REST API and the actual solidity contracts
// stage A was doing all of this with in-memory maps and SHA256 fakes
// now it's real ethers.js calls to contracts deployed on a local hardhat node
const app = express();
app.use(cors());
app.use(express.json());

// connect to the hardhat node (or besu in stage C)
const provider = new ethers.JsonRpcProvider(process.env.CHAIN_RPC || 'http://localhost:8545');

// signer is the deployer account — holds owner role on both contracts
const signer = new ethers.Wallet(
  process.env.DEPLOYER_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // hardhat account #0 default key
  provider,
);

export { provider, signer };

app.use('/api/wallet', walletRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/ledger', ledgerRoutes);

app.get('/api/health', async (_req, res) => {
  const blockNumber = await provider.getBlockNumber();
  res.json({ status: 'ok', service: 'fintech-vault', stage: 'B', blockNumber });
});

const PORT = process.env.PORT || 3002;
createServer(app).listen(PORT, () => {
  console.log(`fintech-vault → http://localhost:${PORT}`);
});
