// Agent HTTP API for the dashboard and the arena (node:http, no framework).
//
// npm run serve        (port AGENT_API_PORT, default 8787)
//
// GET  /api/health                 → { ok, network, chainId }
// GET  /api/decisions?limit=100    → { decisions } newest first; &lang=vi (en, zh-Hant, zh-Hans) adds an explanation
// POST /api/arena {text, channel?} → { id, outcome, stage, reason?, tx? }   anvil only; 2,000 chars; 5/min per IP,
//                                    20/min overall; 202 { id, pending } if the run takes over ARENA_TIMEOUT_MS
// GET  /api/arena/board?limit=50   → { attempts } newest first
//
// The arena text is untrusted: it only ever goes to the extractor (pipeline.ts).

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { isLocalNetwork, loadConfig } from "./config.ts";
import { explain, LANGS, type Lang } from "./explain.ts";
import { isMain } from "./isMain.ts";
import { MAX_INPUT_CHARS } from "./llm/extractor.ts";
import type { Channel } from "./llm/provider.ts";
import { DecisionLog, JsonlFile } from "./log.ts";
import type { PipelineResult } from "./pipeline.ts";
import type { Decision } from "./types.ts";

export const MAX_BODY_BYTES = 16 * 1024;
const CHANNELS: Channel[] = ["email", "invoice", "chat", "zalo"];

export interface ArenaAttempt {
  id: string;
  ts: string;
  preview: string;
  channel: Channel;
  outcome: Decision["outcome"];
  stage: Decision["stage"];
  reason?: string;
  tx?: string;
}

/** Sliding-window-per-key limiter: at most `limit` hits per `windowMs` for each key (IP). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastPrune = 0;

  constructor(
    private readonly limit = 5,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const t = this.now();
    this.prune(t);
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }

  get size(): number {
    return this.hits.size;
  }

  /** Drops keys with no hit inside the window, at most once per window, so the map stays small. */
  private prune(t: number): void {
    if (t - this.lastPrune < this.windowMs) return;
    this.lastPrune = t;
    for (const [k, v] of this.hits) if (v.every((x) => t - x >= this.windowMs)) this.hits.delete(k);
  }
}

export const ARENA_TIMEOUT_MS = Number(process.env.ARENA_TIMEOUT_MS ?? 50_000);

export interface ApiDeps {
  network: string;
  chainId: number;
  decisions: DecisionLog;
  arena: JsonlFile<ArenaAttempt>;
  limiter: RateLimiter;
  /** Across all IPs: one judge with many addresses cannot flood the board or the model. */
  globalLimiter?: RateLimiter;
  timeoutMs?: number;
  /** Runs the text through extractor → planner → localCheck → executor; undefined when the chain is unavailable. */
  runArena?: (text: string, channel: Channel, input: string) => Promise<PipelineResult>;
}

