import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { startTrolleySimulation } from './trolleySim';
import { PRODUCTS, applyDynamicPricing } from './products';
import { getWallet, getAllWallets, getLedger, checkout, getBlockHeight } from './walletService';

// single http server shared by express and websocket, one port is cleaner for local dev
// in stage b these split into separate services behind an nginx gateway
const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server });

// health check, useful to ping before running tests to make sure the sim is up
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ASE-PRIME Simulator', stage: 'A', blockHeight: getBlockHeight() });
});

// product catalog with dynamic pricing already baked in
// the frontend doesn't need to care whether an item is discounted or not
app.get('/api/products', (_req, res) => {
  const priced = PRODUCTS.map((p) => ({ ...p, ...applyDynamicPricing(p) }));
  res.json(priced);
});

app.get('/api/products/:sku', (req, res) => {
  const p = PRODUCTS.find((x) => x.sku === req.params.sku);
  if (!p) return res.status(404).json({ error: 'sku not found' });
  res.json({ ...p, ...applyDynamicPricing(p) });
});

// wallet endpoints, flutter app polls /api/wallets/:id every 5s to keep balance in sync
app.get('/api/wallets', (_req, res) => {
  res.json(getAllWallets());
});

app.get('/api/wallets/:id', (req, res) => {
  const w = getWallet(req.params.id);
  if (!w) return res.status(404).json({ error: 'wallet not found' });
  res.json(w);
});

// manual checkout endpoint, the sim calls this automatically but keeping it as REST
// so i can test the overdraft logic with curl without waiting for a trolley to fill up
app.post('/api/checkout', (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'userId and a positive amount required' });
  }
  res.json(checkout(userId, amount));
});

// last 50 transactions from the mock ledger
app.get('/api/ledger', (_req, res) => {
  res.json({ blockHeight: getBlockHeight(), transactions: getLedger(50) });
});

// broadcast to all open websocket connections, skips any that aren't fully open
const broadcast = (data: unknown) => {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  });
};

wss.on('connection', (ws) => {
  console.log('client connected');
  ws.send(JSON.stringify({ type: 'INFO', message: 'connected to ASE fleet engine', blockHeight: getBlockHeight() }));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`simulator → http://localhost:${PORT}`);
  startTrolleySimulation(broadcast);
});
