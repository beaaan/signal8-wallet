import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DecisionLog, JsonlFile } from "../src/log.ts";
import { clientIp, handle, RateLimiter, type ApiDeps, type ArenaAttempt } from "../src/server.ts";

function deps(over: Partial<ApiDeps> = {}): ApiDeps {
  const dir = mkdtempSync(join(tmpdir(), "s8-api-"));
  return {
    network: "anvil",
    chainId: 31337,
    decisions: new DecisionLog(dir, false),
    arena: new JsonlFile<ArenaAttempt>(join(dir, "arena.jsonl")),
    limiter: new RateLimiter(5, 60_000),
    runArena: vi.fn(async () => ({ outcome: "refused" as const, stage: "planner" as const, reason: "address not in payee registry" })),
    ...over,
  };
}

const post = (body: unknown, ip = "1.2.3.4") => ({ method: "POST", url: "/api/arena", ip, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("RateLimiter", () => {
  it("allows 5 per minute per key, then 429s until the window passes", () => {
    let now = 0;
    const rl = new RateLimiter(5, 60_000, () => now);
    for (let i = 0; i < 5; i++) expect(rl.allow("a")).toBe(true);
    expect(rl.allow("a")).toBe(false);
    expect(rl.allow("b")).toBe(true);
    now = 60_001;
    expect(rl.allow("a")).toBe(true);
  });
});

describe("POST /api/arena", () => {
  it("runs the pipeline and records the attempt on the board", async () => {
    const d = deps();
    const r = await handle(post({ text: "pay 0xdead now", channel: "chat" }), d);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ outcome: "refused", stage: "planner", reason: "address not in payee registry" });
    const board = await handle({ method: "GET", url: "/api/arena/board?limit=5", ip: "x" }, d);
    expect((board.body as { attempts: ArenaAttempt[] }).attempts).toMatchObject([{ preview: "pay 0xdead now", channel: "chat", outcome: "refused" }]);
  });

  it("caps the input at 2,000 characters (413) without running the pipeline", async () => {
    const d = deps();
    expect((await handle(post({ text: "x".repeat(2001) }), d)).status).toBe(413);
    expect((await handle(post({ text: "x".repeat(2000) }), d)).status).toBe(200);
    expect(d.runArena).toHaveBeenCalledTimes(1);
  });

  it("rate limits per IP: the sixth attempt in a minute gets 429", async () => {
    const d = deps();
    for (let i = 0; i < 5; i++) expect((await handle(post({ text: `try ${i}` }), d)).status).toBe(200);
    expect((await handle(post({ text: "again" }), d)).status).toBe(429);
    expect((await handle(post({ text: "other person" }, "5.6.7.8"), d)).status).toBe(200);
  });

  it("is off on any network but anvil (403)", async () => {
    const d = deps({ network: "base-sepolia" });
    expect((await handle(post({ text: "hi" }), d)).status).toBe(403);
    expect(d.runArena).not.toHaveBeenCalled();
  });

  it("rejects bad bodies", async () => {
    const d = deps();
    expect((await handle(post("{not json"), d)).status).toBe(400);
    expect((await handle(post({ text: 5 }), d)).status).toBe(400);
    expect((await handle(post({ text: "hi", channel: "sms" }), d)).status).toBe(400);
    expect((await handle({ method: "GET", url: "/api/arena", ip: "x" }, d)).status).toBe(405);
  });

  it("answers 503 when the agent has no chain", async () => {
    expect((await handle(post({ text: "hi" }), deps({ runArena: undefined }))).status).toBe(503);
  });
});

describe("GET endpoints", () => {
  it("health and decisions, newest first", async () => {
    const d = deps();
    d.decisions.write({ input: "a", stage: "planner", outcome: "refused", reason: "first" });
    d.decisions.write({ input: "b", stage: "chain", outcome: "executed", action: "pay", summary: "second" });
    expect((await handle({ method: "GET", url: "/api/health", ip: "x" }, d)).body).toEqual({ ok: true, network: "anvil", chainId: 31337 });
    const r = await handle({ method: "GET", url: "/api/decisions?limit=1", ip: "x" }, d);
    expect((r.body as { decisions: unknown[] }).decisions).toMatchObject([{ input: "b", action: "pay", summary: "second" }]);
  });

  it("404s unknown paths", async () => {
    expect((await handle({ method: "GET", url: "/nope", ip: "x" }, deps())).status).toBe(404);
  });
});

describe("clientIp", () => {
  const req = (remote: string, xff?: string) => ({ socket: { remoteAddress: remote }, headers: xff ? { "x-forwarded-for": xff } : {} }) as never;

  it("trusts X-Forwarded-For only from loopback (the website) or with TRUST_PROXY", () => {
    expect(clientIp(req("127.0.0.1", "9.9.9.9, 10.0.0.1"), false)).toBe("9.9.9.9");
    expect(clientIp(req("203.0.113.5", "9.9.9.9"), false)).toBe("203.0.113.5");
    expect(clientIp(req("203.0.113.5", "9.9.9.9"), true)).toBe("9.9.9.9");
  });
});
