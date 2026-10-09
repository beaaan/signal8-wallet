// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {Test} from "forge-std/Test.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ISignalAttestor} from "../../src/interfaces/ISignalAttestor.sol";
import "../../src/interfaces/IPlanModule.sol";
import {PlanModule} from "../../src/PlanModule.sol";
import {LocalSafe} from "../../src/LocalSafe.sol";
import {MockUSD} from "../../src/MockUSD.sol";
import {MockMMFVault} from "../../src/mocks/MockMMFVault.sol";
import {FlowCreditLine} from "../../src/mocks/FlowCreditLine.sol";
import {MockSignalCover} from "../../src/mocks/MockSignalCover.sol";
import {EvidenceRegistry} from "../../src/mocks/EvidenceRegistry.sol";
import {MockAttestor} from "./MockAttestor.sol";

/// @notice Demo configuration from data/fixtures/plans/plan-book.example.json, with a controllable attestor.
abstract contract Fixture is Test {
    uint256 internal constant USD = 1e6;
    bytes32 internal constant REGION = keccak256("HK");
    bytes32 internal constant PLAN_HASH = keccak256("plan-book");
    bytes32 internal constant EVENT_A = keccak256("TC-1001211#a");
    bytes32 internal constant EVENT_B = keccak256("TC-1001211#b");

    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address internal guardian = makeAddr("guardian");
    address internal supplier = makeAddr("supplier");
    address internal staff = makeAddr("staff");
    address internal both = makeAddr("both");
    address internal stranger = makeAddr("stranger");

    LocalSafe internal safe;
    MockUSD internal usd;
    MockMMFVault internal vault;
    FlowCreditLine internal credit;
    MockSignalCover internal cover;
    EvidenceRegistry internal evidence;
    MockAttestor internal attestor;
    PlanModule internal module;

    function _deploy(uint256 timeUnit) internal {
        safe = new LocalSafe(owner);
        usd = new MockUSD();
        vault = new MockMMFVault(IERC20Metadata(address(usd)));
        credit = new FlowCreditLine(usd, address(safe), 50_000 * USD);
        attestor = new MockAttestor();
        cover = new MockSignalCover(usd, address(safe), 20_000 * USD, ISignalAttestor(address(attestor)), REGION);
        evidence = new EvidenceRegistry();

        PlanModule.PayeeInit[] memory payees = new PlanModule.PayeeInit[](3);
        payees[0] = PlanModule.PayeeInit(supplier, 1); // base
        payees[1] = PlanModule.PayeeInit(staff, 2); // storm
        payees[2] = PlanModule.PayeeInit(both, 3); // base + storm

        PlanModule.Config memory c = PlanModule.Config({
            safe: address(safe),
            token: address(usd),
            region: REGION,
            timeUnit: timeUnit,
            agent: agent,
            guardian: guardian,
            attestor: address(attestor),
            targets: PlanModule.Targets(address(vault), address(credit), address(cover), address(evidence)),
            basePlan: IPlanModule.Plan(5_000 * USD, 15_000 * USD, 0, ACT_PAY | ACT_VAULT_DEPOSIT | ACT_VAULT_WITHDRAW, true, PLAN_HASH),
            stormPlan: IPlanModule.Plan(
                3_000 * USD,
                25_000 * USD,
                15_000 * USD,
                ACT_PAY | ACT_VAULT_WITHDRAW | ACT_CREDIT_DRAW | ACT_COVER_CLAIM,
                true,
                PLAN_HASH
            ),
            dailyCeiling: 35_000 * USD,
            payees: payees
        });
        module = new PlanModule(c);
        vm.prank(owner);
        safe.enableModule(address(module));

        usd.mint(address(safe), 100_000 * USD);
        usd.mint(address(credit), 200_000 * USD);
        usd.mint(address(cover), 100_000 * USD);
    }

    function _storm(bool on, bytes32 eventId) internal {
        attestor.set(REGION, on, eventId);
    }

    /// @dev Owner path: queue through the Safe, wait the delay, apply.
    function _ownerChange(bytes memory data) internal {
        vm.prank(owner);
        safe.execute(address(module), 0, abi.encodeWithSelector(IPlanModule.queueChange.selector, data));
        vm.warp(block.timestamp + module.delay());
        vm.prank(owner);
        safe.execute(address(module), 0, abi.encodeWithSelector(IPlanModule.applyChange.selector, data));
    }
}
