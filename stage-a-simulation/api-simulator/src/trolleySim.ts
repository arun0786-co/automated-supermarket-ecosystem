import { PRODUCTS, Product, applyDynamicPricing } from './products';
import { checkout } from './walletService';

// the shape of a single trolley in our simulation
// when we eventually get real hardware, these fields map 1:1 to the
// data the Jetson Nano will be publishing over MQTT
export interface Trolley {
  id: string;
  userId: string;   // which customer scanned their QR code at the trolley dock
  x: number;
  y: number;
  dx: number;       // velocity x — i'm using simple euler integration here
  dy: number;       // velocity y — good enough for a sim, real nav uses ROS2 nav stack
  status: 'IDLE' | 'SHOPPING' | 'CHECKOUT';
  cartItems: CartItem[];
  totalWeight: number;
  cartTotal: number;
}

export interface CartItem {
  sku: string;
  name: string;
  confidence: number;  // 0.0 - 1.0, from the YOLOv8 inference result
  weightDelta: number; // grams, from the load cell reading
  price: number;
  discounted: boolean; // true if expiry-based 20% discount was applied
  ts: string;
}

// store floor is 800x600 "units" — matches the canvas in StoreMap.tsx
// so positions here map directly to pixel coords on the dashboard
const FLOOR_W = 800;
const FLOOR_H = 600;

// each trolley is assigned to a real wallet so checkout actually debits SPMT
const USER_IDS = ['USR-001', 'USR-002', 'USR-003', 'USR-001', 'USR-002'];

export function startTrolleySimulation(broadcast: (data: unknown) => void) {
  // spin up 5 trolleys — increase this later to stress test the websocket
  const trolleys: Trolley[] = Array.from({ length: 5 }, (_, i) => ({
    id: `TROLLEY-${100 + i}`,
    userId: USER_IDS[i],
    x: 60 + Math.random() * (FLOOR_W - 120),
    y: 60 + Math.random() * (FLOOR_H - 120),
    dx: (Math.random() - 0.5) * 6,
    dy: (Math.random() - 0.5) * 6,
    status: 'SHOPPING',
    cartItems: [],
    totalWeight: 0,
    cartTotal: 0,
  }));

  console.log('🤖 trolley sim started — 5 agents running');

  setInterval(() => {
    trolleys.forEach((t) => {

      // --- movement ---
      // jitter the velocity a little each tick so paths feel organic
      // in stage b this whole block gets replaced by real MQTT position updates
      t.dx += (Math.random() - 0.5) * 2;
      t.dy += (Math.random() - 0.5) * 2;

      // cap max speed so trolleys don't fly across the map
      const maxSpeed = 5;
      const speed = Math.hypot(t.dx, t.dy);
      if (speed > maxSpeed) {
        t.dx *= maxSpeed / speed;
        t.dy *= maxSpeed / speed;
      }

      t.x += t.dx;
      t.y += t.dy;

      // bounce off walls — real trolleys would pathfind around them
      if (t.x < 30)           { t.x = 30;           t.dx = Math.abs(t.dx);  }
      if (t.x > FLOOR_W - 30) { t.x = FLOOR_W - 30; t.dx = -Math.abs(t.dx); }
      if (t.y < 30)           { t.y = 30;           t.dy = Math.abs(t.dy);  }
      if (t.y > FLOOR_H - 30) { t.y = FLOOR_H - 30; t.dy = -Math.abs(t.dy); }

      // --- vision + weight sensor fusion (simulating Service B) ---
      // 5% chance per 800ms tick = roughly one item scan every 15-16 seconds per trolley
      // real trigger is when load cell delta > 10g AND stabilises for 500ms
      if (Math.random() < 0.05 && t.status === 'SHOPPING') {
        const product = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
        const { price, discounted } = applyDynamicPricing(product);

        // produce items are harder to classify so YOLOv8 confidence is a bit lower
        const baseConf = product.category === 'Produce' ? 0.75 : 0.85;
        const confidence = +(baseConf + Math.random() * 0.14).toFixed(3);

        // add ±5% noise to weight reading — HX711 ADC is pretty accurate but not perfect
        const weightDelta = +(product.weight * (0.95 + Math.random() * 0.1)).toFixed(1);

        const item: CartItem = {
          sku: product.sku,
          name: product.name,
          confidence,
          weightDelta,
          price,
          discounted,
          ts: new Date().toISOString(),
        };

        t.cartItems.push(item);
        t.totalWeight += weightDelta;
        t.cartTotal = +(t.cartTotal + price).toFixed(2);

        // reject the scan if model isn't confident enough
        // in production this also flashes the red LED on the trolley
        const accepted = confidence >= 0.60;

        broadcast({
          type: 'SCAN_EVENT',
          trolleyId: t.id,
          userId: t.userId,
          event: { ...item, accepted },
        });

        // auto-checkout at 15 items — same threshold the spec uses
        // this is when the blockchain checkout contract gets called
        if (t.cartItems.length >= 15) {
          t.status = 'CHECKOUT';

          const result = checkout(t.userId, t.cartTotal);

          broadcast({
            type: 'CHECKOUT_EVENT',
            trolleyId: t.id,
            userId: t.userId,
            total: t.cartTotal,
            itemCount: t.cartItems.length,
            ...result,
          });

          // reset the cart after a few seconds so the trolley can shop again
          setTimeout(() => {
            t.cartItems = [];
            t.totalWeight = 0;
            t.cartTotal = 0;
            t.status = 'SHOPPING';
          }, 5000);
        }
      }
    });

    // push position update every tick so the map stays smooth
    // only sending the last 3 cart items to keep the payload small
    broadcast({
      type: 'TROLLEY_POSITIONS',
      data: trolleys.map((t) => ({
        id: t.id,
        userId: t.userId,
        x: +t.x.toFixed(1),
        y: +t.y.toFixed(1),
        status: t.status,
        cartItems: t.cartItems.slice(-3),
        totalWeight: t.totalWeight,
        cartTotal: t.cartTotal,
      })),
    });
  }, 800);
}
