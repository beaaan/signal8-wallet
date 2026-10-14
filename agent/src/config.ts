// Configuration: ../.env, contracts/deployments/<network>.json and repo paths.
// Spec: docs/specs/agent.md#process-layout
//
// Private keys are read only through secretKey(); they are never stored on the Config object, so logging
// a Config (or handing it to model code) cannot leak them.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../..");
export const AGENT_DIR = resolve(REPO_ROOT, "agent");

export const PATHS = {
  env: resolve(REPO_ROOT, ".env"),
  envExample: resolve(REPO_ROOT, ".env.example"),
  deployments: resolve(REPO_ROOT, "contracts/deployments"),
  replays: resolve(REPO_ROOT, "data/replays"),
  fixtures: resolve(REPO_ROOT, "data/fixtures"),
  invoices: resolve(REPO_ROOT, "data/fixtures/invoices"),
  /** PAYROLL overrides it (the Yagi replay uses data/fixtures/yagi/payroll.json). Read when used, after .env loads. */
  get payroll(): string {
    return process.env.PAYROLL ? resolve(process.env.PAYROLL) : resolve(REPO_ROOT, "data/fixtures/payroll.json");
  },
  /** RECEIVABLES overrides it (the Yagi replay uses data/fixtures/yagi/receivables.json). */
  get receivables(): string {
    return process.env.RECEIVABLES ? resolve(process.env.RECEIVABLES) : resolve(REPO_ROOT, "data/fixtures/receivables.json");
  },
  planBook: resolve(REPO_ROOT, "data/fixtures/plans/plan-book.json"),
  planBookExample: resolve(REPO_ROOT, "data/fixtures/plans/plan-book.example.json"),
  redteam: resolve(REPO_ROOT, "redteam"),
};

/**
 * "anvil" or "anvil-<name>" (a local chain; the name selects deployments/<name>.json), "base-sepolia", or "fisco" /
 * "fisco-<name>" (a local FISCO BCOS chain's web3 RPC; Yagi replay, stretch).
 */
export type Network = string;

/** Local anvil chains: public dev keys allowed, arena allowed. */
export function isLocalNetwork(network: string): boolean {
  return network === "anvil" || network.startsWith("anvil-");
}

/**
 * A local FISCO BCOS v3 chain (web3 RPC). Not an anvil: no dev-key fallback, no evm_mine, no arena, no Safe
 * Transaction Service. Its EVM sees block.timestamp in milliseconds (contracts take timeUnit 1000).
 */
export function isFiscoNetwork(network: string): boolean {
  return network === "fisco" || network.startsWith("fisco-");
}

/** eth_chainId of a FISCO BCOS v3 chain built by build_chain.sh (config.genesis [web3] chain_id). */
export const FISCO_DEFAULT_CHAIN_ID = 20200;

export type KeyRole = "agent" | "hkoRelayer" | "gdacsRelayer" | "nchmfRelayer" | "demoClient";

export const KEY_ENV: Record<KeyRole, string> = {
  agent: "AGENT_PRIVATE_KEY",
  hkoRelayer: "HKO_RELAYER_PRIVATE_KEY",
  gdacsRelayer: "GDACS_RELAYER_PRIVATE_KEY",
  /** Vietnam (Yagi) only: the NCHMF bulletin relayer fills the local-source slot outside Hong Kong. */
  nchmfRelayer: "NCHMF_RELAYER_PRIVATE_KEY",
  demoClient: "DEMO_CLIENT_PRIVATE_KEY",
};

/** Anvil's default-mnemonic keys (public; see the shared interfaces). Used only when NETWORK=anvil. */
const ANVIL_KEYS: Record<KeyRole, `0x${string}`> = {
  agent: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  hkoRelayer: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  gdacsRelayer: "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
  nchmfRelayer: "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6", // anvil #9, Deploy.s.sol's default
  demoClient: "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
};

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/) as unknown as z.ZodType<`0x${string}`>;

