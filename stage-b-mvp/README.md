# Stage B: Microservices

The whole system running in containers: a simulated trolley publishes over MQTT, and everything else is the real software.

## Run it

```bash
make stage-b-env    # once: creates .env with random secrets and prints your logins
make stage-b        # builds and starts everything
```

Open <http://localhost> and log in with the admin details it printed.

| Command | Adds |
|---|---|
| `make stage-b` | The normal stack on the Hardhat dev chain |
| `make stage-b-besu` | A real four validator IBFT 2.0 chain |
| `make stage-b-observability` | Prometheus on :9090, Grafana on :3100, Jaeger on :16686 |
| `make stage-b-tls` | HTTPS on :443 |
| `make stage-b-down` | Stops it, keeping data |

**If Docker says `docker-credential-desktop` isn't found**, remove the `"credsStore": "desktop"` line from `~/.docker/config.json`. It's left over from Docker Desktop.

**Customers run out of money.** At the default pace all three wallets run dry in roughly 10 minutes, after which checkouts are refused, stock goes back and staff get an alert. That's the right behaviour. To top one up, log in as admin and call the mint route:

```bash
curl -X POST http://localhost/api/wallet/mint -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"to":"0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC","amount":"100"}'
```

The addresses are in `services/auth-service/src/main.ts`.

## Services

| Service | Spec | Built with | Holds |
|---|---|---|---|
| `product-core` | A, chapter 4 | NestJS, TypeORM | Catalog and stock in Postgres, live counts in Redis |
| `vision` | B, chapter 5 | FastAPI, onnxruntime | Nothing |
| `fintech-vault` | C, chapter 6 | Express, ethers | Contract addresses |
| `ai-engine` | D, chapter 7 | FastAPI, numpy | Model state, in a volume |
| `auth-service` | chapter 10 | Express, Postgres | Users and the person to address mapping |
| `fleet-engine` | connects them | Express, MQTT | Carts in Redis |
| `trolley-sim` | hardware stand-in | MQTT only | Nothing, replaced by real trolleys in stage C |
| `web-dashboard` | fleet command | Next.js | Nothing |
| `gateway` | chapter 3 | nginx | Nothing |

The API is in [docs/api-stage-b.md](../docs/api-stage-b.md) and the design in [docs/architecture.md](../docs/architecture.md).

## The vision model

Simulated trolleys send what the camera would have reported, labelled `simulated` in every response. To use the real model on real images:

```bash
make vision-model   # exports yolov8n to services/vision/models, not committed
```

The pretrained model only knows 5 catalog items: banana, apple, orange, broccoli and carrot. Recognising the rest takes a model trained on store photos, see `stage-c-production/vision`.

Ultralytics and its weights are AGPL-3.0. That matters if this ever ships as a closed commercial product: it needs Ultralytics' enterprise licence, or a different model.

## Tests

```bash
make test    # every unit suite, each service needs its own install first
make e2e     # starts a fresh stack, tests it, removes it
```

`make e2e` takes about 6 minutes. It uses its own compose project and throwaway secrets, so your data isn't touched, but it needs ports 80 and 1883 free, so stop a running stack first. It covers the API, who can do what, the whole trolley loop, real outages, a real browser and the mobile app's state code against the live stack.

`E2E_OVERLAY=besu`, `observability` or `tls` adds those checks. `E2E_BROWSER=0` skips the browser, whose image is large. `E2E_BANANA_PHOTO=<path>` adds a real camera burst when the model is exported.

Some bugs only show over time. It's worth leaving `make stage-b` running for a couple of hours, then checking that the Postgres stock total matches the catalog and searching the fleet engine's log for errors. That's how the recommendations bug in the git history was found.

## Needs

Docker with Compose. To run tests outside Docker: Node 22.13 or newer, Python 3.11 and Flutter.
