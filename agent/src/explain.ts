// Two-line explanations of decision log lines in the owner's language (PLAN.md §5.3.10). Deterministic: no model.
// Line 1 says what happened in plain words; line 2 says why (the plan rule or refusal reason), with an explorer link
// on Base Sepolia. Unknown reasons fall back to the raw reason, so nothing the agent did is ever hidden.
//
//   npm run explain                      # the last 10 decisions, all four languages
//   npm run explain -- --lang vi --last 5
//
// TRANSLATIONS NEED A NATIVE SPEAKER'S REVIEW (zh-Hant, zh-Hans, vi) before they are shown to a real owner.
// zh-Hant is standard written Chinese with Hong Kong vocabulary (出糧, 風球, 東主), not colloquial Cantonese.

import { loadConfig } from "./config.ts";
import { isMain } from "./isMain.ts";
import { DecisionLog } from "./log.ts";
import { loadPlanBook } from "./plan.ts";
import type { Decision } from "./types.ts";

export const LANGS = ["en", "zh-Hant", "zh-Hans", "vi"] as const;
export type Lang = (typeof LANGS)[number];
export type Explanation = [string, string];

export interface ExplainOpts {
  /** Overrides decision.tx. */
  tx?: `0x${string}`;
  /** 84532 (Base Sepolia) adds a Basescan link to line 2. */
  chainId?: number;
  /** Payee address (any case) → display name, e.g. from the plan book. */
  names?: Map<string, string> | Record<string, string>;
}

const EXPLORERS: Record<number, string> = { 84532: "https://sepolia.basescan.org/tx/" };

/** The decision fields explain() reads; a full Decision line fits. */
export type Explainable = Pick<Decision, "stage" | "outcome"> & Partial<Pick<Decision, "reason" | "action" | "summary" | "tx" | "input">>;

type Plan = "base" | "storm";

/** What the summary line says was done, parsed from the fixed phrasings in exec/calls.ts describe() and the loops. */
type Fact =
  | { kind: "pay"; amount: string; who: string; plan: Plan }
  | { kind: "payroll"; period: string; staff: string; amount: string }
  | { kind: "vault_deposit"; amount: string }
  | { kind: "vault_withdraw"; amount: string; plan: Plan }
  | { kind: "credit_draw"; amount: string }
  | { kind: "cover_claim"; amount?: string }
  | { kind: "anchor"; what: string }
  | { kind: "no_payment"; who: string; amount: string; currency: string }
  | { kind: "other"; text: string };

function lookup(names: ExplainOpts["names"], key: string): string | undefined {
  if (!names) return undefined;
  const k = key.toLowerCase();
  if (names instanceof Map) return names.get(k) ?? names.get(key);
  return names[k] ?? names[key];
}

/** "Lee Kee Flour (fictional)" → "Lee Kee Flour"; addresses go through the name lookup first. */
function displayName(who: string, names: ExplainOpts["names"]): string {
  const named = /^0x[0-9a-fA-F]{40}$/.test(who) ? (lookup(names, who) ?? `${who.slice(0, 6)}…${who.slice(-4)}`) : who;
  return named.replace(/\s*\(fictional\)\s*/g, " ").trim();
}

