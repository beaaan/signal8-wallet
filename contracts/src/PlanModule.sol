// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "./interfaces/IPlanModule.sol";
import {ISignalAttestor} from "./interfaces/ISignalAttestor.sol";
import {IFlowCreditLine, IMockSignalCover, IEvidenceRegistry} from "./interfaces/IMocks.sol";
import {ISafe} from "./interfaces/ISafe.sol";

/// @title PlanModule
/// @notice Safe module: the only path by which the agent moves money, and only inside owner-signed plans.
/// @dev Spec: docs/specs/contracts.md#planmodule. Typed agent functions only; each builds its own calls
///      through the Safe, and the Safe is the only receiver of vault, credit and cover funds.
contract PlanModule is IPlanModule {
    struct Targets {
        address vault;
        address creditLine;
        address cover;
        address evidence;
    }

    struct PayeeInit {
        address payee;
        uint8 planMask;
    }

    /// @notice Bootstrap configuration, applied without the timelock (see docs/SECURITY.md, known risk 3).
    struct Config {
        address safe;
        address token;
        bytes32 region;
        uint256 timeUnit;
        address agent;
        address guardian;
        address attestor;
        Targets targets;
        Plan basePlan;
        Plan stormPlan;
        uint256 dailyCeiling;
        PayeeInit[] payees;
    }

    uint8 internal constant PLAN_COUNT = 2;

    mapping(uint8 => Plan) public plans;
    mapping(address => uint8) public payeePlans;
    mapping(uint8 => mapping(uint256 => uint256)) public spentOnDay;
    mapping(uint256 => uint256) public spentAllOnDay;
    uint256 public dailyCeiling;
    mapping(bytes32 => uint256) public drawnInEvent;
    mapping(bytes32 => bool) public refUsed;

    address public immutable safe;
    address public immutable token;
    address public vault;
    address public creditLine;
    address public cover;
    address public evidence;
    ISignalAttestor public attestor;
    address public agent;
    address public guardian;
    bytes32 public immutable region;
    uint256 public immutable timeUnit;
    uint256 public immutable delay;
    bool public paused;
    mapping(bytes32 => uint256) public queuedAt;

    constructor(Config memory c) {
        safe = c.safe;
        token = c.token;
        region = c.region;
        timeUnit = c.timeUnit;
        delay = 24 hours * c.timeUnit;
        _setAgent(c.agent);
        _setGuardian(c.guardian);
        _setAttestor(c.attestor);
        _setTargets(c.targets.vault, c.targets.creditLine, c.targets.cover, c.targets.evidence);
        _setPlan(BASE, c.basePlan);
        _setPlan(STORM, c.stormPlan);
        _setDailyCeiling(c.dailyCeiling);
        for (uint256 i = 0; i < c.payees.length; i++) {
            _setPayee(c.payees[i].payee, c.payees[i].planMask);
        }
    }

    // ------------------------------------------------------------------ modifiers

    modifier onlySafe() {
        if (msg.sender != safe) revert NotSafe();
        _;
    }

    modifier onlySelf() {
        if (msg.sender != address(this)) revert NotSelf();
        _;
    }

    // ------------------------------------------------------------------ agent functions

    /// @notice Pay a payee registered for `planId`, within the plan's caps and the daily ceiling.
    function pay(
        uint8 planId,
        address to,
        uint256 amount,
        bytes32 ref
    ) external {
        _checkAction(planId, ACT_PAY, ref);
        if (payeePlans[to] & (uint8(1) << planId) == 0) revert PayeeNotInPlan();
        Plan storage p = plans[planId];
        if (amount > p.perTxCap) revert OverPerTxCap();
        uint256 day = _today();
        if (spentOnDay[planId][day] + amount > p.dailyCap) revert OverDailyCap();
        if (spentAllOnDay[day] + amount > dailyCeiling) revert OverDailyCeiling();
        spentOnDay[planId][day] += amount;
        spentAllOnDay[day] += amount;

        _exec(token, abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        emit Executed(planId, ACT_PAY, to, amount, ref);
    }

    /// @notice Move Safe cash into the money-market vault; shares are minted to the Safe.
    function vaultDeposit(
        uint8 planId,
        uint256 assets,
        bytes32 ref
    ) external {
        _checkAction(planId, ACT_VAULT_DEPOSIT, ref);
        _exec(token, abi.encodeWithSelector(IERC20.approve.selector, vault, assets));
        _exec(vault, abi.encodeWithSelector(IERC4626.deposit.selector, assets, safe));
        if (IERC20(token).allowance(safe, vault) != 0) revert ExecFailed();
        emit Executed(planId, ACT_VAULT_DEPOSIT, vault, assets, ref);
    }

    /// @notice Withdraw from the vault back to the Safe (receiver and owner are always the Safe).
    function vaultWithdraw(
        uint8 planId,
        uint256 assets,
        bytes32 ref
    ) external {
        _checkAction(planId, ACT_VAULT_WITHDRAW, ref);
        _exec(vault, abi.encodeWithSelector(IERC4626.withdraw.selector, assets, safe, safe));
        emit Executed(planId, ACT_VAULT_WITHDRAW, vault, assets, ref);
    }

    /// @notice Draw on the credit line during a storm, capped per storm event. The line pays only the Safe.
    function creditDraw(uint256 amount, bytes32 ref) external {
        _checkAction(STORM, ACT_CREDIT_DRAW, ref);
        (bytes32 eventId, ) = attestor.currentEvent(region);
        if (drawnInEvent[eventId] + amount > plans[STORM].creditCapPerEvent) revert OverCreditCap();
        drawnInEvent[eventId] += amount;
        _exec(creditLine, abi.encodeWithSelector(IFlowCreditLine.draw.selector, amount));
        emit Executed(STORM, ACT_CREDIT_DRAW, creditLine, amount, ref);
    }

    /// @notice Claim the typhoon cover during a storm. The cover pays only the Safe, once per event.
    function claimCover(bytes32 ref) external {
        _checkAction(STORM, ACT_COVER_CLAIM, ref);
        uint256 before = IERC20(token).balanceOf(safe);
        _exec(cover, abi.encodeWithSelector(IMockSignalCover.claim.selector));
        // the payout the Safe received, so the event carries a real amount like every other action
        emit Executed(STORM, ACT_COVER_CLAIM, cover, IERC20(token).balanceOf(safe) - before, ref);
    }

    /// @notice Anchor a report hash in the evidence registry. Moves no money.
    function anchor(bytes32 hash, bytes32 kind) external {
        if (msg.sender != agent) revert NotAgent();
        if (paused) revert Paused();
        _exec(evidence, abi.encodeWithSelector(IEvidenceRegistry.anchor.selector, hash, kind));
    }

    // ------------------------------------------------------------------ emergency

    /// @notice Instant stop. The Safe, the guardian or the agent itself.
    function pause() external {
        if (msg.sender != safe && msg.sender != guardian && msg.sender != agent) revert NotPauser();
        paused = true;
        emit PausedSet(true, msg.sender);
    }

    /// @notice Resume. Safe only.
    function unpause() external onlySafe {
        paused = false;
        emit PausedSet(false, msg.sender);
    }

    // ------------------------------------------------------------------ owner changes (timelocked)

    /// @notice Queue a setter call; `data` is abi.encodeCall(this.<setter>, (...)).
    function queueChange(bytes calldata data) external onlySafe {
        bytes32 id = keccak256(data);
        queuedAt[id] = block.timestamp;
        emit ChangeQueued(id, data, block.timestamp + delay);
    }

    /// @notice Apply a queued change once the delay has passed.
    function applyChange(bytes calldata data) external onlySafe {
        bytes32 id = keccak256(data);
        uint256 t = queuedAt[id];
        if (t == 0) revert NotQueued();
        if (block.timestamp < t + delay) revert TooEarly();
        delete queuedAt[id];
        (bool ok, bytes memory ret) = address(this).call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        emit ChangeApplied(id);
    }

    function cancelChange(bytes calldata data) external onlySafe {
        bytes32 id = keccak256(data);
        if (queuedAt[id] == 0) revert NotQueued();
        delete queuedAt[id];
        emit ChangeCancelled(id);
    }

    function setPlan(uint8 planId, Plan calldata p) external onlySelf {
        _setPlan(planId, p);
    }

    function setDailyCeiling(uint256 ceiling) external onlySelf {
        _setDailyCeiling(ceiling);
    }

    function setPayee(address payee, uint8 planMask) external onlySelf {
        _setPayee(payee, planMask);
    }

    function setAgent(address newAgent) external onlySelf {
        _setAgent(newAgent);
    }

    function setGuardian(address newGuardian) external onlySelf {
        _setGuardian(newGuardian);
    }

    function setAttestor(address newAttestor) external onlySelf {
        _setAttestor(newAttestor);
    }

    function setTargets(
        address vault_,
        address creditLine_,
        address cover_,
        address evidence_
    ) external onlySelf {
        _setTargets(vault_, creditLine_, cover_, evidence_);
    }

    // ------------------------------------------------------------------ views

    function today() public view returns (uint256) {
        return _today();
    }

    function spentToday(uint8 planId) external view returns (uint256) {
        return spentOnDay[planId][_today()];
    }

    function spentAllToday() external view returns (uint256) {
        return spentAllOnDay[_today()];
    }

    /// @notice Most the plan can still pay today: the lower of its daily cap and the ceiling across plans.
    function remainingToday(uint8 planId) external view returns (uint256) {
        if (planId >= PLAN_COUNT) revert UnknownPlan();
        uint256 day = _today();
        uint256 cap = plans[planId].dailyCap;
        uint256 plan = spentOnDay[planId][day] >= cap ? 0 : cap - spentOnDay[planId][day];
        uint256 all = spentAllOnDay[day] >= dailyCeiling ? 0 : dailyCeiling - spentAllOnDay[day];
        return plan < all ? plan : all;
    }

    // ------------------------------------------------------------------ internals

    /// @dev Checks 1 to 6 of the spec, in order; marks the ref used.
    function _checkAction(
        uint8 planId,
        uint8 action,
        bytes32 ref
    ) internal {
        if (msg.sender != agent) revert NotAgent();
        if (paused) revert Paused();
        if (planId >= PLAN_COUNT || !plans[planId].active) revert PlanInactive();
        if (planId == STORM && !attestor.isStorm(region)) revert StormNotActive();
        if (plans[planId].actions & action == 0) revert ActionNotAllowed();
        if (refUsed[ref]) revert RefUsed();
        refUsed[ref] = true;
    }

    function _exec(address to, bytes memory data) internal {
        if (!ISafe(safe).execTransactionFromModule(to, 0, data, 0)) revert ExecFailed();
    }

    function _today() internal view returns (uint256) {
        return block.timestamp / (1 days * timeUnit);
    }

    function _setPlan(uint8 planId, Plan memory p) internal {
        if (planId >= PLAN_COUNT) revert UnknownPlan();
        plans[planId] = p;
        emit PlanSet(planId, p.perTxCap, p.dailyCap, p.creditCapPerEvent, p.actions, p.planHash);
    }

    function _setDailyCeiling(uint256 ceiling) internal {
        dailyCeiling = ceiling;
        emit DailyCeilingSet(ceiling);
    }

    function _setPayee(address payee, uint8 planMask) internal {
        payeePlans[payee] = planMask;
        emit PayeeSet(payee, planMask);
    }

    function _setAgent(address a) internal {
        agent = a;
    }

    function _setGuardian(address g) internal {
        guardian = g;
    }

    function _setAttestor(address a) internal {
        attestor = ISignalAttestor(a);
    }

    function _setTargets(
        address vault_,
        address creditLine_,
        address cover_,
        address evidence_
    ) internal {
        vault = vault_;
        creditLine = creditLine_;
        cover = cover_;
        evidence = evidence_;
        emit TargetsSet(vault_, creditLine_, cover_, evidence_);
    }
}
