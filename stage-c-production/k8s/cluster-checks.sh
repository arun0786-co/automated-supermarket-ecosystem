#!/usr/bin/env bash
# what only a real cluster can show: the system working end to end, network policies actually
# blocking traffic, nothing running as root, and pods coming back after being killed
set -u

OVERLAY=${1:-local}
NS=${E2E_NAMESPACE:-ase}
HERE=$(cd "$(dirname "$0")" && pwd)
E2E="$HERE/../../stage-b-mvp/e2e"
# shellcheck source=../../stage-b-mvp/e2e/lib.sh
source "$E2E/lib.sh"
FEED="$WORK/feed.ndjson"
touch "$FEED"

ADMIN=$(login admin@ase.local "$ADMIN_PASSWORD")
TOKEN=$ADMIN
node "$E2E/record-feed.mjs" "$WS?token=$ADMIN" "$FEED" &
RECORDER=$!
trap 'kill "$RECORDER" 2>/dev/null; rm -rf "$WORK"' EXIT

feed_count() {
  python3 - "$FEED" "$1" "${2:-0}" <<'PY'
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
PY
}
lines() { wc -l < "$FEED" | tr -d ' '; }

wait_event() {
  local i
  for ((i = 0; i < $2; i++)); do
    [ "$(feed_count "$3" "${4:-0}")" -gt 0 ] && { ok "$1"; return 0; }
    sleep 1
  done
  nope "$1: nothing within $2s"
  return 1
}

# from <label> <host> <port>: can a pod carrying this app label open a connection?
from() {
  local name="np-test-$RANDOM"
  kubectl -n "$NS" run "$name" --image=busybox:1.37 --labels="app=$1" --restart=Never --quiet --rm -i \
    --command -- sh -c "nc -z -w 3 $2 $3 && echo open || echo blocked" 2>/dev/null | tail -1
}

echo '== the whole loop on the cluster'
kubectl -n "$NS" scale deployment/trolley-sim --replicas=1 > /dev/null
kubectl -n "$NS" rollout status deployment/trolley-sim --timeout=120s > /dev/null 2>&1
wait_event 'trolleys reach the feed through the gateway' 90 "e['type'] == 'TROLLEY_POSITIONS' and len(e['data']) == 5"
wait_event 'scans are accepted' 90 "e['type'] == 'SCAN_EVENT' and e['event']['accepted']"
wait_event 'recommendations arrive' 60 "e['type'] == 'RECOMMENDATION_EVENT'"
wait_event 'a checkout lands on the chain' 180 "e['type'] == 'CHECKOUT_EVENT' and e['ok'] and len(e.get('hash', '')) == 66"

echo '== network policies'
expect 'the simulator can reach the broker' open "$(from trolley-sim mqtt-broker 1883)"
expect 'but not the database' blocked "$(from trolley-sim postgres 5432)"
expect 'or the vault' blocked "$(from trolley-sim fintech-vault 3002)"
expect 'the gateway can reach auth' open "$(from gateway auth-service 3004)"
expect 'but not the database' blocked "$(from gateway postgres 5432)"
expect 'a pod nobody expects can reach the gateway' open "$(from intruder gateway 80)"
expect 'but not the database' blocked "$(from intruder postgres 5432)"
expect 'or redis' blocked "$(from intruder redis 6379)"
expect 'or the chain' blocked "$(from intruder chain 8545)"
expect 'or go around the gateway to a service' blocked "$(from intruder product-core 3001)"

echo '== nothing of ours runs as root'
for app in product-core vision fintech-vault ai-engine auth-service fleet-engine web-dashboard trolley-sim; do
  expect "$app runs as a normal user" 1000 "$(kubectl -n "$NS" exec "deployment/$app" -- id -u 2>/dev/null)"
done

echo '== pods come back'
kubectl -n "$NS" delete pod -l app=vision --wait=false > /dev/null
sleep 5
kubectl -n "$NS" rollout status deployment/vision --timeout=180s > /dev/null 2>&1
mark=$(lines)
wait_event 'scans work again after vision is killed' 90 "e['type'] == 'SCAN_EVENT' and e['event']['accepted']" "$mark"

stop_simulator() {
  kubectl -n "$NS" scale deployment/trolley-sim --replicas=0 > /dev/null
  kubectl -n "$NS" wait --for=delete pod -l app=trolley-sim --timeout=60s > /dev/null 2>&1
  sleep 8 # let in-flight scans and the checkout reset settle
}
started=$(date +%s)
stop_simulator
# this proves the SIGTERM handling too. without it, kubernetes waits out its 30s grace period
elapsed=$(( $(date +%s) - started - 8 ))
if [ "$elapsed" -lt 20 ]; then ok "the simulator stops promptly when asked (${elapsed}s)"; else nope "the simulator took ${elapsed}s to stop"; fi
carts() { api "$GW/api/fleet/trolleys" | json "sorted((t['id'], t['itemCount'], t['cartTotal']) for t in d)"; }
before=$(carts)
kubectl -n "$NS" delete pod -l app=fleet-engine > /dev/null
kubectl -n "$NS" rollout status deployment/fleet-engine --timeout=180s > /dev/null 2>&1
sleep 2
expect 'carts survive the fleet engine being killed' "$before" "$(carts)"
kubectl -n "$NS" scale deployment/trolley-sim --replicas=1 > /dev/null

stock_before=$(api "$GW/api/products/PNT-004" | json "d['stockLevel']")
kubectl -n "$NS" delete pod -l app=product-core --wait=false > /dev/null
sleep 3
kubectl -n "$NS" rollout status deployment/product-core --timeout=180s > /dev/null 2>&1
check 'the catalog returns after product-core is killed' 200 '"sku":"PNT-004"' "$GW/api/products/PNT-004"
stock_after=$(api "$GW/api/products/PNT-004" | json "d['stockLevel']")
if [ "$stock_after" -le "$stock_before" ]; then ok 'and its stock did not reset'; else nope "stock went from $stock_before to $stock_after"; fi

if [ "$OVERLAY" = "local-besu" ]; then
  echo '== the chain on the cluster'
  validators=$(kubectl -n "$NS" exec deployment/fintech-vault -- node -e "
    fetch('http://chain:8545', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ibft_getValidatorsByBlockNumber', params: ['latest'] }) })
      .then((r) => r.json()).then((d) => console.log(d.result.length))")
  expect 'four ibft 2.0 validators' 4 "$validators"
  stop_simulator
  balance_before=$(api "$GW/api/wallets/USR-003" | json "d['balance']")
  kubectl -n "$NS" delete pod -l app=fintech-vault > /dev/null
  kubectl -n "$NS" rollout status deployment/fintech-vault --timeout=180s > /dev/null 2>&1
  expect 'a killed vault keeps the contracts and balances' "$balance_before" "$(api "$GW/api/wallets/USR-003" | json "d['balance']")"
fi

summary
