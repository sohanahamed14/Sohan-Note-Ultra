/** @jest-environment node */
import { isNull, sum } from 'drizzle-orm';
import { cash_entries, party_ledger } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { createTestDb } from '@/test/testDb';
import { createProduct, getProductById, getStock } from './products';
import {
  createPurchase,
  deletePurchase,
  getPurchaseDetail,
  listPurchases,
  listSuppliers,
  quickAddSupplier,
  restorePurchase,
} from './purchases';
import type { ServiceCtx } from './stock';

const ownerCtx: ServiceCtx = { shopId: 'shop1', userId: 'u1', role: 'owner' };
const cashierCtx: ServiceCtx = { shopId: 'shop1', userId: 'u3', role: 'cashier' };

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

describe('purchases service', () => {
  it('records partial-paid purchase: stock+, cash-, supplier ledger-, bill_no', () => {
    const db = createTestDb();
    const supplier = quickAddSupplier(db, ownerCtx, {
      name: 'Dhaka Wholesale',
      phone: '01711000000',
    });
    expect(listSuppliers(db, 'shop1')).toHaveLength(1);

    const p1 = createProduct(db, ownerCtx, {
      name: 'Rice 5kg',
      buy_price: 35000,
      sell_price: 42000,
      opening_stock: 2,
    });
    const p2 = createProduct(db, ownerCtx, {
      name: 'Lentil 1kg',
      buy_price: 12000,
      sell_price: 15000,
      opening_stock: 0,
    });

    const d = new Date(2026, 10, 20, 10, 0, 0).getTime();
    const detail = createPurchase(db, ownerCtx, {
      party_id: supplier.id,
      date: d,
      items: [
        { product_id: p1.id, name: p1.name, qty: 3, unit_price: 36000 }, // 108000
        { product_id: p2.id, name: p2.name, qty: 2.5, unit_price: 12000 }, // 30000
      ],
      discount: 8000,
      vat: 5000,
      paid: 100000,
      method: 'bkash',
      note: 'Morning stock-in',
      update_buy_price: true,
    });

    expect(detail.purchase.bill_no).toBe('BILL-20261120-0001');
    expect(detail.purchase.subtotal).toBe(138000);
    expect(detail.purchase.total).toBe(135000);
    expect(detail.purchase.paid).toBe(100000);
    expect(detail.purchase.due).toBe(35000);
    expect(detail.items).toHaveLength(2);
    expect(detail.supplier?.name).toBe('Dhaka Wholesale');

    // Effects: stock +, cash -paid, supplier ledger -due (we owe them)
    expect(getStock(db, 'shop1', p1.id)).toBe(5); // 2 + 3
    expect(getStock(db, 'shop1', p2.id)).toBe(2.5);
    expect(cashSum(db)).toBe(-100000);
    expect(ledgerSum(db)).toBe(-35000);

    // update_buy_price updated p1's buy_price
    expect(getProductById(db, 'shop1', p1.id)?.buy_price).toBe(36000);
  });

  it('handles full paid walk-in purchase (no supplier, no ledger) and full due purchase (no cash)', () => {
    const db = createTestDb();
    const p = createProduct(db, ownerCtx, { name: 'Salt', buy_price: 3000, opening_stock: 0 });
    const supplier = quickAddSupplier(db, ownerCtx, { name: 'Salt Co' });

    // Full paid without supplier
    const cashBuy = createPurchase(db, ownerCtx, {
      items: [{ product_id: p.id, name: p.name, qty: 5, unit_price: 3000 }],
      paid: 15000,
      method: 'cash',
    });
    expect(cashBuy.purchase.due).toBe(0);
    expect(cashSum(db)).toBe(-15000);
    expect(ledgerSum(db)).toBe(0);

    // Full due with supplier (paid = 0)
    const dueBuy = createPurchase(db, ownerCtx, {
      party_id: supplier.id,
      items: [{ product_id: p.id, name: p.name, qty: 4, unit_price: 3000 }],
      paid: 0,
      method: 'cash',
    });
    expect(dueBuy.purchase.paid).toBe(0);
    expect(dueBuy.purchase.due).toBe(12000);
    expect(getStock(db, 'shop1', p.id)).toBe(9);
    expect(cashSum(db)).toBe(-15000);
    expect(ledgerSum(db)).toBe(-12000);
  });

  it('rejects overpay, due without supplier, discount > subtotal, empty items, and cashier buy', () => {
    const db = createTestDb();
    const supplier = quickAddSupplier(db, ownerCtx, { name: 'Sup A' });
    const p = createProduct(db, ownerCtx, { name: 'Flour', buy_price: 5000 });

    // Overpay -> OVERPAY
    try {
      createPurchase(db, ownerCtx, {
        party_id: supplier.id,
        items: [{ product_id: p.id, name: p.name, qty: 2, unit_price: 5000 }],
        paid: 10001,
      });
      fail('should throw OVERPAY');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('OVERPAY');
    }

    // Due without supplier -> VALIDATION
    expect(() =>
      createPurchase(db, ownerCtx, {
        items: [{ product_id: p.id, name: p.name, qty: 2, unit_price: 5000 }],
        paid: 5000,
      }),
    ).toThrow(AppError);

    // Discount > subtotal
    expect(() =>
      createPurchase(db, ownerCtx, {
        items: [{ product_id: p.id, name: p.name, qty: 1, unit_price: 5000 }],
        discount: 6000,
        paid: 0,
      }),
    ).toThrow(AppError);

    // Empty items
    expect(() => createPurchase(db, ownerCtx, { items: [], paid: 0 })).toThrow(AppError);

    // Cashier forbidden
    expect(() =>
      createPurchase(db, cashierCtx, {
        items: [{ product_id: p.id, name: p.name, qty: 1, unit_price: 5000 }],
        paid: 5000,
      }),
    ).toThrow(AppError);

    expect(getStock(db, 'shop1', p.id)).toBe(0);
    expect(cashSum(db)).toBe(0);
    expect(ledgerSum(db)).toBe(0);
  });

  it('filters purchase ledger by date, status, search and computes totals', () => {
    const db = createTestDb();
    const s1 = quickAddSupplier(db, ownerCtx, { name: 'Alpha Traders' });
    const s2 = quickAddSupplier(db, ownerCtx, { name: 'Beta Supply' });

    const d1 = new Date(2026, 10, 10, 12, 0).getTime();
    const d2 = new Date(2026, 10, 20, 12, 0).getTime();

    createPurchase(db, ownerCtx, {
      party_id: s1.id,
      date: d1,
      items: [{ name: 'Bulk Rice', qty: 1, unit_price: 50000 }],
      paid: 50000,
    });
    createPurchase(db, ownerCtx, {
      party_id: s2.id,
      date: d2,
      items: [{ name: 'Bulk Sugar', qty: 2, unit_price: 20000 }],
      paid: 15000,
    });

    const all = listPurchases(db, 'shop1');
    expect(all.totals).toEqual({ count: 2, total: 90000, paid: 65000, due: 25000 });

    const dueOnly = listPurchases(db, 'shop1', { status: 'due' });
    expect(dueOnly.items).toHaveLength(1);
    expect(dueOnly.items[0].supplierName).toBe('Beta Supply');
    expect(dueOnly.totals.due).toBe(25000);

    const dateFiltered = listPurchases(db, 'shop1', { from: d2 - 1000, to: d2 + 1000 });
    expect(dateFiltered.items).toHaveLength(1);
    expect(dateFiltered.totals.total).toBe(40000);

    const searchFiltered = listPurchases(db, 'shop1', { search: 'alpha' });
    expect(searchFiltered.items).toHaveLength(1);
  });

  it('delete reverses stock, cash, ledger and items; restore re-applies them', () => {
    const db = createTestDb();
    const supplier = quickAddSupplier(db, ownerCtx, { name: 'Mega Mart' });
    const p = createProduct(db, ownerCtx, { name: 'Milk', buy_price: 8000, opening_stock: 1 });

    const created = createPurchase(db, ownerCtx, {
      party_id: supplier.id,
      items: [{ product_id: p.id, name: p.name, qty: 4, unit_price: 8000 }],
      paid: 20000,
      method: 'cash',
    });

    expect(getStock(db, 'shop1', p.id)).toBe(5);
    expect(cashSum(db)).toBe(-20000);
    expect(ledgerSum(db)).toBe(-12000);

    // Cashier cannot delete
    expect(() => deletePurchase(db, cashierCtx, created.purchase.id)).toThrow(AppError);

    deletePurchase(db, ownerCtx, created.purchase.id);
    expect(getPurchaseDetail(db, 'shop1', created.purchase.id)).toBeNull();
    expect(listPurchases(db, 'shop1').items).toHaveLength(0);
    expect(getStock(db, 'shop1', p.id)).toBe(1); // back to opening stock
    expect(cashSum(db)).toBe(0);
    expect(ledgerSum(db)).toBe(0);

    restorePurchase(db, ownerCtx, created.purchase.id);
    expect(getPurchaseDetail(db, 'shop1', created.purchase.id)?.items).toHaveLength(1);
    expect(getStock(db, 'shop1', p.id)).toBe(5);
    expect(cashSum(db)).toBe(-20000);
    expect(ledgerSum(db)).toBe(-12000);
  });
});
