// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IRecoveryGovernor } from "./interfaces/IRecoveryGovernor.sol";
import { IVoteReceipts } from "./interfaces/IVoteReceipts.sol";
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
///      Same-side agreement is verified from immutable, ordered Governor receipts on this chain.
contract VoteMirror is AbstractCallback, Ownable2Step {
    enum SkipReason {
        Paused,
        SkippedByOwner,
        AlreadyVoted,
        NotActive,
        CastFailed,
        NotConfirmed,
        PolicyMismatch
    }

    /// @dev Bounds receipt reads and sorting in the callback.
    uint256 public constant MAX_TRUSTED = 16;

    string public constant MIRROR_REASON = "VoteMirror: trusted voters agreed";

    IGovernor public immutable GOVERNOR;

    /// @notice When true, no mirrored vote is cast.
    bool public paused;

    /// @notice Proposals the owner does not want mirrored.
    mapping(uint256 proposalId => bool) public skipped;

    /// @notice Number of currently trusted voters that must agree according to the Governor's receipts.
    ///         Kept equal to MirrorReactive's threshold by the owner.
    uint256 public threshold;

    uint256 public policyVersion = 1;
    mapping(address => uint256) public trustedAfterSequence;
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
    /// @param threshold_ How many of them must agree (k of n), as in MirrorReactive.
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
    function castMirrored(address reactive_, uint256 proposalId_, uint8 support_, bytes32 policy_)
        external
        onlyServiceProvider
        onlyCallbackSender(reactive_)
    {
        if (policy_ != policyHash()) {
            emit Skipped(proposalId_, support_, SkipReason.PolicyMismatch);
            return;
        }
        _castVerified(proposalId_, support_);
    }

    /// @notice Owner recovery when origin logs or the relay are unavailable.
    ///         Uses the same receipt verification, pause and skip controls as a callback.
    function reconcileVote(uint256 proposalId_, uint8 support_) external onlyOwner {
        _castVerified(proposalId_, support_);
    }

    uint256 public recoveryCursor;
    uint256 public constant RECOVERY_BATCH_SIZE = 2;
    uint256 public constant MAX_RECOVERY_PROPOSALS = 32;
    event RecoveryScanned(uint256 scanned, uint256 nextCursor);
    event RecoveryUnavailable();

    /// @notice Anyone can pay to restore a vote without possessing owner authority.
    function reconcileProposal(uint256 proposalId_) public {
        (bool reached, uint8 support) = confirmedSupport(proposalId_);
        if (reached) _castVerified(proposalId_, support);
    }

    /// @notice Scheduled, bounded recovery. Discovery comes from the Governor, not delivered vote logs.
    function reconcileBatch(address reactive_) external onlyServiceProvider onlyCallbackSender(reactive_) {
        if (paused) return;
        try IRecoveryGovernor(address(GOVERNOR)).recoveryProposals() returns (uint256[] memory proposals) {
            uint256 length = proposals.length;
            if (length == 0) {
                recoveryCursor = 0;
                emit RecoveryScanned(0, 0);
                return;
            }
            if (length > MAX_RECOVERY_PROPOSALS) {
                emit RecoveryUnavailable();
                return;
            }
            uint256 scanned = length < RECOVERY_BATCH_SIZE ? length : RECOVERY_BATCH_SIZE;
            uint256 cursor = recoveryCursor % length;
            for (uint256 i; i < scanned; ++i) {
                uint256 id = proposals[cursor];
                if (_isActive(id) && !skipped[id] && !_hasVoted(id, address(this))) reconcileProposal(id);
                cursor = (cursor + 1) % length;
            }
            recoveryCursor = cursor;
            emit RecoveryScanned(scanned, cursor);
        } catch {
            emit RecoveryUnavailable();
        }
    }

    function _castVerified(uint256 proposalId_, uint8 support_) internal {
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
        (bool reached, uint8 winner) = confirmedSupport(proposalId_);
        if (!reached || winner != support_) {
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

    /// @notice First choice to reach k according to the Governor's ballot order.
    ///         Receipt order, rather than relay arrival order, resolves ties even when 2k <= n.
    function confirmedSupport(uint256 proposalId_) public view returns (bool reached, uint8 support) {
        uint256 length = _trusted.length;
        uint256[] memory sequences = new uint256[](length);
        uint8[] memory choices = new uint8[](length);
        uint256 valid;
        for (uint256 i; i < length; ++i) {
            address voter = _trusted[i];
            try IVoteReceipts(address(GOVERNOR)).voteReceipt(proposalId_, voter) returns (
                uint8 choice, uint256 sequence
            ) {
                if (choice == 0 || choice > 3 || sequence <= trustedAfterSequence[voter]) continue;
                uint256 j = valid;
                while (j > 0 && sequences[j - 1] > sequence) {
                    sequences[j] = sequences[j - 1];
                    choices[j] = choices[j - 1];
                    --j;
                }
                sequences[j] = sequence;
                choices[j] = choice;
                ++valid;
            } catch {
                // A receipt that cannot be read supplies no evidence.
            }
        }
        uint256[3] memory counts;
        for (uint256 i; i < valid; ++i) {
            uint8 side = choices[i] - 1;
            if (++counts[side] == threshold) return (true, side);
        }
    }

    /// @notice Binds callback to the ordered voter list, threshold and configuration revision.
    function policyHash() public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(GOVERNOR), policyVersion, threshold, _trusted));
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

    /// @notice Apply the same configuration operations in the same order on MirrorReactive.
    function setThreshold(uint256 threshold_) external onlyOwner {
        _setThreshold(threshold_);
        ++policyVersion;
    }

    function addTrusted(address voter_) external onlyOwner {
        _addTrusted(voter_);
        ++policyVersion;
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
        ++policyVersion;
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
        // Fail deployment/configuration if the Governor lacks the required receipt API.
        trustedAfterSequence[voter_] = IVoteReceipts(address(GOVERNOR)).voteSequence();
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