export function parseSummary(d: Explainable, names?: ExplainOpts["names"]): Fact {
  const s = (d.summary ?? "").replace(/^Owner proposal:\s*/, "");
  let m: RegExpExecArray | null;
  if ((m = /^Pay ([\d.]+) mUSD to (.+?) under the (base|storm) plan/.exec(s))) return { kind: "pay", amount: m[1]!, who: displayName(m[2]!, names), plan: m[3] as Plan };
  if ((m = /^payroll (\S+), (\d+) staff, ([\d.]+) mUSD/.exec(s))) return { kind: "payroll", period: m[1]!, staff: m[2]!, amount: m[3]! };
  if ((m = /^Move ([\d.]+) mUSD of surplus into the money-market vault/.exec(s))) return { kind: "vault_deposit", amount: m[1]! };
  if ((m = /^Withdraw ([\d.]+) mUSD from the vault to the Safe \((base|storm) plan\)/.exec(s))) return { kind: "vault_withdraw", amount: m[1]!, plan: m[2] as Plan };
  if ((m = /^Draw ([\d.]+) mUSD of emergency credit/.exec(s))) return { kind: "credit_draw", amount: m[1]! };
  if ((m = /^Claimed the typhoon cover: ([\d,.]+) mUSD/.exec(s))) return { kind: "cover_claim", amount: m[1]!.replace(/,/g, "") };
  if (/^Claim the typhoon cover payout/.test(s)) return { kind: "cover_claim" };
  if ((m = /^Anchor (PRE_STORM|DAILY_REPORT|ATTACK_LOG) evidence hash/.exec(s))) return { kind: "anchor", what: m[1]! };
  if ((m = /^No payment for "(.*)" ([\d.]+) (USD|HKD|VND)/.exec(s))) return { kind: "no_payment", who: displayName(m[1]!, names), amount: m[2]!, currency: m[3]! };
  return { kind: "other", text: d.summary ?? d.action ?? d.input ?? "" };
}

/** 1250.5 → "1,250.50" (en, zh) or "1.250,50" (vi); whole amounts keep no decimals. */
function money(amount: string, lang: Lang): string {
  const n = Number(amount);
  const frac = !Number.isInteger(n);
  return n.toLocaleString(lang === "vi" ? "vi-VN" : "en-US", { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 });
}

const PLAN_NAME: Record<Lang, Record<Plan, string>> = {
  en: { base: "everyday plan", storm: "storm plan" },
  "zh-Hant": { base: "平日計劃", storm: "風暴計劃" },
  "zh-Hans": { base: "日常计划", storm: "风暴计划" },
  vi: { base: "kế hoạch ngày thường", storm: "kế hoạch bão" },
};

const EVIDENCE: Record<Lang, Record<string, string>> = {
  en: { PRE_STORM: "pre-storm", DAILY_REPORT: "daily report", ATTACK_LOG: "attack log" },
  "zh-Hant": { PRE_STORM: "風暴前", DAILY_REPORT: "每日報告", ATTACK_LOG: "攻擊紀錄" },
  "zh-Hans": { PRE_STORM: "风暴前", DAILY_REPORT: "每日报告", ATTACK_LOG: "攻击记录" },
  vi: { PRE_STORM: "trước bão", DAILY_REPORT: "báo cáo ngày", ATTACK_LOG: "nhật ký tấn công" },
};

/**
 * One action in each language. English needs three forms (past / infinitive / -ing); Chinese and Vietnamese use one
 * verb phrase with an outcome word in front (已 / 沒有, Đã / Không).
 */
interface Phrase {
  past: string;
  inf: string;
  ing: string;
  zhHant: string;
  zhHans: string;
  vi: string;
}

