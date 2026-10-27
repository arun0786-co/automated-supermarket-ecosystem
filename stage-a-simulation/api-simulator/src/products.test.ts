import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDynamicPricing, Product, PRODUCTS } from './products';

const base: Product = { sku: 'T-1', name: 'Test', category: 'Test', price: 10, weight: 100, emoji: '', daysToExpiry: 0 };

test('discounts 20% only when less than 2 days to expiry', () => {
  assert.deepEqual(applyDynamicPricing({ ...base, daysToExpiry: 1 }), { price: 8, discounted: true });
  assert.deepEqual(applyDynamicPricing({ ...base, daysToExpiry: 2 }), { price: 10, discounted: false });
  assert.deepEqual(applyDynamicPricing({ ...base, daysToExpiry: 5 }), { price: 10, discounted: false });
});

test('non-perishables (daysToExpiry 0) are never discounted', () => {
  assert.deepEqual(applyDynamicPricing({ ...base, daysToExpiry: 0 }), { price: 10, discounted: false });
});

test('catalog skus are unique', () => {
  assert.equal(new Set(PRODUCTS.map((p) => p.sku)).size, PRODUCTS.length);
});
