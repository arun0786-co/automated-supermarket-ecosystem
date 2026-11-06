#!/usr/bin/env bash
# generates four validator keys and a genesis, and stores them in the besu-network secret.
# it does nothing if the secret exists: new keys would mean a new chain.
# CHAIN_MNEMONIC is the vault's signing key. it defaults to hardhat's public test mnemonic, which
# the genesis funds, and that is only acceptable for a test chain. change the genesis alloc
# and set your own for anything real
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
MNEMONIC=${CHAIN_MNEMONIC:-test test test test test test test test test test test junk}
kubectl create namespace ase --dry-run=client -o yaml | kubectl apply -f - > /dev/null
if kubectl -n ase get secret besu-network > /dev/null 2>&1; then
  echo "besu-network already exists"
  exit 0
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
docker run --rm -i --user root --entrypoint bash hyperledger/besu:26.11.0 -c '
  set -e
  cat > /tmp/config.json
  /opt/besu/bin/besu operator generate-blockchain-config --config-file=/tmp/config.json --to=/tmp/out --private-key-file-name=key > /dev/null 2>&1
  cd /tmp/out && tar cf - genesis.json keys
' < "$HERE/../../../stage-b-mvp/besu/network-config.json" | tar xf - -C "$WORK"

args=(--from-file=genesis.json="$WORK/genesis.json" --from-literal=mnemonic="$MNEMONIC")
peers=()
number=0
for keys in "$WORK"/keys/*; do
  args+=(--from-file="key-$number=$keys/key")
  peers+=("\"enode://$(sed 's/^0x//' "$keys/key.pub")@besu-$number.besu-peers:30303\"")
  number=$((number + 1))
done
(IFS=,; echo "[${peers[*]}]") > "$WORK/static-nodes.json"
kubectl -n ase create secret generic besu-network "${args[@]}" --from-file=static-nodes.json="$WORK/static-nodes.json" > /dev/null
echo "besu-network created with $number validators"
