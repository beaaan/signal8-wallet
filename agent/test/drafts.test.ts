import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDrafts, circular53Closed, circular53Vi, claimDeadline, claimLetterEn, claimLetterZhHant, deadlines, writeDrafts, type DraftContext } from "../src/drafts.ts";
import { units } from "../src/exec/calls.ts";
import { DecisionLog } from "../src/log.ts";

const hex = (b: string, n = 32) => `0x${b.repeat(n)}` as const;
const ragasa: DraftContext = {
  runId: "r1",
  business: "Golden Lotus Dim Sum, 10 staff (fictional)",
  eventName: "Super Typhoon Ragasa",
  region: "HK",
  timeZone: "Asia/Hong_Kong",
  network: "base-sepolia",
  chainId: 84532,
  stormStart: new Date("2025-09-23T06:20:00Z"),
  stormEnd: new Date("2025-09-24T12:20:00Z"),
  generatedAt: new Date("2025-09-25T03:00:00Z"),
  safe: hex("5a", 20),
  cover: { contract: hex("c0", 20), eventId: hex("ee"), tx: hex("01"), payout: units("20000") },
  preStorm: { hash: hex("ab"), tx: hex("02"), signal: "TC3", at: new Date("2025-09-22T13:40:00Z"), files: [] },
  credit: { amount: units("15000"), tx: hex("03"), outstanding: units("14500") },
  payroll: { period: "2025-09", payday: "2025-09-24", total: units("23000"), staff: 10, paidInStorm: true },
  held: [{ payee: "Wing On Meats", amount: "1200.00", invoiceId: "WO-2231", dueDate: "2025-09-26" }],
};

describe("after-storm drafts", () => {
  it("the claim letter cites the cover event id, the payout tx and the PRE_STORM hash (en and zh-Hant)", () => {
    const [en, zh] = buildDrafts(ragasa);
    for (const d of [en!, zh!]) {
      expect(d.body).toContain(ragasa.cover!.eventId);
      expect(d.body).toContain(`https://sepolia.basescan.org/tx/${ragasa.cover!.tx}`);
      expect(d.body).toContain(ragasa.preStorm!.hash);
      expect(d.body).toContain("20,000");
    }
    expect(zh!.lang).toBe("zh-Hant");
    expect(buildDrafts(ragasa).map((d) => d.file)).toEqual(["claim-en.md", "claim-zh-Hant.md", "deadlines.md"]);
  });

  it("the deadline list has payroll, held supplier payments, credit repayment and the claim window, in date order", () => {
    const d = deadlines(ragasa);
    expect(d.map((x) => x.what)).toEqual([
      expect.stringContaining("WO-2231 to Wing On Meats, 1200.00"),
      expect.stringContaining("Next payroll"),
      expect.stringContaining("Insurance claim window"),
      expect.stringContaining("Credit line: drew 15,000"),
    ]);
    expect(d.find((x) => x.what.includes("claim window"))!.date).toBe("2025-10-24");
    expect(d.find((x) => x.what.includes("payroll"))!.date).toBe("2025-10-24");
  });

  it("the Yagi variant adds the Vietnamese Circular 53/2024 restructuring request", () => {
    const yagi = { ...ragasa, region: "VN-QN-HP", timeZone: "Asia/Ho_Chi_Minh", eventName: "Typhoon Yagi" };
    const ds = buildDrafts(yagi);
    expect(ds.map((d) => d.file)).toEqual(["claim-en.md", "deadlines.md", "circular53-vi.md"]);
    const vi = ds.at(-1)!;
    expect(vi.lang).toBe("vi");
    expect(vi.body).toContain("Thông tư 53/2024/TT-NHNN");
    expect(vi.body).toContain(ragasa.preStorm!.hash);
    expect(deadlines(yagi).some((x) => x.what.includes("Circular 53"))).toBe(true);
  });

  it("writes drafts under drafts/<runId>/ and logs each as an owner proposal, never as sent", () => {
    const dir = mkdtempSync(join(tmpdir(), "s8-drafts-"));
    const log = new DecisionLog(dir, false);
    const paths = writeDrafts(ragasa, dir, log);
    expect(paths.map((p) => p.slice(dir.length).replace(/\\/g, "/"))).toEqual(["/drafts/r1/claim-en.md", "/drafts/r1/claim-zh-Hant.md", "/drafts/r1/deadlines.md"]);
    expect(readFileSync(paths[0]!, "utf8")).toMatch(/never sends it/);
    const lines = log.readNewest();
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.stage === "owner" && l.outcome === "proposed" && l.action === "draft")).toBe(true);
  });
});

