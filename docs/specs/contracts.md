# Contract specs

Solidity **0.8.11**, OpenZeppelin **4.9.x**, Foundry. All contracts must also compile for FISCO BCOS, which supports at most 0.8.11, returns 0 from `CHAINID` and reports `block.timestamp` in milliseconds. So every contract that measures time takes an immutable `timeUnit` (1 on Base Sepolia, 1000 on FISCO) and multiplies every duration by it, and the EIP-712 chain id is a constructor parameter. Interfaces are in `contracts/src/interfaces/`.

| Contract | Role | Deployed on |
| --- | --- | --- |
| `PlanModule` | Safe module: the only path by which the agent moves money. Typed functions only; the module builds every call itself | Base Sepolia (Safe); FISCO standalone variant |
| `SignalAttestor` | Turns two signed official-source attestations into storm mode | Both |
| `PlanGuard` (should) | Safe transaction guard: blocks module/owner changes outside the timelock | Base Sepolia |
| `MockUSD` | 6-decimal test dollar, owner can mint | Both (VND variant on FISCO) |
| `MockSignalCover` | Mock insurer: pays a fixed sum once per event while storm mode is on | Both |
| `FlowCreditLine` + `PaymentRouter` | Mock lender: pre-approved line, repaid by a share of each inflow; sweep pauses in storm mode | Both |
| `MockMMFVault` | OpenZeppelin ERC-4626 over `MockUSD`, stands in for a tokenised money-market fund | Base Sepolia |
| `EvidenceRegistry` | Stores hashes: pre-storm evidence, daily reports, attack log | Both |

---

## Business Safe

- Safe v1.4.1, **2-of-3 human owners**: owner, partner, and the owner's backup key (kept offline).
- The agent is **not** a Safe owner. It is registered as a Safe **delegate** in the Transaction Service, so it can propose transactions for the owners to sign but cannot sign one. A stolen agent key therefore gives L2 at most, with or without `PlanGuard`.
- Module: `PlanModule`. Guard: `PlanGuard` (should).

---

## PlanModule

### Roles

| Role | Address | Can do |
| --- | --- | --- |
| `safe` | the Business Safe | `queueChange`, `applyChange`, `cancelChange`, `pause`, `unpause` |
| `guardian` | owner's hot key | `pause` only (instant emergency stop) |
| `agent` | agent backend key | the agent functions below, and `pause` (it stops itself when end-of-day reconciliation fails) |

### Storage

```solidity
uint8 constant BASE = 0;
uint8 constant STORM = 1;

// Action bits for Plan.actions
uint8 constant ACT_PAY            = 1 << 0;
uint8 constant ACT_VAULT_DEPOSIT  = 1 << 1;
uint8 constant ACT_VAULT_WITHDRAW = 1 << 2;
uint8 constant ACT_CREDIT_DRAW    = 1 << 3;
uint8 constant ACT_COVER_CLAIM    = 1 << 4;

struct Plan {
    uint256 perTxCap;          // max per payment, token units
    uint256 dailyCap;          // max total payments per day under this plan
    uint256 creditCapPerEvent; // max total credit drawn per storm event; 0 = no credit
    uint8 actions;             // ACT_* bits this plan allows
    bool active;               // plan exists and is signed
    bytes32 planHash;          // keccak256 of the human-readable signed plan (canonical JSON)
}

mapping(uint8 => Plan) public plans;
mapping(address => uint8) public payeePlans;                      // bit p set = payable under plan p; 0 = not a payee
mapping(uint8 => mapping(uint256 => uint256)) public spentOnDay;  // plan => dayIndex => paid
mapping(uint256 => uint256) public spentAllOnDay;                 // dayIndex => paid across all plans
uint256 public dailyCeiling;                                      // max total payments per day across all plans
mapping(bytes32 => uint256) public drawnInEvent;                  // storm eventId => credit drawn
mapping(bytes32 => bool) public refUsed;                          // ref => already executed

address public immutable safe;
address public immutable token;   // the dollar token this module accounts in
address public vault;             // MockMMFVault
address public creditLine;        // FlowCreditLine
address public cover;             // MockSignalCover
address public evidence;          // EvidenceRegistry
ISignalAttestor public attestor;
address public agent;
address public guardian;
bytes32 public immutable region;  // e.g. keccak256("HK")
uint256 public immutable timeUnit; // 1 on EVM chains, 1000 on FISCO (millisecond timestamps)
uint256 public immutable delay;    // 24 hours * timeUnit
bool public paused;
mapping(bytes32 => uint256) public queuedAt; // keccak256(data) => time queued
```

