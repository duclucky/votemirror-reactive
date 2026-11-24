import test from "node:test";
import assert from "node:assert/strict";
import * as view from "../js/view.js";

const MIRROR = "0x00000000000000000000000000000000000000AA";
const VOTERS = ["0x00000000000000000000000000000000000000b1", "0x00000000000000000000000000000000000000B2", "0x00000000000000000000000000000000000000b3"];
const T0 = 1_700_000_000;
const NOW = T0 + 10_000;

/** Builds a state from a compact script of events: [chain, event, secondsAfterT0, fields]. */
function stateOf(script, { proposals = {}, settings = {} } = {}) {
  const events = { base: [], lasna: [] };
  let n = 0;
  for (const [chain, event, at, fields = {}] of script) {
    n++;
    events[chain].push({
      event,
      chain,
      block: at,
      logIndex: n,
      tx: fields.tx ?? `0x${chain}${n}`,
      timestamp: T0 + at,
      proposalId: "1",
      ...fields,
    });
  }
  return {
    deployment: { voteMirror: MIRROR },
    settings: { threshold: 2, trustedVoters: VOTERS, ...settings },
    proposals: { 1: { state: 4, votes: { against: "0", for: "0", abstain: "0" }, mirrorHasVoted: false, skipFlag: false }, ...proposals },
    base: { events: events.base },
    lasna: { events: events.lasna },
  };
}

const created = ["base", "ProposalCreated", 0, { proposer: VOTERS[0], voteStart: T0 + 5, voteEnd: T0 + 3600, description: "# Fund grants\nBody" }];
const vote = (index, at, support = 1) => ["base", "VoteCast", at, { voter: VOTERS[index], support, weight: "1000", reason: "" }];
const observed = (index, at, agreeing, support = 1) => ["lasna", "VoteObserved", at, { voter: VOTERS[index], support, agreeing }];
const requested = (at, tx, support = 1) => ["lasna", "MirrorRequested", at, { support, agreeing: 2, tx }];
const agreed = [created, vote(0, 10), observed(0, 10, 1), vote(1, 12), observed(1, 12, 2, 1), requested(12, "0xreq")];
agreed[4][3].tx = "0xreq";

const only = (state, now = NOW) => view.buildView(state, now).proposals[0];
const kinds = (proposal) => proposal.items.map((item) => item.kind);

test("a mirrored vote: full timeline in causal order across both chains", () => {
  const state = stateOf([
    ...agreed,
    ["base", "VoteCast", 14, { voter: MIRROR, support: 1, weight: "500", reason: "mirror", tx: "0xcb" }],
    ["base", "Mirrored", 14, { support: 1, weight: "500", tx: "0xcb" }],
  ]);
  const proposal = only(state);
  assert.deepEqual(proposal.status, { kind: "mirrored", support: 1, weight: "500", agreeing: 2 });
  assert.deepEqual(kinds(proposal), ["created", "vote", "observed", "vote", "observed", "requested", "mirrored"]);
  assert.equal(proposal.title, "Fund grants");
  assert.equal(proposal.governorStateName, "Succeeded");
  assert.equal(proposal.observedCount, 2);
  const summary = view.buildView(state, NOW).summary;
  assert.deepEqual([summary.proposals, summary.mirrored, summary.skipped, summary.observedVotes, summary.requests, summary.retries], [1, 1, 0, 2, 1, 0]);
  assert.deepEqual(view.buildView(state, NOW).voters.map((voter) => voter.observed), [1, 1, 0]);
});

test("a reaction is never listed before the vote that caused it, even if Lasna's clock is behind", () => {
  const state = stateOf([created, vote(0, 10), observed(0, 9, 1), vote(1, 11), observed(1, 10, 2), requested(10, "0xreq")]);
  state.lasna.events[1].tx = "0xreq";
  assert.deepEqual(kinds(only(state)), ["created", "vote", "observed", "vote", "observed", "requested"]);
  assert.deepEqual(only(state).items.filter((item) => item.kind !== "created").map((item) => item.voter ?? "request"), [
    VOTERS[0], VOTERS[0], VOTERS[1], VOTERS[1], "request",
  ]);
});

test("a skipped vote reports the reason", () => {
  const state = stateOf([
    created,
    ["base", "SkipSet", 1, { skipped: true }],
    ...agreed.slice(1),
    ["base", "Skipped", 14, { support: 1, reason: 1 }],
  ]);
  const proposal = only(state);
  assert.deepEqual(proposal.status, { kind: "skipped", support: 1, reason: 1 });
  assert.deepEqual(kinds(proposal), ["created", "skipSet", "vote", "observed", "vote", "observed", "requested", "skipped"]);
  assert.equal(view.buildView(state, NOW).summary.skipped, 1);
});