export interface ApiRequest {
  method: string;
  url: string;
  ip: string;
  body?: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

function limitParam(url: URL, fallback: number, max: number): number {
  const n = Number(url.searchParams.get("limit") ?? fallback);
  return Number.isFinite(n) ? Math.min(Math.max(1, Math.floor(n)), max) : fallback;
}

let queue: Promise<unknown> = Promise.resolve();
/** One arena run at a time: the agent key sends transactions in sequence. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

export async function handle(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname.replace(/\/+$/, "");

  if (req.method === "GET" && path === "/api/health") return { status: 200, body: { ok: true, network: deps.network, chainId: deps.chainId } };
  if (req.method === "GET" && path === "/api/decisions") {
    const decisions = deps.decisions.readNewest(limitParam(url, 100, 1000));
    // ?lang=en|zh-Hant|zh-Hans|vi adds the two-line owner explanation to each line (explain.ts, no model)
    const lang = url.searchParams.get("lang");
    if (!lang || !(LANGS as readonly string[]).includes(lang)) return { status: 200, body: { decisions } };
    return { status: 200, body: { decisions: decisions.map((d) => ({ ...d, explanation: explain(d, lang as Lang, { chainId: deps.chainId }) })) } };
  }
  if (req.method === "GET" && path === "/api/arena/board") return { status: 200, body: { attempts: deps.arena.readNewest(limitParam(url, 50, 500)) } };

  if (path === "/api/arena") {
    if (req.method !== "POST") return { status: 405, body: { error: "POST only" } };
    if (!isLocalNetwork(deps.network)) return { status: 403, body: { error: "the arena runs only against a local anvil chain" } };
    if (!deps.limiter.allow(req.ip)) return { status: 429, body: { error: "rate limited: 5 attempts per minute" } };
    if (deps.globalLimiter && !deps.globalLimiter.allow("*")) return { status: 429, body: { error: "the arena is busy, try again in a minute" } };
    let parsed: unknown;
    try {
      parsed = JSON.parse(req.body ?? "");
    } catch {
      return { status: 400, body: { error: "body must be JSON" } };
    }
    const { text, channel = "email" } = (parsed ?? {}) as { text?: unknown; channel?: unknown };
    if (typeof text !== "string" || text.trim() === "") return { status: 400, body: { error: "text must be a non-empty string" } };
    if (text.length > MAX_INPUT_CHARS) return { status: 413, body: { error: `text is over ${MAX_INPUT_CHARS} characters` } };
    if (typeof channel !== "string" || !(CHANNELS as string[]).includes(channel)) return { status: 400, body: { error: `channel must be one of ${CHANNELS.join(", ")}` } };
    if (!deps.runArena) return { status: 503, body: { error: "agent is not connected to a chain" } };

    const id = randomUUID();
    // The board gets the attempt when the run finishes, even if this request has stopped waiting for it.
    const run = serial(() => deps.runArena!(text, channel as Channel, `arena:${id}`)).then((r) => {
      const attempt: ArenaAttempt = { id, ts: new Date().toISOString(), preview: text.slice(0, 80), channel: channel as Channel, outcome: r.outcome, stage: r.stage, reason: r.reason, tx: r.tx };
      deps.arena.append(attempt);
      return r;
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timeout">((done) => {
      timer = setTimeout(() => done("timeout"), deps.timeoutMs ?? ARENA_TIMEOUT_MS);
    });
    try {
      const r = await Promise.race([run, timeout]);
      if (r === "timeout") {
        run.catch((err) => console.error("arena run failed:", err instanceof Error ? err.message : err));
        return { status: 202, body: { id, pending: true, error: "still deciding, watch the board" } };
      }
      return { status: 200, body: { id, outcome: r.outcome, stage: r.stage, reason: r.reason, tx: r.tx } };
    } catch (err) {
      console.error("arena run failed:", err instanceof Error ? err.message : err);
      deps.decisions.write({ input: `arena:${id}`, stage: "extractor", outcome: "refused", reason: "agent error", summary: "Arena attempt failed inside the agent" }, { quiet: true });
      return { status: 500, body: { error: "agent error" } };
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: 404, body: { error: "not found" } };
}

/**
 * Client IP; X-Forwarded-For is trusted only from loopback (the website's route handler) or with TRUST_PROXY=1, and
 * then only its last entry, the one the trusted hop appended (a client can write anything in the earlier ones).
 */
export function clientIp(req: Pick<IncomingMessage, "headers" | "socket">, trustProxy = process.env.TRUST_PROXY === "1"): string {
  const remote = req.socket.remoteAddress ?? "unknown";
  const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const xff = req.headers["x-forwarded-for"];
  const forwarded = (Array.isArray(xff) ? xff.join(",") : xff)?.split(",").pop()?.trim();
  return (trustProxy || loopback) && forwarded ? forwarded : remote;
}

function readBody(req: IncomingMessage): Promise<string | "too-large"> {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= MAX_BODY_BYTES) chunks.push(c);
      else if (size > 64 * MAX_BODY_BYTES) req.destroy(); // keep reading a little so the client gets its 413
    });
    req.on("end", () => resolveBody(size > MAX_BODY_BYTES ? "too-large" : Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown, cors: boolean): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...(cors ? { "access-control-allow-origin": "*" } : {}) });
  res.end(JSON.stringify(body));
}

export function startServer(deps: ApiDeps, port: number) {
  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    if (method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET", "access-control-max-age": "600" });
      res.end();
      return;
    }
    try {
      let body: string | undefined;
      if (method === "POST") {
        const raw = await readBody(req);
        if (raw === "too-large") return send(res, 413, { error: "body too large" }, false);
        body = raw;
      }
      const r = await handle({ method, url: req.url ?? "/", ip: clientIp(req), body }, deps);
      send(res, r.status, r.body, method === "GET");
    } catch (err) {
      console.error(err);
      send(res, 500, { error: "internal error" }, false);
    }
  });
  server.listen(port, () => console.log(`agent API on http://127.0.0.1:${port} (${deps.network})`));
  return server;
}

if (isMain(import.meta.url)) {
  const cfg = loadConfig();
  const decisions = new DecisionLog(cfg.logDir);
  const deps: ApiDeps = {
    network: cfg.network,
    chainId: cfg.chainId,
    decisions,
    arena: new JsonlFile<ArenaAttempt>(resolve(cfg.logDir, "arena.jsonl")),
    limiter: new RateLimiter(5, 60_000),
    globalLimiter: new RateLimiter(20, 60_000),
  };
  try {
    const { makeAgent } = await import("./agent.ts");
    const { processUntrusted } = await import("./pipeline.ts");
    const agent = makeAgent();
    deps.chainId = agent.c.dep.chainId;
    const onchain = await agent.stormChain.planHashes();
    if (!onchain.every((h) => h.toLowerCase() === agent.localPlanHash.toLowerCase())) throw new Error("the plan book does not match the signed on-chain plan");
    if (cfg.local) {
      deps.runArena = (text, channel, input) => processUntrusted(text, channel, input, agent.pipeline);
      // Arena payments use this chain's caps and refs: on demo day run the arena's agent on its own anvil.
      if (cfg.network === "anvil") console.warn("arena is on the default anvil chain; for the demo, serve it from a separate chain (NETWORK=anvil-arena, see docs/DEMO.md)");
    }
    console.log(`model provider: ${agent.provider.name}`);
  } catch (err) {
    console.warn(`read-only mode (${err instanceof Error ? err.message : err}): decisions and the board work, the arena does not`);
  }
  startServer(deps, cfg.apiPort);
}
