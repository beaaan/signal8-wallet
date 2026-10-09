// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/// @notice Mock lender: pre-approved line, repaid by a share of each inflow through PaymentRouter.
interface IFlowCreditLine {
    event Drawn(uint256 amount, uint256 drawnTotal);
    event Repaid(uint256 amount, uint256 drawnTotal);

    error OverLimit();
    error NotBorrower();

    function draw(uint256 amount) external; // only the borrower (the Safe, via PlanModule.executeCall)

    function repay(uint256 amount) external; // called by PaymentRouter

    function limit() external view returns (uint256);

    function drawn() external view returns (uint256);
}

/// @notice Clients pay invoices here; a share is swept to the lender unless storm mode is on.
interface IPaymentRouter {
    event Inflow(bytes32 indexed invoiceRef, uint256 amount, uint256 swept);

    function pay(bytes32 invoiceRef, uint256 amount) external;

    function sweepBps() external view returns (uint16);
}

/// @notice Mock insurer: pays a fixed sum once per event while storm mode is on.
interface IMockSignalCover {
    event Claimed(bytes32 indexed eventId, uint256 payout);

    error NotInsured();
    error NoStorm();
    error AlreadyClaimed();

    function claim() external;

    function payout() external view returns (uint256);
}

/// @notice Stores hashes of pre-storm evidence, daily reports and the attack log.
interface IEvidenceRegistry {
    event Anchored(bytes32 indexed kind, bytes32 hash, address indexed sender);

    function anchor(bytes32 hash, bytes32 kind) external;
}
