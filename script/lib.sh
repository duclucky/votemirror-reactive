#!/usr/bin/env bash
# Shared settings for the deploy and demo scripts. Testnet only.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[ -f .env ] && { set -a; . ./.env; set +a; }

: "${PRIVATE_KEY:?set PRIVATE_KEY (testnet only)}"
: "${VOTER_KEYS:?set VOTER_KEYS to comma separated demo voter keys}"
export BASE_SEPOLIA_RPC="${BASE_SEPOLIA_RPC:-https://sepolia.base.org}"
export LASNA_RPC="${LASNA_RPC:-https://lasna-rpc.rnk.dev/}"
BASE_CHAIN_ID=84532
LASNA_CHAIN_ID=5318007
CALLBACK_PROXY=0x476F44b11F5C942c58f4c8E3d0300E5710743585
SYSTEM_CONTRACT=0x8888888888888888888888888888888888888888
DEPLOYMENT=deployments/testnet.json

[ "$(cast chain-id --rpc-url "$BASE_SEPOLIA_RPC")" = "$BASE_CHAIN_ID" ] || { echo "BASE_SEPOLIA_RPC is not Base Sepolia" >&2; exit 1; }
[ "$(cast chain-id --rpc-url "$LASNA_RPC")" = "$LASNA_CHAIN_ID" ] || { echo "LASNA_RPC is not Reactive Lasna" >&2; exit 1; }

IFS=',' read -r -a VOTER_KEY_LIST <<< "$VOTER_KEYS"
OWNER=$(cast wallet address --private-key "$PRIVATE_KEY")
VOTERS=()
for key in "${VOTER_KEY_LIST[@]}"; do VOTERS+=("$(cast wallet address --private-key "$key")"); done
# A voter delegates to itself, which would replace the owner's delegation to VoteMirror.
for voter in "${VOTERS[@]}"; do
  [ "$voter" != "$OWNER" ] || { echo "PRIVATE_KEY must not be one of VOTER_KEYS" >&2; exit 1; }
done

# json <file> <key>: read a top-level string from a JSON file.
json() { python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])" "$1" "$2"; }
# send <rpc> <key> <args...>: send a transaction and print its hash; fails if it reverted.
send() {
  local rpc=$1 key=$2; shift 2
  cast send --rpc-url "$rpc" --private-key "$key" --json "$@" |
    python3 -c "import json,sys; r=json.load(sys.stdin); assert r['status'] in ('0x1',1), r; print(r['transactionHash'])"
}
# create <rpc> <chain id> <contract> <value> <constructor args...>: deploy and print the address.
create() {
  local rpc=$1 chain=$2 contract=$3 value=$4; shift 4
  local args=()
  [ $# -gt 0 ] && args=(--constructor-args "$@")
  forge create --broadcast --json --rpc-url "$rpc" --chain-id "$chain" --private-key "$PRIVATE_KEY" \
    --value "$value" "$contract" "${args[@]}" |
    python3 -c "import json,sys; print(json.load(sys.stdin)['deployedTo'])"
}
