import { PRODUCTS, Product, applyDynamicPricing } from './products';
import { checkout } from './walletService';
import { fuseScan } from './fusion';

// trolley state. each field maps directly to what the jetson will publish over MQTT in stage B
export interface Trolley {
  id: string;
  userId: string;   // customer who checked in at the trolley dock
  x: number;
  y: number;
  dx: number;       // velocity x
  dy: number;       // velocity y, simple euler integration, real nav uses ROS2 nav stack
  status: 'IDLE' | 'SHOPPING' | 'CHECKOUT';
  cartItems: CartItem[];
  totalWeight: number;
  cartTotal: number;
}

export interface CartItem {
  sku: string;
  name: string;
  emoji: string;
  confidence: number;  // 0.0–1.0, YOLOv8 output
  weightDelta: number; // grams from HX711 load cell
  price: number;
  discounted: boolean;
  ts: string;
}

// 800x600 matches the canvas in StoreMap.tsx so trolley coords are pixel-direct
const FLOOR_W = 800;
const FLOOR_H = 600;

// map each trolley to a real wallet so checkouts actually debit balances
const USER_IDS = ['USR-001', 'USR-002', 'USR-003', 'USR-001', 'USR-002'];

export function startTrolleySimulation(broadcast: (data: unknown) => void) {
  const trolleys: Trolley[] = Array.from({ length: 5 }, (_, i) => ({
    id: `TROLLEY-${100 + i}`,
    userId: USER_IDS[i],
    x: 60 + Math.random() * (FLOOR_W - 120),
    y: 60 + Math.random() * (FLOOR_H - 120),
    dx: (Math.random() - 0.5) * 6,
    dy: (Math.random() - 0.5) * 6,
    status: 'SHOPPING' as const,
    cartItems: [],
    totalWeight: 0,
    cartTotal: 0,
  }));

  console.log('trolley sim started with 5 agents');

  setInterval(() => {
    trolleys.forEach((t) => {
      // jitter velocity each tick for organic-looking paths
      // in stage B replace this whole block with real MQTT position messages
      t.dx += (Math.random() - 0.5) * 2;
      t.dy += (Math.random() - 0.5) * 2;
      const speed = Math.hypot(t.dx, t.dy);
      if (speed > 5) { t.dx *= 5 / speed; t.dy *= 5 / speed; }

      t.x += t.dx;
      t.y += t.dy;
      if (t.x < 30)            { t.x = 30;            t.dx = Math.abs(t.dx);  }
      if (t.x > FLOOR_W - 30)  { t.x = FLOOR_W - 30;  t.dx = -Math.abs(t.dx); }
      if (t.y < 30)            { t.y = 30;            t.dy = Math.abs(t.dy);  }
      if (t.y > FLOOR_H - 30)  { t.y = FLOOR_H - 30;  t.dy = -Math.abs(t.dy); }

      // 5% chance per 800ms tick = ~one scan every 16s per trolley
      // real trigger: load cell delta > 10g AND stable for 500ms
      if (Math.random() < 0.05 && t.status === 'SHOPPING') {
        const product = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
        const { price, discounted } = applyDynamicPricing(product);
        // produce is harder for yolov8 to classify, so confidence baseline is lower
        const baseConf = product.category === 'Produce' ? 0.75 : 0.85;
        let confidence = +(baseConf + Math.random() * 0.14).toFixed(3);
        // the load cells are precise to ±5g (chapter 2 of the spec)
        let weightDelta = +(product.weight + (Math.random() - 0.5) * 10).toFixed(1);

        // roughly 1 in 10 scans goes wrong so the reject path shows up in the demo:
        // a blurry frame (low confidence) or the camera naming the wrong item
        const roll = Math.random();
        if (roll < 0.05) {
          confidence = +(0.3 + Math.random() * 0.29).toFixed(3);
        } else if (roll < 0.10) {
          const actual = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
          weightDelta = +(actual.weight + (Math.random() - 0.5) * 10).toFixed(1);
        }

        const item: CartItem = { sku: product.sku, name: product.name, emoji: product.emoji, confidence, weightDelta, price, discounted, ts: new Date().toISOString() };
        const { accepted, reason } = fuseScan(product, confidence, weightDelta);
        // rejected scans are reported but never reach the cart or the bill
        if (accepted) {
          t.cartItems.push(item);
          t.totalWeight += weightDelta;
          t.cartTotal = +(t.cartTotal + price).toFixed(2);
        }
        broadcast({ type: 'SCAN_EVENT', trolleyId: t.id, userId: t.userId, event: { ...item, accepted, reason } });

        // auto-checkout at 15 items, calls the mock blockchain checkout
        if (t.cartItems.length >= 15) {
          t.status = 'CHECKOUT';
          const result = checkout(t.userId, t.cartTotal);
          broadcast({ type: 'CHECKOUT_EVENT', trolleyId: t.id, userId: t.userId, total: t.cartTotal, itemCount: t.cartItems.length, ...result });
          // reset after 5s so the trolley can shop again
          setTimeout(() => { t.cartItems = []; t.totalWeight = 0; t.cartTotal = 0; t.status = 'SHOPPING'; }, 5000);
        }
      }
    });

    // push positions every tick, only send last 3 cart items to keep payload small
    broadcast({
      type: 'TROLLEY_POSITIONS',
      data: trolleys.map((t) => ({
        id: t.id, userId: t.userId,
        x: +t.x.toFixed(1), y: +t.y.toFixed(1),
        status: t.status,
        cartItems: t.cartItems.slice(-3),
        itemCount: t.cartItems.length,
        totalWeight: t.totalWeight,
        cartTotal: t.cartTotal,
      })),
    });
  }, 800);
}
