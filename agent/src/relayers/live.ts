// Live relayers: poll the official source, attest on change, and re-attest every 6 h while the condition holds, so a
// long storm keeps storm mode on (the attestor lets HKO attestations lapse after 12 h and GDACS ones after 24 h).
// Spec: docs/specs/agent.md#hko-relayershkots, #gdacs-relayersgdacsts; docs/specs/contracts.md (re-attestation).
//
//   npm run relayer:hko                # one observation and the decision, no transaction (dry run)
//   npm run relayer:hko -- --live      # poll warnsum every 60 s and attest with the HKO relayer key
//   npm run relayer:gdacs -- --live    # poll GDACS every 60 s, attest Orange/Red TC events for the region
//
// The scheduling is pure (decideHko, decideGdacs) and the loop takes an injected clock, fetch and submitter, so it is
// unit-tested with fakes (test/live.test.ts). The last attested state starts from the attestor's latest(source, region).

import { resolve } from "node:path";
import { signalAttestorAbi } from "../abis.ts";
import { connect, type Chainish } from "../chain.ts";
import { loadConfig, loadDeployment } from "../config.ts";
import { isMain } from "../isMain.ts";
import { JsonlFile } from "../log.ts";
import { buildGdacsAttestation, fetchGdacsEvents, gdacsEventId, GDACS_EVENTS_URL, pickEvent, type GdacsEvent } from "./gdacs.ts";
import { buildHkoAttestation, fetchHkoSignal, HKO_WARNSUM_URL, type HkoSignal } from "./hko.ts";
import { SOURCE, ZERO32, type Hex } from "./sign.ts";
import { attest } from "./submit.ts";

export const POLL_MS = 60_000;
export const REATTEST_MS = 6 * 3_600_000;

/** The last attestation this relayer made (or found on-chain). */
export interface Attested {
  level: number;
  eventId: Hex;
  issuedAtMs: number;
}

export interface Decision {
  attest: boolean;
  why: string;
}

/** HKO: attest when the level changes; while it is 8 or above, re-attest every 6 h. */
export function decideHko(obs: HkoSignal, last: Attested | undefined, nowMs: number, reattestMs = REATTEST_MS): Decision {
  if (!last) return { attest: true, why: `first attestation (level ${obs.level})` };
  if (obs.level !== last.level) return { attest: true, why: `level ${last.level} → ${obs.level}` };
  if (obs.level >= 8 && nowMs - last.issuedAtMs >= reattestMs) return { attest: true, why: `re-attest level ${obs.level} (last ${Math.round((nowMs - last.issuedAtMs) / 60_000)} min ago)` };
  return { attest: false, why: `level ${obs.level} unchanged` };
}

/**
 * GDACS: attest a current Orange/Red TC event for the region when it is new or its alert level changes; re-attest
 * every 6 h while it stays current. A tracked event downgraded to Green is attested too (it ends the GDACS half of
 * storm mode); an event that is no longer current is left to lapse.
 */
export function decideGdacs(event: GdacsEvent | undefined, last: Attested | undefined, nowMs: number, reattestMs = REATTEST_MS): Decision {
  if (!event) return { attest: false, why: "no current TC event for the region" };
  const id = gdacsEventId(event.eventId);
  const tracked = last && last.eventId.toLowerCase() === id.toLowerCase();
  if (event.alertLevel < 2) {
    if (tracked && last.level >= 2) return { attest: true, why: `event ${event.eventId} downgraded to level ${event.alertLevel}` };
    return { attest: false, why: `event ${event.eventId} is Green` };
  }
  if (!tracked) return { attest: true, why: `event ${event.eventId} (${event.name}) level ${event.alertLevel}` };
  if (event.alertLevel !== last.level) return { attest: true, why: `event ${event.eventId} level ${last.level} → ${event.alertLevel}` };
  if (nowMs - last.issuedAtMs >= reattestMs) return { attest: true, why: `re-attest event ${event.eventId} (last ${Math.round((nowMs - last.issuedAtMs) / 60_000)} min ago)` };
  return { attest: false, why: `event ${event.eventId} level ${event.alertLevel} unchanged` };
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

export interface TickResult {
  at: string;
  observed?: string;
  action: "attest" | "skip" | "error" | "dry-run";
  why: string;
  tx?: Hex;
}

/** One relayer's source: how to observe, decide and submit. */
export interface LiveSource<T> {
  name: string;
  observe(): Promise<T>;
  describe(obs: T): string;
  decide(obs: T, last: Attested | undefined, nowMs: number): Decision;
  /** Signs and sends; returns what is now on-chain. */
  submit(obs: T): Promise<Attested & { tx: Hex }>;
}

export class LiveRelayer<T> {
  last: Attested | undefined;
  private initialised = false;

  constructor(
    private readonly src: LiveSource<T>,
    private readonly clock: Clock,
    private readonly initial: () => Promise<Attested | undefined>,
    private readonly opts: { dryRun?: boolean; onTick?: (t: TickResult) => void; pollMs?: number } = {},
  ) {}

  async tick(): Promise<TickResult> {
    const at = new Date(this.clock.now()).toISOString();
    const done = (t: TickResult) => (this.opts.onTick?.(t), t);
    try {
      if (!this.initialised) {
        this.last = await this.initial();
        this.initialised = true;
      }
    } catch (err) {
      return done({ at, action: "error", why: `reading the attestor: ${msg(err)}` });
    }
    let obs: T;
    try {
      obs = await this.src.observe();
    } catch (err) {
      return done({ at, action: "error", why: `fetch: ${msg(err)}` }); // keep polling; the last attestation stands
    }
    const observed = this.src.describe(obs);
    const d = this.src.decide(obs, this.last, this.clock.now());
    if (!d.attest) return done({ at, observed, action: "skip", why: d.why });
    if (this.opts.dryRun) return done({ at, observed, action: "dry-run", why: d.why });
    try {
      const r = await this.src.submit(obs);
      this.last = { level: r.level, eventId: r.eventId, issuedAtMs: r.issuedAtMs };
      return done({ at, observed, action: "attest", why: d.why, tx: r.tx });
    } catch (err) {
      return done({ at, observed, action: "error", why: `attest: ${msg(err)}` }); // retried on the next poll
    }
  }

  /** Polls until `stop()` is true (tests) or forever. */
  async run(stop: () => boolean = () => false): Promise<void> {
    while (!stop()) {
      await this.tick();
      if (stop()) break;
      await this.clock.sleep(this.opts.pollMs ?? POLL_MS);
    }
  }
}

function msg(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 160);
}

