// Reads everything the status page shows from the two testnets and returns it as plain JSON.
// Nothing here writes to a chain: only eth_call, eth_getLogs, eth_getBalance and block reads.

import * as abi from "./abi.js";
import { Rpc, mapLimit } from "./rpc.js";
import { NETWORKS } from "./networks.js";

export const STATE_VERSION = 1;

const ZERO_TOPIC = "0x" + "0".repeat(64);
const REORG_MARGIN = 20;
const MAX_BACK_WINDOWS = 400;

const TOPICS = {
  ProposalCreated: abi.topic("ProposalCreated(uint256,address,address[],uint256[],string[],bytes[],uint256,uint256,string)"),
  VoteCast: abi.topic("VoteCast(address,uint256,uint8,uint256,string)"),
  VoteCastWithParams: abi.topic("VoteCastWithParams(address,uint256,uint8,uint256,string,bytes)"),
  Mirrored: abi.topic("Mirrored(uint256,uint8,uint256)"),
  Skipped: abi.topic("Skipped(uint256,uint8,uint8)"),
  PausedSet: abi.topic("PausedSet(bool)"),
  SkipSet: abi.topic("SkipSet(uint256,bool)"),
  VoteObserved: abi.topic("VoteObserved(uint256,address,uint8,uint256)"),
  MirrorRequested: abi.topic("MirrorRequested(uint256,uint8,uint256)"),
  MirrorRetried: abi.topic("MirrorRetried(uint256,uint8,uint256)"),
  ThresholdSet: abi.topic("ThresholdSet(uint256)"),
  TrustedVoterAdded: abi.topic("TrustedVoterAdded(address)"),
  TrustedVoterRemoved: abi.topic("TrustedVoterRemoved(address)"),
  OwnershipTransferred: abi.topic("OwnershipTransferred(address,address)"),
};
const TOPIC_NAMES = new Map(Object.entries(TOPICS).map(([name, hash]) => [hash, name]));

const id = (hexWord) => BigInt(hexWord).toString();

/** Event-specific fields of a raw log, or null for events the page does not show. */
function decodeArgs(name, log) {
  const { topics, data } = log;
  switch (name) {
    case "ProposalCreated":
      return {
        proposalId: abi.uint(data, 0).toString(),
        proposer: abi.address(data, 1),
        voteStart: Number(abi.uint(data, 6)),
        voteEnd: Number(abi.uint(data, 7)),
        description: abi.string(data, 8),
      };
    case "VoteCast":
    case "VoteCastWithParams":
      return {
        voter: abi.topicAddress(topics[1]),
        proposalId: abi.uint(data, 0).toString(),
        support: Number(abi.uint(data, 1)),
        weight: abi.uint(data, 2).toString(),
        reason: abi.string(data, 3),
      };
    case "Mirrored":
      return { proposalId: id(topics[1]), support: Number(abi.uint(data, 0)), weight: abi.uint(data, 1).toString() };
    case "Skipped":
      return { proposalId: id(topics[1]), support: Number(abi.uint(data, 0)), reason: Number(abi.uint(data, 1)) };
    case "PausedSet":
      return { paused: abi.bool(data, 0) };
    case "SkipSet":
      return { proposalId: id(topics[1]), skipped: abi.bool(data, 0) };
    case "VoteObserved":
      return {
        proposalId: id(topics[1]),
        voter: abi.topicAddress(topics[2]),
        support: Number(abi.uint(data, 0)),
        agreeing: Number(abi.uint(data, 1)),
      };
    case "MirrorRequested":
    case "MirrorRetried":
      return { proposalId: id(topics[1]), support: Number(abi.uint(data, 0)), agreeing: Number(abi.uint(data, 1)) };
    case "ThresholdSet":
      return { threshold: Number(abi.uint(data, 0)) };
    case "TrustedVoterAdded":
    case "TrustedVoterRemoved":
      return { voter: abi.topicAddress(topics[1]) };
    case "OwnershipTransferred":
      return { previousOwner: abi.topicAddress(topics[1]), newOwner: abi.topicAddress(topics[2]) };
    default:
      return null;
  }
}

/** Turns a raw log into `{ event, chain, contract, block, logIndex, tx, timestamp, ...args }`, or null. */
export function decodeLog(chain, log) {
  const event = TOPIC_NAMES.get(log.topics?.[0]);
  if (!event) return null;
  let args;
  try {
    args = decodeArgs(event, log);
  } catch {
    return null; // Same topic, different layout: not one of ours.
  }
  if (!args) return null;
  return {
    event,
    chain,
    contract: abi.checksum(log.address),
    block: Number(BigInt(log.blockNumber)),
    logIndex: Number(BigInt(log.logIndex)),
    tx: log.transactionHash,
    timestamp: log.blockTimestamp ? Number(BigInt(log.blockTimestamp)) : 0,
    ...args,
  };
}

