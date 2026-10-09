// Server-side settings, read from the environment. The website holds no keys.
import path from "node:path";

const network = (process.env.NETWORK || "anvil").trim();

function rpcUrl(): string {
  if (network === "base-sepolia") {
    return process.env.BASE_SEPOLIA_RPC || process.env.RPC_URL || "https://sepolia.base.org";
  }
  return process.env.RPC_URL || "http://127.0.0.1:8545";
}

// `npm run dev|build|start` runs with web/ as the working directory; the repo root is one level up.
// REPO_ROOT overrides it (e.g. when the site is started from elsewhere). path.resolve keeps this Windows-safe.
const repoRoot = path.resolve(process.env.REPO_ROOT || path.join(process.cwd(), ".."));

const agentApiUrl = (process.env.AGENT_API_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");

/** Only the host of a URL, for messages that reach the page: a full RPC URL can carry an API key. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || "?";
  } catch {
    return "?";
  }
}

export const config = {
  network,
  rpcUrl: rpcUrl(),
  agentApiUrl,
  /** The arena can talk to its own agent (e.g. one on an anvil fork) so arena traffic stays off the dashboard's agent. */
  arenaAgentApiUrl: (process.env.ARENA_AGENT_API_URL || agentApiUrl).replace(/\/+$/, ""),
  /** Set to 1 only behind a reverse proxy that appends the client address to X-Forwarded-For. */
  trustProxy: process.env.TRUST_PROXY === "1",
  publicArenaUrl: process.env.PUBLIC_ARENA_URL || null,
  repoRoot,
  deploymentsFile: path.join(repoRoot, "contracts", "deployments", `${network}.json`),
  planBookFiles: [
    path.join(repoRoot, "data", "fixtures", "plans", "plan-book.json"),
    path.join(repoRoot, "data", "fixtures", "plans", "plan-book.example.json"),
  ],
  /** Timeout for each RPC and agent API call, so a dead backend never hangs a page. */
  timeoutMs: 4000,
} as const;
