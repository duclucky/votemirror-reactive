# VoteMirror

Vote in a DAO automatically when the voters you trust agree, without giving anyone your tokens.

Built for the Reactive Omni Buildathon on [Reactive Network](https://reactive.network). Testnet only.

## Problem

Most governance token holders do not vote: reading every proposal takes time. The usual fix is to delegate to one
person, which hands that person all of your voting power on every proposal.

VoteMirror is a middle ground. You pick `n` voters you trust and a threshold `k`. When `k` of them vote the same way
on a proposal, VoteMirror casts the same vote with your voting power. You can still vote yourself, skip a single
proposal, or pause mirroring at any time.

Your tokens never move. You only delegate voting power (`ERC20Votes.delegate`) to your own VoteMirror contract, and
you can take it back with one transaction.

## Architecture

```
 Base Sepolia (84532)                          Reactive Lasna (5318007)
┌──────────────────────────┐   VoteCast log   ┌──────────────────────────────┐
│ Governor (OpenZeppelin)  │ ───────────────▶ │ MirrorReactive.react()       │
│   trusted voter votes    │                  │   counts trusted votes per   │
└──────────────────────────┘                  │   proposal, k of n agree?    │
            ▲                                 └──────────────┬───────────────┘
            │ castVoteWithReason                             │ requestCallback
┌───────────┴──────────────┐   callback via   ┌──────────────▼───────────────┐
│ VoteMirror.castMirrored()│ ◀─────────────── │ Reactive callback proxy      │
│   paused? skipped? voted?│   callback proxy │   (on Base Sepolia)          │
└──────────────────────────┘                  └──────────────────────────────┘
```

| Contract | Chain | Role |
| --- | --- | --- |
| [`MirrorReactive`](src/MirrorReactive.sol) | Reactive Lasna | Subscribes to `VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)` on the Governor, one subscription per trusted voter (topic 0 and topic 1), so it only pays for votes it cares about. Records each trusted voter once per proposal and requests one callback per proposal when `k` agree. |
| [`VoteMirror`](src/VoteMirror.sol) | Base Sepolia | Receives the callback and calls `governor.castVoteWithReason`. Holds the voting power the user delegated to it. Owner controls: `castVote` (override), `setSkipped`, `setPaused`. |
| [`DemoToken`](src/demo/DemoToken.sol), [`DemoGovernor`](src/demo/DemoGovernor.sol) | Base Sepolia | A standard OpenZeppelin `ERC20Votes` token and `Governor` for the demo. Any OpenZeppelin Governor works. |

Design decisions:

- **Callback authorization is double checked.** `castMirrored` requires `msg.sender` to be the Reactive callback
  proxy and the first argument, which Reactive overwrites with the address of the requesting reactive contract, to be
  the `MirrorReactive` it was deployed for. Nobody else can make VoteMirror vote.
- **The callback never reverts on business conditions.** A failed callback is still charged, so a paused contract, a
  skipped proposal, a closed vote, or an earlier manual vote emit `Skipped(proposalId, support, reason)` instead.
- **The owner always wins.** A manual `castVote` is final: the Governor allows one vote per account, and the callback
  checks `hasVoted` first.
- **Timestamps, not block numbers.** Base Sepolia produces a block every 2 seconds and the cross-chain round trip is
  not instant, so the token and Governor use `mode=timestamp` clocks and the voting window is expressed in seconds.
- **No custody.** Neither contract can move the user's tokens. They only hold a small gas balance (lREACT on Lasna,
  ETH on Base Sepolia) that the owner can withdraw.

## Deployed contracts (testnet)

