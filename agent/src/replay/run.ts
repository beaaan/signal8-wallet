// Real replay mode: everyday day (optional), GDACS attestation, each HKO signal change, the storm loop,
// the scenario's fake messages through the full pipeline, and payday. Every tx is printed at the end and
// written to agent/logs/run-<runId>.json (npm run evidence turns it into EVIDENCE.md rows).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { makeAgent, type Agent } from "../agent.ts";
import { isStorm, readSnapshot } from "../chain.ts";
import { fmt, units } from "../exec/executor.ts";
import { extractFields } from "../llm/rules.ts";
import type { Channel } from "../llm/provider.ts";
import { clientPays, listInvoices, runEveryday } from "../loops/everyday.ts";
import { loadPayroll, payrollTotal, StormLoop } from "../loops/storm.ts";
import { processUntrusted } from "../pipeline.ts";
import { buildGdacsAttestation, eventFromReplay, gdacsEventId } from "../relayers/gdacs.ts";
import { buildHkoAttestation } from "../relayers/hko.ts";
import { SOURCE, type Hex } from "../relayers/sign.ts";
import { attest } from "../relayers/submit.ts";
import { buildSteps, loadReplay, type ReplayFile, type ReplayStep } from "./timeline.ts";

export interface RunOptions {
  event: string;
  speed: number;
  runId?: string;
  rpcUrl?: string;
  pauseAtSteps?: boolean;
  skipEveryday?: boolean;
}

export interface RunTx {
  n: number;
  phase: "everyday" | "replay";
  signal?: string; // HKO code in force when the tx was sent
  replayTime?: string; // recorded official time of the step (ISO)
  label: string;
  tx: Hex;
}

export interface RunFile {
  runId: string;
  event: string;
  name: string;
  network: string;
  chainId: number;
  startedAt: string;
  finishedAt?: string;
  gdacs: { eventId: string; alertLevel: string; saltedEventId: Hex };
  txs: RunTx[];
  fakeMessages: Array<{ replayTime: string; channel: string; outcome: string; stage: string; reason?: string }>;
  ok: boolean;
  error?: string;
}

const CHANNELS: Channel[] = ["email", "invoice", "chat", "zalo"];

type RunStep = ReplayStep | (Omit<ReplayStep, "kind"> & { kind: "payday" });

/** The dry-run steps plus payday, on the same compressed clock. */
export function buildRunSteps(file: ReplayFile, speed: number): RunStep[] {
  const steps: RunStep[] = buildSteps(file, speed).map((s) => ({ ...s }));
  if (file.scenario?.payday) steps.push({ at: new Date(file.scenario.payday), delayMs: 0, kind: "payday", code: "payday" });
  steps.sort((a, b) => a.at.getTime() - b.at.getTime());
  return steps.map((s, i) => ({ ...s, delayMs: i === 0 ? 0 : Math.round((s.at.getTime() - steps[i - 1]!.at.getTime()) / speed) }));
}

