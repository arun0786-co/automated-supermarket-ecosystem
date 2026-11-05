#!/bin/sh
# the pod's ordinal picks its key: besu-0 uses key-0
set -eu
ordinal=${HOSTNAME##*-}
exec /opt/besu/bin/besu \
  --data-path=/data \
  --genesis-file=/network/genesis.json \
  --node-private-key-file="/network/key-$ordinal" \
  --static-nodes-file=/network/static-nodes.json \
  --discovery-enabled=false \
  --Xdns-enabled=true \
  --Xdns-update-enabled=true \
  --min-gas-price=0 \
  --rpc-http-enabled \
  --rpc-http-host=0.0.0.0 \
  --rpc-http-api=ETH,NET,WEB3,IBFT \
  --host-allowlist=* \
  --logging=WARN
