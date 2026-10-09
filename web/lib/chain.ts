// Chain reads through viem. Read-only: the website never signs or sends transactions. Server only.
import {
  createPublicClient,
  hexToString,
  http,
  keccak256,
  toBytes,
  type PublicClient,
} from "viem";
import { attestorAbi, creditLineAbi, erc20Abi, feedEvents, planModuleAbi, vaultAbi } from "./abis";
import { config } from "./config";
import type { Deployment } from "./deployments";
import { fmtUnits, gdacsLabel, hkoLabel, shortAddr, shortHash } from "./format";

let client: PublicClient | null = null;
export function getClient(): PublicClient {
  if (!client) {
    client = createPublicClient({ transport: http(config.rpcUrl, { timeout: config.timeoutMs, retryCount: 0 }) });
  }
  return client;
}

export const regionId = (region: string) => keccak256(toBytes(region));
export const SOURCES = {
  HKO: keccak256(toBytes("HKO")),
  GDACS: keccak256(toBytes("GDACS")),
  NCHMF: keccak256(toBytes("NCHMF")),
} as const;
const ZERO32 = `0x${"0".repeat(64)}`;

/** Thrown when the RPC does not answer; pages show "not connected". */
export class ChainUnreachable extends Error {}

export interface PlanState {
  id: number;
  name: "base" | "storm";
  perTxCap: string;
  dailyCap: string;
  creditCapPerEvent: string;
  actions: number;
  active: boolean;
  planHash: string;
  spentToday: string | null;
}

export interface SourceLevel {
  level: number;
  eventId: string;
  sourceTime: number;
  issuedAt: number;
}

/** All amounts are raw token units as decimal strings (JSON-safe). null = that read failed. */
export interface ChainSnapshot {
  chainId: number;
  blockNumber: string;
  decimals: number;
  safeBalance: string | null;
  vaultShares: string | null;
  vaultAssets: string | null;
  creditDrawn: string | null;
  creditLimit: string | null;
  isStorm: boolean | null;
  currentEvent: { eventId: string; hkoLevel: number } | null;
  hko: SourceLevel | null;
  gdacs: SourceLevel | null;
  paused: boolean | null;
  dailyCeiling: string | null;
  spentAllToday: string | null;
  plans: (PlanState | null)[];
  activePlanId: number | null;
  readErrors: string[];
}

async function reachable(): Promise<{ chainId: number; blockNumber: bigint }> {
  const c = getClient();
  try {
    const [chainId, blockNumber] = await Promise.all([c.getChainId(), c.getBlockNumber({ cacheTime: 0 })]);
    return { chainId, blockNumber };
  } catch (e) {
    throw new ChainUnreachable(`RPC ${config.rpcUrl} is not answering (${shortError(e)}).`);
  }
}

function shortError(e: unknown): string {
  const m = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? String(e);
  return m.split("\n")[0].slice(0, 160);
}

