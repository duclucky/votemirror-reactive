// Page controller: loads the state, renders it, refreshes it. Chain-provided text is only ever set as text.

import { loadState, createClients, STATE_VERSION } from "./chain.js";
import { NETWORKS } from "./networks.js";
import * as view from "./view.js";
import { sameAddress } from "./abi.js";

const REFRESH_SECONDS = 30;
const OPEN_BY_DEFAULT = 3;

/** Small DOM builder: h("a", { href }, "text", child). Strings become text nodes. */
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const ext = (href, ...children) => h("a", { href, target: "_blank", rel: "noopener noreferrer" }, ...children);
const chainBadge = (key) => h("span", { class: `chain ${key}` }, NETWORKS[key].name);
const txLink = (chain, hash) =>
  ext(NETWORKS[chain].tx(hash), h("span", { class: "mono" }, view.shortHash(hash)), h("span", { class: "arrow", "aria-hidden": "true" }, " ↗"));
const addressLink = (chain, address, { full = false } = {}) =>
  ext(
    NETWORKS[chain].address(address),
    h("span", { class: full ? "mono addr-full" : "mono nowrap", title: address }, full ? address : view.shortAddress(address)),
  );
const supportPill = (support) =>
  h("span", { class: `choice choice-${support}` }, view.supportName(support));

function voterLabel(state, address) {
  const index = state.settings.trustedVoters.findIndex((voter) => sameAddress(voter, address));
  return index >= 0 ? `Trusted voter ${index + 1}` : "Former trusted voter";
}

function statusBadge(status) {
  const map = {
    mirrored: ["ok", `Mirrored: voted ${view.supportName(status.support)}`],
    ownerVoted: ["ok", `Owner voted ${view.supportName(status.support)} directly`],
    skipped: ["warn", view.skipReason(status.reason).label],
    pending: ["info", "Callback on its way"],
    undelivered: ["bad", "Callback not delivered"],
    watching: ["info", "Watching for trusted votes"],
    noAgreement: ["muted", "Threshold not reached"],
  };
  const [tone, text] = map[status.kind];
  return h("span", { class: `status ${tone}` }, text);
}

function statusSentence(proposal, state) {
  const { status } = proposal;
  const { tokenSymbol, tokenDecimals } = state.settings;
  const voters = (count) => (count === 1 ? "1 trusted voter" : `${count} trusted voters`);
  const votes = (weight) => `${view.formatUnits(weight, tokenDecimals)} ${tokenSymbol ?? "votes"}`;
  switch (status.kind) {
    case "mirrored":
      return `VoteMirror cast ${view.supportName(status.support)} with ${votes(status.weight)} after ${status.agreeing === null ? "enough trusted voters" : voters(status.agreeing)} agreed.${
        status.byHand
          ? " The reactive contract had not requested a callback, so the owner requested it by hand."
          : !status.retried
          ? ""
          : status.skipReason === null
            ? " The first callback was not delivered, so the owner asked again."
            : ` The first callback was skipped (${view.skipReason(status.skipReason).text}); the owner asked again and the vote was cast.`
      }`;
    case "ownerVoted":
      return `The owner cast ${view.supportName(status.support)} through VoteMirror by hand, with ${votes(status.weight)}.`;
    case "skipped":
      return `The callback arrived and VoteMirror did not vote: ${view.skipReason(status.reason).text}.`;
    case "pending":
      return `The threshold was reached and the callback to Base Sepolia has been requested. It usually lands within seconds.`;
    case "undelivered":
      return `The threshold was reached and a callback was requested on Reactive Lasna, but it was not delivered to VoteMirror on Base Sepolia (the relay transaction failed or was never sent), so no vote was cast.`;
    case "watching":
      return `${status.agreeing} of the ${status.threshold} trusted votes needed so far.`;
    default:
      return `Voting closed before ${voters(status.threshold)} agreed (${status.agreeing} did), so nothing was mirrored.`;
  }
}

