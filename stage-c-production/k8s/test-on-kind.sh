#!/usr/bin/env bash
# deploys the manifests to a throwaway local cluster and tests the running result: the same api
# checks as compose, plus what only kubernetes can show. usage: test-on-kind.sh [local|local-besu]
# KEEP=1 leaves the cluster running. needs docker, kind and kubectl
set -u

OVERLAY=${1:-local}
CLUSTER=ase-test
NS=ase
PORT=18080
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
SERVICES="product-core vision fintech-vault ai-engine auth-service fleet-engine web-dashboard trolley-sim"

export DEMO_PASSWORD=${DEMO_PASSWORD:-$(openssl rand -hex 16)}
export ADMIN_PASSWORD=${ADMIN_PASSWORD:-$(openssl rand -hex 16)}
FORWARD=
BUILD_ENV=$(mktemp)

finish() {
  [ -n "$FORWARD" ] && kill "$FORWARD" 2>/dev/null
  rm -f "$BUILD_ENV"
  if [ "${KEEP:-0}" = "1" ]; then
    echo "cluster $CLUSTER left running"
  else
    kind delete cluster --name "$CLUSTER" > /dev/null 2>&1
  fi
}
trap finish EXIT

bash "$HERE/scripts/sync-config.sh" --check || exit 1

echo "== building images"
# compose knows how each image is built. these values only satisfy its checks, nothing runs
for name in POSTGRES_PASSWORD JWT_SECRET MQTT_FLEET_PASSWORD MQTT_TROLLEY_PASSWORD DEMO_PASSWORD ADMIN_PASSWORD; do
  echo "$name=build-only" >> "$BUILD_ENV"
done
# shellcheck disable=SC2086
docker compose -p ase-k8s -f "$ROOT/stage-b-mvp/docker-compose.yml" --env-file "$BUILD_ENV" build $SERVICES > /dev/null 2>&1 || {
  echo "image build failed"
  exit 1
}

echo "== creating the cluster"
kind get clusters 2>/dev/null | grep -qx "$CLUSTER" || kind create cluster --name "$CLUSTER" --wait 180s > /dev/null 2>&1 || {
  echo "could not create the cluster"
  exit 1
}
for service in $SERVICES; do
  kind load docker-image "ase-k8s-$service:latest" --name "$CLUSTER" > /dev/null 2>&1 || {
    echo "could not load $service into the cluster"
    exit 1
  }
done

echo "== deploying $OVERLAY"
bash "$HERE/scripts/create-secrets.sh"
[ "$OVERLAY" = "local-besu" ] && bash "$HERE/scripts/create-besu-secret.sh"
kubectl apply -k "$HERE/overlays/$OVERLAY" > /dev/null || exit 1

ready=1
for deployment in product-core vision fintech-vault ai-engine auth-service fleet-engine web-dashboard gateway mqtt-broker; do
  kubectl -n "$NS" rollout status "deployment/$deployment" --timeout=420s > /dev/null 2>&1 || {
    echo "FAIL  $deployment did not become ready"
    ready=0
  }
done
if [ "$ready" = 0 ]; then
  kubectl -n "$NS" get pods
  kubectl -n "$NS" get events --sort-by=.lastTimestamp | tail -20
  for pod in $(kubectl -n "$NS" get pods --no-headers | grep -v -E '1/1|2/2|Running' | cut -d' ' -f1 | head -4); do
    echo "--- $pod"
    kubectl -n "$NS" logs "$pod" --tail=15 2>&1 | cut -c1-200
  done
  exit 1
fi

kubectl -n "$NS" port-forward svc/gateway "$PORT:80" > /dev/null 2>&1 &
FORWARD=$!
sleep 3

export GW="http://localhost:$PORT"
export WS="ws://localhost:$PORT/ws"
export E2E_NAMESPACE=$NS

echo
bash "$ROOT/stage-b-mvp/e2e/smoke.sh" || exit 1
echo
bash "$HERE/cluster-checks.sh" "$OVERLAY" || exit 1
