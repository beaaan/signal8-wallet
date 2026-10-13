import { decodeFunctionData, getAddress, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { planModuleAbi } from "../src/abis.ts";
import { PATHS, type Deployment } from "../src/config.ts";
import { loadPlanBook, planHash, toChainParams } from "../src/plan.ts";
import { limitChanges, rehashTxs, type OnChainPlanBook } from "../src/planUpdate.ts";

const a = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const dep: Deployment = {
  network: "base-sepolia",
  chainId: 84532,
  region: "HK",
  contracts: { Safe: a(0x5afe), PlanModule: a(1), SignalAttestor: a(2), MockUSD: a(3), MockSignalCover: a(4), FlowCreditLine: a(5), PaymentRouter: a(6), MockMMFVault: a(7), EvidenceRegistry: a(8) },
};
const book = loadPlanBook(PATHS.planBookExample);
const OLD: Hex = `0x${"11".repeat(32)}`;

/** PlanModule as deployed from an earlier wording of the same plan book: same numbers, old hash. */
function signedEarlier(): OnChainPlanBook {
  const p = toChainParams(book);
  return {
    plans: { base: { ...p.plans.base, planHash: OLD }, storm: { ...p.plans.storm, planHash: OLD } },
    dailyCeiling: p.dailyCeiling,
    payeePlans: Object.fromEntries(p.payees.map((x) => [x.address.toLowerCase(), x.planMask])),
  };
}

describe("plan:rehash", () => {
  it("queues then applies setPlan for both plans with the new hash and unchanged numbers", () => {
    const r = rehashTxs(dep, book, signedEarlier());
    expect(r.planHash).toBe(planHash(book));
    expect([...r.queue, ...r.apply].every((t) => t.to === dep.contracts.PlanModule && t.value === "0" && t.operation === 0)).toBe(true);
    const want = toChainParams(book);
    for (const [i, name] of (["base", "storm"] as const).entries()) {
      const q = decodeFunctionData({ abi: planModuleAbi, data: r.queue[i]!.data });
      const ap = decodeFunctionData({ abi: planModuleAbi, data: r.apply[i]!.data });
      expect(q.functionName).toBe("queueChange");
      expect(ap).toEqual({ functionName: "applyChange", args: q.args });
      const inner = decodeFunctionData({ abi: planModuleAbi, data: q.args![0] as Hex });
      expect(inner).toEqual({ functionName: "setPlan", args: [i, want.plans[name]] });
    }
  });

  it("refuses a plan book that changes a cap, the ceiling or a payee", () => {
    const now = signedEarlier();
    expect(limitChanges(book, now)).toEqual([]);
    now.plans.storm.dailyCap = 30_000_000_000n;
    now.dailyCeiling = 50_000_000_000n;
    now.payeePlans[book.payees[0]!.address.toLowerCase()] = 3;
    expect(limitChanges(book, now)).toEqual([
      "storm.dailyCap: on-chain 30000000000, plan book 25000000000",
      "dailyCeiling: on-chain 50000000000, plan book 40000000000",
      `payee ${book.payees[0]!.address}: on-chain plans 3, plan book 1`,
    ]);
    expect(() => rehashTxs(dep, book, now)).toThrow(/changes limits, not just wording/);
  });

  it("has nothing to sign when both plans already store the hash", () => {
    const now = signedEarlier();
    now.plans.base.planHash = now.plans.storm.planHash = planHash(book);
    expect(() => rehashTxs(dep, book, now)).toThrow(/already store/);
  });
});
