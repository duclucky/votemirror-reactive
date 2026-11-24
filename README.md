# VoteMirror

Vote in a DAO when **k of n trusted voters agree**, while retaining your tokens and the
ability to pause, skip a proposal or vote manually.

Built for the Reactive Omni Buildathon. The current deployment is **v4 on Base Sepolia
and Reactive Lasna**, with a VoteMirror-operated recovery sender on Base Sepolia.
This is a testnet project with an internal security review.

## How it works

1. The token holder delegates voting power to their VoteMirror contract.
2. MirrorReactive subscribes to the Governor's VoteCast and VoteCastWithParams events.
3. When a trusted group agrees, Reactive requests a callback.
4. VoteMirror independently checks the Governor's ordered ballot receipts on Base.
   It votes only for the first side to reach the current threshold.
5. A dedicated recovery sender discovers eligible proposals on Base and sends
   reconciliation transactions if the event-driven path has not completed.

The sender uses a separate fee wallet without owner authority. It persists signed
transactions before broadcast, uses RPC failover and same-nonce fee replacement, and
checks both the receipt and the Governor's vote state. Windows Task Scheduler restarts
the sender at login; its supervisor restarts failed child processes.

Optional CRON recovery is implemented and verified. **It is currently disabled** because
recurring Lasna fees depleted its testnet budget during observation. Event-driven
Reactive subscriptions and the Base recovery sender remain the operating paths.

## Current contracts

