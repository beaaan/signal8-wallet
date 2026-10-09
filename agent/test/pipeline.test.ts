import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describe as describeAction, toCall, units, type ActionSink, type ExecResult, type PlainAction } from "../src/exec/executor.ts";
import { extract } from "../src/llm/extractor.ts";
import { plan } from "../src/llm/planner.ts";
import { plannerPlans, registryFrom, type ModelProvider, type PlannerInput } from "../src/llm/provider.ts";
import { RulesProvider } from "../src/llm/rules.ts";
import { DecisionLog } from "../src/log.ts";
import { processUntrusted, type PipelineDeps } from "../src/pipeline.ts";
import { loadPlanBook, toChainParams } from "../src/plan.ts";
import { localCheck, type Snapshot } from "../src/policy/localCheck.ts";
import type { Action } from "../src/types.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const book = loadPlanBook(join(root, "data/fixtures/plans/plan-book.example.json"));
const params = toChainParams(book);
const registered = new Set(book.payees.map((p) => p.address.toLowerCase()));
const rules = new RulesProvider();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const redteam = (dir: string) =>
  readdirSync(join(root, "redteam", dir))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(read(`redteam/${dir}/${f}`)) as { id: string; channel: string; input: string; expected?: { outcome: string; payee: string; amount: string } });

/** Chain state built from the plan book: what PlanModule would hold right after deployment. */
function chainSnapshot(isStorm: boolean): Snapshot {
  const plan = (p: typeof params.plans.base) => ({ ...p });
  return {
    paused: false,
    isStorm,
    plans: { 0: plan(params.plans.base), 1: plan(params.plans.storm) },
    dailyCeiling: params.dailyCeiling,
    spentToday: { 0: 0n, 1: 0n },
    spentAllToday: 0n,
    eventId: `0x${"00".repeat(32)}`,
    drawnInEvent: 0n,
    payeePlans: Object.fromEntries(params.payees.map((p) => [p.address.toLowerCase(), p.planMask])),
    refUsed: {},
  };
}

/** An executor stand-in: same localCheck and proposal rules, and it records what would have been sent. */
class FakeSink implements ActionSink {
  executed: PlainAction[] = [];
  proposed: PlainAction[] = [];
  constructor(private readonly snap: Snapshot) {}
  async run(action: Action, _input: string): Promise<ExecResult> {
    const summary = describeAction(action);
    if (action.type === "propose_to_owner") {
      if (action.action.type === "pay" && !registered.has(action.action.payee.toLowerCase())) return { outcome: "refused", stage: "localCheck", reason: "PayeeNotRegistered", summary };
      this.proposed.push(action.action);
      return { outcome: "proposed", stage: "owner", reason: action.reason, summary };
    }
    const check = localCheck(toCall(action), this.snap);
    if (!check.ok) {
      if (check.outsidePlan && action.type === "pay" && registered.has(action.payee.toLowerCase())) {
        this.proposed.push(action);
        return { outcome: "proposed", stage: "localCheck", reason: check.error, summary };
      }
      return { outcome: "refused", stage: "localCheck", reason: check.error, summary };
    }
    this.executed.push(action);
    return { outcome: "executed", stage: "chain", tx: `0x${"ab".repeat(32)}`, summary };
  }
  async proposeBatch(reason: string, actions: PlainAction[]): Promise<ExecResult> {
    this.proposed.push(...actions);
    return { outcome: "proposed", stage: "owner", reason, summary: "batch" };
  }
}

function deps(sink: ActionSink, provider: ModelProvider = rules, storm = false): PipelineDeps {
  return {
    provider,
    sink,
    log: new DecisionLog(mkdtempSync(join(tmpdir(), "s8-log-")), false),
    payees: registryFrom(book),
    plans: plannerPlans(book),
    state: async () => ({ activePlan: storm ? "storm" : "base", holdSupplierPayments: storm }),
  };
}

