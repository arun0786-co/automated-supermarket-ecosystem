import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FleetEngine } from './engine';
import { CartItem, ChargeUnknownError, Product, Recommendation, RecommendationContext, Services, VisionRequest, VisionResult } from './types';
import { MemoryCartStore } from './store';

const catalog: Record<string, Product> = {
  'PRD-001': { sku: 'PRD-001', name: 'Banana', emoji: '🍌', category: 'Produce', price: 1.2, weight: 150, stockLevel: 80, discountThreshold: 10, daysToExpiry: 5, discounted: false },
  'BKR-003': { sku: 'BKR-003', name: 'Croissant x2', emoji: '🥐', category: 'Bakery', price: 2.4, weight: 200, stockLevel: 11, discountThreshold: 10, daysToExpiry: 1, discounted: true },
};

const USER = { id: 'USR-001', name: 'Arun K.', walletAddress: '0xabc' };

class FakeServices implements Services {
  picks: string[] = [];
  releases: [string, number][] = [];
  charges: { address: string; amount: string; skus: string[] }[] = [];
  purchases: { skus: string[] }[] = [];
  visionDown = false;
  productDown = false;
  pickDown = false;
  outOfStock = new Set<string>();
  stockAfterPick: number | null = null;
  charge: () => Promise<{ ok: boolean; hash?: string; reason?: string; overdraftUsed?: number }> = async () => ({ ok: true, hash: '0xhash' });
  vision: (req: VisionRequest) => VisionResult = (req) => ({
    sku: req.detection?.sku ?? null,
    confidence: req.detection?.confidence ?? 0,
    fusionProbability: 0.99,
    accepted: true,
    source: 'simulated',
  });

  async scan(req: VisionRequest) {
    if (this.visionDown) throw new Error('vision is down');
    return this.vision(req);
  }
  async getProduct(sku: string) {
    if (this.productDown) throw new Error('product-core is down');
    return catalog[sku] ?? null;
  }
  async pick(sku: string) {
    if (this.pickDown) throw new Error('product-core is down');
    if (this.outOfStock.has(sku)) return null;
    this.picks.push(sku);
    return this.stockAfterPick ?? catalog[sku].stockLevel - 1;
  }
  async release(sku: string, quantity: number) {
    this.releases.push([sku, quantity]);
  }
  async checkout(address: string, amount: string, skus: string[]) {
    this.charges.push({ address, amount, skus });
    return this.charge();
  }
  async recordPurchase(skus: string[]) {
    this.purchases.push({ skus });
  }
  recs: Recommendation[] = [];
  recommendCalls: { cartSkus: string[]; context: RecommendationContext }[] = [];
  feedback: { sku: string; reward: number }[] = [];
  recommendImpl: () => Promise<Recommendation[]> = async () => this.recs;
  async recommend(_userId: string, cart: CartItem[], context: RecommendationContext) {
    this.recommendCalls.push({ cartSkus: cart.map((i) => i.sku), context });
    return this.recommendImpl();
  }
  async sendFeedback(sku: string, reward: 0 | 1, _context: RecommendationContext) {
    this.feedback.push({ sku, reward });
  }
  async getUser(id: string) {
    return id === USER.id ? USER : null;
  }
}

function setup(store = new MemoryCartStore()) {
  const services = new FakeServices();
  const broadcasts: any[] = [];
  const published: { topic: string; payload: any }[] = [];
  const scheduled: (() => void)[] = [];
  const engine = new FleetEngine({
    services,
    store,
    broadcast: (m) => broadcasts.push(m),
    publish: (topic, payload) => published.push({ topic, payload }),
    schedule: (fn) => scheduled.push(fn),
    log: () => {},
  });
  return { engine, services, store, broadcasts, published, scheduled };
}

const T = 'TROLLEY-100';
const position = (x = 10, y = 20) => Buffer.from(JSON.stringify({ userId: USER.id, x, y, ts: 1 }));
const scanMsg = (eventId: string, sku = 'PRD-001', weightDelta = 150, confidence = 0.9) =>
  Buffer.from(JSON.stringify({ eventId, weightDelta, detection: { sku, confidence } }));

async function checkedIn() {
  const ctx = setup();
  await ctx.engine.handleMessage(`trolley/${T}/position`, position());
  return ctx;
}

