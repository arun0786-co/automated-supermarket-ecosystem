#!/usr/bin/env bash
# chapter 11.2 against the running stack: the named metrics, the dashboard, and one add to cart
# traced from the trolley message down to the database. needs the simulator to have been running
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=e2e/lib.sh
source "$HERE/lib.sh"
trap 'rm -rf "$WORK"' EXIT
PROM=http://localhost:9090
GRAFANA=http://localhost:3100
JAEGER=http://localhost:16686

prom() { curl -s -m 10 -G "$PROM/api/v1/query" --data-urlencode "query=$1" | json "len(d['data']['result'])"; }

wait_prom() {
  local i
  for ((i = 0; i < 60; i++)); do
    [ "$(prom "$1")" -gt 0 ] 2>/dev/null && { ok "$2"; return 0; }
    sleep 2
  done
  nope "$2: nothing for $1"
}

echo '== metrics'
wait_for "$PROM/-/ready"
for job in fleet-engine vision product-core; do
  wait_prom "up{job=\"$job\"} == 1" "prometheus is scraping $job"
done
wait_prom 'ase_active_carts' 'active carts'
wait_prom 'ase_transaction_latency_seconds_count > 0' 'transaction latency'
wait_prom 'ase_vision_confidence_count > 0' 'vision model confidence'
wait_prom 'ase_scans_total{outcome="accepted"} > 0' 'accepted scans'
wait_prom 'ase_picks_total{path="redis",outcome="ok"} > 0' 'picks through redis'
wait_prom 'ase_hot_stock_degraded == 0' 'hot stock reports healthy'

if curl -s -m 5 "$GW/api/metrics" | grep -q '^ase_'; then nope 'metrics are exposed through the gateway'; else ok 'metrics are not exposed through the gateway'; fi

echo '== dashboard'
wait_for "$GRAFANA/api/health"
expect 'grafana refuses a wrong password' 401 "$(curl -s -m 5 -o /dev/null -w '%{http_code}' -u admin:wrong "$GRAFANA/api/search")"
board=$(curl -s -m 10 -u "admin:$GRAFANA_PASSWORD" "$GRAFANA/api/dashboards/uid/ase-store-health")
expect 'the store health dashboard is provisioned' 'Store Health' "$(echo "$board" | json "d['dashboard']['title']")"
# a panel with a mistyped metric still loads, so ask for each panel's actual data
mistakes=0
while IFS= read -r expr; do
  result=$(curl -s -m 10 -G "$PROM/api/v1/query" --data-urlencode "query=$expr" | json "d['status']")
  [ "$result" = "success" ] || mistakes=$((mistakes + 1))
done < <(echo "$board" | json "'\n'.join(t['expr'] for p in d['dashboard']['panels'] for t in p['targets'])")
expect 'every panel query is valid' 0 "$mistakes"

echo '== one add to cart, end to end'
found=0
for ((i = 0; i < 60 && found == 0; i++)); do
  curl -s -m 15 -G "$JAEGER/api/traces" --data-urlencode 'service=fleet-engine' --data-urlencode 'operation=scan' \
    --data-urlencode 'limit=50' --data-urlencode 'lookback=1h' > "$WORK/traces.json"
  summary_line=$(python3 - "$WORK/traces.json" <<'PY'
import json, sys
try:
    traces = json.load(open(sys.argv[1])).get("data") or []
except ValueError:
    traces = []
best = ""
for trace in traces:
    services = {p["serviceName"] for p in trace["processes"].values()}
    names = [s["operationName"] for s in trace["spans"]]
    tags = [t for s in trace["spans"] for t in s.get("tags", [])]
    systems = {t["value"] for t in tags if t["key"] in ("db.system", "db.system.name")}
    if {"fleet-engine", "product-core"} <= services and "redis" in systems:
        best = f"{len(trace['spans'])} spans, services {sorted(services)}, databases {sorted(systems)}"
        break
print(best)
PY
)
  [ -n "$summary_line" ] && found=1 || sleep 2
done
if [ "$found" = 1 ]; then ok "a scan is traced through fleet and product-core to the store ($summary_line)"; else nope 'no trace reached product-core and its store'; fi

summary
