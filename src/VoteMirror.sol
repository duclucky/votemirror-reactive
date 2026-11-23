// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";
import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { AbstractCallback } from "@reactive/src/base/AbstractCallback.sol";

/// @title VoteMirror
/// @notice Holds the owner's delegated voting power (never their tokens) and casts a vote when the
///         owner's MirrorReactive reports that enough trusted voters agreed. The owner can vote
///         directly, skip single proposals, or pause mirroring at any time.
/// @dev Business conditions that are not met emit `Skipped` instead of reverting, because a
///      reverting callback is still charged by the callback proxy.
contract VoteMirror is AbstractCallback, Ownable {
    enum SkipReason {
        Paused,
        SkippedByOwner,
        AlreadyVoted,
        NotActive,
        CastFailed
    }

    string public constant MIRROR_REASON = "VoteMirror: trusted voters agreed";

    IGovernor public immutable GOVERNOR;

    /// @notice When true, no mirrored vote is cast.
    bool public paused;

    /// @notice Proposals the owner does not want mirrored.
    mapping(uint256 proposalId => bool) public skipped;

    event Mirrored(uint256 indexed proposalId, uint8 support, uint256 weight);
    event Skipped(uint256 indexed proposalId, uint8 support, SkipReason reason);
    event PausedSet(bool paused);
    event SkipSet(uint256 indexed proposalId, bool skipped);

    /// @param callbackProxy_ Reactive callback proxy of this chain.
    /// @param reactive_ MirrorReactive on Reactive Network allowed to trigger `castMirrored`. Immutable.
    /// @param governor_ Governor to vote on.
    /// @param owner_ Token holder who delegates voting power to this contract.
    /// @dev `payable` so the contract can be funded for callback fees at deployment.
    constructor(IPayable callbackProxy_, address reactive_, IGovernor governor_, address owner_)
        payable
        AbstractCallback(callbackProxy_, reactive_)
        Ownable(owner_)
    {
        GOVERNOR = governor_;
    }

    // ------------------------------------------------------------------ callback

    /// @notice Callback entry point: casts `support_` on `proposalId_` unless the owner's controls say otherwise.
    /// @param reactive_ Address of the requesting reactive contract, injected by the callback proxy.
    function castMirrored(address reactive_, uint256 proposalId_, uint8 support_)
        external
        onlyServiceProvider
        onlyCallbackSender(reactive_)
    {
        if (paused) {
            emit Skipped(proposalId_, support_, SkipReason.Paused);
            return;
        }
        if (skipped[proposalId_]) {
            emit Skipped(proposalId_, support_, SkipReason.SkippedByOwner);
            return;
        }
        if (GOVERNOR.hasVoted(proposalId_, address(this))) {
            emit Skipped(proposalId_, support_, SkipReason.AlreadyVoted);
            return;
        }
        if (!_isActive(proposalId_)) {
            emit Skipped(proposalId_, support_, SkipReason.NotActive);
            return;
        }
        try GOVERNOR.castVoteWithReason(proposalId_, support_, MIRROR_REASON) returns (uint256 weight) {
            emit Mirrored(proposalId_, support_, weight);
        } catch {
            emit Skipped(proposalId_, support_, SkipReason.CastFailed);
        }
    }

    // ------------------------------------------------------------------ owner controls

    /// @notice Owner override: vote directly. A later mirrored vote for the proposal is skipped.
    function castVote(uint256 proposalId_, uint8 support_, string calldata reason_)
        external
        onlyOwner
        returns (uint256)
    {
        return GOVERNOR.castVoteWithReason(proposalId_, support_, reason_);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function setSkipped(uint256 proposalId_, bool skipped_) external onlyOwner {
        skipped[proposalId_] = skipped_;
        emit SkipSet(proposalId_, skipped_);
    }

    /// @notice Settles outstanding debt to the callback proxy from this contract's balance.
    function coverDebt() external {
        _coverDebt();
    }

    /// @notice Returns unused callback fee funds to the owner.
    function withdraw(uint256 amount_) external onlyOwner {
        _pay(payable(msg.sender), amount_);
    }

    // ------------------------------------------------------------------ internals

    /// @dev `state()` reverts for unknown proposals, which counts as not active.
    function _isActive(uint256 proposalId_) internal view returns (bool) {
        try GOVERNOR.state(proposalId_) returns (IGovernor.ProposalState state_) {
            return state_ == IGovernor.ProposalState.Active;
        } catch {
            return false;
        }
    }
}
