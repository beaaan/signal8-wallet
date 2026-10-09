// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @title MockMMFVault
/// @notice OpenZeppelin ERC-4626 over MockUSD, standing in for a tokenised money-market fund. Simulation only.
contract MockMMFVault is ERC4626 {
    constructor(IERC20Metadata asset_) ERC20("Mock Money Market Fund", "mMMF") ERC4626(asset_) {}
}
