// End-of-period reconciliation: the agent's ledger (executed actions + inflows) against the chain (Safe balance,
// vault, PlanModule.spentToday, the lender's outstanding principal and the Safe's token Transfer logs). On a mismatch
// the agent pauses PlanModule with its own key, logs and alerts.
// Spec: docs/specs/agent.md#everyday-loopseverydayts (step 4). The backend never holds the guardian key.

import { creditLineAbi, erc20Abi, planModuleAbi, vaultAbi } from "../abis.ts";
import type { Chainish } from "../chain.ts";
import { fmt } from "../exec/calls.ts";
import { reconcile, type ChainView, type Coverage, type Ledger, type Reconciliation, type SafeTransfer } from "../ledger.ts";
import { JsonlFile, type DecisionLog } from "../log.ts";
import type { Hex } from "../policy/localCheck.ts";
import { LOG_RANGE } from "./inflows.ts";

/** Reads what reconciliation compares. Tests use a fake. */
export interface ChainReader {
  /** With the opening view's block, also the Safe's Transfer logs after it, up to the block this view is read at. */
  view(fromBlock?: bigint): Promise<ChainView>;
}

const same = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();

/** Token Transfer logs from or to the Safe in [fromBlock, toBlock], de-duplicated by tx hash + log index. */
export async function safeTransfers(c: Chainish, fromBlock: bigint, toBlock: bigint): Promise<SafeTransfer[]> {
  const { Safe, MockUSD } = c.dep.contracts;
  const out = new Map<string, SafeTransfer>();
  // public Base Sepolia RPCs cap eth_getLogs at 200 blocks
  for (let from = fromBlock; from <= toBlock; from += LOG_RANGE) {
    const to = from + LOG_RANGE - 1n < toBlock ? from + LOG_RANGE - 1n : toBlock;
    const range = { address: MockUSD, abi: erc20Abi, eventName: "Transfer", fromBlock: from, toBlock: to } as const;
    const [sent, received] = await Promise.all([c.pub.getContractEvents({ ...range, args: { from: Safe } }), c.pub.getContractEvents({ ...range, args: { to: Safe } })]);
    for (const l of [...sent, ...received]) {
      const value = l.args.value ?? 0n;
      const safeDelta = (same(l.args.to, Safe) ? value : 0n) - (same(l.args.from, Safe) ? value : 0n);
      out.set(`${l.transactionHash}:${l.logIndex}`, { tx: l.transactionHash, logIndex: l.logIndex, block: l.blockNumber, safeDelta });
    }
  }
  return [...out.values()].sort((a, b) => (a.block! === b.block! ? a.logIndex! - b.logIndex! : a.block! < b.block! ? -1 : 1));
}

export function chainReader(c: Chainish): ChainReader {
  const { Safe, MockUSD, MockMMFVault, PlanModule, FlowCreditLine } = c.dep.contracts;
  const pm = { address: PlanModule, abi: planModuleAbi } as const;
  return {
    async view(fromBlock) {
      // One block for every field: parallel "latest" reads can straddle a new block and look like a mismatch.
      // Through rpc.ts the block is never older than this process's newest receipt, nor (here) than the opening view.
      const head = await c.pub.getBlockNumber({ cacheTime: 0 });
      const blockNumber = fromBlock !== undefined && head < fromBlock ? fromBlock : head;
      const at = { blockNumber } as const;
      const [day, safe, vault, s0, s1, creditDrawn] = await Promise.all([
        c.pub.readContract({ ...pm, functionName: "today", ...at }),
        c.pub.readContract({ address: MockUSD, abi: erc20Abi, functionName: "balanceOf", args: [Safe], ...at }),
        c.pub.readContract({ address: MockMMFVault, abi: vaultAbi, functionName: "maxWithdraw", args: [Safe], ...at }),
        c.pub.readContract({ ...pm, functionName: "spentToday", args: [0], ...at }),
        c.pub.readContract({ ...pm, functionName: "spentToday", args: [1], ...at }),
        FlowCreditLine ? c.pub.readContract({ address: FlowCreditLine, abi: creditLineAbi, functionName: "drawn", ...at }) : undefined,
      ]);
      const transfers = fromBlock === undefined ? undefined : await safeTransfers(c, fromBlock + 1n, blockNumber);
      return { block: blockNumber, day, safe, vault, spent: { 0: s0, 1: s1 }, creditDrawn, transfers };
    },
  };
}

export interface Alert {
  ts: string;
  kind: "LedgerMismatch";
  day: string;
  period?: string;
  diffs: string[];
  /** The closing block the mismatch was found at. */
  block?: string;
  pauseTx?: Hex;
  /** The pause failed (with `guidance` for the owners). */
  error?: string;
  guidance?: string;
  /** The report could not be read, written or anchored; the mismatch is verified all the same. */
  reportError?: string;
}

