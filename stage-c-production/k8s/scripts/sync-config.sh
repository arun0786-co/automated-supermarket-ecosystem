#!/usr/bin/env bash
# the gateway and broker config lives in stage-b-mvp/config. this copies it here for kustomize,
# which can't read outside its own folder. --check fails if the copies have drifted, ci runs that
#
# kubernetes services keep a stable ip, so the gateway drops the dynamic dns the compose
# version needs for recreated containers
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
SOURCE="$HERE/../../../stage-b-mvp/config"
TARGET="$HERE/../base/config"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

sed -E -e '/^ *# docker.s dns/,/^ *resolver /d' -e '/^ *zone upstreams/d' -e 's/ resolve;/;/' "$SOURCE/nginx.conf" > "$OUT/nginx.conf"
for file in nginx-protected.conf nginx-admin.conf mosquitto.conf mosquitto-acl.conf mosquitto-start.sh; do
  cp "$SOURCE/$file" "$OUT/$file"
done

if [ "${1:-}" = "--check" ]; then
  diff -r "$OUT" "$TARGET" && echo "k8s config is in sync"
else
  mkdir -p "$TARGET"
  cp "$OUT"/* "$TARGET"/
  echo "k8s config updated"
fi
