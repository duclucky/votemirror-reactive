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
| [`MirrorReactive`](src/MirrorReactive.sol) | Reactive Lasna | Subscribes to `VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)` and `VoteCastWithParams` on the Governor, per trusted voter (topic 0 and topic 1), so it only pays for votes it cares about. Records each trusted voter once per proposal and requests one callback per proposal when `k` agree. Owner controls: the trusted list, the threshold, and `retryMirror` to ask again for a proposal whose callback was skipped or lost. |
| [`VoteMirror`](src/VoteMirror.sol) | Base Sepolia | Receives the callback and calls `governor.castVoteWithReason`. Holds the voting power the user delegated to it. Owner controls: `castVote` (override), `setSkipped`, `setPaused`, and its copy of the trusted list and threshold. |
| [`DemoToken`](src/demo/DemoToken.sol), [`DemoGovernor`](src/demo/DemoGovernor.sol) | Base Sepolia | A standard OpenZeppelin `ERC20Votes` token and `Governor` for the demo. Any OpenZeppelin Governor works. |

Design decisions:

- **Callback authorization is double checked.** `castMirrored` requires `msg.sender` to be the Reactive callback
  proxy and the first argument, which Reactive overwrites with the address of the requesting reactive contract, to be
  the `MirrorReactive` it was deployed for. No other contract or account can make VoteMirror vote.
- **The callback is not taken at its word.** VoteMirror keeps its own copy of the trusted list and threshold and,
  before voting, checks on the Governor (`hasVoted`) that at least `k` trusted voters have voted on the proposal.
  A callback that Reactive's relayer made up, or one based on votes that a reorg removed, ends in
  `Skipped(NotConfirmed)`. The Governor does not expose which side a voter chose, so the side is the one part
  that still rests on Reactive delivering what `MirrorReactive` requested.
- **The callback never reverts on business conditions.** A failed callback is still charged, so a paused contract, a
  skipped proposal, a closed vote, or an earlier manual vote emit `Skipped(proposalId, support, reason)` instead.
- **The owner always wins.** A manual `castVote` is final: the Governor allows one vote per account, and the callback
  checks `hasVoted` first.
- **Timestamps, not block numbers.** Block times differ between chains and change over time, and the cross-chain round
  trip is not instant, so the token and Governor use `mode=timestamp` clocks and the voting window is expressed in seconds.
- **A missed vote can be recovered, but only the agreed one.** `react()` asks once per proposal. If that callback
  was skipped (paused, skipped by the owner) or lost, the owner calls `retryMirror(proposalId, support)` on Lasna;
  it reverts unless `k` currently trusted voters agree on that choice and it is the choice of the first request,
  and VoteMirror still refuses to vote twice.
- **Ownership cannot be lost by accident.** Both contracts use two-step ownership transfer and `renounceOwnership`
  is disabled.
- **No custody.** Neither contract can move the user's tokens. They only hold a small gas balance (lREACT on Lasna,
  ETH on Base Sepolia) that the owner can withdraw.

## Deployed contracts (testnet)

Deployed on 2026-11-24 from the code with the [security review](docs/security-review.md) fixes.

