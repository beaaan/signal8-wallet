// Real replay mode: everyday day (optional), GDACS attestation, each HKO signal change, the storm loop,
// the scenario's fake messages through the full pipeline, and payday. Every tx is printed at the end and
// written to agent/logs/run-<runId>.json (npm run evidence turns it into EVIDENCE.md rows).
//
// Two declared periods, each with its own ledger, reconciliation and anchored report (loops/report.ts): the ordinary
// day, and the storm period from the ordinary day's compared closing snapshot to the end of the replay (brace,
// cover payout, payroll, credit draw, the post-storm receipt and its sweep). A period the run did not close is
// marked as such in the run file; the ordinary-day report never stands for the whole replay.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { makeAgent, type Agent } from "../agent.ts";
import { isStorm, readBalances, readSnapshot } from "../chain.ts";
import { writeDrafts, type DraftContext } from "../drafts.ts";
import { Ledger, type ChainView } from "../ledger.ts";
import { JsonlFile } from "../log.ts";
import { fmt, plain, units } from "../exec/executor.ts";
import { extractFields } from "../llm/rules.ts";
import type { Channel } from "../llm/provider.ts";
import { clientPays, listInvoices, runEveryday } from "../loops/everyday.ts";
import { chainInflows, inflowCheckpointPath, InflowWatcher, loadReceivables, type InflowMatch } from "../loops/inflows.ts";
import { chainReader, type Alert, type DayClose } from "../loops/reconcile.ts";
import { closePeriod, resultLine, type ReportResult, type SealedReport } from "../loops/report.ts";
import { loadPayroll, payrollTotal, StormLoop, type StormRecord } from "../loops/storm.ts";
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
  /** End-of-day reconciliation of the ordinary day. */
  reconciliation?: { ok: boolean; diffs: string[]; pauseTx?: Hex };
  /** Each declared period's reconciliation and report (absent in runs before issue #18). */
  periods?: RunPeriod[];
  inflows: Array<{ kind: string; receivable?: string; amount: string; swept: string; tx: Hex }>;
  /** What the storm loop recorded: the cover payout (PlanModule's Executed event carries 0 for a claim), evidence, credit, drafts. */
  storm?: { coverPayout?: string; coverTx?: Hex; coverEventId?: Hex; preStormHash?: Hex; creditDrawn?: string; heldProposed: number; drafts: string[] };
  ok: boolean;
  error?: string;
}

/** One declared period. `closed: false` means the run stopped first: no reconciliation or report covers it. */
export interface RunPeriod {
  id: "ordinary-day" | "storm";
  date?: string; // business date the period closed on
  closed: boolean;
  ok?: boolean;
  diffs?: string[];
  debt?: string; // ok | mismatch | not_read
  coverage?: string; // complete | gaps | limited
  blocks?: { opening?: string; closing?: string };
  report?: string; // file name in the log directory
  reportHash?: Hex;
  anchorTx?: Hex;
  reportError?: string;
  pauseTx?: Hex;
  note?: string;
}

