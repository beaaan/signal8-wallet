#!/usr/bin/env bash
# Verify every contract of a broadcast deployment on Sourcify and on Blockscout, neither of which needs an API key.
# Basescan needs BASESCAN_API_KEY: use `forge script ... --verify` (README) for that one.
#
#   script/verify-keyless.sh                        # Base Sepolia: broadcast/Deploy.s.sol/84532/run-latest.json
#   script/verify-keyless.sh <run.json> <chainId> <blockscout-base-url>
set -euo pipefail
cd "$(dirname "$0")/.."
RUN=${1:-broadcast/Deploy.s.sol/84532/run-latest.json}
CHAIN=${2:-84532}
BLOCKSCOUT=${3:-https://base-sepolia.blockscout.com}
SOLC=0.8.11+commit.d7f03943
export BASESCAN_API_KEY=${BASESCAN_API_KEY:-unused} # foundry.toml names it; neither verifier reads it
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# contract name → source path, from the compiled artifacts
ident() { grep -rlE "^contract $1( |\{)" src --include=*.sol | head -1 | sed "s|$|:$1|"; }

python3 -c '
import json, sys
for t in json.load(open(sys.argv[1]))["transactions"]:
    if t["transactionType"] in ("CREATE", "CREATE2"): print(t["contractName"], t["contractAddress"], t["hash"])
' "$RUN" | while read -r name addr tx; do
  id=$(ident "$name")
  forge verify-contract "$addr" "$id" --chain "$CHAIN" --show-standard-json-input > "$TMP/$name.json"
  # Sourcify v2: submit, then poll the job
  job=$(python3 -c '
import json, sys
print(json.dumps({"stdJsonInput": json.load(open(sys.argv[1])), "compilerVersion": sys.argv[2], "contractIdentifier": sys.argv[3], "creationTransactionHash": sys.argv[4]}))
' "$TMP/$name.json" "$SOLC" "$id" "$tx" | curl -s -m 120 -X POST -H 'content-type: application/json' --data @- "https://sourcify.dev/server/v2/verify/$CHAIN/$addr")
  vid=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("verificationId",""))' "$job")
  sourcify="already verified or error: $job"
  for _ in $(seq 1 40); do
    [ -z "$vid" ] && break
    res=$(curl -s -m 30 "https://sourcify.dev/server/v2/verify/$vid")
    if python3 -c 'import json,sys; sys.exit(0 if json.loads(sys.argv[1]).get("isJobCompleted") else 1)' "$res"; then
      sourcify=$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print((d.get("contract") or {}).get("match") or d.get("error"))' "$res")
      break
    fi
    sleep 3
  done
  # Blockscout v2 standard-input verification (rate-limited: rerun the script for any "Too many requests")
  blockscout=$(curl -s -m 120 -X POST "$BLOCKSCOUT/api/v2/smart-contracts/$addr/verification/via/standard-input" \
    -F "compiler_version=v$SOLC" -F "license_type=mit" -F "contract_name=$name" \
    -F "autodetect_constructor_args=true" -F "files[0]=@$TMP/$name.json;type=application/json")
  echo "$name $addr  sourcify: $sourcify  blockscout: $blockscout"
  sleep 2
done
