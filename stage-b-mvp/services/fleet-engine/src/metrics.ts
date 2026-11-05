import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

// chapter 11.2: prometheus scrapes these from /metrics. this isn't routed through the gateway
export function createMetrics(trolleys: () => { itemCount: number }[]) {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  new Gauge({
    name: 'ase_active_carts',
    help: 'Carts with at least one item in them',
    registers: [registry],
    collect() {
      this.set(trolleys().filter((t) => t.itemCount > 0).length);
    },
  });
  const scans = new Counter({
    name: 'ase_scans_total',
    help: 'Trolley scans by outcome: accepted, or why they were rejected',
    labelNames: ['outcome'],
    registers: [registry],
  });
  const checkouts = new Counter({
    name: 'ase_checkouts_total',
    help: 'Checkouts by outcome: paid, refused or unknown',
    labelNames: ['outcome'],
    registers: [registry],
  });
  const latency = new Histogram({
    name: 'ase_transaction_latency_seconds',
    help: 'Time from starting a checkout to knowing its result',
    labelNames: ['outcome'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [registry],
  });

  return {
    registry,
    scan: (outcome: string) => scans.inc({ outcome }),
    checkout: (outcome: string, seconds: number) => {
      checkouts.inc({ outcome });
      latency.observe({ outcome }, seconds);
    },
  };
}

export type EngineMetrics = Pick<ReturnType<typeof createMetrics>, 'scan' | 'checkout'>;
