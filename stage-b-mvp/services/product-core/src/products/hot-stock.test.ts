import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { HotStock, TakeResult } from './hot-stock';

// behaves like the redis script: one at a time, nothing interleaves inside a call
class FakeHotStock implements HotStock {
  stock = new Map<string, number>();
  dirty = new Set<string>();
  down = false;

  private check() {
    if (this.down) throw new Error('redis is down');
  }
  async seed(sku: string, stock: number) {
    this.check();
    if (!this.stock.has(sku)) this.stock.set(sku, stock);
  }
  async take(sku: string, quantity: number): Promise<TakeResult> {
    this.check();
    const stock = this.stock.get(sku);
    if (stock === undefined) return { status: 'unseeded', stock: 0 };
    if (stock < quantity) return { status: 'insufficient', stock };
    this.stock.set(sku, stock - quantity);
    this.dirty.add(sku);
    return { status: 'ok', stock: stock - quantity };
  }
  async give(sku: string, quantity: number) {
    this.check();
    const stock = this.stock.get(sku);
    if (stock === undefined) return null;
    this.stock.set(sku, stock + quantity);
    this.dirty.add(sku);
    return stock + quantity;
  }
  async read(skus: string[]) {
    this.check();
    return new Map(skus.filter((s) => this.stock.has(s)).map((s) => [s, this.stock.get(s)!]));
  }
  async overwrite(sku: string, stock: number) {
    this.check();
    this.stock.set(sku, stock);
  }
  async drainDirty() {
    this.check();
    const skus = [...this.dirty];
    this.dirty.clear();
    return skus;
  }
  async markDirty(sku: string) {
    this.check();
    this.dirty.add(sku);
  }
  async close() {}
}

// in-memory stand-in for the typeorm repository
function fakeRepo(rows: Record<string, number>) {
  const table = new Map(Object.entries(rows).map(([sku, stockLevel]) => [sku, { sku, stockLevel, version: 1, price: '10.00', daysToExpiry: 1, discountThreshold: 10, active: true }]));
  return {
    table,
    updates: [] as { sku: string; stockLevel: number }[],
    failUpdates: false,
    find: async function () { return [...table.values()].map((r) => ({ ...r })); },
    findOne: async ({ where: { sku } }: { where: { sku: string } }) => {
      const row = table.get(sku);
      return row ? { ...row } : null;
    },
    update: async function (where: { sku: string; version?: number }, set: { stockLevel: number; version?: number }) {
      if (this.failUpdates) throw new Error('postgres is down');
      const row = table.get(where.sku);
      if (!row || (where.version !== undefined && where.version !== row.version)) return { affected: 0 };
      row.stockLevel = set.stockLevel;
      row.version = set.version ?? row.version + 1;
      this.updates.push({ sku: where.sku, stockLevel: set.stockLevel });
      return { affected: 1 };
    },
  };
}

function setup(rows: Record<string, number>) {
  const repo = fakeRepo(rows);
  const hot = new FakeHotStock();
  return { repo, hot, service: new ProductsService(repo as never, hot) };
}

test('startup copies stock into the hot store without overwriting what is there', async () => {
  const { service, hot } = setup({ 'PRD-001': 10, 'PRD-002': 5 });
  hot.stock.set('PRD-001', 3); // already live from before a restart
  await service.seedHotStock();
  assert.equal(hot.stock.get('PRD-001'), 3);
  assert.equal(hot.stock.get('PRD-002'), 5);
});

test('pick decrements the hot count and leaves postgres for the write-back', async () => {
  const { service, repo, hot } = setup({ 'PRD-001': 10 });
  await service.seedHotStock();
  assert.equal(await service.pick('PRD-001', 3), 7);
  assert.equal(hot.stock.get('PRD-001'), 7);
  assert.equal(repo.table.get('PRD-001')!.stockLevel, 10);
});

