// Model-backed provider on any OpenAI-compatible Chat Completions API (MODEL_PROVIDER=openai), e.g. DeepSeek:
//   MODEL_BASE_URL=https://api.deepseek.com  MODEL_NAME=deepseek-flash  MODEL_REASONING_EFFORT=low
// Same prompts and schemas as anthropic.ts (prompts.ts). No tools are passed, ever. JSON mode (`json_object`) only
// guarantees valid JSON, not the schema, so the schema goes into the system prompt and extractor.ts / planner.ts
// validate the result with zod as before. The client holds only MODEL_API_KEY.

import type { Config } from "../config.ts";
import { dropNulls, EXTRACT_SCHEMA, EXTRACT_SYSTEM, PLAN_SCHEMA, PLAN_SYSTEM, toActions } from "./prompts.ts";
import type { Channel, ModelProvider, PlannerInput } from "./provider.ts";

export interface OpenAIOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Sent as reasoning_effort when set (DeepSeek and OpenAI reasoning models take low/high; others may reject it). */
  reasoningEffort?: string;
  timeoutMs?: number;
  /** First retry delay; doubles each retry (tests set 0). */
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

export function openAIOptions(cfg: Config, apiKey: string): OpenAIOptions {
  if (!cfg.model.baseUrl) throw new Error("MODEL_PROVIDER=openai needs MODEL_BASE_URL");
  return { baseUrl: cfg.model.baseUrl, apiKey, model: cfg.model.name, reasoningEffort: cfg.model.reasoningEffort };
}

/** The parts of a Chat Completions response this code reads. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  reasoning_content?: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}
export interface ChatResponse {
  choices: Array<{ finish_reason: string | null; message: ChatMessage }>;
}

const RETRIES = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST {baseUrl}/chat/completions with retries on 429, 5xx and network errors. The key never appears in an error. */
export async function chatCompletion(o: OpenAIOptions, body: Record<string, unknown>): Promise<ChatResponse> {
  const doFetch = o.fetchImpl ?? fetch;
  let last = "";
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep((o.retryDelayMs ?? 1000) * 2 ** (attempt - 1));
    let res: Response;
    try {
      res = await doFetch(`${o.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}` },
        body: JSON.stringify({ model: o.model, ...(o.reasoningEffort ? { reasoning_effort: o.reasoningEffort } : {}), ...body }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 60_000),
      });
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      continue;
    }
    if (res.ok) return (await res.json()) as ChatResponse;
    const text = (await res.text().catch(() => "")).slice(0, 200);
    last = `HTTP ${res.status} ${text}`;
    if (res.status !== 429 && res.status < 500) break;
  }
  throw new Error(`model API (${o.baseUrl}): ${last}`);
}

/**
 * One JSON object from the model, or null when it declined (content filter), was cut off, or returned nothing twice
 * (DeepSeek documents occasional empty content in JSON mode).
 */
export async function chatJson(o: OpenAIOptions, system: string, user: string, schema: Record<string, unknown>, maxTokens = 16000): Promise<unknown> {
  const sys = `${system}\n\nReply with one JSON object only, no prose, matching this JSON Schema:\n${JSON.stringify(schema)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await chatCompletion(o, {
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      max_tokens: maxTokens,
    });
    const choice = res.choices?.[0];
    if (!choice || choice.finish_reason === "content_filter" || choice.finish_reason === "length") return null;
    const text = choice.message?.content?.trim();
    if (text) return JSON.parse(text) as unknown;
  }
  return null;
}

export class OpenAICompatProvider implements ModelProvider {
  readonly name: string;

  constructor(private readonly o: OpenAIOptions) {
    this.name = `openai:${o.model}`;
  }

  async extract(text: string, channel: Channel): Promise<unknown> {
    const out = await chatJson(this.o, EXTRACT_SYSTEM, `<document channel="${channel}">\n${text}\n</document>`, EXTRACT_SCHEMA);
    return out && typeof out === "object" ? dropNulls(out as Record<string, unknown>) : out;
  }

  async plan(input: PlannerInput): Promise<unknown> {
    return toActions(await chatJson(this.o, PLAN_SYSTEM, JSON.stringify(input), PLAN_SCHEMA));
  }
}
