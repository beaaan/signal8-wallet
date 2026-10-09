// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/// @notice Test double for SignalAttestor: storm mode and the event id are set directly.
contract MockAttestor {
    mapping(bytes32 => bool) public storm;
    mapping(bytes32 => bytes32) public eventOf;

    function set(bytes32 region, bool on, bytes32 eventId) external {
        storm[region] = on;
        eventOf[region] = eventId;
    }

    function isStorm(bytes32 region) external view returns (bool) {
        return storm[region];
    }

    function currentEvent(bytes32 region) external view returns (bytes32, uint8) {
        return (eventOf[region], storm[region] ? 8 : 0);
    }
}
