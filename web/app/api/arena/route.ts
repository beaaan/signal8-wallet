import { ARENA_CHANNELS, ARENA_MAX_CHARS, postArena, type ArenaChannel } from "@/lib/agentApi";

export const dynamic = "force-dynamic";

// The website does not decide anything: it checks the size, rate-limits, and forwards the text to the agent.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5; // same as the agent's per-IP limit
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.clear(); // crude bound on memory
  return false;
}

const FRIENDLY: Record<number, string> = {
  400: "The agent could not read that submission.",
  403: "The arena is closed: the agent only accepts arena input when it runs on the local test chain.",
  413: `Too long: ${ARENA_MAX_CHARS.toLocaleString("en-US")} characters at most.`,
  429: "Too many tries from your connection. Wait a minute and try again.",
};

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > 64 * 1024) return fail(413, FRIENDLY[413]);
  let body: { text?: unknown; channel?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Send JSON: { text, channel }.");
  }
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) return fail(400, "Paste some text first.");
  if (text.length > ARENA_MAX_CHARS) return fail(413, FRIENDLY[413]);
  const channel = (body.channel ?? "email") as ArenaChannel;
  if (!ARENA_CHANNELS.includes(channel)) return fail(400, "Unknown channel.");

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  if (rateLimited(ip)) return fail(429, FRIENDLY[429]);

  let res: { status: number; body: unknown };
  try {
    res = await postArena(text, channel, ip);
  } catch {
    return fail(503, "The agent is not connected. Try again in a moment.");
  }
  if (res.status >= 200 && res.status < 300 && res.body && typeof res.body === "object") {
    const b = res.body as Record<string, unknown>;
    return Response.json({ id: b.id, outcome: b.outcome, stage: b.stage, reason: b.reason, tx: b.tx });
  }
  if (FRIENDLY[res.status]) return fail(res.status, FRIENDLY[res.status]);
  return fail(502, `The agent could not process this (HTTP ${res.status}).`);
}
