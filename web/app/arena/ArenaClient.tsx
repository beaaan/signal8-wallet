"use client";

import { useEffect, useRef, useState } from "react";
import { shortHash, timeAgo } from "@/lib/format";
import { outcomeWords, plainReason } from "@/lib/words";
import { ShortHash } from "../components/Copy";
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
type Result =
  | { kind: "ok"; outcome: string; stage: string; reason?: string; tx?: string }
  | { kind: "pending" }
  | { kind: "error"; message: string }
  | null;

/** `closed` is set when the agent is down or not on a local chain: the board stays, the form does not. */
export default function ArenaClient({ closed }: { closed: string | null }) {
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("email");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [board, setBoard] = useState<Board>(null);
  const [now, setNow] = useState(() => Date.now());
  const [news, setNews] = useState(""); // read out by screen readers: only attempts that just arrived
  const refresh = useRef<() => void>(() => undefined);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let seen: Set<string> | null = null;
    let loading = false;
    let again = false; // a refresh asked for while a poll was in flight
    const load = async () => {
      if (loading) {
        again = true;
        return;
      }
      loading = true;
      clearTimeout(timer);
      try {
        const res = await fetch("/api/arena/board", { cache: "no-store" });
        const b = (await res.json()) as Board;
        if (!alive) return;
        if (b?.ok) {
          const fresh = seen ? b.attempts.filter((a) => !seen!.has(a.id)) : [];
          seen = new Set(b.attempts.map((a) => a.id));
          if (fresh.length) setNews(fresh.map((a) => `New attempt: ${outcomeWords(a.outcome, a.stage).badge}.`).join(" "));
        }
        setBoard(b);
        setNow(Date.now());
      } catch {
        if (alive) setBoard({ ok: false, reason: "The website is not answering." });
      } finally {
        loading = false;
        if (alive && again) {
          again = false;
          load();
        } else if (alive) timer = setTimeout(load, POLL_MS);
      }
    };
    refresh.current = load;
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
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
      const b = (await res.json().catch(() => ({}))) as { error?: string; pending?: boolean; outcome?: string; stage?: string; reason?: string; tx?: string };
      if (res.status === 202 && b.pending) {
        setResult({ kind: "pending" });
        setText("");
      } else if (!res.ok || !b.outcome) {
        setResult({ kind: "error", message: b.error ?? `Something went wrong (HTTP ${res.status}).` });
      } else {
        setResult({ kind: "ok", outcome: b.outcome, stage: b.stage ?? "", reason: b.reason, tx: b.tx });
        setText("");
      }
    } catch {
      setResult({ kind: "error", message: "Could not reach the website." });
    } finally {
      setBusy(false);
      refresh.current();
    }
  }

  return (
    <div className="arena-main stack">
      {closed ? (
        <div className="card arena-closed" role="status">
          <h2>Arena closed</h2>
          <p className="muted small">{closed}</p>
        </div>
      ) : (
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
          {result?.kind === "ok" ? (
            <Verdict outcome={result.outcome} stage={result.stage} reason={result.reason} tx={result.tx} />
          ) : result?.kind === "pending" ? (
            <p className="banner verdict pill-wait" role="status">
              Still deciding, watch the board.
            </p>
          ) : result?.kind === "error" ? (
            <p className="warn">{result.message}</p>
          ) : null}
        </form>
      )}

      <section className="card">
        <h2>Live board</h2>
        <p className="sr-only" aria-live="polite">
          {news}
        </p>
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

function Verdict({ outcome, stage, reason, tx }: { outcome: string; stage: string; reason?: string; tx?: string }) {
  const w = outcomeWords(outcome, stage);
  const why = plainReason(reason);
  return (
    <div className={`banner verdict pill-${w.tone}`} role="status">
      <strong>{w.badge}.</strong> {w.text}
      {why ? <> Reason: {why}.</> : null}
      {tx && /^0x[0-9a-fA-F]{64}$/.test(tx) ? (
        <>
          {" "}
          <ShortHash hash={tx} />
        </>
      ) : null}
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
