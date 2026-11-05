// stands in for the trolley hardware. it only knows what a jetson would know, and only speaks
// mqtt, so a real trolley can replace it without changing anything else

export type Rng = () => number;

export type CatalogItem = { sku: string; category: string; weight: number };

export type SimTrolley = { id: string; userId: string; x: number; y: number; dx: number; dy: number };

export type ScanMessage = {
  eventId: string;
  weightDelta: number;
  // what the camera would report. real trolleys send frames instead
  detection: { sku: string; confidence: number };
};

// same 800x600 floor as the dashboard map, same customers as stage A
const FLOOR_W = 800;
const FLOOR_H = 600;
const MARGIN = 30;
const MAX_SPEED = 5;
const USER_IDS = ['USR-001', 'USR-002', 'USR-003', 'USR-001', 'USR-002'];

export function createTrolleys(rng: Rng): SimTrolley[] {
  return USER_IDS.map((userId, i) => ({
    id: `TROLLEY-${100 + i}`,
    userId,
    x: 60 + rng() * (FLOOR_W - 120),
    y: 60 + rng() * (FLOOR_H - 120),
    dx: (rng() - 0.5) * 6,
    dy: (rng() - 0.5) * 6,
  }));
}

export function stepTrolley(t: SimTrolley, rng: Rng): void {
  t.dx += (rng() - 0.5) * 2;
  t.dy += (rng() - 0.5) * 2;
  const speed = Math.hypot(t.dx, t.dy);
  if (speed > MAX_SPEED) {
    t.dx *= MAX_SPEED / speed;
    t.dy *= MAX_SPEED / speed;
  }
  t.x += t.dx;
  t.y += t.dy;
  if (t.x < MARGIN) { t.x = MARGIN; t.dx = Math.abs(t.dx); }
  if (t.x > FLOOR_W - MARGIN) { t.x = FLOOR_W - MARGIN; t.dx = -Math.abs(t.dx); }
  if (t.y < MARGIN) { t.y = MARGIN; t.dy = Math.abs(t.dy); }
  if (t.y > FLOOR_H - MARGIN) { t.y = FLOOR_H - MARGIN; t.dy = -Math.abs(t.dy); }
}

const pick = <T>(items: T[], rng: Rng): T => items[Math.floor(rng() * items.length)];
const round = (value: number, places: number) => Number(value.toFixed(places));

export function makeScan(catalog: CatalogItem[], rng: Rng, newId: () => string): ScanMessage {
  const item = pick(catalog, rng);
  // produce is harder to classify, so its confidence starts lower
  const base = item.category === 'Produce' ? 0.75 : 0.85;
  let confidence = round(base + rng() * 0.14, 3);
  // chapter 2.1.2: the load cells are precise to +/- 5g
  let weightDelta = round(item.weight + (rng() - 0.5) * 10, 1);

  // about 1 in 10 goes wrong so the reject path gets exercised: a blurry frame, or the
  // camera naming one item while the customer put in another
  const roll = rng();
  if (roll < 0.05) {
    confidence = round(0.3 + rng() * 0.29, 3);
  } else if (roll < 0.1) {
    weightDelta = round(pick(catalog, rng).weight + (rng() - 0.5) * 10, 1);
  }
  return { eventId: newId(), weightDelta, detection: { sku: item.sku, confidence } };
}
