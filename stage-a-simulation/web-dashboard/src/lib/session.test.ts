import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, type SessionDeps } from './session.ts';

type Reply = { status: number; body?: unknown };

function setup(replies: Record<string, Reply | ((init: RequestInit) => Reply | Promise<Reply>)> = {}, startMs = 1_000_000) {
  const calls: { url: string; init: RequestInit }[] = [];
  const stored = new Map<string, string>();
  let expired = 0;
  let now = startMs;
  const deps: SessionDeps = {
    base: 'http://gw',
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      const reply = replies[String(url).replace('http://gw', '')] ?? { status: 404 };
      const { status, body } = typeof reply === 'function' ? await reply(init) : reply;
      return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status });
    },
    storage: {
      getItem: (k) => stored.get(k) ?? null,
      setItem: (k, v) => void stored.set(k, v),
      removeItem: (k) => void stored.delete(k),
    },
    now: () => now,
    onExpired: () => {
      expired++;
    },
  };
  return {
    session: new Session(deps),
    calls,
    stored,
    expiredCount: () => expired,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const tokens = (n: number, expiresIn = 900) => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
  expiresIn,
  user: { id: 'ADM-001', name: 'Store Admin', role: 'admin' },
});

const LOGIN = '/api/auth/login';
const REFRESH = '/api/auth/refresh';

test('login stores only the refresh token and exposes the user', async () => {
  const { session, stored } = setup({ [LOGIN]: { status: 200, body: tokens(1) } });
  await session.login('a@b.c', 'pw');
  assert.equal(session.user?.name, 'Store Admin');
  assert.equal(await session.token(), 'access-1');
  assert.deepEqual([...stored.values()], ['refresh-1']);
});

test('a wrong password says so and leaves nobody logged in', async () => {
  const { session } = setup({ [LOGIN]: { status: 401, body: { error: 'invalid email or password' } } });
  await assert.rejects(session.login('a@b.c', 'no'), /invalid email or password/i);
  assert.equal(session.user, null);
});

test('being rate limited gets its own message', async () => {
  const { session } = setup({ [LOGIN]: { status: 429 } });
  await assert.rejects(session.login('a@b.c', 'pw'), /too many attempts/i);
});

test('a dead gateway gets its own message', async () => {
  const { session } = setup({
    [LOGIN]: () => {
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(session.login('a@b.c', 'pw'), /could not reach/i);
});

test('a token close to expiry is refreshed before use', async () => {
  const { session, advance } = setup({
    [LOGIN]: { status: 200, body: tokens(1) },
    [REFRESH]: { status: 200, body: tokens(2) },
  });
  await session.login('a@b.c', 'pw');
  advance(890_000);
  assert.equal(await session.token(), 'access-2');
});

// a refresh token only works once and reuse revokes the session, so racing would log people out
test('requests at the same moment share one refresh', async () => {
  let refreshes = 0;
  const { session, advance } = setup({
    [LOGIN]: { status: 200, body: tokens(1) },
    [REFRESH]: async () => {
      refreshes++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { status: 200, body: tokens(2) };
    },
  });
  await session.login('a@b.c', 'pw');
  advance(890_000);
  const results = await Promise.all([session.token(), session.token(), session.token()]);
  assert.equal(refreshes, 1);
  assert.deepEqual(results, ['access-2', 'access-2', 'access-2']);
});

test('a refused refresh ends the session and tells the app', async () => {
  const { session, stored, advance, expiredCount } = setup({
    [LOGIN]: { status: 200, body: tokens(1) },
    [REFRESH]: { status: 401 },
  });
  await session.login('a@b.c', 'pw');
  advance(1_000_000);
  assert.equal(await session.token(), null);
  assert.equal(session.user, null);
  assert.equal(stored.size, 0);
  assert.equal(expiredCount(), 1);
});

test('a network blip during refresh keeps the session', async () => {
  let down = true;
  const { session, stored, advance, expiredCount } = setup({
    [LOGIN]: { status: 200, body: tokens(1) },
    [REFRESH]: () => {
      if (down) throw new TypeError('fetch failed');
      return { status: 200, body: tokens(2) };
    },
  });
  await session.login('a@b.c', 'pw');
  advance(1_000_000);
  assert.equal(await session.token(), null);
  assert.equal(expiredCount(), 0);
  assert.equal(stored.size, 1);
  down = false;
  assert.equal(await session.token(), 'access-2');
});

test('fetch sends the token', async () => {
  const { session, calls } = setup({
    [LOGIN]: { status: 200, body: tokens(1) },
    '/api/wallets': { status: 200, body: [] },
  });
  await session.login('a@b.c', 'pw');
  await session.fetch('/api/wallets');
  const sent = new Headers(calls.at(-1)!.init.headers);
  assert.equal(sent.get('authorization'), 'Bearer access-1');
});

test('fetch retries once with a fresh token after a 401', async () => {
  let first = true;
  const { session } = setup({
    [LOGIN]: { status: 200, body: tokens(1) },
    [REFRESH]: { status: 200, body: tokens(2) },
    '/api/wallets': () => {
      if (first) {
        first = false;
        return { status: 401 };
      }
      return { status: 200, body: ['ok'] };
    },
  });
  await session.login('a@b.c', 'pw');
  const res = await session.fetch('/api/wallets');
  assert.equal(res.status, 200);
});

test('fetch gives up after one retry', async () => {
  let attempts = 0;
  const { session, expiredCount } = setup({
    [LOGIN]: { status: 200, body: tokens(1) },
    [REFRESH]: { status: 200, body: tokens(2) },
    '/api/wallets': () => {
      attempts++;
      return { status: 401 };
    },
  });
  await session.login('a@b.c', 'pw');
  const res = await session.fetch('/api/wallets');
  assert.equal(res.status, 401);
  assert.equal(attempts, 2);
  assert.equal(expiredCount(), 1);
});

test('a page reload picks the session back up', async () => {
  const first = setup({ [LOGIN]: { status: 200, body: tokens(1) } });
  await first.session.login('a@b.c', 'pw');

  const stored = first.stored;
  const reload = setup({ [REFRESH]: { status: 200, body: tokens(2) } });
  for (const [k, v] of stored) reload.stored.set(k, v);
  assert.equal(await reload.session.restore(), true);
  assert.equal(reload.session.user?.id, 'ADM-001');
  assert.equal(await reload.session.token(), 'access-2');
});

test('nothing stored means nothing to restore, and no request', async () => {
  const { session, calls } = setup();
  assert.equal(await session.restore(), false);
  assert.equal(calls.length, 0);
});

test('logout clears everything and tells the server', async () => {
  const { session, stored, calls } = setup({
    [LOGIN]: { status: 200, body: tokens(1) },
    '/api/auth/logout': { status: 204 },
  });
  await session.login('a@b.c', 'pw');
  await session.logout();
  assert.equal(session.user, null);
  assert.equal(stored.size, 0);
  assert.equal(await session.token(), null);
  assert.equal(calls.at(-1)!.url, 'http://gw/api/auth/logout');
});

test('logout still clears locally when the server is unreachable', async () => {
  const { session, stored } = setup({
    [LOGIN]: { status: 200, body: tokens(1) },
    '/api/auth/logout': () => {
      throw new TypeError('fetch failed');
    },
  });
  await session.login('a@b.c', 'pw');
  await session.logout();
  assert.equal(stored.size, 0);
});
