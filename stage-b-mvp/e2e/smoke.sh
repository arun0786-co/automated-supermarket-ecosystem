#!/usr/bin/env bash
# end to end checks against a running stage B, through the gateway.
# exits non-zero if anything fails. run.sh starts the stack and calls this.
# env: E2E_ENV_FILE, DEMO_PASSWORD, ADMIN_PASSWORD (required), GW to point somewhere else
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=e2e/lib.sh
source "$HERE/lib.sh"
trap 'rm -rf "$WORK"' EXIT
# hardhat accounts #2 to #4, funded by the vault's deploy script
USR1=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
USR2=0x90F79bf6EB2c4f870365E785982E1f101E93b906

wait_for "$GW/health/products" || exit 1
wait_for "$GW/health/vision" || exit 1
wait_for "$GW/health/vault" || exit 1
wait_for "$GW/health/ai" || exit 1
wait_for "$GW/health/fleet" || exit 1
wait_for "$GW/health/auth" || exit 1

ADMIN=$(login admin@ase.local "$ADMIN_PASSWORD")
ARUN=$(login arun@ase.local "$DEMO_PASSWORD")
TOKEN=$ADMIN

echo '== health'
check 'gateway'           200 '"gateway":"nginx"'        "$GW/health"
check 'product-core'      200 '"service":"product-core"' "$GW/health/products"
check 'vision'            200 '"service":"vision"'       "$GW/health/vision"
check 'fintech-vault'     200 '"service":"fintech-vault"' "$GW/health/vault"
check 'ai-engine'         200 '"service":"ai-engine"'    "$GW/health/ai"
check 'fleet-engine'      200 '"service":"fleet-engine"' "$GW/health/fleet"
check 'auth-service'      200 '"service":"auth-service"' "$GW/health/auth"

echo '== dashboard'
TOKEN= check 'the dashboard loads through the gateway' 200 'ASE-PRIME Dashboard' "$GW/"
script=$(curl -s "$GW/" | grep -o '/_next/static/[^"]*\.js' | head -1)
TOKEN= check 'and so do its scripts' 200 '' "$GW$script"

echo '== catalog and pricing'
expect 'catalog has 33 products' 33 "$(api "$GW/api/products" | json 'len(d)')"
check 'overstocked near expiry is 20% off' 200 '"price":2.4'        "$GW/api/products/BKR-003"
check 'low stock near expiry is full price' 200 '"discounted":false' "$GW/api/products/MTF-002"
check 'unknown sku'       404 'not found'                "$GW/api/products/NOPE-1"
check 'query string'      200 ''                         "$GW/api/products?a=1&b[c]=2"

echo '== pick'
P="$GW/api/products/PRD-001/pick"
check 'pick two'          201 '"stockLevel":78' -X POST -H "$CT" -d '{"quantity":2}' "$P"
check 'pick with no body' 201 '"stockLevel":77' -X POST "$P"
check 'pick zero'         400 'positive integer' -X POST -H "$CT" -d '{"quantity":0}' "$P"
check 'pick negative'     400 'positive integer' -X POST -H "$CT" -d '{"quantity":-3}' "$P"
check 'pick decimal'      400 'positive integer' -X POST -H "$CT" -d '{"quantity":1.5}' "$P"
check 'pick string'       400 'positive integer' -X POST -H "$CT" -d '{"quantity":"abc"}' "$P"
check 'pick bad json'     400 ''                 -X POST -H "$CT" -d '{bad' "$P"
check 'pick too many'     409 'only 77'          -X POST -H "$CT" -d '{"quantity":99999}' "$P"
check 'pick unknown sku'  404 'not found'        -X POST -H "$CT" -d '{"quantity":1}' "$GW/api/products/NOPE-1/pick"
python3 -c "print('{\"quantity\":1,\"pad\":\"' + 'x'*200000 + '\"}')" > "$WORK/big.json"
check 'oversized body'    413 ''                 -X POST -H "$CT" --data-binary "@$WORK/big.json" "$P"
check 'stock is what the picks left' 200 '"stockLevel":77' "$GW/api/products/PRD-001"

