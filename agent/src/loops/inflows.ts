// Inflow matching: PaymentRouter Inflow events since the last checkpoint, matched to open receivables.
// Spec: docs/specs/agent.md#everyday-loopseverydayts (step 1).
//
// invoiceRef = keccak256(invoiceId) for live payments, keccak256(invoiceId#runId) in replays. A payment that matches
// an open receivable exactly is logged; a short payment, an overpayment or an unknown ref is flagged for the owner
// (stage owner, outcome proposed). Nothing here moves money. Partial payments add up across events.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { keccak256, toBytes } from "viem";
import { z } from "zod";
import { paymentRouterAbi } from "../abis.ts";
import type { Chainish } from "../chain.ts";
import { PATHS } from "../config.ts";
import { FISCO_LOG_RANGE } from "../fisco.ts";
import { fmt, units } from "../exec/calls.ts";
import { withRun } from "../exec/refs.ts";
import type { Ledger } from "../ledger.ts";
import type { DecisionLog } from "../log.ts";
import type { Hex } from "../policy/localCheck.ts";
import { tokenSymbol } from "../token.ts";

export const Receivables = z.object({
  note: z.string().optional(),
  receivables: z.array(z.object({ id: z.string().min(1), customer: z.string(), amount: z.string().regex(/^\d+(\.\d+)?$/), due: z.string().optional() }).strict()),
});
export type Receivable = z.infer<typeof Receivables>["receivables"][number];

export function loadReceivables(path = PATHS.receivables): Receivable[] {
  return existsSync(path) ? Receivables.parse(JSON.parse(readFileSync(path, "utf8"))).receivables : [];
}

export interface InflowEvent {
  invoiceRef: Hex;
  amount: bigint;
  swept: bigint; // sent on to FlowCreditLine.repay(); the Safe received amount - swept
  tx: Hex;
  block: bigint;
}

/** Where Inflow events come from. Tests use a fake. */
export interface InflowSource {
  latestBlock(): Promise<bigint>;
  inflows(fromBlock: bigint, toBlock: bigint): Promise<InflowEvent[]>;
}

/** Blocks per eth_getLogs call. */
const LOG_RANGE = 200n;

export function chainInflows(c: Chainish): InflowSource {
  // FISCO v3.16.3 silently answers only the first 10 blocks of a longer range (fisco.ts FISCO_LOG_RANGE)
  const range = c.cfg.fisco ? FISCO_LOG_RANGE : LOG_RANGE;
  return {
    latestBlock: () => c.pub.getBlockNumber({ cacheTime: 0 }),
    async inflows(fromBlock, toBlock) {
      const out: InflowEvent[] = [];
      // public Base Sepolia RPCs cap eth_getLogs at 200 blocks, and a checkpoint can be hours old
      for (let from = fromBlock; from <= toBlock; from += range) {
        const to = from + range - 1n < toBlock ? from + range - 1n : toBlock;
        const logs = await c.pub.getContractEvents({ address: c.dep.contracts.PaymentRouter, abi: paymentRouterAbi, eventName: "Inflow", fromBlock: from, toBlock: to });
        out.push(...logs.map((l) => ({ invoiceRef: l.args.invoiceRef!, amount: l.args.amount!, swept: l.args.swept!, tx: l.transactionHash!, block: l.blockNumber! })));
      }
      return out;
    },
  };
}

export type MatchKind = "matched" | "short" | "over" | "unmatched";

export interface InflowMatch {
  kind: MatchKind;
  event: InflowEvent;
  receivable?: Receivable;
  /** Total received for this receivable so far, including this event. */
  received?: bigint;
}

/** Matches events in order; `paid` (receivable id → received so far) is updated in place. */
export function matchInflows(events: InflowEvent[], receivables: Receivable[], paid: Map<string, bigint>, runId?: string): InflowMatch[] {
  const byRef = new Map<string, Receivable>();
  for (const r of receivables) {
    byRef.set(keccak256(toBytes(r.id)).toLowerCase(), r);
    if (runId) byRef.set(keccak256(toBytes(withRun(r.id, runId))).toLowerCase(), r);
  }
  return events.map((event) => {
    const receivable = byRef.get(event.invoiceRef.toLowerCase());
    if (!receivable) return { kind: "unmatched", event };
    const received = (paid.get(receivable.id) ?? 0n) + event.amount;
    paid.set(receivable.id, received);
    const due = units(receivable.amount);
    const kind: MatchKind = received === due ? "matched" : received < due ? "short" : "over";
    return { kind, event, receivable, received };
  });
}

