// Extractor: untrusted text → ExtractedInvoice, or a refusal. The only module that sees untrusted text.
// Spec: docs/specs/agent.md#trust-boundaries (1, 2)

import { ExtractedInvoice } from "../types.ts";
import type { Channel, ModelProvider } from "./provider.ts";

export type Extraction = { ok: true; invoice: ExtractedInvoice } | { ok: false; reason: string };

export const MAX_INPUT_CHARS = 2000;

/** Literal 0x addresses in the text; an extracted payeeAddress must be one of them. */
function literalAddresses(text: string): Set<string> {
  return new Set([...text.matchAll(/0x[0-9a-fA-F]{40}/g)].map((m) => m[0].toLowerCase()));
}

export async function extract(provider: ModelProvider, text: string, channel: Channel): Promise<Extraction> {
  if (text.length > MAX_INPUT_CHARS) return { ok: false, reason: `input over ${MAX_INPUT_CHARS} characters` };
  let raw: unknown;
  try {
    raw = await provider.extract(text, channel);
  } catch (err) {
    return { ok: false, reason: `extractor error: ${err instanceof Error ? err.message.slice(0, 120) : "unknown"}` };
  }
  if (raw === null || raw === undefined) return { ok: false, reason: "extractor declined" };
  const parsed = ExtractedInvoice.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: `invalid extractor output: ${issue?.path.join(".") || "root"} ${issue?.message ?? ""}`.trim() };
  }
  // "only if literally present; never inferred"
  const addr = parsed.data.payeeAddress;
  if (addr && !literalAddresses(text).has(addr.toLowerCase())) {
    return { ok: false, reason: "invalid extractor output: payeeAddress not present in the input" };
  }
  return { ok: true, invoice: parsed.data };
}
