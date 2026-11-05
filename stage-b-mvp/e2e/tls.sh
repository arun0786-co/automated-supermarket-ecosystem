#!/usr/bin/env bash
# chapter 3.1.2: ssl termination at the gateway
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=e2e/lib.sh
source "$HERE/lib.sh"
trap 'rm -rf "$WORK"' EXIT
TLS=https://localhost:443

echo '== https at the gateway'
code=$(curl -s -k -m 10 -o /dev/null -w '%{http_code}' "$TLS/health")
expect 'the gateway answers over https' 200 "$code"
version=$(curl -s -k -m 10 -o /dev/null -w '%{ssl_version}' --tlsv1.2 "$TLS/health" 2>/dev/null || true)
[ -n "$version" ] || version=$(curl -s -k -m 10 -v -o /dev/null "$TLS/health" 2>&1 | grep -o -m1 'TLSv1\.[0-9]')
case "$version" in
  *1.2* | *1.3*) ok "with a current protocol ($version)" ;;
  *) nope "unexpected protocol: $version" ;;
esac
if curl -s -k -m 10 --tls-max 1.1 -o /dev/null "$TLS/health" 2>/dev/null; then nope 'old tls versions are accepted'; else ok 'old tls versions are refused'; fi
if curl -s -k -m 10 -D - -o /dev/null "$TLS/health" | grep -qi '^strict-transport-security'; then ok 'browsers are told to stay on https'; else nope 'no hsts header'; fi

ACCESS=$(curl -s -k -m 30 -X POST -H "$CT" -d "{\"email\":\"admin@ase.local\",\"password\":\"$ADMIN_PASSWORD\"}" "$TLS/api/auth/login" | json "d['accessToken']")
code=$(curl -s -k -m 10 -o /dev/null -w '%{http_code}' -H "authorization: Bearer $ACCESS" "$TLS/api/products")
expect 'logging in and using the api works over https' 200 "$code"
code=$(curl -s -k -m 10 -o /dev/null -w '%{http_code}' "$TLS/api/products")
expect 'and a missing token is still refused' 401 "$code"

summary
