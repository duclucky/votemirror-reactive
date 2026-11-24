# VoteMirror internal security review

This is the team's own review of the contracts, done by a reviewer who did not write them. It is **not an
independent audit** and the project remains unaudited. Scope: `src/VoteMirror.sol`, `src/MirrorReactive.sol`, the
demo token and Governor, the deploy and demo scripts, and the live testnet deployment in
[`deployments/testnet.json`](../deployments/testnet.json), at commit `0c4c215`.

The findings below describe the first deployment (commit `0c4c215`). A second pass and the fixes followed; the
"Status" section says what was done about each finding in the contracts that are deployed now. Line numbers in
the findings refer to commit `0c4c215`.

## Result

No critical or high severity issue. One medium, four low, six informational.

| # | Severity | Finding |
|---|----------|---------|
| M-1 | Medium (low on today's testnet gas prices) | Anyone can spend VoteMirror's callback balance with callbacks it rejects, until mirroring stops |
| L-1 | Low | Reactive's relayer and the callback proxy owner can make VoteMirror cast any vote |
| L-2 | Low | A skipped, paused or failed callback is final for that proposal |
| L-3 | Low | One trusted voter alone can run up MirrorReactive's fees |
| L-4 | Low | Votes of a removed voter count again when the voter is added back |
| I-1 | Info | `renounceOwnership` and one-step ownership transfer are left enabled |
| I-2 | Info | VoteMirror's constructor accepts any address for its three immutables |
| I-3 | Info | `agreement(id, 255)` reverts with an arithmetic panic |
| I-4 | Info | Trusted votes count whatever their weight, and without waiting for finality |
| I-5 | Info | Scripts pass private keys on the command line; one `.env` holds every demo key |
| I-6 | Info | Floating pragma; CI actions pinned by tag |

## Status after the fixes

| # | Status | What changed |
|---|--------|--------------|
| M-1 | Mitigated, not removable | The charge is made by Reactive's proxy. `retryMirror()` now recovers the votes missed while VoteMirror was in debt |
| L-1 | Reduced, not removable | VoteMirror now checks on the Governor that `threshold` trusted voters have voted before it casts (`Skipped(NotConfirmed)` otherwise), so a made-up callback cannot vote on a proposal the trusted voters are silent on. The side still comes from the callback: a standard Governor does not expose it |
| L-2 | Fixed | Owner-only `MirrorReactive.retryMirror(proposalId, support)`; reverts unless `threshold` currently trusted voters agree on that choice (`AgreementNotReached`) and it is the choice requested first (`OtherChoiceRequested`) |
| L-3 | Accepted and documented | Reactive bills per delivered log; `removeTrusted` stops it |
| L-4 | Fixed | `trustEpoch[voter]` is raised on removal and votes are recorded per epoch |
| I-1 | Fixed | `Ownable2Step` on both contracts; `renounceOwnership()` reverts with `RenounceDisabled` |
| I-2 | Fixed | VoteMirror's constructor reverts with `ZeroAddress` |
| I-3 | Fixed | `agreement()` returns 0 for a support value above 2 |
| I-4 | Finality fixed, weight by design | VoteMirror's check reads the Governor when it casts, so votes removed by a reorg no longer count. Counting per address is the product rule |
| I-5 | Documented | Testnet demo keys. `cast` and `forge create` take a raw key only as an argument; a real setup would use a keystore or a hardware wallet |
| I-6 | Fixed | `pragma solidity 0.8.30`; CI actions pinned by commit |

## Second pass

The second pass read the verified source of Reactive's system contract on Lasna (`0x8888…8888`, implementation
`0xbbbb…bbbb`, on Sourcify) and ran a probe on the testnets with two throwaway contracts.

- **N-1 (makes M-1 cheaper).** `SystemContract.requestCallback` is open to any caller and emits
  `CallbackRequest(chainId, msg.sender, recipient, …)`, so a plain wallet on Lasna can request callbacks to
  VoteMirror; no reactive contract is needed. In the probe a request sent by a wallet was delivered on Base Sepolia
  with the wallet's address as first argument (transaction `0x6e221485caa1f02f590c52bf50fdd37c2fac8a1dda4868e627d2633337d8c362`).
  VoteMirror rejects such a callback and is still charged for it.
- **N-2.** A callback requested from an ordinary transaction of a contract, outside `react()`, is delivered with
  that contract's address as first argument (transaction
  `0xfd9046e610948747fc46b3aa274e3e8e6e585895966cea8019a68a15bec24fe0`). `retryMirror()` relies on this.
- **N-3 (info).** When `2 × threshold` is not more than the number of trusted voters, both sides can reach the
  threshold; the first one is mirrored, and `retryMirror()` only repeats that one.
