// FISCO BCOS port and the Yagi replay: config, millisecond time, the NCHMF signal mapping, the Yagi fixtures and
// the mVND labels. No chain needed (CI has no FISCO node).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toBytes } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { Deployment, loadConfig, loadDeployment, PATHS, secretKey } from "../src/config.ts";
import { buildDrafts, deadlines, type DraftContext } from "../src/drafts.ts";
import { describe as describeAction, units, type ActionSink, type ExecResult, type PlainAction } from "../src/exec/executor.ts";
import { attestorChainId, evmSeconds, fiscoProblems, FISCO_LOG_RANGE, headerSeconds, pickIssuedAt, toEvmTime } from "../src/fisco.ts";
import { plannerPlans, registryFrom } from "../src/llm/provider.ts";
import { RulesProvider } from "../src/llm/rules.ts";
import { DecisionLog } from "../src/log.ts";
import { loadReceivables } from "../src/loops/inflows.ts";
import { braceMargin, FORECAST, loadPayroll, payrollTotal, sizedForecast, StormLoop } from "../src/loops/storm.ts";
import { processUntrusted } from "../src/pipeline.ts";
import { loadPlanBook, toChainParams } from "../src/plan.ts";
import { buildGdacsAttestation, eventFromReplay, gdacsEventId } from "../src/relayers/gdacs.ts";
import { buildHkoAttestation } from "../src/relayers/hko.ts";
import { SOURCE, ZERO32 } from "../src/relayers/sign.ts";
import { relayerKeyRole } from "../src/relayers/submit.ts";
import { buildRunSteps } from "../src/replay/run.ts";
import { buildSteps, loadReplay } from "../src/replay/timeline.ts";
import { chainSnapshot, SimSink } from "../src/sim.ts";
import { setTokenSymbol, tokenSizing, tokenSymbol } from "../src/token.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const yagiBook = loadPlanBook(join(root, "data/fixtures/plans/plan-book.yagi.json"));
const yagiPayroll = loadPayroll(join(root, "data/fixtures/yagi/payroll.json"));
const yagi = loadReplay("yagi-2024");

afterEach(() => setTokenSymbol("mUSD"));

describe("config: NETWORK=fisco", () => {
  it("is a local FISCO chain, not an anvil: FISCO_RPC, chain id 20200 by default", () => {
    const cfg = loadConfig({ NETWORK: "fisco", FISCO_RPC: "http://127.0.0.1:18545" });
    expect(cfg).toMatchObject({ network: "fisco", fisco: true, local: false, rpcUrl: "http://127.0.0.1:18545", chainId: 20200 });
    expect(loadConfig({ NETWORK: "fisco" }).rpcUrl).toBe("http://127.0.0.1:8545");
    expect(loadConfig({ NETWORK: "fisco", RPC_URL: "http://127.0.0.1:9999" }).rpcUrl).toBe("http://127.0.0.1:9999");
    expect(loadConfig({ NETWORK: "fisco", FISCO_RPC: "http://a:1", RPC_URL: "http://b:2" }).rpcUrl).toBe("http://a:1");
    expect(loadConfig({ NETWORK: "fisco-yagi" }).fisco).toBe(true);
    expect(loadConfig({ NETWORK: "anvil" }).fisco).toBe(false);
  });

  it("takes FISCO_CHAIN_ID and rejects a bad one", () => {
    expect(loadConfig({ NETWORK: "fisco", FISCO_CHAIN_ID: "1234" }).chainId).toBe(1234);
    expect(() => loadConfig({ NETWORK: "fisco", FISCO_CHAIN_ID: "abc" })).toThrow(/FISCO_CHAIN_ID/);
    expect(() => loadConfig({ NETWORK: "fisco", FISCO_CHAIN_ID: "0" })).toThrow(/FISCO_CHAIN_ID/);
    expect(() => loadConfig({ NETWORK: "mainnet" })).toThrow(/anvil, anvil-<name>, base-sepolia or fisco/);
  });

  it("never falls back to anvil dev keys on FISCO; the NCHMF relayer's anvil key is dev account 9", () => {
    expect(() => secretKey("agent", "fisco", {})).toThrow(/AGENT_PRIVATE_KEY/);
    expect(() => secretKey("nchmfRelayer", "fisco", {})).toThrow(/NCHMF_RELAYER_PRIVATE_KEY/);
    expect(privateKeyToAccount(secretKey("nchmfRelayer", "anvil", {})).address).toBe("0xa0Ee7A142d267C1f36714E4a8F75612F20a79720");
  });

  it("PAYROLL and RECEIVABLES select the Yagi fixtures", () => {
    const saved = { p: process.env.PAYROLL, r: process.env.RECEIVABLES };
    try {
      process.env.PAYROLL = join(root, "data/fixtures/yagi/payroll.json");
      process.env.RECEIVABLES = join(root, "data/fixtures/yagi/receivables.json");
      expect(loadPayroll().token).toBe("mVND");
      expect(loadReceivables().map((r) => r.id)).toContain("INV-C-2024-09-08");
      delete process.env.PAYROLL;
      delete process.env.RECEIVABLES;
      expect(PATHS.payroll).toBe(join(root, "data/fixtures/payroll.json"));
      expect(loadPayroll().token).toBe("mUSD");
    } finally {
      if (saved.p === undefined) delete process.env.PAYROLL;
      else process.env.PAYROLL = saved.p;
      if (saved.r === undefined) delete process.env.RECEIVABLES;
      else process.env.RECEIVABLES = saved.r;
    }
  });
});

