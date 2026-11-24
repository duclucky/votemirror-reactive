# VoteMirror operational dashboard

A static governance workspace for the current VoteMirror v4 testnet deployment.
UI language is English for the buildathon demo. It uses Vite, vanilla JavaScript
and viem, without a backend, stored signing keys or a wallet service.

This is the core product's operational dashboard: it reads contracts and can submit
real testnet actions through a browser wallet. It is distinct from the public,
read-only [judging demo](https://votemirror-demo.vercel.app), maintained in the
separate [votemirror-demo repository](https://github.com/duclucky/votemirror-demo).
That demo contains recorded walkthroughs, the usage guide and the narrated film;
its playback controls do not connect wallets or send transactions.

## Run

Node 24 is used in CI. From this directory:

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

Vite prints the local URL. `dist/` is the deployable static output and supports
deep links through query parameters and hash navigation, without server rewrites.
Use [votemirror-demo.vercel.app](https://votemirror-demo.vercel.app) as the public
judging link. Running or hosting this operational dashboard is separate and requires
RPC access for its live features.

## Product flows

- **Overview:** current Base policy, voting power and controls; historical decision
  walkthrough; current network read status.
- **Proposals:** choose a Governor registry entry, paste a decimal proposal ID,
  create a valueless-token proposal or cast a ballot with an injected EVM wallet.
- **Trusted policy:** current voters, policy hashes on both networks, owner and
  contract links. Owner configuration changes remain in the existing scripts to
  avoid exposing a partially synchronized cross-chain policy editor.
- **Execution proofs:** nine recorded scenarios, with source files and transaction
  links from the earlier baseline checks. These are historical executions, not a
  live replay or uptime guarantee. The newer eight-scenario submission suite is
  documented in [submission-evidence.md](../docs/submission-evidence.md); the public
  demo includes that suite, the filmed run, and a separate sender recovery.

A wallet is not needed to inspect the dashboard. A signing action requests Base
Sepolia, checks the network again, simulates the contract call, and waits for two
confirmations. A rejected signature is never displayed as a successful transaction.
Recovery is a separate, explicitly labeled direct Base action.

Only the configured trusted voters count toward agreement. A different wallet can
create and vote on demo proposals, but does not become a trusted voter or the owner.
Demo voters share one operator; this is not evidence of independent human consensus.

## Data integrity

`src/generated/evidence.json` is generated from an allowlist of public deployment
fields and nine existing proof files. To update it from the parent repository:

```sh
npm run sync-data
node scripts/sync-data.mjs --check
```

Recorded receipts are rechecked against chain status, target contracts, proposal IDs,
ballot senders and support values, and decoded result events. Callback transactions
target the proxy and include internal VoteMirror logs. Direct recovery targets the
mirror itself. A failed RPC read leaves the historical evidence labeled unverified
for this session rather than pretending the check succeeded.

Live Base reads are pinned to one block. The UI refreshes every 15 seconds while
visible and no dialog or transaction is pending; live sending requires a read less
than 45 seconds old. The visible tab offers a pause control. Lasna availability and
policy alignment are displayed separately. The dashboard cannot measure sender
process uptime. Balances do not establish that fee debts are paid.

Live delivery-log discovery covers the most recent 2,000 Base blocks. Older votes
remain visible through the Governor's `hasVoted`; the UI does not infer an execution
path without a matching log and transaction. Known historical runs use exact hashes.

## Verification

```sh
npm test
npm run test:browser
npm run check:live
```

Browser tests use installed **Google Chrome** locally, in an isolated headless
session. CI uses Playwright Chromium for the deterministic RPC-outage test. The full
browser suite and `check:live` read public testnet RPCs and require network access.
Wallet signing tests use a provider that declines signing; they never transfer funds.

Ignored local screenshots and traces are under `.local/` and `test-results/`.
The production bundle contains no private keys, wallet runtime configuration,
keystores, relayer journal or secret API keys.

## Film a demo

1. Use a desktop browser at 1440×900 or wider. Begin at Overview and show the current
   2-of-3 policy, delegated voting power, and the distinction between custody and votes.
2. Open Proposals → Recorded demos → A shared conviction. After receipts have been
   rechecked, show Alice and Bob, threshold 2, Lasna request, and Base callback. Open
   the transaction links to corroborate the result.
3. Switch to Disagreement and Owner skip to show that neither is forced into a vote.
4. Inspect Delivery has a backup. Explain that this is the Base recovery sender,
   not a Reactive callback. Show the sender's exact transaction on the explorer.
5. Finish on Trusted policy and the repository's security/operating boundaries.

For a fresh live run, open Live workspace. Create a proposal and vote with the
existing demo voter wallets in an extension-enabled browser, or drive the existing
keystore-based demo script in a separate terminal while the frontend follows its ID.
Do not import private keys into the web application. Do not label historical proof
navigation as a newly executed run.
