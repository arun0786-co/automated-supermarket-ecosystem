import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProductsService } from './products.service';
import { Product } from './product.entity';

// applyPricing doesn't touch the repository, so no database is needed
const service = new ProductsService(null as never);

function product(daysToExpiry: number, stockLevel: number): Product {
  return Object.assign(new Product(), { price: '10.00', daysToExpiry, stockLevel, discountThreshold: 10 });
}

test('discounts 20% when under 2 days to expiry and stock is above threshold', () => {
  assert.deepEqual(service.applyPricing(product(1, 40)), { price: 8, discounted: true });
});

test('full price when stock is at or below threshold', () => {
  assert.deepEqual(service.applyPricing(product(1, 10)), { price: 10, discounted: false });
});

test('full price at 2 or more days to expiry', () => {
  assert.deepEqual(service.applyPricing(product(2, 40)), { price: 10, discounted: false });
});

test('non-perishables are never discounted', () => {
  assert.deepEqual(service.applyPricing(product(0, 400)), { price: 10, discounted: false });
});