test("a retry after a skip ends as mirrored and is counted as a retry", () => {
  const state = stateOf([
    ...agreed,
    ["base", "Skipped", 14, { support: 1, reason: 0 }],
    ["lasna", "MirrorRetried", 60, { support: 1, agreeing: 2 }],
    ["base", "VoteCast", 62, { voter: MIRROR, support: 1, weight: "500", reason: "", tx: "0xcb" }],
    ["base", "Mirrored", 62, { support: 1, weight: "500", tx: "0xcb" }],
  ]);
  const proposal = only(state);
  assert.equal(proposal.status.kind, "mirrored");
  assert.deepEqual(kinds(proposal).slice(-4), ["requested", "skipped", "retried", "mirrored"]);
  const summary = view.buildView(state, NOW).summary;
  assert.deepEqual([summary.mirrored, summary.skipped, summary.retries], [1, 0, 1]);
});

test("a retry that has not been answered yet is pending, then undelivered", () => {
  const state = stateOf([...agreed, ["base", "Skipped", 14, { support: 1, reason: 0 }], ["lasna", "MirrorRetried", 60, { support: 1, agreeing: 2 }]]);
  assert.equal(only(state, T0 + 70).status.kind, "pending");
  assert.equal(only(state, T0 + 60 + view.CALLBACK_GRACE_SECONDS).status.kind, "undelivered");
});

test("a request with no callback is pending for a few minutes, then undelivered", () => {
  const state = stateOf(agreed);
  assert.deepEqual(only(state, T0 + 20).status, { kind: "pending", support: 1 });
  assert.deepEqual(only(state, NOW).status, { kind: "undelivered", support: 1 });
  assert.equal(view.buildView(state, NOW).summary.undelivered, 1);
});

test("below the threshold: watching while open, not reached once closed", () => {
  const script = [created, vote(0, 10, 0), observed(0, 10, 1, 0)];
  const open = stateOf(script, { proposals: { 1: { state: 1 } } });
  assert.deepEqual(only(open).status, { kind: "watching", agreeing: 1, support: 0, threshold: 2 });
  const closed = stateOf(script, { proposals: { 1: { state: 3 } } });
  assert.deepEqual(only(closed).status, { kind: "noAgreement", agreeing: 1, threshold: 2 });
  const untouched = stateOf([created], { proposals: { 1: { state: 0 } } });
  assert.deepEqual(only(untouched).status, { kind: "watching", agreeing: 0, support: null, threshold: 2 });
});

test("the owner's manual vote is shown as such, and votes by strangers are left out", () => {
  const state = stateOf([
    created,
    ["base", "VoteCast", 8, { voter: "0x00000000000000000000000000000000000000ff", support: 0, weight: "9", reason: "" }],
    ["base", "VoteCast", 9, { voter: MIRROR, support: 2, weight: "500", reason: "manual" }],
  ]);
  const proposal = only(state);
  assert.deepEqual(kinds(proposal), ["created", "ownerVote"]);
  assert.deepEqual(proposal.status, { kind: "ownerVoted", support: 2, weight: "500" });
});

test("a vote counted for a voter who was later removed still shows", () => {
  const state = stateOf([created, vote(0, 10), observed(0, 10, 1)], { settings: { trustedVoters: VOTERS.slice(1) } });
  assert.deepEqual(kinds(only(state)), ["created", "vote", "observed"]);
});

test("pausing shows only on proposals that were open at the time", () => {
  const state = stateOf([created, ["base", "PausedSet", 100, { paused: true, proposalId: undefined }], ["base", "PausedSet", 5000, { paused: false, proposalId: undefined }]]);
  assert.deepEqual(kinds(only(state)), ["created", "pausedSet"]);
});

test("unknown proposal state and missing live data do not break the view", () => {
  const state = stateOf([created], { proposals: { 1: {} } });
  const proposal = only(state);
  assert.equal(proposal.governorStateName, "Unknown");
  assert.equal(proposal.votes, null);
  assert.equal(proposal.status.kind, "noAgreement");
});

test("ruleMismatch compares the two chains' copies of the rule", () => {
  const settings = { threshold: 2, trustedVoters: VOTERS };
  assert.equal(view.ruleMismatch({ ...settings, mirrorThreshold: null, mirrorTrustedVoters: null }), false);
  assert.equal(view.ruleMismatch({ ...settings, mirrorThreshold: 2, mirrorTrustedVoters: [...VOTERS].reverse().map((a) => a.toUpperCase().replace("0X", "0x")) }), false);
  assert.equal(view.ruleMismatch({ ...settings, mirrorThreshold: 3, mirrorTrustedVoters: VOTERS }), true);
  assert.equal(view.ruleMismatch({ ...settings, mirrorThreshold: 2, mirrorTrustedVoters: VOTERS.slice(1) }), true);
});

