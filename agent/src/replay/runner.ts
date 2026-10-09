// Replay runner: loads a recorded storm timeline and plays it on a compressed clock.
// Spec: docs/specs/agent.md#replay-replayrunnerts
//
// npm run replay -- --event ragasa-2025 --speed 600 [--run-id id] [--rpc url] [--pause-at-steps] [--skip-everyday] [--dry-run]
//
// --dry-run prints each step on the compressed clock and sends nothing (CI greps "STORM MODE ON").
// Without it, replay/run.ts drives the relayers, the storm loop and the everyday day against the chain.

import { isMain } from "../isMain.ts";
import { buildSteps, loadReplay } from "./timeline.ts";

export { buildSteps, loadReplay, type ReplayFile, type ReplaySignal, type ReplayStep } from "./timeline.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

if (isMain(import.meta.url)) {
  const id = arg("event", "ragasa-2025")!;
  const speed = Number(arg("speed", "600"));
  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun) {
    const { runReplay } = await import("./run.ts");
    process.exitCode = await runReplay({
      event: id,
      speed,
      runId: arg("run-id"),
      rpcUrl: arg("rpc"),
      pauseAtSteps: process.argv.includes("--pause-at-steps"),
      skipEveryday: process.argv.includes("--skip-everyday"),
    });
    process.exit();
  }
  const file = loadReplay(id);
  const steps = buildSteps(file, speed);
  console.log(`${file.name} (${file.id}), region ${file.region}, GDACS ${file.gdacs.eventId}, speed ${speed}x`);
  let storm = false;
  for (const s of steps) {
    await new Promise((r) => setTimeout(r, Math.min(s.delayMs, 2000))); // capped so a dry run stays short
    if (s.kind === "signal") {
      const nowStorm = (s.level ?? 0) >= 8;
      const change = nowStorm !== storm ? (nowStorm ? "  → STORM MODE ON" : "  → storm mode off") : "";
      storm = nowStorm;
      console.log(`${s.at.toISOString()}  ${s.code.padEnd(12)} level ${String(s.level).padStart(2)}${change}`);
    } else {
      console.log(`${s.at.toISOString()}  ${s.code.padEnd(12)} fake message (should be refused): "${s.detail?.slice(0, 60)}…"`);
    }
  }
}
