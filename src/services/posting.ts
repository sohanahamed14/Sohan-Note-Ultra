import { sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { newRow } from '@/db/helpers';
import {
  cash_entries,
  party_ledger,
  stock_movements,
  type Method,
  type CashEntry,
} from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { roundQty } from '@/lib/money';

/**
 * Posting helpers. Call them inside the caller's `db.transaction((tx) => ...)`
 * and pass `tx` as `db`. All are synchronous. Zero amounts are no-ops (return null).
 */

type Base = {
  shopId: string;
  userId: string | null;
  refId: string | null;
  date: number;
  note?: string;
};

function assertInt(n: number): void {
  if (!Number.isSafeInteger(n)) throw new AppError('VALIDATION', 'Amount must be whole paisa');
}

/** qty is signed: + in, − out. */
export function postStock(
  db: AppDb,
  p: Base & { productId: string; qty: number; type: (typeof stock_movements.$inferInsert)['type'] },
): string | null {
  const qty = roundQty(p.qty);
  if (qty === 0) return null;
  const row = newRow(p.shopId, p.userId);
  db.insert(stock_movements)
    .values({
      ...row,
      product_id: p.productId,
      qty,
      type: p.type,
      ref_id: p.refId,
      note: p.note ?? null,
      date: p.date,
    })
    .run();
  return row.id;
}

/** amount is signed: + cash in, − cash out. */
export function postCash(
  db: AppDb,
  p: Base & { amount: number; type: CashEntry['type']; method: Method },
): string | null {
  assertInt(p.amount);
  if (p.amount === 0) return null;
  const row = newRow(p.shopId, p.userId);
  db.insert(cash_entries)
    .values({
      ...row,
      amount: p.amount,
      type: p.type,
      method: p.method,
      ref_id: p.refId,
      date: p.date,
      note: p.note ?? null,
    })
    .run();
  return row.id;
}

/** amount is signed: + they owe us, − we owe them. */
export function postLedger(
  db: AppDb,
  p: Base & { partyId: string; amount: number; type: (typeof party_ledger.$inferInsert)['type'] },
): string | null {
  assertInt(p.amount);
  if (p.amount === 0) return null;
  const row = newRow(p.shopId, p.userId);
  db.insert(party_ledger)
    .values({
      ...row,
      party_id: p.partyId,
      amount: p.amount,
      type: p.type,
      ref_id: p.refId,
      date: p.date,
      note: p.note ?? null,
    })
    .run();
  return row.id;
}

const POSTING_TABLES: readonly SQLiteTable[] = [stock_movements, party_ledger, cash_entries];

export type DeleteTarget = {
  shopId: string;
  /** parent row table, e.g. `sales`, `purchases`, `expenses` */
  table: SQLiteTable;
  id: string;
  /** child item table + its FK column, e.g. `{ table: sale_items, fk: 'sale_id' }` */
  items?: { table: SQLiteTable; fk: string };
};

function readDeletedAt(db: AppDb, t: DeleteTarget): number | null {
  const row = db.get<{ deleted_at: number | null } | undefined>(
    sql`SELECT deleted_at FROM ${t.table} WHERE id = ${t.id} AND shop_id = ${t.shopId}`,
  );
  if (!row) throw new AppError('NOT_FOUND', 'Record not found');
  return row.deleted_at;
}

/** Soft-deletes parent, its items and every posting with ref_id = parent id (one shared timestamp). */
export function softDeleteWithRefs(db: AppDb, t: DeleteTarget): void {
  if (readDeletedAt(db, t) !== null) throw new AppError('CONFLICT', 'Already deleted');
  const at = Date.now();
  const set = sql`SET deleted_at = ${at}, updated_at = ${at}, dirty = 1`;
  db.run(sql`UPDATE ${t.table} ${set} WHERE id = ${t.id} AND shop_id = ${t.shopId}`);
  if (t.items) {
    db.run(
      sql`UPDATE ${t.items.table} ${set} WHERE ${sql.identifier(t.items.fk)} = ${t.id}
          AND shop_id = ${t.shopId} AND deleted_at IS NULL`,
    );
  }
  for (const table of POSTING_TABLES) {
    db.run(
      sql`UPDATE ${table} ${set} WHERE ref_id = ${t.id} AND shop_id = ${t.shopId} AND deleted_at IS NULL`,
    );
  }
}

/** Reverses softDeleteWithRefs: restores only rows deleted together with the parent. */
export function restoreWithRefs(db: AppDb, t: DeleteTarget): void {
  const deletedAt = readDeletedAt(db, t);
  if (deletedAt === null) throw new AppError('CONFLICT', 'Record is not deleted');
  const at = Date.now();
  const set = sql`SET deleted_at = NULL, updated_at = ${at}, dirty = 1`;
  db.run(sql`UPDATE ${t.table} ${set} WHERE id = ${t.id} AND shop_id = ${t.shopId}`);
  if (t.items) {
    db.run(
      sql`UPDATE ${t.items.table} ${set} WHERE ${sql.identifier(t.items.fk)} = ${t.id}
          AND shop_id = ${t.shopId} AND deleted_at = ${deletedAt}`,
    );
  }
  for (const table of POSTING_TABLES) {
    db.run(
      sql`UPDATE ${table} ${set} WHERE ref_id = ${t.id} AND shop_id = ${t.shopId} AND deleted_at = ${deletedAt}`,
    );
  }
}
