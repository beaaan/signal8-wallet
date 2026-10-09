// Everyday loop, first iteration: one ordinary day.
// Spec: docs/specs/agent.md#everyday-loopseverydayts
//
// 1. A customer (the demo client key, not the agent) pays an invoice into PaymentRouter.
// 2. Supplier invoices in data/fixtures/invoices go through extractor → planner → localCheck → executor;
//    those due within 2 days are paid under the base plan, later ones are returned as scheduled.
// 3. Cash above the everyday buffer goes into the vault (vault_deposit).
// 4. The day's report is hashed and anchored as DAILY_REPORT.
// TODO: match Inflow events to open invoices, and pause() on a ledger/chain mismatch.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { formatUnits, keccak256, stringToBytes, toBytes } from "viem";
import { erc20Abi, paymentRouterAbi } from "../abis.ts";
import { readBalances, walletFor, type Chainish } from "../chain.ts";
import { PATHS } from "../config.ts";
import { fmt, units, type ActionSink, type PlainAction } from "../exec/executor.ts";
import { withRun } from "../exec/refs.ts";
import type { DecisionLog } from "../log.ts";
import { act, understand, type PipelineDeps } from "../pipeline.ts";
import { canonicalJson } from "../plan.ts";
import type { Hex } from "../policy/localCheck.ts";

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

/** A customer pays into PaymentRouter with the demo client key (simulating the shop's customer). */
export async function clientPays(c: Chainish, log: DecisionLog, invoiceId: string, amount: bigint, onTx?: (label: string, tx: Hex) => void): Promise<Hex> {
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
  const summary = `Customer paid ${fmt(amount)} mUSD for ${invoiceId} into PaymentRouter (simulated client, not the agent)`;
  log.write({ input: `inflow:${invoiceId}`, stage: "chain", outcome: receipt.status === "success" ? "executed" : "refused", action: "inflow", summary, tx });
  onTx?.(summary, tx);
  return tx;
}

export async function runEveryday(d: EverydayDeps): Promise<{ scheduled: PlainAction[] }> {
  console.log(`Ordinary day ${d.today}`);
  const results: Array<{ input: string; outcome: string; reason?: string; tx?: string }> = [];

  await clientPays(d.c, d.log, withRun(`INV-C-${d.today}`, d.runId), EVERYDAY.clientPayment, d.onTx);

  const scheduled: PlainAction[] = [];
  const deps = { ...d, state: async () => ({ activePlan: "base" as const, holdSupplierPayments: false }) };
  for (const file of listInvoices(d.invoiceDir)) {
    const input = `invoice:${basename(file)}`;
    const u = await understand(readFileSync(file, "utf8"), "invoice", input, deps);
    if (!u.actions) {
      results.push({ input, outcome: u.outcome, reason: u.reason });
      continue;
    }
    // Replays salt the invoice id so a rerun on the same chain is a new ref; live runs use keccak256(invoiceId).
    const actions = u.actions.map((a) => (a.type === "pay" && d.runId ? { ...a, ref: withRun(a.ref, d.runId) } : a));
    const due = u.invoice?.dueDate;
    if (due && daysUntil(d.today, due) > EVERYDAY.dueWithinDays) {
      scheduled.push(...actions.filter((a): a is PlainAction => a.type === "pay"));
      console.log(`  scheduled ${u.invoice?.invoiceId} (due ${due})`);
      continue;
    }
    const r = await act(actions, input, d.sink, u.invoice);
    results.push({ input, outcome: r.outcome, reason: r.reason, tx: r.tx });
  }

  const b = await readBalances(d.c);
  const surplus = b.safe - EVERYDAY.buffer;
  if (surplus >= EVERYDAY.minSweep) {
    const r = await d.sink.run({ type: "vault_deposit", plan: "base", amount: formatUnits(surplus, 6), ref: withRun(`sweep-${d.today}`, d.runId) }, `sweep:${d.today}`);
    results.push({ input: `sweep:${d.today}`, outcome: r.outcome, reason: r.reason, tx: r.tx });
  }

  const after = await readBalances(d.c);
  const report = {
    kind: "DAILY_REPORT",
    date: d.today,
    runId: d.runId ?? null,
    balances: { safe: after.safe.toString(), vault: after.vault.toString(), creditDrawn: after.creditDrawn.toString() },
    results,
    scheduled: scheduled.map((a) => ({ ...a })),
  };
  const json = canonicalJson(report);
  mkdirSync(d.c.cfg.logDir, { recursive: true });
  writeFileSync(resolve(d.c.cfg.logDir, `report-${d.today}${d.runId ? `-${d.runId}` : ""}.json`), json);
  await d.sink.run({ type: "anchor", kind: "DAILY_REPORT", hash: keccak256(stringToBytes(json)) }, `report:${d.today}`);
  return { scheduled };
}
