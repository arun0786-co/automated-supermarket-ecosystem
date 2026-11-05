import { Cart, CartItem, CartStore, ChargeResult, ChargeUnknownError, Product, RecommendationContext, Services, VisionRequest } from './types';

// same rule as stage A: the cart checks out by itself at 15 items
const CHECKOUT_AT_ITEMS = 15;
const RESET_AFTER_MS = 5000;
const RECENT_EVENTS_KEPT = 50;
// the 800 unit wide floor split into the aisles the recommender knows about
const AISLE_WIDTH = 100;
// the local network is treated as hostile (chapter 10), so a flood of ids can't grow memory forever
const MAX_TROLLEYS = 1000;
const FLOOR_LIMIT = 100_000;

const TOPIC = /^trolley\/([A-Za-z0-9-]{1,64})\/(position|scan)$/;

type Options = {
  services: Services;
  store: CartStore;
  broadcast: (message: unknown) => void;
  publish: (topic: string, payload: unknown) => void;
  schedule?: (fn: () => void, ms: number) => void;
  log?: (message: string) => void;
};

type Position = { x: number; y: number };

function asObject(raw: Buffer): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw.toString());
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseScan(body: Record<string, unknown>): (VisionRequest & { eventId: string }) | null {
  const { eventId, weightDelta, frames, detection } = body;
  if (typeof eventId !== 'string' || eventId.length === 0 || eventId.length > 64) return null;
  if (typeof weightDelta !== 'number' || !Number.isFinite(weightDelta)) return null;
  const hasFrames = Array.isArray(frames) && frames.length > 0 && frames.every((f) => typeof f === 'string');
  const d = detection as { sku?: unknown; confidence?: unknown } | undefined;
  const hasDetection = !!d && typeof d.sku === 'string' && typeof d.confidence === 'number';
  if (!hasFrames && !hasDetection) return null;
  return {
    eventId,
    weightDelta,
    ...(hasFrames ? { frames: frames as string[] } : {}),
    ...(hasDetection ? { detection: { sku: d!.sku as string, confidence: d!.confidence as number } } : {}),
  };
}

const unknownProduct = (sku: string | null) => ({ sku: sku ?? 'UNKNOWN', name: 'Unknown item', emoji: '❓', price: 0, discounted: false });

export class FleetEngine {
  private readonly carts = new Map<string, Cart>();
  private readonly positions = new Map<string, Position>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly lowStockAlerted = new Set<string>();
  private readonly background = new Set<Promise<unknown>>();
  // what each trolley was last shown, to score the recommendation when the next item arrives
  private readonly shown = new Map<string, { skus: string[]; context: RecommendationContext }>();
  private readonly services: Services;
  private readonly store: CartStore;
  private readonly broadcast: Options['broadcast'];
  private readonly publish: Options['publish'];
  private readonly schedule: NonNullable<Options['schedule']>;
  private readonly log: NonNullable<Options['log']>;

  constructor(options: Options) {
    this.services = options.services;
    this.store = options.store;
    this.broadcast = options.broadcast;
    this.publish = options.publish;
    this.schedule = options.schedule ?? ((fn, ms) => void setTimeout(fn, ms).unref());
    this.log = options.log ?? console.warn;
  }

  // keeping carts durable matters, but not more than keeping the shop open
  private async saveCart(cart: Cart) {
    await this.store.save(cart).catch((err) => this.log(`could not save cart for ${cart.trolleyId}: ${String(err)}`));
  }

  async restore(): Promise<void> {
    let carts: Cart[] = [];
    try {
      carts = await this.store.loadAll();
    } catch (err) {
      this.log(`could not restore carts, starting empty: ${String(err)}`);
    }
    for (const cart of carts) {
      this.carts.set(cart.trolleyId, cart);
      // the engine stopped between starting a charge and recording the result. it may have
      // gone through, so charging again could double charge. a person has to look at it
      if (cart.status === 'CHECKOUT') this.settleUnknownCheckout(cart);
    }
  }

