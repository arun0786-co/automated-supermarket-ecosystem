#!/usr/bin/env bash
# runs browser-check.mjs in a container on the stack's network, so nothing needs installing here.
# usage: browser-check.sh <compose project> [folder to copy screenshots into]
# env: DEMO_PASSWORD, ADMIN_PASSWORD
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
PROJECT=${1:?compose project name}
OUT=${2:-}
PLAYWRIGHT=1.65.0
NAME="$PROJECT-browser-check"

docker rm -f "$NAME" > /dev/null 2>&1
docker run --name "$NAME" -i --network "${PROJECT}_default" \
  -e BASE_URL=http://gateway \
  -e DEMO_PASSWORD -e ADMIN_PASSWORD -e SCREENSHOT_DIR=/tmp/shots \
  "mcr.microsoft.com/playwright:v$PLAYWRIGHT-noble" \
  bash -c "mkdir -p /tmp/shots /tmp/run && cd /tmp/run && cat > check.mjs && npm init -y > /dev/null && npm install --silent --no-audit --no-fund playwright@$PLAYWRIGHT && node check.mjs" \
  < "$HERE/browser-check.mjs"
status=$?

if [ -n "$OUT" ]; then
  mkdir -p "$OUT"
  docker cp "$NAME:/tmp/shots/." "$OUT" > /dev/null 2>&1
fi
docker rm -f "$NAME" > /dev/null 2>&1
exit "$status"
