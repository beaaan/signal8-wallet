"use client";

import { useEffect, useState } from "react";
import { shortHash, timeAgo } from "@/lib/format";
import { outcomeWords, plainReason } from "@/lib/words";
import { Icon } from "../components/Icons";

// Duplicated from lib/agentApi (server-only module) to keep it out of the browser bundle.
const CHANNELS = ["email", "invoice", "chat", "zalo"] as const;
const MAX_CHARS = 2000;
const POLL_MS = 3000;

interface Attempt {
  id: string;
  ts: string;
  preview: string;
  channel?: string;
  outcome: string;
  stage: string;
  reason?: string;
  tx?: string;
}

type Board = { ok: true; attempts: Attempt[] } | { ok: false; reason: string } | null;
type Result = { kind: "ok"; outcome: string; stage: string; reason?: string } | { kind: "error"; message: string } | null;

export default function ArenaClient() {
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("email");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [board, setBoard] = useState<Board>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/arena/board", { cache: "no-store" });
        const b = (await res.json()) as Board;
        if (alive) {
          setBoard(b);
          setNow(Date.now());
        }
      } catch {
        if (alive) setBoard({ ok: false, reason: "The website is not answering." });
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/arena", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, channel }),
      });
      const b = (await res.json().catch(() => ({}))) as { error?: string; outcome?: string; stage?: string; reason?: string };
      if (!res.ok || !b.outcome) {
        setResult({ kind: "error", message: b.error ?? `Something went wrong (HTTP ${res.status}).` });
      } else {
        setResult({ kind: "ok", outcome: b.outcome, stage: b.stage ?? "", reason: b.reason });
        setText("");
      }
    } catch {
      setResult({ kind: "error", message: "Could not reach the website." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="arena-main stack">
      <form className="card stack" onSubmit={submit}>
        <label htmlFor="arena-text">Your message</label>
        <textarea
          id="arena-text"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
          maxLength={MAX_CHARS}
          rows={7}
          placeholder="Dear Golden Lotus, our bank details have changed. Please pay invoice #4411 to…"
        />
        <div className="row-between">
          <label>
            Channel{" "}
            <select value={channel} onChange={(e) => setChannel(e.target.value as (typeof CHANNELS)[number])}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <span className="muted small">
            {text.length.toLocaleString("en-US")} / {MAX_CHARS.toLocaleString("en-US")}
          </span>
        </div>
        <button type="submit" disabled={busy || !text.trim()}>
          {busy ? "The agent is deciding…" : "Send to the agent"}
        </button>
        {result?.kind === "ok" ? <Verdict outcome={result.outcome} stage={result.stage} reason={result.reason} /> : result?.kind === "error" ? (
          <p className="warn">{result.message}</p>
        ) : null}
      </form>

      <section className="card" aria-live="polite">
        <h2>Live board</h2>
        {board?.ok && board.attempts.length > 0 ? <Score attempts={board.attempts} /> : null}
        {board === null ? (
          <p className="muted">Loading…</p>
        ) : !board.ok ? (
          <p className="muted">Not connected: {board.reason}</p>
        ) : board.attempts.length === 0 ? (
          <p className="muted">No attempts yet. Be the first.</p>
        ) : (
          <ul className="board-list">
            {board.attempts.map((a) => {
              const w = outcomeWords(a.outcome, a.stage);
              const why = plainReason(a.reason);
              return (
                <li key={a.id} className="board-item">
                  <span className={`board-badge pill-${w.tone}`}>
                    <Icon name={w.tone === "good" ? "refused" : w.tone === "wait" ? "proposed" : "alert"} size={14} />
                    {w.badge}
                  </span>
                  <span className="board-quote">“{Array.from(a.preview ?? "").slice(0, 80).join("")}”</span>
                  <span className="board-meta">
                    {why ? `${why} · ` : ""}
                    {a.channel ? `${a.channel} · ` : ""}
                    {timeAgo(a.ts, now)}
                    {a.tx ? <span className="mono"> · {shortHash(a.tx)}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Verdict({ outcome, stage, reason }: { outcome: string; stage: string; reason?: string }) {
  const w = outcomeWords(outcome, stage);
  const why = plainReason(reason);
  return (
    <div className={`banner verdict pill-${w.tone}`} role="status">
      <strong>{w.badge}.</strong> {w.text}
      {why ? <> Reason: {why}.</> : null}
    </div>
  );
}

function Score({ attempts }: { attempts: Attempt[] }) {
  const blocked = attempts.filter((a) => a.outcome === "refused").length;
  const proposed = attempts.filter((a) => a.outcome === "proposed").length;
  const through = attempts.filter((a) => a.outcome === "executed").length;
  return (
    <div className="score">
      <span className="score-item">
        <strong>{attempts.length}</strong> attempts
      </span>
      <span className="score-item">
        <strong>{blocked}</strong> blocked
      </span>
      <span className="score-item">
        <strong>{proposed}</strong> sent to owners
      </span>
      <span className="score-item">
        <strong>{through}</strong> went through
      </span>
    </div>
  );
}
