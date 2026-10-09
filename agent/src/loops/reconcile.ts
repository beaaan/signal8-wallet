// End-of-day reconciliation: the agent's ledger (executed actions + inflows) against the chain (Safe balance,
// vault, PlanModule.spentToday). On a mismatch the agent pauses PlanModule with its own key, logs and alerts.
// Spec: docs/specs/agent.md#everyday-loopseverydayts (step 4). The backend never holds the guardian key.

import { erc20Abi, planModuleAbi, vaultAbi } from "../abis.ts";
import type { Chainish } from "../chain.ts";
import { fmt } from "../exec/calls.ts";
import { reconcile, type ChainView, type Ledger, type Reconciliation } from "../ledger.ts";
import { JsonlFile, type DecisionLog } from "../log.ts";
import type { Hex } from "../policy/localCheck.ts";

/** Reads what reconciliation compares. Tests use a fake. */
export interface ChainReader {
  view(): Promise<ChainView>;
}

export function chainReader(c: Chainish): ChainReader {
  const { Safe, MockUSD, MockMMFVault, PlanModule } = c.dep.contracts;
  const pm = { address: PlanModule, abi: planModuleAbi } as const;
  return {
    async view() {
      const [day, safe, vault, s0, s1] = await Promise.all([
        c.pub.readContract({ ...pm, functionName: "today" }),
        c.pub.readContract({ address: MockUSD, abi: erc20Abi, functionName: "balanceOf", args: [Safe] }),
        c.pub.readContract({ address: MockMMFVault, abi: vaultAbi, functionName: "maxWithdraw", args: [Safe] }),
        c.pub.readContract({ ...pm, functionName: "spentToday", args: [0] }),
        c.pub.readContract({ ...pm, functionName: "spentToday", args: [1] }),
      ]);
      return { day, safe, vault, spent: { 0: s0, 1: s1 } };
    },
  };
}

export interface Alert {
  ts: string;
  kind: "LedgerMismatch";
  day: string;
  diffs: string[];
  pauseTx?: Hex;
  error?: string;
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
}

export type DayClose = Reconciliation & { after: ChainView; pauseTx?: Hex };

/** Compares the day's ledger with the chain. On a mismatch: pause, log, alert (alerts.jsonl and stderr). */
export async function closeDay(day: string, ledger: Ledger, before: ChainView, d: CloseDayDeps): Promise<DayClose> {
  const after = await d.reader.view();
  const r = reconcile(ledger, before, after);
  const input = `reconcile:${day}`;
  if (r.ok) {
    d.log.write({
      input,
      stage: "chain",
      outcome: "executed",
      action: "reconcile",
      summary: `End of day ${day}: ledger matches the chain (${ledger.entries.length} entries; Safe ${fmt(r.expected.safe)}, vault ${fmt(r.expected.vault)}, base spent ${fmt(r.expected.spent[0] ?? 0n)})`,
    });
    await d.beforePause?.({ ...r, after });
    return { ...r, after };
  }
  d.log.write({ input, stage: "localCheck", outcome: "refused", action: "reconcile", reason: "LedgerMismatch", summary: `End of day ${day}: ${r.diffs.join("; ")}` });
  await d.beforePause?.({ ...r, after });
  const alert: Alert = { ts: new Date().toISOString(), kind: "LedgerMismatch", day, diffs: r.diffs };
  let pauseTx: Hex | undefined;
  try {
    pauseTx = await d.pauser.pause();
    alert.pauseTx = pauseTx;
    d.log.write({ input, stage: "chain", outcome: "executed", action: "pause", tx: pauseTx, summary: "Ledger and chain disagree: the agent paused PlanModule with its own key. Two owners must check and unpause." });
    d.onTx?.("Agent paused PlanModule (ledger mismatch)", pauseTx);
  } catch (err) {
    alert.error = err instanceof Error ? err.message.slice(0, 200) : String(err);
    d.log.write({ input, stage: "chain", outcome: "refused", action: "pause", reason: alert.error, summary: "Ledger mismatch, and the agent could not pause PlanModule; owners: pause from Safe Wallet or with the guardian key" });
  }
  d.alerts?.append(alert);
  console.error(`ALERT ${day}: ledger mismatch (${r.diffs.join("; ")})${pauseTx ? `; PlanModule paused ${pauseTx}` : "; pause FAILED"}`);
  return { ...r, after, pauseTx };
}
