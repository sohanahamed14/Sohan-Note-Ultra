import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import { active } from '@/db/helpers';
import { cash_entries, METHODS, type CashEntry, type Role } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { can, type Action } from './permissions';
import { postCash, restoreWithRefs, softDeleteWithRefs } from './posting';

export type CapitalContext = {
  shopId: string;
  userId: string | null;
  role: Role;
};

export type CapitalSummary = {
  totalCapital: number;
  totalInvested: number;
  totalWithdrawn: number;
  count: number;
};

const CAPITAL_TYPES = ['capital_in', 'capital_out'] as const;
export type CapitalType = (typeof CAPITAL_TYPES)[number];

const positivePaisa = z
  .number()
  .int('Amount must be whole paisa')
  .positive('Amount must be greater than 0')
  .refine(Number.isSafeInteger, 'Amount out of range');

const epochMs = z
  .number()
  .int('Invalid date')
  .refine(Number.isSafeInteger, 'Invalid date');

export const capitalInputSchema = z.object({
  amount: positivePaisa,
  method: z.enum(METHODS).default('cash'),
  date: epochMs.optional(),
  note: z.string().trim().max(300, 'Note is too long').optional().nullable(),
});

export type CapitalInput = z.input<typeof capitalInputSchema>;

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

/** Derived owner capital summary (Σ capital_in − Σ capital_out). */
export function getCapitalSummary(db: AppDb, shopId: string): CapitalSummary {
  const rows = db
    .select({ type: cash_entries.type, amount: cash_entries.amount })
    .from(cash_entries)
    .where(and(active(cash_entries, shopId), inArray(cash_entries.type, [...CAPITAL_TYPES])))
    .all();

  let totalInvested = 0;
  let totalWithdrawn = 0;
  for (const r of rows) {
    if (r.type === 'capital_in') totalInvested += r.amount;
    else if (r.type === 'capital_out') totalWithdrawn += -r.amount;
  }
  return {
    totalCapital: totalInvested - totalWithdrawn,
    totalInvested,
    totalWithdrawn,
    count: rows.length,
  };
}

export function listCapitalEntries(
  db: AppDb,
  shopId: string,
  opts: { from?: number; to?: number; type?: CapitalType } = {},
): CashEntry[] {
  const conds = [
    active(cash_entries, shopId),
    opts.type
      ? eq(cash_entries.type, opts.type)
      : inArray(cash_entries.type, [...CAPITAL_TYPES]),
  ];
  if (opts.from !== undefined) conds.push(gte(cash_entries.date, opts.from));
  if (opts.to !== undefined) conds.push(lte(cash_entries.date, opts.to));

  return db
    .select()
    .from(cash_entries)
    .where(and(...conds))
    .orderBy(desc(cash_entries.date), desc(cash_entries.created_at))
    .all();
}

/** Owner capital investment (+ capital, + cashbox). */
export function investCapital(db: AppDb, ctx: CapitalContext, input: CapitalInput): CashEntry {
  assertCan(ctx.role, 'manageCapital');
  const data = parseOrThrow(capitalInputSchema, input);
  const date = data.date ?? Date.now();
  const note = cleanNote(data.note);

  const id = postCash(db, {
    shopId: ctx.shopId,
    userId: ctx.userId,
    refId: null,
    date,
    amount: data.amount,
    type: 'capital_in',
    method: data.method,
    note: note ?? 'Owner investment',
  });
  if (!id) throw new AppError('VALIDATION', 'Amount must be greater than 0');

  const row = db
    .select()
    .from(cash_entries)
    .where(and(active(cash_entries, ctx.shopId), eq(cash_entries.id, id)))
    .get();
  if (!row) throw new AppError('UNKNOWN', 'Failed to read created capital entry');
  return row;
}

/** Owner capital withdrawal (− capital, − cashbox; rejects withdrawal > total capital). */
export function withdrawCapital(db: AppDb, ctx: CapitalContext, input: CapitalInput): CashEntry {
  assertCan(ctx.role, 'manageCapital');
  const data = parseOrThrow(capitalInputSchema, input);

  return db.transaction((tx) => {
    const { totalCapital } = getCapitalSummary(tx, ctx.shopId);
    if (data.amount > totalCapital) {
      throw new AppError('OVERPAY', 'Withdrawal exceeds available capital');
    }
    const date = data.date ?? Date.now();
    const note = cleanNote(data.note);
    const id = postCash(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      refId: null,
      date,
      amount: -data.amount,
      type: 'capital_out',
      method: data.method,
      note: note ?? 'Owner withdrawal',
    });
    if (!id) throw new AppError('VALIDATION', 'Amount must be greater than 0');

    const row = tx
      .select()
      .from(cash_entries)
      .where(and(active(cash_entries, ctx.shopId), eq(cash_entries.id, id)))
      .get();
    if (!row) throw new AppError('UNKNOWN', 'Failed to read created capital entry');
    return row;
  });
}

/** Soft-delete a capital entry (reverses both capital total and cashbox). */
export function deleteCapitalEntry(db: AppDb, ctx: CapitalContext, id: string): void {
  assertCan(ctx.role, 'manageCapital');
  assertCan(ctx.role, 'delete');
  db.transaction((tx) => {
    const row = tx
      .select()
      .from(cash_entries)
      .where(and(eq(cash_entries.shop_id, ctx.shopId), eq(cash_entries.id, id)))
      .get();
    if (!row) throw new AppError('NOT_FOUND', 'Capital entry not found');
    if (row.type !== 'capital_in' && row.type !== 'capital_out') {
      throw new AppError('CONFLICT', 'Record is not a capital entry');
    }
    softDeleteWithRefs(tx, { shopId: ctx.shopId, table: cash_entries, id });
  });
}

/** Restore a soft-deleted capital entry. */
export function restoreCapitalEntry(db: AppDb, ctx: CapitalContext, id: string): void {
  assertCan(ctx.role, 'manageCapital');
  assertCan(ctx.role, 'restore');
  db.transaction((tx) => {
    const row = tx
      .select()
      .from(cash_entries)
      .where(and(eq(cash_entries.shop_id, ctx.shopId), eq(cash_entries.id, id)))
      .get();
    if (!row) throw new AppError('NOT_FOUND', 'Capital entry not found');
    if (row.type !== 'capital_in' && row.type !== 'capital_out') {
      throw new AppError('CONFLICT', 'Record is not a capital entry');
    }
    restoreWithRefs(tx, { shopId: ctx.shopId, table: cash_entries, id });
  });
}