const scanEvents = (b: any[]) => b.filter((m) => m.type === 'SCAN_EVENT');
const checkoutEvents = (b: any[]) => b.filter((m) => m.type === 'CHECKOUT_EVENT');

test('an accepted scan takes stock, fills the cart and uses the stage A event shape', async () => {
  const { engine, services, broadcasts, published } = await checkedIn();
  await engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'));

  assert.deepEqual(services.picks, ['PRD-001']);
  const [ev] = scanEvents(broadcasts);
  assert.equal(ev.trolleyId, T);
  assert.equal(ev.userId, USER.id);
  assert.equal(ev.event.accepted, true);
  assert.equal(ev.event.sku, 'PRD-001');
  assert.equal(ev.event.name, 'Banana');
  assert.equal(ev.event.emoji, '🍌');
  assert.equal(ev.event.confidence, 0.9);
  assert.equal(ev.event.weightDelta, 150);
  assert.equal(ev.event.price, 1.2);
  assert.equal(ev.event.discounted, false);
  assert.equal(typeof ev.event.ts, 'string');
  assert.deepEqual(published.at(-1), { topic: `trolley/${T}/led`, payload: { color: 'green' } });

  const [row] = engine.snapshot();
  assert.equal(row.id, T);
  assert.equal(row.itemCount, 1);
  assert.equal(row.cartTotal, 1.2);
  assert.equal(row.totalWeight, 150);
  assert.equal(row.status, 'SHOPPING');
  assert.deepEqual([row.x, row.y], [10, 20]);
});

test('the same event delivered twice only counts once', async () => {
  const { engine, services, broadcasts } = await checkedIn();
  await engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'));
  await engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'));
  assert.equal(services.picks.length, 1);
  assert.equal(scanEvents(broadcasts).length, 1);
  assert.equal(engine.snapshot()[0].itemCount, 1);
});

