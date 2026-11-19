/** @jest-environment node */
import { and, eq, isNull, sum } from 'drizzle-orm';
import { newRow } from '@/db/helpers';
import { cash_entries, party_ledger, sale_items, sales, stock_movements } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { nextInvoiceNo } from '@/lib/invoiceNo';
import { createTestDb } from '@/test/testDb';
import { postCash, postLedger, postStock, restoreWithRefs, softDeleteWithRefs } from './posting';

const SHOP = 'shop1';
const base = { shopId: SHOP, userId: 'u1', date: 1000 };

function makeSale(db: AppDb): string {
  const row = newRow(SHOP, 'u1');
  db.transaction((tx) => {
    tx.insert(sales)
      .values({
        ...row,
        invoice_no: 'INV-1',
        date: 1000,
        subtotal: 1000,
        total: 1000,
        paid: 400,
        due: 600,
      })
      .run();
    tx.insert(sale_items)
      .values({
        ...newRow(SHOP, 'u1'),
        sale_id: row.id,
        name: 'x',
        qty: 2,
        unit_price: 500,
        total: 1000,
      })
      .run();
    postStock(tx, { ...base, refId: row.id, productId: 'p1', qty: -2, type: 'sale' });
    postCash(tx, { ...base, refId: row.id, amount: 400, type: 'sale', method: 'cash' });
    postLedger(tx, { ...base, refId: row.id, partyId: 'c1', amount: 600, type: 'sale_due' });
  });
  return row.id;
}

const stockSum = (db: AppDb) =>
  Number(
    db
      .select({ s: sum(stock_movements.qty) })
      .from(stock_movements)
      .where(isNull(stock_movements.deleted_at))
      .get()?.s ?? 0,
  );
const cashSum = (db: AppDb) =>
  Number(
    db
      .select({ s: sum(cash_entries.amount) })
      .from(cash_entries)
      .where(isNull(cash_entries.deleted_at))
      .get()?.s ?? 0,
  );
const ledgerSum = (db: AppDb) =>
  Number(
    db
      .select({ s: sum(party_ledger.amount) })
      .from(party_ledger)
      .where(isNull(party_ledger.deleted_at))
      .get()?.s ?? 0,
  );

describe('posting', () => {
  it('posts rows with common columns', () => {
    const db = createTestDb();
    const id = postCash(db, {
      ...base,
      refId: null,
      amount: 500,
      type: 'cash_in',
      method: 'bkash',
    });
    const row = db
      .select()
      .from(cash_entries)
      .where(eq(cash_entries.id, id ?? ''))
      .get();
    expect(row).toMatchObject({
      amount: 500,
      dirty: 1,
      deleted_at: null,
      shop_id: SHOP,
      method: 'bkash',
    });
  });
  it('zero amounts are no-ops', () => {
    const db = createTestDb();
    expect(
      postCash(db, { ...base, refId: null, amount: 0, type: 'sale', method: 'cash' }),
    ).toBeNull();
    expect(
      postLedger(db, { ...base, refId: null, partyId: 'c', amount: 0, type: 'give' }),
    ).toBeNull();
    expect(
      postStock(db, { ...base, refId: null, productId: 'p', qty: 0, type: 'adjust' }),
    ).toBeNull();
  });
  it('rejects fractional paisa', () => {
    const db = createTestDb();
    expect(() =>
      postCash(db, { ...base, refId: null, amount: 1.5, type: 'sale', method: 'cash' }),
    ).toThrow(AppError);
  });
  it('rounds qty to 3dp', () => {
    const db = createTestDb();
    postStock(db, { ...base, refId: null, productId: 'p', qty: 0.1 + 0.2, type: 'opening' });
    expect(stockSum(db)).toBe(0.3);
  });
  it('delete reverses all effects, restore re-applies', () => {
    const db = createTestDb();
    const id = makeSale(db);
    const target = { shopId: SHOP, table: sales, id, items: { table: sale_items, fk: 'sale_id' } };
    expect([stockSum(db), cashSum(db), ledgerSum(db)]).toEqual([-2, 400, 600]);
    db.transaction((tx) => softDeleteWithRefs(tx, target));
    expect([stockSum(db), cashSum(db), ledgerSum(db)]).toEqual([0, 0, 0]);
    expect(
      db
        .select()
        .from(sale_items)
        .where(and(eq(sale_items.sale_id, id), isNull(sale_items.deleted_at)))
        .all(),
    ).toHaveLength(0);
    expect(() => softDeleteWithRefs(db, target)).toThrow(AppError);
    db.transaction((tx) => restoreWithRefs(tx, target));
    expect([stockSum(db), cashSum(db), ledgerSum(db)]).toEqual([-2, 400, 600]);
    expect(db.select().from(sales).get()?.deleted_at).toBeNull();
    expect(() => restoreWithRefs(db, target)).toThrow(AppError);
  });
  it('restore leaves rows deleted earlier untouched', () => {
    const db = createTestDb();
    const id = makeSale(db);
    const cash = db.select().from(cash_entries).get();
    db.update(cash_entries)
      .set({ deleted_at: 5 })
      .where(eq(cash_entries.id, cash?.id ?? ''))
      .run();
    const target = { shopId: SHOP, table: sales, id };
    softDeleteWithRefs(db, target);
    restoreWithRefs(db, target);
    expect(cashSum(db)).toBe(0);
    expect(ledgerSum(db)).toBe(600);
  });
  it('rolls back with the surrounding transaction', () => {
    const db = createTestDb();
    expect(() =>
      db.transaction((tx) => {
        postCash(tx, { ...base, refId: null, amount: 100, type: 'cash_in', method: 'cash' });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(cashSum(db)).toBe(0);
  });
  it('missing parent → NOT_FOUND; other shop untouched', () => {
    const db = createTestDb();
    const id = makeSale(db);
    expect(() => softDeleteWithRefs(db, { shopId: SHOP, table: sales, id: 'nope' })).toThrow(
      AppError,
    );
    expect(() => softDeleteWithRefs(db, { shopId: 'other', table: sales, id })).toThrow(AppError);
  });
  it('nextInvoiceNo increments per day and ignores deleted', () => {
    const db = createTestDb();
    const d = new Date(2026, 10, 20).getTime();
    expect(nextInvoiceNo(db, SHOP, 'sale', d)).toBe('INV-20261120-0001');
    db.insert(sales)
      .values({
        ...newRow(SHOP, null),
        invoice_no: 'INV-20261120-0001',
        date: d,
        subtotal: 1,
        total: 1,
      })
      .run();
    expect(nextInvoiceNo(db, SHOP, 'sale', d)).toBe('INV-20261120-0002');
    expect(nextInvoiceNo(db, SHOP, 'purchase', d)).toBe('BILL-20261120-0001');
    expect(nextInvoiceNo(db, 'other', 'sale', d)).toBe('INV-20261120-0001');
  });
});
