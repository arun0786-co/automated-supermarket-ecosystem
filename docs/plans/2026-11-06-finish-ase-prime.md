# Finish ASE-PRIME Implementation Plan

**Status:** done. [roadmap.md](../roadmap.md) has what was proven. Where the build differs from this plan: purchases reach the AI engine as `{ skus }` with no customer id, the mobile app has no offline add-to-cart queue (see architecture section 5), and the Kubernetes test uses kind rather than k3s.

**Goal:** turn the separate stage B services into one working system that follows the spec, then build the stage C software that can be proven without hardware.

**Architecture:** a simulated trolley publishes over MQTT, exactly as the Jetson would. A fleet engine consumes those messages, asks the vision service to fuse camera and weight, takes stock through product-core, charges through the vault and pushes the existing stage A event shapes to the dashboard and app. Everything external goes through the nginx gateway with JWT.

**Tech stack:** Node 22, TypeScript, NestJS 12, Express, Python 3.11, FastAPI, onnxruntime, numpy, Postgres 16, Redis 7, Mosquitto 2, Hardhat or Besu, Next.js 16, Flutter, Docker Compose, Kubernetes.

**Spec:** `Automated Supermarket Ecosystem.pdf` (v2.0.0). Chapter numbers below refer to it.

## Global Constraints

- Keep the stage A event shapes: `INFO`, `TROLLEY_POSITIONS`, `SCAN_EVENT`, `CHECKOUT_EVENT`, and `/api/wallets` rows of `{ userId, name, balance, overdraftLimit, isSubscriber }`. Stage A must keep working.
- Fusion values from chapter 5: load cell precision 5 g, catalog match within 10 g, burst of 5 frames, minimum confidence 0.60 (existing stage A rule).
- Pricing from chapter 4: `Days_To_Expiry < 2 AND Stock_Level > Threshold` gives 20% off.
- No secrets, datasets or model weights in git. Compose refuses to start without required secrets.
- No hardcoded behaviour that pretends to be real. Simulated inputs are labelled `simulated` in the output.
- Small lowercase commits on branch `finish-stage-b`. Nothing is pushed without asking.

## Review Focus

Each of these gets a test in the task that owns the code.

1. Duplicate MQTT delivery (QoS 1 redelivers): the same scan or checkout must not add or charge twice.
2. The last unit picked by two trolleys at once: exactly one succeeds, including when Redis is down and the Postgres path takes over.
3. A dependency down mid-shop (vision, product-core, vault, broker, fleet restart): no unverified item enters a cart, no cart is lost, an ambiguous checkout failure is never retried into a double charge.
4. A token expiring on an open WebSocket or dashboard: the connection closes and the UI returns to login, it does not sit on stale data.
5. Malformed or hostile input on a broker topic or public route: logged and dropped, the service stays up (chapter 10 treats the local network as hostile).

## Scope Boundaries

**Cannot be finished here, needs hardware or real-world access:** chassis build, sensor mounting, flashing and testing firmware on a device, TensorRT and DeepStream on a Jetson, SLAM on real LiDAR, BLE beacons, smart shelves, store network and VLANs, training on real store images (no dataset exists), fiat top-up and recovery through a payment provider, deployment to a paid cloud account.

**Replaced on purpose, recorded in `docs/roadmap.md`:**

| Spec | Used here | Why |
|---|---|---|
| MongoDB for flexible attributes | Postgres | No feature needs a second database yet |
| Redis Cluster | Single Redis | Same commands, cluster is a deployment concern |
| TFX and Milvus | numpy item-item model | 33 products do not need a vector database |
| scikit-surprise (old roadmap) | numpy | Basket data is implicit, surprise targets explicit ratings |
| C++ inference, DeepStream | Python and onnxruntime | Stage B runs on CPU per the roadmap |
| GitLab, Harbor, SonarQube | GitHub Actions and GHCR | The repo is on GitHub |
| Kong | nginx | The spec allows either |

**Left for later, per the roadmap's "Beyond Stage C":** federated learning, `$ASE-GOV`, BLE positioning, smart shelf integration.

## File Structure

```
stage-b-mvp/services/
  vision/         service B: fusion, burst inference, onnx detector
  trolley-sim/    publishes what the jetson will publish, nothing else
  fleet-engine/   mqtt consumer, carts, websocket feed, wallet view
  auth-service/   users, jwt, refresh, gateway verify, right to be forgotten
  product-core/   add hot inventory (redis) and release
  ai-engine/      add item-item model and contextual bandit
  fintech-vault/  report overdraftUsed from checkout
stage-b-mvp/e2e/  repeatable end to end test, also run in ci
stage-b-mvp/observability/  prometheus, grafana, jaeger config
stage-b-mvp/besu/ ibft 2.0 chain overlay
stage-c-production/
  k8s/            kustomize base and overlays, argocd application
  robotics/       costmap, a*, d* lite, ros 2 node
  firmware/       esp32 load cell firmware
  vision/         yolov8 training and export pipeline
```