function phrase(f: Exclude<Fact, { kind: "other" }>, lang: Lang): Phrase {
  const a = "amount" in f && f.amount ? `${money(f.amount, lang)} mUSD` : "";
  const P = (l: Lang, p: Plan) => PLAN_NAME[l][p];
  switch (f.kind) {
    case "pay": {
      const en = `${f.who} ${a} under the ${P("en", f.plan)}`;
      return { past: `Paid ${en}`, inf: `pay ${en}`, ing: `paying ${en}`, zhHant: `按${P("zh-Hant", f.plan)}向 ${f.who} 付款 ${a}`, zhHans: `按${P("zh-Hans", f.plan)}向 ${f.who} 付款 ${a}`, vi: `trả ${f.who} ${a} theo ${P("vi", f.plan)}` };
    }
    case "payroll": {
      const en = `payroll ${f.period} (${f.staff} staff, ${a})`;
      return { past: `Paid ${en}`, inf: `pay ${en}`, ing: `paying ${en}`, zhHant: `發放 ${f.period} 的薪金（${f.staff} 位員工，${a}）`, zhHans: `发放 ${f.period} 的工资（${f.staff} 名员工，${a}）`, vi: `trả lương kỳ ${f.period} (${f.staff} nhân viên, ${a})` };
    }
    case "vault_deposit":
      return { past: `Moved ${a} of spare cash into the money-market fund`, inf: `move ${a} of spare cash into the money-market fund`, ing: `moving ${a} into the money-market fund`, zhHant: `把 ${a} 多餘現金存入貨幣市場基金`, zhHans: `把 ${a} 闲置资金存入货币市场基金`, vi: `chuyển ${a} tiền dư vào quỹ thị trường tiền tệ` };
    case "vault_withdraw":
      return { past: `Took ${a} out of the money-market fund (${P("en", f.plan)})`, inf: `take ${a} out of the money-market fund`, ing: `taking ${a} out of the money-market fund`, zhHant: `從貨幣市場基金取回 ${a}（${P("zh-Hant", f.plan)}）`, zhHans: `从货币市场基金取回 ${a}（${P("zh-Hans", f.plan)}）`, vi: `rút ${a} từ quỹ thị trường tiền tệ (${P("vi", f.plan)})` };
    case "credit_draw":
      return { past: `Drew ${a} from the emergency credit line`, inf: `draw ${a} from the emergency credit line`, ing: `drawing ${a} from the emergency credit line`, zhHant: `從應急信貸額提取 ${a}`, zhHans: `从应急信贷额度提取 ${a}`, vi: `rút ${a} từ hạn mức tín dụng khẩn cấp` };
    case "cover_claim": {
      const paid = a ? `: ${a} paid into the shop's wallet` : "";
      return { past: `Claimed the typhoon cover${paid}`, inf: "claim the typhoon cover", ing: "claiming the typhoon cover", zhHant: `申領颱風保險${a ? `，${a} 已存入店舖錢包` : ""}`, zhHans: `申领台风保险${a ? `，${a} 已存入店铺钱包` : ""}`, vi: `yêu cầu bảo hiểm bão${a ? `, ${a} đã vào ví của cửa hàng` : ""}` };
    }
    case "anchor": {
      const w = (l: Lang) => EVIDENCE[l][f.what] ?? f.what;
      return { past: `Recorded a ${w("en")} evidence fingerprint on-chain`, inf: `record a ${w("en")} evidence fingerprint`, ing: `recording a ${w("en")} evidence fingerprint`, zhHant: `把${w("zh-Hant")}證據指紋記錄在鏈上`, zhHans: `把${w("zh-Hans")}证据指纹记录在链上`, vi: `ghi dấu vân tay bằng chứng ${w("vi")} lên chuỗi khối` };
    }
    case "no_payment": {
      // "0 USD" (nothing extracted) and "unknown" payees are left out rather than shown.
      const amt = Number(f.amount) > 0 ? `${money(f.amount, lang)} ${f.currency}` : "";
      const who = f.who === "unknown" ? "" : f.who;
      const en = [who, amt].filter(Boolean).join(" ") || "anything";
      const zh = `${who ? `向 ${who} ` : ""}付款${amt ? ` ${amt}` : ""}`;
      const vi = [who, amt].filter(Boolean).join(" ") || "khoản nào";
      return { past: `Paid ${en}`, inf: `pay ${en}`, ing: `paying ${en}`, zhHant: zh, zhHans: zh, vi: `trả ${vi}` };
    }
  }
}

