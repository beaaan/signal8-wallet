// Plan book: types, canonical JSON and hash. Spec: docs/specs/plans.md.
// canonicalJson and planHash are copied from agent/src/plan.ts and must stay byte-for-byte equivalent;
// `npm run check:plan-hash` compares the two.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { keccak256, stringToBytes } from "viem";
import { config } from "./config";

export type PlanName = "base" | "storm";
export type PlanAction = "pay" | "vault_deposit" | "vault_withdraw" | "credit_draw" | "cover_claim";

export interface PlanRules {
  perTxCap: string;
  dailyCap: string;
  creditCapPerEvent: string;
  actions: PlanAction[];
}

export interface Payee {
  id: string;
  name: string;
  address: `0x${string}`;
  role: "staff" | "supplier" | "other";
  plans: PlanName[];
}

export interface Citation {
  rule: string;
  doc: string;
  clause: string;
  quote: string;
}

/** Same shape as PlanBook in agent/src/types.ts (the agent validates it with zod). */
export interface PlanBook {
  version: 1;
  business: string;
  region: string;
  token: { symbol: string; decimals: number };
  dailyCeiling: string;
  payees: Payee[];
  plans: { base: PlanRules; storm: PlanRules };
  summary: Record<string, string>;
  citations: Citation[];
}

/** Action bits, same values as ACT_* in IPlanModule.sol. */
export const ACTION_BIT: Record<PlanAction, number> = {
  pay: 1 << 0,
  vault_deposit: 1 << 1,
  vault_withdraw: 1 << 2,
  credit_draw: 1 << 3,
  cover_claim: 1 << 4,
};

/** Plan ids, same values as BASE and STORM in IPlanModule.sol. */
export const PLAN_ID: Record<PlanName, number> = { base: 0, storm: 1 };

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

/** Light shape check; the agent's zod schema is the real validator. Throws with a readable message. */
export function checkPlanBook(json: unknown): PlanBook {
  const b = json as Partial<PlanBook> | null;
  const fail = (what: string) => {
    throw new Error(`plan book: ${what}`);
  };
  if (!b || typeof b !== "object") fail("not an object");
  if (b!.version !== 1) fail("version must be 1");
  if (!b!.token || typeof b!.token.decimals !== "number") fail("token.decimals missing");
  if (!Array.isArray(b!.payees)) fail("payees missing");
  if (!b!.plans?.base || !b!.plans?.storm) fail("plans.base / plans.storm missing");
  if (!b!.summary || typeof b!.summary !== "object") fail("summary missing");
  if (!Array.isArray(b!.citations)) fail("citations missing");
  return b as PlanBook;
}

export type PlanBookResult =
  | { ok: true; book: PlanBook; file: string; hash: `0x${string}` }
  | { ok: false; reason: string };

/** Loads data/fixtures/plans/plan-book.json, falling back to plan-book.example.json. Server only. */
export async function loadPlanBook(): Promise<PlanBookResult> {
  for (const file of config.planBookFiles) {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const shown = path.relative(config.repoRoot, file).split(path.sep).join("/");
    try {
      const book = checkPlanBook(JSON.parse(raw));
      return { ok: true, book, file: shown, hash: planHash(book) };
    } catch (e) {
      return { ok: false, reason: `${shown}: ${(e as Error).message}` };
    }
  }
  return { ok: false, reason: "No plan book found in data/fixtures/plans/." };
}
