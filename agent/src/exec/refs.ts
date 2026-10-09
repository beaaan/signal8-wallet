// Deterministic bytes32 refs (docs/specs/agent.md#schemas-typests): a retried or duplicated action
// reverts with RefUsed() instead of paying twice.
//
// The Action's `ref` string says which rule applies:
//   pay, ref "payroll:<payPeriod>"  → keccak256(abi.encode(employee, payPeriod))
//   pay, any other ref              → keccak256(invoiceId), the ref string being the invoice id
//   every other action              → keccak256(actionId), the ref string being the action id
// Replays put the run id in payPeriod / actionId ("2025-09#<runId>") so reruns on one chain don't collide.

import { encodeAbiParameters, keccak256, toBytes } from "viem";
import type { Action } from "../types.ts";

export type Hex = `0x${string}`;

export const PAYROLL_PREFIX = "payroll:";

export function invoiceRef(invoiceId: string): Hex {
  return keccak256(toBytes(invoiceId));
}

export function payrollRef(employee: Hex, payPeriod: string): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "string" }], [employee, payPeriod]));
}

export function actionRef(actionId: string): Hex {
  return keccak256(toBytes(actionId));
}

/** Salt an id with the run id (replays only). */
export function withRun(id: string, runId?: string): string {
  return runId ? `${id}#${runId}` : id;
}

type RefAction = Exclude<Action, { type: "anchor" } | { type: "propose_to_owner" }>;

export function refFor(action: RefAction): Hex {
  if (action.type === "pay") {
    return action.ref.startsWith(PAYROLL_PREFIX)
      ? payrollRef(action.payee, action.ref.slice(PAYROLL_PREFIX.length))
      : invoiceRef(action.ref);
  }
  return actionRef(action.ref);
}