test("labels", () => {
  assert.deepEqual([0, 1, 2, 9].map(view.supportName), ["Against", "For", "Abstain", "choice 9"]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((reason) => view.skipReason(reason).name), ["Paused", "SkippedByOwner", "AlreadyVoted", "NotActive", "CastFailed", "NotConfirmed"]);
  assert.equal(view.skipReason(9).name, "Reason 9");
  assert.equal(view.skipReason(1).label, "Skipped by the owner");
  assert.equal(view.skipReason(9).label, "Skipped: reason 9");
  assert.equal(view.proposalTitle("\n## Hello world \nmore"), "Hello world");
  assert.equal(view.proposalTitle(""), "Untitled proposal");
});

test("formatting", () => {
  assert.equal(view.formatUnits("1000000000000000000000"), "1,000");
  assert.equal(view.formatUnits("19993169686400000"), "0.0199");
  assert.equal(view.formatUnits("4617070200000000000"), "4.617");
  assert.equal(view.formatUnits("0"), "0");
  assert.equal(view.formatUnits("1234567", 6, 2), "1.23");
  assert.equal(view.shortAddress("0x693a59C704615b121752804fB70a8fA3Af210306"), "0x693a…0306");
  assert.equal(view.shortId("21050956219681342699067861559973482979429812992604307250648822920922857859107"), "210509…859107");
  assert.equal(view.shortId("7"), "7");
  assert.equal(view.formatUtc(1795471264), "2026-11-23 22:01:04 UTC");
  assert.equal(view.formatUtc(0), "time unknown");
  assert.deepEqual([5, 125, 7300, 200000].map((age) => view.timeAgo(1000, 1000 + age)), ["5s ago", "2 min ago", "2 h ago", "2 d ago"]);
});

test("a removed voter's vote stops counting towards an open proposal", () => {
  const script = [created, vote(0, 10), observed(0, 10, 1), ["lasna", "TrustedVoterRemoved", 20, { voter: VOTERS[0], proposalId: undefined }]];
  const state = stateOf(script, { settings: { trustedVoters: VOTERS.slice(1) }, proposals: { 1: { state: 1 } } });
  assert.deepEqual(only(state).status, { kind: "watching", agreeing: 0, support: null, threshold: 2 });
  // A removal before the vote was counted (the voter was added back since) does not drop it.
  const readded = stateOf([created, ["lasna", "TrustedVoterRemoved", 5, { voter: VOTERS[0], proposalId: undefined }], vote(0, 10), observed(0, 10, 1)], {
    proposals: { 1: { state: 1 } },
  });
  assert.equal(only(readded).status.agreeing, 1);
  // Once voting has closed, a later removal does not rewrite how far the proposal got.
  const late = stateOf([created, vote(0, 10), observed(0, 10, 1), ["lasna", "TrustedVoterRemoved", 4000, { voter: VOTERS[0], proposalId: undefined }]], {
    proposals: { 1: { state: 3 } },
  });
  assert.deepEqual(only(late).status, { kind: "noAgreement", agreeing: 1, threshold: 2 });
});

test("a proposal is described by the threshold in force at the time, not today's", () => {
  const rule = (at, threshold) => ["lasna", "ThresholdSet", at, { threshold, proposalId: undefined }];
  const state = stateOf([rule(-100, 2), ...agreed, ["base", "Mirrored", 13, { support: 1, weight: "1000" }], rule(5000, 3)], { settings: { threshold: 3 } });
  const proposal = only(state);
  assert.deepEqual(proposal.status, { kind: "mirrored", support: 1, weight: "1000", agreeing: 2 });
  assert.deepEqual(proposal.items.filter((entry) => entry.threshold !== undefined).map((entry) => [entry.kind, entry.agreeing, entry.threshold]), [
    ["observed", 1, 2],
    ["observed", 2, 2],
    ["requested", 2, 2],
  ]);
  const closed = stateOf([rule(-100, 2), created, vote(0, 10), observed(0, 10, 1), rule(5000, 3)], { settings: { threshold: 3 }, proposals: { 1: { state: 3 } } });
  assert.deepEqual(only(closed).status, { kind: "noAgreement", agreeing: 1, threshold: 2 });
  const open = stateOf([rule(-100, 2), created, vote(0, 10), observed(0, 10, 1), rule(50, 3)], { settings: { threshold: 3 }, proposals: { 1: { state: 1 } } });
  assert.deepEqual(only(open).status, { kind: "watching", agreeing: 1, support: 1, threshold: 3 });
});
