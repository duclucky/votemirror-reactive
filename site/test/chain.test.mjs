import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLog, parseDeployment, loadState, createClients } from "../js/chain.js";
import * as abi from "../js/abi.js";
import { fakeChains } from "./fake-chain.mjs";

// Raw logs fetched from the two testnets; the expected values were decoded independently with `cast`.
const logs = JSON.parse(readFileSync(new URL("./fixtures/logs.json", import.meta.url), "utf8"));
const decoded = (chain, event) =>
  logs[chain].map((log) => decodeLog(chain, log)).find((entry) => entry?.event === event);
const PROPOSAL = "21050956219681342699067861559973482979429812992604307250648822920922857859107";

test("decodes Governor logs from Base Sepolia", () => {
  const created = decoded("base", "ProposalCreated");
  assert.equal(created.proposalId, PROPOSAL);
  assert.equal(created.proposer, "0x128c87E91c09E6165dc023A5cd5AB93b53AfC8ef");
  assert.equal(created.voteStart, 1795471269);
  assert.equal(created.voteEnd, 1795474869);
  assert.equal(created.description, "Demo proposal (skip) 2026-11-23T22:01:02Z");
  assert.equal(created.block, 62746977);
  assert.equal(created.timestamp, 1795471264);

  const vote = decoded("base", "VoteCast");
  assert.equal(vote.voter, "0x65165D1632B58DE4f095AE94BD5D957592beB52e");
  assert.equal(vote.proposalId, PROPOSAL);
  assert.equal(vote.support, 1);
  assert.equal(vote.weight, "1000000000000000000000");
  assert.equal(vote.reason, "trusted voter 2");
});

test("decodes VoteMirror logs from Base Sepolia", () => {
  const mirrored = decoded("base", "Mirrored");
  assert.equal(mirrored.support, 1);
  assert.equal(mirrored.weight, "1000000000000000000000");
  assert.equal(mirrored.tx, "0x82de1a45482c4270bdbc0f0f20ceef8975e7e5c767a6a9c7d3d4d16362490731");
  assert.deepEqual(
    (({ proposalId, support, reason }) => ({ proposalId, support, reason }))(decoded("base", "Skipped")),
    { proposalId: PROPOSAL, support: 1, reason: 1 },
  );
  assert.equal(decoded("base", "SkipSet").skipped, true);
});

test("decodes MirrorReactive logs from Reactive Lasna", () => {
  const observed = decoded("lasna", "VoteObserved");
  assert.equal(observed.proposalId, PROPOSAL);
  assert.equal(observed.voter, "0x65165D1632B58DE4f095AE94BD5D957592beB52e");
  assert.equal(observed.support, 1);
  assert.equal(observed.agreeing, 2);
  const requested = decoded("lasna", "MirrorRequested");
  assert.deepEqual([requested.proposalId, requested.support, requested.agreeing], [PROPOSAL, 1, 2]);
  assert.equal(decoded("lasna", "ThresholdSet").threshold, 2);
});

test("decodes the events added by the redeployment", () => {
  const word = (n) => BigInt(n).toString(16).padStart(64, "0");
  const retried = decodeLog("lasna", {
    address: "0xc5d993c7df3107a02943b4368794aa524e94b686",
    topics: [abi.topic("MirrorRetried(uint256,uint8,uint256)"), "0x" + word(7)],
    data: "0x" + word(1) + word(2),
    blockNumber: "0x10",
    logIndex: "0x0",
    transactionHash: "0x" + "ab".repeat(32),
  });
  assert.deepEqual([retried.event, retried.proposalId, retried.support, retried.agreeing], ["MirrorRetried", "7", 1, 2]);

  // VoteCastWithParams(voter, proposalId, support, weight, reason, params)
  const withParams = decodeLog("base", {
    address: "0x69c34b596db8cc39b68067b9d0b391d75616bc14",
    topics: [
      abi.topic("VoteCastWithParams(address,uint256,uint8,uint256,string,bytes)"),
      "0x" + "65165d1632b58de4f095ae94bd5d957592beb52e".padStart(64, "0"),
    ],
    data: "0x" + word(7) + word(0) + word(5) + word(0xa0) + word(0xe0) + word(2) + "6f6b".padEnd(64, "0") + word(0),
    blockNumber: "0x10",
    logIndex: "0x1",
    transactionHash: "0x" + "cd".repeat(32),
    blockTimestamp: "0x64",
  });
  assert.deepEqual(
    [withParams.voter, withParams.proposalId, withParams.support, withParams.weight, withParams.reason, withParams.timestamp],
    ["0x65165D1632B58DE4f095AE94BD5D957592beB52e", "7", 0, "5", "ok", 100],
  );
});

