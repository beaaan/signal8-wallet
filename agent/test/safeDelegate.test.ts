import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { describe, expect, it } from "vitest";
import { DELEGATE_LABEL, registerDelegate, type DelegateApi } from "../src/safeDelegate.ts";

const ownerKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // anvil dev key 1
const owner = privateKeyToAccount(ownerKey);
const signer = createWalletClient({ account: owner, chain: baseSepolia, transport: http("http://127.0.0.1:1") });
const safe = "0xB1b4169eA856a2Edb709AE0ee284ceee10E7b60E";
const agent = "0x531e8e4484f53Bd6ab88eBB17840627bE08dD952";

function fakeApi(delegates: string[] = []): DelegateApi & { added: unknown[] } {
  const added: unknown[] = [];
  return {
    added,
    getSafeDelegates: async () => ({ results: delegates.map((d) => ({ delegate: d, delegator: owner.address, label: "x" })) }),
    addSafeDelegate: async (p) => {
      added.push({ ...p, signer: p.signer.account.address });
    },
  };
}

describe("safe:delegate", () => {
  it("an owner registers the agent as a delegate, labelled as proposing only", async () => {
    const api = fakeApi();
    expect(await registerDelegate(api, { safe, agent, owners: [owner.address], signer })).toEqual({ added: true, delegator: owner.address });
    expect(api.added).toEqual([{ safeAddress: safe, delegateAddress: agent, delegatorAddress: owner.address, label: DELEGATE_LABEL, signer: owner.address }]);
  });

  it("does nothing when the agent is already a delegate", async () => {
    const api = fakeApi([agent.toLowerCase()]);
    expect(await registerDelegate(api, { safe, agent, owners: [owner.address], signer })).toMatchObject({ added: false });
    expect(api.added).toEqual([]);
  });

  it("refuses a key that is not an owner, and an agent that is an owner", async () => {
    await expect(registerDelegate(fakeApi(), { safe, agent, owners: [agent], signer })).rejects.toThrow("is not an owner");
    await expect(registerDelegate(fakeApi(), { safe, agent: owner.address, owners: [owner.address], signer })).rejects.toThrow("must not be a Safe owner");
  });
});
