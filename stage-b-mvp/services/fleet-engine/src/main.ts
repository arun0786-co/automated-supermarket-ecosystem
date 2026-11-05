import { createServer, IncomingMessage } from 'node:http';
import cors from 'cors';
import express from 'express';
import mqtt from 'mqtt';
import { WebSocket, WebSocketServer } from 'ws';
import { FleetEngine } from './engine';
import { fetchCustomers, fetchWallet, httpServices } from './http-services';
import { MemoryCartStore, RedisCartStore } from './store';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`set ${name}`);
  return value;
}

const urls = {
  vision: process.env.VISION_URL || 'http://vision:8001',
  products: process.env.PRODUCT_CORE_URL || 'http://product-core:3001',
  vault: process.env.VAULT_URL || 'http://fintech-vault:3002',
  auth: process.env.AUTH_URL || 'http://auth-service:3004',
  ai: process.env.AI_URL || 'http://ai-engine:8000',
};
const POSITIONS_EVERY_MS = 800;

const clients = new Set<WebSocket>();

function broadcast(message: unknown) {
  const text = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(text);
  }
}

async function main() {
  const broker = mqtt.connect(process.env.MQTT_URL || 'mqtt://mqtt-broker:1883', {
    username: 'fleet',
    password: required('MQTT_FLEET_PASSWORD'),
    // a fixed id and a kept session: the broker holds qos 1 scans while this service restarts
    clientId: 'fleet-engine',
    clean: false,
    reconnectPeriod: 2000,
  });

  const services = httpServices(urls);
  const engine = new FleetEngine({
    services,
    store: process.env.REDIS_URL ? new RedisCartStore(process.env.REDIS_URL) : new MemoryCartStore(),
    broadcast,
    publish: (topic, payload) => {
      broker.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) console.warn(`could not publish to ${topic}: ${err.message}`);
      });
    },
  });

  // attached before anything async: the broker can connect at any moment. messages wait for the
  // restore, so a redelivered scan is checked against the restored cart
  const restored = engine.restore();
  let subscribed = false;
  broker.on('connect', () => {
    console.log('connected to mqtt broker');
    broker.subscribe(['trolley/+/position', 'trolley/+/scan'], { qos: 1 }, (err) => {
      if (err) console.error(`could not subscribe: ${err.message}`);
      subscribed = !err;
    });
  });
  broker.on('close', () => {
    subscribed = false;
  });
  broker.on('error', (err) => console.warn(`mqtt error: ${err.message}`));
  broker.on('message', (topic, payload) => void restored.then(() => engine.handleMessage(topic, payload)));

  const app = express();
  app.use(cors());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'fleet-engine', stage: 'B', brokerConnected: broker.connected, subscribed, trolleys: engine.snapshot().length, clients: clients.size });
  });

  app.get('/api/fleet/trolleys', (_req, res) => {
    res.json(engine.snapshot());
  });

  app.get('/api/fleet/cart/:userId', (req, res) => {
    res.json(engine.cartFor(req.params.userId) ?? { trolleyId: null, status: 'IDLE', items: [], total: 0 });
  });

  app.get('/api/wallets', async (_req, res) => {
    try {
      const customers = await fetchCustomers(urls);
      res.json(await Promise.all(customers.map((user) => fetchWallet(urls, user))));
    } catch (err) {
      console.warn(`wallet list failed: ${String(err)}`);
      res.status(503).json({ error: 'wallets unavailable' });
    }
  });

  app.get('/api/wallets/:id', async (req, res) => {
    try {
      const user = await services.getUser(req.params.id);
      if (!user) {
        res.status(404).json({ error: 'wallet not found' });
        return;
      }
      res.json(await fetchWallet(urls, user));
    } catch (err) {
      console.warn(`wallet lookup failed: ${String(err)}`);
      res.status(503).json({ error: 'wallet unavailable' });
    }
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  wss.on('connection', (socket: WebSocket, _req: IncomingMessage) => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
    socket.send(JSON.stringify({ type: 'INFO', message: 'connected to ASE fleet engine' }));
  });

  setInterval(() => broadcast({ type: 'TROLLEY_POSITIONS', data: engine.snapshot() }), POSITIONS_EVERY_MS).unref();

  const port = Number(process.env.PORT || 3003);
  server.listen(port, () => console.log(`fleet-engine on port ${port}`));

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      broker.end(false, () => process.exit(0));
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
