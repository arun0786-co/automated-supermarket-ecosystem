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
    "sku": "BKR-003",
    "name": "Croissant x2",
    "category": "Bakery",
    "price": 2.40,
    "weight": 200,
    "emoji": "🥐",
    "daysToExpiry": 1,
    "discounted": true
  }
]
```

> Perishables with `daysToExpiry < 2` get `discounted: true` and 20% off (chapter 4 of the spec). `daysToExpiry: 0` means non-perishable and is never discounted. Stage A ignores stock levels; Stage B product-core also requires `stockLevel > discountThreshold`.

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

`amount` must be a positive number, otherwise the endpoint returns `400`.

Response (success):
```json
{ "ok": true, "hash": "0xa4f3b2..." }
```

Response (subscriber overdraft, balance went below zero):
```json
{ "ok": true, "hash": "0xa4f3b2...", "overdraftUsed": 7.25 }
```

Response (failure):
```json
{ "ok": false, "reason": "insufficient funds" }
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

Transaction types: `PURCHASE` | `OVERDRAFT` (subscriber checkout that took the balance below zero)

---

## WebSocket Events (Server → Client)

Connect to `ws://localhost:3001`. All events are JSON strings.

### `INFO`
Sent once on connection.
```json
{ "type": "INFO", "message": "connected to ASE fleet engine", "blockHeight": 10000 }
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
      "itemCount": 6,
      "totalWeight": 1250.0,
      "cartTotal": 14.20
    }
  ]
}
```

> `cartItems` only carries the last 3 items to keep the payload small; `itemCount` is the full cart size.

### `SCAN_EVENT`
Fired for every load cell weight change, whether the scan is accepted or rejected.
```json
{
  "type": "SCAN_EVENT",
  "trolleyId": "TROLLEY-101",
  "userId": "USR-002",
  "event": {
    "sku": "PNT-001",
    "name": "Cereal Box",
    "emoji": "🥣",
    "confidence": 0.924,
    "weightDelta": 447.3,
    "price": 4.50,
    "discounted": false,
    "ts": "2026-10-27T07:32:05.000Z",
    "accepted": true
  }
}
```
> The simulator fuses the vision and weight readings (chapter 5 of the spec). The scan is
> rejected, with `accepted: false` and a `reason`, when confidence is below 0.60
> (`"low confidence"`) or the load cell reading is more than 10g off the catalog weight
> (`"weight mismatch"`). Rejected items never reach the cart or the bill.

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
> Carries the same `ok`, `hash`, `reason` and `overdraftUsed` fields as `POST /api/checkout`.
