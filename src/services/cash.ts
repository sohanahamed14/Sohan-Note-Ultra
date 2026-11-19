import { and, desc, eq, gt, gte, lt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { active } from '@/db/helpers';
import { cash_entries, METHODS, type CashEntry, type Method, type Role } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { can, type Action } from './permissions';
import { postCash, restoreWithRefs, softDeleteWithRefs } from './posting';

export type CashContext = {
  shopId: string;
  userId: string | null;
  role: Role;
};

export type MethodSummary = {
  balance: number;
  totalIn: number;
  totalOut: number;
};

export type CashListResult = {
  entries: CashEntry[];
  totalIn: number;
  totalOut: number;
  net: number;
  openingBalance: number;
  closingBalance: number;
};

const positivePaisa = z
  .number()
  .int('Amount must be whole paisa')
  .positive('Amount must be greater than 0')
  .refine(Number.isSafeInteger, 'Amount out of range');

const epochMs = z
  .number()
  .int('Invalid date')
  .refine(Number.isSafeInteger, 'Invalid date');

export const manualCashSchema = z.object({
  direction: z.enum(['in', 'out']),
  amount: positivePaisa,
  method: z.enum(METHODS).default('cash'),
  date: epochMs.optional(),
  note: z.string().trim().max(300, 'Note is too long').optional().nullable(),
});

export type ManualCashInput = z.input<typeof manualCashSchema>;

function assertCan(role: Role, action: Action): void {
  if (!can(role, action)) {
    throw new AppError('FORBIDDEN', 'You do not have permission for this action');
  }
}

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const res = schema.safeParse(input);
  if (!res.success) {
    throw new AppError('VALIDATION', res.error.issues[0]?.message ?? 'Invalid input');
  }
  return res.data;
}

