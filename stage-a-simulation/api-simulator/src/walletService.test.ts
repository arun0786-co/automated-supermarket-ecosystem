import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkout, getWallet, getLedger } from './walletService';

// wallet state is module-level, so each test works on a different user or reads the
// balance first instead of assuming the seed value

test('rejects zero, negative and non-finite amounts', () => {
  const before = getWallet('USR-002')!.balance;
  for (const amount of [0, -5, NaN, Infinity]) {
    assert.deepEqual(checkout('USR-002', amount), { ok: false, reason: 'invalid amount' });
  }
  assert.equal(getWallet('USR-002')!.balance, before);
});

test('rejects unknown wallets', () => {
  assert.deepEqual(checkout('USR-999', 1), { ok: false, reason: 'wallet not found' });
});

test('normal purchase debits the wallet and records a block', () => {
  const before = getWallet('USR-001')!.balance;
  const res = checkout('USR-001', 5.5);
  assert.equal(res.ok, true);
  assert.equal(getWallet('USR-001')!.balance, +(before - 5.5).toFixed(2));
  assert.equal(getLedger(1)[0].hash, res.hash);
  assert.equal(getLedger(1)[0].type, 'PURCHASE');
});

test('non-subscriber cannot go negative', () => {
  const balance = getWallet('USR-002')!.balance;
  assert.deepEqual(checkout('USR-002', balance + 1), { ok: false, reason: 'insufficient funds' });
});

test('subscriber can overdraw down to the limit but not past it', () => {
  const w = getWallet('USR-003')!;
  // limit is -50, so balance + 50 is the most this wallet can spend
  assert.equal(checkout('USR-003', w.balance + 51).ok, false);
  assert.equal(checkout('USR-003', w.balance + 20).ok, true);
  assert.equal(getWallet('USR-003')!.balance, -20);
});
