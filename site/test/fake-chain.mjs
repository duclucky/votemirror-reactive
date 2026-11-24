// A tiny in-memory stand-in for the two testnets' JSON-RPC endpoints, for tests.

import * as abi from "../js/abi.js";
import { NETWORKS } from "../js/networks.js";

const word = (n) => BigInt(n).toString(16).padStart(64, "0");
const addressWord = (address) => address.slice(2).toLowerCase().padStart(64, "0");
const hex = (n) => "0x" + BigInt(n).toString(16);
const encodeString = (text) => {
  const bytes = Buffer.from(text, "utf8");
  return word(bytes.length) + bytes.toString("hex").padEnd(Math.ceil(bytes.length / 32) * 64 || 64, "0");
};

const A = (n) => abi.checksum("0x" + n.toString(16).padStart(40, "0"));
const VOTES = 1000n * 10n ** 18n;

class FakeChain {
  constructor(chainId, head, deployBlock) {
    this.chainId = chainId;
    this.head = head;
    this.deployBlock = deployBlock;
    this.logs = [];
    this.calls = new Map();
    this.receipts = new Map();
    this.logQueries = [];
    this.maxRange = 50_000;
  }

  timestamp(block) {
    return 1_700_000_000 + block * 2;
  }

  emit(block, address, signature, topics, data, { withTimestamp = false } = {}) {
    const log = {
      address: address.toLowerCase(),
      topics: [abi.topic(signature), ...topics],
      data: "0x" + data,
      blockNumber: hex(block),
      logIndex: hex(this.logs.filter((other) => other.blockNumber === hex(block)).length),
      transactionHash: "0x" + word(this.chainId * 1_000_000 + this.logs.length + 1),
      removed: false,
    };
    if (withTimestamp) log.blockTimestamp = hex(this.timestamp(block));
    this.logs.push(log);
    return log;
  }

  onCall(to, signature, args, result) {
    this.calls.set(`${to.toLowerCase()}:${abi.encodeCall(signature, args)}`, result);
  }

  handle({ method, params }) {
    switch (method) {
      case "eth_chainId":
        return { result: hex(this.chainId) };
      case "eth_blockNumber":
        return { result: hex(this.head) };
      case "eth_getBlockByNumber": {
        const block = params[0] === "latest" ? this.head : Number(BigInt(params[0]));
        return { result: { number: hex(block), timestamp: hex(this.timestamp(block)) } };
      }
      case "eth_getBalance":
        return { result: hex(5n * 10n ** 17n) };
      case "eth_getTransactionReceipt":
        return { result: this.receipts.get(params[0]) ?? null };
      case "eth_getLogs": {
        const [{ address, fromBlock, toBlock }] = params;
        const from = Number(BigInt(fromBlock));
        const to = Number(BigInt(toBlock));
        this.logQueries.push({ from, to });
        if (to - from + 1 > this.maxRange) return { error: { code: -32000, message: "block range too large" } };
        const addresses = [address].flat().map((entry) => entry.toLowerCase());
        return {
          result: this.logs.filter((log) => {
            const block = Number(BigInt(log.blockNumber));
            return block >= from && block <= to && addresses.includes(log.address);
          }),
        };
      }
      case "eth_call": {
        const [{ to, data }] = params;
        const result = this.calls.get(`${to.toLowerCase()}:${data}`);
        return result === undefined ? { error: { code: 3, message: "execution reverted" } } : { result: "0x" + result };
      }
      default:
        return { error: { code: -32601, message: `method ${method} not found` } };
    }
  }
}

