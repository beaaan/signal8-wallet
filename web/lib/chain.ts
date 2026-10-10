// Chain reads through viem. Read-only: the website never signs or sends transactions. Server only.
import { createPublicClient, http, keccak256, toBytes, type PublicClient } from "viem";
import { attestorAbi, coverAbi, creditLineAbi, erc20Abi, feedEvents, planModuleAbi, vaultAbi } from "./abis";
import { config, hostOf } from "./config";
import type { Deployment } from "./deployments";

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
export const ZERO32 = `0x${"0".repeat(64)}`;

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
  /** GDACS event id the attestor tracks (stays set after the storm ends); null when none. */
  eventId: string | null;
  hko: SourceLevel | null;
  gdacs: SourceLevel | null;
  paused: boolean | null;
  dailyCeiling: string | null;
  spentAllToday: string | null;
  plans: (PlanState | null)[];
  activePlanId: number | null;
  coverPayout: string | null;
  /** Cover already paid for the current (or last) event. */
  coverClaimed: boolean | null;
  /** Credit drawn under the storm plan for the current (or last) event. */
  drawnInEvent: string | null;
  readErrors: string[];
}

async function reachable(): Promise<{ chainId: number; blockNumber: bigint }> {
  const c = getClient();
  try {
    const [chainId, blockNumber] = await Promise.all([c.getChainId(), c.getBlockNumber({ cacheTime: 0 })]);
    return { chainId, blockNumber };
  } catch (e) {
    throw new ChainUnreachable(`RPC at ${hostOf(config.rpcUrl)} is not answering (${shortError(e)}).`);
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

  const [decimals, safeBalance, vaultShares, creditDrawn, creditLimit, isStorm, currentEvent, hko, gdacs, paused, ceiling, spentAll, payout] =
    await Promise.all([
      r("MockUSD.decimals", c.readContract({ address: k.MockUSD, abi: erc20Abi, functionName: "decimals" })),
      r("MockUSD.balanceOf(Safe)", c.readContract({ address: k.MockUSD, abi: erc20Abi, functionName: "balanceOf", args: [k.Safe] })),
      r("MockMMFVault.balanceOf(Safe)", c.readContract({ address: k.MockMMFVault, abi: vaultAbi, functionName: "balanceOf", args: [k.Safe] })),
      r("FlowCreditLine.drawn", c.readContract({ address: k.FlowCreditLine, abi: creditLineAbi, functionName: "drawn" })),
      r("FlowCreditLine.limit", c.readContract({ address: k.FlowCreditLine, abi: creditLineAbi, functionName: "limit" })),
      r("SignalAttestor.isStorm", c.readContract({ address: k.SignalAttestor, abi: attestorAbi, functionName: "isStorm", args: [region] })),
      r("SignalAttestor.currentEvent", c.readContract({ address: k.SignalAttestor, abi: attestorAbi, functionName: "currentEvent", args: [region] })),
      r("SignalAttestor.latest(HKO)", c.readContract({ address: k.SignalAttestor, abi: attestorAbi, functionName: "latest", args: [d.region === "HK" ? SOURCES.HKO : SOURCES.NCHMF, region] })),
      r("SignalAttestor.latest(GDACS)", c.readContract({ address: k.SignalAttestor, abi: attestorAbi, functionName: "latest", args: [SOURCES.GDACS, region] })),
      r("PlanModule.paused", c.readContract({ address: k.PlanModule, abi: planModuleAbi, functionName: "paused" })),
      r("PlanModule.dailyCeiling", c.readContract({ address: k.PlanModule, abi: planModuleAbi, functionName: "dailyCeiling" })),
      r("PlanModule.spentAllToday", c.readContract({ address: k.PlanModule, abi: planModuleAbi, functionName: "spentAllToday" })),
      r("MockSignalCover.payout", c.readContract({ address: k.MockSignalCover, abi: coverAbi, functionName: "payout" })),
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

  const eventId = currentEvent && currentEvent[0] !== ZERO32 ? currentEvent[0] : null;
  const [vaultAssets, coverClaimed, drawnInEvent] = await Promise.all([
    vaultShares === null
      ? null
      : r("MockMMFVault.convertToAssets", c.readContract({ address: k.MockMMFVault, abi: vaultAbi, functionName: "convertToAssets", args: [vaultShares] })),
    eventId ? r("MockSignalCover.claimed", c.readContract({ address: k.MockSignalCover, abi: coverAbi, functionName: "claimed", args: [eventId] })) : null,
    eventId ? r("PlanModule.drawnInEvent", c.readContract({ address: k.PlanModule, abi: planModuleAbi, functionName: "drawnInEvent", args: [eventId] })) : null,
  ]);

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
    eventId,
    hko: level(hko),
    gdacs: level(gdacs),
    paused,
    dailyCeiling: s(ceiling),
    spentAllToday: s(spentAll),
    plans,
    activePlanId: isStorm === null ? null : isStorm ? 1 : 0,
    coverPayout: s(payout),
    coverClaimed: eventId ? coverClaimed : false,
    drawnInEvent: eventId ? s(drawnInEvent) : "0",
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

// ---------------------------------------------------------------- event logs

/** One decoded event the activity timeline and the storm strip are built from. */
export interface ChainLog {
  eventName: string;
  args: Record<string, unknown>;
  block: number;
  logIndex: number;
  tx: `0x${string}`;
  /** Block time, unix seconds; null when not fetched. */
  time: number | null;
}

interface RawLog {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: `0x${string}`;
  removed: boolean;
}

interface LogCache {
  key: string;
  scannedTo: number; // block numbers fit in a JS number; plain numbers also keep Next's file tracer happy
  logs: RawLog[];
}

// Module-level cache: logs are scanned once from startBlock, then only new blocks on each poll.
let cache: LogCache | null = null;
let scanning: Promise<void> | null = null;
const blockTimes = new Map<number, number>();
const CHUNK = 5_000; // blocks per eth_getLogs call (public RPCs cap the range)
const MAX_CHUNKS_PER_POLL = 20; // keep one request fast; the rest is picked up on the next poll

// The deployment's start block. Its hash tells a restarted anvil (same addresses, same block numbers) from the
// old one; its time is when this run began, so older agent log lines can be dropped. Re-read every few seconds.
let start: { key: string; hash: string; time: number; at: number } | null = null;
const START_TTL_MS = 3_000;

/** Hash and time (unix seconds) of the deployment's start block. Throws when the RPC is down. */
export async function readStart(d: Deployment): Promise<{ hash: string; time: number }> {
  const key = `${d.chainId}:${d.startBlock}:${d.contracts.PlanModule.toLowerCase()}`;
  if (start && start.key === key && Date.now() - start.at < START_TTL_MS) return start;
  const blk = await getClient().getBlock({ blockNumber: BigInt(d.startBlock) });
  start = { key, hash: blk.hash ?? "", time: Number(blk.timestamp), at: Date.now() };
  return start;
}

async function scan(d: Deployment): Promise<void> {
  const c = getClient();
  const [latest, s] = await Promise.all([c.getBlockNumber({ cacheTime: 0 }).then(Number), readStart(d)]);
  const key = `${d.chainId}:${d.startBlock}:${d.contracts.PlanModule.toLowerCase()}:${s.hash}`;
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
    })) as unknown as RawLog[];
    cache.logs.push(...logs.filter((l) => !l.removed));
    cache.scannedTo = toBlock;
  }
}

