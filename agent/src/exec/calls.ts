// Pure helpers shared by the executor, the Safe proposer and the loops: token units, Action → PlanModule call,
// and the one-line descriptions written to the decision log.

import { formatUnits, parseUnits, stringToHex } from "viem";
import { PLAN_ID } from "../plan.ts";
import type { Hex, PlanCall } from "../policy/localCheck.ts";
import { tokenSymbol } from "../token.ts";
import type { Action } from "../types.ts";
import { refFor } from "./refs.ts";

export type PlainAction = Exclude<Action, { type: "propose_to_owner" }>;

export const TOKEN_DECIMALS = 6;

export function units(amount: string): bigint {
  return parseUnits(amount, TOKEN_DECIMALS);
}

/** Token units → "1,250.5" for people. */
export function fmt(amount: bigint): string {
  return Number(formatUnits(amount, TOKEN_DECIMALS)).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Token units → "1250.5" for Action amounts. */
export function plain(amount: bigint): string {
  return formatUnits(amount, TOKEN_DECIMALS);
}

export function toCall(action: PlainAction): PlanCall {
  switch (action.type) {
    case "pay":
      return { fn: "pay", planId: PLAN_ID[action.plan], to: action.payee, amount: units(action.amount), ref: refFor(action) };
    case "vault_deposit":
      return { fn: "vaultDeposit", planId: PLAN_ID.base, amount: units(action.amount), ref: refFor(action) };
    case "vault_withdraw":
      return { fn: "vaultWithdraw", planId: PLAN_ID[action.plan], amount: units(action.amount), ref: refFor(action) };
    case "credit_draw":
      return { fn: "creditDraw", planId: 1, amount: units(action.amount), ref: refFor(action) };
    case "cover_claim":
      return { fn: "claimCover", planId: 1, ref: refFor(action) };
    case "anchor":
      return { fn: "anchor", hash: action.hash, kind: stringToHex(action.kind, { size: 32 }) };
  }
}

/** One plain-language line for the decision log, in the deployment's token (mUSD, or mVND on FISCO). */
export function describe(action: Action, names: Map<string, string> = new Map()): string {
  const who = (a: Hex) => names.get(a.toLowerCase()) ?? a;
  const t = tokenSymbol();
  switch (action.type) {
    case "pay":
      return `Pay ${action.amount} ${t} to ${who(action.payee)} under the ${action.plan} plan (${action.ref})`;
    case "vault_deposit":
      return `Move ${action.amount} ${t} of surplus into the money-market vault`;
    case "vault_withdraw":
      return `Withdraw ${action.amount} ${t} from the vault to the Safe (${action.plan} plan)`;
    case "credit_draw":
      return `Draw ${action.amount} ${t} of emergency credit (storm plan)`;
    case "cover_claim":
      return "Claim the typhoon cover payout (storm plan)";
    case "anchor":
      return `Anchor ${action.kind} evidence hash ${action.hash.slice(0, 10)}…`;
    case "propose_to_owner":
      return `Owner proposal: ${describe(action.action, names)}`;
  }
}