function line1(d: Explainable, f: Fact, lang: Lang): string {
  if (f.kind === "other") {
    const label = {
      en: { executed: "Done", proposed: "Sent to the owners", refused: "Stopped" },
      "zh-Hant": { executed: "已完成", proposed: "已交東主處理", refused: "已停止" },
      "zh-Hans": { executed: "已完成", proposed: "已交店主处理", refused: "已停止" },
      vi: { executed: "Đã xong", proposed: "Đã gửi chủ cửa hàng", refused: "Đã dừng" },
    }[lang][d.outcome];
    const colon = lang.startsWith("zh") ? "：" : ": ";
    return `${label}${colon}${f.text}`;
  }
  const p = phrase(f, lang);
  switch (lang) {
    case "en":
      return d.outcome === "executed" ? `${p.past}.` : d.outcome === "proposed" ? `Asked the owners to approve ${p.ing}.` : `Did not ${p.inf}.`;
    case "zh-Hant":
      return d.outcome === "executed" ? `已${p.zhHant}。` : d.outcome === "proposed" ? `已請東主批准${p.zhHant}。` : `沒有${p.zhHant}。`;
    case "zh-Hans":
      return d.outcome === "executed" ? `已${p.zhHans}。` : d.outcome === "proposed" ? `已请店主批准${p.zhHans}。` : `没有${p.zhHans}。`;
    case "vi":
      return d.outcome === "executed" ? `Đã ${p.vi}.` : d.outcome === "proposed" ? `Đã đề nghị chủ cửa hàng duyệt: ${p.vi}.` : `Không ${p.vi}.`;
  }
}

type Reasons = Record<Lang, string>;

/** PlanModule / localCheck error names (contracts.md#agent-functions) and the agent's own named refusals. */
const ERRORS: Record<string, Reasons> = {
  PayeeNotInPlan: {
    en: "This payee is not on the active plan's list.",
    "zh-Hant": "收款人不在現行計劃的名單上。",
    "zh-Hans": "收款人不在当前计划的名单上。",
    vi: "Người nhận không có trong danh sách của kế hoạch đang áp dụng.",
  },
  PayeeNotRegistered: {
    en: "This address is not a registered payee in any plan.",
    "zh-Hant": "這個地址不是任何計劃的登記收款人。",
    "zh-Hans": "这个地址不是任何计划的登记收款人。",
    vi: "Địa chỉ này không phải người nhận đã đăng ký trong kế hoạch nào.",
  },
  OverPerTxCap: {
    en: "It is above the plan's limit for a single payment.",
    "zh-Hant": "超出計劃的單筆付款上限。",
    "zh-Hans": "超出计划的单笔付款上限。",
    vi: "Khoản này vượt hạn mức một lần thanh toán của kế hoạch.",
  },
  OverDailyCap: {
    en: "It would go over the plan's daily limit.",
    "zh-Hant": "會超出計劃的每日上限。",
    "zh-Hans": "会超出计划的每日上限。",
    vi: "Khoản này sẽ vượt hạn mức trong ngày của kế hoạch.",
  },
  OverDailyCeiling: {
    en: "It would go over the daily ceiling for all plans together.",
    "zh-Hant": "會超出所有計劃合計的每日總上限。",
    "zh-Hans": "会超出所有计划合计的每日总上限。",
    vi: "Khoản này sẽ vượt mức trần chi trong ngày của tất cả kế hoạch cộng lại.",
  },
  OverCreditCap: {
    en: "It would draw more credit than the loan allows for one storm.",
    "zh-Hant": "提取的信貸會超出貸款條款容許的每次風暴上限。",
    "zh-Hans": "提取的信贷会超出贷款条款允许的每次风暴上限。",
    vi: "Khoản rút sẽ vượt mức tín dụng cho phép cho một cơn bão.",
  },
  RefUsed: {
    en: "This exact payment was already made (same reference), so it is never paid twice.",
    "zh-Hant": "同一參考編號的付款已經完成，不會重複付款。",
    "zh-Hans": "同一参考编号的付款已经完成，不会重复付款。",
    vi: "Khoản này đã được trả (cùng mã tham chiếu), nên không bao giờ trả hai lần.",
  },
  StormNotActive: {
    en: "The storm plan only works while two weather sources confirm a storm.",
    "zh-Hant": "風暴計劃只在兩個天氣來源都確認有風暴時才生效。",
    "zh-Hans": "风暴计划只在两个天气来源都确认有风暴时才生效。",
    vi: "Kế hoạch bão chỉ có hiệu lực khi hai nguồn thời tiết cùng xác nhận có bão.",
  },
  Paused: {
    en: "The assistant is paused; only the owners can restart it.",
    "zh-Hant": "助理已暫停運作，只有東主可以恢復。",
    "zh-Hans": "助理已暂停运作，只有店主可以恢复。",
    vi: "Trợ lý đang tạm dừng; chỉ chủ cửa hàng mới mở lại được.",
  },
  PlanInactive: {
    en: "That plan is switched off.",
    "zh-Hant": "該計劃已停用。",
    "zh-Hans": "该计划已停用。",
    vi: "Kế hoạch đó đang tắt.",
  },
  ActionNotAllowed: {
    en: "The active plan does not allow this kind of action.",
    "zh-Hant": "現行計劃不容許這類操作。",
    "zh-Hans": "当前计划不允许这类操作。",
    vi: "Kế hoạch đang áp dụng không cho phép loại thao tác này.",
  },
  Reverted: {
    en: "The blockchain rejected the transaction.",
    "zh-Hant": "區塊鏈拒絕了這筆交易。",
    "zh-Hans": "区块链拒绝了这笔交易。",
    vi: "Chuỗi khối đã từ chối giao dịch này.",
  },
  PlanHashMismatch: {
    en: "The local plan book differs from the one the owners signed, so the assistant stopped.",
    "zh-Hant": "本地計劃書與東主簽署的版本不同，助理已停止。",
    "zh-Hans": "本地计划书与店主签署的版本不同，助理已停止。",
    vi: "Sổ kế hoạch trên máy khác với bản chủ cửa hàng đã ký, nên trợ lý dừng lại.",
  },
  LedgerMismatch: {
    en: "The day's books did not match the blockchain, so the assistant paused itself.",
    "zh-Hant": "當日賬目與區塊鏈不符，助理已自行暫停。",
    "zh-Hans": "当日账目与区块链不符，助理已自行暂停。",
    vi: "Sổ sách trong ngày không khớp với chuỗi khối, nên trợ lý tự tạm dừng.",
  },
};

