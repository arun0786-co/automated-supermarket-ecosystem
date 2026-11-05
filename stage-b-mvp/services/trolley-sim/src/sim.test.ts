import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogItem, createTrolleys, makeScan, stepTrolley } from './sim';

const catalog: CatalogItem[] = [
  { sku: 'PRD-001', category: 'Produce', weight: 150 },
  { sku: 'PNT-001', category: 'Pantry', weight: 450 },
  { sku: 'DRY-001', category: 'Dairy', weight: 1000 },
];

// a seeded generator, so a failure here can be reproduced
function seeded(seed = 42) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

test('five trolleys on the demo customers, same ids as stage A', () => {
  const trolleys = createTrolleys(seeded());
  assert.deepEqual(trolleys.map((t) => t.id), ['TROLLEY-100', 'TROLLEY-101', 'TROLLEY-102', 'TROLLEY-103', 'TROLLEY-104']);
  assert.deepEqual(trolleys.map((t) => t.userId), ['USR-001', 'USR-002', 'USR-003', 'USR-001', 'USR-002']);
});

test('trolleys stay on the 800x600 floor', () => {
  const rng = seeded();
  const [t] = createTrolleys(rng);
  for (let i = 0; i < 5000; i++) {
    stepTrolley(t, rng);
    assert.ok(t.x >= 30 && t.x <= 770 && t.y >= 30 && t.y <= 570, `off the floor at ${t.x},${t.y}`);
  }
});

test('a scan has what the topic contract asks for and carries no customer data', () => {
  const scan = makeScan(catalog, seeded(), () => 'id-1');
  assert.deepEqual(Object.keys(scan).sort(), ['detection', 'eventId', 'weightDelta']);
  assert.equal(scan.eventId, 'id-1');
  assert.ok(catalog.some((item) => item.sku === scan.detection.sku));
  assert.ok(scan.detection.confidence >= 0 && scan.detection.confidence <= 1);
});

test('most scans fuse and about 1 in 10 go wrong, as in stage A', () => {
  const rng = seeded();
  let good = 0;
  const total = 5000;
  for (let i = 0; i < total; i++) {
    const scan = makeScan(catalog, rng, () => String(i));
    const item = catalog.find((c) => c.sku === scan.detection.sku)!;
    // the same gate the vision service applies
    if (scan.detection.confidence >= 0.6 && Math.abs(scan.weightDelta - item.weight) <= 10) good++;
  }
  // a wrong-item scan can land on the same item, so the bad rate sits a little under 10%
  assert.ok(good / total > 0.88 && good / total < 0.97, `good rate was ${good / total}`);
});

test('load cell noise stays within the spec precision of 5g on good scans', () => {
  const rng = seeded();
  for (let i = 0; i < 1000; i++) {
    const scan = makeScan([catalog[1]], rng, () => String(i));
    assert.ok(Math.abs(scan.weightDelta - 450) <= 5);
  }
});
