# VoteMirror demo video script

The video is 1:55 long: generated screens with an English text-to-speech voice-over and captions. The terminal
output and explorer pages in it are from the run listed under "Run shown in the demo video" in the README.

| Time | Screen | Voice-over |
| --- | --- | --- |
| 0:00 to 0:14 | Problem: three cards (most holders never vote, delegate everything, follow k of n) | "Most token holders never vote. Delegating hands one person all of your voting power, on every proposal. VoteMirror is the middle ground: your votes follow a group of voters you trust, and only when enough of them agree." |
| 0:14 to 0:39 | Animated architecture diagram: Base Sepolia and Reactive Lasna | "It is two contracts. MirrorReactive lives on Reactive Network and listens to the Governor's VoteCast events on Base Sepolia, with one subscription per trusted voter. When k of n pick the same side, it asks Reactive for a callback. VoteMirror, on Base Sepolia, receives that callback and casts the vote. Your tokens never leave your wallet: you only delegate voting power." |
| 0:39 to 1:06 | `./script/demo.sh for` output, then the react transaction on Reactscan and the callback on Blockscout | "Loop one, on live testnets. A proposal opens. Trusted voter one votes For. Nothing happens: one of three is not enough. Trusted voter two votes For. The reactive contract now counts two of three and requests the callback, and about a second later VoteMirror votes For with the owner's 1,000 tokens. The explorer shows the callback transaction, delivered by Reactive's callback proxy, and the vote it cast." |
| 1:06 to 1:17 | `./script/demo.sh against` output, then the callback on Blockscout | "Loop two. Same flow, but this time the trusted voters vote Against, so VoteMirror votes Against. It copies the side they agree on, not a fixed answer." |
| 1:17 to 1:33 | `./script/demo.sh skip` output, then the `Skipped` event on Blockscout and the owner controls | "Loop three. The owner wants to judge this proposal personally, and marks it skipped. Two trusted voters still agree, and the callback still arrives, but VoteMirror emits Skipped instead of voting. The owner can also pause everything, or cast the vote directly." |
| 1:33 to 1:50 | `forge test` output, contract addresses, README contents | "46 Foundry tests cover the k-of-n rule, duplicate votes, the owner override, pause, and who is allowed to deliver the callback. Everything runs on testnets only. Addresses, transaction hashes and known limitations are in the README." |
| 1:50 to 1:55 | Title and repository URL | "VoteMirror: stay a voter, without reading every proposal." |