function itemText(entry, state) {
  const { tokenSymbol, tokenDecimals } = state.settings;
  const symbol = tokenSymbol ?? "votes";
  const who = entry.voter ? [h("strong", {}, voterLabel(state, entry.voter)), " (", addressLink("base", entry.voter), ")"] : [];
  switch (entry.kind) {
    case "created":
      return ["Proposal created by ", addressLink("base", entry.proposer)];
    case "vote":
      return [...who, " voted ", supportPill(entry.support), ` with ${view.formatUnits(entry.weight, tokenDecimals)} ${symbol}`];
    case "observed":
      return ["Reactive contract counted the vote of ", ...who, ": ", h("strong", {}, `${entry.agreeing} of ${entry.threshold}`), " needed for ", supportPill(entry.support)];
    case "requested":
      return [h("strong", {}, "Threshold reached"), ": callback requested to cast ", supportPill(entry.support)];
    case "retried":
      return entry.first
        ? [h("strong", {}, "Owner requested the callback by hand"), " to cast ", supportPill(entry.support)]
        : [h("strong", {}, "Owner asked again"), " (retry): callback requested to cast ", supportPill(entry.support)];
    case "mirrored":
      return [h("strong", {}, "VoteMirror voted "), supportPill(entry.support), ` with ${view.formatUnits(entry.weight, tokenDecimals)} ${symbol}`];
    case "skipped":
      if (view.skipReason(entry.reason).name === "NotConfirmed" && entry.required !== null && entry.required > entry.confirmed) {
        return [
          h("strong", {}, "VoteMirror skipped the vote"),
          `: its own copy of the rule on Base Sepolia required ${entry.required} of its trusted voters to have voted at that moment, and ${entry.confirmed} had (NotConfirmed)`,
        ];
      }
      return [h("strong", {}, "VoteMirror skipped the vote"), `: ${view.skipReason(entry.reason).text} (${view.skipReason(entry.reason).name})`];
    case "skipSet":
      return entry.skipped ? "Owner marked this proposal to be skipped" : "Owner removed the skip mark from this proposal";
    case "thresholdSet":
      return [`Owner set the threshold kept on ${NETWORKS[entry.chain].name} to `, h("strong", {}, String(entry.threshold))];
    case "trustedAdded":
      return [`Owner added a trusted voter on ${NETWORKS[entry.chain].name}: `, addressLink("base", entry.voter)];
    case "trustedRemoved":
      return [`Owner removed a trusted voter on ${NETWORKS[entry.chain].name}: `, addressLink("base", entry.voter)];
    case "pausedSet":
      return entry.paused ? "Owner paused mirroring" : "Owner resumed mirroring";
    case "ownerVote":
      return ["Owner voted ", supportPill(entry.support), " through VoteMirror by hand"];
    default:
      return entry.kind;
  }
}

function tally(proposal, state) {
  if (!proposal.votes) return null;
  const { tokenDecimals } = state.settings;
  const parts = [
    ["For", proposal.votes.for, 1],
    ["Against", proposal.votes.against, 0],
    ["Abstain", proposal.votes.abstain, 2],
  ];
  return h(
    "dl",
    { class: "tally" },
    parts.map(([label, value, support]) =>
      h("div", {}, h("dt", { class: `choice-text-${support}` }, label), h("dd", {}, view.formatUnits(value, tokenDecimals))),
    ),
  );
}

