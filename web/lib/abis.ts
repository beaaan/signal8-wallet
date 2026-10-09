// Read-only ABI fragments the website uses. Must match contracts/src (see the shared interface list).
import { parseAbi } from "viem";

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

export const planModuleAbi = parseAbi([
  "function plans(uint8 planId) view returns (uint256 perTxCap, uint256 dailyCap, uint256 creditCapPerEvent, uint8 actions, bool active, bytes32 planHash)",
  "function dailyCeiling() view returns (uint256)",
  "function spentToday(uint8 planId) view returns (uint256)",
  "function spentAllToday() view returns (uint256)",
  "function paused() view returns (bool)",
  "function drawnInEvent(bytes32 eventId) view returns (uint256)",
  "event Executed(uint8 indexed planId, uint8 indexed action, address target, uint256 amount, bytes32 indexed ref)",
  "event PausedSet(bool paused, address by)",
]);

export const attestorAbi = parseAbi([
  "function isStorm(bytes32 region) view returns (bool)",
  "function currentEvent(bytes32 region) view returns (bytes32 eventId, uint8 hkoLevel)",
  "function latest(bytes32 source, bytes32 region) view returns (uint8 level, bytes32 eventId, uint64 sourceTime, uint64 issuedAt)",
  "event Attested(bytes32 indexed source, bytes32 indexed region, uint8 level, bytes32 eventId, uint64 sourceTime, uint64 issuedAt)",
  "event StormStarted(bytes32 indexed region, bytes32 indexed eventId)",
  "event StormEnded(bytes32 indexed region, bytes32 indexed eventId)",
]);

export const vaultAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
]);

export const creditLineAbi = parseAbi([
  "function limit() view returns (uint256)",
  "function drawn() view returns (uint256)",
  "event Drawn(uint256 amount, uint256 drawnTotal)",
  "event Repaid(uint256 amount, uint256 drawnTotal)",
]);

export const routerAbi = parseAbi(["event Inflow(bytes32 indexed invoiceRef, uint256 amount, uint256 swept)"]);

export const coverAbi = parseAbi([
  "function payout() view returns (uint256)",
  "function claimed(bytes32 eventId) view returns (bool)",
  "event Claimed(bytes32 indexed eventId, uint256 payout)",
]);

export const evidenceAbi = parseAbi(["event Anchored(bytes32 indexed kind, bytes32 hash, address indexed sender)"]);

/** Every event the transaction feed shows. */
export const feedEvents = [
  ...planModuleAbi.filter((x) => x.type === "event"),
  ...attestorAbi.filter((x) => x.type === "event"),
  ...creditLineAbi.filter((x) => x.type === "event"),
  ...routerAbi,
  ...coverAbi.filter((x) => x.type === "event"),
  ...evidenceAbi,
] as const;
