// Executor: Action → the typed PlanModule function, signed by the agent key. There is no generic call path.
// Spec: docs/specs/agent.md (executor table) and docs/specs/contracts.md#agent-functions
//
// Order per action: localCheck on a fresh snapshot → simulateContract → writeContract → receipt.
// Payments outside the active plan (over a cap, payee in another plan) and propose_to_owner become owner
// proposals: always written to agent/logs/proposals.jsonl and, on Base Sepolia with SAFE_API_KEY, proposed to the
// Safe Transaction Service by the agent as a delegate (safeProposer.ts). Nothing here ever calls the Safe directly.

import { resolve } from "node:path";
import { decodeEventLog } from "viem";
import { coverAbi, planModuleAbi } from "../abis.ts";
import { readSnapshot, revertReason, walletFor, type Chainish, type Wallet } from "../chain.ts";
import type { Ledger } from "../ledger.ts";
import { DecisionLog, JsonlFile } from "../log.ts";
import { localCheck, type Hex, type PlanCall, type Snapshot } from "../policy/localCheck.ts";
import { tokenSymbol } from "../token.ts";
import type { Action, Decision } from "../types.ts";
import { describe, fmt, toCall, type PlainAction } from "./calls.ts";
import { refFor } from "./refs.ts";
import { ProposalWriter, type PlanChange, type Proposal, type SafeProposer } from "./safeProposer.ts";

export { describe, fmt, plain, toCall, TOKEN_DECIMALS, units, type PlainAction } from "./calls.ts";
export { tokenSymbol } from "../token.ts";

export interface ExecResult {
  outcome: Decision["outcome"];
  stage: Decision["stage"];
  reason?: string;
  tx?: Hex;
  summary: string;
  /** cover_claim: the payout the cover sent to the Safe (from its Claimed event). */
  payout?: bigint;
}

/** What the pipeline and the loops hand actions to. Tests use a fake. */
export interface ActionSink {
  run(action: Action, input: string): Promise<ExecResult>;
  /** Several payments as one owner proposal (e.g. ordinary-day payroll as one Safe batch). */
  proposeBatch(reason: string, actions: PlainAction[], input: string, summary: string): Promise<ExecResult>;
}

export interface ExecutorOptions {
  names?: Map<string, string>;
  onTx?: (label: string, tx: Hex) => void;
  /** Base Sepolia with SAFE_API_KEY: proposals also go to the Safe Transaction Service. */
  proposer?: SafeProposer;
  /** The day's ledger for end-of-day reconciliation. */
  ledger?: Ledger;
}

export class Executor implements ActionSink {
  private readonly wallet: Wallet;
  private readonly proposals: ProposalWriter;
  ledger?: Ledger;

  constructor(
    private readonly c: Chainish,
    private readonly log: DecisionLog,
    private readonly opts: ExecutorOptions = {},
  ) {
    this.wallet = walletFor(c, "agent");
    this.proposals = new ProposalWriter(c.dep, new JsonlFile<Proposal>(resolve(c.cfg.logDir, "proposals.jsonl")), c.cfg.local || c.cfg.fisco, opts.proposer);
    this.ledger = opts.ledger;
  }

  private record(input: string, action: Action, r: ExecResult): ExecResult {
    this.log.write({ input, stage: r.stage, outcome: r.outcome, reason: r.reason, tx: r.tx, action: action.type, summary: r.summary });
    // a reverted transaction is in the decision log, never in the run's transaction list (EVIDENCE.md)
    if (r.tx && r.outcome === "executed") this.opts.onTx?.(r.summary, r.tx);
    return r;
  }

  private async writeProposal(input: string, reason: string, actions: PlainAction[], change?: PlanChange): Promise<string> {
    return (await this.proposals.write(input, reason, actions, change)).note;
  }

  /** Already proposed to the owners against this PlanModule (see ProposalWriter.proposedRefs). */
  private proposed(a: PlainAction): boolean {
    return a.type === "pay" && this.proposals.proposedRefs().has(toRefHex(a));
  }

