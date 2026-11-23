#!/usr/bin/env bash
# Deploys the whole VoteMirror demo: token + governor + VoteMirror on Base Sepolia, MirrorReactive on Lasna.
# Order matters: reactive first, then the callback contract with the reactive address, then wire it back.
. "$(dirname "$0")/lib.sh"

THRESHOLD="${THRESHOLD:-2}"
VOTING_DELAY="${VOTING_DELAY:-5}"          # seconds
VOTING_PERIOD="${VOTING_PERIOD:-3600}"     # seconds
REACTIVE_FUNDING="${REACTIVE_FUNDING:-5ether}"    # lREACT for react() fees
MIRROR_FUNDING="${MIRROR_FUNDING:-0.02ether}"     # ETH for callback fees
VOTER_GAS="${VOTER_GAS:-0.002ether}"

echo "owner $OWNER, trusted voters ${VOTERS[*]}, threshold $THRESHOLD"
forge build >/dev/null

echo "1/6 DemoToken and DemoGovernor on Base Sepolia"
TOKEN=$(create "$BASE_SEPOLIA_RPC" $BASE_CHAIN_ID src/demo/DemoToken.sol:DemoToken 0)
GOVERNOR=$(create "$BASE_SEPOLIA_RPC" $BASE_CHAIN_ID src/demo/DemoGovernor.sol:DemoGovernor 0 "$TOKEN" "$VOTING_DELAY" "$VOTING_PERIOD")

echo "2/6 MirrorReactive on Lasna"
TRUSTED="[$(IFS=,; echo "${VOTERS[*]}")]"
REACTIVE=$(create "$LASNA_RPC" $LASNA_CHAIN_ID src/MirrorReactive.sol:MirrorReactive "$REACTIVE_FUNDING" $BASE_CHAIN_ID "$GOVERNOR" "$TRUSTED" "$THRESHOLD")

echo "3/6 VoteMirror on Base Sepolia"
MIRROR=$(create "$BASE_SEPOLIA_RPC" $BASE_CHAIN_ID src/VoteMirror.sol:VoteMirror "$MIRROR_FUNDING" "$CALLBACK_PROXY" "$REACTIVE" "$GOVERNOR" "$OWNER")

echo "4/6 point MirrorReactive at VoteMirror"
SET_MIRROR_TX=$(send "$LASNA_RPC" "$PRIVATE_KEY" "$REACTIVE" "setMirror(address)" "$MIRROR")

echo "5/6 owner gets demo tokens and delegates voting power to VoteMirror"
send "$BASE_SEPOLIA_RPC" "$PRIVATE_KEY" "$TOKEN" "faucet(address)" "$OWNER" >/dev/null
DELEGATE_TX=$(send "$BASE_SEPOLIA_RPC" "$PRIVATE_KEY" "$TOKEN" "delegate(address)" "$MIRROR")

echo "6/6 trusted voters get gas, demo tokens, and delegate to themselves"
for i in "${!VOTERS[@]}"; do
  send "$BASE_SEPOLIA_RPC" "$PRIVATE_KEY" "${VOTERS[$i]}" --value "$VOTER_GAS" >/dev/null
  send "$BASE_SEPOLIA_RPC" "$PRIVATE_KEY" "$TOKEN" "faucet(address)" "${VOTERS[$i]}" >/dev/null
  send "$BASE_SEPOLIA_RPC" "${VOTER_KEY_LIST[$i]}" "$TOKEN" "delegate(address)" "${VOTERS[$i]}" >/dev/null
done

mkdir -p deployments
python3 - "$DEPLOYMENT" <<PY
import json, sys
json.dump({
    "baseSepoliaChainId": $BASE_CHAIN_ID, "lasnaChainId": $LASNA_CHAIN_ID,
    "callbackProxy": "$CALLBACK_PROXY", "owner": "$OWNER",
    "trustedVoters": "${VOTERS[*]}".split(), "threshold": $THRESHOLD,
    "demoToken": "$TOKEN", "demoGovernor": "$GOVERNOR",
    "mirrorReactive": "$REACTIVE", "voteMirror": "$MIRROR",
    "setMirrorTx": "$SET_MIRROR_TX", "delegateTx": "$DELEGATE_TX",
}, open(sys.argv[1], "w"), indent=2)
PY
cat "$DEPLOYMENT"