## Shared Contracts

**MQTT, QoS 1 except position.** Every client authenticates. Topics follow `config/mosquitto.conf`:

| Topic | Direction | Payload |
|---|---|---|
| `trolley/<id>/position` | sim to fleet | `{ userId, x, y, ts }` |
| `trolley/<id>/scan` | sim to fleet | `{ eventId, weightDelta, frames?: string[], detection?: { sku, confidence } }` |
| `trolley/<id>/led` | fleet to sim | `{ color: 'red' \| 'green', reason? }` |
| `trolley/<id>/checkout` | fleet to sim | `{ ok, total, hash?, reason? }` |
| `store/alerts` | fleet | `{ type: 'LOW_STOCK' \| 'CHECKOUT_FAILED', ... }` |

**Vision.** `POST /api/vision/scan { weightDelta, frames?, detection? }` returns `{ sku, confidence, fusionProbability, accepted, reason?, source: 'model' \| 'simulated' }`. Reasons: `low confidence`, `weight mismatch`, `unknown item`, `no detection`.

**Product core.** Existing routes plus `POST /api/products/:sku/release { quantity }`.

**Auth.** `POST /api/auth/{login,register,refresh,logout}`, `GET` and `DELETE /api/auth/me`. Token response: `{ accessToken, refreshToken, expiresIn, user: { id, name, role } }`. Internal only: `GET /internal/verify` (204 with `X-User-Id`, `X-User-Role`, else 401) and `GET /internal/users/:id` returning `{ id, name, walletAddress }`.

**Fleet.** `WS /ws`, `GET /api/wallets`, `GET /api/wallets/:id`, `GET /api/fleet/cart/:userId`. New event: `RECOMMENDATION_EVENT { trolleyId, userId, recs }`.

**AI.** Existing routes plus `POST /api/recommendations/feedback { userId, sku, reward, context }`, `POST /api/events/purchase { userId, skus }`, `GET /api/recommendations/model`.

## Milestone 1: End to end harness

### Task 1: Repeatable stage B test

**Files:** create `stage-b-mvp/e2e/smoke.sh`, modify `Makefile`, `.github/workflows/test.yml`.

- [x] Port the throwaway smoke test into the repo, with `make e2e` starting compose under project `ase-e2e`, running it and tearing down that project only.
- [x] Add a `stage-b-e2e` CI job so stage B actually gets started on every push.
- [x] Run `make e2e`. Expected: every check passes on the current code.
- [x] Commit.

## Milestone 2: Service B, vision and fusion (chapter 5)

### Task 2: Fusion

**Files:** create `stage-b-mvp/services/vision/{fusion.py,test_fusion.py}`.

- [x] Write tests: confidence 0.85 at 450 g against a 450 g item gives `fusionProbability > 0.99` and accepted (spec example). Cereal at 1000 g is rejected with `weight mismatch` (spec conflict example). Confidence 0.59 is rejected with `low confidence`. Exactly 10 g off is accepted, 10.1 g is not.
- [x] Run, expect failure.
- [x] Implement `fuse(confidence: float, weight_delta: float, catalog_weight: float) -> FusionResult`. Bayesian update with a Gaussian match likelihood (sigma 5 g) against a uniform alternative over a 1000 g range.
- [x] Run, expect pass. Commit.

### Task 3: Burst inference and service

**Files:** create `vision/{main.py,detector.py,requirements*.txt,Dockerfile,test_main.py,scripts/export_model.sh}`, modify `docker-compose.yml`, CI, `.gitignore`.

- [x] Write tests with a stub detector: 3 of 5 frames say banana gives banana with the mean confidence of those frames. Empty detections give `no detection`. A COCO class with no catalog item gives `unknown item`. Undecodable base64 gives 400. Product-core down gives 503, never accepted. `detection` input reports `source: simulated`. Frames with no model loaded give 503.
- [x] Implement `Detector.detect(frame) -> list[Detection]` with onnxruntime, letterbox to 640, numpy NMS, and `COCO_TO_SKU` for banana, apple, orange, broccoli, carrot. Only those five can come from the real model until a store-trained model exists.
- [x] Export `yolov8n.onnx` from the official weights through the script, gitignored. Run a real banana photo through the running container. Expected: `PRD-001`, `source: model`.
- [x] Commit.