| Contract | Chain | Address |
| --- | --- | --- |
| MirrorReactive | Reactive Lasna (5318007) | `0xc5D993C7DF3107a02943b4368794AA524e94B686` |
| VoteMirror | Base Sepolia (84532) | [`0x7266da930e9aDb5F028c09991275b0d88744F194`](https://sepolia.basescan.org/address/0x7266da930e9aDb5F028c09991275b0d88744F194) |
| DemoGovernor | Base Sepolia (84532) | [`0x69c34B596DB8CC39b68067b9d0B391D75616bc14`](https://sepolia.basescan.org/address/0x69c34B596DB8CC39b68067b9d0B391D75616bc14) |
| DemoToken | Base Sepolia (84532) | [`0xc5D993C7DF3107a02943b4368794AA524e94B686`](https://sepolia.basescan.org/address/0xc5D993C7DF3107a02943b4368794AA524e94B686) |

MirrorReactive and DemoToken share an address because each was the deployer's first transaction on its chain. Lasna
addresses and transactions can be looked up on the [Lasna explorer](https://lasna.reactscan.net/).

Settings: threshold 2 of 3 trusted voters, voting period 1 hour, callback proxy
`0x476F44b11F5C942c58f4c8E3d0300E5710743585`, owner `0x128c87E91c09E6165dc023A5cd5AB93b53AfC8ef`. The full record is
in [`deployments/testnet.json`](deployments/testnet.json).

## Demo loops

**Status on 2026-11-23: the loop runs up to the last hop, which is blocked by a Reactive testnet incident.** Since
2026-11-23 09:51 UTC the Base Sepolia callback proxy rejects Reactive's own relayer
(`0xF7E866D726658F6C3F14B8EE537fe268a4D91DDb`) with `NotAuthorized`, so every `deliverCallback` on that proxy
reverts before it reaches any callback contract, VoteMirror included. The table below is what was recorded on chain
so far; it will be replaced with complete loops once the proxy accepts callbacks again.

| Step | Loop 1: For | Loop 2: Against | Loop 3: Skip |
| --- | --- | --- | --- |
| Proposal (Base Sepolia) | [`0xd84ab348…`](https://sepolia.basescan.org/tx/0xd84ab348676f20630ef902ef6ca812cd81506acdf3d2f7890e9a88145a0f210e) | [`0xdba69abc…`](https://sepolia.basescan.org/tx/0xdba69abc04387f7a4957913e6c06de0bd47ba981ced2604afc4728f0c812432b) | [`0x369d435c…`](https://sepolia.basescan.org/tx/0x369d435ce9e3e43d8bde5287c24abc14cfbed95ee74ad768058050bb18a3b33c), skipped by the owner in [`0x5e24e947…`](https://sepolia.basescan.org/tx/0x5e24e9478909c9574a37ef090cbb0dfc609d850dc8fb000e052dacb76f42bd8e) |
| `VoteCast` by trusted voter 1 (Base Sepolia) | [`0x8ec8de44…`](https://sepolia.basescan.org/tx/0x8ec8de44d9711130ec2072a769a2dcca72fee13d427becdf8da609e3d498e032) | [`0x98c14cbe…`](https://sepolia.basescan.org/tx/0x98c14cbe2ed30d984b20e70f0a371e026e6bc11f8e97025253b8e71bd131bd9f) | [`0x6f1439da…`](https://sepolia.basescan.org/tx/0x6f1439da3afa26c20b1effef4c20c30854dbaf3f6084c44532d3a73b12e210f5) |
| `VoteCast` by trusted voter 2 (Base Sepolia) | [`0x7072c96d…`](https://sepolia.basescan.org/tx/0x7072c96dcec75f30dda62e2d86b049c6e1ad2175ff54f165450882e89e9bb02d) | [`0xdd6ffedc…`](https://sepolia.basescan.org/tx/0xdd6ffedc5324f5b5fd7fb2d24e839b19e2d40229333c3cb36c3e3646d39e46b3) | [`0xe6a92af3…`](https://sepolia.basescan.org/tx/0xe6a92af3a73c19569c4110f15667ef8a220712c363a6d37bcc32cb3f895340f2) |
| `react()` reaching 2 of 3, `MirrorRequested` (Lasna) | `0x8388667617ceb06a465b4294a3a7241280ca9b28794316f779d1d0292a5f18da` | `0x2edd8fbbc695b93d7cab9b5540b8c2bb10181ce12ae2351d6f8e463bac7d6db1` | `0x655097e8b6f3488a05d87da16df9488fb25dd62677ea180ec33d7f70bfc5f438` |
| Callback delivery (Base Sepolia) | reverted at the proxy: [`0x95062c16…`](https://sepolia.basescan.org/tx/0x95062c166bebb0181c09097b8c14975200b6b7cae449772c114eb979335ee1ad) | reverted at the proxy: [`0x3eb05a00…`](https://sepolia.basescan.org/tx/0x3eb05a00f1ba979bfbf7c1a226969631a715934e37252afae3d377dc9567ab8d) | reverted at the proxy: [`0xe8c5ffe7…`](https://sepolia.basescan.org/tx/0xe8c5ffe73fea79333f2bb2cf862fd0bca56354cec9ac3f8d433cc18f04887dc0) |
| Resulting vote by VoteMirror | none yet | none yet | none (expected: `Skipped`) |

What is verified and what is not:

- Verified on chain: the subscriptions, the event reaching `MirrorReactive`, the 2 of 3 count, and the callback
  request. On a healthy feed `react()` ran within seconds of the second vote.
- Verified by simulation only: an `eth_call` of `castMirrored` sent from the callback proxy address against the live
  Loop 2 proposal casts the Against vote with the owner's 1,000 delegated votes and emits `Mirrored` (81k gas, the
  callback gas limit is 600k). The same call from the relayer address reverts with `NotAuthorized`.
- Not verified on chain yet: a callback transaction that reaches VoteMirror and the vote it casts.

## Run it yourself

Requirements: [Foundry](https://getfoundry.sh), Python 3, a testnet key with Base Sepolia ETH and Lasna lREACT
(send Sepolia ETH to the Reactive faucet contract, see the
[Reactive docs](https://dev.reactive.network/reactive-mainnet#get-testnet-react)).

```bash
git clone --recurse-submodules <this repo> && cd votemirror-reactive
forge test                       # 46 tests

cp .env.example .env             # fill in PRIVATE_KEY and three demo VOTER_KEYS, testnet only
./script/deploy.sh               # deploys everything, writes deployments/testnet.json
./script/demo.sh for             # 2 of 3 vote For      -> VoteMirror votes For
./script/demo.sh against         # 2 of 3 vote Against  -> VoteMirror votes Against
./script/demo.sh skip            # owner skips proposal -> Skipped, no vote
```

`demo.sh` prints the hash of every step: the proposal, each `VoteCast`, the `react()` transaction on Lasna, and the
callback on Base Sepolia.

## Tests

`forge test` runs 46 tests:

- [`test/MirrorReactive.t.sol`](test/MirrorReactive.t.sol): k of n rule (For, Against, Abstain, split votes,
  threshold of one), duplicate votes, one callback per proposal, untrusted voters and foreign logs ignored, only the
  system contract may call `react()`, adding and removing trusted voters, debt payment, and a fuzz test of the
  agreement rule.
- [`test/VoteMirror.t.sol`](test/VoteMirror.t.sol): the three demo loops end to end against a real OpenZeppelin
  Governor with a mock of the Reactive relay, pause, skip, owner override, proposals that are pending, closed or
  unknown, callback authorization (wrong caller, owner calling directly, another reactive contract), and funds.

## Known limitations

- **One user per deployment.** Each user deploys their own VoteMirror and MirrorReactive pair. A shared registry
  would cut the cost per user.
- **The trusted list lives on Lasna.** Changing it is a transaction on Reactive Network, not on the DAO's chain.
- **Delay.** The mirrored vote lands after Reactive has seen the `k`-th vote and delivered the callback. A trusted
  vote cast in the last moments of the voting period can be too late; VoteMirror then emits `Skipped(NotActive)`.
- **First agreement wins.** Votes cannot be changed in OpenZeppelin Governor, so VoteMirror mirrors the first side
  that reaches `k` and ignores later votes.
- **Only standard `VoteCast`.** `VoteCastWithParams` and Governors that are not OpenZeppelin-compatible are not
  mirrored.
- **Gas must be kept topped up.** Both contracts pay for their own reactions and callbacks and stop being served if
  they run into debt; `coverDebt()` settles it.
- **Not audited.** Demo code for a hackathon, testnet only.
