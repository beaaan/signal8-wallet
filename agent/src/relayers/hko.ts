// HKO relayer: reads the Hong Kong Observatory warning summary and maps the tropical cyclone signal to a level.
// Spec: docs/specs/agent.md#hko-relayershkots
// buildHkoAttestation turns a signal into the SignalAttestation the HKO relayer signs (relayers/sign.ts)
// and submits (relayers/submit.ts).
//
// Run once:  npm run hko:now     Live relayer (poll 60 s, attest on change, re-attest every 6 h at ≥ 8): npm run relayer:hko -- --live
// (on Node 22 without tsx: NODE_USE_ENV_PROXY=1 node --experimental-strip-types src/relayers/hko.ts)
// Parser tests: test/hko.test.ts

import { isMain } from "../isMain.ts";
import { SOURCE, ZERO32, type Hex, type SignalAttestation } from "./sign.ts";

export const HKO_WARNSUM_URL =
  process.env.HKO_WARNSUM_URL ??
  "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=en";

/** HKO tropical cyclone signal code → level used in SignalAttestation. */
export const TC_LEVEL: Record<string, number> = {
  TC1: 1,
  TC3: 3,
  TC8NE: 8,
  TC8SE: 8,
  TC8NW: 8,
  TC8SW: 8,
  TC9: 9,
  TC10: 10,
  CANCEL: 0,
};

export interface HkoSignal {
  code: string; // e.g. "TC8NE", or "NONE" when no tropical cyclone warning is in force
  level: number; // 0, 1, 3, 8, 9, 10
  actionCode?: string; // ISSUE, REISSUE, CANCEL, EXTEND, UPDATE
  issueTime?: string; // ISO time from HKO
  updateTime?: string;
}

/** Parse a warnsum JSON body. An empty object means no warnings are in force. */
export function parseWarnsum(body: unknown): HkoSignal {
  if (typeof body !== "object" || body === null) throw new Error("warnsum: body is not an object");
  const entry = (body as Record<string, unknown>)["WTCSGNL"];
  if (entry === undefined) return { code: "NONE", level: 0 };
  if (typeof entry !== "object" || entry === null) throw new Error("warnsum: WTCSGNL is not an object");
  const e = entry as Record<string, unknown>;
  const code = String(e["code"] ?? "");
  const level = TC_LEVEL[code];
  if (level === undefined) throw new Error(`warnsum: unknown tropical cyclone code "${code}"`);
  return {
    code,
    level,
    actionCode: e["actionCode"] === undefined ? undefined : String(e["actionCode"]),
    issueTime: e["issueTime"] === undefined ? undefined : String(e["issueTime"]),
    updateTime: e["updateTime"] === undefined ? undefined : String(e["updateTime"]),
  };
}

/** Official time (unix seconds) from an HKO ISO time; falls back to the signing time when HKO gave none. */
export function toUnixSeconds(iso: string | undefined, fallback: bigint): bigint {
  if (!iso) return fallback;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) throw new Error(`bad time "${iso}"`);
  return BigInt(Math.floor(ms / 1000));
}

/**
 * The attestation the HKO relayer signs: eventId is always zero (only GDACS carries the event id),
 * sourceTime is HKO's issueTime, issuedAt is the signing time. The Yagi variant passes source NCHMF.
 */
export function buildHkoAttestation(
  signal: Pick<HkoSignal, "level" | "issueTime">,
  opts: { region: Hex; nonce: bigint; issuedAt: bigint; source?: Hex },
): SignalAttestation {
  if (![0, 1, 3, 8, 9, 10].includes(signal.level)) throw new Error(`HKO level ${signal.level} is not one the attestor accepts`);
  return {
    source: opts.source ?? SOURCE.HKO,
    region: opts.region,
    level: signal.level,
    eventId: ZERO32,
    sourceTime: toUnixSeconds(signal.issueTime, opts.issuedAt),
    issuedAt: opts.issuedAt,
    nonce: opts.nonce,
  };
}

export async function fetchHkoSignal(url: string = HKO_WARNSUM_URL, fetchImpl: typeof fetch = fetch): Promise<HkoSignal> {
  const res = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`warnsum: HTTP ${res.status}`);
  return parseWarnsum(await res.json());
}

// Live fetch when run directly.
if (isMain(import.meta.url)) {
  fetchHkoSignal()
    .then((s) => console.log("live HKO signal:", s))
    .catch((err) => {
      console.error("live fetch failed:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
