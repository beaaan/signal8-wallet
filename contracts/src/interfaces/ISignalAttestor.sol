// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/// @title ISignalAttestor
/// @notice Turns two signed official-source attestations (HKO + GDACS) into "storm mode" for a region.
/// @dev Spec: docs/specs/contracts.md#signalattestor. Each relayer reads only its own source; pairing happens here.
interface ISignalAttestor {
    struct SignalAttestation {
        bytes32 source; // keccak256("HKO"), keccak256("GDACS") or keccak256("NCHMF")
        bytes32 region; // keccak256("HK") or keccak256("VN-QN-HP")
        uint8 level; // HKO/NCHMF: 0,1,3,8,9,10. GDACS: 0 none, 1 green, 2 orange, 3 red
        bytes32 eventId; // GDACS only: keccak256 of the GDACS event id (run-salted in replays). 0 for HKO/NCHMF
        uint64 sourceTime; // official issue time, unix seconds. Emitted, not checked
        uint64 issuedAt; // relayer signing time, unix seconds. Checked for freshness
        uint64 nonce; // strictly increasing per relayer
    }

    event Attested(
        bytes32 indexed source,
        bytes32 indexed region,
        uint8 level,
        bytes32 eventId,
        uint64 sourceTime,
        uint64 issuedAt
    );
    event StormStarted(bytes32 indexed region, bytes32 indexed eventId);
    event StormEnded(bytes32 indexed region, bytes32 indexed eventId);

    error UnknownRelayer();
    error BadNonce();
    error StaleAttestation();
    error FutureAttestation();
    error UnexpectedEventId();
    error BadLevel();

    function attest(SignalAttestation calldata a, bytes calldata signature) external;

    function isStorm(bytes32 region) external view returns (bool);

    /// @return eventId latest GDACS event id for the region; hkoLevel latest HKO/NCHMF level
    function currentEvent(bytes32 region) external view returns (bytes32 eventId, uint8 hkoLevel);
}
