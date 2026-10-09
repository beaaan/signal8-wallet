// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {Test} from "forge-std/Test.sol";
import "../src/interfaces/IPlanModule.sol";
import {PlanModule} from "../src/PlanModule.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {MockAttestor} from "./utils/MockAttestor.sol";
import {Fixture} from "./utils/Fixture.sol";

/// @notice Drives the module as the agent (and as an agent trying to escalate) with random inputs.
contract Handler is Test {
    PlanModule internal module;
    MockAttestor internal attestor;
    MockUSD internal usd;
    address internal agent;
    bytes32 internal region;
    address[] internal targets; // payees and non-payees
    bytes32[2] internal events;

    // ghosts
    uint256[] public daysTouched;
    mapping(uint256 => bool) internal dayKnown;
    mapping(bytes32 => uint256) public refExecutions;
    bytes32[] public refsSeen;
    uint256 public stormExecWhileCalm;
    uint256 public payToNonPlanPayee;

    constructor(
        PlanModule module_,
        MockAttestor attestor_,
        MockUSD usd_,
        address agent_,
        bytes32 region_,
        address[] memory targets_
    ) {
        module = module_;
        attestor = attestor_;
        usd = usd_;
        agent = agent_;
        region = region_;
        targets = targets_;
        events = [keccak256("e1"), keccak256("e2")];
    }

    function _ref(uint256 seed) internal pure returns (bytes32) {
        return bytes32(seed % 64); // small space so duplicate refs actually occur
    }

    function _noteDay() internal {
        uint256 d = module.today();
        if (!dayKnown[d]) {
            dayKnown[d] = true;
            daysTouched.push(d);
        }
    }

    function _executed(uint8 planId, bytes32 ref) internal {
        if (refExecutions[ref] == 0) refsSeen.push(ref);
        refExecutions[ref]++;
        if (planId == STORM && !attestor.isStorm(region)) stormExecWhileCalm++;
    }

    function pay(uint256 planSeed, uint256 toSeed, uint256 amount, uint256 refSeed) external {
        uint8 planId = uint8(planSeed % 2);
        address to = targets[toSeed % targets.length];
        amount = bound(amount, 0, 6_000e6);
        bytes32 ref = _ref(refSeed);
        _noteDay();
        vm.prank(agent);
        try module.pay(planId, to, amount, ref) {
            _executed(planId, ref);
            if (module.payeePlans(to) & (uint8(1) << planId) == 0) payToNonPlanPayee++;
        } catch {}
    }

    function vaultDeposit(uint256 assets, uint256 refSeed) external {
        assets = bound(assets, 0, 10_000e6);
        bytes32 ref = _ref(refSeed);
        vm.prank(agent);
        try module.vaultDeposit(BASE, assets, ref) {
            _executed(BASE, ref);
        } catch {}
    }

    function vaultWithdraw(uint256 planSeed, uint256 assets, uint256 refSeed) external {
        uint8 planId = uint8(planSeed % 2);
        assets = bound(assets, 0, 10_000e6);
        bytes32 ref = _ref(refSeed);
        vm.prank(agent);
        try module.vaultWithdraw(planId, assets, ref) {
            _executed(planId, ref);
        } catch {}
    }

    function creditDraw(uint256 amount, uint256 refSeed) external {
        amount = bound(amount, 0, 20_000e6);
        bytes32 ref = _ref(refSeed);
        vm.prank(agent);
        try module.creditDraw(amount, ref) {
            _executed(STORM, ref);
        } catch {}
    }

    function claimCover(uint256 refSeed) external {
        bytes32 ref = _ref(refSeed);
        vm.prank(agent);
        try module.claimCover(ref) {
            _executed(STORM, ref);
        } catch {}
    }

    function setStorm(bool on, uint256 eventSeed) external {
        attestor.set(region, on, events[eventSeed % 2]);
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 2 days));
    }

    /// The agent tries every configuration path; all must revert.
    function agentEscalates(uint256 which, address who) external {
        vm.startPrank(agent);
        uint256 w = which % 6;
        if (w == 0) try module.setPayee(who, 3) {} catch {}
        else if (w == 1) try module.setDailyCeiling(type(uint256).max) {} catch {}
        else if (w == 2) try module.setAgent(who) {} catch {}
        else if (w == 3) try module.queueChange(abi.encodeWithSelector(IPlanModule.setPayee.selector, who, 3)) {} catch {}
        else if (w == 4) try module.applyChange(abi.encodeWithSelector(IPlanModule.setPayee.selector, who, 3)) {} catch {}
        else try module.setTargets(who, who, who, who) {} catch {}
        vm.stopPrank();
    }

    function daysCount() external view returns (uint256) {
        return daysTouched.length;
    }

    function refsCount() external view returns (uint256) {
        return refsSeen.length;
    }
}

