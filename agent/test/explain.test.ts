import { describe, expect, it } from "vitest";
import { explain, explainAll, explainReason, LANGS } from "../src/explain.ts";
import type { Decision } from "../src/types.ts";

const tx = `0x${"2a".repeat(32)}` as const;
const names = new Map([["0x00000000000000000000000000000000000000b1", "Lee Kee Flour (fictional)"]]);

const pay: Decision = {
  ts: "2025-09-22T10:00:00Z",
  input: "invoice:lee-kee-flour-LK-0921.txt",
  stage: "chain",
  outcome: "executed",
  tx,
  action: "pay",
  summary: "Pay 1250.50 mUSD to 0x00000000000000000000000000000000000000b1 under the base plan (LK-0921)",
};

const refusal: Decision = {
  ts: "2025-09-22T10:01:00Z",
  input: "invoice:wing-on-meats-WO-2240-injected.txt",
  stage: "planner",
  outcome: "refused",
  reason: "bank detail changes go through the owners' timelocked setPayee, never a message",
  summary: 'No payment for "Wing On Meats" 980.00 USD',
};

const proposal: Decision = {
  ts: "2025-09-24T09:00:00Z",
  input: "storm:end",
  stage: "owner",
  outcome: "proposed",
  reason: "supplier payment held during the storm",
  action: "propose_to_owner",
  summary: "Owner proposal: Pay 1400.00 mUSD to Wing On Meats under the base plan (WO-2231#17); logged for the owners (local chain)",
};

const unknown: Decision = {
  ts: "2025-09-22T10:02:00Z",
  input: "arena:7",
  stage: "localCheck",
  outcome: "refused",
  reason: "SomethingNew",
  summary: "Pay 99 mUSD to Wing On Meats under the base plan (X-1)",
};

