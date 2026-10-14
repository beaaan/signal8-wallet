// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {Test} from "forge-std/Test.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../src/interfaces/IPlanModule.sol";
import {ISignalAttestor} from "../src/interfaces/ISignalAttestor.sol";
import {PlanModule} from "../src/PlanModule.sol";
import {SignalAttestor} from "../src/SignalAttestor.sol";
import {LocalSafe} from "../src/LocalSafe.sol";
import {MockVNDDeposit} from "../src/MockVNDDeposit.sol";
import {MockMMFVault} from "../src/mocks/MockMMFVault.sol";
import {FlowCreditLine} from "../src/mocks/FlowCreditLine.sol";
import {MockSignalCover} from "../src/mocks/MockSignalCover.sol";
import {EvidenceRegistry} from "../src/mocks/EvidenceRegistry.sol";

/// @notice The Yagi deployment as it runs on the local FISCO BCOS v3.16.3 chain: chain id 20200 (what eth_chainId
///         and CHAINID return there), block.timestamp in milliseconds (timeUnit 1000), the standalone LocalSafe as
///         the wallet, the mock bank-issued VND deposit token, and no HKO relayer (NCHMF fills the local slot).
contract FiscoYagiTest is Test {
    uint256 internal constant VND = 1e6; // one dong in token units (6 decimals, like MockUSD)
    uint256 internal constant FISCO_CHAIN_ID = 20200;
    bytes32 internal constant VN = keccak256("VN-QN-HP");
    bytes32 internal constant HK = keccak256("HK");
    bytes32 internal constant HKO = keccak256("HKO");
    bytes32 internal constant GDACS = keccak256("GDACS");
    bytes32 internal constant NCHMF = keccak256("NCHMF");
    bytes32 internal constant YAGI = keccak256("TC-1001090#run1");
    bytes32 internal constant PLAN_HASH = keccak256("plan-book.yagi");

    uint256 internal gdacsKey = 0xB0B;
    uint256 internal nchmfKey = 0xC0FFEE;
    uint256 internal hkoKey = 0xA11CE; // not registered on the Vietnam deployment
    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address internal worker = makeAddr("worker");
    address internal supplier = makeAddr("supplier");

    LocalSafe internal safe;
    MockVNDDeposit internal vnd;
    SignalAttestor internal att;
    MockSignalCover internal cover;
    PlanModule internal module;
    mapping(address => uint64) internal nonces;
    uint256 internal n;

    function setUp() public {
        vm.chainId(FISCO_CHAIN_ID);
        vm.warp(1_791_980_814_156); // a FISCO block.timestamp, in milliseconds
        safe = new LocalSafe(owner);
        vnd = new MockVNDDeposit();
        att = new SignalAttestor(FISCO_CHAIN_ID, 1000, owner, address(0), vm.addr(gdacsKey), vm.addr(nchmfKey));
        MockMMFVault vault = new MockMMFVault(IERC20Metadata(address(vnd)));
        FlowCreditLine credit = new FlowCreditLine(vnd, address(safe), 1_250_000_000 * VND);
        cover = new MockSignalCover(vnd, address(safe), 500_000_000 * VND, ISignalAttestor(address(att)), VN);
        EvidenceRegistry evidence = new EvidenceRegistry();

        PlanModule.PayeeInit[] memory payees = new PlanModule.PayeeInit[](2);
        payees[0] = PlanModule.PayeeInit(supplier, 1);
        payees[1] = PlanModule.PayeeInit(worker, 2);
        module = new PlanModule(
            PlanModule.Config({
                safe: address(safe),
                token: address(vnd),
                region: VN,
                timeUnit: 1000,
                agent: agent,
                guardian: owner,
                attestor: address(att),
                targets: PlanModule.Targets(address(vault), address(credit), address(cover), address(evidence)),
                basePlan: IPlanModule.Plan(60_000_000 * VND, 150_000_000 * VND, 0, ACT_PAY | ACT_VAULT_DEPOSIT | ACT_VAULT_WITHDRAW, true, PLAN_HASH),
                stormPlan: IPlanModule.Plan(
                    12_000_000 * VND,
                    200_000_000 * VND,
                    400_000_000 * VND,
                    ACT_PAY | ACT_VAULT_WITHDRAW | ACT_CREDIT_DRAW | ACT_COVER_CLAIM,
                    true,
                    PLAN_HASH
                ),
                dailyCeiling: 300_000_000 * VND,
                payees: payees
            })
        );
        vm.prank(owner);
        safe.enableModule(address(module));
        vnd.mint(address(safe), 1_250_000_000 * VND);
        vnd.mint(address(cover), 2_500_000_000 * VND);
        vnd.mint(address(credit), 5_000_000_000 * VND);
    }

    function _a(
        bytes32 source,
        uint8 level,
        bytes32 eventId,
        uint256 key
    ) internal returns (ISignalAttestor.SignalAttestation memory a) {
        address signer = vm.addr(key);
        nonces[signer]++;
        // relayers sign seconds; the attestor multiplies by timeUnit
        a = ISignalAttestor.SignalAttestation(source, VN, level, eventId, 1725584400, uint64(block.timestamp / 1000), nonces[signer]);
    }

    function _attest(
        bytes32 source,
        uint8 level,
        bytes32 eventId,
        uint256 key
    ) internal {
        ISignalAttestor.SignalAttestation memory a = _a(source, level, eventId, key);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, att.hashAttestation(a));
        att.attest(a, abi.encodePacked(r, s, v));
    }

    function _ref() internal returns (bytes32) {
        return keccak256(abi.encode("yagi", ++n));
    }

    function test_DomainUsesTheFiscoChainId() public {
        assertEq(block.chainid, FISCO_CHAIN_ID);
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Signal8Attestor"),
                keccak256("1"),
                FISCO_CHAIN_ID,
                address(att)
            )
        );
        assertEq(att.DOMAIN_SEPARATOR(), expected);
    }

    function test_YagiStormOnMillisecondTime() public {
        vm.prank(agent);
        vm.expectRevert(IPlanModule.StormNotActive.selector);
        module.pay(STORM, worker, 10_400_000 * VND, _ref());

        _attest(GDACS, 3, YAGI, gdacsKey); // GDACS Red, YAGI-24 lists VNM
        _attest(NCHMF, 8, bytes32(0), nchmfKey); // risk level 4 → 8
        assertTrue(att.isStorm(VN));
        (bytes32 eventId, uint8 local) = att.currentEvent(VN);
        assertEq(eventId, YAGI);
        assertEq(local, 8);

        vm.startPrank(agent);
        module.claimCover(_ref());
        module.pay(STORM, worker, 10_400_000 * VND, _ref());
        vm.stopPrank();
        assertEq(vnd.balanceOf(worker), 10_400_000 * VND);
        assertEq(vnd.balanceOf(address(safe)), (1_250_000_000 + 500_000_000 - 10_400_000) * VND);
        assertEq(module.spentToday(STORM), 10_400_000 * VND);
        assertEq(module.today(), block.timestamp / (1 days * 1000));

        // landfall, then the warning is lifted: storm mode ends at once
        _attest(NCHMF, 10, bytes32(0), nchmfKey);
        _attest(NCHMF, 0, bytes32(0), nchmfKey);
        assertFalse(att.isStorm(VN));
        vm.prank(agent);
        vm.expectRevert(IPlanModule.StormNotActive.selector);
        module.pay(STORM, worker, 1 * VND, _ref());
    }

    function test_NchmfLapsesAfter12HoursOfMilliseconds() public {
        _attest(GDACS, 3, YAGI, gdacsKey);
        _attest(NCHMF, 8, bytes32(0), nchmfKey);
        uint256 issuedMs = (block.timestamp / 1000) * 1000; // issuedAt (seconds) × timeUnit
        vm.warp(issuedMs + 12 hours * 1000 - 1);
        assertTrue(att.isStorm(VN));
        vm.warp(issuedMs + 12 hours * 1000);
        assertFalse(att.isStorm(VN));
    }

    function test_NoHkoRelayerOnTheVietnamDeployment() public {
        assertEq(att.relayers(HKO), address(0));
        ISignalAttestor.SignalAttestation memory a = _a(HKO, 8, bytes32(0), hkoKey);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(hkoKey, att.hashAttestation(a));
        vm.expectRevert(ISignalAttestor.UnknownRelayer.selector);
        att.attest(a, abi.encodePacked(r, s, v));
    }

    function test_NchmfCannotSpeakForHongKong() public {
        ISignalAttestor.SignalAttestation memory a = _a(NCHMF, 8, bytes32(0), nchmfKey);
        a.region = HK;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(nchmfKey, att.hashAttestation(a));
        vm.expectRevert(ISignalAttestor.WrongRegion.selector);
        att.attest(a, abi.encodePacked(r, s, v));
    }

    function test_MockVndDepositIsABankDepositStandIn() public {
        assertEq(vnd.symbol(), "mVND");
        assertEq(vnd.name(), "Mock VND Deposit (bank-issued, test only)");
        assertEq(vnd.decimals(), 6);
        vm.prank(owner);
        vm.expectRevert("Ownable: caller is not the owner");
        vnd.mint(owner, 1);
    }

    function test_OnlyTheOwnerRunsTheStandaloneWallet() public {
        // LocalSafe: one admin key instead of the 2-of-3 Safe; the agent cannot call it directly
        vm.prank(agent);
        vm.expectRevert(LocalSafe.NotAdmin.selector);
        safe.execute(address(vnd), 0, abi.encodeWithSignature("transfer(address,uint256)", agent, 1));
        vm.prank(agent);
        vm.expectRevert(LocalSafe.NotModule.selector);
        safe.execTransactionFromModule(address(vnd), 0, abi.encodeWithSignature("transfer(address,uint256)", agent, 1), 0);
    }
}
