// Deterministic offline provider: regex extraction and a name-matching planner.
// Used when MODEL_API_KEY is unset, and in tests and CI. Same contract as the model: JSON out, zod-validated by the caller.

import type { Action, ExtractedInvoice } from "../types.ts";
import type { Channel, ModelProvider, PlannerInput, RegistryPayee } from "./provider.ts";

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** A literal 0x address (40 hex digits, not part of a longer hex string). */
const ADDRESS = /\b0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;

function isoDate(s: string): string | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return s;
  const m = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})$/.exec(s.trim());
  const month = m ? MONTHS[m[2]!.toLowerCase()] : undefined;
  if (!m || !month) return undefined;
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
}

function plainAmount(raw: string, currency: string): string {
  // VND writes thousands with dots ("2.000.000đ"); dollars use commas.
  const s = currency === "VND" ? raw.replace(/[.,](?=\d{3}(\D|$))/g, "") : raw.replace(/,/g, "");
  const n = /^\d+(\.\d+)?$/.exec(s);
  return n ? s.replace(/^0+(?=\d)/, "") : "0";
}

export function extractFields(text: string): ExtractedInvoice {
  const currency: ExtractedInvoice["currency"] = /HK\$|\bHKD\b/i.test(text) ? "HKD" : /\bVND\b|đ|₫/.test(text) ? "VND" : "USD";

  let amount = "0";
  const keyed = /\b(?:amount due|total due|balance due|total|amount)\s*[:\-]?\s*(?:HK\$|US\$|\$|USD|HKD)?\s*(\d[\d,]*(?:\.\d{1,2})?)/i.exec(text);
  const marked = /(?:HK\$|US\$|\$|\bUSD|\bHKD)\s*(\d[\d,]*(?:\.\d{1,2})?)/i.exec(text);
  const vnd = /(\d[\d.,]*)\s*(?:đ|₫|VND)/.exec(text);
  if (keyed) amount = plainAmount(keyed[1]!, currency);
  else if (marked) amount = plainAmount(marked[1]!, currency);
  else if (vnd) amount = plainAmount(vnd[1]!, "VND");

  const invoiceId =
    /\b(?:invoice|inv|bill)\b[\s#:.]*(?:no\.?\s*)?([A-Z]{1,5}-?\d{2,8})\b/i.exec(text)?.[1] ?? /\b([A-Z]{2,5}-\d{3,8})\b/.exec(text)?.[1];

  const dueRaw = /\bdue(?:\s+date)?\s*(?:on|by|:)?\s*(\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}|\d{4}-\d{2}-\d{2})/i.exec(text)?.[1];
  const dueDate = dueRaw ? isoDate(dueRaw) : undefined;
  // Invoice or delivery date. Without a year, borrow the first year written anywhere in the text.
  const issue = /\b(?:delivered|dated|invoice date|date)\s*(?:on|:)?\s*(\d{1,2}\s+[A-Za-z]{3,9}\.?)(?:\s+(\d{4}))?|\b(?:dated|invoice date|date)\s*:?\s*(\d{4}-\d{2}-\d{2})/i.exec(text);
  const year = issue?.[2] ?? /\b(20\d{2})\b/.exec(text)?.[1];
  const issueDate = issue?.[3] ?? (issue?.[1] && year ? isoDate(`${issue[1].replace(/\.$/, "")} ${year}`) : undefined);

  const payeeName =
    /((?:[A-Z][a-z'&]+\s){1,3}(?:Flour|Meats|Foods|Trading|Bakery|Supplies|Ltd|Limited|Company|Co\.))/.exec(text)?.[1] ??
    /\bfrom\s+((?:[A-Z][\w'&.-]*\s?){1,5})/.exec(text)?.[1]?.trim() ??
    "unknown";

  const kind: ExtractedInvoice["kind"] =
    /\b(?:new|updated|changed?)\s+(?:bank\s+)?(?:account|wallet|address|bank details)\b|\b(?:bank|account|payment|wallet)\s+details?\s+(?:have\s+)?(?:changed|updated)/i.test(text)
      ? "bank_detail_change"
      : /\bpayroll\b|\bwages?\b|\bsalar(?:y|ies)\b/i.test(text)
        ? "payroll"
        : /\binvoice\b|\bbill\b|\bamount due\b|\btotal due\b/i.test(text)
          ? "invoice"
          : "other";

  const out: ExtractedInvoice = { kind, payeeName: payeeName.slice(0, 120), amount, currency };
  const addr = ADDRESS.exec(text)?.[0];
  if (addr) out.payeeAddress = addr as `0x${string}`;
  if (dueDate) out.dueDate = dueDate;
  if (issueDate) out.issueDate = issueDate;
  if (invoiceId) out.invoiceId = invoiceId.slice(0, 64);
  return out;
}

function words(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(fictional\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Registry entry whose name matches the extracted payee name. */
export function matchPayee(name: string, payees: RegistryPayee[]): RegistryPayee | undefined {
  const n = words(name);
  if (n.length < 3) return undefined;
  return payees.find((p) => {
    const w = words(p.name);
    return w === n || (n.length >= 6 && (w.includes(n) || n.includes(w)));
  });
}

export function planInvoice(input: PlannerInput): { actions: Action[] } {
  const inv = input.invoice;
  const payee = matchPayee(inv.payeeName, input.payees);
  if (!payee || !inv.invoiceId) return { actions: [] };
  const pay = { type: "pay" as const, plan: input.activePlan, payee: payee.address, amount: inv.amount, ref: inv.invoiceId };
  if (payee.role === "supplier" && input.holdSupplierPayments) {
    return { actions: [{ type: "propose_to_owner", reason: "supplier payments wait until the storm passes", action: { ...pay, plan: "base" } }] };
  }
  if (!payee.plans.includes(input.activePlan)) {
    return { actions: [{ type: "propose_to_owner", reason: `${payee.id} is not a ${input.activePlan}-plan payee`, action: { ...pay, plan: payee.plans[0]! } }] };
  }
  return { actions: [pay] };
}

export class RulesProvider implements ModelProvider {
  readonly name = "rules";

  async extract(text: string, _channel: Channel): Promise<unknown> {
    return extractFields(text);
  }

  async plan(input: PlannerInput): Promise<unknown> {
    return planInvoice(input);
  }
}
