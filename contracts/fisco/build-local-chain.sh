#!/usr/bin/env bash
# Local 4-node FISCO BCOS v3.16.3 Air chain with web3 RPC on 127.0.0.1:8545 (node0 only), for the Yagi replay
# (stretch; docs/PLAN.md §5.6, contracts/README.md "Local FISCO BCOS").
#
# Everything goes to $FISCO_DIR (default /tmp/fisco), outside the repo: the binary, node configs, node certificates
# and chain data. Never commit any of it.
#
#   bash contracts/fisco/build-local-chain.sh <admin address>   # download (once), build a fresh chain, start it
#   bash "${FISCO_DIR:-/tmp/fisco}/nodes/127.0.0.1/stop_all.sh"  # stop
#
# Why v3.16.3: v3.16.4's web3 RPC refuses any sender with a zero balance (InsufficientFunds, even at gas price 0),
# and its genesis has no working way to fund accounts. v3.16.3 accepts gas-price-0 legacy transactions.
# The admin address only stops build_chain.sh downloading get_account.sh (it passes -a, which also switches on auth
# mode); the script switches auth back off, as on a default Air chain.
set -euo pipefail

VERSION=v3.16.3
DIR=${FISCO_DIR:-/tmp/fisco}
ADMIN=${1:?usage: build-local-chain.sh <admin address, e.g. the deployer>}
[[ $ADMIN =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "not an address: $ADMIN" >&2; exit 2; }

BIN_DIR=$DIR/$VERSION
mkdir -p "$BIN_DIR"
if [ ! -x "$BIN_DIR/fisco-bcos" ]; then
  curl -sSfL -o "$BIN_DIR/fisco-bcos-linux-x86_64.tar.gz" \
    "https://github.com/FISCO-BCOS/FISCO-BCOS/releases/download/$VERSION/fisco-bcos-linux-x86_64.tar.gz"
  tar -xzf "$BIN_DIR/fisco-bcos-linux-x86_64.tar.gz" -C "$BIN_DIR"
fi
if [ ! -f "$BIN_DIR/build_chain.sh" ]; then
  curl -sSfL -o "$BIN_DIR/build_chain.sh" \
    "https://raw.githubusercontent.com/FISCO-BCOS/FISCO-BCOS/$VERSION/tools/BcosAirBuilder/build_chain.sh"
fi
"$BIN_DIR/fisco-bcos" -v | head -1

NODES=$DIR/nodes
[ -x "$NODES/127.0.0.1/stop_all.sh" ] && bash "$NODES/127.0.0.1/stop_all.sh" > /dev/null 2>&1 || true
# another chain (or a node still shutting down) on our ports would answer the final check instead of this one
for _ in $(seq 1 15); do
  pgrep -f "$NODES/127.0.0.1/node[0-3]/../fisco-bcos" > /dev/null || break
  sleep 1
done
for port in 8545 20200 20201 20202 20203 30300 30301 30302 30303; do
  if (exec 3<> "/dev/tcp/127.0.0.1/$port") 2> /dev/null; then
    echo "127.0.0.1:$port is already in use; stop the other chain first" >&2
    exit 1
  fi
done
rm -rf "$NODES"
(cd "$DIR" && bash "$BIN_DIR/build_chain.sh" -l 127.0.0.1:4 -p 30300,20200 -e "$BIN_DIR/fisco-bcos" -o "$NODES" -a "$ADMIN")

cd "$NODES/127.0.0.1"
# all four genesis files must stay identical
sed -i 's/is_auth_check=true/is_auth_check=false/' node0/config.genesis node1/config.genesis node2/config.genesis node3/config.genesis
# web3 RPC on node0 only, loopback only (eth_chainId = config.genesis [web3] chain_id = 20200)
sed -i '/^\[web3_rpc\]/,/^\[/{s/^    enable=false/    enable=true/;s/^    listen_ip=0.0.0.0/    listen_ip=127.0.0.1/}' node0/config.ini
grep -A3 '^\[web3_rpc\]' node0/config.ini
bash start_all.sh
for _ in $(seq 1 30); do
  if curl -sS --noproxy '*' -m 2 -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545 2> /dev/null; then
    echo
    exit 0
  fi
  sleep 1
done
echo "web3 RPC did not come up on 127.0.0.1:8545; see $NODES/127.0.0.1/node0/log/" >&2
exit 1
