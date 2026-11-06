import { Controller, Get, Header } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Registry } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const picks = new Counter({
  name: 'ase_picks_total',
  help: 'Stock picks by how they were served and how they ended',
  labelNames: ['path', 'outcome'],
  registers: [registry],
});

export const hotStockDegraded = new Gauge({
  name: 'ase_hot_stock_degraded',
  help: '1 while redis is unavailable and picks go straight to postgres',
  registers: [registry],
});

// GET /api/metrics, scraped by prometheus. the gateway has no route to it
@Controller('metrics')
export class MetricsController {
  @Get()
  @Header('Content-Type', registry.contentType)
  scrape() {
    return registry.metrics();
  }
}
