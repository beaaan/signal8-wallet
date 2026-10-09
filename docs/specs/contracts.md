# Contract specs

Solidity **0.8.11**, OpenZeppelin **4.9.x**, Foundry. All contracts must also compile for FISCO BCOS, which supports at most 0.8.11, returns 0 from `CHAINID` and reports `block.timestamp` in milliseconds. Interfaces are in `contracts/src/interfaces/`.

| Contract | Role | Deployed on |
| --- | --- | --- |
| `PlanModule` | Safe module: the only path by which the agent moves money | Base Sepolia (Safe); FISCO standalone variant |
| `SignalAttestor` | Turns two signed official-source attestations into storm mode | Both |
| `PlanGuard` (should) | Safe transaction guard: blocks module/owner changes outside the timelock | Base Sepolia |
| `MockUSD` | 6-decimal test dollar, owner can mint | Both (VND variant on FISCO) |
| `MockSignalCover` | Mock insurer: pays a fixed sum once per event at level ≥ 8 | Both |
| `FlowCreditLine` + `PaymentRouter` | Mock lender: pre-approved line, repaid by a share of each inflow; sweep pauses in storm mode | Both |
| `MockMMFVault` | OpenZeppelin ERC-4626 over `MockUSD`, stands in for a tokenised money-market fund | Base Sepolia |
| `EvidenceRegistry` | Stores hashes: pre-storm evidence, daily reports, attack log | Both |

---

## PlanModule

### Roles

| Role | Address | Can do |
| --- | --- | --- |
| `safe` | the Business Safe (2-of-3) | `queueChange`, `applyChange`, `cancelChange`, `pause`, `unpause` |
| `guardian` | owner's hot key | `pause` only (instant emergency stop) |
| `agent` | agent backend key | `executeTransfer`, `executeCall` only |

### Storage

```solidity
uint8 constant BASE = 0;
uint8 constant STORM = 1;

struct Plan {
    uint256 perTxCap;      // max per transfer, token units
    uint256 dailyCap;      // max total per day across transfers and value-moving calls
    bool active;           // plan exists and is signed
    bytes32 planHash;      // keccak of the human-readable signed plan (off-chain JSON)
}

mapping(uint8 => Plan) public plans;
mapping(address => uint256) public payeeActiveFrom;    // 0 = not registered; else timestamp after cooling-off
mapping(uint8 => mapping(address => mapping(bytes4 => bool))) public allowedCall; // plan => target => selector
mapping(uint8 => mapping(uint256 => uint256)) public spentOnDay;              // plan => dayIndex => amount
address public token;            // the dollar token this module accounts in
bytes32 public immutable region; // e.g. keccak256("HK")
bool public paused;
uint256 public constant DELAY = 24 hours;   // FISCO: multiply by TIME_UNIT (1000 for ms)
mapping(bytes32 => uint256) public queuedAt; // keccak(data) => time queued
```

### Agent functions

```solidity
function executeTransfer(uint8 planId, address to, uint256 amount, bytes32 ref) external;
function executeCall(uint8 planId, address target, bytes calldata data, uint256 valueCounted, bytes32 ref) external;
```

Checks, in this order (each a custom error):

1. `msg.sender == agent` → `NotAgent()`
2. `!paused` → `Paused()`
3. `plans[planId].active` → `PlanInactive()`
4. `planId == STORM` ⇒ `attestor.isStorm(region)` → `StormNotActive()` (`region` is set at construction)
5. transfer: `payeeActiveFrom[to] != 0 && block.timestamp >= payeeActiveFrom[to]` → `PayeeNotActive()`
6. call: `allowedCall[planId][target][bytes4(data)]` → `CallNotAllowed()`
7. `amount <= perTxCap` → `OverPerTxCap()`
8. `spentOnDay[planId][today] + amount <= dailyCap` → `OverDailyCap()`
9. execute through `ISafe(safe).execTransactionFromModule(...)`; revert `ExecFailed()` if it returns false

`ref` is the invoice id or action id hash, emitted for reconciliation. For `executeCall`, `valueCounted` is the dollar amount the call moves (e.g., a credit draw or vault withdraw), declared by the backend and checked by the target's own logic; claims and anchors count 0.

### Owner functions (timelocked)

```solidity
function queueChange(bytes calldata data) external onlySafe;   // data = abi.encodeCall(this.<setter>, (...))
function applyChange(bytes calldata data) external onlySafe;   // requires queuedAt + DELAY <= now
function cancelChange(bytes calldata data) external onlySafe;
// setters, callable only via applyChange (internal check: msg.sender == address(this) path):
function setPlan(uint8 planId, Plan calldata p) external;
function addPayee(address payee) external;           // payeeActiveFrom = now + DELAY
function removePayee(address payee) external;
function setAllowedCall(uint8 planId, address target, bytes4 selector, bool allowed) external;
function setAgent(address newAgent) external;
function setAttestor(address newAttestor) external;
function pause() external;      // safe or guardian, instant
function unpause() external;    // safe only
```

Implementation hint: `applyChange` does `address(this).call(data)` after the delay check, and each setter requires `msg.sender == address(this)`.

### Events

```solidity
event Executed(uint8 indexed planId, address indexed target, uint256 amount, bytes32 indexed ref);
event ChangeQueued(bytes32 indexed id, bytes data, uint256 eta);
event ChangeApplied(bytes32 indexed id);
event ChangeCancelled(bytes32 indexed id);
event PlanSet(uint8 indexed planId, uint256 perTxCap, uint256 dailyCap, bytes32 planHash);
event PayeeAdded(address indexed payee, uint256 activeFrom);
event PayeeRemoved(address indexed payee);
event PausedSet(bool paused);
```

