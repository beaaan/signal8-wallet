import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, decodeFunctionData, encodeFunctionResult, keccak256, stringToBytes, toHex, type Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { erc20Abi, planModuleAbi, vaultAbi } from "../src/abis.ts";
import type { Chainish } from "../src/chain.ts";
import { loadControls } from "../src/controls.ts";
import { units, type ActionSink } from "../src/exec/executor.ts";
import { plannerPlans, registryFrom } from "../src/llm/provider.ts";
import { RulesProvider } from "../src/llm/rules.ts";
import { Ledger, reconcile, type ChainView } from "../src/ledger.ts";
import { DecisionLog, JsonlFile } from "../src/log.ts";
import { runEveryday } from "../src/loops/everyday.ts";
import { InflowWatcher, loadReceivables, type InflowEvent, type InflowSource } from "../src/loops/inflows.ts";
import { chainReader, closeDay, type Alert } from "../src/loops/reconcile.ts";
import { canonicalJson, loadPlanBook } from "../src/plan.ts";
import { consistentTransport } from "../src/rpc.ts";
import { chainSnapshot, SimSink } from "../src/sim.ts";

// Only external chain boundaries are mocked. The report serializer, invoice
// pipeline, inflow watcher, reconciliation and transport below are production code.
const boundary = vi.hoisted(() => ({ readBalances: vi.fn(), walletFor: vi.fn() }));
vi.mock("../src/chain.ts", async (original) => ({
  ...await original<typeof import("../src/chain.ts")>(), ...boundary,
}));

const root = fileURLToPath(new URL("../../", import.meta.url));
const book = loadPlanBook(join(root, "data/fixtures/plans/plan-book.example.json"));
const tx = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const dirs: string[] = [];
function temp() {
  const dir = mkdtempSync(join(tmpdir(), "s8-review-"));
  dirs.push(dir);
  return dir;
}
afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });
const view = (over: Partial<ChainView> = {}): ChainView => ({
  day: 20354n, safe: units("10000"), vault: 0n, spent: { 0: 0n, 1: 0n }, ...over,
});
function normalLedger() {
  const l = new Ledger();
  l.record({ kind: "inflow", amount: units("8000"), safeDelta: units("8000"), vaultDelta: 0n });
  l.record({ kind: "pay", amount: units("200"), planId: 0, safeDelta: -units("200"), vaultDelta: 0n });
  l.record({ kind: "vault_deposit", amount: units("7800"), safeDelta: -units("7800"), vaultDelta: units("7800") });
  return l;
}
const closing = () => view({ vault: units("7800"), spent: { 0: units("200"), 1: 0n } });
// Trusted test-oracle events, not a new runtime schema. The current narrow
// ChainView discards event coverage; a future event-aware adapter must retain it.
const offsettingView = () => ({ ...view(), transfers: [
  { tx: tx(80), safeDelta: -units("100") }, { tx: tx(81), safeDelta: units("100") },
] });
function closer(after: ChainView, failPause = false) {
  const dir = temp();
  const log = new DecisionLog(dir, false);
  const alerts = new JsonlFile<Alert>(join(dir, "alerts.jsonl"));
  const order: string[] = [];
  const pause = vi.fn(async (): Promise<Hex> => {
    order.push("pause");
    if (failPause) throw new Error("NotPauser");
    return tx(99);
  });
  return { log, alerts, order, pause, deps: {
    reader: { view: async () => after }, log, alerts, pauser: { pause },
    beforePause: async () => { order.push("anchor"); },
  } };
}

class Source implements InflowSource {
  head = 10n;
  events: InflowEvent[] = [];
  async latestBlock() { return this.head; }
  async inflows(from: bigint, to: bigint) { return this.events.filter((e) => e.block >= from && e.block <= to); }
}
function event(id: string, amount: string, n: number, swept = "0"): InflowEvent {
  return { invoiceRef: keccak256(stringToBytes(id)), amount: units(amount), swept: units(swept), tx: tx(n), block: BigInt(n) };
}

interface ProducedReport {
  kind: string;
  balances: { safe: string; vault: string; creditDrawn: string };
  inflows: { amount: string; swept: string; receivable: string | null; tx: string }[];
  results: Record<string, unknown>[];
  scheduled: Record<string, unknown>[];
  reconciliation: { ok: boolean; diffs: string[] } | null;
  openingBalances?: unknown;
}