/** The planner's and extractor's refusal reasons (llm/planner.ts, llm/extractor.ts, loops/storm.ts). First match wins. */
const PATTERNS: Array<[RegExp, (m: RegExpExecArray) => Reasons]> = [
  [
    /address not in payee registry/,
    () => ({
      en: "The message asked for payment to an address that is not on the owners' payee list.",
      "zh-Hant": "訊息要求付款到一個不在東主收款人名單上的地址。",
      "zh-Hans": "消息要求付款到一个不在店主收款人名单上的地址。",
      vi: "Tin nhắn yêu cầu trả tiền tới một địa chỉ không có trong danh sách người nhận của chủ cửa hàng.",
    }),
  ],
  [
    /bank detail changes go through/,
    () => ({
      en: "A message can never change bank details; only the owners can, with a 24-hour wait.",
      "zh-Hant": "訊息不能更改收款戶口；只有東主可以更改，而且要等 24 小時才生效。",
      "zh-Hans": "消息不能更改收款账户；只有店主可以更改，而且要等 24 小时才生效。",
      vi: "Tin nhắn không bao giờ đổi được thông tin tài khoản; chỉ chủ cửa hàng mới đổi được, sau 24 giờ chờ.",
    }),
  ],
  [
    /invoice (\S+) already paid(?: on (\S+))?/,
    (m) => ({
      en: `Invoice ${m[1]} was already paid${m[2] ? ` on ${m[2]}` : ""}.`,
      "zh-Hant": `發票 ${m[1]} 已經付款${m[2] ? `（${m[2]}）` : ""}。`,
      "zh-Hans": `发票 ${m[1]} 已经付款${m[2] ? `（${m[2]}）` : ""}。`,
      vi: `Hóa đơn ${m[1]} đã được thanh toán${m[2] ? ` ngày ${m[2]}` : ""}.`,
    }),
  ],
  [
    /re-issue of (\S+)/,
    (m) => ({
      en: `It looks like invoice ${m[1]} sent again under a new number (same supplier and amount); the owners decide.`,
      "zh-Hant": `看來是發票 ${m[1]} 換了新編號再發一次（同一供應商、同一金額），由東主決定。`,
      "zh-Hans": `看起来是发票 ${m[1]} 换了新编号再发一次（同一供应商、同一金额），由店主决定。`,
      vi: `Có vẻ là hóa đơn ${m[1]} gửi lại với số mới (cùng nhà cung cấp, cùng số tiền); chủ cửa hàng sẽ quyết định.`,
    }),
  ],
  [
    /above purchase order (\S+) \(([\d.]+)\)/,
    (m) => ({
      en: `The bill is above purchase order ${m[1]} (${money(m[2]!, "en")}), so the owners must approve it.`,
      "zh-Hant": `帳單金額高於採購單 ${m[1]}（${money(m[2]!, "zh-Hant")}），須由東主批准。`,
      "zh-Hans": `账单金额高于采购单 ${m[1]}（${money(m[2]!, "zh-Hans")}），须由店主批准。`,
      vi: `Hóa đơn cao hơn đơn đặt hàng ${m[1]} (${money(m[2]!, "vi")}), nên chủ cửa hàng phải duyệt.`,
    }),
  ],
  [
    /no purchase order for (\S+)/,
    (m) => ({
      en: `This supplier needs a purchase order and there is none for ${m[1]}; the owners decide.`,
      "zh-Hant": `這間供應商需要採購單，但 ${m[1]} 沒有採購單，由東主決定。`,
      "zh-Hans": `这家供应商需要采购单，但 ${m[1]} 没有采购单，由店主决定。`,
      vi: `Nhà cung cấp này cần đơn đặt hàng nhưng ${m[1]} không có; chủ cửa hàng sẽ quyết định.`,
    }),
  ],
  [
    /supplier payments? (?:wait until the storm passes|held during the storm)/,
    () => ({
      en: "During a storm, supplier payments wait until it passes; the owners approve them afterwards.",
      "zh-Hant": "風暴期間供應商付款暫緩，風暴過後由東主批准。",
      "zh-Hans": "风暴期间供应商付款暂缓，风暴过后由店主批准。",
      vi: "Trong bão, các khoản trả nhà cung cấp chờ đến khi bão qua; chủ cửa hàng duyệt sau.",
    }),
  ],
  [
    /payroll on an ordinary day/,
    () => ({
      en: "On an ordinary day wages need two owners to sign; the assistant pays staff by itself only in a storm.",
      "zh-Hant": "平日出糧需要兩位東主簽署；只有風暴期間助理才會自行出糧。",
      "zh-Hans": "平日发工资需要两位店主签字；只有风暴期间助理才会自行发工资。",
      vi: "Ngày thường, trả lương cần hai chủ cửa hàng ký; trợ lý chỉ tự trả lương khi có bão.",
    }),
  ],
  [
    /payroll is paid from payroll\.json|payday loop pays staff/,
    () => ({
      en: "Wages are paid from the owners' payroll list on schedule, never because a message asks.",
      "zh-Hant": "薪金按東主的出糧名單準時發放，不會因為一則訊息而付款。",
      "zh-Hans": "工资按店主的工资名单按时发放，不会因为一条消息而付款。",
      vi: "Lương được trả đúng hạn theo danh sách lương của chủ, không bao giờ theo yêu cầu của tin nhắn.",
    }),
  ],
  [
    /payroll total (\S+) differs from payroll\.json \((\S+)\)/,
    (m) => ({
      en: `The wage total in the message (${m[1]}) differs from the payroll list (${m[2]}).`,
      "zh-Hant": `訊息中的薪金總額（${m[1]}）與出糧名單（${m[2]}）不符。`,
      "zh-Hans": `消息中的工资总额（${m[1]}）与工资名单（${m[2]}）不符。`,
      vi: `Tổng lương trong tin nhắn (${m[1]}) khác với danh sách lương (${m[2]}).`,
    }),
  ],
  [
    /is not a (base|storm)-plan payee/,
    (m) => ({
      en: `This payee is not covered by the ${PLAN_NAME.en[m[1] as Plan]}, so the owners must approve.`,
      "zh-Hant": `這位收款人不在${PLAN_NAME["zh-Hant"][m[1] as Plan]}之內，須由東主批准。`,
      "zh-Hans": `这位收款人不在${PLAN_NAME["zh-Hans"][m[1] as Plan]}之内，须由店主批准。`,
      vi: `Người nhận này không thuộc ${PLAN_NAME.vi[m[1] as Plan]}, nên chủ cửa hàng phải duyệt.`,
    }),
  ],
  [
    /^not an invoice$/,
    () => ({
      en: "The message is not a bill, so there is nothing to pay.",
      "zh-Hant": "這則訊息不是帳單，無需付款。",
      "zh-Hans": "这条消息不是账单，无需付款。",
      vi: "Tin nhắn này không phải hóa đơn, nên không có gì để trả.",
    }),
  ],
  [
    /^no amount$/,
    () => ({ en: "No amount due was found.", "zh-Hant": "找不到應付金額。", "zh-Hans": "找不到应付金额。", vi: "Không tìm thấy số tiền phải trả." }),
  ],
  [
    /^currency (\w+) does not match/,
    (m) => ({
      en: `The bill is in ${m[1]}, which this wallet does not pay in.`,
      "zh-Hant": `帳單以 ${m[1]} 計算，這個錢包不以此貨幣付款。`,
      "zh-Hans": `账单以 ${m[1]} 计价，这个钱包不以该货币付款。`,
      vi: `Hóa đơn tính bằng ${m[1]}, ví này không trả bằng loại tiền đó.`,
    }),
  ],
  [
    /^no invoice id/,
    () => ({
      en: "The bill has no invoice number, so it could be paid twice; it was not paid.",
      "zh-Hant": "帳單沒有發票編號，可能被重複付款，所以沒有付款。",
      "zh-Hans": "账单没有发票编号，可能被重复付款，所以没有付款。",
      vi: "Hóa đơn không có số, có thể bị trả hai lần, nên không trả.",
    }),
  ],
  [
    /^payee not in registry$/,
    () => ({
      en: "The payee is not on the owners' payee list.",
      "zh-Hant": "收款人不在東主的收款人名單上。",
      "zh-Hans": "收款人不在店主的收款人名单上。",
      vi: "Người nhận không có trong danh sách người nhận của chủ cửa hàng.",
    }),
  ],
  [
    /^(invalid extractor output|extractor declined|input over \d+ characters)/,
    () => ({
      en: "The message could not be read safely as a bill, so it was dropped.",
      "zh-Hant": "這則訊息無法安全地讀成帳單，已被略過。",
      "zh-Hans": "这条消息无法安全地读成账单，已被丢弃。",
      vi: "Không thể đọc tin nhắn này một cách an toàn như một hóa đơn, nên đã bỏ qua.",
    }),
  ],
];

