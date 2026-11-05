import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import Redis from 'ioredis';
import { RedisHotStock } from './hot-stock';

// the check-and-decrement is a lua script, so only a real redis can prove it.
// runs when TEST_REDIS_URL is set, as it is in ci
const url = process.env.TEST_REDIS_URL;
const options = { skip: url ? false : 'set TEST_REDIS_URL to run against redis' };

let raw: Redis;
let hot: RedisHotStock;

before(async () => {
  if (!url) return;
  raw = new Redis(url);
  await raw.flushdb();
  hot = new RedisHotStock(url);
});

after(async () => {
  if (!url) return;
  await hot.close();
  await raw.quit();
});

test('seed keeps a count that is already there', options, async () => {
  await hot.seed('A', 5);
  await hot.seed('A', 99);
  assert.deepEqual([...(await hot.read(['A', 'MISSING']))], [['A', 5]]);
});

test('take reports each outcome and only marks real changes dirty', options, async () => {
  await hot.seed('B', 3);
  await hot.drainDirty();
  assert.deepEqual(await hot.take('MISSING-B', 1), { status: 'unseeded', stock: 0 });
  assert.deepEqual(await hot.take('B', 5), { status: 'insufficient', stock: 3 });
  assert.deepEqual(await hot.drainDirty(), []);
  assert.deepEqual(await hot.take('B', 2), { status: 'ok', stock: 1 });
  assert.deepEqual(await hot.drainDirty(), ['B']);
  assert.deepEqual(await hot.drainDirty(), []);
});

test('fifty racing takes on ten units give exactly ten successes', options, async () => {
  await hot.seed('C', 10);
  const results = await Promise.all(Array.from({ length: 50 }, () => hot.take('C', 1)));
  assert.equal(results.filter((r) => r.status === 'ok').length, 10);
  assert.equal((await hot.read(['C'])).get('C'), 0);
});

test('give adds back, and reports when the count is missing', options, async () => {
  await hot.seed('D', 1);
  assert.equal(await hot.give('D', 4), 5);
  assert.equal(await hot.give('MISSING-D', 4), null);
});

test('overwrite and markDirty', options, async () => {
  await hot.overwrite('E', 7);
  assert.equal((await hot.read(['E'])).get('E'), 7);
  await hot.drainDirty();
  await hot.markDirty('E');
  assert.deepEqual(await hot.drainDirty(), ['E']);
});

test('a dead redis fails quickly so the postgres path can take over', async (t) => {
  const dead = new RedisHotStock('redis://127.0.0.1:1');
  const started = Date.now();
  await assert.rejects(dead.take('X', 1));
  assert.ok(Date.now() - started < 2000, 'should not hang');
  await dead.close();
  t.diagnostic('failed fast');
});
