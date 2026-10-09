// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockUSD
/// @notice 6-decimal test dollar for payroll-sized amounts. Testnet only; the owner mints.
contract MockUSD is ERC20, Ownable {
    constructor() ERC20("Mock USD", "mUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint test tokens. Owner (the deployer) only.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
