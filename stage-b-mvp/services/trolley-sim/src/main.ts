import { randomUUID } from 'node:crypto';
import mqtt from 'mqtt';
import { CatalogItem, createTrolleys, makeScan, stepTrolley } from './sim';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`set ${name}`);
  return value;
}

const TICK_MS = Number(process.env.TICK_MS || 800);
// 5% per 800ms tick is about one scan every 16s per trolley, as in stage A
const SCAN_PROBABILITY = Number(process.env.SCAN_PROBABILITY || 0.05);
const PRODUCT_CORE_URL = process.env.PRODUCT_CORE_URL || 'http://product-core:3001';

async function loadCatalog(): Promise<CatalogItem[]> {
  for (;;) {
    try {
      const res = await fetch(`${PRODUCT_CORE_URL}/api/products`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const items = (await res.json()) as CatalogItem[];
        if (items.length > 0) return items;
      }
    } catch {
      // product-core is still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function main() {
  const catalog = await loadCatalog();
  const trolleys = createTrolleys(Math.random);

  const broker = mqtt.connect(process.env.MQTT_URL || 'mqtt://mqtt-broker:1883', {
    username: 'trolley',
    password: required('MQTT_TROLLEY_PASSWORD'),
    clientId: 'trolley-sim',
    reconnectPeriod: 2000,
  });
  broker.on('error', (err) => console.warn(`mqtt error: ${err.message}`));
  broker.on('connect', () => {
    console.log(`connected to mqtt broker, simulating ${trolleys.length} trolleys`);
    broker.subscribe(['trolley/+/led', 'trolley/+/checkout'], { qos: 1 });
  });
  broker.on('message', (topic, payload) => {
    // a real trolley would flash its led here
    if (topic.endsWith('/checkout')) console.log(`${topic} ${payload.toString()}`);
  });

  // node runs as pid 1 in a container, where SIGTERM does nothing without a handler, and
  // kubernetes would wait out its whole grace period with this still publishing
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => broker.end(false, () => process.exit(0)));
  }

  setInterval(() => {
    if (!broker.connected) return;
    for (const t of trolleys) {
      stepTrolley(t, Math.random);
      broker.publish(
        `trolley/${t.id}/position`,
        JSON.stringify({ userId: t.userId, x: Number(t.x.toFixed(1)), y: Number(t.y.toFixed(1)), ts: Date.now() }),
        { qos: 0 },
      );
      if (Math.random() < SCAN_PROBABILITY) {
        broker.publish(`trolley/${t.id}/scan`, JSON.stringify(makeScan(catalog, Math.random, randomUUID)), { qos: 1 });
      }
    }
  }, TICK_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
