import { describe, expect, it } from "vitest";
import { openaiBareClient, runBareCase } from "../src/bare.ts";
import { chatCompletion, chatJson, OpenAICompatProvider, type ChatResponse, type OpenAIOptions } from "../src/llm/openai.ts";
import { OpenAIPlanCompiler } from "../src/llm/planCompiler.ts";

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A fake fetch that records requests and answers from a script (a status, or a Chat Completions body). */
function fakeFetch(script: Array<number | ChatResponse | Error>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const next = script.shift();
    if (next === undefined) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    if (typeof next === "number") return new Response(`{"error":{"message":"status ${next}"}}`, { status: next });
    return new Response(JSON.stringify(next), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const reply = (content: string | null, finish = "stop", extra: Record<string, unknown> = {}): ChatResponse => ({
  choices: [{ finish_reason: finish, message: { role: "assistant", content, ...extra } }],
});

const opts = (f: typeof fetch, extra: Partial<OpenAIOptions> = {}): OpenAIOptions => ({
  baseUrl: "https://api.deepseek.com",
  apiKey: "sk-secret",
  model: "deepseek-flash",
  retryDelayMs: 0,
  fetchImpl: f,
  ...extra,
});

describe("OpenAI-compatible provider", () => {
  it("extract: JSON mode, the schema in the system prompt, the key only in the header", async () => {
    const fields = { kind: "invoice", payeeName: "Lee Kee Flour", payeeAddress: null, amount: "1250.50", currency: "USD", dueDate: null, issueDate: null, invoiceId: "LK-0917" };
    const f = fakeFetch([reply(JSON.stringify(fields))]);
    const p = new OpenAICompatProvider(opts(f.impl, { reasoningEffort: "low" }));
    expect(p.name).toBe("openai:deepseek-flash");
    const out = await p.extract("Invoice LK-0917 ...", "invoice");
    expect(out).toEqual({ kind: "invoice", payeeName: "Lee Kee Flour", amount: "1250.50", currency: "USD", invoiceId: "LK-0917" });
    const [c] = f.calls;
    expect(c!.url).toBe("https://api.deepseek.com/chat/completions");
    expect(c!.headers.authorization).toBe("Bearer sk-secret");
    expect(c!.body).toMatchObject({ model: "deepseek-flash", reasoning_effort: "low", response_format: { type: "json_object" } });
    expect(c!.body.tools).toBeUndefined();
    const [sys, user] = c!.body.messages as Array<{ role: string; content: string }>;
    expect(sys!.content).toContain("JSON Schema");
    expect(sys!.content).toContain('"invoiceId"');
    expect(user!.content).toContain('<document channel="invoice">');
    expect(JSON.stringify(c!.body)).not.toContain("sk-secret");
  });

  it("plan: maps flat rows to actions", async () => {
    const f = fakeFetch([
      reply(JSON.stringify({ actions: [{ type: "propose_to_owner", plan: "base", payee: "0x00000000000000000000000000000000000000b2", amount: "1400.00", ref: "WO-2231", reason: "held in the storm" }] })),
    ]);
    const out = await new OpenAICompatProvider(opts(f.impl)).plan({} as never);
    expect(out).toEqual({
      actions: [{ type: "propose_to_owner", reason: "held in the storm", action: { type: "pay", plan: "base", payee: "0x00000000000000000000000000000000000000b2", amount: "1400.00", ref: "WO-2231" } }],
    });
    expect(f.calls[0]!.body.reasoning_effort).toBeUndefined();
  });

  it("returns null when the model declines, is cut off, or answers empty twice", async () => {
    expect(await chatJson(opts(fakeFetch([reply(null, "content_filter")]).impl), "s", "u", {})).toBeNull();
    expect(await chatJson(opts(fakeFetch([reply('{"a":', "length")]).impl), "s", "u", {})).toBeNull();
    expect(await chatJson(opts(fakeFetch([reply(""), reply("  ")]).impl), "s", "u", {})).toBeNull();
    expect(await chatJson(opts(fakeFetch([reply(""), reply('{"ok":true}')]).impl), "s", "u", {})).toEqual({ ok: true });
  });

  it("retries 429, 5xx and network errors, but not other 4xx; errors never carry the key", async () => {
    const ok = fakeFetch([429, 503, reply("{}")]);
    await chatCompletion(opts(ok.impl), {});
    expect(ok.calls).toHaveLength(3);
    const net = fakeFetch([new Error("socket hang up"), reply("{}")]);
    await chatCompletion(opts(net.impl), {});
    expect(net.calls).toHaveLength(2);
    const bad = fakeFetch([401]);
    const err = await chatCompletion(opts(bad.impl), {}).catch((e: Error) => e);
    expect(bad.calls).toHaveLength(1);
    expect(String(err)).toMatch(/HTTP 401/);
    expect(String(err)).not.toContain("sk-secret");
    const down = fakeFetch([500, 500, 500]);
    await expect(chatCompletion(opts(down.impl), {})).rejects.toThrow(/HTTP 500/);
    expect(down.calls).toHaveLength(3);
  });

  it("plan compiler: same prompt, JSON mode", async () => {
    const f = fakeFetch([reply('{"version":1}')]);
    const c = new OpenAIPlanCompiler(opts(f.impl));
    const out = await c.compile({ documents: [{ name: "policy.txt", text: "1. Pay staff." }], payroll: { business: "x", token: "mUSD", payDay: 1, staff: [] } as never, register: [], region: "HK", token: { symbol: "mUSD", decimals: 6 } });
    expect(out).toEqual({ version: 1 });
    expect(JSON.stringify(f.calls[0]!.body.messages)).toContain("policy.txt");
  });
});

describe("bare baseline on an OpenAI-compatible API", () => {
  it("runs the tool loop: tools as functions, tool results as tool messages, reasoning_content sent back", async () => {
    const b2 = "0x00000000000000000000000000000000000000b2";
    const f = fakeFetch([
      reply(null, "tool_calls", {
        reasoning_content: "registered supplier, under the cap",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "transfer", arguments: JSON.stringify({ to: b2, amount: "1400.00", memo: "WO-2231" }) } }],
      }),
      reply("Paid."),
    ]);
    const r = await runBareCase(openaiBareClient(opts(f.impl)), "SYSTEM", "Invoice WO-2231", "invoice");
    expect(r.transfers).toEqual([{ to: b2, amount: "1400.00", memo: "WO-2231" }]);
    expect(r.turns).toBe(2);
    expect(r.stop).toBe("end_turn");
    expect(r.finalText).toBe("Paid.");
    const first = f.calls[0]!.body;
    expect((first.tools as Array<{ type: string; function: { name: string } }>).map((t) => `${t.type}:${t.function.name}`)).toEqual(["function:transfer", "function:propose_to_owner"]);
    const second = f.calls[1]!.body.messages as Array<Record<string, unknown>>;
    expect(second.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(second[2]).toMatchObject({ reasoning_content: "registered supplier, under the cap", tool_calls: [{ id: "call_1", function: { name: "transfer" } }] });
    expect(second[3]).toMatchObject({ tool_call_id: "call_1" });
    expect(String(second[3]!.content)).toContain("sent 1400.00 mUSD");
  });

  it("counts malformed arguments as invalid calls and never executes them", async () => {
    const f = fakeFetch([
      reply(null, "tool_calls", { tool_calls: [{ id: "c1", type: "function", function: { name: "transfer", arguments: "{not json" } }] }),
      reply("ok"),
    ]);
    const r = await runBareCase(openaiBareClient(opts(f.impl)), "S", "x", "email");
    expect(r.transfers).toEqual([]);
    expect(r.invalidCalls).toBe(1);
  });
});
