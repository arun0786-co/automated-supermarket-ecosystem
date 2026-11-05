# ASE-PRIME Roadmap

A box is only checked if it was run and tested, and the note says how. Software that works but has never touched real hardware says so.

## Stage A: Simulation (complete)

- [x] Backend API simulator with trolley walk, catalog, mock ledger and fusion
- [x] Web dashboard: live map, scan feed, ledger, wallet cards
- [x] Flutter app with home, cart and wallet screens
- [x] Tests for checkout, pricing and fusion

## Stage B: MVP Microservices (complete)

- [x] **Service A**: Postgres catalog, chapter 4 pricing, Redis hot inventory with write-back, optimistic concurrency as the fallback. 40 of 40 concurrent picks succeed, up from 17 to 30 before Redis
- [x] **Service B**: FastAPI, YOLOv8n on ONNX on CPU, burst voting, Bayesian fusion. A real photo of a banana gives `PRD-001` through the gateway, at about 45 ms a frame
- [x] **Service C**: Solidity contracts on Hardhat or Besu
- [x] **Service D**: item-item model trained on baskets, plus a LinUCB bandit rewarded by what customers add
- [x] **Fleet engine**: the piece that connects everything, with carts that survive restarts
- [x] **MQTT**: authenticated broker with per-role topics, simulator speaking only MQTT
- [x] **Gateway**: JWT on every route, roles, rate limits, TLS option
- [x] **Auth**: login, rotating refresh tokens, right to be forgotten
- [x] **Dashboard** on stage B with login, tested in a real browser
- [x] **Mobile app** on stage B with login and offline cache, tested against the live stack. Not yet run on a phone or emulator
- [x] **End to end test**: `make e2e`, also in CI

## Stage C: Production

### Software, tested without hardware

- [x] **Besu with IBFT 2.0**: four validators, zero gas, survives one failure, halts safely on two. Measured on a laptop: 0.95 s per confirmed checkout, 42 checkouts a second. The spec's 1000+ TPS has not been shown
- [x] **Kubernetes**: all services, deployed to a real local cluster and tested on both Hardhat and four Besu validators, including network policies blocking traffic and pods recovering
- [x] **Metrics**: Prometheus with the spec's three metrics, Grafana dashboard
- [x] **Tracing**: one add to cart traced through fleet and product core to Redis and Postgres in Jaeger
- [x] **D\* Lite and A\***: layered costmap, matches a fresh A\* on random maps. On the store floor it replans in about 12 expansions against 1482 for starting over
- [x] **ROS 2 node**: built and tested over real topics in a Humble container

### Software written, not fully exercised

- [ ] **ArgoCD**: the `Application` manifest exists, but it has never been applied to a cluster running ArgoCD
- [ ] **Image publishing**: `.github/workflows/images.yml` runs on version tags, and no tag has been pushed yet
- [ ] **Production overlay**: accepted by a Kubernetes API server in a dry run, but not deployed to a cloud account
- [ ] **Istio mTLS**: the component exists, but it hasn't been run with Istio
- [ ] **ESP32 firmware**: logic tested on a computer, compiles for an ESP32, has never run on a device. The calibration factor is a placeholder
- [ ] **Training pipeline**: ran one epoch on the public coco8 sample, and the vision service loads the result. No store dataset exists, so nothing has been trained for real
- [ ] **TensorRT export**: the script exists, but it needs a Jetson or Nvidia GPU

### Needs things that can't be done from a laptop

- [ ] Source hardware: Jetson Orin Nano, load cells, RPLIDAR A1, cameras, about $1,200 a trolley
- [ ] Build the chassis, mount sensors, flash and calibrate firmware
- [ ] Photograph products and train on them. Until then the real model only recognises the 5 catalog items in COCO: banana, apple, orange, broccoli and carrot
- [ ] SLAM on real LiDAR, testing navigation in Gazebo and on a real trolley
- [ ] Geofencing and anti-tamper (chapter 10.2), which depend on trolley hardware
- [ ] Store network: WiFi 6E, VLANs, BLE beacons, smart shelves
- [ ] Payment provider for real fiat top-ups and overdraft recovery. `POST /api/wallet/mint` stands in for now
- [ ] Legal review before handling real money or personal data. A stablecoin and an overdraft product are both regulated in most places

## Beyond Stage C

From the spec, not started:

- Federated learning for recommendations
- `$ASE-GOV` governance token
- BLE indoor positioning in the app
- Smart shelf integration as a second signal for vision
