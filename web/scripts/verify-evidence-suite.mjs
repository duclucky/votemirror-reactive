// Independent, read-only chain verification for the submission evidence suite.
// Run from web/: node scripts/verify-evidence-suite.mjs <run-id>
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  createPublicClient,
  http,
  fallback,
  parseAbi,
  parseAbiParameters,
  decodeEventLog,
  decodeFunctionData,
  decodeAbiParameters,
  encodeAbiParameters,
  toHex,
} from 'viem';

const runId = process.argv[2];
if (!runId || !/^[a-zA-Z0-9-]+$/.test(runId))
  throw new Error('Supply a safe run ID.');
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) =>
  JSON.parse(readFileSync(resolve(root, path), 'utf8').replace(/^\uFEFF/, ''));
const d = read('deployments/hardened-testnet-v4.json');
const suite = read(`deployments/evidence-suite-${runId}.json`);
assert.ok(
  [
    'executed-awaiting-independent-verification',
    'independently-verified',
  ].includes(suite.status),
);
assert.ok(
  suite.initialTaskRunning === false ||
    suite.recoverySenderStoppedForProof === true,
);
const SYSTEM = '0x8888888888888888888888888888888888888888';
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();
const rpc = (urls) =>
  createPublicClient({
    transport: fallback(
      urls.map((url) =>
        http(url, { timeout: 15_000, retryCount: 2, batch: true }),
      ),
    ),
  });
const base = rpc([
  'https://sepolia.base.org',
  'https://base-sepolia-rpc.publicnode.com',
]);
const lasna = rpc(['https://lasna-rpc.rnk.dev/']);
assert.equal(await base.getChainId(), 84532);
assert.equal(await lasna.getChainId(), 5318007);

const governorAbi = parseAbi([
  'event ProposalCreated(uint256 proposalId,address proposer,address[] targets,uint256[] values,string[] signatures,bytes[] calldatas,uint256 voteStart,uint256 voteEnd,string description)',
  'event VoteCast(address indexed voter,uint256 proposalId,uint8 support,uint256 weight,string reason)',
  'function hasVoted(uint256,address) view returns (bool)',
  'function proposalVotes(uint256) view returns (uint256,uint256,uint256)',
]);
const mirrorAbi = parseAbi([
  'function castMirrored(address,uint256,uint8,bytes32)',
  'event Mirrored(uint256 indexed proposalId,uint8 support,uint256 weight)',
  'event Skipped(uint256 indexed proposalId,uint8 support,uint8 reason)',
  'function confirmedSupport(uint256) view returns (bool,uint8)',
  'function paused() view returns (bool)',
  'function policyHash() view returns (bytes32)',
]);
const reactiveAbi = parseAbi([
  'event VoteObserved(uint256 indexed proposalId,address indexed voter,uint8 support,uint256 agreeing)',
  'event MirrorRequested(uint256 indexed proposalId,uint8 support,uint256 agreeing)',
  'event MirrorRetried(uint256 indexed proposalId,uint8 support,uint256 agreeing)',
  'function recoveryEnabled() view returns (bool)',
  'function policyHash() view returns (bytes32)',
]);
const payerAbi = parseAbi([
  'function debt(address) view returns (uint256)',
  'function reserves(address) view returns (uint256)',
  'function depositTo(address) payable',
]);
const notificationParams = parseAbiParameters(
  'address recipient,(uint256 chainId,address contractAddress,uint256 topic0,uint256 topic1,uint256 topic2,uint256 topic3,bytes data,uint256 blockNumber,uint256 opCode,uint256 blockHash,uint256 txHash,uint256 logIndex) notification',
);
const proxyParams = parseAbiParameters('uint8 version,bytes config');
const callbackParams = parseAbiParameters(
  '(uint256 chainId,address recipient,uint64 gasLimit,bytes payload) config',
);
const policy = await baseReadPolicy();
async function baseReadPolicy() {
  return base.readContract({
    address: d.voteMirror,
    abi: mirrorAbi,
    functionName: 'policyHash',
  });
}