echo '== concurrent picks'
# every successful pick has to take exactly one off the shelf, however many race
before=$(api "$GW/api/products/PNT-002" | json "d['stockLevel']")
seq 1 40 | xargs -P 40 -I{} curl -s -m 30 -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $TOKEN" \
  -X POST -H "$CT" -d '{"quantity":1}' "$GW/api/products/PNT-002/pick" > "$WORK/codes"
ok=$(grep -c '^201$' "$WORK/codes")
after=$(api "$GW/api/products/PNT-002" | json "d['stockLevel']")
echo "      $ok of 40 succeeded"
expect 'stock matches successful picks' "$((before - ok))" "$after"
expect 'nothing but 201 or 409' 0 "$(grep -v -c -E '^(201|409)$' "$WORK/codes")"
# redis takes the count atomically, so with plenty of stock nobody should get turned away
expect 'all 40 succeeded with stock to spare' 40 "$ok"
sleep 1
db_stock=$(db 'select "stockLevel" from products where sku = '"'PNT-002'")
expect 'postgres caught up with the hot count' "$after" "$db_stock"

echo '== the last unit'
# MTF-002 is seeded with 6, so 20 racing pickers must leave exactly 6 winners
seq 1 20 | xargs -P 20 -I{} curl -s -m 30 -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $TOKEN" \
  -X POST -H "$CT" -d '{"quantity":1}' "$GW/api/products/MTF-002/pick" > "$WORK/last"
expect 'exactly the stock on hand was sold' 6 "$(grep -c '^201$' "$WORK/last")"
check 'nothing left' 200 '"stockLevel":0' "$GW/api/products/MTF-002"
check 'release puts it back' 201 '"stockLevel":2' -X POST -H "$CT" -d '{"quantity":2}' "$GW/api/products/MTF-002/release"
check 'release validates the quantity' 400 'positive integer' -X POST -H "$CT" -d '{"quantity":0}' "$GW/api/products/MTF-002/release"

echo '== vision and fusion'
V="$GW/api/vision/scan"
# the worked examples from chapter 5.4 of the spec
check 'cereal at 450g goes in the cart' 200 '"accepted":true' -X POST -H "$CT" \
  -d '{"weightDelta":450,"detection":{"sku":"PNT-001","confidence":0.85}}' "$V"
check 'cereal at 1000g is rejected' 200 '"reason":"weight mismatch"' -X POST -H "$CT" \
  -d '{"weightDelta":1000,"detection":{"sku":"PNT-001","confidence":0.85}}' "$V"
check 'blurry frame is rejected' 200 '"reason":"low confidence"' -X POST -H "$CT" \
  -d '{"weightDelta":450,"detection":{"sku":"PNT-001","confidence":0.3}}' "$V"
check 'simulated input is labelled' 200 '"source":"simulated"' -X POST -H "$CT" \
  -d '{"weightDelta":450,"detection":{"sku":"PNT-001","confidence":0.85}}' "$V"
check 'unknown sku' 200 '"reason":"unknown item"' -X POST -H "$CT" \
  -d '{"weightDelta":450,"detection":{"sku":"NOPE-1","confidence":0.85}}' "$V"
check 'no camera input' 400 '' -X POST -H "$CT" -d '{"weightDelta":450}' "$V"
if [ "$(api "$GW/health/vision" | json "d['modelLoaded']")" = "True" ]; then
  # a real camera burst through the gateway, when the model and a photo are available
  if [ -n "${E2E_BANANA_PHOTO:-}" ]; then
    python3 -c "