## Milestone 3: Hot inventory (chapter 4.2)

### Task 4: Redis pick path

**Files:** create `product-core/src/products/hot-inventory.ts` and test, modify `products.service.ts`, `products.controller.ts`, `package.json`.

- [x] Write tests against a fake client: stock 1 with two concurrent picks gives one success and one conflict. Redis errors fall back to the existing versioned Postgres pick. Write-back applies the queued deltas once. A restart keeps existing hot counts (`SETNX`).
- [x] Implement a Lua check-and-decrement, a write-back list drained every 200 ms through the versioned update, `release`, and a catalog read that overlays hot stock so pricing stays accurate.
- [x] Extend e2e: 40 concurrent picks all return 201 when stock allows (baseline before this change: 17 to 21 of 40), and Postgres converges to the Redis count.
- [x] Commit.

## Milestone 4: The connected loop (chapters 3, 5, 6)

### Task 5: Broker auth and trolley simulator

**Files:** create `services/trolley-sim/*`, modify `config/mosquitto.conf`, `docker-compose.yml`, `.env.example`.

- [x] Require a username and password on the broker. The password file is generated at container start from env.
- [x] Move the stage A walk and scan generator into `trolley-sim`, publishing the contract above. Keep the 1 in 10 bad scan rate. Test the message shapes.
- [x] Commit.

### Task 6: Fleet engine

**Files:** create `services/fleet-engine/*`, modify `fintech-vault/src/routes/checkout.ts`.

**Interfaces:** consumes vision, product-core, vault, auth `GET /internal/users/:id`. Produces the WebSocket feed and wallet view.

- [x] Write tests with fake dependencies. A duplicate `eventId` is ignored. A vision failure gives `accepted: false, reason: 'vision unavailable'`, cart unchanged. A pick conflict gives `reason: 'out of stock'`. The 15th item triggers exactly one checkout. A vault timeout is not retried and raises `CHECKOUT_FAILED`. A failed checkout releases stock and clears the cart after 5 s. Malformed JSON is dropped without a crash. Carts are restored from Redis after a restart. `overdraftUsed` is passed through.
- [x] Implement it. Scan flow: vision, then pick, then cart, then `SCAN_EVENT` and LED. Write carts through to Redis. Publish `LOW_STOCK` at or below the discount threshold.
- [x] Have the vault return `overdraftUsed` from the `OverdraftUsed` event, with a contract level test.
- [x] Extend e2e: within 3 minutes the feed shows accepted and rejected scans, a checkout with a real chain hash, a matching ledger row, and reduced stock.
- [x] Commit.

## Milestone 5: Service D, recommendations (chapter 7)

### Task 7: Item-item model and bandit

**Files:** create `ai-engine/{model.py,bandit.py,baskets.py}` and tests, modify `main.py`, `requirements.txt`.

- [x] Write tests: baskets where X and Y co-occur rank Y first for X. Cart items are never recommended. A cold start uses synthetic baskets and reports `trainedOn: synthetic`. Real purchases change the ranking after retraining and report `mixed`. With repeated reward on one action in a context, LinUCB ranks it first in that context and not in another. A corrupt state file falls back to synthetic training.
- [x] Implement cosine item-item on numpy and LinUCB over aisle, hour bucket and cart categories, with atomic JSON persistence on a volume. Update and audit the pinned Python dependencies.
- [x] Wire the fleet: send `RECOMMENDATION_EVENT` after accepted scans, report rewards and purchases. The dashboard uses event data when present and keeps the stage A table otherwise.
- [x] Commit.

## Milestone 6: Zero trust at the edge (chapter 10)

### Task 8: Auth service

**Files:** create `services/auth-service/*`.

- [x] Write tests: wrong password gives 401 with no hint of which field failed. A tampered or expired token gives 401 on verify. Refresh rotates, and reusing an old refresh token revokes the family. Forgetting a user removes email, name and the wallet mapping while the on-chain record stays. Deleted users cannot log in.
- [x] Implement it with Express, pg, scrypt from node crypto and `jose`. Access tokens last 15 minutes. Seed the three demo customers on hardhat accounts #2 to #4 and an admin, with passwords from env.
- [x] Commit.

### Task 9: Gateway

**Files:** modify `config/nginx.conf`, `docker-compose.yml`, `fleet-engine`, `e2e/smoke.sh`.