const isGenesis = (log, contract) =>
  abi.sameAddress(log.address, contract) &&
  log.topics[0] === TOPICS.OwnershipTransferred &&
  log.topics[1] === ZERO_TOPIC;

/**
 * Collects the logs of `addresses` from the block `contract` was deployed in up to `latest`.
 * The deployment block is found by walking back from `anchorBlock` (a block known to be at or after the
 * deployment; `latest` when unknown) until the constructor's OwnershipTransferred log shows up.
 */
async function collectLogs(rpc, { addresses, contract, anchorBlock, latest, onProgress }) {
  const window = rpc.logRange;
  const upper = Math.min(anchorBlock ?? latest, latest);
  let logs = [];
  let fromBlock = null;
  let hi = upper;
  for (let done = 0; done < MAX_BACK_WINDOWS && hi >= 0 && fromBlock === null; ) {
    const ranges = [];
    for (let i = 0; i < 4 && hi >= 0 && done + ranges.length < MAX_BACK_WINDOWS; i++) {
      const lo = Math.max(0, hi - window + 1);
      ranges.push([lo, hi]);
      hi = lo - 1;
    }
    const chunks = await Promise.all(
      ranges.map(([lo, to]) => rpc.getLogs({ address: addresses, fromBlock: lo, toBlock: to })),
    );
    done += ranges.length;
    for (const chunk of chunks) {
      if (fromBlock !== null) break;
      logs = [...chunk, ...logs];
      const genesis = chunk.find((log) => isGenesis(log, contract));
      if (genesis) fromBlock = Number(BigInt(genesis.blockNumber));
    }
    onProgress?.();
  }
  const complete = fromBlock !== null;
  if (!complete) fromBlock = Math.max(0, hi + 1);
  if (upper < latest) {
    const starts = [];
    for (let start = upper + 1; start <= latest; start += window) starts.push(start);
    const chunks = await mapLimit(starts, 6, async (start) => {
      const chunk = await rpc.getLogs({
        address: addresses,
        fromBlock: start,
        toBlock: Math.min(latest, start + window - 1),
      });
      onProgress?.();
      return chunk;
    });
    logs = logs.concat(...chunks);
  }
  return { fromBlock, complete, logs: logs.filter((log) => Number(BigInt(log.blockNumber)) >= fromBlock) };
}

const eventKey = (event) => `${event.tx}:${event.logIndex}`;

function mergeEvents(previous, fresh, fromBlock) {
  // Events at or after `fromBlock` are replaced by what the chain says now, so a reorg cannot leave a stale one.
  const merged = new Map(previous.filter((event) => event.block < fromBlock).map((event) => [eventKey(event), event]));
  for (const event of fresh) merged.set(eventKey(event), event);
  return [...merged.values()].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
}

async function fillTimestamps(rpc, events) {
  const missing = [...new Set(events.filter((event) => !event.timestamp).map((event) => event.block))];
  if (!missing.length) return;
  const replies = await rpc.batch(
    missing.map((block) => ({ method: "eth_getBlockByNumber", params: ["0x" + block.toString(16), false] })),
  );
  const timestamps = new Map();
  replies.forEach((reply, i) => {
    if (reply.ok && reply.result?.timestamp) timestamps.set(missing[i], Number(BigInt(reply.result.timestamp)));
  });
  for (const event of events) if (!event.timestamp) event.timestamp = timestamps.get(event.block) ?? 0;
}

async function anchorBlock(rpc, txHash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash ?? "")) return null;
  try {
    const receipt = await rpc.request("eth_getTransactionReceipt", [txHash]);
    return receipt?.blockNumber ? Number(BigInt(receipt.blockNumber)) : null;
  } catch {
    return null;
  }
}

