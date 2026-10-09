// Agent HTTP API for the dashboard and the arena (node:http, no framework).
//
// npm run serve        (port AGENT_API_PORT, default 8787)
//
// GET  /api/health                 → { ok, network, chainId }
// GET  /api/decisions?limit=100    → { decisions } newest first
// POST /api/arena {text, channel?} → { id, outcome, stage, reason?, tx? }   anvil only; 2,000 chars; 5/min per IP
// GET  /api/arena/board?limit=50   → { attempts } newest first
//
// The arena text is untrusted: it only ever goes to the extractor (pipeline.ts).

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { isLocalNetwork, loadConfig } from "./config.ts";
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

/** Fixed-window-per-key limiter: at most `limit` hits per `windowMs` for each key (IP). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit = 5,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }
}

export interface ApiDeps {
  network: string;
  chainId: number;
  decisions: DecisionLog;
  arena: JsonlFile<ArenaAttempt>;
  limiter: RateLimiter;
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
  if (req.method === "GET" && path === "/api/decisions") return { status: 200, body: { decisions: deps.decisions.readNewest(limitParam(url, 100, 1000)) } };
  if (req.method === "GET" && path === "/api/arena/board") return { status: 200, body: { attempts: deps.arena.readNewest(limitParam(url, 50, 500)) } };

  if (path === "/api/arena") {
    if (req.method !== "POST") return { status: 405, body: { error: "POST only" } };
    if (!isLocalNetwork(deps.network)) return { status: 403, body: { error: "the arena runs only against a local anvil chain" } };
    if (!deps.limiter.allow(req.ip)) return { status: 429, body: { error: "rate limited: 5 attempts per minute" } };
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
    let r: PipelineResult;
    try {
      r = await serial(() => deps.runArena!(text, channel as Channel, `arena:${id}`));
    } catch (err) {
      console.error("arena run failed:", err instanceof Error ? err.message : err);
      return { status: 500, body: { error: "agent error" } };
    }
    const attempt: ArenaAttempt = { id, ts: new Date().toISOString(), preview: text.slice(0, 80), channel: channel as Channel, outcome: r.outcome, stage: r.stage, reason: r.reason, tx: r.tx };
    deps.arena.append(attempt);
    return { status: 200, body: { id, outcome: r.outcome, stage: r.stage, reason: r.reason, tx: r.tx } };
  }
  return { status: 404, body: { error: "not found" } };
}

/** Client IP; X-Forwarded-For is trusted only from loopback (the website's route handler) or with TRUST_PROXY=1. */
export function clientIp(req: Pick<IncomingMessage, "headers" | "socket">, trustProxy = process.env.TRUST_PROXY === "1"): string {
  const remote = req.socket.remoteAddress ?? "unknown";
  const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const xff = req.headers["x-forwarded-for"];
  const forwarded = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  return (trustProxy || loopback) && forwarded ? forwarded : remote;
}

function readBody(req: IncomingMessage): Promise<string | "too-large"> {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        resolveBody("too-large");
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
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
  };
  try {
    const { makeAgent } = await import("./agent.ts");
    const { processUntrusted } = await import("./pipeline.ts");
    const agent = makeAgent();
    deps.chainId = agent.c.dep.chainId;
    if (cfg.local) deps.runArena = (text, channel, input) => processUntrusted(text, channel, input, agent.pipeline);
    console.log(`model provider: ${agent.provider.name}`);
  } catch (err) {
    console.warn(`read-only mode (${err instanceof Error ? err.message : err}): decisions and the board work, the arena does not`);
  }
  startServer(deps, cfg.apiPort);
}
