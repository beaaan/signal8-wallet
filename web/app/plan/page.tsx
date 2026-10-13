import Link from "next/link";
import { Fragment } from "react";
import { readPlanHashes } from "@/lib/chain";
import { loadDeployment } from "@/lib/deployments";
import { fmtDecimal, shortAddr } from "@/lib/format";
import { CopyButton } from "../components/Copy";
import { Hint } from "../components/Hint";
import { Icon } from "../components/Icons";
import { loadPlanBook, type Citation, type PlanAction, type PlanName } from "@/lib/plan";

export const dynamic = "force-dynamic";

// UI strings. The plan book's own summary covers the languages it has; any string or summary missing in the
// chosen language falls back to English.
const EN = {
  summary: "Summary",
  planTitle: { base: "Everyday plan", storm: "Storm plan" },
  planWhen: { base: "Ordinary days", storm: "Only when Signal 8 or higher is up and GDACS confirms the storm" },
  may: "The assistant may:",
  perTxLabel: "Per payment",
  dailyLabel: "Per day",
  creditLabel: "Credit per storm",
  ceilingLabel: "Assistant payments per day, both plans",
  ceilingNote:
    "Counts supplier and staff payments the assistant makes through the plan module. Moving money to or from the fund, credit drawn and insurance payouts are tracked separately. Payments the owners make directly from the Safe are not counted and must be recorded in the daily report.",
  mayLabel: "May",
  actionsShort: {
    pay: "Pay listed payees",
    vault_deposit: "Cash → fund",
    vault_withdraw: "Fund → cash",
    credit_draw: "Borrow",
    cover_claim: "Claim cover",
  } as Record<PlanAction, string>,
  payeesShort: (n: number) => `${n} payees`,
  actions: {
    pay: "pay the payees listed for this plan",
    vault_deposit: "move spare cash into the money-market fund",
    vault_withdraw: "take cash out of the money-market fund",
    credit_draw: "draw on the credit line",
    cover_claim: "claim the typhoon cover",
  } as Record<PlanAction, string>,
  payees: "Payees",
  name: "Name",
  role: "Role",
  plans: "Plans",
  address: "Address",
  roles: { staff: "Staff", supplier: "Supplier", other: "Other" },
  planShort: { base: "everyday", storm: "storm" },
  source: "Source",
  otherCitations: "Other citations",
  hashTitle: "Plan hash",
  hashNote: "keccak256 of the canonical JSON of this plan book (keys sorted, no whitespace). Both on-chain plans store it.",
  match: "matches the signed plan on-chain",
  mismatch: "does not match",
  notConnected: "not connected",
  hashUnread: "hash couldn't be read",
  copy: "Copy plan hash",
  copied: "Copied",
  file: "File",
  verified: "This is the plan the owners signed",
  verifiedNote: "The plan book below hashes to the same fingerprint both on-chain plans store, so what runs is what was signed.",
  mismatchTitle: "Warning: this is not the signed plan",
  mismatchNote: "The plan book below differs from what the owners signed on-chain. The agent refuses to act until they match.",
  unknownTitle: "Cannot check the signature right now",
};
type Strings = typeof EN;

