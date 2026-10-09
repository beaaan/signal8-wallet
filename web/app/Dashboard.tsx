"use client";

import { Fragment, useEffect, useState } from "react";
import type { ActivityGroup, ActivityItem, StormStep, StormStrip } from "@/lib/activity";
import type { DashboardData, Meter } from "@/lib/dashboard";
import { txLink } from "@/lib/format";
import { ShortHash } from "./components/Copy";
import { Hint } from "./components/Hint";
import { Icon } from "./components/Icons";
import { SignalBadge } from "./components/Signal";

const POLL_MS = 5000;
const ACTIVITY_ROWS = 10;

export default function Dashboard({ initial, big: bigAtStart = false }: { initial: DashboardData; big?: boolean }) {
  const [data, setData] = useState(initial);
  const [stale, setStale] = useState(false);
  const [lastOk, setLastOk] = useState<number | null>(null); // browser time of the last good data
  const [big, setBig] = useState(bigAtStart);

  // Poll: the next request starts only after the previous one finished, none while the tab is hidden, one right
  // away when it is shown again. A response older than the data on screen is dropped.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let newest = Date.parse(initial.generatedAt);
    setLastOk(Date.now());
    const schedule = () => {
      clearTimeout(timer);
      if (alive && !document.hidden) timer = setTimeout(poll, POLL_MS);
    };
    const poll = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const res = await fetch("/api/dashboard", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as DashboardData;
        const t = Date.parse(next.generatedAt);
        if (alive && !(t < newest)) {
          newest = t;
          setData(next);
          setStale(false);
          setLastOk(Date.now());
        }
      } catch {
        if (alive) setStale(true);
      } finally {
        inFlight = false;
        schedule();
      }
    };
    const onVisibility = () => {
      if (document.hidden) clearTimeout(timer);
      else poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [initial.generatedAt]);

  // Presenter mode: ?big=1, or press b.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "b" || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
      setBig((b) => {
        const url = new URL(window.location.href);
        if (b) url.searchParams.delete("big");
        else url.searchParams.set("big", "1");
        window.history.replaceState(null, "", url);
        return !b;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={big ? "dash dash-big" : "dash"}>
      <Status data={data} stale={stale} lastOk={lastOk} />
      <NeedsYou data={data} />
      <Money data={data} />
      <Limits data={data} />
      {data.strip ? <Storm strip={data.strip} /> : null}
      <Activity data={data} />
    </div>
  );
}

