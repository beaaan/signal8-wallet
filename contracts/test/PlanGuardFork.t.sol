// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {Test} from "forge-std/Test.sol";
import "../src/interfaces/IPlanModule.sol";
import {ISafeV141, ISafeProxyFactoryV141, SafeV141} from "../src/interfaces/ISafeV141.sol";
import {PlanGuard} from "../src/PlanGuard.sol";
import {PlanModule} from "../src/PlanModule.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {MockAttestor} from "./utils/MockAttestor.sol";

/// @notice An enabled module that forwards anything: shows that Safe v1.4.1 does not run the guard on module calls.
contract ProbeModule {
    function exec(
        ISafeV141 safe,
        address to,
        bytes calldata data,
        uint8 operation
    ) external returns (bool) {
        return safe.execTransactionFromModule(to, 0, data, operation);
    }
}

/// @notice PlanGuard set on a fresh Safe made through the real Safe v1.4.1 contracts (SafeL2 singleton,
///         SafeProxyFactory, MultiSendCallOnly, CompatibilityFallbackHandler) on a Base Sepolia fork, with
///         2-of-3 owner keys and signed Safe transactions. Skips when BASE_SEPOLIA_RPC is unset (CI).
///   BASE_SEPOLIA_RPC=<url> forge test --match-path test/PlanGuardFork.t.sol -vvv
/// Optional FORK_BLOCK pins the fork (needs an RPC that serves that block's state).
contract PlanGuardForkTest is Test {
    uint8 internal constant CALL = 0;
    uint8 internal constant DELEGATECALL = 1;
    uint256 internal constant USD = 1e6;
    address internal constant SENTINEL = address(0x1);
    /// MultiSendCallOnly v1.5.0. Unlike v1.4.1 it sends an entry whose `to` is address(0) to the Safe itself.
    address internal constant MULTI_SEND_CALL_ONLY_150 = 0xA83c336B20401Af773B6219BA5027174338D1836;

    event Consumed(bytes32 indexed id);

    bool internal forked;
    uint256 internal salt = uint256(keccak256("signal8.PlanGuardFork"));

    ISafeV141 internal safe;
    PlanGuard internal guard;
    PlanModule internal module;
    MockUSD internal usd;

    address[5] internal owner; // 0-2 are the initial 2-of-3 owners, 3-4 are spares for owner changes
    mapping(address => uint256) internal keyOf;
    address internal agent = makeAddr("agent");
    address internal guardian = makeAddr("guardian");
    address internal supplier = makeAddr("supplier");

    function setUp() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC", string(""));
        if (bytes(rpc).length == 0) return; // every test skips
        uint256 forkBlock = vm.envOr("FORK_BLOCK", uint256(0));
        if (forkBlock == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, forkBlock);
        forked = true;

        assertEq(block.chainid, 84532, "not Base Sepolia");
        assertGt(SafeV141.SAFE_L2_SINGLETON.code.length, 0, "SafeL2 singleton");
        assertGt(SafeV141.PROXY_FACTORY.code.length, 0, "SafeProxyFactory");
        assertGt(SafeV141.MULTI_SEND_CALL_ONLY.code.length, 0, "MultiSendCallOnly");
        assertGt(SafeV141.MULTI_SEND.code.length, 0, "MultiSend");
        assertGt(SafeV141.FALLBACK_HANDLER.code.length, 0, "CompatibilityFallbackHandler");
        assertGt(SafeV141.SIGN_MESSAGE_LIB.code.length, 0, "SignMessageLib");

        for (uint256 i = 0; i < owner.length; i++) {
            (address a, uint256 k) = makeAddrAndKey(string(abi.encodePacked("owner", vm.toString(i))));
            owner[i] = a;
            keyOf[a] = k;
        }
        safe = _createSafe(_owners(3), 2);
        assertEq(safe.VERSION(), "1.4.1");
        assertEq(address(uint160(uint256(vm.load(address(safe), 0)))), SafeV141.SAFE_L2_SINGLETON);

        // cut-down Deploy.s.sol: token, mock attestor, PlanModule with one base-plan payee
        usd = new MockUSD();
        MockAttestor attestor = new MockAttestor();
        PlanModule.PayeeInit[] memory payees = new PlanModule.PayeeInit[](1);
        payees[0] = PlanModule.PayeeInit(supplier, 1);
        module = new PlanModule(
            PlanModule.Config({
                safe: address(safe),
                token: address(usd),
                region: keccak256("HK"),
                timeUnit: 1,
                agent: agent,
                guardian: guardian,
                attestor: address(attestor),
                targets: PlanModule.Targets(address(0), address(0), address(0), address(0)),
                basePlan: IPlanModule.Plan(5_000 * USD, 15_000 * USD, 0, ACT_PAY, true, keccak256("plan-book")),
                stormPlan: IPlanModule.Plan(0, 0, 0, 0, false, bytes32(0)),
                dailyCeiling: 35_000 * USD,
                payees: payees
            })
        );
        usd.mint(address(safe), 100_000 * USD);

        // the owners enable the module and set the guard with signed Safe transactions (no guard yet: no wait)
        assertTrue(_exec(safe, address(safe), abi.encodeWithSelector(ISafeV141.enableModule.selector, address(module)), CALL));
        guard = new PlanGuard(address(safe), 1, SafeV141.MULTI_SEND_CALL_ONLY);
        assertTrue(_exec(safe, address(safe), _setGuard(address(guard)), CALL));
        assertEq(_guardOf(safe), address(guard));
        assertTrue(safe.isModuleEnabled(address(module)));
    }

    modifier onlyFork() {
        if (!forked) {
            vm.skip(true);
            return;
        }
        _;
    }

    // ------------------------------------------------------------------ ordinary transactions

    function test_Fork_OrdinaryTransferRunsThroughTheGuard() public onlyFork {
        uint256 n = safe.nonce();
        vm.expectCall(address(guard), abi.encodeWithSelector(PlanGuard.checkTransaction.selector), 1);
        vm.expectCall(address(guard), abi.encodeWithSelector(PlanGuard.checkAfterExecution.selector), 1);
        assertTrue(_exec(safe, address(usd), _transfer(supplier, 1_000 * USD), CALL));
        assertEq(usd.balanceOf(supplier), 1_000 * USD);
        assertEq(safe.nonce(), n + 1);
    }

    function test_Fork_PayrollBatchThroughMultiSendCallOnlyPasses() public onlyFork {
        address[3] memory staff = [makeAddr("staff0"), makeAddr("staff1"), makeAddr("staff2")];
        bytes memory txs;
        for (uint256 i = 0; i < staff.length; i++) {
            txs = abi.encodePacked(txs, _pack(address(usd), _transfer(staff[i], (i + 1) * 100 * USD)));
        }
        assertTrue(_exec(safe, SafeV141.MULTI_SEND_CALL_ONLY, _multiSend(txs), DELEGATECALL));
        for (uint256 i = 0; i < staff.length; i++) assertEq(usd.balanceOf(staff[i]), (i + 1) * 100 * USD);
    }

    // ------------------------------------------------------------------ guarded Safe calls

    function test_Fork_DisableModuleNeedsTheTimelock() public onlyFork {
        _throughTimelock(address(safe), abi.encodeWithSelector(ISafeV141.disableModule.selector, SENTINEL, address(module)), CALL);
        assertFalse(safe.isModuleEnabled(address(module)));
    }

    function test_Fork_OwnerAndThresholdChangesNeedTheTimelock() public onlyFork {
        _throughTimelock(address(safe), abi.encodeWithSelector(ISafeV141.addOwnerWithThreshold.selector, owner[3], 2), CALL);
        _throughTimelock(
            address(safe),
            abi.encodeWithSelector(ISafeV141.swapOwner.selector, _prevOwner(owner[0]), owner[0], owner[4]),
            CALL
        );
        _throughTimelock(
            address(safe),
            abi.encodeWithSelector(ISafeV141.removeOwner.selector, _prevOwner(owner[1]), owner[1], 2),
            CALL
        );
        _throughTimelock(address(safe), abi.encodeWithSelector(ISafeV141.changeThreshold.selector, 3), CALL);

        address[] memory now_ = safe.getOwners();
        assertEq(now_.length, 3);
        assertEq(safe.getThreshold(), 3);
        for (uint256 i = 0; i < now_.length; i++) assertTrue(now_[i] != owner[0] && now_[i] != owner[1]);
    }

    function test_Fork_SetFallbackHandlerNeedsTheTimelock() public onlyFork {
        address handler = makeAddr("handler");
        _throughTimelock(address(safe), abi.encodeWithSelector(ISafeV141.setFallbackHandler.selector, handler), CALL);
        assertEq(
            address(uint160(uint256(vm.load(address(safe), keccak256("fallback_manager.handler.address"))))),
            handler
        );
    }

    /// Replacing the guard: the old guard checks the change and is told the result, the new one guards from then on.
    function test_Fork_ReplacingTheGuardNeedsTheTimelock() public onlyFork {
        PlanGuard next = new PlanGuard(address(safe), 1, SafeV141.MULTI_SEND_CALL_ONLY);
        _throughTimelock(address(safe), _setGuard(address(next)), CALL);
        assertEq(_guardOf(safe), address(next));

        guard = next;
        _execReverts(safe, address(safe), _setGuard(address(0)), CALL, _blocked(_setGuard(address(0))));
    }

    /// Recovery: a queued setGuard(address(0)) passes once its delay has elapsed; the Safe works normally meanwhile.
    function test_Fork_RecoveryRemovesTheGuardAfterTheDelay() public onlyFork {
        bytes memory remove = _setGuard(address(0));
        _execReverts(safe, address(safe), remove, CALL, _blocked(remove));
        assertTrue(_exec(safe, address(guard), _queue(address(safe), remove, CALL), CALL));

        vm.warp(block.timestamp + guard.delay() - 1);
        _execReverts(safe, address(safe), remove, CALL, abi.encodeWithSelector(PlanGuard.TooEarly.selector));
        assertTrue(_exec(safe, address(usd), _transfer(supplier, 1 * USD), CALL)); // still usable while waiting

        vm.warp(block.timestamp + 1);
        assertTrue(_exec(safe, address(safe), remove, CALL));
        assertEq(_guardOf(safe), address(0));
        // no guard: a change that needed the timelock goes through at once
        assertTrue(_exec(safe, address(safe), abi.encodeWithSelector(ISafeV141.changeThreshold.selector, 3), CALL));
        assertEq(safe.getThreshold(), 3);
    }

    /// enableModule needs the timelock because an enabled module is outside the guard: Safe v1.4.1 does not run
    /// the guard on execTransactionFromModule, so this module can change the threshold at once.
    function test_Fork_EnableModuleNeedsTheTimelockAndModulesBypassTheGuard() public onlyFork {
        ProbeModule probe = new ProbeModule();
        _throughTimelock(address(safe), abi.encodeWithSelector(ISafeV141.enableModule.selector, address(probe)), CALL);
        assertTrue(safe.isModuleEnabled(address(probe)));

        vm.expectCall(address(guard), abi.encodeWithSelector(PlanGuard.checkTransaction.selector), 0);
        vm.expectCall(address(guard), abi.encodeWithSelector(PlanGuard.checkAfterExecution.selector), 0);
        assertTrue(probe.exec(safe, address(safe), abi.encodeWithSelector(ISafeV141.changeThreshold.selector, 1), CALL));
        assertEq(safe.getThreshold(), 1);
    }

    /// The agent's path: PlanModule -> execTransactionFromModule. The guard is not called.
    function test_Fork_PlanModuleAgentPathIsNotGuarded() public onlyFork {
        vm.expectCall(address(guard), abi.encodeWithSelector(PlanGuard.checkTransaction.selector), 0);
        vm.expectCall(address(guard), abi.encodeWithSelector(PlanGuard.checkAfterExecution.selector), 0);
        vm.prank(agent);
        module.pay(BASE, supplier, 2_000 * USD, keccak256("INV-1"));
        assertEq(usd.balanceOf(supplier), 2_000 * USD);
    }

    // ------------------------------------------------------------------ batches and delegatecalls

    function test_Fork_BatchHidingDisableModuleIsBlockedUntilQueued() public onlyFork {
        bytes memory txs = abi.encodePacked(
            _pack(address(usd), _transfer(supplier, 100 * USD)),
            _pack(address(safe), abi.encodeWithSelector(ISafeV141.disableModule.selector, SENTINEL, address(module)))
        );
        _throughTimelock(SafeV141.MULTI_SEND_CALL_ONLY, _multiSend(txs), DELEGATECALL);
        assertFalse(safe.isModuleEnabled(address(module)));
        assertEq(usd.balanceOf(supplier), 100 * USD);
    }

    function test_Fork_DelegatecallOutsideMultiSendCallOnlyIsBlockedUntilQueued() public onlyFork {
        // the same harmless payroll batch through the full MultiSend (which can delegatecall) is blocked
        bytes memory payroll = _multiSend(_pack(address(usd), _transfer(supplier, 100 * USD)));
        _execReverts(safe, SafeV141.MULTI_SEND, payroll, DELEGATECALL, _blocked(payroll));

        // on-chain message signing (Safe Wallet delegatecalls SignMessageLib) works only through the timelock
        bytes memory sign = abi.encodeWithSignature("signMessage(bytes)", bytes("signal8 plan book v1"));
        _throughTimelock(SafeV141.SIGN_MESSAGE_LIB, sign, DELEGATECALL);
    }

    /// MultiSendCallOnly v1.5.0 calls the Safe itself for an entry with to == address(0); v1.4.1 calls address(0).
    /// A PlanGuard built with the v1.5.0 address must therefore count such an entry as a call to the Safe.
    function test_Fork_ZeroToEntryInV150BatchIsBlocked() public onlyFork {
        if (MULTI_SEND_CALL_ONLY_150.code.length == 0) {
            vm.skip(true);
            return;
        }
        bytes memory hidden = _multiSend(_pack(address(0), abi.encodeWithSelector(ISafeV141.changeThreshold.selector, 1)));

        // real bytecode, Safes without a guard: v1.4.1 leaves the threshold alone, v1.5.0 changes it
        ISafeV141 bare = _createSafe(_owners(3), 2);
        assertTrue(_exec(bare, SafeV141.MULTI_SEND_CALL_ONLY, hidden, DELEGATECALL));
        assertEq(bare.getThreshold(), 2);
        assertTrue(_exec(bare, MULTI_SEND_CALL_ONLY_150, hidden, DELEGATECALL));
        assertEq(bare.getThreshold(), 1);

        // a guard built for v1.5.0 blocks it, and still lets plain batches through
        ISafeV141 s = _createSafe(_owners(3), 2);
        PlanGuard g = new PlanGuard(address(s), 1, MULTI_SEND_CALL_ONLY_150);
        assertTrue(_exec(s, address(s), _setGuard(address(g)), CALL));
        _execReverts(s, MULTI_SEND_CALL_ONLY_150, hidden, DELEGATECALL, _blocked(hidden));
        assertEq(s.getThreshold(), 2);
        usd.mint(address(s), 100 * USD);
        assertTrue(_exec(s, MULTI_SEND_CALL_ONLY_150, _multiSend(_pack(address(usd), _transfer(supplier, 100 * USD))), DELEGATECALL));
        assertEq(usd.balanceOf(supplier), 100 * USD);
    }

    // ------------------------------------------------------------------ failed inner calls

    /// safeTxGas == 0 and gasPrice == 0 (what Safe Wallet sends): a failing inner call reverts the whole
    /// execTransaction with GS013, so neither the nonce nor the queue entry is used up; checkAfterExecution never runs.
    function test_Fork_FailedInnerCallWithZeroSafeTxGasRevertsAndKeepsTheEntry() public onlyFork {
        bytes memory data = abi.encodeWithSelector(ISafeV141.changeThreshold.selector, 4); // 3 owners: GS201
        _queueAndWait(address(safe), data, CALL);
        uint256 n = safe.nonce();

        bytes memory sigs = _signatures(safe, address(safe), data, CALL, 0);
        vm.expectRevert(bytes("GS013"));
        safe.execTransaction(address(safe), 0, data, CALL, 0, 0, 0, address(0), payable(address(0)), sigs);

        assertEq(safe.nonce(), n);
        assertGt(guard.queuedAt(guard.txId(address(safe), data, CALL)), 0);
    }

    /// safeTxGas > 0: the Safe finishes the transaction with success = false (ExecutionFailure, nonce used) and
    /// tells the guard so; the entry stays, and the same change passes later without a second wait.
    function test_Fork_FailedInnerCallWithSafeTxGasKeepsTheEntry() public onlyFork {
        bytes memory data = abi.encodeWithSelector(ISafeV141.changeThreshold.selector, 4);
        _queueAndWait(address(safe), data, CALL);
        bytes32 id = guard.txId(address(safe), data, CALL);
        uint256 n = safe.nonce();
        bytes32 safeTxHash = _safeTxHash(safe, address(safe), data, CALL, 100_000);

        vm.expectCall(address(guard), abi.encodeWithSelector(PlanGuard.checkAfterExecution.selector, safeTxHash, false), 1);
        assertFalse(_execGas(safe, address(safe), data, CALL, 100_000));
        assertEq(safe.nonce(), n + 1);
        assertGt(guard.queuedAt(id), 0);
        assertEq(safe.getThreshold(), 2);

        // make it valid (a fourth owner, itself through the timelock), then the kept entry applies at once
        _throughTimelock(address(safe), abi.encodeWithSelector(ISafeV141.addOwnerWithThreshold.selector, owner[3], 2), CALL);
        vm.expectEmit(true, false, false, false, address(guard));
        emit Consumed(id);
        assertTrue(_exec(safe, address(safe), data, CALL));
        assertEq(safe.getThreshold(), 4);
        assertEq(guard.queuedAt(id), 0);
    }

    // ------------------------------------------------------------------ the lock hazard

    /// Safe v1.4.1 setGuard only checks ERC-165. A PlanGuard bound to another Safe passes that check and then
    /// reverts every execTransaction with NotSafe, including setGuard(0) and queue: the Safe is locked and only an
    /// enabled module could clear the guard (PlanModule cannot). Hence: check guard.safe() before setting it.
    function test_Fork_GuardBoundToAnotherSafeLocksIt() public onlyFork {
        ISafeV141 s = _createSafe(_owners(3), 2);
        PlanGuard wrong = new PlanGuard(address(safe), 1, SafeV141.MULTI_SEND_CALL_ONLY);
        assertTrue(_exec(s, address(s), _setGuard(address(wrong)), CALL));
        assertEq(_guardOf(s), address(wrong));

        bytes memory notSafe = abi.encodeWithSelector(PlanGuard.NotSafe.selector);
        _execReverts(s, address(usd), _transfer(supplier, 0), CALL, notSafe);
        _execReverts(s, address(s), _setGuard(address(0)), CALL, notSafe);
        _execReverts(s, address(wrong), _queue(address(s), _setGuard(address(0)), CALL), CALL, notSafe);
        assertEq(s.nonce(), 1); // only the setGuard transaction ran
    }

    // ------------------------------------------------------------------ helpers

    /// Blocked now; queued by a signed Safe transaction to the guard; TooEarly one second before the delay;
    /// passes after it and is used up, so the same transaction is blocked again.
    function _throughTimelock(
        address to,
        bytes memory data,
        uint8 operation
    ) internal {
        _execReverts(safe, to, data, operation, _blocked(data));
        assertTrue(_exec(safe, address(guard), _queue(to, data, operation), CALL));
        vm.warp(block.timestamp + guard.delay() - 1);
        _execReverts(safe, to, data, operation, abi.encodeWithSelector(PlanGuard.TooEarly.selector));
        vm.warp(block.timestamp + 1);

        bytes32 id = guard.txId(to, data, operation);
        vm.expectEmit(true, false, false, false, address(guard));
        emit Consumed(id);
        assertTrue(_exec(safe, to, data, operation));
        assertEq(guard.queuedAt(id), 0);
        _execReverts(safe, to, data, operation, _blocked(data));
    }

    function _queueAndWait(
        address to,
        bytes memory data,
        uint8 operation
    ) internal {
        assertTrue(_exec(safe, address(guard), _queue(to, data, operation), CALL));
        vm.warp(block.timestamp + guard.delay());
    }

    function _createSafe(address[] memory owners, uint256 threshold) internal returns (ISafeV141) {
        bytes memory init = abi.encodeWithSelector(
            ISafeV141.setup.selector,
            owners,
            threshold,
            address(0),
            bytes(""),
            SafeV141.FALLBACK_HANDLER,
            address(0),
            0,
            payable(address(0))
        );
        return ISafeV141(ISafeProxyFactoryV141(SafeV141.PROXY_FACTORY).createProxyWithNonce(SafeV141.SAFE_L2_SINGLETON, init, salt++));
    }

    function _exec(
        ISafeV141 s,
        address to,
        bytes memory data,
        uint8 operation
    ) internal returns (bool) {
        return _execGas(s, to, data, operation, 0);
    }

    function _execGas(
        ISafeV141 s,
        address to,
        bytes memory data,
        uint8 operation,
        uint256 safeTxGas
    ) internal returns (bool) {
        bytes memory sigs = _signatures(s, to, data, operation, safeTxGas);
        return s.execTransaction(to, 0, data, operation, safeTxGas, 0, 0, address(0), payable(address(0)), sigs);
    }

    function _execReverts(
        ISafeV141 s,
        address to,
        bytes memory data,
        uint8 operation,
        bytes memory reason
    ) internal {
        bytes memory sigs = _signatures(s, to, data, operation, 0);
        uint256 n = s.nonce();
        vm.expectRevert(reason);
        s.execTransaction(to, 0, data, operation, 0, 0, 0, address(0), payable(address(0)), sigs);
        assertEq(s.nonce(), n);
    }

    /// Signatures of the first `threshold` current owners, sorted by address as Safe requires.
    function _signatures(
        ISafeV141 s,
        address to,
        bytes memory data,
        uint8 operation,
        uint256 safeTxGas
    ) internal view returns (bytes memory) {
        return _sign(s, _safeTxHash(s, to, data, operation, safeTxGas));
    }

    function _safeTxHash(
        ISafeV141 s,
        address to,
        bytes memory data,
        uint8 operation,
        uint256 safeTxGas
    ) internal view returns (bytes32) {
        uint256 n = s.nonce();
        return s.getTransactionHash(to, 0, data, operation, safeTxGas, 0, 0, address(0), address(0), n);
    }

    function _sign(ISafeV141 s, bytes32 h) internal view returns (bytes memory sigs) {
        address[] memory o = s.getOwners();
        for (uint256 i = 1; i < o.length; i++) {
            for (uint256 j = i; j > 0 && o[j - 1] > o[j]; j--) (o[j - 1], o[j]) = (o[j], o[j - 1]);
        }
        uint256 t = s.getThreshold();
        for (uint256 i = 0; i < t; i++) {
            (uint8 v, bytes32 r, bytes32 sig) = vm.sign(keyOf[o[i]], h);
            sigs = abi.encodePacked(sigs, r, sig, v);
        }
    }

    function _owners(uint256 n) internal view returns (address[] memory o) {
        o = new address[](n);
        for (uint256 i = 0; i < n; i++) o[i] = owner[i];
    }

    function _prevOwner(address o) internal view returns (address) {
        address[] memory list = safe.getOwners();
        for (uint256 i = 0; i < list.length; i++) if (list[i] == o) return i == 0 ? SENTINEL : list[i - 1];
        revert("not an owner");
    }

    function _guardOf(ISafeV141 s) internal view returns (address) {
        return address(uint160(uint256(vm.load(address(s), SafeV141.GUARD_STORAGE_SLOT))));
    }

    function _blocked(bytes memory data) internal pure returns (bytes memory) {
        bytes4 sel;
        assembly {
            sel := mload(add(data, 32))
        }
        return abi.encodeWithSelector(PlanGuard.Blocked.selector, sel);
    }

    function _queue(
        address to,
        bytes memory data,
        uint8 operation
    ) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(PlanGuard.queue.selector, to, data, operation);
    }

    function _setGuard(address g) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(ISafeV141.setGuard.selector, g);
    }

    function _transfer(address to, uint256 amount) internal pure returns (bytes memory) {
        return abi.encodeWithSignature("transfer(address,uint256)", to, amount);
    }

    function _multiSend(bytes memory txs) internal pure returns (bytes memory) {
        return abi.encodeWithSignature("multiSend(bytes)", txs);
    }

    function _pack(address to, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(0), to, uint256(0), data.length, data);
    }
}
