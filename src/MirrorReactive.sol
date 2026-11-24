// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";
import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { AbstractReactive } from "@reactive/src/base/AbstractReactive.sol";

/// @title MirrorReactive
/// @notice Lives on Reactive Network. Watches the `VoteCast` and `VoteCastWithParams` events of one Governor
///         on an origin chain, subscribed per trusted voter, and asks the owner's VoteMirror to cast the same vote
///         once `threshold` trusted voters agree on a choice. A proposal is requested once by `react()`;
///         the owner can ask again with `retryMirror()` if that callback was skipped or lost.
contract MirrorReactive is AbstractReactive, Ownable2Step {
    /// @dev keccak256("VoteCast(address,uint256,uint8,uint256,string)"), the OpenZeppelin Governor event.
    uint256 public constant VOTE_CAST_TOPIC_0 = 0xb8e138887d0aa13bab447e82de9d5c1777041ecd21ca36ba824ff1e6c07ddda4;

    /// @dev keccak256("VoteCastWithParams(address,uint256,uint8,uint256,string,bytes)"), emitted instead of
    ///      `VoteCast` when a vote carries params. Its data starts with the same `proposalId` and `support`.
    uint256 public constant VOTE_CAST_WITH_PARAMS_TOPIC_0 =
        0xe2babfbac5889a709b63bb7f598b324e08bc5a4fb9ec647fb3cbc9ec07eb8712;

    /// @dev Highest support value of Governor Bravo style counting (0 Against, 1 For, 2 Abstain).
    uint8 public constant MAX_SUPPORT = 2;

    /// @dev Keeps the agreement count in `react()` far below the reactive transaction gas cap.
    uint256 public constant MAX_TRUSTED = 16;

    uint64 public constant CALLBACK_GAS_LIMIT = 600_000;

    uint256 public immutable ORIGIN_CHAIN_ID;
    address public immutable GOVERNOR;

    /// @notice VoteMirror on the origin chain that receives the callback.
    address public mirror;

    /// @notice Number of trusted voters that must agree before the vote is mirrored.
    uint256 public threshold;

    address[] private _trusted;
    mapping(address voter => bool) public isTrusted;

    /// @notice Number of times a voter was removed. Votes are recorded per epoch, so the votes seen before a
    ///         removal stay out of the count if the voter is trusted again later.
    mapping(address voter => uint256) public trustEpoch;

    /// @dev Choice of a voter for a proposal in a trust epoch, stored as `support + 1` (0 means no vote seen).
    mapping(uint256 proposalId => mapping(address voter => mapping(uint256 epoch => uint8))) private _recordedVote;

    /// @dev Choice requested for a proposal, stored as `support + 1` (0 means nothing was requested yet).
    ///      Set by the first request and never changed, so a retry cannot ask for another choice.
    mapping(uint256 proposalId => uint8) private _requested;

    event MirrorSet(address indexed mirror);
    event ThresholdSet(uint256 threshold);
    event TrustedVoterAdded(address indexed voter);
    event TrustedVoterRemoved(address indexed voter);
    event VoteObserved(uint256 indexed proposalId, address indexed voter, uint8 support, uint256 agreeing);
    event MirrorRequested(uint256 indexed proposalId, uint8 support, uint256 agreeing);
    event MirrorRetried(uint256 indexed proposalId, uint8 support, uint256 agreeing);

    error InvalidThreshold(uint256 threshold, uint256 trustedCount);
    error TooManyTrusted();
    error AlreadyTrusted(address voter);
    error NotTrusted(address voter);
    error ZeroAddress();
    error MirrorNotSet();
    error AgreementNotReached(uint256 proposalId, uint8 support, uint256 agreeing, uint256 threshold);
    error OtherChoiceRequested(uint256 proposalId, uint8 requestedSupport);
    error RenounceDisabled();

    /// @param originChainId_ Chain of the Governor (84532 for Base Sepolia).
    /// @param governor_ Governor whose `VoteCast` events are followed.
    /// @param trusted_ Voters to follow.
    /// @param threshold_ How many of them must agree (k of n).
    /// @dev `payable` so the contract can be funded with REACT at deployment.
    constructor(uint256 originChainId_, address governor_, address[] memory trusted_, uint256 threshold_)
        payable
        Ownable(msg.sender)
    {
        if (governor_ == address(0)) revert ZeroAddress();
        ORIGIN_CHAIN_ID = originChainId_;
        GOVERNOR = governor_;
        for (uint256 i = 0; i < trusted_.length; ++i) {
            _addTrusted(trusted_[i]);
        }
        _setThreshold(threshold_);
    }

    // ------------------------------------------------------------------ reactive entry point

    /// @inheritdoc IReactive
    function react(LogRecord calldata log_) external onlySystem {
        // Anything unexpected falls through: a revert here is still billed.
        if (
            (log_.topic0 != VOTE_CAST_TOPIC_0 && log_.topic0 != VOTE_CAST_WITH_PARAMS_TOPIC_0) || log_.opCode != 2
                || log_.chainId != ORIGIN_CHAIN_ID || log_.contractAddress != GOVERNOR || log_.data.length < 64
        ) return;

        address voter = address(uint160(log_.topic1));
        if (!isTrusted[voter]) return;

        // Only the two leading words are read, so nothing in the rest of the data can make this revert.
        (uint256 proposalId, uint256 rawSupport) = abi.decode(log_.data[:64], (uint256, uint256));
        uint256 epoch = trustEpoch[voter];
        if (rawSupport > MAX_SUPPORT || _recordedVote[proposalId][voter][epoch] != 0) return;

        uint8 support = uint8(rawSupport);
        _recordedVote[proposalId][voter][epoch] = support + 1;
        uint256 agreeing = agreement(proposalId, support);
        emit VoteObserved(proposalId, voter, support, agreeing);

        if (agreeing < threshold || _requested[proposalId] != 0 || mirror == address(0)) return;

        _requested[proposalId] = support + 1;
        emit MirrorRequested(proposalId, support, agreeing);
        _requestCallback(proposalId, support);
    }

    // ------------------------------------------------------------------ views

    /// @notice Number of currently trusted voters that chose `support_` on `proposalId_`.
    function agreement(uint256 proposalId_, uint8 support_) public view returns (uint256 count_) {
        if (support_ > MAX_SUPPORT) return 0;
        uint256 length = _trusted.length;
        for (uint256 i = 0; i < length; ++i) {
            address voter = _trusted[i];
            if (_recordedVote[proposalId_][voter][trustEpoch[voter]] == support_ + 1) ++count_;
        }
    }

    /// @notice True once a callback was requested for the proposal.
    function mirrorRequested(uint256 proposalId_) external view returns (bool) {
        return _requested[proposalId_] != 0;
    }

    /// @notice Choice that was requested for the proposal; meaningful only if `mirrorRequested` is true.
    function requestedSupport(uint256 proposalId_) external view returns (uint8) {
        uint8 requested = _requested[proposalId_];
        return requested == 0 ? 0 : requested - 1;
    }

    /// @notice Recorded choice of a voter for a proposal, stored as `support + 1` (0 means no vote counted).
    function recordedVote(uint256 proposalId_, address voter_) external view returns (uint8) {
        return _recordedVote[proposalId_][voter_][trustEpoch[voter_]];
    }

    function trustedVoters() external view returns (address[] memory) {
        return _trusted;
    }

    // ------------------------------------------------------------------ owner controls

    /// @notice Sets the VoteMirror that receives callbacks. Needed once after deployment, because
    ///         VoteMirror is deployed after this contract.
    function setMirror(address mirror_) external onlyOwner {
        if (mirror_ == address(0)) revert ZeroAddress();
        mirror = mirror_;
        emit MirrorSet(mirror_);
    }

    function setThreshold(uint256 threshold_) external onlyOwner {
        _setThreshold(threshold_);
    }

    function addTrusted(address voter_) external onlyOwner {
        _addTrusted(voter_);
    }

    /// @notice Asks VoteMirror again to cast `support_` on `proposalId_`, for a proposal whose callback was
    ///         skipped (paused, skipped by the owner), lost on the way, or never requested because the
    ///         threshold or the mirror was set after the trusted voters had voted.
    /// @dev Only what the trusted voters agree on right now can be requested, and only the choice of the
    ///      first request: the first agreement wins here as it does in `react()`. VoteMirror still applies
    ///      its own checks, so a proposal it has already voted on is not voted twice.
    function retryMirror(uint256 proposalId_, uint8 support_) external onlyOwner {
        if (mirror == address(0)) revert MirrorNotSet();
        uint256 agreeing = agreement(proposalId_, support_);
        if (agreeing < threshold) revert AgreementNotReached(proposalId_, support_, agreeing, threshold);
        uint8 requested = _requested[proposalId_];
        if (requested == 0) _requested[proposalId_] = support_ + 1;
        else if (requested != support_ + 1) revert OtherChoiceRequested(proposalId_, requested - 1);
        emit MirrorRetried(proposalId_, support_, agreeing);
        _requestCallback(proposalId_, support_);
    }

    /// @notice Stops following a voter. Their recorded votes no longer count towards agreement, also if the
    ///         voter is added again later.
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
        ++trustEpoch[voter_];
        uint256 topic1 = uint256(uint160(voter_));
        SYSTEM.unsubscribe(ORIGIN_CHAIN_ID, GOVERNOR, VOTE_CAST_TOPIC_0, topic1, REACTIVE_IGNORE, REACTIVE_IGNORE);
        SYSTEM.unsubscribe(
            ORIGIN_CHAIN_ID, GOVERNOR, VOTE_CAST_WITH_PARAMS_TOPIC_0, topic1, REACTIVE_IGNORE, REACTIVE_IGNORE
        );
        emit TrustedVoterRemoved(voter_);
    }

    /// @notice Settles outstanding debt to the system contract from this contract's balance.
    function coverDebt() external {
        _coverDebt();
    }

    /// @notice Returns unused REACT to the owner.
    function withdraw(uint256 amount_) external onlyOwner {
        _pay(payable(msg.sender), amount_);
    }

    /// @dev Giving up ownership would freeze the trusted list and strand the balance.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ------------------------------------------------------------------ internals

    function _requestCallback(uint256 proposalId_, uint8 support_) internal {
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: ORIGIN_CHAIN_ID,
                recipient: mirror,
                gasLimit: CALLBACK_GAS_LIMIT,
                // The first argument is overwritten by the network with this contract's address.
                payload: abi.encodeWithSignature(
                    "castMirrored(address,uint256,uint8)", address(0), proposalId_, support_
                )
            })
        );
    }

    function _addTrusted(address voter_) internal {
        if (voter_ == address(0)) revert ZeroAddress();
        if (isTrusted[voter_]) revert AlreadyTrusted(voter_);
        if (_trusted.length == MAX_TRUSTED) revert TooManyTrusted();
        isTrusted[voter_] = true;
        _trusted.push(voter_);
        uint256 topic1 = uint256(uint160(voter_));
        SYSTEM.subscribe(ORIGIN_CHAIN_ID, GOVERNOR, VOTE_CAST_TOPIC_0, topic1, REACTIVE_IGNORE, REACTIVE_IGNORE);
        SYSTEM.subscribe(
            ORIGIN_CHAIN_ID, GOVERNOR, VOTE_CAST_WITH_PARAMS_TOPIC_0, topic1, REACTIVE_IGNORE, REACTIVE_IGNORE
        );
        emit TrustedVoterAdded(voter_);
    }

    function _setThreshold(uint256 threshold_) internal {
        if (threshold_ == 0 || threshold_ > _trusted.length) revert InvalidThreshold(threshold_, _trusted.length);
        threshold = threshold_;
        emit ThresholdSet(threshold_);
    }
}
