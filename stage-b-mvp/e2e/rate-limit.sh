#!/usr/bin/env bash
# password guessing against the gateway. runs last: it uses up the login allowance for a while
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=e2e/lib.sh
source "$HERE/lib.sh"
trap 'rm -rf "$WORK"' EXIT

echo '== password guessing'
seq 1 60 | xargs -P 20 -I{} curl -s -m 30 -w '\n%{http_code}\n' -X POST -H "$CT" \
  -d '{"email":"arun@ase.local","password":"guess guess"}' "$GW/api/auth/login" > "$WORK/guesses"
limited=$(grep -c '^429$' "$WORK/guesses")
if [ "$limited" -gt 20 ]; then ok "the gateway stops it ($limited of 60 were limited)"; else nope "only $limited of 60 guesses were limited"; fi
if grep -q 'too many requests' "$WORK/guesses"; then ok 'and says so in json'; else nope 'the limit response was not the json one'; fi

summary