describe("after-storm drafts: dates, evidence and unknown terms (#32)", () => {
  const yagi: DraftContext = { ...ragasa, region: "VN-QN-HP", timeZone: "Asia/Ho_Chi_Minh", eventName: "Typhoon Yagi" };
  const later = new Date("2026-10-14T03:00:00Z");

  it("a draft prepared right after the storm is not labelled historical", () => {
    const [en, zh, list] = buildDrafts(ragasa);
    expect(en!.body).toContain("Prepared on: 2025-09-25");
    expect(zh!.body).toContain("擬稿日期：2025-09-25");
    for (const d of [en!, zh!, list!]) expect(d.body).not.toMatch(/Historical replay|歷史重播|\(past\)|\(passed\)/);
    expect(claimDeadline(ragasa)).toEqual({ date: "2025-10-24", days: 30, passed: false });
  });

  it("a replay prepared after the claim deadline keeps the real preparation date and says the deadline passed", () => {
    const c = { ...ragasa, generatedAt: later };
    const [en, zh, list] = buildDrafts(c);
    expect(en!.body).toContain("Prepared on: 2026-10-14");
    expect(en!.body).toContain("**Historical replay.**");
    expect(en!.body).toContain("demo default of 30 days after the event (2025-10-24), which had passed by 2026-10-14");
    expect(zh!.body).toContain("**歷史重播。**");
    expect(list!.body).toContain("**Historical replay.**");
    expect(list!.body).toContain("| 2025-10-24 (past) |");
    const claim = deadlines(c).find((x) => x.what.includes("claim window"))!;
    expect(claim.what).toContain("(passed)");
    expect(claim.action).toMatch(/^Historical/);
  });

  it("an expired Circular 53 window is labelled historical, not backdated, and its deadline row says closed", () => {
    const c = { ...yagi, stormStart: new Date("2024-09-06T09:00:00Z"), stormEnd: new Date("2024-09-08T12:00:00Z"), generatedAt: later };
    expect(circular53Closed(c)).toBe(true);
    const vi = buildDrafts(c).find((d) => d.file === "circular53-vi.md")!;
    expect(vi.body).toContain("Bản minh họa lịch sử, không phải hồ sơ đề nghị nộp tại thời điểm hiện tại.");
    expect(vi.body).toContain("ngày 14 tháng 10 năm 2026");
    const row = deadlines(c).find((x) => x.what.includes("Circular 53"))!;
    expect(row.what).toContain("(closed)");
    expect(row.action).toContain("Do not send circular53-vi.md as a current request");
    expect(claimDeadline(c)).toMatchObject({ date: "2024-10-08", passed: true });
  });

  it("an open Circular 53 window gets no historical label", () => {
    const c = { ...yagi, stormEnd: new Date("2024-09-08T12:00:00Z"), generatedAt: new Date("2024-09-20T03:00:00Z") };
    expect(circular53Closed(c)).toBe(false);
    const vi = buildDrafts(c).find((d) => d.file === "circular53-vi.md")!;
    expect(vi.body).not.toContain("Bản minh họa lịch sử");
    expect(deadlines(c).find((x) => x.what.includes("Circular 53"))!.what).not.toContain("(closed)");
  });

  it("an empty PRE_STORM record is never described as committing to photos or stock records", () => {
    const [en, zh] = buildDrafts(ragasa);
    const vi = circular53Vi(yagi);
    expect(en!.body).toContain("No photos or stock records were supplied, so it does not cover any.");
    expect(en!.body).not.toMatch(/commits to our premises photos|We can provide the original files/);
    expect(zh!.body).toContain("由於沒有提供相片或存貨紀錄");
    expect(zh!.body).not.toContain("原檔可隨時提供");
    expect(vi.body).toContain("Chưa có ảnh hay sổ sách hàng tồn kho nào được cung cấp");
    expect(vi.body).not.toContain("đã được ghi nhận");
  });

  it("a missing PRE_STORM record says so; supplied file hashes are counted; an unanchored hash is flagged", () => {
    const none = { ...yagi, preStorm: undefined };
    expect(claimLetterEn(none).body).toContain("No pre-storm evidence was recorded for this event.");
    expect(circular53Vi(none).body).toContain("Chưa có bằng chứng trước bão hoặc giao dịch ghi nhận được xác minh trong bản nháp này.");
    const files = { ...ragasa, preStorm: { ...ragasa.preStorm!, files: [hex("f1"), hex("f2")] } };
    expect(claimLetterEn(files).body).toContain("the 2 file hash(es) in that record");
    const unanchored = { ...ragasa, preStorm: { ...ragasa.preStorm!, tx: undefined } };
    expect(claimLetterEn(unanchored).body).toContain("It was not anchored on a chain.");
  });

  it("policy number, extra cover and the claim deadline are left for the owner to confirm", () => {
    const en = claimLetterEn(ragasa).body;
    expect(en).toContain("| Policy number | (owner to confirm) |");
    expect(en).toContain("## Other losses (only if the policy covers them)");
    expect(en).toContain("The claim deadline is set by the policy; the owner confirms it before sending.");
    expect(en).not.toContain("claim for the losses the benefit does not cover");
    expect(claimLetterZhHant(ragasa).body).toContain("| 保單編號 | （東主確認） |");
  });

  it("the Vietnamese request asks for owner-confirmed damage instead of asserting it", () => {
    const vi = circular53Vi(yagi).body;
    expect(vi).not.toContain("nguyên vật liệu và hàng hóa bị hư hỏng");
    expect(vi).toContain("Thiệt hại thực tế do chủ doanh nghiệp xác nhận và cung cấp chứng từ");
    expect(vi).toContain("trước ngày 07/9/2024");
    expect(vi).toContain("theo chính sách của Ngân hàng");
  });
});