- **N-4 (info, fixed with L-2).** Lowering the threshold or setting the mirror late does not request a callback for
  a proposal on which the trusted voters have already voted.
- **N-5 (info, fixed).** A vote cast with `castVoteWithReasonAndParams` emits `VoteCastWithParams` and was not
  followed. MirrorReactive now subscribes to both events and reads only the two leading words of the data.
- **N-6 (info).** A callback that ends in `Skipped` is billed like any other.
- **N-7 (info, part of L-1).** The system contract and the callback proxy are each upgradeable by one key.

Why M-1 cannot be closed in VoteMirror: `CallbackProxy._callback` charges the recipient after every call, and when
the recipient's reserve is empty it calls `pay(debt)` on it. If VoteMirror refused to pay for callbacks it
rejected, the unpaid amount would become debt, and `_callback` reverts with `InDebt` for a recipient in debt: one
foreign callback would then stop mirroring at once instead of after the balance is spent. Paying is the lesser
harm. A rejected callback costs VoteMirror the proxy's fixed overhead only, because it reverts at the first check.

Considered and not done: re-requesting automatically when the owner lifts a pause (more fees and more surface
than one `retryMirror` transaction), and requiring `2 × threshold > n` (it would forbid "any one of my three
delegates", which is a legitimate rule; the first requested choice is now final instead).

## What was checked

- Manual read of both contracts and of the Reactive base contracts they inherit (`AbstractCallback`,
  `AbstractPayer`, `AbstractReactive`, `reactive-lib-omni` v0.1.0).
- The verified source of Reactive's Base Sepolia callback proxy (`0x476F44b1…3585`, implementation
  `0x49E4AC69…E059`), because VoteMirror's authorization and fees depend on it.
- `forge test` (51 tests after the first pass, 73 after the fixes, all passing), `forge coverage` (VoteMirror 100% lines and branches,
  MirrorReactive 98% lines, 64% branches), Slither 0.11 (no finding beyond events after external calls to trusted
  contracts and naming).
- Live state, read only: the runtime bytecode of all four deployed contracts is identical to a build of `main`;
  owner, callback proxy, reactive sender, Governor, origin chain, threshold 2 of 3 and the trusted list match the
  deployment file; neither contract is in debt; the owner's 1,000 votes are delegated to VoteMirror.
- Two findings (M-1, L-1) were reproduced on a local fork of Base Sepolia by impersonating Reactive's relayer. No
  transaction was sent to a real network.

## Findings

### M-1 Anyone can spend VoteMirror's callback balance with callbacks it rejects

`castMirrored` rejects a callback that another reactive contract requested (`onlyCallbackSender`,
`src/VoteMirror.sol:56-59`), but the callback proxy bills the recipient whether the call succeeded or not
(`CallbackProxy._callback`: `_charge(address(contract_), adjustedGasPrice)` runs after the call, with no check of
its result), and VoteMirror pays whatever the proxy asks through the inherited `pay(uint256)`
(`AbstractPayer.sol:51-53`).

So anyone can deploy a reactive contract on Lasna that requests callbacks with `recipient = VoteMirror`. Each one
reverts in VoteMirror and still costs it gas. When the balance is gone VoteMirror goes into debt, the proxy
refuses further callbacks (`InDebt`), and because MirrorReactive asks only once per proposal (L-2), the proposals
that reach agreement in that time are never mirrored.

Reproduced on a fork: a rejected callback cost VoteMirror 575,731,200,000 wei at a gas price of 0.006 gwei. The
current balance of 0.01999 ETH covers about 34,700 of them, so on Base Sepolia today this is expensive to do and
cheap to recover from. The cost to the victim grows with the gas price of the destination chain.

This cannot be fully fixed in VoteMirror, the charge is made by the proxy. Keep only a
small balance in the contract, watch `debt()` and the balance, and give the owner a way to have a proposal
mirrored again after an outage (L-2).

### L-1 Reactive's relayer and the proxy owner can make VoteMirror cast any vote

The README says "Nobody else can make VoteMirror vote". The two checks in `castMirrored` hold against other
contracts and accounts, but not against Reactive itself: the proxy forwards the payload unchanged
(`_callback(config.recipient, config.payload)`), so the first argument is whatever the relayer submits. The
relayer accounts allowed by the proxy (`onlyOperators`) can deliver `castMirrored(MirrorReactive, anyProposal,
anySupport)`, and the proxy is upgradeable by its owner, an externally owned account on Base Sepolia.

Reproduced on a fork: with the relayer impersonated, VoteMirror voted Against on a new proposal that no trusted
voter had voted on.

