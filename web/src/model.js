export const SUPPORT = ['Against', 'For', 'Abstain'];
export const GOVERNOR_STATES = [
  'Pending',
  'Active',
  'Canceled',
  'Defeated',
  'Succeeded',
  'Queued',
  'Expired',
  'Executed',
];
export const short = (value, start = 6, end = 4) =>
  value ? `${String(value).slice(0, start)}…${String(value).slice(-end)}` : '—';
export const equalAddress = (a, b) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
export function safeProposalId(value) {
  if (!/^[1-9]\d*$/.test(String(value)))
    throw new Error('Enter a decimal proposal ID.');
  const id = BigInt(value);
  if (id >= 2n ** 256n) throw new Error('Proposal ID is outside uint256.');
  return id;
}
export function canonicalAgreement(receipts, threshold) {
  const counts = [0, 0, 0];
  let reached = false;
  let support = null;
  const valid = receipts.filter(
    (r) =>
      r.choice >= 1 &&
      r.choice <= 3 &&
      BigInt(r.sequence) > BigInt(r.floor ?? 0),
  );
  valid.sort((a, b) => (BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1));
  for (const receipt of valid) {
    const side = receipt.choice - 1;
    ++counts[side];
    if (!reached && threshold > 0 && counts[side] >= threshold) {
      reached = true;
      support = side;
    }
  }
  return { counts, reached, support, valid };
}
export function proposalStatus({
  state,
  voted,
  mirrored,
  skipped,
  paused,
  reached,
}) {
  if (voted) return mirrored ? 'Mirrored' : 'Voted';
  if (skipped) return 'Skipped';
  if (state !== 1) return GOVERNOR_STATES[state] ?? 'Unknown';
  if (paused) return 'Paused';
  return reached ? 'Ready to mirror' : 'Awaiting agreement';
}
export function transactionPath(sender, proxy, relayer, owner, recipient) {
  if (
    equalAddress(recipient, proxy) ||
    (!recipient && equalAddress(sender, proxy))
  )
    return 'Reactive callback';
  if (equalAddress(sender, relayer)) return 'Recovery sender';
  if (equalAddress(sender, owner)) return 'Owner recovery';
  return 'Permissionless recovery';
}
export function errorMessage(error) {
  let current = error;
  for (let i = 0; current && i < 8; i++, current = current.cause) {
    if (current.code === 4001 || current.name === 'UserRejectedRequestError')
      return 'Request declined in your wallet. Nothing was sent.';
    if (current.code === -32002)
      return 'A wallet request is already open. Check your wallet extension.';
    if (current.name === 'InsufficientFundsError')
      return 'Your wallet needs Base Sepolia ETH for the network fee.';
    if (current.name === 'ContractFunctionRevertedError')
      return 'The contract rejected this action. Refresh the proposal before trying again.';
  }
  return 'The request could not be completed. Please try again.';
}
export function timeRemaining(deadline, now = Date.now() / 1000) {
  const seconds = Math.max(0, Number(deadline) - now);
  if (!seconds) return 'Voting closed';
  if (seconds < 60) return `${Math.ceil(seconds)}s remaining`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m remaining`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m remaining`;
}
