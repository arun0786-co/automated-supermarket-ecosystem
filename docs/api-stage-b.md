# API Reference: Stage B

Everything goes through the gateway on port 80 (or 443 with `make stage-b-tls`). Apart from health checks, the dashboard itself and logging in, every request needs `Authorization: Bearer <accessToken>`. The stage A simulator's API is in [api-reference.md](api-reference.md).

Status codes the gateway adds to any route: `401` no valid token, `403` valid token without permission, `429` rate limited.

## Who can call what

| Route | Customer | Staff (`admin`) |
|---|---|---|
| `GET /api/products`, `GET /api/products/:sku` | yes | yes |
| `POST /api/products/:sku/pick`, `/release` | no | yes |
| `GET /api/recommendations/*`, `POST /api/recommendations` | yes | yes |
| `GET /api/wallets/:id`, `GET /api/fleet/cart/:id` | own only | any |
| `GET /api/wallets`, `GET /api/fleet/trolleys` | no | yes |
| `POST /api/vision/scan` | no | yes |
| `GET /api/wallet/:address`, `POST /api/wallet/mint` | no | yes |
| `POST /api/checkout`, `GET /api/ledger` | no | yes |

Trolleys don't use these routes. They publish over MQTT and the fleet engine calls services directly inside the stack.

## Accounts

**POST** `/api/auth/login` `{ "email", "password" }`, **POST** `/api/auth/register` `{ "email", "name", "password" }`

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "kX9...",
  "expiresIn": 900,
  "user": { "id": "USR-001", "name": "Arun K.", "role": "customer" }
}
```

Access tokens last 15 minutes. `register` always creates a customer, a `role` in the body is ignored. Passwords are 8 to 200 characters. Login and register share a limit of 30 a minute per address.

**POST** `/api/auth/refresh` `{ "refreshToken" }` returns a new pair, and the old refresh token stops working. Using an old one again ends the whole session, because that's what a stolen token looks like.

**POST** `/api/auth/logout` `{ "refreshToken" }`, **GET** `/api/auth/me`

**DELETE** `/api/auth/me` `{ "password" }` is the right to be forgotten (chapter 10.3). It deletes the person's email, name, password and the link to their wallet address. Their purchases stay on the chain, but nothing connects them to a person any more.

## Products (Service A)

**GET** `/api/products`, **GET** `/api/products/:sku`

```json
{
  "id": 16, "sku": "BKR-003", "name": "Croissant x2", "category": "Bakery",
  "price": 2.4, "weight": 200, "emoji": "🥐", "daysToExpiry": 1,
  "stockLevel": 40, "discountThreshold": 10, "active": true, "version": 1, "discounted": true
}
```

`Days_To_Expiry < 2 AND Stock_Level > Threshold` gives 20% off (chapter 4.3.2). `stockLevel` is the live count from Redis.

**POST** `/api/products/:sku/pick` `{ "quantity": 1 }` returns `201 { "sku", "stockLevel" }`, or `409` if there isn't enough left.

**POST** `/api/products/:sku/release` `{ "quantity": 1 }` puts stock back.

## Vision (Service B)

**POST** `/api/vision/scan`

```json
{ "weightDelta": 450, "frames": ["<base64 jpeg>"] }
```

Up to 5 frames (chapter 5.3), 4 MB each. Simulated trolleys send `"detection": { "sku", "confidence" }` instead.

```json
{ "sku": "PNT-001", "confidence": 0.85, "fusionProbability": 0.9978, "accepted": true, "reason": null, "source": "simulated" }
```

`reason` is one of `low confidence`, `weight mismatch`, `unknown item`, `no detection`. `source` is `model` or `simulated`, so test data can't be mistaken for a real detection. Frames with no model loaded get `503`, never a guess.

## Wallets and chain (Service C)

**GET** `/api/wallets/:id` (`/api/wallets` for staff) has the stage A shape:

```json
{ "userId": "USR-001", "name": "Arun K.", "balance": 95.5, "overdraftLimit": -20, "isSubscriber": true }
```

A negative `balance` means overdraft in use.

**POST** `/api/checkout` `{ "customer": "0x...", "amount": "12.50", "cartItems": [{ "sku": "PRD-001" }] }`

```json
{ "ok": true, "hash": "0x...", "blockNumber": 42, "cartHash": "0x...", "overdraftUsed": "4.5" }
```

`ok: false` comes with a `reason`. `overdraftUsed` is only there if overdraft was used.

**POST** `/api/wallet/mint` `{ "to": "0x...", "amount": "50" }` tops up a wallet, standing in for a fiat payment. **GET** `/api/ledger?limit=20` lists recent purchases from the chain, within the last 5000 blocks.

## Recommendations (Service D)

**POST** `/api/recommendations`

```json
{
  "userId": "USR-001",
  "cartItems": [{ "sku": "PNT-002", "name": "Pasta 500g", "category": "Pantry" }],
  "limit": 3,
  "context": { "aisle": 4, "hour": 18, "cartCategories": ["Pantry"] }
}
```

`context` is optional. **GET** `/api/recommendations/trending`. **GET** `/api/recommendations/model` says what the model learned from:

```json
{ "algorithm": "item-item cosine with LinUCB reranking", "trainedOn": "mixed", "syntheticBaskets": 2000, "realBaskets": 9, "feedbackEvents": 8220, "lastTrained": 1793909030.5 }
```

`trainedOn` is `synthetic`, `mixed` or `real`.

## Fleet

**GET** `/api/fleet/cart/:id`: `{ "trolleyId", "status", "items", "total" }`. The app reconciles with this after being offline.

**GET** `/api/fleet/trolleys`: the same rows as `TROLLEY_POSITIONS`.

## Live feed

`ws://<gateway>/ws?token=<accessToken>`. A token goes in the URL because browsers can't set headers on a websocket, and that route is left out of the access log. The connection closes with code `4401` when the token expires, so the client should reconnect with a fresh one.

Events are the stage A ones (`INFO`, `TROLLEY_POSITIONS`, `SCAN_EVENT`, `CHECKOUT_EVENT`, see [api-reference.md](api-reference.md)) plus:

- `RECOMMENDATION_EVENT`: `{ trolleyId, userId, recs: [{ sku, name, emoji, category, price, reason, score }] }` after each accepted scan.
- `PRICE_EVENT`: `{ sku, price, discounted }` when stock crosses a discount threshold.

Staff get everything. Customers only get their own trolley, scans, checkouts and recommendations, plus prices.

Additional `SCAN_EVENT` rejection reasons in stage B: `vision unavailable`, `inventory unavailable`, `out of stock`, `checkout in progress`, `no customer checked in`.

`CHECKOUT_EVENT` with `reason: "checkout result unknown"` means the service can't tell whether the charge went through, usually a timeout. It's never retried and stock isn't released, and staff get an alert to review it.

## MQTT (trolleys)

Broker on port 1883. Every client logs in and each role can only use its own topics.

| Topic | From | Payload |
|---|---|---|
| `trolley/<id>/position` | trolley | `{ userId, x, y, ts }` |
| `trolley/<id>/scan` | trolley | `{ eventId, weightDelta, frames? , detection? }` QoS 1 |
| `trolley/<id>/led` | fleet | `{ color: "red" \| "green", reason? }` |
| `trolley/<id>/checkout` | fleet | `{ ok, total, hash?, reason? }` |
| `store/alerts` | fleet | `{ type: "LOW_STOCK" \| "CHECKOUT_FAILED", ... }` |

`eventId` makes redelivery safe: the same scan delivered twice only counts once, including across a fleet engine restart.
