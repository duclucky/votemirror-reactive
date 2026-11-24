import './style.css';
import { formatUnits, formatEther } from 'viem';
import {
  deployment as d,
  scenarios,
  REPOSITORY,
  baseExplorer,
  lasnaExplorer,
  readWorkspace,
  readReactive,
  readProposal,
  readDelivery,
  readRequested,
  verifyScenario,
  sendAction,
} from './chain.js';
import {
  SUPPORT,
  GOVERNOR_STATES,
  short,
  escapeHtml as esc,
  equalAddress,
  canonicalAgreement,
  proposalStatus,
  safeProposalId,
  errorMessage,
  timeRemaining,
} from './model.js';
import { icon, logo } from './icons.js';

const app = document.querySelector('#app');
const state = {
  tab: 'overview',
  mode: 'recorded',
  scenario: scenarios[0],
  workspace: null,
  source: null,
  baseError: false,
  sourceError: false,
  loading: true,
  refreshing: false,
  selectedId: null,
  proposal: null,
  proposalError: null,
  delivery: null,
  deliveryUnavailable: false,
  requested: null,
  provider: null,
  account: null,
  walletChain: null,
  pending: null,
  notice: null,
  autoRefresh: true,
  verified: new Map(),
  verifying: false,
  verificationError: false,
};
let selectionVersion = 0;
let refreshVersion = 0;
const providers = new Map();
const knownProposals = new Map();
const sibling = (name) => `${REPOSITORY}/blob/main/${name}`;
const txLink = (hash, network = 'base', label = short(hash)) =>
  hash
    ? `<a class="tx-link" href="${network === 'base' ? baseExplorer : lasnaExplorer}/tx/${hash}" target="_blank" rel="noopener noreferrer">${esc(label)}${icon('link')}</a>`
    : '<span class="muted">Not recorded</span>';
const addressLink = (address, network = 'base', label = short(address)) =>
  `<a class="address-link" href="${network === 'base' ? baseExplorer : lasnaExplorer}/address/${address}" target="_blank" rel="noopener noreferrer" title="${address}">${esc(label)}${icon('link')}</a>`;
const namedVoter = (address) => {
  const i = d.trustedVoters.findIndex((a) => equalAddress(a, address));
  return i >= 0 ? ['Alice', 'Bob', 'Carol'][i] : short(address);
};
const badge = (label, tone = '') =>
  `<span class="badge ${tone}">${esc(label)}</span>`;
const unit = (value, decimals = 18, maximumFractionDigits = 2) =>
  Number(formatUnits(BigInt(value ?? 0), decimals)).toLocaleString('en-US', {
    maximumFractionDigits,
  });
const updated = (time) =>
  time
    ? new Date(time).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : 'Not synced';
const disabled = (condition) => (condition ? ' disabled' : '');
const stale = () =>
  !state.workspace ||
  state.baseError ||
  Date.now() - state.workspace.fetchedAt > 45_000;
const statusTone = (status) =>
  ['Mirrored', 'Succeeded', 'Active', 'Ready to mirror'].includes(status)
    ? 'green'
    : ['Skipped', 'Paused', 'No consensus', 'Defeated'].includes(status)
      ? 'amber'
      : '';

