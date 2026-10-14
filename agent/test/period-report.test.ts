// Issue #18 regression tests: event coverage, debt, one-block snapshots, containment and period reports.
// No chain: the production chainReader runs over consistentTransport with a fake JSON-RPC node.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, hexToBigInt, keccak256, stringToBytes, toHex, type Hex } from "viem";
import { afterAll, describe, expect, it, vi } from "vitest";
import { creditLineAbi, erc20Abi, planModuleAbi, vaultAbi } from "../src/abis.ts";
import type { Chainish } from "../src/chain.ts";
import { units, type ActionSink } from "../src/exec/executor.ts";
import { Ledger, reconcile, type ChainView, type SafeTransfer } from "../src/ledger.ts";
import { DecisionLog, JsonlFile } from "../src/log.ts";
import { InflowWatcher, loadReceivables, type InflowEvent } from "../src/loops/inflows.ts";
import { chainReader, closeDay, type Alert } from "../src/loops/reconcile.ts";
import { closePeriod, reportName } from "../src/loops/report.ts";
import { consistentTransport } from "../src/rpc.ts";
import type { Action } from "../src/types.ts";

const tx = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const dirs: string[] = [];
function temp() {
  const dir = mkdtempSync(join(tmpdir(), "s8-period-"));
  dirs.push(dir);
  return dir;
}
afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

const view = (over: Partial<ChainView> = {}): ChainView => ({ day: 20354n, safe: units("10000"), vault: 0n, spent: { 0: 0n, 1: 0n }, ...over });
const log = (n: number, safeDelta: string, logIndex = 0): SafeTransfer => ({ tx: tx(n), logIndex, safeDelta: units(safeDelta) });

describe("event coverage is checked apart from balances", () => {
  it("a quiet day with the logs read is complete; without the logs it is limited, and neither fails", () => {
    expect(reconcile(new Ledger(), view(), view({ transfers: [] }))).toMatchObject({ ok: true, coverage: { status: "complete", transfers: 0 } });
    expect(reconcile(new Ledger(), view(), view())).toMatchObject({ ok: true, coverage: { status: "limited" } });
  });

  it("every Safe transfer matched to a recorded tx (net per tx) is complete; a duplicated log counts once", () => {
    const l = new Ledger();
    l.record({ kind: "inflow", amount: units("8000"), safeDelta: units("7200"), vaultDelta: 0n, debtDelta: -units("800"), tx: tx(1) });
    l.record({ kind: "pay", amount: units("200"), planId: 0, safeDelta: -units("200"), vaultDelta: 0n, tx: tx(2) });
    const transfers = [log(1, "7200"), log(2, "-200"), log(2, "-200")];
    const r = reconcile(l, view({ creditDrawn: units("1000") }), view({ safe: units("17000"), spent: { 0: units("200"), 1: 0n }, creditDrawn: units("200"), transfers }));
    expect(r).toMatchObject({ ok: true, checks: { balances: "ok", spent: "ok", debt: "ok" }, coverage: { status: "complete", transfers: 2 } });
  });

  it("an owner's direct payment reconciles only with its transaction as evidence", () => {
    const after = view({ safe: units("9900"), transfers: [log(70, "-100")] });
    const withTx = new Ledger();
    withTx.record({ kind: "pay", amount: units("100"), safeDelta: -units("100"), vaultDelta: 0n, tx: tx(70), note: "owner direct payment" });
    expect(reconcile(withTx, view(), after).ok).toBe(true);
    const claimed = new Ledger();
    claimed.record({ kind: "pay", amount: units("100"), safeDelta: -units("100"), vaultDelta: 0n, note: "owner says they paid" });
    const r = reconcile(claimed, view(), after);
    expect(r.checks.balances).toBe("ok");
    expect(r.coverage).toMatchObject({ status: "gaps", untraced: 1, unrecorded: [log(70, "-100")] });
    expect(r.diffs).toContain("1 ledger entry moves Safe cash without a tx hash");
  });

  it("two fabricated offsetting entries without transactions do not pass when the logs are read", () => {
    const l = new Ledger();
    l.record({ kind: "pay", amount: units("100"), safeDelta: -units("100"), vaultDelta: 0n });
    l.record({ kind: "inflow", amount: units("100"), safeDelta: units("100"), vaultDelta: 0n });
    expect(reconcile(l, view(), view()).ok).toBe(true); // balance-only: limited coverage, cannot tell
    expect(reconcile(l, view(), view({ transfers: [] })).ok).toBe(false);
  });

  it("a recorded tx the logs do not show, or show with another amount, is a gap; so is an unrecorded tx netting to zero", () => {
    const l = new Ledger();
    l.record({ kind: "pay", amount: units("200"), planId: 0, safeDelta: -units("200"), vaultDelta: 0n, tx: tx(2) });
    l.record({ kind: "pay", amount: units("300"), planId: 0, safeDelta: -units("300"), vaultDelta: 0n, tx: tx(3) });
    const after = view({ safe: units("9500"), spent: { 0: units("500"), 1: 0n }, transfers: [log(3, "-250"), log(9, "-50", 0), log(9, "50", 1)] });
    const r = reconcile(l, view(), after);
    expect(r.checks.balances).toBe("ok");
    expect(r.coverage.unmatched).toEqual([
      { tx: tx(2), ledger: -units("200"), chain: 0n },
      { tx: tx(3), ledger: -units("300"), chain: -units("250") },
    ]);
    expect(r.diffs).toContain(`unrecorded Safe movement 0 in tx ${tx(9).slice(0, 10)}…`);
    expect(r.ok).toBe(false);
  });
});