| Contract | Network | Address |
|---|---|---|
| DemoToken | Base Sepolia | [0x1c1000C7d8Ee05b97F5FF7bfCbA7c04aC9e58515](https://sepolia.basescan.org/address/0x1c1000C7d8Ee05b97F5FF7bfCbA7c04aC9e58515) |
| DemoGovernor | Base Sepolia | [0x04bB46C2E47F640Dd94bCfC0ea2aC9191364fafb](https://sepolia.basescan.org/address/0x04bB46C2E47F640Dd94bCfC0ea2aC9191364fafb) |
| VoteMirror | Base Sepolia | [0x4a89e26aD48A2729d8D95B3b446DBC1083AEF87a](https://sepolia.basescan.org/address/0x4a89e26aD48A2729d8D95B3b446DBC1083AEF87a) |
| MirrorReactive | Lasna | [0x81A8a6edf8B2d773FF53dc1450De4822c5756988](https://lasna.reactscan.net/address/0x81A8a6edf8B2d773FF53dc1450De4822c5756988) |

The deployment manifest is [hardened-testnet-v4.json](deployments/hardened-testnet-v4.json).
Current contract sources are verified on Sourcify. Creation bytecode, constructor arguments
and runtime were checked against the build in [v4-bytecode-check.json](deployments/v4-bytecode-check.json).

## Frontend dashboard

The [frontend](web/) provides current policy and proposal reads, browser-wallet proposal
creation and ballots, and nine clearly labeled historical demos. It rechecks receipt
status, contract addresses and decoded events before marking a recorded run verified.
Reactive callbacks, owner recovery and sender recovery retain distinct labels.

```sh
cd web
npm ci
npm run dev
```

Open the local URL printed by Vite. The frontend uses Base Sepolia and Lasna public
RPCs and never reads local keystores. See [web/README.md](web/README.md) for building,
Chrome browser checks and filming a demo. It is a single deployed holder workspace;
it does not create a personalized VoteMirror for each connecting wallet.

## Contract and service checks

Requirements are Foundry with Solidity 0.8.30 and Python 3. The deployment and local
service wrappers additionally require Windows PowerShell 7.

```sh
git clone --recurse-submodules https://github.com/duclucky/votemirror-reactive.git
cd votemirror-reactive
forge fmt --check
forge test --fuzz-runs 4096
python -m unittest discover -s service -p test_relayer.py -v
```

There are **112 Solidity tests** and **12 sender tests**. Four Solidity fuzz tests run
4,096 cases each with the command above. Tests cover wrong-side callbacks, stale policies,
out-of-order and missing logs, request failures, recovery gas limits, sender restarts,
ambiguous broadcasts, nonce replacement, receipt reorgs and fee accounting.

## Reproduce a testnet demo

Use a local wallet profile outside the repository with encrypted keystores named
owner, alice, bob and carol, an addresses.json file with those public address keys, and
password.dpapi.xml containing the shared keystore password exported as a Windows
SecureString. Restrict the profile directory to the current Windows user. All keys
must be testnet-only. The scripts never require raw private keys on their command line.

```powershell
# Supply your existing local wallet profile.
$wallets = "$env:USERPROFILE/.codex/wallets/your-votemirror-profile"

# Read-only funding check.
./script/deploy.ps1 -WalletDirectory $wallets

# Deploy a new immutable contract pair and Governor, using a fresh manifest.
./script/deploy.ps1 -WalletDirectory $wallets -Manifest deployments/my-testnet.json -Broadcast

# Run against the current deployment (use -Manifest for a separate deployment).
./script/demo.ps1 -WalletDirectory $wallets -Mode for -RunId demo-1
```

Demo modes are for, against, abstain, splitmajority, thirdvote, owneroverride, skip,
retry, reconcile, split, recovery, lostlogs and sender.
Use a unique RunId for a new scenario; reuse it only to resume that scenario's recorded
transactions. Some modes temporarily alter subscriptions or recovery settings.
A fresh deployment needs its own updated sender configuration and deployment wiring.
See the [sender operations guide](docs/relayer-service.md).

## Verified evidence

The [submission evidence index](docs/submission-evidence.md) records a fresh set of
eight scenarios with full origin → Lasna → Base callback links. Each trusted origin
ballot is matched against the transaction hash and raw log carried in the Lasna system
notification. The report separately labels an interrupted attempt recovered by the
Base sender; that direct recovery is excluded from the Reactive callback count.

To run this suite, use `script/run-evidence.ps1 -WalletDirectory <profile> -RunId <unique-id>`.
It temporarily stops the local recovery sender when its journal has no pending
transaction, restores the pause control on exit, and restarts the sender if it was
previously running. From `web/`, independently verify the resulting receipts with
`node scripts/verify-evidence-suite.mjs <run-id>`. This sends no transactions.

Eight contract scenarios passed on live testnets, with receipts and vote totals read
back. The [verification summary](deployments/v4-verification.json) links each scenario
to its result transaction.

The dedicated sender was also tested with CRON disabled and a trusted vote absent from
Lasna. It sent [this direct Base reconciliation](https://sepolia.basescan.org/tx/0xf432d30bfdfeb16d01917383d8e0ba3ee4264a915dcd58517f8767214fcdebe7).
The [sender proof](deployments/v4-sender-audit-service-2.json) records the source state,
transaction sender and successful vote. The [restart snapshot](deployments/relayer-runtime-verification.json)
is a historical observation, not a live status endpoint.

Read the [security and recovery review](docs/recovery-v4.md) for scope, assumptions and
remaining risks, and the [video outline](docs/video-script.md) for the current demo.

## Boundaries

- The Governor must implement immutable, unique, ordered IVoteReceipts. Scheduled and
  sender discovery additionally use IRecoveryGovernor. An arbitrary OpenZeppelin Governor
  without these APIs is not supported.
- Votes count by trusted address, including an accepted zero-weight ballot. Mutable or
  fractional ballots are outside the supported model.
- Policies on Base and Lasna must be updated with the same operations in the same order.
  Wrong-policy callbacks are rejected. Base independently validates the winning side.
- DemoGovernor allows at most 32 concurrent Pending/Active proposals. Scheduled recovery
  checks two entries per callback. Proposal timing uses timestamps.
- Relay availability, RPC access, fee funding and the Governor's deadline constrain
  completion. Proxy charges for rejected callbacks can still cause fee griefing.
- The deployed sender runs on the current Windows host while it is online and logged in.
  An always-on host and monitoring are required for a continuous operational commitment.
- Each deployment serves one token holder. The demo wallets share an operator.

## License

[MIT](LICENSE)