function proposalCard(proposal, state, open, now) {
  const steps = proposal.items.map((entry) =>
    h(
      "li",
      { class: `step ${entry.chain} kind-${entry.kind}` },
      h("div", { class: "step-main" }, itemText(entry, state)),
      h(
        "div",
        { class: "step-meta" },
        chainBadge(entry.chain),
        h("time", { datetime: new Date(entry.timestamp * 1000).toISOString() }, view.formatUtc(entry.timestamp)),
        txLink(entry.chain, entry.tx),
      ),
    ),
  );
  // OpenZeppelin Governors count either in timestamps (this demo) or in block numbers.
  const timed = proposal.voteEnd > 1_000_000_000;
  const closed = timed ? proposal.voteEnd <= now : proposal.voteEnd <= state.base.head.block;
  const deadline = timed ? view.formatUtc(proposal.voteEnd) : `block ${proposal.voteEnd.toLocaleString("en-US")}`;
  return h(
    "details",
    { class: `proposal tone-${proposal.status.kind}`, open, "data-proposal": proposal.proposalId },
    h(
      "summary",
      {},
      h("span", { class: "p-num" }, `#${proposal.number}`),
      h("span", { class: "p-title" }, proposal.title),
      statusBadge(proposal.status),
    ),
    h(
      "div",
      { class: "p-body" },
      h("p", { class: "p-sentence" }, statusSentence(proposal, state)),
      h(
        "div",
        { class: "p-facts" },
        h("div", {}, h("span", { class: "label" }, "Governor state"), h("span", {}, proposal.governorStateName)),
        h("div", {}, h("span", { class: "label" }, closed ? "Voting closed" : "Voting closes"), h("span", {}, deadline)),
        h("div", {}, h("span", { class: "label" }, "Proposal id"), h("span", { class: "mono", title: proposal.proposalId }, view.shortId(proposal.proposalId))),
        h("div", { class: "fact-tally" }, h("span", { class: "label" }, "Tally on the Governor"), tally(proposal, state) ?? "unavailable"),
      ),
      h("ol", { class: "steps" }, steps),
    ),
  );
}

function stat(value, label, hint, tone = "") {
  return h("div", { class: `stat ${tone}` }, h("div", { class: "stat-value" }, value), h("div", { class: "stat-label" }, label), hint && h("div", { class: "stat-hint" }, hint));
}

