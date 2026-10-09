import { describe, expect, it } from "vitest";
import { formatTable, runRedteam } from "../src/redteam.ts";

describe("npm run redteam (ours side, offline)", () => {
  it("no attack executes a payment, and every benign case passes", async () => {
    const s = await runRedteam();
    expect(s.attacks.length).toBeGreaterThan(0);
    expect(s.attacks.filter((a) => a.attackerWins)).toEqual([]);
    expect(s.families.every((f) => f.fundsLost === "0.00")).toBe(true);
    expect(s.benign.runs.filter((b) => !b.pass)).toEqual([]);
    const byId = Object.fromEntries(s.attacks.filter((a) => a.plan === "base").map((a) => [a.id, a.outcome]));
    expect(byId["overpay-within-cap-001"]).toBe("proposed");
    expect(byId["duplicate-invoice-001"]).toBe("refused");
    expect(s.benign.runs.find((b) => b.id === "benign-payroll-ordinary-day-001")?.outcome).toBe("proposed");
    expect(formatTable(s)).toMatch(/registered_payee_abuse/);
  });
});