const STRINGS: Record<string, Partial<Strings>> = {
  en: EN,
  "zh-Hant": {
    summary: "摘要",
    planTitle: { base: "平日計劃", storm: "風暴計劃" },
    planWhen: { base: "平日", storm: "只在八號或以上風球生效、並經 GDACS 確認風暴時" },
    may: "助理可以：",
    perTxLabel: "每筆上限",
    dailyLabel: "每日上限",
    creditLabel: "每次風暴信貸",
    ceilingLabel: "助理每日付款上限（兩個計劃合計）",
    ceilingNote: "只計算助理經計劃模組向供應商及員工的付款。基金存取、信貸提取及保險賠償另行記錄。東主直接從 Safe 付出的款項不計入此上限，須記入每日報告。",
    mayLabel: "可以",
    actionsShort: {
      pay: "付款給名單收款人",
      vault_deposit: "現金存入基金",
      vault_withdraw: "從基金取回現金",
      credit_draw: "提取信貸",
      cover_claim: "申領保險",
    } as Record<PlanAction, string>,
    payeesShort: (n: number) => `${n} 位收款人`,
    actions: {
      pay: "向此計劃名單上的收款人付款",
      vault_deposit: "把多餘現金存入貨幣市場基金",
      vault_withdraw: "從貨幣市場基金取出現金",
      credit_draw: "提取信貸額",
      cover_claim: "申領颱風保險",
    } as Record<PlanAction, string>,
    payees: "收款人",
    name: "名稱",
    role: "角色",
    plans: "計劃",
    address: "地址",
    roles: { staff: "員工", supplier: "供應商", other: "其他" },
    planShort: { base: "平日", storm: "風暴" },
    source: "出處",
    otherCitations: "其他出處",
    hashTitle: "計劃雜湊值",
    hashNote: "此計劃書標準 JSON（鍵排序、無空白）的 keccak256。鏈上兩個計劃都儲存這個值。",
    match: "與鏈上已簽署的計劃相符",
    mismatch: "不相符",
    notConnected: "未連線",
    hashUnread: "無法讀取雜湊值",
    copy: "複製雜湊值",
    copied: "已複製",
    file: "檔案",
    verified: "這就是東主簽署的計劃",
    verifiedNote: "以下計劃書的指紋（雜湊值）與鏈上兩個計劃儲存的一致，所以執行的正是簽署的內容。",
    mismatchTitle: "注意：這不是已簽署的計劃",
    mismatchNote: "以下計劃書與東主在鏈上簽署的不同。在兩者一致之前，助理不會行動。",
    unknownTitle: "暫時無法核對簽署",
  },
  "zh-Hans": {
    summary: "摘要",
    planTitle: { base: "日常计划", storm: "风暴计划" },
    planWhen: { base: "平日", storm: "仅在八号或以上台风信号生效、并经 GDACS 确认风暴时" },
    may: "助理可以：",
    perTxLabel: "每笔上限",
    dailyLabel: "每日上限",
    creditLabel: "每次风暴信贷",
    ceilingLabel: "助理每日付款上限（两个计划合计）",
    ceilingNote: "只计算助理通过计划模块向供应商和员工的付款。基金存取、信贷提取和保险赔付另行记录。店主直接从 Safe 付出的款项不计入这个上限，必须记入每日报告。",
    mayLabel: "可以",
    actionsShort: {
      pay: "向名单内收款人付款",
      vault_deposit: "现金存入基金",
      vault_withdraw: "从基金取回现金",
      credit_draw: "动用信贷",
      cover_claim: "申领保险",
    },
    payeesShort: (n: number) => `${n} 位收款人`,
    actions: {
      pay: "向本计划名单上的收款人付款",
      vault_deposit: "把闲置现金存入货币市场基金",
      vault_withdraw: "从货币市场基金取出现金",
      credit_draw: "动用信贷额度",
      cover_claim: "申领台风保险",
    },
    payees: "收款人",
    name: "名称",
    role: "角色",
    plans: "计划",
    address: "地址",
    roles: { staff: "员工", supplier: "供应商", other: "其他" },
    planShort: { base: "日常", storm: "风暴" },
    source: "出处",
    otherCitations: "其他出处",
    hashTitle: "计划哈希值",
    hashNote: "本计划书规范 JSON（键已排序、无空白）的 keccak256。链上两个计划都存储这个值。",
    match: "与链上已签署的计划一致",
    mismatch: "不一致",
    notConnected: "未连接",
    hashUnread: "无法读取哈希值",
    copy: "复制哈希值",
    copied: "已复制",
    file: "文件",
    verified: "这就是店主签署的计划",
    verifiedNote: "下面计划书的指纹（哈希值）与链上两个计划存储的一致，所以执行的就是签署的内容。",
    mismatchTitle: "注意：这不是已签署的计划",
    mismatchNote: "下面的计划书与店主在链上签署的不同。两者一致之前，助理不会行动。",
    unknownTitle: "暂时无法核对签署",
  },
  vi: {
    summary: "Tóm tắt",
    planTitle: { base: "Kế hoạch thường ngày", storm: "Kế hoạch bão" },
    planWhen: { base: "Ngày bình thường", storm: "Chỉ khi có tín hiệu số 8 trở lên và GDACS xác nhận bão" },
    may: "Trợ lý được phép:",
    perTxLabel: "Mỗi khoản chi",
    dailyLabel: "Mỗi ngày",
    creditLabel: "Tín dụng mỗi cơn bão",
    ceilingLabel: "Khoản trợ lý trả mỗi ngày, cả hai kế hoạch",
    ceilingNote: "Chỉ tính các khoản trợ lý trả cho nhà cung cấp và nhân viên qua mô-đun kế hoạch. Tiền chuyển vào hoặc rút ra khỏi quỹ, tiền rút tín dụng và tiền bồi thường bảo hiểm được theo dõi riêng. Các khoản chủ cửa hàng trả trực tiếp từ Safe không tính vào hạn mức này và phải được ghi vào báo cáo hằng ngày.",
    mayLabel: "Được phép",
    actionsShort: {
      pay: "Trả người nhận trong danh sách",
      vault_deposit: "Tiền mặt → quỹ",
      vault_withdraw: "Quỹ → tiền mặt",
      credit_draw: "Vay",
      cover_claim: "Nhận bảo hiểm",
    },
    payeesShort: (n: number) => `${n} người nhận`,
    actions: {
      pay: "trả tiền cho người nhận trong danh sách của kế hoạch này",
      vault_deposit: "chuyển tiền mặt dư vào quỹ thị trường tiền tệ",
      vault_withdraw: "rút tiền mặt từ quỹ thị trường tiền tệ",
      credit_draw: "rút hạn mức tín dụng",
      cover_claim: "yêu cầu bồi thường bảo hiểm bão",
    },
    payees: "Người nhận",
    name: "Tên",
    role: "Vai trò",
    plans: "Kế hoạch",
    address: "Địa chỉ",
    roles: { staff: "Nhân viên", supplier: "Nhà cung cấp", other: "Khác" },
    planShort: { base: "thường ngày", storm: "bão" },
    source: "Nguồn",
    otherCitations: "Trích dẫn khác",
    hashTitle: "Mã băm kế hoạch",
    hashNote: "keccak256 của JSON chuẩn hóa của sổ kế hoạch này (khóa được sắp xếp, không có khoảng trắng). Cả hai kế hoạch trên chuỗi đều lưu giá trị này.",
    match: "khớp với kế hoạch đã ký trên chuỗi",
    mismatch: "không khớp",
    notConnected: "chưa kết nối",
    hashUnread: "không đọc được mã băm",
    copy: "Sao chép mã băm",
    copied: "Đã sao chép",
    file: "Tệp",
    verified: "Đây đúng là kế hoạch chủ cửa hàng đã ký",
    verifiedNote: "Sổ kế hoạch dưới đây có cùng dấu vân tay (mã băm) với bản lưu trên chuỗi, nên những gì đang chạy chính là những gì đã ký.",
    mismatchTitle: "Cảnh báo: đây không phải kế hoạch đã ký",
    mismatchNote: "Sổ kế hoạch dưới đây khác với bản chủ cửa hàng đã ký trên chuỗi. Trợ lý sẽ không làm gì cho đến khi hai bản khớp nhau.",
    unknownTitle: "Hiện chưa kiểm tra được chữ ký",
  },
};
const LANGS = ["en", "zh-Hant", "zh-Hans", "vi"];