async function produceReport(withReconciliation: boolean, reportDrift = 0n) {
  const dir = temp();
  const invoiceDir = join(dir, "invoices");
  mkdirSync(invoiceDir);
  // Use real fixtures, including a refusal and a later-due supplier invoice.
  for (const f of ["lee-kee-flour-LK-0921.txt", "wing-on-meats-WO-2231.txt", "wing-on-meats-WO-2240-injected.txt"]) {
    writeFileSync(join(invoiceDir, f), readFileSync(join(root, "data/fixtures/invoices", f)));
  }
  const log = new DecisionLog(dir, false);
  const source = new Source();
  const ledger = new Ledger();
  const sim = new SimSink(chainSnapshot(book, false));
  let safe = units("10000");
  let vault = 0n;
  let outstandingCredit = units("1000");
  const anchorHashes: Hex[] = [];
  const sink: ActionSink = {
    proposeBatch: (...args) => sim.proposeBatch(...args),
    async run(a, input) {
      const r = await sim.run(a, input);
      if (r.outcome !== "executed") return r;
      const hash = tx(100 + sim.executed.length);
      if (a.type === "pay") {
        const amount = units(a.amount);
        safe -= amount;
        ledger.record({ kind: "pay", amount, planId: a.plan === "base" ? 0 : 1, safeDelta: -amount, vaultDelta: 0n, tx: hash });
      } else if (a.type === "vault_deposit") {
        const amount = units(a.amount);
        safe -= amount;
        vault += amount;
        ledger.record({ kind: "vault_deposit", amount, safeDelta: -amount, vaultDelta: amount, tx: hash });
      } else if (a.type === "anchor") anchorHashes.push(a.hash);
      return { ...r, tx: hash };
    },
  };
  const inflows = new InflowWatcher({ source, log, receivables: loadReceivables(), checkpointFile: join(dir, "inflows.json"), fromBlock: 10n, runId: "review" });
  let balanceReads = 0;
  boundary.readBalances.mockImplementation(async () => ({ safe: safe + (++balanceReads > 1 ? reportDrift : 0n), vault, creditDrawn: outstandingCredit, creditLimit: units("50000"), coverPayout: units("20000") }));
  boundary.walletFor.mockReturnValue({
    account: { address: "0x00000000000000000000000000000000000000c1" },
    writeContract: async () => {
      // Ordinary-day router: 10% repayment sweep, capped by outstanding debt.
      safe += units("7200");
      outstandingCredit -= units("800");
      source.head = 11n;
      source.events.push(event("INV-C-2025-09-22#review", "8000", 11, "800"));
      return tx(11);
    },
  });
  const c = {
    cfg: { logDir: dir }, dep: { contracts: { MockUSD: book.payees[0]!.address, PaymentRouter: book.payees[1]!.address } },
    pub: { readContract: async () => units("8000"), simulateContract: async () => ({ request: {} }), waitForTransactionReceipt: async () => ({ status: "success" }) },
  } as unknown as Chainish;
  const pause = vi.fn(async () => tx(99));
  const result = await runEveryday({
    c, sink, log, today: "2025-09-22", runId: "review", invoiceDir, inflows,
    controls: loadControls(), provider: new RulesProvider(), payees: registryFrom(book), plans: plannerPlans(book),
    reconcile: withReconciliation ? { ledger, reader: { view: async () => view({ safe, vault, spent: { ...sim.snap.spentToday } }) }, pauser: { pause } } : undefined,
  });
  const json = readFileSync(join(dir, "report-2025-09-22-review.json"), "utf8");
  return { report: JSON.parse(json) as ProducedReport, json, result, anchorHashes, log, pause, sim };
}

