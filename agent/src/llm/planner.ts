// Planner: validated invoice fields + plan state → Action[]. Never sees raw text.
// Spec: docs/specs/agent.md#trust-boundaries (3)
//
// Deterministic code wraps the provider on both sides:
// - before: guards that hold whatever the model would say (unregistered address, bank detail change, …), and
//   payroll messages, which never reach the model (payroll comes from payroll.json, not from a message);
// - after: every action is checked against the registry and the invoice, then against the owner's records
//   (purchase orders, invoices already paid, re-issues). Only payments, or owner proposals of payments, come out.

import type { PayeeControls } from "../controls.ts";
import { plain, units, type PlainAction } from "../exec/calls.ts";
import { normaliseInvoiceId, PAYROLL_PREFIX } from "../exec/refs.ts";
import { PlannerOutput, type Action, type ExtractedInvoice } from "../types.ts";
import type { ModelProvider, PlannerInput, RegistryPayee } from "./provider.ts";
import { matchPayee } from "./rules.ts";

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
  if (inv.kind === "credit_note") return "a credit note lowers what is owed; it never starts a payment";
  if (inv.kind === "statement") return "a supplier statement is for reconciliation; each invoice is paid on its own";
  if (inv.kind !== "invoice") return "not an invoice";
  if (units(inv.amount) <= 0n) return "no amount";
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
  if (units(inv.amount) !== units(p.total)) return { ok: false, reason: `payroll total ${inv.amount} differs from payroll.json (${p.total})` };
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
  if (pay.part !== undefined) return "the part number comes from the owner's paid records, not the planner";
  const payee = input.payees.find((p) => p.address.toLowerCase() === pay.payee.toLowerCase());
  if (!payee) return "payee not in registry";
  // The invoice names its payee; the model may not move the payment to another registered payee (e.g. to dodge a
  // purchase-order rule). With no literal address and no name match, applyNameCheck sends it to the owners.
  const named = namedPayee(input);
  if (named && named.address.toLowerCase() !== pay.payee.toLowerCase()) return `invoice names ${named.id}, not ${payee.id}`;
  if (units(pay.amount) !== units(input.invoice.amount)) return "amount differs from the invoice";
  if (pay.ref !== input.invoice.invoiceId) return "ref is not the invoice id";
  if (a.type === "pay" && !payee.plans.includes(pay.plan)) return `payee is not in the ${pay.plan} plan`;
  if (a.type === "pay" && pay.plan !== input.activePlan) return "pay under a plan that is not active";
  return undefined;
}

/** The registry payee the invoice itself names: its literal address, else a deterministic name match. */
function namedPayee(input: PlannerInput): RegistryPayee | undefined {
  const inv = input.invoice;
  if (inv.payeeAddress) return input.payees.find((p) => p.address.toLowerCase() === inv.payeeAddress!.toLowerCase());
  return matchPayee(inv.payeeName, input.payees);
}

/** A payee only the model could match to the invoice's name is the owners' call, never an automatic payment. */
function applyNameCheck(a: Action, input: PlannerInput): Action {
  if (a.type !== "pay" || namedPayee(input)) return a;
  const id = input.payees.find((p) => p.address.toLowerCase() === a.payee.toLowerCase())?.id ?? a.payee;
  return { type: "propose_to_owner", reason: `"${input.invoice.payeeName.slice(0, 40)}" does not match the registry name of ${id}`, action: a };
}

/**
 * The owner's records: an invoice already paid in full is refused; a re-issue (same supplier and amount, same date
 * or none, new number), an amount above what its purchase order still allows, a missing PO where one is required,
 * or (without a PO) an amount above the supplier's usual amount turns the payment into an owner proposal.
 *
 * One invoice may be paid in parts (instalments, the balance after a deposit) only when a purchase order gives a
 * verified total: every part is bounded by what the order still allows, and each gets its own on-chain ref (part n),
 * so a retried part reverts instead of paying twice. Without an order, an invoice is paid once.
 */
export function applyControls(a: Action, input: PlannerInput, controls?: PayeeControls): { action?: Action; refuse?: string } {
  if (!controls) return { action: a };
  const pay = a.type === "propose_to_owner" ? a.action : a;
  if (pay.type !== "pay") return { action: a };
  const inv = input.invoice;
  const supplier = input.payees.find((p) => p.address.toLowerCase() === pay.payee.toLowerCase())?.id;
  if (!supplier) return { action: a };
  const id = inv.invoiceId ? normaliseInvoiceId(inv.invoiceId) : undefined;
  const mine = controls.paid.filter((p) => p.supplier === supplier);
  const earlier = mine.filter((p) => normaliseInvoiceId(p.invoiceId) === id);
  const order = controls.orders.find((o) => o.supplier === supplier && o.invoiceId !== undefined && normaliseInvoiceId(o.invoiceId) === id);
  const paidSoFar = earlier.reduce((s, p) => s + units(p.amount), 0n);
  if (earlier.length && (!order || paidSoFar >= units(order.amount))) {
    const last = earlier.at(-1)!;
    return { refuse: `invoice ${last.invoiceId} already paid${last.paidOn ? ` on ${last.paidOn}` : ""}` };
  }
  const out: typeof pay = earlier.length ? { ...pay, part: earlier.length + 1 } : pay;

  let reason: string | undefined;
  // Same supplier and amount as another paid invoice: a re-issue if the dates match, or if the new one has no date to tell them apart.
  const reissue = mine.find((p) => !earlier.includes(p) && units(p.amount) === units(inv.amount) && (inv.issueDate ? p.issueDate === inv.issueDate : true));
  if (reissue) reason = `looks like a re-issue of ${reissue.invoiceId} (same supplier and amount, ${inv.issueDate ? "same date" : "no date on the new invoice"})`;
  if (!reason && order && units(inv.amount) > units(order.amount) - paidSoFar) {
    reason = earlier.length
      ? `amount ${inv.amount} is above the ${plain(units(order.amount) - paidSoFar)} left on purchase order ${order.po} (${order.amount}, ${plain(paidSoFar)} paid)`
      : `amount ${inv.amount} is above purchase order ${order.po} (${order.amount})`;
  }
  if (!reason && !order && controls.requiresPO[supplier]) reason = `no purchase order for ${inv.invoiceId}`;
  const usual = controls.usualAmount?.[supplier];
  if (!reason && !order && usual && units(inv.amount) > units(usual)) reason = `amount ${inv.amount} is above the usual ${usual} for ${supplier}`;
  if (!reason) return { action: a.type === "propose_to_owner" ? { ...a, action: out } : out };
  return { action: { type: "propose_to_owner", reason, action: out } };
}

const HOLD_REASON: Record<NonNullable<ExtractedInvoice["hold"]>, string> = {
  not_received: "the invoice says the goods have not been received; the owners confirm receipt first",
  disputed: "the invoice's quantity or price is disputed; the owners check the corrected document",
  hold_requested: "the invoice asks to hold payment; the owners decide when to release it",
};

/** A document that itself says not received, disputed or hold is never paid automatically. */
function applyHold(a: Action, inv: ExtractedInvoice): Action {
  if (!inv.hold || a.type !== "pay") return a;
  return { type: "propose_to_owner", reason: HOLD_REASON[inv.hold], action: a };
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
    const c = applyControls(applyNameCheck(a, input), input, controls);
    if (c.refuse) return { ok: false, reason: c.refuse };
    actions.push(applyHold(c.action!, input.invoice));
  }
  if (actions.length === 0) return { ok: false, reason: dropped[0] ?? "payee not in registry" };
  return { ok: true, actions, dropped };
}
