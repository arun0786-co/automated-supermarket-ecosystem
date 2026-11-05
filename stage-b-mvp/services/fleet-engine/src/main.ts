import { createServer } from 'node:http';
import mqtt from 'mqtt';
import { WebSocketServer } from 'ws';
import { createApi } from './api';
import { FleetEngine } from './engine';
import { Feed, TOKEN_EXPIRED, viewerFromHeaders } from './feed';
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

const feed = new Feed();

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
    broadcast: (message) => feed.broadcast(message as { type: string }),
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

  const app = createApi({
    health: () => ({ status: 'ok', service: 'fleet-engine', stage: 'B', brokerConnected: broker.connected, subscribed, trolleys: engine.snapshot().length, clients: feed.size() }),
    snapshot: () => engine.snapshot(),
    cartFor: (id) => engine.cartFor(id),
    getUser: (id) => services.getUser(id),
    listCustomers: () => fetchCustomers(urls),
    walletOf: (user) => fetchWallet(urls, user),
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  wss.on('connection', (socket, req) => {
    const viewer = viewerFromHeaders(req.headers);
    if (!viewer) {
      socket.close(TOKEN_EXPIRED, 'not logged in');
      return;
    }
    feed.add(socket, viewer);
  });

  setInterval(() => feed.broadcast({ type: 'TROLLEY_POSITIONS', data: engine.snapshot() }), POSITIONS_EVERY_MS).unref();

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
