import { describe, expect, it } from "vitest";
import { gdacsEventId } from "../src/relayers/gdacs.ts";
import { ZERO32, type Hex } from "../src/relayers/sign.ts";
import { decideGdacs, decideHko, gdacsSource, hkoSource, LiveRelayer, POLL_MS, REATTEST_MS, type Attested, type Clock, type LiveSource, type TickResult } from "../src/relayers/live.ts";

const H = 3_600_000;
const T0 = Date.parse("2025-09-23T06:00:00Z");

class FakeClock implements Clock {
  constructor(public t = T0) {}
  now() {
    return this.t;
  }
  async sleep(ms: number) {
    this.t += ms;
  }
}

/** A fake fetch that serves whatever body the test sets, or fails. */
function fakeFetch(state: { body: unknown; fail?: boolean; calls: number }): typeof fetch {
  return (async () => {
    state.calls++;
    if (state.fail) throw new Error("ECONNRESET");
    return new Response(JSON.stringify(state.body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

/** Wraps a real source (real parser and decision) with a fake submit that records what would be attested. */
function withFakeSubmit<T>(src: LiveSource<T>, clock: Clock, sent: Array<{ at: number; level: number; eventId: Hex }>, eventIdOf: (o: T) => Hex, levelOf: (o: T) => number): LiveSource<T> {
  return {
    ...src,
    async submit(o) {
      const a = { level: levelOf(o), eventId: eventIdOf(o), issuedAtMs: clock.now() - 5000 };
      sent.push({ at: clock.now(), level: a.level, eventId: a.eventId });
      return { ...a, tx: `0x${String(sent.length).padStart(64, "0")}` as Hex };
    },
  };
}

const warnsum = (code?: string) => (code ? { WTCSGNL: { name: "Tropical Cyclone Warning Signal", code, actionCode: "ISSUE", issueTime: "2025-09-23T14:20:00+08:00" } } : {});

describe("decideHko", () => {
  const last = (level: number, agoH: number): Attested => ({ level, eventId: ZERO32, issuedAtMs: T0 - agoH * H });
  it.each([
    [8, undefined, true, /first/],
    [8, last(3, 1), true, /3 → 8/],
    [8, last(8, 1), false, /unchanged/],
    [8, last(8, 6), true, /re-attest/],
    [3, last(3, 7), false, /unchanged/], // below 8: no refresh needed
    [0, last(8, 0.1), true, /8 → 0/],
  ])("level %i, last %o → attest %s", (level, l, attest, why) => {
    const d = decideHko({ code: "X", level }, l, T0);
    expect(d.attest).toBe(attest);
    expect(d.why).toMatch(why);
  });
});

describe("decideGdacs", () => {
  const ev = (alertLevel: number, isCurrent = true) => ({ eventId: "1001211", name: "RAGASA-25", alertLevel, countries: ["PHL", "CHN"], isCurrent });
  const id = gdacsEventId("1001211");
  it("attests a new Orange/Red event, not Green, refreshes every 6 h, and attests a downgrade of a tracked event", () => {
    expect(decideGdacs(ev(3), undefined, T0).attest).toBe(true);
    expect(decideGdacs(ev(1), undefined, T0)).toMatchObject({ attest: false, why: /Green/ });
    expect(decideGdacs(ev(3), { level: 3, eventId: id, issuedAtMs: T0 - 2 * H }, T0).attest).toBe(false);
    expect(decideGdacs(ev(3), { level: 3, eventId: id, issuedAtMs: T0 - 6 * H }, T0)).toMatchObject({ attest: true, why: /re-attest/ });
    expect(decideGdacs(ev(3), { level: 2, eventId: id, issuedAtMs: T0 }, T0)).toMatchObject({ attest: true, why: /2 → 3/ });
    expect(decideGdacs(ev(1), { level: 3, eventId: id, issuedAtMs: T0 }, T0)).toMatchObject({ attest: true, why: /downgraded/ });
    expect(decideGdacs(undefined, { level: 3, eventId: id, issuedAtMs: T0 }, T0).attest).toBe(false);
  });
});

describe("LiveRelayer scheduling (fake clock, fake fetch)", () => {
  it("HKO: polls every 60 s, attests on change, re-attests every 6 h at ≥ 8, keeps going through fetch errors", async () => {
    const clock = new FakeClock();
    const net = { body: warnsum("TC3") as unknown, calls: 0, fail: false };
    const sent: Array<{ at: number; level: number; eventId: Hex }> = [];
    const src = withFakeSubmit(hkoSource({ fetchImpl: fakeFetch(net), url: "http://fake" }), clock, sent, () => ZERO32, (s) => s.level);
    const ticks: TickResult[] = [];
    // On-chain: TC3 attested 10 minutes ago.
    const relayer = new LiveRelayer(src, clock, async () => ({ level: 3, eventId: ZERO32, issuedAtMs: T0 - 10 * 60_000 }), { onTick: (t) => ticks.push(t) });

    const until = (ms: number) => () => clock.now() >= ms;
    await relayer.run(until(T0 + 30 * 60_000)); // 30 min of TC3: nothing to do
    expect(sent).toEqual([]);
    expect(net.calls).toBe(30);

    net.body = warnsum("TC8NW"); // Signal 8 goes up
    await relayer.run(until(T0 + 31 * 60_000));
    expect(sent.map((s) => s.level)).toEqual([8]);

    net.fail = true; // the Observatory is unreachable for 10 minutes
    await relayer.run(until(T0 + 41 * 60_000));
    expect(ticks.filter((t) => t.action === "error")).toHaveLength(10);
    net.fail = false;

    await relayer.run(until(T0 + 30 * 60_000 + 7 * H)); // still 8 seven hours later: one refresh at +6 h
    expect(sent.map((s) => s.level)).toEqual([8, 8]);
    expect(sent[1]!.at - sent[0]!.at).toBeGreaterThanOrEqual(REATTEST_MS);
    expect(sent[1]!.at - sent[0]!.at).toBeLessThan(REATTEST_MS + 2 * POLL_MS);

    net.body = warnsum("TC3"); // down to 3: storm over
    await relayer.run(until(clock.now() + 2 * POLL_MS));
    net.body = {}; // all signals cancelled
    await relayer.run(until(clock.now() + 2 * POLL_MS));
    expect(sent.map((s) => s.level)).toEqual([8, 8, 3, 0]);
  });

  it("GDACS: attests a current Orange/Red event for HK (CHN), re-attests every 6 h while current, then lets it lapse", async () => {
    const clock = new FakeClock();
    const feature = (alert: string, current: boolean, countries = ["PHL", "CHN"]) => ({
      type: "FeatureCollection",
      features: [{ properties: { eventtype: "TC", eventid: 1001211, name: "RAGASA-25", alertlevel: alert, iscurrent: String(current), affectedcountries: countries.map((iso3) => ({ iso3 })), fromdate: "2025-09-18T12:00:00" } }],
    });
    const net = { body: feature("Red", true, ["PHL"]) as unknown, calls: 0 };
    const sent: Array<{ at: number; level: number; eventId: Hex }> = [];
    const src = withFakeSubmit(gdacsSource({ region: "HK", fetchImpl: fakeFetch(net), url: "http://fake", clock }), clock, sent, (e) => gdacsEventId(e!.eventId), (e) => e!.alertLevel);
    const relayer = new LiveRelayer(src, clock, async () => undefined);
    const until = (ms: number) => () => clock.now() >= ms;

    await relayer.run(until(T0 + 5 * 60_000)); // Philippines only: not HK
    expect(sent).toEqual([]);

    net.body = feature("Orange", true);
    await relayer.run(until(T0 + 10 * 60_000));
    net.body = feature("Red", true);
    await relayer.run(until(T0 + 15 * 60_000));
    expect(sent.map((s) => s.level)).toEqual([2, 3]);
    expect(sent[0]!.eventId).toBe(gdacsEventId("1001211"));

    await relayer.run(until(T0 + 15 * 60_000 + 13 * H)); // 13 h at Red: two refreshes
    expect(sent.map((s) => s.level)).toEqual([2, 3, 3, 3]);

    net.body = feature("Red", false); // no longer current: nothing more
    await relayer.run(until(clock.now() + 7 * H));
    expect(sent).toHaveLength(4);
  });

  it("a dry run decides but never submits", async () => {
    const clock = new FakeClock();
    const net = { body: warnsum("TC8NE") as unknown, calls: 0 };
    let submitted = 0;
    const src = { ...hkoSource({ fetchImpl: fakeFetch(net), url: "http://fake" }), submit: async () => (submitted++, { level: 8, eventId: ZERO32, issuedAtMs: 0, tx: ZERO32 }) };
    const t = await new LiveRelayer(src, clock, async () => undefined, { dryRun: true }).tick();
    expect(t).toMatchObject({ action: "dry-run", observed: expect.stringContaining("TC8NE") });
    expect(submitted).toBe(0);
  });
});
