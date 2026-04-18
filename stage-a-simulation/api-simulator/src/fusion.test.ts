import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuseScan } from './fusion';
import { PRODUCTS } from './products';

const cereal = PRODUCTS.find((p) => p.sku === 'PNT-001')!;

test('accepts a confident scan', () => {
  assert.deepEqual(fuseScan(cereal, 0.85, 450), { accepted: true });
});

test('rejects a scan below 0.60 confidence', () => {
  assert.deepEqual(fuseScan(cereal, 0.59, 450), { accepted: false, reason: 'low confidence' });
});

test('accepts a reading within 10g of the catalog weight', () => {
  assert.equal(fuseScan(cereal, 0.85, 455).accepted, true);
  assert.equal(fuseScan(cereal, 0.85, 440).accepted, true);
});

test('rejects a reading that does not match the catalog weight', () => {
  // the spec's example: vision says cereal, scale says 1000g
  assert.deepEqual(fuseScan(cereal, 0.85, 1000), { accepted: false, reason: 'weight mismatch' });
  assert.equal(fuseScan(cereal, 0.85, 461).accepted, false);
});