import base64, json, sys
frame = base64.b64encode(open('$E2E_BANANA_PHOTO', 'rb').read()).decode()
json.dump({'weightDelta': 150, 'frames': [frame] * 5}, open('$WORK/burst.json', 'w'))"
    check 'real photo of a banana' 200 '"sku":"PRD-001"' -X POST -H "$CT" --data-binary "@$WORK/burst.json" "$V"
    check 'real photo uses the model' 200 '"source":"model"' -X POST -H "$CT" --data-binary "@$WORK/burst.json" "$V"
  else
    echo '      model loaded, set E2E_BANANA_PHOTO to test a real burst'
  fi
else
  check 'frames with no model are refused' 503 'no vision model' -X POST -H "$CT" \
    -d '{"weightDelta":150,"frames":["aGk="]}' "$V"
fi

echo '== recommendations'
check 'trending'          200 '"sku":"BVG-001"' "$GW/api/recommendations/trending"
check 'from a cart'       200 '"sku":"PNT-003"' -X POST -H "$CT" \
  -d '{"userId":"USR-001","cartItems":[{"sku":"PNT-002","name":"Pasta 500g","category":"Pantry"}],"limit":3}' "$GW/api/recommendations"
check 'empty cart falls back' 200 '"sku":"BVG-001"' -X POST -H "$CT" \
  -d '{"userId":"USR-001","cartItems":[],"limit":2}' "$GW/api/recommendations"
check 'model says what it learned from' 200 '"trainedOn":"synthetic"' "$GW/api/recommendations/model"

echo '== vault'
check 'seeded balance'    200 '"balance":"105.5"' "$GW/api/wallet/$USR1"
check 'bad address'       400 'invalid address'   "$GW/api/wallet/not-an-address"
TOKEN=$ARUN check 'a customer can not mint' 403 'not allowed' -X POST -H "$CT" -d "{\"to\":\"$USR2\",\"amount\":\"5\"}" "$GW/api/wallet/mint"
check 'mint'              200 '"ok":true'         -X POST -H "$CT" -d "{\"to\":\"$USR2\",\"amount\":\"5\"}" "$GW/api/wallet/mint"
check 'balance after mint' 200 '"balance":"67.0"' "$GW/api/wallet/$USR2"
check 'checkout'          200 '"ok":true'         -X POST -H "$CT" -d "{\"customer\":\"$USR1\",\"amount\":\"10\",\"cartItems\":[{\"sku\":\"PRD-001\"}]}" "$GW/api/checkout"
check 'balance after checkout' 200 '"balance":"95.5"' "$GW/api/wallet/$USR1"
check 'checkout into overdraft' 200 '"overdraftUsed":"4.5"' -X POST -H "$CT" -d "{\"customer\":\"$USR1\",\"amount\":\"100\",\"cartItems\":[{\"sku\":\"BVG-003\"}]}" "$GW/api/checkout"
check 'overdraft is recorded' 200 '"overdraftOwed":"4.5"' "$GW/api/wallet/$USR1"
check 'checkout past the limit' 200 '"ok":false'  -X POST -H "$CT" -d "{\"customer\":\"$USR2\",\"amount\":\"9999\",\"cartItems\":[]}" "$GW/api/checkout"
check 'checkout bad amount' 400 'positive amount' -X POST -H "$CT" -d "{\"customer\":\"$USR1\",\"amount\":\"-1\"}" "$GW/api/checkout"
check 'ledger has both purchases' 200 '"amount":"100.0"' "$GW/api/ledger"

echo '== who can do what'
T=$GW/api
for path in products/PRD-001 recommendations/trending recommendations/model wallets wallets/USR-001 fleet/trolleys fleet/cart/USR-001 ledger wallet/$USR1; do
  TOKEN= check "no token: $path" 401 'not logged in' "$T/$path"
done
TOKEN= check 'no token: checkout' 401 '' -X POST -H "$CT" -d '{}' "$T/checkout"
TOKEN= check 'no token: pick' 401 '' -X POST "$T/products/PRD-001/pick"
TOKEN= check 'no token: the live feed' 401 '' -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "$GW/ws"
TOKEN=not.a.token check 'garbage token' 401 '' "$T/products"
TOKEN=$ARUN check 'a client can not claim to be someone else' 403 'not allowed' -H 'X-User-Id: USR-002' -H 'X-User-Role: admin' "$T/wallets/USR-002"