export function localDate(d: Date, timeZone = "UTC"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Refuses to start if the run's payments would not fit in today's caps (the whole run lands in one chain day). */
async function preflight(a: Agent, stormNeed: bigint, baseNeed: bigint): Promise<string | undefined> {
  const s = await readSnapshot(a.c);
  if (s.paused) return "PlanModule is paused";
  const base = s.plans[0]!;
  const storm = s.plans[1]!;
  const lines = [
    `base plan spent today ${fmt(s.spentToday[0]!)} + run ${fmt(baseNeed)} ≤ ${fmt(base.dailyCap)}`,
    `storm plan spent today ${fmt(s.spentToday[1]!)} + run ${fmt(stormNeed)} ≤ ${fmt(storm.dailyCap)}`,
    `all plans spent today ${fmt(s.spentAllToday)} + run ${fmt(baseNeed + stormNeed)} ≤ ceiling ${fmt(s.dailyCeiling)}`,
  ];
  console.log(`Preflight:\n  ${lines.join("\n  ")}`);
  if (s.spentToday[0]! + baseNeed > base.dailyCap) return "the everyday payments would not fit in today's base-plan cap";
  if (s.spentToday[1]! + stormNeed > storm.dailyCap) return "payroll would not fit in today's storm-plan cap";
  if (s.spentAllToday + baseNeed + stormNeed > s.dailyCeiling) return "the run would not fit under today's daily ceiling";
  if (s.isStorm) console.log("  note: storm mode is already on (an earlier run?); the first HKO attestation ends it");
  return undefined;
}

/** Upper bound of the everyday supplier payments: fixture invoices the base plan could pay. */
function everydayEstimate(a: Agent): bigint {
  const cap = units(a.book.plans.base.perTxCap);
  return listInvoices()
    .map((f) => extractFields(readFileSync(f, "utf8")))
    .filter((inv) => inv.kind === "invoice")
    .map((inv) => units(inv.amount))
    .filter((x) => x <= cap)
    .reduce((s, x) => s + x, 0n);
}

async function waitEnter(rl: ReturnType<typeof createInterface> | undefined, what: string): Promise<void> {
  if (rl) await rl.question(`  [paused] next: ${what}. Press Enter… `);
}

export async function runReplay(opts: RunOptions): Promise<number> {
  const runId = opts.runId ?? String(Math.floor(Date.now() / 1000));
  const file = loadReplay(opts.event);
  const ctx: { n: number; phase: RunTx["phase"]; signal?: string; replayTime?: string } = { n: 0, phase: "everyday" };
  const txs: RunTx[] = [];
  const onTx = (label: string, tx: Hex) => txs.push({ n: ++ctx.n, phase: ctx.phase, signal: ctx.signal, replayTime: ctx.replayTime, label, tx });

  const a = makeAgent({ rpcUrl: opts.rpcUrl, onTx });
  if (a.c.dep.region !== file.region) throw new Error(`replay region ${file.region} does not match deployment region ${a.c.dep.region}`);
  const payroll = loadPayroll();
  const run: RunFile = {
    runId,
    event: file.id,
    name: file.name,
    network: a.cfg.network,
    chainId: a.c.dep.chainId,
    startedAt: new Date().toISOString(),
    gdacs: { eventId: file.gdacs.eventId, alertLevel: file.gdacs.alertLevel, saltedEventId: gdacsEventId(file.gdacs.eventId, runId) },
    txs,
    fakeMessages: [],
    ok: false,
  };
  const outPath = resolve(a.cfg.logDir, `run-${runId}.json`);
  const save = () => {
    mkdirSync(a.cfg.logDir, { recursive: true });
    writeFileSync(outPath, JSON.stringify(run, null, 2));
  };

  console.log(`${file.name} (${file.id}) on ${a.cfg.network} (chain ${a.c.dep.chainId}, ${a.cfg.rpcUrl}), speed ${opts.speed}x`);
  console.log(`Run id ${runId}: GDACS event TC-${file.gdacs.eventId}#${runId} → ${run.gdacs.saltedEventId}`);
  console.log(`Model provider: ${a.provider.name}`);

  const refusal = await preflight(a, payrollTotal(payroll), opts.skipEveryday ? 0n : everydayEstimate(a));
  if (refusal) {
    console.error(`Refusing to start: ${refusal}. Wait for the next chain day (UTC) or rehearse on an anvil fork (--rpc).`);
    return 2;
  }

  const rl = opts.pauseAtSteps ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  const storm = new StormLoop({ sink: a.sink, log: a.log, chain: a.stormChain, payroll, localPlanHash: a.localPlanHash, runId, names: a.names });
  const tz = file.timezone ?? "UTC";
  const steps = buildRunSteps(file, opts.speed);
  try {
    if (!opts.skipEveryday) {
      await waitEnter(rl, "ordinary day");
      const { scheduled } = await runEveryday({ ...a.pipeline, c: a.c, sink: a.sink, log: a.log, today: localDate(steps[0]!.at, tz), runId, onTx });
      storm.schedule(scheduled);
    }

    ctx.phase = "replay";
    ctx.replayTime = steps[0]!.at.toISOString();
    await waitEnter(rl, "GDACS attestation");
    const event = eventFromReplay({ ...file.gdacs, name: file.name });
    const g = await attest(a.c, "gdacsRelayer", (n) => buildGdacsAttestation(event, { region: file.region, regionId: a.c.region, runId, ...n }));
    onTx(`GDACS attestation: TC-${file.gdacs.eventId} (${file.name}), ${file.gdacs.alertLevel}`, g.tx);
    console.log(`GDACS ${file.gdacs.alertLevel} attested: ${g.tx}`);

    let stormSeen = false;
    for (const step of steps) {
      if (step.delayMs > 0) await new Promise((r) => setTimeout(r, step.delayMs));
      ctx.replayTime = step.at.toISOString();
      const when = `${step.at.toISOString()} ${step.code}`;
      if (step.kind === "signal") {
        await waitEnter(rl, `signal ${step.code}`);
        ctx.signal = step.code;
        console.log(`${when}: HKO level ${step.level}`);
        const source = file.region === "HK" ? SOURCE.HKO : SOURCE.NCHMF;
        const h = await attest(a.c, "hkoRelayer", (n) =>
          buildHkoAttestation({ level: step.level ?? 0, issueTime: step.at.toISOString() }, { region: a.c.region, source, ...n }),
        );
        const change = h.stormStarted ? " → StormStarted" : h.stormEnded ? " → StormEnded" : "";
        onTx(`HKO attestation: ${step.code} (level ${step.level})${change}`, h.tx);
        if (change) console.log(`  ${change.slice(3)} ${h.tx}`);
        const stormNow = await isStorm(a.c);
        stormSeen ||= stormNow;
        await storm.onSignal(step.level ?? 0, step.code, stormNow, step.at);
        if ((step.level ?? 0) === 0 && stormSeen) {
          // After the storm, the next customer payment repays the credit line again (sweep resumes).
          await clientPays(a.c, a.log, `INV-C-${localDate(step.at, tz)}#${runId}`, units("5000"), onTx);
        }
      } else if (step.kind === "fake_message") {
        await waitEnter(rl, `fake ${step.code} message`);
        const channel = (CHANNELS as string[]).includes(step.code) ? (step.code as Channel) : "chat";
        console.log(`${when}: fake message arrives`);
        const r = await processUntrusted(step.detail ?? "", channel, `${channel}:${step.at.toISOString()}`, a.pipeline);
        run.fakeMessages.push({ replayTime: step.at.toISOString(), channel, outcome: r.outcome, stage: r.stage, reason: r.reason });
        if (r.outcome === "executed") throw new Error("a fake message led to an executed action");
      } else {
        await waitEnter(rl, "payday");
        console.log(`${when}: payday ${payroll.payPeriod}`);
        await storm.onPayday();
      }
      save();
    }
    run.ok = true;
  } catch (err) {
    run.error = err instanceof Error ? err.message : String(err);
    console.error(`Run stopped: ${run.error}`);
  } finally {
    rl?.close();
    run.finishedAt = new Date().toISOString();
    save();
  }

  console.log(`\nTransactions (${txs.length}), run ${runId}:`);
  for (const t of txs) console.log(`${String(t.n).padStart(3)}  ${t.tx}  ${t.signal ?? "-"}  ${t.label}`);
  console.log(`\nWritten to ${outPath}. npm run evidence prints EVIDENCE.md rows.`);
  return run.ok ? 0 : 1;
}
