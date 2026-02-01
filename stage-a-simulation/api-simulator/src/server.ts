import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { startTrolleySimulation } from './trolleySim';
import { PRODUCTS, applyDynamicPricing } from './products';
import { getWallet, getAllWallets, getLedger, checkout, getBlockHeight } from './walletService';

// single express app + http server so websocket and REST share the same port (3001)
// i don't want to manage multiple ports locally — stage B will split these properly
const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server });

// --- REST routes ---

// quick health check — useful to ping this in a script before running tests
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ASE-PRIME Simulator', stage: 'A', blockHeight: getBlockHeight() });
});

// Service A equivalent — product catalog with dynamic pricing already applied
// the frontend doesn't need to know about the raw price vs discounted price
app.get('/api/products', (_req, res) => {
  const priced = PRODUCTS.map((p) => ({ ...p, ...applyDynamicPricing(p) }));
  res.json(priced);
});

app.get('/api/products/:sku', (req, res) => {
  const p = PRODUCTS.find((x) => x.sku === req.params.sku);
  if (!p) return res.status(404).json({ error: 'SKU not found' });
  res.json({ ...p, ...applyDynamicPricing(p) });
});

// Service C equivalent — wallet balances
// the flutter app polls this every 5 seconds to keep the balance display in sync
app.get('/api/wallets', (_req, res) => {
  res.json(getAllWallets());
});

app.get('/api/wallets/:id', (req, res) => {
  const w = getWallet(req.params.id);
  if (!w) return res.status(404).json({ error: 'Wallet not found' });
  res.json(w);
});

// manual checkout endpoint — the trolleySim calls this automatically but leaving
// it as a REST endpoint too so i can test it with curl without waiting for a trolley to fill up
app.post('/api/checkout', (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || typeof amount !== 'number') {
    return res.status(400).json({ error: 'userId and amount required' });
  }
  res.json(checkout(userId, amount));
});

// blockchain ledger — shows the last 50 transactions with their block hashes
app.get('/api/ledger', (_req, res) => {
  res.json({ blockHeight: getBlockHeight(), transactions: getLedger(50) });
});

// --- WebSocket ---

// broadcasts a message to every connected client (dashboard + any mobile apps)
// readyState === 1 means the socket is OPEN — skip closed/connecting ones
const broadcast = (data: unknown) => {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  });
};

wss.on('connection', (ws) => {
  console.log('📡 client connected');
  ws.send(JSON.stringify({ type: 'INFO', message: 'Connected to ASE Fleet Engine', blockHeight: getBlockHeight() }));
});

// --- start everything ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 simulator running → http://localhost:${PORT}`);
  startTrolleySimulation(broadcast);
});