test('the last unit goes to exactly one of two simultaneous picks', async () => {
  const { service } = setup({ 'PRD-001': 1 });
  await service.seedHotStock();
  const results = await Promise.allSettled([service.pick('PRD-001'), service.pick('PRD-001')]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.ok(lost.reason instanceof ConflictException);
});

test('asking for more than is left says how many are left', async () => {
  const { service } = setup({ 'PRD-001': 2 });
  await service.seedHotStock();
  await assert.rejects(service.pick('PRD-001', 5), /only 2 of PRD-001 left/);
});

test('a sku the hot store lost is reloaded from postgres, then picked', async () => {
  const { service, hot } = setup({ 'PRD-001': 10 });
  assert.equal(hot.stock.size, 0); // redis restarted empty
  assert.equal(await service.pick('PRD-001', 1), 9);
  assert.equal(hot.stock.get('PRD-001'), 9);
});

test('an unknown sku is a 404 and leaves nothing in the hot store', async () => {
  const { service, hot } = setup({ 'PRD-001': 10 });
  await assert.rejects(service.pick('NOPE-1'), NotFoundException);
  assert.equal(hot.stock.has('NOPE-1'), false);
});

test('with redis down, pick falls back to the versioned postgres update', async () => {
  const { service, repo, hot } = setup({ 'PRD-001': 10 });
  await service.seedHotStock();
  hot.down = true;
  assert.equal(await service.pick('PRD-001', 2), 8);
  assert.equal(repo.table.get('PRD-001')!.stockLevel, 8);
  assert.equal(repo.table.get('PRD-001')!.version, 2);
});

test('with redis down, the last unit still goes to exactly one pick', async () => {
  const { service, hot } = setup({ 'PRD-001': 1 });
  await service.seedHotStock();
  hot.down = true;
  const results = await Promise.allSettled([service.pick('PRD-001'), service.pick('PRD-001')]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});

test('write-back stores the absolute hot count, once per changed sku', async () => {
  const { service, repo } = setup({ 'PRD-001': 10, 'PRD-002': 5 });
  await service.seedHotStock();
  await service.pick('PRD-001', 1);
  await service.pick('PRD-001', 1);
  await service.flushHotStock();
  assert.deepEqual(repo.updates, [{ sku: 'PRD-001', stockLevel: 8 }]);
  await service.flushHotStock();
  assert.equal(repo.updates.length, 1); // nothing changed, nothing written
});

test('a failed write-back is retried on the next flush', async () => {
  const { service, repo } = setup({ 'PRD-001': 10 });
  await service.seedHotStock();
  await service.pick('PRD-001', 1);
  repo.failUpdates = true;
  await service.flushHotStock();
  assert.equal(repo.table.get('PRD-001')!.stockLevel, 10);
  repo.failUpdates = false;
  await service.flushHotStock();
  assert.equal(repo.table.get('PRD-001')!.stockLevel, 9);
});

test('after an outage the lower of the two counts wins, so nothing is oversold', async () => {
  const { service, repo, hot } = setup({ 'PRD-001': 10 });
  await service.seedHotStock();
  hot.down = true;
  await service.pick('PRD-001', 4); // postgres says 6, redis still says 10
  hot.down = false;
  await service.flushHotStock();
  assert.equal(hot.stock.get('PRD-001'), 6);
  assert.equal(repo.table.get('PRD-001')!.stockLevel, 6);
  assert.equal(await service.pick('PRD-001', 6), 0);
  await assert.rejects(service.pick('PRD-001'), ConflictException);
});

test('the catalog shows hot stock, so pricing reacts immediately', async () => {
  const { service } = setup({ 'PRD-001': 11 }); // 1 day to expiry, threshold 10: discounted
  await service.seedHotStock();
  assert.equal((await service.getAllWithPricing())[0].discounted, true);
  await service.pick('PRD-001', 1); // now at the threshold, back to full price
  const [row] = await service.getAllWithPricing();
  assert.equal(row.stockLevel, 10);
  assert.equal(row.discounted, false);
});

test('the catalog still answers with redis down', async () => {
  const { service, hot } = setup({ 'PRD-001': 11 });
  await service.seedHotStock();
  hot.down = true;
  assert.equal((await service.getAllWithPricing())[0].stockLevel, 11);
  assert.equal((await service.findBySku('PRD-001')).stockLevel, 11);
});

test('release puts stock back', async () => {
  const { service } = setup({ 'PRD-001': 10 });
  await service.seedHotStock();
  await service.pick('PRD-001', 3);
  assert.equal(await service.release('PRD-001', 2), 9);
});

test('release works with redis down', async () => {
  const { service, repo, hot } = setup({ 'PRD-001': 10 });
  await service.seedHotStock();
  hot.down = true;
  assert.equal(await service.release('PRD-001', 2), 12);
  assert.equal(repo.table.get('PRD-001')!.stockLevel, 12);
});

test('release of an unknown sku is a 404', async () => {
  const { service } = setup({ 'PRD-001': 10 });
  await assert.rejects(service.release('NOPE-1', 1), NotFoundException);
});