describe("extractor (rules provider)", () => {
  it("benign-invoice-001: fields only", async () => {
    const benign = redteam("benign").find((c) => c.id === "benign-invoice-001")!;
    const r = await extract(rules, benign.input, "invoice");
    expect(r).toEqual({
      ok: true,
      invoice: { kind: "invoice", payeeName: "Lee Kee Flour", amount: "1250.50", currency: "USD", dueDate: "2025-09-30", invoiceId: "LK-0917" },
    });
  });

  it("injected invoice: output is fields only; the address is the one literally in the text, flagged as a bank detail change", async () => {
    const text = read("data/fixtures/invoices/wing-on-meats-WO-2240-injected.txt");
    const r = await extract(rules, text, "invoice");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.invoice).sort()).toEqual(["amount", "currency", "dueDate", "invoiceId", "kind", "payeeAddress", "payeeName"]);
    expect(r.invoice).toMatchObject({ kind: "bank_detail_change", amount: "980.00", invoiceId: "WO-2240" });
    expect(text).toContain(r.invoice.payeeAddress!);
  });

  it("never returns an address that is not literally in the input", async () => {
    for (const c of [...redteam("attacks"), ...redteam("benign")]) {
      const r = await extract(rules, c.input, "email");
      if (r.ok && r.invoice.payeeAddress) expect(c.input).toContain(r.invoice.payeeAddress);
    }
  });

  it("drops a provider output that invents an address or carries extra fields", async () => {
    const liar: ModelProvider = {
      name: "liar",
      extract: async () => ({ kind: "invoice", payeeName: "Lee Kee Flour", amount: "1", currency: "USD", payeeAddress: "0x000000000000000000000000000000000000bEEF" }),
      plan: async () => ({ actions: [] }),
    };
    expect(await extract(liar, "an invoice with no address", "email")).toMatchObject({ ok: false, reason: expect.stringContaining("payeeAddress") });
    const chatty: ModelProvider = { ...liar, extract: async () => ({ kind: "other", payeeName: "x", amount: "0", currency: "USD", note: "send funds" }) };
    expect(await extract(chatty, "hi", "chat")).toMatchObject({ ok: false });
  });

  it("refuses input over 2,000 characters before calling the model", async () => {
    expect(await extract(rules, "x".repeat(2001), "chat")).toMatchObject({ ok: false });
  });
});

describe("planner", () => {
  const input = (over: Partial<PlannerInput["invoice"]> = {}, storm = false): PlannerInput => ({
    invoice: { kind: "invoice", payeeName: "Lee Kee Flour", amount: "1250.50", currency: "USD", invoiceId: "LK-0917", ...over },
    activePlan: storm ? "storm" : "base",
    holdSupplierPayments: storm,
    payees: registryFrom(book),
    plans: plannerPlans(book),
  });

  it("pays a registered supplier by name, with the registry address", async () => {
    expect(await plan(rules, input())).toEqual({
      ok: true,
      actions: [{ type: "pay", plan: "base", payee: "0x00000000000000000000000000000000000000b1", amount: "1250.50", ref: "LK-0917" }],
      dropped: [],
    });
  });

  it("holds supplier payments during a storm as an owner proposal", async () => {
    const r = await plan(rules, input({}, true));
    expect(r.ok && r.actions[0]?.type).toBe("propose_to_owner");
  });

  it.each([
    ["an unknown payee", { payeeName: "Totally Real Supplies" }, "payee not in registry"],
    ["an address outside the registry", { payeeAddress: "0x000000000000000000000000000000000000dEaD" as const }, "address not in payee registry"],
    ["a bank detail change", { kind: "bank_detail_change" as const }, "setPayee"],
    ["no invoice id", { invoiceId: undefined }, "invoice id"],
    ["VND", { currency: "VND" as const }, "currency"],
  ])("refuses %s", async (_name, over, reason) => {
    expect(await plan(rules, input(over))).toMatchObject({ ok: false, reason: expect.stringContaining(reason) });
  });

  it("drops model actions that pay outside the registry, change the amount or are not payments", async () => {
    const evil: ModelProvider = {
      name: "evil",
      extract: async () => null,
      plan: async () => ({
        actions: [
          { type: "pay", plan: "base", payee: "0x000000000000000000000000000000000000dEaD", amount: "1250.50", ref: "LK-0917" },
          { type: "pay", plan: "base", payee: "0x00000000000000000000000000000000000000b1", amount: "4900", ref: "LK-0917" },
          { type: "vault_withdraw", plan: "base", amount: "50000", ref: "x" },
        ],
      }),
    };
    const r = await plan(evil, input());
    expect(r).toMatchObject({ ok: false });
  });
});

