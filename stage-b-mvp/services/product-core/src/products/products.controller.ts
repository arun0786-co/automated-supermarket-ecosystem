import { Controller, Get, Param } from '@nestjs/common';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  // GET /api/products — same shape as stage A so the dashboard doesn't need changes
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
}
