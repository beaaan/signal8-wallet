// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

// Plan ids
uint8 constant BASE = 0;
uint8 constant STORM = 1;

// Action bits for Plan.actions
uint8 constant ACT_PAY = 1 << 0;
uint8 constant ACT_VAULT_DEPOSIT = 1 << 1;
uint8 constant ACT_VAULT_WITHDRAW = 1 << 2;
uint8 constant ACT_CREDIT_DRAW = 1 << 3;
uint8 constant ACT_COVER_CLAIM = 1 << 4;

/// @title IPlanModule
/// @notice Safe module through which the agent moves money, only inside owner-signed plans.
/// @dev Spec: docs/specs/contracts.md#planmodule. There is deliberately no generic call path:
///      each agent function builds its own calls, and the Safe is the only receiver of vault, credit and cover funds.
interface IPlanModule {
    struct Plan {
        uint256 perTxCap;
        uint256 dailyCap;
        uint256 creditCapPerEvent; // 0 = no credit under this plan
        uint8 actions; // ACT_* bits
        bool active;
        bytes32 planHash; // keccak256 of the signed human-readable plan (canonical JSON)
    }

    event Executed(uint8 indexed planId, uint8 indexed action, address target, uint256 amount, bytes32 indexed ref);
    event ChangeQueued(bytes32 indexed id, bytes data, uint256 eta);
    event ChangeApplied(bytes32 indexed id);
    event ChangeCancelled(bytes32 indexed id);
    event PlanSet(
        uint8 indexed planId,
        uint256 perTxCap,
        uint256 dailyCap,
        uint256 creditCapPerEvent,
        uint8 actions,
        bytes32 planHash
    );
    event DailyCeilingSet(uint256 ceiling);
    event PayeeSet(address indexed payee, uint8 planMask);
    event TargetsSet(address vault, address creditLine, address cover, address evidence);
    event PausedSet(bool paused, address by);

    error NotAgent();
    error NotSafe();
    error NotSelf();
    error NotPauser();
    error Paused();
    error PlanInactive();
    error StormNotActive();
    error ActionNotAllowed();
    error RefUsed();
    error PayeeNotInPlan();
    error OverPerTxCap();
    error OverDailyCap();
    error OverDailyCeiling();
    error OverCreditCap();
    error ExecFailed();
    error NotQueued();
    error TooEarly();
    error UnknownPlan();

    // ---- agent ----
    function pay(uint8 planId, address to, uint256 amount, bytes32 ref) external;

    function vaultDeposit(uint8 planId, uint256 assets, bytes32 ref) external;

    function vaultWithdraw(uint8 planId, uint256 assets, bytes32 ref) external;

    function creditDraw(uint256 amount, bytes32 ref) external; // storm plan

    function claimCover(bytes32 ref) external; // storm plan

    function anchor(bytes32 hash, bytes32 kind) external;

    // ---- owner (Safe), timelocked ----
    function queueChange(bytes calldata data) external;

    function applyChange(bytes calldata data) external;

    function cancelChange(bytes calldata data) external;

    // setters: callable only by this contract via applyChange
    function setPlan(uint8 planId, Plan calldata p) external;

    function setDailyCeiling(uint256 ceiling) external;

    function setPayee(address payee, uint8 planMask) external; // 0 removes

    function setAgent(address newAgent) external;

    function setGuardian(address newGuardian) external;

    function setAttestor(address newAttestor) external;

    function setTargets(address vault, address creditLine, address cover, address evidence) external;

    // ---- emergency ----
    function pause() external; // Safe, guardian or agent, instant

    function unpause() external; // Safe only

    // ---- views ----
    function plans(uint8 planId)
        external
        view
        returns (
            uint256 perTxCap,
            uint256 dailyCap,
            uint256 creditCapPerEvent,
            uint8 actions,
            bool active,
            bytes32 planHash
        );

    function payeePlans(address payee) external view returns (uint8);

    function dailyCeiling() external view returns (uint256);

    function spentToday(uint8 planId) external view returns (uint256);

    function spentAllToday() external view returns (uint256);

    /// @notice Most `planId` can still pay today: min(dailyCap - spent, dailyCeiling - spent across plans).
    function remainingToday(uint8 planId) external view returns (uint256);

    function drawnInEvent(bytes32 eventId) external view returns (uint256);

    function refUsed(bytes32 ref) external view returns (bool);
}
