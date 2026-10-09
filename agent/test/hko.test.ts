import { describe, expect, it } from "vitest";
import { parseWarnsum } from "../src/relayers/hko.ts";

describe("parseWarnsum", () => {
  it.each([
    [{}, 0],
    [{ WTCSGNL: { name: "Tropical Cyclone Warning Signal", code: "TC8NW", actionCode: "ISSUE" } }, 8],
    [{ WTCSGNL: { code: "TC10", actionCode: "ISSUE" } }, 10],
    [{ WTCSGNL: { code: "CANCEL", actionCode: "CANCEL" } }, 0],
    [{ WRAIN: { code: "WRAINA" } }, 0],
  ])("maps %j to level %i", (body, level) => {
    expect(parseWarnsum(body).level).toBe(level);
  });

  it("keeps HKO's times", () => {
    const s = parseWarnsum({ WTCSGNL: { code: "TC3", actionCode: "ISSUE", issueTime: "2025-09-22T21:40:00+08:00" } });
    expect(s).toMatchObject({ code: "TC3", level: 3, actionCode: "ISSUE", issueTime: "2025-09-22T21:40:00+08:00" });
  });

  it("rejects an unknown signal code instead of guessing", () => {
    expect(() => parseWarnsum({ WTCSGNL: { code: "TC11" } })).toThrow(/unknown tropical cyclone code/);
  });

  it("rejects a body that is not an object", () => {
    expect(() => parseWarnsum(null)).toThrow();
    expect(() => parseWarnsum("TC8NE")).toThrow();
  });
});
