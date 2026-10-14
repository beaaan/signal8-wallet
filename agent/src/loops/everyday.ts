// Everyday loop, first iteration: one ordinary day.
// Spec: docs/specs/agent.md#everyday-loopseverydayts
//
// 0. Read the chain view the day's ledger is reconciled against (and catch up on older Inflow events).
// 1. A customer (the demo client key, not the agent) pays an invoice into PaymentRouter; the Inflow event is
//    matched to the open receivable (inflows.ts), short/over/unknown payments are flagged for the owner.
// 2. Supplier invoices in data/fixtures/invoices go through extractor → planner → localCheck → executor;
//    those due within 2 days are paid under the base plan, later ones are returned as scheduled.
// 3. Cash above the everyday buffer goes into the vault (vault_deposit).
// 4. End of day (reconcile.ts): ledger vs chain; the report (report.ts: observed opening and the compared closing
//    snapshot, movements, structured payments, checks) is hashed and anchored as DAILY_REPORT; on a mismatch the
//    agent then pauses PlanModule with its own key and alerts the owner, whether or not the report succeeded.

import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { formatUnits, keccak256, toBytes } from "viem";
import { erc20Abi, paymentRouterAbi } from "../abis.ts";
import { readBalances, walletFor, type Chainish } from "../chain.ts";
import { PATHS } from "../config.ts";
import { fmt, units, type ActionSink, type PlainAction } from "../exec/executor.ts";
import { withRun } from "../exec/refs.ts";
import type { DecisionLog } from "../log.ts";
import type { ChainView, Ledger } from "../ledger.ts";
import { act, rememberPaid, understand, type PipelineDeps } from "../pipeline.ts";
import type { Hex } from "../policy/localCheck.ts";
import type { Action } from "../types.ts";
import type { HeldInfo } from "./storm.ts";
import type { InflowMatch, InflowWatcher } from "./inflows.ts";
import type { CloseDayDeps, DayClose } from "./reconcile.ts";
import { buildReport, closePeriod, reportName, resultLine, sealReport, type Balances, type ReportResult, type SealedReport } from "./report.ts";

export const EVERYDAY = {
  clientPayment: units("8000"),
  buffer: units("10000"), // cash kept in the Safe on an ordinary day
  minSweep: units("1000"),
  dueWithinDays: 2,
};

export interface EverydayDeps extends Omit<PipelineDeps, "state"> {
  c: Chainish;
  sink: ActionSink;
  log: DecisionLog;
  today: string; // YYYY-MM-DD, the business day being run
  runId?: string;
  invoiceDir?: string;
  onTx?: (label: string, tx: Hex) => void;
  /** Inflow matching (PaymentRouter events → receivables). */
  inflows?: InflowWatcher;
  /** End-of-day reconciliation: the executor must record into this same ledger. */
  reconcile?: { ledger: Ledger } & Omit<CloseDayDeps, "log" | "onTx" | "beforePause">;
}

export function daysUntil(today: string, due: string): number {
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function listInvoices(dir: string = PATHS.invoices): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) => resolve(dir, f));
}

/**
 * A customer pays into PaymentRouter with the demo client key (simulating the shop's customer). Only the tx is
 * recorded here; the decision line comes from inflow matching, which reads the Inflow event like any other payment.
 */
export async function clientPays(c: Chainish, invoiceId: string, amount: bigint, onTx?: (label: string, tx: Hex) => void): Promise<Hex> {
  const client = walletFor(c, "demoClient");
  const { MockUSD, PaymentRouter } = c.dep.contracts;
  const allowance = await c.pub.readContract({ address: MockUSD, abi: erc20Abi, functionName: "allowance", args: [client.account.address, PaymentRouter] });
  if (allowance < amount) {
    const approve = await client.writeContract({ address: MockUSD, abi: erc20Abi, functionName: "approve", args: [PaymentRouter, amount] });
    await c.pub.waitForTransactionReceipt({ hash: approve });
  }
  const invoiceRef = keccak256(toBytes(invoiceId));
  const { request } = await c.pub.simulateContract({ address: PaymentRouter, abi: paymentRouterAbi, functionName: "pay", args: [invoiceRef, amount], account: client.account });
  const tx = await client.writeContract(request);
  const receipt = await c.pub.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") throw new Error(`customer payment ${invoiceId} reverted`);
  onTx?.(`Customer paid ${fmt(amount)} mUSD for ${invoiceId} into PaymentRouter (simulated client, not the agent)`, tx);
  return tx;
}

