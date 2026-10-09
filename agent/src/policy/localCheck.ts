// Local replay of PlanModule's checks, run before anything is signed (defence in depth).
// Same order and the same error names as the contract: docs/specs/contracts.md#agent-functions
//
// Pure: works on a snapshot of on-chain state (chain.ts readSnapshot), so it is unit-tested without a chain.

import { ACTION_BIT, PLAN_ID } from "../plan.ts";

export type Hex = `0x${string}`;

/** One resolved PlanModule call: what the executor is about to send. */
export type PlanCall =
  | { fn: "pay"; planId: number; to: Hex; amount: bigint; ref: Hex }
  | { fn: "vaultDeposit"; planId: number; amount: bigint; ref: Hex }
  | { fn: "vaultWithdraw"; planId: number; amount: bigint; ref: Hex }
  | { fn: "creditDraw"; planId: 1; amount: bigint; ref: Hex }
  | { fn: "claimCover"; planId: 1; ref: Hex }
  | { fn: "anchor"; hash: Hex; kind: Hex };

export interface PlanState {
  perTxCap: bigint;
  dailyCap: bigint;
  creditCapPerEvent: bigint;
  actions: number;
  active: boolean;
  planHash: Hex;
}

/** The on-chain state the checks need. payeePlans and refUsed cover at least the call's payee and ref. */
export interface Snapshot {
  paused: boolean;
  isStorm: boolean;
  plans: Record<number, PlanState>;
  dailyCeiling: bigint;
  spentToday: Record<number, bigint>;
  spentAllToday: bigint;
  eventId: Hex;
  drawnInEvent: bigint;
  payeePlans: Record<string, number>; // lowercase address → plan mask
  refUsed: Record<string, boolean>; // lowercase ref → used
}

export type CheckError =
  | "Paused"
  | "PlanInactive"
  | "StormNotActive"
  | "ActionNotAllowed"
  | "RefUsed"
  | "PayeeNotInPlan"
  | "OverPerTxCap"
  | "OverDailyCap"
  | "OverDailyCeiling"
  | "OverCreditCap";

export type CheckResult = { ok: true } | { ok: false; error: CheckError; outsidePlan: boolean };

const FN_BIT: Record<Exclude<PlanCall["fn"], "anchor">, number> = {
  pay: ACTION_BIT.pay,
  vaultDeposit: ACTION_BIT.vault_deposit,
  vaultWithdraw: ACTION_BIT.vault_withdraw,
  creditDraw: ACTION_BIT.credit_draw,
  claimCover: ACTION_BIT.cover_claim,
};

/**
 * "Outside the plan" refusals: the payment itself may be legitimate, so it goes to the owners as a Safe proposal
 * instead of being dropped. Only payments to payees registered in some plan qualify (see executor.ts).
 */
const OUTSIDE_PLAN: ReadonlySet<CheckError> = new Set(["PayeeNotInPlan", "OverPerTxCap", "OverDailyCap", "OverDailyCeiling"]);

function fail(error: CheckError): CheckResult {
  return { ok: false, error, outsidePlan: OUTSIDE_PLAN.has(error) };
}

export function localCheck(call: PlanCall, s: Snapshot): CheckResult {
  if (s.paused) return fail("Paused");
  if (call.fn === "anchor") return { ok: true };

  const plan = s.plans[call.planId];
  if (!plan?.active) return fail("PlanInactive");
  if (call.planId === PLAN_ID.storm && !s.isStorm) return fail("StormNotActive");
  if ((plan.actions & FN_BIT[call.fn]) === 0) return fail("ActionNotAllowed");
  if (s.refUsed[call.ref.toLowerCase()]) return fail("RefUsed");

  if (call.fn === "pay") {
    const mask = s.payeePlans[call.to.toLowerCase()] ?? 0;
    if ((mask & (1 << call.planId)) === 0) return fail("PayeeNotInPlan");
    if (call.amount > plan.perTxCap) return fail("OverPerTxCap");
    if ((s.spentToday[call.planId] ?? 0n) + call.amount > plan.dailyCap) return fail("OverDailyCap");
    if (s.spentAllToday + call.amount > s.dailyCeiling) return fail("OverDailyCeiling");
  }
  if (call.fn === "creditDraw") {
    const storm = s.plans[PLAN_ID.storm]!;
    if (s.drawnInEvent + call.amount > storm.creditCapPerEvent) return fail("OverCreditCap");
  }
  return { ok: true };
}
