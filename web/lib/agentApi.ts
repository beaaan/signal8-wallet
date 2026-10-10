// Client for the agent HTTP API (agent: npm run serve). Server only; the browser talks to our route handlers.
import { config } from "./config";

export type Stage = "extractor" | "planner" | "localCheck" | "chain" | "owner";
export type Outcome = "executed" | "refused" | "proposed";

/** One line of agent/logs/decisions.jsonl. `input` is untrusted text: render as React text only, never HTML. */
export interface Decision {
  ts: string;
  input: string;
  stage: Stage;
  outcome: Outcome;
  reason?: string;
  tx?: string;
  action?: string;
  summary?: string;
}

export interface ArenaAttempt {
  id: string;
  ts: string;
  preview: string;
  channel?: string;
  outcome: Outcome;
  stage: Stage;
  reason?: string;
  tx?: string;
}

export const ARENA_CHANNELS = ["email", "invoice", "chat", "zalo"] as const;
export type ArenaChannel = (typeof ARENA_CHANNELS)[number];
export const ARENA_MAX_CHARS = 2000;
const ARENA_TIMEOUT_MS = 60_000; // a little above the agent's own limit (50 s), after which it answers 202 { pending }

async function getJson<T>(base: string, pathAndQuery: string): Promise<T> {
  const res = await fetch(`${base}${pathAndQuery}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!res.ok) throw new Error(`agent API ${pathAndQuery}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Newest first. Throws when the agent API is down. */
export async function fetchDecisions(limit = 100): Promise<Decision[]> {
  const body = await getJson<{ decisions?: Decision[] }>(config.agentApiUrl, `/api/decisions?limit=${limit}`);
  return Array.isArray(body.decisions) ? body.decisions : [];
}

/** Newest first, from the arena's agent. Throws when it is down. */
export async function fetchArenaBoard(limit = 50): Promise<ArenaAttempt[]> {
  const body = await getJson<{ attempts?: ArenaAttempt[] }>(config.arenaAgentApiUrl, `/api/arena/board?limit=${limit}`);
  return Array.isArray(body.attempts) ? body.attempts : [];
}

/** Same rule as the agent's isLocalNetwork: the arena only runs against a local anvil chain. */
export const isLocalNetwork = (network: string) => network === "anvil" || network.startsWith("anvil-");

/** The arena agent's GET /api/health; null when it does not answer. */
export async function fetchArenaHealth(): Promise<{ network: string; chainId: number | null } | null> {
  try {
    const b = await getJson<{ ok?: boolean; network?: unknown; chainId?: unknown }>(config.arenaAgentApiUrl, "/api/health");
    return b.ok ? { network: String(b.network ?? ""), chainId: typeof b.chainId === "number" ? b.chainId : null } : null;
  } catch {
    return null;
  }
}

/** Thrown by postArena when the agent took too long to answer; it may still be working on the submission. */
export class ArenaTimeout extends Error {}

/**
 * Forwards one arena submission to the arena's agent. Returns the agent's status and JSON body as-is; the route
 * handler maps status codes to friendly messages. `clientIp` goes in X-Forwarded-For so the agent can rate-limit
 * per person; it is null when the website cannot tell who sent it, and then no header is sent.
 */
export async function postArena(
  text: string,
  channel: ArenaChannel,
  clientIp: string | null,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (clientIp) headers["x-forwarded-for"] = clientIp;
  let res: Response;
  try {
    res = await fetch(`${config.arenaAgentApiUrl}/api/arena`, {
      method: "POST",
      cache: "no-store",
      headers,
      body: JSON.stringify({ text, channel }),
      // The pipeline runs two model calls and maybe a transaction; allow more time than a read.
      signal: AbortSignal.timeout(ARENA_TIMEOUT_MS),
    });
  } catch (e) {
    if ((e as Error)?.name === "TimeoutError") throw new ArenaTimeout("agent did not answer in time");
    throw e;
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch (e) {
    if ((e as Error)?.name === "TimeoutError") throw new ArenaTimeout("agent did not answer in time");
    // non-JSON error page; keep null
  }
  return { status: res.status, body };
}
