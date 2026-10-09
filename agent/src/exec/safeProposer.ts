// Owner proposals through the Safe Transaction Service. The agent is a Safe *delegate*: it may propose a Safe
// transaction (signing the safeTxHash), but it is not an owner, so two human owners must still sign in Safe Wallet.
// Spec: docs/specs/agent.md#trust-boundaries (5), docs/specs/contracts.md#business-safe
//
// The service client and the signer are injected, so this is unit-tested with fakes (test/safeProposer.test.ts).
// The live adapters at the bottom use @safe-global/api-kit and @safe-global/protocol-kit; they need SAFE_API_KEY
// and a real Safe on Base Sepolia, and are not exercised in tests or on anvil.

import * as apiKit from "@safe-global/api-kit";
import * as protocolKit from "@safe-global/protocol-kit";
import { OperationType, type MetaTransactionData, type SafeTransactionData } from "@safe-global/types-kit";
import { encodeFunctionData, type Hex } from "viem";
import { coverAbi, creditLineAbi, erc20Abi, evidenceRegistryAbi, planModuleAbi, vaultAbi } from "../abis.ts";
import type { Deployment } from "../config.ts";
import { JsonlFile } from "../log.ts";
import { toCall, units, type PlainAction } from "./calls.ts";

// Under NodeNext the kits' .d.ts files read as CommonJS, so the types see a double default; at runtime the ESM
// build's default export is the class itself.
const SafeApiKit = apiKit.default as unknown as typeof apiKit.default.default;
const Safe = protocolKit.default as unknown as typeof protocolKit.default.default;

/** One call the Safe would make (operation 0 = CALL). */
export interface MetaTx {
  to: Hex;
  value: "0";
  data: Hex;
  operation: 0;
}

/** The part of SafeApiKit the proposer uses. */
export interface ProposalApi {
  getNextNonce(safeAddress: string): Promise<string>;
  proposeTransaction(p: { safeAddress: string; safeTransactionData: SafeTransactionData; safeTxHash: string; senderAddress: string; senderSignature: string; origin?: string }): Promise<void>;
}

/** Builds the Safe transaction for given calls and nonce, and signs its hash with the agent (delegate) key. */
export interface SafeTxSigner {
  readonly sender: Hex;
  build(txs: MetaTx[], nonce: string): Promise<{ data: SafeTransactionData; safeTxHash: Hex; signature: Hex }>;
}

export interface ProposalReceipt {
  safeTxHash: Hex;
  nonce: string;
}

export class SafeProposer {
  constructor(
    readonly safeAddress: Hex,
    private readonly api: ProposalApi,
    private readonly signer: SafeTxSigner,
    private readonly origin = "Signal 8 Wallet agent (delegate proposal)",
  ) {}

  async propose(txs: MetaTx[]): Promise<ProposalReceipt> {
    if (txs.length === 0) throw new Error("nothing to propose");
    // The service's next nonce counts queued proposals too, so several proposals line up instead of replacing each other.
    const nonce = await this.api.getNextNonce(this.safeAddress);
    const { data, safeTxHash, signature } = await this.signer.build(txs, nonce);
    await this.api.proposeTransaction({
      safeAddress: this.safeAddress,
      safeTransactionData: data,
      safeTxHash,
      senderAddress: this.signer.sender,
      senderSignature: signature,
      origin: this.origin,
    });
    return { safeTxHash, nonce };
  }
}

/**
 * The Safe transactions the owners sign for an action outside the plan. The owners act on the Safe directly
 * (they cannot call PlanModule's agent functions), so each action becomes the plain call PlanModule would have made.
 */
export function safeTxsFor(dep: Deployment, a: PlainAction): MetaTx[] {
  const { MockUSD, MockMMFVault, FlowCreditLine, MockSignalCover, EvidenceRegistry, Safe: safe } = dep.contracts;
  const tx = (to: Hex, data: Hex): MetaTx => ({ to, value: "0", data, operation: 0 });
  switch (a.type) {
    case "pay":
      return [tx(MockUSD, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [a.payee, units(a.amount)] }))];
    case "vault_deposit":
      return [
        tx(MockUSD, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [MockMMFVault, units(a.amount)] })),
        tx(MockMMFVault, encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [units(a.amount), safe] })),
      ];
    case "vault_withdraw":
      return [tx(MockMMFVault, encodeFunctionData({ abi: vaultAbi, functionName: "withdraw", args: [units(a.amount), safe, safe] }))];
    case "credit_draw":
      return [tx(FlowCreditLine, encodeFunctionData({ abi: creditLineAbi, functionName: "draw", args: [units(a.amount)] }))];
    case "cover_claim":
      return [tx(MockSignalCover, encodeFunctionData({ abi: coverAbi, functionName: "claim" }))];
    case "anchor": {
      const call = toCall(a);
      if (call.fn !== "anchor") throw new Error("unreachable");
      return [tx(EvidenceRegistry, encodeFunctionData({ abi: evidenceRegistryAbi, functionName: "anchor", args: [call.hash, call.kind] }))];
    }
  }
}

