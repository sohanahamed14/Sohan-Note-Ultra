/** @jest-environment node */
import type { Product } from '@/db/schema';
import { getCartSummary, useCartStore } from './cartStore';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    shop_id: 's1',
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    created_by: 'u1',
    dirty: 1,
    name: 'LED Bulb',
    category_id: null,
    unit: 'pcs',
    code: null,
    buy_price: 10000,
    sell_price: 15000,
    wholesale_price: 14000,
    low_stock_alert: 2,
    warranty_days: 90,
    image_uri: null,
    description: null,
    online_visible: 0,
    featured: 0,
    ...overrides,
  };
}

describe('cartStore', () => {
  beforeEach(() => {
    useCartStore.getState().clear();
    useCartStore.getState().syncShop('s1');
  });

  it('enforces stock guard on addProduct and setQty', () => {
    const prod = makeProduct();
    expect(useCartStore.getState().addProduct(prod, 0).ok).toBe(false);
    expect(useCartStore.getState().addProduct(prod, 2).ok).toBe(true);
    expect(useCartStore.getState().addProduct(prod, 2).ok).toBe(true);
    expect(useCartStore.getState().addProduct(prod, 2).ok).toBe(false);
    expect(useCartStore.getState().setQty('p1', 3).ok).toBe(false);
    expect(useCartStore.getState().setQty('p1', 1.5).ok).toBe(true);

    expect(getCartSummary(useCartStore.getState().items)).toEqual({
      lineCount: 1,
      totalQty: 1.5,
      subtotal: 22500,
    });

    // Updating unit price updates subtotal
    useCartStore.getState().setUnitPrice('p1', 20000);
    expect(getCartSummary(useCartStore.getState().items).subtotal).toBe(30000);

    // Setting qty to 0 removes item
    useCartStore.getState().setQty('p1', 0);
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('clears cart when switching shop', () => {
    useCartStore.getState().addProduct(makeProduct(), 5);
    expect(useCartStore.getState().items).toHaveLength(1);
    useCartStore.getState().syncShop('s2');
    expect(useCartStore.getState().items).toHaveLength(0);
  });
});