  async proposeBatch(reason: string, actions: PlainAction[], input: string, summary: string): Promise<ExecResult> {
    if (actions.length > 0 && actions.every((a) => this.proposed(a))) {
      const r: ExecResult = { outcome: "refused", stage: "owner", reason: "already proposed to the owners", summary };
      this.log.write({ input, stage: "owner", outcome: "refused", reason: r.reason, action: "propose_to_owner", summary });
      return r;
    }
    const note = await this.writeProposal(input, reason, actions);
    const r: ExecResult = { outcome: "proposed", stage: "owner", reason, summary: `${summary}; ${note}` };
    this.log.write({ input, stage: "owner", outcome: "proposed", reason, action: "propose_to_owner", summary: r.summary });
    return r;
  }

  /** A plan change (e.g. a new payee) for the owners to queue in PlanModule's 24 h timelock. */
  async proposePlanChange(change: PlanChange, input: string, reason: string): Promise<ExecResult> {
    const note = await this.writeProposal(input, reason, [], change);
    const what = change.fn === "setPayee" ? `setPayee(${change.payee}, mask ${change.planMask})` : `setDailyCeiling(${change.ceiling})`;
    const r: ExecResult = { outcome: "proposed", stage: "owner", reason, summary: `Owner proposal: queueChange ${what}; ${note}` };
    this.log.write({ input, stage: "owner", outcome: "proposed", reason, action: "plan_change", summary: r.summary });
    return r;
  }

  async run(action: Action, input: string): Promise<ExecResult> {
    const names = this.opts.names;
    if (action.type === "propose_to_owner") {
      const inner = action.action;
      if (inner.type === "pay") {
        const ref = toRefHex(inner);
        const snap = await readSnapshot(this.c, { payees: [inner.payee], refs: [ref] });
        if (!snap.payeePlans[inner.payee.toLowerCase()]) {
          return this.record(input, action, { outcome: "refused", stage: "localCheck", reason: "PayeeNotRegistered", summary: describe(action, names) });
        }
        if (snap.refUsed[ref]) return this.record(input, action, { outcome: "refused", stage: "localCheck", reason: "RefUsed", summary: describe(action, names) });
        if (this.proposed(inner)) {
          return this.record(input, action, { outcome: "refused", stage: "owner", reason: "already proposed to the owners", summary: describe(action, names) });
        }
      }
      const note = await this.writeProposal(input, action.reason, [inner]);
      return this.record(input, action, { outcome: "proposed", stage: "owner", reason: action.reason, summary: `${describe(action, names)}; ${note}` });
    }

    if (this.proposed(action)) {
      return this.record(input, action, { outcome: "refused", stage: "owner", reason: "already proposed to the owners", summary: describe(action, names) });
    }
    const call = toCall(action);
    const snap: Snapshot = await readSnapshot(this.c, {
      payees: call.fn === "pay" ? [call.to] : [],
      refs: "ref" in call ? [call.ref] : [],
    });
    const check = localCheck(call, snap);
    if (!check.ok) {
      const registered = call.fn === "pay" && (snap.payeePlans[call.to.toLowerCase()] ?? 0) !== 0;
      if (check.outsidePlan && registered) {
        const note = await this.writeProposal(input, check.error, [action]);
        return this.record(input, action, { outcome: "proposed", stage: "localCheck", reason: check.error, summary: `Owner proposal: ${describe(action, names)}; ${note}` });
      }
      return this.record(input, action, { outcome: "refused", stage: "localCheck", reason: check.error, summary: describe(action, names) });
    }

    try {
      const tx = await this.send(call);
      const receipt = await this.c.pub.waitForTransactionReceipt({ hash: tx });
      if (receipt.status !== "success") {
        return this.record(input, action, { outcome: "refused", stage: "chain", reason: "Reverted", tx, summary: describe(action, names) });
      }
      let summary = describe(action, names);
      let payout: bigint | undefined;
      if (action.type === "cover_claim") {
        // PlanModule's Executed event carries amount 0 for a claim; the cover's Claimed event has the payout.
        for (const l of receipt.logs) {
          if (l.address.toLowerCase() !== this.c.dep.contracts.MockSignalCover.toLowerCase()) continue;
          try {
            const ev = decodeEventLog({ abi: coverAbi, data: l.data, topics: l.topics });
            if (ev.eventName === "Claimed") payout = ev.args.payout;
          } catch {
            // not Claimed
          }
        }
        if (payout !== undefined) summary = `Claimed the typhoon cover: ${fmt(payout)} ${tokenSymbol()} paid to the Safe (storm plan)`;
      }
      this.recordLedger(action, call, tx, payout);
      return this.record(input, action, { outcome: "executed", stage: "chain", tx, summary, payout });
    } catch (err) {
      return this.record(input, action, { outcome: "refused", stage: "chain", reason: revertReason(err), summary: describe(action, names) });
    }
  }

