// Issue #16: what is payable now. Amount due over order totals, part payments bounded by the purchase order,
// credit notes and statements, replacement invoices, and documents that themselves say not to pay yet.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PayeeControls } from "../src/controls.ts";
import { describe as describeAction } from "../src/exec/calls.ts";
import { invoiceRef, refFor } from "../src/exec/refs.ts";
import { extract } from "../src/llm/extractor.ts";
import { plan } from "../src/llm/planner.ts";
import { plannerPlans, registryFrom, type ModelProvider, type PlannerInput } from "../src/llm/provider.ts";
import { extractFields, RulesProvider } from "../src/llm/rules.ts";
import { loadPlanBook } from "../src/plan.ts";
import type { ExtractedInvoice } from "../src/types.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const book = loadPlanBook(join(root, "data/fixtures/plans/plan-book.example.json"));
const rules = new RulesProvider();
const flour = book.payees.find((p) => p.id === "supplier-flour")!.address;
const meat = book.payees.find((p) => p.id === "supplier-meat")!.address;

const input = (invoice: ExtractedInvoice): PlannerInput => ({ invoice, activePlan: "base", holdSupplierPayments: false, payees: registryFrom(book), plans: plannerPlans(book) });
const inv = (o: Partial<ExtractedInvoice>): ExtractedInvoice => ({ kind: "invoice", payeeName: "Wing On Meats", amount: "600.00", currency: "USD", invoiceId: "WO-9001", ...o });
const controls = (o: Partial<PayeeControls> = {}): PayeeControls => ({
  requiresPO: { "supplier-flour": false, "supplier-meat": true },
  orders: [{ po: "PO-9001", supplier: "supplier-meat", invoiceId: "WO-9001", amount: "600.00" }],
  paid: [],
  ...o,
});

describe("extraction: what is payable now (rules provider)", () => {
  it("takes the amount due, not the order or invoice total written before it", () => {
    expect(extractFields("INVOICE LK-0921 from Lee Kee Flour. Original order total: 200.00. Amount due: 100.00. Remaining balance: 100.00.").amount).toBe("100.00");
    expect(extractFields("FINAL INVOICE WO-3204 from Wing On Meats. Original order total: 600.00. Deposit paid: 120.00. Balance due: 480.00.").amount).toBe("480.00");
    expect(extractFields("Invoice LK-1 from Lee Kee Flour. Total: 75.00").amount).toBe("75.00");
  });

  it("reads credit notes and statements as what they are", () => {
    expect(extractFields("CREDIT NOTE CN-2231 from Wing On Meats. Credit amount: 100.00 against invoice WO-2231. No payment is requested.").kind).toBe("credit_note");
    expect(extractFields("Please find our credit note CN-7 for 50.00 against invoice WO-2231.").kind).toBe("credit_note");
    expect(extractFields("STATEMENT from Lee Kee Flour. Invoice LK-0921, amount due 200.00.").kind).toBe("statement");
    // an invoice that mentions an applied credit note is still an invoice
    expect(extractFields("INVOICE WO-2231 from Wing On Meats. Credit note CN-1 applied. Amount due: 1,100.00.").kind).toBe("invoice");
  });

  it("takes the replacement invoice's number over the withdrawn one", () => {
    const f = extractFields("Original invoice WO-3210 from Wing On Meats was withdrawn. Replacement invoice WO-3210A is the active invoice. Amount due: 200.00.");
    expect(f.invoiceId).toBe("WO-3210A");
  });

  it("flags a document that says not received, disputed or hold, and nothing else", () => {
    expect(extractFields("INVOICE WO-2240 from Wing On Meats. Amount due: 820.00. The order has not been delivered.").hold).toBe("not_received");
    expect(extractFields("INVOICE WO-3220 from Wing On Meats. Amount due: 1,200.00. Delivery is delayed.").hold).toBe("not_received");
    expect(extractFields("INVOICE WO-3218 from Wing On Meats. Amount due: 600.00. This is a clerical quantity error.").hold).toBe("disputed");
    expect(extractFields("INVOICE WO-1 from Wing On Meats. Amount due: 600.00. Please hold payment until Friday.").hold).toBe("hold_requested");
    // an agreed withheld portion is not a hold on the undisputed amount being asked for
    expect(extractFields("INVOICE WO-2231 from Wing On Meats. 300.00 remains disputed. Amount due: 900.00 for the undisputed goods. Do not settle the withheld portion.").hold).toBeUndefined();
    expect(extractFields("INVOICE LK-0917 from Lee Kee Flour. Delivered 15 Sep 2025. Amount due: 1,250.50.").hold).toBeUndefined();
    expect(extractFields("Reminder: invoice LK-0917 from Lee Kee Flour, amount due 1,250.50. Your payment has not been received.").hold).toBeUndefined();
    expect(extractFields("INVOICE WO-1 from Wing On Meats. Amount due: 600.00. We have not received the goods yet.").hold).toBe("not_received");
  });

  it("the extractor schema rejects an unknown hold value from a model", async () => {
    const odd: ModelProvider = { name: "odd", extract: async () => ({ ...inv({}), hold: "pay_now" }), plan: async () => ({ actions: [] }) };
    expect(await extract(odd, "x", "invoice")).toMatchObject({ ok: false });
  });
});

