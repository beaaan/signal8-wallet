import { encodeAbiParameters, keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { actionRef, invoiceRef, normaliseInvoiceId, payrollRef, refFor, withRun } from "../src/exec/refs.ts";

const a1 = "0x00000000000000000000000000000000000000a1";
const a2 = "0x00000000000000000000000000000000000000a2";

describe("refs", () => {
  it("supplier payment: keccak256(abi.encode(payee, normalised invoiceId))", () => {
    const b1 = "0x00000000000000000000000000000000000000b1";
    const r = refFor({ type: "pay", plan: "base", payee: b1, amount: "1250.50", ref: "LK-0917" });
    expect(r).toBe(keccak256(encodeAbiParameters([{ type: "address" }, { type: "string" }], [b1, "LK0917"])));
    expect(r).toBe(invoiceRef(b1, "LK-0917"));
  });

  it("the same invoice written differently is one ref; the same number from another supplier is not", () => {
    const b1 = "0x00000000000000000000000000000000000000b1";
    for (const id of ["lk-0917", "LK 0917", "LK0917", " LK–0917 "]) expect(invoiceRef(b1, id)).toBe(invoiceRef(b1, "LK-0917"));
    expect(invoiceRef("0x00000000000000000000000000000000000000b2", "LK-0917")).not.toBe(invoiceRef(b1, "LK-0917"));
    expect(normaliseInvoiceId("lk-0921#r1")).toBe("LK0921#r1");
    expect(invoiceRef(b1, "LK-0921#r1")).not.toBe(invoiceRef(b1, "LK-0921#r2"));
  });

  it("part n ≥ 2 of one invoice gets its own ref; part 1 is the invoice's ref", () => {
    const b1 = "0x00000000000000000000000000000000000000b1";
    expect(invoiceRef(b1, "LK-3202", 1)).toBe(invoiceRef(b1, "LK-3202"));
    expect(invoiceRef(b1, "LK-3202", 2)).toBe(keccak256(encodeAbiParameters([{ type: "address" }, { type: "string" }], [b1, "LK3202/2"])));
    expect(new Set([invoiceRef(b1, "LK-3202"), invoiceRef(b1, "LK-3202", 2), invoiceRef(b1, "LK-3202", 3)]).size).toBe(3);
    expect(refFor({ type: "pay", plan: "base", payee: b1, amount: "100", ref: "LK-3202#r1", part: 2 })).toBe(invoiceRef(b1, "LK-3202#r1", 2));
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