async function verifyProxyPayload(hash, id, support) {
  const tx = await base.getTransaction({ hash });
  const encoded = `0x${tx.input.slice(10)}`;
  const [version, config] = decodeAbiParameters(proxyParams, encoded);
  assert.equal(
    encodeAbiParameters(proxyParams, [version, config]).toLowerCase(),
    encoded.toLowerCase(),
  );
  assert.equal(version, 0);
  const [callback] = decodeAbiParameters(callbackParams, config);
  assert.equal(
    encodeAbiParameters(callbackParams, [callback]).toLowerCase(),
    config.toLowerCase(),
  );
  assert.equal(callback.chainId, 84532n);
  assert.ok(same(callback.recipient, d.voteMirror));
  assert.equal(callback.gasLimit, 600000n);
  const decoded = decodeFunctionData({
    abi: mirrorAbi,
    data: callback.payload,
  });
  assert.equal(decoded.functionName, 'castMirrored');
  assert.ok(same(decoded.args[0], d.mirrorReactive));
  assert.equal(decoded.args[1], id);
  assert.equal(Number(decoded.args[2]), support);
  assert.equal(decoded.args[3], policy);
}

function decodeLogs(receipt, address, abi) {
  return receipt.logs
    .filter((log) => same(log.address, address))
    .flatMap((log) => {
      try {
        return [
          {
            ...decodeEventLog({ abi, data: log.data, topics: log.topics }),
            raw: log,
          },
        ];
      } catch {
        return [];
      }
    });
}
function findEvent(receipt, address, abi, name, id) {
  return decodeLogs(receipt, address, abi).find(
    (event) => event.eventName === name && event.args.proposalId === id,
  );
}
async function receipt(client, hash, target) {
  const value = await client.getTransactionReceipt({ hash });
  assert.equal(value.status, 'success', `Reverted ${hash}`);
  assert.ok(same(value.to, target), `Wrong recipient ${hash}`);
  const [block, head] = await Promise.all([
    client.getBlock({ blockNumber: value.blockNumber }),
    client.getBlockNumber(),
  ]);
  assert.equal(block.hash, value.blockHash, `Noncanonical receipt ${hash}`);
  assert.ok(
    head >= value.blockNumber + 2n,
    `Insufficient confirmations ${hash}`,
  );
  return value;
}
const baseRead = (address, abi, functionName, args = [], blockNumber) =>
  base.readContract({ address, abi, functionName, args, blockNumber });
const lasnaRead = (address, abi, functionName, args = []) =>
  lasna.readContract({ address, abi, functionName, args });
const link = (network, hash) =>
  `https://${network === 'base' ? 'sepolia.basescan.org' : 'lasna.reactscan.net'}/tx/${hash}`;
const labels = {
  for: 'For consensus',
  against: 'Against consensus',
  abstain: 'Abstain consensus',
  splitmajority: 'Split, then majority',
  skip: 'Owner skip',
  retry: 'Paused, then Reactive retry',
  thirdvote: 'Third ballot, no duplicate vote',
  owneroverride: 'Owner vote takes priority',
};
const results = [];

