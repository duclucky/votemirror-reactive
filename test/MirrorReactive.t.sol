// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Test } from "forge-std/Test.sol";
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

    function test_RevertedFirstSideReservationDoesNotBlockCanonicalSide() public {
        reactive.setThreshold(1);
        system.setRejectCallbacks(true);
        _vote(bob, 13, FOR);
        assertEq(reactive.requestedChoices(reactive.policyHash(), 13), 0);
        assertFalse(reactive.mirrorRequested(13));
        system.setRejectCallbacks(false);
        _vote(alice, 13, AGAINST);
        assertEq(system.callbackCount(), 1);
        assertEq(reactive.requestedChoices(reactive.policyHash(), 13), 1);
        reactive.retryMirror(13, FOR);
        assertEq(reactive.requestedChoices(reactive.policyHash(), 13), 3);
    }

    function test_NestedSystemDeliveryCannotDuplicateRequestedSide() public {
        _vote(alice, 17, FOR);
        system.setNestedDelivery(address(reactive), abi.encodeCall(MirrorReactive.react, (_log(carol, 17, FOR))));
        _vote(bob, 17, FOR);
        assertEq(reactive.agreement(17, FOR), 3);
        assertEq(system.callbackCount(), 1);
        assertEq(reactive.requestedChoices(reactive.policyHash(), 17), 2);
    }

    function _cron() internal {
        IReactive.LogRecord memory log_;
        log_.chainId = block.chainid;
        log_.contractAddress = reactive.CRON_EMITTER();
        log_.topic0 = reactive.CRON_TOPIC();
        log_.opCode = 2;
        vm.prank(SYSTEM);
        reactive.react(log_);
    }

    function test_RecoveryCooldownAndDisable() public {
        vm.warp(1_800_000_000);
        _cron();
        assertEq(system.callbackCount(), 0);
        reactive.setRecoveryEnabled(true);
        _cron();
        assertEq(system.callbackCount(), 1);
        _cron();
        assertEq(system.callbackCount(), 1);
        vm.warp(block.timestamp + 59);
        _cron();
        assertEq(system.callbackCount(), 1);
        vm.warp(block.timestamp + 1);
        _cron();
        assertEq(system.callbackCount(), 2);
        reactive.setRecoveryEnabled(false);
        vm.warp(block.timestamp + 60);
        _cron();
        assertEq(system.callbackCount(), 2);
    }

    function test_RecoveryRequestFailureConsumesCooldownNotVoteEvidence() public {
        vm.warp(1_800_000_000);
        reactive.setRecoveryEnabled(true);
        system.setRejectCallbacks(true);
        _cron();
        assertEq(reactive.recoveryRequestsToday(), 1);
        system.setRejectCallbacks(false);
        _cron();
        assertEq(system.callbackCount(), 0);
        vm.warp(block.timestamp + 60);
        _cron();
        assertEq(system.callbackCount(), 1);
    }

    function test_RecoveryEnableOnlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        reactive.setRecoveryEnabled(true);
    }

    function test_NestedCronCannotBypassRecoveryCooldown() public {
        vm.warp(1_800_000_000);
        reactive.setRecoveryEnabled(true);
        IReactive.LogRecord memory log_;
        log_.chainId = block.chainid;
        log_.contractAddress = reactive.CRON_EMITTER();
        log_.topic0 = reactive.CRON_TOPIC();
        log_.opCode = 2;
        system.setNestedDelivery(address(reactive), abi.encodeCall(MirrorReactive.react, (log_)));
        _cron();
        assertEq(system.callbackCount(), 1);
        assertEq(reactive.recoveryRequestsToday(), 1);
    }

    function test_RecoveryDayBoundaryAndIdempotentEnable() public {
        uint256 day = 20_000 days;
        vm.warp(day + 1 days - 30);
        reactive.setRecoveryEnabled(true);
        uint256 subscriptions = system.subscriptionCount();
        reactive.setRecoveryEnabled(true);
        assertEq(system.subscriptionCount(), subscriptions);
        _cron();
        assertEq(reactive.recoveryRequestsToday(), 1);
        vm.warp(day + 1 days + 30);
        _cron();
        assertEq(reactive.recoveryRequestsToday(), 1);
        assertEq(system.callbackCount(), 2);
    }

    function test_RealLasnaCron10FixtureRequestsRecovery() public {
        string memory raw = vm.readFile("deployments/lasna-cron10-fixture.json");
        IReactive.LogRecord memory record;
        record.chainId = block.chainid;
        record.contractAddress = vm.parseJsonAddress(raw, ".address");
        record.topic0 = uint256(vm.parseJsonBytes32(raw, ".topics[0]"));
        record.topic1 = uint256(vm.parseJsonBytes32(raw, ".topics[1]"));
        record.data = vm.parseJsonBytes(raw, ".data");
        record.opCode = 2;
        vm.warp(1_800_000_000);
        reactive.setRecoveryEnabled(true);
        vm.prank(SYSTEM);
        reactive.react(record);
        assertEq(system.callbackCount(), 1);
    }

    function test_RequestFailurePreservesDecidingVoteAndCanRetry() public {
        system.setRejectCallbacks(true);
        _vote(alice, 99, FOR);
        _vote(bob, 99, FOR);
        assertEq(reactive.agreement(99, FOR), 2);
        assertFalse(reactive.mirrorRequested(99));
        system.setRejectCallbacks(false);
        reactive.retryMirror(99, FOR);
        assertEq(system.callbackCount(), 1);
        assertTrue(reactive.mirrorRequested(99));
    }

    function test_FailedRetryPreservesFirstRequestedChoice() public {
        _vote(alice, 99, FOR);
        _vote(bob, 99, FOR);
        system.setRejectCallbacks(true);
        reactive.retryMirror(99, FOR);
        assertTrue(reactive.mirrorRequested(99));
        assertEq(reactive.requestedSupport(99), FOR);
    }

    function test_NewPolicyCanRequestAgain() public {
        _vote(alice, 99, FOR);
        _vote(bob, 99, FOR);
        bytes32 before = reactive.policyHash();
        reactive.setThreshold(1);
        assertNotEq(reactive.policyHash(), before);
        assertFalse(reactive.mirrorRequested(99));
        reactive.retryMirror(99, FOR);
        assertEq(system.callbackCount(), 2);
    }

    function test_TopicMatchesOpenZeppelinVoteCast() public view {
        assertEq(reactive.VOTE_CAST_TOPIC_0(), uint256(keccak256("VoteCast(address,uint256,uint8,uint256,string)")));
    }

    function test_SubscribesOncePerTrustedVoter() public view {
        // Two per voter: `VoteCast` and `VoteCastWithParams`.
        assertEq(system.subscriptionCount(), 6);
        (uint256 chainId, address contractAddress, uint256 topic0, uint256 topic1) = system.subscriptions(2);
        assertEq(chainId, ORIGIN);
        assertEq(contractAddress, governor);
        assertEq(topic0, reactive.VOTE_CAST_TOPIC_0());
        assertEq(topic1, uint256(uint160(bob)));
        (,, topic0, topic1) = system.subscriptions(3);
        assertEq(topic0, reactive.VOTE_CAST_WITH_PARAMS_TOPIC_0());
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
            config.payload,
            abi.encodeWithSignature(
                "castMirrored(address,uint256,uint8,bytes32)", address(0), uint256(7), FOR, reactive.policyHash()
            )
        );
        assertTrue(reactive.mirrorRequested(7));
    }

    function test_AgainstIsMirroredAsAgainst() public {
        _vote(bob, 9, AGAINST);
        _vote(carol, 9, AGAINST);
        assertEq(
            system.callbackAt(0).payload,
            abi.encodeWithSignature(
                "castMirrored(address,uint256,uint8,bytes32)", address(0), uint256(9), AGAINST, reactive.policyHash()
            )
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
            abi.encodeWithSignature(
                "castMirrored(address,uint256,uint8,bytes32)", address(0), uint256(7), AGAINST, reactive.policyHash()
            )
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

    function test_TopicMatchesOpenZeppelinVoteCastWithParams() public view {
        assertEq(
            reactive.VOTE_CAST_WITH_PARAMS_TOPIC_0(),
            uint256(keccak256("VoteCastWithParams(address,uint256,uint8,uint256,string,bytes)"))
        );
    }

    /// @dev A vote cast with params is counted like a plain one, once per voter and proposal.
    function test_VoteCastWithParamsIsCounted() public {
        IReactive.LogRecord memory log = _log(alice, 7, FOR);
        log.topic0 = reactive.VOTE_CAST_WITH_PARAMS_TOPIC_0();
        log.data = abi.encode(uint256(7), FOR, uint256(100e18), "because", hex"1234");
        vm.prank(SYSTEM);
        reactive.react(log);
        assertEq(reactive.agreement(7, FOR), 1);

        _vote(alice, 7, AGAINST);
        assertEq(reactive.agreement(7, AGAINST), 0);
        _vote(bob, 7, FOR);
        assertEq(system.callbackCount(), 1);
    }

    /// @dev Data that is too short or carries a support value beyond uint8 is ignored without reverting.
    function test_MalformedVoteDataIgnored() public {
        IReactive.LogRecord memory log = _log(alice, 7, FOR);
        log.data = abi.encode(uint256(7));
        vm.prank(SYSTEM);
        reactive.react(log);
        log.data = abi.encode(uint256(7), uint256(257));
        vm.prank(SYSTEM);
        reactive.react(log);
        assertEq(reactive.recordedVote(7, alice), 0);

        // Nothing after the two leading words is read.
        log.data = abi.encode(uint256(7), uint256(FOR));
        vm.prank(SYSTEM);
        reactive.react(log);
        assertEq(reactive.recordedVote(7, alice), FOR + 1);
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

    function test_RevertWhen_SettingsAreInvalid() public {
        address[] memory trusted = new address[](1);
        trusted[0] = alice;
        vm.expectRevert(MirrorReactive.ZeroAddress.selector);
        new MirrorReactive(ORIGIN, address(0), trusted, 1);

        vm.expectRevert(MirrorReactive.ZeroAddress.selector);
        reactive.setMirror(address(0));
        vm.expectRevert(MirrorReactive.ZeroAddress.selector);
        reactive.addTrusted(address(0));
        vm.expectRevert(abi.encodeWithSelector(MirrorReactive.NotTrusted.selector, stranger));
        reactive.removeTrusted(stranger);
    }

    function test_NothingRequestedYetReadsAsZero() public {
        _vote(alice, 7, AGAINST);
        assertFalse(reactive.mirrorRequested(7));
        assertEq(reactive.requestedSupport(7), 0);
    }

    function test_OwnerWithdrawsUnusedBalance() public {
        vm.deal(address(reactive), 2 ether);
        uint256 before = address(this).balance;
        reactive.withdraw(0.5 ether);
        assertEq(address(reactive).balance, 1.5 ether);
        assertEq(address(this).balance, before + 0.5 ether);
    }

    // ------------------------------------------------------------------ changing the list

    function test_AddTrustedSubscribesAndCounts() public {
        address dave = makeAddr("dave");
        reactive.addTrusted(dave);
        assertEq(system.subscriptionCount(), 8);
        _vote(dave, 7, FOR);
        _vote(alice, 7, FOR);
        assertEq(system.callbackCount(), 1);
    }

    function test_RemoveTrustedUnsubscribesAndDropsTheirVote() public {
        _vote(alice, 7, FOR);
        reactive.removeTrusted(alice);

        assertEq(system.unsubscriptionCount(), 2);
        (,, uint256 topic0, uint256 topic1) = system.unsubscriptions(0);
        assertEq(topic0, reactive.VOTE_CAST_TOPIC_0());
        assertEq(topic1, uint256(uint160(alice)));
        (,, topic0, topic1) = system.unsubscriptions(1);
        assertEq(topic0, reactive.VOTE_CAST_WITH_PARAMS_TOPIC_0());
        assertEq(topic1, uint256(uint160(alice)));
        assertEq(reactive.trustedVoters().length, 2);
        assertEq(reactive.agreement(7, FOR), 0);

        _vote(bob, 7, FOR);
        assertEq(system.callbackCount(), 0);
        _vote(carol, 7, FOR);
        assertEq(system.callbackCount(), 1);
    }

    /// @dev Votes seen before a removal stay out of the count when the voter is trusted again.
    function test_ReAddedVoterDoesNotBringBackOldVotes() public {
        _vote(alice, 7, FOR);
        assertEq(reactive.recordedVote(7, alice), FOR + 1);
        reactive.removeTrusted(alice);
        assertEq(reactive.trustEpoch(alice), 1);
        assertEq(reactive.recordedVote(7, alice), 0);

        reactive.addTrusted(alice);
        assertEq(reactive.agreement(7, FOR), 0);
        _vote(bob, 7, FOR);
        assertEq(system.callbackCount(), 0);

        // A vote on another proposal, cast after being trusted again, counts as usual.
        _vote(alice, 8, FOR);
        _vote(bob, 8, FOR);
        assertEq(system.callbackCount(), 1);
    }

    /// @dev A vote cast while the voter was not trusted is never counted, also after the voter is added.
    function test_VoteCastBeforeBeingTrustedIsNotCounted() public {
        address dave = makeAddr("dave");
        _vote(dave, 7, FOR);
        reactive.addTrusted(dave);
        assertEq(reactive.agreement(7, FOR), 0);
    }

    function test_AgreementIsZeroForUnknownSupport() public {
        _vote(alice, 7, FOR);
        assertEq(reactive.agreement(7, 3), 0);
        assertEq(reactive.agreement(7, 255), 0);
    }

    // ------------------------------------------------------------------ retry

    function test_RetryMirrorRequestsAgainWhatTrustedVotersAgreedOn() public {
        _vote(alice, 7, AGAINST);
        _vote(bob, 7, AGAINST);
        assertEq(system.callbackCount(), 1);

        vm.expectEmit(address(reactive));
        emit MirrorReactive.MirrorRetried(7, AGAINST, 2);
        reactive.retryMirror(7, AGAINST);

        assertEq(system.callbackCount(), 2);
        ISystemContract.CallbackConfiguration_V_1_0 memory config = system.callbackAt(1);
        assertEq(config.chainId, ORIGIN);
        assertEq(config.recipient, mirror);
        assertEq(config.gasLimit, reactive.CALLBACK_GAS_LIMIT());
        assertEq(
            config.payload,
            abi.encodeWithSignature(
                "castMirrored(address,uint256,uint8,bytes32)", address(0), 7, AGAINST, reactive.policyHash()
            )
        );
    }

    function test_RevertWhen_RetryWithoutAgreement() public {
        _vote(alice, 7, FOR);
        vm.expectRevert(abi.encodeWithSelector(MirrorReactive.AgreementNotReached.selector, 7, FOR, 1, 2));
        reactive.retryMirror(7, FOR);

        _vote(bob, 7, FOR);
        // The other side and unknown support values were not agreed on.
        vm.expectRevert(abi.encodeWithSelector(MirrorReactive.AgreementNotReached.selector, 7, AGAINST, 0, 2));
        reactive.retryMirror(7, AGAINST);
        vm.expectRevert(abi.encodeWithSelector(MirrorReactive.AgreementNotReached.selector, 7, 9, 0, 2));
        reactive.retryMirror(7, 9);
    }

    /// @dev With 2k <= n both sides can reach the threshold. Base validates canonical receipt order.
    function test_RetryCanRequestEitherAgreedSide() public {
        address dave = makeAddr("dave");
        reactive.addTrusted(dave);
        _vote(alice, 7, FOR);
        _vote(bob, 7, FOR);
        _vote(carol, 7, AGAINST);
        _vote(dave, 7, AGAINST);
        assertEq(reactive.agreement(7, AGAINST), 2);
        assertEq(reactive.requestedSupport(7), FOR);

        reactive.retryMirror(7, AGAINST);
        reactive.retryMirror(7, FOR);
        assertEq(system.callbackCount(), 4);
    }

    /// @dev The first request is diagnostic; another agreed side must remain reachable.
    function test_RetryFirstChoiceDoesNotBlockAnotherAgreedChoice() public {
        _vote(alice, 7, FOR);
        _vote(bob, 7, AGAINST);
        reactive.setThreshold(1);
        assertFalse(reactive.mirrorRequested(7));
        reactive.retryMirror(7, AGAINST);
        assertTrue(reactive.mirrorRequested(7));
        assertEq(reactive.requestedSupport(7), AGAINST);

        reactive.retryMirror(7, FOR);
        _vote(carol, 7, FOR);
        assertEq(system.callbackCount(), 2);
    }

    function test_RevertWhen_RetryAfterAgreeingVoterWasRemoved() public {
        _vote(alice, 7, FOR);
        _vote(bob, 7, FOR);
        reactive.removeTrusted(alice);
        vm.expectRevert(abi.encodeWithSelector(MirrorReactive.AgreementNotReached.selector, 7, FOR, 1, 2));
        reactive.retryMirror(7, FOR);
    }

    function test_RevertWhen_RetryByNonOwnerOrWithoutMirror() public {
        _vote(alice, 7, FOR);
        _vote(bob, 7, FOR);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        reactive.retryMirror(7, FOR);

        address[] memory trusted = new address[](1);
        trusted[0] = alice;
        MirrorReactive unset = new MirrorReactive(ORIGIN, governor, trusted, 1);
        vm.expectRevert(MirrorReactive.MirrorNotSet.selector);
        unset.retryMirror(7, FOR);
    }

    /// @dev Lowering the threshold does not look back by itself; the owner can ask for the vote.
    function test_RetryAfterThresholdWasLowered() public {
        _vote(alice, 7, FOR);
        _vote(bob, 7, AGAINST);
        _vote(carol, 7, ABSTAIN);
        reactive.setThreshold(1);
        assertEq(system.callbackCount(), 0);
        reactive.retryMirror(7, FOR);
        assertEq(system.callbackCount(), 1);
    }

    // ------------------------------------------------------------------ ownership

    function test_OwnershipMovesInTwoSteps() public {
        reactive.transferOwnership(stranger);
        assertEq(reactive.owner(), address(this));
        vm.prank(stranger);
        reactive.acceptOwnership();
        assertEq(reactive.owner(), stranger);
    }

    function test_RevertWhen_OwnershipIsRenounced() public {
        vm.expectRevert(MirrorReactive.RenounceDisabled.selector);
        reactive.renounceOwnership();
        assertEq(reactive.owner(), address(this));
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
