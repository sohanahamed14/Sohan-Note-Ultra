/** @jest-environment node */
import { AppError } from '@/lib/errors';
import { createTestDb } from '@/test/testDb';
import {
  createProduct,
  createProductCategory,
  deleteProduct,
  getProductById,
  getStock,
  listProductCategories,
  listProductsWithStock,
  restoreProduct,
  updateProduct,
  type ServiceCtx,
} from './products';

const ownerCtx: ServiceCtx = { shopId: 'shop1', userId: 'u1', role: 'owner' };
const managerCtx: ServiceCtx = { shopId: 'shop1', userId: 'u2', role: 'manager' };
const cashierCtx: ServiceCtx = { shopId: 'shop1', userId: 'u3', role: 'cashier' };
const otherShopCtx: ServiceCtx = { shopId: 'shop2', userId: 'u9', role: 'owner' };

describe('products service', () => {
  it('creates product with opening stock, computes stockValue and low-stock flag', () => {
    const db = createTestDb();
    const cat = createProductCategory(db, ownerCtx, 'Beverages');
    const created = createProduct(db, ownerCtx, {
      name: 'Mineral Water 1L',
      category_id: cat.id,
      unit: 'bottle',
      code: 'MW-01',
      buy_price: 1500, // 15.00
      sell_price: 2500, // 25.00
      wholesale_price: 2000,
      opening_stock: 10,
      low_stock_alert: 12,
      warranty_days: 30,
      image_uri: 'https://example.com/water.jpg',
      description: '1L purified water',
      online_visible: true,
      featured: true,
    });

    expect(created).toMatchObject({
      name: 'Mineral Water 1L',
      categoryName: 'Beverages',
      unit: 'bottle',
      code: 'MW-01',
      buy_price: 1500,
      sell_price: 2500,
      wholesale_price: 2000,
      stock: 10,
      stockValue: 15000,
      isLowStock: true,
      warranty_days: 30,
      online_visible: 1,
      featured: 1,
      dirty: 1,
    });
    expect(getStock(db, 'shop1', created.id)).toBe(10);
  });

  it('creates product with zero opening stock and no movement row', () => {
    const db = createTestDb();
    const p = createProduct(db, managerCtx, {
      name: 'Pen',
      buy_price: 0,
      sell_price: 1000,
      opening_stock: 0,
    });
    expect(p.stock).toBe(0);
    expect(p.stockValue).toBe(0);
    expect(p.isLowStock).toBe(false);
    expect(p.unit).toBe('pcs');
  });

  it('updates product fields and validates missing / invalid inputs', () => {
    const db = createTestDb();
    const p = createProduct(db, ownerCtx, {
      name: 'Tea',
      buy_price: 10000,
      sell_price: 15000,
      opening_stock: 2.5,
    });

    const updated = updateProduct(db, ownerCtx, p.id, {
      name: 'Green Tea',
      buy_price: 12000,
      low_stock_alert: 5,
      online_visible: 1,
    });
    expect(updated.name).toBe('Green Tea');
    expect(updated.buy_price).toBe(12000);
    expect(updated.stock).toBe(2.5);
    expect(updated.stockValue).toBe(30000);
    expect(updated.isLowStock).toBe(true);
    expect(updated.online_visible).toBe(1);

    expect(() => createProduct(db, ownerCtx, { name: '   ' })).toThrow(AppError);
    expect(() =>
      createProduct(db, ownerCtx, { name: 'Bad', buy_price: -10 }),
    ).toThrow(AppError);
    expect(() =>
      createProduct(db, ownerCtx, { name: 'Bad', sell_price: 12.5 }),
    ).toThrow(AppError);
    expect(() => updateProduct(db, ownerCtx, 'missing', { name: 'X' })).toThrow(AppError);
  });

  it('filters listProductsWithStock by search, category, lowStockOnly, onlineOnly, and shop isolation', () => {
    const db = createTestDb();
    const catA = createProductCategory(db, ownerCtx, 'Snacks');
    const catB = createProductCategory(db, ownerCtx, 'Electronics');

    createProduct(db, ownerCtx, {
      name: 'Potato Chips',
      category_id: catA.id,
      code: 'SNK-1',
      buy_price: 1000,
      sell_price: 1500,
      opening_stock: 2,
      low_stock_alert: 5,
      online_visible: true,
    });
    createProduct(db, ownerCtx, {
      name: 'USB Cable',
      category_id: catB.id,
      code: 'ELC-9',
      buy_price: 5000,
      sell_price: 10000,
      opening_stock: 20,
      low_stock_alert: 5,
      online_visible: false,
      featured: true,
    });
    createProduct(db, otherShopCtx, { name: 'Other Shop Item', opening_stock: 1 });

    expect(listProductsWithStock(db, 'shop1')).toHaveLength(2);
    expect(listProductsWithStock(db, 'shop1', { categoryId: catA.id })).toHaveLength(1);
    expect(listProductsWithStock(db, 'shop1', { search: 'elc-9' })).toHaveLength(1);
    expect(listProductsWithStock(db, 'shop1', { search: 'snacks' })).toHaveLength(1);
    expect(listProductsWithStock(db, 'shop1', { lowStockOnly: true })).toHaveLength(1);
    expect(listProductsWithStock(db, 'shop1', { onlineOnly: true })).toHaveLength(1);
    expect(listProductsWithStock(db, 'shop1', { featuredOnly: true })).toHaveLength(1);
    expect(listProductsWithStock(db, 'shop2')).toHaveLength(1);
  });

  it('soft-deletes and restores product together with opening stock', () => {
    const db = createTestDb();
    const p = createProduct(db, ownerCtx, {
      name: 'Soap',
      buy_price: 3000,
      sell_price: 4500,
      opening_stock: 8,
    });
    expect(getStock(db, 'shop1', p.id)).toBe(8);

    deleteProduct(db, ownerCtx, p.id);
    expect(getProductById(db, 'shop1', p.id)).toBeNull();
    expect(listProductsWithStock(db, 'shop1')).toHaveLength(0);
    expect(getStock(db, 'shop1', p.id)).toBe(0);

    restoreProduct(db, ownerCtx, p.id);
    expect(getProductById(db, 'shop1', p.id)?.stock).toBe(8);
    expect(getStock(db, 'shop1', p.id)).toBe(8);
  });

  it('enforces role permissions and category uniqueness', () => {
    const db = createTestDb();
    const p = createProduct(db, ownerCtx, { name: 'Rice', opening_stock: 5 });

    expect(() => createProduct(db, cashierCtx, { name: 'Blocked' })).toThrow(AppError);
    expect(() => updateProduct(db, cashierCtx, p.id, { name: 'Blocked' })).toThrow(AppError);
    expect(() => deleteProduct(db, cashierCtx, p.id)).toThrow(AppError);
    expect(() => restoreProduct(db, cashierCtx, p.id)).toThrow(AppError);
    expect(() => createProductCategory(db, cashierCtx, 'Food')).toThrow(AppError);

    createProductCategory(db, ownerCtx, 'Food');
    expect(() => createProductCategory(db, ownerCtx, 'food')).toThrow(AppError);
    expect(listProductCategories(db, 'shop1')).toHaveLength(1);
  });
});
