// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Bounded discovery of pending or active proposals for relay-independent recovery.
interface IRecoveryGovernor {
    function recoveryProposals() external view returns (uint256[] memory);
}