for (const mode of Object.keys(labels)) {
  const state = read(suite.scenarios[mode].evidence);
  assert.equal(state.status, 'verified');
  const id = BigInt(state.proposalId);
  const proposal = await receipt(
    base,
    state.steps.propose.hash,
    d.demoGovernor,
  );
  const created = findEvent(
    proposal,
    d.demoGovernor,
    governorAbi,
    'ProposalCreated',
    id,
  );
  assert.ok(created, `Missing proposal ${mode}`);
  assert.equal(created.args.description, state.description);
  const origins = [];
  const originByHash = new Map();
  const ballotKeys = [
    'aliceVote',
    'bobVote',
    ...(state.steps.carolVote ? ['carolVote'] : []),
  ];
  for (const key of ballotKeys) {
    const step = state.steps[key];
    const origin = await receipt(base, step.hash, d.demoGovernor);
    assert.ok(same(origin.from, step.sender));
    const ballot = findEvent(
      origin,
      d.demoGovernor,
      governorAbi,
      'VoteCast',
      id,
    );
    assert.ok(ballot, `Missing ballot ${mode}/${key}`);
    assert.ok(same(ballot.args.voter, step.sender));
    const expectedSupport =
      key === 'bobVote' && mode === 'splitmajority' ? 0 : state.support;
    assert.equal(Number(ballot.args.support), expectedSupport);
    assert.equal(ballot.args.weight, 1000n * 10n ** 18n);
    origins.push({
      role: key,
      voter: step.sender,
      support: expectedSupport,
      hash: step.hash,
      url: link('base', step.hash),
      blockNumber: origin.blockNumber.toString(),
    });
    originByHash.set(step.hash.toLowerCase(), { receipt: origin, ballot });
  }
  const sourceHead = await lasna.getBlockNumber();
  const sourceEvents = [];
  // Match receipts fetched independently of the event arrays saved by the runner.
  for (
    let start = BigInt(state.lasnaFrom);
    start <= sourceHead;
    start += 200n
  ) {
    const logs = await lasna.getLogs({
      address: d.mirrorReactive,
      fromBlock: start,
      toBlock: start + 199n < sourceHead ? start + 199n : sourceHead,
    });
    for (const log of logs) {
      try {
        const parsed = decodeEventLog({
          abi: reactiveAbi,
          data: log.data,
          topics: log.topics,
        });
        if (parsed.args.proposalId === id)
          sourceEvents.push({ ...parsed, hash: log.transactionHash });
      } catch {
        /* Unrelated event. */
      }
    }
  }
  const observed = sourceEvents.filter((e) => e.eventName === 'VoteObserved');
  assert.equal(
    observed.length,
    origins.length,
    `Missing or repeated source observations ${mode}`,
  );
  for (const origin of origins) {
    const observation = observed.find(
      (e) =>
        same(e.args.voter, origin.voter) &&
        Number(e.args.support) === origin.support,
    );
    assert.ok(observation, `Origin was not observed ${mode}/${origin.role}`);
    const [sourceReceipt, transaction] = await Promise.all([
      receipt(lasna, observation.hash, SYSTEM),
      lasna.getTransaction({ hash: observation.hash }),
    ]);
    assert.ok(
      findEvent(
        sourceReceipt,
        d.mirrorReactive,
        reactiveAbi,
        'VoteObserved',
        id,
      ),
    );
    // The current system entrypoint wraps the documented LogRecord with a recipient.
    // Re-encoding must reproduce every payload byte before trusting this layout.
    const encoded = `0x${transaction.input.slice(10)}`;
    const [recipient, notification] = decodeAbiParameters(
      notificationParams,
      encoded,
    );
    assert.equal(
      encodeAbiParameters(notificationParams, [
        recipient,
        notification,
      ]).toLowerCase(),
      encoded.toLowerCase(),
    );
    assert.ok(same(recipient, d.mirrorReactive));
    assert.equal(notification.chainId, 84532n);
    assert.ok(same(notification.contractAddress, d.demoGovernor));
    assert.equal(notification.opCode, 2n);
    assert.equal(
      toHex(notification.txHash, { size: 32 }).toLowerCase(),
      origin.hash.toLowerCase(),
    );
    const original = originByHash.get(origin.hash.toLowerCase());
    assert.equal(
      toHex(notification.blockHash, { size: 32 }),
      original.receipt.blockHash,
    );
    assert.equal(notification.blockNumber, original.receipt.blockNumber);
    assert.equal(Number(notification.logIndex), original.ballot.raw.logIndex);
    assert.equal(notification.data, original.ballot.raw.data);
    assert.equal(
      toHex(notification.topic0, { size: 32 }),
      original.ballot.raw.topics[0],
    );
    assert.equal(
      toHex(notification.topic1, { size: 32 }),
      original.ballot.raw.topics[1],
    );
    origin.reactiveObservation = {
      hash: observation.hash,
      url: link('lasna', observation.hash),
      originHashMatched: true,
      logRecordVerified: true,
    };
  }
  const requests = sourceEvents.filter(
    (e) => e.eventName === 'MirrorRequested',
  );
  const retries = sourceEvents.filter((e) => e.eventName === 'MirrorRetried');
  assert.equal(requests.length, 1, `Unexpected callback requests ${mode}`);
  assert.equal(retries.length, mode === 'retry' ? 1 : 0);
  for (const request of [...requests, ...retries]) {
    assert.equal(Number(request.args.support), state.support);
    assert.equal(request.args.agreeing, 2n);
  }
  const callbacks = [];
  const skippedModes = ['skip', 'retry', 'owneroverride'];
  if (skippedModes.includes(mode)) {
    const hash = state.initialSkipped[0].transactionHash;
    const value = await receipt(base, hash, d.callbackProxy);
    await verifyProxyPayload(hash, id, state.support);
    const event = findEvent(value, d.voteMirror, mirrorAbi, 'Skipped', id);
    assert.ok(event, `Missing skip callback ${mode}`);
    assert.equal(Number(event.args.support), state.support);
    assert.equal(
      Number(event.args.reason),
      mode === 'skip' ? 1 : mode === 'owneroverride' ? 2 : 0,
    );
    assert.ok(!findEvent(value, d.demoGovernor, governorAbi, 'VoteCast', id));
    callbacks.push({
      outcome: 'Skipped',
      reason: Number(event.args.reason),
      hash,
      url: link('base', hash),
      blockNumber: value.blockNumber.toString(),
    });
  }
  if (!['skip', 'owneroverride'].includes(mode)) {
    assert.equal(state.mirrored.length, 1, `Duplicate recorded mirror ${mode}`);
    const hash = state.mirrored[0].transactionHash;
    const value = await receipt(base, hash, d.callbackProxy);
    await verifyProxyPayload(hash, id, state.support);
    const mirrored = findEvent(value, d.voteMirror, mirrorAbi, 'Mirrored', id);
    const ballot = findEvent(
      value,
      d.demoGovernor,
      governorAbi,
      'VoteCast',
      id,
    );
    assert.ok(mirrored && ballot, `Missing destination vote ${mode}`);
    assert.equal(Number(mirrored.args.support), state.support);
    assert.equal(mirrored.args.weight, 1000n * 10n ** 18n);
    assert.ok(same(ballot.args.voter, d.voteMirror));
    assert.equal(Number(ballot.args.support), state.support);
    callbacks.push({
      outcome: 'Mirrored',
      support: state.support,
      hash,
      url: link('base', hash),
      blockNumber: value.blockNumber.toString(),
    });
  }
  const voted = await baseRead(d.demoGovernor, governorAbi, 'hasVoted', [
    id,
    d.voteMirror,
  ]);
  assert.equal(voted, mode !== 'skip');
  const totals = await baseRead(d.demoGovernor, governorAbi, 'proposalVotes', [
    id,
  ]);
  const expected =
    mode === 'splitmajority'
      ? [1, 3, 0]
      : mode === 'owneroverride'
        ? [1, 2, 0]
        : [0, 0, 0];
  if (!['splitmajority', 'owneroverride'].includes(mode))
    expected[state.support] =
      mode === 'skip' ? 2 : mode === 'thirdvote' ? 4 : 3;
  assert.deepEqual(
    totals,
    expected.map((n) => BigInt(n) * 1000n * 10n ** 18n),
  );
  if (mode === 'splitmajority') {
    const before = BigInt(state.beforeMajority.block);
    assert.equal(
      await baseRead(
        d.demoGovernor,
        governorAbi,
        'hasVoted',
        [id, d.voteMirror],
        before,
      ),
      false,
    );
    assert.equal(
      (
        await baseRead(
          d.voteMirror,
          mirrorAbi,
          'confirmedSupport',
          [id],
          before,
        )
      )[0],
      false,
    );
  }
  if (mode === 'thirdvote') {
    assert.ok(
      BigInt(callbacks[0].blockNumber) < BigInt(origins.at(-1).blockNumber),
      'Third ballot was not after the mirrored vote',
    );
  }
  let ownerOverride = null;
  if (mode === 'owneroverride') {
    const value = await receipt(
      base,
      state.steps.ownerOverride.hash,
      d.voteMirror,
    );
    const ballot = findEvent(
      value,
      d.demoGovernor,
      governorAbi,
      'VoteCast',
      id,
    );
    assert.ok(ballot && same(ballot.args.voter, d.voteMirror));
    assert.equal(Number(ballot.args.support), 0);
    ownerOverride = {
      hash: state.steps.ownerOverride.hash,
      url: link('base', state.steps.ownerOverride.hash),
    };
  }
  results.push({
    mode,
    evidenceFile: suite.scenarios[mode].evidence,
    label: labels[mode],
    verified: true,
    proposalId: id.toString(),
    description: state.description,
    proposalCreation: {
      hash: state.steps.propose.hash,
      url: link('base', state.steps.propose.hash),
    },
    origins,
    requests: [...requests, ...retries].map((e) => ({
      event: e.eventName,
      support: Number(e.args.support),
      hash: e.hash,
      url: link('lasna', e.hash),
    })),
    callbacks,
    ownerOverride,
    finalVoteTotals: totals.map(String),
    mirrorHasVoted: voted,
  });
  console.log(
    `VERIFIED ${mode}: ${origins.length} origin links, ${requests.length + retries.length} requests, ${callbacks.length} proxy callbacks`,
  );
}
const [basePolicy, sourcePolicy, paused, cron, baseDebt, sourceDebt, reserve] =
  await Promise.all([
    baseRead(d.voteMirror, mirrorAbi, 'policyHash'),
    lasnaRead(d.mirrorReactive, reactiveAbi, 'policyHash'),
    baseRead(d.voteMirror, mirrorAbi, 'paused'),
    lasnaRead(d.mirrorReactive, reactiveAbi, 'recoveryEnabled'),
    baseRead(d.callbackProxy, payerAbi, 'debt', [d.voteMirror]),
    lasnaRead(SYSTEM, payerAbi, 'debt', [d.mirrorReactive]),
    lasnaRead(SYSTEM, payerAbi, 'reserves', [d.mirrorReactive]),
  ]);
