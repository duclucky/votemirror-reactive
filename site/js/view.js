// Turns the raw chain state into what the page shows. Pure functions: no network, no DOM.

import { sameAddress } from "./abi.js";

export const SUPPORT = ["Against", "For", "Abstain"];
export const PROPOSAL_STATES = ["Pending", "Active", "Canceled", "Defeated", "Succeeded", "Queued", "Expired", "Executed"];
export const SKIP_REASONS = [
  { name: "Paused", text: "mirroring was paused by the owner" },
  { name: "SkippedByOwner", text: "the owner marked this proposal to be skipped" },
  { name: "AlreadyVoted", text: "VoteMirror had already voted on this proposal" },
  { name: "NotActive", text: "voting on the proposal was no longer open" },
  { name: "CastFailed", text: "the Governor rejected the vote" },
  { name: "NotConfirmed", text: "VoteMirror could not confirm on Base Sepolia that enough trusted voters had voted that way" },
];

/** How long after a request a missing callback still counts as on its way. */
export const CALLBACK_GRACE_SECONDS = 600;

export const supportName = (support) => SUPPORT[support] ?? `choice ${support}`;
export const skipReason = (reason) => SKIP_REASONS[reason] ?? { name: `Reason ${reason}`, text: `reason ${reason}` };

// Order of events that share a timestamp across the two chains: cause before effect.
const RANK = { created: 0, pausedSet: 1, skipSet: 1, vote: 2, observed: 3, requested: 4, retried: 4, ownerVote: 5, mirrored: 5, skipped: 5 };

function compareItems(a, b) {
  if (a.sortTime !== b.sortTime) return a.sortTime - b.sortTime;
  if (a.chain === b.chain) return a.block - b.block || a.logIndex - b.logIndex;
  return RANK[a.kind] - RANK[b.kind];
}

