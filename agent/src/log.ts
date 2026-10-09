// Decision log: one JSON line per action, refusal or proposal in agent/logs/decisions.jsonl.
// Spec: docs/specs/agent.md#decision-log. The dashboard reads it through server.ts.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Decision } from "./types.ts";

export class JsonlFile<T> {
  constructor(readonly path: string) {}

  append(value: T): void {
    mkdirSync(resolve(this.path, ".."), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(value)}\n`);
  }

  /** Newest first. Lines that fail to parse are skipped. */
  readNewest(limit: number, parse: (v: unknown) => T | undefined = (v) => v as T): T[] {
    if (!existsSync(this.path)) return [];
    const lines = readFileSync(this.path, "utf8").split("\n");
    const out: T[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      const line = lines[i]!.trim();
      if (!line) continue;
      try {
        const v = parse(JSON.parse(line));
        if (v !== undefined) out.push(v);
      } catch {
        // a torn or hand-edited line; skip it
      }
    }
    return out;
  }
}

export class DecisionLog {
  private readonly file: JsonlFile<Decision>;

  constructor(
    logDir: string,
    private readonly echo = true,
  ) {
    this.file = new JsonlFile(resolve(logDir, "decisions.jsonl"));
  }

  /** Validates, stamps the time if missing, appends and echoes one line to stdout. */
  write(d: Omit<Decision, "ts"> & { ts?: string }, opts: { quiet?: boolean } = {}): Decision {
    const line = Decision.parse({ ts: new Date().toISOString(), ...d, summary: d.summary?.slice(0, 280), reason: d.reason?.slice(0, 280) });
    this.file.append(line);
    if (this.echo && !opts.quiet) {
      const parts = [line.outcome.toUpperCase().padEnd(8), line.stage.padEnd(10), line.summary ?? line.action ?? "", line.reason ? `(${line.reason})` : "", line.tx ?? ""];
      console.log(`  ${parts.filter(Boolean).join(" ")}`);
    }
    return line;
  }

  readNewest(limit = 100): Decision[] {
    return this.file.readNewest(limit, (v) => {
      const r = Decision.safeParse(v);
      return r.success ? r.data : undefined;
    });
  }
}
