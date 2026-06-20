import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { ProductsService } from './products.service';

// in-memory stand-in for the typeorm repository: findOne and a versioned update.
// `interfere` simulates another shopper bumping the version between our read and write
function fakeRepo(stockLevel: number, interfere = 0) {
  const row = { sku: 'PRD-001', stockLevel, version: 1 };
  return {
    row,
    findOne: async () => ({ ...row }),
    update: async (where: { version: number }, set: { stockLevel: number; version: number }) => {
      if (interfere > 0) {
        interfere--;
        row.stockLevel -= 1;
        row.version += 1;
      }
      if (where.version !== row.version) return { affected: 0 };
      Object.assign(row, set);
      return { affected: 1 };
    },
  };
}

test('pick decrements stock and bumps the version', async () => {
  const repo = fakeRepo(10);
  const service = new ProductsService(repo as never);
  assert.equal(await service.pick('PRD-001', 3), 7);
  assert.deepEqual(repo.row, { sku: 'PRD-001', stockLevel: 7, version: 2 });
});

test('pick retries after a concurrent update and uses the fresh stock level', async () => {
  const repo = fakeRepo(10, 1);
  const service = new ProductsService(repo as never);
  // the other shopper took one, so 10 - 1 - 1 = 8
  assert.equal(await service.pick('PRD-001', 1), 8);
});

test('pick refuses to go below zero', async () => {
  const service = new ProductsService(fakeRepo(1) as never);
  await assert.rejects(service.pick('PRD-001', 2), ConflictException);
});

test('pick gives up after too many conflicts', async () => {
  const service = new ProductsService(fakeRepo(100, 10) as never);
  await assert.rejects(service.pick('PRD-001', 1, 3), /kept changing/);
});
