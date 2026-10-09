// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IFlowCreditLine} from "../interfaces/IMocks.sol";

/// @title FlowCreditLine
/// @notice Mock lender (simulation of a pre-approved line): the borrower draws up to `limit`; repaid by
///         PaymentRouter from a share of each inflow. Draws are paid to the borrower only.
contract FlowCreditLine is IFlowCreditLine {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable borrower;
    uint256 public immutable limit;
    uint256 public drawn;

    constructor(
        IERC20 token_,
        address borrower_,
        uint256 limit_
    ) {
        token = token_;
        borrower = borrower_;
        limit = limit_;
    }

    function draw(uint256 amount) external {
        if (msg.sender != borrower) revert NotBorrower();
        if (drawn + amount > limit) revert OverLimit();
        drawn += amount;
        token.safeTransfer(borrower, amount);
        emit Drawn(amount, drawn);
    }

    /// @notice Anyone may repay on the borrower's behalf (the router does). Overpayment is capped at `drawn`.
    function repay(uint256 amount) external {
        if (amount > drawn) amount = drawn;
        drawn -= amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Repaid(amount, drawn);
    }
}