describe("debt over the storm period", () => {
  // Bookkeeping notes: cover +C (no debt), draw +D (debt +D, not revenue), receipt gross G with sweep S (Safe +(G-S), debt -S).
  function stormLedger() {
    const l = new Ledger();
    l.record({ kind: "vault_withdraw", amount: units("15000"), safeDelta: units("15000"), vaultDelta: -units("15000"), tx: tx(11) });
    l.record({ kind: "cover_claim", amount: units("20000"), safeDelta: units("20000"), vaultDelta: 0n, tx: tx(12) });
    l.record({ kind: "pay", amount: units("2300"), planId: 1, payee: "0x00000000000000000000000000000000000000a1", ref: "payroll:2025-09#r1", safeDelta: -units("2300"), vaultDelta: 0n, tx: tx(13) });
    l.record({ kind: "pay", amount: units("2300"), planId: 1, payee: "0x00000000000000000000000000000000000000a2", ref: "payroll:2025-09#r1", safeDelta: -units("2300"), vaultDelta: 0n, tx: tx(14) });
    l.record({ kind: "credit_draw", amount: units("15000"), safeDelta: units("15000"), vaultDelta: 0n, debtDelta: units("15000"), tx: tx(15) });
    l.record({ kind: "inflow", amount: units("5000"), safeDelta: units("4500"), vaultDelta: 0n, debtDelta: -units("500"), tx: tx(16), note: "INV-C-2025-09-25" });
    return l;
  }
  const opening = view({ vault: units("46749.5"), creditDrawn: 0n, block: 200n });
  const transfers = [log(11, "15000"), log(12, "20000"), log(13, "-2300"), log(14, "-2300"), log(15, "15000"), log(16, "4500")];
  const closing = view({ safe: units("59900"), vault: units("31749.5"), spent: { 0: 0n, 1: units("4600") }, creditDrawn: units("14500"), block: 300n, transfers });

  it("draws minus router repayments reconcile; the sweep is not subtracted twice", () => {
    expect(reconcile(stormLedger(), opening, closing)).toMatchObject({ ok: true, expected: { safe: units("49900"), debt: units("14500") }, checks: { debt: "ok" }, coverage: { status: "complete", transfers: 6 } });
  });

  it("a repayment the ledger does not know (anyone may repay) is flagged even though cash matches", () => {
    const r = reconcile(stormLedger(), opening, { ...closing, creditDrawn: units("14000") });
    expect(r.checks).toMatchObject({ balances: "ok", debt: "mismatch" });
    expect(r.diffs).toEqual(["outstanding credit moved 14,000, ledger says 14,500"]);
  });

  it("the inflow watcher records gross, net to the Safe and the swept repayment once", async () => {
    const dir = temp();
    const event: InflowEvent = { invoiceRef: keccak256(stringToBytes("INV-C-2025-09-25")), amount: units("5000"), swept: units("500"), tx: tx(16), block: 5n };
    const source = { latestBlock: async () => 5n, inflows: async () => [event] };
    const ledger = new Ledger();
    await new InflowWatcher({ source, log: new DecisionLog(dir, false), receivables: loadReceivables(), checkpointFile: join(dir, "cp.json"), fromBlock: 1n }).poll(ledger);
    expect(ledger.entries).toEqual([{ kind: "inflow", amount: units("5000"), safeDelta: units("4500"), vaultDelta: 0n, debtDelta: -units("500"), tx: tx(16), note: "INV-C-2025-09-25" }]);
  });

  it("closes the storm period with its own versioned, anchored report", async () => {
    const dir = temp();
    const anchors: Action[] = [];
    const sink: ActionSink = {
      run: async (a) => { anchors.push(a); return { outcome: "executed", stage: "chain", tx: tx(99), summary: "anchor" }; },
      proposeBatch: async () => { throw new Error("unexpected"); },
    };
    const c = { cfg: { logDir: dir, network: "anvil" }, dep: { chainId: 31337, contracts: { MockUSD: "0x0000000000000000000000000000000000000001", Safe: "0x0000000000000000000000000000000000005afe" } } } as unknown as Chainish;
    const pause = vi.fn(async () => tx(98));
    const close = await closePeriod({
      c, sink, deps: { reader: { view: async () => closing }, log: new DecisionLog(dir, false), pauser: { pause } },
      period: { id: "storm", from: "2025-09-22", to: "2025-09-25" }, runId: "r1", ledger: stormLedger(), opening, inflows: [], results: [{ input: "email:x", outcome: "refused", reason: "NotAnInvoice" }],
    });
    expect(close.rec.ok).toBe(true);
    expect(pause).not.toHaveBeenCalled();
    expect(close.report!.file).toBe(join(dir, "report-2025-09-25-r1-storm.json"));
    const json = readFileSync(close.report!.file, "utf8");
    expect(anchors).toEqual([{ type: "anchor", kind: "DAILY_REPORT", hash: keccak256(stringToBytes(json)) }]);
    const report = JSON.parse(json);
    expect(report).toMatchObject({
      kind: "DAILY_REPORT", version: 2, date: "2025-09-25", period: { id: "storm", from: "2025-09-22", to: "2025-09-25" },
      chain: { network: "anvil", chainId: 31337, token: { decimals: 6 } },
      blocks: { opening: "200", closing: "300" },
      openingBalances: { safe: "10000000000", vault: "46749500000", creditDrawn: "0" },
      balances: { safe: "59900000000", vault: "31749500000", creditDrawn: "14500000000" },
      reconciliation: { ok: true, diffs: [] },
      checks: { balances: "ok", debt: "ok", coverage: { status: "complete", fromBlock: "201", toBlock: "300", transfers: 6 } },
    });
    expect(report.movements.map((m: { kind: string }) => m.kind)).toEqual(["vault_withdraw", "cover_claim", "pay", "pay", "credit_draw", "inflow"]);
    expect(report.movements[4]).toMatchObject({ kind: "credit_draw", debtDelta: "15000000000", tx: tx(15) });
    expect(report.movements[2]).toMatchObject({ payee: "0x00000000000000000000000000000000000000a1", ref: "payroll:2025-09#r1", planId: 1 });
  });

  it("never overwrites an existing report; the reconciliation still stands and the error is recorded", async () => {
    const dir = temp();
    expect(reportName("2025-09-22", "r1")).toBe("report-2025-09-22-r1.json"); // the ordinary day keeps the version-1 name
    writeFileSync(join(dir, "report-2025-09-22-r1.json"), "historical");
    const sink: ActionSink = { run: vi.fn(), proposeBatch: vi.fn() };
    const c = { cfg: { logDir: dir }, dep: { contracts: {} } } as unknown as Chainish;
    const close = await closePeriod({
      c, sink, deps: { reader: { view: async () => view() }, log: new DecisionLog(dir, false), pauser: { pause: vi.fn() } },
      period: { id: "ordinary-day", from: "2025-09-22", to: "2025-09-22" }, runId: "r1", ledger: new Ledger(), opening: view(), inflows: [], results: [],
    });
    expect(close.rec).toMatchObject({ ok: true, reportError: expect.stringContaining("already exists") });
    expect(close.report).toBeUndefined();
    expect(readFileSync(join(dir, "report-2025-09-22-r1.json"), "utf8")).toBe("historical");
    expect(sink.run).not.toHaveBeenCalled();
  });
});