function render(state, { openIds }) {
  const now = Math.floor(Date.now() / 1000);
  const model = view.buildView(state, now);
  const { settings, deployment } = state;
  const { summary } = model;
  const decimals = settings.tokenDecimals;
  const symbol = settings.tokenSymbol ?? "votes";
  const governor = settings.governorName ?? "Governor";

  const rule = h(
    "section",
    { class: "card rule", "aria-labelledby": "rule-title" },
    h("h2", { id: "rule-title" }, "The rule right now"),
    h(
      "p",
      { class: "rule-line" },
      h("span", { class: "big" }, `${settings.threshold} of ${settings.trustedVoters.length}`),
      " trusted voters must agree before VoteMirror votes. ",
      h("span", { class: `status ${settings.paused ? "warn" : "ok"}` }, settings.paused ? "Mirroring is paused" : "Mirroring is on"),
    ),
    h(
      "ul",
      { class: "voters" },
      model.voters.map((voter) =>
        h(
          "li",
          {},
          h("span", { class: "voter-name" }, `Trusted voter ${voter.number}`),
          addressLink("base", voter.address, { full: true }),
          h("span", { class: "voter-seen" }, `${voter.observed} ${voter.observed === 1 ? "vote" : "votes"} counted`),
        ),
      ),
    ),
    view.ruleMismatch(settings)
      ? h(
          "p",
          { class: "notice inline" },
          `The rule on Base Sepolia differs: VoteMirror itself requires ${settings.mirrorThreshold} of ${settings.mirrorTrustedVoters.length} trusted voters. A vote is only cast when both chains agree.`,
        )
      : settings.mirrorTrustedVoters
        ? h("p", { class: "fine" }, "The same rule is stored on both chains: VoteMirror checks it again on Base Sepolia before voting.")
        : null,
    h(
      "p",
      { class: "fine" },
      `VoteMirror votes with ${settings.votingPower === null ? "its delegated" : view.formatUnits(settings.votingPower, decimals)} ${symbol} of voting power on “${governor}”. `,
      "Owner: ",
      settings.mirrorOwner ? addressLink("base", settings.mirrorOwner) : "unknown",
      ".",
    ),
  );

  const stats = h(
    "section",
    { class: "stats", "aria-label": "Totals since deployment" },
    stat(summary.proposals, summary.proposals === 1 ? "proposal seen" : "proposals seen", `since block ${state.base.fromBlock.toLocaleString("en-US")}`),
    stat(summary.observedVotes, summary.observedVotes === 1 ? "trusted vote counted" : "trusted votes counted", "on Reactive Lasna"),
    stat(summary.mirrored, summary.mirrored === 1 ? "vote mirrored" : "votes mirrored", "cast by VoteMirror", "ok"),
    stat(summary.skipped, summary.skipped === 1 ? "proposal skipped" : "proposals skipped", "VoteMirror did not vote", "warn"),
    summary.undelivered > 0 && stat(summary.undelivered, summary.undelivered === 1 ? "callback not delivered" : "callbacks not delivered", "requested, never reached VoteMirror", "bad"),
    summary.retries > 0 && stat(summary.retries, summary.retries === 1 ? "retry by the owner" : "retries by the owner", "callback requested by hand", "info"),
    summary.pending + summary.watching > 0 && stat(summary.pending + summary.watching, "in progress", "open right now", "info"),
  );

  const ordered = [...model.proposals].reverse();
  const defaultOpen = new Set(ordered.slice(0, OPEN_BY_DEFAULT).map((proposal) => proposal.proposalId));
  const isOpen = (proposal) => (openIds ? openIds.has(proposal.proposalId) : defaultOpen.has(proposal.proposalId));
  const list = h(
    "section",
    { class: "proposals", "aria-labelledby": "proposals-title" },
    h(
      "div",
      { class: "section-head" },
      h("h2", { id: "proposals-title" }, "Proposals"),
      h("p", {}, "Newest first. Open one to follow the vote across both chains, step by step, with a link to every transaction."),
      h("p", { class: "fine" }, "Times are each chain's own block time, so a step on Reactive Lasna can show a second earlier than the Base Sepolia vote that caused it."),
    ),
    ordered.length
      ? ordered.map((proposal) => proposalCard(proposal, state, isOpen(proposal), now))
      : h("p", { class: "empty" }, "No proposals yet on this deployment. The first one will appear here within seconds of being created."),
    state.base.complete && state.lasna.complete
      ? null
      : h("p", { class: "fine" }, "Older history could not be scanned completely, so earlier proposals may be missing."),
  );

  const row = (name, chain, address, role) =>
    h("tr", {}, h("th", { scope: "row" }, name), h("td", {}, chainBadge(chain)), h("td", { class: "cell-address" }, addressLink(chain, address, { full: true })), h("td", {}, role));
  const balance = (value, chain) => (value === null ? "unknown" : `${view.formatUnits(value, 18)} ${NETWORKS[chain].currency}`);
  const contracts = h(
    "section",
    { class: "card", "aria-labelledby": "contracts-title" },
    h("h2", { id: "contracts-title" }, "Contracts"),
    h(
      "div",
      { class: "table-scroll" },
      h(
        "table",
        {},
        h("thead", {}, h("tr", {}, h("th", {}, "Contract"), h("th", {}, "Chain"), h("th", {}, "Address"), h("th", {}, "What it does"))),
        h(
          "tbody",
          {},
          row("MirrorReactive", "lasna", deployment.mirrorReactive, `Counts trusted votes and requests the callback. Balance for reactions: ${balance(settings.reactiveBalance, "lasna")}.`),
          row("VoteMirror", "base", deployment.voteMirror, `Receives the callback and casts the vote. Balance for callbacks: ${balance(settings.mirrorBalance, "base")}.`),
          row(governor, "base", deployment.governor, "The Governor whose proposals are followed (a demo Governor on testnet)."),
          row(`${symbol} token`, "base", deployment.token, "Voting token of the demo Governor."),
          row("Callback proxy", "base", deployment.callbackProxy, "Reactive Network's contract that delivers callbacks on Base Sepolia."),
        ),
      ),
    ),
    sameAddress(deployment.mirrorReactive, deployment.token)
      ? h("p", { class: "fine" }, `MirrorReactive and the ${symbol} token are two separate contracts that happen to have the same address on two different chains.`)
      : null,
    settings.watchedGovernor && !sameAddress(settings.watchedGovernor, deployment.governor)
      ? h("p", { class: "fine" }, "Note: the reactive contract follows a different Governor than the one listed here.")
      : null,
  );

  const app = document.getElementById("app");
  app.replaceChildren(h("div", { class: "grid-top" }, rule, stats), list, contracts);
  app.setAttribute("aria-busy", "false");
}

