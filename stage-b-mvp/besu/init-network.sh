#!/bin/bash
# runs once before the validators: generates their keys and a genesis that names them.
# the output stays in a volume, so restarts reuse it and the keys never touch the repo
set -eu

if [ -f /network/genesis.json ]; then
  echo "network already initialised"
  exit 0
fi

WORK=$(mktemp -d)
/opt/besu/bin/besu operator generate-blockchain-config \
  --config-file=/besu/network-config.json \
  --to="$WORK/generated" \
  --private-key-file-name=key

number=1
peers=()
for keys in "$WORK"/generated/keys/*; do
  mkdir -p "/network/node-$number"
  cp "$keys/key" "$keys/key.pub" "/network/node-$number/"
  public_key=$(sed 's/^0x//' "$keys/key.pub")
  peers+=("\"enode://$public_key@besu-$number:30303\"")
  number=$((number + 1))
done

(IFS=,; echo "[${peers[*]}]") > /network/static-nodes.json
cp "$WORK/generated/genesis.json" /network/genesis.json
# the validators run as the image's unprivileged user
chmod -R a+rX /network
echo "generated a network with $((number - 1)) validators"
