// The agent's own ledger for one business day, and end-of-day reconciliation against the chain.
// Spec: docs/specs/agent.md#everyday-loopseverydayts (step 4): on a mismatch the agent pauses PlanModule with its own key.

import type { Hex } from "./policy/localCheck.ts";

export interface LedgerEntry {
  kind: "pay" | "vault_deposit" | "vault_withdraw" | "credit_draw" | "cover_claim" | "inflow";
  amount: bigint;
  planId?: number; // payments only
  safeDelta: bigint; // effect on the Safe's token balance
  vaultDelta: bigint; // effect on the Safe's withdrawable vault assets
  tx?: Hex;
  note?: string;
}

export class Ledger {
  readonly entries: LedgerEntry[] = [];

  record(e: LedgerEntry): void {
    this.entries.push(e);
  }

  totals(): { safe: bigint; vault: bigint; spent: Record<number, bigint> } {
    const spent: Record<number, bigint> = { 0: 0n, 1: 0n };
    let safe = 0n;
    let vault = 0n;
    for (const e of this.entries) {
      safe += e.safeDelta;
      vault += e.vaultDelta;
      if (e.kind === "pay" && e.planId !== undefined) spent[e.planId] = (spent[e.planId] ?? 0n) + e.amount;
    }
    return { safe, vault, spent };
  }
}

/** What reconciliation reads from the chain at the start and the end of the day. */
export interface ChainView {
  day: bigint; // PlanModule.today()
  safe: bigint;
  vault: bigint;
  spent: Record<number, bigint>; // spentToday per plan
}

export interface Reconciliation {
  ok: boolean;
  diffs: string[];
  expected: { safe: bigint; vault: bigint; spent: Record<number, bigint> };
}

const fmt = (x: bigint) => (Number(x) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });

/**
 * Chain deltas must equal the ledger's. The vault is allowed `vaultTolerance` units of ERC-4626 rounding;
 * spentToday is skipped when the chain day rolled over in between (it resets at 00:00 UTC).
 */
export function reconcile(ledger: Ledger, before: ChainView, after: ChainView, vaultTolerance = 2n): Reconciliation {
  const t = ledger.totals();
  const diffs: string[] = [];
  const safeDelta = after.safe - before.safe;
  if (safeDelta !== t.safe) diffs.push(`Safe balance moved ${fmt(safeDelta)}, ledger says ${fmt(t.safe)}`);
  const vaultDelta = after.vault - before.vault;
  const vaultGap = vaultDelta > t.vault ? vaultDelta - t.vault : t.vault - vaultDelta;
  if (vaultGap > vaultTolerance) diffs.push(`vault moved ${fmt(vaultDelta)}, ledger says ${fmt(t.vault)}`);
  if (after.day === before.day) {
    for (const p of [0, 1]) {
      const d = (after.spent[p] ?? 0n) - (before.spent[p] ?? 0n);
      if (d !== (t.spent[p] ?? 0n)) diffs.push(`plan ${p} spentToday moved ${fmt(d)}, ledger says ${fmt(t.spent[p] ?? 0n)}`);
    }
  }
  return { ok: diffs.length === 0, diffs, expected: t };
}