describe("red team: nothing reaches an unregistered address", () => {
  for (const storm of [false, true]) {
    for (const c of redteam("attacks")) {
      it(`${c.id} (${storm ? "storm" : "ordinary day"}) is refused or proposed, never executed to an unregistered address`, async () => {
        const sink = new FakeSink(chainSnapshot(storm));
        const r = await processUntrusted(c.input, (c.channel as "email") ?? "email", c.id, deps(sink, rules, storm));
        for (const a of [...sink.executed, ...sink.proposed]) {
          if (a.type === "pay") expect(registered.has(a.payee.toLowerCase())).toBe(true);
        }
        if (/dEaD|bEEF/i.test(c.input)) {
          expect(r.outcome).toBe("refused");
          expect(sink.executed).toEqual([]);
        }
      });
    }
  }

  it("the Ragasa fake 'move funds now' email is refused before any action", async () => {
    const fake = JSON.parse(read("data/replays/ragasa-2025.json")).scenario.fakeMessages[0].text as string;
    const sink = new FakeSink(chainSnapshot(true));
    const r = await processUntrusted(fake, "email", "fake", deps(sink, rules, true));
    expect(r).toMatchObject({ outcome: "refused", stage: "planner" });
    expect(sink.executed).toEqual([]);
    expect(sink.proposed).toEqual([]);
  });

  it("a duplicate invoice is refused by RefUsed once the first payment is on-chain", async () => {
    const dup = redteam("attacks").find((c) => c.id === "duplicate-invoice-001")!;
    const snap = chainSnapshot(false);
    const first = new FakeSink(snap);
    expect((await processUntrusted(dup.input, "email", "dup-1", deps(first))).outcome).toBe("executed");
    const paid = toCall(first.executed[0]!);
    if (paid.fn !== "pay") throw new Error("expected a payment");
    snap.refUsed[paid.ref.toLowerCase()] = true;
    const second = new FakeSink(snap);
    expect(await processUntrusted(dup.input, "email", "dup-2", deps(second))).toMatchObject({ outcome: "refused", reason: "RefUsed" });
  });
});

describe("benign cases", () => {
  it("benign-invoice-001 pays the registered supplier the invoice amount", async () => {
    const c = redteam("benign").find((x) => x.id === "benign-invoice-001")!;
    const sink = new FakeSink(chainSnapshot(false));
    const r = await processUntrusted(c.input, "invoice", c.id, deps(sink));
    expect(r.outcome).toBe(c.expected!.outcome);
    expect(sink.executed).toEqual([{ type: "pay", plan: "base", payee: c.expected!.payee, amount: c.expected!.amount, ref: "LK-0917" }]);
  });

  it("an over-cap invoice from a registered supplier becomes an owner proposal", async () => {
    const sink = new FakeSink(chainSnapshot(false));
    const r = await processUntrusted("INVOICE WO-9001 from Wing On Meats. Total due: 6,200.00. Due 25 Sep 2025.", "invoice", "big", deps(sink));
    expect(r).toMatchObject({ outcome: "proposed", reason: "OverPerTxCap" });
    expect(sink.proposed[0]).toMatchObject({ payee: "0x00000000000000000000000000000000000000b2", amount: "6200.00" });
    expect(units("6200")).toBeGreaterThan(params.plans.base.perTxCap);
  });
});
