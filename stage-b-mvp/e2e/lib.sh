# shared by smoke.sh and loop.sh
GW=${GW:-http://localhost:80}
CT='content-type: application/json'
WORK=$(mktemp -d)
passed=0
failed=0
# the bearer token sent by check and api. set it for one call with TOKEN=... check ...
TOKEN=

ok()   { passed=$((passed + 1)); printf 'ok    %s\n' "$1"; }
nope() { failed=$((failed + 1)); printf 'FAIL  %s\n' "$1"; }

# check <label> <expected status> <text expected in the body, or ''> <curl args...>
check() {
  local label=$1 want=$2 needle=$3
  shift 3
  local code
  code=$(curl -g -s -m 30 -o "$WORK/body" -w '%{http_code}' ${TOKEN:+-H "authorization: Bearer $TOKEN"} "$@" 2>/dev/null)
  if [ "$code" = "$want" ] && { [ -z "$needle" ] || grep -q -F -- "$needle" "$WORK/body"; }; then
    ok "$label"
  else
    nope "$label: wanted $want with [$needle], got $code: $(cut -c1-300 "$WORK/body")"
  fi
}

# expect <label> <wanted> <got>
expect() {
  if [ "$2" = "$3" ]; then ok "$1"; else nope "$1: wanted $2, got $3"; fi
}

api() { curl -g -s -m 30 ${TOKEN:+-H "authorization: Bearer $TOKEN"} "$@"; }

json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

wait_for() {
  local i
  for i in $(seq 1 150); do
    [ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null)" = "200" ] && return 0
    sleep 2
  done
  nope "timed out waiting for $1"
  return 1
}

# login <email> <password>: prints the access token
login() {
  curl -s -m 30 -X POST -H "$CT" -d "{\"email\":\"$1\",\"password\":\"$2\"}" "$GW/api/auth/login" | json "d['accessToken']"
}

compose() { docker compose -p "${E2E_PROJECT:-ase-e2e}" --env-file "$E2E_ENV_FILE" "$@"; }

# reads postgres directly, only for checks the api can't answer
db() { compose exec -T postgres psql -U ase -d ase_products -Atc "$1"; }

summary() {
  echo
  echo "$passed passed, $failed failed"
  [ "$failed" -eq 0 ]
}
