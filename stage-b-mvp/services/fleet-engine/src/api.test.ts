import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { createApi } from './api';

const USERS: Record<string, { id: string; name: string; walletAddress: string }> = {
  'USR-001': { id: 'USR-001', name: 'Arun K.', walletAddress: '0x1' },
  'USR-002': { id: 'USR-002', name: 'Priya M.', walletAddress: '0x2' },
};

let vaultDown = false;
let server: Server;
let base: string;

before(async () => {
  const app = createApi({
    health: () => ({ status: 'ok' }),
    snapshot: () => [{ id: 'T1' }],
    cartFor: (id) => (id === 'USR-001' ? { trolleyId: 'T1', status: 'SHOPPING', items: [], total: 0 } : null),
    getUser: async (id) => USERS[id] ?? null,
    listCustomers: async () => Object.values(USERS),
    walletOf: async (user) => {
      if (vaultDown) throw new Error('vault is down');
      return { userId: user.id, name: user.name, balance: 1, overdraftLimit: 0, isSubscriber: false };
    },
    metrics: async () => ({ contentType: 'text/plain; version=0.0.4', body: 'ase_active_carts 1\n' }),
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

const as = (userId: string, role: string) => ({ 'x-user-id': userId, 'x-user-role': role });
const ADMIN = as('ADM-001', 'admin');
const ARUN = as('USR-001', 'customer');
const get = (path: string, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { headers });

test('customers read their own wallet and not anyone elses', async () => {
  assert.equal((await get('/api/wallets/USR-001', ARUN)).status, 200);
  assert.equal((await get('/api/wallets/USR-002', ARUN)).status, 403);
});

test('asking for someone elses wallet looks the same whether or not they exist', async () => {
  const real = await get('/api/wallets/USR-002', ARUN);
  const made_up = await get('/api/wallets/USR-404', ARUN);
  assert.equal(real.status, made_up.status);
  assert.deepEqual(await real.json(), await made_up.json());
});

test('an admin reads any wallet and the whole list', async () => {
  assert.equal((await get('/api/wallets/USR-002', ADMIN)).status, 200);
  const list = (await (await get('/api/wallets', ADMIN)).json()) as unknown[];
  assert.equal(list.length, 2);
});

test('a customer can not list wallets or see the fleet', async () => {
  assert.equal((await get('/api/wallets', ARUN)).status, 403);
  assert.equal((await get('/api/fleet/trolleys', ARUN)).status, 403);
  assert.equal((await get('/api/fleet/trolleys', ADMIN)).status, 200);
});

test('carts follow the same rule', async () => {
  assert.equal((await get('/api/fleet/cart/USR-001', ARUN)).status, 200);
  assert.equal((await get('/api/fleet/cart/USR-002', ARUN)).status, 403);
  assert.equal((await get('/api/fleet/cart/USR-002', ADMIN)).status, 200);
});

test('a customer with no trolley gets an empty cart', async () => {
  const body = (await (await get('/api/fleet/cart/USR-002', ADMIN)).json()) as { trolleyId: unknown; items: unknown[] };
  assert.equal(body.trolleyId, null);
  assert.deepEqual(body.items, []);
});

test('no identity from the gateway means no data', async () => {
  for (const path of ['/api/wallets', '/api/wallets/USR-001', '/api/fleet/trolleys', '/api/fleet/cart/USR-001']) {
    assert.equal((await get(path)).status, 401, path);
  }
});

test('an unknown wallet is a 404 for an admin', async () => {
  assert.equal((await get('/api/wallets/USR-404', ADMIN)).status, 404);
});

test('a vault outage is a 503, not a crash', async () => {
  vaultDown = true;
  assert.equal((await get('/api/wallets', ADMIN)).status, 503);
  assert.equal((await get('/api/wallets/USR-001', ARUN)).status, 503);
  vaultDown = false;
});

test('health needs no identity', async () => {
  assert.equal((await get('/api/health')).status, 200);
});

test('metrics are plain text for prometheus', async () => {
  const res = await get('/metrics');
  assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
  assert.equal(await res.text(), 'ase_active_carts 1\n');
});
