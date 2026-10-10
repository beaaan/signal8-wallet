// Model-backed provider on the Anthropic Messages API (MODEL_PROVIDER=anthropic).
// No tools are passed, ever: each call returns one JSON object constrained by output_config.format,
// which extractor.ts / planner.ts then validate with zod. The client holds only MODEL_API_KEY.

import Anthropic from "@anthropic-ai/sdk";
import { dropNulls, EXTRACT_SCHEMA, EXTRACT_SYSTEM, PLAN_SCHEMA, PLAN_SYSTEM, toActions } from "./prompts.ts";
import type { Channel, ModelProvider, PlannerInput } from "./provider.ts";

/** Models that take server-side refusal fallbacks (claude-api skill: opt in by default on these). */
const FALLBACK_MODELS = /^claude-(opus-5|fable-5|sonnet-5-5)/;
/** Models without the effort parameter. */
const NO_EFFORT = /^claude-(haiku-4|sonnet-4-5|3)/;

export class AnthropicProvider implements ModelProvider {
  readonly name: string;
  private readonly client: Anthropic;

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 45_000 });
    this.name = `anthropic:${model}`;
  }

  private async json(system: string, user: string, schema: Record<string, unknown>): Promise<unknown> {
    const fallback = FALLBACK_MODELS.test(this.model);
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { ...(NO_EFFORT.test(this.model) ? {} : { effort: "low" as const }), format: { type: "json_schema", schema } },
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return null;
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return JSON.parse(text) as unknown;
  }

  async extract(text: string, channel: Channel): Promise<unknown> {
    const out = await this.json(EXTRACT_SYSTEM, `<document channel="${channel}">\n${text}\n</document>`, EXTRACT_SCHEMA);
    return out && typeof out === "object" ? dropNulls(out as Record<string, unknown>) : out;
  }

  async plan(input: PlannerInput): Promise<unknown> {
    return toActions(await this.json(PLAN_SYSTEM, JSON.stringify(input), PLAN_SCHEMA));
  }
}
