import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';

// GET /api/health, used by the nginx gateway's /health/products route
@Controller('health')
export class HealthController {
  constructor(private readonly ds: DataSource) {}

  @Get()
  async check() {
    await this.ds.query('SELECT 1');
    return { status: 'ok', service: 'product-core', stage: 'B' };
  }
}
