// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {Test} from "forge-std/Test.sol";
import {ISignalAttestor} from "../src/interfaces/ISignalAttestor.sol";
import {IFlowCreditLine, IMockSignalCover} from "../src/interfaces/IMocks.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {FlowCreditLine} from "../src/mocks/FlowCreditLine.sol";
import {PaymentRouter} from "../src/mocks/PaymentRouter.sol";
import {MockSignalCover} from "../src/mocks/MockSignalCover.sol";
import {MockAttestor} from "./utils/MockAttestor.sol";

contract MocksTest is Test {
    bytes32 internal constant HK = keccak256("HK");
    address internal safe = makeAddr("safe");
    address internal client = makeAddr("client");

    MockUSD internal usd;
    MockAttestor internal attestor;
    FlowCreditLine internal credit;
    PaymentRouter internal router;
    MockSignalCover internal cover;

    function setUp() public {
        usd = new MockUSD();
        attestor = new MockAttestor();
        credit = new FlowCreditLine(usd, safe, 50_000e6);
        router = new PaymentRouter(usd, safe, credit, ISignalAttestor(address(attestor)), HK, 1000);
        cover = new MockSignalCover(usd, safe, 20_000e6, ISignalAttestor(address(attestor)), HK);
        usd.mint(address(credit), 200_000e6);
        usd.mint(address(cover), 100_000e6);
        usd.mint(client, 100_000e6);
        vm.prank(client);
        usd.approve(address(router), type(uint256).max);
    }

    function test_RouterRejectsSweepOver100Percent() public {
        vm.expectRevert(PaymentRouter.SweepTooHigh.selector);
        new PaymentRouter(usd, safe, credit, ISignalAttestor(address(attestor)), HK, 10_001);
    }

    function test_CreditDrawOnlyBorrowerAndPaysBorrower() public {
        vm.expectRevert(IFlowCreditLine.NotBorrower.selector);
        credit.draw(1);
        vm.prank(safe);
        credit.draw(10_000e6);
        assertEq(usd.balanceOf(safe), 10_000e6);
        vm.prank(safe);
        vm.expectRevert(IFlowCreditLine.OverLimit.selector);
        credit.draw(40_000e6 + 1);
    }

    function test_RouterNoSweepWithoutDebt() public {
        vm.prank(client);
        router.pay("INV-1", 1_000e6);
        assertEq(usd.balanceOf(safe), 1_000e6);
    }

    function test_RouterSweepsTenPercentWhileDrawn() public {
        vm.prank(safe);
        credit.draw(5_000e6);
        vm.prank(client);
        router.pay("INV-1", 1_000e6);
        assertEq(credit.drawn(), 4_900e6);
        assertEq(usd.balanceOf(safe), 5_000e6 + 900e6);
    }

    function test_RouterSweepCappedAtDebt() public {
        vm.prank(safe);
        credit.draw(50e6);
        vm.prank(client);
        router.pay("INV-1", 1_000e6);
        assertEq(credit.drawn(), 0);
        assertEq(usd.balanceOf(safe), 50e6 + 950e6);
    }

    function test_RouterSweepPausedInStorm() public {
        vm.prank(safe);
        credit.draw(5_000e6);
        attestor.set(HK, true, "e1");
        vm.prank(client);
        router.pay("INV-1", 1_000e6);
        assertEq(credit.drawn(), 5_000e6);
        assertEq(usd.balanceOf(safe), 6_000e6);
    }

    function test_CoverOncePerEventToInsured() public {
        vm.expectRevert(IMockSignalCover.NotInsured.selector);
        cover.claim();
        vm.prank(safe);
        vm.expectRevert(IMockSignalCover.NoStorm.selector);
        cover.claim();
        attestor.set(HK, true, "e1");
        vm.prank(safe);
        cover.claim();
        assertEq(usd.balanceOf(safe), 20_000e6);
        vm.prank(safe);
        vm.expectRevert(IMockSignalCover.AlreadyClaimed.selector);
        cover.claim();
        attestor.set(HK, true, "e2");
        vm.prank(safe);
        cover.claim();
        assertEq(usd.balanceOf(safe), 40_000e6);
    }
}