export const Deployment = z.object({
  network: z.string(),
  chainId: z.number().int(),
  startBlock: z.number().int().optional(),
  region: z.string(),
  /** 1 on EVM chains, 1000 on FISCO (block.timestamp in milliseconds). */
  timeUnit: z.number().int().optional(),
  /** The EIP-712 chain id SignalAttestor was built with (a constructor parameter); defaults to chainId. */
  attestorChainId: z.number().int().optional(),
  /** The token PlanModule accounts in: MockUSD, or MockVNDDeposit (mVND) on the Vietnam deployment. */
  token: z.object({ contract: z.string(), symbol: z.string(), decimals: z.number().int() }).optional(),
  planHash: z.string().optional(),
  contracts: z
    .object({
      Safe: address,
      PlanModule: address,
      SignalAttestor: address,
      MockUSD: address.optional(),
      MockVNDDeposit: address.optional(),
      MockSignalCover: address,
      FlowCreditLine: address,
      PaymentRouter: address,
      MockMMFVault: address,
      EvidenceRegistry: address,
    })
    // The agent reads the token as contracts.MockUSD (the token slot), whichever mock it is.
    .transform(({ MockUSD, MockVNDDeposit, ...rest }, ctx) => {
      const token = MockUSD ?? MockVNDDeposit;
      if (!token) {
        ctx.addIssue({ code: "custom", message: "deployment has no token (MockUSD or MockVNDDeposit)" });
        return z.NEVER;
      }
      return { ...rest, MockUSD: token };
    }),
});
export type Deployment = z.infer<typeof Deployment>;

export interface Config {
  network: Network;
  rpcUrl: string;
  chainId: number;
  /** anvil or anvil-<name>: dev-key fallback, arena, evm_mine. */
  local: boolean;
  /** fisco or fisco-<name>: a local FISCO BCOS chain (plain http transport, no Safe service, idle-chain refresh). */
  fisco: boolean;
  /** baseUrl and reasoningEffort apply to MODEL_PROVIDER=openai (any OpenAI-compatible API, e.g. DeepSeek). */
  model: { provider: "anthropic" | "openai" | "rules"; name: string; hasKey: boolean; baseUrl?: string; reasoningEffort?: string };
  /** Safe Transaction Service (base-sepolia proposals); the key itself is read with safeApiKey(). */
  safe: { address?: `0x${string}`; hasApiKey: boolean };
  logDir: string;
  stateDir: string;
  planBookPath: string;
  apiPort: number;
}

/** Default model when MODEL_NAME is unset (claude-api skill: current default model; see llm/anthropic.ts). */
export const DEFAULT_MODEL = "claude-opus-5-5";

