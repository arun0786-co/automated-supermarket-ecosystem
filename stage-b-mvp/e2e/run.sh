#!/usr/bin/env bash
# start stage B from scratch under its own compose project, test it, tear it down.
# throwaway secrets are generated for the run, so stage-b-mvp/.env is not needed.
# KEEP=1 leaves the stack running afterwards.
set -u

cd "$(dirname "$0")/.." || exit 1
ENV_FILE=$(mktemp)
chmod 600 "$ENV_FILE"
export E2E_ENV_FILE=$ENV_FILE
export ADMIN_TOKEN=$(openssl rand -hex 16)
export DEMO_PASSWORD=$(openssl rand -hex 16)
export ADMIN_PASSWORD=$(openssl rand -hex 16)
{
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
  echo "ADMIN_TOKEN=$ADMIN_TOKEN"
  echo "JWT_SECRET=$(openssl rand -hex 32)"
  echo "MQTT_FLEET_PASSWORD=$(openssl rand -hex 16)"
  echo "MQTT_TROLLEY_PASSWORD=$(openssl rand -hex 16)"
  echo "DEMO_PASSWORD=$DEMO_PASSWORD"
  echo "ADMIN_PASSWORD=$ADMIN_PASSWORD"
  # far faster than a real shop, so a cart fills up within the test
  echo "SCAN_PROBABILITY=0.6"
} > "$ENV_FILE"

compose() { docker compose -p ase-e2e --env-file "$ENV_FILE" "$@"; }

finish() {
  if [ "${KEEP:-0}" = "1" ]; then
    echo "stack left running: docker compose -p ase-e2e --env-file $ENV_FILE ..."
  else
    compose down -v --remove-orphans > /dev/null 2>&1
    rm -f "$ENV_FILE"
  fi
}
trap finish EXIT

# everything but the simulator first: the api checks expect exact balances and stock
if ! compose up -d --build --wait --wait-timeout 600 --scale trolley-sim=0; then
  echo "stage B did not start"
  compose ps
  compose logs --no-color --tail 40
  exit 1
fi

bash e2e/smoke.sh
status=$?
if [ "$status" -eq 0 ]; then
  compose up -d --no-deps --scale trolley-sim=1 trolley-sim
  bash e2e/loop.sh
  status=$?
fi
if [ "$status" -ne 0 ]; then
  compose ps
  compose logs --no-color --tail 40
fi
exit "$status"