describe("planner: credit notes, statements and holds", () => {
  it("never pays a credit note or a statement, whatever the provider plans", async () => {
    const eager: ModelProvider = { name: "eager", extract: async () => null, plan: async () => ({ actions: [{ type: "pay", plan: "base", payee: meat, amount: "100.00", ref: "CN-2231" }] }) };
    for (const kind of ["credit_note", "statement"] as const) {
      const r = await plan(eager, input(inv({ kind, amount: "100.00", invoiceId: "CN-2231" })), controls());
      expect(r).toMatchObject({ ok: false });
    }
  });

  it("a hold turns the payment into an owner proposal, with or without the owner's records", async () => {
    for (const hold of ["not_received", "disputed", "hold_requested"] as const) {
      for (const c of [controls(), undefined]) {
        const r = await plan(rules, input(inv({ hold })), c);
        expect(r.ok && r.actions[0]?.type).toBe("propose_to_owner");
      }
    }
  });
});

describe("planner: part payments against a purchase order", () => {
  it("pays a first part below the order, then the balance as part 2 with its own ref", async () => {
    const c = controls();
    const first = await plan(rules, input(inv({ amount: "120.00" })), c);
    expect(first.ok && first.actions[0]).toMatchObject({ type: "pay", amount: "120.00", ref: "WO-9001" });
    expect(first.ok && first.actions[0]!.type === "pay" && first.actions[0].part).toBeUndefined();
    c.paid.push({ supplier: "supplier-meat", invoiceId: "WO-9001", amount: "120.00" });
    const second = await plan(rules, input(inv({ amount: "480.00" })), c);
    expect(second.ok && second.actions[0]).toMatchObject({ type: "pay", amount: "480.00", ref: "WO-9001", part: 2 });
    const [a, b] = [first, second].map((r) => (r.ok && r.actions[0]!.type === "pay" ? refFor(r.actions[0]) : undefined));
    expect(a).not.toBe(b);
    expect(b).toBe(invoiceRef(meat, "WO-9001", 2));
  });

  it("refuses once the order is paid in full, and sends anything above the balance left to the owners", async () => {
    const full = controls({ paid: [{ supplier: "supplier-meat", invoiceId: "WO 9001", amount: "600.00", paidOn: "2025-09-20" }] });
    expect(await plan(rules, input(inv({ amount: "1.00" })), full)).toEqual({ ok: false, reason: "invoice WO 9001 already paid on 2025-09-20" });
    const part = controls({ paid: [{ supplier: "supplier-meat", invoiceId: "WO-9001", amount: "500.00" }] });
    const r = await plan(rules, input(inv({ amount: "200.00" })), part);
    expect(r.ok && r.actions[0]).toMatchObject({ type: "propose_to_owner", reason: expect.stringContaining("100 left on purchase order PO-9001"), action: { part: 2 } });
  });

  it("without a purchase order there is no verified total: a second payment of one invoice is refused", async () => {
    const c = controls({ requiresPO: { "supplier-flour": false }, orders: [], paid: [{ supplier: "supplier-flour", invoiceId: "LK-77", amount: "50.00" }] });
    const r = await plan(rules, input(inv({ payeeName: "Lee Kee Flour", invoiceId: "LK-77", amount: "50.00" })), c);
    expect(r).toEqual({ ok: false, reason: "invoice LK-77 already paid" });
  });

  it("a part is not mistaken for a re-issue of itself, while another number with the same amount still is", async () => {
    const c = controls({
      orders: [{ po: "PO-9001", supplier: "supplier-meat", invoiceId: "WO-9001", amount: "200.00" }],
      paid: [{ supplier: "supplier-meat", invoiceId: "WO-9001", amount: "100.00" }],
    });
    const part2 = await plan(rules, input(inv({ amount: "100.00" })), c);
    expect(part2.ok && part2.actions[0]).toMatchObject({ type: "pay", part: 2 });
    c.orders.push({ po: "PO-9002", supplier: "supplier-meat", invoiceId: "WO-9002", amount: "100.00" });
    const other = await plan(rules, input(inv({ amount: "100.00", invoiceId: "WO-9002" })), c);
    expect(other.ok && other.actions[0]).toMatchObject({ type: "propose_to_owner", reason: expect.stringContaining("re-issue of WO-9001") });
  });

  it("a planner cannot set the part itself (it would dodge the one-use ref)", async () => {
    const sly: ModelProvider = { name: "sly", extract: async () => null, plan: async () => ({ actions: [{ type: "pay", plan: "base", payee: meat, amount: "600.00", ref: "WO-9001", part: 7 }] }) };
    expect(await plan(sly, input(inv({})), controls())).toMatchObject({ ok: false, reason: expect.stringContaining("part number") });
  });

  it("the decision log line names the part", () => {
    expect(describeAction({ type: "pay", plan: "base", payee: flour, amount: "100", ref: "LK-3202", part: 2 })).toContain("(LK-3202, part 2)");
  });
});
