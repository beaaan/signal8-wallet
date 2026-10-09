// Deterministic bytes32 refs (docs/specs/agent.md#schemas-typests): a retried or duplicated action
// reverts with RefUsed() instead of paying twice.
//
// The Action's `ref` string says which rule applies:
//   pay, ref "payroll:<payPeriod>"  → keccak256(abi.encode(employee, payPeriod))
//   pay, any other ref              → keccak256(abi.encode(payee, normalised invoiceId)), the ref string being
//                                     the invoice id; "lk 0917" and "LK-0917" are the same invoice, and two
//                                     suppliers may both send an invoice numbered "1001"
//   every other action              → keccak256(actionId), the ref string being the action id
// Replays put the run id in payPeriod / actionId ("2025-09#<runId>") so reruns on one chain don't collide.

import { encodeAbiParameters, keccak256, toBytes } from "viem";
import type { Action } from "../types.ts";

export type Hex = `0x${string}`;

export const PAYROLL_PREFIX = "payroll:";

/** "LK 0917", "lk-0917" and "LK0917" are one invoice number. A replay's "#<runId>" suffix is kept as is. */
export function normaliseInvoiceId(invoiceId: string): string {
  const i = invoiceId.indexOf("#");
  const id = i < 0 ? invoiceId : invoiceId.slice(0, i);
  return id.toUpperCase().replace(/[^A-Z0-9]/g, "") + (i < 0 ? "" : invoiceId.slice(i));
}

export function invoiceRef(payee: Hex, invoiceId: string): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "string" }], [payee, normaliseInvoiceId(invoiceId)]));
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
      : invoiceRef(action.payee, action.ref);
  }
  return actionRef(action.ref);
}