function render() {
  const focusId = document.activeElement?.id;
  app.innerHTML = `
    <aside class="sidebar">
      <a href="#overview" class="brand" data-tab="overview" aria-label="VoteMirror overview"><span class="brand-mark">${logo}</span><span>VoteMirror<span class="brand-sub">GOVERNANCE, IN SYNC</span></span></a>
      <div class="workspace-label"><span class="workspace-avatar">V</span><div>Demo workspace<small>Base Sepolia · v4</small></div><span class="workspace-tag">TESTNET</span></div>
      <div class="nav-label">WORKSPACE</div>
      <nav aria-label="Main navigation">
        ${[
          ['overview', 'grid', 'Overview'],
          ['proposals', 'layers', 'Proposals'],
          ['policy', 'shield', 'Trusted policy'],
          ['proof', 'activity', 'Execution proofs'],
        ]
          .map(
            ([id, glyph, name]) =>
              `<a id="nav-${id}" href="#${id}" data-tab="${id}" aria-label="${name}" class="nav-item ${state.tab === id ? 'selected' : ''}" ${state.tab === id ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${name}</span>${id === 'proof' ? '<span class="nav-count">9</span>' : ''}</a>`,
          )
          .join('')}
      </nav>
      <div class="sidebar-note"><span class="sidebar-note-icon">${icon('shield')}</span><strong>Your tokens stay yours.</strong><p>Delegate voting power.<br>Keep custody and control.</p></div>
      <div class="sidebar-bottom"><a href="${REPOSITORY}" target="_blank" rel="noopener noreferrer">${icon('code')}Source code${icon('link')}</a><a href="${sibling('docs/recovery-v4.md')}" target="_blank" rel="noopener noreferrer">${icon('book')}Documentation${icon('link')}</a><div class="build-note">Built with Reactive Omni<span>Base Sepolia + Reactive Lasna</span></div></div>
    </aside>
    <div class="shell">
      <header class="topbar"><div class="breadcrumb">Workspace<span>/</span><strong>${{ overview: 'Overview', proposals: 'Proposals', policy: 'Trusted policy', proof: 'Execution proofs' }[state.tab]}</strong></div><div class="top-actions"><span class="network-pill"><span class="base-symbol">−</span>Base Sepolia</span><button id="wallet-button" class="button ${state.account ? 'secondary' : 'dark'} small" data-action="wallet">${icon('wallet')}<span>${state.account ? esc(short(state.account)) : 'Connect wallet'}</span></button></div></header>
      <main id="main" tabindex="-1">
        ${state.notice ? noticeMarkup() : ''}
        ${state.baseError ? `<div class="banner warning" role="status">${icon('info')}<div><strong>Base RPC is unavailable.</strong> ${state.workspace ? 'Previously fetched data is shown. Actions are disabled until a fresh sync.' : 'Recorded demos remain available. Live actions need a fresh connection.'}</div><button data-action="refresh" class="text-button">Try again</button></div>` : ''}
        ${state.tab === 'overview' ? overview() : state.tab === 'proposals' ? proposalsPage() : state.tab === 'policy' ? policyPage() : proofPage()}
        <footer class="page-footer"><span>VoteMirror <span class="footer-dot">·</span> Governance on your terms.</span><span>Testnet assets have no monetary value.</span></footer>
      </main>
    </div>`;
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}

function pageHeading(eyebrow, title, text, action = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${text}</p></div>${action}</div>`;
}
function syncControl() {
  return `<button id="refresh-button" class="button secondary small" data-action="refresh"${disabled(state.refreshing)}>${icon('refresh', state.refreshing ? 'spinning' : '')}<span>${state.refreshing ? 'Syncing…' : 'Refresh'}</span></button>`;
}
function overview() {
  const w = state.workspace;
  return `${pageHeading('YOUR GOVERNANCE, ON AUTOPILOT', 'Good decisions. Mirrored.', 'Follow the people you trust, without giving up your voice.', syncControl())}
    <section class="hero-panel" aria-labelledby="hero-title"><div class="hero-copy"><div class="hero-kicker"><span class="tiny-line"></span>TRUSTED VOTERS. SHARED CONVICTION.</div><h2 id="hero-title">Your vote follows<br>agreement. <em>Not noise.</em></h2><p>When your trusted circle agrees, VoteMirror casts your DAO vote. You keep your tokens — and the final say.</p><div class="hero-actions"><button class="button mint" data-action="live">${icon('layers')}Open live workspace</button><button class="hero-link" data-tab="policy">See your policy${icon('chevron')}</button></div></div><div class="mirror-illustration" aria-label="Two of three trusted voters agree and VoteMirror follows"><div class="illustration-label">THE AGREEMENT LOOP</div><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="avatar-node alice">A<span>${icon('check')}</span></div><div class="avatar-node bob">B<span>${icon('check')}</span></div><div class="avatar-node carol">C</div><div class="mirror-node">${logo}</div><div class="agreement-pill">${icon('check')}2 of 3 agree</div><div class="diagram-caption">Trusted circle<span class="diagram-line"></span>Your vote</div></div></section>
    <section class="metrics" aria-label="Current policy metrics">
      ${metric('Trusted threshold', w ? `${w.threshold}<span> / ${w.trusted.length}</span>` : '—', 'Same-side agreement required', 'network')}
      ${metric('Delegated voting power', w ? `${unit(w.votingPower)}<span> VMD</span>` : '—', 'Voting power, never token custody', 'layers')}
      ${metric('Mirror control', w ? (w.paused ? 'Paused' : 'Enabled') : 'Syncing', w ? `Base read at ${updated(w.fetchedAt)}` : 'Reading current contract state', 'shield', w && !w.paused ? 'metric-good' : '')}
    </section>
    ${workspacePanel()}
    <section class="bottom-grid"><div class="panel policy-summary"><div class="section-title"><h2>Your trusted circle</h2><button class="text-button" data-tab="policy">View policy${icon('chevron')}</button></div><p class="section-copy">A small circle. A clear threshold.</p>${voterCircle()}<div class="policy-caption">${icon('shield')}Independent verification on Base before every mirrored vote.</div></div><div class="panel network-summary"><div class="section-title"><h2>Connected networks</h2>${badge('Testnet')}</div>${networkRows()}<p class="network-footnote">Event-driven subscriptions + a separate recovery sender.<br>Cron recovery: ${state.source ? (state.source.recoveryEnabled ? '<strong>on</strong>' : '<strong>off</strong>') : '<strong>unavailable</strong>'}. Sender uptime is not measured by this page.</p></div></section>`;
}
function metric(label, value, caption, glyph, tone = '') {
  return `<div class="metric ${tone}"><div class="metric-label">${label}${icon(glyph)}</div><div class="metric-value">${value}</div><div class="metric-caption">${caption}</div></div>`;
}
function voterCircle() {
  const trusted = state.workspace?.trusted ?? d.trustedVoters;
  return `<div class="voter-circle">${trusted
    .slice(0, 5)
    .map(
      (address, i) =>
        `<div class="circle-person"><span class="person-avatar avatar-${i % 3}">${esc(namedVoter(address).slice(0, 1))}</span><strong>${esc(namedVoter(address))}</strong>${addressLink(address)}</div>`,
    )
    .join('')}</div>`;
}
function networkRows() {
  return `<div class="network-row"><span class="network-logo base-logo">−</span><div><strong>Base Sepolia</strong><small>Governor &amp; VoteMirror</small></div><div class="network-state">${state.workspace && !state.baseError ? badge('Synced', 'green') : badge(state.baseError ? 'Unavailable' : 'Connecting', 'amber')}<small>${state.workspace ? `Block ${state.workspace.blockNumber.toLocaleString()}` : 'Reading chain…'}</small></div></div><div class="network-row"><span class="network-logo reactive-logo">${icon('activity')}</span><div><strong>Reactive Lasna</strong><small>Event processing &amp; callbacks</small></div><div class="network-state">${state.source && !state.sourceError ? badge('Synced', 'green') : badge(state.sourceError ? 'Unavailable' : 'Connecting', 'amber')}<small>${state.source ? `Block ${state.source.blockNumber.toLocaleString()}` : 'Reading chain…'}</small></div></div>`;
}
function workspacePanel() {
  return `<section class="panel execution-panel" aria-label="Proposal execution"><div class="execution-header"><div><div class="section-title"><h2>Follow a decision</h2>${badge(state.mode === 'recorded' ? 'Recorded demo' : 'Live workspace', state.mode === 'live' ? 'blue' : '')}</div><p class="section-copy">From a trusted ballot to a verifiable vote.</p></div><div class="segmented" aria-label="Data source"><button id="mode-recorded" class="${state.mode === 'recorded' ? 'active' : ''}" aria-pressed="${state.mode === 'recorded'}" data-action="recorded">Recorded demos</button><button id="mode-live" class="${state.mode === 'live' ? 'active' : ''}" aria-pressed="${state.mode === 'live'}" data-action="live">Live workspace</button></div></div>${state.mode === 'recorded' ? recordedDecision() : liveDecision()}</section>`;
}
function recordedDecision() {
  const s = state.scenario;
  const verification = state.verified.get(s.mode);
  const agrees = s.mode !== 'split';
  const blocked = ['skip', 'split'].includes(s.mode);
  return `<div class="scenario-picker"><label for="scenario">Demo scenario</label><div class="select-wrap"><select id="scenario">${scenarios.map((item) => `<option value="${item.mode}"${item.mode === s.mode ? ' selected' : ''}>${item.title} · ${item.path}</option>`).join('')}</select>${icon('down')}</div><span class="recorded-note">Historical on-chain transactions</span></div>
    <div class="proposal-heading"><div><div class="proposal-meta">DEMO GOVERNOR <span>·</span> ${esc(short(s.proposalId, 5, 4))}</div><h3>${esc(s.title)}</h3><p>${esc(s.summary)}</p></div>${badge(s.outcome, statusTone(s.outcome))}</div>
    <div class="decision-grid"><div class="ballots-panel"><div class="mini-heading">TRUSTED BALLOTS<span>2 recorded ballots</span></div>${s.ballots.map((ballot, i) => ballotRow(ballot.voter, ballot.support, i + 1, ballot.tx)).join('')}<div class="ballot-row"><span class="person-avatar avatar-2">C</span><div class="ballot-person"><strong>${s.ballots.some((b) => equalAddress(b.voter, d.trustedVoters[2])) ? 'Bob' : 'Carol'}</strong><small>No ballot in this run</small></div><span class="muted ballot-choice">—</span></div></div><div class="consensus-panel"><div class="mini-heading">SAME-SIDE AGREEMENT</div><div class="consensus-numeral">${agrees ? '2' : '1'}<span> / 2</span></div><div class="consensus-track"><span style="width:${agrees ? '100' : '50'}%"></span></div><strong>${agrees ? `Threshold reached · ${SUPPORT[s.support]}` : 'Threshold not reached'}</strong><p>${s.mode === 'skip' ? 'The owner’s skip takes priority.' : agrees ? 'Two trusted addresses chose the same side.' : 'Different choices never add up to consensus.'}</p></div></div>
    ${executionTimeline([
      {
        title: 'Ballots cast',
        subtitle: 'Base Sepolia',
        hash: s.ballots[1].tx,
        done: true,
      },
      {
        title: s.reactiveTx
          ? 'Reactive request'
          : s.mode === 'sender'
            ? 'Base recovery'
            : s.mode === 'split'
              ? 'No agreement'
              : 'Recorded trigger',
        subtitle: s.reactiveTx ? 'Reactive Lasna' : s.path,
        hash: s.reactiveTx,
        network: 'lasna',
        done: !!s.reactiveTx || s.mode === 'sender',
        neutral: !s.reactiveTx,
      },
      {
        title: blocked ? s.outcome : 'Vote mirrored',
        subtitle: blocked ? 'Owner controls respected' : s.path,
        hash: s.resultTx,
        done: !blocked,
        neutral: blocked,
      },
    ])}
    <div class="evidence-footer"><div class="verification-state ${verification ? 'verified' : ''}">${icon(verification ? 'shield' : 'info')}<span>${verification ? `Receipts rechecked at ${updated(verification.verifiedAt)}${s.reactiveTx ? ' · Base + Lasna' : ' · Base'}` : state.verifying ? 'Rechecking transaction receipts…' : state.verificationError ? 'Receipt check unavailable. Saved evidence is shown.' : 'Saved evidence · not rechecked this session'}</span></div><button id="verify-evidence" class="text-button" data-action="verify"${disabled(state.verifying)}>${icon('refresh', state.verifying ? 'spinning' : '')}Recheck receipts</button><a href="${sibling(`deployments/${s.sourceFile}`)}" class="text-link" target="_blank" rel="noopener noreferrer">Evidence file${icon('code')}</a></div>`;
}
function ballotRow(address, support, order, hash, excluded = false) {
  const idx = d.trustedVoters.findIndex((a) => equalAddress(a, address));
  return `<div class="ballot-row"><span class="person-avatar avatar-${Math.max(0, idx) % 3}">${esc(namedVoter(address).slice(0, 1))}</span><div class="ballot-person"><strong>${esc(namedVoter(address))}</strong><small>${excluded ? 'Before current trust policy' : order ? `Ballot #${order}` : 'No ballot yet'}${hash ? ` · ${txLink(hash, 'base', 'Transaction')}` : ''}</small></div>${support === null ? '<span class="muted">Awaiting vote</span>' : badge(SUPPORT[support], excluded ? '' : support === 1 ? 'green' : support === 0 ? 'rose' : '')}</div>`;
}
function executionTimeline(items) {
  return `<div class="execution-timeline">${items.map((step, i) => `<div class="execution-step ${step.done ? 'complete' : ''} ${step.neutral ? 'neutral' : ''}"><span class="step-icon">${icon(step.done ? 'check' : step.neutral ? 'pause' : 'clock')}</span><div><strong>${step.title}</strong><small>${esc(step.subtitle)}</small>${step.hash ? txLink(step.hash, step.network) : ''}</div>${i < items.length - 1 ? '<span class="step-connector"></span>' : ''}</div>`).join('')}</div>`;
}
function liveDecision() {
  const p = state.proposal;
  const w = state.workspace;
  if (!w)
    return `<div class="empty-state">${icon(state.baseError ? 'info' : 'refresh', state.loading ? 'spinning' : '')}<h3>${state.baseError ? 'Waiting for a Base connection' : 'Reading your workspace'}</h3><p>Your policy and proposals are loaded directly from deployed contracts.</p><button class="button secondary" data-action="refresh">Retry connection</button></div>`;
  const pick = `<div class="live-controls"><div class="select-wrap"><select id="live-proposal" aria-label="Choose live proposal"><option value="">Select a proposal</option>${w.proposals.map((item) => `<option value="${item.id}"${item.id === state.selectedId ? ' selected' : ''}>${esc(knownProposals.get(item.id)?.title ?? short(item.id, 9, 6))} · ${GOVERNOR_STATES[item.state]}</option>`).join('')}${state.selectedId && !w.proposals.some((item) => item.id === state.selectedId) ? `<option value="${state.selectedId}" selected>${esc(short(state.selectedId, 9, 6))}</option>` : ''}</select>${icon('down')}</div><button class="button secondary small" data-action="lookup">${icon('search')}Find by ID</button><button class="button dark small" data-action="new">${icon('plus')}New proposal</button></div>`;
  if (!state.selectedId)
    return `${pick}<div class="empty-state">${icon('layers')}<h3>A fresh decision starts here.</h3><p>Create a testnet proposal, or choose an existing one.<br>Trusted ballots and delivery update automatically.</p><button class="button dark" data-action="new">${icon('plus')}Create proposal</button></div>`;
  if (state.proposalError)
    return `${pick}<div class="empty-state"><h3>Could not read this proposal.</h3><p>Check the ID and Base connection. No state has been assumed.</p><button class="button secondary" data-action="refresh">Retry</button></div>`;
  if (!p || p.id !== state.selectedId)
    return `${pick}<div class="empty-state">${icon('refresh', 'spinning')}<h3>Loading proposal…</h3><p>Reading timestamp, ballot receipts and mirror status.</p></div>`;
  const agreement = canonicalAgreement(p.receipts, w.threshold);
  const status = proposalStatus({
    ...p,
    paused: w.paused,
    mirrored: !!state.delivery,
  });
  const canVote =
    state.account &&
    equalAddress(p.account, state.account) &&
    p.state === 1 &&
    !state.pending &&
    !stale();
  const didVote = p.accountVoted;
  const currentPolicyMatches =
    state.source &&
    state.source.policyHash === w.policyHash &&
    !state.sourceError;
  return `${pick}<div class="proposal-heading"><div><div class="proposal-meta">DEMO GOVERNOR <span>·</span>${esc(short(p.id, 8, 6))}<button class="icon-button" data-copy="${p.id}" aria-label="Copy proposal ID">${icon('copy')}</button></div><h3>${esc(knownProposals.get(p.id)?.title ?? 'Governance proposal')}</h3><p>${GOVERNOR_STATES[p.state]} · ${timeRemaining(p.deadline, w.timestamp)} · Reads at Base block ${p.blockNumber.toLocaleString()}</p></div>${badge(status, statusTone(status))}</div>
    <div class="decision-grid"><div class="ballots-panel"><div class="mini-heading">TRUSTED BALLOTS<span>Current policy</span></div>${p.receipts.map((r) => ballotRow(r.voter, r.choice ? r.choice - 1 : null, r.sequence ? String(r.sequence) : null, null, r.choice > 0 && r.sequence <= r.floor)).join('')}</div><div class="consensus-panel"><div class="mini-heading">SAME-SIDE AGREEMENT</div><div class="consensus-numeral">${Math.max(...agreement.counts)}<span> / ${w.threshold}</span></div><div class="consensus-track"><span style="width:${Math.min(100, (Math.max(...agreement.counts) / w.threshold) * 100)}%"></span></div><strong>${p.reached ? `${SUPPORT[p.support]} has reached the threshold` : 'Awaiting trusted agreement'}</strong><p>${p.reached ? 'Winning side verified from Governor receipt order.' : 'Against, For and Abstain each have their own count.'}</p>${!currentPolicyMatches ? '<span class="inline-warning">Reactive policy unavailable or out of sync.</span>' : ''}</div></div>
    ${executionTimeline([
      {
        title: 'Trusted ballots',
        subtitle: `${p.receipts.filter((r) => r.choice > 0).length} of ${w.trusted.length} addresses voted`,
        done: agreement.reached,
      },
      {
        title:
          state.requested > 0 ? 'Callback requested' : 'Reactive subscription',
        subtitle:
          state.requested > 0
            ? `${SUPPORT[state.requested - 1]} · current policy`
            : state.requested === null
              ? 'Source read unavailable'
              : 'Waiting for a matching event',
        done: state.requested > 0,
      },
      {
        title: p.voted
          ? state.delivery
            ? 'Vote mirrored'
            : 'Vote recorded'
          : p.skipped
            ? 'Owner skipped'
            : w.paused
              ? 'Mirroring paused'
              : 'Awaiting delivery',
        subtitle:
          state.delivery?.path ??
          (state.deliveryUnavailable
            ? 'Delivery trace unavailable'
            : p.voted
              ? 'Governor confirms VoteMirror voted'
              : 'Base Sepolia'),
        hash: state.delivery?.hash,
        done: p.voted,
        neutral: p.skipped || w.paused,
      },
    ])}
    <div class="vote-actions"><div><strong>Cast your ballot</strong><p>${!state.account ? 'Connect a wallet to vote on Base Sepolia.' : didVote ? 'Your trusted address has already voted.' : !w.trusted.some((a) => equalAddress(a, state.account)) ? 'You can vote, but only trusted addresses count toward the mirror threshold.' : p.state !== 1 ? 'Voting is not open for this proposal.' : 'Your wallet signs the ballot. VoteMirror follows trusted agreement.'}</p></div><div class="vote-buttons">${SUPPORT.map((label, i) => `<button class="button ${i === 1 ? 'dark' : 'secondary'} small" data-vote="${i}"${disabled(!canVote || didVote)}>${label}</button>`).join('')}</div></div>
    <div class="evidence-footer"><span>${icon('clock')}Updated ${updated(p.fetchedAt)} · automatic refresh every 15s</span><button id="auto-refresh" class="text-button" data-action="auto" aria-pressed="${state.autoRefresh}">${state.autoRefresh ? 'Pause updates' : 'Resume updates'}</button><button class="text-button" data-action="recover"${disabled(!state.account || stale() || state.pending || p.state !== 1 || p.voted || p.skipped || w.paused || !p.reached)}>Recover delivery</button></div>`;
}
function proposalsPage() {
  return `${pageHeading('DECISIONS, WITH CONTEXT', 'Proposals', 'Watch trusted agreement become a vote.', `<button class="button dark" data-action="new">${icon('plus')}New proposal</button>`)}${workspacePanel()}<section class="panel proposal-list"><div class="section-title"><h2>On-chain proposal registry</h2>${badge(`${state.workspace?.proposals.length ?? 0} entries`)}</div><p class="section-copy">The Governor retains up to 32 open entries. Closed entries are pruned when new proposals are created.</p>${state.workspace?.proposals.length ? `<div class="table-scroll"><table><thead><tr><th>Proposal</th><th>Governor state</th><th>Network</th><th><span class="sr-only">Open proposal</span></th></tr></thead><tbody>${state.workspace.proposals.map((p) => `<tr><td><strong>${esc(knownProposals.get(p.id)?.title ?? 'Governance proposal')}</strong><span class="mono muted">${short(p.id, 14, 8)}</span></td><td>${badge(GOVERNOR_STATES[p.state], p.state === 1 ? 'green' : '')}</td><td>Base Sepolia</td><td><button class="button secondary small" data-proposal="${p.id}">Open${icon('chevron')}</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state compact"><p>No registry data is available yet.</p></div>'}</section>`;
}
function policyPage() {
  const w = state.workspace;
  const source = state.source;
  const aligned =
    w &&
    source &&
    !state.baseError &&
    !state.sourceError &&
    w.policyHash === source.policyHash;
  return `${pageHeading('A POLICY YOU CAN VERIFY', 'Trust, with boundaries.', 'One token holder. A trusted circle. A threshold you can inspect.', syncControl())}<section class="policy-layout"><div class="panel"><div class="section-title"><h2>Trusted voters</h2>${badge(`${w?.threshold ?? d.threshold} of ${w?.trusted.length ?? d.trustedVoters.length} required`, 'green')}</div><p class="section-copy">Each trusted address counts once. Only matching choices reach agreement.</p><div class="policy-voters">${(w?.trusted ?? d.trustedVoters).map((address, i) => `<div class="policy-voter"><span class="person-avatar avatar-${i % 3}">${esc(namedVoter(address)[0])}</span><div><strong>${esc(namedVoter(address))}</strong>${addressLink(address)}</div>${badge(w ? 'Trusted on Base' : 'Deployment record', w ? 'green' : '')}</div>`).join('')}</div><div class="policy-caption">${icon('info')}Demo voters share an operator. They demonstrate the mechanism, not independent decision-making.</div></div><div class="panel policy-rules"><h2>Control stays with the owner</h2>${[
    [
      'shield',
      'Keep custody',
      'Tokens stay in the holder’s wallet. Only voting power is delegated.',
    ],
    [
      'pause',
      'Pause or skip',
      'Owner controls are checked before automated and recovery votes.',
    ],
    [
      'network',
      'Verify before voting',
      'Base validates ordered Governor receipts and the callback policy.',
    ],
  ]
    .map(
      ([glyph, title, text]) =>
        `<div class="rule">${icon(glyph)}<div><h3>${title}</h3><p>${text}</p></div></div>`,
    )
    .join(
      '',
    )}</div></section><section class="panel contracts-panel"><div class="section-title"><h2>Policy &amp; deployment</h2>${badge(aligned ? 'Policies match' : w && source ? 'Policy mismatch' : 'Awaiting both chains', aligned ? 'green' : 'amber')}</div><p class="section-copy">Current reads are separate from the historical policies used in recorded demos.</p><dl class="policy-facts"><div><dt>Owner</dt><dd>${addressLink(w?.owner ?? d.owner)}</dd></div><div><dt>Base policy hash</dt><dd class="hash-value">${w ? esc(w.policyHash) : 'Unavailable'}</dd></div><div><dt>Lasna policy hash</dt><dd class="hash-value">${source ? esc(source.policyHash) : 'Unavailable'}</dd></div><div><dt>Optional Cron recovery</dt><dd>${source ? (source.recoveryEnabled ? 'Enabled' : 'Disabled to conserve testnet fees') : 'Unavailable'}</dd></div></dl><div class="table-scroll"><table><thead><tr><th>Contract</th><th>Network</th><th>Address</th><th>Contract balance</th></tr></thead><tbody>${[
    ['DemoToken', 'Base Sepolia', d.demoToken, 'base', null],
    ['DemoGovernor', 'Base Sepolia', d.demoGovernor, 'base', null],
    ['VoteMirror', 'Base Sepolia', d.voteMirror, 'base', w?.balance],
    [
      'MirrorReactive',
      'Reactive Lasna',
      d.mirrorReactive,
      'lasna',
      source?.balance,
    ],
  ]
    .map(
      ([name, network, address, chain, balance]) =>
        `<tr><td><strong>${name}</strong></td><td>${network}</td><td>${addressLink(address, chain)}</td><td>${balance == null ? '—' : `${Number(formatEther(balance)).toLocaleString('en-US', { maximumFractionDigits: 5 })} ${chain === 'base' ? 'ETH' : 'lREACT'}`}</td></tr>`,
    )
    .join(
      '',
    )}</tbody></table></div><div class="evidence-footer"><span>Balances do not prove fee debt is zero or guarantee delivery.</span><a class="text-link" href="${sibling('docs/recovery-v4.md')}" target="_blank" rel="noopener noreferrer">Read security boundaries${icon('book')}</a></div></section>`;
}
function proofPage() {
  return `${pageHeading('SHOW THE WORK', 'Every claim has a transaction.', 'Nine recorded testnet scenarios. Inspect the origin, the execution path and the result.', `<a class="button secondary" href="${sibling('deployments/v4-verification.json')}" target="_blank" rel="noopener noreferrer">${icon('code')}Verification report</a>`)}<div class="proof-intro"><span class="proof-seal">${icon('shield')}</span><p>These are historical tests, not live uptime metrics. Direct sender and owner recoveries are labeled separately from Reactive callbacks.</p></div><section class="proof-grid">${scenarios.map((s, i) => `<button class="panel proof-card" data-scenario="${s.mode}"><div class="proof-card-top"><span class="proof-icon">${icon(['shield', 'layers', 'network', 'pause', 'refresh', 'wallet', 'clock', 'activity', 'wallet'][i])}</span>${badge(s.outcome, statusTone(s.outcome))}</div><h2>${esc(s.title)}</h2><p>${esc(s.summary)}</p><div class="proof-card-bottom"><span>${s.path}</span><span>Inspect${icon('chevron')}</span></div></button>`).join('')}</section>`;
}
function noticeMarkup() {
  return `<div class="banner ${state.notice.error ? 'warning' : 'success'}" role="status">${icon(state.notice.error ? 'info' : 'check')}<div><strong>${esc(state.notice.title)}</strong>${state.notice.text ? `<span>${esc(state.notice.text)}</span>` : ''}${state.notice.hash ? txLink(state.notice.hash, 'base', 'View transaction') : ''}</div><button class="icon-button" data-action="dismiss" aria-label="Dismiss notification">${icon('close')}</button></div>`;
}

function notify(message) {
  const region = document.querySelector('#notifications');
  region.innerHTML = `<div class="toast">${icon('check')}${esc(message)}</div>`;
  setTimeout(() => region.replaceChildren(), 3500);
}
function updateRoute() {
  const url = new URL(location.href);
  url.hash = state.tab;
  url.searchParams.set('view', state.mode);
  if (state.mode === 'recorded') {
    url.searchParams.set('demo', state.scenario.mode);
    url.searchParams.delete('proposal');
  } else {
    url.searchParams.delete('demo');
    if (state.selectedId) url.searchParams.set('proposal', state.selectedId);
    else url.searchParams.delete('proposal');
  }
  history.replaceState(null, '', url);
}
function goTab(tab) {
  state.tab = tab;
  updateRoute();
  render();
  document.querySelector('#main')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}
async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  const version = ++refreshVersion;
  render();
  const [baseResult, sourceResult] = await Promise.allSettled([
    readWorkspace(),
    readReactive(),
  ]);
  if (version !== refreshVersion) return;
  state.baseError = baseResult.status === 'rejected';
  state.sourceError = sourceResult.status === 'rejected';
  if (baseResult.status === 'fulfilled') state.workspace = baseResult.value;
  if (sourceResult.status === 'fulfilled') state.source = sourceResult.value;
  state.loading = false;
  state.refreshing = false;
  if (state.mode === 'live' && !state.selectedId && state.workspace)
    state.selectedId =
      state.workspace.proposals.find((p) => p.state === 1)?.id ?? null;
  render();
  if (state.mode === 'live' && state.selectedId && !state.baseError)
    await loadSelected();
}
async function loadSelected() {
  if (!state.selectedId || !state.workspace || state.baseError) return;
  const version = ++selectionVersion;
  const id = state.selectedId;
  state.proposalError = null;
  try {
    const proposal = await readProposal(id, state.workspace, state.account);
    if (
      version !== selectionVersion ||
      state.mode !== 'live' ||
      state.selectedId !== id
    )
      return;
    state.proposal = proposal;
    state.delivery = null;
    state.deliveryUnavailable = false;
    state.requested = null;
    render();
    const [delivery, requested] = await Promise.allSettled([
      readDelivery(
        id,
        knownProposals.get(id)?.blockNumber,
        proposal.blockNumber,
      ),
      readRequested(id),
    ]);
    if (
      version !== selectionVersion ||
      state.mode !== 'live' ||
      state.selectedId !== id
    )
      return;
    state.delivery = delivery.status === 'fulfilled' ? delivery.value : null;
    state.deliveryUnavailable = delivery.status === 'rejected';
    state.requested = requested.status === 'fulfilled' ? requested.value : null;
  } catch {
    if (version === selectionVersion) state.proposalError = true;
  }
  if (version === selectionVersion) render();
}
async function selectScenario(mode) {
  ++selectionVersion;
  state.mode = 'recorded';
  state.scenario = scenarios.find((s) => s.mode === mode) ?? scenarios[0];
  state.verificationError = false;
  updateRoute();
  render();
  if (!state.verified.has(state.scenario.mode)) await checkEvidence();
}
async function checkEvidence() {
  if (state.verifying) return;
  const scenario = state.scenario;
  state.verifying = true;
  state.verificationError = false;
  render();
  try {
    state.verified.set(scenario.mode, await verifyScenario(scenario));
  } catch {
    if (state.scenario.mode === scenario.mode) state.verificationError = true;
  } finally {
    state.verifying = false;
    render();
  }
}
async function openLive(id) {
  state.mode = 'live';
  if (id) {
    state.selectedId = id;
    state.proposal = null;
    state.proposalError = null;
  } else if (!state.selectedId)
    state.selectedId =
      state.workspace?.proposals.find((p) => p.state === 1)?.id ?? null;
  updateRoute();
  render();
  if (state.workspace && !stale()) await loadSelected();
  else await refresh();
}

function openDialog(title, body) {
  document.querySelector('#action-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'action-dialog';
  dialog.className = 'action-dialog';
  dialog.innerHTML = `<div class="dialog-header"><div class="eyebrow">VOTEMIRROR WORKSPACE</div><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div><h2>${title}</h2>${body}`;
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
function createDialog() {
  openDialog(
    'Put a decision on-chain.',
    `<p class="dialog-description">Create a real proposal in the testnet DemoGovernor. The proposed action mints valueless demo tokens to the Governor.</p><form id="proposal-form"><label for="proposal-title">Proposal title</label><input id="proposal-title" name="title" required minlength="5" maxlength="120" placeholder="Fund the next community workshop" autocomplete="off"><div class="form-note">${icon('info')}Base Sepolia transaction. Your wallet pays the network fee.</div><p id="form-error" class="form-error" role="alert"></p><button class="button dark full" type="submit"${disabled(!state.account || !!state.pending || stale())}>${icon('plus')}Create proposal</button>${!state.account ? '<button class="button secondary full" type="button" data-action="wallet">Connect wallet first</button>' : ''}</form>`,
  );
}
function lookupDialog() {
  openDialog(
    'Find a proposal.',
    `<p class="dialog-description">Paste the decimal ID of a proposal in this workspace’s DemoGovernor.</p><form id="lookup-form"><label for="proposal-id">Proposal ID</label><input id="proposal-id" name="id" required inputmode="numeric" placeholder="4975796977408826…" autocomplete="off"><p id="form-error" class="form-error" role="alert"></p><button class="button dark full" type="submit">${icon('search')}Open proposal</button></form>`,
  );
}
function walletDialog() {
  if (state.account) {
    openDialog(
      'Your connected wallet.',
      `<div class="connected-wallet">${icon('wallet')}<strong class="hash-value">${esc(state.account)}</strong>${badge(state.walletChain === 84532 ? 'Base Sepolia' : 'Switches to Base Sepolia before signing', state.walletChain === 84532 ? 'green' : 'amber')}</div><p class="dialog-description">Only actions you confirm in your wallet are sent. This dashboard never asks for a private key.</p><button class="button secondary full" data-action="disconnect">Disconnect from dashboard</button>`,
    );
    return;
  }
  const injected = window.ethereum;
  if (injected && !providers.size)
    providers.set('injected', { name: 'Browser wallet', provider: injected });
  openDialog(
    'Connect your wallet.',
    `<p class="dialog-description">Use a browser wallet to create proposals and cast testnet ballots. Viewing evidence needs no wallet.</p>${providers.size ? `<div class="wallet-list">${[...providers].map(([key, wallet]) => `<button class="button secondary full" data-provider="${esc(key)}">${icon('wallet')}${esc(wallet.name)}${icon('chevron')}</button>`).join('')}</div>` : `<div class="wallet-empty">${icon('wallet')}<strong>No browser wallet detected</strong><p>Open this dashboard in a browser with an EVM wallet extension, then connect here.</p><button class="button secondary full" data-action="copy-url">${icon('copy')}Copy dashboard link</button></div>`}<div class="form-note">${icon('shield')}Base Sepolia only. No mainnet transactions.</div>`,
  );
}
function recoverDialog() {
  openDialog(
    'Recover this delivery?',
    `<p class="dialog-description">This sends a direct Base Sepolia reconciliation, paid by your wallet. VoteMirror still verifies agreement, pause and skip controls.</p><div class="form-note">${icon('info')}This is a separate recovery path. It will be labeled as direct recovery, not a Reactive callback.</div><button class="button dark full" data-action="confirm-recover">Confirm in wallet</button>`,
  );
}
function voteDialog(support) {
  openDialog(
    `Vote ${SUPPORT[support]}?`,
    `<p class="dialog-description">Cast a real ballot on the selected testnet proposal. Accepted ballots cannot be changed.</p><dl class="transaction-summary"><div><dt>Proposal</dt><dd>${esc(short(state.selectedId, 12, 8))}</dd></div><div><dt>Your choice</dt><dd>${badge(SUPPORT[support], support === 1 ? 'green' : '')}</dd></div><div><dt>Network</dt><dd>Base Sepolia</dd></div></dl><button class="button dark full" data-confirm-vote="${support}">Confirm in wallet</button>`,
  );
}

let listenersProvider;
const accountsChanged = (accounts) => {
  state.account = accounts[0] ?? null;
  render();
  if (state.mode === 'live') loadSelected();
};
const chainChanged = (id) => {
  state.walletChain = Number(id);
  render();
};
async function connect(key) {
  const wallet = providers.get(key);
  if (!wallet) return;
  const button = document.querySelector(`[data-provider="${CSS.escape(key)}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = 'Check your wallet…';
  }
  try {
    const accounts = await wallet.provider.request({
      method: 'eth_requestAccounts',
    });
    if (!accounts.length) throw new Error('No account.');
    listenersProvider?.removeListener?.('accountsChanged', accountsChanged);
    listenersProvider?.removeListener?.('chainChanged', chainChanged);
    state.provider = wallet.provider;
    state.account = accounts[0];
    state.walletChain = Number(
      await wallet.provider.request({ method: 'eth_chainId' }),
    );
    listenersProvider = wallet.provider;
    listenersProvider.on?.('accountsChanged', accountsChanged);
    listenersProvider.on?.('chainChanged', chainChanged);
    document.querySelector('dialog')?.close();
    render();
    notify('Wallet connected.');
    if (state.mode === 'live') loadSelected();
  } catch (error) {
    document.querySelector('dialog')?.close();
    state.notice = {
      title: 'Wallet connection not completed.',
      text: errorMessage(error),
      error: true,
    };
    render();
  }
}
async function transact(kind, args) {
  if (state.pending) return;
  if (!state.provider || !state.account) {
    walletDialog();
    return;
  }
  if (stale()) {
    state.notice = {
      title: 'Refresh required.',
      text: 'A fresh Base read is needed before sending a transaction.',
      error: true,
    };
    render();
    return;
  }
  document.querySelector('dialog')?.close();
  state.pending = { kind };
  state.notice = {
    title: 'Confirm in your wallet.',
    text: 'Review the Base Sepolia transaction before signing.',
  };
  render();
  try {
    const result = await sendAction(state.provider, kind, args, (hash) => {
      state.pending = { kind, hash };
      state.notice = {
        title: 'Transaction submitted.',
        text: 'Waiting for two confirmations on Base Sepolia.',
        hash,
      };
      render();
    });
    state.walletChain = 84532;
    state.notice = {
      title: 'Transaction confirmed.',
      text:
        kind === 'propose'
          ? 'Proposal created. The voting delay is set by the Governor.'
          : kind === 'vote'
            ? 'Your ballot is recorded. Follow the agreement and delivery below.'
            : 'Reconciliation confirmed. Refreshing the Governor’s vote state.',
      hash: result.hash,
    };
    if (result.proposalId) {
      knownProposals.set(result.proposalId, {
        title: args.title,
        blockNumber: result.blockNumber,
      });
      state.selectedId = result.proposalId;
      state.proposal = null;
      state.mode = 'live';
      updateRoute();
    }
  } catch (error) {
    const hash = state.pending?.hash;
    state.notice = {
      title: hash
        ? 'Confirmation could not be established.'
        : 'Action not completed.',
      text: hash
        ? 'The transaction may still be pending. Inspect it before submitting again.'
        : errorMessage(error),
      hash,
      error: true,
    };
  } finally {
    state.pending = null;
    render();
    await refresh();
  }
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button,a');
  if (!button) return;
  if (button.dataset.tab) {
    event.preventDefault();
    goTab(button.dataset.tab);
    return;
  }
  if (button.dataset.scenario) {
    goTab('overview');
    await selectScenario(button.dataset.scenario);
    return;
  }
  if (button.dataset.proposal) {
    await openLive(button.dataset.proposal);
    window.scrollTo({ top: 0 });
    return;
  }
  if (button.dataset.copy) {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      notify('Proposal ID copied.');
    } catch {
      notify('Clipboard unavailable. Select and copy the ID.');
    }
    return;
  }
  if (button.dataset.provider) {
    await connect(button.dataset.provider);
    return;
  }
  if (button.dataset.vote !== undefined) {
    voteDialog(Number(button.dataset.vote));
    return;
  }
  if (button.dataset.confirmVote !== undefined) {
    await transact('vote', {
      id: state.selectedId,
      support: Number(button.dataset.confirmVote),
    });
    return;
  }
  switch (button.dataset.action) {
    case 'refresh':
      await refresh();
      break;
    case 'live':
      await openLive();
      break;
    case 'recorded':
      await selectScenario(state.scenario.mode);
      break;
    case 'verify':
      await checkEvidence();
      break;
    case 'new':
      createDialog();
      break;
    case 'lookup':
      lookupDialog();
      break;
    case 'wallet':
      walletDialog();
      break;
    case 'close-dialog':
      document.querySelector('dialog')?.close();
      break;
    case 'disconnect':
      listenersProvider?.removeListener?.('accountsChanged', accountsChanged);
      listenersProvider?.removeListener?.('chainChanged', chainChanged);
      state.account = null;
      state.provider = null;
      state.walletChain = null;
      document.querySelector('dialog')?.close();
      render();
      break;
    case 'dismiss':
      state.notice = null;
      render();
      break;
    case 'auto':
      state.autoRefresh = !state.autoRefresh;
      render();
      break;
    case 'recover':
      recoverDialog();
      break;
    case 'confirm-recover':
      await transact('reconcile', { id: state.selectedId });
      break;
    case 'copy-url':
      try {
        await navigator.clipboard.writeText(location.href);
        notify('Dashboard link copied.');
      } catch {
        notify('Copy the dashboard URL from your address bar.');
      }
      break;
  }
});
document.addEventListener('change', async (event) => {
  if (event.target.id === 'scenario') await selectScenario(event.target.value);
  if (event.target.id === 'live-proposal' && event.target.value)
    await openLive(event.target.value);
});
document.addEventListener('submit', async (event) => {
  if (event.target.getAttribute('id') === 'lookup-form') {
    event.preventDefault();
    try {
      const id = safeProposalId(new FormData(event.target).get('id').trim());
      document.querySelector('dialog')?.close();
      await openLive(id.toString());
    } catch {
      document.querySelector('#form-error').textContent =
        'Enter a valid decimal proposal ID between 1 and 2²⁵⁶ − 1.';
    }
  }
  if (event.target.getAttribute('id') === 'proposal-form') {
    event.preventDefault();
    const title = new FormData(event.target).get('title').trim();
    if (title.length < 5 || title.length > 120) {
      document.querySelector('#form-error').textContent =
        'Use between 5 and 120 characters.';
      return;
    }
    await transact('propose', { title });
  }
});
window.addEventListener('eip6963:announceProvider', (event) => {
  const { info, provider } = event.detail ?? {};
  if (!info?.uuid || !provider?.request) return;
  providers.set(info.uuid, { name: info.name, provider });
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
function restoreRoute() {
  const url = new URL(location.href);
  const tab = url.hash.slice(1);
  if (['overview', 'proposals', 'policy', 'proof'].includes(tab))
    state.tab = tab;
  if (url.searchParams.get('view') === 'live') state.mode = 'live';
  const demo = scenarios.find((s) => s.mode === url.searchParams.get('demo'));
  if (demo) state.scenario = demo;
  const id = url.searchParams.get('proposal');
  if (id) {
    try {
      state.selectedId = safeProposalId(id).toString();
      state.mode = 'live';
    } catch {
      /* Invalid deep link stays in the default workspace. */
    }
  }
}
window.addEventListener('popstate', () => {
  restoreRoute();
  render();
  if (state.mode === 'live') loadSelected();
});
restoreRoute();
render();
refresh();
if (state.mode === 'recorded') checkEvidence();
setInterval(() => {
  if (
    state.autoRefresh &&
    !document.hidden &&
    !document.querySelector('dialog') &&
    !state.pending
  )
    refresh();
}, 15_000);