export interface EverydayResult {
  scheduled: PlainAction[];
  scheduledInfo: HeldInfo[];
  inflows: InflowMatch[];
  /** The opening snapshot the day was compared from (with reconciliation). */
  opening?: ChainView;
  /** With `after`, the compared closing snapshot; `reportError` when the report could not be sealed. */
  reconciliation?: DayClose;
  /** The sealed report (file, content hash, anchor tx); absent if sealing failed. */
  report?: SealedReport;
}

export async function runEveryday(d: EverydayDeps): Promise<EverydayResult> {
  console.log(`Ordinary day ${d.today}`);
  const results: ReportResult[] = [];
  const names = new Map(d.payees.map((p) => [p.address.toLowerCase(), p.name]));

  // Catch up on older inflows first, so only today's land in today's ledger.
  if (d.inflows) await d.inflows.poll();
  // The observed opening snapshot, at one block; without reconciliation, the plain balances (not compared).
  const before = d.reconcile ? await d.reconcile.reader.view() : undefined;
  const opening: Balances = before ?? (await readBalances(d.c));

  await clientPays(d.c, withRun(`INV-C-${d.today}`, d.runId), EVERYDAY.clientPayment, d.onTx);
  const inflows = d.inflows ? await d.inflows.poll(d.reconcile?.ledger) : [];

  const scheduled: PlainAction[] = [];
  const scheduledInfo: HeldInfo[] = [];
  const deps = { ...d, state: async () => ({ activePlan: "base" as const, holdSupplierPayments: false }) };
  for (const file of listInvoices(d.invoiceDir)) {
    const input = `invoice:${basename(file)}`;
    const u = await understand(readFileSync(file, "utf8"), "invoice", input, deps);
    if (!u.actions) {
      results.push(resultLine(input, u));
      continue;
    }
    // Replays salt the invoice id so a rerun on the same chain is a new ref; live runs use keccak256(invoiceId).
    const salt = (a: PlainAction): PlainAction => (a.type === "pay" && d.runId ? { ...a, ref: withRun(a.ref, d.runId) } : a);
    const actions: Action[] = u.actions.map((a) => (a.type === "propose_to_owner" ? { ...a, action: salt(a.action) } : salt(a)));
    const due = u.invoice?.dueDate;
    // Only payments wait for their due date; an owner proposal (above its PO, a re-issue, …) goes to the owners now.
    const later = due && daysUntil(d.today, due) > EVERYDAY.dueWithinDays ? actions.filter((a) => a.type === "pay") : [];
    for (const a of later) {
      scheduled.push(a);
      scheduledInfo.push({ invoiceId: u.invoice?.invoiceId, dueDate: due });
    }
    if (later.length) console.log(`  scheduled ${u.invoice?.invoiceId} (due ${due})`);
    const now = actions.filter((a) => !(later as Action[]).includes(a));
    if (now.length === 0) continue;
    const r = await act(now, input, d.sink, u.invoice);
    rememberPaid(r, d, u.invoice);
    // the overall result is the first action's, and so are its details
    results.push(resultLine(input, r, now[0], u.invoice, names));
  }

  const b = await readBalances(d.c);
  const surplus = b.safe - EVERYDAY.buffer;
  if (surplus >= EVERYDAY.minSweep) {
    const sweep: PlainAction = { type: "vault_deposit", plan: "base", amount: formatUnits(surplus, 6), ref: withRun(`sweep-${d.today}`, d.runId) };
    results.push(resultLine(`sweep:${d.today}`, await d.sink.run(sweep, `sweep:${d.today}`), sweep));
  }

  const period = { id: "ordinary-day", from: d.today, to: d.today };
  const held = scheduled.map((a, i) => ({ ...a, ...scheduledInfo[i] }));
  if (d.reconcile && before) {
    const { ledger, ...deps } = d.reconcile;
    // The report carries the compared closing snapshot and is anchored before any pause, which would block the anchor.
    const { rec, report } = await closePeriod({
      c: d.c, sink: d.sink, deps: { ...deps, log: d.log, onTx: d.onTx }, period, runId: d.runId, ledger, opening: before, inflows, results, scheduled: held,
    });
    return { scheduled, scheduledInfo, inflows, opening: before, reconciliation: rec, report };
  }
  // Nothing compared: the closing balances are read now and the report says reconciliation was not run.
  const body = buildReport({ c: d.c, date: d.today, period, runId: d.runId, opening, closing: await readBalances(d.c), inflows, results, scheduled: held });
  const report = await sealReport(d.c.cfg.logDir, d.sink, body, reportName(d.today, d.runId), `report:${d.today}`);
  return { scheduled, scheduledInfo, inflows, report };
}
