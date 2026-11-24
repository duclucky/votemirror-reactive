# VoteMirror

Vote in a DAO automatically when the voters you trust agree, without giving anyone your tokens.

Built for the Reactive Omni Buildathon on [Reactive Network](https://reactive.network). Testnet only.

**Live status page: <https://duclucky.github.io/votemirror-reactive/>.** No wallet and no sign-in: it reads both
testnets from your browser and shows the trusted voters and threshold, every proposal, each trusted vote the reactive
contract counted, and each vote VoteMirror mirrored or skipped, with links to the transactions on both chains.

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
  the `MirrorReactive` it was deployed for. No other contract or account can make VoteMirror vote; Reactive's
  relayer and the owner of the callback proxy are trusted to deliver only what `MirrorReactive` requested.
- **The callback never reverts on business conditions.** A failed callback is still charged, so a paused contract, a
  skipped proposal, a closed vote, or an earlier manual vote emit `Skipped(proposalId, support, reason)` instead.
- **The owner always wins.** A manual `castVote` is final: the Governor allows one vote per account, and the callback
  checks `hasVoted` first.
- **Timestamps, not block numbers.** Block times differ between chains and change over time, and the cross-chain round
  trip is not instant, so the token and Governor use `mode=timestamp` clocks and the voting window is expressed in seconds.
- **No custody.** Neither contract can move the user's tokens. They only hold a small gas balance (lREACT on Lasna,
  ETH on Base Sepolia) that the owner can withdraw.

## Deployed contracts (testnet)

