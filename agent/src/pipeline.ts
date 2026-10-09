// Untrusted text → extractor → planner → (localCheck + executor via the ActionSink).
// Used by the arena, the everyday loop and the replay's fake messages. Every stage that stops writes a decision line.

import type { ActionSink } from "./exec/executor.ts";
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
): Promise<PipelineResult & { actions?: Action[] }> {
  const ex = await extract(deps.provider, text, channel);
  if (!ex.ok) {
    deps.log.write({ input, stage: "extractor", outcome: "refused", reason: ex.reason, summary: "Input dropped by the extractor" });
    return { outcome: "refused", stage: "extractor", reason: ex.reason };
  }
  const state = await deps.state();
  const planned = await plan(deps.provider, { invoice: ex.invoice, ...state, payees: deps.payees, plans: deps.plans });
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
  return { outcome: "proposed", stage: "planner", invoice: ex.invoice, actions: planned.actions };
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
  if (!u.actions) return u;
  return act(u.actions, input, deps.sink, u.invoice);
}
