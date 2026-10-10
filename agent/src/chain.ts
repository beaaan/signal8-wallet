// viem clients and typed reads of the deployed contracts.
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  toBytes,
  type Account,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { coverAbi, creditLineAbi, erc20Abi, planModuleAbi, signalAttestorAbi, vaultAbi } from "./abis.ts";
import { secretKey, type Config, type Deployment, type KeyRole } from "./config.ts";
import { consistentTransport } from "./rpc.ts";
import type { Hex, PlanState, Snapshot } from "./policy/localCheck.ts";

export type Wallet = WalletClient<Transport, Chain, Account>;

export interface Chainish {
  cfg: Config;
  dep: Deployment;
  chain: Chain;
  pub: PublicClient;
  /** keccak256("HK") etc. */
  region: Hex;
  /** Shared by the public and wallet clients, so reads see this process's own writes (see rpc.ts). */
  transport?: Transport;
}

export function regionId(region: string): Hex {
  return keccak256(toBytes(region));
}

export function connect(cfg: Config, dep: Deployment): Chainish {
  const chain = defineChain({
    id: dep.chainId,
    name: dep.network,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
  const transport = cfg.local ? http(cfg.rpcUrl) : consistentTransport(cfg.rpcUrl);
  const pub = createPublicClient({ chain, transport }) as PublicClient;
  return { cfg, dep, chain, pub, region: regionId(dep.region), transport };
}

/** A wallet client for one role. The key stays inside the viem account object. */
export function walletFor(c: Chainish, role: KeyRole): Wallet {
  const account = privateKeyToAccount(secretKey(role, c.cfg.network));
  return createWalletClient({ account, chain: c.chain, transport: c.transport ?? http(c.cfg.rpcUrl) });
}

export function addressOf(c: Chainish, role: KeyRole): Hex {
  return privateKeyToAccount(secretKey(role, c.cfg.network)).address;
}

/** The custom error name from a viem revert (e.g. "OverPerTxCap"), or a short message. */
export function revertReason(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.data?.errorName ?? reverted.reason ?? reverted.shortMessage;
    }
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}

export async function readPlan(c: Chainish, planId: number): Promise<PlanState> {
  const [perTxCap, dailyCap, creditCapPerEvent, actions, active, planHash] = await c.pub.readContract({
    address: c.dep.contracts.PlanModule,
    abi: planModuleAbi,
    functionName: "plans",
    args: [planId],
  });
  return { perTxCap, dailyCap, creditCapPerEvent, actions, active, planHash };
}

export async function isStorm(c: Chainish): Promise<boolean> {
  return c.pub.readContract({ address: c.dep.contracts.SignalAttestor, abi: signalAttestorAbi, functionName: "isStorm", args: [c.region] });
}

export async function currentEventId(c: Chainish): Promise<Hex> {
  const [eventId] = await c.pub.readContract({
    address: c.dep.contracts.SignalAttestor,
    abi: signalAttestorAbi,
    functionName: "currentEvent",
    args: [c.region],
  });
  return eventId;
}

/** Everything localCheck needs, for the given payees and refs. */
export async function readSnapshot(c: Chainish, want: { payees?: Hex[]; refs?: Hex[] } = {}): Promise<Snapshot> {
  const pm = { address: c.dep.contracts.PlanModule, abi: planModuleAbi } as const;
  const [paused, storm, base, stormPlan, dailyCeiling, spentBase, spentStorm, spentAllToday, eventId] = await Promise.all([
    c.pub.readContract({ ...pm, functionName: "paused" }),
    isStorm(c),
    readPlan(c, 0),
    readPlan(c, 1),
    c.pub.readContract({ ...pm, functionName: "dailyCeiling" }),
    c.pub.readContract({ ...pm, functionName: "spentToday", args: [0] }),
    c.pub.readContract({ ...pm, functionName: "spentToday", args: [1] }),
    c.pub.readContract({ ...pm, functionName: "spentAllToday" }),
    currentEventId(c),
  ]);
  const drawnInEvent = await c.pub.readContract({ ...pm, functionName: "drawnInEvent", args: [eventId] });
  const payeePlans: Record<string, number> = {};
  const refUsed: Record<string, boolean> = {};
  await Promise.all([
    ...(want.payees ?? []).map(async (p) => {
      payeePlans[p.toLowerCase()] = await c.pub.readContract({ ...pm, functionName: "payeePlans", args: [p] });
    }),
    ...(want.refs ?? []).map(async (r) => {
      refUsed[r.toLowerCase()] = await c.pub.readContract({ ...pm, functionName: "refUsed", args: [r] });
    }),
  ]);
  return {
    paused,
    isStorm: storm,
    plans: { 0: base, 1: stormPlan },
    dailyCeiling,
    spentToday: { 0: spentBase, 1: spentStorm },
    spentAllToday,
    eventId,
    drawnInEvent,
    payeePlans,
    refUsed,
  };
}

/** Balances the loops size their actions with (token units, 6 decimals). */
export async function readBalances(c: Chainish): Promise<{ safe: bigint; vault: bigint; creditDrawn: bigint; creditLimit: bigint; coverPayout: bigint }> {
  const { Safe, MockUSD, MockMMFVault, FlowCreditLine, MockSignalCover } = c.dep.contracts;
  const [safe, vault, creditDrawn, creditLimit, coverPayout] = await Promise.all([
    c.pub.readContract({ address: MockUSD, abi: erc20Abi, functionName: "balanceOf", args: [Safe] }),
    c.pub.readContract({ address: MockMMFVault, abi: vaultAbi, functionName: "maxWithdraw", args: [Safe] }),
    c.pub.readContract({ address: FlowCreditLine, abi: creditLineAbi, functionName: "drawn" }),
    c.pub.readContract({ address: FlowCreditLine, abi: creditLineAbi, functionName: "limit" }),
    c.pub.readContract({ address: MockSignalCover, abi: coverAbi, functionName: "payout" }),
  ]);
  return { safe, vault, creditDrawn, creditLimit, coverPayout };
}
