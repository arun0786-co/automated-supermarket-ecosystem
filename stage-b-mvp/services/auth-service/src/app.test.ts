import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { SignJWT } from 'jose';
import { createApp } from './app';
import { hashPassword } from './passwords';
import { MemoryUsers } from './users';

const SECRET = 'x'.repeat(40);
const COST = 2 ** 4; // cheap hashing, only for tests

let server: Server;
let base: string;
let users: MemoryUsers;
let now = Date.now();

before(async () => {
  users = new MemoryUsers();
  const app = createApp({ users, jwtSecret: SECRET, scryptCost: COST, now: () => now });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

beforeEach(async () => {
  now = Date.now();
  users.clear();
  await users.create({ id: 'USR-001', email: 'arun@ase.local', name: 'Arun K.', passwordHash: await hashPassword('correct horse', COST), role: 'customer', walletAddress: '0xaaa' });
  await users.create({ id: 'ADM-001', email: 'admin@ase.local', name: 'Store Admin', passwordHash: await hashPassword('admin password', COST), role: 'admin', walletAddress: '0xbbb' });
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function login(email = 'arun@ase.local', password = 'correct horse') {
  const res = await post('/api/auth/login', { email, password });
  assert.equal(res.status, 200);
  return res.json() as Promise<{ accessToken: string; refreshToken: string; expiresIn: number; user: { id: string; name: string; role: string } }>;
}

const verify = (token?: string, query = '', headers: Record<string, string> = {}) =>
  fetch(`${base}/internal/verify${query}`, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });

test('login returns a short-lived token and the user', async () => {
  const body = await login();
  assert.deepEqual(body.user, { id: 'USR-001', name: 'Arun K.', role: 'customer' });
  assert.equal(body.expiresIn, 900);
  assert.equal(typeof body.accessToken, 'string');
  assert.equal(typeof body.refreshToken, 'string');
});

test('login is not case sensitive on the email', async () => {
  assert.equal((await post('/api/auth/login', { email: 'ARUN@ase.local', password: 'correct horse' })).status, 200);
});

test('a wrong password and an unknown email look the same', async () => {
  const wrong = await post('/api/auth/login', { email: 'arun@ase.local', password: 'nope nope' });
  const unknown = await post('/api/auth/login', { email: 'ghost@ase.local', password: 'nope nope' });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(await wrong.json(), await unknown.json());
});

for (const [label, body] of [
  ['no fields', {}],
  ['non-string password', { email: 'arun@ase.local', password: 12345678 }],
  ['object as email', { email: { $ne: null }, password: 'x' }],
] as const) {
  test(`malformed login is a 400: ${label}`, async () => {
    assert.equal((await post('/api/auth/login', body)).status, 400);
  });
}

test('malformed json is a 400, not a crash', async () => {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
  assert.equal(res.status, 400);
});

test('verify returns who the token belongs to', async () => {
  const { accessToken } = await login();
  const res = await verify(accessToken);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('x-user-id'), 'USR-001');
  assert.equal(res.headers.get('x-user-role'), 'customer');
  assert.ok(Number(res.headers.get('x-token-exp')) > Date.now() / 1000);
});

test('verify with no token is a 401', async () => {
  assert.equal((await verify()).status, 401);
});

test('a tampered token is a 401', async () => {
  const { accessToken } = await login();
  const [h, p, s] = accessToken.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  const forged = Buffer.from(JSON.stringify({ ...claims, role: 'admin' })).toString('base64url');
  assert.equal((await verify(`${h}.${forged}.${s}`)).status, 401);
});

test('a token signed with another secret is a 401', async () => {
  const other = await new SignJWT({ role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setSubject('ADM-001').setIssuer('ase-auth').setExpirationTime('5m').sign(new TextEncoder().encode('some-other-secret-that-is-long-enough'));
  assert.equal((await verify(other)).status, 401);
});

test('an alg none token is a 401', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'ADM-001', role: 'admin', iss: 'ase-auth', exp: 9999999999 })).toString('base64url');
  assert.equal((await verify(`${header}.${payload}.`)).status, 401);
});

test('an expired token is a 401', async () => {
  const expired = await new SignJWT({ role: 'customer' }).setProtectedHeader({ alg: 'HS256' }).setSubject('USR-001').setIssuer('ase-auth').setExpirationTime(Math.floor(Date.now() / 1000) - 10).sign(new TextEncoder().encode(SECRET));
  assert.equal((await verify(expired)).status, 401);
});

test('a role requirement is a 403 for everyone else', async () => {
  const customer = await login();
  const admin = await login('admin@ase.local', 'admin password');
  assert.equal((await verify(customer.accessToken, '?role=admin')).status, 403);
  assert.equal((await verify(admin.accessToken, '?role=admin')).status, 204);
});

test('a websocket can send its token in the original uri', async () => {
  const { accessToken } = await login();
  const res = await verify(undefined, '', { 'x-original-uri': `/ws?token=${accessToken}` });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('x-user-id'), 'USR-001');
});

test('refresh rotates the token', async () => {
  const first = await login();
  const res = await post('/api/auth/refresh', { refreshToken: first.refreshToken });
  assert.equal(res.status, 200);
  const second = (await res.json()) as { accessToken: string; refreshToken: string };
  assert.notEqual(second.refreshToken, first.refreshToken);
  assert.equal((await verify(second.accessToken)).status, 204);
});

