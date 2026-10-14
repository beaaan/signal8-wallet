// After-storm drafts for the owner: insurance claim letter, deadline list and (Yagi variant) a Vietnamese loan
// restructuring request under SBV Circular 53/2024/TT-NHNN. Spec: docs/PLAN.md §5.3 item 9, docs/specs/agent.md.
//
// The agent only writes drafts: Markdown files in <logDir>/drafts/<runId>/ and one decision line each
// (stage owner, outcome proposed). The owner reviews, signs and sends them; the agent never sends anything.
// Pure templates (no model call): every fact comes from the storm loop's record and the chain, never from untrusted text.
//
//   npx tsx src/drafts.ts --event yagi-2024     # preview the drafts with sample facts (no chain)

import { mkdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { isFiscoNetwork } from "./config.ts";
import { fmt } from "./exec/calls.ts";
import { isMain } from "./isMain.ts";
import { DecisionLog } from "./log.ts";
import type { Hex } from "./policy/localCheck.ts";
import { tokenSymbol } from "./token.ts";

export interface HeldPayment {
  payee: string;
  amount: string;
  invoiceId?: string;
  dueDate?: string; // YYYY-MM-DD
}

/** What the storm loop saw, plus deployment facts. Every field is from code or the chain. */
export interface DraftContext {
  runId: string;
  business: string;
  eventName: string; // e.g. "Super Typhoon Ragasa"
  region: string; // "HK" or a VN province code such as "VN-QN-HP"
  timeZone: string;
  network: string;
  chainId: number;
  stormStart?: Date; // official time the storm trigger fired (Signal 8 / risk level 4)
  stormEnd: Date; // official time it ended (Signal 3 or below)
  safe: Hex;
  cover?: { contract: Hex; eventId?: Hex; tx?: Hex; payout?: bigint };
  preStorm?: { hash: Hex; tx?: Hex; signal?: string; at?: Date };
  credit?: { amount: bigint; tx?: Hex; outstanding?: bigint };
  payroll: { period: string; payday: string; total: bigint; staff: number; paidInStorm: boolean };
  held: HeldPayment[];
  /** Fictional demo terms; the owner checks them against the real policy and loan (data/fixtures/policy.txt, loan.txt). */
  terms?: { claimWindowDays?: number; sweepPercent?: number };
  /** Token symbol for amounts (default: the agent's token, mUSD or mVND; see token.ts). */
  token?: string;
}

const tok = (c: DraftContext) => c.token ?? tokenSymbol();

/** Who approves an owner proposal: two Safe owners, or on the local FISCO chain the standalone wallet's one owner. */
const approvers = (c: DraftContext) => (isFiscoNetwork(c.network) ? "the owner approves it (standalone wallet on the local FISCO chain)" : "two owners sign in Safe Wallet");

export interface Draft {
  file: string; // file name inside the run's drafts folder
  title: string;
  lang: "en" | "zh-Hant" | "vi";
  body: string;
}

const CLAIM_WINDOW_DAYS = 30;
const SWEEP_PERCENT = 10;

export const isVietnam = (region: string) => region.startsWith("VN");

export function explorerTx(chainId: number, tx?: Hex): string {
  if (!tx) return "(no transaction)";
  if (chainId === 84532) return `[${tx}](https://sepolia.basescan.org/tx/${tx})`;
  return `\`${tx}\` (chain ${chainId}, local)`;
}

function day(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function stamp(d: Date, timeZone: string): string {
  const s = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" }).format(d);
  return s;
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function nextMonth(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

const DRAFT_NOTE = "_Draft prepared by the Signal 8 Wallet agent. Check every figure, sign and send it yourself; the agent never sends it._";

export function claimLetterEn(c: DraftContext): Draft {
  const tz = c.timeZone;
  const window = c.terms?.claimWindowDays ?? CLAIM_WINDOW_DAYS;
  const lines = [
    `# Insurance claim: ${c.eventName}`,
    "",
    DRAFT_NOTE,
    "",
    `To: the Insurer, typhoon cover (parametric)`,
    `From: ${c.business}`,
    `Date: ${day(new Date(), tz)}`,
    `Re: ${c.eventName}, ${c.stormStart ? `${stamp(c.stormStart, tz)} to ` : "ended "}${stamp(c.stormEnd, tz)}`,
    "",
    "Dear Sir or Madam,",
    "",
    `We write to confirm the parametric benefit already paid under our typhoon cover for ${c.eventName}, and to claim for the losses the benefit does not cover.`,
    "",
    "## Facts on record",
    "",
    `| Item | Value |`,
    `| --- | --- |`,
    `| Insured account (Safe) | \`${c.safe}\` |`,
    `| Cover contract | ${c.cover ? `\`${c.cover.contract}\`` : "(not claimed)"} |`,
    `| Cover event id | ${c.cover?.eventId ? `\`${c.cover.eventId}\`` : "(not recorded)"} |`,
    `| Parametric payout | ${c.cover?.payout !== undefined ? `${fmt(c.cover.payout)} ${tok(c)}` : "(not recorded)"} |`,
    `| Payout transaction | ${explorerTx(c.chainId, c.cover?.tx)} |`,
    `| Pre-storm evidence hash (PRE_STORM) | ${c.preStorm ? `\`${c.preStorm.hash}\`` : "(none)"} |`,
    `| Evidence anchor transaction | ${explorerTx(c.chainId, c.preStorm?.tx)} |`,
    `| Evidence taken at | ${c.preStorm?.at ? `${stamp(c.preStorm.at, tz)}${c.preStorm.signal ? `, signal ${c.preStorm.signal}` : ""}` : "(none)"} |`,
    `| Network | ${c.network} (chain id ${c.chainId}) |`,
    "",
    "The pre-storm evidence hash commits to our premises photos and stock records taken before the storm arrived. We can provide the original files; anyone can recompute the hash and compare it with the anchored value.",
    "",
    "## Losses claimed beyond the parametric benefit",
    "",
    "| Loss | Amount | Evidence |",
    "| --- | --- | --- |",
    "| (stock spoiled, repairs, lost trading days) | (owner to fill) | (photos, receipts) |",
    "",
    `We understand claims must be lodged within ${window} days of the event (by ${addDays(day(c.stormEnd, tz), window)}). Please confirm receipt and the documents you need.`,
    "",
    "Yours faithfully,",
    "",
    `${c.business}`,
    "(two owners sign)",
    "",
  ];
  return { file: "claim-en.md", title: "Insurance claim letter", lang: "en", body: lines.join("\n") };
}

export function claimLetterZhHant(c: DraftContext): Draft {
  const tz = c.timeZone;
  const window = c.terms?.claimWindowDays ?? CLAIM_WINDOW_DAYS;
  const lines = [
    `# 保險索償：${c.eventName}`,
    "",
    "_此信由 Signal 8 Wallet 助理草擬。請核對所有數字，由東主簽署及寄出；助理不會代為寄出。_",
    "",
    `致：保險公司（颱風參數保險）`,
    `寄件人：${c.business}`,
    `日期：${day(new Date(), tz)}`,
    `事由：${c.eventName}，${c.stormStart ? `${stamp(c.stormStart, tz)} 至 ` : ""}${stamp(c.stormEnd, tz)}`,
    "",
    "敬啟者：",
    "",
    `本店確認已收到 ${c.eventName} 的颱風參數保險賠款，並就賠款未涵蓋的損失提出索償。`,
    "",
    "| 項目 | 內容 |",
    "| --- | --- |",
    `| 受保帳戶（Safe） | \`${c.safe}\` |`,
    `| 保險合約 | ${c.cover ? `\`${c.cover.contract}\`` : "（未申領）"} |`,
    `| 保險事件編號 | ${c.cover?.eventId ? `\`${c.cover.eventId}\`` : "（未記錄）"} |`,
    `| 參數賠款 | ${c.cover?.payout !== undefined ? `${fmt(c.cover.payout)} ${tok(c)}` : "（未記錄）"} |`,
    `| 賠款交易 | ${explorerTx(c.chainId, c.cover?.tx)} |`,
    `| 風暴前證據雜湊（PRE_STORM） | ${c.preStorm ? `\`${c.preStorm.hash}\`` : "（無）"} |`,
    `| 證據上鏈交易 | ${explorerTx(c.chainId, c.preStorm?.tx)} |`,
    "",
    "風暴前證據雜湊對應本店於風暴前拍攝的店舖相片及存貨紀錄，原檔可隨時提供，任何人都可重新計算雜湊並與鏈上紀錄比對。",
    "",
    "| 其他損失 | 金額 | 證明 |",
    "| --- | --- | --- |",
    "| （變壞存貨、維修、停業日數） | （東主填寫） | （相片、收據） |",
    "",
    `據我們理解，索償須於事件後 ${window} 日內（即 ${addDays(day(c.stormEnd, tz), window)} 或之前）提出。請確認收妥並告知所需文件。`,
    "",
    `${c.business}`,
    "（兩位東主簽署）",
    "",
  ];
  return { file: "claim-zh-Hant.md", title: "保險索償信", lang: "zh-Hant", body: lines.join("\n") };
}

export interface Deadline {
  date: string; // YYYY-MM-DD, or "" for no fixed date
  what: string;
  action: string;
}

export function deadlines(c: DraftContext): Deadline[] {
  const tz = c.timeZone;
  const end = day(c.stormEnd, tz);
  const out: Deadline[] = [];
  const p = c.payroll;
  const fisco = isFiscoNetwork(c.network);
  if (p.paidInStorm) {
    out.push({ date: nextMonth(p.payday), what: `Next payroll (${p.staff} staff, ${fmt(p.total)} ${tok(c)})`, action: `On an ordinary day payroll is an owner proposal: ${approvers(c)}.` });
  } else {
    out.push({ date: p.payday, what: `Payroll ${p.period} (${p.staff} staff, ${fmt(p.total)} ${tok(c)})`, action: `Proposed to the owners; ${approvers(c)}.` });
  }
  for (const h of c.held) {
    const late = h.dueDate && h.dueDate < end ? " (fell due during the storm)" : "";
    out.push({
      date: h.dueDate ?? end,
      what: `Held supplier payment ${h.invoiceId ?? ""} to ${h.payee}, ${h.amount} ${tok(c)}${late}`.replace("  ", " "),
      action: `Proposed to the owners after the storm; ${fisco ? "the owner approves it" : "approve in Safe Wallet"} or reschedule with the supplier.`,
    });
  }
  if (c.credit && c.credit.amount > 0n) {
    const pct = c.terms?.sweepPercent ?? SWEEP_PERCENT;
    out.push({
      date: "",
      what: `Credit line: drew ${fmt(c.credit.amount)} ${tok(c)} in the storm${c.credit.outstanding !== undefined ? `, ${fmt(c.credit.outstanding)} outstanding` : ""}`,
      action: `Repaid automatically by ${pct}% of each customer payment now the storm is over; check the loan's final repayment date.`,
    });
  }
  const window = c.terms?.claimWindowDays ?? CLAIM_WINDOW_DAYS;
  out.push({ date: addDays(end, window), what: "Insurance claim window closes", action: "Send the claim letter (claim-en.md) with photos and receipts." });
  if (isVietnam(c.region)) {
    out.push({ date: "2025-12-31", what: "Circular 53/2024: last day for the bank to restructure repayment terms", action: "Send the restructuring request (circular53-vi.md) to the bank as early as possible." });
  }
  return out.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
}

