// Public chain evidence only. Wallet configuration and runtime are never inputs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (file) =>
  JSON.parse(
    readFileSync(resolve(root, '../deployments', file), 'utf8').replace(
      /^\uFEFF/,
      '',
    ),
  );
const manifest = read('hardened-testnet-v4.json');
const summaries = read('v4-verification.json');
const modes = [
  'for',
  'against',
  'split',
  'skip',
  'retry',
  'reconcile',
  'recovery',
  'lostlogs',
  'sender',
];
const labels = {
  for: [
    'A shared conviction',
    'Two trusted voters support a proposal. VoteMirror follows their agreement.',
    'Reactive callback',
  ],
  against: [
    'Dissent, mirrored',
    'Agreement works both ways. Two Against ballots trigger an Against vote.',
    'Reactive callback',
  ],
  split: [
    'Disagreement is a decision',
    'One For, one Against. Without same-side agreement, VoteMirror stays out.',
    'No consensus',
  ],
  skip: [
    'Your veto stays yours',
    'The owner skips a proposal. Trusted agreement cannot override that choice.',
    'Owner skipped',
  ],
  retry: [
    'A second chance to deliver',
    'A paused callback is skipped. After unpausing, a Reactive retry completes the vote.',
    'Reactive retry',
  ],
  reconcile: [
    'A recovery, on your terms',
    'The owner reconciles the vote directly after unpausing.',
    'Owner recovery',
  ],
  recovery: [
    'A safety net on-chain',
    'A recorded Cron recovery delivers the vote after a pause. Cron is currently off.',
    'Cron recovery',
  ],
  lostlogs: [
    'When an event goes missing',
    'A recorded Cron scan recovers an agreement absent from Reactive logs.',
    'Cron recovery',
  ],
  sender: [
    'Delivery has a backup',
    'With Cron off and a source ballot missing, the dedicated Base sender recovers the vote.',
    'Recovery sender',
  ],
};
const scenarios = modes.map((mode) => {
  const filename =
    mode === 'sender'
      ? 'v4-sender-audit-service-2.json'
      : `v4-${mode}-audit-4.json`;
  const evidence = read(filename);
  if (evidence.status !== 'verified' || !/^\d+$/.test(evidence.proposalId))
    throw new Error(`Invalid evidence ${filename}`);
  const summary = summaries.find((s) => s.mode === mode);
  const resultEvent = (evidence.mirrored ??
    evidence.initialSkipped ??
    evidence.reconcileEvidence ??
    [])[0];
  const resultTx =
    resultEvent?.transactionHash ??
    evidence.serviceSenderProof?.transactionHash ??
    summary?.baseResultTx ??
    null;
  const outcome =
    mode === 'split'
      ? 'No consensus'
      : mode === 'skip'
        ? 'Skipped'
        : 'Mirrored';
  return {
    mode,
    title: labels[mode][0],
    summary: labels[mode][1],
    path: labels[mode][2],
    outcome,
    proposalId: evidence.proposalId,
    description: evidence.description,
    support: evidence.support,
    sourceFile: filename,
    baseFrom: evidence.baseFrom,
    proposeTx: evidence.steps.propose.hash,
    voteTxs: [evidence.steps.aliceVote.hash, evidence.steps.bobVote.hash],
    reactiveTx: evidence.reactiveEvents?.[0]?.transactionHash ?? null,
    resultTx,
    ballots: [
      {
        voter: evidence.steps.aliceVote.sender,
        support: evidence.support,
        tx: evidence.steps.aliceVote.hash,
      },
      {
        voter: evidence.steps.bobVote.sender,
        support: mode === 'split' ? 0 : evidence.support,
        tx: evidence.steps.bobVote.hash,
      },
    ],
    votes: (evidence.proposalVotes.match(/^\d+/gm) ?? []).map(String),
    mirrored: evidence.hasVoted === 'true',
  };
});
const output =
  JSON.stringify(
    {
      deployment: Object.fromEntries(
        [
          'contractVersion',
          'baseSepoliaChainId',
          'lasnaChainId',
          'demoToken',
          'demoGovernor',
          'voteMirror',
          'mirrorReactive',
          'callbackProxy',
          'owner',
          'trustedVoters',
          'threshold',
        ].map((key) => [key, manifest[key]]),
      ),
      scenarios,
    },
    null,
    2,
  ) + '\n';
const target = resolve(root, 'src/generated/evidence.json');
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output)
    throw new Error('Frontend evidence is out of date. Run npm run sync-data.');
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, output);
}
console.log(`Validated ${scenarios.length} public evidence scenarios.`);
