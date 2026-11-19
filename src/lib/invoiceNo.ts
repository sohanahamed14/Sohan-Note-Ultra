import { and, eq, like } from 'drizzle-orm';
import type { AppDb } from '@/db/types';
import { purchases, sales } from '@/db/schema';
import { toDateInput } from './date';

export type InvoiceKind = 'sale' | 'purchase';

const PREFIX: Record<InvoiceKind, string> = { sale: 'INV', purchase: 'BILL' };

/** "INV-20261120-0007" */
export function formatInvoiceNo(kind: InvoiceKind, date: number, seq: number): string {
  return `${PREFIX[kind]}-${toDateInput(date).replace(/-/g, '')}-${String(seq).padStart(4, '0')}`;
}

/** Next number for the day; counts soft-deleted rows too so numbers are never reused. */
export function nextInvoiceNo(db: AppDb, shopId: string, kind: InvoiceKind, date: number): string {
  const pattern = formatInvoiceNo(kind, date, 0).replace(/0000$/, '%');
  const rows =
    kind === 'sale'
      ? db
          .select({ n: sales.invoice_no })
          .from(sales)
          .where(and(eq(sales.shop_id, shopId), like(sales.invoice_no, pattern)))
          .all()
      : db
          .select({ n: purchases.bill_no })
          .from(purchases)
          .where(and(eq(purchases.shop_id, shopId), like(purchases.bill_no, pattern)))
          .all();
  const max = rows.reduce((m, r) => Math.max(m, Number(r.n.split('-')[2] ?? 0)), 0);
  return formatInvoiceNo(kind, date, max + 1);
}
