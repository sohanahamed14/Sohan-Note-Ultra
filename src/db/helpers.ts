import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/id';
import type { AppDb } from './types';

export type RowBase = {
  id: string;
  shop_id: string;
  created_at: number;
  updated_at: number;
  deleted_at: null;
  created_by: string | null;
  dirty: 1;
};

/** Common columns for a new synced row. Spread into `db.insert(t).values({...newRow(), ...})`. */
export function newRow(shopId: string, userId: string | null, at: number = Date.now()): RowBase {
  return {
    id: newId(),
    shop_id: shopId,
    created_at: at,
    updated_at: at,
    deleted_at: null,
    created_by: userId,
    dirty: 1,
  };
}

/** Spread into `.set({...touch(), ...})` on every update. */
export function touch(at: number = Date.now()): { updated_at: number; dirty: 1 } {
  return { updated_at: at, dirty: 1 };
}

type Scoped = { shop_id: AnySQLiteColumn; deleted_at: AnySQLiteColumn };

/** `shop_id = ? AND deleted_at IS NULL` — add extra conditions with `and(active(t, shop), ...)`. */
export function active(table: Scoped, shopId: string): SQL {
  return and(eq(table.shop_id, shopId), isNull(table.deleted_at)) as SQL;
}

/** Soft-delete a single row. Throws NOT_FOUND if missing or already deleted. */
export function softDelete(db: AppDb, table: SQLiteTable, shopId: string, id: string): void {
  const at = Date.now();
  const res = db.run(
    sql`UPDATE ${table} SET deleted_at = ${at}, updated_at = ${at}, dirty = 1
        WHERE id = ${id} AND shop_id = ${shopId} AND deleted_at IS NULL`,
  );
  if (!res || (res as { changes?: number }).changes === 0) {
    throw new AppError('NOT_FOUND', 'Record not found');
  }
}
