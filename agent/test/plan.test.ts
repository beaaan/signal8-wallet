import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalJson, loadPlanBook, planHash, toChainParams } from "../src/plan.ts";
import { PlanBook } from "../src/types.ts";

const examplePath = fileURLToPath(new URL("../../data/fixtures/plans/plan-book.example.json", import.meta.url));
const book = loadPlanBook(examplePath);

describe("canonicalJson", () => {
  it("sorts keys and drops whitespace (RFC 8785)", () => {
    expect(canonicalJson({ b: 1, a: [true, null, "x"], c: { z: "é", y: 2 } })).toBe(
      '{"a":[true,null,"x"],"b":1,"c":{"y":2,"z":"é"}}',
    );
  });

  it("refuses values JSON cannot carry", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(() => 1)).toThrow();
  });
});

describe("planHash", () => {
  it("does not depend on key order or formatting", () => {
    const reversed = Object.fromEntries(Object.entries(book).reverse());
    const reordered = JSON.parse(JSON.stringify(reversed, null, 4)) as PlanBook;
    expect(Object.keys(reordered)[0]).toBe("citations");
    expect(planHash(reordered)).toBe(planHash(book));
  });

  it("changes when any rule changes", () => {
    const raised = { ...book, plans: { ...book.plans, storm: { ...book.plans.storm, dailyCap: "25001" } } };
    expect(planHash(raised)).not.toBe(planHash(book));
  });

  it("covers the plain-language summary the owner reads", () => {
    const edited = { ...book, summary: { ...book.summary, en: "Anything goes." } };
    expect(planHash(edited)).not.toBe(planHash(book));
  });
});

describe("toChainParams", () => {
  const params = toChainParams(book);

  it("uses the contract's action bits (ACT_* in IPlanModule.sol)", () => {
    expect(params.plans.base.actions).toBe(0b00111); // pay, vault deposit, vault withdraw
    expect(params.plans.storm.actions).toBe(0b11101); // pay, vault withdraw, credit draw, cover claim
  });

  it("puts suppliers in the base plan and staff in the storm plan", () => {
    const mask = (id: string) => params.payees[book.payees.findIndex((p) => p.id === id)]!.planMask;
    expect(mask("supplier-flour")).toBe(1);
    expect(mask("staff-01")).toBe(2);
  });

  it("converts amounts to token units", () => {
    expect(params.plans.storm.creditCapPerEvent).toBe(15_000n * 10n ** 6n);
    expect(params.dailyCeiling).toBe(40_000n * 10n ** 6n);
  });

  it("fits one full demo run under the ceiling: base day plus storm payroll", () => {
    expect(params.plans.base.dailyCap + params.plans.storm.dailyCap).toBeLessThanOrEqual(params.dailyCeiling);
  });
});

describe("PlanBook", () => {
  it("rejects credit in the base plan", () => {
    const bad = { ...book, plans: { ...book.plans, base: { ...book.plans.base, actions: ["pay", "credit_draw"] } } };
    expect(PlanBook.safeParse(bad).success).toBe(false);
  });

  it("rejects a credit cap without the credit action", () => {
    const bad = {
      ...book,
      plans: { ...book.plans, storm: { ...book.plans.storm, actions: ["pay", "cover_claim"] } },
    };
    expect(PlanBook.safeParse(bad).success).toBe(false);
  });

  it("rejects the same address listed twice", () => {
    const bad = { ...book, payees: [...book.payees, { ...book.payees[0]!, id: "dup" }] };
    expect(PlanBook.safeParse(bad).success).toBe(false);
  });
});