describe("deployments/fisco.json", () => {
  const base = {
    network: "fisco",
    chainId: 20200,
    region: "VN-QN-HP",
    contracts: Object.fromEntries(["Safe", "PlanModule", "SignalAttestor", "MockSignalCover", "FlowCreditLine", "PaymentRouter", "MockMMFVault", "EvidenceRegistry"].map((k, i) => [k, `0x${String(i + 1).padStart(40, "0")}`])),
  };

  it("reads MockVNDDeposit into the agent's token slot", () => {
    const vnd = "0x00000000000000000000000000000000000000dd";
    const dep = Deployment.parse({ ...base, timeUnit: 1000, attestorChainId: 20200, token: { contract: "MockVNDDeposit", symbol: "mVND", decimals: 6 }, contracts: { ...base.contracts, MockVNDDeposit: vnd } });
    expect(dep.contracts.MockUSD).toBe(vnd);
    expect(dep.token?.symbol).toBe("mVND");
    expect(() => Deployment.parse(base)).toThrow(/no token/);
  });

  it("the committed deployment is the Vietnam configuration: ms time, chain id 20200, mVND", () => {
    const dep = loadDeployment("fisco");
    expect(dep).toMatchObject({ network: "fisco", chainId: 20200, attestorChainId: 20200, timeUnit: 1000, region: "VN-QN-HP", token: { contract: "MockVNDDeposit", symbol: "mVND", decimals: 6 } });
    expect(dep.planHash).toBe(toChainParams(yagiBook).planHash);
  });

  it("the attestor's chain id defaults to the deployment's", () => {
    expect(attestorChainId({ chainId: 20200 })).toBe(20200);
    expect(attestorChainId({ chainId: 20200, attestorChainId: 0 })).toBe(0);
  });

  it("checks the node's eth_chainId and the time unit", () => {
    const dep = { chainId: 20200, timeUnit: 1000 };
    expect(fiscoProblems({ nodeChainId: 20200, cfgChainId: 20200, dep })).toEqual([]);
    expect(fiscoProblems({ nodeChainId: 20201, cfgChainId: 20200, dep }).join()).toMatch(/eth_chainId is 20201/);
    expect(fiscoProblems({ nodeChainId: 20200, cfgChainId: 20200, dep: { chainId: 20200, timeUnit: 1 } }).join()).toMatch(/must be 1000/);
  });
});

