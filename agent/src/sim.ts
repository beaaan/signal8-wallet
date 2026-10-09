// Offline simulation of the "ours" side: PlanModule state built from the plan book, and an ActionSink that applies
// the same localCheck and owner-proposal rules as the executor without a chain. Used by the tests and `npm run redteam`.

import type { ActionSink, ExecResult } from "./exec/executor.ts";
import { describe, toCall, type PlainAction } from "./exec/calls.ts";
import { toChainParams } from "./plan.ts";
import { localCheck, type Hex, type Snapshot } from "./policy/localCheck.ts";
import type { Action, PlanBook } from "./types.ts";

/** What PlanModule would hold right after deployment from this plan book. */
export function chainSnapshot(book: PlanBook, isStorm: boolean): Snapshot {
  const params = toChainParams(book);
  return {
    paused: false,
    isStorm,
    plans: { 0: { ...params.plans.base }, 1: { ...params.plans.storm } },
    dailyCeiling: params.dailyCeiling,
    spentToday: { 0: 0n, 1: 0n },
    spentAllToday: 0n,
    eventId: `0x${"00".repeat(32)}`,
    drawnInEvent: 0n,
    payeePlans: Object.fromEntries(params.payees.map((p) => [p.address.toLowerCase(), p.planMask])),
    refUsed: {},
  };
}

/** An executor stand-in: localCheck on the simulated state, owner proposals for registered payees, and it records what would have been sent. */
export class SimSink implements ActionSink {
  executed: PlainAction[] = [];
  proposed: PlainAction[] = [];
  constructor(readonly snap: Snapshot) {}

  private registered(addr: Hex): boolean {
    return (this.snap.payeePlans[addr.toLowerCase()] ?? 0) !== 0;
  }

  async run(action: Action, _input: string): Promise<ExecResult> {
    const summary = describe(action);
    if (action.type === "propose_to_owner") {
      if (action.action.type === "pay" && !this.registered(action.action.payee)) return { outcome: "refused", stage: "localCheck", reason: "PayeeNotRegistered", summary };
      this.proposed.push(action.action);
      return { outcome: "proposed", stage: "owner", reason: action.reason, summary };
    }
    const call = toCall(action);
    const check = localCheck(call, this.snap);
    if (!check.ok) {
      if (check.outsidePlan && call.fn === "pay" && this.registered(call.to)) {
        this.proposed.push(action);
        return { outcome: "proposed", stage: "localCheck", reason: check.error, summary };
      }
      return { outcome: "refused", stage: "localCheck", reason: check.error, summary };
    }
    // Apply the effects PlanModule would record, so later actions in the same run see them.
    if ("ref" in call) this.snap.refUsed[call.ref.toLowerCase()] = true;
    if (call.fn === "pay") {
      this.snap.spentToday[call.planId] = (this.snap.spentToday[call.planId] ?? 0n) + call.amount;
      this.snap.spentAllToday += call.amount;
    }
    if (call.fn === "creditDraw") this.snap.drawnInEvent += call.amount;
    this.executed.push(action);
    return { outcome: "executed", stage: "chain", tx: `0x${"ab".repeat(32)}`, summary };
  }

  async proposeBatch(reason: string, actions: PlainAction[], _input: string, summary: string): Promise<ExecResult> {
    this.proposed.push(...actions);
    return { outcome: "proposed", stage: "owner", reason, summary };
  }
}