const TIMED_RECENT = 200; // block times are fetched for the newest logs and for every signal / storm log

/** Every feed event since startBlock, oldest first. Throws ChainUnreachable when the RPC is down. */
export async function readLogs(d: Deployment): Promise<ChainLog[]> {
  await reachable();
  if (!scanning) scanning = scan(d).finally(() => (scanning = null));
  await scanning;
  const logs = [...(cache?.logs ?? [])].sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );

  const want = new Set<number>();
  logs.slice(-TIMED_RECENT).forEach((l) => want.add(Number(l.blockNumber)));
  logs
    .filter((l) => l.eventName === "Attested" || l.eventName === "StormStarted" || l.eventName === "StormEnded")
    .forEach((l) => want.add(Number(l.blockNumber)));
  const c = getClient();
  await Promise.all(
    [...want]
      .filter((b) => !blockTimes.has(b))
      .map((b) =>
        c
          .getBlock({ blockNumber: BigInt(b) })
          .then((blk) => blockTimes.set(b, Number(blk.timestamp)))
          .catch(() => undefined),
      ),
  );

  return logs.map((l) => {
    const block = Number(l.blockNumber);
    return {
      eventName: l.eventName,
      args: l.args ?? {},
      block,
      logIndex: l.logIndex,
      tx: l.transactionHash,
      time: blockTimes.get(block) ?? null,
    };
  });
}