  private recordLedger(action: PlainAction, call: PlanCall, tx: Hex, payout?: bigint): void {
    const ref = "ref" in action ? action.ref : undefined;
    if (!this.ledger || call.fn === "anchor" || call.fn === "claimCover") {
      if (this.ledger && call.fn === "claimCover") this.ledger.record({ kind: "cover_claim", amount: payout ?? 0n, safeDelta: payout ?? 0n, vaultDelta: 0n, ref, tx });
      return;
    }
    const a = call.amount;
    // [Safe, vault, outstanding credit]; a draw is borrowing (debt), not income
    const effect: Record<Exclude<PlanCall["fn"], "anchor" | "claimCover">, [bigint, bigint, bigint]> = {
      pay: [-a, 0n, 0n],
      vaultDeposit: [-a, a, 0n],
      vaultWithdraw: [a, -a, 0n],
      creditDraw: [a, 0n, a],
    };
    const [safeDelta, vaultDelta, debtDelta] = effect[call.fn];
    const pay = call.fn === "pay" ? { planId: call.planId, payee: call.to } : {};
    this.ledger.record({ kind: action.type as "pay", amount: a, ...pay, safeDelta, vaultDelta, ...(debtDelta ? { debtDelta } : {}), ref, tx });
  }

  /** The agent stops itself (end-of-day reconciliation failed). Allowed by PlanModule for the agent key. */
  async pause(): Promise<Hex> {
    const { request } = await this.c.pub.simulateContract({ address: this.c.dep.contracts.PlanModule, abi: planModuleAbi, functionName: "pause", account: this.wallet.account });
    const tx = await this.wallet.writeContract(request);
    await this.c.pub.waitForTransactionReceipt({ hash: tx });
    return tx;
  }

  /** simulateContract first (a revert surfaces its custom error name), then send from the agent key. */
  private async send(call: PlanCall): Promise<Hex> {
    const base = { address: this.c.dep.contracts.PlanModule, abi: planModuleAbi, account: this.wallet.account } as const;
    const sim = this.c.pub;
    const w = this.wallet;
    switch (call.fn) {
      case "pay":
        return w.writeContract((await sim.simulateContract({ ...base, functionName: "pay", args: [call.planId, call.to, call.amount, call.ref] })).request);
      case "vaultDeposit":
        return w.writeContract((await sim.simulateContract({ ...base, functionName: "vaultDeposit", args: [call.planId, call.amount, call.ref] })).request);
      case "vaultWithdraw":
        return w.writeContract((await sim.simulateContract({ ...base, functionName: "vaultWithdraw", args: [call.planId, call.amount, call.ref] })).request);
      case "creditDraw":
        return w.writeContract((await sim.simulateContract({ ...base, functionName: "creditDraw", args: [call.amount, call.ref] })).request);
      case "claimCover":
        return w.writeContract((await sim.simulateContract({ ...base, functionName: "claimCover", args: [call.ref] })).request);
      case "anchor":
        return w.writeContract((await sim.simulateContract({ ...base, functionName: "anchor", args: [call.hash, call.kind] })).request);
    }
  }
}

function toRefHex(a: Extract<PlainAction, { type: "pay" }>): Hex {
  return refFor(a).toLowerCase() as Hex;
}
