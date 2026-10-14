// Replay timeline: loads data/replays/<event>.json and puts its steps on a compressed clock.
// Spec: docs/specs/agent.md#replay-replayrunnerts

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TC_LEVEL } from "../relayers/hko.ts";

export interface ReplaySignal {
  time: string;
  code: string;
  approximate?: boolean;
  note?: string;
}

export interface ReplayFile {
  id: string;
  name: string;
  region: string;
  timezone?: string;
  gdacs: { eventId: string; alertLevel: string; affectedCountries?: string[]; from?: string; to?: string };
  signals: ReplaySignal[];
  levelMap?: Record<string, number>;
  scenario?: {
    business?: string;
    payday?: string;
    /** The customer payment after the storm, in token units (default "5000", the Ragasa demo's mUSD). */
    afterStormInflow?: string;
    fakeMessages?: Array<{ time: string; channel: string; text: string }>;
  };
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
