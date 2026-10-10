// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../src/interfaces/IPlanModule.sol";
import {ISignalAttestor} from "../src/interfaces/ISignalAttestor.sol";
import {SignalAttestor} from "../src/SignalAttestor.sol";
import {Fixture} from "./utils/Fixture.sol";

/// @notice PlanModule and the cover wired to the real SignalAttestor (the unit tests use MockAttestor).
contract IntegrationTest is Fixture {
    bytes32 internal constant HKO = keccak256("HKO");
    bytes32 internal constant GDACS = keccak256("GDACS");

    uint256 internal hkoKey = 0xA11CE;
    uint256 internal gdacsKey = 0xB0B;
    SignalAttestor internal att;
    mapping(address => uint64) internal nonces;
    uint256 internal n;

    function setUp() public {
        vm.warp(1_760_000_000);
        att = new SignalAttestor(block.chainid, 1, makeAddr("safe-owner"), vm.addr(hkoKey), vm.addr(gdacsKey), address(0));
        _deployWith(1, address(att));
    }

    function _attest(bytes32 source, uint8 level, bytes32 eventId, uint256 key) internal {
        address signer = vm.addr(key);
        nonces[signer]++;
        ISignalAttestor.SignalAttestation memory a = ISignalAttestor.SignalAttestation(
            source,
            REGION,
            level,
            eventId,
            1758522000,
            uint64(block.timestamp),
            nonces[signer]
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, att.hashAttestation(a));
        att.attest(a, abi.encodePacked(r, s, v));
    }

    function _ref() internal returns (bytes32) {
        return keccak256(abi.encode("ref", ++n));
    }

    function test_StormUnlocksTheStormPlan() public {
        vm.prank(agent);
        vm.expectRevert(IPlanModule.StormNotActive.selector);
        module.creditDraw(1_000 * USD, _ref());
        _attest(GDACS, 3, EVENT_A, gdacsKey);
        _attest(HKO, 8, bytes32(0), hkoKey);
        vm.prank(agent);
        module.creditDraw(1_000 * USD, _ref());
        assertEq(module.drawnInEvent(EVENT_A), 1_000 * USD);
    }

    /// A GDACS re-attestation with a new event id mid-storm must not reset the credit cap or pay the cover twice.
    function test_NewGdacsEventIdMidStormKeepsTheCaps() public {
        _attest(GDACS, 3, EVENT_A, gdacsKey);
        _attest(HKO, 8, bytes32(0), hkoKey);
        vm.startPrank(agent);
        module.creditDraw(15_000 * USD, _ref());
        module.claimCover(_ref());
        vm.stopPrank();

        _attest(GDACS, 3, EVENT_B, gdacsKey);
        assertTrue(att.isStorm(REGION));
        (bytes32 id, ) = att.currentEvent(REGION);
        assertEq(id, EVENT_A);

        vm.startPrank(agent);
        vm.expectRevert(IPlanModule.OverCreditCap.selector);
        module.creditDraw(1 * USD, _ref());
        vm.expectRevert(IPlanModule.ExecFailed.selector); // the cover reverts AlreadyClaimed inside the Safe call
        module.claimCover(_ref());
        vm.stopPrank();
        assertEq(module.drawnInEvent(EVENT_B), 0);
    }

    /// After the storm ends, the next storm is a new event with its own cap and cover.
    function test_NextStormIsANewEvent() public {
        _attest(GDACS, 3, EVENT_A, gdacsKey);
        _attest(HKO, 8, bytes32(0), hkoKey);
        vm.prank(agent);
        module.creditDraw(15_000 * USD, _ref());
        _attest(HKO, 3, bytes32(0), hkoKey);
        assertFalse(att.isStorm(REGION));

        vm.warp(block.timestamp + 2 days);
        _attest(GDACS, 3, EVENT_B, gdacsKey);
        _attest(HKO, 8, bytes32(0), hkoKey);
        (bytes32 id, ) = att.currentEvent(REGION);
        assertEq(id, EVENT_B);
        vm.prank(agent);
        module.creditDraw(15_000 * USD, _ref());
    }

    function test_StormLapsesWithoutFreshAttestations() public {
        _attest(GDACS, 3, EVENT_A, gdacsKey);
        _attest(HKO, 8, bytes32(0), hkoKey);
        vm.warp(block.timestamp + 12 hours);
        vm.prank(agent);
        vm.expectRevert(IPlanModule.StormNotActive.selector);
        module.creditDraw(1 * USD, _ref());
    }
}