export function runPeriod(id: RunPeriod["id"], date: string, opening: ChainView, rec: DayClose, report?: SealedReport): RunPeriod {
  return {
    id,
    date,
    closed: true,
    ok: rec.ok,
    diffs: rec.diffs,
    debt: rec.checks.debt,
    coverage: rec.coverage.status,
    blocks: { opening: opening.block?.toString(), closing: rec.after.block?.toString() },
    report: report && basename(report.file),
    reportHash: report?.hash,
    anchorTx: report?.tx,
    reportError: rec.reportError,
    pauseTx: rec.pauseTx,
  };
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
    periods: [],
    inflows: [],
    ok: false,
  };
  const periods = run.periods!;
  const outPath = resolve(a.cfg.logDir, `run-${runId}.json`);
  const save = () => {
    mkdirSync(a.cfg.logDir, { recursive: true });
    writeFileSync(outPath, JSON.stringify(run, null, 2));
  };

  console.log(`${file.name} (${file.id}) on ${a.cfg.network} (chain ${a.c.dep.chainId}, ${a.cfg.rpcUrl}), speed ${opts.speed}x`);
  console.log(`Run id ${runId}: GDACS event TC-${file.gdacs.eventId}#${runId} → ${run.gdacs.saltedEventId}`);
  console.log(`Model provider: ${a.provider.name}`);

  // The agent acts only under the plan the owners signed: check before the ordinary day, not just at Signal 1.
  const onchain = await a.stormChain.planHashes();
  if (!onchain.every((h) => h.toLowerCase() === a.localPlanHash.toLowerCase())) {
    a.log.write({ input: "replay:start", stage: "localCheck", outcome: "refused", reason: "PlanHashMismatch", action: "plan_check", summary: "Local plan book does not match the signed on-chain plan; the agent will not act" });
    console.error(`Refusing to start: the plan book hashes to ${a.localPlanHash.slice(0, 10)}…, the chain has ${onchain.map((h) => `${h.slice(0, 10)}…`).join(" / ")}. Redeploy from this plan book, or use the one that was deployed.`);
    return 2;
  }

  const refusal = await preflight(a, payrollTotal(payroll), opts.skipEveryday ? 0n : everydayEstimate(a));
  if (refusal) {
    console.error(`Refusing to start: ${refusal}. Wait for the next chain day (UTC) or rehearse on an anvil fork (--rpc).`);
    return 2;
  }

  const rl = opts.pauseAtSteps ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  const tz = file.timezone ?? "UTC";
  const drafts = async (rec: StormRecord): Promise<string[]> => {
    const b = await readBalances(a.c);
    const ctx: DraftContext = {
      runId,
      business: payroll.business,
      eventName: file.name,
      region: file.region,
      timeZone: tz,
      network: a.cfg.network,
      chainId: a.c.dep.chainId,
      stormStart: rec.stormStart,
      stormEnd: rec.stormEnd ?? new Date(),
      safe: a.c.dep.contracts.Safe,
      cover: rec.cover && { contract: a.c.dep.contracts.MockSignalCover, ...rec.cover },
      preStorm: rec.preStorm,
      credit: rec.credit && { ...rec.credit, outstanding: b.creditDrawn },
      payroll: { period: payroll.payPeriod, payday: payroll.payday, total: payrollTotal(payroll), staff: payroll.staff.length, paidInStorm: rec.payrollPaidInStorm },
      held: rec.proposedHeld.flatMap((h) =>
        h.action.type === "pay" ? [{ payee: a.names.get(h.action.payee.toLowerCase()) ?? h.action.payee, amount: h.action.amount, invoiceId: h.invoiceId, dueDate: h.dueDate }] : [],
      ),
    };
    return writeDrafts(ctx, a.cfg.logDir, a.log);
  };
  const storm = new StormLoop({ sink: a.sink, log: a.log, chain: a.stormChain, payroll, localPlanHash: a.localPlanHash, runId, names: a.names, drafts });
  // Inflow matching starts at this run's first block, so earlier runs' (differently salted) payments are not re-flagged.
  const inflows = new InflowWatcher({
    source: chainInflows(a.c),
    log: a.log,
    receivables: loadReceivables(),
    checkpointFile: inflowCheckpointPath(a.cfg.stateDir, `${a.cfg.network}-run-${runId}`),
    fromBlock: (await a.c.pub.getBlockNumber({ cacheTime: 0 })) + 1n,
    runId,
  });
  const steps = buildRunSteps(file, opts.speed);
  const reader = chainReader(a.c);
  const alerts = new JsonlFile<Alert>(resolve(a.cfg.logDir, "alerts.jsonl"));
  const recordInflow = (m: InflowMatch) => run.inflows.push({ kind: m.kind, receivable: m.receivable?.id, amount: plain(m.event.amount), swept: plain(m.event.swept), tx: m.event.tx });
  // The storm period's own ledger, inflows and report lines (owner proposals, refused messages).
  const stormLedger = new Ledger();
  const stormInflows: InflowMatch[] = [];
  const stormResults: ReportResult[] = [];
  let stormOpening: ChainView | undefined;
  const firstDate = localDate(steps[0]!.at, tz);
  try {
    if (!opts.skipEveryday) {
      await waitEnter(rl, "ordinary day");
      const ledger = new Ledger();
      a.sink.ledger = ledger;
      const day = await runEveryday({
        ...a.pipeline,
        c: a.c,
        sink: a.sink,
        log: a.log,
        today: firstDate,
        runId,
        onTx,
        inflows,
        reconcile: { ledger, reader, pauser: a.sink, alerts },
      });
      a.sink.ledger = undefined;
      storm.schedule(day.scheduled, day.scheduledInfo);
      day.inflows.forEach(recordInflow);
      const rec = day.reconciliation;
      if (rec && day.opening) {
        run.reconciliation = { ok: rec.ok, diffs: rec.diffs, pauseTx: rec.pauseTx };
        periods.push(runPeriod("ordinary-day", firstDate, day.opening, rec, day.report));
      }
      if (rec && !rec.ok) throw new Error(`ledger mismatch at end of day; ${rec.pauseTx ? "PlanModule paused" : "pause FAILED"} (${rec.diffs.join("; ")})`);
      if (rec?.reportError) throw new Error(`daily report not sealed: ${rec.reportError}`);
      // The storm period starts where the ordinary day's compared closing snapshot ends: no gap between the reports.
      stormOpening = rec?.after;
    }
    stormOpening ??= await reader.view();
    a.sink.ledger = stormLedger;

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
          await clientPays(a.c, `INV-C-${localDate(step.at, tz)}#${runId}`, units("5000"), onTx);
          for (const m of await inflows.poll(stormLedger)) {
            stormInflows.push(m);
            recordInflow(m);
          }
        }
      } else if (step.kind === "fake_message") {
        await waitEnter(rl, `fake ${step.code} message`);
        const channel = (CHANNELS as string[]).includes(step.code) ? (step.code as Channel) : "chat";
        console.log(`${when}: fake message arrives`);
        const input = `${channel}:${step.at.toISOString()}`;
        const r = await processUntrusted(step.detail ?? "", channel, input, a.pipeline);
        run.fakeMessages.push({ replayTime: step.at.toISOString(), channel, outcome: r.outcome, stage: r.stage, reason: r.reason });
        stormResults.push(resultLine(input, r, r.actions?.[0], r.invoice, a.names));
        if (r.outcome === "executed") throw new Error("a fake message led to an executed action");
      } else {
        await waitEnter(rl, "payday");
        console.log(`${when}: payday ${payroll.payPeriod}`);
        await storm.onPayday();
      }
      save();
    }
    const r = storm.record;
    run.storm = {
      coverPayout: r.cover?.payout !== undefined ? plain(r.cover.payout) : undefined,
      coverTx: r.cover?.tx,
      coverEventId: r.cover?.eventId,
      preStormHash: r.preStorm?.hash,
      creditDrawn: r.credit ? plain(r.credit.amount) : undefined,
      heldProposed: r.proposedHeld.length,
      drafts: r.drafts.map((p) => p.replace(`${a.cfg.logDir}/`, "")),
    };
    // Held supplier payments became owner proposals: pending approval, not cash movements.
    for (const h of r.proposedHeld) stormResults.push(resultLine("storm:held-payment", { outcome: h.outcome }, h.action, h, a.names));

    // Close the storm period: its own reconciliation and report (one more DAILY_REPORT anchor).
    const lastDate = localDate(steps.at(-1)!.at, tz);
    const close = await closePeriod({
      c: a.c,
      sink: a.sink,
      deps: { reader, log: a.log, pauser: a.sink, alerts, onTx },
      period: { id: "storm", from: firstDate, to: lastDate, note: "from the ordinary day's close to the end of the replay: brace, cover, payroll, credit, post-storm receipt" },
      runId,
      ledger: stormLedger,
      opening: stormOpening,
      inflows: stormInflows,
      results: stormResults,
    });
    a.sink.ledger = undefined;
    periods.push(runPeriod("storm", lastDate, stormOpening, close.rec, close.report));
    if (!close.rec.ok) throw new Error(`ledger mismatch at end of the storm period; ${close.rec.pauseTx ? "PlanModule paused" : "pause FAILED"} (${close.rec.diffs.join("; ")})`);
    if (close.rec.reportError) throw new Error(`storm-period report not sealed: ${close.rec.reportError}`);
    run.ok = true;
  } catch (err) {
    run.error = err instanceof Error ? err.message : String(err);
    console.error(`Run stopped: ${run.error}`);
  } finally {
    a.sink.ledger = undefined;
    // A period the run did not close has no reconciliation or report: say so rather than leave it implied.
    for (const id of opts.skipEveryday ? (["storm"] as const) : (["ordinary-day", "storm"] as const)) {
      if (!periods.some((p) => p.id === id)) periods.push({ id, closed: false, note: `not reconciled or reported: ${run.error ?? "run stopped"}` });
    }
    rl?.close();
    run.finishedAt = new Date().toISOString();
    save();
  }

  if (run.storm) {
    const st = run.storm;
    console.log(`\nStorm: cover payout ${st.coverPayout ?? "-"} mUSD (tx ${st.coverTx ?? "-"}), credit drawn ${st.creditDrawn ?? "0"} mUSD, ${st.heldProposed} held payment(s) proposed`);
    if (st.drafts.length) console.log(`Drafts for the owner (never sent by the agent):\n  ${st.drafts.join("\n  ")}`);
  }
  for (const p of periods) {
    const what = !p.closed
      ? "NOT CLOSED (no reconciliation or report)"
      : p.ok
        ? `ledger matches the chain; debt ${p.debt}, transfer coverage ${p.coverage}`
        : `MISMATCH, ${p.pauseTx ? `paused ${p.pauseTx}` : "pause failed"}`;
    console.log(`Reconciliation, ${p.id}${p.date ? ` ${p.date}` : ""}: ${what}${p.report ? `; report ${p.report}` : ""}${p.reportError ? `; report failed: ${p.reportError}` : ""}`);
  }
  console.log(`\nTransactions (${txs.length}), run ${runId}:`);
  // On Base Sepolia each hash is a Basescan link (most terminals make it clickable).
  const explorer = a.c.dep.chainId === 84532 ? "https://sepolia.basescan.org/tx/" : "";
  for (const t of txs) console.log(`${String(t.n).padStart(3)}  ${explorer}${t.tx}  ${t.signal ?? "-"}  ${t.label}`);
  console.log(`\nWritten to ${outPath}. npm run evidence prints EVIDENCE.md rows; -- --write puts them in docs/EVIDENCE.md.`);
  return run.ok ? 0 : 1;
}
