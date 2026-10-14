// Period report, anchored as DAILY_REPORT. Version 2 (issue #18); spec: docs/specs/agent.md#daily-report.
//
// Opening and closing are the snapshots reconciliation compared (each read at one block), so the anchored closing
// balances are the compared ones, never a later read. Movements are the ledger's entries; payment results carry
// invoice, payee, amount and ref; checks keep balances, debt and transfer coverage apart. Version-1 reports (no
// `version` field) are historical evidence and are never rewritten: an existing report file is not overwritten.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { keccak256, stringToBytes } from "viem";
import type { Chainish } from "../chain.ts";
import { TOKEN_DECIMALS, type ActionSink, type PlainAction } from "../exec/executor.ts";
import type { ChainView, Ledger, LedgerEntry, Reconciliation } from "../ledger.ts";
import { canonicalJson } from "../plan.ts";
import type { Hex } from "../policy/localCheck.ts";
import type { Action } from "../types.ts";
import type { InflowMatch } from "./inflows.ts";
import { closeDay, type CloseDayDeps, type DayClose } from "./reconcile.ts";

export const REPORT_VERSION = 2;

/** A balance snapshot: from reconciliation's ChainView (one block), or plain balances when nothing is compared. */
export type Balances = Pick<ChainView, "safe" | "vault" | "creditDrawn" | "block">;

/** One input's outcome. Payments add what a bookkeeper allocates them by. */
export interface ReportResult {
  input: string;
  outcome: string;
  reason?: string;
  tx?: string;
  type?: PlainAction["type"];
  plan?: string;
  invoiceId?: string;
  dueDate?: string;
  payee?: Hex;
  payeeName?: string;
  amount?: string;
  ref?: string;
}

/** The result of `action` (for an owner proposal, of the action proposed) with its structured details. */
export function resultLine(
  input: string,
  r: { outcome: string; reason?: string; tx?: string },
  action?: Action,
  invoice?: { invoiceId?: string; dueDate?: string },
  names?: Map<string, string>,
): ReportResult {
  const line: ReportResult = { input, outcome: r.outcome, reason: r.reason, tx: r.tx };
  const a = action?.type === "propose_to_owner" ? action.action : action;
  if (!a || a.type === "anchor") return line;
  if (a.type === "pay") {
    return { ...line, type: a.type, plan: a.plan, invoiceId: invoice?.invoiceId, dueDate: invoice?.dueDate, payee: a.payee, payeeName: names?.get(a.payee.toLowerCase()), amount: a.amount, ref: a.ref };
  }
  return { ...line, type: a.type, plan: a.plan, amount: "amount" in a ? a.amount : undefined, ref: a.ref };
}

export interface ReportPeriod {
  /** "ordinary-day", or "storm" for the replay's period from the ordinary day's close to the end of the replay. */
  id: string;
  from: string; // business dates (YYYY-MM-DD)
  to: string;
  note?: string;
}

export interface ReportInput {
  c: Chainish;
  date: string;
  period: ReportPeriod;
  runId?: string;
  opening?: Balances;
  closing: Balances;
  /** The period's ledger; absent when nothing was recorded. */
  ledger?: Ledger;
  inflows: InflowMatch[];
  results: ReportResult[];
  scheduled: Array<PlainAction & { invoiceId?: string; dueDate?: string }>;
  reconciliation?: Reconciliation;
}

const str = (x: bigint | undefined) => (x === undefined ? null : x.toString());
const balances = (b: Balances) => ({ safe: b.safe.toString(), vault: b.vault.toString(), creditDrawn: str(b.creditDrawn) });
const spent = (s?: Record<number, bigint>) => (s ? { 0: str(s[0] ?? 0n), 1: str(s[1] ?? 0n) } : null);

function movement(e: LedgerEntry) {
  return { ...e, amount: e.amount.toString(), safeDelta: e.safeDelta.toString(), vaultDelta: e.vaultDelta.toString(), debtDelta: e.debtDelta?.toString() };
}

/** Network, chain id, token and the contracts the balances were read from. */
export function reportChain(c: Chainish) {
  const k = c.dep.contracts;
  return {
    network: c.cfg.network,
    chainId: c.dep.chainId,
    token: { address: k.MockUSD, symbol: "mUSD", decimals: TOKEN_DECIMALS },
    safe: k.Safe,
    vault: k.MockMMFVault,
    creditLine: k.FlowCreditLine,
    planModule: k.PlanModule,
  };
}

