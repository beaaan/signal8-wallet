import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDrafts, deadlines, writeDrafts, type DraftContext } from "../src/drafts.ts";
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
  safe: hex("5a", 20),
  cover: { contract: hex("c0", 20), eventId: hex("ee"), tx: hex("01"), payout: units("20000") },
  preStorm: { hash: hex("ab"), tx: hex("02"), signal: "TC3", at: new Date("2025-09-22T13:40:00Z") },
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
