import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { units, type ActionSink, type ExecResult, type PlainAction } from "../src/exec/executor.ts";
import { DecisionLog } from "../src/log.ts";
import { forecast, FORECAST, loadPayroll, payrollTotal, StormLoop, type StormChain, type StormRecord } from "../src/loops/storm.ts";
import type { Action } from "../src/types.ts";

const H = `0x${"aa".repeat(32)}` as const;
const payroll = loadPayroll();

class Recorder implements ActionSink {
  runs: Action[] = [];
  batches: PlainAction[][] = [];
  async run(a: Action): Promise<ExecResult> {
    this.runs.push(a);
    if (a.type === "propose_to_owner") return { outcome: "proposed", stage: "owner", summary: a.type };
    const tx = `0x${this.runs.length.toString(16).padStart(64, "0")}` as const;
    return { outcome: "executed", stage: "chain", tx, summary: a.type, payout: a.type === "cover_claim" ? units("20000") : undefined };
  }
  async proposeBatch(_r: string, actions: PlainAction[]): Promise<ExecResult> {
    this.batches.push(actions);
    return { outcome: "proposed", stage: "owner", summary: "batch" };
  }
}

const EVENT = `0x${"ee".repeat(32)}` as const;

function setup(over: Partial<{ hashes: `0x${string}`[]; safe: bigint; vault: bigint; room: bigint; drafts: (r: StormRecord) => string[] }> = {}) {
  const sink = new Recorder();
  const chain: StormChain = {
    planHashes: async () => over.hashes ?? [H, H],
    balances: async () => ({ safe: over.safe ?? units("10000"), vault: over.vault ?? units("40000"), creditDrawn: 0n, creditLimit: units("50000") }),
    creditRoom: async () => over.room ?? units("15000"),
    eventId: async () => EVENT,
  };
  const loop = new StormLoop({ sink, log: new DecisionLog(mkdtempSync(join(tmpdir(), "s8-storm-")), false), chain, payroll, localPlanHash: H, runId: "r1", drafts: over.drafts });
  return { sink, loop };
}

const at = new Date("2025-09-22T13:40:00Z");

describe("payroll fixture", () => {
  it("has 10 staff at 2,300, all storm-plan payees a1..aa", () => {
    expect(payroll.staff).toHaveLength(10);
    expect(payrollTotal(payroll)).toBe(units("23000"));
    expect(payroll.staff.map((s) => s.address.slice(-2))).toEqual(["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "aa"]);
  });
});

describe("forecast", () => {
  it("finds the low point and the credit needed to stay above the buffer", () => {
    // 6 disrupted weeks at -8,000 from 22,000 → -26,000; buffer 10,000 → need 36,000
    expect(forecast(units("22000"))).toEqual({ minBalance: units("-26000"), need: units("36000") });
    expect(forecast(units("100000")).need).toBe(0n);
    expect(FORECAST.weeks).toBe(13);
  });
});

describe("StormLoop", () => {
  it("runs the Ragasa sequence: brace at 3, claim at storm start, payroll + credit on payday, proposals at the end", async () => {
    const { sink, loop } = setup();
    loop.schedule([{ type: "pay", plan: "base", payee: "0x00000000000000000000000000000000000000b2", amount: "1400.00", ref: "WO-2231#r1" }]);

    await loop.onSignal(1, "TC1", false, at);
    expect(sink.runs).toEqual([]);

    await loop.onSignal(3, "TC3", false, at);
    expect(sink.runs.map((a) => a.type)).toEqual(["vault_withdraw", "anchor"]);
    expect(sink.runs[0]).toMatchObject({ plan: "base", amount: "15000", ref: "brace-withdraw#r1" }); // 25,000 buffer - 10,000 cash

    await loop.onSignal(8, "TC8NW", true, at);
    expect(sink.runs[2]).toEqual({ type: "cover_claim", plan: "storm", ref: "cover-claim#r1" });

    await loop.onSignal(10, "TC10", true, at);
    await loop.onPayday();
    const pays = sink.runs.filter((a) => a.type === "pay");
    expect(pays).toHaveLength(10);
    expect(pays.every((a) => a.type === "pay" && a.plan === "storm" && a.amount === "2300" && a.ref === "payroll:2025-09#r1")).toBe(true);
    // cash 10,000 → low point -38,000 → need 48,000, capped by the 15,000 left under creditCapPerEvent
    expect(sink.runs.at(-1)).toMatchObject({ type: "credit_draw", plan: "storm", amount: "15000", ref: "credit-draw#r1" });

    await loop.onSignal(3, "TC3", false, at);
    expect(sink.runs.at(-1)).toMatchObject({ type: "propose_to_owner", action: { payee: "0x00000000000000000000000000000000000000b2" } });
    expect(loop.held).toEqual([]);
  });

  it("records the storm for the drafts and calls the drafts writer once, at storm end", async () => {
    const seen: StormRecord[] = [];
    const { loop } = setup({ drafts: (r) => (seen.push(structuredClone(r)), ["drafts/r1/claim-en.md"]) });
    const t = (h: number) => new Date(at.getTime() + h * 3_600_000);
    loop.schedule([{ type: "pay", plan: "base", payee: "0x00000000000000000000000000000000000000b2", amount: "1400.00", ref: "WO-2231#r1" }], [{ invoiceId: "WO-2231", dueDate: "2025-09-26" }]);
    await loop.onSignal(3, "TC3", false, t(0));
    await loop.onSignal(8, "TC8NW", true, t(16));
    await loop.onPayday();
    expect(seen).toEqual([]);
    await loop.onSignal(3, "TC3", false, t(46));
    expect(seen).toHaveLength(1);
    const r = seen[0]!;
    expect(r.stormStart).toEqual(t(16));
    expect(r.stormEnd).toEqual(t(46));
    expect(r.preStorm).toMatchObject({ signal: "TC3", hash: expect.stringMatching(/^0x[0-9a-f]{64}$/), tx: expect.stringMatching(/^0x/) });
    expect(r.cover).toMatchObject({ payout: units("20000"), eventId: EVENT, tx: expect.stringMatching(/^0x/) });
    expect(r.credit).toMatchObject({ amount: units("15000") });
    expect(r.payrollPaidInStorm).toBe(true);
    expect(r.proposedHeld).toEqual([{ action: expect.objectContaining({ ref: "WO-2231#r1" }), invoiceId: "WO-2231", dueDate: "2025-09-26", outcome: "proposed" }]);
    expect(loop.record.drafts).toEqual(["drafts/r1/claim-en.md"]);
  });

  it("caps the credit draw at the room left under creditCapPerEvent", async () => {
    const { sink, loop } = setup({ room: units("4000") });
    await loop.onSignal(8, "TC8NW", true, at);
    await loop.onPayday();
    expect(sink.runs.at(-1)).toMatchObject({ type: "credit_draw", amount: "4000" });
  });

  it("on an ordinary payday sends the whole payroll to the owners as one proposal", async () => {
    const { sink, loop } = setup();
    await loop.onPayday();
    expect(sink.runs).toEqual([]);
    expect(sink.batches).toHaveLength(1);
    expect(sink.batches[0]).toHaveLength(10);
  });

  it("does nothing when the on-chain plan hash differs from the local plan book", async () => {
    const { sink, loop } = setup({ hashes: [H, `0x${"bb".repeat(32)}`] });
    await loop.onSignal(1, "TC1", false, at);
    await loop.onSignal(3, "TC3", false, at);
    await loop.onSignal(8, "TC8NW", true, at);
    await loop.onPayday();
    expect(loop.halted).toBe(true);
    expect(sink.runs).toEqual([]);
  });
});
