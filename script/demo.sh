#!/usr/bin/env bash
# Runs one demo loop and prints every transaction hash:
#   ./script/demo.sh for      two trusted voters vote For     -> VoteMirror votes For
#   ./script/demo.sh against  two trusted voters vote Against -> VoteMirror votes Against
#   ./script/demo.sh skip     the owner skips the proposal    -> VoteMirror emits Skipped, no vote
. "$(dirname "$0")/lib.sh"

MODE="${1:?usage: demo.sh for|against|skip}"
case "$MODE" in for | skip) SUPPORT=1 ;; against) SUPPORT=0 ;; *) echo "unknown mode $MODE" >&2; exit 1 ;; esac
WAIT_SECONDS="${WAIT_SECONDS:-180}"

TOKEN=$(json "$DEPLOYMENT" demoToken)
GOVERNOR=$(json "$DEPLOYMENT" demoGovernor)
REACTIVE=$(json "$DEPLOYMENT" mirrorReactive)
MIRROR=$(json "$DEPLOYMENT" voteMirror)
# Read from the contract: the owner may have changed the threshold or the trusted list since deployment.
THRESHOLD=$(cast call "$REACTIVE" "threshold()(uint256)" --rpc-url "$LASNA_RPC" | cut -d' ' -f1)
TRUSTED_KEYS=() TRUSTED_VOTERS=()
for i in "${!VOTERS[@]}"; do
  [ "$(cast call "$REACTIVE" "isTrusted(address)(bool)" "${VOTERS[$i]}" --rpc-url "$LASNA_RPC")" = true ] || continue
  TRUSTED_KEYS+=("${VOTER_KEY_LIST[$i]}") TRUSTED_VOTERS+=("${VOTERS[$i]}")
done
[ "$THRESHOLD" -le "${#TRUSTED_KEYS[@]}" ] || { echo "threshold is $THRESHOLD but VOTER_KEYS has ${#TRUSTED_KEYS[@]} trusted voters" >&2; exit 1; }

# Both payers must be funded and free of debt, otherwise the network silently stops serving them.
REACTIVE_DEBT=$(cast call "$SYSTEM_CONTRACT" "debt(address)(uint256)" "$REACTIVE" --rpc-url "$LASNA_RPC" | cut -d' ' -f1)
MIRROR_DEBT=$(cast call "$CALLBACK_PROXY" "debt(address)(uint256)" "$MIRROR" --rpc-url "$BASE_SEPOLIA_RPC" | cut -d' ' -f1)
echo "MirrorReactive: $(cast balance "$REACTIVE" --ether --rpc-url "$LASNA_RPC") lREACT, debt $REACTIVE_DEBT"
echo "VoteMirror:     $(cast balance "$MIRROR" --ether --rpc-url "$BASE_SEPOLIA_RPC") ETH, debt $MIRROR_DEBT"
[ "$REACTIVE_DEBT" = 0 ] && [ "$MIRROR_DEBT" = 0 ] || { echo "settle the debt first (coverDebt())" >&2; exit 1; }

DESCRIPTION="Demo proposal ($MODE) $(date -u +%Y-%m-%dT%H:%M:%SZ)"
CALLDATA=$(cast calldata "faucet(address)" "$GOVERNOR")
DESCRIPTION_HASH=$(cast keccak "$DESCRIPTION")
PROPOSAL_ID=$(cast call "$GOVERNOR" "hashProposal(address[],uint256[],bytes[],bytes32)(uint256)" \
  "[$TOKEN]" "[0]" "[$CALLDATA]" "$DESCRIPTION_HASH" --rpc-url "$BASE_SEPOLIA_RPC" | cut -d' ' -f1)
LASNA_FROM=$(cast block-number --rpc-url "$LASNA_RPC")
BASE_FROM=$(cast block-number --rpc-url "$BASE_SEPOLIA_RPC")

echo "proposal:       $PROPOSAL_ID"
# Assigned before printing so that a failed transaction stops the script instead of being hidden by echo.
PROPOSE_TX=$(send "$BASE_SEPOLIA_RPC" "$PRIVATE_KEY" "$GOVERNOR" "propose(address[],uint256[],bytes[],string)" "[$TOKEN]" "[0]" "[$CALLDATA]" "$DESCRIPTION")
echo "propose tx:     $PROPOSE_TX"
if [ "$MODE" = skip ]; then
  SKIP_TX=$(send "$BASE_SEPOLIA_RPC" "$PRIVATE_KEY" "$MIRROR" "setSkipped(uint256,bool)" "$PROPOSAL_ID" true)
  echo "skip tx:        $SKIP_TX"
