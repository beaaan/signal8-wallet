// GDACS relayer: confirms a tropical-cyclone event affecting the region and builds the GDACS attestation.
// Spec: docs/specs/agent.md#gdacs-relayersgdacsts
//
// Live check:  npx tsx src/relayers/gdacs.ts [fromDate] [toDate]
// Live relayer (attest Orange/Red, re-attest every 6 h while current): npm run relayer:gdacs -- --live
// Tests: test/gdacs.test.ts

import { keccak256, toBytes } from "viem";
import { isMain } from "../isMain.ts";
import { toUnixSeconds } from "./hko.ts";
import { SOURCE, type Hex, type SignalAttestation } from "./sign.ts";

export const GDACS_EVENTS_URL = process.env.GDACS_EVENTS_URL ?? "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH";

/** Region → ISO3 codes GDACS uses. GDACS lists Hong Kong as CHN (RAGASA-25 shows PHL, CHN). */
export const REGION_COUNTRIES: Record<string, string[]> = {
  HK: ["HKG", "CHN"],
  "VN-QN-HP": ["VNM"],
};

export const ALERT_LEVEL: Record<string, number> = { green: 1, orange: 2, red: 3 };

export interface GdacsEvent {
  eventId: string; // GDACS numeric id as a string, e.g. "1001211"
  name: string;
  alertLevel: number; // 1 green, 2 orange, 3 red
  countries: string[]; // ISO3
  fromDate?: string; // ISO, UTC
  toDate?: string;
  isCurrent: boolean;
}

/** GDACS dates come without a zone ("2025-09-18T12:00:00"); they are UTC. */
function utc(s: unknown): string | undefined {
  if (typeof s !== "string" || s === "") return undefined;
  return /Z|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`;
}

function countriesOf(p: Record<string, unknown>): string[] {
  const raw = p["affectedcountries"];
  if (Array.isArray(raw)) {
    return raw
      .map((c) => (typeof c === "string" ? c : typeof c === "object" && c !== null ? String((c as Record<string, unknown>)["iso3"] ?? "") : ""))
      .filter(Boolean)
      .map((c) => c.toUpperCase());
  }
  if (typeof p["iso3"] === "string") return [p["iso3"].toUpperCase()];
  return [];
}

/** Parse the event list GeoJSON. Features that are not tropical cyclones or have an unknown alert level are skipped. */
export function parseGdacsEvents(body: unknown): GdacsEvent[] {
  if (typeof body !== "object" || body === null || !Array.isArray((body as Record<string, unknown>)["features"])) {
    throw new Error("gdacs: body is not a GeoJSON FeatureCollection");
  }
  const out: GdacsEvent[] = [];
  for (const f of (body as { features: unknown[] }).features) {
    const p = (f as { properties?: Record<string, unknown> })?.properties;
    if (!p) continue;
    if (p["eventtype"] !== undefined && p["eventtype"] !== "TC") continue;
    const level = ALERT_LEVEL[String(p["alertlevel"] ?? "").toLowerCase()];
    if (level === undefined || p["eventid"] === undefined) continue;
    out.push({
      eventId: String(p["eventid"]),
      name: String(p["name"] ?? p["eventname"] ?? ""),
      alertLevel: level,
      countries: countriesOf(p),
      fromDate: utc(p["fromdate"]),
      toDate: utc(p["todate"]),
      isCurrent: p["iscurrent"] === true || String(p["iscurrent"]).toLowerCase() === "true",
    });
  }
  return out;
}

export function affectsRegion(e: GdacsEvent, region: string): boolean {
  const accepted = REGION_COUNTRIES[region];
  if (!accepted) throw new Error(`gdacs: no country mapping for region ${region}`);
  return e.countries.some((c) => accepted.includes(c));
}

/** The highest-alert current event affecting the region, if any. */
export function pickEvent(events: GdacsEvent[], region: string): GdacsEvent | undefined {
  return events.filter((e) => e.isCurrent && affectsRegion(e, region)).sort((a, b) => b.alertLevel - a.alertLevel)[0];
}

/** keccak256("TC-<id>"), or keccak256("TC-<id>#<runId>") in replays so each run is a new event on-chain. */
export function gdacsEventId(eventId: string, runId?: string): Hex {
  return keccak256(toBytes(`TC-${eventId}${runId ? `#${runId}` : ""}`));
}

export function buildGdacsAttestation(
  e: GdacsEvent,
  opts: { region: string; regionId: Hex; nonce: bigint; issuedAt: bigint; runId?: string },
): SignalAttestation {
  if (!affectsRegion(e, opts.region)) throw new Error(`gdacs: event ${e.eventId} does not affect ${opts.region}`);
  return {
    source: SOURCE.GDACS,
    region: opts.regionId,
    level: e.alertLevel,
    eventId: gdacsEventId(e.eventId, opts.runId),
    sourceTime: toUnixSeconds(e.fromDate, opts.issuedAt),
    issuedAt: opts.issuedAt,
    nonce: opts.nonce,
  };
}

/** The recorded event in data/replays/<event>.json; replays treat it as current. */
export function eventFromReplay(g: { eventId: string; alertLevel: string; affectedCountries?: string[]; from?: string; to?: string; name?: string }): GdacsEvent {
  const level = ALERT_LEVEL[g.alertLevel.toLowerCase()];
  if (level === undefined) throw new Error(`gdacs: unknown alert level ${g.alertLevel}`);
  return {
    eventId: g.eventId,
    name: g.name ?? "",
    alertLevel: level,
    countries: (g.affectedCountries ?? []).map((c) => c.toUpperCase()),
    fromDate: g.from,
    toDate: g.to,
    isCurrent: true,
  };
}

export async function fetchGdacsEvents(fromDate: string, toDate: string, base = GDACS_EVENTS_URL, fetchImpl: typeof fetch = fetch): Promise<GdacsEvent[]> {
  const url = `${base}?eventlist=TC&fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`;
  const res = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`gdacs: HTTP ${res.status}`);
  return parseGdacsEvents(await res.json());
}

if (isMain(import.meta.url)) {
  const today = new Date().toISOString().slice(0, 10);
  const from = process.argv[2] ?? new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  fetchGdacsEvents(from, process.argv[3] ?? today)
    .then((events) => {
      for (const e of events) console.log(`${e.eventId} ${e.name} level ${e.alertLevel} ${e.countries.join(",")} current=${e.isCurrent}`);
      console.log("event for HK:", pickEvent(events, "HK") ?? "none");
    })
    .catch((err) => {
      console.error("live fetch failed:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
