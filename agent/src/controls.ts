// Trusted bookkeeping the planner checks invoices against: purchase orders, invoices already paid, and payroll.
// These come from the owner's records (data/fixtures/ in the demo), never from the untrusted text.

import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { PATHS } from "./config.ts";
import { loadPayroll, payrollTotal, type Payroll } from "./loops/storm.ts";
import { plain } from "./exec/calls.ts";

const amount = z.string().regex(/^\d+(\.\d+)?$/);

export const PurchaseOrders = z.object({
  note: z.string().optional(),
  suppliers: z.record(z.string(), z.object({ requiresPO: z.boolean() }).strict()),
  orders: z.array(z.object({ po: z.string(), supplier: z.string(), invoiceId: z.string().optional(), amount, item: z.string().optional() }).strict()),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrders>["orders"][number];

export const PaidInvoices = z.object({
  note: z.string().optional(),
  paid: z.array(z.object({ supplier: z.string(), invoiceId: z.string(), amount, issueDate: z.string().optional(), paidOn: z.string().optional() }).strict()),
});
export type PaidInvoice = z.infer<typeof PaidInvoices>["paid"][number];

export interface PayeeControls {
  requiresPO: Record<string, boolean>; // payee id → needs a purchase order
  orders: PurchaseOrder[];
  /** Grows as the agent pays invoices, so a re-issue later the same session is caught too. */
  paid: PaidInvoice[];
  payroll?: { period: string; total: string; staff: Payroll["staff"] };
}

export function loadControls(paths = { orders: `${PATHS.fixtures}/purchase-orders.json`, paid: `${PATHS.fixtures}/paid-invoices.json`, payroll: PATHS.payroll }): PayeeControls {
  const orders = existsSync(paths.orders) ? PurchaseOrders.parse(JSON.parse(readFileSync(paths.orders, "utf8"))) : { suppliers: {}, orders: [] };
  const paid = existsSync(paths.paid) ? PaidInvoices.parse(JSON.parse(readFileSync(paths.paid, "utf8"))).paid : [];
  const payroll = existsSync(paths.payroll) ? loadPayroll(paths.payroll) : undefined;
  return {
    requiresPO: Object.fromEntries(Object.entries(orders.suppliers).map(([k, v]) => [k, v.requiresPO])),
    orders: orders.orders,
    paid,
    payroll: payroll && { period: payroll.payPeriod, total: plain(payrollTotal(payroll)), staff: payroll.staff },
  };
}