describe("containment after a verified mismatch", () => {
  it("report and pause both fail: the alert keeps the mismatch, both errors and the owners' manual-pause guidance", async () => {
    const dir = temp();
    const decisions = new DecisionLog(dir, false);
    const alerts = new JsonlFile<Alert>(join(dir, "alerts.jsonl"));
    const r = await closeDay("2025-09-25", new Ledger(), view(), {
      reader: { view: async () => view({ safe: units("9000"), block: 7n }) }, log: decisions, alerts, period: "storm",
      pauser: { pause: async () => { throw new Error("NotPauser"); } },
      beforePause: async () => { throw new Error("anchor RPC down"); },
    });
    expect(r).toMatchObject({ ok: false, pauseError: "NotPauser", reportError: "anchor RPC down" });
    expect(alerts.readNewest(5)).toEqual([expect.objectContaining({
      kind: "LedgerMismatch", period: "storm", block: "7", error: "NotPauser", reportError: "anchor RPC down", diffs: ["Safe balance moved -1,000, ledger says 0"],
      guidance: expect.stringContaining("from Safe Wallet (two owners) or with the guardian key"),
    })]);
    const lines = decisions.readNewest().reverse();
    expect(lines.map((l) => [l.input, l.action, l.reason])).toEqual([
      ["reconcile:storm:2025-09-25", "reconcile", "LedgerMismatch"],
      ["reconcile:storm:2025-09-25", "report", "anchor RPC down"],
      ["reconcile:storm:2025-09-25", "pause", "NotPauser"],
    ]);
    expect(lines[0]!.summary).toMatch(/^End of storm period 2025-09-25: Safe balance moved -1,000/);
    expect(lines[2]!.summary).toContain("owners: pause from Safe Wallet or with the guardian key");
  });

  it("a read failure before the comparison is not verified: no mismatch, report, pause or alert", async () => {
    const dir = temp();
    const pause = vi.fn();
    const beforePause = vi.fn();
    const alerts = new JsonlFile<Alert>(join(dir, "alerts.jsonl"));
    await expect(closeDay("2025-09-22", new Ledger(), view(), { reader: { view: async () => { throw new Error("header not found"); } }, log: new DecisionLog(dir, false), alerts, pauser: { pause }, beforePause })).rejects.toThrow("header not found");
    expect([pause.mock.calls.length, beforePause.mock.calls.length, alerts.readNewest(5).length]).toEqual([0, 0, 0]);
  });
});

