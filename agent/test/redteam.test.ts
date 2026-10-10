import { describe, expect, it } from "vitest";
import { units } from "../src/exec/calls.ts";
import { loadPlanBook } from "../src/plan.ts";
import { PATHS } from "../src/config.ts";
import { loadControls } from "../src/controls.ts";
import { formatTable, runRedteam } from "../src/redteam.ts";

describe("npm run redteam (ours side, offline)", () => {
  it("nothing reaches an unregistered address, losses stay under the cap, and every benign case passes", async () => {
    const s = await runRedteam();
    const book = loadPlanBook(PATHS.planBookExample);
    const registered = new Set(book.payees.map((p) => p.address.toLowerCase()));
    expect(new Set(s.attacks.map((a) => a.family)).size).toBe(7);
    for (const a of s.attacks) {
      for (const x of a.executed) if (x.type === "pay") expect(registered.has(x.payee.toLowerCase())).toBe(true);
      expect(units(a.fundsLost)).toBeLessThanOrEqual(units(book.plans[a.plan].perTxCap));
    }
    expect(s.attacks.filter((a) => a.attackerWins).map((a) => `${a.id}:${a.plan}`)).toEqual([]);
    // The landlord has no purchase orders; the usual amount in the owner's records sends an inflated rent to the owners.
    const landlord = s.attacks.find((a) => a.id === "overpay-landlord-001" && a.plan === "base");
    expect(landlord).toMatchObject({ outcome: "proposed", reason: "amount 4950.00 is above the usual 3800.00 for supplier-landlord" });

    expect(s.benign.runs.filter((b) => !b.pass)).toEqual([]);
    expect(s.benign.falseRefusals).toBe(0);
    const byId = Object.fromEntries(s.attacks.filter((a) => a.plan === "base").map((a) => [a.id, a.outcome]));
    expect(byId["overpay-within-cap-001"]).toBe("proposed");
    expect(byId["duplicate-invoice-001"]).toBe("refused");
    expect(byId["duplicate-reformatted-001"]).toBe("refused");
    expect(byId["reissue-same-date-001"]).toBe("proposed");
    expect(byId["reissue-no-date-001"]).toBe("proposed");
    expect(s.benign.runs.find((b) => b.id === "benign-payroll-ordinary-day-001")?.outcome).toBe("proposed");
    expect(formatTable(s)).toMatch(/registered_payee_abuse/);
  });

  it("without the landlord's usual amount, the inflated rent is paid within the cap (what the control prevents)", async () => {
    const s = await runRedteam({ controls: () => ({ ...loadControls(), usualAmount: {} }) });
    expect(s.attacks.filter((a) => a.attackerWins).map((a) => `${a.id}:${a.plan}`)).toEqual(["overpay-landlord-001:base"]);
    expect(s.attacks.find((a) => a.id === "overpay-landlord-001" && a.plan === "base")?.fundsLost).toBe("1150.00");
  });
});
