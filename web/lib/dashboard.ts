// Everything the dashboard shows, in one JSON-safe object, with numbers and times already in words.
// Each source (deployment file, chain, agent API) fails on its own. Server only.
import { buildActivity, agoLabel, whenLabel, type ActivityGroup, type NeedsYouItem, type StormStrip } from "./activity";
import { fetchDecisions, type Decision } from "./agentApi";
import { readLogs, readSnapshot, SOURCES, type ChainLog, type ChainSnapshot } from "./chain";
import { config } from "./config";
import { loadDeployment } from "./deployments";
import { fmtUnits } from "./format";
import { loadPlanBook } from "./plan";
import { actionWords, gdacsName, hkoName } from "./words";

export interface Meter {
  used: string;
  cap: string;
  pct: number;
}

export interface DashboardData {
  network: string;
  generatedAt: string;
  updatedLabel: string;
  symbol: string;
  chainId: number | null;
  safeQueueUrl: string | null;
  connection: {
    deployment: { ok: boolean; text: string };
    chain: { ok: boolean; text: string };
    agent: { ok: boolean; text: string };
    readErrors: string[];
  };
  status: {
    mode: "calm" | "watch" | "storm" | "unknown";
    paused: boolean;
    /** Two or three words: "Storm plan on", "Everyday plan", "Paused". */
    title: string;
    /** Short facts beside the title: "Signal 10", "GDACS Red", "Since 02:01". */
    chips: string[];
    /** The same in one full sentence, for screen readers and hover. */
    headline: string;
    lines: string[];
    hkoLevel: number | null;
    gdacsLevel: number | null;
  };
  /** Amounts are in `symbol`, written without it. Each `hint` is a one-line explanation for hover. */
  money: null | {
    cash: string;
    fund: string;
    credit: Meter;
    cover: { state: "paid" | "ready" | "standby"; value: string; label: string };
    hints: { cash: string; fund: string; credit: string; cover: string };
  };
  limits: null | {
    plan: "base" | "storm";
    planName: string;
    perTx: string;
    planMeter: Meter;
    allMeter: Meter;
    creditMeter: Meter | null;
    allowed: string[];
    active: boolean;
  };
  needsYou: { ok: boolean; items: NeedsYouItem[]; total: number };
  activity: { ok: boolean; reason: string | null; groups: ActivityGroup[] };
  strip: StormStrip | null;
}

const msg = (e: unknown) => ((e as Error)?.message ?? String(e)).split("\n")[0].slice(0, 200);

const TIME_ZONES: Record<string, string> = { HK: "Asia/Hong_Kong", "VN-QN-HP": "Asia/Ho_Chi_Minh" };

function meter(used: string | null, cap: string | null, decimals: number): Meter {
  const u = BigInt(used ?? "0");
  const c = BigInt(cap ?? "0");
  const pct = c > 0n ? Math.min(100, Number((u * 1000n) / c) / 10) : 0;
  return { used: fmtUnits(u, decimals), cap: fmtUnits(c, decimals), pct };
}