function cleanNote(v: string | null | undefined): string | undefined {
  if (v == null) return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const CASH_TYPE_LABELS: Record<CashEntry['type'], string> = {
  sale: 'Sale',
  purchase: 'Purchase',
  expense: 'Expense',
  received: 'Due Received',
  paid: 'Due Paid',
  capital_in: 'Capital Invested',
  capital_out: 'Capital Withdrawn',
  cash_in: 'Manual Cash In',
  cash_out: 'Manual Cash Out',
};

export const METHOD_LABELS: Record<Method, string> = {
  cash: 'Cash',
  bkash: 'bKash',
  nagad: 'Nagad',
  card: 'Card',
  bank: 'Bank',
  other: 'Other',
};

/** Derived cashbox balance in paisa (Σ cash_entries.amount). */
export function getCashBalance(
  db: AppDb,
  shopId: string,
  opts: { method?: Method; until?: number } = {},
): number {
  const conds = [active(cash_entries, shopId)];
  if (opts.method) conds.push(eq(cash_entries.method, opts.method));
  if (opts.until !== undefined) conds.push(lte(cash_entries.date, opts.until));

  const row = db
    .select({ total: sql<number>`COALESCE(SUM(${cash_entries.amount}), 0)` })
    .from(cash_entries)
    .where(and(...conds))
    .get();
  return Number(row?.total ?? 0);
}

/** Cash in / out / balance per payment method. */
export function getCashMethodBreakdown(
  db: AppDb,
  shopId: string,
  opts: { from?: number; to?: number } = {},
): Record<Method, MethodSummary> {
  const conds = [active(cash_entries, shopId)];
  if (opts.from !== undefined) conds.push(gte(cash_entries.date, opts.from));
  if (opts.to !== undefined) conds.push(lte(cash_entries.date, opts.to));

  const rows = db
    .select({ method: cash_entries.method, amount: cash_entries.amount })
    .from(cash_entries)
    .where(and(...conds))
    .all();

  const out: Record<Method, MethodSummary> = {
    cash: { balance: 0, totalIn: 0, totalOut: 0 },
    bkash: { balance: 0, totalIn: 0, totalOut: 0 },
    nagad: { balance: 0, totalIn: 0, totalOut: 0 },
    card: { balance: 0, totalIn: 0, totalOut: 0 },
    bank: { balance: 0, totalIn: 0, totalOut: 0 },
    other: { balance: 0, totalIn: 0, totalOut: 0 },
  };

  for (const r of rows) {
    const bucket = out[r.method];
    bucket.balance += r.amount;
    if (r.amount > 0) bucket.totalIn += r.amount;
    else if (r.amount < 0) bucket.totalOut += -r.amount;
  }
  return out;
}

export type ListCashOptions = {
  from?: number;
  to?: number;
  method?: Method;
  type?: CashEntry['type'];
  direction?: 'in' | 'out';
};

export function listCashEntries(
  db: AppDb,
  shopId: string,
  opts: ListCashOptions = {},
): CashListResult {
  const openingConds = [active(cash_entries, shopId)];
  if (opts.method) openingConds.push(eq(cash_entries.method, opts.method));
  const openingBalance =
    opts.from !== undefined
      ? Number(
          db
            .select({ total: sql<number>`COALESCE(SUM(${cash_entries.amount}), 0)` })
            .from(cash_entries)
            .where(and(...openingConds, lt(cash_entries.date, opts.from)))
            .get()?.total ?? 0,
        )
      : 0;

  const conds = [active(cash_entries, shopId)];
  if (opts.from !== undefined) conds.push(gte(cash_entries.date, opts.from));
  if (opts.to !== undefined) conds.push(lte(cash_entries.date, opts.to));
  if (opts.method) conds.push(eq(cash_entries.method, opts.method));
  if (opts.type) conds.push(eq(cash_entries.type, opts.type));
  if (opts.direction === 'in') conds.push(gt(cash_entries.amount, 0));
  if (opts.direction === 'out') conds.push(lt(cash_entries.amount, 0));

  const entries = db
    .select()
    .from(cash_entries)
    .where(and(...conds))
    .orderBy(desc(cash_entries.date), desc(cash_entries.created_at))
    .all();

  let totalIn = 0;
  let totalOut = 0;
  for (const e of entries) {
    if (e.amount > 0) totalIn += e.amount;
    else if (e.amount < 0) totalOut += -e.amount;
  }
  const net = totalIn - totalOut;
  return {
    entries,
    totalIn,
    totalOut,
    net,
    openingBalance,
    closingBalance: openingBalance + net,
  };
}

/** Add a manual cash_in or cash_out entry (owner/manager only). */
export function addManualCash(db: AppDb, ctx: CashContext, input: ManualCashInput): CashEntry {
  assertCan(ctx.role, 'manageCash');
  const data = parseOrThrow(manualCashSchema, input);
  const date = data.date ?? Date.now();
  const signedAmount = data.direction === 'in' ? data.amount : -data.amount;
  const type = data.direction === 'in' ? 'cash_in' : 'cash_out';
  const note = cleanNote(data.note);

  const id = postCash(db, {
    shopId: ctx.shopId,
    userId: ctx.userId,
    refId: null,
    date,
    amount: signedAmount,
    type,
    method: data.method,
    note,
  });
  if (!id) throw new AppError('VALIDATION', 'Amount must be greater than 0');

  const row = db
    .select()
    .from(cash_entries)
    .where(and(active(cash_entries, ctx.shopId), eq(cash_entries.id, id)))
    .get();
  if (!row) throw new AppError('UNKNOWN', 'Failed to read created cash entry');
  return row;
}

/** Soft-delete a standalone manual cash entry (cash_in / cash_out). */
export function deleteManualCash(db: AppDb, ctx: CashContext, id: string): void {
  assertCan(ctx.role, 'manageCash');
  assertCan(ctx.role, 'delete');
  db.transaction((tx) => {
    const row = tx
      .select()
      .from(cash_entries)
      .where(and(eq(cash_entries.shop_id, ctx.shopId), eq(cash_entries.id, id)))
      .get();
    if (!row) throw new AppError('NOT_FOUND', 'Cash entry not found');
    if (row.ref_id !== null || (row.type !== 'cash_in' && row.type !== 'cash_out')) {
      throw new AppError(
        'CONFLICT',
        'Only manual cash entries can be deleted from Cashbox. Delete linked records from their source ledger.',
      );
    }
    softDeleteWithRefs(tx, { shopId: ctx.shopId, table: cash_entries, id });
  });
}

/** Restore a soft-deleted manual cash entry. */
export function restoreManualCash(db: AppDb, ctx: CashContext, id: string): void {
  assertCan(ctx.role, 'manageCash');
  assertCan(ctx.role, 'restore');
  db.transaction((tx) => {
    const row = tx
      .select()
      .from(cash_entries)
      .where(and(eq(cash_entries.shop_id, ctx.shopId), eq(cash_entries.id, id)))
      .get();
    if (!row) throw new AppError('NOT_FOUND', 'Cash entry not found');
    if (row.ref_id !== null || (row.type !== 'cash_in' && row.type !== 'cash_out')) {
      throw new AppError('CONFLICT', 'Only manual cash entries can be restored from Cashbox');
    }
    restoreWithRefs(tx, { shopId: ctx.shopId, table: cash_entries, id });
  });
}
