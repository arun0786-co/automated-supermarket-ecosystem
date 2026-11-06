#!/usr/bin/env bash
# chapter 6 against a real ibft 2.0 network: consensus, zero gas, finality, what happens when
# validators fail, and measured numbers rather than the ones in the spec
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=e2e/lib.sh
source "$HERE/lib.sh"
trap 'rm -rf "$WORK"' EXIT
USR3=0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65
TOKEN=$(login admin@ase.local "$ADMIN_PASSWORD")

# rpc <node> <method> [json params]: the nodes aren't published, so ask from inside the stack
rpc() {
  compose exec -T fintech-vault node -e "
    fetch('http://besu-$1:8545', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: '$2', params: ${3:-[]} }), signal: AbortSignal.timeout(5000) })
      .then((r) => r.text()).then(console.log, (e) => console.log(JSON.stringify({ error: String(e) })))" 2>/dev/null
}
height() { rpc "$1" eth_blockNumber | json "int(d['result'], 16)" 2>/dev/null; }

# checkouts <count> <parallel>: prints how many paid, then the seconds taken
checkouts() {
  local started finished
  started=$(python3 -c 'import time; print(time.time())')
  seq 1 "$1" | xargs -P "$2" -I{} curl -s -m 60 -o /dev/null -w '%{http_code}\n' -X POST -H "$CT" -H "authorization: Bearer $TOKEN" \
    -d "{\"customer\":\"$USR3\",\"amount\":\"0.01\",\"cartItems\":[{\"sku\":\"PRD-001\"}]}" "$GW/api/checkout" > "$WORK/codes"
  finished=$(python3 -c 'import time; print(time.time())')
  echo "$(grep -c '^200$' "$WORK/codes") $(python3 -c "print(round($finished - $started, 2))")"
}

compose stop trolley-sim > /dev/null 2>&1
sleep 3

echo '== consensus'
validators=$(rpc 1 ibft_getValidatorsByBlockNumber '["latest"]' | json "len(d['result'])")
expect 'ibft 2.0 reports four validators' 4 "$validators"
check 'the vault is on this chain' 200 '"status":"ok"' "$GW/health/vault"

check 'give the test customer funds' 200 '"ok":true' -X POST -H "$CT" -d "{\"to\":\"$USR3\",\"amount\":\"1000\"}" "$GW/api/wallet/mint"

echo '== zero gas'
tx=$(api -X POST -H "$CT" -d "{\"customer\":\"$USR3\",\"amount\":\"1\",\"cartItems\":[{\"sku\":\"PRD-001\"}]}" "$GW/api/checkout" | json "d['hash']")
receipt=$(rpc 1 eth_getTransactionReceipt "[\"$tx\"]")
expect 'a checkout was mined' 1 "$(echo "$receipt" | json "int(d['result']['status'], 16)")"
expect 'and cost no gas' 0 "$(echo "$receipt" | json "int(d['result']['effectiveGasPrice'], 16)")"

echo '== finality'
expect 'every validator has the same block' \
  "$(rpc 1 eth_getTransactionReceipt "[\"$tx\"]" | json "d['result']['blockHash']")" \
  "$(rpc 3 eth_getTransactionReceipt "[\"$tx\"]" | json "d['result']['blockHash']")"
read -r paid seconds <<< "$(checkouts 10 1)"
expect 'ten checkouts in a row all paid' 10 "$paid"
echo "      measured: one at a time, $(python3 -c "print(round($seconds / 10, 2))")s per confirmed checkout"
# one block period is 1s, so most of a checkout should be waiting for the next block
if python3 -c "exit(0 if $seconds / 10 < 2.5 else 1)"; then ok 'a confirmed checkout takes a couple of block periods at most'; else nope "too slow: $seconds s for 10"; fi

echo '== throughput'
read -r paid seconds <<< "$(checkouts 200 40)"
expect 'two hundred at once all paid' 200 "$paid"
echo "      measured: $(python3 -c "print(round($paid / $seconds, 1))") checkouts per second through the vault, 4 validators on this machine"
echo "      the spec's 1000+ TPS is not shown by this test"

echo '== one validator fails (f = 1 of 4)'
compose stop besu-4 > /dev/null 2>&1
read -r paid seconds <<< "$(checkouts 5 1)"
expect 'checkouts keep working' 5 "$paid"
behind=$(height 1)
compose start besu-4 > /dev/null 2>&1
caught=0
for i in $(seq 1 60); do
  now=$(height 4)
  if [ -n "$now" ] && [ "$now" -ge "$behind" ]; then caught=1; break; fi
  sleep 2
done
expect 'and it catches up when it returns' 1 "$caught"

echo '== two validators fail (more than it can tolerate)'
compose stop besu-3 besu-4 > /dev/null 2>&1
sleep 5
stopped_at=$(height 1)
code=$(api -m 20 -o /dev/null -w '%{http_code}' -X POST -H "$CT" -d "{\"customer\":\"$USR3\",\"amount\":\"1\",\"cartItems\":[{\"sku\":\"PRD-001\"}]}" "$GW/api/checkout")
expect 'the chain halts rather than fork' "$stopped_at" "$(height 1)"
echo "      a checkout sent meanwhile got: $code (no block, so no confirmation)"
compose start besu-3 besu-4 > /dev/null 2>&1
resumed=0
for i in $(seq 1 90); do
  now=$(height 1)
  if [ -n "$now" ] && [ "$now" -gt "$stopped_at" ]; then resumed=1; break; fi
  sleep 2
done
expect 'and resumes once there is a quorum again' 1 "$resumed"

echo '== the chain outlives the vault'
sleep 15 # the checkout sent during the halt may land now, let it settle
before=$(api "$GW/api/wallet/$USR3" | json "d['balance']")
compose restart fintech-vault > /dev/null 2>&1
wait_for "$GW/health/vault"
expect 'a vault restart keeps the contracts and the balance' "$before" "$(api "$GW/api/wallet/$USR3" | json "d['balance']")"
check 'and the history' 200 '"transactions":[{' "$GW/api/ledger"

compose start trolley-sim > /dev/null 2>&1
summary
