// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Simple, immutable ballots recorded by the Governor in the same transaction that counts them.
/// @dev Sequence is globally increasing, starts at one and is unique per accepted ballot.
///      Choices use support + 1; zero denotes no ballot. Fractional and mutable ballots are unsupported.
interface IVoteReceipts {
    function voteSequence() external view returns (uint256);
    function voteReceipt(uint256 proposalId, address voter) external view returns (uint8 choice, uint256 sequence);
}