export async function readSnapshot(d: Deployment): Promise<ChainSnapshot> {
  const { chainId, blockNumber } = await reachable();
  const c = getClient();
  const k = d.contracts;
  const region = regionId(d.region);
  const errors: string[] = [];
  // Each read fails on its own (e.g. a contract that does not match the ABI) without taking the page down.
  const r = <T,>(label: string, p: Promise<T>): Promise<T | null> =>
    p.catch((e) => {
      errors.push(`${label}: ${shortError(e)}`);
      return null;
    });

  const [decimals, safeBalance, vaultShares, creditDrawn, creditLimit, isStorm, currentEvent, hko, gdacs, paused, ceiling, spentAll] =
    await Promise.all([
      r("MockUSD.decimals", c.readContract({ address: k.MockUSD, abi: erc20Abi, functionName: "decimals" })),
      r("MockUSD.balanceOf(Safe)", c.readContract({ address: k.MockUSD, abi: erc20Abi, functionName: "balanceOf", args: [k.Safe] })),
      r("MockMMFVault.balanceOf(Safe)", c.readContract({ address: k.MockMMFVault, abi: vaultAbi, functionName: "balanceOf", args: [k.Safe] })),
      r("FlowCreditLine.drawn", c.readContract({ address: k.FlowCreditLine, abi: creditLineAbi, functionName: "drawn" })),
      r("FlowCreditLine.limit", c.readContract({ address: k.FlowCreditLine, abi: creditLineAbi, functionName: "limit" })),
      r("SignalAttestor.isStorm", c.readContract({ address: k.SignalAttestor, abi: attestorAbi, functionName: "isStorm", args: [region] })),
      r("SignalAttestor.currentEvent", c.readContract({ address: k.SignalAttestor, abi: attestorAbi, functionName: "currentEvent", args: [region] })),
      r("SignalAttestor.latest(HKO)", c.readContract({ address: k.SignalAttestor, abi: attestorAbi, functionName: "latest", args: [SOURCES.HKO, region] })),
      r("SignalAttestor.latest(GDACS)", c.readContract({ address: k.SignalAttestor, abi: attestorAbi, functionName: "latest", args: [SOURCES.GDACS, region] })),
      r("PlanModule.paused", c.readContract({ address: k.PlanModule, abi: planModuleAbi, functionName: "paused" })),
      r("PlanModule.dailyCeiling", c.readContract({ address: k.PlanModule, abi: planModuleAbi, functionName: "dailyCeiling" })),
      r("PlanModule.spentAllToday", c.readContract({ address: k.PlanModule, abi: planModuleAbi, functionName: "spentAllToday" })),
    ]);

  const plans = await Promise.all(
    ([0, 1] as const).map(async (id) => {
      const [p, spent] = await Promise.all([
        r(`PlanModule.plans(${id})`, c.readContract({ address: k.PlanModule, abi: planModuleAbi, functionName: "plans", args: [id] })),
        r(`PlanModule.spentToday(${id})`, c.readContract({ address: k.PlanModule, abi: planModuleAbi, functionName: "spentToday", args: [id] })),
      ]);
      if (!p) return null;
      const [perTxCap, dailyCap, creditCapPerEvent, actions, active, planHash] = p;
      return {
        id,
        name: id === 0 ? "base" : "storm",
        perTxCap: perTxCap.toString(),
        dailyCap: dailyCap.toString(),
        creditCapPerEvent: creditCapPerEvent.toString(),
        actions,
        active,
        planHash,
        spentToday: spent === null ? null : spent.toString(),
      } satisfies PlanState;
    }),
  );

  const vaultAssets =
    vaultShares === null
      ? null
      : await r(
          "MockMMFVault.convertToAssets",
          c.readContract({ address: k.MockMMFVault, abi: vaultAbi, functionName: "convertToAssets", args: [vaultShares] }),
        );

  const level = (v: readonly [number, `0x${string}`, bigint, bigint] | null): SourceLevel | null =>
    v ? { level: v[0], eventId: v[1], sourceTime: Number(v[2]), issuedAt: Number(v[3]) } : null;
  const s = (v: bigint | null) => (v === null ? null : v.toString());

  return {
    chainId,
    blockNumber: blockNumber.toString(),
    decimals: decimals ?? 6,
    safeBalance: s(safeBalance),
    vaultShares: s(vaultShares),
    vaultAssets: s(vaultAssets),
    creditDrawn: s(creditDrawn),
    creditLimit: s(creditLimit),
    isStorm,
    currentEvent: currentEvent ? { eventId: currentEvent[0], hkoLevel: currentEvent[1] } : null,
    hko: level(hko),
    gdacs: level(gdacs),
    paused,
    dailyCeiling: s(ceiling),
    spentAllToday: s(spentAll),
    plans,
    activePlanId: isStorm === null ? null : isStorm ? 1 : 0,
    readErrors: errors,
  };
}

