// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {ISafe} from "./interfaces/ISafe.sol";

/// @title LocalSafe
/// @notice Stand-in for the Business Safe on a local Anvil chain and in tests. One admin, no signatures.
///         NOT for Base Sepolia: there the real 2-of-3 Safe v1.4.1 is used. It implements only what
///         PlanModule needs (execTransactionFromModule, call only) plus an admin `execute` for owner actions.
contract LocalSafe is ISafe {
    error NotAdmin();
    error NotModule();
    error DelegateCallNotSupported();
    error CallFailed(bytes reason);

    event EnabledModule(address module);
    event DisabledModule(address module);

    address public immutable admin;
    mapping(address => bool) public isModuleEnabled;

    constructor(address admin_) {
        admin = admin_;
    }

    modifier onlyAdminOrSelf() {
        if (msg.sender != admin && msg.sender != address(this)) revert NotAdmin();
        _;
    }

    function enableModule(address module) external onlyAdminOrSelf {
        isModuleEnabled[module] = true;
        emit EnabledModule(module);
    }

    function disableModule(address module) external onlyAdminOrSelf {
        isModuleEnabled[module] = false;
        emit DisabledModule(module);
    }

    /// @notice What the owners would do with a signed Safe transaction (e.g. PlanModule.queueChange).
    function execute(address to, uint256 value, bytes calldata data) external returns (bytes memory) {
        if (msg.sender != admin) revert NotAdmin();
        (bool ok, bytes memory ret) = to.call{value: value}(data);
        if (!ok) revert CallFailed(ret);
        return ret;
    }

    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) external override returns (bool success) {
        if (!isModuleEnabled[msg.sender]) revert NotModule();
        if (operation != 0) revert DelegateCallNotSupported();
        (success, ) = to.call{value: value}(data);
    }

    receive() external payable {}
}
