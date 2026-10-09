"use client";

import { useEffect, useState } from "react";
import type { ActivityGroup, StormStrip } from "@/lib/activity";
import type { DashboardData } from "@/lib/dashboard";
import { txLink } from "@/lib/format";
import { Icon } from "./components/Icons";
import { MeterBar } from "./components/Meter";
import { GdacsChip, SignalBadge } from "./components/Signal";

const POLL_MS = 5000;

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
      <StatusHero data={data} stale={stale} />
      <NeedsYou data={data} />
      <Money data={data} />
      {data.strip ? <StormProgress strip={data.strip} /> : null}
      <div className="dash-cols">
        <Activity data={data} />
        <Limits data={data} />
      </div>
    </div>
  );
}

function StatusHero({ data, stale }: { data: DashboardData; stale: boolean }) {
  const s = data.status;
  const c = data.connection;
  return (
    <section className={`hero hero-${s.mode}${s.paused ? " hero-paused" : ""}`} aria-live="polite">
      <SignalBadge level={s.hkoLevel} size="lg" />
      <div className="hero-text">
        <p className="hero-kicker">
          {s.mode === "storm" ? "Storm mode" : s.mode === "unknown" ? "Not connected" : s.mode === "watch" ? "Calm, watching the weather" : "Calm"}
          {s.paused ? " · Paused" : ""}
        </p>
        <h1 className="hero-headline">{s.headline}</h1>
        {s.lines.length ? (
          <ul className="hero-lines">
            {s.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="hero-side">
        <GdacsChip level={s.gdacsLevel} />
        <div className="conn" aria-label="Connections">
          <Dot ok={c.deployment.ok} label="Contracts" title={c.deployment.text} />
          <Dot ok={c.chain.ok} label="Chain" title={c.chain.text} />
          <Dot ok={c.agent.ok} label="Agent" title={c.agent.text} />
        </div>
        <span className="hero-updated">{stale ? "Refresh failed: showing older data" : `Updated ${data.updatedLabel}`}</span>
      </div>
      {!c.chain.ok || !c.agent.ok ? (
        <details className="hero-why">
          <summary>Why “not connected”?</summary>
          <ul>
            {!c.deployment.ok ? <li>{c.deployment.text}</li> : null}
            {c.deployment.ok && !c.chain.ok ? <li>{c.chain.text}</li> : null}
            {!c.agent.ok ? <li>{c.agent.text}</li> : null}
          </ul>
        </details>
      ) : c.readErrors.length ? (
        <details className="hero-why">
          <summary>{c.readErrors.length} chain reads failed</summary>
          <ul>
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

function Dot({ ok, label, title }: { ok: boolean; label: string; title: string }) {
  return (
    <span className="conn-item" title={title}>
      <span className={`dot ${ok ? "dot-ok" : "dot-bad"}`} aria-hidden />
      {label}
      <span className="sr-only">{ok ? " connected" : " not connected"}</span>
    </span>
  );
}

function NeedsYou({ data }: { data: DashboardData }) {
  const n = data.needsYou;
  if (!n.ok) {
    return (
      <section className="card needs needs-empty">
        <Icon name="proposed" />
        <div>
          <h2>Needs you</h2>
          <p className="muted">Agent not connected, so owner approvals cannot be shown.</p>
        </div>
      </section>
    );
  }
  if (n.total === 0) {
    return (
      <section className="card needs needs-empty">
        <span className="ok-circle">
          <Icon name="check" />
        </span>
        <div>
          <h2>Nothing waiting for you</h2>
          <p className="muted">The agent is working inside the signed plan. Anything outside it comes here for two owners to approve.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="card needs" aria-labelledby="needs-title">
      <div className="card-head">
        <h2 id="needs-title">
          Needs you <span className="count">{n.total}</span>
        </h2>
        {data.safeQueueUrl ? (
          <a className="button" href={data.safeQueueUrl} target="_blank" rel="noreferrer">
            Review in Safe Wallet <Icon name="external" size={16} />
          </a>
        ) : (
          <span className="muted small">Two owners approve these in the shared wallet.</span>
        )}
      </div>
      <ul className="needs-list">
        {n.items.map((it) => (
          <li key={it.id} className="needs-item">
            <div className="needs-main">
              <p className="needs-title">{it.title}</p>
              {it.why ? <p className="needs-why">Why it needs you: {it.why}</p> : null}
              <p className="muted small">
                {[it.source, it.timeLabel].filter(Boolean).join(" · ")}
              </p>
            </div>
            {it.amount ? <div className="needs-amount">{it.amount}</div> : null}
          </li>
        ))}
      </ul>
      {n.total > n.items.length ? <p className="muted small">and {n.total - n.items.length} older requests</p> : null}
    </section>
  );
}

function Money({ data }: { data: DashboardData }) {
  const m = data.money;
  if (!m) {
    return (
      <section className="money" aria-label="Money at a glance">
        {["Cash in the Safe", "Money-market fund", "Credit line", "Typhoon cover"].map((t) => (
          <div key={t} className="card tile">
            <p className="tile-label">{t}</p>
            <p className="tile-value muted">not connected</p>
          </div>
        ))}
      </section>
    );
  }
  return (
    <section className="money" aria-label="Money at a glance">
      <div className="card tile">
        <p className="tile-label">
          <Icon name="cash" /> Cash in the Safe
        </p>
        <p className="tile-value">{m.cash}</p>
        <p className="tile-note">The shop&apos;s shared wallet, ready to pay staff and suppliers.</p>
      </div>
      <div className="card tile">
        <p className="tile-label">
          <Icon name="fund" /> Money-market fund
        </p>
        <p className="tile-value">{m.fund}</p>
        <p className="tile-note">Spare cash earning interest. The agent brings it back before a storm.</p>
      </div>
      <div className="card tile">
        <p className="tile-label">
          <Icon name="credit" /> Credit line
        </p>
        <p className="tile-value">
          {m.credit.used} <span className="tile-of">of {m.credit.cap} {data.symbol} used</span>
        </p>
        <div className="meter-track small-track" aria-hidden>
          <div className={`meter-fill meter-${m.credit.pct >= 90 ? "hot" : m.credit.pct >= 70 ? "warm" : "ok"}`} style={{ width: `${m.credit.pct}%` }} />
        </div>
        <p className="tile-note">{m.creditNote}</p>
      </div>
      <div className={`card tile cover-${m.cover.state}`}>
        <p className="tile-label">
          <Icon name="cover" /> Typhoon cover
        </p>
        <p className="tile-value">
          {m.cover.state === "paid" ? <Icon name="check" /> : null} {m.cover.title}
        </p>
        <p className="tile-note">{m.cover.note}</p>
      </div>
    </section>
  );
}

function Limits({ data }: { data: DashboardData }) {
  const l = data.limits;
  return (
    <section className="card limits" aria-labelledby="limits-title">
      <h2 id="limits-title">
        <Icon name="limit" /> Today&apos;s limits
      </h2>
      {!l ? (
        <p className="muted">Not connected.</p>
      ) : (
        <>
          <p className={`plan-pill plan-${l.plan}`}>{l.planName} in force</p>
          {!l.active ? <p className="warn">This plan is switched off on-chain.</p> : null}
          <MeterBar label={`Spent today, ${l.planName.toLowerCase()}`} {...l.planMeter} symbol={data.symbol} />
          <MeterBar label="Spent today, all plans (hard ceiling)" {...l.allMeter} symbol={data.symbol} />
          {l.creditMeter ? <MeterBar label="Borrowed this storm" {...l.creditMeter} symbol={data.symbol} /> : null}
          <p className="limits-line">
            Each payment can be at most <strong>{l.perTx}</strong>.
          </p>
          <p className="limits-line">
            Right now the agent may: {l.allowed.length ? l.allowed.join(", ") : "nothing"}.
          </p>
          <p className="muted small">
            Limits are enforced by the contract, not by the agent. <a href="/plan">Read the signed plan</a>
          </p>
        </>
      )}
    </section>
  );
}

function StormProgress({ strip }: { strip: StormStrip }) {
  return (
    <section className="card strip" aria-labelledby="strip-title">
      <h2 id="strip-title">
        <Icon name="signal" /> {strip.ongoing ? "This storm so far" : "The last storm"}
      </h2>
      <ol className="strip-steps">
        {strip.steps.map((s, i) => (
          <li key={i} className={`strip-step${s.stormOn ? " strip-storm" : ""}${s.current ? " strip-current" : ""}`}>
            <div className="strip-head">
              <SignalBadge level={s.level} size="sm" />
              <div>
                <p className="strip-title">{s.level === 0 ? "Cancelled" : `Signal ${s.level}`}</p>
                {s.issued ? <p className="strip-time">{s.issued}</p> : null}
              </div>
            </div>
            {s.stormChange ? (
              <p className={`strip-change strip-change-${s.stormChange}`}>{s.stormChange === "on" ? "Storm mode ON" : "Storm mode off"}</p>
            ) : null}
            {s.actions.length ? (
              <ul className="strip-actions">
                {s.actions.slice(0, 5).map((a, j) => (
                  <li key={j} className={`k-${a.kind}`}>
                    <Icon name={a.kind} size={14} /> {a.text}
                  </li>
                ))}
                {s.actions.length > 5 ? <li className="muted">+{s.actions.length - 5} more</li> : null}
              </ul>
            ) : (
              <p className="strip-none">No action needed</p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Activity({ data }: { data: DashboardData }) {
  const a = data.activity;
  return (
    <section className="card activity" aria-labelledby="activity-title">
      <h2 id="activity-title">
        <Icon name="timeline" /> Activity
      </h2>
      {a.reason ? <p className="muted small">{a.reason}</p> : null}
      {!a.ok ? (
        <p className="muted">Not connected.</p>
      ) : a.groups.length === 0 ? (
        <p className="muted">Nothing has happened yet.</p>
      ) : (
        a.groups.map((g) => <Group key={g.key} g={g} chainId={data.chainId} />)
      )}
    </section>
  );
}

function Group({ g, chainId }: { g: ActivityGroup; chainId: number | null }) {
  return (
    <div className={`group group-${g.phase}`}>
      <h3 className="group-head">{g.label}</h3>
      <ul className="items">
        {g.items.map((it) => {
          const link = txLink(chainId, it.tx);
          return (
            <li key={it.id} className={`item k-${it.kind}`}>
              <span className="item-icon" aria-hidden>
                <Icon name={it.kind} size={18} />
              </span>
              <div className="item-body">
                <p className="item-title">{it.title}</p>
                {it.detail ? <p className="item-detail">{it.detail}</p> : null}
                {it.meta ? <p className="item-meta">{it.meta}</p> : null}
                {it.children?.length ? (
                  <details className="item-children">
                    <summary>Show all {it.children.length}</summary>
                    <ul>
                      {it.children.map((c, j) => {
                        const l = txLink(chainId, c.tx);
                        return (
                          <li key={j}>
                            <span>{c.title}</span>
                            <span className="item-amount">
                              {c.amount}
                              {l ? (
                                <a href={l} target="_blank" rel="noreferrer" className="item-link" aria-label="View on the block explorer">
                                  <Icon name="external" size={12} />
                                </a>
                              ) : null}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                ) : null}
              </div>
              <div className="item-side">
                {it.amount ? <span className="item-amount">{it.amount}</span> : null}
                <span className="item-time">
                  {it.timeLabel}
                  {link ? (
                    <a href={link} target="_blank" rel="noreferrer" className="item-link" aria-label="View on the block explorer" title="View on the block explorer">
                      <Icon name="external" size={14} />
                    </a>
                  ) : null}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
