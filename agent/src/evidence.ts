// npm run evidence [-- <run-file.json>] [--write]
// Turns the latest agent/logs/run-<runId>.json into markdown rows for docs/EVIDENCE.md, printed to stdout.
// --write also replaces the "Latest run" section of docs/EVIDENCE.md (between the evidence markers).

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, PATHS } from "./config.ts";
import { isMain } from "./isMain.ts";
import type { RunFile } from "./replay/run.ts";

const EXPLORER: Record<string, string> = { "base-sepolia": "https://sepolia.basescan.org/tx/" };

export function latestRunFile(logDir: string): string | undefined {
  if (!existsSync(logDir)) return undefined;
  return readdirSync(logDir)
    .filter((f) => /^run-.+\.json$/.test(f))
    .map((f) => resolve(logDir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

function hkt(iso: string | undefined, timeZone = "Asia/Hong_Kong"): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

const SIGNAL_NAME: Record<string, string> = { TC1: "No. 1", TC3: "No. 3", TC8NE: "No. 8 NE", TC8SE: "No. 8 SE", TC8NW: "No. 8 NW", TC8SW: "No. 8 SW", TC9: "No. 9", TC10: "No. 10", CANCEL: "Cancelled" };

export function evidenceMarkdown(run: RunFile): string {
  const link = (tx: string) => (EXPLORER[run.network] ? `[${tx.slice(0, 10)}…](${EXPLORER[run.network]}${tx})` : `\`${tx}\``);
  const out: string[] = [];
  out.push(`Run id: ${run.runId} (${run.network}, chain ${run.chainId}); GDACS TC-${run.gdacs.eventId} salted as TC-${run.gdacs.eventId}#${run.runId} = \`${run.gdacs.saltedEventId}\`. ${run.ok ? "Completed" : `Stopped: ${run.error ?? "unknown"}`} ${run.finishedAt ?? ""}`);
  out.push("");
  out.push("| # | Replay time (HKT) | Signal | Action | Tx hash | Result |", "| --- | --- | --- | --- | --- | --- |");
  const replay = run.txs.filter((t) => t.phase === "replay");
  const rows: Array<{ at: string; line: string }> = replay.map((t) => ({
    at: t.replayTime ?? "",
    line: `| ${t.n} | ${hkt(t.replayTime)} | ${SIGNAL_NAME[t.signal ?? ""] ?? t.signal ?? ""} | ${t.label.replace(/\|/g, "\\|")} | ${link(t.tx)} | ok |`,
  }));
  for (const f of run.fakeMessages) {
    rows.push({ at: f.replayTime, line: `| - | ${hkt(f.replayTime)} | | Fake ${f.channel}: ${f.outcome} at ${f.stage}${f.reason ? ` (${f.reason})` : ""} | n/a | ${f.outcome} |` });
  }
  rows.sort((a, b) => a.at.localeCompare(b.at));
  out.push(...rows.map((r) => r.line));
  const everyday = run.txs.filter((t) => t.phase === "everyday");
  if (everyday.length) {
    out.push("", "| # | Action | Tx hash | Result |", "| --- | --- | --- | --- |");
    for (const t of everyday) out.push(`| ${t.n} | ${t.label.replace(/\|/g, "\\|")} | ${link(t.tx)} | ok |`);
  }
  return out.join("\n");
}

const START = "<!-- evidence:start -->";
const END = "<!-- evidence:end -->";

/** EVIDENCE.md with the text between the evidence markers replaced; throws if the markers are missing. */
export function withEvidence(doc: string, markdown: string): string {
  const i = doc.indexOf(START);
  const j = doc.indexOf(END);
  if (i < 0 || j < i) throw new Error(`docs/EVIDENCE.md has no ${START} … ${END} section`);
  return `${doc.slice(0, i + START.length)}\n${markdown}\n${doc.slice(j)}`;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const path = file ? resolve(file) : latestRunFile(loadConfig().logDir);
  if (!path) {
    console.error("no run file in agent/logs; run npm run replay first");
    process.exit(1);
  }
  const md = evidenceMarkdown(JSON.parse(readFileSync(path, "utf8")) as RunFile);
  console.log(md);
  if (args.includes("--write")) {
    const doc = resolve(PATHS.fixtures, "..", "..", "docs", "EVIDENCE.md");
    writeFileSync(doc, withEvidence(readFileSync(doc, "utf8"), md));
    console.log(`\nWrote the Latest run section of ${doc}`);
  }
}
