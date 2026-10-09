import { keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { affectsRegion, buildGdacsAttestation, eventFromReplay, gdacsEventId, parseGdacsEvents, pickEvent } from "../src/relayers/gdacs.ts";
import { SOURCE } from "../src/relayers/sign.ts";
import { loadReplay } from "../src/replay/runner.ts";

// Trimmed from the GDACS event list for 2025-09-18..26 (RAGASA-25), plus a Green event elsewhere.
const body = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        eventtype: "TC",
        eventid: 1001211,
        episodeid: 25,
        name: "RAGASA-25",
        alertlevel: "Red",
        affectedcountries: [
          { iso2: "PH", iso3: "PHL", countryname: "Philippines" },
          { iso2: "CN", iso3: "CHN", countryname: "China" },
        ],
        fromdate: "2025-09-18T12:00:00",
        todate: "2025-09-24T12:00:00",
        iscurrent: "true",
      },
    },
    {
      type: "Feature",
      properties: { eventtype: "TC", eventid: 1001300, name: "OTHER-25", alertlevel: "Green", affectedcountries: [{ iso3: "JPN" }], iscurrent: "true" },
    },
    { type: "Feature", properties: { eventtype: "EQ", eventid: 5, alertlevel: "Red", affectedcountries: [{ iso3: "CHN" }] } },
  ],
};

describe("parseGdacsEvents", () => {
  const events = parseGdacsEvents(body);

  it("keeps tropical cyclones only and maps Green/Orange/Red to 1/2/3", () => {
    expect(events.map((e) => [e.eventId, e.alertLevel])).toEqual([
      ["1001211", 3],
      ["1001300", 1],
    ]);
  });

  it("reads ISO3 country codes and treats GDACS dates as UTC", () => {
    expect(events[0]).toMatchObject({ countries: ["PHL", "CHN"], fromDate: "2025-09-18T12:00:00Z", isCurrent: true });
  });

  it("rejects a body that is not GeoJSON", () => {
    expect(() => parseGdacsEvents({})).toThrow();
    expect(() => parseGdacsEvents(null)).toThrow();
  });
});

describe("region mapping", () => {
  const [ragasa, other] = parseGdacsEvents(body);

  it("accepts CHN (or HKG) for Hong Kong, VNM for Hai Phong", () => {
    expect(affectsRegion(ragasa!, "HK")).toBe(true);
    expect(affectsRegion({ ...ragasa!, countries: ["HKG"] }, "HK")).toBe(true);
    expect(affectsRegion(ragasa!, "VN-QN-HP")).toBe(false);
    expect(affectsRegion(other!, "HK")).toBe(false);
  });

  it("picks the current event affecting the region", () => {
    expect(pickEvent(parseGdacsEvents(body), "HK")?.eventId).toBe("1001211");
    expect(pickEvent(parseGdacsEvents(body), "VN-QN-HP")).toBeUndefined();
  });
});

describe("event id", () => {
  it("hashes TC-<id>, salted with #<runId> in replays", () => {
    expect(gdacsEventId("1001211")).toBe(keccak256(toBytes("TC-1001211")));
    expect(gdacsEventId("1001211", "run7")).toBe(keccak256(toBytes("TC-1001211#run7")));
    expect(gdacsEventId("1001211", "run7")).not.toBe(gdacsEventId("1001211", "run8"));
  });
});

describe("buildGdacsAttestation", () => {
  it("builds the Ragasa replay attestation from the replay file", () => {
    const file = loadReplay("ragasa-2025");
    const region = keccak256(toBytes("HK"));
    const a = buildGdacsAttestation(eventFromReplay(file.gdacs), { region: "HK", regionId: region, nonce: 4n, issuedAt: 1760000000n, runId: "r1" });
    expect(a).toEqual({
      source: SOURCE.GDACS,
      region,
      level: 3,
      eventId: keccak256(toBytes("TC-1001211#r1")),
      sourceTime: BigInt(Date.parse("2025-09-18T12:00:00Z") / 1000),
      issuedAt: 1760000000n,
      nonce: 4n,
    });
  });

  it("refuses an event that does not affect the region", () => {
    const [, other] = parseGdacsEvents(body);
    expect(() => buildGdacsAttestation(other!, { region: "HK", regionId: keccak256(toBytes("HK")), nonce: 1n, issuedAt: 1n })).toThrow();
  });
});