`dayIndex = block.timestamp / (1 days * timeUnit)`.

### What each plan allows (demo configuration)

| | Base plan | Storm plan |
| --- | --- | --- |
| Payable payees | suppliers (`payeePlans` bit 0) | staff (bit 1) |
| Actions | pay, vault deposit, vault withdraw | pay, vault withdraw, credit draw, cover claim |
| Credit | none (`creditCapPerEvent = 0`) | up to `creditCapPerEvent` per storm event |

This is what storm mode unlocks. On an ordinary day staff are not payable under the base plan, so payroll is a Safe proposal the owners co-sign (L3). During a storm the pre-signed storm plan pays staff on schedule, draws credit within its cap and claims the cover, while supplier payments wait. The owner can put a payee in both plans.

The two plans have separate daily caps, and `dailyCeiling` caps their sum, so the worst day is bounded by one number.

### Agent functions

```solidity
function pay(uint8 planId, address to, uint256 amount, bytes32 ref) external;
function vaultDeposit(uint8 planId, uint256 assets, bytes32 ref) external;
function vaultWithdraw(uint8 planId, uint256 assets, bytes32 ref) external;
function creditDraw(uint256 amount, bytes32 ref) external;   // storm plan
function claimCover(bytes32 ref) external;                     // storm plan
function anchor(bytes32 hash, bytes32 kind) external;          // any plan; only needs "not paused"
function pause() external;                                     // also callable by safe and guardian
```

There is **no generic "call any target" function**. An allowlist of target and selector does not constrain arguments: ERC-4626 `withdraw(assets, receiver, owner)` and `deposit(assets, receiver)` both take a receiver, so a generic call path would let a stolen agent key send the vault's assets anywhere, uncapped. Instead the module builds each call itself, and the Safe is the only receiver:

| Function | Calls the Safe makes (`execTransactionFromModule`) | Limited by |
| --- | --- | --- |
| `pay` | `token.transfer(to, amount)` | plan `perTxCap`, plan `dailyCap`, `dailyCeiling`, payee in plan |
| `vaultDeposit` | `token.approve(vault, assets)`, then `vault.deposit(assets, safe)`; the allowance must be 0 afterwards | Safe balance; the shares stay with the Safe |
| `vaultWithdraw` | `vault.withdraw(assets, safe, safe)` | Safe's shares; the money returns to the Safe |
| `creditDraw` | `creditLine.draw(amount)`; the line pays only its borrower, the Safe | `drawnInEvent[eventId] + amount ≤ creditCapPerEvent`, and the line's own limit |
| `claimCover` | `cover.claim()`; the cover pays only the insured, the Safe | once per event, enforced by the cover; `Executed.amount` is the payout the Safe received |
| `anchor` | `evidence.anchor(hash, kind)` | nothing; moves no money |

Checks, in this order (each a custom error):

1. `msg.sender == agent` → `NotAgent()`
2. `!paused` → `Paused()`
3. `plans[planId].active` → `PlanInactive()` (`anchor` skips checks 3 to 6)
4. `planId == STORM` ⇒ `attestor.isStorm(region)` → `StormNotActive()`
5. the plan's `actions` has the function's bit → `ActionNotAllowed()`
6. `!refUsed[ref]`, then mark it used → `RefUsed()`
7. `pay`: `payeePlans[to] & (1 << planId) != 0` → `PayeeNotInPlan()`
8. `pay`: `amount <= perTxCap` → `OverPerTxCap()`; `spentOnDay[planId][today] + amount <= dailyCap` → `OverDailyCap()`; `spentAllOnDay[today] + amount <= dailyCeiling` → `OverDailyCeiling()`
9. `creditDraw`: `(eventId, ) = attestor.currentEvent(region)`; `drawnInEvent[eventId] + amount <= plans[STORM].creditCapPerEvent` → `OverCreditCap()`
10. execute through the Safe; revert `ExecFailed()` if any call returns false

`creditDraw` and `claimCover` use the storm plan implicitly, so check 4 always applies to them.

**`ref` rules.** Supplier payment: `keccak256(invoiceId)`. Payroll: `keccak256(abi.encode(employee, payPeriod))`. Other actions: `keccak256(actionId)`. A ref executes once, so a duplicated invoice or a second payroll run for the same period reverts with `RefUsed()`.

**Worst case with a stolen agent key:** payments to payees registered for an active plan, up to `dailyCeiling` per day; credit draws up to `creditCapPerEvent` per storm event, which land in the Safe; vault moves, which stay in the Safe. The guardian pauses, or the agent's own reconciliation does.

### Owner functions (timelocked)