TOKEN=$ARUN check 'customer reads the catalog' 200 '"sku":"PRD-001"' "$T/products"
TOKEN=$ARUN check 'customer reads their own wallet' 200 '"balance":' "$T/wallets/USR-001"
TOKEN=$ARUN check 'customer reads their own cart' 200 '"items":' "$T/fleet/cart/USR-001"
TOKEN=$ARUN check 'another wallet is refused' 403 '' "$T/wallets/USR-002"
TOKEN=$ARUN check 'another cart is refused' 403 '' "$T/fleet/cart/USR-002"
TOKEN=$ARUN check 'the wallet list is refused' 403 '' "$T/wallets"
TOKEN=$ARUN check 'the fleet view is refused' 403 '' "$T/fleet/trolleys"
TOKEN=$ARUN check 'the ledger is refused' 403 '' "$T/ledger"
TOKEN=$ARUN check 'charging a wallet is refused' 403 '' -X POST -H "$CT" -d "{\"customer\":\"$USR2\",\"amount\":\"1\"}" "$T/checkout"
TOKEN=$ARUN check 'the raw vault is refused' 403 '' "$T/wallet/$USR2"
TOKEN=$ARUN check 'taking stock directly is refused' 403 '' -X POST "$T/products/PRD-001/pick"
TOKEN=$ARUN check 'releasing stock is refused' 403 '' -X POST "$T/products/PRD-001/release"
TOKEN=$ARUN check 'vision is refused' 403 '' -X POST -H "$CT" -d '{}' "$T/vision/scan"
TOKEN=$ARUN check 'recommendation feedback is not exposed' 404 '' -X POST -H "$CT" -d '{"sku":"A","reward":1}' "$T/recommendations/feedback"
TOKEN=$ADMIN check 'internal routes are not exposed' 404 '' "$GW/internal/users/USR-001"
TOKEN=$ADMIN check 'unknown routes are a 404' 404 '' "$GW/nothing-here"

for port in 3000 3001 3002 3003 3004 8000 8001 5432 6379 8545; do
  code=$(curl -s -m 3 -o /dev/null -w '%{http_code}' "http://localhost:$port/" 2>/dev/null)
  expect "port $port is not reachable from outside" 000 "$code"
done

echo '== accounts'
A=$T/auth
NEW="e2e-$RANDOM@ase.local"
TOKEN= check 'wrong password' 401 'invalid email or password' -X POST -H "$CT" -d '{"email":"arun@ase.local","password":"wrong wrong"}' "$A/login"
TOKEN= check 'register' 201 '"role":"customer"' -X POST -H "$CT" -d "{\"email\":\"$NEW\",\"name\":\"E2E\",\"password\":\"long enough password\",\"role\":\"admin\"}" "$A/register"
FRESH=$(login "$NEW" 'long enough password')
TOKEN=$FRESH check 'a new customer works' 200 "\"email\":\"$NEW\"" "$A/me"
TOKEN=$FRESH check 'and has a real empty wallet' 200 '"balance":0' "$T/wallets/$(TOKEN=$FRESH api "$A/me" | json "d['id']")"
TOKEN=$FRESH check 'forgetting needs the password' 401 '' -X DELETE -H "$CT" -d '{"password":"wrong"}' "$A/me"
TOKEN=$FRESH check 'forget me' 204 '' -X DELETE -H "$CT" -d '{"password":"long enough password"}' "$A/me"
TOKEN= check 'a forgotten user can not log in' 401 '' -X POST -H "$CT" -d "{\"email\":\"$NEW\",\"password\":\"long enough password\"}" "$A/login"
TOKEN=$FRESH check 'and their token stops working' 401 '' "$T/products"
expect 'and nothing of theirs is left in the database' 0 "$(db "select count(*) from auth.users where email = '$NEW'")"

summary
