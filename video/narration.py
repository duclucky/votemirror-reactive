# scene id -> list of (caption shown on screen, text spoken by the TTS)
S = {
 "intro": [
  ("Most token holders never vote.", "Most token holders never vote."),
  ("Delegating hands one person all of your voting power, on every proposal.", "Delegating hands one person all of your voting power, on every proposal."),
  ("VoteMirror is the middle ground: your votes follow a group of voters you trust,", "Vote Mirror is the middle ground: your votes follow a group of voters you trust,"),
  ("and only when enough of them agree.", "and only when enough of them agree."),
 ],
 "arch": [
  ("It is two contracts.", "It is two contracts."),
  ("MirrorReactive lives on Reactive Network and listens to the Governor's VoteCast events on Base Sepolia,", "Mirror Reactive lives on Reactive Network, and listens to the Governor's Vote Cast events on Base Sepolia,"),
  ("with one subscription per trusted voter.", "with one subscription per trusted voter."),
  ("When k of n pick the same side, it asks Reactive for a callback.", "When K of N pick the same side, it asks Reactive for a callback."),
  ("VoteMirror, on Base Sepolia, receives that callback,", "Vote Mirror, on Base Sepolia, receives that callback,"),
  ("checks on the Governor that enough trusted voters really voted, and casts the vote.", "checks on the Governor that enough trusted voters really voted, and casts the vote."),
  ("Your tokens never leave your wallet: you only delegate voting power.", "Your tokens never leave your wallet: you only delegate voting power."),
 ],
 "for": [
  ("Loop one, on the public testnets. A proposal opens.", "Loop one, on the public test nets. A proposal opens."),
  ("Trusted voter one votes For. Nothing happens: one of three is not enough.", "Trusted voter one votes For. Nothing happens: one of three is not enough."),
  ("Trusted voter two votes For.", "Trusted voter two votes For."),
  ("The reactive contract now counts two of three and requests the callback,", "The reactive contract now counts two of three, and requests the callback,"),
  ("and about a second later VoteMirror votes For with the owner's 1,000 tokens.", "and about a second later, Vote Mirror votes For, with the owner's one thousand tokens."),
  ("The explorer shows the callback transaction, sent through Reactive Network's callback proxy,", "The explorer shows the callback transaction, sent through Reactive Network's callback proxy,"),
  ("and the For vote cast by VoteMirror.", "and the For vote, cast by Vote Mirror."),
 ],
 "against": [
  ("Loop two. Same flow, but this time the trusted voters vote Against,", "Loop two. Same flow, but this time the trusted voters vote Against,"),
  ("so VoteMirror votes Against.", "so Vote Mirror votes Against."),
  ("It mirrors the side they agree on, not a fixed answer.", "It mirrors the side they agree on, not a fixed answer."),
 ],
 "skip": [
  ("Loop three. The owner wants to judge this proposal personally, and marks it skipped.", "Loop three. The owner wants to judge this proposal personally, and marks it skipped."),
  ("Two trusted voters still agree, and the callback still arrives,", "Two trusted voters still agree, and the callback still arrives,"),
  ("but VoteMirror emits Skipped instead of voting.", "but Vote Mirror emits Skipped, instead of voting."),
  ("The owner can also pause everything, or cast the vote directly.", "The owner can also pause everything, or cast the vote directly."),
 ],
 "retry": [
  ("Loop four. VoteMirror is paused when the trusted voters agree.", "Loop four. Vote Mirror is paused, when the trusted voters agree."),
  ("The callback still arrives, and is answered with Skipped, not a failed transaction.", "The callback still arrives, and is answered with Skipped, not a failed transaction."),
  ("The vote is not lost. The owner unpauses, and calls retryMirror on Reactive.", "The vote is not lost. The owner un-pauses, and calls retry Mirror, on Reactive."),
  ("A second callback is delivered, and VoteMirror votes For.", "A second callback is delivered, and Vote Mirror votes For."),
  ("A retry only goes through for the side the trusted voters agreed on.", "A retry only goes through for the side the trusted voters agreed on."),
 ],
 "tests": [
  ("77 Foundry tests cover the k-of-n rule, duplicate votes, owner overrides,", "Seventy seven Foundry tests cover the K of N rule, duplicate votes, owner overrides,"),
  ("pause, retry, and who is allowed to deliver the callback.", "pause, retry, and who is allowed to deliver the callback."),
  ("These contracts include the fixes from a security review, and their source code is verified.", "These contracts include the fixes from a security review, and their source code is verified."),
  ("Everything runs on testnets only.", "Everything runs on test nets only."),
  ("Addresses, transaction hashes and known limitations are in the README.", "Addresses, transaction hashes, and known limitations, are in the read me."),
 ],
 "outro": [
  ("VoteMirror: stay a voter, without reading every proposal.", "Vote Mirror: stay a voter, without reading every proposal."),
 ],
}
