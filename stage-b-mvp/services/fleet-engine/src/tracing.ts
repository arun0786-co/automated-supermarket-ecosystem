// chapter 11.2: distributed tracing. loaded with NODE_OPTIONS=--require ./dist/tracing.js before
// anything else, so the libraries it patches haven't been imported yet. the observability
// overlay turns it on, the service runs without it otherwise
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';

const sdk = new NodeSDK({
  // service name and endpoint come from OTEL_SERVICE_NAME and OTEL_EXPORTER_OTLP_ENDPOINT
  traceExporter: new OTLPTraceExporter(),
  // undici is what global fetch is built on
  instrumentations: [new HttpInstrumentation(), new UndiciInstrumentation(), new IORedisInstrumentation()],
});
sdk.start();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void sdk.shutdown());
}
