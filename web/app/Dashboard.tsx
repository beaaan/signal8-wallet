"use client";

import { Fragment, useEffect, useState } from "react";
import type { ActivityGroup, StormStep, StormStrip } from "@/lib/activity";
import type { DashboardData, Meter } from "@/lib/dashboard";
import { txLink } from "@/lib/format";
import { Icon } from "./components/Icons";
import { SignalBadge } from "./components/Signal";

const POLL_MS = 5000;
const ACTIVITY_ROWS = 10;

export default function Dashboard({ initial }: { initial: DashboardData }) {
  const [data, setData] = useState(initial);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/dashboard", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as DashboardData;
        if (alive) {
          setData(next);
          setStale(false);
        }
      } catch {
        if (alive) setStale(true);
      }
    };
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="dash">
      <Status data={data} stale={stale} />
      <NeedsYou data={data} />
      <Money data={data} />
      <Limits data={data} />
      {data.strip ? <Storm strip={data.strip} /> : null}
      <Activity data={data} />
    </div>
  );
}

function Status({ data, stale }: { data: DashboardData; stale: boolean }) {
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
        <span className={`live ${down.length || stale ? "live-bad" : ""}`} title={[c.deployment.text, c.chain.text, c.agent.text].join("\n")}>
          <span className="live-dot" aria-hidden />
          {stale ? "Refresh failed" : down.length ? `No ${down.join(", ")}` : `Live · ${data.updatedLabel}`}
        </span>
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
          <div key={c.label} className="figure" title={c.hint}>
            <span className="figure-label">{c.label}</span>
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
        <Bar label="Spent today" m={l.planMeter} />
        <Bar label="All plans today" m={l.allMeter} />
        {l.creditMeter ? <Bar label="Borrowed this storm" m={l.creditMeter} /> : null}
      </div>
      <p className="muted small limits-foot" title={`Right now the agent may: ${l.allowed.join(", ") || "nothing"}. The contract enforces these limits, not the agent.`}>
        Max <span className="mono">{l.perTx}</span> per payment
      </p>
    </section>
  );
}

function Bar({ label, m }: { label: string; m: Meter }) {
  const tone = m.pct >= 90 ? "hot" : m.pct >= 70 ? "warm" : "ok";
  return (
    <div className="bar">
      <div className="bar-label">
        <span className="muted">{label}</span>
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

function Rows({ rows, chainId }: { rows: { g: ActivityGroup; it: ActivityGroup["items"][number]; first: boolean }[]; chainId: number | null }) {
  return (
    <ul className="rows">
      {rows.map(({ g, it, first }) => {
        const link = txLink(chainId, it.tx);
        const hover = [it.detail, it.meta, it.children?.map((c) => `${c.title} ${c.amount ?? ""}`).join("\n")].filter(Boolean).join("\n");
        return (
          <Fragment key={it.id}>
            {first ? <li className={`row-group row-group-${g.phase}`}>{g.label}</li> : null}
            <li className={`row k-${it.kind}`} title={hover || undefined}>
            <span className="row-time mono">{it.timeLabel}</span>
            <span className="row-icon" aria-hidden>
              <Icon name={it.kind} size={15} />
            </span>
            <span className="row-title">
              {it.title}
              {it.detail ? <span className="sr-only">. {it.detail}</span> : null}
            </span>
            <span className="row-amount mono">
              {it.amount ?? ""}
              {link ? (
                <a href={link} target="_blank" rel="noreferrer" className="row-link" aria-label="View on the block explorer">
                  <Icon name="external" size={12} />
                </a>
              ) : null}
            </span>
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}
