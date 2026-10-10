import { fetchArenaBoard } from "@/lib/agentApi";
import { readStart } from "@/lib/chain";
import { config, hostOf } from "@/lib/config";
import { loadDeployment } from "@/lib/deployments";

export const dynamic = "force-dynamic";

/** When this chain run began (ms), if the arena's agent is the dashboard's: older attempts are from an earlier run. */
async function runStart(): Promise<number | null> {
  if (config.arenaAgentApiUrl !== config.agentApiUrl) return null;
  const dep = await loadDeployment();
  if (!dep.ok) return null;
  return readStart(dep.deployment).then(
    (s) => s.time * 1000,
    () => null,
  );
}

/** The arena board, proxied from the agent. Always 200 so the page can show "not connected" instead of an error. */
export async function GET() {
  try {
    const [board, since] = await Promise.all([fetchArenaBoard(50), runStart()]);
    const attempts = board
      .filter((a) => since === null || !(Date.parse(String(a.ts)) < since))
      .map((a) => ({
        id: String(a.id),
        ts: String(a.ts),
        // only ever the first 80 characters on the projected board, even if the agent sent more
        preview: Array.from(String(a.preview ?? "")).slice(0, 80).join(""),
        channel: a.channel ? String(a.channel) : undefined,
        outcome: a.outcome,
        stage: a.stage,
        reason: a.reason ? String(a.reason).slice(0, 200) : undefined,
        tx: a.tx,
      }));
    return Response.json({ ok: true, attempts }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json(
      { ok: false, reason: `Agent at ${hostOf(config.arenaAgentApiUrl)} is not answering.` },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
