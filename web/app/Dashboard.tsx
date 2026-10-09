"use client";

import { useEffect, useState } from "react";
import type { DashboardData, DecisionView } from "@/lib/dashboard";
import type { ChainSnapshot, PlanState } from "@/lib/chain";
import { fmtUnits, gdacsLabel, hkoLabel, outcomeLabel, outcomeTone, shortAddr, shortHash, timeAgo, txLink } from "@/lib/format";

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

  const now = Date.parse(data.generatedAt);
  const snap = data.chain.ok ? data.chain.snapshot : null;
  const chainId = data.deployment.ok ? data.deployment.chainId : null;
  const symbol = data.planBook.ok ? data.planBook.symbol : "mUSD";
  const decisions = data.agent.ok ? data.agent.decisions : [];
  const pending = decisions.filter((d) => d.outcome === "proposed");

  return (
    <div className="stack">
      <Status data={data} stale={stale} />
      <StormBanner snap={snap} />
      {snap?.paused ? (
        <div className="banner banner-alert">The agent is paused. Nothing moves until the owners resume it.</div>
      ) : null}

      <section className="grid3">
        <Stat label="Safe balance" value={snap ? `${fmtUnits(snap.safeBalance, snap.decimals)} ${symbol}` : "not connected"} />
        <Stat
          label="Money-market fund"
          value={snap ? `${fmtUnits(snap.vaultAssets, snap.decimals)} ${symbol}` : "not connected"}
          note={snap?.vaultShares ? `${fmtUnits(snap.vaultShares, snap.decimals)} shares` : undefined}
        />
        <Stat
          label="Credit line"
          value={snap ? `${fmtUnits(snap.creditDrawn, snap.decimals)} / ${fmtUnits(snap.creditLimit, snap.decimals)} ${symbol}` : "not connected"}
          note="drawn / limit"
        />
      </section>

      <ActivePlan snap={snap} symbol={symbol} />

      <section className="card">
        <h2>Waiting for the owners</h2>
        {!data.agent.ok ? (
          <p className="muted">Agent not connected.</p>
        ) : pending.length === 0 ? (
          <p className="muted">Nothing waiting.</p>
        ) : (
          <ul className="list">
            {pending.map((d, i) => (
              <DecisionRow key={`${d.ts}-${i}`} d={d} now={now} chainId={chainId} />
            ))}
          </ul>
        )}
        {data.safeQueueUrl ? (
          <p>
            <a href={data.safeQueueUrl} target="_blank" rel="noreferrer">
              Open the Safe Wallet queue to sign →
            </a>
          </p>
        ) : pending.length > 0 ? (
          <p className="muted small">On anvil the wallet is a LocalSafe; there is no Safe Wallet queue to link to.</p>
        ) : null}
      </section>

      <section className="card">
        <h2>Transactions</h2>
        {!data.feed.ok ? (
          <p className="muted">{data.feed.reason}</p>
        ) : data.feed.items.length === 0 ? (
          <p className="muted">No events since the deployment block yet.</p>
        ) : (
          <ul className="list">
            {data.feed.items.map((f) => {
              const link = txLink(chainId, f.tx);
              return (
                <li key={f.id} className={`row tone-${f.tone}`}>
                  <span className="row-main">{f.text}</span>
                  <span className="row-meta">
                    {f.ts ? timeAgo(f.ts, now) : `block ${f.block}`}
                    {" · "}
                    {link ? (
                      <a href={link} target="_blank" rel="noreferrer">
                        {shortHash(f.tx)}
                      </a>
                    ) : (
                      <span className="mono">{shortHash(f.tx)}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Agent decisions</h2>
        {!data.agent.ok ? (
          <p className="muted">{data.agent.reason}</p>
        ) : decisions.length === 0 ? (
          <p className="muted">No decisions logged yet.</p>
        ) : (
          <ul className="list">
            {decisions.slice(0, 30).map((d, i) => (
              <DecisionRow key={`${d.ts}-${i}`} d={d} now={now} chainId={chainId} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Status({ data, stale }: { data: DashboardData; stale: boolean }) {
  const dot = (ok: boolean) => <span className={`dot ${ok ? "dot-ok" : "dot-bad"}`} aria-hidden />;
  return (
    <section className="status">
      <span>
        {dot(data.deployment.ok)} Deployment{" "}
        {data.deployment.ok ? `${data.deployment.file} · Safe ${shortAddr(data.deployment.safe)}` : "not found"}
      </span>
      <span>
        {dot(data.chain.ok)} Chain{" "}
        {data.chain.ok ? `${data.chain.snapshot.chainId} · block ${data.chain.snapshot.blockNumber}` : "not connected"}
      </span>
      <span>
        {dot(data.agent.ok)} Agent {data.agent.ok ? "connected" : "not connected"}
      </span>
      {stale ? <span className="warn">Refresh failed; showing the last data.</span> : null}
      {!data.deployment.ok ? <p className="muted small full">{data.deployment.reason}</p> : null}
      {data.deployment.ok && !data.chain.ok ? <p className="muted small full">{data.chain.reason}</p> : null}
      {data.chain.ok && data.chain.snapshot.readErrors.length > 0 ? (
        <details className="small full">
          <summary>{data.chain.snapshot.readErrors.length} reads failed</summary>
          <ul>
            {data.chain.snapshot.readErrors.map((e) => (
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

function StormBanner({ snap }: { snap: ChainSnapshot | null }) {
  if (!snap) return <div className="banner banner-unknown">Storm status: not connected.</div>;
  const levels = (
    <span className="levels">
      HKO: {hkoLabel(snap.hko?.level)} · GDACS: {gdacsLabel(snap.gdacs?.level)}
      {snap.currentEvent && /[1-9a-f]/i.test(snap.currentEvent.eventId.slice(2))
        ? ` · event ${shortHash(snap.currentEvent.eventId)}`
        : ""}
    </span>
  );
  if (snap.isStorm) {
    return (
      <div className="banner banner-storm" role="alert">
        <strong>Storm mode is ON.</strong> The storm plan is active: wages, cover claim and credit draw are allowed;
        supplier payments wait. {levels}
      </div>
    );
  }
  return (
    <div className="banner banner-calm">
      <strong>Calm.</strong> The base plan is active. {levels}
    </div>
  );
}

function ActivePlan({ snap, symbol }: { snap: ChainSnapshot | null; symbol: string }) {
  if (!snap) {
    return (
      <section className="card">
        <h2>Active plan</h2>
        <p className="muted">Not connected.</p>
      </section>
    );
  }
  const plan: PlanState | null = snap.activePlanId === null ? null : snap.plans[snap.activePlanId] ?? null;
  const u = (v: string | null) => `${fmtUnits(v, snap.decimals)} ${symbol}`;
  return (
    <section className="card">
      <h2>
        Active plan: {plan ? (plan.name === "storm" ? "Storm" : "Base") : "unknown"}
        {plan && !plan.active ? <span className="pill pill-bad">inactive</span> : null}
      </h2>
      {plan ? (
        <>
          <dl className="kv">
            <dt>Per payment</dt>
            <dd>up to {u(plan.perTxCap)}</dd>
            <dt>Per day (this plan)</dt>
            <dd>up to {u(plan.dailyCap)}</dd>
            {plan.creditCapPerEvent !== "0" ? (
              <>
                <dt>Credit per storm</dt>
                <dd>up to {u(plan.creditCapPerEvent)}</dd>
              </>
            ) : null}
            <dt>Allowed</dt>
            <dd>{actionNames(plan.actions).join(", ") || "nothing"}</dd>
          </dl>
          <Meter label="Spent today (this plan)" used={plan.spentToday} cap={plan.dailyCap} decimals={snap.decimals} symbol={symbol} />
        </>
      ) : (
        <p className="muted">Could not read the plan.</p>
      )}
      <Meter label="Spent today (all plans)" used={snap.spentAllToday} cap={snap.dailyCeiling} decimals={snap.decimals} symbol={symbol} />
    </section>
  );
}

function Meter(props: { label: string; used: string | null; cap: string | null; decimals: number; symbol: string }) {
  const used = props.used ? BigInt(props.used) : 0n;
  const cap = props.cap ? BigInt(props.cap) : 0n;
  const pct = cap > 0n ? Number((used * 1000n) / cap) / 10 : 0;
  return (
    <div className="meter">
      <div className="meter-label">
        <span>{props.label}</span>
        <span>
          {fmtUnits(props.used, props.decimals)} / {fmtUnits(props.cap, props.decimals)} {props.symbol}
        </span>
      </div>
      <div className="meter-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`meter-fill ${pct >= 90 ? "meter-hot" : ""}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note ? <div className="muted small">{note}</div> : null}
    </div>
  );
}

function DecisionRow({ d, now, chainId }: { d: DecisionView; now: number; chainId: number | null }) {
  const link = txLink(chainId, d.tx);
  return (
    <li className="row">
      <span className="row-main">
        <span className={`pill pill-${outcomeTone(d.outcome)}`}>{outcomeLabel(d.outcome, d.stage)}</span>{" "}
        {d.summary ?? d.action ?? (d.inputPreview ? `“${d.inputPreview}”` : "")}
        {d.reason ? <span className="muted"> · {d.reason}</span> : null}
      </span>
      <span className="row-meta">
        {timeAgo(d.ts, now)}
        {d.tx ? (
          <>
            {" · "}
            {link ? (
              <a href={link} target="_blank" rel="noreferrer">
                {shortHash(d.tx)}
              </a>
            ) : (
              <span className="mono">{shortHash(d.tx)}</span>
            )}
          </>
        ) : null}
      </span>
    </li>
  );
}

const ACTION_WORDS: [number, string][] = [
  [1, "pay listed payees"],
  [2, "deposit into the fund"],
  [4, "withdraw from the fund"],
  [8, "draw credit"],
  [16, "claim cover"],
];
function actionNames(bits: number): string[] {
  return ACTION_WORDS.filter(([b]) => (bits & b) !== 0).map(([, w]) => w);
}