/** Line 2 without a recorded reason: the rule that let it through, or why the owners were asked. */
function defaultWhy(d: Explainable, f: Fact, lang: Lang): string {
  // Notices, drafts and inflow matches move no money from the Safe: say only who acts next.
  if (f.kind === "other" && d.outcome !== "refused") {
    return d.outcome === "executed"
      ? { en: "Recorded in the assistant's log.", "zh-Hant": "已記錄在助理的紀錄中。", "zh-Hans": "已记录在助理的日志中。", vi: "Đã ghi vào nhật ký của trợ lý." }[lang]
      : { en: "Waiting for the owners to review it.", "zh-Hant": "等待東主審閱。", "zh-Hans": "等待店主审阅。", vi: "Đang chờ chủ cửa hàng xem xét." }[lang];
  }
  const plan = f.kind === "pay" || f.kind === "vault_withdraw" ? f.plan : f.kind === "credit_draw" || f.kind === "cover_claim" ? "storm" : undefined;
  if (d.outcome === "executed") {
    if (!plan) return { en: "Allowed by the plan the owners signed.", "zh-Hant": "符合東主簽署的計劃。", "zh-Hans": "符合店主签署的计划。", vi: "Được phép theo kế hoạch chủ cửa hàng đã ký." }[lang];
    const n = PLAN_NAME[lang][plan];
    return {
      en: `Within the ${n} the owners signed, so no extra signature was needed.`,
      "zh-Hant": `在東主簽署的${n}範圍內，無需額外簽署。`,
      "zh-Hans": `在店主签署的${n}范围内，无需额外签字。`,
      vi: `Nằm trong ${n} chủ cửa hàng đã ký, nên không cần ký thêm.`,
    }[lang];
  }
  if (d.outcome === "proposed") {
    return {
      en: "The assistant may not do this alone; two owners must sign in Safe Wallet.",
      "zh-Hant": "助理不能自行處理，須由兩位東主在 Safe Wallet 簽署。",
      "zh-Hans": "助理不能自行处理，须由两位店主在 Safe Wallet 签字。",
      vi: "Trợ lý không được tự làm việc này; hai chủ cửa hàng phải ký trong Safe Wallet.",
    }[lang];
  }
  return { en: "No reason was recorded.", "zh-Hant": "沒有記錄原因。", "zh-Hans": "没有记录原因。", vi: "Không có lý do được ghi lại." }[lang];
}

