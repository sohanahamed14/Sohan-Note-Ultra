/** @jest-environment node */
import { newRow } from '@/db/helpers';
import { parties, products, shops } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { addDays } from '@/lib/date';
import { postStock } from '@/services/posting';
import { createSale, deleteSale, type SaleContext } from '@/services/sales';
import { createTestDb } from '@/test/testDb';
import { classifyWarranty, getWarrantySummary, listWarrantyItems } from './warranty';

const SHOP = 'shop_war';
const CTX: SaleContext = { shopId: SHOP, userId: 'u1', role: 'owner' };
const NOW = new Date(2026, 10, 20, 12, 0, 0).getTime();

function seedWarrantyData(db: AppDb) {
  db.insert(shops)
    .values({
      id: SHOP,
      shop_id: SHOP,
      created_at: NOW,
      updated_at: NOW,
      deleted_at: null,
      created_by: 'u1',
      dirty: 1,
      name: 'Tech World',
      owner_id: 'u1',
    })
    .run();

  const makeProd = (name: string, warrantyDays: number) => {
    const row = newRow(SHOP, 'u1', NOW);
    db.insert(products)
      .values({ ...row, name, sell_price: 50000, warranty_days: warrantyDays })
      .run();
    postStock(db, {
      shopId: SHOP,
      userId: 'u1',
      refId: null,
      date: NOW,
      productId: row.id,
      qty: 10,
      type: 'opening',
    });
    return row.id;
  };

  const makeCust = (name: string, phone: string) => {
    const row = newRow(SHOP, 'u1', NOW);
    db.insert(parties).values({ ...row, type: 'customer', name, phone }).run();
    return row.id;
  };

  const pLong = makeProd('Laptop Charger', 365);
  const pSoon = makeProd('Mouse', 15);
  const pNone = makeProd('USB Cable', 0);

  const c1 = makeCust('Farhan Islam', '01755667788');
  const c2 = makeCust('Mitu Begum', '01911223344');

  // Active (>30d left)
  const sActive = createSale(db, CTX, {
    partyId: c1,
    date: NOW,
    items: [
      { productId: pLong, name: 'Laptop Charger', qty: 1, unitPrice: 50000 },
      { productId: pNone, name: 'USB Cable', qty: 1, unitPrice: 10000 },
    ],
    paid: 60000,
  });

  // Expiring soon (15d left)
  createSale(db, CTX, {
    partyId: c2,
    date: NOW,
    items: [{ productId: pSoon, name: 'Mouse', qty: 2, unitPrice: 20000 }],
    paid: 40000,
  });

  // Expired (sold 40 days ago with 15-day warranty)
  createSale(db, CTX, {
    partyId: c1,
    date: addDays(NOW, -40),
    items: [{ productId: pSoon, name: 'Old Mouse', qty: 1, unitPrice: 20000 }],
    paid: 20000,
  });

  // Soft-deleted sale (must not appear)
  const sDel = createSale(db, CTX, {
    partyId: c2,
    date: NOW,
    items: [{ productId: pLong, name: 'Deleted Charger', qty: 1, unitPrice: 50000 }],
    paid: 50000,
  });
  deleteSale(db, CTX, sDel.sale.id);

  return { sActiveId: sActive.sale.id };
}

describe('warranty service', () => {
  it('classifies active, expiring, and expired warranty dates', () => {
    expect(classifyWarranty(addDays(NOW, 60), NOW)).toEqual({
      status: 'active',
      daysRemaining: 60,
    });
    expect(classifyWarranty(addDays(NOW, 10), NOW)).toEqual({
      status: 'expiring',
      daysRemaining: 10,
    });
    expect(classifyWarranty(addDays(NOW, 0), NOW)).toEqual({
      status: 'expiring',
      daysRemaining: 0,
    });
    expect(classifyWarranty(addDays(NOW, -5), NOW)).toEqual({
      status: 'expired',
      daysRemaining: -5,
    });
  });

  it('lists warranty items with filters, search by customer/phone/product/invoice, and summary', () => {
    const db = createTestDb();
    seedWarrantyData(db);

    const all = listWarrantyItems(db, SHOP, { nowMs: NOW });
    expect(all.summary).toEqual({ total: 3, active: 2, expiring: 1, expired: 1 });
    expect(all.items).toHaveLength(3);
    // Active soonest first, then active later, then expired
    expect(all.items.map((i) => i.productName)).toEqual(['Mouse', 'Laptop Charger', 'Old Mouse']);

    const activeOnly = listWarrantyItems(db, SHOP, { status: 'active', nowMs: NOW });
    expect(activeOnly.items).toHaveLength(2);

    const expiredOnly = listWarrantyItems(db, SHOP, { status: 'expired', nowMs: NOW });
    expect(expiredOnly.items).toHaveLength(1);
    expect(expiredOnly.items[0].productName).toBe('Old Mouse');

    const byPhone = listWarrantyItems(db, SHOP, { search: '0191122', nowMs: NOW });
    expect(byPhone.items).toHaveLength(1);
    expect(byPhone.items[0].customerName).toBe('Mitu Begum');

    const byCustomer = listWarrantyItems(db, SHOP, { search: 'farhan', nowMs: NOW });
    expect(byCustomer.items).toHaveLength(2);

    expect(getWarrantySummary(db, SHOP, NOW)).toEqual({
      total: 3,
      active: 2,
      expiring: 1,
      expired: 1,
    });
    expect(listWarrantyItems(db, 'other_shop', { nowMs: NOW }).items).toHaveLength(0);
  });
});
