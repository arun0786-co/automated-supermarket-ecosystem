import Redis from 'ioredis';
import { Cart, CartStore } from './types';

// test double, and what the engine runs on with no redis configured
export class MemoryCartStore implements CartStore {
  private carts = new Map<string, string>();

  async save(cart: Cart) {
    this.carts.set(cart.trolleyId, JSON.stringify(cart));
  }

  async loadAll() {
    return [...this.carts.values()].map((raw) => JSON.parse(raw) as Cart);
  }
}

const KEY = 'fleet:carts';

// written through on every change, so a fleet engine restart loses nothing
export class RedisCartStore implements CartStore {
  private readonly redis: Redis;

  constructor(url: string) {
    // fail fast: a scan shouldn't wait on a dead redis
    this.redis = new Redis(url, {
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      connectTimeout: 1000,
      commandTimeout: 1000,
      retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
    });
    this.redis.on('error', () => {});
  }

  // the offline queue is off, so commands fail while connecting. wait briefly the first time
  private async ready() {
    if (this.redis.status === 'ready') return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.redis.off('ready', done);
        resolve();
      };
      const timer = setTimeout(done, 1000);
      this.redis.once('ready', done);
    });
  }

  async save(cart: Cart) {
    await this.ready();
    await this.redis.hset(KEY, cart.trolleyId, JSON.stringify(cart));
  }

  async loadAll() {
    await this.ready();
    const rows = await this.redis.hvals(KEY);
    const carts: Cart[] = [];
    for (const row of rows) {
      try {
        carts.push(JSON.parse(row) as Cart);
      } catch {
        // a damaged row costs one cart, not the whole fleet
      }
    }
    return carts;
  }
}
