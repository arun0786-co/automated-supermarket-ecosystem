# ASE-PRIME Roadmap

## Stage A — Simulation ✅ (Complete)

The full system is simulated in software. 5 virtual trolleys navigate a store floor, scan items using a mock YOLOv8 pipeline with Kalman-style sensor fusion, and check out using a mock blockchain with real SHA256 block hashes.

### Completed
- [x] Backend API simulator (Node.js + TypeScript)
- [x] 30+ product catalog with dynamic expiry-based pricing (Service A logic)
- [x] Vision + weight fusion simulator with confidence scoring (Service B logic)
- [x] Mock blockchain wallet service with Limited Overdraft smart contract (Service C logic)
- [x] Rule-based AI recommendation engine (Service D logic)
- [x] WebSocket real-time event feed (`TROLLEY_POSITIONS`, `SCAN_EVENT`, `CHECKOUT_EVENT`)
- [x] Web dashboard (Next.js) — live store map, scan feed, blockchain ledger, wallet cards
- [x] Flutter mobile app scaffold (Home, Cart, Wallet screens with live WS connection)
- [x] Full project documentation (architecture, API reference, stage READMEs)

---

## Stage B — MVP Microservices 🔜

Break the monolith into real containerised services with actual databases and a message broker.

### To Build
- [ ] **Service A** — NestJS + PostgreSQL + Redis (real product DB, inventory tracking)
- [ ] **Service B** — Python FastAPI + YOLOv8 ONNX (runs without GPU using CPU inference)
- [ ] **Service C** — Hardhat local chain + Solidity `SPMTToken.sol` + `Checkout.sol`
- [ ] **Service D** — Python FastAPI + collaborative filtering (scikit-surprise)
- [ ] **NGINX Gateway** — JWT validation, rate limiting, CORS
- [ ] **MQTT Broker** — Mosquitto, replace WebSocket with pub/sub topics
- [ ] **Docker Compose** — One-command local startup for all services
- [ ] **Auth** — JWT login flow on mobile app and dashboard

**Target stack:** Docker Compose, PostgreSQL 16, Redis 7, Hardhat, FastAPI, NestJS

---

## Stage C — Production Hardware 🔮

Deploy to real smart trolleys and a cloud Kubernetes cluster.

### Hardware Milestones
- [ ] Source hardware (Jetson Orin Nano, load cells, RPLIDAR A1, cameras)
- [ ] Build prototype trolley chassis
- [ ] Flash ESP32 firmware for HX711 weight ADC
- [ ] Mount cameras and depth sensor

### Software Milestones
- [ ] Train YOLOv8-nano on store product images
- [ ] Export to TensorRT (INT8 quantized) for Jetson
- [ ] Write ROS 2 SLAM localisation node
- [ ] Implement D* dynamic pathfinding for obstacle avoidance
- [ ] Migrate Hardhat → Hyperledger Besu (private EVM, IBFT 2.0 consensus)
- [ ] Kubernetes manifests for all services (EKS or GKE)
- [ ] CI/CD pipeline — GitHub Actions → ArgoCD → Kubernetes
- [ ] Monitoring — Prometheus + Grafana dashboards
- [ ] Distributed tracing — Jaeger

---

## Beyond Stage C

- Smart shelf pressure-mat integration (secondary vision confirmation)
- BLE beacon indoor positioning in Flutter app (maps user to aisle in real-time)
- Federated Learning for privacy-preserving recommendation model updates
- `$ASE-GOV` governance token (customers vote on store policies)
- GDPR "Right to be Forgotten" — anonymous ID mapping in off-chain SQL