/** A fake node: per-block state, Transfer logs, and optionally a lagging replica that answers every other call. */
const K = {
  Safe: "0x0000000000000000000000000000000000005afe",
  MockUSD: "0x0000000000000000000000000000000000000001",
  MockMMFVault: "0x0000000000000000000000000000000000000002",
  PlanModule: "0x0000000000000000000000000000000000000003",
  FlowCreditLine: "0x0000000000000000000000000000000000000004",
} as const;
interface State { safe: bigint; vault: bigint; drawn: bigint }
interface RawTransfer { block: bigint; tx: Hex; logIndex: number; from: Hex; to: Hex; value: bigint }

function fakeNode(o: { states: Array<[bigint, State]>; heads: bigint[]; receipt: bigint; transfers?: RawTransfer[]; laggingHead?: bigint }) {
  const calls: Array<{ method: string; block?: string; node: string }> = [];
  let heads = 0;
  let turn = 0;
  const at = (b: bigint) => o.states.filter(([n]) => n <= b).at(-1)![1];
  const base = async ({ method, params }: { method: string; params?: unknown }) => {
    const node = o.laggingHead !== undefined && turn++ % 2 === 0 ? "lagging" : "fresh";
    const p = (params ?? []) as unknown[];
    if (method === "eth_getTransactionReceipt") return { blockNumber: toHex(o.receipt) };
    if (method === "eth_blockNumber") {
      calls.push({ method, node });
      return toHex(node === "lagging" ? o.laggingHead! : o.heads[Math.min(heads++, o.heads.length - 1)]!);
    }
    if (method === "eth_call") {
      const [call, tag] = p as [{ to: Hex; data: Hex }, Hex];
      calls.push({ method, block: tag, node });
      const block = hexToBigInt(tag);
      if (node === "lagging" && block > o.laggingHead!) throw new Error("header not found");
      const s = at(block);
      const to = call.to.toLowerCase();
      if (to === K.MockUSD) return encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: s.safe });
      if (to === K.MockMMFVault) return encodeFunctionResult({ abi: vaultAbi, functionName: "maxWithdraw", result: s.vault });
      if (to === K.FlowCreditLine) return encodeFunctionResult({ abi: creditLineAbi, functionName: "drawn", result: s.drawn });
      const fn = decodeFunctionData({ abi: planModuleAbi, data: call.data }).functionName;
      return fn === "today" ? encodeFunctionResult({ abi: planModuleAbi, functionName: "today", result: 20354n }) : encodeFunctionResult({ abi: planModuleAbi, functionName: "spentToday", result: 0n });
    }
    if (method === "eth_getLogs") {
      const [f] = p as [{ fromBlock: Hex; toBlock: Hex; topics: Array<Hex | null> }];
      calls.push({ method, block: `${hexToBigInt(f.fromBlock)}-${hexToBigInt(f.toBlock)}`, node });
      return (o.transfers ?? [])
        .filter((t) => t.block >= hexToBigInt(f.fromBlock) && t.block <= hexToBigInt(f.toBlock))
        .map((t) => ({ t, topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: t.from, to: t.to } }) }))
        .filter(({ topics }) => f.topics.every((want, i) => !want || (want as Hex).toLowerCase() === (topics[i] as Hex).toLowerCase()))
        .map(({ t, topics }) => ({
          address: K.MockUSD, topics, data: encodeAbiParameters([{ type: "uint256" }], [t.value]), blockNumber: toHex(t.block), blockHash: tx(Number(t.block)),
          transactionHash: t.tx, transactionIndex: "0x0", logIndex: toHex(t.logIndex), removed: false,
        }));
    }
    throw new Error(`unexpected ${method}`);
  };
  const pub = createPublicClient({ transport: consistentTransport("http://unused.invalid", { waitMs: 0, base }) });
  const c = { pub, dep: { contracts: K } } as unknown as Chainish;
  return { c, pub, calls, seed: () => pub.request({ method: "eth_getTransactionReceipt", params: [tx(1)] }) };
}

