// chapter 11.2: distributed tracing, so one add to cart can be followed down to the database.
// loaded with NODE_OPTIONS=--require ./dist/tracing.js before anything else, so the libraries it
// patches haven't been imported yet. the observability overlay turns it on
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

const sdk = new NodeSDK({
  // service name and endpoint come from OTEL_SERVICE_NAME and OTEL_EXPORTER_OTLP_ENDPOINT
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [new HttpInstrumentation(), new IORedisInstrumentation(), new PgInstrumentation()],
});
sdk.start();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void sdk.shutdown());
}