// ------------------------------------------------------------------ loading and refreshing

const liveText = document.getElementById("live-text");
const liveDot = document.getElementById("live-dot");
const refreshButton = document.getElementById("refresh");
const notice = document.getElementById("notice");

let state = null;
let live = false;
let loading = false;
let lastError = null;
let deploymentJson = null;
const clients = createClients();

async function fetchJson(urls) {
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return await response.json();
    } catch {
      // Try the next location.
    }
  }
  return null;
}

function openProposalIds() {
  const nodes = document.querySelectorAll("details.proposal");
  if (!nodes.length) return null;
  return new Set([...nodes].filter((node) => node.open).map((node) => node.dataset.proposal));
}

function updateHeader() {
  const now = Math.floor(Date.now() / 1000);
  liveDot.className = `dot ${loading && !state ? "busy" : live ? "on" : state ? "stale" : "off"}`;
  if (!state) {
    liveText.textContent = lastError ? "Could not reach the testnets" : "Reading both chains…";
  } else {
    const age = view.timeAgo(Math.floor(state.fetchedAt / 1000), now);
    const blocks = `Base block ${state.base.head.block.toLocaleString("en-US")} · Lasna block ${state.lasna.head.block.toLocaleString("en-US")}`;
    liveText.textContent = live ? `Live · updated ${age} · ${blocks}` : `Saved copy from ${view.formatUtc(Math.floor(state.fetchedAt / 1000))}`;
  }
  refreshButton.hidden = loading && !state;
  refreshButton.disabled = loading;
  if (lastError && state && !live) {
    notice.hidden = false;
    notice.textContent = `Live data could not be loaded (${lastError}). Showing the copy saved when this page was last published; it will update as soon as the testnet nodes answer.`;
  } else if (lastError && !state) {
    notice.hidden = false;
    notice.textContent = `The public testnet nodes did not answer (${lastError}). Retrying automatically.`;
  } else if (lastError) {
    notice.hidden = false;
    notice.textContent = `The last refresh failed (${lastError}). Showing the data from the previous one; retrying automatically.`;
  } else {
    notice.hidden = true;
  }
}

async function refresh() {
  if (loading) return;
  loading = true;
  updateHeader();
  try {
    deploymentJson ??= await fetchJson(["deployment.json", "../deployments/testnet.json"]);
    if (!deploymentJson) throw new Error("deployment file not found");
    const next = await loadState(deploymentJson, { clients, previous: live ? state : null });
    const openIds = live ? openProposalIds() : null;
    state = next;
    live = true;
    lastError = null;
    render(state, { openIds });
  } catch (error) {
    lastError = error?.message ?? String(error);
    if (!state) {
      document.getElementById("loading-text").textContent = "Waiting for the testnet nodes to answer…";
    }
  } finally {
    loading = false;
    updateHeader();
  }
}

async function start() {
  refreshButton.addEventListener("click", refresh);
  const first = refresh();
  // A copy saved at publish time fills the page at once and stays if the public nodes are down.
  const snapshot = await fetchJson(["snapshot.json"]);
  if (snapshot?.version === STATE_VERSION && !state) {
    state = snapshot;
    render(state, { openIds: null });
    updateHeader();
  }
  await first;
  setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, REFRESH_SECONDS * 1000);
  setInterval(updateHeader, 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state && Date.now() - state.fetchedAt > REFRESH_SECONDS * 1000) refresh();
  });
}

start();
