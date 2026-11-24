// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Test, Vm } from "forge-std/Test.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";
import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";
import { AbstractPayer } from "@reactive/src/base/AbstractPayer.sol";
import { AbstractCallback } from "@reactive/src/base/AbstractCallback.sol";
import { VoteMirror } from "../src/VoteMirror.sol";
import { MirrorReactive } from "../src/MirrorReactive.sol";
import { DemoToken } from "../src/demo/DemoToken.sol";
import { DemoGovernor } from "../src/demo/DemoGovernor.sol";
import { MockSystem } from "./mocks/MockSystem.sol";
import { MockCallbackProxy } from "./mocks/MockCallbackProxy.sol";

contract VoteMirrorTest is Test {
    address internal constant SYSTEM = 0x8888888888888888888888888888888888888888;
    uint8 internal constant AGAINST = 0;
    uint8 internal constant FOR = 1;
    uint48 internal constant VOTING_DELAY = 5;
    uint32 internal constant VOTING_PERIOD = 1 hours;

    address internal user = makeAddr("user");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal stranger = makeAddr("stranger");

    DemoToken internal token;
    DemoGovernor internal governor;
    MockSystem internal system;
    MockCallbackProxy internal proxy;
    MirrorReactive internal reactive;
    VoteMirror internal mirror;

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.etch(SYSTEM, address(new MockSystem()).code);
        system = MockSystem(payable(SYSTEM));
        proxy = new MockCallbackProxy();

        token = new DemoToken();
        governor = new DemoGovernor(token, VOTING_DELAY, VOTING_PERIOD);

        address[] memory trusted = new address[](3);
        trusted[0] = alice;
        trusted[1] = bob;
        trusted[2] = carol;
        reactive = new MirrorReactive(block.chainid, address(governor), trusted, 2);
        mirror = new VoteMirror(IPayable(payable(address(proxy))), address(reactive), governor, user, trusted, 2);
        reactive.setMirror(address(mirror));

        // The user keeps the tokens and only delegates voting power to VoteMirror.
        token.faucet(user);
        vm.prank(user);
        token.delegate(address(mirror));
        for (uint256 i = 0; i < 3; ++i) {
            token.faucet(trusted[i]);
            vm.prank(trusted[i]);
            token.delegate(trusted[i]);
        }
    }

    // ------------------------------------------------------------------ helpers

    function _propose(string memory description_) internal returns (uint256 proposalId) {
        address[] memory targets = new address[](1);
        targets[0] = address(token);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(DemoToken.faucet, (address(governor)));
        proposalId = governor.propose(targets, values, calldatas, description_);
        vm.warp(block.timestamp + VOTING_DELAY + 1);
    }

    /// @dev Two trusted voters vote on the Governor without anything being relayed, so that a callback
    ///      delivered by hand with `_deliver` passes VoteMirror's own check.
    function _trustedVotes(uint256 proposalId_, uint8 support_) internal {
        vm.prank(alice);
        governor.castVote(proposalId_, support_);
        vm.prank(bob);
        governor.castVote(proposalId_, support_);
    }

    function _deliver(uint256 proposalId_, uint8 support_) internal {
        proxy.deliver(
            address(reactive),
            address(mirror),
            abi.encodeWithSignature("castMirrored(address,uint256,uint8)", address(0), proposalId_, support_)
        );
    }

    /// @dev Casts a vote on the Governor, feeds the resulting `VoteCast` log to the reactive contract the
    ///      way Reactive Network does, and delivers any callback it requested through the proxy.
    function _voteAndRelay(address voter_, uint256 proposalId_, uint8 support_) internal {
        vm.recordLogs();
        vm.prank(voter_);
        governor.castVoteWithReason(proposalId_, support_, "my own view");
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 before = system.callbackCount();
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter != address(governor)) continue;
            bytes32[] memory topics = logs[i].topics;
            IReactive.LogRecord memory record = IReactive.LogRecord({
                chainId: block.chainid,
                contractAddress: logs[i].emitter,
                topic0: uint256(topics[0]),
                topic1: topics.length > 1 ? uint256(topics[1]) : 0,
                topic2: topics.length > 2 ? uint256(topics[2]) : 0,
                topic3: topics.length > 3 ? uint256(topics[3]) : 0,
                data: logs[i].data,
                blockNumber: block.number,
                opCode: topics.length,
                blockHash: 0,
                txHash: 0,
                logIndex: i
            });
            vm.prank(SYSTEM);
            reactive.react(record);
        }
        for (uint256 i = before; i < system.callbackCount(); ++i) {
            ISystemContract.CallbackConfiguration_V_1_0 memory config = system.callbackAt(i);
            assertEq(config.chainId, block.chainid);
            proxy.deliver(address(reactive), config.recipient, config.payload);
        }
    }

    /// @dev Checks the single event VoteMirror emitted since the last `_voteAndRelay` read the logs.
    function _assertMirrorEmitted(bytes memory data_, bytes32 topic0_, uint256 proposalId_) internal view {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 found;
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter != address(mirror)) continue;
            ++found;
            assertEq(logs[i].topics[0], topic0_);
            assertEq(uint256(logs[i].topics[1]), proposalId_);
            assertEq(logs[i].data, data_);
        }
        assertEq(found, 1);
    }

    function _votes(uint256 proposalId_) internal view returns (uint256 against, uint256 for_, uint256 abstain) {
        return governor.proposalVotes(proposalId_);
    }

    // ------------------------------------------------------------------ full loop (origin -> reactive -> callback)

    function test_Loop_TwoTrustedForVotesMirrorFor() public {
        uint256 id = _propose("Fund the grants round");
        _voteAndRelay(alice, id, FOR);
        assertFalse(governor.hasVoted(id, address(mirror)));

        _voteAndRelay(bob, id, FOR);
        _assertMirrorEmitted(abi.encode(FOR, uint256(1_000e18)), VoteMirror.Mirrored.selector, id);

        assertTrue(governor.hasVoted(id, address(mirror)));
        (, uint256 forVotes,) = _votes(id);
        assertEq(forVotes, 3_000e18);
    }

    function test_Loop_TwoTrustedAgainstVotesMirrorAgainst() public {
        uint256 id = _propose("Raise the fee");
        _voteAndRelay(carol, id, AGAINST);
        _voteAndRelay(alice, id, AGAINST);

        (uint256 againstVotes, uint256 forVotes,) = _votes(id);
        assertEq(againstVotes, 3_000e18);
        assertEq(forVotes, 0);
    }

    function test_Loop_SkippedProposalIsNotVoted() public {
        uint256 id = _propose("Something the user wants to judge alone");
        vm.prank(user);
        mirror.setSkipped(id, true);

        _voteAndRelay(alice, id, FOR);
        _voteAndRelay(bob, id, FOR);
        _assertMirrorEmitted(abi.encode(FOR, VoteMirror.SkipReason.SkippedByOwner), VoteMirror.Skipped.selector, id);

        assertFalse(governor.hasVoted(id, address(mirror)));
        (, uint256 forVotes,) = _votes(id);
        assertEq(forVotes, 2_000e18);
    }

    /// @dev Relays the callbacks requested since `from_`, as `_voteAndRelay` does for a vote.
    function _relayFrom(uint256 from_) internal {
        for (uint256 i = from_; i < system.callbackCount(); ++i) {
            ISystemContract.CallbackConfiguration_V_1_0 memory config = system.callbackAt(i);
            proxy.deliver(address(reactive), config.recipient, config.payload);
        }
    }

    /// @dev `react()` asks once per proposal, so lifting a skip does not bring the vote back by itself.
    ///      The owner asks again with `retryMirror()`.
    function test_Loop_UnskippedProposalIsMirroredAfterRetry() public {
        uint256 id = _propose("Skipped first, wanted after all");
        vm.prank(user);
        mirror.setSkipped(id, true);
        _voteAndRelay(alice, id, FOR);
        _voteAndRelay(bob, id, FOR);

        vm.prank(user);
        mirror.setSkipped(id, false);
        _voteAndRelay(carol, id, FOR);
        assertEq(system.callbackCount(), 1);
        assertFalse(governor.hasVoted(id, address(mirror)));

        reactive.retryMirror(id, FOR);
        _relayFrom(1);
        assertTrue(governor.hasVoted(id, address(mirror)));
        (, uint256 forVotes,) = _votes(id);
        assertEq(forVotes, 4_000e18);
    }

    function test_Loop_ProposalSkippedWhilePausedIsMirroredAfterRetry() public {
        uint256 id = _propose("Voted on while paused");
        vm.prank(user);
        mirror.setPaused(true);
        _voteAndRelay(alice, id, AGAINST);
        _voteAndRelay(bob, id, AGAINST);
        assertFalse(governor.hasVoted(id, address(mirror)));

        vm.prank(user);
        mirror.setPaused(false);
        reactive.retryMirror(id, AGAINST);
        _relayFrom(1);
        (uint256 againstVotes,,) = _votes(id);
        assertEq(againstVotes, 3_000e18);
    }

    /// @dev A retry cannot make VoteMirror vote twice or override the owner's own vote.
    function test_Loop_RetryAfterMirroredVoteIsSkipped() public {
        uint256 id = _propose("Already mirrored");
        _voteAndRelay(alice, id, FOR);
        _voteAndRelay(bob, id, FOR);
        assertTrue(governor.hasVoted(id, address(mirror)));

        vm.recordLogs();
        reactive.retryMirror(id, FOR);
        _relayFrom(1);
        _assertMirrorEmitted(abi.encode(FOR, VoteMirror.SkipReason.AlreadyVoted), VoteMirror.Skipped.selector, id);
        (, uint256 forVotes,) = _votes(id);
        assertEq(forVotes, 3_000e18);
    }

    function test_Loop_ThirdAgreeingVoteDoesNotVoteTwice() public {
        uint256 id = _propose("Fund the grants round");
        _voteAndRelay(alice, id, FOR);
        _voteAndRelay(bob, id, FOR);
        _voteAndRelay(carol, id, FOR);
        assertEq(system.callbackCount(), 1);
        (, uint256 forVotes,) = _votes(id);
        assertEq(forVotes, 4_000e18);
    }

    function test_UserKeepsTheTokens() public view {
        assertEq(token.balanceOf(user), 1_000e18);
        assertEq(token.balanceOf(address(mirror)), 0);
        assertEq(token.getVotes(address(mirror)), 1_000e18);
    }

    // ------------------------------------------------------------------ owner controls

    function test_PausedMirrorSkips() public {
        uint256 id = _propose("p");
        _trustedVotes(id, FOR);
        vm.prank(user);
        mirror.setPaused(true);

        vm.expectEmit(address(mirror));
        emit VoteMirror.Skipped(id, FOR, VoteMirror.SkipReason.Paused);
        _deliver(id, FOR);
        assertFalse(governor.hasVoted(id, address(mirror)));

        vm.prank(user);
        mirror.setPaused(false);
        _deliver(id, FOR);
        assertTrue(governor.hasVoted(id, address(mirror)));
    }

    function test_OwnerOverrideWinsOverMirror() public {
        uint256 id = _propose("p");
        vm.prank(user);
        mirror.castVote(id, AGAINST, "I disagree with them");

        vm.expectEmit(address(mirror));
        emit VoteMirror.Skipped(id, FOR, VoteMirror.SkipReason.AlreadyVoted);
        _deliver(id, FOR);

        (uint256 againstVotes, uint256 forVotes,) = _votes(id);
        assertEq(againstVotes, 1_000e18);
        assertEq(forVotes, 0);
    }

    function test_UnskipAllowsMirroring() public {
        uint256 id = _propose("p");
        _trustedVotes(id, FOR);
        vm.startPrank(user);
        mirror.setSkipped(id, true);
        mirror.setSkipped(id, false);
        vm.stopPrank();
        _deliver(id, FOR);
        assertTrue(governor.hasVoted(id, address(mirror)));
    }

    // ------------------------------------------------------------------ own check on the Governor

    /// @dev A callback that MirrorReactive never asked for, delivered by the relayer through the real proxy
    ///      with the right first argument, does not make VoteMirror vote while the trusted voters are silent.
    function test_CallbackWithoutTrustedVotesIsNotConfirmed() public {
        uint256 id = _propose("p");
        assertEq(mirror.confirmations(id), 0);
        vm.expectEmit(address(mirror));
        emit VoteMirror.Skipped(id, FOR, VoteMirror.SkipReason.NotConfirmed);
        _deliver(id, FOR);
        assertFalse(governor.hasVoted(id, address(mirror)));
    }

    function test_CallbackNeedsThresholdTrustedVotesOnTheGovernor() public {
        uint256 id = _propose("p");
        vm.prank(alice);
        governor.castVote(id, FOR);
        vm.prank(stranger);
        governor.castVote(id, FOR);
        assertEq(mirror.confirmations(id), 1);
        vm.expectEmit(address(mirror));
        emit VoteMirror.Skipped(id, FOR, VoteMirror.SkipReason.NotConfirmed);
        _deliver(id, FOR);

        vm.prank(bob);
        governor.castVote(id, FOR);
        assertEq(mirror.confirmations(id), 2);
        _deliver(id, FOR);
        assertTrue(governor.hasVoted(id, address(mirror)));
    }

    function test_TrustedListStartsEqualToMirrorReactive() public view {
        assertEq(mirror.trustedVoters(), reactive.trustedVoters());
        assertEq(mirror.threshold(), reactive.threshold());
        assertTrue(mirror.isTrusted(carol));
        assertFalse(mirror.isTrusted(stranger));
    }

    function test_OwnerChangesTrustedListAndThreshold() public {
        vm.startPrank(user);
        mirror.addTrusted(stranger);
        assertEq(mirror.trustedVoters().length, 4);
        mirror.setThreshold(4);
        vm.expectRevert(abi.encodeWithSelector(VoteMirror.InvalidThreshold.selector, 4, 3));
        mirror.removeTrusted(alice);
        mirror.setThreshold(1);
        mirror.removeTrusted(alice);
        assertFalse(mirror.isTrusted(alice));
        assertEq(mirror.trustedVoters().length, 3);
        vm.stopPrank();

        // alice no longer counts, stranger does.
        uint256 id = _propose("p");
        vm.prank(alice);
        governor.castVote(id, FOR);
        assertEq(mirror.confirmations(id), 0);
        vm.prank(stranger);
        governor.castVote(id, FOR);
        assertEq(mirror.confirmations(id), 1);
    }

    function test_RevertWhen_TrustedListChangeIsInvalid() public {
        vm.startPrank(user);
        vm.expectRevert(abi.encodeWithSelector(VoteMirror.AlreadyTrusted.selector, alice));
        mirror.addTrusted(alice);
        vm.expectRevert(VoteMirror.ZeroAddress.selector);
        mirror.addTrusted(address(0));
        vm.expectRevert(abi.encodeWithSelector(VoteMirror.NotTrusted.selector, stranger));
        mirror.removeTrusted(stranger);
        vm.expectRevert(abi.encodeWithSelector(VoteMirror.InvalidThreshold.selector, 0, 3));
        mirror.setThreshold(0);
        vm.expectRevert(abi.encodeWithSelector(VoteMirror.InvalidThreshold.selector, 4, 3));
        mirror.setThreshold(4);
        for (uint160 i = 1; i <= 13; ++i) {
            mirror.addTrusted(address(i + 1000));
        }
        vm.expectRevert(VoteMirror.TooManyTrusted.selector);
        mirror.addTrusted(stranger);
        vm.stopPrank();

        address[] memory none = new address[](0);
        vm.expectRevert(abi.encodeWithSelector(VoteMirror.InvalidThreshold.selector, 1, 0));
        new VoteMirror(IPayable(payable(address(proxy))), address(reactive), governor, user, none, 1);
    }

    /// @dev The callback with a full trusted list stays far below the gas MirrorReactive asks for.
    function test_CallbackWithFullTrustedListFitsTheGasLimit() public {
        vm.startPrank(user);
        for (uint160 i = 1; i <= 13; ++i) {
            mirror.addTrusted(address(i + 1000));
        }
        vm.stopPrank();
        uint256 id = _propose("p");
        _trustedVotes(id, FOR);
        uint256 gasBefore = gasleft();
        _deliver(id, FOR);
        assertLt(gasBefore - gasleft(), reactive.CALLBACK_GAS_LIMIT() / 2);
        assertTrue(governor.hasVoted(id, address(mirror)));
    }

    function test_RevertWhen_NonOwnerUsesControls() public {
        uint256 id = _propose("p");
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        mirror.setPaused(true);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        mirror.setSkipped(id, true);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        mirror.castVote(id, FOR, "");
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        mirror.withdraw(1);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ proposal state

    function test_PendingProposalSkips() public {
        address[] memory targets = new address[](1);
        targets[0] = address(token);
        uint256 id = governor.propose(targets, new uint256[](1), new bytes[](1), "not open yet");

        vm.expectEmit(address(mirror));
        emit VoteMirror.Skipped(id, FOR, VoteMirror.SkipReason.NotActive);
        _deliver(id, FOR);
    }

    function test_ClosedProposalSkips() public {
        uint256 id = _propose("p");
        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        vm.expectEmit(address(mirror));
        emit VoteMirror.Skipped(id, FOR, VoteMirror.SkipReason.NotActive);
        _deliver(id, FOR);
        assertFalse(governor.hasVoted(id, address(mirror)));
    }

    function test_UnknownProposalSkipsWithoutReverting() public {
        vm.expectEmit(address(mirror));
        emit VoteMirror.Skipped(123, FOR, VoteMirror.SkipReason.NotActive);
        _deliver(123, FOR);
    }

    function test_InvalidSupportSkipsWithoutReverting() public {
        uint256 id = _propose("p");
        _trustedVotes(id, FOR);
        vm.expectEmit(address(mirror));
        emit VoteMirror.Skipped(id, 9, VoteMirror.SkipReason.CastFailed);
        _deliver(id, 9);
        assertFalse(governor.hasVoted(id, address(mirror)));
    }

    function test_VotingWindowUsesTimestamps() public {
        assertEq(token.CLOCK_MODE(), "mode=timestamp");
        assertEq(governor.CLOCK_MODE(), "mode=timestamp");
        uint256 start = block.timestamp;
        uint256 id = _propose("p");
        assertEq(governor.proposalSnapshot(id), start + VOTING_DELAY);
        assertEq(governor.proposalDeadline(id), start + VOTING_DELAY + VOTING_PERIOD);

        // Many blocks, no time: still open. Time passes without blocks: closed.
        vm.roll(block.number + 1_000_000);
        assertEq(uint256(governor.state(id)), uint256(IGovernor.ProposalState.Active));
        vm.warp(start + VOTING_DELAY + VOTING_PERIOD + 1);
        assertTrue(governor.state(id) != IGovernor.ProposalState.Active);
    }

    // ------------------------------------------------------------------ callback authorization

    function test_RevertWhen_CallerIsNotTheProxy() public {
        uint256 id = _propose("p");
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, stranger, address(proxy)));
        vm.prank(stranger);
        mirror.castMirrored(address(reactive), id, FOR);
    }

    function test_RevertWhen_OwnerCallsCallbackDirectly() public {
        uint256 id = _propose("p");
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, user, address(proxy)));
        vm.prank(user);
        mirror.castMirrored(address(reactive), id, FOR);
    }

    function test_RevertWhen_ProxyDeliversForAnotherReactiveContract() public {
        uint256 id = _propose("p");
        vm.expectRevert(
            abi.encodeWithSelector(AbstractCallback.CallbackNotAuthorized.selector, stranger, address(reactive))
        );
        vm.prank(address(proxy));
        mirror.castMirrored(stranger, id, FOR);
        assertFalse(governor.hasVoted(id, address(mirror)));
    }

    function test_ForeignReactiveContractThroughProxyFails() public {
        uint256 id = _propose("p");
        bool success = proxy.deliver(
            stranger,
            address(mirror),
            abi.encodeWithSignature("castMirrored(address,uint256,uint8)", address(0), id, FOR)
        );
        assertFalse(success);
        assertFalse(governor.hasVoted(id, address(mirror)));
    }

    function test_WiringIsImmutableAndCorrect() public view {
        assertEq(address(mirror._SERVICE_PROVIDER()), address(proxy));
        assertEq(mirror._CALLBACK_SENDER(), address(reactive));
        assertEq(address(mirror.GOVERNOR()), address(governor));
        assertEq(reactive.mirror(), address(mirror));
        assertEq(mirror.owner(), user);
    }

    // ------------------------------------------------------------------ funds

    function test_RevertWhen_DeployedWithZeroAddress() public {
        IPayable proxy_ = IPayable(payable(address(proxy)));
        address[] memory trusted = mirror.trustedVoters();
        vm.expectRevert(VoteMirror.ZeroAddress.selector);
        new VoteMirror(IPayable(payable(address(0))), address(reactive), governor, user, trusted, 2);
        vm.expectRevert(VoteMirror.ZeroAddress.selector);
        new VoteMirror(proxy_, address(0), governor, user, trusted, 2);
        vm.expectRevert(VoteMirror.ZeroAddress.selector);
        new VoteMirror(proxy_, address(reactive), DemoGovernor(payable(address(0))), user, trusted, 2);
    }

    function test_OwnershipMovesInTwoSteps() public {
        vm.prank(user);
        mirror.transferOwnership(stranger);
        assertEq(mirror.owner(), user);
        vm.prank(stranger);
        mirror.acceptOwnership();
        assertEq(mirror.owner(), stranger);
    }

    function test_RevertWhen_OwnershipIsRenounced() public {
        vm.prank(user);
        vm.expectRevert(VoteMirror.RenounceDisabled.selector);
        mirror.renounceOwnership();
        assertEq(mirror.owner(), user);
    }

    function test_CoverDebtPaysProxy() public {
        vm.deal(address(mirror), 1 ether);
        proxy.setDebt(address(mirror), 0.2 ether);
        mirror.coverDebt();
        assertEq(address(proxy).balance, 0.2 ether);
    }

    function test_PayOnlyFromProxyAndWithdrawOnlyToOwner() public {
        vm.deal(address(mirror), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, stranger, address(proxy)));
        vm.prank(stranger);
        mirror.pay(1 ether);

        vm.prank(address(proxy));
        mirror.pay(0.1 ether);
        assertEq(address(proxy).balance, 0.1 ether);

        vm.prank(user);
        mirror.withdraw(0.9 ether);
        assertEq(user.balance, 0.9 ether);
    }
}
