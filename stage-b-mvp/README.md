# Stage B: MVP Microservices

This directory is the next phase of ASE-PRIME. The goal here is to break apart the
monolithic Stage A simulator into real, containerised microservices with actual databases,
a message broker, and containerised deployments.

## What Changes from Stage A to Stage B

| Component | Stage A | Stage B |
|---|---|---|
| Trolley data | Simulated in Node.js | Real MQTT messages from hardware OR a high-fidelity ROS 2 bag replay |
| Database | In-memory (Map) | PostgreSQL + Redis |
| Blockchain | Mock SHA256 hashes | Hyperledger Besu node (private EVM chain) |
| AI Recommendations | Rule-based lookup table | Collaborative filtering (Python / FastAPI) |
| Deployment | `npm start` on localhost | Docker Compose |
| Auth | None | JWT (short-lived tokens) + mTLS between services |

## Services

### Service A: Product Core
- **Runtime:** Node.js (TypeScript) + NestJS
- **DB:** PostgreSQL (Redis read cache not wired yet)
- **Exposes:** REST

### Service B: Vision API (edge simulation, not started)
- **Runtime:** Python 3.11 + FastAPI
- **ML:** YOLOv8-nano (ONNX format for portability, no GPU needed for stage B)
- **Input:** Simulated image frames from video files

### Service C: Fintech Vault
- **Runtime:** Node.js + ethers.js
- **Chain:** Local Hardhat network (EVM-compatible, instant mining)
- **Contract:** `SPMTToken.sol` + `Checkout.sol`

### Service D: Recommendation Engine
- **Runtime:** Python + FastAPI
- **Algorithm:** hand-written co-purchase matrix for now; collaborative filtering with surprise + contextual bandits is next

### Gateway
- **Runtime:** NGINX
- **Handles:** routing and health checks today; JWT validation, rate limiting and SSL termination are next

## Getting Started

```bash
# from the repo root, needs Docker
cp stage-b-mvp/.env.example stage-b-mvp/.env   # then set POSTGRES_PASSWORD and ADMIN_TOKEN
make stage-b
```

No passwords live in the repo. Compose refuses to start without `POSTGRES_PASSWORD`, and
mint stays disabled while `ADMIN_TOKEN` is empty. To run product-core outside Docker, set
`DATABASE_URL` or `DB_PASS` (plus `DB_HOST`, `DB_USER`, `DB_NAME` if they differ from the defaults).

Everything is reached through the nginx gateway on port 80:

| Path | Service |
|---|---|
| `GET /health` | gateway itself |
| `GET /health/products`, `/health/vault`, `/health/ai` | each service's health |
| `GET /api/products`, `GET /api/products/:sku` | product-core catalog with pricing |
| `POST /api/products/:sku/pick` `{ "quantity": 1 }` | take stock, 409 if not enough left |
| `GET /api/wallet/:address` | SPMT balance and overdraft state |
| `POST /api/wallet/mint` | top up, needs `Authorization: Bearer $ADMIN_TOKEN` |
| `POST /api/checkout` `{ customer, amount, cartItems }` | on-chain checkout |
| `GET /api/ledger` | recent Purchase events from the chain |
| `POST /api/recommendations` | co-purchase recommendations for a cart |

On start, product-core seeds any missing products and the vault deploys fresh contracts
to the hardhat node, minting the three Stage A demo customers onto hardhat accounts #2 to #4.
The hardhat chain is in-memory, so balances reset when the stack restarts.

## Tests

```bash
cd services/product-core && npm install && npm test
cd services/fintech-vault && npm install && npx hardhat test
cd services/ai-engine && pip install -r requirements-dev.txt && python -m pytest
```

## What You Need to Install First
- Docker with Compose
- Node.js 20+ and Python 3.11+ to run the tests outside Docker