### Tests (M1 gate)

| Kind | Cases |
| --- | --- |
| Unit | each revert in the check list; setters only via `applyChange`; `applyChange` before delay reverts; cancel works; pause by guardian; unpause only by Safe |
| Fuzz | random `amount` and sequences of transfers never exceed per-tx or daily caps; day rollover resets |
| **Invariant** | (1) for every plan and day, `spentOnDay ≤ dailyCap`; (2) agent-originated calls never change plans, payees, agent or attestor; (3) no `STORM` execution while `isStorm(region)` is false |

Use a minimal `MockSafe` in tests that implements `execTransactionFromModule` (call through, return success) so tests don't need a full Safe deployment. Add one fork test against the real Safe on Base Sepolia after deployment.

---

## SignalAttestor

### EIP-712

```solidity
// domain: name "Signal8Attestor", version "1", chainId (constructor param, not block.chainid), verifyingContract
struct SignalAttestation {
    bytes32 source;     // keccak256("HKO") or keccak256("GDACS")
    bytes32 region;     // keccak256("HK") or keccak256("VN-QN-HP")
    uint8   level;      // HKO: 0 none/cancel, 1, 3, 8, 9, 10. GDACS: 0 none, 1 green, 2 orange, 3 red
    bytes32 eventId;    // keccak256 of GDACS event id, e.g. "TC-1001190" (same in both attestations)
    uint64  issuedAt;   // source issue time (unix seconds)
    uint64  nonce;      // strictly increasing per relayer
}
```

### Rules

- `attest(SignalAttestation a, bytes sig)`: recover the signer; it must be the registered relayer for `a.source`; `a.nonce > lastNonce[relayer]`; `a.issuedAt <= now` and `now - a.issuedAt <= MAX_AGE` (HKO 3 h, GDACS 24 h).
- Store the latest attestation per source and region.
- `isStorm(region)` is true iff:
  - latest HKO attestation for the region has `level >= 8`, and
  - latest GDACS attestation for the region has `level >= 2` with the same `eventId`, and
  - the HKO attestation is less than `STORM_TTL` (12 h) old.
- An HKO attestation with `level < 8` (e.g., Signal 3 or cancel) ends storm mode at once.
- For the Yagi variant, the "HKO" source slot is filled by the Vietnamese bulletin relayer with source `keccak256("NCHMF")`, mapping disaster risk level 4 → level 8.
- Events: `Attested(source, region, level, eventId, issuedAt)`, `StormStarted(region, eventId)`, `StormEnded(region, eventId)`.
- Admin (relayer rotation) goes through the same 24 h timelock pattern, owned by the Safe.

### Tests

Forged signature; wrong relayer for source; replayed nonce; stale `issuedAt`; GDACS event id mismatch; storm ends on HKO level 3; storm auto-expires after 12 h; chain id set to 0 works (FISCO).

---

## PaymentRouter and FlowCreditLine (mock lender)

- Clients pay invoices into `PaymentRouter.pay(invoiceRef, amount)`.
- The router sends `sweepBps` (e.g., 1000 = 10%) to `FlowCreditLine.repay()` while `drawn > 0` **and** `!attestor.isStorm(region)`, and the rest to the Safe. Event `Inflow(invoiceRef, amount, swept)`.
- `FlowCreditLine.draw(amount)`: only the Safe (via `PlanModule.executeCall`), `drawn + amount <= limit`, transfers `MockUSD` from the lender reserve to the Safe. Event `Drawn(amount)`.
- `limit` set by the lender (deployer) at construction; labelled as a simulation of a pre-approved line.

## MockSignalCover (mock insurer)

- Constructor: `insured` (the Safe), `payout` (e.g., 20,000 mUSD), attestor, region.
- `claim()`: only the insured; requires `attestor.isStorm(region)`; once per `eventId`; transfers `payout`. Event `Claimed(eventId, payout)`.

## MockMMFVault

OpenZeppelin 4.9 `ERC4626` over `MockUSD`, name "Mock Money Market Fund". Deposit and withdraw only through allowed calls on `PlanModule` (base plan: deposit; storm plan: withdraw).

## EvidenceRegistry

`anchor(bytes32 hash, bytes32 kind)`; `kind` ∈ {`PRE_STORM`, `DAILY_REPORT`, `ATTACK_LOG`, `PLAN`}. Event `Anchored(kind, hash, sender)`. No storage beyond the event.

## PlanGuard (should)

Implements Safe v1.4.1 `Guard` (`checkTransaction`, `checkAfterExecution`). Reverts any Safe transaction whose target is the Safe itself and whose selector is one of `disableModule`, `enableModule`, `addOwnerWithThreshold`, `removeOwner`, `swapOwner`, `changeThreshold`, `setGuard`, `setFallbackHandler`, unless `keccak(data)` was queued in `PlanModule`'s timelock at least 24 h earlier. **Deploy to a throwaway Safe first.**

## Deployment

`contracts/script/Deploy.s.sol`:

1. Deploy `MockUSD`, `SignalAttestor` (relayer addresses, chain id), `PlanModule` (safe, guardian, agent, attestor, token), mocks.
2. Mint: Safe 50,000 mUSD; lender reserve 200,000; insurer reserve 100,000; demo client wallet 100,000.
3. Output the Safe transactions the owners must sign: `enableModule(PlanModule)`, then (optionally) `setGuard(PlanGuard)`.
4. Bootstrap config without the 24 h wait: the constructor takes the initial plans, payees and allowed calls, and marks them active immediately. Only later changes are timelocked. Say so in `SECURITY.md`.
5. Write `contracts/deployments/<network>.json` with addresses, ABIs and the block number.
