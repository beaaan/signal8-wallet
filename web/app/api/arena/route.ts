import { ARENA_CHANNELS, ARENA_MAX_CHARS, ArenaTimeout, postArena, type ArenaChannel } from "@/lib/agentApi";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

// The website does not decide anything: it checks the size, rate-limits, and forwards the text to the agent.
const MAX_BODY_BYTES = 64 * 1024;
const WINDOW_MS = 60_000;
const MAX_PER_KEY = 5; // same as the agent's per-IP limit
const MAX_GLOBAL = 20; // across everyone: the agent runs one submission at a time anyway
const hits = new Map<string, number[]>();
let all: number[] = [];

/** "key" or "global" when over a limit; records the hit otherwise. Expired keys are evicted on every call. */
function rateLimited(key: string): "key" | "global" | null {
  const now = Date.now();
  const fresh = (ts: number[]) => ts.filter((t) => now - t < WINDOW_MS);
  for (const [k, ts] of hits) {
    const f = fresh(ts);
    if (f.length) hits.set(k, f);
    else hits.delete(k);
  }
  all = fresh(all);
  const mine = hits.get(key) ?? [];
  if (all.length >= MAX_GLOBAL) return "global";
  if (mine.length >= MAX_PER_KEY) return "key";
  mine.push(now);
  hits.set(key, mine);
  all.push(now);
  return null;
}

/**
 * Who is submitting. A route handler cannot see the socket address, and X-Forwarded-For is whatever the client
 * sent unless a proxy we trust appended to it. So: with TRUST_PROXY=1 the last hop (the one our proxy added);
 * otherwise everyone shares one key and `ip` is null (nothing is forwarded to the agent).
 */
function client(req: Request): { key: string; ip: string | null } {
  if (config.trustProxy) {
    const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return { key: `ip:${last}`, ip: last };
  }
  return { key: "shared", ip: null };
}

/** The body as text, or null when it is over `max` bytes (counted while reading, not trusted from a header). */
async function readBody(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

const FRIENDLY: Record<number, string> = {
  400: "The agent could not read that submission.",
  403: "The arena is closed: the agent only accepts arena input when it runs on the local test chain.",
  413: `Too long: ${ARENA_MAX_CHARS.toLocaleString("en-US")} characters at most.`,
  429: "Too many tries. Wait a minute and try again.",
};

const BUSY = "The arena is busy. Wait a minute and try again.";

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const raw = await readBody(req, MAX_BODY_BYTES).catch(() => "");
  if (raw === null) return fail(413, FRIENDLY[413]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail(400, "Send JSON: { text, channel }.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail(400, "Send JSON: { text, channel }.");
  const body = parsed as { text?: unknown; channel?: unknown };
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) return fail(400, "Paste some text first.");
  if (text.length > ARENA_MAX_CHARS) return fail(413, FRIENDLY[413]);
  const channel = (body.channel ?? "email") as ArenaChannel;
  if (!ARENA_CHANNELS.includes(channel)) return fail(400, "Unknown channel.");

  const who = client(req);
  const limited = rateLimited(who.key);
  if (limited === "global") return fail(429, BUSY);
  if (limited) return fail(429, FRIENDLY[429]);

  let res: { status: number; body: unknown };
  try {
    res = await postArena(text, channel, who.ip);
  } catch (e) {
    // The agent is still working on it and will put the outcome on the board.
    if (e instanceof ArenaTimeout) return Response.json({ pending: true }, { status: 202 });
    return fail(503, "The agent is not connected. Try again in a moment.");
  }
  const b = (res.body && typeof res.body === "object" ? res.body : {}) as Record<string, unknown>;
  // The agent answers 202 { pending } when its own time limit passes; the outcome still lands on the board.
  if (res.status === 202 || b.pending === true) return Response.json({ pending: true }, { status: 202 });
  if (res.status === 429 && /busy/i.test(String(b.error ?? ""))) return fail(429, BUSY);
  if (res.status >= 200 && res.status < 300 && res.body && typeof res.body === "object") {
    return Response.json({ id: b.id, outcome: b.outcome, stage: b.stage, reason: b.reason, tx: b.tx });
  }
  if (FRIENDLY[res.status]) return fail(res.status, FRIENDLY[res.status]);
  return fail(502, `The agent could not process this (HTTP ${res.status}).`);
}
