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
  payroll: resolve(REPO_ROOT, "data/fixtures/payroll.json"),
  planBook: resolve(REPO_ROOT, "data/fixtures/plans/plan-book.json"),
  planBookExample: resolve(REPO_ROOT, "data/fixtures/plans/plan-book.example.json"),
  redteam: resolve(REPO_ROOT, "redteam"),
};

export type Network = "anvil" | "base-sepolia";
export type KeyRole = "agent" | "hkoRelayer" | "gdacsRelayer" | "demoClient";

export const KEY_ENV: Record<KeyRole, string> = {
  agent: "AGENT_PRIVATE_KEY",
  hkoRelayer: "HKO_RELAYER_PRIVATE_KEY",
  gdacsRelayer: "GDACS_RELAYER_PRIVATE_KEY",
  demoClient: "DEMO_CLIENT_PRIVATE_KEY",
};

/** Anvil's default-mnemonic keys (public; see the shared interfaces). Used only when NETWORK=anvil. */
const ANVIL_KEYS: Record<KeyRole, `0x${string}`> = {
  agent: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  hkoRelayer: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  gdacsRelayer: "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
  demoClient: "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
};

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/) as unknown as z.ZodType<`0x${string}`>;

export const Deployment = z.object({
  network: z.string(),
  chainId: z.number().int(),
  startBlock: z.number().int().optional(),
  region: z.string(),
  timeUnit: z.number().int().optional(),
  planHash: z.string().optional(),
  contracts: z.object({
    Safe: address,
    PlanModule: address,
    SignalAttestor: address,
    MockUSD: address,
    MockSignalCover: address,
    FlowCreditLine: address,
    PaymentRouter: address,
    MockMMFVault: address,
    EvidenceRegistry: address,
  }),
});
export type Deployment = z.infer<typeof Deployment>;

export interface Config {
  network: Network;
  rpcUrl: string;
  chainId: number;
  model: { provider: "anthropic" | "rules"; name: string; hasKey: boolean };
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
  const network = (env.NETWORK || "anvil") as Network;
  if (network !== "anvil" && network !== "base-sepolia") throw new Error(`NETWORK must be anvil or base-sepolia, not "${network}"`);
  const rpcUrl =
    opts.rpcUrl ||
    env.RPC_URL ||
    (network === "anvil" ? "http://127.0.0.1:8545" : env.BASE_SEPOLIA_RPC || "https://sepolia.base.org");
  const provider = (env.MODEL_PROVIDER || (env.MODEL_API_KEY ? "anthropic" : "rules")) as Config["model"]["provider"];
  if (provider !== "anthropic" && provider !== "rules") throw new Error(`MODEL_PROVIDER must be anthropic or rules`);
  return {
    network,
    rpcUrl,
    chainId: network === "anvil" ? 31337 : 84532,
    model: { provider, name: env.MODEL_NAME || DEFAULT_MODEL, hasKey: Boolean(env.MODEL_API_KEY) },
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
  if (network === "anvil") return ANVIL_KEYS[role];
  throw new Error(`${KEY_ENV[role]} is not set (required on ${network}; run npm run keys:new)`);
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