/** The attestor's latest(source, region), as this relayer's starting point (undefined if never attested). */
export async function onchainLatest(c: Chainish, source: Hex): Promise<Attested | undefined> {
  const [level, eventId, , issuedAt] = await c.pub.readContract({ address: c.dep.contracts.SignalAttestor, abi: signalAttestorAbi, functionName: "latest", args: [source, c.region] });
  return issuedAt === 0n ? undefined : { level, eventId, issuedAtMs: Number(issuedAt) * 1000 };
}

export function hkoSource(opts: { fetchImpl?: typeof fetch; url?: string; c?: Chainish }): LiveSource<HkoSignal> {
  return {
    name: "hko",
    observe: () => fetchHkoSignal(opts.url ?? HKO_WARNSUM_URL, opts.fetchImpl),
    describe: (s) => `${s.code} (level ${s.level})${s.issueTime ? ` issued ${s.issueTime}` : ""}`,
    decide: (s, last, now) => decideHko(s, last, now),
    async submit(s) {
      if (!opts.c) throw new Error("no chain");
      const c = opts.c;
      const r = await attest(c, "hkoRelayer", (n) => buildHkoAttestation(s, { region: c.region, ...n }));
      return { tx: r.tx, level: s.level, eventId: ZERO32, issuedAtMs: Number(r.attestation.issuedAt) * 1000 };
    },
  };
}

export function gdacsSource(opts: { region: string; fetchImpl?: typeof fetch; url?: string; c?: Chainish; clock?: Clock }): LiveSource<GdacsEvent | undefined> {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return {
    name: "gdacs",
    async observe() {
      const now = (opts.clock ?? realClock).now();
      const events = await fetchGdacsEvents(day(now - 7 * 86_400_000), day(now + 86_400_000), opts.url ?? GDACS_EVENTS_URL, opts.fetchImpl);
      return pickEvent(events, opts.region);
    },
    describe: (e) => (e ? `TC-${e.eventId} ${e.name} level ${e.alertLevel} (${e.countries.join(",")})` : "none"),
    decide: (e, last, now) => decideGdacs(e, last, now),
    async submit(e) {
      if (!opts.c || !e) throw new Error("no chain or no event");
      const c = opts.c;
      const r = await attest(c, "gdacsRelayer", (n) => buildGdacsAttestation(e, { region: opts.region, regionId: c.region, ...n }));
      return { tx: r.tx, level: e.alertLevel, eventId: r.attestation.eventId, issuedAtMs: Number(r.attestation.issuedAt) * 1000 };
    },
  };
}

if (isMain(import.meta.url)) {
  const which = process.argv[2];
  if (which !== "hko" && which !== "gdacs") {
    console.error("usage: tsx src/relayers/live.ts hko|gdacs [--live]");
    process.exit(2);
  }
  const live = process.argv.includes("--live");
  const cfg = loadConfig();
  const dep = loadDeployment(cfg.network);
  const c = connect(cfg, dep);
  if (which === "hko" && dep.region !== "HK") throw new Error(`the HKO relayer serves HK; this deployment's region is ${dep.region}`);
  const file = new JsonlFile<TickResult & { source: string; network: string }>(resolve(cfg.logDir, `relayer-${which}.jsonl`));
  const onTick = (t: TickResult) => {
    console.log(`${t.at} ${which} ${t.action.padEnd(7)} ${t.observed ?? "-"}: ${t.why}${t.tx ? ` ${t.tx}` : ""}`);
    if (live) file.append({ ...t, source: which, network: cfg.network });
  };
  const src = which === "hko" ? hkoSource({ c }) : gdacsSource({ region: dep.region, c });
  const source = which === "hko" ? SOURCE.HKO : SOURCE.GDACS;
  const initial = async () => {
    try {
      return await onchainLatest(c, source);
    } catch (err) {
      if (live) throw err;
      console.log(`  (could not read the attestor at ${cfg.rpcUrl}: ${msg(err)}; deciding as if nothing was attested)`);
      return undefined;
    }
  };
  const relayer = new LiveRelayer<unknown>(src as LiveSource<unknown>, realClock, initial, { dryRun: !live, onTick });
  console.log(`${which} relayer on ${cfg.network} (${dep.contracts.SignalAttestor}), region ${dep.region}: ${live ? `live, polling every ${POLL_MS / 1000} s` : "dry run (one observation, no transaction; add --live)"}`);
  if (live) await relayer.run();
  else {
    const t = await relayer.tick();
    process.exitCode = t.action === "error" ? 1 : 0;
  }
}
