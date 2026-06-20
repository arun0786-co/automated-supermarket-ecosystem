import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './product.entity';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly repo: Repository<Product>,
  ) {}

  findAll(): Promise<Product[]> {
    // only return active products — soft-delete by setting active=false
    return this.repo.find({ where: { active: true } });
  }

  async findBySku(sku: string): Promise<Product> {
    const p = await this.repo.findOne({ where: { sku } });
    if (!p) throw new NotFoundException(`sku ${sku} not found`);
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

  // take items off the shelf with optimistic concurrency (chapter 4.3.1 of the spec):
  // read version v, update WHERE version = v, and if someone else got there first
  // re-read and try again. returns the new stock level
  async pick(sku: string, quantity = 1, maxAttempts = 5): Promise<number> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const p = await this.findBySku(sku);
      if (p.stockLevel < quantity) throw new ConflictException(`only ${p.stockLevel} of ${sku} left`);

      const result = await this.repo.update(
        { sku, version: p.version },
        { stockLevel: p.stockLevel - quantity, version: p.version + 1 },
      );
      if (result.affected === 1) return p.stockLevel - quantity;
    }
    throw new ConflictException(`stock for ${sku} kept changing, try again`);
  }
}