test('reusing an old refresh token revokes the whole family', async () => {
  const first = await login();
  const secondRes = await post('/api/auth/refresh', { refreshToken: first.refreshToken });
  const second = (await secondRes.json()) as { refreshToken: string };

  assert.equal((await post('/api/auth/refresh', { refreshToken: first.refreshToken })).status, 401);
  // the thief and the customer can't tell who is who, so both have to log in again
  assert.equal((await post('/api/auth/refresh', { refreshToken: second.refreshToken })).status, 401);
});

test('two refreshes racing with one token: at most one wins', async () => {
  const { refreshToken } = await login();
  const results = await Promise.all([1, 2].map(() => post('/api/auth/refresh', { refreshToken })));
  assert.ok(results.filter((r) => r.status === 200).length <= 1);
});

test('an expired refresh token is a 401', async () => {
  const { refreshToken } = await login();
  now += 8 * 24 * 60 * 60 * 1000;
  assert.equal((await post('/api/auth/refresh', { refreshToken })).status, 401);
});

test('an unknown refresh token is a 401', async () => {
  assert.equal((await post('/api/auth/refresh', { refreshToken: 'made-up' })).status, 401);
});

test('logout ends the refresh token', async () => {
  const { refreshToken } = await login();
  assert.equal((await post('/api/auth/logout', { refreshToken })).status, 204);
  assert.equal((await post('/api/auth/refresh', { refreshToken })).status, 401);
});

test('register creates a customer with their own wallet address', async () => {
  const res = await post('/api/auth/register', { email: 'new@ase.local', name: 'New Person', password: 'long enough password' });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { user: { id: string; role: string } };
  assert.equal(body.user.role, 'customer');
  const internal = (await (await fetch(`${base}/internal/users/${body.user.id}`)).json()) as { walletAddress: string };
  assert.match(internal.walletAddress, /^0x[0-9a-f]{40}$/);
});

test('register can not pick its own role', async () => {
  const res = await post('/api/auth/register', { email: 'sneaky@ase.local', name: 'Sneaky', password: 'long enough password', role: 'admin' });
  assert.equal(((await res.json()) as { user: { role: string } }).user.role, 'customer');
});

test('register refuses a taken email, whatever its case', async () => {
  const res = await post('/api/auth/register', { email: 'ARUN@ase.local', name: 'Copy', password: 'long enough password' });
  assert.equal(res.status, 409);
});

for (const [label, body] of [
  ['short password', { email: 'x@ase.local', name: 'X', password: 'short' }],
  ['absurdly long password', { email: 'x@ase.local', name: 'X', password: 'x'.repeat(5000) }],
  ['bad email', { email: 'not-an-email', name: 'X', password: 'long enough password' }],
  ['no name', { email: 'x@ase.local', password: 'long enough password' }],
] as const) {
  test(`register validates: ${label}`, async () => {
    assert.equal((await post('/api/auth/register', body)).status, 400);
  });
}

test('me needs a token and returns the user', async () => {
  assert.equal((await fetch(`${base}/api/auth/me`)).status, 401);
  const { accessToken } = await login();
  const res = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${accessToken}` } });
  assert.deepEqual(await res.json(), { id: 'USR-001', name: 'Arun K.', email: 'arun@ase.local', role: 'customer', walletAddress: '0xaaa' });
});

const forget = (token: string, password: string) =>
  fetch(`${base}/api/auth/me`, { method: 'DELETE', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ password }) });

test('forgetting a user needs the password', async () => {
  const { accessToken } = await login();
  assert.equal((await forget(accessToken, 'wrong password')).status, 401);
  assert.equal((await fetch(`${base}/internal/users/USR-001`)).status, 200);
});

// chapter 10.3: deleting the off-chain mapping leaves the on-chain history anonymous
test('forgetting a user removes the mapping and every way back in', async () => {
  const { accessToken, refreshToken } = await login();
  assert.equal((await forget(accessToken, 'correct horse')).status, 204);

  assert.equal((await fetch(`${base}/internal/users/USR-001`)).status, 404);
  assert.equal((await post('/api/auth/login', { email: 'arun@ase.local', password: 'correct horse' })).status, 401);
  assert.equal((await post('/api/auth/refresh', { refreshToken })).status, 401);
  // the access token is still in date, but it now names nobody
  assert.equal((await verify(accessToken)).status, 401);
  assert.equal(users.findStoredPersonalData('arun@ase.local').length, 0);
});

test('internal lookup and listing', async () => {
  const one = (await (await fetch(`${base}/internal/users/USR-001`)).json()) as Record<string, unknown>;
  assert.deepEqual(one, { id: 'USR-001', name: 'Arun K.', walletAddress: '0xaaa' });
  assert.equal((await fetch(`${base}/internal/users/NOPE`)).status, 404);
  const all = (await (await fetch(`${base}/internal/customers`)).json()) as { id: string }[];
  assert.deepEqual(all.map((u) => u.id), ['USR-001']);
});

test('password hashes never leave the service', async () => {
  const { accessToken } = await login();
  const responses = await Promise.all([
    fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${accessToken}` } }),
    fetch(`${base}/internal/users/USR-001`),
    fetch(`${base}/internal/customers`),
  ]);
  for (const res of responses) assert.doesNotMatch(await res.text(), /scrypt|passwordHash|password_hash/);
});

test('health', async () => {
  const body = (await (await fetch(`${base}/api/health`)).json()) as { service: string };
  assert.equal(body.service, 'auth-service');
});