fi

# ProposalState.Active is 1.
until [ "$(cast call "$GOVERNOR" "state(uint256)(uint8)" "$PROPOSAL_ID" --rpc-url "$BASE_SEPOLIA_RPC")" = 1 ]; do sleep 2; done

STARTED=$(date +%s)
for i in $(seq 0 $((THRESHOLD - 1))); do
  LAST_VOTE_TX=$(send "$BASE_SEPOLIA_RPC" "${TRUSTED_KEYS[$i]}" "$GOVERNOR" "castVoteWithReason(uint256,uint8,string)" "$PROPOSAL_ID" "$SUPPORT" "trusted voter $((i + 1))")
  echo "VoteCast tx $((i + 1)):  $LAST_VOTE_TX  (${TRUSTED_VOTERS[$i]})"
done

# scan <rpc> <from block> <address> <topic1> <event signatures...>: print "tx hash, block, event" of the first matching
# log, looking in windows small enough for public RPCs.
scan() {
  local rpc=$1 from=$2 address=$3 topic=$4; shift 4
  local latest to event hit
  latest=$(cast block-number --rpc-url "$rpc")
  while [ "$from" -le "$latest" ]; do
    to=$((from + 199 < latest ? from + 199 : latest))
    for event in "$@"; do
      hit=$(cast logs --rpc-url "$rpc" --from-block "$from" --to-block "$to" --address "$address" --json "$event" "$topic" |
        python3 -c "import json,sys; l=json.load(sys.stdin); print(l[0]['transactionHash'], int(l[0]['blockNumber'], 16)) if l else None")
      [ -n "$hit" ] && { echo "$hit ${event%%(*}"; return; }
    done
    from=$((to + 1))
  done
}
timestamp() { cast block "$2" --rpc-url "$1" -f timestamp; }
TOPIC_ID=$(cast to-uint256 "$PROPOSAL_ID")
REACT="" CALLBACK=""
while [ $(($(date +%s) - STARTED)) -lt "$WAIT_SECONDS" ]; do
  [ -n "$REACT" ] || REACT=$(scan "$LASNA_RPC" "$LASNA_FROM" "$REACTIVE" "$TOPIC_ID" "MirrorRequested(uint256 indexed,uint8,uint256)")
  [ -n "$CALLBACK" ] || CALLBACK=$(scan "$BASE_SEPOLIA_RPC" "$BASE_FROM" "$MIRROR" "$TOPIC_ID" "Mirrored(uint256 indexed,uint8,uint256)" "Skipped(uint256 indexed,uint8,uint8)")
  [ -n "$REACT" ] && [ -n "$CALLBACK" ] && break
  sleep 3
done
read -r REACT_TX _ _ <<<"$REACT"
read -r CALLBACK_TX CALLBACK_BLOCK RESULT <<<"$CALLBACK"

echo "react() tx:     ${REACT_TX:-not seen within ${WAIT_SECONDS}s} (Lasna, MirrorRequested)"
if [ -n "$CALLBACK_TX" ]; then
  LAST_VOTE_BLOCK=$(cast receipt "$LAST_VOTE_TX" blockNumber --rpc-url "$BASE_SEPOLIA_RPC")
  DELAY=$(($(timestamp "$BASE_SEPOLIA_RPC" "$CALLBACK_BLOCK") - $(timestamp "$BASE_SEPOLIA_RPC" "$LAST_VOTE_BLOCK")))
  echo "callback tx:    $CALLBACK_TX (Base Sepolia, $RESULT, ${DELAY}s after the last trusted vote)"
else
  echo "callback tx:    not delivered within ${WAIT_SECONDS}s"
fi
echo "VoteMirror voted: $(cast call "$GOVERNOR" "hasVoted(uint256,address)(bool)" "$PROPOSAL_ID" "$MIRROR" --rpc-url "$BASE_SEPOLIA_RPC")"
echo "votes (against, for, abstain): $(cast call "$GOVERNOR" "proposalVotes(uint256)(uint256,uint256,uint256)" "$PROPOSAL_ID" --rpc-url "$BASE_SEPOLIA_RPC" | tr '\n' ' ')"
[ -n "$CALLBACK_TX" ]
