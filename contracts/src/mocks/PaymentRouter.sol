// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPaymentRouter, IFlowCreditLine} from "../interfaces/IMocks.sol";
import {ISignalAttestor} from "../interfaces/ISignalAttestor.sol";

/// @title PaymentRouter
/// @notice Clients pay invoices here. While credit is drawn and no storm is on, `sweepBps` of each inflow
///         repays the credit line; the rest goes to the Safe. In a storm the sweep pauses.
contract PaymentRouter is IPaymentRouter {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable safe;
    IFlowCreditLine public immutable creditLine;
    ISignalAttestor public immutable attestor;
    bytes32 public immutable region;
    uint16 public immutable sweepBps;

    constructor(
        IERC20 token_,
        address safe_,
        IFlowCreditLine creditLine_,
        ISignalAttestor attestor_,
        bytes32 region_,
        uint16 sweepBps_
    ) {
        token = token_;
        safe = safe_;
        creditLine = creditLine_;
        attestor = attestor_;
        region = region_;
        sweepBps = sweepBps_;
    }

    function pay(bytes32 invoiceRef, uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 swept;
        uint256 owed = creditLine.drawn();
        if (owed > 0 && !attestor.isStorm(region)) {
            swept = (amount * sweepBps) / 10_000;
            if (swept > owed) swept = owed;
            token.safeApprove(address(creditLine), swept);
            creditLine.repay(swept);
        }
        token.safeTransfer(safe, amount - swept);
        emit Inflow(invoiceRef, amount, swept);
    }
}
