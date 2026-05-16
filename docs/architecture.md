# ASE-PRIME Architecture

This document lives in `docs/` and covers the full system design as of Stage A.
Diagrams are written in Mermaid — paste them into https://mermaid.live to render.

---

## 1. High-Level Flow

```mermaid
sequenceDiagram
    participant Trolley as Smart Trolley (Simulated)
    participant Backend as API Simulator (Node.js)
    participant WS as WebSocket Channel
    participant Dashboard as Web Dashboard (Next.js)
    participant Wallet as $SPMT Wallet

    Trolley->>Backend: Weight event (dWeight > 10g)
    Backend->>Backend: Simulate YOLOv8 inference + Kalman fusion
    Backend->>WS: Emit SCAN_EVENT {class, confidence, weight}
    WS->>Dashboard: Push to all connected clients
    Dashboard->>Dashboard: Update StoreMap canvas
    Dashboard->>Dashboard: Append to ScanFeed list
    Dashboard->>Dashboard: Re-run AI recommendation logic
    Dashboard->>Wallet: Deduct $SPMT for matched item
```

---

## 2. Trolley Data Model

```mermaid
classDiagram
    class Trolley {
        +id: string
        +x: number
        +y: number
        +status: IDLE | SHOPPING | CHECKOUT
        +cartItems: CartItem[]
        +tick(): void
    }

    class CartItem {
        +class: string
        +confidence: float
        +weightDelta: number
    }

    Trolley "1" --> "0..*" CartItem
```

---

## 3. WebSocket Event Types

| Event Type | Direction | Payload |
|---|---|---|
| `INFO` | Server → Client | Initial connection message |
| `TROLLEY_POSITIONS` | Server → Client | Array of all trolley states (every 1s) |
| `SCAN_EVENT` | Server → Client | Single item detection event |

---

## 4. Stage Progression

```mermaid
graph LR
    A["Stage A\nSimulation\n(Current)"] -->|Replace simulator\nwith real MQTT| B["Stage B\nMVP Microservices"]
    B -->|Add Jetson Nano,\nYOLOv8, ROS2| C["Stage C\nProduction Hardware"]

    style A fill:#1e3a5f,stroke:#3b82f6,color:#fff
    style B fill:#1a3a1a,stroke:#22c55e,color:#fff
    style C fill:#3a1a1a,stroke:#ef4444,color:#fff
```

---

## 5. Technology Decisions

| Layer | Stage A (Now) | Stage B | Stage C |
|---|---|---|---|
| Frontend | Next.js (Web) | Next.js + Flutter | Flutter (Native) |
| Backend | Express + WS | NestJS Microservices | Same + edge compute |
| Database | In-memory | PostgreSQL + Redis | Same |
| Messaging | WebSocket | MQTT + RabbitMQ | ROS 2 DDS |
| AI | Rule-based recs | Collaborative filter | YOLOv8 on Jetson |
| Blockchain | Mock ledger | Hyperledger Besu | Same |
| DevOps | Local | Docker Compose | Kubernetes (EKS) |
