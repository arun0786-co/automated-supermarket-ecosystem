import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './product.entity';
import { HOT_STOCK, HotStock } from './hot-stock';
import { hotStockDegraded, picks } from '../metrics.controller';

const FLUSH_INTERVAL_MS = 200;

@Injectable()
export class ProductsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ProductsService.name);
  private flushTimer?: NodeJS.Timeout;
  private flushing = false;
  // redis failed at some point, so its counts can't be trusted until they're reconciled
  private degraded = false;

  constructor(
    @InjectRepository(Product)
    private readonly repo: Repository<Product>,
    @Optional() @Inject(HOT_STOCK) private readonly hot: HotStock | null = null,
  ) {}

  async onApplicationBootstrap() {
    hotStockDegraded.set(0);
    if (!this.hot) return;
    await this.seedHotStock().catch((err) => this.markDegraded(err));
    this.flushTimer = setInterval(() => void this.flushHotStock(), FLUSH_INTERVAL_MS);
    this.flushTimer.unref();
  }

  async onApplicationShutdown() {
    clearInterval(this.flushTimer);
    await this.flushHotStock();
    await this.hot?.close();
  }

  private markDegraded(err: unknown) {
    if (!this.degraded) this.logger.warn(`hot stock unavailable, using postgres: ${String(err)}`);
    this.degraded = true;
    hotStockDegraded.set(1);
  }

  // SETNX underneath, so a service restart keeps the live counts
  async seedHotStock(): Promise<void> {
    if (!this.hot) return;
    for (const p of await this.repo.find()) await this.hot.seed(p.sku, p.stockLevel);
  }

  // replaces the postgres count with the hot one wherever redis has it
  private async withHotStock<T extends Product>(products: T[]): Promise<T[]> {
    if (!this.hot) return products;
    try {
      const counts = await this.hot.read(products.map((p) => p.sku));
      return products.map((p) => ({ ...p, stockLevel: counts.get(p.sku) ?? p.stockLevel }));
    } catch (err) {
      this.markDegraded(err);
      return products;
    }
  }

  async findAll(): Promise<Product[]> {
    // only return active products, soft-delete by setting active=false
    return this.withHotStock(await this.repo.find({ where: { active: true } }));
  }

  private async loadRow(sku: string): Promise<Product> {
    const p = await this.repo.findOne({ where: { sku } });
    if (!p) throw new NotFoundException(`sku ${sku} not found`);
    return p;
  }

  async findBySku(sku: string): Promise<Product> {
    const [p] = await this.withHotStock([await this.loadRow(sku)]);
    return p;
  }

  // dynamic pricing from chapter 4 of the spec:
  // IF Days_To_Expiry < 2 AND Stock_Level > Threshold THEN Apply_Discount(20%)
  // i.e. discount stock that won't sell before it expires
  applyPricing(p: Product): { price: number; discounted: boolean } {
    const nearExpiry = p.daysToExpiry > 0 && p.daysToExpiry < 2;
    const overstocked = p.stockLevel > p.discountThreshold;
    if (nearExpiry && overstocked) {
      return { price: +(Number(p.price) * 0.8).toFixed(2), discounted: true };
    }
    return { price: Number(p.price), discounted: false };
  }

  async getAllWithPricing(): Promise<(Product & { discounted: boolean })[]> {
    const products = await this.findAll();
    return products.map((p) => ({ ...p, ...this.applyPricing(p) }));
  }

  // called by the seed script to populate the DB on first run
  async upsert(data: Partial<Product>): Promise<Product> {
    const existing = await this.repo.findOne({ where: { sku: data.sku } });
    if (existing) {
      return this.repo.save({ ...existing, ...data });
    }
    return this.repo.save(this.repo.create(data));
  }

  // takes stock in redis (chapter 4.2). if redis is unavailable, the versioned update below
  // keeps the same guarantee, just slower
  async pick(sku: string, quantity = 1, maxAttempts = 5): Promise<number> {
    if (this.hot) {
      try {
        let result = await this.hot.take(sku, quantity);
        if (result.status === 'unseeded') {
          // redis restarted empty, or this sku is new. reload it, which also 404s unknown skus
          await this.hot.seed(sku, (await this.loadRow(sku)).stockLevel);
          result = await this.hot.take(sku, quantity);
        }
        if (result.status === 'ok') {
          picks.inc({ path: 'redis', outcome: 'ok' });
          return result.stock;
        }
        if (result.status === 'insufficient') {
          picks.inc({ path: 'redis', outcome: 'out_of_stock' });
          throw new ConflictException(`only ${result.stock} of ${sku} left`);
        }
      } catch (err) {
        if (err instanceof HttpException) throw err;
        this.markDegraded(err);
      }
    }
    try {
      const stock = await this.changeInPostgres(sku, -quantity, maxAttempts);
      picks.inc({ path: 'postgres', outcome: 'ok' });
      return stock;
    } catch (err) {
      picks.inc({ path: 'postgres', outcome: err instanceof ConflictException ? 'out_of_stock' : 'error' });
      throw err;
    }
  }

  // puts stock back, e.g. when a checkout fails and the customer returns the goods
  async release(sku: string, quantity = 1): Promise<number> {
    if (this.hot) {
      try {
        let stock = await this.hot.give(sku, quantity);
        if (stock === null) {
          await this.hot.seed(sku, (await this.loadRow(sku)).stockLevel);
          stock = await this.hot.give(sku, quantity);
        }
        if (stock !== null) return stock;
      } catch (err) {
        if (err instanceof HttpException) throw err;
        this.markDegraded(err);
      }
    }
    return this.changeInPostgres(sku, quantity);
  }

  // optimistic concurrency (chapter 4.3.1 of the spec): read version v, update WHERE
  // version = v, and if someone else got there first re-read and try again
  private async changeInPostgres(sku: string, change: number, maxAttempts = 5): Promise<number> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const p = await this.loadRow(sku);
      if (p.stockLevel + change < 0) throw new ConflictException(`only ${p.stockLevel} of ${sku} left`);

      const result = await this.repo.update(
        { sku, version: p.version },
        { stockLevel: p.stockLevel + change, version: p.version + 1 },
      );
      if (result.affected === 1) return p.stockLevel + change;
    }
    throw new ConflictException(`stock for ${sku} kept changing, try again`);
  }

  // the asynchronous write-back from chapter 4.2. it writes the absolute hot count rather than
  // a queue of changes, so a crash or a repeat can't apply the same pick twice
  async flushHotStock(): Promise<void> {
    if (!this.hot || this.flushing) return;
    this.flushing = true;
    try {
      if (this.degraded) await this.reconcile();
      const skus = await this.hot.drainDirty();
      if (skus.length === 0) return;
      const counts = await this.hot.read(skus);
      for (const sku of skus) {
        const stockLevel = counts.get(sku);
        if (stockLevel === undefined) continue;
        try {
          await this.repo.update({ sku }, { stockLevel });
        } catch (err) {
          this.logger.warn(`write-back failed for ${sku}, will retry: ${String(err)}`);
          await this.hot.markDirty(sku);
        }
      }
    } catch (err) {
      this.markDegraded(err);
    } finally {
      this.flushing = false;
    }
  }

  // after an outage postgres has picks redis missed, and redis may have picks not yet written
  // back. the lower count wins: at worst a unit is undersold, it is never sold twice
  private async reconcile() {
    const hot = this.hot!;
    const products = await this.repo.find();
    const counts = await hot.read(products.map((p) => p.sku));
    for (const p of products) {
      const current = counts.get(p.sku);
      if (current === undefined) {
        await hot.seed(p.sku, p.stockLevel);
        continue;
      }
      const stockLevel = Math.min(current, p.stockLevel);
      if (stockLevel !== current) await hot.overwrite(p.sku, stockLevel);
      if (stockLevel !== p.stockLevel) await this.repo.update({ sku: p.sku }, { stockLevel });
    }
    this.degraded = false;
    hotStockDegraded.set(0);
    this.logger.log('hot stock reconciled with postgres');
  }
}