const LANG_NAMES: Record<string, string> = { en: "English", "zh-Hant": "繁體中文", "zh-Hans": "简体中文", vi: "Tiếng Việt" };

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const pb = await loadPlanBook();
  if (!pb.ok) {
    return (
      <div className="stack">
        <h1>Plan book</h1>
        <p className="banner banner-info">{pb.reason}</p>
      </div>
    );
  }
  const { book, hash, file } = pb;
  const langs = [...LANGS, ...Object.keys(book.summary).filter((l) => !LANGS.includes(l))];
  const asked = (await searchParams).lang;
  const want = Array.isArray(asked) ? asked[0] : asked;
  const lang = want && langs.includes(want) ? want : "en";
  const t: Strings = { ...EN, ...STRINGS[lang] };
  // `lang` attributes name the language actually shown, which is English wherever a translation is missing.
  const uiLang = STRINGS[lang] ? lang : "en";
  const summaryLang = book.summary[lang] ? lang : book.summary.en ? "en" : Object.keys(book.summary)[0];
  const money = (x: string) => (
    <strong className="rule-amount">
      {fmtDecimal(x)} {book.token.symbol}
    </strong>
  );

  const onChain = await readOnChain();
  const status = (h: string | null) =>
    !onChain.ok ? (
      <span className="pill pill-wait">{t.notConnected}</span>
    ) : h === null ? (
      <span className="pill pill-wait">{t.hashUnread}</span>
    ) : h.toLowerCase() === hash.toLowerCase() ? (
      <span className="pill pill-good">{t.match}</span>
    ) : (
      <span className="pill pill-bad">{t.mismatch}</span>
    );

  const used = new Set<Citation>();
  const cite = (rule: string) => {
    const cs = book.citations.filter((c) => c.rule === rule);
    cs.forEach((c) => used.add(c));
    return cs.length ? <Citations items={cs} label={t.source} /> : null;
  };

  // Render the plans first so `used` knows which citations were placed under a rule.
  const planSections = (["base", "storm"] as PlanName[]).map((p) => {
    const r = book.plans[p];
    const payees = book.payees.filter((x) => x.plans.includes(p));
    return (
      <section className={`card plan-card-${p}`} key={p}>
        <h2>{t.planTitle[p]}</h2>
        <p className="muted small plan-when">{t.planWhen[p]}</p>
        <dl className="kv">
          <div>
            <dt>{t.perTxLabel}</dt>
            <dd>
              {money(r.perTxCap)}
              {cite(`plans.${p}.perTxCap`)}
            </dd>
          </div>
          <div>
            <dt>{t.dailyLabel}</dt>
            <dd>
              {money(r.dailyCap)}
              {cite(`plans.${p}.dailyCap`)}
            </dd>
          </div>
          {Number(r.creditCapPerEvent) > 0 ? (
            <div>
              <dt>{t.creditLabel}</dt>
              <dd>
                {money(r.creditCapPerEvent)}
                {cite(`plans.${p}.creditCapPerEvent`)}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>{t.mayLabel}</dt>
            <dd>
              <ul className="chips" aria-label={t.may}>
                {r.actions.map((a) => (
                  <li key={a} className="chip" title={t.actions[a] ?? a}>
                    {t.actionsShort[a] ?? a}
                  </li>
                ))}
              </ul>
              {cite(`plans.${p}.actions`)}
              {r.actions.map((a) => (
                <Fragment key={a}>{cite(`plans.${p}.actions.${a}`)}</Fragment>
              ))}
            </dd>
          </div>
          <div>
            <dt>{t.payees}</dt>
            <dd>
              {t.payeesShort(payees.length)}
              {cite(`plans.${p}.payees`)}
            </dd>
          </div>
        </dl>
        <p className="small plan-onchain">{status(onChain.ok ? onChain.hashes[p] : null)}</p>
      </section>
    );
  });
  const ceilingCite = cite("dailyCeiling");
  const payeeCite = cite("payees");
  const other = book.citations.filter((c) => !used.has(c));

  return (
    <article className="stack" lang={uiLang}>
      <div className="page-head">
        <div>
          <h1>{book.business}</h1>
          <p className="muted small">
            {book.region} · {book.token.symbol} ·{" "}
            <span className="mono" title={`${t.file}: ${file}`}>
              {file.split("/").pop()}
            </span>
          </p>
        </div>
        <nav className="langs" aria-label="Language">
          {langs.map((l) => (
            <Link key={l} href={`/plan?lang=${encodeURIComponent(l)}`} className={l === lang ? "lang active" : "lang"} lang={l}>
              {LANG_NAMES[l] ?? l}
            </Link>
          ))}
        </nav>
      </div>

      <Verify t={t} hash={hash} onChain={onChain} />

      <section className="card">
        <h2 className="section-label">{t.summary}</h2>
        <p className="summary" lang={summaryLang}>
          {book.summary[summaryLang]}
        </p>
        <dl className="kv">
          <div>
            <dt>{t.ceilingLabel}</dt>
            <dd>
              {money(book.dailyCeiling)}
              {ceilingCite}
            </dd>
          </div>
        </dl>
        <p className="muted small">{t.ceilingNote}</p>
      </section>

      <div className="grid2">{planSections}</div>

      <section className="card">
        <h2>{t.payees}</h2>
        {payeeCite}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.name}</th>
                <th>{t.role}</th>
                <th>{t.plans}</th>
                <th>{t.address}</th>
              </tr>
            </thead>
            <tbody>
              {book.payees.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{t.roles[p.role] ?? p.role}</td>
                  <td>{p.plans.map((x) => t.planShort[x] ?? x).join(", ")}</td>
                  <td className="mono" title={p.address}>
                    {shortAddr(p.address)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {other.length > 0 ? (
        <section className="card">
          <h2>{t.otherCitations}</h2>
          {other.map((c, i) => (
            <div key={i}>
              <span className="mono small">{c.rule}</span>
              <Citations items={[c]} label={t.source} />
            </div>
          ))}
        </section>
      ) : null}

      <section className="card">
        <h2>{t.hashTitle}</h2>
        <p className="hash-line">
          <span className="mono hash">{hash}</span>
          <CopyButton text={hash} label={t.copy} doneLabel={t.copied} />
        </p>
        <p className="muted small">{t.hashNote}</p>
      </section>
    </article>
  );
}

function Verify({
  t,
  hash,
  onChain,
}: {
  t: Strings;
  hash: string;
  onChain: { ok: true; hashes: { base: string | null; storm: string | null } } | { ok: false; reason: string };
}) {
  const hs = onChain.ok ? [onChain.hashes.base, onChain.hashes.storm] : [];
  const state = !onChain.ok || hs.some((h) => !h) ? "wait" : hs.every((h) => h!.toLowerCase() === hash.toLowerCase()) ? "good" : "bad";
  return (
    <section className={`card verify verify-${state}`}>
      <span className="verify-icon">
        <Icon name={state === "good" ? "check" : state === "bad" ? "alert" : "evidence"} />
      </span>
      <div>
        <h2>{state === "good" ? <Hint text={t.verifiedNote}>{t.verified}</Hint> : state === "bad" ? t.mismatchTitle : t.unknownTitle}</h2>
        {state !== "good" ? <p className="muted small">{state === "bad" ? t.mismatchNote : onChain.ok ? t.hashUnread : onChain.reason}</p> : null}
      </div>
    </section>
  );
}

function Citations({ items, label }: { items: Citation[]; label: string }) {
  return (
    <>
      {items.map((c, i) => (
        <details key={i} className="cite">
          <summary>
            {label}: {c.doc} §{c.clause}
          </summary>
          <blockquote>“{c.quote}”</blockquote>
        </details>
      ))}
    </>
  );
}

async function readOnChain(): Promise<
  { ok: true; hashes: { base: string | null; storm: string | null } } | { ok: false; reason: string }
> {
  const dep = await loadDeployment();
  if (!dep.ok) return { ok: false, reason: dep.reason };
  try {
    return { ok: true, hashes: await readPlanHashes(dep.deployment) };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

