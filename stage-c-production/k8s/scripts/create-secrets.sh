#!/usr/bin/env bash
# creates the ase-secrets secret with random values, so nothing has to be committed. it does
# nothing if the secret already exists. DEMO_PASSWORD and ADMIN_PASSWORD can be set beforehand
set -eu

kubectl create namespace ase --dry-run=client -o yaml | kubectl apply -f - > /dev/null
if kubectl -n ase get secret ase-secrets > /dev/null 2>&1; then
  echo "ase-secrets already exists"
  exit 0
fi
kubectl -n ase create secret generic ase-secrets \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 24)" \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=MQTT_FLEET_PASSWORD="$(openssl rand -hex 24)" \
  --from-literal=MQTT_TROLLEY_PASSWORD="$(openssl rand -hex 24)" \
  --from-literal=DEMO_PASSWORD="${DEMO_PASSWORD:-$(openssl rand -hex 16)}" \
  --from-literal=ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(openssl rand -hex 16)}" > /dev/null
echo "ase-secrets created. read a password back with: kubectl -n ase get secret ase-secrets -o jsonpath='{.data.ADMIN_PASSWORD}' | base64 -d"
