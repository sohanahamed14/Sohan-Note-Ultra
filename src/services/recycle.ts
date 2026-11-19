import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import {
  cash_entries,
  categories,
  expenses,
  online_orders,
  parties,
  party_ledger,
  products,
  purchase_items,
  purchases,
  sale_items,
  sales,
  stock_movements,
  type Role,
} from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { can } from './permissions';
import { restoreWithRefs, type DeleteTarget } from './posting';

export const RECYCLE_ENTITIES = [
  'sale',
  'purchase',
  'expense',
  'product',
  'party',
  'cash',
  'ledger',
  'category',
  'online_order',
] as const;

export type RecycleEntity = (typeof RECYCLE_ENTITIES)[number];

export type RecycleItem = {
  id: string;
  entity: RecycleEntity;
  title: string;
  subtitle: string | null;
  amount: number | null;
  deletedAt: number;
};

const POSTING_TABLES: readonly SQLiteTable[] = [stock_movements, party_ledger, cash_entries];

function buildTarget(shopId: string, entity: RecycleEntity, id: string): DeleteTarget {
  switch (entity) {
    case 'sale':
      return { shopId, table: sales, id, items: { table: sale_items, fk: 'sale_id' } };
    case 'purchase':
      return { shopId, table: purchases, id, items: { table: purchase_items, fk: 'purchase_id' } };
    case 'expense':
      return { shopId, table: expenses, id };
    case 'product':
      return { shopId, table: products, id };
    case 'party':
      return { shopId, table: parties, id };
    case 'cash':
      return { shopId, table: cash_entries, id };
    case 'ledger':
      return { shopId, table: party_ledger, id };
    case 'category':
      return { shopId, table: categories, id };
    case 'online_order':
      return { shopId, table: online_orders, id };
  }
}

/** Lists all soft-deleted top-level records in the recycle bin, newest deleted first. */
export function listDeleted(
  db: AppDb,
  shopId: string,
  role: Role,
  filter?: RecycleEntity | 'all',
): RecycleItem[] {
  if (!can(role, 'restore')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to view the recycle bin');
  }
  const want = (e: RecycleEntity) => !filter || filter === 'all' || filter === e;
  const items: RecycleItem[] = [];

  if (want('sale')) {
    const rows = db
      .select()
      .from(sales)
      .where(and(eq(sales.shop_id, shopId), isNotNull(sales.deleted_at)))
      .orderBy(desc(sales.deleted_at))
      .all();
    for (const r of rows) {
      items.push({
        id: r.id,
        entity: 'sale',
        title: r.invoice_no,
        subtitle: [r.kind.toUpperCase(), r.note].filter(Boolean).join(' · ') || 'Sale',
        amount: r.total,
        deletedAt: r.deleted_at ?? r.updated_at,
      });
    }
  }

  if (want('purchase')) {
    const rows = db
      .select()
      .from(purchases)
      .where(and(eq(purchases.shop_id, shopId), isNotNull(purchases.deleted_at)))
      .orderBy(desc(purchases.deleted_at))
      .all();
    for (const r of rows) {
      items.push({
        id: r.id,
        entity: 'purchase',
        title: r.bill_no,
        subtitle: r.note ?? 'Purchase',
        amount: r.total,
        deletedAt: r.deleted_at ?? r.updated_at,
      });
    }
  }

  if (want('expense')) {
    const rows = db
      .select()
      .from(expenses)
      .where(and(eq(expenses.shop_id, shopId), isNotNull(expenses.deleted_at)))
      .orderBy(desc(expenses.deleted_at))
      .all();
    for (const r of rows) {
      items.push({
        id: r.id,
        entity: 'expense',
        title: r.note?.trim() || 'Expense',
        subtitle: r.method.toUpperCase(),
        amount: r.amount,
        deletedAt: r.deleted_at ?? r.updated_at,
      });
    }
  }

  if (want('product')) {
    const rows = db
      .select()
      .from(products)
      .where(and(eq(products.shop_id, shopId), isNotNull(products.deleted_at)))
      .orderBy(desc(products.deleted_at))
      .all();
    for (const r of rows) {
      items.push({
        id: r.id,
        entity: 'product',
        title: r.name,
        subtitle: [r.unit, r.code].filter(Boolean).join(' · ') || 'Product',
        amount: r.sell_price,
        deletedAt: r.deleted_at ?? r.updated_at,
      });
    }
  }

  if (want('party')) {
    const rows = db
      .select()
      .from(parties)
      .where(and(eq(parties.shop_id, shopId), isNotNull(parties.deleted_at)))
      .orderBy(desc(parties.deleted_at))
      .all();
    for (const r of rows) {
      items.push({
        id: r.id,
        entity: 'party',
        title: r.name,
        subtitle: [r.type, r.phone].filter(Boolean).join(' · '),
        amount: null,
        deletedAt: r.deleted_at ?? r.updated_at,
      });
    }
  }

  if (want('cash')) {
    const rows = db
      .select()
      .from(cash_entries)
      .where(
        and(
          eq(cash_entries.shop_id, shopId),
          isNotNull(cash_entries.deleted_at),
          isNull(cash_entries.ref_id),
        ),
      )
      .orderBy(desc(cash_entries.deleted_at))
      .all();
    for (const r of rows) {
      items.push({
        id: r.id,
        entity: 'cash',
        title: r.note?.trim() || r.type.replace('_', ' '),
        subtitle: `${r.type.replace('_', ' ')} · ${r.method.toUpperCase()}`,
        amount: r.amount,
        deletedAt: r.deleted_at ?? r.updated_at,
      });
    }
  }

  if (want('ledger')) {
    const rows = db
      .select()
      .from(party_ledger)
      .where(
        and(
          eq(party_ledger.shop_id, shopId),
          isNotNull(party_ledger.deleted_at),
          isNull(party_ledger.ref_id),
        ),
      )
      .orderBy(desc(party_ledger.deleted_at))
      .all();
    for (const r of rows) {
      items.push({
        id: r.id,
        entity: 'ledger',
        title: r.note?.trim() || `Due entry (${r.type})`,
        subtitle: r.type,
        amount: r.amount,
        deletedAt: r.deleted_at ?? r.updated_at,
      });
    }
  }

  if (want('category')) {
    const rows = db
      .select()
      .from(categories)
      .where(and(eq(categories.shop_id, shopId), isNotNull(categories.deleted_at)))
      .orderBy(desc(categories.deleted_at))
      .all();
    for (const r of rows) {
      items.push({
        id: r.id,
        entity: 'category',
        title: r.name,
        subtitle: `${r.kind} category`,
        amount: null,
        deletedAt: r.deleted_at ?? r.updated_at,
      });
    }
  }

  if (want('online_order')) {
    const rows = db
      .select()
      .from(online_orders)
      .where(and(eq(online_orders.shop_id, shopId), isNotNull(online_orders.deleted_at)))
      .orderBy(desc(online_orders.deleted_at))
      .all();
    for (const r of rows) {
      items.push({
        id: r.id,
        entity: 'online_order',
        title: `${r.order_no} · ${r.customer_name}`,
        subtitle: `${r.status} · ${r.phone}`,
        amount: r.total,
        deletedAt: r.deleted_at ?? r.updated_at,
      });
    }
  }

  return items.sort((a, b) => b.deletedAt - a.deletedAt);
}

