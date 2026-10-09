// Plan book hashing and chain parameters. Spec: docs/specs/plans.md
//
// npm run plan:hash -- ../data/fixtures/plans/plan-book.example.json
//
// Prints the plan hash and the on-chain parameters the deploy script (or a queueChange proposal) uses.

import { readFileSync } from "node:fs";
import { keccak256, parseUnits, stringToBytes } from "viem";
import { isMain } from "./isMain.ts";
import { PlanBook } from "./types.ts";

/** Action bits, same values as ACT_* in contracts/src/interfaces/IPlanModule.sol. */
export const ACTION_BIT = {
  pay: 1 << 0,
  vault_deposit: 1 << 1,
  vault_withdraw: 1 << 2,
  credit_draw: 1 << 3,
  cover_claim: 1 << 4,
} as const;

/** Plan ids, same values as BASE and STORM in IPlanModule.sol. */
export const PLAN_ID = { base: 0, storm: 1 } as const;

/**
 * Canonical JSON (RFC 8785, JCS): object keys sorted by UTF-16 code units, no whitespace,
 * strings and numbers serialised as JSON.stringify does. Same document, same bytes, same hash.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
    const s = JSON.stringify(value);
    if (s === undefined) throw new Error(`canonicalJson: cannot serialise ${typeof value}`);
    return s;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** keccak256 of the canonical plan book. Both on-chain plans store this as planHash. */
export function planHash(book: PlanBook): `0x${string}` {
  return keccak256(stringToBytes(canonicalJson(book)));
}

export interface ChainPlan {
  perTxCap: bigint;
  dailyCap: bigint;
  creditCapPerEvent: bigint;
  actions: number;
  active: true;
  planHash: `0x${string}`;
}

export interface ChainParams {
  planHash: `0x${string}`;
  /** The deploy script checks it against REGION, so a Yagi plan book cannot be deployed as HK. */
  region: string;
  dailyCeiling: bigint;
  plans: { base: ChainPlan; storm: ChainPlan };
  payees: Array<{ address: `0x${string}`; planMask: number }>;
}

/** What the plan book means on-chain: token units, action bits and payee plan masks. */
export function toChainParams(book: PlanBook): ChainParams {
  const hash = planHash(book);
  const units = (v: string) => parseUnits(v, book.token.decimals);
  const plan = (p: keyof PlanBook["plans"]): ChainPlan => {
    const r = book.plans[p];
    return {
      perTxCap: units(r.perTxCap),
      dailyCap: units(r.dailyCap),
      creditCapPerEvent: units(r.creditCapPerEvent),
      actions: r.actions.reduce((bits, a) => bits | ACTION_BIT[a], 0),
      active: true,
      planHash: hash,
    };
  };
  return {
    planHash: hash,
    region: book.region,
    dailyCeiling: units(book.dailyCeiling),
    plans: { base: plan("base"), storm: plan("storm") },
    payees: book.payees.map((p) => ({
      address: p.address,
      planMask: p.plans.reduce((mask, name) => mask | (1 << PLAN_ID[name]), 0),
    })),
  };
}

export function loadPlanBook(path: string): PlanBook {
  return PlanBook.parse(JSON.parse(readFileSync(path, "utf8")));
}

if (isMain(import.meta.url)) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: npm run plan:hash -- <plan-book.json>");
    process.exit(1);
  }
  const params = toChainParams(loadPlanBook(path));
  // bigint → decimal string so the output is plain JSON for Foundry's vm.parseJson
  console.log(JSON.stringify(params, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}
