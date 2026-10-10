// Model providers for the extractor and the planner. Neither gets tools, keys, or any way to move money:
// each returns JSON that extractor.ts / planner.ts validate with zod before anything else sees it.

import type { Config } from "../config.ts";
import { modelApiKey } from "../config.ts";
import type { ExtractedInvoice, PlanBook } from "../types.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { OpenAICompatProvider, openAIOptions } from "./openai.ts";
import { RulesProvider } from "./rules.ts";

export type Channel = "email" | "invoice" | "chat" | "zalo";

/** A registered payee as the planner sees it. Only registry addresses ever reach the planner. */
export interface RegistryPayee {
  id: string;
  name: string;
  role: "staff" | "supplier" | "other";
  plans: Array<"base" | "storm">;
  address: `0x${string}`;
}

/** Everything the planner sees: validated fields and plan state, never the raw text. */
export interface PlannerInput {
  invoice: ExtractedInvoice;
  activePlan: "base" | "storm";
  /** In a storm, supplier payments wait until it passes (plan book summary). */
  holdSupplierPayments: boolean;
  payees: RegistryPayee[];
  plans: { base: { perTxCap: string; dailyCap: string }; storm: { perTxCap: string; dailyCap: string } };
}

export interface ModelProvider {
  readonly name: string;
  /** Untrusted text in, unvalidated JSON out (null = the model declined). */
  extract(text: string, channel: Channel): Promise<unknown>;
  /** Validated fields in, unvalidated JSON out (expected shape: PlannerOutput). */
  plan(input: PlannerInput): Promise<unknown>;
}

/**
 * The payee registry as the planner sees it. The example plan book labels every name "(fictional)"; DeepSeek read
 * "Lee Kee Flour (fictional)" as a different name from the invoice's "Lee Kee Flour" and planned nothing, so the
 * label stays in the plan book and is dropped here (matchPayee ignores it too).
 */
export function registryFrom(book: PlanBook): RegistryPayee[] {
  return book.payees.map((p) => ({ id: p.id, name: p.name.replace(/\s*\(fictional\)\s*$/i, ""), role: p.role, plans: p.plans, address: p.address }));
}

export function plannerPlans(book: PlanBook): PlannerInput["plans"] {
  const pick = (p: "base" | "storm") => ({ perTxCap: book.plans[p].perTxCap, dailyCap: book.plans[p].dailyCap });
  return { base: pick("base"), storm: pick("storm") };
}

/** The model provider when MODEL_API_KEY is set (MODEL_PROVIDER=anthropic or openai), otherwise the offline rules. */
export function makeProvider(cfg: Config): ModelProvider {
  const apiKey = modelApiKey();
  if (cfg.model.provider === "rules") return new RulesProvider();
  if (!apiKey) throw new Error(`MODEL_PROVIDER=${cfg.model.provider} needs MODEL_API_KEY`);
  if (cfg.model.provider === "openai") return new OpenAICompatProvider(openAIOptions(cfg, apiKey));
  return new AnthropicProvider(apiKey, cfg.model.name);
}