/** Scans one chain, reusing the events of `previous` when it covers the same contracts. */
async function scanChain(rpc, { addresses, contract, anchorTx, previous, onProgress }) {
  const latestBlock = await rpc.request("eth_getBlockByNumber", ["latest", false]);
  const latest = Number(BigInt(latestBlock.number));
  const head = { block: latest, timestamp: Number(BigInt(latestBlock.timestamp)) };
  const signature = addresses.map((address) => address.toLowerCase()).join(",");

  if (previous?.signature === signature && previous.scannedTo <= latest) {
    const fromBlock = Math.max(previous.fromBlock, previous.scannedTo - REORG_MARGIN + 1);
    const raw = await rpc.getLogs({ address: addresses, fromBlock, toBlock: latest });
    const fresh = raw.map((log) => decodeLog(rpc.key, log)).filter(Boolean);
    await fillTimestamps(rpc, fresh);
    return { ...previous, head, scannedTo: latest, events: mergeEvents(previous.events, fresh, fromBlock) };
  }

  const anchor = await anchorBlock(rpc, anchorTx);
  const { fromBlock, complete, logs } = await collectLogs(rpc, {
    addresses,
    contract,
    anchorBlock: anchor,
    latest,
    onProgress,
  });
  const events = logs.map((log) => decodeLog(rpc.key, log)).filter(Boolean);
  await fillTimestamps(rpc, events);
  return { signature, head, fromBlock, complete, scannedTo: latest, events: mergeEvents([], events, 0) };
}

/** Runs named eth_calls / reads in one batch: `{ name: { ok, result } }`. */
async function readAll(rpc, reads) {
  const names = Object.keys(reads);
  const replies = await rpc.batch(names.map((name) => reads[name]));
  return Object.fromEntries(names.map((name, i) => [name, replies[i]]));
}

const ethCall = (to, signature, args) => ({
  method: "eth_call",
  params: [{ to, data: abi.encodeCall(signature, args) }, "latest"],
});

function required(read, decode, what) {
  if (!read?.ok) throw new Error(`Could not read ${what}: ${read?.error?.message ?? "no reply"}`);
  return decode(read.result);
}
const optional = (read, decode) => {
  try {
    return read?.ok && read.result && read.result !== "0x" ? decode(read.result) : null;
  } catch {
    return null;
  }
};

export function createClients(options = {}) {
  const make = (network) => {
    const rpc = new Rpc({ name: network.name, endpoints: network.endpoints, ...options });
    rpc.key = network.key;
    return rpc;
  };
  return { base: make(NETWORKS.base), lasna: make(NETWORKS.lasna) };
}

/** Checks the deployment file and returns the addresses the page needs, checksummed. */
export function parseDeployment(json) {
  const need = (key) => {
    const value = json?.[key];
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
      throw new Error(`deployments/testnet.json has no valid "${key}" address`);
    }
    return abi.checksum(value);
  };
  if (json.baseSepoliaChainId !== NETWORKS.base.chainId || json.lasnaChainId !== NETWORKS.lasna.chainId) {
    throw new Error("deployments/testnet.json is not for Base Sepolia and Reactive Lasna");
  }
  return {
    mirrorReactive: need("mirrorReactive"),
    voteMirror: need("voteMirror"),
    governor: need("demoGovernor"),
    token: need("demoToken"),
    callbackProxy: need("callbackProxy"),
    setMirrorTx: json.setMirrorTx ?? null,
    delegateTx: json.delegateTx ?? null,
  };
}

/**
 * Loads the full page state. Pass the previous state to only fetch what changed since.
 * @returns plain JSON (big numbers as decimal strings), safe to store as a snapshot.
 */
