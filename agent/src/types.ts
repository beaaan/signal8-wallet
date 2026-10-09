// Schemas for every value that crosses a trust boundary. Spec: docs/specs/agent.md#schemas-typests
import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "not an address") as unknown as z.ZodType<`0x${string}`>;
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "not bytes32") as unknown as z.ZodType<`0x${string}`>;
const amount = z.string().regex(/^\d+(\.\d+)?$/, "amount must be a decimal string");

/** Output of the extractor (model call with no tools) for one email, invoice or chat message. */
export const ExtractedInvoice = z
  .object({
    kind: z.enum(["invoice", "payroll", "bank_detail_change", "other"]),
    payeeName: z.string().max(120),
    payeeAddress: address.optional(), // only if literally present in the input; never inferred
    amount,
    currency: z.enum(["USD", "HKD", "VND"]),
    dueDate: z.string().date().optional(),
    invoiceId: z.string().max(64).optional(),
  })
  .strict();
export type ExtractedInvoice = z.infer<typeof ExtractedInvoice>;

const ref = z.string().min(1).max(64);

const BaseAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pay"), plan: z.enum(["base", "storm"]), payee: address, amount, ref }).strict(),
  z.object({ type: z.literal("vault_deposit"), plan: z.literal("base"), amount, ref }).strict(),
  z.object({ type: z.literal("vault_withdraw"), plan: z.enum(["base", "storm"]), amount, ref }).strict(),
  z.object({ type: z.literal("credit_draw"), plan: z.literal("storm"), amount, ref }).strict(),
  z.object({ type: z.literal("cover_claim"), plan: z.literal("storm"), ref }).strict(),
  z
    .object({
      type: z.literal("anchor"),
      kind: z.enum(["PRE_STORM", "DAILY_REPORT", "ATTACK_LOG"]),
      hash: bytes32,
    })
    .strict(),
]);

/** Output of the planner (model call with no tools). Anything that fails this schema is dropped and logged. */
export const Action = z.union([
  BaseAction,
  z.object({ type: z.literal("propose_to_owner"), reason: z.string().max(280), action: BaseAction }).strict(),
]);
export type Action = z.infer<typeof Action>;

export const PlannerOutput = z.object({ actions: z.array(Action).max(50) }).strict();
export type PlannerOutput = z.infer<typeof PlannerOutput>;

/** One line in agent/logs/decisions.jsonl, read by the dashboard and the arena. */
export const Decision = z.object({
  ts: z.string(),
  input: z.string(),
  stage: z.enum(["extractor", "planner", "localCheck", "chain", "owner"]),
  outcome: z.enum(["executed", "refused", "proposed"]),
  reason: z.string().optional(),
  tx: bytes32.optional(),
});
export type Decision = z.infer<typeof Decision>;

/**
 * The plan book: the human-readable document the owner signs. Both on-chain plans carry its hash.
 * Spec: docs/specs/plans.md. Drafted by the plan compiler or by hand; nothing changes on-chain until the Safe owners sign.
 */
const PlanName = z.enum(["base", "storm"]);
const PlanAction = z.enum(["pay", "vault_deposit", "vault_withdraw", "credit_draw", "cover_claim"]);

const PlanRules = z
  .object({
    perTxCap: amount,
    dailyCap: amount,
    creditCapPerEvent: amount,
    actions: z.array(PlanAction).min(1),
  })
  .strict();

export const PlanBook = z
  .object({
    version: z.literal(1),
    business: z.string().max(120),
    region: z.enum(["HK", "VN-QN-HP"]),
    token: z.object({ symbol: z.string().max(12), decimals: z.number().int().min(0).max(18) }).strict(),
    dailyCeiling: amount,
    payees: z
      .array(
        z
          .object({
            id: z.string().max(40),
            name: z.string().max(120),
            address,
            role: z.enum(["staff", "supplier", "other"]),
            plans: z.array(PlanName).min(1),
          })
          .strict(),
      )
      .max(100),
    plans: z.object({ base: PlanRules, storm: PlanRules }).strict(),
    summary: z.record(z.string().max(12), z.string().max(2000)), // language tag → plain-language summary
    citations: z
      .array(
        z
          .object({
            rule: z.string().max(80), // e.g. "plans.storm.creditCapPerEvent"
            doc: z.string().max(80), // e.g. "loan.txt"
            clause: z.string().max(40),
            quote: z.string().max(280),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .superRefine((book, ctx) => {
    for (const a of ["credit_draw", "cover_claim"] as const) {
      if (book.plans.base.actions.includes(a)) {
        ctx.addIssue({ code: "custom", path: ["plans", "base", "actions"], message: `${a} is storm-plan only` });
      }
    }
    for (const p of ["base", "storm"] as const) {
      const rules = book.plans[p];
      const hasCredit = rules.actions.includes("credit_draw");
      if (hasCredit !== (Number(rules.creditCapPerEvent) > 0)) {
        ctx.addIssue({
          code: "custom",
          path: ["plans", p, "creditCapPerEvent"],
          message: "credit_draw needs creditCapPerEvent > 0, and a cap needs credit_draw",
        });
      }
    }
    const seen = new Set<string>();
    for (const [i, payee] of book.payees.entries()) {
      const key = payee.address.toLowerCase();
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["payees", i, "address"], message: "duplicate payee address" });
      seen.add(key);
    }
  });
export type PlanBook = z.infer<typeof PlanBook>;