| Contract | Chain | Address |
| --- | --- | --- |
| MirrorReactive | Reactive Lasna (5318007) | `0x0327DEcCC0eF3a2749c14221314153d290228945` |
| VoteMirror | Base Sepolia (84532) | [`0x78BE9fC3e973598b7251a5860d25118e826468dB`](https://base-sepolia.blockscout.com/address/0x78BE9fC3e973598b7251a5860d25118e826468dB) |
| DemoGovernor | Base Sepolia (84532) | [`0x7C175E4859c9E6BFF44FC41195746610148a894a`](https://base-sepolia.blockscout.com/address/0x7C175E4859c9E6BFF44FC41195746610148a894a) |
| DemoToken | Base Sepolia (84532) | [`0xe70C80CcEDF880F712dC76c8A66F6ce341E58C11`](https://base-sepolia.blockscout.com/address/0xe70C80CcEDF880F712dC76c8A66F6ce341E58C11) |

Source verification: the three Base Sepolia contracts on Blockscout (the links above), MirrorReactive on
[Sourcify](https://sourcify.dev/server/v2/contract/5318007/0x0327DEcCC0eF3a2749c14221314153d290228945) (exact match),
which is the verifier Reactive uses for Lasna. Lasna addresses and transactions can be looked up on the
[Lasna explorer](https://lasna.reactscan.net/).

Settings: threshold 2 of 3 trusted voters (the same list on both contracts), voting period 1 hour, callback proxy
`0x476F44b11F5C942c58f4c8E3d0300E5710743585`, owner `0x128c87E91c09E6165dc023A5cd5AB93b53AfC8ef`. The full record is
in [`deployments/testnet.json`](deployments/testnet.json).

## Demo loops

Four complete loops, run on 2026-11-24 with `script/demo.sh for|against|skip|retry` against the contracts above. In
each one the callback is a `deliverCallback` transaction sent by Reactive's relayer to the callback proxy, and it
landed in the same second as the second trusted vote or the one after (by block timestamps).

| Step | Loop 1: For | Loop 2: Against | Loop 3: Skip | Loop 4: Retry |
| --- | --- | --- | --- | --- |
| Proposal (Base Sepolia) | [`0xeb153394…`](https://sepolia.basescan.org/tx/0xeb1533941a3222464d5c382f3c4cdf2b219e2773064df434886e3395e4fd8e36) | [`0x4d849fbc…`](https://sepolia.basescan.org/tx/0x4d849fbcf3b880420e1110746a335103f09fbe1a10a5cc9948693049de9c7fd2) | [`0x713bc002…`](https://sepolia.basescan.org/tx/0x713bc002b0a9674a9dd87231b743f8320be0a2f4e359d15be8849672ed133f2d), skipped by the owner in [`0xd84ccf04…`](https://sepolia.basescan.org/tx/0xd84ccf04f0649c3a44000c9c612f04d04b05e688d02829112a14eeb9923d72d4) | [`0x2fc2c153…`](https://sepolia.basescan.org/tx/0x2fc2c153b8a4829be44772b1878d0bcd8c7435bba5965cae88e8a0ed85571f36), VoteMirror paused in [`0x52a7451a…`](https://sepolia.basescan.org/tx/0x52a7451a6e9bc18cf0b7f402b67e186d4e17750cdfb6698e193b4796b0b59af3) |
| `VoteCast` by trusted voter 1 (Base Sepolia) | [`0xe601f918…`](https://sepolia.basescan.org/tx/0xe601f918c5ebec0079f44c21fae2c38561b3ee86c75a59ba72f68343fdc924fa) For | [`0x349625df…`](https://sepolia.basescan.org/tx/0x349625dfcf3aa3cf7de8435a5748c37e745df2508d9ae22ec55dea30aed97778) Against | [`0xe95749d0…`](https://sepolia.basescan.org/tx/0xe95749d0f5b1975346b99a3820ff44e22d8012b986c473acd8e18df654f27067) For | [`0xf8e4fcbd…`](https://sepolia.basescan.org/tx/0xf8e4fcbdba69d205928c163fc70b8e7f950f9e17139c7414c3d896f904a44fc8) For |
| `VoteCast` by trusted voter 2 (Base Sepolia) | [`0xde8f782c…`](https://sepolia.basescan.org/tx/0xde8f782cf979e96be26ba3dbc2df9551aad1cface237aa4ef8400e519d079bdf) For | [`0x6e5077b1…`](https://sepolia.basescan.org/tx/0x6e5077b1fac157b5091f86e2683ab52340c1f0e91842ae4610f70c67a3c6b620) Against | [`0x2ca7b5ba…`](https://sepolia.basescan.org/tx/0x2ca7b5ba8b1b5606e87156fadde79e16c775c00e64e3cdd4787f1c799c404d7f) For | [`0x5300929a…`](https://sepolia.basescan.org/tx/0x5300929a455f2d754c5a89ade8d3365a48d30461666d29041f787378b61837b3) For |
| `react()` reaching 2 of 3, `MirrorRequested` (Lasna) | `0x5f3765b2d3ebfba71d0d5a13289a3864c7ac8073ec4c1eaaad998af120614dff` | `0x9453a3fe365027e05dd4324c0933ac2f5dc630513a7220c0650efc079a7211be` | `0x5dca7f3d87132733181e40a58122c30594ce784ff133fa68534050096a080ffe` | `0xb240538dd33ad8220f288e3efd027314efd66cf8dcb73b98d8531e9c625e161b` |
| Callback into VoteMirror (Base Sepolia) | [`0xfb4b628d…`](https://sepolia.basescan.org/tx/0xfb4b628dfed15b87dd9f92a5a53063dc57acbe69ce354a233d7512a4ffdb9fd3) | [`0x6a03cfb9…`](https://sepolia.basescan.org/tx/0x6a03cfb949bd509833bdc49a51f6efa7adff694a9e54c5fd911bda56b3a412c1) | [`0xc757fa7c…`](https://sepolia.basescan.org/tx/0xc757fa7ccf8cd43fee7d4f1e83d0d68d811d6fc08cbe2350edeb34f60c65c3ac) | [`0xe6a72d18…`](https://sepolia.basescan.org/tx/0xe6a72d180a4f19b8c2da9bee2cbe8bbd1974a68633885d94e6e1aa97450e77ab) |
| Result in the callback transaction | `Mirrored`: VoteMirror votes For with 1,000 delegated votes | `Mirrored`: VoteMirror votes Against with 1,000 delegated votes | `Skipped(SkippedByOwner)`: no vote | `Skipped(Paused)`: no vote |
| Owner asks again | | | | unpause [`0xa59287ad…`](https://sepolia.basescan.org/tx/0xa59287ad07a2eafc599d596a5a23ec31aab3385439fb75f38b35636bb71465a2), then `retryMirror`, `MirrorRetried` (Lasna) `0x6fd85e95e9fc5bd8c7e648ede75a725fbc85bfbe0918ec02bb6fc38f3a49ca05` |
| Second callback (Base Sepolia) | | | | [`0x277ec94e…`](https://sepolia.basescan.org/tx/0x277ec94e7a9b6bdf08ab02c9d729d9468e0aff4d9ec9a154feac69c2b98eabd0), `Mirrored`: For |
| Final tally (against / for / abstain) | 0 / 3,000 / 0 | 3,000 / 0 / 0 | 0 / 2,000 / 0 | 0 / 3,000 / 0 |

The tallies are in votes: each trusted voter holds 1,000 and the owner delegated 1,000 to VoteMirror.

### VoteMirror's own check, run live

VoteMirror votes only if it finds on the Governor that `threshold` trusted voters have voted. To show the check
refusing, its threshold was raised to 3 ([`0xa10ab8fd…`](https://sepolia.basescan.org/tx/0xa10ab8fd30b15925077b8579ed054203793102a0389e19dba051f9fe358715e1)) while MirrorReactive stayed at 2, then two trusted
voters voted For on a new proposal ([`0x2dbf6daa…`](https://sepolia.basescan.org/tx/0x2dbf6daa623eb872a533392200890350394f08f8b617386b3b2d98d6ea682155)). MirrorReactive requested the callback (`0xcc6ca31839f97f35247dae93cdd0c898b2f479149e7690e50dd83ba0b3361657`),
and VoteMirror answered `Skipped(NotConfirmed)` in [`0x51aff7ef…`](https://sepolia.basescan.org/tx/0x51aff7efff33b667b78043c2ffefa179c656df7a7c877cf384296aa86ae89ea7): it counted 2 trusted votes and needed 3.
The threshold was set back to 2 ([`0x471b73e2…`](https://sepolia.basescan.org/tx/0x471b73e2ace3cc3847ff5ec523b9284bc4b6103af216c1a6ab7628bdf959c1ea)), `retryMirror` was called (`0x0fb8cfe14046462e9554f338cdbcc3b0e90cab3dc43eb4a8c05d39f2191abc25`), and the
second callback mirrored the vote: [`0x259b4574…`](https://sepolia.basescan.org/tx/0x259b4574f8f9426d9d70f85d8e34d33ce2524e1cac01a11a5fef91a31729dded).

### Previous deployment

The first deployment, before the security review fixes, is still on the testnets: MirrorReactive
`0xc5D993C7DF3107a02943b4368794AA524e94B686` (Lasna), VoteMirror `0x7266da930e9aDb5F028c09991275b0d88744F194`,
DemoGovernor `0x69c34B596DB8CC39b68067b9d0B391D75616bc14` and DemoToken `0xc5D993C7DF3107a02943b4368794AA524e94B686`
(Base Sepolia). Do not use it; its loops are kept here because the demo video shows them.

A run of the three loops on 2026-11-23 between 13:38 and 13:45 UTC stopped at the last hop: Reactive's Base Sepolia
callback proxy was rejecting Reactive's own relayer with `NotAuthorized` (a testnet incident that began at 09:51 UTC
and was over by 21:00 UTC), so those three callbacks reverted at the proxy, for example
[`0x95062c16…`](https://sepolia.basescan.org/tx/0x95062c166bebb0181c09097b8c14975200b6b7cae449772c114eb979335ee1ad),
and were not delivered again afterwards. Those three proposals closed without a mirrored vote. That deployment had
no `retryMirror()`.

The [demo video script](docs/video-script.md) was recorded against this later run on 2026-11-23:

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
forge test                       # 77 tests

cp .env.example .env             # fill in PRIVATE_KEY and three demo VOTER_KEYS, testnet only
./script/deploy.sh               # deploys everything, writes deployments/testnet.json
./script/demo.sh for             # 2 of 3 vote For      -> VoteMirror votes For
./script/demo.sh against         # 2 of 3 vote Against  -> VoteMirror votes Against
./script/demo.sh skip            # owner skips proposal -> Skipped, no vote
./script/demo.sh retry           # paused during the votes -> Skipped; unpause + retryMirror -> votes For
```

`demo.sh` prints the hash of every step: the proposal, each `VoteCast`, the `react()` transaction on Lasna, and the
callback on Base Sepolia.

## Tests

`forge test` runs 77 tests:

- [`test/MirrorReactive.t.sol`](test/MirrorReactive.t.sol): k of n rule (For, Against, Abstain, split votes,
  threshold of one), duplicate votes, one callback per proposal, untrusted voters and foreign logs ignored, only the
  system contract may call `react()`, adding and removing trusted voters (a removed voter's old votes never count again), `retryMirror`, two-step
  ownership, debt payment, and a fuzz test of the agreement rule.
- [`test/VoteMirror.t.sol`](test/VoteMirror.t.sol): the three demo loops end to end against a real OpenZeppelin
  Governor with a mock of the Reactive relay, pause, skip, a retry after a pause or a skip, owner override, proposals that are pending, closed or
  unknown, callback authorization (wrong caller, owner calling directly, another reactive contract), VoteMirror's own check
  of the trusted votes on the Governor (a made-up callback is not voted), and funds.

## Known limitations

- **One user per deployment.** Each user deploys their own VoteMirror and MirrorReactive pair. A shared registry
  would cut the cost per user.
- **The trusted list lives on both chains.** `addTrusted`, `removeTrusted` and `setThreshold` are called on
  MirrorReactive (Lasna) and on VoteMirror (the DAO's chain). If the two differ, the worst case is a
  `Skipped(NotConfirmed)`, which `retryMirror()` recovers once they agree again.
- **Depends on Reactive's relay.** A callback that fails at the callback proxy is not retried by the network (see
  the 2026-11-23 run under "Previous deployment"). The owner asks again with `retryMirror()` or votes through
  `castVote()`. Reactive's
  relayer and the owners of its upgradeable system contract and callback proxy could deliver a callback that
  `MirrorReactive` never requested: VoteMirror then votes only if `k` trusted voters have voted on that proposal,
  but the side would be the relayer's.
- **Delay.** The mirrored vote lands after Reactive has seen the `k`-th vote and delivered the callback. A trusted
  vote cast in the last moments of the voting period can be too late; VoteMirror then emits `Skipped(NotActive)`.
- **A lowered threshold is not applied to past votes by itself.** `setThreshold` takes effect on the next trusted
  vote; for a proposal whose recorded votes already meet the new threshold the owner calls `retryMirror()`.
- **First agreement wins.** Votes cannot be changed in OpenZeppelin Governor, so VoteMirror mirrors the first side
  that reaches `k` and ignores later votes, also when `2k` is not more than `n` and the other side reaches `k` later.
- **Trusted votes count per address, not per weight.** You follow people, not stake. MirrorReactive counts a vote
  as soon as Reactive delivers the log; VoteMirror re-checks the votes on the Governor when it casts.
- **OpenZeppelin-compatible Governors only.** `VoteCast` and `VoteCastWithParams` with support 0, 1 or 2 are
  followed; VoteMirror itself always votes without params.
- **Gas must be kept topped up.** Both contracts pay for their own reactions and callbacks and stop being served if
  they run into debt; `coverDebt()` settles it.
- **Fees can be run up from outside.** Reactive's callback proxy charges VoteMirror for every callback addressed to
  it, also one that VoteMirror rejects, and anyone can request such a callback from Lasna. A trusted voter can
  likewise make MirrorReactive pay for a `react()` per proposal they vote on, and per ballot on a Governor that
  lets one voter cast several (fractional voting); `removeTrusted` stops it. Keep the balances small and watched;
  after a top-up, `retryMirror()` recovers the votes missed while a contract was in debt.
- **Demo keys.** The scripts pass keys on the command line and one `.env` holds the owner and every trusted voter
  key. That is fine for a testnet demo and must not be copied to a real setup.
- **Not audited.** Demo code for a hackathon, testnet only. Our own review of the contracts, which is not an
  independent audit, is in [`docs/security-review.md`](docs/security-review.md).

## License

[MIT](LICENSE)
