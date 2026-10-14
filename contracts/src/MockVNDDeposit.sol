// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockVNDDeposit
/// @notice Mock of a bank-issued Vietnamese dong deposit token, for the Yagi replay on a local FISCO BCOS chain only.
///         It stands for a tokenised bank deposit (a claim on a licensed bank, in VND), not a cryptocurrency:
///         crypto-assets are not a lawful means of payment in Vietnam. The owner (the deployer, standing in for the
///         issuing bank) mints. Test chains only; it is worth nothing.
/// @dev 6 decimals like MockUSD, so the agent's unit handling is unchanged. Amounts are whole dong in practice.
contract MockVNDDeposit is ERC20, Ownable {
    constructor() ERC20("Mock VND Deposit (bank-issued, test only)", "mVND") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint test deposits. Owner (the deployer, as the mock issuing bank) only.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
