import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { units } from "../src/exec/calls.ts";
import { Ledger } from "../src/ledger.ts";
import { DecisionLog } from "../src/log.ts";
import { InflowWatcher, loadReceivables, matchInflows, type InflowEvent, type InflowSource } from "../src/loops/inflows.ts";

const ref = (id: string) => keccak256(toBytes(id));
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
const ev = (id: string, amount: string, block: number, swept = "0"): InflowEvent => ({ invoiceRef: ref(id), amount: units(amount), swept: units(swept), tx: tx(block), block: BigInt(block) });
const receivables = loadReceivables();

class FakeSource implements InflowSource {
  events: InflowEvent[] = [];
  head = 0n;
  async latestBlock() {
    return this.head;
  }
  async inflows(from: bigint, to: bigint) {
    return this.events.filter((e) => e.block >= from && e.block <= to);
  }
}

describe("matchInflows", () => {
  it("matches exact payments, flags short, over and unknown refs, and adds up partial payments", () => {
    const paid = new Map<string, bigint>();
    const m = matchInflows(
      [ev("INV-C-2025-09-22", "8000", 1), ev("INV-C-2025-09-25", "3000", 2), ev("INV-C-2025-09-25", "2000", 3), ev("INV-C-2025-09-30", "3500", 4), ev("INV-X-1", "100", 5)],
      receivables,
      paid,
    );
    expect(m.map((x) => [x.kind, x.receivable?.id])).toEqual([
      ["matched", "INV-C-2025-09-22"],
      ["short", "INV-C-2025-09-25"],
      ["matched", "INV-C-2025-09-25"],
      ["over", "INV-C-2025-09-30"],
      ["unmatched", undefined],
    ]);
    expect(paid.get("INV-C-2025-09-25")).toBe(units("5000"));
  });

  it("accepts the replay's salted ref <id>#<runId> only for that run", () => {
    expect(matchInflows([ev("INV-C-2025-09-22#r7", "8000", 1)], receivables, new Map(), "r7")[0]!.kind).toBe("matched");
    expect(matchInflows([ev("INV-C-2025-09-22#r7", "8000", 1)], receivables, new Map(), "r8")[0]!.kind).toBe("unmatched");
  });
});

describe("InflowWatcher", () => {
  it("reads only events after the checkpoint, logs matches and flags, and feeds the ledger amount - swept", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s8-inflow-"));
    const log = new DecisionLog(dir, false);
    const src = new FakeSource();
    const cp = join(dir, "inflows.json");
    const w = new InflowWatcher({ source: src, log, receivables, checkpointFile: cp, fromBlock: 10n });
    src.events = [ev("INV-C-2025-09-22", "8000", 5), ev("INV-C-2025-09-22", "8000", 11, "800")];
    src.head = 12n;
    const ledger = new Ledger();
    const first = await w.poll(ledger);
    expect(first.map((m) => m.kind)).toEqual(["matched"]); // block 5 is before the start block
    expect(ledger.totals().safe).toBe(units("7200"));
    expect(JSON.parse(readFileSync(cp, "utf8"))).toEqual({ block: "12", paid: { "INV-C-2025-09-22": "8000000000" } });

    src.events.push(ev("INV-C-2025-09-25", "4000", 13), ev("INV-Z", "50", 14));
    src.head = 14n;
    const second = await w.poll();
    expect(second.map((m) => m.kind)).toEqual(["short", "unmatched"]);
    expect(await w.poll()).toEqual([]);

    const lines = log.readNewest().reverse();
    expect(lines.map((l) => [l.action, l.outcome, l.reason])).toEqual([
      ["inflow", "executed", undefined],
      ["inflow_flag", "proposed", "ShortPayment"],
      ["inflow_flag", "proposed", "UnmatchedInflow"],
    ]);
    expect(lines[0]!.summary).toMatch(/800 swept to the credit line/);
  });
});
