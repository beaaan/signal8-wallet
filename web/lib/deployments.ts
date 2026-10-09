// Reads contracts/deployments/<NETWORK>.json (written by contracts/script/Deploy.s.sol). Server only.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

export const CONTRACT_NAMES = [
  "Safe",
  "PlanModule",
  "SignalAttestor",
  "MockUSD",
  "MockSignalCover",
  "FlowCreditLine",
  "PaymentRouter",
  "MockMMFVault",
  "EvidenceRegistry",
] as const;
export type ContractName = (typeof CONTRACT_NAMES)[number];

export interface Deployment {
  network: string;
  chainId: number;
  startBlock: number;
  region: string;
  timeUnit: number;
  planHash?: `0x${string}`;
  contracts: Record<ContractName, `0x${string}`>;
}

export type DeploymentResult =
  | { ok: true; deployment: Deployment; file: string }
  | { ok: false; reason: string; file: string };

const isAddress = (v: unknown): v is `0x${string}` => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);

export async function loadDeployment(): Promise<DeploymentResult> {
  const file = config.deploymentsFile;
  const shown = path.relative(config.repoRoot, file).split(path.sep).join("/");
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return { ok: false, file: shown, reason: `No deployments file at ${shown}. Deploy the contracts first.` };
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, file: shown, reason: `${shown} is not valid JSON.` };
  }
  const contracts = (json.contracts ?? {}) as Record<string, unknown>;
  const missing = CONTRACT_NAMES.filter((n) => !isAddress(contracts[n]));
  if (missing.length > 0) {
    return { ok: false, file: shown, reason: `${shown} has no address for: ${missing.join(", ")}.` };
  }
  if (typeof json.chainId !== "number") {
    return { ok: false, file: shown, reason: `${shown} has no chainId.` };
  }
  return {
    ok: true,
    file: shown,
    deployment: {
      network: String(json.network ?? config.network),
      chainId: json.chainId,
      startBlock: Number(json.startBlock ?? 0),
      region: String(json.region ?? "HK"),
      timeUnit: Number(json.timeUnit ?? 1),
      planHash: typeof json.planHash === "string" ? (json.planHash as `0x${string}`) : undefined,
      contracts: contracts as Record<ContractName, `0x${string}`>,
    },
  };
}