/** A plan change the owners queue in PlanModule's 24 h timelock: Safe → PlanModule.queueChange(abi.encodeCall(setter, args)). */
export type PlanChange = { fn: "setPayee"; payee: Hex; planMask: number } | { fn: "setDailyCeiling"; ceiling: string };

export function queueChangeTx(dep: Deployment, change: PlanChange): MetaTx {
  const inner =
    change.fn === "setPayee"
      ? encodeFunctionData({ abi: planModuleAbi, functionName: "setPayee", args: [change.payee, change.planMask] })
      : encodeFunctionData({ abi: planModuleAbi, functionName: "setDailyCeiling", args: [units(change.ceiling)] });
  return { to: dep.contracts.PlanModule, value: "0", data: encodeFunctionData({ abi: planModuleAbi, functionName: "queueChange", args: [inner] }), operation: 0 };
}

// ---- live adapters (Base Sepolia) ----

export function apiKitClient(chainId: number, apiKey: string): ProposalApi {
  return new SafeApiKit({ chainId: BigInt(chainId), apiKey });
}

/**
 * protocol-kit builds the SafeTx (MultiSend when there are several calls), computes the safeTxHash for this Safe's
 * version and chain, and signs it with the agent key. signHash does not require an owner, which is what a delegate needs.
 */
export async function protocolKitSigner(rpcUrl: string, agentKey: Hex, sender: Hex, safeAddress: Hex): Promise<SafeTxSigner> {
  const kit = await Safe.init({ provider: rpcUrl, signer: agentKey, safeAddress });
  return {
    sender,
    async build(txs, nonce) {
      const transactions: MetaTransactionData[] = txs.map((t) => ({ to: t.to, value: t.value, data: t.data, operation: OperationType.Call }));
      const safeTx = await kit.createTransaction({ transactions, options: { nonce: Number(nonce) } });
      const safeTxHash = (await kit.getTransactionHash(safeTx)) as Hex;
      const sig = await kit.signHash(safeTxHash);
      return { data: safeTx.data, safeTxHash, signature: sig.data as Hex };
    },
  };
}

/** Defers protocol-kit's Safe.init (it reads the chain) to the first proposal. */
export function lazySigner(sender: Hex, init: () => Promise<SafeTxSigner>): SafeTxSigner {
  let ready: Promise<SafeTxSigner> | undefined;
  return {
    sender,
    async build(txs, nonce) {
      ready ??= init();
      return (await ready).build(txs, nonce);
    },
  };
}

export interface Proposal {
  ts: string;
  input: string;
  reason: string;
  actions: PlainAction[];
  change?: PlanChange;
  /** The Safe transactions the owners would sign. */
  safeTxs: MetaTx[];
  /** logged: only in proposals.jsonl (anvil, or no SAFE_API_KEY); proposed: in the Safe Transaction Service. */
  status: "logged" | "proposed" | "service-error";
  safeTxHash?: Hex;
  nonce?: string;
  error?: string;
}

/**
 * Every owner proposal is appended to logs/proposals.jsonl. With a proposer (Base Sepolia + SAFE_API_KEY) it is also
 * proposed to the Safe Transaction Service; if that fails the proposal stays logged and the note says why.
 */
export class ProposalWriter {
  constructor(
    private readonly dep: Deployment,
    private readonly file: JsonlFile<Proposal>,
    private readonly local: boolean,
    private readonly proposer?: SafeProposer,
  ) {}

  async write(input: string, reason: string, actions: PlainAction[], change?: PlanChange): Promise<{ proposal: Proposal; note: string }> {
    const safeTxs = change ? [queueChangeTx(this.dep, change)] : actions.flatMap((a) => safeTxsFor(this.dep, a));
    const p: Proposal = { ts: new Date().toISOString(), input, reason, actions, change, safeTxs, status: "logged" };
    let note = this.local ? "logged for the owners (local chain)" : "logged only: SAFE_API_KEY not set";
    if (this.proposer) {
      try {
        const r = await this.proposer.propose(safeTxs);
        Object.assign(p, { status: "proposed", safeTxHash: r.safeTxHash, nonce: r.nonce });
        note = `proposed to the Safe as delegate, safeTxHash ${r.safeTxHash.slice(0, 10)}… nonce ${r.nonce}`;
      } catch (err) {
        p.status = "service-error";
        p.error = err instanceof Error ? err.message.slice(0, 200) : String(err);
        note = `Safe Transaction Service error, logged only (${p.error.slice(0, 60)})`;
      }
    }
    this.file.append(p);
    return { proposal: p, note };
  }
}
