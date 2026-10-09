import { fetchArenaBoard } from "@/lib/agentApi";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/** The arena board, proxied from the agent. Always 200 so the page can show "not connected" instead of an error. */
export async function GET() {
  try {
    const attempts = (await fetchArenaBoard(50)).map((a) => ({
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
      { ok: false, reason: `Agent API at ${config.agentApiUrl} is not answering.` },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