describe("explain", () => {
  it("explains a payment in every language, with the payee name and a Basescan link on Base Sepolia", () => {
    const all = explainAll(pay, { names, chainId: 84532 });
    expect(all.en[0]).toBe("Paid Lee Kee Flour 1,250.50 mUSD under the everyday plan.");
    expect(all["zh-Hant"][0]).toBe("已按平日計劃向 Lee Kee Flour 付款 1,250.50 mUSD。");
    expect(all["zh-Hans"][0]).toBe("已按日常计划向 Lee Kee Flour 付款 1,250.50 mUSD。");
    expect(all.vi[0]).toBe("Đã trả Lee Kee Flour 1.250,50 mUSD theo kế hoạch ngày thường.");
    for (const l of LANGS) expect(all[l][1]).toContain(`https://sepolia.basescan.org/tx/${tx}`);
    expect(all.en[1]).toMatch(/^Within the everyday plan the owners signed/);
  });

  it("adds no link off Base Sepolia, and opts.tx overrides the line's tx", () => {
    expect(explain(pay, "en", { chainId: 31337 })[1]).not.toMatch(/basescan/);
    const other = `0x${"cd".repeat(32)}` as const;
    expect(explain({ ...pay, tx: undefined }, "en", { chainId: 84532, tx: other })[1]).toContain(other);
  });

  it("explains a refusal in every language", () => {
    const all = explainAll(refusal);
    expect(all.en).toEqual(["Did not pay Wing On Meats 980 USD.", "A message can never change bank details; only the owners can, with a 24-hour wait."]);
    expect(all["zh-Hant"]).toEqual(["沒有向 Wing On Meats 付款 980 USD。", "訊息不能更改收款戶口；只有東主可以更改，而且要等 24 小時才生效。"]);
    expect(all["zh-Hans"]).toEqual(["没有向 Wing On Meats 付款 980 USD。", "消息不能更改收款账户；只有店主可以更改，而且要等 24 小时才生效。"]);
    expect(all.vi).toEqual(["Không trả Wing On Meats 980 USD.", "Tin nhắn không bao giờ đổi được thông tin tài khoản; chỉ chủ cửa hàng mới đổi được, sau 24 giờ chờ."]);
  });

  it("explains an owner proposal in every language", () => {
    const all = explainAll(proposal);
    expect(all.en).toEqual([
      "Asked the owners to approve paying Wing On Meats 1,400 mUSD under the everyday plan.",
      "During a storm, supplier payments wait until it passes; the owners approve them afterwards.",
    ]);
    expect(all["zh-Hant"]).toEqual(["已請東主批准按平日計劃向 Wing On Meats 付款 1,400 mUSD。", "風暴期間供應商付款暫緩，風暴過後由東主批准。"]);
    expect(all["zh-Hans"]).toEqual(["已请店主批准按日常计划向 Wing On Meats 付款 1,400 mUSD。", "风暴期间供应商付款暂缓，风暴过后由店主批准。"]);
    expect(all.vi).toEqual([
      "Đã đề nghị chủ cửa hàng duyệt: trả Wing On Meats 1.400 mUSD theo kế hoạch ngày thường.",
      "Trong bão, các khoản trả nhà cung cấp chờ đến khi bão qua; chủ cửa hàng duyệt sau.",
    ]);
  });

  it("falls back to the raw reason and the raw summary when it does not know them", () => {
    const all = explainAll(unknown);
    expect(all.en[1]).toBe("Reason: SomethingNew");
    expect(all["zh-Hant"][1]).toBe("原因：SomethingNew");
    expect(all["zh-Hans"][1]).toBe("原因：SomethingNew");
    expect(all.vi[1]).toBe("Lý do: SomethingNew");
    const odd: Decision = { ts: "t", input: "inflow:1", stage: "chain", outcome: "executed", action: "inflow", summary: "Customer payment matched: INV-1, 8,000 mUSD" };
    expect(explain(odd, "en")[0]).toBe("Done: Customer payment matched: INV-1, 8,000 mUSD");
    expect(explain(odd, "zh-Hant")[0]).toBe("已完成：Customer payment matched: INV-1, 8,000 mUSD");
    expect(explain(odd, "vi")[0]).toBe("Đã xong: Customer payment matched: INV-1, 8,000 mUSD");
  });

  it("maps contract errors and the planner's records checks", () => {
    for (const e of ["PayeeNotInPlan", "OverPerTxCap", "OverDailyCap", "OverDailyCeiling", "OverCreditCap", "RefUsed", "StormNotActive", "Paused"]) {
      for (const l of LANGS) expect(explainReason(e, l)).toBeTruthy();
    }
    expect(explainReason("invoice LK-0917 already paid on 2025-09-16", "en")).toBe("Invoice LK-0917 was already paid on 2025-09-16.");
    expect(explainReason("looks like a re-issue of LK-0917 (same supplier and amount, same date)", "zh-Hans")).toContain("LK-0917");
    expect(explainReason("amount 4900.00 is above purchase order PO-M-0915 (1400.00)", "en")).toBe("The bill is above purchase order PO-M-0915 (1,400), so the owners must approve it.");
    expect(explainReason("no purchase order for WO-9999", "vi")).toContain("WO-9999");
    expect(explainReason("address not in payee registry", "en")).toMatch(/not on the owners' payee list/);
  });

  it("explains the storm actions", () => {
    const claim: Decision = { ts: "t", input: "storm", stage: "chain", outcome: "executed", action: "cover_claim", summary: "Claimed the typhoon cover: 20,000 mUSD paid to the Safe (storm plan)" };
    expect(explain(claim, "en")[0]).toBe("Claimed the typhoon cover: 20,000 mUSD paid into the shop's wallet.");
    const over: Decision = { ts: "t", input: "storm", stage: "localCheck", outcome: "refused", reason: "OverCreditCap", action: "credit_draw", summary: "Draw 16000 mUSD of emergency credit (storm plan)" };
    expect(explain(over, "en")).toEqual(["Did not draw 16,000 mUSD from the emergency credit line.", "It would draw more credit than the loan allows for one storm."]);
  });
});
