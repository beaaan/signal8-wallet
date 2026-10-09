// Storm loop: the deterministic state machine from docs/specs/agent.md#storm-loopsstormts.
// Code decides the order; amounts come from simple, logged arithmetic. Every money movement goes through
// the ActionSink (executor → PlanModule) or becomes an owner proposal.
//
// | On                          | Do                                                                    |
// | level 1                     | compare local plan hash with on-chain planHash; 3-line owner summary   |
// | level 3 rising              | vault_withdraw to the storm buffer; hold supplier payments; anchor PRE_STORM |
// | storm starts                | cover_claim; re-run forecast                                          |
// | payday, storm               | pay each staff member (storm plan); credit_draw sized by forecast      |
// | payday, no storm            | one owner proposal for the whole payroll                              |
// | storm ends                  | held supplier payments → owner proposals; drafts (TODO drafts.ts)      |

import { readFileSync } from "node:fs";
import { formatUnits, keccak256, stringToBytes } from "viem";
import { z } from "zod";
import { PATHS } from "../config.ts";
import { fmt, units, type ActionSink, type PlainAction } from "../exec/executor.ts";
import { PAYROLL_PREFIX, withRun } from "../exec/refs.ts";
import type { DecisionLog } from "../log.ts";
import { canonicalJson } from "../plan.ts";
import type { Hex } from "../policy/localCheck.ts";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/) as unknown as z.ZodType<Hex>;

export const Payroll = z
  .object({
    business: z.string(),
    token: z.string(),
    payPeriod: z.string(),
    payday: z.string(),
    staff: z.array(z.object({ id: z.string(), name: z.string(), address, amount: z.string().regex(/^\d+(\.\d+)?$/) }).strict()).min(1),
  })
  .strict();
export type Payroll = z.infer<typeof Payroll>;

