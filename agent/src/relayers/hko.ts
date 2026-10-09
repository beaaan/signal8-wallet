// HKO relayer: reads the Hong Kong Observatory warning summary and maps the tropical cyclone signal to a level.
// Spec: docs/specs/agent.md#hko-relayershkots
// Signing and submitting the EIP-712 attestation is still to build (relayers/sign.ts).
//
// Run once:  npm run hko:now
// (on Node 22 without tsx: NODE_USE_ENV_PROXY=1 node --experimental-strip-types src/relayers/hko.ts)

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

export async function fetchHkoSignal(url: string = HKO_WARNSUM_URL): Promise<HkoSignal> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`warnsum: HTTP ${res.status}`);
  return parseWarnsum(await res.json());
}

// Self-test of the parser, plus a live fetch when run directly.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const cases: Array<[unknown, number]> = [
    [{}, 0],
    [{ WTCSGNL: { name: "Tropical Cyclone Warning Signal", code: "TC8NW", actionCode: "ISSUE" } }, 8],
    [{ WTCSGNL: { code: "TC10", actionCode: "ISSUE" } }, 10],
    [{ WTCSGNL: { code: "CANCEL", actionCode: "CANCEL" } }, 0],
    [{ WRAIN: { code: "WRAINA" } }, 0],
  ];
  for (const [body, want] of cases) {
    const got = parseWarnsum(body).level;
    if (got !== want) throw new Error(`parser self-test failed: ${JSON.stringify(body)} → ${got}, want ${want}`);
  }
  console.log("parser self-test: ok");
  fetchHkoSignal()
    .then((s) => console.log("live HKO signal:", s))
    .catch((err) => {
      console.error("live fetch failed:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