export interface CloseDayDeps {
  reader: ChainReader;
  log: DecisionLog;
  /** The agent's own pause (Executor.pause). */
  pauser: { pause(): Promise<Hex> };
  alerts?: JsonlFile<Alert>;
  onTx?: (label: string, tx: Hex) => void;
  /** Runs after the comparison and before any pause (e.g. anchoring the day's report, which a pause would block). */
  beforePause?: (r: Reconciliation & { after: ChainView }) => Promise<void>;
  /** A period other than the business day (the replay's "storm" period); names it in the log and the alert. */
  period?: string;
}

/** `after` is the compared closing snapshot; reports serialise it rather than reading the chain again. */
export type DayClose = Reconciliation & { after: ChainView; pauseTx?: Hex; pauseError?: string; reportError?: string };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);
const signed = (x: bigint) => (x > 0n ? `+${fmt(x)}` : fmt(x));

/** Closing balances, not changes. */
export function closingText(v: ChainView): string {
  const credit = v.creditDrawn !== undefined ? `, credit drawn ${fmt(v.creditDrawn)}` : "";
  return `Closing Safe ${fmt(v.safe)}, vault ${fmt(v.vault)}${credit}${v.block !== undefined ? ` (block ${v.block})` : ""}`;
}

/** Changes over the period, as observed on chain (equal to the ledger's when the check passed). */
export function changeText(r: Reconciliation): string {
  const o = r.observed;
  const debt = o.debt !== undefined ? `, credit ${signed(o.debt)}` : "";
  return `change Safe ${signed(o.safe)}, vault ${signed(o.vault)}${debt}, base spent ${fmt(r.expected.spent[0] ?? 0n)}`;
}

export function coverageText(c: Coverage): string {
  if (c.status === "limited") return "transfer coverage limited (logs not read)";
  return c.status === "complete" ? `all ${c.transfers} Safe transfers recorded` : "transfer coverage has gaps";
}

/** Compares the period's ledger with the chain. On a mismatch: pause, log, alert (alerts.jsonl and stderr). */
export async function closeDay(day: string, ledger: Ledger, before: ChainView, d: CloseDayDeps): Promise<DayClose> {
  // A read error propagates from here: nothing was compared, so nothing is verified, paused or reported as a mismatch.
  const after = await d.reader.view(before.block);
  const r = reconcile(ledger, before, after);
  const input = d.period ? `reconcile:${d.period}:${day}` : `reconcile:${day}`;
  const what = d.period ? `End of ${d.period} period ${day}` : `End of day ${day}`;
  if (r.ok) {
    d.log.write({
      input,
      stage: "chain",
      outcome: "executed",
      action: "reconcile",
      summary: `${what}: ledger matches the chain (${ledger.entries.length} entries). ${closingText(after)}; ${changeText(r)}; ${coverageText(r.coverage)}`,
    });
    const reportError = await report(d, r, after, input);
    return { ...r, after, reportError };
  }
  d.log.write({ input, stage: "localCheck", outcome: "refused", action: "reconcile", reason: "LedgerMismatch", summary: `${what}: ${r.diffs.join("; ")}. ${closingText(after)}` });
  // The mismatch is verified. Containment (pause, alert) must not depend on the report's read, write or anchor.
  const reportError = await report(d, r, after, input);
  const alert: Alert = { ts: new Date().toISOString(), kind: "LedgerMismatch", day, period: d.period, diffs: r.diffs, block: after.block?.toString(), reportError };
  let pauseTx: Hex | undefined;
  try {
    pauseTx = await d.pauser.pause();
    alert.pauseTx = pauseTx;
    d.log.write({ input, stage: "chain", outcome: "executed", action: "pause", tx: pauseTx, summary: "Ledger and chain disagree: the agent paused PlanModule with its own key. Two owners must check and unpause." });
    d.onTx?.("Agent paused PlanModule (ledger mismatch)", pauseTx);
  } catch (err) {
    alert.error = message(err);
    alert.guidance = "Pause PlanModule now from Safe Wallet (two owners) or with the guardian key, then check the diffs";
    d.log.write({ input, stage: "chain", outcome: "refused", action: "pause", reason: alert.error, summary: "Ledger mismatch, and the agent could not pause PlanModule; owners: pause from Safe Wallet or with the guardian key" });
  }
  try {
    d.alerts?.append(alert);
  } catch (err) {
    console.error(`could not write the alert file: ${message(err)}`);
  }
  const outcome = pauseTx ? `; PlanModule paused ${pauseTx}` : "; pause FAILED, owners: pause from Safe Wallet or with the guardian key";
  console.error(`ALERT ${what}: ledger mismatch (${r.diffs.join("; ")})${outcome}${reportError ? `; report failed: ${reportError}` : ""}`);
  return { ...r, after, pauseTx, pauseError: alert.error, reportError };
}

/** Runs the report callback; its failure is logged and returned, never thrown past the comparison. */
async function report(d: CloseDayDeps, r: Reconciliation, after: ChainView, input: string): Promise<string | undefined> {
  if (!d.beforePause) return undefined;
  try {
    await d.beforePause({ ...r, after });
    return undefined;
  } catch (err) {
    const reason = message(err);
    d.log.write({ input, stage: "chain", outcome: "refused", action: "report", reason, summary: "The period report could not be read, written or anchored; the reconciliation result stands" });
    return reason;
  }
}
