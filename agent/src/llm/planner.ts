// Planner: validated invoice fields + plan state → Action[]. Never sees raw text.
// Spec: docs/specs/agent.md#trust-boundaries (3)
//
// Deterministic code wraps the provider on both sides:
// - before: guards that hold whatever the model would say (unregistered address, bank detail change, …), and
//   payroll messages, which never reach the model (payroll comes from payroll.json, not from a message);
// - after: every action is checked against the registry and the invoice, then against the owner's records
//   (purchase orders, invoices already paid, re-issues). Only payments, or owner proposals of payments, come out.

import type { PayeeControls } from "../controls.ts";
import type { PlainAction } from "../exec/calls.ts";
import { PAYROLL_PREFIX } from "../exec/refs.ts";
import { PlannerOutput, type Action, type ExtractedInvoice } from "../types.ts";
import type { ModelProvider, PlannerInput } from "./provider.ts";

export interface Batch {
  reason: string;
  actions: PlainAction[];
  summary: string;
}

export type Planning = { ok: true; actions: Action[]; dropped: string[]; batch?: Batch } | { ok: false; reason: string };

/** The plan token stands for the shop's dollar; HKD and USD amounts are taken at face value (demo simplification). */
const PLAN_CURRENCIES: ReadonlySet<ExtractedInvoice["currency"]> = new Set(["USD", "HKD"]);

export function guard(input: PlannerInput): string | undefined {
  const inv = input.invoice;
  if (inv.kind === "bank_detail_change") return "bank detail changes go through the owners' timelocked setPayee, never a message";
  if (inv.payeeAddress && !input.payees.some((p) => p.address.toLowerCase() === inv.payeeAddress!.toLowerCase())) {
    return "address not in payee registry";
  }
  if (inv.kind === "payroll") return "payroll is paid from payroll.json, not from messages";
  if (inv.kind !== "invoice") return "not an invoice";
  if (Number(inv.amount) <= 0) return "no amount";
  if (!PLAN_CURRENCIES.has(inv.currency)) return `currency ${inv.currency} does not match the plan token`;
  if (!inv.invoiceId) return "no invoice id, so no deterministic ref";
  return undefined;
}

/**
 * A payroll message on an ordinary day: if its total matches payroll.json, the whole payroll goes to the owners as
 * one proposal (staff are storm-plan payees only). Addresses come from payroll.json, never from the message.
 */
function planPayroll(input: PlannerInput, controls?: PayeeControls): Planning {
  const inv = input.invoice;
  const p = controls?.payroll;
  if (!p) return { ok: false, reason: "no payroll.json to check the message against" };
  if (input.activePlan === "storm") return { ok: false, reason: "in a storm the payday loop pays staff under the storm plan" };
  if (Number(inv.amount) !== Number(p.total)) return { ok: false, reason: `payroll total ${inv.amount} differs from payroll.json (${p.total})` };
  const actions: PlainAction[] = p.staff.map((s) => ({ type: "pay", plan: "storm", payee: s.address, amount: s.amount, ref: `${PAYROLL_PREFIX}${p.period}` }));
  return {
    ok: true,
    actions: [],
    dropped: [],
    batch: { reason: "payroll on an ordinary day needs two owners (staff are storm-plan payees only)", actions, summary: `Owner proposal: payroll ${p.period}, ${p.staff.length} staff, ${p.total} mUSD` },
  };
}

/** Why an action from the provider is not acceptable for this invoice, or undefined if it is. */
function reject(a: Action, input: PlannerInput): string | undefined {
  const pay = a.type === "propose_to_owner" ? a.action : a;
  if (pay.type !== "pay") return `${pay.type} cannot come from an invoice`;
  const payee = input.payees.find((p) => p.address.toLowerCase() === pay.payee.toLowerCase());
  if (!payee) return "payee not in registry";
  if (Number(pay.amount) !== Number(input.invoice.amount)) return "amount differs from the invoice";
  if (pay.ref !== input.invoice.invoiceId) return "ref is not the invoice id";
  if (a.type === "pay" && !payee.plans.includes(pay.plan)) return `payee is not in the ${pay.plan} plan`;
  if (a.type === "pay" && pay.plan !== input.activePlan) return "pay under a plan that is not active";
  return undefined;
}

/**
 * The owner's records: an invoice already paid is refused; a re-issue (same supplier, amount and date, new number),
 * an amount above its purchase order, or a missing PO where one is required turns the payment into an owner proposal.
 */
export function applyControls(a: Action, input: PlannerInput, controls?: PayeeControls): { action?: Action; refuse?: string } {
  if (!controls) return { action: a };
  const pay = a.type === "propose_to_owner" ? a.action : a;
  if (pay.type !== "pay") return { action: a };
  const inv = input.invoice;
  const supplier = input.payees.find((p) => p.address.toLowerCase() === pay.payee.toLowerCase())?.id;
  if (!supplier) return { action: a };
  const mine = controls.paid.filter((p) => p.supplier === supplier);
  const already = mine.find((p) => p.invoiceId === inv.invoiceId);
  if (already) return { refuse: `invoice ${already.invoiceId} already paid${already.paidOn ? ` on ${already.paidOn}` : ""}` };

  let reason: string | undefined;
  const reissue = mine.find((p) => Number(p.amount) === Number(inv.amount) && p.issueDate && p.issueDate === inv.issueDate);
  if (reissue) reason = `looks like a re-issue of ${reissue.invoiceId} (same supplier, amount and date)`;
  const order = controls.orders.find((o) => o.supplier === supplier && o.invoiceId === inv.invoiceId);
  if (!reason && order && Number(inv.amount) > Number(order.amount)) reason = `amount ${inv.amount} is above purchase order ${order.po} (${order.amount})`;
  if (!reason && !order && controls.requiresPO[supplier]) reason = `no purchase order for ${inv.invoiceId}`;
  if (!reason) return { action: a };
  return { action: { type: "propose_to_owner", reason, action: pay } };
}

export async function plan(provider: ModelProvider, input: PlannerInput, controls?: PayeeControls): Promise<Planning> {
  if (input.invoice.kind === "payroll" && !input.invoice.payeeAddress) return planPayroll(input, controls);
  const blocked = guard(input);
  if (blocked) return { ok: false, reason: blocked };
  let raw: unknown;
  try {
    raw = await provider.plan(input);
  } catch (err) {
    return { ok: false, reason: `planner error: ${err instanceof Error ? err.message.slice(0, 120) : "unknown"}` };
  }
  const parsed = PlannerOutput.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid planner output" };
  const actions: Action[] = [];
  const dropped: string[] = [];
  for (const a of parsed.data.actions) {
    const why = reject(a, input);
    if (why) {
      dropped.push(why);
      continue;
    }
    if (actions.length > 0) {
      dropped.push("more than one payment for one invoice");
      continue;
    }
    const c = applyControls(a, input, controls);
    if (c.refuse) return { ok: false, reason: c.refuse };
    actions.push(c.action!);
  }
  if (actions.length === 0) return { ok: false, reason: dropped[0] ?? "payee not in registry" };
  return { ok: true, actions, dropped };
}