  // trolleys are handled one message at a time, in order, so a cart can't race with itself
  private enqueue<T>(trolleyId: string, task: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(trolleyId) ?? Promise.resolve()).then(task, task);
    const tail = run.catch(() => {});
    this.queues.set(trolleyId, tail);
    void tail.then(() => {
      if (this.queues.get(trolleyId) === tail) this.queues.delete(trolleyId);
    });
    return run;
  }

  async handleMessage(topic: string, payload: Buffer): Promise<void> {
    const match = TOPIC.exec(topic);
    const body = match && asObject(payload);
    if (!match || !body) {
      this.log(`dropped message on ${topic.slice(0, 100)}`);
      return;
    }
    const [, trolleyId, kind] = match;
    try {
      if (kind === 'position') {
        this.handlePosition(trolleyId, body);
      } else {
        const scan = parseScan(body);
        if (!scan) {
          this.log(`dropped malformed scan from ${trolleyId}`);
          return;
        }
        await this.enqueue(trolleyId, () => this.handleScan(trolleyId, scan));
      }
    } catch (err) {
      this.log(`error handling ${kind} from ${trolleyId}: ${String(err)}`);
    }
  }

  private cartFor_(trolleyId: string): Cart | null {
    const existing = this.carts.get(trolleyId);
    if (existing) return existing;
    if (this.carts.size >= MAX_TROLLEYS) {
      this.log(`ignoring ${trolleyId}, already tracking ${MAX_TROLLEYS} trolleys`);
      return null;
    }
    const cart: Cart = { trolleyId, userId: '', status: 'SHOPPING', items: [], totalWeight: 0, cartTotal: 0, recentEvents: [] };
    this.carts.set(trolleyId, cart);
    return cart;
  }

  private handlePosition(trolleyId: string, body: Record<string, unknown>) {
    const { userId, x, y } = body;
    if (typeof x !== 'number' || typeof y !== 'number' || Math.abs(x) > FLOOR_LIMIT || Math.abs(y) > FLOOR_LIMIT) {
      this.log(`dropped bad position from ${trolleyId}`);
      return;
    }
    const cart = this.cartFor_(trolleyId);
    if (!cart) return;
    this.positions.set(trolleyId, { x, y });
    if (typeof userId === 'string' && userId !== cart.userId && userId.length <= 64) {
      cart.userId = userId;
      void this.saveCart(cart);
    }
  }

  private async handleScan(trolleyId: string, scan: VisionRequest & { eventId: string }): Promise<void> {
    const cart = this.cartFor_(trolleyId);
    if (!cart) return;
    if (cart.recentEvents.includes(scan.eventId)) return;

    if (cart.status === 'CHECKOUT') return this.reject(cart, scan, 'checkout in progress');
    if (!cart.userId) return this.reject(cart, scan, 'no customer checked in');

    let vision;
    try {
      vision = await this.services.scan({ weightDelta: scan.weightDelta, frames: scan.frames, detection: scan.detection });
    } catch (err) {
      this.log(`vision failed: ${String(err)}`);
      return this.reject(cart, scan, 'vision unavailable');
    }
    if (!vision.accepted || !vision.sku) {
      return this.reject(cart, scan, vision.reason ?? 'not recognised', vision.sku, vision.confidence);
    }

    let product: Product | null;
    let stockLevel: number | null;
    try {
      product = await this.services.getProduct(vision.sku);
      if (!product) return this.reject(cart, scan, 'unknown item', vision.sku, vision.confidence);
      stockLevel = await this.services.pick(vision.sku);
    } catch (err) {
      this.log(`inventory failed: ${String(err)}`);
      return this.reject(cart, scan, 'inventory unavailable', vision.sku, vision.confidence);
    }
    if (stockLevel === null) return this.reject(cart, scan, 'out of stock', vision.sku, vision.confidence);

    const item: CartItem = {
      sku: product.sku,
      name: product.name,
      emoji: product.emoji,
      category: product.category,
      confidence: vision.confidence,
      weightDelta: scan.weightDelta,
      price: product.price,
      discounted: product.discounted,
      ts: new Date().toISOString(),
    };
    cart.items.push(item);
    cart.totalWeight = Math.round((cart.totalWeight + scan.weightDelta) * 10) / 10;
    cart.cartTotal = Math.round((cart.cartTotal + product.price) * 100) / 100;
    this.remember(cart, scan.eventId);
    await this.saveCart(cart);

    this.broadcast({ type: 'SCAN_EVENT', trolleyId, userId: cart.userId, event: { ...item, accepted: true } });
    this.publish(`trolley/${trolleyId}/led`, { color: 'green' });
    await this.noteStockChange(product, stockLevel);

    if (cart.items.length >= CHECKOUT_AT_ITEMS) {
      this.shown.delete(trolleyId);
      await this.checkout(cart);
    } else {
      this.afterAccepted(cart, item);
    }
  }

  private remember(cart: Cart, eventId: string) {
    cart.recentEvents.push(eventId);
    if (cart.recentEvents.length > RECENT_EVENTS_KEPT) cart.recentEvents.shift();
  }

  private async reject(cart: Cart, scan: VisionRequest, reason: string, sku?: string | null, confidence?: number) {
    // undefined: rejected before vision ran, so show what the camera claimed.
    // null: vision ran and couldn't name anything
    const claimed = sku === undefined ? (scan.detection?.sku ?? null) : sku;
    let shown: Pick<CartItem, 'sku' | 'name' | 'emoji' | 'price' | 'discounted'> = unknownProduct(claimed);
    if (claimed) {
      // only for display, so it doesn't matter if this fails
      const product = await this.services.getProduct(claimed).catch(() => null);
      if (product) shown = { sku: product.sku, name: product.name, emoji: product.emoji, price: product.price, discounted: product.discounted };
    }
    this.broadcast({
      type: 'SCAN_EVENT',
      trolleyId: cart.trolleyId,
      userId: cart.userId,
      event: {
        ...shown,
        confidence: confidence ?? scan.detection?.confidence ?? 0,
        weightDelta: scan.weightDelta,
        ts: new Date().toISOString(),
        accepted: false,
        reason,
      },
    });
    // chapter 5.4: the trolley flashes a red led when an addition is rejected
    this.publish(`trolley/${cart.trolleyId}/led`, { color: 'red', reason });
  }

  private async noteStockChange(product: Product, stockLevel: number) {
    if (stockLevel <= product.discountThreshold) {
      if (!this.lowStockAlerted.has(product.sku)) {
        this.lowStockAlerted.add(product.sku);
        this.publish('store/alerts', { type: 'LOW_STOCK', sku: product.sku, stockLevel, threshold: product.discountThreshold });
      }
    } else {
      this.lowStockAlerted.delete(product.sku);
    }

    // chapter 4.3.2: price changes get pushed to clients over the websocket
    const nearExpiry = product.daysToExpiry > 0 && product.daysToExpiry < 2;
    const discountedNow = nearExpiry && stockLevel > product.discountThreshold;
    if (discountedNow !== product.discounted) {
      const fresh = await this.services.getProduct(product.sku).catch(() => null);
      this.broadcast({ type: 'PRICE_EVENT', sku: product.sku, price: fresh?.price ?? product.price, discounted: discountedNow });
    }
  }

  // recommendations are extra: never awaited by the scan, so a slow or dead ai engine can't hold
  // up a trolley
  private afterAccepted(cart: Cart, item: CartItem) {
    const task = this.scoreAndRecommend(cart, item).catch((err) => this.log(`recommendations failed: ${String(err)}`));
    this.background.add(task);
    void task.finally(() => this.background.delete(task));
  }

  private async scoreAndRecommend(cart: Cart, item: CartItem) {
    // chapter 7.3.2: +1 if the customer added what was suggested, 0 if they ignored it
    const previous = this.shown.get(cart.trolleyId);
    if (previous) {
      this.shown.delete(cart.trolleyId);
      // learning is a bonus: if it fails, the customer should still get their next suggestions
      await Promise.all(previous.skus.map((sku) => this.services.sendFeedback(sku, sku === item.sku ? 1 : 0, previous.context))).catch((err) =>
        this.log(`could not send recommendation feedback: ${String(err)}`),
      );
    }

    const position = this.positions.get(cart.trolleyId);
    const context: RecommendationContext = {
      aisle: Math.floor((position?.x ?? 0) / AISLE_WIDTH),
      hour: new Date().getHours(),
      cartCategories: [...new Set(cart.items.map((i) => i.category ?? 'Unknown'))],
    };
    const recs = await this.services.recommend(cart.userId, cart.items, context);
    if (cart.status !== 'SHOPPING') return;
    this.shown.set(cart.trolleyId, { skus: recs.map((r) => r.sku), context });
    this.broadcast({ type: 'RECOMMENDATION_EVENT', trolleyId: cart.trolleyId, userId: cart.userId, recs });
  }

  // for tests and shutdown: resolves once background work has finished
  async idle(): Promise<void> {
    await Promise.all(this.background);
  }

  private async checkout(cart: Cart): Promise<void> {
    cart.status = 'CHECKOUT';
    // saved before the charge, so a crash during it is detected at the next start
    await this.saveCart(cart);

    const skus = cart.items.map((item) => item.sku);
    const total = cart.cartTotal;
    let result: ChargeResult;
    try {
      const user = await this.services.getUser(cart.userId);
      if (!user) {
        result = { ok: false, reason: 'no wallet for customer' };
      } else {
        result = await this.services.checkout(user.walletAddress, total.toFixed(2), skus);
      }
    } catch (err) {
      if (err instanceof ChargeUnknownError) {
        this.log(`charge outcome unknown for ${cart.trolleyId}: ${err.message}`);
        this.settleUnknownCheckout(cart);
        return;
      }
      this.log(`checkout failed for ${cart.trolleyId}: ${String(err)}`);
      result = { ok: false, reason: 'payment service unavailable' };
    }

    if (result.ok) {
      void this.services.recordPurchase(skus).catch((err) => this.log(`could not record purchase: ${String(err)}`));
    } else {
      // no money moved, so the goods go back on the shelf and staff get told
      await this.releaseItems(skus);
      this.publish('store/alerts', { type: 'CHECKOUT_FAILED', trolleyId: cart.trolleyId, userId: cart.userId, total, reason: result.reason, needsReview: false });
    }

    this.broadcast({ type: 'CHECKOUT_EVENT', trolleyId: cart.trolleyId, userId: cart.userId, total, itemCount: skus.length, ...result });
    this.publish(`trolley/${cart.trolleyId}/checkout`, { ok: result.ok, total, ...(result.hash ? { hash: result.hash } : {}), ...(result.reason ? { reason: result.reason } : {}) });
    this.scheduleReset(cart);
  }

  private settleUnknownCheckout(cart: Cart) {
    const reason = 'checkout result unknown';
    this.publish('store/alerts', { type: 'CHECKOUT_FAILED', trolleyId: cart.trolleyId, userId: cart.userId, total: cart.cartTotal, reason, needsReview: true });
    this.broadcast({ type: 'CHECKOUT_EVENT', trolleyId: cart.trolleyId, userId: cart.userId, total: cart.cartTotal, itemCount: cart.items.length, ok: false, reason });
    this.publish(`trolley/${cart.trolleyId}/checkout`, { ok: false, total: cart.cartTotal, reason });
    this.scheduleReset(cart);
  }

  private async releaseItems(skus: string[]) {
    const counts = new Map<string, number>();
    for (const sku of skus) counts.set(sku, (counts.get(sku) ?? 0) + 1);
    for (const [sku, quantity] of counts) {
      await this.services.release(sku, quantity).catch((err) => this.log(`could not release ${sku}: ${String(err)}`));
    }
  }

  private scheduleReset(cart: Cart) {
    this.schedule(() => {
      void this.enqueue(cart.trolleyId, async () => {
        cart.items = [];
        cart.totalWeight = 0;
        cart.cartTotal = 0;
        cart.status = 'SHOPPING';
        await this.saveCart(cart);
      }).catch((err) => this.log(`could not reset ${cart.trolleyId}: ${String(err)}`));
    }, RESET_AFTER_MS);
  }

  // same shape as TROLLEY_POSITIONS data in stage A
  snapshot() {
    return [...this.carts.values()].map((cart) => {
      const position = this.positions.get(cart.trolleyId) ?? { x: 0, y: 0 };
      return {
        id: cart.trolleyId,
        userId: cart.userId,
        x: position.x,
        y: position.y,
        status: cart.status,
        cartItems: cart.items.slice(-3),
        itemCount: cart.items.length,
        totalWeight: cart.totalWeight,
        cartTotal: cart.cartTotal,
      };
    });
  }

  // the whole cart, for a client reconciling after being offline
  cartFor(userId: string) {
    const cart = [...this.carts.values()].find((c) => c.userId === userId);
    if (!cart) return null;
    return { trolleyId: cart.trolleyId, status: cart.status, items: cart.items, total: cart.cartTotal };
  }
}
