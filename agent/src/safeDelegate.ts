// `npm run safe:delegate`: one Safe owner registers the agent as a *delegate* of the business Safe on the Safe
// Transaction Service, so the agent's owner proposals (over a cap, payee outside the plan, ordinary-day payroll) appear
// in Safe Wallet for two owners to sign. A delegate can propose but never sign or execute.
//
//   npm run safe:delegate -- --check                         # list the Safe's delegates (needs SAFE_API_KEY)
//   OWNER_PRIVATE_KEY=0x… npm run safe:delegate               # register the agent (needs SAFE_API_KEY)
//
// The owner key is read from the environment for this one command and used only to sign the delegate message
// (EIP-712, no transaction, no gas). It is never written anywhere, and no other module reads OWNER_PRIVATE_KEY.

import * as apiKit from "@safe-global/api-kit";
import { createWalletClient, getAddress, http, type Account, type Chain, type Hex, type Transport, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { addressOf, connect } from "./chain.ts";
import { loadConfig, loadDeployment, safeApiKey } from "./config.ts";
import { isMain } from "./isMain.ts";

const SafeApiKit = apiKit.default as unknown as typeof apiKit.default.default;

/** The part of SafeApiKit this command uses (injected in tests). */
export interface DelegateApi {
  getSafeDelegates(p: { safeAddress: string }): Promise<{ results: Array<{ delegate: string; delegator: string; label: string }> }>;
  addSafeDelegate(p: { safeAddress: string; delegateAddress: string; delegatorAddress: string; label: string; signer: WalletClient<Transport, Chain, Account> }): Promise<unknown>;
}

export const DELEGATE_LABEL = "Signal 8 Wallet agent (proposes only)";

export async function delegatesOf(api: DelegateApi, safe: Hex): Promise<Array<{ delegate: Hex; delegator: Hex; label: string }>> {
  const r = await api.getSafeDelegates({ safeAddress: getAddress(safe) });
  return r.results.map((d) => ({ delegate: getAddress(d.delegate), delegator: getAddress(d.delegator), label: d.label }));
}

/**
 * Registers `agent` as a delegate of `safe`, signed by `owner`. Refuses a signer that is not an owner (the service
 * would too, less clearly) and does nothing when the agent is already a delegate.
 */
export async function registerDelegate(
  api: DelegateApi,
  opts: { safe: Hex; agent: Hex; owners: Hex[]; signer: WalletClient<Transport, Chain, Account> },
): Promise<{ added: boolean; delegator: Hex }> {
  const delegator = getAddress(opts.signer.account.address);
  if (!opts.owners.some((o) => getAddress(o) === delegator)) throw new Error(`${delegator} is not an owner of the Safe ${opts.safe}`);
  if (getAddress(opts.agent) === delegator) throw new Error("the agent key must not be a Safe owner");
  const existing = await delegatesOf(api, opts.safe);
  if (existing.some((d) => d.delegate === getAddress(opts.agent))) return { added: false, delegator };
  await api.addSafeDelegate({ safeAddress: getAddress(opts.safe), delegateAddress: getAddress(opts.agent), delegatorAddress: delegator, label: DELEGATE_LABEL, signer: opts.signer });
  return { added: true, delegator };
}

const safeOwnersAbi = [{ type: "function", name: "getOwners", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] }] as const;

if (isMain(import.meta.url)) {
  const cfg = loadConfig();
  if (cfg.network !== "base-sepolia") throw new Error("safe:delegate is for NETWORK=base-sepolia (on anvil the stand-in Safe has no Transaction Service)");
  const apiKey = safeApiKey();
  if (!apiKey) throw new Error("SAFE_API_KEY is not set (developer.safe.global)");
  const dep = loadDeployment(cfg.network);
  const c = connect(cfg, dep);
  const safe = dep.contracts.Safe;
  const agent = addressOf(c, "agent");
  const api = new SafeApiKit({ chainId: BigInt(dep.chainId), apiKey }) as unknown as DelegateApi;
  if (process.argv.includes("--check")) {
    const ds = await delegatesOf(api, safe);
    console.log(ds.length ? ds.map((d) => `${d.delegate} (by ${d.delegator}) ${d.label}${d.delegate === getAddress(agent) ? "  ← the agent" : ""}`).join("\n") : "no delegates");
  } else {
    const key = process.env.OWNER_PRIVATE_KEY?.trim();
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("set OWNER_PRIVATE_KEY (one Safe owner's key, for this command only)");
    const signer = createWalletClient({ account: privateKeyToAccount(key as Hex), chain: baseSepolia, transport: http(cfg.rpcUrl) });
    const owners = (await c.pub.readContract({ address: safe, abi: safeOwnersAbi, functionName: "getOwners" })) as Hex[];
    const r = await registerDelegate(api, { safe, agent, owners, signer });
    console.log(r.added ? `Agent ${agent} is now a delegate of ${safe} (signed by owner ${r.delegator}).` : `Agent ${agent} is already a delegate of ${safe}.`);
  }
}
