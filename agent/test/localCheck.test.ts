import { describe, expect, it } from "vitest";
import { toCall, units } from "../src/exec/executor.ts";
import { localCheck, type PlanCall, type Snapshot } from "../src/policy/localCheck.ts";

const supplier = "0x00000000000000000000000000000000000000b1";
const staff = "0x00000000000000000000000000000000000000a1";
const stranger = "0x000000000000000000000000000000000000dEaD";
const ref = `0x${"11".repeat(32)}` as const;
const hash = `0x${"22".repeat(32)}` as const;

/** Demo plans from plan-book.example.json, nothing spent yet, storm on. */
function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    paused: false,
    isStorm: true,
    plans: {
      0: { perTxCap: units("5000"), dailyCap: units("15000"), creditCapPerEvent: 0n, actions: 0b00111, active: true, planHash: hash },
      1: { perTxCap: units("3000"), dailyCap: units("25000"), creditCapPerEvent: units("15000"), actions: 0b11101, active: true, planHash: hash },
    },
    dailyCeiling: units("40000"),
    spentToday: { 0: 0n, 1: 0n },
    spentAllToday: 0n,
    eventId: hash,
    drawnInEvent: 0n,
    payeePlans: { [supplier]: 1, [staff]: 2 },
    refUsed: {},
    ...over,
  };
}

const pay = (planId: number, to: `0x${string}`, amount: string): PlanCall => ({ fn: "pay", planId, to, amount: units(amount), ref });

describe("localCheck accepts what the plan allows", () => {
  it.each([
    ["supplier under base", pay(0, supplier, "1250.50")],
    ["staff under storm", pay(1, staff, "2300")],
    ["vault withdraw under base", { fn: "vaultWithdraw", planId: 0, amount: units("100"), ref } as PlanCall],
    ["credit draw within the event cap", { fn: "creditDraw", planId: 1, amount: units("15000"), ref } as PlanCall],
    ["cover claim in a storm", { fn: "claimCover", planId: 1, ref } as PlanCall],
    ["anchor", { fn: "anchor", hash, kind: hash } as PlanCall],
  ])("%s", (_name, call) => {
    expect(localCheck(call, snap())).toEqual({ ok: true });
  });
});

describe("localCheck refuses with the contract's error name", () => {
  it.each<[string, PlanCall, Partial<Snapshot>, string, boolean]>([
    ["Paused (even anchor)", { fn: "anchor", hash, kind: hash }, { paused: true }, "Paused", false],
    ["PlanInactive", pay(0, supplier, "1"), { plans: { ...snap().plans, 0: { ...snap().plans[0]!, active: false } } }, "PlanInactive", false],
    ["StormNotActive: storm plan on an ordinary day", pay(1, staff, "2300"), { isStorm: false }, "StormNotActive", false],
    ["StormNotActive: cover claim without a storm", { fn: "claimCover", planId: 1, ref }, { isStorm: false }, "StormNotActive", false],
    ["ActionNotAllowed: vault deposit under storm", { fn: "vaultDeposit", planId: 1, amount: 1n, ref }, {}, "ActionNotAllowed", false],
    ["ActionNotAllowed: credit under a plan without it", { fn: "creditDraw", planId: 1, amount: 1n, ref }, { plans: { ...snap().plans, 1: { ...snap().plans[1]!, actions: 0b00101 } } }, "ActionNotAllowed", false],
    ["RefUsed", pay(0, supplier, "1"), { refUsed: { [ref]: true } }, "RefUsed", false],
    ["PayeeNotInPlan: staff under base (ordinary-day payroll)", pay(0, staff, "2300"), {}, "PayeeNotInPlan", true],
    ["PayeeNotInPlan: supplier under storm", pay(1, supplier, "100"), {}, "PayeeNotInPlan", true],
    ["PayeeNotInPlan: unregistered address", pay(0, stranger, "1"), {}, "PayeeNotInPlan", true],
    ["OverPerTxCap", pay(0, supplier, "5000.01"), {}, "OverPerTxCap", true],
    ["OverDailyCap", pay(0, supplier, "2000"), { spentToday: { 0: units("14000"), 1: 0n } }, "OverDailyCap", true],
    ["OverDailyCeiling", pay(1, staff, "2300"), { spentAllToday: units("39000") }, "OverDailyCeiling", true],
    ["OverCreditCap", { fn: "creditDraw", planId: 1, amount: units("5000"), ref }, { drawnInEvent: units("12000") }, "OverCreditCap", false],
  ])("%s", (_name, call, over, error, outsidePlan) => {
    expect(localCheck(call, snap(over))).toEqual({ ok: false, error, outsidePlan });
  });

  it("checks in the contract's order: ref before payee, payee before caps", () => {
    expect(localCheck(pay(0, stranger, "999999"), snap({ refUsed: { [ref]: true } }))).toMatchObject({ error: "RefUsed" });
    expect(localCheck(pay(0, stranger, "999999"), snap())).toMatchObject({ error: "PayeeNotInPlan" });
  });
});

describe("toCall", () => {
  it("maps actions to the typed PlanModule functions with token units", () => {
    expect(toCall({ type: "pay", plan: "storm", payee: staff, amount: "2300", ref: "payroll:2025-09" })).toMatchObject({ fn: "pay", planId: 1, to: staff, amount: 2_300_000_000n });
    expect(toCall({ type: "vault_deposit", plan: "base", amount: "0.5", ref: "x" })).toMatchObject({ fn: "vaultDeposit", planId: 0, amount: 500_000n });
    expect(toCall({ type: "credit_draw", plan: "storm", amount: "1", ref: "x" })).toMatchObject({ fn: "creditDraw", planId: 1 });
    expect(toCall({ type: "anchor", kind: "PRE_STORM", hash })).toEqual({ fn: "anchor", hash, kind: `0x${Buffer.from("PRE_STORM").toString("hex").padEnd(64, "0")}` });
  });
});
