// Turns chain events and agent decisions into what the dashboard shows: one activity timeline grouped by
// phase and day, the storm progress strip, and the "Needs you" list. Server only; output is JSON-safe and
// every time is pre-formatted (in the business's time zone) so the browser renders strings only.
import type { Decision } from "./agentApi";
import { SOURCES, ZERO32, type ChainLog } from "./chain";
import { fmtDecimal, fmtUnits, shortHash } from "./format";
import { gdacsName, plainReason, signalFromCode, sourceLabel } from "./words";

export type Kind =
  | "paid"
  | "refused"
  | "proposed"
  | "signal"
  | "stormOn"
  | "stormOff"
  | "cover"
  | "credit"
  | "vault"
  | "evidence"
  | "inflow"
  | "hold"
  | "note"
  | "alert";

export interface ActivityItem {
  id: string;
  /** unix ms; null when unknown */
  time: number | null;
  timeLabel: string;
  kind: Kind;
  title: string;
  detail?: string;
  meta?: string;
  amount?: string;
  tx?: string;
  /** Raw token units of `amount`, used to add up grouped payments. */
  raw?: string;
  /** Payments folded into this line (e.g. one payroll run). */
  children?: { title: string; amount?: string; tx?: string }[];
}

export interface ActivityGroup {
  key: string;
  phase: "calm" | "storm";
  label: string;
  items: ActivityItem[]; // newest first
}

export interface StormStep {
  level: number;
  /** Official time the signal was issued (HKO), formatted; null if not given. */
  issued: string | null;
  stormOn: boolean;
  stormChange: "on" | "off" | null;
  actions: { kind: Kind; text: string }[];
  current: boolean;
}

export interface StormStrip {
  ongoing: boolean;
  steps: StormStep[];
}

export interface NeedsYouItem {
  id: string;
  timeLabel: string;
  /** Who gets paid, or what to review: a few words. */
  title: string;
  /** Why it needs the owners, in a short phrase. */
  why: string | null;
  /** Invoice or order reference, if any. */
  ref: string | null;
  amount: string | null;
  source: string | null;
}

export interface Ctx {
  decimals: number;
  symbol: string;
  timeZone: string;
  now: number; // ms
  payees: Map<string, { name: string; role: string }>;
  hkoSource: string; // SOURCES.HKO or SOURCES.NCHMF
}

// ---------------------------------------------------------------- time

function parts(ms: number, tz: string) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { day: `${get("day")} ${get("month")}`, weekday: get("weekday"), time: `${get("hour")}:${get("minute")}` };
}

/** "14:20" today, "Mon 22 Sep, 14:20" otherwise. */
export function whenLabel(ms: number | null, ctx: Pick<Ctx, "timeZone" | "now">): string {
  if (ms === null) return "";
  const a = parts(ms, ctx.timeZone);
  const today = parts(ctx.now, ctx.timeZone);
  return a.day === today.day ? a.time : `${a.weekday} ${a.day}, ${a.time}`;
}

export function dayLabel(ms: number, ctx: Pick<Ctx, "timeZone" | "now">): string {
  const a = parts(ms, ctx.timeZone);
  const today = parts(ctx.now, ctx.timeZone);
  const yesterday = parts(ctx.now - 86_400_000, ctx.timeZone);
  if (a.day === today.day) return "Today";
  if (a.day === yesterday.day) return "Yesterday";
  return `${a.weekday} ${a.day}`;
}