let envLoaded = false;
/** Loads ../.env once. Variables already set in the process environment win. */
export function loadEnvFile(path: string = PATHS.env): void {
  if (envLoaded) return;
  envLoaded = true;
  if (existsSync(path)) loadDotenv({ path, quiet: true });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts: { rpcUrl?: string } = {}): Config {
  if (env === process.env) loadEnvFile();
  const network = env.NETWORK || "anvil";
  const local = isLocalNetwork(network);
  const fisco = isFiscoNetwork(network);
  if (!local && !fisco && network !== "base-sepolia") throw new Error(`NETWORK must be anvil, anvil-<name>, base-sepolia or fisco, not "${network}"`);
  const rpcUrl =
    opts.rpcUrl ||
    (fisco ? env.FISCO_RPC?.trim() : undefined) ||
    env.RPC_URL ||
    (local || fisco ? "http://127.0.0.1:8545" : env.BASE_SEPOLIA_RPC || "https://sepolia.base.org");
  const fiscoChainId = env.FISCO_CHAIN_ID?.trim() ? Number(env.FISCO_CHAIN_ID) : FISCO_DEFAULT_CHAIN_ID;
  if (fisco && !(Number.isSafeInteger(fiscoChainId) && fiscoChainId > 0)) throw new Error(`FISCO_CHAIN_ID must be a positive integer, not "${env.FISCO_CHAIN_ID}"`);
  const safeAddress = env.SAFE_ADDRESS?.trim();
  if (safeAddress && !/^0x[0-9a-fA-F]{40}$/.test(safeAddress)) throw new Error("SAFE_ADDRESS is not an address");
  const provider = (env.MODEL_PROVIDER || (env.MODEL_API_KEY ? "anthropic" : "rules")) as Config["model"]["provider"];
  if (provider !== "anthropic" && provider !== "openai" && provider !== "rules") throw new Error(`MODEL_PROVIDER must be anthropic, openai or rules`);
  const baseUrl = env.MODEL_BASE_URL?.trim().replace(/\/+$/, "") || undefined;
  if (provider === "openai") {
    if (!baseUrl) throw new Error("MODEL_PROVIDER=openai needs MODEL_BASE_URL (e.g. https://api.deepseek.com)");
    if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(baseUrl)) throw new Error("MODEL_BASE_URL must be https (or http on localhost)");
    if (!env.MODEL_NAME) throw new Error("MODEL_PROVIDER=openai needs MODEL_NAME (e.g. deepseek-flash)");
  }
  return {
    network,
    rpcUrl,
    chainId: local ? 31337 : fisco ? fiscoChainId : 84532,
    local,
    fisco,
    model: {
      provider,
      name: env.MODEL_NAME || DEFAULT_MODEL,
      hasKey: Boolean(env.MODEL_API_KEY),
      ...(provider === "openai" ? { baseUrl, reasoningEffort: env.MODEL_REASONING_EFFORT?.trim() || undefined } : {}),
    },
    safe: { address: safeAddress ? (safeAddress as `0x${string}`) : undefined, hasApiKey: Boolean(env.SAFE_API_KEY?.trim()) },
    logDir: env.LOG_DIR ? resolve(env.LOG_DIR) : resolve(AGENT_DIR, "logs"),
    stateDir: env.STATE_DIR ? resolve(env.STATE_DIR) : resolve(AGENT_DIR, "state"),
    planBookPath: env.PLAN_BOOK ? resolve(env.PLAN_BOOK) : existsSync(PATHS.planBook) ? PATHS.planBook : PATHS.planBookExample,
    apiPort: Number(env.AGENT_API_PORT || 8787),
  };
}

/**
 * The private key for one role. Falls back to the public anvil dev key only on NETWORK=anvil;
 * on any other network a missing key is an error. Never log the return value or pass it to model code.
 */
export function secretKey(role: KeyRole, network: Network, env: NodeJS.ProcessEnv = process.env): `0x${string}` {
  if (env === process.env) loadEnvFile();
  const value = env[KEY_ENV[role]]?.trim();
  if (value) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${KEY_ENV[role]} is not a 32-byte hex key`);
    return value as `0x${string}`;
  }
  if (isLocalNetwork(network)) return ANVIL_KEYS[role];
  throw new Error(`${KEY_ENV[role]} is not set (required on ${network}; run npm run keys:new)`);
}

/** The Safe Transaction Service API key; only the Safe proposer reads it. */
export function safeApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env === process.env) loadEnvFile();
  return env.SAFE_API_KEY?.trim() || undefined;
}

/** The model API key; only the model provider reads it. */
export function modelApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env === process.env) loadEnvFile();
  return env.MODEL_API_KEY || undefined;
}

export function deploymentPath(network: string): string {
  return resolve(PATHS.deployments, `${network}.json`);
}

export function loadDeployment(network: string): Deployment {
  const path = deploymentPath(network);
  if (!existsSync(path)) {
    throw new Error(`no deployment for ${network}: ${path} is missing (deploy the contracts first)`);
  }
  return Deployment.parse(JSON.parse(readFileSync(path, "utf8")));
}
