// The agent's own ledger for one period (a business day, or the replay's storm period), and its reconciliation
// against the chain. Spec: docs/specs/agent.md#everyday-loopseverydayts (step 4): on a mismatch the agent pauses
// PlanModule with its own key.
//
// Three checks, reported separately (docs/RECONCILIATION_REVIEW.md F02–F04):
// - balances: Safe cash, vault assets and PlanModule.spentToday moved as the ledger says;
// - debt: the lender's outstanding principal moved by recorded draws minus router repayments;
// - coverage: every token Transfer touching the Safe in the period is a recorded transaction, so two unrecorded
//   movements cannot cancel out in the balances. Without the logs coverage is "limited", not a failure.

import type { Hex } from "./policy/localCheck.ts";

export interface LedgerEntry {
  kind: "pay" | "vault_deposit" | "vault_withdraw" | "credit_draw" | "cover_claim" | "inflow";
  amount: bigint; // inflows: the gross receipt
  planId?: number; // payments only
  safeDelta: bigint; // effect on the Safe's token balance
  vaultDelta: bigint; // effect on the Safe's withdrawable vault assets
  debtDelta?: bigint; // effect on the lender's outstanding principal (draw +, router repayment -)
  payee?: Hex; // payments only
  ref?: string; // the action's ref (invoice id, payroll period, action id), before hashing
  tx?: Hex;
  note?: string;
}

export class Ledger {
  readonly entries: LedgerEntry[] = [];

  record(e: LedgerEntry): void {
    this.entries.push(e);
  }

  totals(): { safe: bigint; vault: bigint; debt: bigint; spent: Record<number, bigint> } {
    const spent: Record<number, bigint> = { 0: 0n, 1: 0n };
    let safe = 0n;
    let vault = 0n;
    let debt = 0n;
    for (const e of this.entries) {
      safe += e.safeDelta;
      vault += e.vaultDelta;
      debt += e.debtDelta ?? 0n;
      if (e.kind === "pay" && e.planId !== undefined) spent[e.planId] = (spent[e.planId] ?? 0n) + e.amount;
    }
    return { safe, vault, debt, spent };
  }
}

/** One token Transfer log that touches the Safe. Logs are identified by tx hash + log index. */
export interface SafeTransfer {
  tx: Hex;
  logIndex?: number;
  block?: bigint;
  safeDelta: bigint; // + into the Safe, - out of it
}

/** What reconciliation reads from the chain at the start and the end of a period. */
export interface ChainView {
  day: bigint; // PlanModule.today()
  safe: bigint;
  vault: bigint;
  spent: Record<number, bigint>; // spentToday per plan
  /** FlowCreditLine.drawn(): outstanding principal, not total ever borrowed. Absent when not read. */
  creditDrawn?: bigint;
  /** The one block every field above was read at. */
  block?: bigint;
  /** Transfer logs touching the Safe after the opening view's block, up to this view's block. Absent when not read. */
  transfers?: SafeTransfer[];
}

export interface Coverage {
  /** complete: every Safe transfer is a recorded tx and vice versa; gaps: not; limited: the logs were not read. */
  status: "complete" | "gaps" | "limited";
  /** Transfer logs read (after de-duplication). */
  transfers: number;
  /** On-chain Safe movements in transactions the ledger does not have. */
  unrecorded: SafeTransfer[];
  /** Recorded transactions whose Safe movement differs from the logs (chain 0 = not in the logs). */
  unmatched: Array<{ tx: Hex; ledger: bigint; chain: bigint }>;
  /** Ledger entries that move Safe cash without a tx hash, so no chain event can confirm them. */
  untraced: number;
}

export interface Reconciliation {
  ok: boolean;
  diffs: string[];
  /** Net changes the ledger records over the period (not balances). */
  expected: { safe: bigint; vault: bigint; debt: bigint; spent: Record<number, bigint> };
  /** Net changes observed on chain, closing minus opening (not balances). */
  observed: { safe: bigint; vault: bigint; debt?: bigint; spent?: Record<number, bigint> };
  checks: { balances: "ok" | "mismatch"; spent: "ok" | "mismatch" | "skipped"; debt: "ok" | "mismatch" | "not_read" };
  coverage: Coverage;
}

const fmt = (x: bigint) => (Number(x) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });
const signed = (x: bigint) => (x > 0n ? `+${fmt(x)}` : fmt(x));
const short = (tx: Hex) => `${tx.slice(0, 10)}…`;