export async function getDashboardData(): Promise<DashboardData> {
  const now = Date.now();
  const [dep, pb, decisionsRes] = await Promise.all([
    loadDeployment(),
    loadPlanBook(),
    fetchDecisions(300).then(
      (ds) => ({ ok: true as const, decisions: ds }),
      (e) => ({ ok: false as const, reason: `Agent API at ${config.agentApiUrl} is not answering (${msg(e)}).` }),
    ),
  ]);
  const decisions: Decision[] = decisionsRes.ok ? decisionsRes.decisions : [];
  const symbol = pb.ok ? pb.book.token.symbol : "mUSD";
  const region = dep.ok ? dep.deployment.region : pb.ok ? pb.book.region : "HK";
  const timeZone = TIME_ZONES[region] ?? "UTC";

  let snap: ChainSnapshot | null = null;
  let chainText = "No deployment to read.";
  let logs: ChainLog[] = [];
  let logsError: string | null = null;
  if (dep.ok) {
    try {
      snap = await readSnapshot(dep.deployment);
      chainText = `Chain ${snap.chainId}, block ${snap.blockNumber}`;
      try {
        logs = await readLogs(dep.deployment);
      } catch (e) {
        logsError = `Could not read events: ${msg(e)}`;
      }
    } catch (e) {
      chainText = msg(e);
    }
  }
  const decimals = snap?.decimals ?? (pb.ok ? pb.book.token.decimals : 6);
  const payees = new Map<string, { name: string; role: string }>();
  if (pb.ok) for (const p of pb.book.payees) payees.set(p.address.toLowerCase(), { name: p.name, role: p.role });

  const activity = buildActivity(logs, decisions, {
    decimals,
    symbol,
    timeZone,
    now,
    payees,
    hkoSource: region === "HK" ? SOURCES.HKO : SOURCES.NCHMF,
  });
  const ctx = { timeZone, now };
  const u = (v: string | null) => `${fmtUnits(v, decimals)} ${symbol}`;
  const n = (v: string | null) => fmtUnits(v, decimals);

  // ---- top status
  const hko = snap?.hko?.level ?? null;
  const gdacs = snap?.gdacs?.level ?? null;
  const status: DashboardData["status"] = {
    mode: "unknown",
    paused: Boolean(snap?.paused),
    title: "Not connected",
    chips: [],
    headline: "Not connected: storm status unknown",
    lines: [],
    hkoLevel: hko,
    gdacsLevel: gdacs,
  };
  if (snap) {
    const issued =
      snap.hko && snap.hko.sourceTime > 0
        ? `${hko === 0 ? "Signals cancelled" : `${hkoName(hko)} issued`} ${whenLabel(snap.hko.sourceTime * 1000, ctx)} (official time)`
        : null;
    const since = activity.stormSince ? `Since ${whenLabel(activity.stormSince, ctx)}` : null;
    const signalChip = hko === null ? "Signal unknown" : hko === 0 ? "No signal" : `Signal ${hko}`;
    const gdacsChip = gdacs ? `GDACS ${gdacsName(gdacs)}` : null;
    status.title = snap.isStorm ? "Storm plan on" : "Everyday plan";
    status.chips = [signalChip, gdacsChip, snap.isStorm ? since : (hko ?? 0) >= 8 ? "Waiting for GDACS" : (hko ?? 0) >= 1 ? "Getting ready" : null].filter(
      (x): x is string => Boolean(x),
    );
    if (snap.paused) {
      status.title = "Paused";
      status.chips.unshift("Agent can't move money");
    }
    if (snap.isStorm) {
      status.mode = "storm";
      status.headline = `Storm mode: ${hkoName(hko)} and GDACS ${gdacsName(gdacs)} confirmed. The storm plan is paying staff; supplier payments wait.`;
    } else if ((hko ?? 0) >= 8) {
      status.mode = "watch";
      status.headline = `Calm: the everyday plan is running. ${hkoName(hko)} is up; storm mode starts when GDACS confirms the storm.`;
    } else if ((hko ?? 0) >= 1) {
      status.mode = "watch";
      status.headline = `Calm: the everyday plan is running. ${hkoName(hko)} is up, so the agent is getting ready.`;
    } else {
      status.mode = "calm";
      status.headline = "Calm: the everyday plan is running.";
    }
    if (snap.paused) status.headline = `Paused: the agent cannot move money until the owners resume it. ${status.headline}`;
    if (activity.stormSince) status.lines.push(`Storm mode since ${whenLabel(activity.stormSince, ctx)} (${agoLabel(activity.stormSince, now)})`);
    if (!snap.isStorm && activity.stormEnded) status.lines.push(`Last storm mode ended ${whenLabel(activity.stormEnded, ctx)} (${agoLabel(activity.stormEnded, now)})`);
    if (issued) status.lines.push(issued);
  } else if (!dep.ok) {
    status.lines.push(dep.reason);
  } else {
    status.lines.push(chainText);
  }

  // ---- money
  let money: DashboardData["money"] = null;
  if (snap) {
    const credit = meter(snap.creditDrawn, snap.creditLimit, decimals);
    const stormPlan = snap.plans[1];
    const payout = u(snap.coverPayout);
    const cover: NonNullable<DashboardData["money"]>["cover"] = snap.coverClaimed
      ? { state: "paid", value: `+${n(snap.coverPayout)}`, label: snap.isStorm ? "Paid this storm" : "Paid last storm" }
      : snap.isStorm
        ? { state: "ready", value: n(snap.coverPayout), label: "Ready to claim" }
        : { state: "standby", value: n(snap.coverPayout), label: "On standby" };
    money = {
      cash: n(snap.safeBalance),
      fund: n(snap.vaultAssets),
      credit,
      cover,
      hints: {
        cash: "The shop's shared wallet (a 2-of-3 Safe), ready to pay staff and suppliers.",
        fund: "Spare cash in a money-market fund. The agent brings it back before a storm.",
        credit:
          stormPlan && stormPlan.creditCapPerEvent !== "0"
            ? `Emergency credit line. In a storm the agent may borrow up to ${u(stormPlan.creditCapPerEvent)}.`
            : "Emergency credit line for storms.",
        cover: activity.lastCoverPaid
          ? `Typhoon cover pays ${payout} once per Signal 8+ storm. Last paid ${activity.lastCoverPaid.when}.`
          : `Typhoon cover pays ${payout} once per storm, when Signal 8+ and GDACS are confirmed.`,
      },
    };
  }

  // ---- limits of the plan in force
  let limits: DashboardData["limits"] = null;
  const plan = snap && snap.activePlanId !== null ? snap.plans[snap.activePlanId] : null;
  if (snap && plan) {
    limits = {
      plan: plan.name,
      planName: plan.name === "storm" ? "Storm plan" : "Everyday plan",
      perTx: n(plan.perTxCap),
      planMeter: meter(plan.spentToday, plan.dailyCap, decimals),
      allMeter: meter(snap.spentAllToday, snap.dailyCeiling, decimals),
      creditMeter: plan.name === "storm" && plan.creditCapPerEvent !== "0" ? meter(snap.drawnInEvent, plan.creditCapPerEvent, decimals) : null,
      allowed: actionWords(plan.actions),
      active: plan.active,
    };
  }

  const deploymentText = dep.ok ? `${dep.file}` : dep.reason;
  return {
    network: config.network,
    generatedAt: new Date(now).toISOString(),
    updatedLabel: whenLabel(now, ctx),
    symbol,
    chainId: dep.ok ? dep.deployment.chainId : null,
    safeQueueUrl: dep.ok && dep.deployment.chainId === 84532 ? `https://app.safe.global/transactions/queue?safe=basesep:${dep.deployment.contracts.Safe}` : null,
    connection: {
      deployment: { ok: dep.ok, text: deploymentText },
      chain: { ok: snap !== null, text: chainText },
      agent: { ok: decisionsRes.ok, text: decisionsRes.ok ? "Agent connected" : decisionsRes.reason },
      readErrors: snap?.readErrors ?? [],
    },
    status,
    money,
    limits,
    needsYou: { ok: decisionsRes.ok, items: activity.needsYou, total: activity.needsYouTotal },
    activity: {
      ok: snap !== null || decisionsRes.ok,
      reason: logsError ?? (!snap && decisionsRes.ok ? "Chain not connected: showing agent decisions only." : null),
      groups: activity.groups,
    },
    strip: activity.strip,
  };
}
