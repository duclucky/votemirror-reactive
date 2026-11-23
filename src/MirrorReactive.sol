// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";
import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { AbstractReactive } from "@reactive/src/base/AbstractReactive.sol";

/// @title MirrorReactive
/// @notice Lives on Reactive Network. Watches `VoteCast` events of one Governor on an origin chain,
///         one subscription per trusted voter, and asks the owner's VoteMirror to cast the same vote
///         once `threshold` trusted voters agree on a choice. Each proposal is mirrored at most once.
contract MirrorReactive is AbstractReactive, Ownable {
    /// @dev keccak256("VoteCast(address,uint256,uint8,uint256,string)"), the OpenZeppelin Governor event.
    uint256 public constant VOTE_CAST_TOPIC_0 = 0xb8e138887d0aa13bab447e82de9d5c1777041ecd21ca36ba824ff1e6c07ddda4;

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

    /// @notice Recorded choice of a voter for a proposal, stored as `support + 1` (0 means no vote seen).
    mapping(uint256 proposalId => mapping(address voter => uint8)) public recordedVote;

    /// @notice True once a callback was requested for the proposal.
    mapping(uint256 proposalId => bool) public mirrorRequested;

    event MirrorSet(address indexed mirror);
    event ThresholdSet(uint256 threshold);
    event TrustedVoterAdded(address indexed voter);
    event TrustedVoterRemoved(address indexed voter);
    event VoteObserved(uint256 indexed proposalId, address indexed voter, uint8 support, uint256 agreeing);
    event MirrorRequested(uint256 indexed proposalId, uint8 support, uint256 agreeing);

    error InvalidThreshold(uint256 threshold, uint256 trustedCount);
    error TooManyTrusted();
    error AlreadyTrusted(address voter);
    error NotTrusted(address voter);
    error ZeroAddress();

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
            log_.topic0 != VOTE_CAST_TOPIC_0 || log_.opCode != 2 || log_.chainId != ORIGIN_CHAIN_ID
                || log_.contractAddress != GOVERNOR
        ) return;

        address voter = address(uint160(log_.topic1));
        if (!isTrusted[voter]) return;

        (uint256 proposalId, uint8 support,,) = abi.decode(log_.data, (uint256, uint8, uint256, string));
        if (support > MAX_SUPPORT || recordedVote[proposalId][voter] != 0) return;

        recordedVote[proposalId][voter] = support + 1;
        uint256 agreeing = agreement(proposalId, support);
        emit VoteObserved(proposalId, voter, support, agreeing);

        if (agreeing < threshold || mirrorRequested[proposalId] || mirror == address(0)) return;

        mirrorRequested[proposalId] = true;
        emit MirrorRequested(proposalId, support, agreeing);
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: ORIGIN_CHAIN_ID,
                recipient: mirror,
                gasLimit: CALLBACK_GAS_LIMIT,
                // The first argument is overwritten by the network with this contract's address.
                payload: abi.encodeWithSignature("castMirrored(address,uint256,uint8)", address(0), proposalId, support)
            })
        );
    }

    // ------------------------------------------------------------------ views

    /// @notice Number of currently trusted voters that chose `support_` on `proposalId_`.
    function agreement(uint256 proposalId_, uint8 support_) public view returns (uint256 count_) {
        uint256 length = _trusted.length;
        for (uint256 i = 0; i < length; ++i) {
            if (recordedVote[proposalId_][_trusted[i]] == support_ + 1) ++count_;
        }
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

    /// @notice Stops following a voter. Their recorded votes no longer count towards agreement.
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
        SYSTEM.unsubscribe(
            ORIGIN_CHAIN_ID, GOVERNOR, VOTE_CAST_TOPIC_0, uint256(uint160(voter_)), REACTIVE_IGNORE, REACTIVE_IGNORE
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

    // ------------------------------------------------------------------ internals

    function _addTrusted(address voter_) internal {
        if (voter_ == address(0)) revert ZeroAddress();
        if (isTrusted[voter_]) revert AlreadyTrusted(voter_);
        if (_trusted.length == MAX_TRUSTED) revert TooManyTrusted();
        isTrusted[voter_] = true;
        _trusted.push(voter_);
        SYSTEM.subscribe(
            ORIGIN_CHAIN_ID, GOVERNOR, VOTE_CAST_TOPIC_0, uint256(uint160(voter_)), REACTIVE_IGNORE, REACTIVE_IGNORE
        );
        emit TrustedVoterAdded(voter_);
    }

    function _setThreshold(uint256 threshold_) internal {
        if (threshold_ == 0 || threshold_ > _trusted.length) revert InvalidThreshold(threshold_, _trusted.length);
        threshold = threshold_;
        emit ThresholdSet(threshold_);
    }
}