| Contract | Chain | Address |
| --- | --- | --- |
| MirrorReactive | Reactive Lasna (5318007) | `0xc5D993C7DF3107a02943b4368794AA524e94B686` |
| VoteMirror | Base Sepolia (84532) | [`0x7266da930e9aDb5F028c09991275b0d88744F194`](https://base-sepolia.blockscout.com/address/0x7266da930e9aDb5F028c09991275b0d88744F194) |
| DemoGovernor | Base Sepolia (84532) | [`0x69c34B596DB8CC39b68067b9d0B391D75616bc14`](https://base-sepolia.blockscout.com/address/0x69c34B596DB8CC39b68067b9d0B391D75616bc14) |
| DemoToken | Base Sepolia (84532) | [`0xc5D993C7DF3107a02943b4368794AA524e94B686`](https://base-sepolia.blockscout.com/address/0xc5D993C7DF3107a02943b4368794AA524e94B686) |

Source verification: the three Base Sepolia contracts on Blockscout (the links above), MirrorReactive on
[Sourcify](https://sourcify.dev/server/v2/contract/5318007/0xc5D993C7DF3107a02943b4368794AA524e94B686) (exact match),
which is the verifier Reactive uses for Lasna.
MirrorReactive and DemoToken share an address because each was the deployer's first transaction on its chain. Lasna
addresses and transactions can be looked up on the [Lasna explorer](https://lasna.reactscan.net/).

Settings: threshold 2 of 3 trusted voters, voting period 1 hour, callback proxy
`0x476F44b11F5C942c58f4c8E3d0300E5710743585`, owner `0x128c87E91c09E6165dc023A5cd5AB93b53AfC8ef`. The full record is
in [`deployments/testnet.json`](deployments/testnet.json).

## Demo loops

Three complete loops, run on 2026-11-23 with `script/demo.sh`. In each one the callback is a `deliverCallback`
transaction sent by Reactive's relayer to the callback proxy, and it landed in the same second as the second trusted
vote or the one after (by block timestamps).

| Step | Loop 1: For | Loop 2: Against | Loop 3: Skip |
| --- | --- | --- | --- |
| Proposal (Base Sepolia) | [`0xc97c5232…`](https://sepolia.basescan.org/tx/0xc97c5232bb9107ecbc1652a52bb6fdc746280d19beb9a2e89352fe684e62085d) | [`0x7800935d…`](https://sepolia.basescan.org/tx/0x7800935d295fe6f65f97f9874e079945a7f232bc660df87a30d5547b19ee9c2f) | [`0x7e2832b0…`](https://sepolia.basescan.org/tx/0x7e2832b06630191efa87f9e2c28b43363a9b7c3266f1043152bdcd3f36149627), skipped by the owner in [`0x40fe0196…`](https://sepolia.basescan.org/tx/0x40fe0196ba0322fae4107030ef832dce251faf6ab530dcb46d793ccc47658969) |
| `VoteCast` by trusted voter 1 (Base Sepolia) | [`0x06a0e30f…`](https://sepolia.basescan.org/tx/0x06a0e30fcc497f2173bc89c19ebf21899180b5020c3d6665a9987a0fe3704df9) For | [`0x0c07c514…`](https://sepolia.basescan.org/tx/0x0c07c514ff45778ea74db4fa71d57a1a124a1b439e2b3c0de507dde64398be88) Against | [`0xcc3f8573…`](https://sepolia.basescan.org/tx/0xcc3f85730e3054d0ed6df2e04ad518ec7eef8bbe7e90adb44a574db0725210df) For |
| `VoteCast` by trusted voter 2 (Base Sepolia) | [`0x6162e204…`](https://sepolia.basescan.org/tx/0x6162e2040815fca1112fc1e4fc495babdb5c927010d51be13cf90d8ac2797b23) For | [`0xbee1063f…`](https://sepolia.basescan.org/tx/0xbee1063fee069d060698a52e6a348ecc9504c8ba55fca13349721c35c98e21b6) Against | [`0xe75815da…`](https://sepolia.basescan.org/tx/0xe75815dab7f1f522a4dbbad50145a0949eb7d528d1ffeb9a36c3f1479a90d784) For |
| `react()` reaching 2 of 3, `MirrorRequested` (Lasna) | `0xe96d36252c3bfe2b7af721fdcb28b50d74da4aef04092f62c2a406a1129c5195` | `0xac342802c0de847bf5383d6e501a6e58143b7743a540752605806ad85b977519` | `0x607881086a7c85af8cece5e27edfecae10a45d6932613328b5e29c6918490bf4` |
| Callback into VoteMirror (Base Sepolia) | [`0xbe54f565…`](https://sepolia.basescan.org/tx/0xbe54f565ddd72fe6b7456e6701d712714dec87c8adf951d74074627c97029360) | [`0xb9f03b52…`](https://sepolia.basescan.org/tx/0xb9f03b5282a44f3507f68f1790dcd0604556d0da3282b0b5c89d0d3e6ad5f3d9) | [`0x5d38e88c…`](https://sepolia.basescan.org/tx/0x5d38e88ca105dedfb47f53c2ecbcedf04f3fed414c66342bc300463029b5a346) |
| Result in the callback transaction | `Mirrored`: VoteMirror votes For with 1,000 delegated votes | `Mirrored`: VoteMirror votes Against with 1,000 delegated votes | `Skipped(SkippedByOwner)`: no vote |
| Final tally (against / for / abstain) | 0 / 3,000 / 0 | 3,000 / 0 / 0 | 0 / 2,000 / 0 |

The tallies are in votes: each trusted voter holds 1,000 and the owner delegated 1,000 to VoteMirror.

An earlier run of the same three loops on 2026-11-23 between 13:38 and 13:45 UTC stopped at the last hop: Reactive's
Base Sepolia callback proxy was rejecting Reactive's own relayer with `NotAuthorized` (a testnet incident that began
at 09:51 UTC and was over by 21:00 UTC), so those three callbacks reverted at the proxy, for example
[`0x95062c16…`](https://sepolia.basescan.org/tx/0x95062c166bebb0181c09097b8c14975200b6b7cae449772c114eb979335ee1ad),
and were not delivered again afterwards. Those three proposals closed without a mirrored vote.

### Run shown in the demo video

The [demo video script](docs/video-script.md) was recorded against a later run of the same three scripts on
2026-11-23, so the video shows these transactions rather than the ones in the table above.

| Step | Loop 1: For | Loop 2: Against | Loop 3: Skip |
| --- | --- | --- | --- |
| Proposal (Base Sepolia) | [`0x3cccc41e…`](https://sepolia.basescan.org/tx/0x3cccc41e9afff31987539028a07054ae50e578410f5cd768a1f5cc902e8bfeb5) | [`0xade9981b…`](https://sepolia.basescan.org/tx/0xade9981ba4e6b0401d7c7775b231cf5e22952044b8042a87ef5c12878e79334f) | [`0xab99e78c…`](https://sepolia.basescan.org/tx/0xab99e78c48c7139d20a8877cb2b5ba4c4a60f76e5428d7f615e1cbde01db6ee6), skipped by the owner in [`0xf0185623…`](https://sepolia.basescan.org/tx/0xf01856232945a50c26ccdb24b589cea7227a920fd7495f4332c5ecda4fca63d7) |
| `VoteCast` by trusted voter 1 (Base Sepolia) | [`0x3b713d45…`](https://sepolia.basescan.org/tx/0x3b713d45df3c564d1e76239f2b8861e9f94731f1e79d8d4b32beb64b69615405) | [`0xfe197e57…`](https://sepolia.basescan.org/tx/0xfe197e57e3fcb89460532e5f9c3d8e399fab7688d79bf18337afede2909f4413) | [`0x25abfc8d…`](https://sepolia.basescan.org/tx/0x25abfc8d43df74fc7857adfde3af23481284040dbb2f2b5be81ad581b8432448) |
| `VoteCast` by trusted voter 2 (Base Sepolia) | [`0xd98742ac…`](https://sepolia.basescan.org/tx/0xd98742ac63ab225c257861e4bc6bcaae286f69cc27d8ad0f5d84da08e34396f0) | [`0xbcacb56c…`](https://sepolia.basescan.org/tx/0xbcacb56c42f68d20a369a6049e8bbbf10db4a842c4701192c3f61d18fd42e7e6) | [`0x2fdab52b…`](https://sepolia.basescan.org/tx/0x2fdab52b1af95c98dfe5508d3c0fc53bbd3ac9d61c779d3f6009401ebfe26f7c) |
| `react()`, `MirrorRequested` (Lasna) | `0xabf3f0c3def5945f666c6a1e20752f72bbdee59d0ebc9c3bd7f6bc11cbb3ef88` | `0xab321eb64f8caae48b9012954b52152b48be7f4c77370ac902141290ad3d67f8` | `0x37ac9c127eb6bbfd87d239aa9108ad920b490517c13cb597b7edfd6e1f7a4172` |
| Callback into VoteMirror (Base Sepolia) | [`0x82de1a45…`](https://sepolia.basescan.org/tx/0x82de1a45482c4270bdbc0f0f20ceef8975e7e5c767a6a9c7d3d4d16362490731) | [`0x3d3c6b5e…`](https://sepolia.basescan.org/tx/0x3d3c6b5ecc8dbeac753993bd91f3bd13d2180b82ae5e3da9dec64b9f16341576) | [`0x1f73751b…`](https://sepolia.basescan.org/tx/0x1f73751b1b406e631dbc36470705ef6c356bcd76a68292e8bb53f9bbaf3a4715) |
| Result | `Mirrored`: For | `Mirrored`: Against | `Skipped(SkippedByOwner)`: no vote |

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

`forge test` runs 51 tests:

- [`test/MirrorReactive.t.sol`](test/MirrorReactive.t.sol): k of n rule (For, Against, Abstain, split votes,
  threshold of one), duplicate votes, one callback per proposal, untrusted voters and foreign logs ignored, only the
  system contract may call `react()`, adding and removing trusted voters, debt payment, and a fuzz test of the
  agreement rule.
- [`test/VoteMirror.t.sol`](test/VoteMirror.t.sol): the three demo loops end to end against a real OpenZeppelin
  Governor with a mock of the Reactive relay, pause, skip, owner override, proposals that are pending, closed or
  unknown, callback authorization (wrong caller, owner calling directly, another reactive contract), and funds.

## Status page

The page at <https://duclucky.github.io/votemirror-reactive/> is the static site in [`site/`](site), with no
dependencies and no backend. It takes the contract addresses from
[`deployments/testnet.json`](deployments/testnet.json), finds the deployment block from the contracts' own logs, and
reads everything else from public RPC endpoints of Base Sepolia and Reactive Lasna (`eth_call` and `eth_getLogs`
only; it cannot send a transaction). It refreshes every 30 seconds.

```bash
node --test "site/test/*.test.mjs"     # 33 tests, Node 22 or newer
node site/build.mjs --snapshot         # builds site/dist
python3 -m http.server -d site/dist    # open http://localhost:8000
```

[`status-page.yml`](.github/workflows/status-page.yml) runs the tests on every pull request and publishes the page to
GitHub Pages on every push to `main`, so a redeployment shows up as soon as the new `deployments/testnet.json` is
merged.

## Known limitations

- **One user per deployment.** Each user deploys their own VoteMirror and MirrorReactive pair. A shared registry
  would cut the cost per user.
- **The trusted list lives on Lasna.** Changing it is a transaction on Reactive Network, not on the DAO's chain.
- **Depends on Reactive's relay.** A callback that fails at the callback proxy is not retried (see the earlier run
  above), so that proposal is not mirrored; the owner can still vote through `castVote()`.
- **Delay.** The mirrored vote lands after Reactive has seen the `k`-th vote and delivered the callback. A trusted
  vote cast in the last moments of the voting period can be too late; VoteMirror then emits `Skipped(NotActive)`.
- **A lowered threshold is not applied to past votes.** `setThreshold` takes effect on the next trusted vote; a
  proposal whose recorded votes already meet the new threshold is mirrored only if another trusted voter votes the
  same way. The owner can vote on it directly with `castVote()`.
- **First agreement wins.** Votes cannot be changed in OpenZeppelin Governor, so VoteMirror mirrors the first side
  that reaches `k` and ignores later votes.
- **Only standard `VoteCast`.** `VoteCastWithParams` and Governors that are not OpenZeppelin-compatible are not
  mirrored.
- **Gas must be kept topped up.** Both contracts pay for their own reactions and callbacks and stop being served if
  they run into debt; `coverDebt()` settles it.
- **One callback per proposal.** If that callback is skipped (paused, skipped by the owner) or lost, lifting the
  pause or the skip does not bring the vote back; the owner votes with `castVote()`.
- **Rejected callbacks are still billed.** Reactive's callback proxy charges VoteMirror for a callback requested by
  somebody else's reactive contract even though VoteMirror rejects it, so its balance can be run down from outside.
- **Re-adding a trusted voter brings back their recorded votes** on proposals that are still open.
- **Not audited.** Demo code for a hackathon, testnet only. Our own review of the contracts, which is not an
  independent audit, is in [`docs/security-review.md`](docs/security-review.md).

## License

[MIT](LICENSE)