describe("millisecond time", () => {
  const sec = 1_791_980_829n;
  const ms = 1_791_980_829_475n; // FISCO's EVM block.timestamp for the same moment

  it("reads a header timestamp as seconds whether the RPC reports seconds or milliseconds", () => {
    expect(headerSeconds(sec)).toBe(sec); // FISCO v3.16.3 web3 RPC and EVM chains
    expect(headerSeconds(ms)).toBe(sec);
  });

  it("converts contract-level times with the deployment's timeUnit", () => {
    expect(evmSeconds(ms, 1000)).toBe(sec);
    expect(evmSeconds(sec)).toBe(sec);
    expect(toEvmTime(sec, 1000)).toBe(1_791_980_829_000n);
    // the attestor's check issuedAt * timeUnit <= block.timestamp holds for a signing time taken from the header
    expect(toEvmTime(headerSeconds(ms), 1000) <= ms).toBe(true);
    // PlanModule.today() = block.timestamp / (1 days * timeUnit): the same day index as on an EVM chain
    expect(ms / (86_400n * 1000n)).toBe(sec / 86_400n);
  });

  it("signs no later than the latest block and asks for a fresh block when the chain is idle", () => {
    expect(pickIssuedAt(sec, sec - 10n)).toEqual({ issuedAt: sec - 10n, stale: false });
    expect(pickIssuedAt(sec, sec + 3n)).toEqual({ issuedAt: sec, stale: false });
    expect(pickIssuedAt(sec, sec - 3600n)).toEqual({ issuedAt: sec - 3600n, stale: true }); // FISCO seals no empty blocks
    expect(pickIssuedAt(sec, ms - 10_000n)).toEqual({ issuedAt: sec - 10n, stale: false }); // a millisecond header
  });

  it("reads FISCO logs in 10-block windows", () => {
    expect(FISCO_LOG_RANGE).toBe(10n);
  });
});

describe("Yagi signals (NCHMF + GDACS)", () => {
  const region = keccak256(toBytes("VN-QN-HP"));

  it("maps Vietnam's warnings with the replay's level map: risk level 4 → 8, landfall → 10, cancel → 0", () => {
    const steps = buildSteps(yagi, 600).filter((s) => s.kind === "signal");
    expect(steps.map((s) => [s.code, s.level])).toEqual([
      ["VN_RISK_4", 8],
      ["VN_LANDFALL", 10],
      ["VN_CANCEL", 0],
    ]);
  });

  it("the local signal is an NCHMF attestation (HKO counts only for Hong Kong) with no event id", () => {
    const a = buildHkoAttestation({ level: 8, issueTime: yagi.signals[0]!.time }, { region, source: SOURCE.NCHMF, nonce: 1n, issuedAt: 1_791_980_000n });
    expect(a).toEqual({ source: SOURCE.NCHMF, region, level: 8, eventId: ZERO32, sourceTime: 1_725_584_400n, issuedAt: 1_791_980_000n, nonce: 1n });
    expect(relayerKeyRole("hkoRelayer", "VN-QN-HP")).toBe("nchmfRelayer");
    expect(relayerKeyRole("hkoRelayer", "HK")).toBe("hkoRelayer");
    expect(relayerKeyRole("gdacsRelayer", "VN-QN-HP")).toBe("gdacsRelayer");
  });

  it("GDACS attests YAGI-24 (event 1001090, Red) for VN-QN-HP because it lists VNM, salted by the run id", () => {
    const e = eventFromReplay({ ...yagi.gdacs, name: yagi.name });
    expect(e.countries).toContain("VNM");
    const a = buildGdacsAttestation(e, { region: "VN-QN-HP", regionId: region, nonce: 1n, issuedAt: 1_791_980_000n, runId: "r1" });
    expect(a).toMatchObject({ source: SOURCE.GDACS, level: 3, eventId: gdacsEventId("1001090", "r1") });
    expect(a.eventId).toBe(keccak256(toBytes("TC-1001090#r1")));
  });

  it("puts payday between the level 4 warning and landfall, and the fake Zalo message after landfall", () => {
    const steps = buildRunSteps(yagi, 600);
    expect(steps.map((s) => s.code)).toEqual(["VN_RISK_4", "payday", "VN_LANDFALL", "zalo", "VN_CANCEL"]);
    expect(yagi.scenario?.afterStormInflow).toBe("125000000");
  });
});

