#!/usr/bin/env bash
# creates stage-b-mvp/.env with random secrets and a self-signed certificate, so stage B can start
# without inventing seven passwords by hand. it won't touch a .env that already exists.
# the certificate is for trying tls locally, browsers will warn about it. use a real one in production
set -eu

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo ".env already exists, leaving it alone"
else
  umask 077
  demo=$(openssl rand -hex 8)
  admin=$(openssl rand -hex 8)
  grafana=$(openssl rand -hex 8)
  {
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    echo "JWT_SECRET=$(openssl rand -hex 32)"
    echo "MQTT_FLEET_PASSWORD=$(openssl rand -hex 24)"
    echo "MQTT_TROLLEY_PASSWORD=$(openssl rand -hex 24)"
    echo "DEMO_PASSWORD=$demo"
    echo "ADMIN_PASSWORD=$admin"
    echo "GRAFANA_PASSWORD=$grafana"
  } > .env
  umask 022
  echo "created stage-b-mvp/.env"
  echo
  echo "  dashboard login:  admin@ase.local / $admin"
  echo "  customer logins:  arun@ase.local, priya@ase.local, rohan@ase.local / $demo"
  echo "  grafana login:    admin / $grafana"
  echo
  echo "these are also in the .env file. they only take effect on a fresh database"
fi

if [ ! -f certs/tls.crt ]; then
  mkdir -p certs
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    -keyout certs/tls.key -out certs/tls.crt > /dev/null 2>&1
  # nginx reads the key as root before dropping privileges, and the mount is read only
  chmod 644 certs/tls.crt
  chmod 600 certs/tls.key
  echo "created a self-signed certificate in stage-b-mvp/certs"
fi
