// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Governor } from "@openzeppelin/contracts/governance/Governor.sol";
import { GovernorCountingSimple } from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import { GovernorSettings } from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import { GovernorVotes } from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import { IRecoveryGovernor } from "../interfaces/IRecoveryGovernor.sol";
import { IVoteReceipts } from "../interfaces/IVoteReceipts.sol";
import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";

/// @title DemoGovernor
/// @notice Plain OpenZeppelin Governor for the VoteMirror demo. Delay and period are in seconds,
///         because the token uses a timestamp clock.
contract DemoGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    IVoteReceipts,
    IRecoveryGovernor
{
    uint256 public constant MAX_OPEN_PROPOSALS = 32;
    uint256[] private _recoveryProposals;
    error TooManyOpenProposals();

    function recoveryProposals() external view returns (uint256[] memory) {
        return _recoveryProposals;
    }

    function _propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description,
        address proposer
    ) internal override returns (uint256 id) {
        // Old closed entries are removed on proposal creation, keeping discovery bounded forever.
        uint256 i;
        while (i < _recoveryProposals.length) {
            ProposalState status = state(_recoveryProposals[i]);
            if (status != ProposalState.Pending && status != ProposalState.Active) {
                _recoveryProposals[i] = _recoveryProposals[_recoveryProposals.length - 1];
                _recoveryProposals.pop();
            } else {
                ++i;
            }
        }
        if (_recoveryProposals.length == MAX_OPEN_PROPOSALS) revert TooManyOpenProposals();
        id = super._propose(targets, values, calldatas, description, proposer);
        _recoveryProposals.push(id);
    }

    struct Receipt {
        uint8 choice;
        uint256 sequence;
    }

    uint256 public override voteSequence;
    mapping(uint256 => mapping(address => Receipt)) private _receipts;

    function voteReceipt(uint256 proposalId, address voter) external view returns (uint8, uint256) {
        Receipt memory receipt = _receipts[proposalId][voter];
        return (receipt.choice, receipt.sequence);
    }

    function _countVote(uint256 proposalId, address account, uint8 support, uint256 weight, bytes memory params)
        internal
        override(Governor, GovernorCountingSimple)
        returns (uint256)
    {
        uint256 counted = super._countVote(proposalId, account, support, weight, params);
        _receipts[proposalId][account] = Receipt(support + 1, ++voteSequence);
        return counted;
    }

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