/** Matches the period's Safe Transfer logs with the ledger's transactions. */
export function coverage(ledger: Ledger, transfers?: SafeTransfer[]): Coverage {
  const untraced = ledger.entries.filter((e) => !e.tx && e.safeDelta !== 0n).length;
  if (!transfers) return { status: "limited", transfers: 0, unrecorded: [], unmatched: [], untraced };
  const logs = new Map<string, SafeTransfer>();
  for (const t of transfers) if (t.safeDelta !== 0n) logs.set(`${t.tx.toLowerCase()}:${t.logIndex ?? ""}`, t);
  const chain = new Map<string, bigint>();
  for (const t of logs.values()) chain.set(t.tx.toLowerCase(), (chain.get(t.tx.toLowerCase()) ?? 0n) + t.safeDelta);
  const book = new Map<string, { tx: Hex; delta: bigint }>();
  for (const e of ledger.entries) {
    if (!e.tx) continue;
    const k = e.tx.toLowerCase();
    book.set(k, { tx: e.tx, delta: (book.get(k)?.delta ?? 0n) + e.safeDelta });
  }
  // an unrecorded transaction is flagged even when its movements, or several such transactions, net to zero
  const unrecorded = [...logs.values()].filter((t) => !book.has(t.tx.toLowerCase()));
  const unmatched: Coverage["unmatched"] = [];
  for (const [k, b] of book) {
    const c = chain.get(k) ?? 0n;
    if (c !== b.delta) unmatched.push({ tx: b.tx, ledger: b.delta, chain: c });
  }
  const gaps = unrecorded.length > 0 || unmatched.length > 0 || untraced > 0;
  return { status: gaps ? "gaps" : "complete", transfers: logs.size, unrecorded, unmatched, untraced };
}

/**
 * Chain deltas must equal the ledger's. The vault is allowed `vaultTolerance` units of ERC-4626 rounding;
 * spentToday is skipped when the chain day rolled over in between (it resets at 00:00 UTC); debt is compared
 * when both views read it; coverage when the closing view carries the period's Transfer logs.
 */
export function reconcile(ledger: Ledger, before: ChainView, after: ChainView, vaultTolerance = 2n): Reconciliation {
  const t = ledger.totals();
  const diffs: string[] = [];
  const checks: Reconciliation["checks"] = { balances: "ok", spent: "skipped", debt: "not_read" };
  const observed: Reconciliation["observed"] = { safe: after.safe - before.safe, vault: after.vault - before.vault };
  if (observed.safe !== t.safe) diffs.push(`Safe balance moved ${fmt(observed.safe)}, ledger says ${fmt(t.safe)}`);
  const vaultGap = observed.vault > t.vault ? observed.vault - t.vault : t.vault - observed.vault;
  if (vaultGap > vaultTolerance) diffs.push(`vault moved ${fmt(observed.vault)}, ledger says ${fmt(t.vault)}`);
  if (diffs.length) checks.balances = "mismatch";
  if (after.day === before.day) {
    checks.spent = "ok";
    observed.spent = {};
    for (const p of [0, 1]) {
      const d = (after.spent[p] ?? 0n) - (before.spent[p] ?? 0n);
      observed.spent[p] = d;
      if (d !== (t.spent[p] ?? 0n)) {
        diffs.push(`plan ${p} spentToday moved ${fmt(d)}, ledger says ${fmt(t.spent[p] ?? 0n)}`);
        checks.spent = "mismatch";
      }
    }
  }
  if (before.creditDrawn !== undefined && after.creditDrawn !== undefined) {
    observed.debt = after.creditDrawn - before.creditDrawn;
    checks.debt = observed.debt === t.debt ? "ok" : "mismatch";
    if (checks.debt === "mismatch") diffs.push(`outstanding credit moved ${fmt(observed.debt)}, ledger says ${fmt(t.debt)}`);
  }
  const cov = coverage(ledger, after.transfers);
  const byTx = new Map<string, bigint>();
  for (const u of cov.unrecorded) byTx.set(u.tx, (byTx.get(u.tx) ?? 0n) + u.safeDelta);
  for (const [tx, d] of byTx) diffs.push(`unrecorded Safe movement ${signed(d)} in tx ${short(tx as Hex)}`);
  for (const u of cov.unmatched) diffs.push(`tx ${short(u.tx)} moved the Safe ${fmt(u.chain)} on chain, ledger says ${fmt(u.ledger)}`);
  if (after.transfers && cov.untraced) diffs.push(`${cov.untraced} ledger entr${cov.untraced === 1 ? "y moves" : "ies move"} Safe cash without a tx hash`);
  return { ok: diffs.length === 0, diffs, expected: t, observed, checks, coverage: cov };
}