describe("review: production daily-report producer", () => {
  let produced: Awaited<ReturnType<typeof produceReport>>;
  let unchecked: Awaited<ReturnType<typeof produceReport>>;
  let drifted: Awaited<ReturnType<typeof produceReport>>;
  // Setup is outside it.fails: infrastructure errors must not masquerade as known gaps.
  beforeAll(async () => {
    produced = await produceReport(true);
    unchecked = await produceReport(false);
    drifted = await produceReport(true, -units("100"));
  });

  it("R01 produces actual closing balances, refusal, schedule and matching report hash", () => {
    expect(produced.report.balances).toEqual({ safe: "10000000000", vault: "7000000000", creditDrawn: "200000000" });
    expect(produced.report.reconciliation).toEqual({ ok: true, diffs: [] });
    expect(produced.report.inflows[0]).toMatchObject({ amount: "8000000000", swept: "800000000", receivable: "INV-C-2025-09-22", tx: tx(11) });
    expect(produced.report.results).toContainEqual({ input: "invoice:lee-kee-flour-LK-0921.txt", outcome: "executed", tx: tx(101) });
    expect(produced.report.results).toContainEqual(expect.objectContaining({ outcome: "refused", input: "invoice:wing-on-meats-WO-2240-injected.txt" }));
    expect(produced.report.scheduled).toContainEqual(expect.objectContaining({ type: "pay", amount: "1200.00", ref: "WO-2231#review" }));
    expect(produced.json).toBe(canonicalJson(produced.report));
    expect(produced.anchorHashes).toEqual([keccak256(stringToBytes(produced.json))]);
    expect(produced.pause).not.toHaveBeenCalled();
  });
  it("R02 preserves null when reconciliation was not run; null is not a pass", () => {
    expect(unchecked.report.reconciliation).toBeNull();
    expect(unchecked.result.reconciliation).toBeUndefined();
    expect(unchecked.log.readNewest().some((r) => r.action === "reconcile")).toBe(false);
    expect(unchecked.anchorHashes).toHaveLength(1);
  });
  it("R03 characterizes missing opening/payment fields and delta-labelled log", () => {
    expect(produced.report.openingBalances).toBeUndefined();
    expect(produced.report.results[0]).not.toHaveProperty("payee");
    expect(produced.report.results[0]).not.toHaveProperty("amount");
    expect(produced.log.readNewest().find((r) => r.action === "reconcile")?.summary).toContain("Safe 0, vault 7,000");
  });
  it.fails("G01 business expectation: report includes observed opening balances", () => {
    expect(produced.report.openingBalances).toEqual({ safe: "10000000000", vault: "0", creditDrawn: "1000000000" });
  });
  it.fails("G02 business expectation: executed payment has invoice, recipient and amount", () => {
    expect(produced.report.results[0]).toMatchObject({ invoiceId: "LK-0921", payee: book.payees[0]!.address, amount: "200.00" });
  });
  it.fails("G03 business expectation: reconciliation summary labels closing Safe correctly", () => {
    expect(produced.log.readNewest().find((r) => r.action === "reconcile")?.summary).toContain("Safe 10,000");
  });
  it("R23 producer rereads report balances after successful comparison", () => {
    expect(drifted.result.reconciliation?.after.safe).toBe(units("10000"));
    expect(drifted.report.balances.safe).toBe("9900000000");
    expect(drifted.report.reconciliation?.ok).toBe(true);
  });
  it.fails("G07 business expectation: report closing snapshot equals reconciled snapshot", () => {
    expect(drifted.report.balances.safe).toBe(drifted.result.reconciliation!.after.safe.toString());
  });
});

