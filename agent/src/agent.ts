// Wiring: config + deployment + plan book → chain, decision log, executor, provider and pipeline deps.
import { connect, isStorm, readBalances, readPlan, readSnapshot, type Chainish } from "./chain.ts";
import { loadConfig, loadDeployment, type Config } from "./config.ts";
import { Executor } from "./exec/executor.ts";
import { makeProvider, plannerPlans, registryFrom, type ModelProvider } from "./llm/provider.ts";
import { DecisionLog } from "./log.ts";
import type { StormChain } from "./loops/storm.ts";
import type { PipelineDeps } from "./pipeline.ts";
import { loadPlanBook, planHash } from "./plan.ts";
import type { Hex } from "./policy/localCheck.ts";
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
  const names = new Map(book.payees.map((p) => [p.address.toLowerCase(), p.name.replace(/ \(fictional\)$/, "")]));
  const sink = new Executor(c, log, { names, onTx: opts.onTx });
  const provider = makeProvider(cfg);
  const pipeline: PipelineDeps = {
    provider,
    sink,
    log,
    payees: registryFrom(book),
    plans: plannerPlans(book),
    state: async () => {
      const storm = await isStorm(c);
      return { activePlan: storm ? "storm" : "base", holdSupplierPayments: storm };
    },
  };
  const stormChain: StormChain = {
    planHashes: async () => Promise.all([readPlan(c, 0), readPlan(c, 1)]).then((ps) => ps.map((p) => p.planHash)),
    balances: () => readBalances(c),
    creditRoom: async () => {
      const s = await readSnapshot(c);
      const cap = s.plans[1]!.creditCapPerEvent;
      return cap > s.drawnInEvent ? cap - s.drawnInEvent : 0n;
    },
  };
  return { cfg, c, log, sink, provider, book, localPlanHash: planHash(book), names, pipeline, stormChain };
}