/** plans(0).planHash and plans(1).planHash. Throws ChainUnreachable when the RPC is down. */
export async function readPlanHashes(d: Deployment): Promise<{ base: string | null; storm: string | null }> {
  await reachable();
  const c = getClient();
  const one = (id: 0 | 1) =>
    c
      .readContract({ address: d.contracts.PlanModule, abi: planModuleAbi, functionName: "plans", args: [id] })
      .then((p) => p[5] as string)
      .catch(() => null);
  const [base, storm] = await Promise.all([one(0), one(1)]);
  return { base, storm };
}

// ---------------------------------------------------------------- transaction feed

export interface FeedItem {
  id: string;
  block: string;
  tx: string;
  ts: number | null; // unix seconds
  kind: string; // event name
  tone: "money" | "storm" | "info" | "alert";
  text: string;
}

/** The parts of a decoded log the feed uses. */
interface FeedLog {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: `0x${string}`;
  removed: boolean;
}

interface FeedCache {
  key: string;
  scannedTo: number; // block numbers fit in a JS number; plain numbers also keep Next's file tracer happy
  logs: FeedLog[];
}

// Module-level cache: the feed is scanned once from startBlock, then only new blocks on each poll.
let cache: FeedCache | null = null;
let scanning: Promise<void> | null = null;
const blockTimes = new Map<string, number>();
const CHUNK = 5_000; // blocks per eth_getLogs call (public RPCs cap the range)
const MAX_CHUNKS_PER_POLL = 20; // keep one request fast; the rest is picked up on the next poll

async function scan(d: Deployment): Promise<void> {
  const c = getClient();
  const key = `${d.chainId}:${d.startBlock}:${d.contracts.PlanModule.toLowerCase()}`;
  const latest = Number(await c.getBlockNumber({ cacheTime: 0 }));
  if (!cache || cache.key !== key || latest < cache.scannedTo) {
    // new deployment, or anvil was restarted / reset
    cache = { key, scannedTo: Math.max(0, d.startBlock) - 1, logs: [] };
    blockTimes.clear();
  }
  const addresses = [
    d.contracts.PlanModule,
    d.contracts.SignalAttestor,
    d.contracts.PaymentRouter,
    d.contracts.MockSignalCover,
    d.contracts.FlowCreditLine,
    d.contracts.EvidenceRegistry,
  ];
  for (let i = 0; i < MAX_CHUNKS_PER_POLL && cache.scannedTo < latest; i++) {
    const fromBlock = cache.scannedTo + 1;
    const toBlock = Math.min(fromBlock + CHUNK - 1, latest);
    const logs = (await c.getLogs({
      address: addresses,
      events: feedEvents,
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
      strict: false,
    })) as unknown as FeedLog[];
    cache.logs.push(...logs.filter((l) => !l.removed));
    cache.scannedTo = toBlock;
  }
}

/** Newest first, at most `limit` items. Throws ChainUnreachable when the RPC is down. */
export async function readFeed(
  d: Deployment,
  ctx: { decimals: number; symbol: string; payeeName: (a: string) => string | null },
  limit = 50,
): Promise<FeedItem[]> {
  await reachable();
  if (!scanning) scanning = scan(d).finally(() => (scanning = null));
  await scanning;
  const logs = [...(cache?.logs ?? [])]
    .sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1))
    .slice(0, limit);

  const c = getClient();
  const missing = [...new Set(logs.map((l) => l.blockNumber.toString()))].filter((b) => !blockTimes.has(b));
  await Promise.all(
    missing.map((b) =>
      c
        .getBlock({ blockNumber: BigInt(b) })
        .then((blk) => blockTimes.set(b, Number(blk.timestamp)))
        .catch(() => undefined),
    ),
  );

  return logs.map((l) => ({
    id: `${l.transactionHash}:${l.logIndex}`,
    block: l.blockNumber.toString(),
    tx: l.transactionHash,
    ts: blockTimes.get(l.blockNumber.toString()) ?? null,
    kind: l.eventName,
    ...describe(l, ctx),
  }));
}

