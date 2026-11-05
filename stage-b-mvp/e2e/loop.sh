#!/usr/bin/env bash
# the connected system: trolley over mqtt, fleet, vision, stock, chain, live feed, plus what
# happens when parts of it fail. run.sh starts the simulator just before this.
# env: same as smoke.sh, and E2E_ENV_FILE so services can be stopped and started
set -u

GW=${GW:-http://localhost:80}
WS=${WS:-ws://localhost:80/ws}
CT='content-type: application/json'
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)
FEED="$WORK/feed.ndjson"
touch "$FEED"
passed=0
failed=0

compose() { docker compose -p "${E2E_PROJECT:-ase-e2e}" --env-file "$E2E_ENV_FILE" "$@"; }

node "$HERE/record-feed.mjs" "$WS" "$FEED" &
RECORDER=$!
trap 'kill "$RECORDER" 2>/dev/null; rm -rf "$WORK"' EXIT

ok()   { passed=$((passed + 1)); printf 'ok    %s\n' "$1"; }
nope() { failed=$((failed + 1)); printf 'FAIL  %s\n' "$1"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

# counts feed events after a line number that match a python condition on the event e
feed_count() {
  python3 - "$FEED" "$1" "${2:-0}" <<'EOF'
import json, sys
path, condition, skip = sys.argv[1], sys.argv[2], int(sys.argv[3])
count = 0
for number, line in enumerate(open(path)):
    if number < skip:
        continue
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if eval(condition, {"e": e}):
        count += 1
print(count)
EOF
}

# wait_event <label> <seconds> <condition> [start at feed line]
wait_event() {
  local i
  for ((i = 0; i < $2; i++)); do
    if [ "$(feed_count "$3" "${4:-0}")" -gt 0 ]; then
      ok "$1"
      return 0
    fi
    sleep 1
  done
  nope "$1: nothing within $2s"
  return 1
}

lines() { wc -l < "$FEED" | tr -d ' '; }

stock_total() { curl -s "$GW/api/products" | json "sum(p['stockLevel'] for p in d)"; }

wait_ok() {
  local i
  for i in $(seq 1 90); do
    [ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null)" = "200" ] && return 0
    sleep 1
  done
  return 1
}

wait_ok "$GW/health/fleet" || nope 'fleet engine never came up'
stock_before=$(stock_total)

echo '== a trolley shops over mqtt'
wait_event 'trolley positions reach the feed' 30 "e['type'] == 'TROLLEY_POSITIONS' and len(e['data']) == 5 and e['data'][0]['userId']"
wait_event 'an accepted scan with the full item' 60 "e['type'] == 'SCAN_EVENT' and e['event']['accepted'] and e['event']['price'] > 0 and e['event']['name'] != 'Unknown item'"
wait_event 'a rejected scan with a reason' 120 "e['type'] == 'SCAN_EVENT' and not e['event']['accepted'] and e['event']['reason'] in ('weight mismatch', 'low confidence')"
wait_event 'a checkout on the chain' 120 "e['type'] == 'CHECKOUT_EVENT' and e['ok'] and e.get('hash', '').startswith('0x') and len(e['hash']) == 66"

echo '== the money and the stock add up'
hash=$(python3 - "$FEED" <<'EOF'
import json, sys
for line in open(sys.argv[1]):
    e = json.loads(line)
    if e["type"] == "CHECKOUT_EVENT" and e["ok"]:
        print(e["hash"])
        break
EOF
)
if [ -n "$hash" ] && curl -s "$GW/api/ledger?limit=100" | grep -q "$hash"; then ok 'the checkout hash is in the on-chain ledger'; else nope "checkout hash [$hash] missing from the ledger"; fi

stock_after=$(stock_total)
if [ "$stock_after" -lt "$stock_before" ]; then ok "stock went down ($stock_before to $stock_after)"; else nope "stock did not go down ($stock_before to $stock_after)"; fi

wallets=$(curl -s "$GW/api/wallets")
if [ "$(echo "$wallets" | json 'len(d)')" = "3" ]; then ok 'three customer wallets'; else nope "wallets: $wallets"; fi
if [ "$(echo "$wallets" | json "sorted(d[0])")" = "['balance', 'isSubscriber', 'name', 'overdraftLimit', 'userId']" ]; then ok 'wallets keep the stage A shape'; else nope "wallet shape: $wallets"; fi
paid=$(echo "$wallets" | json "sum(1 for w in d if w['balance'] < {'USR-001': 105.5, 'USR-002': 67, 'USR-003': 210.75}.get(w['userId'], 0))")
if [ "$paid" -gt 0 ]; then ok 'a customer balance went down'; else nope "no balance moved: $wallets"; fi

echo '== vision goes down'
compose stop vision > /dev/null 2>&1
mark=$(lines)
wait_event 'scans are refused, not guessed' 60 "e['type'] == 'SCAN_EVENT' and e['event'].get('reason') == 'vision unavailable'" "$mark"
compose start vision > /dev/null 2>&1
wait_ok "$GW/health/vision" || nope 'vision did not come back'
mark=$(lines)
wait_event 'scans are accepted again once it is back' 60 "e['type'] == 'SCAN_EVENT' and e['event']['accepted']" "$mark"

echo '== the fleet engine restarts mid shop'
compose stop trolley-sim > /dev/null 2>&1
sleep 8 # let any in-flight scan and checkout reset settle
before=$(curl -s "$GW/api/fleet/trolleys" | json "sorted((t['id'], t['itemCount'], t['cartTotal']) for t in d)")
charges_before=$(feed_count "e['type'] == 'CHECKOUT_EVENT' and e['ok']")
ledger_before=$(curl -s "$GW/api/ledger?limit=100" | json "len(d['transactions'])")
compose restart fleet-engine > /dev/null 2>&1
wait_ok "$GW/health/fleet" || nope 'fleet engine did not come back'
after=$(curl -s "$GW/api/fleet/trolleys" | json "sorted((t['id'], t['itemCount'], t['cartTotal']) for t in d)")
if [ "$before" = "$after" ]; then ok 'every cart survived the restart'; else nope "carts changed: $before then $after"; fi
sleep 2
ledger_after=$(curl -s "$GW/api/ledger?limit=100" | json "len(d['transactions'])")
if [ "$ledger_before" = "$ledger_after" ]; then ok 'nothing was charged again'; else nope "ledger went from $ledger_before to $ledger_after"; fi
compose start trolley-sim > /dev/null 2>&1
mark=$(lines)
wait_event 'scans flow again after the restart' 60 "e['type'] == 'SCAN_EVENT'" "$mark"

echo '== redis goes down'
compose stop trolley-sim > /dev/null 2>&1
sleep 3
stock_sku() { curl -s "$GW/api/products/$1" | json "d['stockLevel']"; }
s0=$(stock_sku PNT-004)
compose stop redis > /dev/null 2>&1
code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST -H "$CT" -d '{"quantity":1}' "$GW/api/products/PNT-004/pick")
if [ "$code" = "201" ]; then ok 'picks fall back to postgres'; else nope "pick with redis down returned $code"; fi
if [ "$(stock_sku PNT-004)" = "$((s0 - 1))" ]; then ok 'the catalog stays right without redis'; else nope 'catalog wrong with redis down'; fi
compose start redis > /dev/null 2>&1
sleep 3
code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST -H "$CT" -d '{"quantity":1}' "$GW/api/products/PNT-004/pick")
if [ "$code" = "201" ] && [ "$(stock_sku PNT-004)" = "$((s0 - 2))" ]; then ok 'no pick was lost or counted twice across the outage'; else nope "after the outage: $code, stock $(stock_sku PNT-004), wanted $((s0 - 2))"; fi

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
