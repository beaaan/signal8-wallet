// Re-signing the plan book on-chain after a wording-only change. Spec: docs/specs/plans.md#hash
//
// npm run plan:rehash -- <plan-book.json>      (reads PlanModule on NETWORK / RPC_URL from ../.env)
//
// Both plans store the plan book's hash, so editing its summary or citations changes what the owners must sign even
// when no number changes. This prints the Safe transactions for the owners: first PlanModule.queueChange(setPlan(...))
// for both plans, then, after the 24 h delay, the matching applyChange calls. It signs and sends nothing, and it
// refuses when a cap, an action, the daily ceiling or a payee's plans would change: that is a limit change, which
// the owners approve separately.

import { encodeFunctionData, type Hex } from "viem";
import { planModuleAbi } from "./abis.ts";
import { connect, readPlan } from "./chain.ts";
import { loadConfig, loadDeployment, type Deployment } from "./config.ts";
import type { MetaTx } from "./exec/safeProposer.ts";
import { isMain } from "./isMain.ts";
import { loadPlanBook, PLAN_ID, toChainParams, type ChainPlan } from "./plan.ts";
import type { PlanState } from "./policy/localCheck.ts";
import type { PlanBook } from "./types.ts";

/** What PlanModule holds now, as far as the plan book covers it. */
export interface OnChainPlanBook {
  plans: { base: PlanState; storm: PlanState };
  dailyCeiling: bigint;
  /** payeePlans(address) for every payee in the new plan book (lowercased address → mask). */
  payeePlans: Record<string, number>;
}

export interface Rehash {
  planHash: Hex;
  /** Owners sign these first. */
  queue: MetaTx[];
  /** Owners sign these once PlanModule's delay has passed. */
  apply: MetaTx[];
}

/** Every number or permission that would differ on-chain if this plan book were signed. */
export function limitChanges(book: PlanBook, now: OnChainPlanBook): string[] {
  const want = toChainParams(book);
  const out: string[] = [];
  for (const name of ["base", "storm"] as const) {
    const w = want.plans[name];
    const n = now.plans[name];
    for (const k of ["perTxCap", "dailyCap", "creditCapPerEvent", "actions", "active"] as const) {
      if (w[k] !== n[k]) out.push(`${name}.${k}: on-chain ${n[k]}, plan book ${w[k]}`);
    }
  }
  if (want.dailyCeiling !== now.dailyCeiling) out.push(`dailyCeiling: on-chain ${now.dailyCeiling}, plan book ${want.dailyCeiling}`);
  for (const p of want.payees) {
    const n = now.payeePlans[p.address.toLowerCase()] ?? 0;
    if (n !== p.planMask) out.push(`payee ${p.address}: on-chain plans ${n}, plan book ${p.planMask}`);
  }
  return out;
}

/** The queue and apply transactions that store a new plan book hash in both plans and change nothing else. */
export function rehashTxs(dep: Deployment, book: PlanBook, now: OnChainPlanBook): Rehash {
  const changes = limitChanges(book, now);
  if (changes.length) throw new Error(`the plan book changes limits, not just wording; the owners approve that separately:\n  ${changes.join("\n  ")}`);
  const params = toChainParams(book);
  if (now.plans.base.planHash.toLowerCase() === params.planHash.toLowerCase() && now.plans.storm.planHash.toLowerCase() === params.planHash.toLowerCase()) {
    throw new Error(`both plans already store ${params.planHash}; nothing to sign`);
  }
  const tx = (fn: "queueChange" | "applyChange", inner: Hex): MetaTx => ({
    to: dep.contracts.PlanModule,
    value: "0",
    data: encodeFunctionData({ abi: planModuleAbi, functionName: fn, args: [inner] }),
    operation: 0,
  });
  const setPlan = (name: "base" | "storm", p: ChainPlan) => encodeFunctionData({ abi: planModuleAbi, functionName: "setPlan", args: [PLAN_ID[name], p] });
  const inner = [setPlan("base", params.plans.base), setPlan("storm", params.plans.storm)];
  return { planHash: params.planHash, queue: inner.map((d) => tx("queueChange", d)), apply: inner.map((d) => tx("applyChange", d)) };
}

if (isMain(import.meta.url)) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: npm run plan:rehash -- <plan-book.json>");
    process.exit(1);
  }
  const cfg = loadConfig();
  const dep = loadDeployment(cfg.network);
  const c = connect(cfg, dep);
  const book = loadPlanBook(path);
  const module = { address: dep.contracts.PlanModule, abi: planModuleAbi } as const;
  const masks = await Promise.all(book.payees.map((p) => c.pub.readContract({ ...module, functionName: "payeePlans", args: [p.address] })));
  const now: OnChainPlanBook = {
    plans: { base: await readPlan(c, PLAN_ID.base), storm: await readPlan(c, PLAN_ID.storm) },
    dailyCeiling: await c.pub.readContract({ ...module, functionName: "dailyCeiling" }),
    payeePlans: Object.fromEntries(book.payees.map((p, i) => [p.address.toLowerCase(), masks[i]!])),
  };
  try {
    const r = rehashTxs(dep, book, now);
    console.log(JSON.stringify({ network: cfg.network, safe: dep.contracts.Safe, from: now.plans.base.planHash, ...r }, null, 2));
    console.error("Owners: sign the two queue transactions in Safe Wallet, then the two apply transactions after the 24 h delay.");
    console.error("Point the agent at this plan book only after both plans store the new hash.");
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
