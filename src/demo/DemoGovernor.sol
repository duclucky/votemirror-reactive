// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Governor } from "@openzeppelin/contracts/governance/Governor.sol";
import { GovernorCountingSimple } from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import { GovernorSettings } from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import { GovernorVotes } from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";

/// @title DemoGovernor
/// @notice Plain OpenZeppelin Governor for the VoteMirror demo. Delay and period are in seconds,
///         because the token uses a timestamp clock.
contract DemoGovernor is Governor, GovernorSettings, GovernorCountingSimple, GovernorVotes {
    constructor(IVotes token_, uint48 votingDelaySeconds_, uint32 votingPeriodSeconds_)
        Governor("VoteMirror Demo Governor")
        GovernorSettings(votingDelaySeconds_, votingPeriodSeconds_, 0)
        GovernorVotes(token_)
    { }

    function quorum(uint256) public pure override returns (uint256) {
        return 1e18;
    }

    function proposalThreshold() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.proposalThreshold();
    }
}