/** The report object (amounts in token base units, as decimal strings). */
export function buildReport(i: ReportInput) {
  const rec = i.reconciliation;
  const gross = i.inflows.reduce((s, m) => s + m.event.amount, 0n);
  const swept = i.inflows.reduce((s, m) => s + m.event.swept, 0n);
  const cov = rec?.coverage;
  return {
    kind: "DAILY_REPORT",
    version: REPORT_VERSION,
    date: i.date,
    period: i.period,
    runId: i.runId ?? null,
    chain: reportChain(i.c),
    blocks: { opening: str(i.opening?.block), closing: str(i.closing.block) },
    openingBalances: i.opening ? balances(i.opening) : null,
    balances: balances(i.closing),
    movements: i.ledger ? i.ledger.entries.map(movement) : null,
    // gross settles the invoices; swept repaid the credit line; only net reached the Safe
    receipts: { gross: gross.toString(), swept: swept.toString(), net: (gross - swept).toString(), flagged: i.inflows.filter((m) => m.kind !== "matched").length },
    inflows: i.inflows.map((m) => ({
      kind: m.kind,
      receivable: m.receivable?.id ?? null,
      amount: m.event.amount.toString(),
      swept: m.event.swept.toString(),
      net: (m.event.amount - m.event.swept).toString(),
      tx: m.event.tx,
    })),
    results: i.results,
    scheduled: i.scheduled.map((a) => ({ ...a })),
    reconciliation: rec ? { ok: rec.ok, diffs: rec.diffs } : null,
    checks: rec
      ? {
          balances: rec.checks.balances,
          spentToday: rec.checks.spent,
          debt: rec.checks.debt,
          coverage: {
            status: cov!.status,
            fromBlock: cov!.status === "limited" || i.opening?.block === undefined ? null : (i.opening.block + 1n).toString(),
            toBlock: cov!.status === "limited" ? null : str(i.closing.block),
            transfers: cov!.transfers,
            unrecorded: cov!.unrecorded.map((t) => ({ tx: t.tx, logIndex: t.logIndex, block: str(t.block), safeDelta: t.safeDelta.toString() })),
            unmatched: cov!.unmatched.map((u) => ({ tx: u.tx, ledger: u.ledger.toString(), chain: u.chain.toString() })),
            untraced: cov!.untraced,
          },
          // changes over the period, not balances
          expectedChange: { safe: rec.expected.safe.toString(), vault: rec.expected.vault.toString(), creditDrawn: rec.expected.debt.toString(), spent: spent(rec.expected.spent) },
          observedChange: { safe: rec.observed.safe.toString(), vault: rec.observed.vault.toString(), creditDrawn: str(rec.observed.debt), spent: spent(rec.observed.spent) },
          vaultTolerance: "2",
        }
      : null,
  };
}

/** report-<date>[-<runId>][-<period>].json; the ordinary day keeps the version-1 name. */
export function reportName(date: string, runId?: string, period = "ordinary-day"): string {
  return `report-${date}${runId ? `-${runId}` : ""}${period === "ordinary-day" ? "" : `-${period}`}.json`;
}

export interface SealedReport {
  file: string;
  hash: Hex;
  tx?: Hex;
}

/** Writes the canonical JSON (never over an existing report) and anchors its hash; throws if either fails. */
export async function sealReport(logDir: string, sink: ActionSink, report: object, name: string, input: string): Promise<SealedReport> {
  const json = canonicalJson(report);
  mkdirSync(logDir, { recursive: true });
  const file = resolve(logDir, name);
  try {
    writeFileSync(file, json, { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${name} already exists; reports are never overwritten (use a new --run-id)`);
    throw err;
  }
  const hash = keccak256(stringToBytes(json));
  const r = await sink.run({ type: "anchor", kind: "DAILY_REPORT", hash }, input);
  if (r.outcome !== "executed") throw new Error(`${name} written but not anchored (${r.reason ?? r.outcome})`);
  return { file, hash, tx: r.tx };
}

export interface PeriodClose {
  /** The reconciliation, with the compared closing snapshot, pause outcome and any report error. */
  rec: DayClose;
  /** Absent when the report could not be sealed (rec.reportError says why). */
  report?: SealedReport;
}

/**
 * Reconciles a period's ledger from its opening snapshot and seals the period's report from the compared closing
 * snapshot, before any pause. Containment on a mismatch does not depend on the report (closeDay).
 */
export async function closePeriod(p: {
  c: Chainish;
  sink: ActionSink;
  deps: Omit<CloseDayDeps, "beforePause" | "period">;
  period: ReportPeriod;
  runId?: string;
  ledger: Ledger;
  opening: ChainView;
  inflows: InflowMatch[];
  results: ReportResult[];
  scheduled?: ReportInput["scheduled"];
}): Promise<PeriodClose> {
  const ordinary = p.period.id === "ordinary-day";
  const date = p.period.to;
  let report: SealedReport | undefined;
  const rec = await closeDay(date, p.ledger, p.opening, {
    ...p.deps,
    period: ordinary ? undefined : p.period.id,
    beforePause: async (r) => {
      const body = buildReport({ ...p, date, closing: r.after, scheduled: p.scheduled ?? [], reconciliation: r });
      report = await sealReport(p.c.cfg.logDir, p.sink, body, reportName(date, p.runId, p.period.id), ordinary ? `report:${date}` : `report:${p.period.id}:${date}`);
    },
  });
  return { rec, report };
}
