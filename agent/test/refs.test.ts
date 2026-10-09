import { encodeAbiParameters, keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { actionRef, invoiceRef, payrollRef, refFor, withRun } from "../src/exec/refs.ts";

const a1 = "0x00000000000000000000000000000000000000a1";
const a2 = "0x00000000000000000000000000000000000000a2";

describe("refs", () => {
  it("supplier payment: keccak256(invoiceId)", () => {
    const r = refFor({ type: "pay", plan: "base", payee: "0x00000000000000000000000000000000000000b1", amount: "1250.50", ref: "LK-0917" });
    expect(r).toBe(keccak256(toBytes("LK-0917")));
    expect(r).toBe(invoiceRef("LK-0917"));
  });

  it("does not depend on the amount, so a resent invoice with another amount still collides", () => {
    const base = { type: "pay" as const, plan: "base" as const, payee: "0x00000000000000000000000000000000000000b1" as const, ref: "LK-0917" };
    expect(refFor({ ...base, amount: "1250.50" })).toBe(refFor({ ...base, amount: "9.99" }));
  });

  it("payroll: keccak256(abi.encode(employee, payPeriod)), one per employee and period", () => {
    const r = refFor({ type: "pay", plan: "storm", payee: a1, amount: "2300", ref: "payroll:2025-09" });
    expect(r).toBe(keccak256(encodeAbiParameters([{ type: "address" }, { type: "string" }], [a1, "2025-09"])));
    expect(r).toBe(payrollRef(a1, "2025-09"));
    expect(payrollRef(a2, "2025-09")).not.toBe(r);
    expect(payrollRef(a1, "2025-10")).not.toBe(r);
  });

  it("other actions: keccak256(actionId)", () => {
    expect(refFor({ type: "cover_claim", plan: "storm", ref: "cover-claim#r1" })).toBe(keccak256(toBytes("cover-claim#r1")));
    expect(refFor({ type: "credit_draw", plan: "storm", amount: "1", ref: "credit-draw" })).toBe(actionRef("credit-draw"));
  });

  it("is deterministic, and the run id makes replays distinct", () => {
    expect(actionRef(withRun("brace-withdraw", "r1"))).toBe(actionRef(withRun("brace-withdraw", "r1")));
    expect(actionRef(withRun("brace-withdraw", "r1"))).not.toBe(actionRef(withRun("brace-withdraw", "r2")));
    expect(payrollRef(a1, withRun("2025-09", "r1"))).not.toBe(payrollRef(a1, "2025-09"));
    expect(withRun("x")).toBe("x");
  });
});
