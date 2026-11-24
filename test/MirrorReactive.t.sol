// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Test, stdError } from "forge-std/Test.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";
import { AbstractPayer } from "@reactive/src/base/AbstractPayer.sol";
import { MirrorReactive } from "../src/MirrorReactive.sol";
import { MockSystem } from "./mocks/MockSystem.sol";

contract MirrorReactiveTest is Test {
    address internal constant SYSTEM = 0x8888888888888888888888888888888888888888;
    uint256 internal constant ORIGIN = 84532;
    uint8 internal constant AGAINST = 0;
    uint8 internal constant FOR = 1;
    uint8 internal constant ABSTAIN = 2;

    address internal governor = makeAddr("governor");
    address internal mirror = makeAddr("mirror");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal stranger = makeAddr("stranger");

    MockSystem internal system;
    MirrorReactive internal reactive;

    function setUp() public {
        vm.etch(SYSTEM, address(new MockSystem()).code);
        system = MockSystem(payable(SYSTEM));

        address[] memory trusted = new address[](3);
        trusted[0] = alice;
        trusted[1] = bob;
        trusted[2] = carol;
        reactive = new MirrorReactive(ORIGIN, governor, trusted, 2);
        reactive.setMirror(mirror);
    }

    // ------------------------------------------------------------------ helpers

    function _log(address voter_, uint256 proposalId_, uint8 support_)
        internal
        view
        returns (IReactive.LogRecord memory)
    {
        return IReactive.LogRecord({
            chainId: ORIGIN,
            contractAddress: governor,
            topic0: reactive.VOTE_CAST_TOPIC_0(),
            topic1: uint256(uint160(voter_)),
            topic2: 0,
            topic3: 0,
            data: abi.encode(proposalId_, support_, uint256(100e18), "because"),
            blockNumber: 1,
            opCode: 2,
            blockHash: 0,
            txHash: 0,
            logIndex: 0
        });
    }

    function _vote(address voter_, uint256 proposalId_, uint8 support_) internal {
        IReactive.LogRecord memory log = _log(voter_, proposalId_, support_);
        vm.prank(SYSTEM);
        reactive.react(log);
    }

    // ------------------------------------------------------------------ setup

    function test_TopicMatchesOpenZeppelinVoteCast() public view {
        assertEq(reactive.VOTE_CAST_TOPIC_0(), uint256(keccak256("VoteCast(address,uint256,uint8,uint256,string)")));
    }

    function test_SubscribesOncePerTrustedVoter() public view {
        assertEq(system.subscriptionCount(), 3);
        (uint256 chainId, address contractAddress, uint256 topic0, uint256 topic1) = system.subscriptions(1);
        assertEq(chainId, ORIGIN);
        assertEq(contractAddress, governor);
        assertEq(topic0, reactive.VOTE_CAST_TOPIC_0());
        assertEq(topic1, uint256(uint160(bob)));
    }

    function test_RevertWhen_ThresholdOutOfRange() public {
        address[] memory trusted = new address[](2);
        trusted[0] = alice;
        trusted[1] = bob;
        vm.expectRevert(abi.encodeWithSelector(MirrorReactive.InvalidThreshold.selector, 3, 2));
        new MirrorReactive(ORIGIN, governor, trusted, 3);
        vm.expectRevert(abi.encodeWithSelector(MirrorReactive.InvalidThreshold.selector, 0, 2));
        new MirrorReactive(ORIGIN, governor, trusted, 0);
    }

    // ------------------------------------------------------------------ k of n

    function test_OneVoteBelowThresholdRequestsNothing() public {
        _vote(alice, 7, FOR);
        assertEq(system.callbackCount(), 0);
        assertEq(reactive.agreement(7, FOR), 1);
        assertFalse(reactive.mirrorRequested(7));
    }

    function test_TwoOfThreeAgreeingRequestsCallback() public {
        _vote(alice, 7, FOR);
        vm.expectEmit(address(reactive));
        emit MirrorReactive.MirrorRequested(7, FOR, 2);
        _vote(bob, 7, FOR);

        assertEq(system.callbackCount(), 1);
        ISystemContract.CallbackConfiguration_V_1_0 memory config = system.callbackAt(0);
        assertEq(config.chainId, ORIGIN);
        assertEq(config.recipient, mirror);
        assertEq(config.gasLimit, reactive.CALLBACK_GAS_LIMIT());
        assertEq(
            config.payload, abi.encodeWithSignature("castMirrored(address,uint256,uint8)", address(0), uint256(7), FOR)
        );
        assertTrue(reactive.mirrorRequested(7));
    }

    function test_AgainstIsMirroredAsAgainst() public {
        _vote(bob, 9, AGAINST);
        _vote(carol, 9, AGAINST);
        assertEq(
            system.callbackAt(0).payload,
            abi.encodeWithSignature("castMirrored(address,uint256,uint8)", address(0), uint256(9), AGAINST)
        );
    }

    function test_SplitVotesDoNotReachThreshold() public {
        _vote(alice, 7, FOR);
        _vote(bob, 7, AGAINST);
        assertEq(system.callbackCount(), 0);
        _vote(carol, 7, ABSTAIN);
        assertEq(system.callbackCount(), 0);
    }

    function test_SplitThenMajority() public {
        _vote(alice, 7, FOR);
        _vote(bob, 7, AGAINST);
        _vote(carol, 7, AGAINST);
        assertEq(system.callbackCount(), 1);
        assertEq(
            system.callbackAt(0).payload,
            abi.encodeWithSignature("castMirrored(address,uint256,uint8)", address(0), uint256(7), AGAINST)
        );
    }

    function test_ProposalsAreCountedSeparately() public {
        _vote(alice, 1, FOR);
        _vote(bob, 2, FOR);
        assertEq(system.callbackCount(), 0);
    }

    function test_ThresholdOfOneMirrorsFirstVote() public {
        reactive.setThreshold(1);
        _vote(carol, 3, ABSTAIN);
        assertEq(system.callbackCount(), 1);
    }

    // ------------------------------------------------------------------ duplicates

    function test_SameVoterCountedOnce() public {
        _vote(alice, 7, FOR);
        _vote(alice, 7, FOR);
        assertEq(reactive.agreement(7, FOR), 1);
        assertEq(system.callbackCount(), 0);
    }

    function test_CallbackRequestedOncePerProposal() public {
        _vote(alice, 7, FOR);
        _vote(bob, 7, FOR);
        _vote(carol, 7, FOR);
        assertEq(system.callbackCount(), 1);
        assertEq(reactive.agreement(7, FOR), 3);
    }

    // ------------------------------------------------------------------ filtering

    function test_UntrustedVoterIgnored() public {
        _vote(stranger, 7, FOR);
        _vote(alice, 7, FOR);
        assertEq(system.callbackCount(), 0);
        assertEq(reactive.recordedVote(7, stranger), 0);
    }

    function test_ForeignLogsIgnored() public {
        IReactive.LogRecord memory log = _log(alice, 7, FOR);
        log.contractAddress = makeAddr("otherGovernor");
        vm.prank(SYSTEM);
        reactive.react(log);

        log = _log(alice, 7, FOR);
        log.chainId = 1;
        vm.prank(SYSTEM);
        reactive.react(log);

        log = _log(alice, 7, FOR);
        log.topic0 = uint256(keccak256("Other()"));
        vm.prank(SYSTEM);
        reactive.react(log);

        log = _log(alice, 7, FOR);
        log.opCode = 3;
        vm.prank(SYSTEM);
        reactive.react(log);

        assertEq(reactive.recordedVote(7, alice), 0);
    }

    function test_UnknownSupportValueIgnored() public {
        _vote(alice, 7, 3);
        _vote(bob, 7, 3);
        assertEq(system.callbackCount(), 0);
        assertEq(reactive.recordedVote(7, alice), 0);
    }

    function test_NoCallbackWhileMirrorUnset() public {
        address[] memory trusted = new address[](1);
        trusted[0] = alice;
        MirrorReactive fresh = new MirrorReactive(ORIGIN, governor, trusted, 1);
        IReactive.LogRecord memory log = _log(alice, 7, FOR);
        vm.prank(SYSTEM);
        fresh.react(log);
        assertEq(system.callbackCount(), 0);
        assertFalse(fresh.mirrorRequested(7));
    }

    // ------------------------------------------------------------------ authorization

    function test_RevertWhen_ReactCalledByNonSystem() public {
        IReactive.LogRecord memory log = _log(alice, 7, FOR);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, stranger, SYSTEM));
        vm.prank(stranger);
        reactive.react(log);
    }

    function test_RevertWhen_NonOwnerChangesSettings() public {
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        reactive.setMirror(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        reactive.setThreshold(1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        reactive.addTrusted(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        reactive.removeTrusted(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        reactive.withdraw(1);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ changing the list

    function test_AddTrustedSubscribesAndCounts() public {
        address dave = makeAddr("dave");
        reactive.addTrusted(dave);
        assertEq(system.subscriptionCount(), 4);
        _vote(dave, 7, FOR);
        _vote(alice, 7, FOR);
        assertEq(system.callbackCount(), 1);
    }

    function test_RemoveTrustedUnsubscribesAndDropsTheirVote() public {
        _vote(alice, 7, FOR);
        reactive.removeTrusted(alice);

        assertEq(system.unsubscriptionCount(), 1);
        (,,, uint256 topic1) = system.unsubscriptions(0);
        assertEq(topic1, uint256(uint160(alice)));
        assertEq(reactive.trustedVoters().length, 2);
        assertEq(reactive.agreement(7, FOR), 0);

        _vote(bob, 7, FOR);
        assertEq(system.callbackCount(), 0);
        _vote(carol, 7, FOR);
        assertEq(system.callbackCount(), 1);
    }

    /// @dev Recorded votes are kept on removal, so they count again if the voter is trusted again later.
    function test_ReAddedVoterBringsBackOldVotes() public {
        _vote(alice, 7, FOR);
        reactive.removeTrusted(alice);
        assertEq(reactive.agreement(7, FOR), 0);

        reactive.addTrusted(alice);
        assertEq(reactive.agreement(7, FOR), 1);
        _vote(bob, 7, FOR);
        assertEq(system.callbackCount(), 1);
    }

    /// @dev A vote cast while the voter was not trusted is never counted, also after the voter is added.
    function test_VoteCastBeforeBeingTrustedIsNotCounted() public {
        address dave = makeAddr("dave");
        _vote(dave, 7, FOR);
        reactive.addTrusted(dave);
        assertEq(reactive.agreement(7, FOR), 0);
    }

    /// @dev `agreement` computes `support_ + 1` in a uint8, so 255 overflows.
    function test_RevertWhen_AgreementQueriedWithSupport255() public {
        vm.expectRevert(stdError.arithmeticError);
        reactive.agreement(7, 255);
    }

    function test_RevertWhen_RemovalWouldBreakThreshold() public {
        reactive.removeTrusted(alice);
        vm.expectRevert(abi.encodeWithSelector(MirrorReactive.InvalidThreshold.selector, 2, 1));
        reactive.removeTrusted(bob);
    }

    function test_RevertWhen_AddingTwiceOrTooMany() public {
        vm.expectRevert(abi.encodeWithSelector(MirrorReactive.AlreadyTrusted.selector, alice));
        reactive.addTrusted(alice);
        for (uint160 i = 1; i <= 13; ++i) {
            reactive.addTrusted(address(i + 1000));
        }
        vm.expectRevert(MirrorReactive.TooManyTrusted.selector);
        reactive.addTrusted(address(5000));
    }

    // ------------------------------------------------------------------ funds

    function test_CoverDebtPaysSystemFromBalance() public {
        vm.deal(address(reactive), 1 ether);
        system.setDebt(address(reactive), 0.3 ether);
        reactive.coverDebt();
        assertEq(address(reactive).balance, 0.7 ether);
        assertEq(SYSTEM.balance, 0.3 ether);
    }

    function test_PayOnlyFromSystem() public {
        vm.deal(address(reactive), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, stranger, SYSTEM));
        vm.prank(stranger);
        reactive.pay(1 ether);

        vm.prank(SYSTEM);
        reactive.pay(0.4 ether);
        assertEq(SYSTEM.balance, 0.4 ether);
    }

    function test_FuzzMirrorsOnlyOnceThresholdAgrees(uint8[3] memory choices_) public {
        address[3] memory voters = [alice, bob, carol];
        uint256[3] memory tally;
        bool expected;
        for (uint256 i = 0; i < 3; ++i) {
            uint8 choice = choices_[i] % 3;
            _vote(voters[i], 42, choice);
            if (++tally[choice] >= 2) expected = true;
        }
        assertEq(system.callbackCount(), expected ? 1 : 0);
        assertEq(reactive.mirrorRequested(42), expected);
    }

    receive() external payable { }
}