export function loadPayroll(path: string = PATHS.payroll): Payroll {
  return Payroll.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function payrollTotal(p: Payroll): bigint {
  return p.staff.reduce((sum, s) => sum + units(s.amount), 0n);
}

/**
 * First-iteration cash forecast (13 weeks) of the Safe's operating cash. The vault is the owner's reserve: in a storm
 * the plan draws the pre-approved credit rather than run the reserve down. The contract's credit cap always wins.
 */
export const FORECAST = {
  weeks: 13,
  weeklyOutflow: units("9000"), // rent, suppliers, utilities, wage accrual
  weeklyInflow: units("10000"),
  weeksDisrupted: 6, // closure and repairs after a Signal 8+ storm
  disruptedInflow: units("1000"),
  buffer: units("10000"), // never plan to go below this
};

/** Lowest projected balance and the credit needed to keep it above the buffer. */
export function forecast(cash: bigint, f: typeof FORECAST = FORECAST): { minBalance: bigint; need: bigint } {
  let balance = cash;
  let min = cash;
  for (let w = 0; w < f.weeks; w++) {
    balance += (w < f.weeksDisrupted ? f.disruptedInflow : f.weeklyInflow) - f.weeklyOutflow;
    if (balance < min) min = balance;
  }
  const need = f.buffer - min;
  return { minBalance: min, need: need > 0n ? need : 0n };
}

export interface StormChain {
  planHashes(): Promise<Hex[]>;
  balances(): Promise<{ safe: bigint; vault: bigint; creditDrawn: bigint; creditLimit: bigint }>;
  creditRoom(): Promise<bigint>; // creditCapPerEvent - drawnInEvent for the current event
}

export interface StormDeps {
  sink: ActionSink;
  log: DecisionLog;
  chain: StormChain;
  payroll: Payroll;
  localPlanHash: Hex;
  runId?: string;
  /** Cash the Safe should hold before the storm: payroll plus a margin. */
  stormBuffer?: bigint;
  names?: Map<string, string>;
}

const amt = (x: bigint) => formatUnits(x, 6);

export class StormLoop {
  level = 0;
  storm = false;
  braced = false;
  halted = false;
  private planChecked = false;
  /** Supplier payments scheduled during the storm window; held at Signal 3, proposed to the owners when it ends. */
  readonly held: PlainAction[] = [];

  constructor(private readonly d: StormDeps) {}

  private id(name: string): string {
    return withRun(name, this.d.runId);
  }

  schedule(actions: PlainAction[]): void {
    this.held.push(...actions);
  }

  private async checkPlan(input: string): Promise<void> {
    this.planChecked = true;
    const onchain = await this.d.chain.planHashes();
    const ok = onchain.every((h) => h.toLowerCase() === this.d.localPlanHash.toLowerCase());
    if (!ok) {
      this.halted = true;
      this.d.log.write({ input, stage: "localCheck", outcome: "refused", reason: "PlanHashMismatch", action: "plan_check", summary: "Local plan book does not match the signed on-chain plan; the agent will not act" });
    }
  }

  async onSignal(level: number, code: string, stormNow: boolean, sourceTime: Date): Promise<void> {
    const input = `storm:${code}`;
    const prev = this.level;
    this.level = level;
    if (level >= 1 && !this.planChecked) await this.checkPlan(input);
    if (this.halted) return;

    if (level === 1 && prev === 0) {
      const b = await this.d.chain.balances();
      this.d.log.write({
        input,
        stage: "owner",
        outcome: "executed",
        action: "notify",
        summary: `Signal 1: storm plan signed and matches (${this.d.localPlanHash.slice(0, 10)}…). Cash ${fmt(b.safe)} + vault ${fmt(b.vault)} mUSD. At Signal 3 I withdraw to the storm buffer and hold supplier payments.`,
      });
    }

    if (level >= 3 && prev < 3 && !this.braced) await this.brace(input, code, sourceTime, stormNow);

    if (stormNow && !this.storm) {
      this.storm = true;
      await this.d.sink.run({ type: "cover_claim", plan: "storm", ref: this.id("cover-claim") }, input);
      const b = await this.d.chain.balances();
      const f = forecast(b.safe);
      this.d.log.write({ input, stage: "planner", outcome: "executed", action: "forecast", summary: `Forecast re-run: lowest balance ${fmt(f.minBalance)} mUSD in 13 weeks, credit need ${fmt(f.need)}` });
    } else if (!stormNow && this.storm) {
      this.storm = false;
      await this.afterStorm(input);
    }
  }

  private async brace(input: string, code: string, sourceTime: Date, stormNow: boolean): Promise<void> {
    this.braced = true;
    const buffer = this.d.stormBuffer ?? payrollTotal(this.d.payroll) + units("2000");
    const b = await this.d.chain.balances();
    const short = buffer > b.safe ? buffer - b.safe : 0n;
    const withdraw = short < b.vault ? short : b.vault;
    if (withdraw > 0n) {
      await this.d.sink.run({ type: "vault_withdraw", plan: stormNow ? "storm" : "base", amount: amt(withdraw), ref: this.id("brace-withdraw") }, input);
    } else {
      console.log(`  (cash ${fmt(b.safe)} already covers the storm buffer ${fmt(buffer)}; no withdraw)`);
    }
    if (this.held.length) {
      this.d.log.write({ input, stage: "planner", outcome: "proposed", action: "hold", summary: `Holding ${this.held.length} scheduled supplier payment(s) until the storm passes` });
    }
    // The warning snapshot (and, in production, hashes of the owner's photos) — only the hash goes on-chain.
    const evidence = { kind: "PRE_STORM", signal: code, sourceTime: sourceTime.toISOString(), runId: this.d.runId ?? null, photos: [] as string[] };
    const hash = keccak256(stringToBytes(canonicalJson(evidence)));
    await this.d.sink.run({ type: "anchor", kind: "PRE_STORM", hash }, input);
  }

  async onPayday(): Promise<void> {
    const p = this.d.payroll;
    const input = `payday:${p.payPeriod}`;
    if (this.halted) return;
    const period = this.id(p.payPeriod);
    const pays: PlainAction[] = p.staff.map((s) => ({ type: "pay", plan: "storm", payee: s.address, amount: s.amount, ref: `${PAYROLL_PREFIX}${period}` }));
    if (!this.storm) {
      await this.d.sink.proposeBatch(
        "payroll on an ordinary day needs two owners (staff are storm-plan payees only)",
        pays.map((a) => ({ ...a, plan: "storm" }) as PlainAction),
        input,
        `Owner proposal: payroll ${p.payPeriod}, ${p.staff.length} staff, ${fmt(payrollTotal(p))} mUSD`,
      );
      return;
    }
    for (const a of pays) await this.d.sink.run(a, input);

    const b = await this.d.chain.balances();
    const f = forecast(b.safe);
    const room = await this.d.chain.creditRoom();
    const lineRoom = b.creditLimit > b.creditDrawn ? b.creditLimit - b.creditDrawn : 0n;
    let draw = f.need < room ? f.need : room;
    if (lineRoom < draw) draw = lineRoom;
    if (draw > 0n) {
      await this.d.sink.run({ type: "credit_draw", plan: "storm", amount: amt(draw), ref: this.id("credit-draw") }, input);
    } else {
      this.d.log.write({ input, stage: "planner", outcome: "refused", reason: f.need === 0n ? "forecast above buffer" : "OverCreditCap", action: "credit_draw", summary: "No credit draw" });
    }
  }

  private async afterStorm(input: string): Promise<void> {
    for (const a of this.held.splice(0)) {
      await this.d.sink.run({ type: "propose_to_owner", reason: "supplier payment held during the storm", action: a }, input);
    }
    // TODO(drafts.ts): insurance claim with the PRE_STORM evidence hash, and the deadline list.
    this.d.log.write({ input, stage: "owner", outcome: "proposed", action: "drafts", summary: "Storm over: insurance claim and deadline list to draft for the owner (drafts.ts not built yet)" });
  }
}