interface Checkpoint {
  block: string;
  paid: Record<string, string>;
}

export interface InflowWatcherOptions {
  source: InflowSource;
  log: DecisionLog;
  receivables: Receivable[];
  checkpointFile: string;
  /** Used when there is no checkpoint yet (the deployment's startBlock, or the block a replay started at). */
  fromBlock: bigint;
  runId?: string;
}

/** Reads new Inflow events, logs each match or flag, and moves the checkpoint forward. */
export class InflowWatcher {
  constructor(private readonly o: InflowWatcherOptions) {}

  private load(): { from: bigint; paid: Map<string, bigint> } {
    try {
      const cp = JSON.parse(readFileSync(this.o.checkpointFile, "utf8")) as Checkpoint;
      return { from: BigInt(cp.block) + 1n, paid: new Map(Object.entries(cp.paid ?? {}).map(([k, v]) => [k, BigInt(v)])) };
    } catch {
      return { from: this.o.fromBlock, paid: new Map() };
    }
  }

  private save(block: bigint, paid: Map<string, bigint>): void {
    mkdirSync(dirname(this.o.checkpointFile), { recursive: true });
    const cp: Checkpoint = { block: block.toString(), paid: Object.fromEntries([...paid].map(([k, v]) => [k, v.toString()])) };
    writeFileSync(this.o.checkpointFile, `${JSON.stringify(cp, null, 2)}\n`);
  }

  /** With a ledger, each inflow is also recorded for the day's reconciliation (the Safe gets amount - swept). */
  async poll(ledger?: Ledger): Promise<InflowMatch[]> {
    const { from, paid } = this.load();
    const to = await this.o.source.latestBlock();
    if (to < from) return [];
    const events = await this.o.source.inflows(from, to);
    const matches = matchInflows(events, this.o.receivables, paid, this.o.runId);
    for (const m of matches) {
      this.report(m);
      ledger?.record({ kind: "inflow", amount: m.event.amount, safeDelta: m.event.amount - m.event.swept, vaultDelta: 0n, tx: m.event.tx, note: m.receivable?.id });
    }
    this.save(to, paid);
    return matches;
  }

  private report(m: InflowMatch): void {
    const e = m.event;
    const swept = e.swept > 0n ? `, ${fmt(e.swept)} swept to the credit line` : "";
    const input = `inflow:${m.receivable?.id ?? e.invoiceRef.slice(0, 18)}`;
    const r = m.receivable;
    const t = tokenSymbol();
    if (m.kind === "matched") {
      this.o.log.write({ input, stage: "chain", outcome: "executed", action: "inflow", tx: e.tx, summary: `Customer payment matched: ${r!.id} from ${r!.customer}, ${fmt(e.amount)} ${t}${swept}` });
      return;
    }
    const why =
      m.kind === "unmatched"
        ? { reason: "UnmatchedInflow", summary: `Customer payment of ${fmt(e.amount)} ${t} with an unknown invoice ref ${e.invoiceRef.slice(0, 10)}…; owner to identify it${swept}` }
        : m.kind === "short"
          ? { reason: "ShortPayment", summary: `${r!.id} from ${r!.customer}: received ${fmt(m.received!)} of ${fmt(units(r!.amount))} ${t}; owner to follow up${swept}` }
          : { reason: "Overpayment", summary: `${r!.id} from ${r!.customer}: received ${fmt(m.received!)} for ${fmt(units(r!.amount))} ${t} due; owner to refund or credit the difference${swept}` };
    this.o.log.write({ input, stage: "owner", outcome: "proposed", action: "inflow_flag", tx: e.tx, ...why });
  }
}

export function inflowCheckpointPath(stateDir: string, network: string): string {
  return resolve(stateDir, `inflows-${network}.json`);
}
