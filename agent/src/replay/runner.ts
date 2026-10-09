// Replay runner: loads a recorded storm timeline and plays it on a compressed clock.
// Spec: docs/specs/agent.md#replay-replayrunnerts
//
// npm run replay -- --event ragasa-2025 --speed 600 --dry-run
//
// What exists now: loading, validation, level mapping and the compressed clock (dry run prints each step).
// To build: hand each step to the HKO/GDACS relayers (sign + attest) and tick the storm loop.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TC_LEVEL } from "../relayers/hko.ts";

interface ReplaySignal {
  time: string;
  code: string;
  approximate?: boolean;
  note?: string;
}

interface ReplayFile {
  id: string;
  name: string;
  region: string;
  gdacs: { eventId: string; alertLevel: string };
  signals: ReplaySignal[];
  levelMap?: Record<string, number>;
  scenario?: { fakeMessages?: Array<{ time: string; channel: string; text: string }> };
}

export interface ReplayStep {
  at: Date; // original time
  delayMs: number; // compressed delay since the previous step
  kind: "signal" | "fake_message";
  code: string;
  level?: number;
  detail?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "../../../data/replays");

export function loadReplay(id: string): ReplayFile {
  const file = JSON.parse(readFileSync(resolve(dataDir, `${id}.json`), "utf8")) as ReplayFile;
  if (!Array.isArray(file.signals) || file.signals.length === 0) throw new Error(`${id}: no signals`);
  return file;
}

export function buildSteps(file: ReplayFile, speed: number): ReplayStep[] {
  const levels = { ...TC_LEVEL, ...(file.levelMap ?? {}) };
  const raw: Omit<ReplayStep, "delayMs">[] = [
    ...file.signals.map((s) => {
      const level = levels[s.code];
      if (level === undefined) throw new Error(`${file.id}: unknown code ${s.code}`);
      return { at: new Date(s.time), kind: "signal" as const, code: s.code, level, detail: s.note };
    }),
    ...(file.scenario?.fakeMessages ?? []).map((m) => ({
      at: new Date(m.time),
      kind: "fake_message" as const,
      code: m.channel,
      detail: m.text,
    })),
  ];
  for (const r of raw) if (Number.isNaN(r.at.getTime())) throw new Error(`${file.id}: bad time for ${r.code}`);
  raw.sort((a, b) => a.at.getTime() - b.at.getTime());
  return raw.map((r, i) => ({
    ...r,
    delayMs: i === 0 ? 0 : Math.round((r.at.getTime() - raw[i - 1]!.at.getTime()) / speed),
  }));
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const id = arg("event", "ragasa-2025")!;
  const speed = Number(arg("speed", "600"));
  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun) {
    console.error("Only --dry-run is implemented so far; relayer submission is still to build.");
    process.exit(1);
  }
  const file = loadReplay(id);
  const steps = buildSteps(file, speed);
  console.log(`${file.name} (${file.id}), region ${file.region}, GDACS ${file.gdacs.eventId}, speed ${speed}x`);
  let storm = false;
  for (const s of steps) {
    await new Promise((r) => setTimeout(r, Math.min(s.delayMs, 2000))); // capped so a dry run stays short
    if (s.kind === "signal") {
      const nowStorm = (s.level ?? 0) >= 8;
      const change = nowStorm !== storm ? (nowStorm ? "  → STORM MODE ON" : "  → storm mode off") : "";
      storm = nowStorm;
      console.log(`${s.at.toISOString()}  ${s.code.padEnd(12)} level ${String(s.level).padStart(2)}${change}`);
    } else {
      console.log(`${s.at.toISOString()}  ${s.code.padEnd(12)} fake message (should be refused): "${s.detail?.slice(0, 60)}…"`);
    }
  }
}
