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

async function getJson<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${config.agentApiUrl}${pathAndQuery}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!res.ok) throw new Error(`agent API ${pathAndQuery}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Newest first. Throws when the agent API is down. */
export async function fetchDecisions(limit = 100): Promise<Decision[]> {
  const body = await getJson<{ decisions?: Decision[] }>(`/api/decisions?limit=${limit}`);
  return Array.isArray(body.decisions) ? body.decisions : [];
}

/** Newest first. Throws when the agent API is down. */
export async function fetchArenaBoard(limit = 50): Promise<ArenaAttempt[]> {
  const body = await getJson<{ attempts?: ArenaAttempt[] }>(`/api/arena/board?limit=${limit}`);
  return Array.isArray(body.attempts) ? body.attempts : [];
}

/**
 * Forwards one arena submission. Returns the agent's status and JSON body as-is; the route handler
 * maps status codes to friendly messages. `clientIp` goes in X-Forwarded-For so the agent can rate-limit per person.
 */
export async function postArena(
  text: string,
  channel: ArenaChannel,
  clientIp: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${config.agentApiUrl}/api/arena`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", "x-forwarded-for": clientIp },
    body: JSON.stringify({ text, channel }),
    // The pipeline runs two model calls and maybe a transaction; allow more time than a read.
    signal: AbortSignal.timeout(60_000),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON error page; keep null
  }
  return { status: res.status, body };
}
