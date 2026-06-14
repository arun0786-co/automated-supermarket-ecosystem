import { Injectable, NotFoundException } from '@nestjs/common';
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

  // decrement stock when a scan event comes in from the trolley
  async decrementStock(sku: string, quantity = 1): Promise<void> {
    await this.repo.decrement({ sku }, 'stockLevel', quantity);
  }
}