```solidity
function queueChange(bytes calldata data) external onlySafe;   // data = abi.encodeCall(this.<setter>, (...))
function applyChange(bytes calldata data) external onlySafe;   // requires queuedAt + delay <= now
function cancelChange(bytes calldata data) external onlySafe;
// setters, callable only via applyChange (each requires msg.sender == address(this)):
function setPlan(uint8 planId, Plan calldata p) external;
function setDailyCeiling(uint256 ceiling) external;
function setPayee(address payee, uint8 planMask) external;     // 0 removes the payee
function setAgent(address newAgent) external;
function setGuardian(address newGuardian) external;
function setAttestor(address newAttestor) external;
function setTargets(address vault, address creditLine, address cover, address evidence) external;
function pause() external;      // safe, guardian or agent, instant
function unpause() external;    // safe only
```

Implementation hint: `applyChange` does `address(this).call(data)` after the delay check.

**New-payee cooling-off is the timelock.** A new payee, or a payee added to another plan, can be paid once its `setPayee` change has waited 24 hours and been applied. There is no second waiting period after that. Tightening changes (removing a payee, lowering a cap) also go through the timelock; use `pause` in the meantime.

### Events

```solidity
event Executed(uint8 indexed planId, uint8 indexed action, address target, uint256 amount, bytes32 indexed ref);
event ChangeQueued(bytes32 indexed id, bytes data, uint256 eta);
event ChangeApplied(bytes32 indexed id);
event ChangeCancelled(bytes32 indexed id);
event PlanSet(uint8 indexed planId, uint256 perTxCap, uint256 dailyCap, uint256 creditCapPerEvent, uint8 actions, bytes32 planHash);
event DailyCeilingSet(uint256 ceiling);
event PayeeSet(address indexed payee, uint8 planMask);
event TargetsSet(address vault, address creditLine, address cover, address evidence);
event PausedSet(bool paused, address by);
```

`anchor` emits no module event; the registry emits `Anchored` with the Safe as sender.

### Tests (M1 gate)

| Kind | Cases |
| --- | --- |
| Unit | each revert in the check list; setters only via `applyChange`; `applyChange` before the delay reverts; cancel works; pause by guardian and by agent; unpause only by the Safe; `vaultDeposit` leaves a zero allowance; vault calls always use the Safe as receiver and owner; a reused `ref` reverts; a payee registered only for the base plan cannot be paid under the storm plan; credit cap is per event and a new event starts at 0 |
| Fuzz | random amounts and sequences never exceed `perTxCap`, `dailyCap` or `dailyCeiling`; day rollover resets; `timeUnit = 1000` behaves like `timeUnit = 1` with millisecond timestamps |
| **Invariant** | (1) for every plan and day, `spentOnDay ≤ dailyCap`, and `spentAllOnDay ≤ dailyCeiling`; (2) agent-originated calls never change plans, payees, ceiling, targets, agent, guardian or attestor; (3) no storm-plan execution while `isStorm(region)` is false; (4) tokens leave the Safe through the module only to a payee registered for the executing plan, or into the vault with shares minted to the Safe; (5) `drawnInEvent[e] ≤ creditCapPerEvent` for every event; (6) each `ref` executes at most once |

Use a minimal `MockSafe` in tests that implements `execTransactionFromModule` (call through, return success) so tests don't need a full Safe deployment. Add one fork test against the real Safe on Base Sepolia after deployment.

### Caps and the compressed replay

Daily windows are real chain days. The Ragasa replay compresses three days into minutes, so the whole run lands in one chain day. The demo caps (in `data/fixtures/plans/`) are therefore sized so that one full run, the everyday payments plus storm payroll, fits under each plan's `dailyCap` and the `dailyCeiling`. Rehearsals run on an Anvil fork, so they do not use up the live deployment's day.

---

## SignalAttestor

### EIP-712

```solidity
// domain: name "Signal8Attestor", version "1", chainId (constructor param, not block.chainid), verifyingContract
struct SignalAttestation {
    bytes32 source;     // keccak256("HKO"), keccak256("GDACS") or keccak256("NCHMF")
    bytes32 region;     // keccak256("HK") or keccak256("VN-QN-HP")
    uint8   level;      // HKO/NCHMF: 0 none/cancel, 1, 3, 8, 9, 10. GDACS: 0 none, 1 green, 2 orange, 3 red
    bytes32 eventId;    // GDACS only: keccak256 of the GDACS event id. Must be 0 for HKO and NCHMF
    uint64  sourceTime; // official issue time from the source (unix seconds). Emitted, not checked
    uint64  issuedAt;   // when the relayer signed (unix seconds). Checked for freshness
    uint64  nonce;      // strictly increasing per relayer
}
```

