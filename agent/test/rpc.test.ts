import { createPublicClient, hexToBigInt, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { consistentTransport } from "../src/rpc.ts";

const ACCOUNT = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"); // anvil dev key 1

/** Two backends behind one URL: a fresh node at block 100 and a stale one at 95, answered alternately. */
function balancer() {
  const calls: { method: string; params?: unknown; node: string }[] = [];
  let turn = 0;
  const nodes = { fresh: 100n, stale: 95n };
  const base = async ({ method, params }: { method: string; params?: unknown }) => {
    const node = turn++ % 2 === 0 ? "stale" : "fresh";
    const head = nodes[node as keyof typeof nodes];
    calls.push({ method, params, node });
    const p = (params ?? []) as unknown[];
    switch (method) {
      case "eth_blockNumber":
        return toHex(head);
      case "eth_getTransactionReceipt":
        return { blockNumber: toHex(100n), status: "0x1" };
      case "eth_call": {
        const tag = p[1];
        if (typeof tag === "string" && tag.startsWith("0x") && hexToBigInt(tag as `0x${string}`) > head) throw new Error("header not found");
        return tag === "latest" && node === "stale" ? "0x00" : "0x01";
      }
      case "eth_getTransactionCount":
        return node === "stale" ? "0x3" : "0x4";
      default:
        throw new Error(`unexpected ${method}`);
    }
  };
  return { base, calls };
}

describe("consistentTransport", () => {
  it("passes reads through untouched until a receipt is seen", async () => {
    const b = balancer();
    const t = consistentTransport("http://rpc", { base: b.base, waitMs: 0 })({});
    await t.request({ method: "eth_call", params: [{ to: "0x01" }, "latest"] });
    expect(b.calls.map((c) => c.method)).toEqual(["eth_call"]);
  });

  it("pins reads after a receipt to a block at least as new, retrying on a lagging node", async () => {
    const b = balancer();
    const t = consistentTransport("http://rpc", { base: b.base, waitMs: 0 })({});
    await t.request({ method: "eth_getTransactionReceipt", params: ["0xabc"] });
    const out = await t.request({ method: "eth_call", params: [{ to: "0x01" }, "latest"] });
    expect(out).toBe("0x01");
    const pinnedCalls = b.calls.filter((c) => c.method === "eth_call");
    expect(pinnedCalls.every((c) => (c.params as unknown[])[1] === toHex(100n))).toBe(true);
  });

  it("keeps an explicit block number as given", async () => {
    const b = balancer();
    const t = consistentTransport("http://rpc", { base: b.base, waitMs: 0 })({});
    await t.request({ method: "eth_getTransactionReceipt", params: ["0xabc"] });
    await t.request({ method: "eth_call", params: [{ to: "0x01" }, toHex(90n)] });
    expect(b.calls.at(-1)!.params).toEqual([{ to: "0x01" }, toHex(90n)]);
  });

  it("never hands out a nonce below one it has already sent", async () => {
    const b = balancer();
    const t = consistentTransport("http://rpc", { base: async (a) => (a.method === "eth_sendRawTransaction" ? "0xhash" : b.base(a)), waitMs: 0 })({});
    const raw = await ACCOUNT.signTransaction({ chainId: 84532, nonce: 4, to: ACCOUNT.address, value: 0n, gas: 21000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n });
    await t.request({ method: "eth_sendRawTransaction", params: [raw] });
    // the stale node answers first and still says 3
    expect(await t.request({ method: "eth_getTransactionCount", params: [ACCOUNT.address, "pending"] })).toBe(toHex(5n));
  });

  it("works as a viem client transport", async () => {
    const b = balancer();
    const pub = createPublicClient({ transport: consistentTransport("http://rpc", { base: b.base, waitMs: 0 }) });
    expect(await pub.getBlockNumber({ cacheTime: 0 })).toBeGreaterThanOrEqual(95n);
  });
});

describe("consistentTransport, log ranges", () => {
  it("never reports a head older than the newest receipt, and retries a log range a lagging node refuses", async () => {
    const b = balancer();
    let refusals = 0;
    const base = async (a: { method: string; params?: unknown }) => {
      if (a.method === "eth_getLogs" && refusals++ < 2) throw new Error("block range extends beyond current head block: requested 100, head 95");
      if (a.method === "eth_getLogs") return [];
      return b.base(a);
    };
    const t = consistentTransport("http://rpc", { base, waitMs: 0 })({});
    await t.request({ method: "eth_getTransactionReceipt", params: ["0xabc"] });
    expect(await t.request({ method: "eth_blockNumber" })).toBe(toHex(100n)); // the stale node said 95
    expect(await t.request({ method: "eth_getLogs", params: [{ fromBlock: "0x5a", toBlock: "0x64" }] })).toEqual([]);
    expect(refusals).toBe(3);
  });
});
