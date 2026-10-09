// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {Test} from "forge-std/Test.sol";
import {ISignalAttestor} from "../src/interfaces/ISignalAttestor.sol";
import {SignalAttestor} from "../src/SignalAttestor.sol";

contract SignalAttestorTest is Test {
    event StormStarted(bytes32 indexed region, bytes32 indexed eventId);
    event StormEnded(bytes32 indexed region, bytes32 indexed eventId);

    bytes32 internal constant HK = keccak256("HK");
    bytes32 internal constant HKO = keccak256("HKO");
    bytes32 internal constant GDACS = keccak256("GDACS");
    bytes32 internal constant NCHMF = keccak256("NCHMF");
    bytes32 internal constant EVENT = keccak256("TC-1001211#run1");

    uint256 internal hkoKey = 0xA11CE;
    uint256 internal gdacsKey = 0xB0B;
    uint256 internal nchmfKey = 0xC0FFEE;
    address internal owner = makeAddr("safe");

    SignalAttestor internal att;
    uint256 internal unit;
    mapping(address => uint64) internal nonces;

    function setUp() public {
        vm.warp(1_760_000_000);
        _deploy(84532, 1);
    }

    function _deploy(uint256 chainId, uint256 timeUnit) internal {
        unit = timeUnit;
        att = new SignalAttestor(chainId, timeUnit, owner, vm.addr(hkoKey), vm.addr(gdacsKey), vm.addr(nchmfKey));
    }

    /// current chain time in seconds, whatever the time unit
    function _now() internal view returns (uint64) {
        return uint64(block.timestamp / unit);
    }

    function _a(
        bytes32 source,
        uint8 level,
        bytes32 eventId,
        uint256 key
    ) internal returns (ISignalAttestor.SignalAttestation memory a) {
        address signer = vm.addr(key);
        nonces[signer]++;
        a = ISignalAttestor.SignalAttestation(source, HK, level, eventId, 1758522000, _now(), nonces[signer]);
    }

    function _sign(ISignalAttestor.SignalAttestation memory a, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, att.hashAttestation(a));
        return abi.encodePacked(r, s, v);
    }

    function _attest(
        bytes32 source,
        uint8 level,
        bytes32 eventId,
        uint256 key
    ) internal {
        ISignalAttestor.SignalAttestation memory a = _a(source, level, eventId, key);
        att.attest(a, _sign(a, key));
    }

    function _hko(uint8 level) internal {
        _attest(HKO, level, bytes32(0), hkoKey);
    }

    function _gdacs(uint8 level) internal {
        _attest(GDACS, level, EVENT, gdacsKey);
    }

    // ------------------------------------------------------------------ storm logic

    function test_StormNeedsBothSources() public {
        _hko(8);
        assertFalse(att.isStorm(HK));
        _gdacs(3);
        assertTrue(att.isStorm(HK));
        (bytes32 e, uint8 level) = att.currentEvent(HK);
        assertEq(e, EVENT);
        assertEq(level, 8);
    }

    function test_GdacsAloneIsNotStorm() public {
        _gdacs(3);
        _hko(3);
        assertFalse(att.isStorm(HK));
    }

    function test_GdacsGreenIsNotStorm() public {
        _gdacs(1);
        _hko(10);
        assertFalse(att.isStorm(HK));
    }

    function test_StormEndsOnSignal3() public {
        _gdacs(3);
        _hko(8);
        vm.expectEmit(true, true, false, false, address(att));
        emit StormEnded(HK, EVENT);
        _hko(3);
        assertFalse(att.isStorm(HK));
    }

    function test_StormStartedEmittedOncePerTransition() public {
        _gdacs(3);
        vm.expectEmit(true, true, false, false, address(att));
        emit StormStarted(HK, EVENT);
        _hko(8);
        vm.recordLogs();
        _hko(9);
        _hko(10);
        // two Attested events, no StormStarted
        assertEq(vm.getRecordedLogs().length, 2);
    }

    function test_HkoExpiresAfter12h() public {
        _gdacs(3);
        _hko(8);
        vm.warp(block.timestamp + 12 hours - 1);
        assertTrue(att.isStorm(HK));
        vm.warp(block.timestamp + 1);
        assertFalse(att.isStorm(HK));
    }

    function test_GdacsExpiresAfter24h() public {
        _gdacs(3);
        _hko(8);
        vm.warp(block.timestamp + 11 hours);
        _hko(8); // HKO re-attests every 6 h
        vm.warp(block.timestamp + 11 hours);
        _hko(8);
        assertTrue(att.isStorm(HK));
        vm.warp(block.timestamp + 2 hours); // GDACS now 24 h old
        assertFalse(att.isStorm(HK));
    }

    function test_ReattestationExtends() public {
        _gdacs(3);
        _hko(8);
        vm.warp(block.timestamp + 6 hours);
        _hko(8);
        _gdacs(3);
        vm.warp(block.timestamp + 11 hours);
        assertTrue(att.isStorm(HK));
    }

    function test_NchmfFillsTheLocalSlot() public {
        bytes32 vn = keccak256("VN-QN-HP");
        ISignalAttestor.SignalAttestation memory a = _a(NCHMF, 8, bytes32(0), nchmfKey);
        a.region = vn;
        att.attest(a, _sign(a, nchmfKey));
        ISignalAttestor.SignalAttestation memory g = _a(GDACS, 3, keccak256("TC-1001090"), gdacsKey);
        g.region = vn;
        att.attest(g, _sign(g, gdacsKey));
        assertTrue(att.isStorm(vn));
        assertFalse(att.isStorm(HK));
    }

    // ------------------------------------------------------------------ rejections

    function test_RevertForgedSignature() public {
        ISignalAttestor.SignalAttestation memory a = _a(HKO, 8, bytes32(0), hkoKey);
        bytes memory siga = _sign(a, 0xBAD);
        vm.expectRevert(ISignalAttestor.UnknownRelayer.selector);
        att.attest(a, siga);
    }

    function test_RevertMalformedSignature() public {
        ISignalAttestor.SignalAttestation memory a = _a(HKO, 8, bytes32(0), hkoKey);
        vm.expectRevert(ISignalAttestor.UnknownRelayer.selector);
        att.attest(a, hex"1234");
    }

    function test_RevertWrongRelayerForSource() public {
        // the GDACS key signs an HKO attestation
        ISignalAttestor.SignalAttestation memory a = _a(HKO, 8, bytes32(0), gdacsKey);
        bytes memory siga = _sign(a, gdacsKey);
        vm.expectRevert(ISignalAttestor.UnknownRelayer.selector);
        att.attest(a, siga);
    }

    function test_RevertTamperedField() public {
        ISignalAttestor.SignalAttestation memory a = _a(HKO, 3, bytes32(0), hkoKey);
        bytes memory sig = _sign(a, hkoKey);
        a.level = 10;
        vm.expectRevert(ISignalAttestor.UnknownRelayer.selector);
        att.attest(a, sig);
    }

    function test_RevertReplayedNonce() public {
        ISignalAttestor.SignalAttestation memory a = _a(HKO, 8, bytes32(0), hkoKey);
        bytes memory sig = _sign(a, hkoKey);
        att.attest(a, sig);
        vm.expectRevert(ISignalAttestor.BadNonce.selector);
        att.attest(a, sig);
    }

    function test_RevertStale() public {
        ISignalAttestor.SignalAttestation memory a = _a(HKO, 8, bytes32(0), hkoKey);
        bytes memory sig = _sign(a, hkoKey);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(ISignalAttestor.StaleAttestation.selector);
        att.attest(a, sig);
    }

    function test_RevertFuture() public {
        ISignalAttestor.SignalAttestation memory a = _a(HKO, 8, bytes32(0), hkoKey);
        a.issuedAt = _now() + 60;
        bytes memory siga = _sign(a, hkoKey);
        vm.expectRevert(ISignalAttestor.FutureAttestation.selector);
        att.attest(a, siga);
    }

    function test_RevertHkoWithEventId() public {
        ISignalAttestor.SignalAttestation memory a = _a(HKO, 8, EVENT, hkoKey);
        bytes memory siga = _sign(a, hkoKey);
        vm.expectRevert(ISignalAttestor.UnexpectedEventId.selector);
        att.attest(a, siga);
    }

    function test_RevertBadLevel() public {
        ISignalAttestor.SignalAttestation memory a = _a(HKO, 5, bytes32(0), hkoKey);
        bytes memory siga = _sign(a, hkoKey);
        vm.expectRevert(ISignalAttestor.BadLevel.selector);
        att.attest(a, siga);
        ISignalAttestor.SignalAttestation memory g = _a(GDACS, 4, EVENT, gdacsKey);
        bytes memory sigg = _sign(g, gdacsKey);
        vm.expectRevert(ISignalAttestor.BadLevel.selector);
        att.attest(g, sigg);
    }

    // ------------------------------------------------------------------ FISCO

    function test_FiscoChainIdZeroAndMilliseconds() public {
        _deploy(0, 1000);
        vm.warp(1_760_000_000_000); // milliseconds
        _gdacs(3);
        _hko(8);
        assertTrue(att.isStorm(HK));
        vm.warp(block.timestamp + 12 hours * 1000);
        assertFalse(att.isStorm(HK));
    }

    function test_FiscoStaleInMilliseconds() public {
        _deploy(0, 1000);
        vm.warp(1_760_000_000_000);
        ISignalAttestor.SignalAttestation memory a = _a(HKO, 8, bytes32(0), hkoKey);
        bytes memory sig = _sign(a, hkoKey);
        vm.warp(block.timestamp + 1 hours * 1000 + 1);
        vm.expectRevert(ISignalAttestor.StaleAttestation.selector);
        att.attest(a, sig);
    }

    // ------------------------------------------------------------------ relayer rotation

    function test_RelayerRotationIsTimelocked() public {
        address newHko = vm.addr(0xD00D);
        bytes memory data = abi.encodeWithSelector(SignalAttestor.setRelayer.selector, HKO, newHko);
        vm.expectRevert(ISignalAttestor.NotSelf.selector);
        att.setRelayer(HKO, newHko);
        vm.expectRevert(ISignalAttestor.NotOwner.selector);
        att.queueChange(data);
        vm.startPrank(owner);
        att.queueChange(data);
        vm.expectRevert(ISignalAttestor.TooEarly.selector);
        att.applyChange(data);
        vm.warp(block.timestamp + 24 hours);
        att.applyChange(data);
        vm.stopPrank();
        assertEq(att.relayers(HKO), newHko);
    }

    /// Fixed vector so agent/src/relayers/sign.ts can be checked against the same digest.
    function test_DigestVector() public {
        SignalAttestor fixedAtt = new SignalAttestor(31337, 1, owner, vm.addr(hkoKey), vm.addr(gdacsKey), address(0));
        ISignalAttestor.SignalAttestation memory a = ISignalAttestor.SignalAttestation(
            HKO,
            HK,
            8,
            bytes32(0),
            1758608400,
            1760000000,
            1
        );
        emit log_named_address("attestor", address(fixedAtt));
        emit log_named_bytes32("digest", fixedAtt.hashAttestation(a));
    }
}
