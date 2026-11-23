# VoteMirror demo video script (under 3 minutes)

Screen: terminal on the left, Base Sepolia and Reactive Lasna explorers on the right.

| Time | Screen | Voice-over |
| --- | --- | --- |
| 0:00 to 0:20 | Title card, then a DAO proposal page with low turnout | "Most token holders never vote. Delegating gives one person all your voting power, forever. VoteMirror is the middle ground: your votes follow a group of voters you trust, only when enough of them agree." |
| 0:20 to 0:45 | Architecture diagram from the README | "Two contracts. MirrorReactive lives on Reactive Network and listens to the Governor's VoteCast events on Base Sepolia, one subscription per trusted voter. When k of n pick the same side, it asks Reactive for a callback. VoteMirror on Base Sepolia receives it and casts the vote. Your tokens never leave your wallet: you only delegate voting power." |
| 0:45 to 1:25 | `./script/demo.sh for`, then the four transactions in the explorers | "Loop one. A proposal opens. Trusted voter one votes For: nothing happens, one of three is not enough. Trusted voter two votes For: the reactive contract sees two of three, requests the callback, and VoteMirror votes For with my 1,000 tokens. Here are the source vote, the react transaction on Lasna, and the callback on Base Sepolia." |
| 1:25 to 1:55 | `./script/demo.sh against` | "Loop two. Same flow, the trusted voters vote Against, and VoteMirror votes Against. It copies the side they agree on, not a fixed answer." |
| 1:55 to 2:25 | `./script/demo.sh skip` | "Loop three. I want to judge this one myself, so I mark it skipped. Two trusted voters agree, the callback arrives, and VoteMirror emits Skipped instead of voting. I can also pause everything or cast my own vote, which always wins." |
| 2:25 to 2:50 | README sections: tests, addresses, limitations | "46 Foundry tests cover the k of n rule, duplicate votes, override, pause and who is allowed to call the callback. Everything is on testnet, addresses and transaction hashes are in the README." |
| 2:50 to 3:00 | Repo URL | "VoteMirror: stay a voter without reading every proposal." |
