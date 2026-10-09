import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { units } from "../src/exec/calls.ts";
import { Ledger, reconcile, type ChainView } from "../src/ledger.ts";
import { DecisionLog, JsonlFile } from "../src/log.ts";
import { closeDay, type Alert, type ChainReader } from "../src/loops/reconcile.ts";

const view = (over: Partial<ChainView> = {}): ChainView => ({ day: 20354n, safe: units("20000"), vault: units("40000"), spent: { 0: 0n, 1: 0n }, ...over });

/** A ledger for one ordinary day: 8,000 in, a 1,250.50 supplier payment, then the surplus swept to the vault. */
function day(): Ledger {
  const l = new Ledger();
  l.record({ kind: "inflow", amount: units("8000"), safeDelta: units("8000"), vaultDelta: 0n });
  l.record({ kind: "pay", amount: units("1250.5"), planId: 0, safeDelta: -units("1250.5"), vaultDelta: 0n });
  l.record({ kind: "vault_deposit", amount: units("16749.5"), safeDelta: -units("16749.5"), vaultDelta: units("16749.5") });
  return l;
}
const honestAfter = view({ safe: units("10000"), vault: units("56749.5") - 1n, spent: { 0: units("1250.5"), 1: 0n } }); // 1 unit of 4626 rounding

class FakeReader implements ChainReader {
  constructor(private readonly v: ChainView) {}
  async view() {
    return this.v;
  }
}

function deps(after: ChainView, failPause = false) {
  const dir = mkdtempSync(join(tmpdir(), "s8-rec-"));
  const pauses: string[] = [];
  const order: string[] = [];
  const alerts = new JsonlFile<Alert>(join(dir, "alerts.jsonl"));
  return {
    dir,
    pauses,
    order,
    alerts,
    log: new DecisionLog(dir, false),
    d: {
      reader: new FakeReader(after),
      log: new DecisionLog(dir, false),
      alerts,
      pauser: {
        async pause() {
          order.push("pause");
          if (failPause) throw new Error("NotPauser");
          pauses.push("paused");
          return `0x${"99".repeat(32)}` as const;
        },
      },
      beforePause: async () => void order.push("anchor"),
    },
  };
}

describe("reconcile", () => {
  it("passes when chain deltas equal the ledger (vault within rounding)", () => {
    expect(reconcile(day(), view(), honestAfter)).toMatchObject({ ok: true, diffs: [] });
  });

  it("skips spentToday when the chain day rolled over", () => {
    expect(reconcile(day(), view(), { ...honestAfter, day: 20355n, spent: { 0: 0n, 1: 0n } }).ok).toBe(true);
  });
});

describe("closeDay", () => {
  it("logs a match and does not pause", async () => {
    const t = deps(honestAfter);
    const r = await closeDay("2025-09-22", day(), view(), t.d);
    expect(r.ok).toBe(true);
    expect(t.order).toEqual(["anchor"]);
    expect(t.log.readNewest()[0]).toMatchObject({ action: "reconcile", outcome: "executed" });
  });

  it("on a mismatch (money left the Safe outside the ledger): anchors the report, pauses with the agent key, logs and alerts", async () => {
    const drained = { ...honestAfter, safe: honestAfter.safe - units("3000") };
    const t = deps(drained);
    const r = await closeDay("2025-09-22", day(), view(), t.d);
    expect(r.ok).toBe(false);
    expect(r.diffs[0]).toMatch(/Safe balance moved/);
    expect(t.order).toEqual(["anchor", "pause"]);
    expect(r.pauseTx).toBe(`0x${"99".repeat(32)}`);
    const lines = t.log.readNewest().reverse();
    expect(lines.map((l) => [l.action, l.outcome, l.reason])).toEqual([
      ["reconcile", "refused", "LedgerMismatch"],
      ["pause", "executed", undefined],
    ]);
    const alert = JSON.parse(readFileSync(t.alerts.path, "utf8").trim()) as Alert;
    expect(alert).toMatchObject({ kind: "LedgerMismatch", day: "2025-09-22", pauseTx: r.pauseTx });
  });

  it("a spentToday the ledger cannot explain (someone else spending through the module) also pauses", async () => {
    const t = deps({ ...honestAfter, spent: { 0: units("1250.5"), 1: units("2300") } });
    const r = await closeDay("2025-09-22", day(), view(), t.d);
    expect(r.diffs).toEqual([expect.stringMatching(/plan 1 spentToday moved 2,300/)]);
    expect(t.pauses).toEqual(["paused"]);
  });

  it("if the pause itself fails, it still alerts and tells the owners to pause", async () => {
    const t = deps({ ...honestAfter, safe: 0n }, true);
    const r = await closeDay("2025-09-22", day(), view(), t.d);
    expect(r.pauseTx).toBeUndefined();
    expect(t.log.readNewest()[0]).toMatchObject({ action: "pause", outcome: "refused", reason: "NotPauser" });
    expect(JSON.parse(readFileSync(t.alerts.path, "utf8").trim())).toMatchObject({ error: "NotPauser" });
  });
});
