// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {IEvidenceRegistry} from "../interfaces/IMocks.sol";

/// @title EvidenceRegistry
/// @notice Stores hashes (pre-storm evidence, daily reports, attack log, plan) as events. No storage.
contract EvidenceRegistry is IEvidenceRegistry {
    function anchor(bytes32 hash, bytes32 kind) external {
        emit Anchored(kind, hash, msg.sender);
    }
}