describe("Yagi fixtures", () => {
  const params = toChainParams(yagiBook);

  it("plan-params.yagi.json is the output of plan:hash on plan-book.yagi.json", async () => {
    const { readFileSync } = await import("node:fs");
    const committed = JSON.parse(readFileSync(join(root, "data/fixtures/plans/plan-params.yagi.json"), "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(params, (_k, v) => (typeof v === "bigint" ? v.toString() : v))));
    expect(params.region).toBe("VN-QN-HP");
  });

  it("pays 20 workers 166,000,000 mVND, all storm-plan payees within the storm caps", () => {
    expect(yagiBook.token).toEqual({ symbol: "mVND", decimals: 6 });
    expect(yagiPayroll.staff).toHaveLength(20);
    expect(payrollTotal(yagiPayroll)).toBe(units("166000000"));
    const storm = new Set(params.payees.filter((p) => p.planMask === 2).map((p) => p.address.toLowerCase()));
    for (const s of yagiPayroll.staff) {
      expect(storm.has(s.address.toLowerCase())).toBe(true);
      expect(units(s.amount) <= params.plans.storm.perTxCap).toBe(true);
    }
    expect(payrollTotal(yagiPayroll) <= params.plans.storm.dailyCap).toBe(true);
    expect(payrollTotal(yagiPayroll) <= params.dailyCeiling).toBe(true);
  });

  it("the fake Zalo 'bank support' message is refused (no registered payee, not an invoice)", async () => {
    const sink = new SimSink(chainSnapshot(yagiBook, true));
    const r = await processUntrusted(yagi.scenario!.fakeMessages![0]!.text, "zalo", "zalo:test", {
      provider: new RulesProvider(),
      sink,
      log: new DecisionLog(mkdtempSync(join(tmpdir(), "s8-yagi-")), false),
      payees: registryFrom(yagiBook),
      plans: plannerPlans(yagiBook),
      state: async () => ({ activePlan: "storm", holdSupplierPayments: true }),
    });
    expect(r.outcome).toBe("refused");
    expect(sink.executed).toEqual([]);
    expect(sink.proposed).toEqual([]);
  });
});

describe("mVND labels and sizing", () => {
  it("labels amounts with the deployment's token", () => {
    const pay: PlainAction = { type: "pay", plan: "storm", payee: "0x000000000000000000000000000000000000c001", amount: "10400000", ref: "payroll:2024-08#r1" };
    expect(describeAction(pay)).toMatch(/^Pay 10400000 mUSD/);
    setTokenSymbol("mVND");
    expect(tokenSymbol()).toBe("mVND");
    expect(describeAction(pay)).toMatch(/^Pay 10400000 mVND to/);
    expect(() => setTokenSymbol("m VND; rm")).toThrow();
  });

  it("sizes the storm loop's dollar defaults in dong (25,000 per dollar, sizing only)", () => {
    expect(tokenSizing("mUSD")).toBe(1n);
    expect(tokenSizing("mVND")).toBe(25_000n);
    expect(tokenSizing("USDC")).toBe(1n);
    expect(sizedForecast(1n)).toEqual(FORECAST);
    expect(sizedForecast(25_000n).buffer).toBe(units("250000000"));
    expect(braceMargin(25_000n)).toBe(units("50000000"));
  });

  it("the storm loop pays all 20 workers in mVND when risk level 4 starts the storm", async () => {
    setTokenSymbol("mVND");
    const runs: Array<Parameters<ActionSink["run"]>[0]> = [];
    const sink: ActionSink = {
      async run(a): Promise<ExecResult> {
        runs.push(a);
        return { outcome: "executed", stage: "chain", tx: `0x${"11".repeat(32)}`, summary: a.type, payout: a.type === "cover_claim" ? units("500000000") : undefined };
      },
      async proposeBatch(): Promise<ExecResult> {
        return { outcome: "proposed", stage: "owner", summary: "batch" };
      },
    };
    const H = `0x${"aa".repeat(32)}` as const;
    const loop = new StormLoop({
      sink,
      log: new DecisionLog(mkdtempSync(join(tmpdir(), "s8-yagi-storm-")), false),
      chain: {
        planHashes: async () => [H, H],
        // after the 500 m cover payout and the 166 m payroll, as on the FISCO run
        balances: async () => ({ safe: units("1584000000"), vault: 0n, creditDrawn: 0n, creditLimit: units("1250000000") }),
        creditRoom: async () => units("400000000"),
      },
      payroll: yagiPayroll,
      localPlanHash: H,
      runId: "r1",
    });
    await loop.onSignal(8, "VN_RISK_4", true, new Date(yagi.signals[0]!.time));
    expect(runs.map((a) => a.type)).toEqual(["anchor", "cover_claim"]); // nothing in the vault to withdraw
    await loop.onPayday();
    const pays = runs.filter((a) => a.type === "pay");
    expect(pays).toHaveLength(20);
    expect(pays.every((a) => a.type === "pay" && a.plan === "storm" && a.ref === "payroll:2024-08#r1")).toBe(true);
    // 1.584 bn cash: the dong-sized forecast bottoms out at 384 m, above its 250 m buffer, so no credit draw
    expect(runs.some((a) => a.type === "credit_draw")).toBe(false);
  });
});

describe("Yagi drafts on FISCO", () => {
  const ctx: DraftContext = {
    runId: "r1",
    business: yagiPayroll.business,
    eventName: yagi.name,
    region: "VN-QN-HP",
    timeZone: "Asia/Ho_Chi_Minh",
    network: "fisco",
    chainId: 20200,
    stormStart: new Date(yagi.signals[0]!.time),
    stormEnd: new Date(yagi.signals[2]!.time),
    safe: "0x00000000000000000000000000000000000000aa",
    cover: { contract: "0x00000000000000000000000000000000000000bb", payout: units("500000000"), tx: `0x${"22".repeat(32)}` },
    payroll: { period: "2024-08", payday: "2024-09-06", total: units("166000000"), staff: 20, paidInStorm: true },
    held: [],
    token: "mVND",
  };

  it("includes the Circular 53/2024 restructuring request, in mVND, for one owner", () => {
    const drafts = buildDrafts(ctx);
    expect(drafts.map((d) => d.file)).toEqual(["claim-en.md", "deadlines.md", "circular53-vi.md"]);
    expect(drafts[0]!.body).toContain("500,000,000 mVND");
    expect(drafts[0]!.body).toContain("(chain 20200, local)");
    const d = deadlines(ctx);
    expect(d.some((x) => x.what.includes("Circular 53"))).toBe(true);
    expect(d[0]).toMatchObject({ what: "Next payroll (20 staff, 166,000,000 mVND)" });
    expect(d[0]!.action).toMatch(/the owner approves it \(standalone wallet on the local FISCO chain\)/);
    expect(deadlines({ ...ctx, network: "base-sepolia", token: "mUSD" })[0]!.action).toBe("On an ordinary day payroll is an owner proposal: two owners sign in Safe Wallet.");
  });
});
