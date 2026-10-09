import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, loadConfig, secretKey } from "../src/config.ts";
import { fillEnv } from "../src/keys.ts";

describe("config", () => {
  it("defaults to anvil on the local RPC with the offline rules provider", () => {
    const cfg = loadConfig({});
    expect(cfg).toMatchObject({ network: "anvil", rpcUrl: "http://127.0.0.1:8545", model: { provider: "rules", name: DEFAULT_MODEL, hasKey: false } });
  });

  it("uses BASE_SEPOLIA_RPC on base-sepolia and lets --rpc override", () => {
    expect(loadConfig({ NETWORK: "base-sepolia", BASE_SEPOLIA_RPC: "https://rpc.example" }).rpcUrl).toBe("https://rpc.example");
    expect(loadConfig({ NETWORK: "base-sepolia" }, { rpcUrl: "http://127.0.0.1:8545" }).rpcUrl).toBe("http://127.0.0.1:8545");
  });

  it("picks the model provider when MODEL_API_KEY is set, without putting the key in the config", () => {
    const cfg = loadConfig({ MODEL_API_KEY: "sk-test", MODEL_NAME: "claude-haiku-5-5" });
    expect(cfg.model).toEqual({ provider: "anthropic", name: "claude-haiku-5-5", hasKey: true });
    expect(JSON.stringify(cfg)).not.toContain("sk-test");
  });

  it("falls back to the anvil dev key for a role only on anvil", () => {
    expect(privateKeyToAccount(secretKey("agent", "anvil", {})).address).toBe("0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"); // anvil #5
    expect(() => secretKey("agent", "base-sepolia", {})).toThrow(/AGENT_PRIVATE_KEY/);
  });

  it("prefers the key from the environment and rejects a malformed one", () => {
    const key = `0x${"12".repeat(32)}` as const;
    expect(secretKey("hkoRelayer", "base-sepolia", { HKO_RELAYER_PRIVATE_KEY: key })).toBe(key);
    expect(() => secretKey("hkoRelayer", "anvil", { HKO_RELAYER_PRIVATE_KEY: "0x1234" })).toThrow();
  });
});

describe("keys:new (fillEnv)", () => {
  let i = 0;
  const gen = () => `0x${(++i).toString(16).padStart(64, "0")}` as const;

  it("fills empty lines and appends missing ones, never overwriting a set key", () => {
    const set = `0x${"77".repeat(32)}`;
    const before = `NETWORK=base-sepolia\nAGENT_PRIVATE_KEY=${set}\nHKO_RELAYER_PRIVATE_KEY=\nGDACS_RELAYER_PRIVATE_KEY=   # later\n`;
    const { text, filled } = fillEnv(before, gen);
    expect(text).toContain(`AGENT_PRIVATE_KEY=${set}`);
    expect(text).toMatch(/^HKO_RELAYER_PRIVATE_KEY=0x0{63}1$/m);
    expect(text).toMatch(/^GDACS_RELAYER_PRIVATE_KEY=0x0{63}2$/m);
    expect(text).toMatch(/^DEMO_CLIENT_PRIVATE_KEY=0x0{63}3$/m);
    expect(Object.keys(filled).sort()).toEqual(["demoClient", "gdacsRelayer", "hkoRelayer"]);
    // the returned values are addresses to fund, not keys
    for (const v of Object.values(filled)) expect(v).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(fillEnv(text, gen).filled).toEqual({});
  });
});