assert.equal(basePolicy, sourcePolicy);
assert.equal(paused, false);
assert.equal(cron, false);
assert.equal(baseDebt, 0n);
assert.equal(sourceDebt, 0n);
const operations = read('deployments/submission-operations-20261124.json');
let operationalProof = null;
if (operations.runId === runId) {
  const funding = await receipt(lasna, operations.fundingHash, SYSTEM);
  const fundingTx = await lasna.getTransaction({
    hash: operations.fundingHash,
  });
  assert.ok(same(funding.from, d.owner));
  assert.equal(fundingTx.value, 500000000000000000n);
  const fundingCall = decodeFunctionData({
    abi: payerAbi,
    data: fundingTx.input,
  });
  assert.equal(fundingCall.functionName, 'depositTo');
  assert.ok(same(fundingCall.args[0], d.mirrorReactive));
  const interrupted = read(operations.excludedReactiveAttempt);
  const recovered = await receipt(
    base,
    operations.separateSenderRecoveryTx,
    d.voteMirror,
  );
  assert.ok(same(recovered.from, '0x90788662F1b5332979f0049FDeA519fc66d1bdAe'));
  assert.ok(
    findEvent(
      recovered,
      d.voteMirror,
      mirrorAbi,
      'Mirrored',
      BigInt(interrupted.proposalId),
    ),
  );
  operationalProof = {
    funding: {
      hash: operations.fundingHash,
      url: link('lasna', operations.fundingHash),
      amountWei: '500000000000000000',
    },
    separateSenderRecovery: {
      hash: operations.separateSenderRecoveryTx,
      url: link('base', operations.separateSenderRecoveryTx),
      proposalId: interrupted.proposalId,
      countedAsReactiveCallback: false,
    },
  };
}
const output = {
  runId,
  verifiedAt: new Date().toISOString(),
  chainIds: { origin: 84532, reactive: 5318007, destination: 84532 },
  contracts: {
    governor: d.demoGovernor,
    reactive: d.mirrorReactive,
    mirror: d.voteMirror,
    proxy: d.callbackProxy,
  },
  summary: {
    scenarios: results.length,
    originVotes: results.reduce((n, r) => n + r.origins.length, 0),
    reactiveObservations: results.reduce((n, r) => n + r.origins.length, 0),
    callbackRequests: results.reduce((n, r) => n + r.requests.length, 0),
    proxyCallbacks: results.reduce((n, r) => n + r.callbacks.length, 0),
    mirroredVotes: results.reduce(
      (n, r) => n + r.callbacks.filter((c) => c.outcome === 'Mirrored').length,
      0,
    ),
  },
  operatingState: {
    policyHash: basePolicy,
    paused,
    cronRecoveryEnabled: cron,
    baseDebt: baseDebt.toString(),
    reactiveDebt: sourceDebt.toString(),
    reactiveReserve: reserve.toString(),
    senderTaskRestored: suite.senderTaskState === 'Running',
  },
  operationalProof,
  scenarios: results,
};
writeFileSync(
  resolve(root, `deployments/submission-evidence-${runId}.json`),
  JSON.stringify(output, null, 2) + '\n',
);
let markdown = `# VoteMirror: submission transaction evidence\n\nVerified ${output.verifiedAt}. Run ID: ${runId}.\n\nAll ${results.length} scenarios ran on the current v4 deployment. The Base recovery sender was temporarily stopped for these tests and restored afterward. Optional Cron recovery remained off. All destination callbacks below target the configured Reactive callback proxy; direct owner transactions are labeled separately.\n\n`;
markdown +=
  '| Scenario | Threshold-reaching origin ballot | Lasna request | Base callback/result |\n|---|---|---|---|\n';