const ACTIONS: Record<number, string> = { 1: "pay", 2: "vault_deposit", 4: "vault_withdraw", 8: "credit_draw", 16: "cover_claim" };

function bytes32Text(h: unknown): string {
  if (typeof h !== "string") return "–";
  try {
    const s = hexToString(h as `0x${string}`, { size: 32 });
    if (/^[\x20-\x7e]+$/.test(s)) return s;
  } catch {
    // not text
  }
  return shortHash(h);
}

function describe(
  l: FeedLog,
  ctx: { decimals: number; symbol: string; payeeName: (a: string) => string | null },
): { tone: FeedItem["tone"]; text: string } {
  const a = l.args ?? {};
  const amt = (v: unknown) => `${fmtUnits(typeof v === "bigint" ? v : 0n, ctx.decimals)} ${ctx.symbol}`;
  const who = (addr: unknown) => {
    const s = String(addr ?? "");
    const name = ctx.payeeName(s);
    return name ? `${name} (${shortAddr(s)})` : shortAddr(s);
  };
  switch (l.eventName) {
    case "Executed": {
      const plan = Number(a.planId) === 1 ? "Storm plan" : "Base plan";
      const action = ACTIONS[Number(a.action)] ?? `action ${a.action}`;
      const text =
        action === "pay"
          ? `Paid ${amt(a.amount)} to ${who(a.target)}`
          : action === "vault_deposit"
            ? `Moved ${amt(a.amount)} into the money-market fund`
            : action === "vault_withdraw"
              ? `Took ${amt(a.amount)} out of the money-market fund`
              : action === "credit_draw"
                ? `Drew ${amt(a.amount)} from the credit line`
                : action === "cover_claim"
                  ? `Claimed the typhoon cover (${amt(a.amount)})`
                  : `${action}: ${amt(a.amount)} to ${who(a.target)}`;
      return { tone: "money", text: `${plan}: ${text}` };
    }
    case "PausedSet":
      return { tone: "alert", text: a.paused ? `Agent paused by ${shortAddr(String(a.by))}` : `Agent resumed by ${shortAddr(String(a.by))}` };
    case "Attested": {
      const src = a.source === SOURCES.HKO ? "HKO" : a.source === SOURCES.GDACS ? "GDACS" : a.source === SOURCES.NCHMF ? "NCHMF" : "Unknown source";
      const level = Number(a.level);
      const label = src === "GDACS" ? gdacsLabel(level) : src === "HKO" ? hkoLabel(level) : `level ${level}`;
      const ev = a.eventId && a.eventId !== ZERO32 ? ` (event ${shortHash(String(a.eventId))})` : "";
      return { tone: "storm", text: `${src} reports ${label}${ev}` };
    }
    case "StormStarted":
      return { tone: "alert", text: `Storm mode ON (event ${shortHash(String(a.eventId))})` };
    case "StormEnded":
      return { tone: "storm", text: `Storm mode off (event ${shortHash(String(a.eventId))})` };
    case "Inflow":
      return {
        tone: "money",
        text:
          `Client paid ${amt(a.amount)} (invoice ${bytes32Text(a.invoiceRef)})` +
          (typeof a.swept === "bigint" && a.swept > BigInt(0) ? `; ${amt(a.swept)} went to repay the credit line` : ""),
      };
    case "Claimed":
      return { tone: "money", text: `Typhoon cover paid out ${amt(a.payout)}` };
    case "Drawn":
      return { tone: "money", text: `Credit line drawn: ${amt(a.amount)} (total drawn ${amt(a.drawnTotal)})` };
    case "Anchored":
      return { tone: "info", text: `Evidence anchored: ${bytes32Text(a.kind)} ${shortHash(String(a.hash))}` };
    default:
      return { tone: "info", text: l.eventName };
  }
}
