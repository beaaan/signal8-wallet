// Replay runner: loads a recorded storm timeline and plays it on a compressed clock.
// Spec: docs/specs/agent.md#replay-replayrunnerts
//
// npm run replay -- --event ragasa-2025 --speed 600 [--run-id id] [--rpc url] [--pause-at-steps] [--skip-everyday] [--dry-run] [--yes]
// npm run replay -- --help
//
// --dry-run prints each step on the compressed clock and sends nothing (CI greps "STORM MODE ON").
// Without it, replay/run.ts drives the relayers, the storm loop and the everyday day against the chain.

import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { loadConfig, loadDeployment, PATHS } from "../config.ts";
import { isMain } from "../isMain.ts";
import { buildSteps, loadReplay } from "./timeline.ts";

export { buildSteps, loadReplay, type ReplayFile, type ReplaySignal, type ReplayStep } from "./timeline.ts";

const USAGE = `Usage: npm run replay -- [--event <id>] [--speed <N>] [options]

  --event <id>        replay in data/replays/ (default ragasa-2025)
  --speed <N>         clock compression, a positive number (default 600)
  --run-id <id>       salts refs and the GDACS event id (default: the current time)
  --rpc <url>         chain to use instead of RPC_URL, e.g. an anvil fork
  --pause-at-steps    wait for Enter before each signal
  --skip-everyday     start at the first signal, no ordinary day
  --dry-run           print the timeline on the compressed clock and send nothing
  --yes               do not ask before sending transactions on a public testnet
  --help              this text`;

const FLAGS = new Set(["event", "speed", "run-id", "rpc"]);
const SWITCHES = new Set(["pause-at-steps", "skip-everyday", "dry-run", "yes", "help"]);

/** Parses argv; any unknown or incomplete flag is an error, so a typo never starts a real run. */
export function parseArgs(argv: string[]): { opts: Record<string, string>; switches: Set<string> } {
  const opts: Record<string, string> = {};
  const switches = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i]!.replace(/^--/, "");
    if (!argv[i]!.startsWith("--")) throw new Error(`unexpected argument "${argv[i]}"`);
    if (SWITCHES.has(name)) switches.add(name);
    else if (FLAGS.has(name)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`--${name} needs a value`);
      opts[name] = v;
    } else throw new Error(`unknown option --${name}`);
  }
  if (opts.speed !== undefined && !(Number(opts.speed) > 0)) throw new Error(`--speed must be a positive number, not "${opts.speed}"`);
  return { opts, switches };
}

function replays(): string[] {
  return readdirSync(resolve(PATHS.fixtures, "..", "replays"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5));
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((done) => rl.question(question, done));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

if (isMain(import.meta.url)) {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : err}\n\n${USAGE}`);
    process.exit(2);
  }
  const { opts, switches } = parsed;
  if (switches.has("help")) {
    console.log(USAGE);
    process.exit(0);
  }
  const id = opts.event ?? "ragasa-2025";
  if (!replays().includes(id)) {
    console.error(`no replay "${id}"; available: ${replays().join(", ")}`);
    process.exit(2);
  }
  const speed = Number(opts.speed ?? "600");
  const dryRun = switches.has("dry-run");
  if (!dryRun) {
    const cfg = loadConfig(process.env, { rpcUrl: opts.rpc });
    if (cfg.fisco) {
      // A local FISCO BCOS chain: no prompt (not a public testnet), but check the node matches deployments/<network>.json.
      try {
        const { checkFiscoNode } = await import("../fisco.ts");
        const node = await checkFiscoNode(cfg, loadDeployment(cfg.network));
        console.log(`FISCO BCOS node ${node.client}, chain id ${node.chainId}, block ${node.blockNumber} (local chain, timeUnit 1000)`);
      } catch (err) {
        console.error(`replay failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    } else if (!cfg.local && !switches.has("yes") && !(await confirm(`This sends real transactions on ${cfg.network} and uses up today's caps. Continue? [y/N] `))) {
      console.log("Cancelled.");
      process.exit(1);
    }
    const { runReplay } = await import("./run.ts");
    try {
      process.exitCode = await runReplay({
        event: id,
        speed,
        runId: opts["run-id"],
        rpcUrl: opts.rpc,
        pauseAtSteps: switches.has("pause-at-steps"),
        skipEveryday: switches.has("skip-everyday"),
      });
    } catch (err) {
      // e.g. no deployments/<network>.json, or the chain is not running
      console.error(`replay failed: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
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
