import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  // GET /api/products, same shape as stage A so the dashboard doesn't need changes
  @Get()
  getAll() {
    return this.service.getAllWithPricing();
  }

  // GET /api/products/:sku
  @Get(':sku')
  async getOne(@Param('sku') sku: string) {
    const p = await this.service.findBySku(sku);
    return { ...p, ...this.service.applyPricing(p) };
  }

  // POST /api/products/:sku/pick { quantity } - called when a trolley accepts a scan
  // 409 if there isn't enough stock left
  @Post(':sku/pick')
  async pick(@Param('sku') sku: string, @Body() body: { quantity?: number }) {
    const quantity = body?.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) throw new BadRequestException('quantity must be a positive integer');
    return { sku, stockLevel: await this.service.pick(sku, quantity) };
  }
}
