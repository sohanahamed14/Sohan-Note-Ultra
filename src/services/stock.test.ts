/** @jest-environment node */
import { AppError } from '@/lib/errors';
import { createTestDb } from '@/test/testDb';
import { createProduct } from './products';
import {
  adjustStock,
  getStock,
  getStockMap,
  getStockSummary,
  listStockMovements,
  type ServiceCtx,
} from './stock';

const ownerCtx: ServiceCtx = { shopId: 'shop1', userId: 'u1', role: 'owner' };
const managerCtx: ServiceCtx = { shopId: 'shop1', userId: 'u2', role: 'manager' };
const cashierCtx: ServiceCtx = { shopId: 'shop1', userId: 'u3', role: 'cashier' };

describe('stock service', () => {
  it('adjusts stock in delta and set modes and records movement history', () => {
    const db = createTestDb();
    const p = createProduct(db, ownerCtx, {
      name: 'Sugar',
      unit: 'kg',
      buy_price: 12000,
      sell_price: 14000,
      opening_stock: 5,
    });

    const addRes = adjustStock(db, ownerCtx, {
      productId: p.id,
      mode: 'delta',
      qty: 2.25,
      note: 'Restock bonus',
      date: 2000,
    });
    expect(addRes.previousStock).toBe(5);
    expect(addRes.newStock).toBe(7.25);
    expect(addRes.movementId).toBeTruthy();

    const remRes = adjustStock(db, managerCtx, {
      productId: p.id,
      mode: 'delta',
      qty: -1.25,
      note: 'Damaged pack',
      date: 3000,
    });
    expect(remRes.newStock).toBe(6);

    const setRes = adjustStock(db, ownerCtx, {
      productId: p.id,
      mode: 'set',
      qty: 10,
      note: 'Physical count',
      date: 4000,
    });
    expect(setRes.previousStock).toBe(6);
    expect(setRes.newStock).toBe(10);

    // Zero delta is a no-op
    const noopRes = adjustStock(db, ownerCtx, { productId: p.id, mode: 'set', qty: 10 });
    expect(noopRes.movementId).toBeNull();
    expect(getStock(db, 'shop1', p.id)).toBe(10);

    const movements = listStockMovements(db, 'shop1', { productId: p.id });
    expect(movements).toHaveLength(4); // opening + 3 adjustments
    expect(movements.map((m) => m.type)).toContain('opening');
    expect(movements.filter((m) => m.type === 'adjust')).toHaveLength(3);
    expect(movements[0].productName).toBe('Sugar');
    expect(movements[0].productUnit).toBe('kg');
  });

  it('rejects removing more than available stock, negative set, missing product, and cashier adjust', () => {
    const db = createTestDb();
    const p = createProduct(db, ownerCtx, { name: 'Oil', opening_stock: 3 });

    try {
      adjustStock(db, ownerCtx, { productId: p.id, mode: 'delta', qty: -5 });
      fail('should throw INSUFFICIENT_STOCK');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('INSUFFICIENT_STOCK');
    }

    expect(() => adjustStock(db, ownerCtx, { productId: p.id, mode: 'set', qty: -1 })).toThrow(
      AppError,
    );
    expect(() => adjustStock(db, ownerCtx, { productId: 'missing', qty: 1 })).toThrow(AppError);
    expect(() => adjustStock(db, cashierCtx, { productId: p.id, qty: 1 })).toThrow(AppError);

    expect(getStock(db, 'shop1', p.id)).toBe(3);
  });

  it('computes stock summary totals and hides cost from cashier', () => {
    const db = createTestDb();
    const p1 = createProduct(db, ownerCtx, {
      name: 'Item A',
      buy_price: 10000, // 100
      sell_price: 15000, // 150
      opening_stock: 4,
      low_stock_alert: 5,
    });
    const p2 = createProduct(db, ownerCtx, {
      name: 'Item B',
      buy_price: 5000, // 50
      sell_price: 8000, // 80
      opening_stock: 0,
      low_stock_alert: 2,
    });
    const p3 = createProduct(db, ownerCtx, {
      name: 'Item C',
      buy_price: 2000, // 20
      sell_price: 3000, // 30
      opening_stock: 10,
      low_stock_alert: 2,
    });

    const map = getStockMap(db, 'shop1', [p1.id, p2.id, p3.id]);
    expect(map.get(p1.id)).toBe(4);
    expect(map.get(p2.id)).toBeUndefined();
    expect(map.get(p3.id)).toBe(10);

    const ownerSummary = getStockSummary(db, 'shop1', { role: 'owner' });
    expect(ownerSummary.totalProducts).toBe(3);
    expect(ownerSummary.totalUnits).toBe(14);
    expect(ownerSummary.lowStockCount).toBe(2); // Item A (4<=5), Item B (0<=2)
    expect(ownerSummary.outOfStockCount).toBe(1); // Item B
    expect(ownerSummary.totalValue).toBe(4 * 10000 + 10 * 2000); // 60000
    expect(ownerSummary.totalSellValue).toBe(4 * 15000 + 10 * 3000); // 90000

    const lowOnly = getStockSummary(db, 'shop1', { role: 'owner', filter: 'low' });
    expect(lowOnly.items.map((i) => i.name)).toEqual(['Item A', 'Item B']);

    const outOnly = getStockSummary(db, 'shop1', { role: 'owner', filter: 'out' });
    expect(outOnly.items.map((i) => i.name)).toEqual(['Item B']);

    // Cashier cannot see cost prices or cost-based valuation
    const cashierSummary = getStockSummary(db, 'shop1', { role: 'cashier' });
    expect(cashierSummary.totalValue).toBeNull();
    expect(cashierSummary.totalSellValue).toBe(90000);
    for (const item of cashierSummary.items) {
      expect(item.buy_price).toBe(0);
      expect(item.stockValue).toBeNull();
    }
  });
});
