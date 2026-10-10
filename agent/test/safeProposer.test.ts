import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SafeTransactionData } from "@safe-global/types-kit";
import { decodeFunctionData, getAddress, hashTypedData, recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { erc20Abi, planModuleAbi, vaultAbi } from "../src/abis.ts";
import type { Deployment } from "../src/config.ts";
import { JsonlFile } from "../src/log.ts";
import { refFor } from "../src/exec/refs.ts";
import { ProposalWriter, queueChangeTx, safeTxsFor, SafeProposer, type MetaTx, type Proposal, type ProposalApi, type SafeTxSigner } from "../src/exec/safeProposer.ts";

const agent = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"); // anvil #5, public
const a = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const dep: Deployment = {
  network: "base-sepolia",
  chainId: 84532,
  region: "HK",
  contracts: { Safe: a(0x5afe), PlanModule: a(1), SignalAttestor: a(2), MockUSD: a(3), MockSignalCover: a(4), FlowCreditLine: a(5), PaymentRouter: a(6), MockMMFVault: a(7), EvidenceRegistry: a(8) },
};

const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

/** Stands in for protocol-kit: a single-call SafeTx v1.4.1, EIP-712 signed by the agent (delegate) key. */
const signer: SafeTxSigner = {
  sender: agent.address,
  async build(txs: MetaTx[], nonce: string) {
    const t = txs[0]!;
    const zero = a(0);
    const data: SafeTransactionData = { to: t.to, value: "0", data: t.data, operation: 0, safeTxGas: "0", baseGas: "0", gasPrice: "0", gasToken: zero, refundReceiver: zero, nonce: Number(nonce) };
    const message = { ...data, value: 0n, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, nonce: BigInt(nonce), to: t.to, data: t.data, gasToken: zero, refundReceiver: zero };
    const typed = { domain: { chainId: dep.chainId, verifyingContract: dep.contracts.Safe }, types: SAFE_TX_TYPES, primaryType: "SafeTx" as const, message };
    return { data, safeTxHash: hashTypedData(typed), signature: await agent.signTypedData(typed) };
  },
};

class FakeApi implements ProposalApi {
  proposals: Parameters<ProposalApi["proposeTransaction"]>[0][] = [];
  nonce = 7;
  fail = false;
  async getNextNonce() {
    return String(this.nonce);
  }
  async proposeTransaction(p: Parameters<ProposalApi["proposeTransaction"]>[0]) {
    if (this.fail) throw new Error("401 Unauthorized");
    this.proposals.push(p);
    this.nonce++;
  }
}

const pay = { type: "pay" as const, plan: "base" as const, payee: a(0xb2), amount: "6200", ref: "WO-9001" };

describe("SafeProposer", () => {
  it("proposes the token transfer as the agent (delegate), with the service's next nonce and a signature that recovers to the agent", async () => {
    const api = new FakeApi();
    const r = await new SafeProposer(dep.contracts.Safe, api, signer).propose(safeTxsFor(dep, pay));
    const sent = api.proposals[0]!;
    expect(r).toMatchObject({ nonce: "7" });
    expect(sent).toMatchObject({ safeAddress: dep.contracts.Safe, senderAddress: agent.address, safeTxHash: r.safeTxHash });
    expect(sent.safeTransactionData).toMatchObject({ to: dep.contracts.MockUSD, nonce: 7 });
    expect(decodeFunctionData({ abi: erc20Abi, data: sent.safeTransactionData.data as Hex })).toEqual({ functionName: "transfer", args: [pay.payee, 6_200_000_000n] });
    const zero = a(0);
    const recovered = await recoverTypedDataAddress({
      domain: { chainId: dep.chainId, verifyingContract: dep.contracts.Safe },
      types: SAFE_TX_TYPES,
      primaryType: "SafeTx",
      message: { to: dep.contracts.MockUSD, value: 0n, data: sent.safeTransactionData.data as Hex, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: zero, refundReceiver: zero, nonce: 7n },
      signature: sent.senderSignature as Hex,
    });
    expect(recovered).toBe(agent.address);
  });

  it("lines up consecutive proposals on increasing nonces", async () => {
    const api = new FakeApi();
    const p = new SafeProposer(dep.contracts.Safe, api, signer);
    await p.propose(safeTxsFor(dep, pay));
    await p.propose(safeTxsFor(dep, { ...pay, ref: "WO-9002" }));
    expect(api.proposals.map((x) => x.safeTransactionData.nonce)).toEqual([7, 8]);
  });
});

describe("Safe transactions for the owners", () => {
  it("vault actions keep the Safe as receiver and owner", () => {
    const [w] = safeTxsFor(dep, { type: "vault_withdraw", plan: "base", amount: "100", ref: "x" });
    expect(decodeFunctionData({ abi: vaultAbi, data: w!.data })).toEqual({ functionName: "withdraw", args: [100_000_000n, dep.contracts.Safe, dep.contracts.Safe] });
    const d = safeTxsFor(dep, { type: "vault_deposit", plan: "base", amount: "5", ref: "x" });
    expect(d.map((t) => t.to)).toEqual([dep.contracts.MockUSD, dep.contracts.MockMMFVault]);
  });

  it("a plan change goes through PlanModule.queueChange (the 24 h timelock)", () => {
    const t = queueChangeTx(dep, { fn: "setPayee", payee: a(0xc1), planMask: 1 });
    expect(t.to).toBe(dep.contracts.PlanModule);
    const outer = decodeFunctionData({ abi: planModuleAbi, data: t.data });
    expect(outer.functionName).toBe("queueChange");
    expect(decodeFunctionData({ abi: planModuleAbi, data: outer.args![0] as Hex })).toEqual({ functionName: "setPayee", args: [a(0xc1), 1] });
  });
});

describe("ProposalWriter", () => {
  const file = () => new JsonlFile<Proposal>(join(mkdtempSync(join(tmpdir(), "s8-prop-")), "proposals.jsonl"));
  const lines = (f: JsonlFile<Proposal>) => readFileSync(f.path, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Proposal);

  it("on anvil only logs the proposal", async () => {
    const f = file();
    const r = await new ProposalWriter(dep, f, true).write("in", "OverPerTxCap", [pay]);
    expect(r.note).toMatch(/local chain/);
    expect(lines(f)[0]).toMatchObject({ status: "logged", reason: "OverPerTxCap", safeTxs: [{ to: dep.contracts.MockUSD }] });
  });

  it("on base-sepolia without SAFE_API_KEY logs and says so", async () => {
    expect((await new ProposalWriter(dep, file(), false).write("in", "r", [pay])).note).toMatch(/SAFE_API_KEY not set/);
  });

  it("with a proposer, records the safeTxHash; on a service error keeps the logged fallback", async () => {
    const api = new FakeApi();
    const f = file();
    const w = new ProposalWriter(dep, f, false, new SafeProposer(dep.contracts.Safe, api, signer));
    expect((await w.write("in", "r", [pay])).note).toMatch(/proposed to the Safe as delegate/);
    api.fail = true;
    expect((await w.write("in", "r", [pay])).note).toMatch(/Service error, logged only/);
    expect(lines(f).map((p) => p.status)).toEqual(["proposed", "service-error"]);
    expect(lines(f)[0]!.safeTxHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("remembers proposed payment refs per PlanModule, across restarts", async () => {
    const f = file();
    await new ProposalWriter(dep, f, true).write("in", "OverPerTxCap", [pay]);
    const ref = refFor(pay).toLowerCase();
    expect(new ProposalWriter(dep, f, true).proposedRefs().has(ref)).toBe(true);
    const redeployed = { ...dep, contracts: { ...dep.contracts, PlanModule: a(0xfe) } };
    expect(new ProposalWriter(redeployed, f, true).proposedRefs().has(ref)).toBe(false);
  });
});