/** The plain-language reason, or undefined when the reason is not one we know (the caller shows it raw). */
export function explainReason(reason: string, lang: Lang): string | undefined {
  const named = ERRORS[reason.trim()];
  if (named) return named[lang];
  for (const [re, f] of PATTERNS) {
    const m = re.exec(reason);
    if (m) return f(m)[lang];
  }
  return undefined;
}

const RAW_LABEL: Record<Lang, string> = { en: "Reason: ", "zh-Hant": "原因：", "zh-Hans": "原因：", vi: "Lý do: " };
const LINK_LABEL: Record<Lang, string> = { en: "Transaction: ", "zh-Hant": "交易紀錄：", "zh-Hans": "交易记录：", vi: "Giao dịch: " };

export function explain(d: Explainable, lang: Lang, opts: ExplainOpts = {}): Explanation {
  const f = parseSummary(d, opts.names);
  const why = d.reason ? (explainReason(d.reason, lang) ?? `${RAW_LABEL[lang]}${d.reason}`) : defaultWhy(d, f, lang);
  const tx = opts.tx ?? d.tx;
  const explorer = opts.chainId !== undefined ? EXPLORERS[opts.chainId] : undefined;
  const link = tx && explorer ? ` ${LINK_LABEL[lang]}${explorer}${tx}` : "";
  return [line1(d, f, lang), `${why}${link}`];
}

