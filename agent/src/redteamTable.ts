// `npm run redteam:table`: the Markdown tables for docs/SECURITY.md §5 from redteam/results/summary.json.
// One row per attack family (cases, attack success rate and funds lost for the bare agent and for ours), then the
// benign set. A side that has not been run prints "not run". Read-only: it never runs a case.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { PATHS } from "./config.ts";
import { isMain } from "./isMain.ts";

const Family = z.object({ family: z.string(), cases: z.number(), runs: z.number(), attackerWins: z.number(), fundsLost: z.string() }).passthrough();
const Side = z
  .object({
    provider: z.string(),
    generatedAt: z.string().optional(),
    families: z.array(Family),
    benign: z.object({ cases: z.number(), passed: z.number(), falseRefusals: z.number() }).passthrough(),
  })
  .passthrough();
type Side = z.infer<typeof Side>;

export interface Sides {
  bare?: Side;
  ours?: Side;
}

/** Each side parsed on its own, so a malformed or missing side becomes "not run" without hiding the other. */
export function parseSummary(raw: unknown): Sides {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const side = (v: unknown) => {
    const r = Side.safeParse(v);
    return r.success ? r.data : undefined;
  };
  return { bare: side(o["bare"]), ours: side(o["ours"]) };
}

const NOT_RUN = "not run";
const pct = (wins: number, runs: number) => (runs ? `${Math.round((wins / runs) * 100)}% (${wins}/${runs})` : "n/a");

function table(header: string[], rows: string[][]): string {
  return [`| ${header.join(" | ")} |`, `|${header.map(() => " --- ").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

export function formatSecurityTables(s: Sides): string {
  const families = [...new Set([...(s.bare?.families ?? []), ...(s.ours?.families ?? [])].map((f) => f.family))].sort();
  const cell = (side: Side | undefined, family: string | undefined) => {
    if (!side) return [NOT_RUN, NOT_RUN];
    const rows = family ? side.families.filter((f) => f.family === family) : side.families;
    if (rows.length === 0) return ["n/a", "n/a"];
    const wins = rows.reduce((n, f) => n + f.attackerWins, 0);
    const runs = rows.reduce((n, f) => n + f.runs, 0);
    return [pct(wins, runs), rows.reduce((n, f) => n + Number(f.fundsLost), 0).toFixed(2)];
  };
  const cases = (family?: string) => {
    const side = s.ours ?? s.bare;
    const rows = side ? side.families.filter((f) => !family || f.family === family) : [];
    return rows.length ? String(rows.reduce((n, f) => n + f.cases, 0)) : "n/a";
  };
  const attackRows = families.map((f) => [f, cases(f), ...cell(s.bare, f), ...cell(s.ours, f)]);
  attackRows.push(["**all**", cases(), ...cell(s.bare, undefined), ...cell(s.ours, undefined)]);

  const benign = (name: string, side?: Side) =>
    side ? [name, String(side.benign.cases), pct(side.benign.passed, side.benign.cases), String(side.benign.falseRefusals)] : [name, NOT_RUN, NOT_RUN, NOT_RUN];
  const provider = (side?: Side) => (side ? `${side.provider}${side.generatedAt ? `, ${side.generatedAt.slice(0, 10)}` : ""}` : NOT_RUN);

  return [
    `Bare agent: ${provider(s.bare)}. Signal 8 Wallet: ${provider(s.ours)}. Each attack runs on an ordinary day and in storm mode; funds lost in mUSD.`,
    "",
    table(["Family", "Cases", "Bare: attack success", "Bare: funds lost", "Ours: attack success", "Ours: funds lost"], attackRows),
    "",
    table(["Agent", "Benign cases", "Task success", "False refusals"], [benign("Bare agent", s.bare), benign("Signal 8 Wallet", s.ours)]),
  ].join("\n");
}

if (isMain(import.meta.url)) {
  const file = process.argv[2] ?? join(PATHS.redteam, "results", "summary.json");
  let raw: unknown = {};
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.error(`no summary at ${file} yet (npm run redteam, npm run redteam:bare)`);
  }
  console.log(formatSecurityTables(parseSummary(raw)));
}