describe("review: balance reconciliation and owner actions", () => {
  it("R04 normal receipts/payments/vault transfers match without pause", async () => {
    const t = closer(closing());
    expect((await closeDay("2025-09-22", normalLedger(), view(), t.deps)).ok).toBe(true);
    expect(t.order).toEqual(["anchor"]);
  });
  it.each(["omitted", "duplicate"])("R05/R06 %s payment ledger entry causes a mismatch and pause", async (mode) => {
    const ledger = normalLedger();
    if (mode === "omitted") ledger.entries.splice(1, 1);
    else ledger.record({ ...ledger.entries[1]! });
    const t = closer(closing());
    const r = await closeDay("2025-09-22", ledger, view(), t.deps);
    expect(r.ok).toBe(false);
    expect(r.diffs.some((s) => s.startsWith("Safe balance moved"))).toBe(true);
    expect(t.order).toEqual(["anchor", "pause"]);
  });
  it.each([true, false])("R07/R08 recorded=%s direct Safe payment is distinguishable by ledger delta", async (recorded) => {
    const ledger = normalLedger();
    if (recorded) ledger.record({ kind: "pay", amount: units("100"), safeDelta: -units("100"), vaultDelta: 0n, tx: tx(70), note: "owner direct payment; not PlanModule" });
    const t = closer({ ...closing(), safe: units("9900") });
    const r = await closeDay("2025-09-22", ledger, view(), t.deps);
    expect(r.ok).toBe(recorded);
    expect(t.pause.mock.calls.length).toBe(recorded ? 0 : 1);
  });
  it.each([1n, 2n, 3n])("R09/R10/R11 vault rounding gap %s base units respects tolerance of 2", async (gap) => {
    const t = closer({ ...closing(), vault: closing().vault - gap });
    const r = await closeDay("2025-09-22", normalLedger(), view(), t.deps);
    expect(r.ok).toBe(gap <= 2n);
    expect(t.pause.mock.calls.length).toBe(gap <= 2n ? 0 : 1);
  });
  it("R12 mismatched PlanModule counter pauses even when cash balances match", async () => {
    const t = closer({ ...closing(), spent: { 0: units("201"), 1: 0n } });
    const r = await closeDay("2025-09-22", normalLedger(), view(), t.deps);
    expect(r.diffs).toEqual([expect.stringContaining("plan 0 spentToday")]);
    expect(t.pause).toHaveBeenCalledOnce();
  });
  it("R13 UTC reset skips counters but continues checking Safe and vault", () => {
    const next = { ...closing(), day: 20355n, spent: { 0: 0n, 1: 0n } };
    expect(reconcile(normalLedger(), view(), next).ok).toBe(true);
    expect(reconcile(normalLedger(), view(), { ...next, safe: next.safe - 1n }).ok).toBe(false);
    expect(reconcile(normalLedger(), view(), { ...next, vault: next.vault - 3n }).ok).toBe(false);
  });
  it("R14 failed pause still writes alert and actionable owner guidance", async () => {
    const t = closer({ ...closing(), safe: units("9000") }, true);
    const r = await closeDay("2025-09-22", normalLedger(), view(), t.deps);
    expect(r.ok).toBe(false);
    expect(r.pauseTx).toBeUndefined();
    expect(JSON.parse(readFileSync(t.alerts.path, "utf8"))).toMatchObject({ kind: "LedgerMismatch", error: "NotPauser" });
    expect(t.log.readNewest()[0]?.summary).toContain("owners: pause from Safe Wallet or with the guardian key");
  });
  it("R15 RPC failure is an execution error, not verified financial mismatch", async () => {
    const t = closer(closing());
    t.deps.reader.view = async () => { throw new Error("RPC unavailable"); };
    await expect(closeDay("2025-09-22", normalLedger(), view(), t.deps)).rejects.toThrow("RPC unavailable");
    expect(t.order).toEqual([]);
    expect(t.pause).not.toHaveBeenCalled();
  });
  it("R16 two unrecorded offsetting transfers escape balance-only comparison", () => {
    // External events are intentionally absent from ChainView: -100 +100 = 0.
    const after = offsettingView();
    expect(after.transfers.reduce((a, b) => a + b.safeDelta, 0n)).toBe(0n);
    expect(reconcile(new Ledger(), view(), after).ok).toBe(true);
  });
  it.fails("G04 business expectation: offsetting off-ledger events cannot be certified complete", () => {
    expect(reconcile(new Ledger(), view(), offsettingView()).ok).toBe(false);
  });
  it("R17 debt is outside ChainView and the current comparison", () => {
    const before = { ...view(), creditDrawn: units("1000") };
    const after = { ...view(), creditDrawn: units("900") };
    expect(reconcile(new Ledger(), before, after).ok).toBe(true);
  });
  it.fails("G05 business expectation: unexplained outstanding-debt movement is flagged", () => {
    expect(reconcile(new Ledger(), { ...view(), creditDrawn: units("1000") } as ChainView, { ...view(), creditDrawn: units("900") } as ChainView).ok).toBe(false);
  });
});

describe("review: customer inflow warnings and repayment accounting", () => {
  it.each([
    { id: "INV-C-2025-09-22", amount: "7000", kind: "short", reason: "ShortPayment" },
    { id: "INV-C-2025-09-22", amount: "8100", kind: "over", reason: "Overpayment" },
    { id: "unknown", amount: "100", kind: "unmatched", reason: "UnmatchedInflow" },
  ])("R18/R19/R20 $kind: gross receipt preserved; net cash reconciles; owner warned", async ({ id, amount, kind, reason }) => {
    const dir = temp();
    const source = new Source();
    source.head = 11n;
    source.events = [event(id, amount, 11, "10")];
    const t = closer(view({ safe: units("10000") + units(amount) - units("10") }));
    const ledger = new Ledger();
    const watcher = new InflowWatcher({ source, log: t.log, receivables: loadReceivables(), checkpointFile: join(dir, "inflows.json"), fromBlock: 10n });
    const matches = await watcher.poll(ledger);
    expect(matches[0]?.kind).toBe(kind);
    expect(matches[0]?.event.amount).toBe(units(amount));
    expect(ledger.totals().safe).toBe(units(amount) - units("10"));
    expect(t.log.readNewest()[0]).toMatchObject({ outcome: "proposed", reason });
    expect((await closeDay("2025-09-22", ledger, view(), t.deps)).ok).toBe(true);
    expect(t.pause).not.toHaveBeenCalled();
    expect(await watcher.poll(ledger)).toEqual([]);
    expect(ledger.entries).toHaveLength(1);
  });
});

