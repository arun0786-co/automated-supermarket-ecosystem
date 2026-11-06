import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics } from './metrics';

test('the metrics the spec names are all exposed', async () => {
  const metrics = createMetrics(() => [{ itemCount: 2 }, { itemCount: 0 }, { itemCount: 5 }]);
  const text = await metrics.registry.metrics();
  // chapter 11.2: "Active Carts", "Transaction Latency"
  assert.match(text, /ase_active_carts 2/);
  assert.match(text, /# TYPE ase_transaction_latency_seconds histogram/);
});

test('active carts only counts carts with something in them', async () => {
  const metrics = createMetrics(() => [{ itemCount: 0 }]);
  assert.match(await metrics.registry.metrics(), /ase_active_carts 0/);
});

test('scans are counted by outcome', async () => {
  const metrics = createMetrics(() => []);
  metrics.scan('accepted');
  metrics.scan('accepted');
  metrics.scan('weight mismatch');
  const text = await metrics.registry.metrics();
  assert.match(text, /ase_scans_total\{outcome="accepted"\} 2/);
  assert.match(text, /ase_scans_total\{outcome="weight mismatch"\} 1/);
});

test('a checkout records its outcome and how long it took', async () => {
  const metrics = createMetrics(() => []);
  metrics.checkout('paid', 0.25);
  const text = await metrics.registry.metrics();
  assert.match(text, /ase_checkouts_total\{outcome="paid"\} 1/);
  assert.match(text, /ase_transaction_latency_seconds_sum\{outcome="paid"\} 0\.25/);
  assert.match(text, /ase_transaction_latency_seconds_count\{outcome="paid"\} 1/);
});

test('each engine has its own numbers', async () => {
  const first = createMetrics(() => []);
  const second = createMetrics(() => []);
  first.scan('accepted');
  assert.doesNotMatch(await second.registry.metrics(), /ase_scans_total\{/);
});
