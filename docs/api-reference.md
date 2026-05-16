# API Reference — Stage A Simulator

Base URL: `http://localhost:3001`
WebSocket: `ws://localhost:3001`

---

## REST Endpoints

### Health

**GET** `/api/health`

Returns service status and current blockchain block height.

```json
{
  "status": "ok",
  "service": "ASE-PRIME Simulator",
  "stage": "A",
  "blockHeight": 10004
}
```

---

### Products (Service A)

**GET** `/api/products`

Returns full product catalog with dynamic pricing applied.

```json
[
  {
    "sku": "PRD-001",
    "name": "Banana",
    "category": "Produce",
    "price": 0.96,
    "weight": 150,
    "emoji": "🍌",
    "daysToExpiry": 5,
    "discounted": true
  }
]
```

> Items with `daysToExpiry <= 2` will have `discounted: true` and price reduced 20%.

**GET** `/api/products/:sku`

Returns a single product by SKU.

---

### Wallets (Service C)

**GET** `/api/wallets`

Returns all user wallets and current $SPMT balances.

```json
[
  {
    "userId": "USR-001",
    "name": "Arun K.",
    "balance": 105.50,
    "overdraftLimit": -20,
    "isSubscriber": true
  }
]
```

**GET** `/api/wallets/:id` — Single wallet by userId.

**POST** `/api/checkout`

Runs the "Limited Overdraft" smart contract logic.

Request:
```json
{ "userId": "USR-001", "amount": 12.50 }
```

Response (success):
```json
{ "ok": true, "hash": "0xa4f3b2..." }
```

Response (failure):
```json
{ "ok": false, "reason": "Insufficient funds" }
```

---

### Ledger (Service C)

**GET** `/api/ledger`

Returns last 50 blockchain transactions in reverse chronological order.

```json
{
  "blockHeight": 10004,
  "transactions": [
    {
      "hash": "0x864914e2...",
      "blockNumber": 10004,
      "from": "USR-002",
      "to": "STORE_WALLET",
      "amount": 51.00,
      "timestamp": "2026-05-15T17:10:51.028Z",
      "type": "PURCHASE"
    }
  ]
}
```

Transaction types: `PURCHASE` | `OVERDRAFT_RECOVERY`

---

## WebSocket Events (Server → Client)

Connect to `ws://localhost:3001`. All events are JSON strings.

### `INFO`
Sent once on connection.
```json
{ "type": "INFO", "message": "Connected to ASE Fleet Engine", "blockHeight": 10000 }
```

### `TROLLEY_POSITIONS`
Broadcast every 800ms with all active trolley states.
```json
{
  "type": "TROLLEY_POSITIONS",
  "data": [
    {
      "id": "TROLLEY-100",
      "userId": "USR-001",
      "x": 342.5,
      "y": 218.3,
      "status": "SHOPPING",
      "cartItems": [],
      "totalWeight": 1250.0,
      "cartTotal": 14.20
    }
  ]
}
```

### `SCAN_EVENT`
Fired when load cell detects weight change and YOLOv8 inference succeeds.
```json
{
  "type": "SCAN_EVENT",
  "trolleyId": "TROLLEY-101",
  "userId": "USR-002",
  "event": {
    "sku": "PNT-001",
    "name": "Cereal Box",
    "confidence": 0.924,
    "weightDelta": 447.3,
    "price": 4.50,
    "discounted": false,
    "accepted": true
  }
}
```
> `accepted: false` when confidence < 0.60 (conflict resolution — item not added to cart)

### `CHECKOUT_EVENT`
Fired when cart hits 15 items and blockchain checkout runs.
```json
{
  "type": "CHECKOUT_EVENT",
  "trolleyId": "TROLLEY-100",
  "userId": "USR-001",
  "total": 55.30,
  "itemCount": 15,
  "ok": true,
  "hash": "0xdbe90a987665df74335f680d0dbbc1dd783035ee"
}
```
