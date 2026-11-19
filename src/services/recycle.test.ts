/** @jest-environment node */
import { eq, isNull, sum } from 'drizzle-orm';
import { newRow, softDelete } from '@/db/helpers';
import {
  cash_entries,
  categories,
  expenses,
  parties,
  party_ledger,
  products,
  purchase_items,
  purchases,
  sale_items,
  sales,
  stock_movements,
} from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { createTestDb } from '@/test/testDb';
import { postCash, postLedger, postStock, softDeleteWithRefs } from './posting';
import { deleteForever, emptyRecycleBin, listDeleted, restoreItem } from './recycle';

const SHOP = 'shop-rec';

const stockTotal = (db: AppDb) =>
  Number(
    db
      .select({ s: sum(stock_movements.qty) })
      .from(stock_movements)
      .where(isNull(stock_movements.deleted_at))
      .get()?.s ?? 0,
  );
const cashTotal = (db: AppDb) =>
  Number(
    db
      .select({ s: sum(cash_entries.amount) })
      .from(cash_entries)
      .where(isNull(cash_entries.deleted_at))
      .get()?.s ?? 0,
  );
const ledgerTotal = (db: AppDb) =>
  Number(
    db
      .select({ s: sum(party_ledger.amount) })
      .from(party_ledger)
      .where(isNull(party_ledger.deleted_at))
      .get()?.s ?? 0,
  );

function seedDeletedSale(db: AppDb): string {
  const row = newRow(SHOP, 'u1');
  db.transaction((tx) => {
    tx.insert(sales)
      .values({
        ...row,
        invoice_no: 'INV-20261120-0001',
        date: 1000,
        subtotal: 5000,
        total: 5000,
        paid: 3000,
        due: 2000,
      })
      .run();
    tx.insert(sale_items)
      .values({
        ...newRow(SHOP, 'u1'),
        sale_id: row.id,
        product_id: 'p1',
        name: 'Item A',
        qty: 3,
        unit_price: 1000,
        total: 3000,
      })
      .run();
    postStock(tx, { shopId: SHOP, userId: 'u1', refId: row.id, date: 1000, productId: 'p1', qty: -3, type: 'sale' });
    postCash(tx, { shopId: SHOP, userId: 'u1', refId: row.id, date: 1000, amount: 3000, type: 'sale', method: 'cash' });
    postLedger(tx, { shopId: SHOP, userId: 'u1', refId: row.id, date: 1000, partyId: 'c1', amount: 2000, type: 'sale_due' });
    softDeleteWithRefs(tx, {
      shopId: SHOP,
      table: sales,
      id: row.id,
      items: { table: sale_items, fk: 'sale_id' },
    });
  });
  return row.id;
}

function seedDeletedPurchase(db: AppDb): string {
  const row = newRow(SHOP, 'u1');
  db.transaction((tx) => {
    tx.insert(purchases)
      .values({
        ...row,
        bill_no: 'BILL-20261120-0001',
        date: 1000,
        subtotal: 4000,
        total: 4000,
        paid: 1000,
        due: 3000,
      })
      .run();
    tx.insert(purchase_items)
      .values({
        ...newRow(SHOP, 'u1'),
        purchase_id: row.id,
        product_id: 'p1',
        name: 'Item A',
        qty: 4,
        unit_price: 1000,
        total: 4000,
      })
      .run();
    postStock(tx, { shopId: SHOP, userId: 'u1', refId: row.id, date: 1000, productId: 'p1', qty: 4, type: 'purchase' });
    postCash(tx, { shopId: SHOP, userId: 'u1', refId: row.id, date: 1000, amount: -1000, type: 'purchase', method: 'cash' });
    postLedger(tx, { shopId: SHOP, userId: 'u1', refId: row.id, date: 1000, partyId: 'sup1', amount: -3000, type: 'purchase_due' });
    softDeleteWithRefs(tx, {
      shopId: SHOP,
      table: purchases,
      id: row.id,
      items: { table: purchase_items, fk: 'purchase_id' },
    });
  });
  return row.id;
}

