import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, Server, RequestListener } from 'node:http';
import { AddressInfo } from 'node:net';
import { httpServices } from './http-services';
import { ChargeUnknownError } from './types';

let server: Server;
let handler: RequestListener = () => {};
let url: string;

before(async () => {
  server = createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

const services = (overrides: Partial<Parameters<typeof httpServices>[0]> = {}) =>
  httpServices({ vision: url, products: url, vault: url, auth: url, ai: url, chargeTimeoutMs: 100, ...overrides });

function respond(status: number, body: unknown = {}): RequestListener {
  return (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
}

test('a successful charge maps the vault response', async () => {
  handler = respond(200, { ok: true, hash: '0xabc', blockNumber: 7, overdraftUsed: '4.5' });
  assert.deepEqual(await services().checkout('0x1', '10.00', ['A']), { ok: true, hash: '0xabc', overdraftUsed: 4.5 });
});

test('a refused charge maps the reason', async () => {
  handler = respond(200, { ok: false, hash: '0xabc', reason: 'insufficient funds' });
  const result = await services().checkout('0x1', '10.00', []);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'insufficient funds');
});

test('the charge request carries the customer, amount and items', async () => {
  let seen: any;
  handler = (req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen = { url: req.url, method: req.method, body: JSON.parse(raw) };
      respond(200, { ok: true, hash: '0x' })(req, res);
    });
  };
  await services().checkout('0x1', '12.50', ['A', 'B']);
  assert.deepEqual(seen, { url: '/api/checkout', method: 'POST', body: { customer: '0x1', amount: '12.50', cartItems: [{ sku: 'A' }, { sku: 'B' }] } });
});

test('a vault that never connected certainly did not charge', async () => {
  // a port that was just free, so nothing is listening on it
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));

  const charge = services({ vault: `http://127.0.0.1:${port}` }).checkout('0x1', '1.00', []);
  await assert.rejects(charge, (err: Error) => !(err instanceof ChargeUnknownError));
});

test('a timeout could have charged, so the outcome is unknown', async () => {
  handler = () => {}; // never answers
  await assert.rejects(services().checkout('0x1', '1.00', []), ChargeUnknownError);
});

test('a dropped connection could have charged, so the outcome is unknown', async () => {
  handler = (req) => req.socket.destroy();
  await assert.rejects(services().checkout('0x1', '1.00', []), ChargeUnknownError);
});

test('a 500 could have charged, so the outcome is unknown', async () => {
  handler = respond(500, { error: 'nonce too low' });
  await assert.rejects(services().checkout('0x1', '1.00', []), ChargeUnknownError);
});

test('a garbled 200 could have charged, so the outcome is unknown', async () => {
  handler = (_req, res) => {
    res.writeHead(200);
    res.end('<html>');
  };
  await assert.rejects(services().checkout('0x1', '1.00', []), ChargeUnknownError);
});

test('a 400 was refused before any charge', async () => {
  handler = respond(400, { error: 'bad amount' });
  await assert.rejects(services().checkout('0x1', '1.00', []), (err: Error) => !(err instanceof ChargeUnknownError));
});

test('pick returns the stock level, null on a conflict, throws otherwise', async () => {
  handler = respond(201, { sku: 'A', stockLevel: 9 });
  assert.equal(await services().pick('A'), 9);
  handler = respond(409, { message: 'only 0 left' });
  assert.equal(await services().pick('A'), null);
  handler = respond(500);
  await assert.rejects(services().pick('A'));
});

test('skus are escaped into the url', async () => {
  let seen = '';
  handler = (req, res) => {
    seen = req.url ?? '';
    respond(200, {})(req, res);
  };
  await services().getProduct('../../admin');
  assert.equal(seen, '/api/products/..%2F..%2Fadmin');
});

test('getProduct returns null on 404', async () => {
  handler = respond(404);
  assert.equal(await services().getProduct('A'), null);
});

test('product prices arrive as numbers', async () => {
  handler = respond(200, { sku: 'A', name: 'x', emoji: 'y', category: 'c', price: '2.40', weight: 200, stockLevel: 5, discountThreshold: 10, daysToExpiry: 1, discounted: true });
  assert.equal((await services().getProduct('A'))?.price, 2.4);
});

test('getUser returns null on 404', async () => {
  handler = respond(404);
  assert.equal(await services().getUser('USR-404'), null);
});

test('a vision failure throws', async () => {
  handler = respond(503, { detail: 'no vision model loaded' });
  await assert.rejects(services().scan({ weightDelta: 1 }));
});

test('purchases and feedback send no customer identity', async () => {
  const bodies: string[] = [];
  handler = (req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      bodies.push(raw);
      respond(200, {})(req, res);
    });
  };
  await services().recordPurchase(['A', 'B']);
  await services().sendFeedback('A', 1, { aisle: 1, hour: 2, cartCategories: [] });
  assert.deepEqual(JSON.parse(bodies[0]), { skus: ['A', 'B'] });
  assert.doesNotMatch(bodies[1], /user/i);
});