**Why two times.** Freshness exists to stop old signatures being replayed, so it checks when the relayer made the statement (`issuedAt`). The official time (`sourceTime`) is kept for the record. In live mode the two are minutes apart. In a replay, `sourceTime` is the 2025 HKO time and `issuedAt` is now; without the split, every replay attestation would be a year stale on the 2026 chain.

**Why only GDACS carries the event id.** HKO's `warnsum` has no event id. If the HKO attestation had to carry the GDACS id, the HKO relayer would have to read GDACS, and the two sources would no longer be independent. Each relayer reads only its own source; the attestor pairs them on-chain.

### Rules

- `attest(SignalAttestation a, bytes sig)`:
  - recover the signer; it must be the registered relayer for `a.source` → `UnknownRelayer()`
  - `a.nonce > lastNonce[relayer]` → `BadNonce()`
  - `a.issuedAt * timeUnit <= block.timestamp` → `FutureAttestation()`
  - `block.timestamp - a.issuedAt * timeUnit <= MAX_AGE * timeUnit` (1 hour) → `StaleAttestation()`
  - `a.eventId == 0` unless `a.source` is GDACS → `UnexpectedEventId()`
  - a GDACS attestation with `level > 0` carries a non-zero `eventId` → `MissingEventId()` (a zero id would make every storm share one cover claim and one credit cap)
  - one local source per region: HKO only for `keccak256("HK")`, NCHMF for every other region → `WrongRegion()`, so one local relayer can never switch another region's storm mode
  - `a.level` is valid for the source → `BadLevel()`
- Store the latest attestation per source and region.
- `isStorm(region)` is true iff:
  - the latest HKO (or NCHMF) attestation for the region has `level >= 8` and is less than `HKO_TTL` (12 h) old, and
  - the latest GDACS attestation for the region has `level >= 2` and is less than `GDACS_TTL` (24 h) old.
- `currentEvent(region)` returns the storm's event id while storm mode is on (`stormEvent[region]`, fixed by the attestation that started the storm), otherwise the latest GDACS `eventId`, plus the latest local level. `MockSignalCover` and `PlanModule.creditDraw` key "once per event" on this id, so a GDACS re-attestation with a different id in the middle of a storm cannot reset the credit cap or let the cover pay twice.
- One address may be the relayer for one source only (constructor and rotation) → `RelayerInUse()`; the deploy script also checks it.
- An HKO attestation with `level < 8` (e.g., Signal 3 or cancel) ends storm mode at once.
- The relayers re-attest every 6 hours while their condition holds (HKO signal ≥ 8, GDACS event current), so a long storm keeps storm mode on. A relayer that goes silent lets storm mode expire after its TTL.
- `attest` emits `StormStarted(region, eventId)` or `StormEnded(region, eventId)` when that attestation changes `isStorm`. Expiry by TTL makes `isStorm` false without an event, so the dashboard reads the view as well.
- For the Yagi variant, the HKO slot is filled by the Vietnamese bulletin relayer with source `keccak256("NCHMF")`, mapping disaster risk level 4 → level 8.
- Durations are multiplied by `timeUnit`; chain id and `timeUnit` are constructor parameters.
- Admin (relayer rotation) goes through the same 24 h timelock pattern, owned by the Safe.

### Replays

In replay mode the relayers sign with `issuedAt = now` and the recorded official time as `sourceTime`. The GDACS relayer salts the event id with a run id, `eventId = keccak256("TC-1001211#<runId>")`, so each run counts as a new event for the cover's and the credit line's once-per-event rules. The real GDACS id is in the replay JSON and the evidence table. `SECURITY.md` lists this as a demo-only behaviour.

### Tests

Forged signature; wrong relayer for source; replayed nonce; stale `issuedAt`; future `issuedAt`; HKO attestation with a non-zero `eventId`; GDACS alert with a zero `eventId`; HKO outside HK and NCHMF for HK; one key for two sources (constructor and rotation); event id pinned for the storm; invalid level; storm needs both sources; storm ends on HKO level 3; storm expires when the HKO attestation passes 12 h, and separately when the GDACS one passes 24 h; re-attestation extends both; `StormStarted` and `StormEnded` emitted once per transition; chain id 0 and `timeUnit = 1000` work (FISCO).

---

## PaymentRouter and FlowCreditLine (mock lender)

