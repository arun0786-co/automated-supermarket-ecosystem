#!/usr/bin/env bash
# end to end checks against a running stage B, mostly through the gateway.
# exits non-zero if anything fails. run.sh starts the stack and calls this.
# env: ADMIN_TOKEN (required), GW and PRODUCT_CORE to point somewhere else
set -u

GW=${GW:-http://localhost:80}
PC=${PRODUCT_CORE:-http://localhost:3001}
CT='content-type: application/json'
# hardhat accounts #2 to #4, funded by the vault's deploy script
USR1=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
USR2=0x90F79bf6EB2c4f870365E785982E1f101E93b906

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
passed=0
failed=0

# check <label> <expected status> <text expected in the body, or ''> <curl args...>
check() {
  local label=$1 want=$2 needle=$3
  shift 3
  local code
  code=$(curl -g -s -m 30 -o "$WORK/body" -w '%{http_code}' "$@" 2>/dev/null)
  if [ "$code" = "$want" ] && { [ -z "$needle" ] || grep -q -F -- "$needle" "$WORK/body"; }; then
    passed=$((passed + 1))
    printf 'ok    %s\n' "$label"
  else
    failed=$((failed + 1))
    printf 'FAIL  %s: wanted %s with [%s], got %s: %s\n' "$label" "$want" "$needle" "$code" "$(cut -c1-300 "$WORK/body")"
  fi
}

# expect <label> <wanted> <got>
expect() {
  if [ "$2" = "$3" ]; then
    passed=$((passed + 1))
    printf 'ok    %s\n' "$1"
  else
    failed=$((failed + 1))
    printf 'FAIL  %s: wanted %s, got %s\n' "$1" "$2" "$3"
  fi
}

wait_for() {
  local i
  for i in $(seq 1 150); do
    [ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null)" = "200" ] && return 0
    sleep 2
  done
  failed=$((failed + 1))
  printf 'FAIL  timed out waiting for %s\n' "$1"
  return 1
}

json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

wait_for "$GW/health/products" || exit 1
wait_for "$GW/health/vault" || exit 1
wait_for "$GW/health/ai" || exit 1

echo '== health'
check 'gateway'           200 '"gateway":"nginx"'        "$GW/health"
check 'product-core'      200 '"service":"product-core"' "$GW/health/products"
check 'fintech-vault'     200 '"service":"fintech-vault"' "$GW/health/vault"
check 'ai-engine'         200 '"service":"ai-engine"'    "$GW/health/ai"

echo '== catalog and pricing'
expect 'catalog has 33 products' 33 "$(curl -s "$GW/api/products" | json 'len(d)')"
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
before=$(curl -s "$GW/api/products/PNT-002" | json "d['stockLevel']")
seq 1 40 | xargs -P 40 -I{} curl -s -m 30 -o /dev/null -w '%{http_code}\n' \
  -X POST -H "$CT" -d '{"quantity":1}' "$GW/api/products/PNT-002/pick" > "$WORK/codes"
ok=$(grep -c '^201$' "$WORK/codes")
after=$(curl -s "$GW/api/products/PNT-002" | json "d['stockLevel']")
echo "      $ok of 40 succeeded"
expect 'stock matches successful picks' "$((before - ok))" "$after"
expect 'nothing but 201 or 409' 0 "$(grep -v -c -E '^(201|409)$' "$WORK/codes")"

echo '== recommendations'
check 'trending'          200 '"sku":"BVG-001"' "$GW/api/recommendations/trending"
check 'from a cart'       200 '"sku":"PNT-003"' -X POST -H "$CT" \
  -d '{"userId":"USR-001","cartItems":[{"sku":"PNT-002","name":"Pasta 500g","category":"Pantry"}],"limit":3}' "$GW/api/recommendations"
check 'empty cart falls back' 200 '"sku":"BVG-001"' -X POST -H "$CT" \
  -d '{"userId":"USR-001","cartItems":[],"limit":2}' "$GW/api/recommendations"

echo '== vault'
check 'seeded balance'    200 '"balance":"105.5"' "$GW/api/wallet/$USR1"
check 'bad address'       400 'invalid address'   "$GW/api/wallet/not-an-address"
check 'mint without token' 403 'admin token'      -X POST -H "$CT" -d "{\"to\":\"$USR2\",\"amount\":\"5\"}" "$GW/api/wallet/mint"
check 'mint wrong token'  403 'admin token'       -X POST -H "$CT" -H 'authorization: Bearer nope' -d "{\"to\":\"$USR2\",\"amount\":\"5\"}" "$GW/api/wallet/mint"
check 'mint'              200 '"ok":true'         -X POST -H "$CT" -H "authorization: Bearer $ADMIN_TOKEN" -d "{\"to\":\"$USR2\",\"amount\":\"5\"}" "$GW/api/wallet/mint"
check 'balance after mint' 200 '"balance":"67.0"' "$GW/api/wallet/$USR2"
check 'checkout'          200 '"ok":true'         -X POST -H "$CT" -d "{\"customer\":\"$USR1\",\"amount\":\"10\",\"cartItems\":[{\"sku\":\"PRD-001\"}]}" "$GW/api/checkout"
check 'balance after checkout' 200 '"balance":"95.5"' "$GW/api/wallet/$USR1"
check 'checkout into overdraft' 200 '"ok":true'   -X POST -H "$CT" -d "{\"customer\":\"$USR1\",\"amount\":\"100\",\"cartItems\":[{\"sku\":\"BVG-003\"}]}" "$GW/api/checkout"
check 'overdraft is recorded' 200 '"overdraftOwed":"4.5"' "$GW/api/wallet/$USR1"
check 'checkout past the limit' 200 '"ok":false'  -X POST -H "$CT" -d "{\"customer\":\"$USR2\",\"amount\":\"9999\",\"cartItems\":[]}" "$GW/api/checkout"
check 'checkout bad amount' 400 'positive amount' -X POST -H "$CT" -d "{\"customer\":\"$USR1\",\"amount\":\"-1\"}" "$GW/api/checkout"
check 'ledger has both purchases' 200 '"amount":"100.0"' "$GW/api/ledger"

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
