// Human-readable ABIs of the contracts the agent talks to (contracts/src/interfaces, docs/specs/contracts.md).
import { parseAbi } from "viem";

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export const planModuleAbi = parseAbi([
  "function pay(uint8 planId, address to, uint256 amount, bytes32 ref)",
  "function vaultDeposit(uint8 planId, uint256 assets, bytes32 ref)",
  "function vaultWithdraw(uint8 planId, uint256 assets, bytes32 ref)",
  "function creditDraw(uint256 amount, bytes32 ref)",
  "function claimCover(bytes32 ref)",
  "function anchor(bytes32 hash, bytes32 kind)",
  "function pause()",
  "function queueChange(bytes data)",
  "function applyChange(bytes data)",
  "function setPlan(uint8 planId, (uint256 perTxCap, uint256 dailyCap, uint256 creditCapPerEvent, uint8 actions, bool active, bytes32 planHash) p)",
  "function setPayee(address payee, uint8 planMask)",
  "function setDailyCeiling(uint256 ceiling)",
  "function today() view returns (uint256)",
  "function plans(uint8 planId) view returns (uint256 perTxCap, uint256 dailyCap, uint256 creditCapPerEvent, uint8 actions, bool active, bytes32 planHash)",
  "function payeePlans(address payee) view returns (uint8)",
  "function dailyCeiling() view returns (uint256)",
  "function spentToday(uint8 planId) view returns (uint256)",
  "function spentAllToday() view returns (uint256)",
  "function remainingToday(uint8 planId) view returns (uint256)",
  "function drawnInEvent(bytes32 eventId) view returns (uint256)",
  "function refUsed(bytes32 ref) view returns (bool)",
  "function paused() view returns (bool)",
  "function agent() view returns (address)",
  "function safe() view returns (address)",
  "function region() view returns (bytes32)",
  "event Executed(uint8 indexed planId, uint8 indexed action, address target, uint256 amount, bytes32 indexed ref)",
  "event PausedSet(bool paused, address by)",
  "event PayeeSet(address indexed payee, uint8 planMask)",
  "event PlanSet(uint8 indexed planId, uint256 perTxCap, uint256 dailyCap, uint256 creditCapPerEvent, uint8 actions, bytes32 planHash)",
  "event ChangeQueued(bytes32 indexed id, bytes data, uint256 eta)",
  "event ChangeApplied(bytes32 indexed id)",
  "error NotAgent()",
  "error NotSafe()",
  "error NotSelf()",
  "error NotPauser()",
  "error Paused()",
  "error PlanInactive()",
  "error StormNotActive()",
  "error ActionNotAllowed()",
  "error RefUsed()",
  "error PayeeNotInPlan()",
  "error OverPerTxCap()",
  "error OverDailyCap()",
  "error OverDailyCeiling()",
  "error OverCreditCap()",
  "error ExecFailed()",
  "error NotQueued()",
  "error TooEarly()",
  // errors of the targets, in case one bubbles up
  "error OverLimit()",
  "error NotBorrower()",
  "error NotInsured()",
  "error NoStorm()",
  "error AlreadyClaimed()",
]);

export const signalAttestorAbi = parseAbi([
  "struct SignalAttestation { bytes32 source; bytes32 region; uint8 level; bytes32 eventId; uint64 sourceTime; uint64 issuedAt; uint64 nonce; }",
  "function attest(SignalAttestation a, bytes signature)",
  "function isStorm(bytes32 region) view returns (bool)",
  "function currentEvent(bytes32 region) view returns (bytes32 eventId, uint8 hkoLevel)",
  "function stormEvent(bytes32 region) view returns (bytes32)",
  "function latest(bytes32 source, bytes32 region) view returns (uint8 level, bytes32 eventId, uint64 sourceTime, uint64 issuedAt)",
  "function relayers(bytes32 source) view returns (address)",
  "function lastNonce(address relayer) view returns (uint64)",
  "event Attested(bytes32 indexed source, bytes32 indexed region, uint8 level, bytes32 eventId, uint64 sourceTime, uint64 issuedAt)",
  "event StormStarted(bytes32 indexed region, bytes32 indexed eventId)",
  "event StormEnded(bytes32 indexed region, bytes32 indexed eventId)",
  "error UnknownRelayer()",
  "error BadNonce()",
  "error StaleAttestation()",
  "error FutureAttestation()",
  "error UnexpectedEventId()",
  "error BadLevel()",
  "error MissingEventId()",
  "error WrongRegion()",
  "error RelayerInUse()",
]);

export const vaultAbi = parseAbi([
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function maxWithdraw(address owner) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
]);

export const creditLineAbi = parseAbi([
  "function draw(uint256 amount)",
  "function limit() view returns (uint256)",
  "function drawn() view returns (uint256)",
  "function borrower() view returns (address)",
  "event Drawn(uint256 amount, uint256 drawnTotal)",
  "event Repaid(uint256 amount, uint256 drawnTotal)",
]);

export const paymentRouterAbi = parseAbi([
  "function pay(bytes32 invoiceRef, uint256 amount)",
  "function sweepBps() view returns (uint16)",
  "event Inflow(bytes32 indexed invoiceRef, uint256 amount, uint256 swept)",
]);

export const coverAbi = parseAbi([
  "function claim()",
  "function payout() view returns (uint256)",
  "function claimed(bytes32 eventId) view returns (bool)",
  "event Claimed(bytes32 indexed eventId, uint256 payout)",
]);

export const evidenceRegistryAbi = parseAbi([
  "function anchor(bytes32 hash, bytes32 kind)",
  "event Anchored(bytes32 indexed kind, bytes32 hash, address indexed sender)",
]);