describe("production chainReader: one block per view", () => {
  const before: State = { safe: units("10000"), vault: 0n, drawn: units("1000") };
  const deposited: State = { safe: units("9900"), vault: units("100"), drawn: units("1000") };
  const later: State = { safe: units("9800"), vault: units("100"), drawn: units("1000") }; // next period's payment
  const deposit: RawTransfer = { block: 101n, tx: tx(101), logIndex: 0, from: K.Safe, to: K.MockMMFVault, value: units("100") };
  const ledger = () => {
    const l = new Ledger();
    l.record({ kind: "vault_deposit", amount: units("100"), safeDelta: -units("100"), vaultDelta: units("100"), tx: tx(101) });
    return l;
  };

  it("an advancing head (101 then 102) is pinned to the first block seen, so the day reconciles without a false pause", async () => {
    const n = fakeNode({ states: [[0n, before], [101n, deposited], [102n, later]], heads: [100n, 101n, 102n, 102n], receipt: 101n, transfers: [deposit] });
    const opening = { ...view(), block: 100n, creditDrawn: units("1000") };
    await n.seed(); // the agent's own deposit receipt at block 101
    const pause = vi.fn(async () => tx(99));
    const r = await closeDay("2025-09-22", ledger(), opening, { reader: chainReader(n.c), log: new DecisionLog(temp(), false), pauser: { pause } });
    expect(n.calls.filter((c) => c.method === "eth_call").map((c) => c.block)).toEqual(Array(6).fill("0x65"));
    expect(r.after).toMatchObject({ block: 101n, safe: units("9900"), vault: units("100"), creditDrawn: units("1000") });
    expect(r).toMatchObject({ ok: true, checks: { balances: "ok", debt: "ok" }, coverage: { status: "complete", transfers: 1 } });
    expect(pause).not.toHaveBeenCalled();
  });

  it("a lagging replica without the pinned block is asked again instead of failing the reconciliation (R21 kept)", async () => {
    const n = fakeNode({ states: [[0n, before], [101n, deposited]], heads: [101n], receipt: 101n, transfers: [deposit], laggingHead: 100n });
    await n.seed();
    const r = await closeDay("2025-09-22", ledger(), { ...view(), block: 100n, creditDrawn: units("1000") }, { reader: chainReader(n.c), log: new DecisionLog(temp(), false), pauser: { pause: vi.fn() } });
    expect(r.ok).toBe(true);
    expect(n.calls.some((c) => c.method === "eth_call" && c.node === "lagging")).toBe(true); // refused once, then retried
    expect(new Set(n.calls.filter((c) => c.method === "eth_call").map((c) => c.block))).toEqual(new Set(["0x65"]));
  });

  it("a node whose head is older than the opening block cannot make the closing view precede the opening", async () => {
    const n = fakeNode({ states: [[0n, before]], heads: [99n], receipt: 0n, transfers: [] });
    const v = await chainReader(n.c).view(100n);
    expect(v).toMatchObject({ block: 100n, transfers: [] });
    expect(new Set(n.calls.filter((c) => c.method === "eth_call").map((c) => c.block))).toEqual(new Set(["0x64"]));
    expect(n.calls.some((c) => c.method === "eth_getLogs")).toBe(false); // no block after the opening yet
  });

  it("reads the Safe's Transfer logs in 200-block ranges, from and to the Safe, de-duplicated by tx and log index", async () => {
    const transfers: RawTransfer[] = [
      { block: 150n, tx: tx(150), logIndex: 0, from: "0x00000000000000000000000000000000000000c1", to: K.Safe, value: units("7200") },
      { block: 320n, tx: tx(320), logIndex: 2, from: K.Safe, to: "0x00000000000000000000000000000000000000b1", value: units("200") },
      { block: 400n, tx: tx(400), logIndex: 1, from: K.Safe, to: K.Safe, value: units("5") }, // in both queries
      { block: 401n, tx: tx(401), logIndex: 0, from: "0x00000000000000000000000000000000000000c1", to: "0x00000000000000000000000000000000000000b1", value: 1n },
    ];
    const n = fakeNode({ states: [[0n, before]], heads: [450n], receipt: 0n, transfers });
    const v = await chainReader(n.c).view(100n);
    expect(n.calls.filter((c) => c.method === "eth_getLogs").map((c) => c.block)).toEqual(["101-300", "101-300", "301-450", "301-450"]);
    expect(v.transfers).toEqual([
      { tx: tx(150), logIndex: 0, block: 150n, safeDelta: units("7200") },
      { tx: tx(320), logIndex: 2, block: 320n, safeDelta: -units("200") },
      { tx: tx(400), logIndex: 1, block: 400n, safeDelta: 0n },
    ]);
  });
});