- [x] Add `auth_request` on everything except auth and health. Customers get 403 on checkout and mint routes. Rate limit API and login separately. WebSocket token in the query string with access log off, and the fleet closes the socket at token expiry. Customers only receive their own trolley's events and wallet.
- [x] Extend e2e: no token gives 401, customer on another wallet gives 403, login burst gives 429, a token on the WebSocket works.
- [x] Commit.

## Milestone 7: Clients on stage B

### Task 10: Dashboard

**Files:** modify `web-dashboard/src/lib/config.ts`, `src/app/page.tsx`; create login view and `Dockerfile`; modify `nginx.conf`, `docker-compose.yml`.

- [x] Served behind the gateway at `/`, so there is no CORS. Login appears only when `NEXT_PUBLIC_REQUIRE_LOGIN=1`, so stage A stays as it is. Refresh silently, return to login on failure. Show the real stage name.
- [x] Open it in a browser against the running stack and check the map, feeds, wallets and ledger.
- [x] Commit.

### Task 11: Mobile app (chapter 9)

**Files:** modify `mobile-app/lib/**`, `pubspec.yaml`.

- [x] Write tests: `CartState` follows the signed-in user, not a fixed trolley. Offline, the catalog and cart load from the local cache. Reconnect reconciles the cart with `GET /api/fleet/cart/:userId`. Queued add-to-cart requests replay once.
- [x] Add a login screen and token storage. Pick the local store by what `flutter test` can run. Keep Provider and record BLoC as a deliberate difference unless it blocks something.
- [x] Run `flutter analyze` and `flutter test`, then run the app against the stack if a device target is available.
- [x] Commit.

## Milestone 8: Operations (chapter 11)

### Task 12: Metrics and tracing

**Files:** create `stage-b-mvp/observability/*`, modify services and `docker-compose.observability.yml`.

- [x] Add `/metrics` with the spec's three named metrics: active carts, transaction latency, vision model confidence. Provision a Grafana dashboard.
- [x] Add OpenTelemetry to fleet and product-core, exporting to Jaeger. The test: query the Jaeger API for one add-to-cart trace spanning fleet, product-core and Postgres.
- [x] Commit.

### Task 13: Besu with IBFT 2.0 (chapter 6)

**Files:** create `stage-b-mvp/besu/*`, `docker-compose.besu.yml`.

- [x] Add a compose overlay with zero gas pricing. Deploy the same contracts. Run the e2e vault checks on it. Measure block finality and report it, without claiming the spec's 1000+ TPS unless measured.
- [x] Commit.

### Task 14: Kubernetes and GitOps

**Files:** create `stage-c-production/k8s/**`, `.github/workflows/images.yml`.

- [x] Kustomize base for all services with probes, limits, secrets by reference and network policies. Add Istio mTLS as an optional overlay. Add an ArgoCD `Application`. Image build workflow to GHCR on tags only.
- [x] Apply it to a local k3s under a separate Colima profile and run the smoke test against it. If that cannot run, validate with server side dry run and say so.
- [x] Commit.

## Milestone 9: Stage C software with no hardware

### Task 15: Navigation (chapter 8)

**Files:** create `stage-c-production/robotics/ase_navigation/*` and tests.

- [x] Write tests: A* gives the optimal path on an empty map. An inflation layer keeps paths off shelves. D* Lite replans after a new obstacle and matches a fresh A* cost, while expanding fewer nodes. A fully blocked goal returns no path instead of hanging.
- [x] Implement in pure Python with a thin ROS 2 node, and run it in a `ros:humble` container. Gazebo and SLAM stay out.
- [x] Commit.

### Task 16: Firmware and training pipeline

**Files:** create `stage-c-production/firmware/*`, `stage-c-production/vision/*`.

- [x] Stabilisation logic in a plain C++ header with host tests: fires at more than 10 g once stable for 500 ms, ignores jitter under 5 g. Compile for ESP32 with PlatformIO if the toolchain installs. Marked as never run on a device.
- [x] YOLOv8 train and ONNX export scripts with a dataset template, smoke tested for one epoch on the public `coco8` sample. TensorRT export is written but marked as needing a Jetson.
- [x] Commit.

## Milestone 10: Finish

### Task 17: Docs and honest status

- [x] Update `README.md`, `docs/architecture.md`, `docs/api-reference.md`, `docs/roadmap.md`, stage READMEs. Every checked box must have been run.
- [x] Run every suite, `make e2e`, and audits for npm and Python. Report exactly what ran.
- [x] Write `.bridge/STATUS.md` with the handoff skill. Ask before pushing.
