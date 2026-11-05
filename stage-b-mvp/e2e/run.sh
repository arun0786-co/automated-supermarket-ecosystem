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
{
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
  echo "ADMIN_TOKEN=$ADMIN_TOKEN"
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

if ! compose up -d --build --wait --wait-timeout 600; then
  echo "stage B did not start"
  compose ps
  compose logs --no-color --tail 40
  exit 1
fi

bash e2e/smoke.sh
status=$?
if [ "$status" -ne 0 ]; then
  compose ps
  compose logs --no-color --tail 40
fi
exit "$status"
