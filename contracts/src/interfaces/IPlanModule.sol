// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/// @title IPlanModule
/// @notice Safe module through which the agent moves money, only inside owner-signed plans.
/// @dev Spec: docs/specs/contracts.md#planmodule
interface IPlanModule {
    struct Plan {
        uint256 perTxCap;
        uint256 dailyCap;
        bool active;
        bytes32 planHash; // keccak256 of the signed human-readable plan JSON
    }

    event Executed(uint8 indexed planId, address indexed target, uint256 amount, bytes32 indexed ref);
    event ChangeQueued(bytes32 indexed id, bytes data, uint256 eta);
    event ChangeApplied(bytes32 indexed id);
    event ChangeCancelled(bytes32 indexed id);
    event PlanSet(uint8 indexed planId, uint256 perTxCap, uint256 dailyCap, bytes32 planHash);
    event PayeeAdded(address indexed payee, uint256 activeFrom);
    event PayeeRemoved(address indexed payee);
    event PausedSet(bool paused);

    error NotAgent();
    error NotSafe();
    error NotSelf();
    error NotGuardianOrSafe();
    error Paused();
    error PlanInactive();
    error StormNotActive();
    error PayeeNotActive();
    error CallNotAllowed();
    error OverPerTxCap();
    error OverDailyCap();
    error ExecFailed();
    error NotQueued();
    error TooEarly();

    // ---- agent ----
    function executeTransfer(uint8 planId, address to, uint256 amount, bytes32 ref) external;

    function executeCall(uint8 planId, address target, bytes calldata data, uint256 valueCounted, bytes32 ref)
        external;

    // ---- owner (Safe), timelocked ----
    function queueChange(bytes calldata data) external;

    function applyChange(bytes calldata data) external;

    function cancelChange(bytes calldata data) external;

    // setters: callable only by this contract via applyChange
    function setPlan(uint8 planId, Plan calldata p) external;

    function addPayee(address payee) external;

    function removePayee(address payee) external;

    function setAllowedCall(uint8 planId, address target, bytes4 selector, bool allowed) external;

    function setAgent(address newAgent) external;

    function setAttestor(address newAttestor) external;

    // ---- emergency ----
    function pause() external; // Safe or guardian, instant

    function unpause() external; // Safe only

    // ---- views ----
    function plans(uint8 planId)
        external
        view
        returns (uint256 perTxCap, uint256 dailyCap, bool active, bytes32 planHash);

    function payeeActiveFrom(address payee) external view returns (uint256);

    function spentToday(uint8 planId) external view returns (uint256);
}
