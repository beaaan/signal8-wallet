// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../src/interfaces/IPlanModule.sol";
import {PlanModule} from "../src/PlanModule.sol";
import {LocalSafe} from "../src/LocalSafe.sol";
import {Fixture} from "./utils/Fixture.sol";

contract PlanModuleTest is Fixture {
    // redeclared: solc 0.8.11 cannot emit an event by its interface-qualified name
    event Executed(uint8 indexed planId, uint8 indexed action, address target, uint256 amount, bytes32 indexed ref);
    event Anchored(bytes32 indexed kind, bytes32 hash, address indexed sender);

    function setUp() public {
        vm.warp(1_760_000_000);
        _deploy(1);
    }

    // ------------------------------------------------------------------ pay: happy paths

    function test_PayBaseSupplier() public {
        vm.prank(agent);
        module.pay(BASE, supplier, 1_250 * USD, keccak256("LK-0917"));
        assertEq(usd.balanceOf(supplier), 1_250 * USD);
        assertEq(module.spentToday(BASE), 1_250 * USD);
        assertEq(module.spentAllToday(), 1_250 * USD);
        assertTrue(module.refUsed(keccak256("LK-0917")));
    }

    function test_PayStormStaffWhenStorm() public {
        _storm(true, EVENT_A);
        vm.prank(agent);
        module.pay(STORM, staff, 2_300 * USD, keccak256(abi.encode(staff, "2025-09")));
        assertEq(usd.balanceOf(staff), 2_300 * USD);
        assertEq(module.spentToday(STORM), 2_300 * USD);
    }

    function test_PayeeInBothPlans() public {
        vm.prank(agent);
        module.pay(BASE, both, 100 * USD, "r1");
        _storm(true, EVENT_A);
        vm.prank(agent);
        module.pay(STORM, both, 100 * USD, "r2");
        assertEq(usd.balanceOf(both), 200 * USD);
    }

    function test_PayEmitsExecuted() public {
        vm.expectEmit(true, true, true, true, address(module));
        emit Executed(BASE, ACT_PAY, supplier, 10 * USD, "ref");
        vm.prank(agent);
        module.pay(BASE, supplier, 10 * USD, "ref");
    }

    // ------------------------------------------------------------------ check list, in order

    function test_RevertNotAgent() public {
        vm.prank(stranger);
        vm.expectRevert(IPlanModule.NotAgent.selector);
        module.pay(BASE, supplier, 1, "r");
    }

    function test_RevertPaused() public {
        vm.prank(guardian);
        module.pause();
        vm.prank(agent);
        vm.expectRevert(IPlanModule.Paused.selector);
        module.pay(BASE, supplier, 1, "r");
    }

    function test_RevertPlanInactive() public {
        IPlanModule.Plan memory p = IPlanModule.Plan(1, 1, 0, ACT_PAY, false, PLAN_HASH);
        _ownerChange(abi.encodeWithSelector(IPlanModule.setPlan.selector, BASE, p));
        vm.prank(agent);
        vm.expectRevert(IPlanModule.PlanInactive.selector);
        module.pay(BASE, supplier, 1, "r");
    }

    function test_RevertUnknownPlanId() public {
        vm.prank(agent);
        vm.expectRevert(IPlanModule.PlanInactive.selector);
        module.pay(7, supplier, 1, "r");
    }

    function test_RevertStormNotActive() public {
        vm.prank(agent);
        vm.expectRevert(IPlanModule.StormNotActive.selector);
        module.pay(STORM, staff, 1, "r");
    }

    function test_RevertActionNotAllowed() public {
        // the base plan cannot draw credit or claim cover, and the storm plan cannot deposit
        _storm(true, EVENT_A);
        vm.prank(agent);
        vm.expectRevert(IPlanModule.ActionNotAllowed.selector);
        module.vaultDeposit(STORM, 1, "r");
    }

    function test_RevertRefUsed() public {
        vm.startPrank(agent);
        module.pay(BASE, supplier, 1, "INV-1");
        vm.expectRevert(IPlanModule.RefUsed.selector);
        module.pay(BASE, supplier, 1, "INV-1");
        vm.stopPrank();
    }

    function test_RevertPayeeNotInPlan() public {
        vm.startPrank(agent);
        vm.expectRevert(IPlanModule.PayeeNotInPlan.selector);
        module.pay(BASE, stranger, 1, "r1");
        // staff are not base-plan payees: ordinary-day payroll must be co-signed
        vm.expectRevert(IPlanModule.PayeeNotInPlan.selector);
        module.pay(BASE, staff, 1, "r2");
        vm.stopPrank();
    }

    function test_BasePayeeCannotBePaidUnderStormPlan() public {
        _storm(true, EVENT_A);
        vm.prank(agent);
        vm.expectRevert(IPlanModule.PayeeNotInPlan.selector);
        module.pay(STORM, supplier, 1, "r");
    }

    function test_RevertOverPerTxCap() public {
        vm.prank(agent);
        vm.expectRevert(IPlanModule.OverPerTxCap.selector);
        module.pay(BASE, supplier, 5_000 * USD + 1, "r");
    }

    function test_RevertOverDailyCap() public {
        vm.startPrank(agent);
        module.pay(BASE, supplier, 5_000 * USD, "r1");
        module.pay(BASE, supplier, 5_000 * USD, "r2");
        module.pay(BASE, supplier, 5_000 * USD, "r3");
        vm.expectRevert(IPlanModule.OverDailyCap.selector);
        module.pay(BASE, supplier, 1, "r4");
        vm.stopPrank();
    }

    function test_RevertOverDailyCeiling() public {
        vm.startPrank(agent);
        module.pay(BASE, supplier, 5_000 * USD, "b1");
        module.pay(BASE, supplier, 5_000 * USD, "b2");
        module.pay(BASE, supplier, 5_000 * USD, "b3");
        vm.stopPrank();
        _storm(true, EVENT_A);
        vm.startPrank(agent);
        for (uint256 i = 0; i < 6; i++) module.pay(STORM, staff, 3_000 * USD, bytes32(i + 1)); // 18k, 33k total
        vm.expectRevert(IPlanModule.OverDailyCeiling.selector);
        module.pay(STORM, staff, 2_000 * USD + 1, "s7");
        vm.stopPrank();
    }

    function test_DailyCapResetsNextDay() public {
        vm.startPrank(agent);
        module.pay(BASE, supplier, 5_000 * USD, "r1");
        module.pay(BASE, supplier, 5_000 * USD, "r2");
        module.pay(BASE, supplier, 5_000 * USD, "r3");
        vm.warp(block.timestamp + 1 days);
        module.pay(BASE, supplier, 5_000 * USD, "r4");
        vm.stopPrank();
        assertEq(module.spentToday(BASE), 5_000 * USD);
    }

    // ------------------------------------------------------------------ vault

    function test_VaultDepositLeavesZeroAllowanceAndSharesWithSafe() public {
        vm.prank(agent);
        module.vaultDeposit(BASE, 10_000 * USD, "d1");
        assertEq(usd.allowance(address(safe), address(vault)), 0);
        assertEq(vault.convertToAssets(vault.balanceOf(address(safe))), 10_000 * USD);
        assertEq(usd.balanceOf(address(vault)), 10_000 * USD);
    }

    function test_VaultWithdrawReturnsToSafe() public {
        vm.startPrank(agent);
        module.vaultDeposit(BASE, 10_000 * USD, "d1");
        uint256 before = usd.balanceOf(address(safe));
        module.vaultWithdraw(BASE, 4_000 * USD, "w1");
        vm.stopPrank();
        assertEq(usd.balanceOf(address(safe)), before + 4_000 * USD);
        assertEq(vault.maxWithdraw(address(safe)), 6_000 * USD);
    }

    function test_VaultWithdrawUnderStormPlan() public {
        vm.prank(agent);
        module.vaultDeposit(BASE, 1_000 * USD, "d1");
        _storm(true, EVENT_A);
        vm.prank(agent);
        module.vaultWithdraw(STORM, 1_000 * USD, "w1");
        assertEq(vault.balanceOf(address(safe)), 0);
    }

    function test_VaultWithdrawMoreThanSharesFails() public {
        vm.prank(agent);
        vm.expectRevert(IPlanModule.ExecFailed.selector);
        module.vaultWithdraw(BASE, 1, "w1");
    }

    // ------------------------------------------------------------------ credit

    function test_CreditDrawCappedPerEvent() public {
        _storm(true, EVENT_A);
        vm.startPrank(agent);
        module.creditDraw(10_000 * USD, "c1");
        vm.expectRevert(IPlanModule.OverCreditCap.selector);
        module.creditDraw(5_000 * USD + 1, "c2");
        module.creditDraw(5_000 * USD, "c3");
        vm.stopPrank();
        assertEq(module.drawnInEvent(EVENT_A), 15_000 * USD);
        assertEq(credit.drawn(), 15_000 * USD);
    }

    function test_CreditCapResetsForNewEvent() public {
        _storm(true, EVENT_A);
        vm.prank(agent);
        module.creditDraw(15_000 * USD, "c1");
        _storm(true, EVENT_B);
        vm.prank(agent);
        module.creditDraw(15_000 * USD, "c2");
        assertEq(module.drawnInEvent(EVENT_B), 15_000 * USD);
    }

    function test_CreditDrawNeedsStorm() public {
        vm.prank(agent);
        vm.expectRevert(IPlanModule.StormNotActive.selector);
        module.creditDraw(1, "c1");
    }

    function test_CreditDrawLandsInSafe() public {
        _storm(true, EVENT_A);
        uint256 before = usd.balanceOf(address(safe));
        vm.prank(agent);
        module.creditDraw(1_000 * USD, "c1");
        assertEq(usd.balanceOf(address(safe)), before + 1_000 * USD);
    }

    // ------------------------------------------------------------------ cover

    function test_ClaimCoverOncePerEvent() public {
        _storm(true, EVENT_A);
        uint256 before = usd.balanceOf(address(safe));
        vm.startPrank(agent);
        module.claimCover("k1");
        assertEq(usd.balanceOf(address(safe)), before + 20_000 * USD);
        // the cover reverts on a second claim for the same event, so the Safe call fails
        vm.expectRevert(IPlanModule.ExecFailed.selector);
        module.claimCover("k2");
        vm.stopPrank();
    }

    function test_ClaimCoverNeedsStorm() public {
        vm.prank(agent);
        vm.expectRevert(IPlanModule.StormNotActive.selector);
        module.claimCover("k1");
    }

    // ------------------------------------------------------------------ anchor

    function test_AnchorEmitsFromSafe() public {
        vm.expectEmit(true, true, true, true, address(evidence));
        emit Anchored(bytes32("PRE_STORM"), keccak256("photos"), address(safe));
        vm.prank(agent);
        module.anchor(keccak256("photos"), bytes32("PRE_STORM"));
    }

    function test_AnchorBlockedWhenPaused() public {
        vm.prank(agent);
        module.pause();
        vm.prank(agent);
        vm.expectRevert(IPlanModule.Paused.selector);
        module.anchor(keccak256("x"), bytes32("DAILY_REPORT"));
    }

    // ------------------------------------------------------------------ pause

    function test_PauseByGuardianAgentAndSafe() public {
        vm.prank(guardian);
        module.pause();
        assertTrue(module.paused());
        vm.prank(owner);
        safe.execute(address(module), 0, abi.encodeWithSelector(IPlanModule.unpause.selector));
        assertFalse(module.paused());
        vm.prank(agent);
        module.pause();
        assertTrue(module.paused());
    }

    function test_RevertPauseByStranger() public {
        vm.prank(stranger);
        vm.expectRevert(IPlanModule.NotPauser.selector);
        module.pause();
    }

    function test_UnpauseOnlySafe() public {
        vm.prank(agent);
        module.pause();
        vm.prank(guardian);
        vm.expectRevert(IPlanModule.NotSafe.selector);
        module.unpause();
        vm.prank(agent);
        vm.expectRevert(IPlanModule.NotSafe.selector);
        module.unpause();
    }

    // ------------------------------------------------------------------ timelock

    function test_SettersOnlyViaApplyChange() public {
        vm.prank(agent);
        vm.expectRevert(IPlanModule.NotSelf.selector);
        module.setPayee(stranger, 1);
        vm.prank(address(safe));
        vm.expectRevert(IPlanModule.NotSelf.selector);
        module.setDailyCeiling(1);
    }

    function test_QueueOnlySafe() public {
        vm.prank(agent);
        vm.expectRevert(IPlanModule.NotSafe.selector);
        module.queueChange(abi.encodeWithSelector(IPlanModule.setPayee.selector, stranger, 1));
    }

    function test_ApplyBeforeDelayReverts() public {
        bytes memory data = abi.encodeWithSelector(IPlanModule.setPayee.selector, stranger, 1);
        vm.startPrank(address(safe));
        module.queueChange(data);
        vm.warp(block.timestamp + 24 hours - 1);
        vm.expectRevert(IPlanModule.TooEarly.selector);
        module.applyChange(data);
        vm.warp(block.timestamp + 1);
        module.applyChange(data);
        vm.stopPrank();
        assertEq(module.payeePlans(stranger), 1);
    }

    function test_ApplyUnqueuedReverts() public {
        vm.prank(address(safe));
        vm.expectRevert(IPlanModule.NotQueued.selector);
        module.applyChange(abi.encodeWithSelector(IPlanModule.setPayee.selector, stranger, 1));
    }

    function test_CancelWorks() public {
        bytes memory data = abi.encodeWithSelector(IPlanModule.setPayee.selector, stranger, 1);
        vm.startPrank(address(safe));
        module.queueChange(data);
        module.cancelChange(data);
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(IPlanModule.NotQueued.selector);
        module.applyChange(data);
        vm.stopPrank();
    }

    function test_NewPayeeCoolingOff() public {
        vm.prank(agent);
        vm.expectRevert(IPlanModule.PayeeNotInPlan.selector);
        module.pay(BASE, stranger, 1, "r1");
        _ownerChange(abi.encodeWithSelector(IPlanModule.setPayee.selector, stranger, 1));
        vm.prank(agent);
        module.pay(BASE, stranger, 1, "r2");
        assertEq(usd.balanceOf(stranger), 1);
    }

    function test_ApplyCannotCallAgentFunctions() public {
        // a queued agent call executes with msg.sender == module, which is not the agent
        bytes memory data = abi.encodeWithSelector(IPlanModule.pay.selector, BASE, supplier, 1, bytes32("r"));
        vm.startPrank(address(safe));
        module.queueChange(data);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(IPlanModule.NotAgent.selector);
        module.applyChange(data);
        vm.stopPrank();
    }

    function test_SetAgentRotates() public {
        address newAgent = makeAddr("newAgent");
        _ownerChange(abi.encodeWithSelector(IPlanModule.setAgent.selector, newAgent));
        vm.prank(agent);
        vm.expectRevert(IPlanModule.NotAgent.selector);
        module.pay(BASE, supplier, 1, "r1");
        vm.prank(newAgent);
        module.pay(BASE, supplier, 1, "r2");
    }

    function test_SetPlanUnknownIdReverts() public {
        IPlanModule.Plan memory p = IPlanModule.Plan(1, 1, 0, ACT_PAY, true, PLAN_HASH);
        bytes memory data = abi.encodeWithSelector(IPlanModule.setPlan.selector, 2, p);
        vm.startPrank(address(safe));
        module.queueChange(data);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(IPlanModule.UnknownPlan.selector);
        module.applyChange(data);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ fuzz

    /// Random amounts and payees never take a day past perTxCap, dailyCap or dailyCeiling.
    function testFuzz_PaymentsStayUnderCaps(uint96[12] memory amounts, uint8 seed) public {
        _storm(true, EVENT_A);
        address[3] memory who = [supplier, staff, both];
        for (uint256 i = 0; i < amounts.length; i++) {
            uint8 planId = uint8((seed >> (i % 8)) & 1);
            address to = who[(uint256(seed) + i) % 3];
            uint256 amount = uint256(amounts[i]) % (6_000 * USD);
            vm.prank(agent);
            try module.pay(planId, to, amount, bytes32(i + 1)) {} catch {}
        }
        (, uint256 baseCap, , , , ) = module.plans(BASE);
        (, uint256 stormCap, , , , ) = module.plans(STORM);
        assertLe(module.spentToday(BASE), baseCap);
        assertLe(module.spentToday(STORM), stormCap);
        assertLe(module.spentAllToday(), module.dailyCeiling());
        assertEq(usd.balanceOf(stranger), 0);
    }

    /// FISCO: timeUnit 1000 with millisecond timestamps behaves like timeUnit 1 with seconds.
    function testFuzz_TimeUnitMilliseconds(uint32 secondsIntoDay) public {
        uint256 start = 1_760_000_000;
        uint256 offset = uint256(secondsIntoDay) % 2 days;

        _deploy(1);
        vm.warp(start + offset);
        uint256 daySeconds = module.today();
        vm.prank(agent);
        module.pay(BASE, supplier, 5_000 * USD, "a");

        _deploy(1000);
        vm.warp((start + offset) * 1000);
        assertEq(module.today(), daySeconds);
        assertEq(module.delay(), 24 hours * 1000);
        vm.prank(agent);
        module.pay(BASE, supplier, 5_000 * USD, "a");
        assertEq(module.spentToday(BASE), 5_000 * USD);
    }
}
