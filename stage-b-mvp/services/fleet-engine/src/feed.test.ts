import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Feed, viewerFromHeaders, viewFor, Viewer } from './feed';

const admin: Viewer = { userId: 'ADM-001', role: 'admin', exp: 0 };
const arun: Viewer = { userId: 'USR-001', role: 'customer', exp: 0 };

const mine = { type: 'SCAN_EVENT', trolleyId: 'T1', userId: 'USR-001', event: {} };
const theirs = { type: 'SCAN_EVENT', trolleyId: 'T2', userId: 'USR-002', event: {} };
const positions = { type: 'TROLLEY_POSITIONS', data: [{ id: 'T1', userId: 'USR-001' }, { id: 'T2', userId: 'USR-002' }] };

test('an admin sees every event', () => {
  assert.deepEqual(viewFor(admin, theirs), theirs);
  assert.deepEqual(viewFor(admin, positions), positions);
});

test('a customer sees their own events only', () => {
  assert.deepEqual(viewFor(arun, mine), mine);
  assert.equal(viewFor(arun, theirs), null);
  for (const type of ['CHECKOUT_EVENT', 'RECOMMENDATION_EVENT']) {
    assert.equal(viewFor(arun, { type, userId: 'USR-002' }), null);
    assert.deepEqual(viewFor(arun, { type, userId: 'USR-001' }), { type, userId: 'USR-001' });
  }
});

test('a customer only gets their own trolley from the position feed', () => {
  assert.deepEqual(viewFor(arun, positions), { type: 'TROLLEY_POSITIONS', data: [{ id: 'T1', userId: 'USR-001' }] });
});

test('prices are public', () => {
  const price = { type: 'PRICE_EVENT', sku: 'A', price: 1, discounted: false };
  assert.deepEqual(viewFor(arun, price), price);
});

test('an event type nobody has classified is not shown to customers', () => {
  const unclassified = { type: 'SOMETHING_NEW', userId: 'USR-002', secret: 1 };
  assert.equal(viewFor(arun, unclassified), null);
  assert.deepEqual(viewFor(admin, { type: 'SOMETHING_NEW' }), { type: 'SOMETHING_NEW' });
});

test('viewer comes from the gateway headers', () => {
  assert.deepEqual(viewerFromHeaders({ 'x-user-id': 'USR-001', 'x-user-role': 'customer', 'x-token-exp': '123' }), { userId: 'USR-001', role: 'customer', exp: 123 });
});

test('no gateway headers means no viewer', () => {
  assert.equal(viewerFromHeaders({}), null);
  assert.equal(viewerFromHeaders({ 'x-user-id': 'USR-001' }), null);
  assert.equal(viewerFromHeaders({ 'x-user-id': 'USR-001', 'x-user-role': 'customer', 'x-token-exp': 'soon' }), null);
});

class FakeSocket {
  readyState = 1;
  sent: any[] = [];
  closed: { code: number; reason: string } | null = null;
  handlers: Record<string, () => void> = {};
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
    this.readyState = 3;
  }
  on(event: string, handler: () => void) {
    this.handlers[event] = handler;
  }
}

function newFeed(nowMs = 0) {
  const timers: { fn: () => void; ms: number }[] = [];
  const feed = new Feed({ now: () => nowMs, setTimer: (fn, ms) => timers.push({ fn, ms }) });
  return { feed, timers };
}

test('a client gets a greeting, then only what it may see', () => {
  const { feed } = newFeed();
  const socket = new FakeSocket();
  feed.add(socket, { ...arun, exp: 1000 });
  assert.equal(socket.sent[0].type, 'INFO');

  feed.broadcast(theirs);
  feed.broadcast(mine);
  assert.deepEqual(socket.sent.slice(1), [mine]);
});

test('a socket that is not open is skipped', () => {
  const { feed } = newFeed();
  const socket = new FakeSocket();
  feed.add(socket, { ...arun, exp: 1000 });
  socket.readyState = 3;
  feed.broadcast(mine);
  assert.equal(socket.sent.length, 1);
});

test('the connection closes when the token expires, it does not sit on stale data', () => {
  const { feed, timers } = newFeed(100_000);
  const socket = new FakeSocket();
  feed.add(socket, { ...arun, exp: 160 }); // 60 seconds from now
  assert.equal(timers[0].ms, 60_000);
  assert.equal(socket.closed, null);

  timers[0].fn();
  assert.deepEqual(socket.closed, { code: 4401, reason: 'token expired' });
  assert.equal(feed.size(), 0);
  feed.broadcast(mine);
  assert.equal(socket.sent.length, 1);
});

test('a token already past its expiry is closed straight away', () => {
  const { feed } = newFeed(100_000);
  const socket = new FakeSocket();
  feed.add(socket, { ...arun, exp: 50 });
  assert.equal(socket.closed?.code, 4401);
  assert.equal(feed.size(), 0);
});

test('a closed client is forgotten', () => {
  const { feed } = newFeed();
  const socket = new FakeSocket();
  feed.add(socket, { ...arun, exp: 1000 });
  assert.equal(feed.size(), 1);
  socket.handlers.close();
  assert.equal(feed.size(), 0);
});