for (const result of results) {
  const trigger = result.origins[result.mode === 'splitmajority' ? 2 : 1];
  markdown += `| ${result.label} | [${trigger.role}](${trigger.url}) | ${result.requests.map((r) => `[${r.event}](${r.url})`).join(' / ')} | ${result.callbacks.map((c) => `[${c.outcome}](${c.url})`).join(' / ')} |\n`;
}
if (operationalProof)
  markdown += `\n## Operational interruption and separate recovery\n\nThe original third-vote attempt encountered exhausted Reactive fee reserves. Its vote was subsequently recovered by the dedicated Base sender: [${operations.separateSenderRecoveryTx}](${operationalProof.separateSenderRecovery.url}). This is a direct recovery transaction and is excluded from the eight Reactive scenarios and nine proxy callbacks counted above. After [depositing 0.5 test lREACT](${operationalProof.funding.url}) to settle debt and replenish reserves, third-vote and owner-override cases ran with fresh proposal IDs. The original incomplete attempt remains recorded in ${operations.excludedReactiveAttempt}.\n\n`;
markdown += '## Complete transaction hashes\n\n';
for (const result of results) {
  markdown += `### ${result.label}\n\nProposal ID: \`${result.proposalId}\`. [Raw scenario](../${result.evidenceFile}).\n\n- Proposal creation: [${result.proposalCreation.hash}](${result.proposalCreation.url})\n`;
  for (const origin of result.origins)
    markdown += `- ${origin.role} (${['Against', 'For', 'Abstain'][origin.support]}): [${origin.hash}](${origin.url}); matching Lasna notification: [${origin.reactiveObservation.hash}](${origin.reactiveObservation.url})\n`;
  for (const request of result.requests)
    markdown += `- ${request.event}: [${request.hash}](${request.url})\n`;
  for (const callback of result.callbacks)
    markdown += `- Proxy callback ${callback.outcome}${callback.reason !== undefined ? ` (reason ${callback.reason})` : ''}: [${callback.hash}](${callback.url})\n`;
  if (result.ownerOverride)
    markdown += `- Owner's earlier direct Against vote (not a Reactive callback): [${result.ownerOverride.hash}](${result.ownerOverride.url})\n`;
  markdown += `\nFinal Governor totals (Against / For / Abstain, raw 18-decimal VMD): ${result.finalVoteTotals.join(' / ')}.\n\n`;
}
markdown +=
  '## Verification scope\n\n- Successful canonical receipts with at least two additional blocks on both chains.\n- Origin VoteCast sender, proposal ID, support and weight.\n- Every observed origin transaction hash, block hash, log index, topics and data matched the decoded Lasna system notification payload. The ABI payload was re-encoded byte for byte.\n- MirrorRequested / MirrorRetried matched the proposal, support and threshold.\n- Destination transactions targeted the configured callback proxy, and emitted the expected VoteMirror Mirrored / Skipped event. Successful mirrored votes also emitted the Governor VoteCast for VoteMirror.\n- Governor vote totals and hasVoted were read back; split-before-majority was checked at its historical Base block.\n- Six scenarios mirrored a vote; skip and owner override intentionally prevented a new mirrored vote. Retry contains both a skipped callback and a successful callback.\n- Third-vote idempotency is demonstrated through the verification block, not a claim about arbitrary future network behavior.\n- No latency SLA or continuous uptime is claimed. All tokens and fees are testnet-only.\n\n';
markdown += `Machine-readable proof: [submission-evidence-${runId}.json](../deployments/submission-evidence-${runId}.json). Scenario paths are indexed in [evidence-suite-${runId}.json](../deployments/evidence-suite-${runId}.json).\n`;
writeFileSync(resolve(root, 'docs/submission-evidence.md'), markdown);
suite.status = 'independently-verified';
suite.independentlyVerifiedAt = output.verifiedAt;
suite.verificationFile = `deployments/submission-evidence-${runId}.json`;
writeFileSync(
  resolve(root, `deployments/evidence-suite-${runId}.json`),
  JSON.stringify(suite, null, 2) + '\n',
);
console.log(JSON.stringify(output.summary));
