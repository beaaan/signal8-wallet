// Wiring: config + deployment + plan book → chain, decision log, executor, provider and pipeline deps.
import { addressOf, connect, currentEventId, isStorm, readBalances, readPlan, readSnapshot, type Chainish } from "./chain.ts";
import { loadControls } from "./controls.ts";
import { loadConfig, loadDeployment, safeApiKey, secretKey, type Config } from "./config.ts";
import { Executor } from "./exec/executor.ts";
import { apiKitClient, lazySigner, protocolKitSigner, SafeProposer } from "./exec/safeProposer.ts";
import { makeProvider, plannerPlans, registryFrom, type ModelProvider } from "./llm/provider.ts";
import { DecisionLog } from "./log.ts";
import type { StormChain } from "./loops/storm.ts";
import type { PipelineDeps } from "./pipeline.ts";
import { loadPlanBook, planHash } from "./plan.ts";
import type { Hex } from "./policy/localCheck.ts";
import { setTokenSymbol } from "./token.ts";
import type { PlanBook } from "./types.ts";

export interface Agent {
  cfg: Config;
  c: Chainish;
  log: DecisionLog;
  sink: Executor;
  provider: ModelProvider;
  book: PlanBook;
  localPlanHash: Hex;
  names: Map<string, string>;
  pipeline: PipelineDeps;
  stormChain: StormChain;
}

export function makeAgent(opts: { rpcUrl?: string; onTx?: (label: string, tx: Hex) => void } = {}): Agent {
  const cfg = loadConfig(process.env, { rpcUrl: opts.rpcUrl });
  const dep = loadDeployment(cfg.network);
  const c = connect(cfg, dep);
  const log = new DecisionLog(cfg.logDir);
  const book = loadPlanBook(cfg.planBookPath);
  if (book.region !== dep.region) throw new Error(`plan book region ${book.region} does not match deployment region ${dep.region}`);
  if (dep.token && (dep.token.symbol !== book.token.symbol || dep.token.decimals !== book.token.decimals)) {
    throw new Error(`plan book token ${book.token.symbol} (${book.token.decimals} decimals) does not match the deployed ${dep.token.contract} (${dep.token.symbol}, ${dep.token.decimals})`);
  }
  setTokenSymbol(book.token.symbol); // labels in logs and drafts: mUSD, or mVND on the Vietnam (FISCO) deployment
  const names = new Map(book.payees.map((p) => [p.address.toLowerCase(), p.name.replace(/ \(fictional\)$/, "")]));
  const sink = new Executor(c, log, { names, onTx: opts.onTx, proposer: makeProposer(c) });
  const provider = makeProvider(cfg);
  const pipeline: PipelineDeps = {
    provider,
    sink,
    log,
    payees: registryFrom(book),
    plans: plannerPlans(book),
    controls: loadControls(),
    state: async () => {
      const storm = await isStorm(c);
      return { activePlan: storm ? "storm" : "base", holdSupplierPayments: storm };
    },
  };
  const stormChain: StormChain = {
    planHashes: async () => Promise.all([readPlan(c, 0), readPlan(c, 1)]).then((ps) => ps.map((p) => p.planHash)),
    eventId: () => currentEventId(c),
    balances: () => readBalances(c),
    creditRoom: async () => {
      const s = await readSnapshot(c);
      const cap = s.plans[1]!.creditCapPerEvent;
      return cap > s.drawnInEvent ? cap - s.drawnInEvent : 0n;
    },
  };
  return { cfg, c, log, sink, provider, book, localPlanHash: planHash(book), names, pipeline, stormChain };
}

/**
 * Base Sepolia with SAFE_API_KEY: owner proposals go to the Safe Transaction Service, signed by the agent as a
 * delegate. Anywhere else (anvil, or no key) they are only logged to logs/proposals.jsonl.
 */
export function makeProposer(c: Chainish): SafeProposer | undefined {
  const apiKey = safeApiKey();
  // FISCO has no Safe (the wallet is a standalone LocalSafe) and no Transaction Service: proposals are only logged.
  if (c.cfg.local || c.cfg.fisco || !apiKey) return undefined;
  const safe = c.cfg.safe.address ?? c.dep.contracts.Safe;
  if (safe.toLowerCase() !== c.dep.contracts.Safe.toLowerCase()) {
    throw new Error(`SAFE_ADDRESS ${safe} differs from the deployment's Safe ${c.dep.contracts.Safe}`);
  }
  const sender = addressOf(c, "agent");
  const signer = lazySigner(sender, () => protocolKitSigner(c.cfg.rpcUrl, secretKey("agent", c.cfg.network), sender, safe));
  return new SafeProposer(safe, apiKitClient(c.dep.chainId, apiKey), signer);
}