/** Proposal title: the first line of its description, without Markdown heading marks. */
export function proposalTitle(description) {
  const line = (description ?? "").split("\n").find((l) => l.trim()) ?? "";
  return line.replace(/^#+\s*/, "").trim() || "Untitled proposal";
}

function buildProposal(created, index, state, now) {
  const { settings, deployment } = state;
  const proposalId = created.proposalId;
  const live = state.proposals[proposalId] ?? {};
  const ofProposal = (event) => event.proposalId === proposalId;
  const baseEvents = state.base.events.filter(ofProposal);
  const lasnaEvents = state.lasna.events.filter(ofProposal);
  const item = (kind, event, extra = {}) => ({
    kind,
    chain: event.chain,
    tx: event.tx,
    block: event.block,
    logIndex: event.logIndex,
    timestamp: event.timestamp,
    sortTime: event.timestamp,
    ...extra,
  });

  const observed = lasnaEvents.filter((event) => event.event === "VoteObserved");
  const followed = (voter) =>
    observed.some((event) => sameAddress(event.voter, voter)) ||
    settings.trustedVoters.some((trusted) => sameAddress(trusted, voter));
  const mirroredTxs = new Set(baseEvents.filter((event) => event.event === "Mirrored").map((event) => event.tx));

  const items = [item("created", created, { proposer: created.proposer })];
  const voteItems = new Map();
  for (const event of baseEvents) {
    if (event.event === "VoteCast" || event.event === "VoteCastWithParams") {
      if (sameAddress(event.voter, deployment.voteMirror)) {
        if (!mirroredTxs.has(event.tx)) {
          items.push(item("ownerVote", event, { support: event.support, weight: event.weight, reason: event.reason }));
        }
      } else if (followed(event.voter)) {
        const vote = item("vote", event, { voter: event.voter, support: event.support, weight: event.weight });
        voteItems.set(event.voter.toLowerCase(), vote);
        items.push(vote);
      }
    } else if (event.event === "Mirrored") {
      items.push(item("mirrored", event, { support: event.support, weight: event.weight }));
    } else if (event.event === "Skipped") {
      items.push(item("skipped", event, { support: event.support, reason: event.reason }));
    } else if (event.event === "SkipSet") {
      items.push(item("skipSet", event, { skipped: event.skipped }));
    }
  }
  for (const event of state.base.events) {
    // Pausing is global; it belongs to this proposal's story if it happened while the vote was open.
    if (event.event === "PausedSet" && event.timestamp >= created.timestamp && event.timestamp <= created.voteEnd) {
      items.push(item("pausedSet", event, { paused: event.paused }));
    }
  }
  for (const event of lasnaEvents) {
    if (event.event === "VoteObserved") {
      const vote = voteItems.get(event.voter.toLowerCase());
      const entry = item("observed", event, { voter: event.voter, support: event.support, agreeing: event.agreeing });
      // A reaction cannot come before the vote it reacts to, whatever the two chains' clocks say.
      if (vote) entry.sortTime = Math.max(entry.sortTime, vote.sortTime);
      items.push(entry);
    } else if (event.event === "MirrorRequested" || event.event === "MirrorRetried") {
      const kind = event.event === "MirrorRequested" ? "requested" : "retried";
      const entry = item(kind, event, { support: event.support, agreeing: event.agreeing });
      const cause = items.find((other) => other.kind === "observed" && other.tx === event.tx);
      if (cause) entry.sortTime = cause.sortTime;
      items.push(entry);
    }
  }
  items.sort(compareItems);

  // Outcome: what VoteMirror ended up doing, read from the ordered events.
  const requests = items.filter((entry) => entry.kind === "requested" || entry.kind === "retried");
  const outcomes = items.filter((entry) => entry.kind === "mirrored" || entry.kind === "skipped");
  const mirrored = outcomes.find((entry) => entry.kind === "mirrored");
  const ownerVote = items.find((entry) => entry.kind === "ownerVote");
  const lastRequest = requests.at(-1);
  const lastOutcome = outcomes.at(-1);
  const governorState = live.state ?? null;
  const active = governorState === 1;
  const agreeing = {};
  for (const event of observed) agreeing[event.support] = event.agreeing;
  const leading = Object.entries(agreeing).sort((a, b) => b[1] - a[1])[0];

  let status;
  if (mirrored) {
    status = { kind: "mirrored", support: mirrored.support, weight: mirrored.weight };
  } else if (ownerVote) {
    status = { kind: "ownerVoted", support: ownerVote.support, weight: ownerVote.weight };
  } else if (lastRequest && (!lastOutcome || items.indexOf(lastRequest) > items.indexOf(lastOutcome))) {
    const waiting = active || now - lastRequest.timestamp < CALLBACK_GRACE_SECONDS;
    status = { kind: waiting ? "pending" : "undelivered", support: lastRequest.support };
  } else if (lastOutcome) {
    status = { kind: "skipped", support: lastOutcome.support, reason: lastOutcome.reason };
  } else if (active || governorState === 0) {
    status = { kind: "watching", agreeing: leading ? leading[1] : 0, support: leading ? Number(leading[0]) : null };
  } else {
    status = { kind: "noAgreement", agreeing: leading ? leading[1] : 0 };
  }

  return {
    number: index + 1,
    proposalId,
    title: proposalTitle(created.description),
    description: created.description,
    proposer: created.proposer,
    createdAt: created.timestamp,
    voteStart: created.voteStart,
    voteEnd: created.voteEnd,
    governorState,
    governorStateName: governorState === null ? "Unknown" : (PROPOSAL_STATES[governorState] ?? `State ${governorState}`),
    votes: live.votes ?? null,
    mirrorHasVoted: live.mirrorHasVoted ?? null,
    skipFlag: live.skipFlag ?? null,
    observedCount: observed.length,
    status,
    items,
  };
}

export function buildView(state, now = Math.floor(Date.now() / 1000)) {
  const created = state.base.events.filter((event) => event.event === "ProposalCreated");
  const proposals = created.map((event, index) => buildProposal(event, index, state, now));
  const count = (kind) => proposals.filter((proposal) => proposal.status.kind === kind).length;
  const observed = state.lasna.events.filter((event) => event.event === "VoteObserved");
  return {
    proposals,
    voters: state.settings.trustedVoters.map((address, index) => ({
      number: index + 1,
      address,
      observed: observed.filter((event) => sameAddress(event.voter, address)).length,
    })),
    summary: {
      proposals: proposals.length,
      mirrored: count("mirrored"),
      skipped: count("skipped"),
      undelivered: count("undelivered"),
      pending: count("pending"),
      watching: count("watching"),
      ownerVoted: count("ownerVoted"),
      noAgreement: count("noAgreement"),
      observedVotes: observed.length,
      requests: state.lasna.events.filter((event) => event.event === "MirrorRequested").length,
      retries: state.lasna.events.filter((event) => event.event === "MirrorRetried").length,
    },
  };
}

/**
 * True when VoteMirror's own copy of the rule (kept on Base Sepolia by the redeployed contract) differs
 * from the reactive contract's. False when they match or when VoteMirror keeps no copy.
 */
export function ruleMismatch(settings) {
  const { mirrorThreshold, mirrorTrustedVoters, threshold, trustedVoters } = settings;
  if (mirrorThreshold === null || mirrorThreshold === undefined || !mirrorTrustedVoters) return false;
  const set = (list) => [...list].map((address) => address.toLowerCase()).sort().join(",");
  return mirrorThreshold !== threshold || set(mirrorTrustedVoters) !== set(trustedVoters);
}

// ------------------------------------------------------------------ formatting

/** Token amount with thousands separators and up to `maxFraction` decimals, trailing zeros dropped. */
export function formatUnits(value, decimals = 18, maxFraction = 4) {
  const amount = BigInt(value);
  const base = 10n ** BigInt(decimals);
  const whole = (amount / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (amount % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;
export const shortHash = (hash) => `${hash.slice(0, 10)}…${hash.slice(-6)}`;
export const shortId = (proposalId) => {
  const text = String(proposalId);
  return text.length > 14 ? `${text.slice(0, 6)}…${text.slice(-6)}` : text;
};

export function formatUtc(seconds) {
  if (!seconds) return "time unknown";
  return new Date(seconds * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

export function timeAgo(seconds, now) {
  const delta = Math.max(0, now - seconds);
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)} min ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)} h ago`;
  return `${Math.floor(delta / 86400)} d ago`;
}
