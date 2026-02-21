# Stage B — MVP Microservices

This directory is the next phase of ASE-PRIME. The goal here is to break apart the
monolithic Stage A simulator into real, containerised microservices with actual databases,
a message broker, and containerised deployments.

## What Changes from Stage A → Stage B

| Component | Stage A | Stage B |
|---|---|---|
| Trolley data | Simulated in Node.js | Real MQTT messages from hardware OR a high-fidelity ROS 2 bag replay |
| Database | In-memory (Map) | PostgreSQL + Redis |
| Blockchain | Mock SHA256 hashes | Hyperledger Besu node (private EVM chain) |
| AI Recommendations | Rule-based lookup table | Collaborative filtering (Python / FastAPI) |
| Deployment | `npm start` on localhost | Docker Compose |
| Auth | None | JWT (short-lived tokens) + mTLS between services |

## Services Planned

### Service A — Product Core
- **Runtime:** Node.js (TypeScript) + NestJS
- **DB:** PostgreSQL (write) + Redis (read cache)
- **Exposes:** REST + WebSocket

### Service B — Vision API (edge simulation)
- **Runtime:** Python 3.11 + FastAPI
- **ML:** YOLOv8-nano (ONNX format for portability, no GPU needed for stage B)
- **Input:** Simulated image frames from video files

### Service C — Fintech Vault
- **Runtime:** Node.js + ethers.js
- **Chain:** Local Hardhat network (EVM-compatible, instant mining)
- **Contract:** `SPMTToken.sol` + `Checkout.sol`

### Service D — Recommendation Engine
- **Runtime:** Python + FastAPI
- **Algorithm:** Collaborative filtering with surprise library + contextual bandits

### Gateway
- **Runtime:** NGINX or Kong
- **Handles:** JWT validation, rate limiting, SSL termination

## Getting Started (not yet implemented)

```bash
# requires Docker + Docker Compose
docker compose up
```

## What You Need to Install First
- Docker Desktop
- Node.js 20+
- Python 3.11+
- (Optional for blockchain): Hardhat CLI