test('duplicates arriving at the same moment still only count once', async () => {
  const { engine, services } = await checkedIn();
  await Promise.all([1, 2, 3].map(() => engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'))));
  assert.equal(services.picks.length, 1);
});

test('a redelivery after a restart is still recognised', async () => {
  const first = await checkedIn();
  await first.engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'));

  const second = setup(first.store);
  await second.engine.restore();
  await second.engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'));
  assert.equal(second.services.picks.length, 0);
  assert.equal(second.engine.snapshot()[0].itemCount, 1);
});

test('vision down: nothing enters the cart and the trolley flashes red', async () => {
  const { engine, services, broadcasts, published } = await checkedIn();
  services.visionDown = true;
  await engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'));

  assert.deepEqual(services.picks, []);
  const [ev] = scanEvents(broadcasts);
  assert.equal(ev.event.accepted, false);
  assert.equal(ev.event.reason, 'vision unavailable');
  assert.equal(engine.snapshot()[0].itemCount, 0);
  assert.deepEqual(published.at(-1), { topic: `trolley/${T}/led`, payload: { color: 'red', reason: 'vision unavailable' } });
});

test('a vision rejection passes its reason through and takes no stock', async () => {
  const { engine, services, broadcasts } = await checkedIn();
  services.vision = () => ({ sku: 'PRD-001', confidence: 0.9, fusionProbability: 0, accepted: false, reason: 'weight mismatch', source: 'simulated' });
  await engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1', 'PRD-001', 1000));

  assert.deepEqual(services.picks, []);
  const [ev] = scanEvents(broadcasts);
  assert.equal(ev.event.reason, 'weight mismatch');
  assert.equal(ev.event.name, 'Banana');
  assert.equal(ev.event.weightDelta, 1000);
});

test('a rejection with no sku still produces a displayable event', async () => {
  const { engine, services, broadcasts } = await checkedIn();
  services.vision = () => ({ sku: null, confidence: 0, fusionProbability: 0, accepted: false, reason: 'no detection', source: 'model' });
  await engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'));
  const [ev] = scanEvents(broadcasts);
  assert.equal(ev.event.sku, 'UNKNOWN');
  assert.equal(ev.event.name, 'Unknown item');
  assert.equal(ev.event.price, 0);
});

test('out of stock is rejected', async () => {
  const { engine, services, broadcasts } = await checkedIn();
  services.outOfStock.add('PRD-001');
  await engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'));
  assert.equal(scanEvents(broadcasts)[0].event.reason, 'out of stock');
  assert.equal(engine.snapshot()[0].itemCount, 0);
});

test('product-core down at pick: rejected, cart unchanged', async () => {
  const { engine, services, broadcasts } = await checkedIn();
  services.pickDown = true;
  await engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'));
  assert.equal(scanEvents(broadcasts)[0].event.reason, 'inventory unavailable');
  assert.equal(engine.snapshot()[0].itemCount, 0);
});

test('product-core down at lookup: rejected, no stock taken', async () => {
  const { engine, services, broadcasts } = await checkedIn();
  services.productDown = true;
  await engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'));
  assert.equal(scanEvents(broadcasts)[0].event.reason, 'inventory unavailable');
  assert.deepEqual(services.picks, []);
});

test('a scan before any customer has checked in is refused', async () => {
  const { engine, services, broadcasts } = setup();
  await engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'));
  assert.deepEqual(services.picks, []);
  assert.equal(scanEvents(broadcasts)[0].event.reason, 'no customer checked in');
});

async function fillCart(ctx: Awaited<ReturnType<typeof checkedIn>>, count = 15) {
  for (let i = 0; i < count; i++) await ctx.engine.handleMessage(`trolley/${T}/scan`, scanMsg(`fill-${i}`));
}

test('the 15th item triggers exactly one checkout for the right amount', async () => {
  const ctx = await checkedIn();
  await fillCart(ctx);
  assert.equal(ctx.services.charges.length, 1);
  assert.deepEqual(ctx.services.charges[0], { address: '0xabc', amount: '18.00', skus: Array(15).fill('PRD-001') });
  const [ev] = checkoutEvents(ctx.broadcasts);
  assert.equal(ev.ok, true);
  assert.equal(ev.hash, '0xhash');
  assert.equal(ev.total, 18);
  assert.equal(ev.itemCount, 15);
  assert.equal(ev.userId, USER.id);
  assert.deepEqual(ctx.published.find((p) => p.topic.endsWith('/checkout'))?.payload, { ok: true, total: 18, hash: '0xhash' });
  // the model only ever sees anonymous baskets
  assert.deepEqual(ctx.services.purchases, [{ skus: Array(15).fill('PRD-001') }]);
});

test('the cart resets after checkout and scans in between are refused', async () => {
  const ctx = await checkedIn();
  await fillCart(ctx);
  assert.equal(ctx.engine.snapshot()[0].status, 'CHECKOUT');

  await ctx.engine.handleMessage(`trolley/${T}/scan`, scanMsg('late'));
  assert.equal(scanEvents(ctx.broadcasts).at(-1).event.reason, 'checkout in progress');
  assert.equal(ctx.services.picks.length, 15);

  ctx.scheduled.shift()!();
  await ctx.engine.handleMessage(`trolley/${T}/position`, position());
  const [row] = ctx.engine.snapshot();
  assert.equal(row.status, 'SHOPPING');
  assert.equal(row.itemCount, 0);
  assert.equal(row.cartTotal, 0);
});

test('overdraft use is passed through', async () => {
  const ctx = await checkedIn();
  ctx.services.charge = async () => ({ ok: true, hash: '0xhash', overdraftUsed: 4.5 });
  await fillCart(ctx);
  assert.equal(checkoutEvents(ctx.broadcasts)[0].overdraftUsed, 4.5);
});

test('insufficient funds: stock goes back and staff are alerted', async () => {
  const ctx = await checkedIn();
  ctx.services.charge = async () => ({ ok: false, reason: 'insufficient funds or overdraft limit reached' });
  await fillCart(ctx);

  const [ev] = checkoutEvents(ctx.broadcasts);
  assert.equal(ev.ok, false);
  assert.equal(ev.reason, 'insufficient funds or overdraft limit reached');
  assert.deepEqual(ctx.services.releases, [['PRD-001', 15]]);
  assert.equal(ctx.services.purchases.length, 0);
  assert.equal(ctx.published.find((p) => p.topic === 'store/alerts')?.payload.type, 'CHECKOUT_FAILED');
  ctx.scheduled.shift()!();
  await ctx.engine.handleMessage(`trolley/${T}/position`, position());
  assert.equal(ctx.engine.snapshot()[0].itemCount, 0);
});

test('an unknown charge outcome is never retried and stock is kept', async () => {
  const ctx = await checkedIn();
  ctx.services.charge = async () => {
    throw new ChargeUnknownError('timed out');
  };
  await fillCart(ctx);

  assert.equal(ctx.services.charges.length, 1);
  assert.deepEqual(ctx.services.releases, []);
  const [ev] = checkoutEvents(ctx.broadcasts);
  assert.equal(ev.ok, false);
  assert.equal(ev.reason, 'checkout result unknown');
  const alert = ctx.published.find((p) => p.topic === 'store/alerts')?.payload;
  assert.equal(alert.type, 'CHECKOUT_FAILED');
  assert.equal(alert.needsReview, true);
});

test('a charge that certainly did not happen releases stock', async () => {
  const ctx = await checkedIn();
  ctx.services.charge = async () => {
    throw new Error('connection refused');
  };
  await fillCart(ctx);
  assert.equal(checkoutEvents(ctx.broadcasts)[0].reason, 'payment service unavailable');
  assert.deepEqual(ctx.services.releases, [['PRD-001', 15]]);
});

test('a customer with no wallet mapping cannot be charged', async () => {
  const ctx = setup();
  await ctx.engine.handleMessage(`trolley/${T}/position`, Buffer.from(JSON.stringify({ userId: 'USR-GONE', x: 1, y: 1, ts: 1 })));
  await fillCart(ctx as never);
  assert.equal(ctx.services.charges.length, 0);
  assert.equal(checkoutEvents(ctx.broadcasts)[0].reason, 'no wallet for customer');
  assert.deepEqual(ctx.services.releases, [['PRD-001', 15]]);
});

test('a store outage costs durability, not the scan', async () => {
  const store = new MemoryCartStore();
  const ctx = setup(store);
  await ctx.engine.handleMessage(`trolley/${T}/position`, position());
  store.save = async () => {
    throw new Error('redis is down');
  };
  await ctx.engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'));
  assert.equal(scanEvents(ctx.broadcasts)[0].event.accepted, true);
  assert.equal(ctx.engine.snapshot()[0].itemCount, 1);
  await fillCart(ctx, 15);
  assert.equal(ctx.services.charges.length, 1);
});

test('a store outage at startup leaves the fleet running with empty carts', async () => {
  const store = new MemoryCartStore();
  store.loadAll = async () => {
    throw new Error('redis is down');
  };
  const ctx = setup(store);
  await ctx.engine.restore();
  await ctx.engine.handleMessage(`trolley/${T}/position`, position());
  await ctx.engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'));
  assert.equal(ctx.engine.snapshot()[0].itemCount, 1);
});

test('carts survive a restart', async () => {
  const first = await checkedIn();
  await fillCart(first, 3);

  const second = setup(first.store);
  await second.engine.restore();
  const [row] = second.engine.snapshot();
  assert.equal(row.itemCount, 3);
  assert.equal(row.cartTotal, 3.6);
  assert.equal(row.userId, USER.id);
});

test('a restart during checkout does not charge again and is flagged', async () => {
  const first = await checkedIn();
  first.services.charge = () => new Promise(() => {}); // crashes here, the call never returns
  void fillCart(first);
  await new Promise((r) => setTimeout(r, 20));

  const second = setup(first.store);
  await second.engine.restore();
  assert.equal(second.services.charges.length, 0);
  assert.equal(checkoutEvents(second.broadcasts)[0].reason, 'checkout result unknown');
  assert.equal(second.published.find((p) => p.topic === 'store/alerts')?.payload.needsReview, true);
  second.scheduled.shift()!();
  await second.engine.handleMessage(`trolley/${T}/position`, position());
  assert.equal(second.engine.snapshot()[0].status, 'SHOPPING');
});

test('low stock raises one alert per crossing', async () => {
  const { engine, services, published } = await checkedIn();
  services.stockAfterPick = 10;
  await engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'));
  services.stockAfterPick = 9;
  await engine.handleMessage(`trolley/${T}/scan`, scanMsg('e2'));
  const alerts = published.filter((p) => p.topic === 'store/alerts');
  assert.equal(alerts.length, 1);
  assert.deepEqual(alerts[0].payload, { type: 'LOW_STOCK', sku: 'PRD-001', stockLevel: 10, threshold: 10 });
});

test('a price change caused by a pick is pushed to clients', async () => {
  const { engine, services, broadcasts } = await checkedIn();
  services.stockAfterPick = 10; // croissant drops to the threshold and loses its discount
  await engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1', 'BKR-003', 200));
  const [ev] = broadcasts.filter((m) => m.type === 'PRICE_EVENT');
  assert.equal(ev.sku, 'BKR-003');
  assert.equal(ev.discounted, false);
});

for (const [label, topic, payload] of [
  ['not json', `trolley/${T}/scan`, '{nope'],
  ['json but not an object', `trolley/${T}/scan`, '[1,2]'],
  ['no event id', `trolley/${T}/scan`, '{"weightDelta":150,"detection":{"sku":"PRD-001","confidence":0.9}}'],
  ['weight is not a number', `trolley/${T}/scan`, '{"eventId":"x","weightDelta":"lots","detection":{"sku":"PRD-001","confidence":0.9}}'],
  ['no camera input', `trolley/${T}/scan`, '{"eventId":"x","weightDelta":150}'],
  ['position with no coordinates', `trolley/${T}/position`, '{"userId":"USR-001"}'],
  ['position off the map', `trolley/${T}/position`, '{"userId":"USR-001","x":1e9,"y":0}'],
  ['bad trolley id', 'trolley/../position', '{"userId":"USR-001","x":1,"y":1}'],
  ['unknown topic', `trolley/${T}/selfdestruct`, '{}'],
  ['outside the trolley tree', 'store/alerts', '{}'],
] as const) {
  test(`malformed input is dropped and the service keeps working: ${label}`, async () => {
    const { engine, services } = await checkedIn();
    await engine.handleMessage(topic, Buffer.from(payload));
    assert.deepEqual(services.picks, []);
    await engine.handleMessage(`trolley/${T}/scan`, scanMsg('still-works'));
    assert.deepEqual(services.picks, ['PRD-001']);
  });
}

const rec = (sku: string): Recommendation => ({ sku, name: sku, emoji: '', category: 'Pantry', price: 1, reason: 'r', score: 1 });

test('an accepted scan is followed by recommendations for that cart', async () => {
  const ctx = await checkedIn();
  ctx.services.recs = [rec('PNT-001')];
  await ctx.engine.handleMessage(`trolley/${T}/position`, position(450, 20));
  await ctx.engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'));
  await ctx.engine.idle();

  const [ev] = ctx.broadcasts.filter((m) => m.type === 'RECOMMENDATION_EVENT');
  assert.equal(ev.trolleyId, T);
  assert.equal(ev.userId, USER.id);
  assert.deepEqual(ev.recs, [rec('PNT-001')]);
  const [call] = ctx.services.recommendCalls;
  assert.deepEqual(call.cartSkus, ['PRD-001']);
  assert.equal(call.context.aisle, 4);
  assert.deepEqual(call.context.cartCategories, ['Produce']);
});

test('a rejected scan asks for no recommendations', async () => {
  const ctx = await checkedIn();
  ctx.services.visionDown = true;
  await ctx.engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'));
  await ctx.engine.idle();
  assert.equal(ctx.services.recommendCalls.length, 0);
});

test('adding a suggested item earns a reward, ignoring the others earns none', async () => {
  const ctx = await checkedIn();
  ctx.services.recs = [rec('BKR-003'), rec('PNT-001')];
  await ctx.engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'));
  await ctx.engine.idle();
  ctx.services.recs = [];
  await ctx.engine.handleMessage(`trolley/${T}/scan`, scanMsg('e2', 'BKR-003', 200));
  await ctx.engine.idle();
  assert.deepEqual(ctx.services.feedback, [{ sku: 'BKR-003', reward: 1 }, { sku: 'PNT-001', reward: 0 }]);
});

test('every accepted scan gets fresh suggestions, even when feedback fails', async () => {
  const ctx = await checkedIn();
  ctx.services.recs = [rec('PNT-001')];
  ctx.services.sendFeedback = async () => {
    throw new Error('feedback refused');
  };
  for (const id of ['e1', 'e2', 'e3']) {
    await ctx.engine.handleMessage(`trolley/${T}/scan`, scanMsg(id));
    await ctx.engine.idle();
  }
  assert.equal(ctx.broadcasts.filter((m) => m.type === 'RECOMMENDATION_EVENT').length, 3);
});

test('a dead ai engine has no effect on the scan', async () => {
  const ctx = await checkedIn();
  ctx.services.recommendImpl = async () => {
    throw new Error('ai engine is down');
  };
  await ctx.engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'));
  await ctx.engine.idle();
  assert.equal(scanEvents(ctx.broadcasts)[0].event.accepted, true);
  assert.equal(ctx.engine.snapshot()[0].itemCount, 1);
});

test('a hanging ai engine does not hold up the next scan', async () => {
  const ctx = await checkedIn();
  ctx.services.recommendImpl = () => new Promise(() => {});
  await ctx.engine.handleMessage(`trolley/${T}/scan`, scanMsg('e1'));
  await ctx.engine.handleMessage(`trolley/${T}/scan`, scanMsg('e2'));
  assert.equal(ctx.engine.snapshot()[0].itemCount, 2);
});

test('scans and checkouts are counted', async () => {
  const counted: string[] = [];
  const services = new FakeServices();
  const engine = new FleetEngine({
    services,
    store: new MemoryCartStore(),
    broadcast: () => {},
    publish: () => {},
    schedule: () => {},
    log: () => {},
    metrics: {
      scan: (outcome) => counted.push(`scan:${outcome}`),
      checkout: (outcome, seconds) => {
        assert.ok(seconds >= 0);
        counted.push(`checkout:${outcome}`);
      },
    },
  });
  await engine.handleMessage(`trolley/${T}/position`, position());
  services.visionDown = true;
  await engine.handleMessage(`trolley/${T}/scan`, scanMsg('bad'));
  services.visionDown = false;
  for (let i = 0; i < 15; i++) await engine.handleMessage(`trolley/${T}/scan`, scanMsg(`ok-${i}`));
  assert.equal(counted.filter((c) => c === 'scan:vision unavailable').length, 1);
  assert.equal(counted.filter((c) => c === 'scan:accepted').length, 15);
  assert.equal(counted.filter((c) => c === 'checkout:paid').length, 1);
});

test('an unknown charge is counted as unknown, not as a failure', async () => {
  const counted: string[] = [];
  const services = new FakeServices();
  services.charge = async () => {
    throw new ChargeUnknownError('timed out');
  };
  const engine = new FleetEngine({
    services,
    store: new MemoryCartStore(),
    broadcast: () => {},
    publish: () => {},
    schedule: () => {},
    log: () => {},
    metrics: { scan: () => {}, checkout: (outcome) => counted.push(outcome) },
  });
  await engine.handleMessage(`trolley/${T}/position`, position());
  for (let i = 0; i < 15; i++) await engine.handleMessage(`trolley/${T}/scan`, scanMsg(`ok-${i}`));
  assert.deepEqual(counted, ['unknown']);
});

test('the number of tracked trolleys is capped', async () => {
  const { engine } = setup();
  for (let i = 0; i < 1100; i++) {
    await engine.handleMessage(`trolley/FLOOD-${i}/position`, position());
  }
  assert.equal(engine.snapshot().length, 1000);
});

test('the snapshot only carries the last three cart items', async () => {
  const ctx = await checkedIn();
  await fillCart(ctx, 5);
  const [row] = ctx.engine.snapshot();
  assert.equal(row.cartItems.length, 3);
  assert.equal(row.itemCount, 5);
});

test('cartFor returns the whole cart for reconciling a client', async () => {
  const ctx = await checkedIn();
  await fillCart(ctx, 5);
  const cart = ctx.engine.cartFor(USER.id);
  assert.equal(cart?.trolleyId, T);
  assert.equal(cart?.items.length, 5);
  assert.equal(cart?.total, 6);
  assert.equal(ctx.engine.cartFor('USR-404'), null);
});