/** One deployment with one proposal (id 7) that two trusted voters voted For and VoteMirror mirrored. */
export function fakeChains() {
  const [reactive, mirror, governor, token, proxy, owner] = [1, 2, 3, 4, 5, 6].map((n) => A(0xa000 + n));
  const voters = [A(0xb001), A(0xb002), A(0xb003)];
  const base = new FakeChain(NETWORKS.base.chainId, 1_000_000, 900_000);
  const lasna = new FakeChain(NETWORKS.lasna.chainId, 500_000, 470_000);
  const delegateTx = "0x" + "de".repeat(32);
  const setMirrorTx = "0x" + "5e".repeat(32);
  base.receipts.set(delegateTx, { blockNumber: hex(900_010) });
  lasna.receipts.set(setMirrorTx, { blockNumber: hex(470_005) });

  const stamp = { withTimestamp: true };
  const ownership = "OwnershipTransferred(address,address)";
  base.emit(900_000, mirror, ownership, ["0x" + word(0), "0x" + addressWord(owner)], "", stamp);
  lasna.emit(470_000, reactive, ownership, ["0x" + word(0), "0x" + addressWord(owner)], "");

  const proposalData = (proposalId, description) =>
    word(proposalId) + addressWord(owner) + word(0x120) + word(0x140) + word(0x160) + word(0x180) + word(1_700_000_100) + word(1_700_003_700) + word(0x1a0) +
    word(0) + word(0) + word(0) + word(0) + encodeString(description);
  const created = "ProposalCreated(uint256,address,address[],uint256[],string[],bytes[],uint256,uint256,string)";
  base.addProposal = (proposalId) => {
    base.head += 100;
    base.emit(base.head - 50, governor, created, [], proposalData(proposalId, `Proposal ${proposalId}`), stamp);
    base.onCall(governor, "state(uint256)", [proposalId], word(1));
    base.onCall(governor, "proposalVotes(uint256)", [proposalId], word(0) + word(0) + word(0));
    base.onCall(governor, "hasVoted(uint256,address)", [proposalId, mirror], word(0));
    base.onCall(mirror, "skipped(uint256)", [proposalId], word(0));
  };

  base.emit(950_000, governor, created, [], proposalData(7, "# Fund the grants round\nDetails"), stamp);
  const voteCast = "VoteCast(address,uint256,uint8,uint256,string)";
  const voteData = (reason) => word(7) + word(1) + word(VOTES) + word(0x80) + encodeString(reason);
  base.emit(950_010, governor, voteCast, ["0x" + addressWord(voters[0])], voteData("one"), stamp);
  base.emit(950_011, governor, voteCast, ["0x" + addressWord(voters[1])], voteData("two"), stamp);
  base.emit(950_013, governor, voteCast, ["0x" + addressWord(mirror)], voteData("mirrored"), stamp);
  // Same transaction as the mirrored vote.
  const mirroredLog = base.emit(950_013, mirror, "Mirrored(uint256,uint8,uint256)", ["0x" + word(7)], word(1) + word(VOTES), stamp);
  mirroredLog.transactionHash = base.logs.at(-2).transactionHash;

  const observed = "VoteObserved(uint256,address,uint8,uint256)";
  lasna.emit(480_000, reactive, observed, ["0x" + word(7), "0x" + addressWord(voters[0])], word(1) + word(1));
  lasna.emit(480_002, reactive, observed, ["0x" + word(7), "0x" + addressWord(voters[1])], word(1) + word(2));
  const requested = lasna.emit(480_002, reactive, "MirrorRequested(uint256,uint8,uint256)", ["0x" + word(7)], word(1) + word(2));
  requested.transactionHash = lasna.logs.at(-2).transactionHash;

  lasna.onCall(reactive, "threshold()", [], word(2));
  lasna.onCall(reactive, "trustedVoters()", [], word(0x20) + word(3) + voters.map(addressWord).join(""));
  lasna.onCall(reactive, "mirror()", [], addressWord(mirror));
  lasna.onCall(reactive, "GOVERNOR()", [], addressWord(governor));
  lasna.onCall(reactive, "owner()", [], addressWord(owner));
  base.onCall(mirror, "paused()", [], word(0));
  base.onCall(mirror, "GOVERNOR()", [], addressWord(governor));
  base.onCall(mirror, "owner()", [], addressWord(owner));
  base.onCall(governor, "name()", [], word(0x20) + encodeString("Demo Governor"));
  base.onCall(token, "getVotes(address)", [mirror], word(VOTES));
  base.onCall(token, "symbol()", [], word(0x20) + encodeString("VMD"));
  base.onCall(token, "decimals()", [], word(18));
  base.onCall(governor, "state(uint256)", [7], word(1));
  base.onCall(governor, "proposalVotes(uint256)", [7], word(0) + word(3n * VOTES) + word(0));
  base.onCall(governor, "hasVoted(uint256,address)", [7, mirror], word(1));
  base.onCall(mirror, "skipped(uint256)", [7], word(0));

  const byHost = new Map();
  for (const endpoint of NETWORKS.base.endpoints) byHost.set(new URL(endpoint.url).host, base);
  for (const endpoint of NETWORKS.lasna.endpoints) byHost.set(new URL(endpoint.url).host, lasna);

  const fetch = async (url, { body }) => {
    const chain = byHost.get(new URL(url).host);
    const request = JSON.parse(body);
    const answer = (call) => ({ jsonrpc: "2.0", id: call.id, ...chain.handle(call) });
    const reply = Array.isArray(request) ? request.map(answer) : answer(request);
    return { status: 200, text: async () => JSON.stringify(reply) };
  };

  return {
    base,
    lasna,
    voters,
    fetch,
    deployment: {
      baseSepoliaChainId: NETWORKS.base.chainId,
      lasnaChainId: NETWORKS.lasna.chainId,
      mirrorReactive: reactive,
      voteMirror: mirror,
      demoGovernor: governor,
      demoToken: token,
      callbackProxy: proxy,
      setMirrorTx,
      delegateTx,
    },
  };
}
