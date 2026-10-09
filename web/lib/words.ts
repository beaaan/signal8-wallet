// Plain-language wording shared by the server and the browser. Pure; safe to import anywhere.

/** Contract error names and agent reasons, in words an owner understands. Unknown reasons pass through. */
const REASONS: Record<string, string> = {
  RefUsed: "already paid (this payment reference was used before)",
  PayeeNotInPlan: "not an approved payee for the plan in force",
  PayeeNotRegistered: "not an approved payee",
  OverPerTxCap: "over the per-payment limit",
  OverDailyCap: "over today's limit for this plan",
  OverDailyCeiling: "over the overall daily limit",
  OverCreditCap: "over the credit allowed for this storm",
  Paused: "the agent is paused",
  PlanInactive: "this plan is switched off",
  StormNotActive: "only allowed while storm mode is on",
  ActionNotAllowed: "the plan in force does not allow this",
  NotAgent: "only the agent may do this",
  ExecFailed: "the wallet refused the transfer",
  Reverted: "the transaction failed on-chain",
  PlanHashMismatch: "the plan book does not match the plan the owners signed",
  NoStorm: "no confirmed storm",
  AlreadyClaimed: "the cover was already paid for this storm",
  "forecast above buffer": "enough cash on hand, no loan needed",
  "extractor declined": "it did not look like a real invoice or payroll message",
  "no action": "nothing to do",
};

export function plainReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const r = reason.trim();
  if (REASONS[r]) return REASONS[r];
  if (/^invalid extractor output/i.test(r)) return "it did not look like a real invoice (the reader could not make sense of it)";
  if (/^input over \d+ characters/i.test(r)) return "the message was too long";
  if (/^extractor error/i.test(r)) return "the message reader failed, so nothing was paid";
  // A bare CamelCase error name we do not know yet: "SomethingWentWrong" → "something went wrong"
  if (/^[A-Z][a-zA-Z]+$/.test(r)) return r.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return r;
}

/** Where a decision came from, from the agent's `input` label (e.g. "invoice:inv-001.txt", "storm:TC8NW"). */
export function sourceLabel(input: string | null | undefined): string | null {
  if (!input) return null;
  const [kind, rest = ""] = input.split(":", 2);
  switch (kind) {
    case "invoice":
      return "Invoice";
    case "email":
      return "Email";
    case "chat":
      return "Chat message";
    case "zalo":
      return "Zalo message";
    case "arena":
      return "Arena attempt";
    case "storm":
      return rest ? `Signal ${signalFromCode(rest) ?? rest}` : "Storm watch";
    case "payday":
      return "Payday";
    case "sweep":
      return "Daily cash sweep";
    case "inflow":
      return "Customer payment";
    case "report":
      return "Daily report";
    default:
      return null;
  }
}

/** HKO warning code → signal number: TC1 → 1, TC8NW → 8, CANCEL → 0. */
export function signalFromCode(code: string): number | null {
  if (/^cancel/i.test(code)) return 0;
  const m = /^TC(\d+)/i.exec(code);
  return m ? Number(m[1]) : null;
}

export function hkoName(level: number | null | undefined): string {
  if (level === null || level === undefined) return "unknown";
  return level === 0 ? "No signal" : `Signal No. ${level}`;
}

export const GDACS_NAMES = ["None", "Green", "Orange", "Red"] as const;
export function gdacsName(level: number | null | undefined): string {
  if (level === null || level === undefined) return "unknown";
  return GDACS_NAMES[level] ?? `Level ${level}`;
}

/** Arena and decision outcomes as a short badge plus a plain sentence. */
export function outcomeWords(outcome: string, stage: string): { badge: string; tone: "good" | "bad" | "wait"; text: string } {
  if (outcome === "executed") return { badge: "Went through", tone: "bad", text: "The agent acted on it." };
  if (outcome === "proposed") return { badge: "Sent to owners", tone: "wait", text: "Not paid. The owners must approve it." };
  switch (stage) {
    case "extractor":
      return { badge: "Blocked at reading", tone: "good", text: "The reader found no genuine invoice in it." };
    case "planner":
      return { badge: "Blocked at planning", tone: "good", text: "The planner found nothing the plan allows." };
    case "localCheck":
      return { badge: "Blocked by plan limits", tone: "good", text: "It broke a rule of the signed plan." };
    case "chain":
      return { badge: "Blocked on-chain", tone: "good", text: "The contract refused it." };
    case "owner":
      return { badge: "Refused by owners", tone: "good", text: "The owners said no." };
  }
  return { badge: "Blocked", tone: "good", text: "Nothing was paid." };
}

/** Action bits (ACT_*) in words. */
export const ACTION_WORDS: [number, string][] = [
  [1, "pay approved payees"],
  [2, "put spare cash in the fund"],
  [4, "take cash out of the fund"],
  [8, "borrow from the credit line"],
  [16, "claim the typhoon cover"],
];
export function actionWords(bits: number): string[] {
  return ACTION_WORDS.filter(([b]) => (bits & b) !== 0).map(([, w]) => w);
}