describe('recycle service', () => {
  it('lists deleted top-level records and omits child postings with ref_id', () => {
    const db = createTestDb();
    seedDeletedSale(db);
    seedDeletedPurchase(db);

    const expRow = newRow(SHOP, 'u1');
    db.insert(expenses).values({ ...expRow, amount: 500, date: 1000, note: 'Tea' }).run();
    softDelete(db, expenses, SHOP, expRow.id);

    const cashId = postCash(db, {
      shopId: SHOP,
      userId: 'u1',
      refId: null,
      date: 1000,
      amount: 1000,
      type: 'cash_in',
      method: 'cash',
      note: 'Manual cash',
    });
    if (cashId) softDelete(db, cash_entries, SHOP, cashId);

    const all = listDeleted(db, SHOP, 'owner');
    // Exactly 4 top-level records: 1 sale, 1 purchase, 1 expense, 1 standalone cash entry
    expect(all).toHaveLength(4);
    expect(all.map((i) => i.entity).sort()).toEqual(['cash', 'expense', 'purchase', 'sale']);

    expect(listDeleted(db, SHOP, 'manager', 'sale')).toHaveLength(1);
    expect(() => listDeleted(db, SHOP, 'cashier')).toThrow(AppError);
  });

  it('restores sale and purchase via restoreWithRefs re-applying stock, cash, ledger and items', () => {
    const db = createTestDb();
    const saleId = seedDeletedSale(db);
    const purchaseId = seedDeletedPurchase(db);

    expect([stockTotal(db), cashTotal(db), ledgerTotal(db)]).toEqual([0, 0, 0]);

    expect(() => restoreItem(db, SHOP, 'cashier', 'sale', saleId)).toThrow(AppError);

    restoreItem(db, SHOP, 'owner', 'sale', saleId);
    expect([stockTotal(db), cashTotal(db), ledgerTotal(db)]).toEqual([-3, 3000, 2000]);
    expect(db.select().from(sale_items).where(isNull(sale_items.deleted_at)).all()).toHaveLength(1);

    restoreItem(db, SHOP, 'manager', 'purchase', purchaseId);
    expect([stockTotal(db), cashTotal(db), ledgerTotal(db)]).toEqual([1, 2000, -1000]);
    expect(
      db.select().from(purchase_items).where(isNull(purchase_items.deleted_at)).all(),
    ).toHaveLength(1);

    // Restoring already active item throws CONFLICT
    expect(() => restoreItem(db, SHOP, 'owner', 'sale', saleId)).toThrow(AppError);
  });

  it('permanently deletes soft-deleted item + refs and refuses active rows', () => {
    const db = createTestDb();
    const saleId = seedDeletedSale(db);

    // Active product cannot be deleted forever
    const prod = newRow(SHOP, 'u1');
    db.insert(products).values({ ...prod, name: 'Active Item' }).run();
    expect(() => deleteForever(db, SHOP, 'owner', 'product', prod.id)).toThrow(AppError);

    // Cashier forbidden
    expect(() => deleteForever(db, SHOP, 'cashier', 'sale', saleId)).toThrow(AppError);

    deleteForever(db, SHOP, 'owner', 'sale', saleId);
    expect(db.select().from(sales).where(eq(sales.id, saleId)).get()).toBeUndefined();
    expect(db.select().from(sale_items).all()).toHaveLength(0);
    expect(db.select().from(stock_movements).all()).toHaveLength(0);
    expect(db.select().from(cash_entries).all()).toHaveLength(0);
    expect(db.select().from(party_ledger).all()).toHaveLength(0);
  });

  it('empties recycle bin across tables', () => {
    const db = createTestDb();
    seedDeletedSale(db);
    const p = newRow(SHOP, 'u1');
    db.insert(parties).values({ ...p, type: 'customer', name: 'Old Customer' }).run();
    softDelete(db, parties, SHOP, p.id);

    const c = newRow(SHOP, 'u1');
    db.insert(categories).values({ ...c, name: 'Old Cat', kind: 'product' }).run();
    softDelete(db, categories, SHOP, c.id);

    expect(() => emptyRecycleBin(db, SHOP, 'cashier')).toThrow(AppError);
    const purged = emptyRecycleBin(db, SHOP, 'owner');
    expect(purged).toBe(3);
    expect(listDeleted(db, SHOP, 'owner')).toHaveLength(0);
  });
});
