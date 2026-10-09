import { describe, expect, it } from "vitest";
import { buildSteps, loadReplay } from "../src/replay/runner.ts";

const HOUR = 3_600_000;

describe("Ragasa replay", () => {
  const file = loadReplay("ragasa-2025");
  const steps = buildSteps(file, 600);

  it("is in time order and starts without a delay", () => {
    expect(steps[0]!.delayMs).toBe(0);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.at.getTime()).toBeGreaterThanOrEqual(steps[i - 1]!.at.getTime());
    }
  });

  it("unlocks storm mode at Signal 8 (23 Sep 14:20) and locks it at Signal 3 (24 Sep 20:20), 30 hours", () => {
    const signals = steps.filter((s) => s.kind === "signal");
    const on = signals.find((s) => (s.level ?? 0) >= 8)!;
    const off = signals.find((s) => s.at > on.at && (s.level ?? 0) < 8)!;
    expect(on.at.toISOString()).toBe("2025-09-23T06:20:00.000Z");
    expect(off.at.toISOString()).toBe("2025-09-24T12:20:00.000Z");
    expect(off.at.getTime() - on.at.getTime()).toBe(30 * HOUR);
  });

  it("includes the fake 'move funds' email while Signal 10 is up", () => {
    const fake = steps.find((s) => s.kind === "fake_message");
    expect(fake?.code).toBe("email");
    const before = steps.filter((s) => s.kind === "signal" && s.at <= fake!.at).at(-1);
    expect(before?.code).toBe("TC10");
  });

  it("compresses delays by the speed factor", () => {
    const tc3 = steps.find((s) => s.code === "TC3")!;
    expect(tc3.delayMs).toBe(Math.round((9 * HOUR + 20 * 60_000) / 600)); // 12:20 → 21:40
  });
});

describe("Yagi replay", () => {
  it("uses its own level map for Vietnamese warning codes", () => {
    const steps = buildSteps(loadReplay("yagi-2024"), 600);
    expect(steps.find((s) => s.code === "VN_RISK_4")?.level).toBe(8);
    expect(steps.find((s) => s.code === "VN_CANCEL")?.level).toBe(0);
  });
});

describe("buildSteps", () => {
  it("rejects an unknown signal code", () => {
    const file = { ...loadReplay("ragasa-2025"), signals: [{ time: "2025-09-22T12:20:00+08:00", code: "TC11" }] };
    expect(() => buildSteps(file, 600)).toThrow(/unknown code TC11/);
  });
});

describe("replay CLI arguments", () => {
  it("parses flags and switches", async () => {
    const { parseArgs } = await import("../src/replay/runner.ts");
    const { opts, switches } = parseArgs(["--event", "yagi-2024", "--speed", "100000", "--dry-run"]);
    expect(opts).toEqual({ event: "yagi-2024", speed: "100000" });
    expect([...switches]).toEqual(["dry-run"]);
  });

  it("rejects typos, missing values and bad speeds, so nothing starts by accident", async () => {
    const { parseArgs } = await import("../src/replay/runner.ts");
    expect(() => parseArgs(["--speeed", "4"])).toThrow(/unknown option --speeed/);
    expect(() => parseArgs(["--event"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--speed", "0"])).toThrow(/positive/);
    expect(() => parseArgs(["--speed", "abc"])).toThrow(/positive/);
    expect(() => parseArgs(["ragasa-2025"])).toThrow(/unexpected argument/);
  });
});
