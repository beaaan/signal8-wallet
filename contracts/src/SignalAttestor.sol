// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ISignalAttestor} from "./interfaces/ISignalAttestor.sol";

/// @title SignalAttestor
/// @notice Turns two signed official-source attestations (HKO or NCHMF, plus GDACS) into storm mode for a region.
/// @dev Spec: docs/specs/contracts.md#signalattestor. The EIP-712 chain id and the time unit are constructor
///      parameters because FISCO BCOS returns 0 from CHAINID and reports block.timestamp in milliseconds.
contract SignalAttestor is ISignalAttestor {
    struct Latest {
        uint8 level;
        bytes32 eventId;
        uint64 sourceTime;
        uint64 issuedAt;
    }

    bytes32 public constant HKO = keccak256("HKO");
    bytes32 public constant GDACS = keccak256("GDACS");
    bytes32 public constant NCHMF = keccak256("NCHMF");

    bytes32 public constant ATTESTATION_TYPEHASH =
        keccak256(
            "SignalAttestation(bytes32 source,bytes32 region,uint8 level,bytes32 eventId,uint64 sourceTime,uint64 issuedAt,uint64 nonce)"
        );
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    uint256 public constant MAX_AGE = 1 hours;
    uint256 public constant LOCAL_TTL = 12 hours; // HKO or NCHMF
    uint256 public constant GDACS_TTL = 24 hours;
    uint256 public constant DELAY = 24 hours;

    bytes32 public immutable DOMAIN_SEPARATOR;
    uint256 public immutable timeUnit;
    address public immutable owner; // the Business Safe; rotates relayers through the timelock

    mapping(bytes32 => address) public relayers; // source => relayer
    mapping(address => uint64) public lastNonce;
    mapping(bytes32 => mapping(bytes32 => Latest)) internal _latest; // source => region => latest
    mapping(bytes32 => uint256) public queuedAt;

    event RelayerSet(bytes32 indexed source, address relayer);
    event ChangeQueued(bytes32 indexed id, bytes data, uint256 eta);
    event ChangeApplied(bytes32 indexed id);
    event ChangeCancelled(bytes32 indexed id);

    constructor(
        uint256 chainId,
        uint256 timeUnit_,
        address owner_,
        address hkoRelayer,
        address gdacsRelayer,
        address nchmfRelayer
    ) {
        timeUnit = timeUnit_;
        owner = owner_;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("Signal8Attestor"), keccak256("1"), chainId, address(this))
        );
        _setRelayer(HKO, hkoRelayer);
        _setRelayer(GDACS, gdacsRelayer);
        _setRelayer(NCHMF, nchmfRelayer);
    }

    // ------------------------------------------------------------------ attest

    /// @notice Submit a relayer-signed attestation. Anyone may submit; the signature decides.
    function attest(SignalAttestation calldata a, bytes calldata signature) external {
        address signer = _recover(a, signature);
        if (signer == address(0) || signer != relayers[a.source]) revert UnknownRelayer();
        if (a.nonce <= lastNonce[signer]) revert BadNonce();
        uint256 issued = uint256(a.issuedAt) * timeUnit;
        if (issued > block.timestamp) revert FutureAttestation();
        if (block.timestamp - issued > MAX_AGE * timeUnit) revert StaleAttestation();
        if (a.source != GDACS && a.eventId != bytes32(0)) revert UnexpectedEventId();
        if (!_validLevel(a.source, a.level)) revert BadLevel();

        bool before = isStorm(a.region);
        lastNonce[signer] = a.nonce;
        _latest[a.source][a.region] = Latest(a.level, a.eventId, a.sourceTime, a.issuedAt);
        emit Attested(a.source, a.region, a.level, a.eventId, a.sourceTime, a.issuedAt);

        bool afterwards = isStorm(a.region);
        if (afterwards != before) {
            bytes32 eventId = _latest[GDACS][a.region].eventId;
            if (afterwards) emit StormStarted(a.region, eventId);
            else emit StormEnded(a.region, eventId);
        }
    }

    // ------------------------------------------------------------------ views

    /// @notice True iff a fresh local signal (HKO/NCHMF level >= 8, under 12 h old) and a fresh GDACS
    ///         alert (Orange or Red, under 24 h old) are both in force for the region.
    function isStorm(bytes32 region) public view returns (bool) {
        Latest memory local = _localLatest(region);
        Latest memory g = _latest[GDACS][region];
        return local.level >= 8 && _fresh(local.issuedAt, LOCAL_TTL) && g.level >= 2 && _fresh(g.issuedAt, GDACS_TTL);
    }

    function currentEvent(bytes32 region) external view returns (bytes32 eventId, uint8 hkoLevel) {
        return (_latest[GDACS][region].eventId, _localLatest(region).level);
    }

    function latest(bytes32 source, bytes32 region)
        external
        view
        returns (
            uint8 level,
            bytes32 eventId,
            uint64 sourceTime,
            uint64 issuedAt
        )
    {
        Latest memory l = _latest[source][region];
        return (l.level, l.eventId, l.sourceTime, l.issuedAt);
    }

    /// @notice EIP-712 digest a relayer signs. Exposed so off-chain signers can be checked against it.
    function hashAttestation(SignalAttestation calldata a) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ATTESTATION_TYPEHASH,
                a.source,
                a.region,
                a.level,
                a.eventId,
                a.sourceTime,
                a.issuedAt,
                a.nonce
            )
        );
        return ECDSA.toTypedDataHash(DOMAIN_SEPARATOR, structHash);
    }

    // ------------------------------------------------------------------ relayer rotation (timelocked, Safe only)

    function queueChange(bytes calldata data) external {
        if (msg.sender != owner) revert NotOwner();
        bytes32 id = keccak256(data);
        queuedAt[id] = block.timestamp;
        emit ChangeQueued(id, data, block.timestamp + DELAY * timeUnit);
    }

    function applyChange(bytes calldata data) external {
        if (msg.sender != owner) revert NotOwner();
        bytes32 id = keccak256(data);
        uint256 t = queuedAt[id];
        if (t == 0) revert NotQueued();
        if (block.timestamp < t + DELAY * timeUnit) revert TooEarly();
        delete queuedAt[id];
        (bool ok, bytes memory ret) = address(this).call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        emit ChangeApplied(id);
    }

    function cancelChange(bytes calldata data) external {
        if (msg.sender != owner) revert NotOwner();
        bytes32 id = keccak256(data);
        if (queuedAt[id] == 0) revert NotQueued();
        delete queuedAt[id];
        emit ChangeCancelled(id);
    }

    /// @notice Only callable through applyChange.
    function setRelayer(bytes32 source, address relayer) external {
        if (msg.sender != address(this)) revert NotSelf();
        _setRelayer(source, relayer);
    }

    // ------------------------------------------------------------------ internals

    function _recover(SignalAttestation calldata a, bytes calldata signature) internal view returns (address) {
        (address signer, ECDSA.RecoverError err) = ECDSA.tryRecover(hashAttestation(a), signature);
        return err == ECDSA.RecoverError.NoError ? signer : address(0);
    }

    function _localLatest(bytes32 region) internal view returns (Latest memory) {
        Latest memory h = _latest[HKO][region];
        Latest memory n = _latest[NCHMF][region];
        return n.issuedAt > h.issuedAt ? n : h;
    }

    function _fresh(uint64 issuedAt, uint256 ttl) internal view returns (bool) {
        if (issuedAt == 0) return false;
        uint256 issued = uint256(issuedAt) * timeUnit;
        return block.timestamp < issued + ttl * timeUnit;
    }

    function _validLevel(bytes32 source, uint8 level) internal pure returns (bool) {
        if (source == GDACS) return level <= 3;
        return level == 0 || level == 1 || level == 3 || level == 8 || level == 9 || level == 10;
    }

    function _setRelayer(bytes32 source, address relayer) internal {
        relayers[source] = relayer;
        emit RelayerSet(source, relayer);
    }
}
