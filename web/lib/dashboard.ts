// Everything the dashboard shows, in one JSON-safe object. Each source fails on its own. Server only.
import { fetchDecisions, type Decision } from "./agentApi";
import { readFeed, readSnapshot, type ChainSnapshot, type FeedItem } from "./chain";
import { config } from "./config";
import { loadDeployment } from "./deployments";
import { loadPlanBook } from "./plan";

/** A decision as sent to the browser: the untrusted input is cut to its first 80 characters. */
export type DecisionView = Omit<Decision, "input"> & { inputPreview: string };

export interface DashboardData {
  network: string;
  generatedAt: string;
  deployment: { ok: true; file: string; chainId: number; safe: string; region: string } | { ok: false; reason: string };
  chain: { ok: true; snapshot: ChainSnapshot } | { ok: false; reason: string };
  feed: { ok: true; items: FeedItem[] } | { ok: false; reason: string };
  agent: { ok: true; decisions: DecisionView[] } | { ok: false; reason: string };
  planBook: { ok: true; file: string; hash: string; symbol: string } | { ok: false; reason: string };
  /** Safe Wallet queue, only on Base Sepolia (anvil uses a LocalSafe). */
  safeQueueUrl: string | null;
}

const msg = (e: unknown) => ((e as Error)?.message ?? String(e)).split("\n")[0].slice(0, 200);

export async function getDashboardData(): Promise<DashboardData> {
  const [dep, pb, decisions] = await Promise.all([
    loadDeployment(),
    loadPlanBook(),
    fetchDecisions(100).then(
      (ds) => ({ ok: true as const, decisions: ds.map(toView) }),
      (e) => ({ ok: false as const, reason: `Agent API at ${config.agentApiUrl} is not answering (${msg(e)}).` }),
    ),
  ]);

  const base = {
    network: config.network,
    generatedAt: new Date().toISOString(),
    agent: decisions,
    planBook: pb.ok
      ? { ok: true as const, file: pb.file, hash: pb.hash, symbol: pb.book.token.symbol }
      : { ok: false as const, reason: pb.reason },
  };

  if (!dep.ok) {
    const reason = dep.reason;
    return {
      ...base,
      deployment: { ok: false, reason },
      chain: { ok: false, reason: "No deployment to read." },
      feed: { ok: false, reason: "No deployment to read." },
      safeQueueUrl: null,
    };
  }
  const d = dep.deployment;
  const names = new Map<string, string>();
  if (pb.ok) for (const p of pb.book.payees) names.set(p.address.toLowerCase(), p.name);

  const snapshot = await readSnapshot(d).then(
    (s) => ({ ok: true as const, snapshot: s }),
    (e) => ({ ok: false as const, reason: msg(e) }),
  );
  const decimals = snapshot.ok ? snapshot.snapshot.decimals : pb.ok ? pb.book.token.decimals : 6;
  const symbol = pb.ok ? pb.book.token.symbol : "mUSD";
  const feed = snapshot.ok
    ? await readFeed(d, { decimals, symbol, payeeName: (a) => names.get(a.toLowerCase()) ?? null }).then(
        (items) => ({ ok: true as const, items }),
        (e) => ({ ok: false as const, reason: `Could not read events: ${msg(e)}` }),
      )
    : { ok: false as const, reason: snapshot.reason };

  return {
    ...base,
    deployment: { ok: true, file: dep.file, chainId: d.chainId, safe: d.contracts.Safe, region: d.region },
    chain: snapshot,
    feed,
    safeQueueUrl: d.chainId === 84532 ? `https://app.safe.global/transactions/queue?safe=basesep:${d.contracts.Safe}` : null,
  };
}

function toView(d: Decision): DecisionView {
  const { input, ...rest } = d;
  return { ...rest, inputPreview: typeof input === "string" ? Array.from(input).slice(0, 80).join("") : "" };
}