export function deadlineList(c: DraftContext): Draft {
  const rows = deadlines(c).map((d) => `| ${d.date || "no fixed date"} | ${d.what} | ${d.action} |`);
  const body = [
    `# Deadlines after ${c.eventName}`,
    "",
    DRAFT_NOTE,
    "",
    `Storm ended ${stamp(c.stormEnd, c.timeZone)}. Business: ${c.business}.`,
    "",
    "| Date | What | What to do |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
  return { file: "deadlines.md", title: "Deadline list", lang: "en", body };
}

/**
 * Loan restructuring request under SBV Circular 53/2024/TT-NHNN (relief for customers hit by Typhoon Yagi, bão số 3).
 * The conditions summarised here must be checked against the official text before use (area D, yagi-2024.json todo).
 */
export function circular53Vi(c: DraftContext): Draft {
  const tz = c.timeZone;
  const body = [
    "# Đề nghị cơ cấu lại thời hạn trả nợ theo Thông tư 53/2024/TT-NHNN",
    "",
    "_Bản nháp do trợ lý Signal 8 Wallet soạn. Chủ doanh nghiệp kiểm tra, điền thông tin, ký và tự gửi cho ngân hàng; trợ lý không gửi thay._",
    "",
    "_Draft template (Vietnamese). Conditions below are a summary of SBV Circular 53/2024/TT-NHNN; check them against the official text and with the bank before sending._",
    "",
    "**CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM**  ",
    "**Độc lập - Tự do - Hạnh phúc**",
    "",
    `……, ngày ${day(new Date(), tz)}`,
    "",
    "## GIẤY ĐỀ NGHỊ CƠ CẤU LẠI THỜI HẠN TRẢ NỢ",
    "",
    "Kính gửi: Ngân hàng …………………… (chi nhánh ……………)",
    "",
    `1. Tên khách hàng: ${c.business}`,
    "2. Mã số doanh nghiệp / hộ kinh doanh: ……………",
    "3. Địa chỉ: ……………",
    "4. Hợp đồng tín dụng số: …………… ngày ……………",
    "5. Dư nợ gốc hiện tại: …………… đồng; lãi: …………… đồng",
    "",
    "### Thiệt hại do bão số 3 (Yagi)",
    "",
    `Doanh nghiệp bị ảnh hưởng trực tiếp bởi ${c.eventName}${c.stormStart ? ` từ ${stamp(c.stormStart, tz)}` : ""} đến ${stamp(c.stormEnd, tz)}: nhà xưởng, máy móc, nguyên vật liệu và hàng hóa bị hư hỏng; hoạt động sản xuất kinh doanh bị gián đoạn, nguồn thu giảm nên không trả được nợ đúng hạn.`,
    "",
    "| Hạng mục thiệt hại | Giá trị ước tính (đồng) | Chứng từ |",
    "| --- | --- | --- |",
    "| (nhà xưởng, máy móc, hàng tồn kho, ngày ngừng sản xuất) | ……… | (ảnh, biên bản xác nhận của chính quyền địa phương) |",
    "",
    `Bằng chứng trước bão đã được ghi nhận: mã băm PRE_STORM ${c.preStorm ? `\`${c.preStorm.hash}\`` : "(không có)"}${c.preStorm?.tx ? `, giao dịch ${explorerTx(c.chainId, c.preStorm.tx)}` : ""}.`,
    "",
    "### Nội dung đề nghị",
    "",
    "Căn cứ Thông tư số 53/2024/TT-NHNN của Ngân hàng Nhà nước Việt Nam, doanh nghiệp đề nghị Ngân hàng:",
    "",
    "1. Cơ cấu lại thời hạn trả nợ đối với khoản nợ gốc và/hoặc lãi đến hạn, giữ nguyên nhóm nợ;",
    "2. Xem xét miễn, giảm lãi và phí theo quy định nội bộ của Ngân hàng;",
    "3. Xem xét cho vay mới để khôi phục sản xuất kinh doanh.",
    "",
    "Điều kiện cần kiểm tra lại với Ngân hàng (tóm tắt):",
    "",
    "- khoản nợ phát sinh trước ngày bão gây thiệt hại và nghĩa vụ trả nợ đến hạn trong thời gian được hỗ trợ;",
    "- khách hàng bị thiệt hại do bão số 3, lũ lụt, sạt lở sau bão, không trả được nợ đúng hạn;",
    "- khoản nợ không vi phạm pháp luật; ngân hàng đánh giá khách hàng có khả năng trả nợ theo thời hạn mới;",
    "- thời hạn cơ cấu lại phù hợp với mức độ thiệt hại; ngân hàng thực hiện cơ cấu lại đến hết ngày 31/12/2025.",
    "",
    "Đề nghị thời hạn trả nợ mới: ……… tháng, bắt đầu từ ……………",
    "",
    "Doanh nghiệp cam kết thông tin trên là đúng sự thật và sử dụng vốn đúng mục đích.",
    "",
    "**Đại diện doanh nghiệp** (ký, ghi rõ họ tên, đóng dấu)",
    "",
    "Hồ sơ kèm theo: ảnh hiện trường, xác nhận thiệt hại của UBND xã/phường, báo cáo tài chính gần nhất, kế hoạch trả nợ.",
    "",
  ].join("\n");
  return { file: "circular53-vi.md", title: "Circular 53/2024 restructuring request", lang: "vi", body };
}

export function buildDrafts(c: DraftContext, opts: { zhHant?: boolean } = {}): Draft[] {
  const out = [claimLetterEn(c)];
  if (opts.zhHant ?? c.region === "HK") out.push(claimLetterZhHant(c));
  out.push(deadlineList(c));
  if (isVietnam(c.region)) out.push(circular53Vi(c));
  return out;
}

/** Writes the drafts to <logDir>/drafts/<runId>/ and logs one "draft" decision per file. Returns the paths. */
export function writeDrafts(c: DraftContext, logDir: string, log: DecisionLog, opts: { zhHant?: boolean } = {}): string[] {
  const dir = resolve(logDir, "drafts", c.runId);
  mkdirSync(dir, { recursive: true });
  const paths: string[] = [];
  for (const d of buildDrafts(c, opts)) {
    const path = resolve(dir, d.file);
    writeFileSync(path, d.body);
    paths.push(path);
    log.write({
      input: `drafts:${c.runId}`,
      stage: "owner",
      outcome: "proposed",
      action: "draft",
      summary: `Draft for the owner to review and send: ${d.title} (${d.lang}) → ${relative(resolve(logDir, ".."), path)}. The agent never sends it.`,
    });
  }
  return paths;
}

if (isMain(import.meta.url)) {
  // Preview with sample facts (no chain): npx tsx src/drafts.ts [--event yagi-2024|ragasa-2025] [--out dir]
  const { loadReplay } = await import("./replay/timeline.ts");
  const { TC_LEVEL } = await import("./relayers/hko.ts");
  const arg = (k: string) => {
    const i = process.argv.indexOf(k);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const file = loadReplay(arg("--event") ?? "yagi-2024");
  const level = (code: string) => file.levelMap?.[code] ?? (TC_LEVEL as Record<string, number>)[code] ?? 0;
  const start = file.signals.find((s) => level(s.code) >= 8);
  const zero = `0x${"00".repeat(20)}` as Hex;
  const ctx: DraftContext = {
    runId: `preview-${file.id}`,
    business: file.scenario?.business ?? "Business (fictional)",
    eventName: file.name,
    region: file.region,
    timeZone: file.timezone ?? "UTC",
    network: "preview",
    chainId: 0,
    stormStart: start && new Date(start.time),
    stormEnd: new Date(file.signals.at(-1)!.time),
    safe: zero,
    cover: { contract: zero, payout: 20_000_000_000n },
    payroll: { period: "2024-09", payday: "2024-09-10", total: 23_000_000_000n, staff: 20, paidInStorm: true },
    held: [],
  };
  const out = arg("--out") ?? resolve(process.cwd(), "logs");
  const paths = writeDrafts(ctx, out, new DecisionLog(out, false));
  console.log(paths.join("\n"));
}
