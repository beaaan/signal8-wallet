// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMockSignalCover} from "../interfaces/IMocks.sol";
import {ISignalAttestor} from "../interfaces/ISignalAttestor.sol";

/// @title MockSignalCover
/// @notice Mock parametric insurer (simulation, not a real product): pays a fixed sum to the insured,
///         once per storm event, while storm mode is on.
contract MockSignalCover is IMockSignalCover {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable insured;
    uint256 public immutable payout;
    ISignalAttestor public immutable attestor;
    bytes32 public immutable region;
    mapping(bytes32 => bool) public claimed;

    constructor(
        IERC20 token_,
        address insured_,
        uint256 payout_,
        ISignalAttestor attestor_,
        bytes32 region_
    ) {
        token = token_;
        insured = insured_;
        payout = payout_;
        attestor = attestor_;
        region = region_;
    }

    function claim() external {
        if (msg.sender != insured) revert NotInsured();
        if (!attestor.isStorm(region)) revert NoStorm();
        (bytes32 eventId, ) = attestor.currentEvent(region);
        if (claimed[eventId]) revert AlreadyClaimed();
        claimed[eventId] = true;
        token.safeTransfer(insured, payout);
        emit Claimed(eventId, payout);
    }
}
