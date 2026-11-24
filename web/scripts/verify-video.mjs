// Read-only verification of the exact fresh transaction shown in the video.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import {
  parseAbi,
  parseAbiParameters,
  decodeAbiParameters,
  encodeAbiParameters,
  decodeEventLog,
  toHex,
  decodeFunctionData,
} from 'viem';
const root = fileURLToPath(new URL('../../', import.meta.url));
const runId = process.argv[2] ?? 'video-20261124-01';
if (!/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error('Invalid run ID');
const read = (path) =>
  JSON.parse(readFileSync(resolve(root, path), 'utf8').replace(/^\uFEFF/, ''));
const s = read(`deployments/v4-for-${runId}.json`);
assert.equal(s.status, 'verified');
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});
try {
  const {
    base,
    reactive,
    deployment: d,
    verifyScenario,
    readWorkspace,
    readReactive,
  } = await server.ssrLoadModule('/src/chain.js');
  const scenario = {
    proposalId: s.proposalId,
    proposeTx: s.steps.propose.hash,
    voteTxs: [s.steps.aliceVote.hash, s.steps.bobVote.hash],
    ballots: [
      { voter: s.steps.aliceVote.sender, support: 1 },
      { voter: s.steps.bobVote.sender, support: 1 },
    ],
    reactiveTx: s.reactiveEvents[0].transactionHash,
    resultTx: s.mirrored[0].transactionHash,
    mirrored: true,
    support: 1,
    path: 'Reactive callback',
  };
  const verified = await verifyScenario(scenario);
  assert.equal(verified.path, 'Reactive callback');
  assert.equal(verified.sourceVerified, true);
  const [workspace, source] = await Promise.all([
    readWorkspace(),
    readReactive(),
  ]);
  assert.equal(workspace.policyHash, source.policyHash);
  assert.equal(workspace.paused, false);
  const abi = parseAbi([
    'event VoteObserved(uint256 indexed proposalId,address indexed voter,uint8 support,uint256 agreeing)',
  ]);
  const params = parseAbiParameters(
    'address recipient,(uint256 chainId,address contractAddress,uint256 topic0,uint256 topic1,uint256 topic2,uint256 topic3,bytes data,uint256 blockNumber,uint256 opCode,uint256 blockHash,uint256 txHash,uint256 logIndex) log',
  );
  const logs = [];
  for (
    let from = BigInt(s.lasnaFrom);
    from <= source.blockNumber;
    from += 200n
  ) {
    logs.push(
      ...(await reactive.getLogs({
        address: d.mirrorReactive,
        fromBlock: from,
        toBlock:
          from + 199n < source.blockNumber ? from + 199n : source.blockNumber,
      })),
    );
  }
  const observed = logs.flatMap((log) => {
    try {
      const parsed = decodeEventLog({
        abi,
        data: log.data,
        topics: log.topics,
      });
      return parsed.args.proposalId === BigInt(s.proposalId)
        ? [{ ...parsed, hash: log.transactionHash }]
        : [];
    } catch {
      return [];
    }
  });
  assert.equal(observed.length, 2);
  const origins = [];
  for (const [role, step] of [
    ['Alice', s.steps.aliceVote],
    ['Bob', s.steps.bobVote],
  ]) {
    const observation = observed.find(
      (e) => e.args.voter.toLowerCase() === step.sender.toLowerCase(),
    );
    assert.ok(observation);
    const [origin, transaction, sourceReceipt] = await Promise.all([
      base.getTransactionReceipt({ hash: step.hash }),
      reactive.getTransaction({ hash: observation.hash }),
      reactive.getTransactionReceipt({ hash: observation.hash }),
    ]);
    assert.equal(sourceReceipt.status, 'success');
    assert.equal(
      transaction.to.toLowerCase(),
      '0x8888888888888888888888888888888888888888',
    );
    const encoded = `0x${transaction.input.slice(10)}`;
    const [recipient, record] = decodeAbiParameters(params, encoded);
    assert.equal(
      encodeAbiParameters(params, [recipient, record]).toLowerCase(),
      encoded.toLowerCase(),
    );
    assert.equal(recipient.toLowerCase(), d.mirrorReactive.toLowerCase());
    assert.equal(record.chainId, 84532n);
    assert.equal(record.opCode, 2n);
    assert.equal(
      toHex(record.txHash, { size: 32 }).toLowerCase(),
      step.hash.toLowerCase(),
    );
    assert.equal(toHex(record.blockHash, { size: 32 }), origin.blockHash);
    const log = origin.logs.find((l) => l.logIndex === Number(record.logIndex));
    assert.ok(log);
    assert.equal(record.data, log.data);
    assert.equal(toHex(record.topic0, { size: 32 }), log.topics[0]);
    assert.equal(toHex(record.topic1, { size: 32 }), log.topics[1]);
    origins.push({
      role,
      hash: step.hash,
      observationHash: observation.hash,
      originLogMatched: true,
    });
  }
  const callback = await base.getTransaction({ hash: scenario.resultTx });
  assert.equal(callback.to.toLowerCase(), d.callbackProxy.toLowerCase());
  const [version, config] = decodeAbiParameters(
    parseAbiParameters('uint8 version,bytes config'),
    `0x${callback.input.slice(10)}`,
  );
  assert.equal(version, 0);
  const [c] = decodeAbiParameters(
    parseAbiParameters(
      '(uint256 chainId,address recipient,uint64 gasLimit,bytes payload) callback',
    ),
    config,
  );
  assert.equal(c.chainId, 84532n);
  assert.equal(c.recipient.toLowerCase(), d.voteMirror.toLowerCase());
  const payload = decodeFunctionData({
    abi: parseAbi(['function castMirrored(address,uint256,uint8,bytes32)']),
    data: c.payload,
  });
  assert.equal(payload.args[0].toLowerCase(), d.mirrorReactive.toLowerCase());
  assert.equal(payload.args[1], BigInt(s.proposalId));
  assert.equal(payload.args[2], 1);
  assert.equal(payload.args[3], workspace.policyHash);
  const proof = {
    runId,
    verifiedAt: new Date().toISOString(),
    proposalId: s.proposalId,
    networks: { baseSepolia: 84532, lasna: 5318007 },
    contracts: d,
    proposalCreation: s.steps.propose.hash,
    origins,
    reactiveRequest: scenario.reactiveTx,
    callback: scenario.resultTx,
    deliveryPath: verified.path,
    policyHash: workspace.policyHash,
    sourceReceiptsVerified: true,
    callbackPayloadVerified: true,
    recording:
      'The fresh proposal and ballot-state transitions were captured in the continuous Chrome recording; explorer pickup shots use the same hashes.',
  };
  writeFileSync(
    resolve(root, `deployments/video-proof-${runId}.json`),
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      verified: true,
      proposalId: s.proposalId,
      reactive: scenario.reactiveTx,
      callback: scenario.resultTx,
    }),
  );
} finally {
  await server.close();
}
