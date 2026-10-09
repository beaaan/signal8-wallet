// Planner: validated invoice fields + plan state → Action[]. Never sees raw text.
// Spec: docs/specs/agent.md#trust-boundaries (3)
//
// Deterministic guards run before the provider (they hold whatever the model would say), and every action the
// provider returns is checked against the registry and the invoice afterwards. Only payments, or owner proposals
// of payments, can come out of an invoice.

import { PlannerOutput, type Action, type ExtractedInvoice } from "../types.ts";
import type { ModelProvider, PlannerInput } from "./provider.ts";

export type Planning = { ok: true; actions: Action[]; dropped: string[] } | { ok: false; reason: string };

/** The plan token stands for the shop's dollar; HKD and USD amounts are taken at face value (demo simplification). */
const PLAN_CURRENCIES: ReadonlySet<ExtractedInvoice["currency"]> = new Set(["USD", "HKD"]);

export function guard(input: PlannerInput): string | undefined {
  const inv = input.invoice;
  if (inv.kind === "bank_detail_change") return "bank detail changes go through the owners' timelocked setPayee, never a message";
  if (inv.payeeAddress && !input.payees.some((p) => p.address.toLowerCase() === inv.payeeAddress!.toLowerCase())) {
    return "address not in payee registry";
  }
  if (inv.kind === "payroll") return "payroll is paid from payroll.json by the payday loop, not from messages";
  if (inv.kind !== "invoice") return "not an invoice";
  if (Number(inv.amount) <= 0) return "no amount";
  if (!PLAN_CURRENCIES.has(inv.currency)) return `currency ${inv.currency} does not match the plan token`;
  if (!inv.invoiceId) return "no invoice id, so no deterministic ref";
  return undefined;
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

export async function plan(provider: ModelProvider, input: PlannerInput): Promise<Planning> {
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
    if (why) dropped.push(why);
    else if (actions.length === 0) actions.push(a);
    else dropped.push("more than one payment for one invoice");
  }
  if (actions.length === 0) return { ok: false, reason: dropped[0] ?? "payee not in registry" };
  return { ok: true, actions, dropped };
}