The reach is limited to `castVoteWithReason` on the one Governor, with the voting power delegated to VoteMirror;
tokens cannot be moved, and `setPaused`, `setSkipped` and an earlier `castVote` still stop it. This is the trust
model of any Reactive callback contract. The README wording was corrected.

### L-2 A skipped, paused or failed callback is final for that proposal

`MirrorReactive.react` sets `mirrorRequested[proposalId] = true` before the callback is delivered
(`src/MirrorReactive.sol:94-96`) and nothing clears it. If the callback then ends in `Skipped` (paused, skipped
by the owner, not active yet) or is lost on the way (the proxy incident on 2026-11-23, VoteMirror in debt), no
later trusted vote requests it again. Lifting the pause or the skip does not bring the vote back.

The owner could still vote with `castVote()`. Fixed with `retryMirror()`; tests:
`test_Loop_UnskippedProposalIsMirroredAfterRetry`, `test_Loop_ProposalSkippedWhilePausedIsMirroredAfterRetry`,
`test_Loop_RetryAfterMirroredVoteIsSkipped`, `test_RevertWhen_RetryWithoutAgreement`.

### L-3 One trusted voter alone can run up MirrorReactive's fees

Every first `VoteCast` of a trusted voter on any proposal is delivered to `react()` and billed
(`src/MirrorReactive.sol:77-92`, one subscription per voter at `:178`). The threshold protects the vote, not the
fee balance: a single trusted voter can vote on as many proposals as exist, and on a Governor with a proposal
threshold of zero, such as DemoGovernor, can create those proposals too. When the lREACT balance is used up the
subscriptions stop being served and nothing is mirrored until the owner pays the debt.

### L-4 Votes of a removed voter count again when the voter is added back

`removeTrusted` takes the voter out of the list but keeps `recordedVote` (`src/MirrorReactive.sol:142-158`), and
`agreement` reads it for whoever is in the list (`:112-117`). The comment on `removeTrusted` says the votes "no
longer count"; after `addTrusted` for the same address they do again, on every proposal still open. The reverse
also holds: a vote cast while the address was not trusted is never counted.

Fixed; tests: `test_ReAddedVoterDoesNotBringBackOldVotes`, `test_VoteCastBeforeBeingTrustedIsNotCounted`.

### I-1 `renounceOwnership` and one-step transfer are left enabled

Both contracts inherit OpenZeppelin `Ownable` unchanged. `renounceOwnership()` on VoteMirror would leave it
voting with no pause, skip, override or `withdraw`; on MirrorReactive it would freeze the trusted list and strand
the balance. `transferOwnership` to a wrong address has the same effect. `Ownable2Step` and a reverting
`renounceOwnership` would close this.

### I-2 VoteMirror's constructor accepts any address

`callbackProxy_`, `reactive_` and `governor_` are immutable and unchecked (`src/VoteMirror.sol:44-50`). A wrong
value cannot be repaired, and the contract cannot check the cross-chain pairing with MirrorReactive at all. The
deployed values were checked and are correct.

### I-3 `agreement(id, 255)` reverts

`recordedVote[...] == support_ + 1` (`src/MirrorReactive.sol:115`) overflows a `uint8` for 255. `react()` never
passes a value above 2, so only an outside caller of the view is affected.
Fixed; test: `test_AgreementIsZeroForUnknownSupport`.

### I-4 Trusted votes count whatever their weight, and without waiting for finality

`react()` ignores the `weight` field, so a trusted address with no voting power counts as much as any other, and
it acts on the log as soon as Reactive delivers it; a `VoteCast` that is later reorganized away stays recorded.

### I-5 Keys in the scripts

`script/lib.sh:34,42` passes keys with `--private-key`, which shows them in the process list of the machine, and
one `.env` holds the owner key and every trusted voter key. On the live demo the owner and the three "trusted
voters" are therefore one key holder, which is fine for a demo and must not be copied to a real setup.

### I-6 Build hygiene

The sources use `pragma solidity ^0.8.29` (the compiler is pinned to 0.8.30 in `foundry.toml`), and the CI
workflow pins `actions/checkout` and `foundry-toolchain` by tag, not by commit.

## Checked and found sound

- Only the callback proxy can call `castMirrored`, and a callback requested by another reactive contract reverts.
- Only the system contract can call `react()`; logs of another chain, contract or event are ignored.
- A voter is counted once per proposal, a proposal is requested once, and both sides are counted separately.
- The owner's manual vote, pause and skip win over a callback that arrives later.
- Neither contract can move the owner's tokens; `withdraw` is owner only; `coverDebt` can only pay the service
  provider what it is owed.
- The callback receives about 417,000 gas of the 600,000 requested after the proxy's own reserve; a whole delivery
  transaction with a mirrored vote on the demo Governor used about 129,000.
