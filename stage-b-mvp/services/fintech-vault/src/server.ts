import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import walletRoutes from './routes/wallet';
import checkoutRoutes from './routes/checkout';
import ledgerRoutes from './routes/ledger';
import { provider } from './chain';

// fintech vault — service C backend
// sits between the REST API and the actual solidity contracts
// stage A was doing all of this with in-memory maps and SHA256 fakes
// now it's real ethers.js calls to contracts deployed on a local hardhat node
const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/wallet', walletRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/ledger', ledgerRoutes);

app.get('/api/health', async (_req, res) => {
  try {
    const blockNumber = await provider.getBlockNumber();
    res.json({ status: 'ok', service: 'fintech-vault', stage: 'B', blockNumber });
  } catch {
    res.status(503).json({ status: 'down', service: 'fintech-vault', reason: 'chain unreachable' });
  }
});

const PORT = process.env.PORT || 3002;
createServer(app).listen(PORT, () => {
  console.log(`fintech-vault → http://localhost:${PORT}`);
});
