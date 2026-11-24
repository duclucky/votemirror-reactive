// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";
import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { AbstractCallback } from "@reactive/src/base/AbstractCallback.sol";

/// @title VoteMirror
/// @notice Holds the owner's delegated voting power (never their tokens) and casts a vote when the
///         owner's MirrorReactive reports that enough trusted voters agreed. The owner can vote
///         directly, skip single proposals, or pause mirroring at any time.
/// @dev Business conditions that are not met emit `Skipped` instead of reverting, because a
///      reverting callback is still charged by the callback proxy.
///      The callback is not taken at its word: before voting, the contract checks on the Governor itself
///      that at least `threshold` of the trusted voters have voted on the proposal. A callback that
///      Reactive's relayer made up, or one based on votes that a reorg removed, ends in `Skipped`. The
///      Governor does not expose which side a voter chose, so the side still comes from the callback.
contract VoteMirror is AbstractCallback, Ownable2Step {
    enum SkipReason {
        Paused,
        SkippedByOwner,
        AlreadyVoted,
        NotActive,
        CastFailed,
        NotConfirmed
    }

    /// @dev Bounds the `hasVoted` calls made inside the callback.
    uint256 public constant MAX_TRUSTED = 16;

    string public constant MIRROR_REASON = "VoteMirror: trusted voters agreed";

    IGovernor public immutable GOVERNOR;

    /// @notice When true, no mirrored vote is cast.
    bool public paused;

    /// @notice Proposals the owner does not want mirrored.
    mapping(uint256 proposalId => bool) public skipped;

    /// @notice Number of trusted voters that must have voted on the Governor before a mirrored vote is cast.
    ///         Kept equal to MirrorReactive's threshold by the owner.
    uint256 public threshold;

    address[] private _trusted;
    mapping(address voter => bool) public isTrusted;

    event Mirrored(uint256 indexed proposalId, uint8 support, uint256 weight);
    event Skipped(uint256 indexed proposalId, uint8 support, SkipReason reason);
    event PausedSet(bool paused);
    event SkipSet(uint256 indexed proposalId, bool skipped);
    event ThresholdSet(uint256 threshold);
    event TrustedVoterAdded(address indexed voter);
    event TrustedVoterRemoved(address indexed voter);

    error InvalidThreshold(uint256 threshold, uint256 trustedCount);
    error TooManyTrusted();
    error AlreadyTrusted(address voter);
    error NotTrusted(address voter);
    error ZeroAddress();
    error RenounceDisabled();

    /// @param callbackProxy_ Reactive callback proxy of this chain.
    /// @param reactive_ MirrorReactive on Reactive Network allowed to trigger `castMirrored`. Immutable.
    /// @param governor_ Governor to vote on.
    /// @param owner_ Token holder who delegates voting power to this contract.
    /// @param trusted_ The voters MirrorReactive follows.
    /// @param threshold_ How many of them must have voted (k of n), as in MirrorReactive.
    /// @dev `payable` so the contract can be funded for callback fees at deployment.
    constructor(
        IPayable callbackProxy_,
        address reactive_,
        IGovernor governor_,
        address owner_,
        address[] memory trusted_,
        uint256 threshold_
    ) payable AbstractCallback(callbackProxy_, reactive_) Ownable(owner_) {
        if (address(callbackProxy_) == address(0) || reactive_ == address(0) || address(governor_) == address(0)) {
            revert ZeroAddress();
        }
        GOVERNOR = governor_;
        for (uint256 i = 0; i < trusted_.length; ++i) {
            _addTrusted(trusted_[i]);
        }
        _setThreshold(threshold_);
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
        if (_hasVoted(proposalId_, address(this))) {
            emit Skipped(proposalId_, support_, SkipReason.AlreadyVoted);
            return;
        }
        if (!_isActive(proposalId_)) {
            emit Skipped(proposalId_, support_, SkipReason.NotActive);
            return;
        }
        if (confirmations(proposalId_) < threshold) {
            emit Skipped(proposalId_, support_, SkipReason.NotConfirmed);
            return;
        }
        try GOVERNOR.castVoteWithReason(proposalId_, support_, MIRROR_REASON) returns (uint256 weight) {
            emit Mirrored(proposalId_, support_, weight);
        } catch {
            emit Skipped(proposalId_, support_, SkipReason.CastFailed);
        }
    }

    // ------------------------------------------------------------------ views

    /// @notice Number of trusted voters that have voted on `proposalId_` on the Governor, whatever their choice.
    function confirmations(uint256 proposalId_) public view returns (uint256 count_) {
        uint256 length = _trusted.length;
        for (uint256 i = 0; i < length; ++i) {
            if (_hasVoted(proposalId_, _trusted[i])) ++count_;
        }
    }

    function trustedVoters() external view returns (address[] memory) {
        return _trusted;
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

    /// @notice Trusted list and threshold mirror MirrorReactive's: change both contracts together.
    function setThreshold(uint256 threshold_) external onlyOwner {
        _setThreshold(threshold_);
    }

    function addTrusted(address voter_) external onlyOwner {
        _addTrusted(voter_);
    }

    function removeTrusted(address voter_) external onlyOwner {
        if (!isTrusted[voter_]) revert NotTrusted(voter_);
        uint256 length = _trusted.length;
        if (length - 1 < threshold) revert InvalidThreshold(threshold, length - 1);
        for (uint256 i = 0; i < length; ++i) {
            if (_trusted[i] == voter_) {
                _trusted[i] = _trusted[length - 1];
                _trusted.pop();
                break;
            }
        }
        isTrusted[voter_] = false;
        emit TrustedVoterRemoved(voter_);
    }

    /// @notice Settles outstanding debt to the callback proxy from this contract's balance.
    function coverDebt() external {
        _coverDebt();
    }

    /// @notice Returns unused callback fee funds to the owner.
    function withdraw(uint256 amount_) external onlyOwner {
        _pay(payable(msg.sender), amount_);
    }

    /// @dev Giving up ownership would leave the contract voting with no pause, skip, override or withdrawal.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ------------------------------------------------------------------ internals

    function _addTrusted(address voter_) internal {
        if (voter_ == address(0)) revert ZeroAddress();
        if (isTrusted[voter_]) revert AlreadyTrusted(voter_);
        if (_trusted.length == MAX_TRUSTED) revert TooManyTrusted();
        isTrusted[voter_] = true;
        _trusted.push(voter_);
        emit TrustedVoterAdded(voter_);
    }

    function _setThreshold(uint256 threshold_) internal {
        if (threshold_ == 0 || threshold_ > _trusted.length) revert InvalidThreshold(threshold_, _trusted.length);
        threshold = threshold_;
        emit ThresholdSet(threshold_);
    }

    /// @dev A Governor that reverts here counts as "not voted", so the callback never reverts on it.
    function _hasVoted(uint256 proposalId_, address account_) internal view returns (bool) {
        try GOVERNOR.hasVoted(proposalId_, account_) returns (bool voted) {
            return voted;
        } catch {
            return false;
        }
    }

    /// @dev `state()` reverts for unknown proposals, which counts as not active.
    function _isActive(uint256 proposalId_) internal view returns (bool) {
        try GOVERNOR.state(proposalId_) returns (IGovernor.ProposalState state_) {
            return state_ == IGovernor.ProposalState.Active;
        } catch {
            return false;
        }
    }
}