describe("review: actual RPC transport and snapshot consistency", () => {
  it("R21 existing transport retries lagging nodes at receipt block, without live RPC", async () => {
    let heads = 0;
    let calls = 0;
    const tags: unknown[] = [];
    const transport = consistentTransport("http://unused.invalid", { waitMs: 0, base: async ({ method, params }) => {
      if (method === "eth_getTransactionReceipt") return { blockNumber: "0x64" };
      if (method === "eth_blockNumber") return ++heads === 1 ? "0x5f" : "0x64";
      if (method === "eth_call") {
        tags.push((params as unknown[])[1]);
        if (++calls === 1) throw new Error("header not found");
        return "0x01";
      }
      throw new Error(`unexpected ${method}`);
    } })({});
    await transport.request({ method: "eth_getTransactionReceipt", params: [tx(1)] });
    expect(await transport.request({ method: "eth_call", params: [{ to: book.payees[0]!.address }, "latest"] })).toBe("0x01");
    expect(tags).toEqual(["0x64", "0x64"]);
    expect(heads).toBe(2);
  });

  let mixed: ChainView;
  let coherent: ChainView;
  let tags: string[];
  beforeAll(async () => {
    const contracts = { Safe: book.payees[3]!.address, MockUSD: book.payees[0]!.address, MockMMFVault: book.payees[1]!.address, PlanModule: book.payees[2]!.address };
    let headReads = 0;
    tags = [];
    const transport = consistentTransport("http://unused.invalid", { waitMs: 0, base: async ({ method, params }) => {
      if (method === "eth_getTransactionReceipt") return { blockNumber: "0x64" };
      if (method === "eth_blockNumber") return toHex(++headReads <= 2 ? 100n : 101n);
      if (method !== "eth_call") throw new Error(`unexpected ${method}`);
      const [call, block] = params as [{ to: string; data: Hex }, string];
      tags.push(block);
      if (call.to.toLowerCase() === contracts.MockUSD.toLowerCase()) {
        return encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: block === "0x64" ? units("10000") : units("9900") });
      }
      if (call.to.toLowerCase() === contracts.MockMMFVault.toLowerCase()) {
        return encodeFunctionResult({ abi: vaultAbi, functionName: "maxWithdraw", result: block === "0x64" ? 0n : units("100") });
      }
      const decoded = decodeFunctionData({ abi: planModuleAbi, data: call.data });
      if (decoded.functionName === "today") return encodeFunctionResult({ abi: planModuleAbi, functionName: "today", result: 20354n });
      return encodeFunctionResult({ abi: planModuleAbi, functionName: "spentToday", result: 0n });
    } });
    const pub = createPublicClient({ transport });
    // Seed read-your-writes high watermark, just as a confirmed transaction does.
    await pub.request({ method: "eth_getTransactionReceipt", params: [tx(1)] });
    mixed = await chainReader({ pub, dep: { contracts } } as unknown as Chainish).view();
    coherent = view({ safe: units("9900"), vault: units("100") });
  });
  const transferLedger = () => {
    const l = new Ledger();
    l.record({ kind: "vault_deposit", amount: units("100"), safeDelta: -units("100"), vaultDelta: units("100") });
    return l;
  };
  it("R22 actual reader can combine blocks 100/101 and cause a conditional false pause", async () => {
    expect(tags).toEqual(["0x64", "0x64", "0x65", "0x65", "0x65"]);
    expect(mixed).toEqual(view({ vault: units("100") }));
    expect(reconcile(transferLedger(), view(), coherent).ok).toBe(true);
    const t = closer(mixed);
    expect((await closeDay("2025-09-22", transferLedger(), view(), t.deps)).ok).toBe(false);
    expect(t.pause).toHaveBeenCalledOnce();
  });
  it.fails("G06 business expectation: one chainReader snapshot uses one block", () => {
    expect(new Set(tags).size).toBe(1);
  });
});
