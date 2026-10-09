// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/// @notice The one Safe v1.4.1 function a module uses. operation 0 = call (PlanModule never delegatecalls).
interface ISafe {
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) external returns (bool success);
}