/** Restores a soft-deleted record along with its child items and linked postings in one transaction. */
export function restoreItem(
  db: AppDb,
  shopId: string,
  role: Role,
  entity: RecycleEntity,
  id: string,
): void {
  if (!can(role, 'restore')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to restore records');
  }
  const target = buildTarget(shopId, entity, id);
  db.transaction((tx) => {
    restoreWithRefs(tx, target);
  });
}

function purgeTarget(tx: AppDb, target: DeleteTarget): void {
  const row = tx.get<{ deleted_at: number | null } | undefined>(
    sql`SELECT deleted_at FROM ${target.table} WHERE id = ${target.id} AND shop_id = ${target.shopId}`,
  );
  if (!row) throw new AppError('NOT_FOUND', 'Record not found');
  if (row.deleted_at === null) {
    throw new AppError('CONFLICT', 'Only soft-deleted records can be permanently deleted');
  }
  const deletedAt = row.deleted_at;

  if (target.items) {
    tx.run(
      sql`DELETE FROM ${target.items.table}
          WHERE ${sql.identifier(target.items.fk)} = ${target.id}
            AND shop_id = ${target.shopId}
            AND deleted_at = ${deletedAt}`,
    );
  }
  for (const postingTable of POSTING_TABLES) {
    tx.run(
      sql`DELETE FROM ${postingTable}
          WHERE ref_id = ${target.id}
            AND shop_id = ${target.shopId}
            AND deleted_at = ${deletedAt}`,
    );
  }
  tx.run(sql`DELETE FROM ${target.table} WHERE id = ${target.id} AND shop_id = ${target.shopId}`);
}

/** Permanently purges a soft-deleted record and its co-deleted children/postings from local DB. */
export function deleteForever(
  db: AppDb,
  shopId: string,
  role: Role,
  entity: RecycleEntity,
  id: string,
): void {
  if (!can(role, 'delete')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to permanently delete records');
  }
  const target = buildTarget(shopId, entity, id);
  db.transaction((tx) => {
    purgeTarget(tx, target);
  });
}

/** Permanently purges all items currently in the shop's recycle bin. */
export function emptyRecycleBin(db: AppDb, shopId: string, role: Role): number {
  if (!can(role, 'delete')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to empty the recycle bin');
  }
  const items = listDeleted(db, shopId, role);
  if (items.length === 0) return 0;

  return db.transaction((tx) => {
    let count = 0;
    for (const item of items) {
      const target = buildTarget(shopId, item.entity, item.id);
      const exists = tx.get<{ deleted_at: number | null } | undefined>(
        sql`SELECT deleted_at FROM ${target.table} WHERE id = ${target.id} AND shop_id = ${target.shopId}`,
      );
      if (exists && exists.deleted_at !== null) {
        purgeTarget(tx, target);
        count += 1;
      }
    }
    return count;
  });
}