- Clients pay invoices into `PaymentRouter.pay(invoiceRef, amount)`.
- The router sends `sweepBps` (e.g., 1000 = 10%) to `FlowCreditLine.repay()` while `drawn > 0` **and** `!attestor.isStorm(region)`, and the rest to the Safe. Event `Inflow(invoiceRef, amount, swept)`.
- `FlowCreditLine.draw(amount)`: only the borrower (the Safe, via `PlanModule.creditDraw`), `drawn + amount <= limit`, transfers `MockUSD` from the lender reserve **to the borrower only**. Event `Drawn(amount, drawnTotal)`.
- `limit` set by the lender (deployer) at construction; labelled as a simulation of a pre-approved line.

## MockSignalCover (mock insurer)

- Constructor: `insured` (the Safe), `payout` (e.g., 20,000 mUSD), attestor, region.
- `claim()`: only the insured; requires `attestor.isStorm(region)`; once per `eventId` from `attestor.currentEvent(region)`; transfers `payout` to the insured. Event `Claimed(eventId, payout)`.

## MockMMFVault

OpenZeppelin 4.9 `ERC4626` over `MockUSD`, name "Mock Money Market Fund". Deposits and withdrawals go through `PlanModule.vaultDeposit` and `vaultWithdraw`, with the Safe as receiver and owner. The base plan allows both (the brace at Signal 3 withdraws before storm mode starts); the storm plan allows withdraw.

## EvidenceRegistry

`anchor(bytes32 hash, bytes32 kind)`; `kind` ∈ {`PRE_STORM`, `DAILY_REPORT`, `ATTACK_LOG`, `PLAN`}. Event `Anchored(kind, hash, sender)`. No storage beyond the event.

## PlanGuard (should)

Implements Safe v1.4.1 `Guard` (`checkTransaction`, `checkAfterExecution`, ERC-165 id `0xe6d7a83a`). Reverts `Blocked(selector)` for any Safe transaction whose target is the Safe itself and whose selector is one of `enableModule`, `disableModule`, `addOwnerWithThreshold`, `removeOwner`, `swapOwner`, `changeThreshold`, `setGuard`, `setFallbackHandler`, and for **any delegatecall** except one to MultiSendCallOnly (v1.4.1 canonical `0x9641d764fc13c8B624c04430C7356C1C7C8102e2`, a constructor parameter), whose batch is decoded and checked call by call: a batch is guarded if any call in it is (or is malformed, or is itself a delegatecall). Safe Wallet batches and the agent's multi-call proposals (protocol-kit `onlyCalls`) use MultiSendCallOnly, so payroll proposals pass. All of this applies unless that exact transaction (`keccak256(abi.encode(to, keccak256(data), operation))`) was queued in the guard by the Safe (`queue(to, data, operation)`) at least 24 h (× `timeUnit`) earlier. A queue entry is consumed in `checkAfterExecution` when the transaction succeeds, so it works once (a Safe transaction whose inner call failed keeps it); `cancel` removes it. The guard keeps its own queue rather than reusing `PlanModule`'s, because `PlanModule.applyChange` would try to call the queued data on the module. Because the agent is not a Safe owner, the guard is not what bounds a stolen agent key; it slows down an attacker who has phished two human owners. Recovery: a queued `setGuard(address(0))` passes once matured. Safe v1.4.1 does not run the guard on module transactions; `PlanModule` only reaches its fixed targets. **Deploy to a throwaway Safe first.** The deploy script deploys it but does not set it; the owners do, as a Safe transaction.

## Deployment

`contracts/script/Deploy.s.sol`:

1. Deploy `MockUSD`, `SignalAttestor` (relayer addresses, chain id, `timeUnit`), the mocks (vault; credit line and cover with the Safe as borrower and insured; router; evidence registry), then `PlanModule` (safe, guardian, agent, attestor, token, targets, region, `timeUnit`, initial plans, payees with plan masks, `dailyCeiling`). Plans, payees and the ceiling come from the plan book: the script reads the JSON printed by `npm run plan:hash` (see [plans.md](plans.md)) with `vm.parseJson`.
2. Mint: Safe 50,000 mUSD; lender reserve 200,000; insurer reserve 100,000; demo client wallet 100,000.
3. Output the Safe transactions the owners must sign: `enableModule(PlanModule)`, then (optionally) `setGuard(PlanGuard)`.
4. One owner registers the agent address as a Safe delegate in the Transaction Service (API Kit `addSafeDelegate`).
5. Bootstrap config without the 24 h wait: the constructor takes the initial plans, payees, ceiling and targets, and they apply immediately. Only later changes are timelocked. Say so in `SECURITY.md`.
6. Write `contracts/deployments/<network>.json` with addresses, ABIs and the block number.