export async function loadState(deploymentJson, { clients = createClients(), previous = null, onProgress } = {}) {
  const deployment = parseDeployment(deploymentJson);
  const { base, lasna } = clients;
  const reuse = previous?.version === STATE_VERSION ? previous : null;

  const [chainIds, baseScan, lasnaScan] = await Promise.all([
    Promise.all([base.request("eth_chainId"), lasna.request("eth_chainId")]),
    scanChain(base, {
      addresses: [deployment.governor, deployment.voteMirror],
      contract: deployment.voteMirror,
      anchorTx: deployment.delegateTx,
      previous: reuse?.base,
      onProgress,
    }),
    scanChain(lasna, {
      addresses: [deployment.mirrorReactive],
      contract: deployment.mirrorReactive,
      anchorTx: deployment.setMirrorTx,
      previous: reuse?.lasna,
      onProgress,
    }),
  ]);
  if (Number(BigInt(chainIds[0])) !== NETWORKS.base.chainId || Number(BigInt(chainIds[1])) !== NETWORKS.lasna.chainId) {
    throw new Error("An RPC endpoint answered for the wrong chain");
  }

  const reactive = deployment.mirrorReactive;
  const mirror = deployment.voteMirror;
  const governor = deployment.governor;
  const token = deployment.token;
  const proposalIds = baseScan.events.filter((event) => event.event === "ProposalCreated").map((event) => event.proposalId);

  const proposalReads = {};
  for (const proposalId of proposalIds) {
    proposalReads[`state:${proposalId}`] = ethCall(governor, "state(uint256)", [proposalId]);
    proposalReads[`votes:${proposalId}`] = ethCall(governor, "proposalVotes(uint256)", [proposalId]);
    proposalReads[`voted:${proposalId}`] = ethCall(governor, "hasVoted(uint256,address)", [proposalId, mirror]);
    proposalReads[`skipped:${proposalId}`] = ethCall(mirror, "skipped(uint256)", [proposalId]);
  }

  const [onLasna, onBase] = await Promise.all([
    readAll(lasna, {
      threshold: ethCall(reactive, "threshold()"),
      trustedVoters: ethCall(reactive, "trustedVoters()"),
      mirror: ethCall(reactive, "mirror()"),
      governor: ethCall(reactive, "GOVERNOR()"),
      owner: ethCall(reactive, "owner()"),
      pendingOwner: ethCall(reactive, "pendingOwner()"),
      balance: { method: "eth_getBalance", params: [reactive, "latest"] },
    }),
    readAll(base, {
      paused: ethCall(mirror, "paused()"),
      mirrorGovernor: ethCall(mirror, "GOVERNOR()"),
      owner: ethCall(mirror, "owner()"),
      pendingOwner: ethCall(mirror, "pendingOwner()"),
      // The redeployed VoteMirror keeps its own copy of the rule; the first deployment has no such views.
      threshold: ethCall(mirror, "threshold()"),
      trustedVoters: ethCall(mirror, "trustedVoters()"),
      balance: { method: "eth_getBalance", params: [mirror, "latest"] },
      governorName: ethCall(governor, "name()"),
      votingPower: ethCall(token, "getVotes(address)", [mirror]),
      tokenSymbol: ethCall(token, "symbol()"),
      tokenDecimals: ethCall(token, "decimals()"),
      ...proposalReads,
    }),
  ]);

  const address0 = (data) => abi.address(data, 0);
  const number0 = (data) => Number(abi.uint(data, 0));
  const big0 = (data) => abi.uint(data, 0).toString();
  const nonZero = (address) => (address && !/^0x0{40}$/.test(address) ? address : null);

  const proposals = {};
  for (const proposalId of proposalIds) {
    const votes = optional(onBase[`votes:${proposalId}`], (data) => ({
      against: abi.uint(data, 0).toString(),
      for: abi.uint(data, 1).toString(),
      abstain: abi.uint(data, 2).toString(),
    }));
    proposals[proposalId] = {
      state: optional(onBase[`state:${proposalId}`], number0),
      votes,
      mirrorHasVoted: optional(onBase[`voted:${proposalId}`], (data) => abi.bool(data, 0)),
      skipFlag: optional(onBase[`skipped:${proposalId}`], (data) => abi.bool(data, 0)),
    };
  }

  return {
    version: STATE_VERSION,
    fetchedAt: Date.now(),
    deployment,
    settings: {
      threshold: required(onLasna.threshold, number0, "the threshold"),
      trustedVoters: required(onLasna.trustedVoters, (data) => abi.addressArray(data, 0), "the trusted voters"),
      mirror: required(onLasna.mirror, address0, "the mirror address"),
      watchedGovernor: optional(onLasna.governor, address0),
      reactiveOwner: optional(onLasna.owner, address0),
      reactivePendingOwner: nonZero(optional(onLasna.pendingOwner, address0)),
      reactiveBalance: optional(onLasna.balance, (data) => BigInt(data).toString()),
      paused: required(onBase.paused, (data) => abi.bool(data, 0), "the paused flag"),
      mirrorGovernor: optional(onBase.mirrorGovernor, address0),
      mirrorOwner: optional(onBase.owner, address0),
      mirrorPendingOwner: nonZero(optional(onBase.pendingOwner, address0)),
      mirrorThreshold: optional(onBase.threshold, number0),
      mirrorTrustedVoters: optional(onBase.trustedVoters, (data) => abi.addressArray(data, 0)),
      mirrorBalance: optional(onBase.balance, (data) => BigInt(data).toString()),
      governorName: optional(onBase.governorName, (data) => abi.string(data, 0)),
      votingPower: optional(onBase.votingPower, big0),
      tokenSymbol: optional(onBase.tokenSymbol, (data) => abi.string(data, 0)),
      tokenDecimals: optional(onBase.tokenDecimals, number0) ?? 18,
    },
    proposals,
    base: baseScan,
    lasna: lasnaScan,
  };
}