contract PlanModuleInvariantTest is Fixture {
    Handler internal handler;
    bytes32 internal configHash;

    function setUp() public {
        vm.warp(1_760_000_000);
        _deploy(1);
        address[] memory targets = new address[](4);
        targets[0] = supplier;
        targets[1] = staff;
        targets[2] = both;
        targets[3] = stranger;
        handler = new Handler(module, attestor, usd, agent, REGION, targets);
        configHash = _config();
        targetContract(address(handler));
    }

    function _config() internal view returns (bytes32) {
        bytes32 roles = keccak256(
            abi.encode(module.dailyCeiling(), module.agent(), module.guardian(), address(module.attestor()))
        );
        bytes32 targetsHash = keccak256(abi.encode(module.vault(), module.creditLine(), module.cover(), module.evidence()));
        bytes32 payees = keccak256(
            abi.encode(
                module.payeePlans(supplier),
                module.payeePlans(staff),
                module.payeePlans(both),
                module.payeePlans(stranger)
            )
        );
        return keccak256(abi.encode(_plan(BASE), _plan(STORM), roles, targetsHash, payees));
    }

    function _plan(uint8 id) internal view returns (bytes memory) {
        (uint256 a, uint256 b, uint256 c, uint8 d, bool e, bytes32 f) = module.plans(id);
        return abi.encode(a, b, c, d, e, f);
    }

    /// (1) per-plan daily caps and the overall ceiling hold on every day touched
    function invariant_DailyCaps() public {
        (, uint256 baseCap, , , , ) = module.plans(BASE);
        (, uint256 stormCap, , , , ) = module.plans(STORM);
        for (uint256 i = 0; i < handler.daysCount(); i++) {
            uint256 d = handler.daysTouched(i);
            assertLe(module.spentOnDay(BASE, d), baseCap);
            assertLe(module.spentOnDay(STORM, d), stormCap);
            assertLe(module.spentAllOnDay(d), module.dailyCeiling());
        }
    }

    /// (2) the agent never changes configuration
    function invariant_AgentCannotConfigure() public {
        assertEq(_config(), configHash);
    }

    /// (3) no storm-plan execution while storm mode is off
    function invariant_NoStormActionWhenCalm() public {
        assertEq(handler.stormExecWhileCalm(), 0);
    }

    /// (4) tokens leave the Safe only to payees of the executing plan (or into the vault for the Safe)
    function invariant_TokensOnlyToPlanPayees() public {
        assertEq(handler.payToNonPlanPayee(), 0);
        assertEq(usd.balanceOf(stranger), 0);
        assertEq(vault.totalSupply(), vault.balanceOf(address(safe)));
    }

    /// (5) credit per event within the storm plan's cap
    function invariant_CreditPerEvent() public {
        (, , uint256 cap, , , ) = module.plans(STORM);
        assertLe(module.drawnInEvent(keccak256("e1")), cap);
        assertLe(module.drawnInEvent(keccak256("e2")), cap);
    }

    /// (6) each ref executes at most once
    function invariant_RefsOnce() public {
        for (uint256 i = 0; i < handler.refsCount(); i++) {
            assertLe(handler.refExecutions(handler.refsSeen(i)), 1);
        }
    }
}
