import {
  createPublicClient,
  createWalletClient,
  http,
  fallback,
  defineChain,
  custom,
  parseAbi,
  parseAbiItem,
  decodeEventLog,
  encodeFunctionData,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import evidence from './generated/evidence.json';
import { equalAddress, safeProposalId, transactionPath } from './model.js';

export const deployment = evidence.deployment;
export const scenarios = evidence.scenarios;
export const REPOSITORY = 'https://github.com/duclucky/votemirror-reactive';
export const RECOVERY_SENDER = '0x90788662F1b5332979f0049FDeA519fc66d1bdAe';
export const baseExplorer = 'https://sepolia.basescan.org';
export const lasnaExplorer = 'https://lasna.reactscan.net';
const lasna = defineChain({
  id: 5318007,
  name: 'Reactive Lasna',
  nativeCurrency: { name: 'Test REACT', symbol: 'lREACT', decimals: 18 },
  rpcUrls: { default: { http: ['https://lasna-rpc.rnk.dev/'] } },
});
const transport = (urls) =>
  fallback(
    urls.map((url) =>
      http(url, { timeout: 10_000, retryCount: 0, batch: { wait: 30 } }),
    ),
    { retryCount: 1 },
  );
export const base = createPublicClient({
  chain: baseSepolia,
  transport: transport([
    'https://sepolia.base.org',
    'https://base-sepolia-rpc.publicnode.com',
  ]),
});
export const reactive = createPublicClient({
  chain: lasna,
  transport: transport(['https://lasna-rpc.rnk.dev/']),
});
export const mirrorAbi = parseAbi([
  'function trustedVoters() view returns (address[])',
  'function threshold() view returns (uint256)',
  'function policyHash() view returns (bytes32)',
  'function paused() view returns (bool)',
  'function owner() view returns (address)',
  'function trustedAfterSequence(address) view returns (uint256)',
  'function confirmedSupport(uint256) view returns (bool,uint8)',
  'function skipped(uint256) view returns (bool)',
  'function reconcileProposal(uint256)',
  'event Mirrored(uint256 indexed proposalId, uint8 support, uint256 weight)',
  'event Skipped(uint256 indexed proposalId, uint8 support, uint8 reason)',
]);
export const governorAbi = parseAbi([
  'function recoveryProposals() view returns (uint256[])',
  'function state(uint256) view returns (uint8)',
  'function proposalSnapshot(uint256) view returns (uint256)',
  'function proposalDeadline(uint256) view returns (uint256)',
  'function hasVoted(uint256,address) view returns (bool)',
  'function proposalVotes(uint256) view returns (uint256,uint256,uint256)',
  'function voteReceipt(uint256,address) view returns (uint8,uint256)',
  'function castVote(uint256,uint8) returns (uint256)',
  'function propose(address[],uint256[],bytes[],string) returns (uint256)',
  'event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)',
  'event VoteCastWithParams(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason, bytes params)',
  'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)',
]);
const reactiveAbi = parseAbi([
  'function policyHash() view returns (bytes32)',
  'function recoveryEnabled() view returns (bool)',
  'function mirrorRequested(uint256) view returns (bool)',
  'function requestedSupport(uint256) view returns (uint8)',
  'event MirrorRequested(uint256 indexed proposalId, uint8 support, uint256 agreeing)',
]);
const tokenAbi = parseAbi([
  'function getVotes(address) view returns (uint256)',
  'function faucet(address)',
  'function delegate(address)',
]);
const readBase = (address, abi, functionName, args = [], blockNumber) =>
  base.readContract({ address, abi, functionName, args, blockNumber });
const readMirror = (functionName, args, blockNumber) =>
  readBase(deployment.voteMirror, mirrorAbi, functionName, args, blockNumber);
const readGovernor = (functionName, args, blockNumber) =>
  readBase(
    deployment.demoGovernor,
    governorAbi,
    functionName,
    args,
    blockNumber,
  );

export async function readWorkspace() {
  const [chainId, block] = await Promise.all([
    base.getChainId(),
    base.getBlock(),
  ]);
  if (chainId !== deployment.baseSepoliaChainId)
    throw new Error('Unexpected Base RPC chain.');
  const blockNumber = block.number;
  const [
    trusted,
    threshold,
    policyHash,
    paused,
    owner,
    proposals,
    votingPower,
    balance,
  ] = await Promise.all([
    readMirror('trustedVoters', [], blockNumber),
    readMirror('threshold', [], blockNumber),
    readMirror('policyHash', [], blockNumber),
    readMirror('paused', [], blockNumber),
    readMirror('owner', [], blockNumber),
    readGovernor('recoveryProposals', [], blockNumber),
    readBase(
      deployment.demoToken,
      tokenAbi,
      'getVotes',
      [deployment.voteMirror],
      blockNumber,
    ),
    base.getBalance({ address: deployment.voteMirror, blockNumber }),
  ]);
  const states = await Promise.all(
    proposals.map(async (id) => ({
      id: id.toString(),
      state: Number(await readGovernor('state', [id], blockNumber)),
    })),
  );
  return {
    trusted,
    threshold: Number(threshold),
    policyHash,
    paused,
    owner,
    proposals: states.reverse(),
    votingPower,
    balance,
    blockNumber,
    timestamp: Number(block.timestamp),
    fetchedAt: Date.now(),
  };
}
export async function readReactive() {
  const [chainId, blockNumber] = await Promise.all([
    reactive.getChainId(),
    reactive.getBlockNumber(),
  ]);
  if (chainId !== deployment.lasnaChainId)
    throw new Error('Unexpected Lasna RPC chain.');
  const [policyHash, recoveryEnabled, balance] = await Promise.all([
    reactive.readContract({
      address: deployment.mirrorReactive,
      abi: reactiveAbi,
      functionName: 'policyHash',
      blockNumber,
    }),
    reactive.readContract({
      address: deployment.mirrorReactive,
      abi: reactiveAbi,
      functionName: 'recoveryEnabled',
      blockNumber,
    }),
    reactive.getBalance({ address: deployment.mirrorReactive, blockNumber }),
  ]);
  return {
    policyHash,
    recoveryEnabled,
    balance,
    blockNumber,
    fetchedAt: Date.now(),
  };
}
export async function readProposal(value, workspace, account = null) {
  const id = safeProposalId(value);
  const blockNumber = workspace.blockNumber;
  const [
    state,
    snapshot,
    deadline,
    voted,
    confirmed,
    skipped,
    votes,
    receipts,
    accountVoted,
  ] = await Promise.all([
    readGovernor('state', [id], blockNumber),
    readGovernor('proposalSnapshot', [id], blockNumber),
    readGovernor('proposalDeadline', [id], blockNumber),
    readGovernor('hasVoted', [id, deployment.voteMirror], blockNumber),
    readMirror('confirmedSupport', [id], blockNumber),
    readMirror('skipped', [id], blockNumber),
    readGovernor('proposalVotes', [id], blockNumber),
    Promise.all(
      workspace.trusted.map(async (voter) => {
        const [[choice, sequence], floor] = await Promise.all([
          readGovernor('voteReceipt', [id, voter], blockNumber),
          readMirror('trustedAfterSequence', [voter], blockNumber),
        ]);
        return { voter, choice: Number(choice), sequence, floor };
      }),
    ),
    account ? readGovernor('hasVoted', [id, account], blockNumber) : false,
  ]);
  return {
    id: id.toString(),
    state: Number(state),
    snapshot,
    deadline,
    voted,
    reached: confirmed[0],
    support: Number(confirmed[1]),
    skipped,
    votes,
    receipts,
    account,
    accountVoted,
    blockNumber,
    fetchedAt: Date.now(),
  };
}
export async function readDelivery(value, fromBlock, toBlock) {
  const id = safeProposalId(value);
  const start =
    fromBlock && BigInt(fromBlock) > toBlock - 2000n
      ? BigInt(fromBlock)
      : toBlock > 2000n
        ? toBlock - 2000n
        : 0n;
  const logs = await base.getLogs({
    address: deployment.voteMirror,
    event: parseAbiItem(
      'event Mirrored(uint256 indexed proposalId, uint8 support, uint256 weight)',
    ),
    args: { proposalId: id },
    fromBlock: start,
    toBlock,
  });
  if (!logs.length) return null;
  const log = logs.at(-1);
  const tx = await base.getTransaction({ hash: log.transactionHash });
  return {
    hash: log.transactionHash,
    support: Number(log.args.support),
    path: transactionPath(
      tx.from,
      deployment.callbackProxy,
      RECOVERY_SENDER,
      deployment.owner,
      tx.to,
    ),
  };
}
export async function readRequested(value) {
  const blockNumber = await reactive.getBlockNumber();
  const args = [safeProposalId(value)];
  const requested = await reactive.readContract({
    address: deployment.mirrorReactive,
    abi: reactiveAbi,
    functionName: 'mirrorRequested',
    args,
    blockNumber,
  });
  if (!requested) return 0;
  const support = Number(
    await reactive.readContract({
      address: deployment.mirrorReactive,
      abi: reactiveAbi,
      functionName: 'requestedSupport',
      args,
      blockNumber,
    }),
  );
  return support + 1;
}
function events(receipt, address, abi) {
  return receipt.logs
    .filter((log) => equalAddress(log.address, address))
    .flatMap((log) => {
      try {
        return [decodeEventLog({ abi, data: log.data, topics: log.topics })];
      } catch {
        return [];
      }
    });
}
export async function verifyScenario(scenario) {
  const chainId = await base.getChainId();
  if (chainId !== deployment.baseSepoliaChainId)
    throw new Error('Unexpected chain.');
  const getReceipt = async (hash, address) => {
    const receipt = await base.getTransactionReceipt({ hash });
    const targets = Array.isArray(address) ? address : [address];
    if (
      receipt.status !== 'success' ||
      !targets.some((target) => equalAddress(receipt.to, target))
    )
      throw new Error('Receipt does not match the recorded contract.');
    return receipt;
  };
  const [proposal, ...ballots] = await Promise.all([
    getReceipt(scenario.proposeTx, deployment.demoGovernor),
    ...scenario.voteTxs.map((hash) =>
      getReceipt(hash, deployment.demoGovernor),
    ),
  ]);
  const created = events(proposal, deployment.demoGovernor, governorAbi).find(
    (e) =>
      e.eventName === 'ProposalCreated' &&
      e.args.proposalId.toString() === scenario.proposalId,
  );
  if (!created) throw new Error('Proposal evidence does not match.');
  for (let i = 0; i < ballots.length; i++) {
    const expected = scenario.ballots[i];
    if (
      !events(ballots[i], deployment.demoGovernor, governorAbi).some(
        (e) =>
          ['VoteCast', 'VoteCastWithParams'].includes(e.eventName) &&
          e.args.proposalId.toString() === scenario.proposalId &&
          equalAddress(e.args.voter, expected.voter) &&
          Number(e.args.support) === expected.support,
      )
    )
      throw new Error('Ballot evidence does not match.');
  }
  let path = scenario.path;
  if (scenario.resultTx) {
    const result = await getReceipt(scenario.resultTx, [
      deployment.voteMirror,
      deployment.callbackProxy,
    ]);
    const name = scenario.mirrored ? 'Mirrored' : 'Skipped';
    if (
      !events(result, deployment.voteMirror, mirrorAbi).some(
        (e) =>
          e.eventName === name &&
          e.args.proposalId.toString() === scenario.proposalId &&
          (!scenario.mirrored || Number(e.args.support) === scenario.support),
      )
    )
      throw new Error('Result evidence does not match.');
    path = transactionPath(
      result.from,
      deployment.callbackProxy,
      RECOVERY_SENDER,
      deployment.owner,
      result.to,
    );
    // Cron/retry labels describe the recorded trigger; receipt proves who delivered it.
  }
  let sourceVerified = false;
  if (scenario.reactiveTx) {
    if ((await reactive.getChainId()) !== deployment.lasnaChainId)
      throw new Error('Unexpected Lasna chain.');
    const receipt = await reactive.getTransactionReceipt({
      hash: scenario.reactiveTx,
    });
    if (
      receipt.status !== 'success' ||
      !events(receipt, deployment.mirrorReactive, reactiveAbi).some(
        (e) =>
          e.eventName === 'MirrorRequested' &&
          e.args.proposalId.toString() === scenario.proposalId &&
          Number(e.args.support) === scenario.support,
      )
    )
      throw new Error('Reactive request evidence does not match.');
    sourceVerified = true;
  }
  return {
    verifiedAt: Date.now(),
    path,
    sourceVerified,
    description: created.args.description,
    blockNumber: proposal.blockNumber,
  };
}

export async function sendAction(
  provider,
  kind,
  { id, support, title } = {},
  onHash = () => {},
) {
  const wallet = createWalletClient({
    chain: baseSepolia,
    transport: custom(provider),
  });
  const [account] = await wallet.getAddresses();
  if (!account) throw new Error('Wallet disconnected.');
  const chainId = await wallet.getChainId();
  if (chainId !== baseSepolia.id) {
    try {
      await wallet.switchChain({ id: baseSepolia.id });
    } catch (error) {
      if (error.code === 4902 || error.cause?.code === 4902) {
        await wallet.addChain({ chain: baseSepolia });
        await wallet.switchChain({ id: baseSepolia.id });
      } else throw error;
    }
  }
  if ((await wallet.getChainId()) !== baseSepolia.id)
    throw new Error('Wrong network.');
  let request;
  let proposalId;
  if (kind === 'propose') {
    const description = `${title.trim()}\n\nVoteMirror testnet demo · ${crypto.randomUUID()}`;
    const calldata = encodeFunctionData({
      abi: tokenAbi,
      functionName: 'faucet',
      args: [deployment.demoGovernor],
    });
    const args = [[deployment.demoToken], [0n], [calldata], description];
    request = {
      address: deployment.demoGovernor,
      abi: governorAbi,
      functionName: 'propose',
      args,
    };
  } else if (kind === 'vote') {
    const proposal = safeProposalId(id);
    const [state, voted] = await Promise.all([
      readGovernor('state', [proposal]),
      readGovernor('hasVoted', [proposal, account]),
    ]);
    if (Number(state) !== 1 || voted)
      throw new Error('Proposal is closed or this wallet has already voted.');
    request = {
      address: deployment.demoGovernor,
      abi: governorAbi,
      functionName: 'castVote',
      args: [proposal, support],
    };
  } else if (kind === 'reconcile') {
    const proposal = safeProposalId(id);
    const [state, voted, skipped, paused, confirmed] = await Promise.all([
      readGovernor('state', [proposal]),
      readGovernor('hasVoted', [proposal, deployment.voteMirror]),
      readMirror('skipped', [proposal]),
      readMirror('paused', []),
      readMirror('confirmedSupport', [proposal]),
    ]);
    if (Number(state) !== 1 || voted || skipped || paused || !confirmed[0])
      throw new Error('This proposal is not eligible for recovery.');
    request = {
      address: deployment.voteMirror,
      abi: mirrorAbi,
      functionName: 'reconcileProposal',
      args: [proposal],
    };
  } else throw new Error('Unsupported action.');
  const { request: simulated } = await base.simulateContract({
    ...request,
    account,
  });
  const hash = await wallet.writeContract(simulated);
  onHash(hash);
  const receipt = await base.waitForTransactionReceipt({
    hash,
    confirmations: 2,
    timeout: 120_000,
  });
  if (receipt.status !== 'success')
    throw new Error('The transaction reverted.');
  if (kind === 'propose') {
    const created = events(receipt, deployment.demoGovernor, governorAbi).find(
      (e) => e.eventName === 'ProposalCreated',
    );
    if (!created) throw new Error('Proposal event not found.');
    proposalId = created.args.proposalId.toString();
  }
  return { hash, proposalId, blockNumber: receipt.blockNumber };
}
