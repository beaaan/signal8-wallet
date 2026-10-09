// Executor: Action → the typed PlanModule function, signed by the agent key. There is no generic call path.
// Spec: docs/specs/agent.md (executor table) and docs/specs/contracts.md#agent-functions
//
// Order per action: localCheck on a fresh snapshot → simulateContract → writeContract → receipt.
// Payments outside the active plan (over a cap, payee in another plan) and propose_to_owner become owner
// proposals in agent/logs/proposals.jsonl. Nothing here ever calls the Safe directly.

import { resolve } from "node:path";
import { encodeFunctionData, formatUnits, parseUnits, stringToHex } from "viem";
import { erc20Abi, planModuleAbi } from "../abis.ts";
import { readSnapshot, revertReason, walletFor, type Chainish, type Wallet } from "../chain.ts";
import { DecisionLog, JsonlFile } from "../log.ts";
import { PLAN_ID } from "../plan.ts";
import { localCheck, type Hex, type PlanCall, type Snapshot } from "../policy/localCheck.ts";
import type { Action, Decision } from "../types.ts";
import { refFor } from "./refs.ts";

export type PlainAction = Exclude<Action, { type: "propose_to_owner" }>;

export interface ExecResult {
  outcome: Decision["outcome"];
  stage: Decision["stage"];
  reason?: string;
  tx?: Hex;
  summary: string;
}

/** What the pipeline and the loops hand actions to. Tests use a fake. */
export interface ActionSink {
  run(action: Action, input: string): Promise<ExecResult>;
  /** Several payments as one owner proposal (e.g. ordinary-day payroll as one Safe batch). */
  proposeBatch(reason: string, actions: PlainAction[], input: string, summary: string): Promise<ExecResult>;
}

export interface Proposal {
  ts: string;
  input: string;
  reason: string;
  actions: PlainAction[];
  /** The Safe transactions the owners would sign (token transfers for payments). */
  safeTxs: Array<{ to: Hex; value: "0"; data: Hex; operation: 0 }>;
  status: "pending";
}

export const TOKEN_DECIMALS = 6;

export function units(amount: string): bigint {
  return parseUnits(amount, TOKEN_DECIMALS);
}

export function fmt(amount: bigint): string {
  return Number(formatUnits(amount, TOKEN_DECIMALS)).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function toCall(action: PlainAction): PlanCall {
  switch (action.type) {
    case "pay":
      return { fn: "pay", planId: PLAN_ID[action.plan], to: action.payee, amount: units(action.amount), ref: refFor(action) };
    case "vault_deposit":
      return { fn: "vaultDeposit", planId: PLAN_ID.base, amount: units(action.amount), ref: refFor(action) };
    case "vault_withdraw":
      return { fn: "vaultWithdraw", planId: PLAN_ID[action.plan], amount: units(action.amount), ref: refFor(action) };
    case "credit_draw":
      return { fn: "creditDraw", planId: 1, amount: units(action.amount), ref: refFor(action) };
    case "cover_claim":
      return { fn: "claimCover", planId: 1, ref: refFor(action) };
    case "anchor":
      return { fn: "anchor", hash: action.hash, kind: stringToHex(action.kind, { size: 32 }) };
  }
}

/** One plain-language line for the decision log. */
export function describe(action: Action, names: Map<string, string> = new Map()): string {
  const who = (a: Hex) => names.get(a.toLowerCase()) ?? a;
  switch (action.type) {
    case "pay":
      return `Pay ${action.amount} mUSD to ${who(action.payee)} under the ${action.plan} plan (${action.ref})`;
    case "vault_deposit":
      return `Move ${action.amount} mUSD of surplus into the money-market vault`;
    case "vault_withdraw":
      return `Withdraw ${action.amount} mUSD from the vault to the Safe (${action.plan} plan)`;
    case "credit_draw":
      return `Draw ${action.amount} mUSD of emergency credit (storm plan)`;
    case "cover_claim":
      return "Claim the typhoon cover payout (storm plan)";
    case "anchor":
      return `Anchor ${action.kind} evidence hash ${action.hash.slice(0, 10)}…`;
    case "propose_to_owner":
      return `Owner proposal: ${describe(action.action, names)}`;
  }
}

function proposalFor(c: Chainish | undefined, actions: PlainAction[]): Proposal["safeTxs"] {
  if (!c) return [];
  return actions.flatMap((a) =>
    a.type === "pay"
      ? [
          {
            to: c.dep.contracts.MockUSD,
            value: "0" as const,
            data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [a.payee, units(a.amount)] }),
            operation: 0 as const,
          },
        ]
      : [],
  );
}

