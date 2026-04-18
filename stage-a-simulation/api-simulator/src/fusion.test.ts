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
