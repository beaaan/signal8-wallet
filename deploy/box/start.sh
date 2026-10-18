#!/usr/bin/env bash
# Starts the public demo inside the container (deploy/box/Dockerfile):
#   1. anvil on 127.0.0.1:8546, a fresh arena chain on every start
#   2. the contracts deployed to it with NETWORK=anvil-arena (anvil dev keys, LocalSafe)
#   3. the arena agent on 127.0.0.1:8788 (NETWORK=anvil-arena)
#   4. a read-only agent on 127.0.0.1:8787 for the dashboard (NETWORK=base-sepolia, no keys)
#   5. the website on 0.0.0.0:$PORT (NETWORK=base-sepolia)
# If any of them exits, the container exits, so the host's restart policy brings the whole box back.
set -euo pipefail
trap 'kill 0' TERM INT   # PID 1 in the container: pass docker stop on to every process

# This box must never hold a key that can move real (testnet) money. Refuse to start with one.
if env | grep -qE '^[A-Z_]*PRIVATE_KEY='; then
  echo "refusing to start: a *_PRIVATE_KEY variable is set; this box runs keyless" >&2
  exit 1
fi

PORT="${PORT:-3000}"
ARENA_RPC=http://127.0.0.1:8546
BASE_SEPOLIA_RPC="${BASE_SEPOLIA_RPC:-https://base-sepolia-rpc.publicnode.com}"
export BASE_SEPOLIA_RPC

anvil --host 127.0.0.1 --port 8546 --silent &

for _ in $(seq 1 50); do
  cast block-number --rpc-url "$ARENA_RPC" >/dev/null 2>&1 && break
  sleep 0.2
done

echo "deploying the contracts to the arena chain"
(cd /app/contracts && NETWORK=anvil-arena forge script script/Deploy.s.sol --rpc-url "$ARENA_RPC" --broadcast >/tmp/deploy.log 2>&1) \
  || { cat /tmp/deploy.log >&2; exit 1; }

# The arena agent gets the model settings (MODEL_*); without them it uses the rule-based extractor.
(cd /app/agent && NETWORK=anvil-arena RPC_URL="$ARENA_RPC" AGENT_API_PORT=8788 LOG_DIR=/app/agent/logs/arena \
  STATE_DIR=/app/agent/state/arena exec node_modules/.bin/tsx src/server.ts) &

# Read-only: on base-sepolia without AGENT_PRIVATE_KEY the server serves decisions and never signs.
(cd /app/agent && exec env -u MODEL_API_KEY NETWORK=base-sepolia AGENT_API_PORT=8787 \
  LOG_DIR=/app/agent/logs/base-sepolia STATE_DIR=/app/agent/state/base-sepolia node_modules/.bin/tsx src/server.ts) &

# TRUST_PROXY=1 only when a reverse proxy in front appends the client address to X-Forwarded-For (compose.yaml).
(cd /app/web && NETWORK=base-sepolia AGENT_API_URL=http://127.0.0.1:8787 ARENA_AGENT_API_URL=http://127.0.0.1:8788 \
  exec node_modules/.bin/next start -H 0.0.0.0 -p "$PORT") &

wait -n
echo "a process exited; stopping the box" >&2
exit 1
