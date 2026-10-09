// Untrusted text → extractor → planner → (localCheck + executor via the ActionSink).
// Used by the arena, the everyday loop and the replay's fake messages. Every stage that stops writes a decision line.

import type { PayeeControls } from "./controls.ts";
import type { ActionSink } from "./exec/executor.ts";
import type { Batch } from "./llm/planner.ts";
import { extract } from "./llm/extractor.ts";
import { plan } from "./llm/planner.ts";
import type { Channel, ModelProvider, PlannerInput, RegistryPayee } from "./llm/provider.ts";
import type { DecisionLog } from "./log.ts";
import type { Action, Decision, ExtractedInvoice } from "./types.ts";

export interface PipelineDeps {
  provider: ModelProvider;
  sink: ActionSink;
  log: DecisionLog;
  payees: RegistryPayee[];
  plans: PlannerInput["plans"];
  /** Live plan state: storm plan while storm mode is on; suppliers held during a storm. */
  state: () => Promise<{ activePlan: "base" | "storm"; holdSupplierPayments: boolean }>;
  /** The owner's records (purchase orders, paid invoices, payroll); without them only the plan's caps apply. */
  controls?: PayeeControls;
}

export interface PipelineResult {
  outcome: Decision["outcome"];
  stage: Decision["stage"];
  reason?: string;
  tx?: `0x${string}`;
  invoice?: ExtractedInvoice;
  actions?: Action[];
}

/** Extract and plan only (no execution). Refusals are logged. */
export async function understand(
  text: string,
  channel: Channel,
  input: string,
  deps: Omit<PipelineDeps, "sink">,
): Promise<PipelineResult & { actions?: Action[]; batch?: Batch }> {
  const ex = await extract(deps.provider, text, channel);
  if (!ex.ok) {
    deps.log.write({ input, stage: "extractor", outcome: "refused", reason: ex.reason, summary: "Input dropped by the extractor" });
    return { outcome: "refused", stage: "extractor", reason: ex.reason };
  }
  const state = await deps.state();
  const planned = await plan(deps.provider, { invoice: ex.invoice, ...state, payees: deps.payees, plans: deps.plans }, deps.controls);
  if (!planned.ok) {
    deps.log.write({
      input,
      stage: "planner",
      outcome: "refused",
      reason: planned.reason,
      summary: `No payment for "${ex.invoice.payeeName}" ${ex.invoice.amount} ${ex.invoice.currency}`,
    });
    return { outcome: "refused", stage: "planner", reason: planned.reason, invoice: ex.invoice };
  }
  return { outcome: "proposed", stage: "planner", invoice: ex.invoice, actions: planned.actions, batch: planned.batch };
}

/** Runs actions through the sink; the overall result is the first action's. */
export async function act(actions: Action[], input: string, sink: ActionSink, invoice?: ExtractedInvoice): Promise<PipelineResult> {
  let first: PipelineResult | undefined;
  for (const a of actions) {
    const r = await sink.run(a, input);
    first ??= { outcome: r.outcome, stage: r.stage, reason: r.reason, tx: r.tx, invoice, actions };
  }
  return first ?? { outcome: "refused", stage: "planner", reason: "no action", invoice };
}

export async function processUntrusted(text: string, channel: Channel, input: string, deps: PipelineDeps): Promise<PipelineResult> {
  const u = await understand(text, channel, input, deps);
  if (u.batch) {
    const r = await deps.sink.proposeBatch(u.batch.reason, u.batch.actions, input, u.batch.summary);
    return { outcome: r.outcome, stage: r.stage, reason: r.reason, invoice: u.invoice, actions: [] };
  }
  if (!u.actions) return u;
  const r = await act(u.actions, input, deps.sink, u.invoice);
  rememberPaid(r, deps, u.invoice);
  return r;
}

/** An executed supplier payment joins the paid history, so a re-issue later in the session is caught. */
export function rememberPaid(r: PipelineResult, deps: Pick<PipelineDeps, "controls" | "payees">, inv?: ExtractedInvoice): void {
  const a = r.actions?.[0];
  if (r.outcome !== "executed" || !deps.controls || !inv?.invoiceId || a?.type !== "pay") return;
  const supplier = deps.payees.find((p) => p.address.toLowerCase() === a.payee.toLowerCase())?.id;
  if (!supplier) return;
  deps.controls.paid.push({ supplier, invoiceId: inv.invoiceId, amount: inv.amount, issueDate: inv.issueDate, paidOn: new Date().toISOString().slice(0, 10) });
}