export class Executor implements ActionSink {
  private readonly wallet: Wallet;
  private readonly proposals: JsonlFile<Proposal>;

  constructor(
    private readonly c: Chainish,
    private readonly log: DecisionLog,
    private readonly opts: { names?: Map<string, string>; onTx?: (label: string, tx: Hex) => void } = {},
  ) {
    this.wallet = walletFor(c, "agent");
    this.proposals = new JsonlFile(resolve(c.cfg.logDir, "proposals.jsonl"));
  }

  private record(input: string, action: Action, r: ExecResult): ExecResult {
    this.log.write({ input, stage: r.stage, outcome: r.outcome, reason: r.reason, tx: r.tx, action: action.type, summary: r.summary });
    if (r.tx) this.opts.onTx?.(r.summary, r.tx);
    return r;
  }

  private writeProposal(input: string, reason: string, actions: PlainAction[]): void {
    // TODO(base-sepolia): also send it with Safe API Kit proposeTransaction, signed by the agent as a Safe
    // delegate (never an owner), so the two human owners see it in Safe Wallet. Needs @safe-global/api-kit
    // and SAFE_API_KEY; until then the proposal is only written here for the dashboard.
    this.proposals.append({ ts: new Date().toISOString(), input, reason, actions, safeTxs: proposalFor(this.c, actions), status: "pending" });
  }

  async proposeBatch(reason: string, actions: PlainAction[], input: string, summary: string): Promise<ExecResult> {
    this.writeProposal(input, reason, actions);
    const r: ExecResult = { outcome: "proposed", stage: "owner", reason, summary };
    this.log.write({ input, stage: "owner", outcome: "proposed", reason, action: "propose_to_owner", summary });
    return r;
  }

  async run(action: Action, input: string): Promise<ExecResult> {
    const names = this.opts.names;
    if (action.type === "propose_to_owner") {
      const inner = action.action;
      if (inner.type === "pay") {
        const snap = await readSnapshot(this.c, { payees: [inner.payee] });
        if (!snap.payeePlans[inner.payee.toLowerCase()]) {
          return this.record(input, action, { outcome: "refused", stage: "localCheck", reason: "PayeeNotRegistered", summary: describe(action, names) });
        }
      }
      this.writeProposal(input, action.reason, [inner]);
      return this.record(input, action, { outcome: "proposed", stage: "owner", reason: action.reason, summary: describe(action, names) });
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
        this.writeProposal(input, check.error, [action]);
        return this.record(input, action, { outcome: "proposed", stage: "localCheck", reason: check.error, summary: `Owner proposal: ${describe(action, names)}` });
      }
      return this.record(input, action, { outcome: "refused", stage: "localCheck", reason: check.error, summary: describe(action, names) });
    }

    try {
      const tx = await this.send(call);
      const receipt = await this.c.pub.waitForTransactionReceipt({ hash: tx });
      if (receipt.status !== "success") {
        return this.record(input, action, { outcome: "refused", stage: "chain", reason: "Reverted", tx, summary: describe(action, names) });
      }
      return this.record(input, action, { outcome: "executed", stage: "chain", tx, summary: describe(action, names) });
    } catch (err) {
      return this.record(input, action, { outcome: "refused", stage: "chain", reason: revertReason(err), summary: describe(action, names) });
    }
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
