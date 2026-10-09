// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {Test} from "forge-std/Test.sol";
import {PlanGuard} from "../src/PlanGuard.sol";

contract PlanGuardTest is Test {
    address internal safe = makeAddr("safe");
    address internal token = makeAddr("token");
    address internal multiSend = makeAddr("multiSendCallOnly");
    PlanGuard internal guard;

    function setUp() public {
        vm.warp(1_760_000_000);
        guard = new PlanGuard(safe, 1, multiSend);
    }

    function _check(
        address to,
        bytes memory data,
        uint8 operation
    ) internal {
        vm.prank(safe);
        guard.checkTransaction(to, 0, data, operation, 0, 0, 0, address(0), payable(address(0)), "", address(0));
    }

    function _disableModule() internal pure returns (bytes memory) {
        return abi.encodeWithSignature("disableModule(address,address)", address(1), address(0xbeef));
    }

    function test_OrdinaryTransactionsPass() public {
        _check(token, abi.encodeWithSignature("transfer(address,uint256)", address(2), 1), 0);
        _check(safe, "", 0); // plain ETH transfer to itself
    }

    function test_BlocksEachGuardedSelector() public {
        bytes[8] memory calls = [
            abi.encodeWithSignature("enableModule(address)", address(3)),
            _disableModule(),
            abi.encodeWithSignature("addOwnerWithThreshold(address,uint256)", address(3), 2),
            abi.encodeWithSignature("removeOwner(address,address,uint256)", address(1), address(3), 2),
            abi.encodeWithSignature("swapOwner(address,address,address)", address(1), address(3), address(4)),
            abi.encodeWithSignature("changeThreshold(uint256)", 1),
            abi.encodeWithSignature("setGuard(address)", address(0)),
            abi.encodeWithSignature("setFallbackHandler(address)", address(3))
        ];
        for (uint256 i = 0; i < calls.length; i++) {
            bytes4 sel;
            bytes memory c = calls[i];
            assembly {
                sel := mload(add(c, 32))
            }
            vm.prank(safe);
            vm.expectRevert(abi.encodeWithSelector(PlanGuard.Blocked.selector, sel));
            guard.checkTransaction(safe, 0, c, 0, 0, 0, 0, address(0), payable(address(0)), "", address(0));
        }
    }

    function test_BlocksDelegatecall() public {
        vm.prank(safe);
        vm.expectRevert(abi.encodeWithSelector(PlanGuard.Blocked.selector, bytes4(0x12345678)));
        guard.checkTransaction(token, 0, hex"12345678", 1, 0, 0, 0, address(0), payable(address(0)), "", address(0));
    }

    function test_QueuedChangePassesAfterDelayOnce() public {
        bytes memory data = _disableModule();
        vm.prank(safe);
        guard.queue(safe, data, 0);

        vm.prank(safe);
        vm.expectRevert(PlanGuard.TooEarly.selector);
        guard.checkTransaction(safe, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), "", address(0));

        vm.warp(block.timestamp + 24 hours);
        _check(safe, data, 0);
        vm.prank(safe);
        guard.checkAfterExecution(bytes32(0), true);

        // consumed: a second identical transaction is blocked again
        vm.prank(safe);
        vm.expectRevert(abi.encodeWithSelector(PlanGuard.Blocked.selector, bytes4(keccak256("disableModule(address,address)"))));
        guard.checkTransaction(safe, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), "", address(0));
    }

    function test_FailedExecutionKeepsTheEntry() public {
        bytes memory data = _disableModule();
        vm.prank(safe);
        guard.queue(safe, data, 0);
        vm.warp(block.timestamp + 24 hours);
        _check(safe, data, 0);
        vm.prank(safe);
        guard.checkAfterExecution(bytes32(0), false); // inner call failed
        assertGt(guard.queuedAt(guard.txId(safe, data, 0)), 0);
        _check(safe, data, 0); // still allowed, no new wait
    }

    function _pack(address to, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(0), to, uint256(0), data.length, data);
    }

    function test_MultiSendOfOrdinaryCallsPasses() public {
        bytes memory txs = abi.encodePacked(
            _pack(token, abi.encodeWithSignature("transfer(address,uint256)", address(2), 1)),
            _pack(token, abi.encodeWithSignature("transfer(address,uint256)", address(3), 2))
        );
        bytes memory batch = abi.encodeWithSignature("multiSend(bytes)", txs);
        assertFalse(guard.isGuarded(multiSend, batch, 1));
        _check(multiSend, batch, 1);
    }

    function test_MultiSendHidingAGuardedCallIsBlocked() public {
        bytes memory txs = abi.encodePacked(
            _pack(token, abi.encodeWithSignature("transfer(address,uint256)", address(2), 1)),
            _pack(safe, _disableModule())
        );
        bytes memory batch = abi.encodeWithSignature("multiSend(bytes)", txs);
        assertTrue(guard.isGuarded(multiSend, batch, 1));
        vm.prank(safe);
        vm.expectRevert(abi.encodeWithSelector(PlanGuard.Blocked.selector, bytes4(keccak256("multiSend(bytes)"))));
        guard.checkTransaction(multiSend, 0, batch, 1, 0, 0, 0, address(0), payable(address(0)), "", address(0));
    }

    function test_MultiSendInnerDelegatecallOrMalformedIsGuarded() public {
        bytes memory inner = abi.encodeWithSignature("transfer(address,uint256)", address(2), 1);
        bytes memory delegated = abi.encodePacked(uint8(1), token, uint256(0), inner.length, inner);
        assertTrue(guard.isGuarded(multiSend, abi.encodeWithSignature("multiSend(bytes)", delegated), 1));
        bytes memory truncated = abi.encodePacked(uint8(0), token, uint256(0), uint256(100), inner); // says 100 bytes, has 68
        assertTrue(guard.isGuarded(multiSend, abi.encodeWithSignature("multiSend(bytes)", truncated), 1));
        assertTrue(guard.isGuarded(multiSend, hex"12345678", 1));
        // a delegatecall to any other contract stays guarded
        bytes memory ok = abi.encodeWithSignature("multiSend(bytes)", _pack(token, inner));
        assertTrue(guard.isGuarded(token, ok, 1));
    }

    function test_QueueIsForTheExactTransaction() public {
        vm.prank(safe);
        guard.queue(safe, _disableModule(), 0);
        vm.warp(block.timestamp + 24 hours);
        bytes memory other = abi.encodeWithSignature("disableModule(address,address)", address(1), address(0xdead));
        vm.prank(safe);
        vm.expectRevert();
        guard.checkTransaction(safe, 0, other, 0, 0, 0, 0, address(0), payable(address(0)), "", address(0));
    }

    function test_CancelRemovesEntry() public {
        bytes memory data = _disableModule();
        vm.startPrank(safe);
        guard.queue(safe, data, 0);
        guard.cancel(safe, data, 0);
        vm.stopPrank();
        vm.warp(block.timestamp + 2 days);
        vm.prank(safe);
        vm.expectRevert();
        guard.checkTransaction(safe, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), "", address(0));
    }

    function test_OnlySafe() public {
        vm.expectRevert(PlanGuard.NotSafe.selector);
        guard.queue(safe, _disableModule(), 0);
        vm.expectRevert(PlanGuard.NotSafe.selector);
        guard.checkTransaction(safe, 0, _disableModule(), 0, 0, 0, 0, address(0), payable(address(0)), "", address(0));
    }

    function test_SupportsGuardInterface() public {
        assertTrue(guard.supportsInterface(0xe6d7a83a));
        assertTrue(guard.supportsInterface(0x01ffc9a7));
        assertFalse(guard.supportsInterface(0xffffffff));
    }

    function test_SelectorMatchesSafeGuardInterface() public {
        // Safe v1.4.1 Guard.checkTransaction takes Enum.Operation, which is uint8 in the ABI
        assertEq(
            PlanGuard.checkTransaction.selector,
            bytes4(
                keccak256(
                    "checkTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes,address)"
                )
            )
        );
        assertEq(
            bytes4(PlanGuard.checkTransaction.selector ^ PlanGuard.checkAfterExecution.selector),
            bytes4(0xe6d7a83a)
        );
    }
}