export function explainAll(d: Explainable, opts: ExplainOpts = {}): Record<Lang, Explanation> {
  return Object.fromEntries(LANGS.map((l) => [l, explain(d, l, opts)])) as Record<Lang, Explanation>;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (isMain(import.meta.url)) {
  const cfg = loadConfig();
  const lang = arg("--lang");
  if (lang !== undefined && !(LANGS as readonly string[]).includes(lang)) {
    console.error(`--lang must be one of ${LANGS.join(", ")}`);
    process.exit(1);
  }
  const last = Number(arg("--last") ?? 10);
  const names = new Map<string, string>();
  try {
    for (const p of loadPlanBook(cfg.planBookPath).payees) names.set(p.address.toLowerCase(), p.name);
  } catch {
    // no plan book: addresses are shortened instead of named
  }
  const lines = new DecisionLog(cfg.logDir, false).readNewest(Number.isFinite(last) && last > 0 ? last : 10).reverse();
  if (lines.length === 0) console.log(`No decisions in ${cfg.logDir}/decisions.jsonl`);
  for (const d of lines) {
    console.log(`${d.ts}  ${d.input}`);
    for (const l of lang ? [lang as Lang] : LANGS) {
      const [a, b] = explain(d, l, { names, chainId: cfg.chainId });
      console.log(`  [${l}] ${a}\n  ${" ".repeat(l.length + 2)} ${b}`);
    }
  }
}