export function agoLabel(ms: number | null, now: number): string {
  if (ms === null) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

// ---------------------------------------------------------------- wording helpers

const EVIDENCE_KINDS: Record<string, string> = {
  PRE_STORM: "pre-storm snapshot",
  DAILY_REPORT: "daily report",
  ATTACK_LOG: "attack log",
  PLAN: "plan book",
};

function bytes32Text(h: unknown): string | null {
  if (typeof h !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(h)) return null;
  const bytes = h.slice(2).match(/../g)!.map((x) => parseInt(x, 16));
  while (bytes.length && bytes[bytes.length - 1] === 0) bytes.pop();
  if (!bytes.length || bytes.some((b) => b < 0x20 || b > 0x7e)) return null;
  return String.fromCharCode(...bytes);
}

/** "Pay 1200 mUSD to X under the base plan (INV-1#123)" → "Pay 1,200 mUSD to X under the base plan". */
export function tidySummary(s: string, symbol: string): string {
  return s
    .replace(/^Owner proposal:\s*/i, "")
    .replace(/\s*\((?:[^()]*#[^()]*|INV[^()]*|ref[^()]*)\)\s*$/i, "")
    .replace(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${symbol}`, "g"), (_m, n: string) => `${fmtDecimal(n)} ${symbol}`)
    .replace(/\(simulated client, not the agent\)/i, "")
    .replace(/ under the (base|storm) plan\b/i, "")
    .trim();
}

function amountIn(s: string | undefined, symbol: string): string | null {
  if (!s) return null;
  const m = new RegExp(`([\\d,]+(?:\\.\\d+)?)\\s*${symbol}`).exec(s);
  return m ? fmtDecimal(m[1].replace(/,/g, "")) : null;
}

// ---------------------------------------------------------------- chain → items

const ACT = { pay: 1, vault_deposit: 2, vault_withdraw: 4, credit_draw: 8, cover_claim: 16 } as const;

function signalItemText(log: ChainLog, ctx: Ctx): { title: string; detail?: string; level: number; source: "hko" | "gdacs" | "other" } {
  const a = log.args;
  const level = Number(a.level);
  const sourceTime = Number(a.sourceTime ?? 0);
  const issued = sourceTime > 0 ? `Issued ${whenLabel(sourceTime * 1000, ctx)} (official time)` : undefined;
  if (a.source === SOURCES.HKO) {
    return { level, source: "hko", title: level === 0 ? "Signals cancelled" : `Signal ${level}`, detail: issued };
  }
  if (a.source === SOURCES.NCHMF) {
    return { level, source: "hko", title: `Storm level ${level}`, detail: issued };
  }
  if (a.source === SOURCES.GDACS) {
    const ev = a.eventId && a.eventId !== ZERO32 ? `event ${shortHash(String(a.eventId))}` : "";
    return { level, source: "gdacs", title: `GDACS ${gdacsName(level)}`, detail: ["Global disaster alert for this storm", ev].filter(Boolean).join(", ") };
  }
  return { level, source: "other", title: `Signal level ${level}` };
}

/** One item per transaction: Executed + Claimed / Drawn become one line, as do Inflow + Repaid. */
function chainItems(logs: ChainLog[], ctx: Ctx, decisionsByTx: Map<string, Decision>): (ActivityItem & { block: number })[] {
  const byTx = new Map<string, ChainLog[]>();
  for (const l of logs) {
    const list = byTx.get(l.tx) ?? [];
    list.push(l);
    byTx.set(l.tx, list);
  }
  const amt = (v: unknown) => fmtUnits(typeof v === "bigint" ? v : 0n, ctx.decimals);
  const out: (ActivityItem & { block: number })[] = [];

  for (const [tx, group] of byTx) {
    const first = group[0];
    const time = first.time === null ? null : first.time * 1000;
    const base = { id: tx, tx, time, timeLabel: whenLabel(time, ctx), block: first.block };
    const find = (n: string) => group.find((l) => l.eventName === n);
    const d = decisionsByTx.get(tx.toLowerCase());
    const from = d ? sourceLabel(d.input) : null;

    const started = find("StormStarted");
    const ended = find("StormEnded");
    const attested = find("Attested");
    if (started || ended) {
      const s = attested ? signalItemText(attested, ctx) : null;
      out.push({
        ...base,
        kind: started ? "stormOn" : "stormOff",
        title: started ? "Storm plan on" : "Everyday plan back",
        detail: s ? (started ? `${s.title} with a GDACS alert: the storm plan takes over` : `${s.title}: back to the everyday plan`) : undefined,
      });
      continue;
    }
    if (attested) {
      const s = signalItemText(attested, ctx);
      out.push({ ...base, kind: "signal", title: s.title, detail: s.detail });
      continue;
    }

    const exec = find("Executed");
    if (exec) {
      const a = exec.args;
      const plan = Number(a.planId) === 1 ? "Storm plan" : "Everyday plan";
      const meta = [plan, from].filter(Boolean).join(" · ");
      switch (Number(a.action)) {
        case ACT.pay: {
          const p = ctx.payees.get(String(a.target).toLowerCase());
          out.push({
            ...base,
            kind: "paid",
            title: `Paid ${p?.name ?? shortHash(String(a.target))}`,
            detail: p ? (p.role === "staff" ? "Wages" : p.role === "supplier" ? "Supplier payment" : undefined) : "Payee not in the plan book",
            meta,
            amount: amt(a.amount),
            raw: String(a.amount ?? 0n),
          });
          break;
        }
        case ACT.vault_deposit:
          out.push({ ...base, kind: "vault", title: "Moved to fund", detail: "Spare cash into the money-market fund", meta, amount: amt(a.amount) });
          break;
        case ACT.vault_withdraw:
          out.push({ ...base, kind: "vault", title: "Back from fund", detail: "Cash out of the money-market fund, ready to pay", meta, amount: amt(a.amount) });
          break;
        case ACT.cover_claim: {
          const c = find("Claimed");
          out.push({ ...base, kind: "cover", title: "Cover paid", detail: "Typhoon insurance, paid once per storm", meta, amount: c ? amt(c.args.payout) : undefined });
          break;
        }
        case ACT.credit_draw: {
          const dr = find("Drawn");
          out.push({
            ...base,
            kind: "credit",
            title: "Borrowed",
            detail: dr ? `Now owing ${amt(dr.args.drawnTotal)}` : undefined,
            meta,
            amount: amt(a.amount),
          });
          break;
        }
        default:
          out.push({ ...base, kind: "note", title: `Agent action ${String(a.action)}`, meta, amount: amt(a.amount) });
      }
      continue;
    }

    const anchored = find("Anchored");
    if (anchored) {
      const kindText = bytes32Text(anchored.args.kind);
      out.push({
        ...base,
        kind: "evidence",
        title: `Sealed ${(kindText && EVIDENCE_KINDS[kindText]) ?? kindText ?? "record"}`,
        detail: `Fingerprint on-chain (${shortHash(String(anchored.args.hash))}); the record stays private`,
        meta: from ?? undefined,
      });
      continue;
    }

    const inflow = find("Inflow");
    if (inflow) {
      const swept = typeof inflow.args.swept === "bigint" ? inflow.args.swept : 0n;
      // The invoice ref on-chain is a hash; the agent's decision line names the invoice.
      const named = d?.summary ? /\bfor ([A-Za-z0-9][\w.-]*)/.exec(d.summary)?.[1] : undefined;
      const ref = bytes32Text(inflow.args.invoiceRef) ?? named ?? null;
      out.push({
        ...base,
        kind: "inflow",
        title: "Customer paid",
        detail: [ref ? `Invoice ${ref}` : null, swept > 0n ? `${amt(swept)} went to repay the credit line` : null].filter(Boolean).join(" · ") || undefined,
        amount: amt(inflow.args.amount),
      });
      continue;
    }

    const repaid = find("Repaid");
    if (repaid) {
      out.push({ ...base, kind: "credit", title: "Repaid credit", detail: `Now owing ${amt(repaid.args.drawnTotal)}`, amount: amt(repaid.args.amount) });
      continue;
    }
    const claimed = find("Claimed");
    if (claimed) {
      out.push({ ...base, kind: "cover", title: "Cover paid", amount: amt(claimed.args.payout) });
      continue;
    }
    const drawn = find("Drawn");
    if (drawn) {
      out.push({ ...base, kind: "credit", title: "Borrowed", amount: amt(drawn.args.amount) });
      continue;
    }
    const paused = find("PausedSet");
    if (paused) {
      out.push({ ...base, kind: "alert", title: paused.args.paused ? "Agent paused" : "Agent resumed", detail: `by ${shortHash(String(paused.args.by))}` });
      continue;
    }
  }
  return out;
}

// ---------------------------------------------------------------- decisions → items

function decisionItem(d: Decision, i: number, ctx: Ctx): ActivityItem {
  const time = Date.parse(d.ts);
  const t = Number.isFinite(time) ? time : null;
  const base = { id: `d${i}-${d.ts}`, time: t, timeLabel: whenLabel(t, ctx), tx: d.tx };
  const from = sourceLabel(d.input);
  const summary = d.summary ? tidySummary(d.summary, ctx.symbol) : undefined;
  const reason = plainReason(d.reason);
  const action = d.action ?? "";

  if (d.outcome === "refused" && action === "credit_draw" && d.reason === "forecast above buffer") {
    return { ...base, kind: "note", title: "No loan needed", detail: "Cash on hand covers the forecast", meta: from ?? undefined };
  }
  if (action === "hold") {
    return { ...base, kind: "hold", title: "Suppliers on hold", detail: summary ?? "Supplier payments wait until the storm passes", meta: from ?? undefined };
  }
  if (d.outcome === "proposed") {
    return {
      ...base,
      kind: "proposed",
      title: `To owners: ${proposalTitle(summary)}`,
      detail: reason ? capital(reason) : summary,
      meta: from ?? undefined,
      amount: amountIn(summary, ctx.symbol) ?? undefined,
    };
  }
  if (d.outcome === "refused") {
    let title: string;
    if (d.stage === "extractor") title = `Blocked ${article(from)}`;
    else if (summary && /^No payment for "/.test(summary)) {
      const m = /^No payment for "(.+)" ([\d.,]+) (\w+)/.exec(summary);
      const known = m && m[1].toLowerCase() !== "unknown" && Number(m[2].replace(/,/g, "")) > 0;
      title = known ? `Refused ${m![1]}` : `Blocked ${article(from)}`;
    } else if (summary) title = `Refused: ${clip(summary, 40)}`;
    else title = "Refused";
    return { ...base, kind: "refused", title, detail: reason ? capital(reason) : undefined, meta: from ?? undefined };
  }
  // executed without a matching chain event: an agent note (notify, forecast, drafts, reconcile, …)
  const label: Record<string, string> = {
    notify: "Owners told",
    forecast: "Forecast updated",
    drafts: "Drafts ready",
    reconcile: /mismatch/i.test(d.summary ?? "") ? "Books do not match" : "Books match",
    inflow_match: "Customer payment matched",
    relayer: "Signal relayed",
    plan_check: "Plan check",
  };
  return {
    ...base,
    kind: "note",
    title: label[action] ?? (summary ? clip(summary, 48) : action ? capital(action.replace(/_/g, " ")) : "Agent note"),
    detail: summary ?? reason ?? undefined,
    meta: from ?? undefined,
  };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** "Pay 4,900 mUSD to Wing On Meats (WO-2299); logged…" → { who: "Wing On Meats", ref: "WO-2299" }. */
export function parseProposal(summary: string | null | undefined): { who: string | null; ref: string | null; draft: string | null } {
  const s = (summary ?? "").split(";")[0];
  const draft = /^Draft for the owner to review and send: (.+?)(?: →|$)/.exec(s)?.[1] ?? null;
  const who = /\bto (.+?)(?: \(|$)/.exec(s)?.[1] ?? null;
  const ref = /\(([^()#]+)(?:#[^()]*)?\)/.exec(s)?.[1] ?? null;
  return { who: draft ? null : who, ref: draft ? null : ref, draft };
}

function proposalTitle(summary: string | undefined): string {
  if (!summary) return "a decision";
  const p = parseProposal(summary);
  if (p.draft) return `draft ${p.draft}`;
  if (p.who) return `pay ${p.who}`;
  if (/queueChange/.test(summary)) return "plan change";
  return clip(summary.split(";")[0], 40);
}

function article(from: string | null): string {
  if (!from) return "a message";
  const w = from.toLowerCase();
  return /^[aeiou]/.test(w) ? `an ${w}` : `a ${w}`;
}

/** Folds 3+ back-to-back payments of the same kind (a payroll run) into one line with the list underneath. */
function foldPayments<T extends ActivityItem>(items: T[], ctx: Ctx): T[] {
  const out: T[] = [];
  let run: T[] = [];
  const isDraft = (x: T) => x.kind === "proposed" && x.title.startsWith("To owners: draft ");
  const same = (a: T, b: T) =>
    (a.kind === "paid" && b.kind === "paid" && a.meta === b.meta && a.detail === b.detail) || (isDraft(a) && isDraft(b));
  const flush = () => {
    if (run.length >= 2 && isDraft(run[0])) {
      const last = run[run.length - 1];
      out.push({
        ...last,
        id: `fold-${run[0].id}`,
        title: `To owners: ${run.length} drafts`,
        detail: "Review and send them yourself; the agent never sends them",
        children: run.map((it) => ({ title: it.title.replace(/^To owners: draft /, "") })),
      });
    } else if (run.length >= 3) {
      const total = run.reduce((s, it) => s + BigInt(it.raw ?? "0"), 0n);
      const last = run[run.length - 1];
      out.push({
        ...last,
        id: `fold-${run[0].id}`,
        title: last.detail === "Wages" ? `Paid ${run.length} staff` : `${run.length} payments`,
        amount: fmtUnits(total, ctx.decimals),
        raw: total.toString(),
        tx: undefined,
        children: run.map((it) => ({ title: it.title.replace(/^Paid /, ""), amount: it.amount, tx: it.tx })),
      });
    } else out.push(...run);
    run = [];
  };
  for (const it of items) {
    if (run.length && !same(run[run.length - 1], it)) flush();
    if (it.kind === "paid" || isDraft(it)) run.push(it);
    else out.push(it);
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- build

export interface Activity {
  groups: ActivityGroup[];
  strip: StormStrip | null;
  needsYou: NeedsYouItem[];
  needsYouTotal: number;
  stormSince: number | null; // unix ms of the last StormStarted, while storm mode is on
  stormEnded: number | null; // unix ms of the last StormEnded, while storm mode is off
  lastCoverPaid: { amount: string; when: string } | null;
}

const MAX_ITEMS = 80;

export function buildActivity(logs: ChainLog[], decisions: Decision[], ctx: Ctx): Activity {
  const decisionsByTx = new Map<string, Decision>();
  for (const d of decisions) if (d.tx) decisionsByTx.set(d.tx.toLowerCase(), d);
  const chain = chainItems(logs, ctx, decisionsByTx);
  const chainTx = new Set(chain.map((c) => c.tx!.toLowerCase()));
  const agent = decisions
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => !(d.tx && chainTx.has(d.tx.toLowerCase())))
    .map(({ d, i }) => decisionItem(d, i, ctx));

  // Oldest first to assign phases; storm on/off items switch the phase.
  const all = foldPayments(
    [...chain, ...agent].sort((a, b) => (a.time ?? 0) - (b.time ?? 0)),
    ctx,
  );
  let phase: "calm" | "storm" = "calm";
  let seg = 0;
  const tagged = all.map((it) => {
    if (it.kind === "stormOn" && phase !== "storm") {
      phase = "storm";
      seg++;
    } else if (it.kind === "stormOff" && phase !== "calm") {
      phase = "calm";
      seg++;
    }
    return { it, phase, seg };
  });
  const recent = tagged.slice(-MAX_ITEMS).reverse();
  const groups: ActivityGroup[] = [];
  for (const { it, phase: ph, seg: sg } of recent) {
    const day = it.time === null ? "Earlier" : dayLabel(it.time, ctx);
    const key = `${sg}:${day}`;
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, phase: ph, label: `${ph === "storm" ? "Storm plan" : "Everyday plan"} · ${day}`, items: [] };
      groups.push(g);
    }
    const { block: _b, ...clean } = it as ActivityItem & { block?: number };
    g.items.push(clean);
  }

  // Needs you: proposals waiting for the owners (holds are information, not a request).
  const proposals = decisions.filter((d) => d.outcome === "proposed" && d.action !== "hold");
  // Newest first; drafts from one run become a single "review the drafts" line.
  const needsAll: NeedsYouItem[] = [];
  const drafts: { d: Decision; name: string }[] = [];
  for (const [i, d] of proposals.entries()) {
    const summary = d.summary ? tidySummary(d.summary, ctx.symbol) : null;
    const p = parseProposal(summary);
    const t = Date.parse(d.ts);
    const timeLabel = Number.isFinite(t) ? whenLabel(t, ctx) : "";
    if (p.draft) {
      if (!drafts.length) needsAll.push({ id: `drafts-${d.ts}`, timeLabel, title: "", why: null, ref: null, amount: null, source: null });
      drafts.push({ d, name: p.draft });
      continue;
    }
    const why = plainReason(d.reason);
    needsAll.push({
      id: `n${i}-${d.ts}`,
      timeLabel,
      title: p.who ?? (d.action === "plan_change" ? "Plan change" : summary ? clip(summary.split(";")[0], 48) : "A decision"),
      why: why ? capital(why) : null,
      ref: p.ref,
      amount: amountIn(summary ?? undefined, ctx.symbol),
      source: sourceLabel(d.input),
    });
  }
  const draftLine = needsAll.find((n) => n.id.startsWith("drafts-"));
  if (draftLine) {
    draftLine.title = drafts.length === 1 ? "Draft to review" : `${drafts.length} drafts to review`;
    draftLine.why = drafts.map((x) => x.name.replace(/ \((?:en|zh-Hant|zh-Hans|vi)\)$/, "")).filter((v, i, a) => a.indexOf(v) === i).join(" · ");
    draftLine.source = "The agent never sends them";
  }
  const needsYou = needsAll.slice(0, 6);

  const lastStart = [...logs].reverse().find((l) => l.eventName === "StormStarted" || l.eventName === "StormEnded");
  const stormSince = lastStart?.eventName === "StormStarted" && lastStart.time !== null ? lastStart.time * 1000 : null;
  const stormEnded = lastStart?.eventName === "StormEnded" && lastStart.time !== null ? lastStart.time * 1000 : null;
  const lastClaim = [...logs].reverse().find((l) => l.eventName === "Claimed");
  const lastCoverPaid = lastClaim
    ? {
        amount: fmtUnits(typeof lastClaim.args.payout === "bigint" ? lastClaim.args.payout : 0n, ctx.decimals),
        when: lastClaim.time ? whenLabel(lastClaim.time * 1000, ctx) : "",
      }
    : null;

  return {
    groups,
    strip: buildStrip(logs, decisions, chain, ctx),
    needsYou,
    needsYouTotal: needsAll.length,
    stormSince,
    stormEnded,
    lastCoverPaid,
  };
}

/**
 * The signal history of the current (or last) storm: each HKO signal with what the agent did while it was up.
 * Chain actions are placed exactly by block. Agent decisions without a transaction are placed by their
 * "storm:<code>" label, walking forward through the steps in time order.
 */
function buildStrip(logs: ChainLog[], decisions: Decision[], chain: (ActivityItem & { block: number })[], ctx: Ctx): StormStrip | null {
  const signals = logs.filter((l) => l.eventName === "Attested" && l.args.source === ctx.hkoSource);
  if (!signals.length) return null;
  let start = -1;
  for (let i = 0; i < signals.length; i++) {
    const lvl = Number(signals[i].args.level);
    const prev = i === 0 ? 0 : Number(signals[i - 1].args.level);
    if (lvl >= 1 && prev === 0) start = i;
  }
  if (start < 0) return null;
  let end = signals.length - 1;
  for (let i = start + 1; i < signals.length; i++) {
    if (Number(signals[i].args.level) === 0) {
      end = i;
      break;
    }
  }
  const evSignals = signals.slice(start, end + 1);
  const ongoing = Number(evSignals[evSignals.length - 1].args.level) !== 0;
  const stormTx = new Map<string, "on" | "off">();
  for (const l of logs) {
    if (l.eventName === "StormStarted") stormTx.set(l.tx, "on");
    if (l.eventName === "StormEnded") stormTx.set(l.tx, "off");
  }
  let stormOn = false;
  // storm state before the first step
  for (const l of logs) {
    if (l.block >= evSignals[0].block) break;
    if (l.eventName === "StormStarted") stormOn = true;
    if (l.eventName === "StormEnded") stormOn = false;
  }

  const steps: (StormStep & { block: number })[] = evSignals.map((l) => {
    const change = stormTx.get(l.tx) ?? null;
    if (change === "on") stormOn = true;
    if (change === "off") stormOn = false;
    const st = Number(l.args.sourceTime ?? 0);
    return {
      level: Number(l.args.level),
      issued: st > 0 ? whenLabel(st * 1000, ctx) : null,
      stormOn,
      stormChange: change,
      actions: [],
      current: false,
      block: l.block,
    };
  });
  if (ongoing) steps[steps.length - 1].current = true;
  const stepTimes = evSignals.map((l) => (l.time === null ? null : l.time * 1000));

  const stepOfBlock = (b: number): number => {
    let k = -1;
    for (let i = 0; i < steps.length; i++) if (steps[i].block <= b) k = i;
    return k;
  };
  const lastBlock = ongoing ? Infinity : nextBlockAfter(logs, steps[steps.length - 1].block, ctx.hkoSource);

  // chain actions: exact by block
  const paidByStep = new Map<number, { n: number; total: bigint }>();
  for (const it of chain) {
    if (it.block < steps[0].block || it.block >= lastBlock) continue;
    if (it.kind === "signal" || it.kind === "stormOn" || it.kind === "stormOff") continue;
    const k = stepOfBlock(it.block);
    if (k < 0) continue;
    if (it.kind === "paid") {
      const raw = logs.find((l) => l.tx === it.tx && l.eventName === "Executed");
      const v = raw && typeof raw.args.amount === "bigint" ? raw.args.amount : 0n;
      const cur = paidByStep.get(k) ?? { n: 0, total: 0n };
      paidByStep.set(k, { n: cur.n + 1, total: cur.total + v });
      continue;
    }
    steps[k].actions.push({ kind: it.kind, text: it.amount ? `${shortTitle(it)} ${it.amount}` : shortTitle(it) });
  }
  for (const [k, p] of paidByStep) {
    steps[k].actions.unshift({ kind: "paid", text: `Paid ${p.n === 1 ? "1 payee" : `${p.n} people`} ${fmtUnits(p.total, ctx.decimals)}` });
  }

  // decisions without a chain event: walk forward through the steps
  const txBlock = new Map<string, number>();
  for (const l of logs) txBlock.set(l.tx.toLowerCase(), l.block);
  const asc = [...decisions].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  let lo = -1;
  let hi = asc.length;
  asc.forEach((d, i) => {
    const b = d.tx ? txBlock.get(d.tx.toLowerCase()) : undefined;
    if (b === undefined) return;
    if (b < steps[0].block) lo = i;
    if (b >= lastBlock && hi === asc.length) hi = i;
  });
  let p = 0;
  for (let i = lo + 1; i < hi; i++) {
    const d = asc[i];
    const b = d.tx ? txBlock.get(d.tx.toLowerCase()) : undefined;
    if (b !== undefined) {
      p = Math.max(0, stepOfBlock(b));
      continue;
    }
    const [kind, code = ""] = d.input.split(":", 2);
    if (kind === "arena" || kind === "invoice" || kind === "sweep") continue;
    // A later signal certainly came first if its block is a whole second older than the decision.
    const ts = Date.parse(d.ts);
    for (let j = steps.length - 1; j > p; j--) {
      const bt = stepTimes[j];
      if (bt !== null && bt + 1000 <= ts) {
        p = j;
        break;
      }
    }
    if (kind === "storm") {
      const lvl = signalFromCode(code);
      if (lvl !== null && steps[p].level !== lvl) {
        const q = steps.findIndex((s, j) => j > p && s.level === lvl);
        if (q > 0) p = q;
      }
    }
    const it = decisionItem(d, i, ctx);
    if (it.kind === "note" && d.action === "forecast") continue; // too detailed for the strip
    if (it.kind === "proposed" && parseProposal(d.summary).draft) {
      if (!steps[p].actions.some((a) => a.text === "Drafts for owners")) steps[p].actions.push({ kind: "proposed", text: "Drafts for owners" });
      continue;
    }
    const text =
      d.action === "notify"
        ? "Plan checked"
        : d.action === "hold"
          ? "Suppliers on hold"
          : d.action === "drafts"
            ? "Claim drafted"
            : shortTitle(it);
    steps[p].actions.push({ kind: it.kind, text });
  }

  return { ongoing, steps: steps.map(({ block: _b, ...s }) => s) };
}

function nextBlockAfter(logs: ChainLog[], block: number, hkoSource: string): number {
  const next = logs.find((l) => l.block > block && l.eventName === "Attested" && l.args.source === hkoSource);
  return next ? next.block : Infinity;
}

function shortTitle(it: ActivityItem): string {
  switch (it.kind) {
    case "cover":
      return "Cover";
    case "vault":
      return it.title.startsWith("Back") ? "Fund → cash" : "Cash → fund";
    default:
      return clip(it.title, 40);
  }
}
