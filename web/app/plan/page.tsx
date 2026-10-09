import Link from "next/link";
import { readPlanHashes } from "@/lib/chain";
import { loadDeployment } from "@/lib/deployments";
import { fmtDecimal, shortAddr } from "@/lib/format";
import { loadPlanBook, type Citation, type PlanAction, type PlanName } from "@/lib/plan";

export const dynamic = "force-dynamic";

// UI strings for the rule lines. The plan book's own summary covers every language it has;
// languages without an entry here fall back to English for the rule lines.
const STRINGS = {
  en: {
    summary: "Summary",
    ceiling: (x: string) => `Across both plans, nothing on any day can exceed ${x}.`,
    planTitle: { base: "Base plan (ordinary days)", storm: "Storm plan (Signal 8 or higher, confirmed by GDACS)" },
    perTx: (x: string) => `Each payment: up to ${x}.`,
    daily: (x: string) => `Per day: up to ${x}.`,
    credit: (x: string) => `Credit line: up to ${x} per storm.`,
    may: "The assistant may:",
    actions: {
      pay: "pay the payees listed for this plan",
      vault_deposit: "move spare cash into the money-market fund",
      vault_withdraw: "take cash out of the money-market fund",
      credit_draw: "draw on the credit line",
      cover_claim: "claim the typhoon cover",
    } as Record<PlanAction, string>,
    payeesFor: (n: number) => `${n} payee${n === 1 ? "" : "s"} in this plan.`,
    payees: "Payees",
    name: "Name",
    role: "Role",
    plans: "Plans",
    address: "Address",
    roles: { staff: "Staff", supplier: "Supplier", other: "Other" },
    planShort: { base: "base", storm: "storm" },
    source: "Source",
    otherCitations: "Other citations",
    hashTitle: "Plan hash",
    hashNote: "keccak256 of the canonical JSON of this plan book (keys sorted, no whitespace). Both on-chain plans store it.",
    match: "matches the signed plan on-chain",
    mismatch: "does not match",
    notConnected: "not connected",
    onChain: (p: string) => `On-chain ${p} plan`,
    file: "File",
  },
  "zh-Hant": {
    summary: "摘要",
    ceiling: (x: string) => `兩個計劃合計，任何一天的總支出都不會超過 ${x}。`,
    planTitle: { base: "平日計劃", storm: "風暴計劃（八號或以上風球，並經 GDACS 確認）" },
    perTx: (x: string) => `每筆付款最多 ${x}。`,
    daily: (x: string) => `每日最多 ${x}。`,
    credit: (x: string) => `每次風暴最多提取 ${x} 信貸額。`,
    may: "助理可以：",
    actions: {
      pay: "向此計劃名單上的收款人付款",
      vault_deposit: "把多餘現金存入貨幣市場基金",
      vault_withdraw: "從貨幣市場基金取出現金",
      credit_draw: "提取信貸額",
      cover_claim: "申領颱風保險",
    } as Record<PlanAction, string>,
    payeesFor: (n: number) => `此計劃有 ${n} 位收款人。`,
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
    onChain: (p: string) => `鏈上${p}計劃`,
    file: "檔案",
  },
};
type Strings = (typeof STRINGS)["en"];

const LANG_NAMES: Record<string, string> = { en: "English", "zh-Hant": "繁體中文", "zh-Hans": "简体中文", vi: "Tiếng Việt" };

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const pb = await loadPlanBook();
  if (!pb.ok) {
    return (
      <div className="stack">
        <h1>Plan book</h1>
        <p className="banner banner-unknown">{pb.reason}</p>
      </div>
    );
  }
  const { book, hash, file } = pb;
  const langs = Object.keys(book.summary);
  const asked = (await searchParams).lang;
  const want = Array.isArray(asked) ? asked[0] : asked;
  const lang = want && langs.includes(want) ? want : langs.includes("en") ? "en" : langs[0] ?? "en";
  const t: Strings = (STRINGS as Record<string, Strings>)[lang] ?? STRINGS.en;
  const money = (x: string) => `${fmtDecimal(x)} ${book.token.symbol}`;

  const onChain = await readOnChain();
  const status = (h: string | null | undefined) =>
    h === undefined || h === null ? (
      <span className="pill pill-wait">{t.notConnected}</span>
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
      <section className="card" key={p}>
        <h2>{t.planTitle[p]}</h2>
        <ul className="rules">
          <li>
            {t.perTx(money(r.perTxCap))}
            {cite(`plans.${p}.perTxCap`)}
          </li>
          <li>
            {t.daily(money(r.dailyCap))}
            {cite(`plans.${p}.dailyCap`)}
          </li>
          {Number(r.creditCapPerEvent) > 0 ? (
            <li>
              {t.credit(money(r.creditCapPerEvent))}
              {cite(`plans.${p}.creditCapPerEvent`)}
            </li>
          ) : null}
          <li>
            {t.may}
            {cite(`plans.${p}.actions`)}
            <ul>
              {r.actions.map((a) => (
                <li key={a}>
                  {t.actions[a] ?? a}
                  {cite(`plans.${p}.actions.${a}`)}
                </li>
              ))}
            </ul>
          </li>
          <li>
            {t.payeesFor(payees.length)}
            {cite(`plans.${p}.payees`)}
          </li>
        </ul>
        <p className="small">
          {t.onChain(t.planShort[p])}: {status(onChain.ok ? onChain.hashes[p] : null)}
        </p>
      </section>
    );
  });
  const ceilingCite = cite("dailyCeiling");
  const payeeCite = cite("payees");
  const other = book.citations.filter((c) => !used.has(c));

  return (
    <article className="stack" lang={lang}>
      <div className="row-between">
        <div>
          <h1>{book.business}</h1>
          <p className="muted small">
            {book.region} · {book.token.symbol} · {t.file}: <span className="mono">{file}</span>
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

      <section className="card">
        <h2>{t.summary}</h2>
        <p className="summary">{book.summary[lang]}</p>
        <p>
          <strong>{t.ceiling(money(book.dailyCeiling))}</strong>
          {ceilingCite}
        </p>
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
        <p className="mono hash">{hash}</p>
        <p className="muted small">{t.hashNote}</p>
        <p>
          {t.onChain(t.planShort.base)}: {status(onChain.ok ? onChain.hashes.base : null)}
          <br />
          {t.onChain(t.planShort.storm)}: {status(onChain.ok ? onChain.hashes.storm : null)}
        </p>
        {!onChain.ok ? <p className="muted small">{onChain.reason}</p> : null}
      </section>
    </article>
  );
}

function Citations({ items, label }: { items: Citation[]; label: string }) {
  return (
    <>
      {items.map((c, i) => (
        <blockquote key={i} className="cite">
          “{c.quote}”
          <footer>
            {label}: {c.doc} §{c.clause}
          </footer>
        </blockquote>
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

