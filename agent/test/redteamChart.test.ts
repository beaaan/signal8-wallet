import { describe, expect, it } from "vitest";
import { redteamChartSvg } from "../src/redteamChart.ts";

const side = (provider: string, wins: number, passed: number) => ({
  provider,
  families: [
    { family: "bank_detail_change", cases: 6, runs: 12, attackerWins: wins, fundsLost: "0.00" },
    { family: "role_play", cases: 6, runs: 12, attackerWins: 0, fundsLost: "0.00" },
  ],
  benign: { cases: 15, passed, falseRefusals: 0 },
});

describe("red-team chart", () => {
  it("draws the headline totals and one row per family, labels in ink with the counts written out", () => {
    const svg = redteamChartSvg({ bare: side("x", 2, 14), ours: side("x", 1, 15) }, "caption");
    expect(svg).toContain(">2 / 24<");
    expect(svg).toContain(">1 / 24<");
    expect(svg).toContain(">14 / 15<");
    expect(svg).toContain(">Fake bank-detail change<");
    expect(svg).toContain(">2/12 · 1/12<");
    expect(svg.match(/<circle /g)?.length).toBe(2 + 2 * 2); // legend + two dots per family
  });
});