/** "Live · 4s ago"; on a failed refresh it keeps the time of the last good one. Ticks on its own. */
function Live({ bad, label, lastOk, title }: { bad: boolean; label: string; lastOk: number | null; title: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  let ago = "";
  if (lastOk !== null && now !== null) {
    const s = Math.max(0, Math.round((now - lastOk) / 1000));
    ago = s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
  }
  return (
    <span className={`live ${bad ? "live-bad" : ""}`} title={title}>
      <span className="live-dot" aria-hidden />
      {ago ? `${label} · ${ago}` : label}
    </span>
  );
}

function Status({ data, stale, lastOk }: { data: DashboardData; stale: boolean; lastOk: number | null }) {
  const s = data.status;
  const c = data.connection;
  const down = [!c.deployment.ok && "contracts", c.deployment.ok && !c.chain.ok && "chain", !c.agent.ok && "agent"].filter(Boolean) as string[];
  const storm = s.mode === "storm";
  return (
    <section className={`status status-${s.mode}${s.paused ? " status-paused" : ""}`} aria-live="polite">
      <SignalBadge level={s.hkoLevel} size="lg" />
      <div className="status-text">
        <h1 title={s.headline}>
          {storm ? (
            <>
              Storm plan <span className="status-on">on</span>
            </>
          ) : (
            s.title
          )}
        </h1>
        <p className="sr-only">{s.headline}</p>
        {s.chips.length ? (
          <ul className="chips">
            {s.chips.map((x) => (
              <li key={x} className={/^GDACS (Red|Orange)/.test(x) ? "chip chip-hot" : "chip"}>
                {x}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="status-side">
        <Live
          bad={Boolean(down.length) || stale}
          label={stale ? "Refresh failed" : down.length ? `No ${down.join(", ")}` : "Live"}
          lastOk={lastOk}
          title={[c.deployment.text, c.chain.text, c.agent.text].join("\n")}
        />
      </div>
      {down.length || c.readErrors.length ? (
        <details className="status-why">
          <summary>{down.length ? "Why?" : `${c.readErrors.length} reads failed`}</summary>
          <ul>
            {!c.deployment.ok ? <li>{c.deployment.text}</li> : null}
            {c.deployment.ok && !c.chain.ok ? <li>{c.chain.text}</li> : null}
            {!c.agent.ok ? <li>{c.agent.text}</li> : null}
            {s.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
            {c.readErrors.map((e) => (
              <li key={e} className="mono">
                {e}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function NeedsYou({ data }: { data: DashboardData }) {
  const n = data.needsYou;
  if (!n.ok) return null; // the status line already says the agent is not connected
  if (n.total === 0) {
    return (
      <section className="panel needs needs-none" aria-label="Needs you">
        <Icon name="check" size={18} />
        <span>Nothing needs you</span>
      </section>
    );
  }
  return (
    <section className="panel needs" aria-labelledby="needs-title">
      <header className="needs-head">
        <h2 id="needs-title" className="tag tag-wait">
          Needs you · {n.total}
        </h2>
        {data.safeQueueUrl ? (
          <a className="button" href={data.safeQueueUrl} target="_blank" rel="noreferrer">
            Review in Safe <Icon name="external" size={14} />
          </a>
        ) : (
          <span className="muted small">2 owners approve</span>
        )}
      </header>
      <ul className="needs-list">
        {n.items.map((it) => (
          <li key={it.id} className="needs-row">
            <div className="needs-what">
              <span className="needs-title">
                {it.title}
                {it.ref ? <span className="mono needs-ref">{it.ref}</span> : null}
              </span>
              {it.why ? <span className="muted small">{it.why}</span> : null}
            </div>
            <span className="needs-amount mono">{it.amount ?? ""}</span>
          </li>
        ))}
      </ul>
      {n.total > n.items.length ? <p className="muted small">+{n.total - n.items.length} older</p> : null}
    </section>
  );
}

function Money({ data }: { data: DashboardData }) {
  const m = data.money;
  const cells: { label: string; value: React.ReactNode; hint?: string; tone?: string }[] = m
    ? [
        { label: "Cash", value: m.cash, hint: m.hints.cash },
        { label: "Savings fund", value: m.fund, hint: m.hints.fund },
        {
          label: "Borrowed",
          value: (
            <>
              {m.credit.used} <span className="figure-of">/ {m.credit.cap}</span>
            </>
          ),
          hint: m.hints.credit,
        },
        { label: `Typhoon cover · ${m.cover.label.toLowerCase()}`, value: m.cover.value, hint: m.hints.cover, tone: m.cover.state === "paid" ? "good" : m.cover.state === "ready" ? "wait" : undefined },
      ]
    : ["Cash", "Savings fund", "Borrowed", "Typhoon cover"].map((label) => ({ label, value: "—" }));
  return (
    <section aria-label={`Money, in ${data.symbol}`}>
      <h2 className="section-label">
        Money <span className="unit">{data.symbol}</span>
      </h2>
      <div className="figures">
        {cells.map((c) => (
          <div key={c.label} className="figure">
            <Hint text={c.hint} className="figure-label">
              {c.label}
            </Hint>
            <span className={`figure-value mono${c.tone ? ` tone-${c.tone}` : ""}`}>{c.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Limits({ data }: { data: DashboardData }) {
  const l = data.limits;
  if (!l) return null;
  return (
    <section aria-labelledby="limits-title">
      <h2 id="limits-title" className="section-label">
        {l.planName} limits
        {!l.active ? <span className="tag tag-bad">switched off</span> : null}
        <a href="/plan" className="section-link">
          Signed plan →
        </a>
      </h2>
      <div className="bars">
        <Bar label="Spent today" m={l.planMeter} hint={l.resetNote} />
        <Bar label="All plans today" m={l.allMeter} hint={l.resetNote} />
        {l.creditMeter ? <Bar label="Borrowed this storm" m={l.creditMeter} /> : null}
      </div>
      <p className="muted small limits-foot">
        <Hint text={`Right now the agent may: ${l.allowed.join(", ") || "nothing"}. The contract enforces these limits, not the agent.`}>
          Max <span className="mono">{l.perTx}</span> per payment
        </Hint>
      </p>
    </section>
  );
}

function Bar({ label, m, hint }: { label: string; m: Meter; hint?: string | null }) {
  const tone = m.pct >= 90 ? "hot" : m.pct >= 70 ? "warm" : "ok";
  return (
    <div className="bar">
      <div className="bar-label">
        <Hint text={hint} className="muted">
          {label}
        </Hint>
        <span className="mono">
          {m.used} / {m.cap}
        </span>
      </div>
      <div className="bar-track" role="progressbar" aria-label={label} aria-valuenow={Math.round(m.pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`bar-fill bar-${tone}`} style={{ width: `${Math.max(m.pct, m.pct > 0 ? 1.5 : 0)}%` }} />
      </div>
    </div>
  );
}

/** "Wed 24 Sept, 02:40" → "Wed 02:40"; today's "14:20" stays. */
const shortWhen = (s: string | null) => (s ? s.replace(/^(\w{3}) [^,]+, /, "$1 ") : "");

function Storm({ strip }: { strip: StormStrip }) {
  return (
    <section aria-labelledby="storm-title">
      <h2 id="storm-title" className="section-label">
        {strip.ongoing ? "This storm" : "Last storm"}
      </h2>
      <div className="steps-wrap">
        <ol className="steps">
          {strip.steps.map((s, i) => (
            <Step key={i} s={s} />
          ))}
        </ol>
      </div>
    </section>
  );
}

function Step({ s }: { s: StormStep }) {
  const shown = s.actions.slice(0, 3);
  return (
    <li className={`step${s.stormOn ? " step-storm" : ""}${s.current ? " step-current" : ""}`}>
      <span className="step-when mono">{shortWhen(s.issued)}</span>
      <span className="step-title">
        {s.level === 0 ? "All clear" : `Signal ${s.level}`}
        {s.current ? <span className="tag tag-now">now</span> : null}
        {s.stormChange ? <span className={`tag ${s.stormChange === "on" ? "tag-bad" : "tag-good"}`}>{s.stormChange === "on" ? "storm on" : "storm off"}</span> : null}
      </span>
      {shown.length ? (
        <ul className="step-did">
          {shown.map((a, j) => (
            <li key={j}>{a.text}</li>
          ))}
          {s.actions.length > shown.length ? <li className="muted">+{s.actions.length - shown.length} more</li> : null}
        </ul>
      ) : (
        <span className="step-did muted">Holding</span>
      )}
    </li>
  );
}

function Activity({ data }: { data: DashboardData }) {
  const a = data.activity;
  if (!a.ok) return null;
  const rows = a.groups.flatMap((g) => g.items.map((it, i) => ({ g, it, first: i === 0 })));
  const head = rows.slice(0, ACTIVITY_ROWS);
  const rest = rows.slice(ACTIVITY_ROWS);
  return (
    <section aria-labelledby="activity-title">
      <h2 id="activity-title" className="section-label">
        Activity
      </h2>
      {a.reason ? <p className="muted small">{a.reason}</p> : null}
      {rows.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <>
          <Rows rows={head} chainId={data.chainId} />
          {rest.length ? (
            <details className="more">
              <summary>Show {rest.length} more</summary>
              <Rows rows={rest} chainId={data.chainId} />
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

function Rows({ rows, chainId }: { rows: { g: ActivityGroup; it: ActivityItem; first: boolean }[]; chainId: number | null }) {
  return (
    <ul className="rows">
      {rows.map(({ g, it, first }) => (
        <Fragment key={it.id}>
          {first ? <li className={`row-group row-group-${g.phase}`}>{g.label}</li> : null}
          <Row it={it} chainId={chainId} />
        </Fragment>
      ))}
    </ul>
  );
}

const isTx = (tx: string | undefined): tx is string => Boolean(tx && /^0x[0-9a-fA-F]{64}$/.test(tx));

/** An explorer link where the chain has one; on anvil a short hash with a copy button. */
function TxRef({ tx, chainId }: { tx: string | undefined; chainId: number | null }) {
  const link = txLink(chainId, tx);
  if (link) {
    return (
      <a href={link} target="_blank" rel="noreferrer" className="row-link" aria-label="View on the block explorer">
        <Icon name="external" size={12} />
      </a>
    );
  }
  return isTx(tx) ? <ShortHash hash={tx} /> : null;
}

/** One activity line. Details (and a folded payroll run's payments) open on click, tap or Enter. */
function Row({ it, chainId }: { it: ActivityItem; chainId: number | null }) {
  const [open, setOpen] = useState(false);
  const link = txLink(chainId, it.tx);
  const note = [it.detail, it.meta].filter(Boolean).join(" · ");
  const more = Boolean(note || it.children?.length || (!link && isTx(it.tx)));
  return (
    <li className={`row k-${it.kind}`}>
      <span className="row-time mono">{it.timeLabel}</span>
      <span className="row-icon" aria-hidden>
        <Icon name={it.kind} size={15} />
      </span>
      {more ? (
        <button type="button" className="row-title row-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="row-title-text">{it.title}</span>
          <span className="row-chevron" aria-hidden>
            <Icon name="chevron" size={12} />
          </span>
        </button>
      ) : (
        <span className="row-title">{it.title}</span>
      )}
      <span className="row-amount mono">
        {it.amount ?? ""}
        {link ? <TxRef tx={it.tx} chainId={chainId} /> : null}
      </span>
      {open ? (
        <div className="row-more">
          {note ? <p>{note}</p> : null}
          {!link && isTx(it.tx) ? <ShortHash hash={it.tx} /> : null}
          {it.children?.length ? (
            <ul className="row-children">
              {it.children.map((c, j) => (
                <li key={j}>
                  <span>{c.title}</span>
                  <span className="row-amount mono">
                    {c.amount ?? ""}
                    <TxRef tx={c.tx} chainId={chainId} />
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
