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