test("ignores unknown and malformed logs", () => {
  const base = { address: "0x" + "11".repeat(20), blockNumber: "0x1", logIndex: "0x0", transactionHash: "0x" + "00".repeat(32) };
  assert.equal(decodeLog("base", { ...base, topics: ["0x" + "12".repeat(32)], data: "0x" }), null);
  assert.equal(decodeLog("base", { ...base, topics: [abi.topic("Mirrored(uint256,uint8,uint256)"), "0x" + "0".repeat(64)], data: "0x" }), null);
  assert.equal(decodeLog("base", { ...base, topics: [], data: "0x" }), null);
});

test("parseDeployment checks chain ids and addresses", () => {
  const json = JSON.parse(readFileSync(new URL("../../deployments/testnet.json", import.meta.url), "utf8"));
  const deployment = parseDeployment(json);
  assert.equal(deployment.voteMirror, abi.checksum(json.voteMirror));
  assert.equal(deployment.governor, abi.checksum(json.demoGovernor));
  assert.throws(() => parseDeployment({ ...json, baseSepoliaChainId: 8453 }), /not for Base Sepolia/);
  assert.throws(() => parseDeployment({ ...json, voteMirror: "0x123" }), /voteMirror/);
});

test("loadState reads a deployment end to end and refreshes incrementally", async () => {
  const chains = fakeChains();
  const clients = createClients({ fetch: chains.fetch });
  const state = await loadState(chains.deployment, { clients });

  assert.equal(state.settings.threshold, 2);
  assert.deepEqual(state.settings.trustedVoters, chains.voters);
  assert.equal(state.settings.paused, false);
  assert.equal(state.settings.votingPower, "1000000000000000000000");
  assert.equal(state.settings.tokenSymbol, "VMD");
  // This fake is the first deployment: no rule on Base Sepolia, no pendingOwner.
  assert.equal(state.settings.mirrorThreshold, null);
  assert.equal(state.settings.mirrorTrustedVoters, null);
  assert.equal(state.settings.mirrorPendingOwner, null);
  assert.equal(state.base.complete, true);
  assert.equal(state.base.fromBlock, chains.base.deployBlock);
  assert.equal(state.lasna.fromBlock, chains.lasna.deployBlock);
  assert.deepEqual(state.base.events.map((event) => event.event), ["OwnershipTransferred", "ProposalCreated", "VoteCast", "VoteCast", "VoteCast", "Mirrored"]);
  assert.deepEqual(state.lasna.events.map((event) => event.event), ["OwnershipTransferred", "VoteObserved", "VoteObserved", "MirrorRequested"]);
  assert.ok(state.lasna.events.every((event) => event.timestamp > 0), "timestamps are filled from block headers");
  assert.deepEqual(state.proposals["7"], {
    state: 1,
    votes: { against: "0", for: "3000000000000000000000", abstain: "0" },
    mirrorHasVoted: true,
    skipFlag: false,
  });
  assert.doesNotThrow(() => JSON.stringify(state));

  // A new proposal appears; the refresh only asks for the new blocks.
  chains.base.addProposal(8);
  const before = chains.base.logQueries.length;
  const next = await loadState(chains.deployment, { clients, previous: state });
  assert.equal(next.base.events.filter((event) => event.event === "ProposalCreated").length, 2);
  assert.equal(next.base.events.length, state.base.events.length + 1);
  const refreshQueries = chains.base.logQueries.slice(before);
  assert.equal(refreshQueries.length, 1);
  assert.ok(refreshQueries[0].from > chains.base.deployBlock);
});

test("loadState starts over when the deployment addresses change", async () => {
  const chains = fakeChains();
  const clients = createClients({ fetch: chains.fetch });
  const state = await loadState(chains.deployment, { clients });
  const stale = { ...state, base: { ...state.base, signature: "0xold" } };
  const before = chains.base.logQueries.length;
  const next = await loadState(chains.deployment, { clients, previous: stale });
  assert.equal(next.base.events.length, state.base.events.length);
  assert.ok(chains.base.logQueries.slice(before).some((query) => query.from <= chains.base.deployBlock));
});

test("loadState refuses an endpoint that answers for another chain", async () => {
  const chains = fakeChains();
  chains.base.chainId = 8453;
  await assert.rejects(loadState(chains.deployment, { clients: createClients({ fetch: chains.fetch }) }), /wrong chain/);
});
