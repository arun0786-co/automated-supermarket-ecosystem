import Redis from 'ioredis';

// "hot inventory" from chapter 4.2 of the spec: redis takes the count instantly and
// postgres catches up shortly after. the {inventory} hash tag keeps every key in one
// slot, so the script keeps working on a redis cluster
const key = (sku: string) => `{inventory}:stock:${sku}`;
const DIRTY = '{inventory}:dirty';

// nest injection token
export const HOT_STOCK = 'HOT_STOCK';

export type TakeResult = { status: 'ok' | 'insufficient' | 'unseeded'; stock: number };

export interface HotStock {
  seed(sku: string, stock: number): Promise<void>;
  take(sku: string, quantity: number): Promise<TakeResult>;
  give(sku: string, quantity: number): Promise<number | null>;
  read(skus: string[]): Promise<Map<string, number>>;
  overwrite(sku: string, stock: number): Promise<void>;
  drainDirty(): Promise<string[]>;
  markDirty(sku: string): Promise<void>;
  close(): Promise<void>;
}

// atomic in redis, so two trolleys can never both take the last unit
const TAKE = `
local stock = redis.call('GET', KEYS[1])
if not stock then return {2, 0} end
stock = tonumber(stock)
local quantity = tonumber(ARGV[1])
if stock < quantity then return {1, stock} end
redis.call('DECRBY', KEYS[1], quantity)
redis.call('SADD', KEYS[2], ARGV[2])
return {0, stock - quantity}
`;

const GIVE = `
local stock = redis.call('GET', KEYS[1])
if not stock then return -1 end
redis.call('SADD', KEYS[2], ARGV[2])
return redis.call('INCRBY', KEYS[1], ARGV[1])
`;

const STATUS = ['ok', 'insufficient', 'unseeded'] as const;

export class RedisHotStock implements HotStock {
  private readonly redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url, {
      // fail fast so a pick falls through to postgres instead of waiting on a dead redis
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      connectTimeout: 1000,
      commandTimeout: 1000,
      retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
    });
    // ioredis throws if nothing listens for connection errors. each call reports its own failure
    this.redis.on('error', () => {});
  }

  private async ready() {
    // with the offline queue off, commands fail while connecting, so wait briefly the first time
    if (this.redis.status === 'wait' || this.redis.status === 'connecting' || this.redis.status === 'connect') {
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
  }

  async seed(sku: string, stock: number) {
    await this.ready();
    await this.redis.setnx(key(sku), stock);
  }

  async take(sku: string, quantity: number): Promise<TakeResult> {
    await this.ready();
    const [status, stock] = (await this.redis.eval(TAKE, 2, key(sku), DIRTY, quantity, sku)) as [number, number];
    return { status: STATUS[status], stock };
  }

  async give(sku: string, quantity: number) {
    await this.ready();
    const stock = (await this.redis.eval(GIVE, 2, key(sku), DIRTY, quantity, sku)) as number;
    return stock < 0 ? null : stock;
  }

  async read(skus: string[]) {
    await this.ready();
    const counts = new Map<string, number>();
    if (skus.length === 0) return counts;
    const values = await this.redis.mget(...skus.map(key));
    values.forEach((value, i) => {
      if (value !== null) counts.set(skus[i], Number(value));
    });
    return counts;
  }

  async overwrite(sku: string, stock: number) {
    await this.ready();
    await this.redis.set(key(sku), stock);
  }

  // spop removes as it reads, so two replicas never write the same sku at the same time
  async drainDirty() {
    await this.ready();
    return this.redis.spop(DIRTY, 1000);
  }

  async markDirty(sku: string) {
    await this.ready();
    await this.redis.sadd(DIRTY, sku);
  }

  async close() {
    this.redis.disconnect();
  }
}
