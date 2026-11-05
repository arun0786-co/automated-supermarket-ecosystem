#!/bin/bash
# one validator. the argument is its number, matching a key folder from init-network.sh
set -eu

NODE=$1
exec /opt/besu/bin/besu \
  --data-path=/data \
  --genesis-file=/network/genesis.json \
  --node-private-key-file="/network/node-$NODE/key" \
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
