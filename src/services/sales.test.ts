/** @jest-environment node */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { newRow } from '@/db/helpers';
import {
  cash_entries,
  categories,
  parties,
  party_ledger,
  products,
  sale_items,
  shops,
} from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { postStock } from '@/services/posting';
import { createTestDb } from '@/test/testDb';
import {
  calculateSaleTotals,
  collectSaleDue,
  createQuickSale,
  createSale,
  deleteSale,
  getProductStock,
  getSaleById,
  listCustomerOptions,
  listSales,
  listSellableProducts,
  quickCreateCustomer,
  restoreSale,
  type SaleContext,
} from './sales';

const SHOP = 'shop_c1';
const OTHER_SHOP = 'shop_other';
const OWNER: SaleContext = { shopId: SHOP, userId: 'u_owner', role: 'owner' };
const MANAGER: SaleContext = { shopId: SHOP, userId: 'u_mgr', role: 'manager' };
const CASHIER: SaleContext = { shopId: SHOP, userId: 'u_cash', role: 'cashier' };
const DAY = new Date(2026, 10, 20, 14, 30, 0).getTime();

function seedShop(db: AppDb, shopId = SHOP) {
  const ts = DAY;
  db.insert(shops)
    .values({
      id: shopId,
      shop_id: shopId,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
      created_by: 'u_owner',
      dirty: 1,
      name: 'Sohan Electronics',
      phone: '01711000000',
      address: 'Dhaka',
      owner_id: 'u_owner',
      vat_percent: 5,
      decimal_enabled: 0,
    })
    .run();
}

function seedProduct(
  db: AppDb,
  opts: {
    name?: string;
    buyPrice?: number;
    sellPrice?: number;
    stock?: number;
    warrantyDays?: number;
    categoryId?: string | null;
    shopId?: string;
    code?: string | null;
  } = {},
): string {
  const shopId = opts.shopId ?? SHOP;
  const row = newRow(shopId, 'u_owner', DAY);
  db.insert(products)
    .values({
      ...row,
      name: opts.name ?? 'LED Bulb',
      category_id: opts.categoryId ?? null,
      unit: 'pcs',
      code: opts.code ?? null,
      buy_price: opts.buyPrice ?? 12000,
      sell_price: opts.sellPrice ?? 20000,
      wholesale_price: 18000,
      low_stock_alert: 3,
      warranty_days: opts.warrantyDays ?? 0,
    })
    .run();
  if (opts.stock && opts.stock > 0) {
    postStock(db, {
      shopId,
      userId: 'u_owner',
      refId: null,
      date: DAY,
      productId: row.id,
      qty: opts.stock,
      type: 'opening',
    });
  }
  return row.id;
}

function seedCustomer(
  db: AppDb,
  name = 'Rahim Uddin',
  phone = '01712345678',
  shopId = SHOP,
): string {
  const row = newRow(shopId, 'u_owner', DAY);
  db.insert(parties)
    .values({
      ...row,
      type: 'customer',
      name,
      phone,
      address: 'Mirpur, Dhaka',
    })
    .run();
  return row.id;
}

const cashTotal = (db: AppDb, shopId = SHOP) =>
  Number(
    db
      .select({ s: sql<number>`COALESCE(SUM(${cash_entries.amount}), 0)` })
      .from(cash_entries)
      .where(and(eq(cash_entries.shop_id, shopId), isNull(cash_entries.deleted_at)))
      .get()?.s ?? 0,
  );

const partyBalance = (db: AppDb, partyId: string) =>
  Number(
    db
      .select({ s: sql<number>`COALESCE(SUM(${party_ledger.amount}), 0)` })
      .from(party_ledger)
      .where(and(eq(party_ledger.party_id, partyId), isNull(party_ledger.deleted_at)))
      .get()?.s ?? 0,
  );

describe('calculateSaleTotals', () => {
  it('computes subtotal, amount discount, VAT, and total in integer paisa', () => {
    const t = calculateSaleTotals({
      items: [
        { qty: 2, unitPrice: 15000 },
        { qty: 1.5, unitPrice: 10000 },
      ],
      discountType: 'amount',
      discountValue: 5000,
      vatPercent: 5,
    });
    expect(t).toEqual({
      subtotal: 45000,
      discount: 5000,
      vat: 2000,
      total: 42000,
      lineTotals: [30000, 15000],
    });
  });

  it('computes percentage discount and zero total when 100% discount', () => {
    const t = calculateSaleTotals({
      items: [{ qty: 3, unitPrice: 10000 }],
      discountType: 'percent',
      discountValue: 100,
      vatPercent: 15,
    });
    expect(t).toEqual({
      subtotal: 30000,
      discount: 30000,
      vat: 0,
      total: 0,
      lineTotals: [30000],
    });
  });

  it('rejects discount exceeding subtotal or out-of-range percent', () => {
    expect(() =>
      calculateSaleTotals({
        items: [{ qty: 1, unitPrice: 10000 }],
        discountType: 'amount',
        discountValue: 10001,
      }),
    ).toThrow(AppError);

    expect(() =>
      calculateSaleTotals({
        items: [{ qty: 1, unitPrice: 10000 }],
        discountType: 'percent',
        discountValue: 110,
      }),
    ).toThrow(AppError);
  });
});

describe('sales service', () => {
  it('creates a full-paid POS sale, snapshots buy_price, computes warranty, deducts stock, posts cash', () => {
    const db = createTestDb();
    seedShop(db);
    const p1 = seedProduct(db, {
      name: 'Router',
      buyPrice: 150000,
      sellPrice: 200000,
      stock: 10,
      warrantyDays: 365,
    });

    const detail = createSale(db, CASHIER, {
      date: DAY,
      items: [{ productId: p1, name: 'Router', qty: 2, unitPrice: 200000 }],
      discountType: 'percent',
      discountValue: 10,
      vatPercent: 5,
      paid: 378000,
      method: 'bkash',
    });

    expect(detail.sale.invoice_no).toBe('INV-20261120-0001');
    expect(detail.sale.subtotal).toBe(400000);
    expect(detail.sale.discount).toBe(40000);
    expect(detail.sale.vat).toBe(18000);
    expect(detail.sale.total).toBe(378000);
    expect(detail.sale.paid).toBe(378000);
    expect(detail.sale.due).toBe(0);
    expect(detail.sale.method).toBe('bkash');
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].buy_price).toBe(150000);
    expect(detail.items[0].warranty_until).toBeGreaterThan(DAY);
    expect(getProductStock(db, SHOP, p1)).toBe(8);
    expect(cashTotal(db)).toBe(378000);

    // Changing product buy_price later does NOT mutate historical snapshot
    db.update(products).set({ buy_price: 999999 }).where(eq(products.id, p1)).run();
    const reloaded = getSaleById(db, SHOP, detail.sale.id);
    expect(reloaded?.items[0].buy_price).toBe(150000);
  });

  it('creates partial-due and full-due sales posting party_ledger +due and cash +paid', () => {
    const db = createTestDb();
    seedShop(db);
    const p1 = seedProduct(db, { stock: 10, sellPrice: 50000 });
    const c1 = seedCustomer(db);

    const partial = createSale(db, OWNER, {
      partyId: c1,
      date: DAY,
      items: [{ productId: p1, name: 'LED Bulb', qty: 2, unitPrice: 50000 }],
      paid: 40000,
      method: 'cash',
    });
    expect(partial.sale.total).toBe(100000);
    expect(partial.sale.paid).toBe(40000);
    expect(partial.sale.due).toBe(60000);
    expect(cashTotal(db)).toBe(40000);
    expect(partyBalance(db, c1)).toBe(60000);

    // Full due (paid = 0) creates no cash entry
    const fullDue = createSale(db, OWNER, {
      partyId: c1,
      date: DAY,
      items: [{ productId: p1, name: 'LED Bulb', qty: 1, unitPrice: 50000 }],
      paid: 0,
      method: 'cash',
    });
    expect(fullDue.sale.due).toBe(50000);
    expect(cashTotal(db)).toBe(40000);
    expect(partyBalance(db, c1)).toBe(110000);
    expect(getProductStock(db, SHOP, p1)).toBe(7);
  });

  it('supports zero-total sale (100% discount) without cash or ledger postings', () => {
    const db = createTestDb();
    seedShop(db);
    const p1 = seedProduct(db, { stock: 5, sellPrice: 10000 });

    const res = createSale(db, OWNER, {
      date: DAY,
      items: [{ productId: p1, name: 'Sample', qty: 1, unitPrice: 10000 }],
      discountType: 'percent',
      discountValue: 100,
      paid: 0,
    });
    expect(res.sale.total).toBe(0);
    expect(res.sale.due).toBe(0);
    expect(getProductStock(db, SHOP, p1)).toBe(4);
    expect(cashTotal(db)).toBe(0);
  });

  it('rejects overpay, due without customer, and insufficient stock (atomic rollback)', () => {
    const db = createTestDb();
    seedShop(db);
    const p1 = seedProduct(db, { name: 'Cable', stock: 2, sellPrice: 10000 });
    const c1 = seedCustomer(db);

    // Overpay rejected
    try {
      createSale(db, OWNER, {
        date: DAY,
        items: [{ productId: p1, name: 'Cable', qty: 1, unitPrice: 10000 }],
        paid: 15000,
      });
      throw new Error('Expected OVERPAY');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('OVERPAY');
    }

    // Due without customer rejected
    try {
      createSale(db, OWNER, {
        date: DAY,
        items: [{ productId: p1, name: 'Cable', qty: 1, unitPrice: 10000 }],
        paid: 5000,
      });
      throw new Error('Expected VALIDATION');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('VALIDATION');
    }

    // Insufficient stock rejected (including combined duplicate lines)
    try {
      createSale(db, OWNER, {
        partyId: c1,
        date: DAY,
        items: [
          { productId: p1, name: 'Cable', qty: 1.5, unitPrice: 10000 },
          { productId: p1, name: 'Cable', qty: 1, unitPrice: 10000 },
        ],
        paid: 25000,
      });
      throw new Error('Expected INSUFFICIENT_STOCK');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('INSUFFICIENT_STOCK');
    }

    // Stock and sales untouched after failed attempts
    expect(getProductStock(db, SHOP, p1)).toBe(2);
    expect(listSales(db, SHOP).rows).toHaveLength(0);

    // allowNegativeStock permits selling beyond stock
    const allowed = createSale(db, OWNER, {
      date: DAY,
      items: [{ productId: p1, name: 'Cable', qty: 3, unitPrice: 10000 }],
      paid: 30000,
      allowNegativeStock: true,
    });
    expect(allowed.sale.total).toBe(30000);
    expect(getProductStock(db, SHOP, p1)).toBe(-1);
  });

  it('creates quick sales and rejects zero amount or overpay', () => {
    const db = createTestDb();
    seedShop(db);
    const c1 = seedCustomer(db);

    const qs = createQuickSale(db, CASHIER, {
      amount: 25000,
      method: 'nagad',
      note: 'Repair charge',
      date: DAY,
    });
    expect(qs.sale.kind).toBe('quick');
    expect(qs.sale.total).toBe(25000);
    expect(qs.sale.paid).toBe(25000);
    expect(qs.sale.due).toBe(0);
    expect(qs.items[0].name).toBe('Repair charge');
    expect(cashTotal(db)).toBe(25000);

    const partialQs = createQuickSale(db, OWNER, {
      amount: 30000,
      paid: 10000,
      partyId: c1,
      date: DAY,
    });
    expect(partialQs.sale.due).toBe(20000);
    expect(partyBalance(db, c1)).toBe(20000);

    expect(() => createQuickSale(db, OWNER, { amount: 0 })).toThrow(AppError);
    expect(() => createQuickSale(db, OWNER, { amount: 10000, paid: 12000 })).toThrow(AppError);
  });

  it('collects due on a sale, rejects overpay/zero/paid, and reverses cleanly on delete + restore', () => {
    const db = createTestDb();
    seedShop(db);
    const p1 = seedProduct(db, { stock: 10, sellPrice: 50000 });
    const c1 = seedCustomer(db);

    const created = createSale(db, OWNER, {
      partyId: c1,
      date: DAY,
      items: [{ productId: p1, name: 'Item', qty: 2, unitPrice: 50000 }],
      paid: 30000,
      method: 'cash',
    });

    // Partial due collection (by cashier)
    const after1 = collectSaleDue(db, CASHIER, {
      saleId: created.sale.id,
      amount: 40000,
      method: 'bkash',
      date: DAY + 1000,
    });
    expect(after1.sale.paid).toBe(70000);
    expect(after1.sale.due).toBe(30000);
    expect(cashTotal(db)).toBe(70000);
    expect(partyBalance(db, c1)).toBe(30000);

    // Overpay rejected
    try {
      collectSaleDue(db, OWNER, { saleId: created.sale.id, amount: 30001 });
      throw new Error('Expected OVERPAY');
    } catch (e) {
      expect((e as AppError).code).toBe('OVERPAY');
    }

    // Zero rejected
    expect(() => collectSaleDue(db, OWNER, { saleId: created.sale.id, amount: 0 })).toThrow(
      AppError,
    );

    // Cashier cannot delete or restore
    try {
      deleteSale(db, CASHIER, created.sale.id);
      throw new Error('Expected FORBIDDEN');
    } catch (e) {
      expect((e as AppError).code).toBe('FORBIDDEN');
    }

    // Delete reverses sale AND its linked due-collection postings
    deleteSale(db, MANAGER, created.sale.id);
    expect(getSaleById(db, SHOP, created.sale.id)).toBeNull();
    expect(getProductStock(db, SHOP, p1)).toBe(10);
    expect(cashTotal(db)).toBe(0);
    expect(partyBalance(db, c1)).toBe(0);
    expect(
      db
        .select()
        .from(sale_items)
        .where(and(eq(sale_items.sale_id, created.sale.id), isNull(sale_items.deleted_at)))
        .all(),
    ).toHaveLength(0);

    // Restore re-applies sale AND due collection
    expect(() => restoreSale(db, CASHIER, created.sale.id)).toThrow(AppError);
    restoreSale(db, OWNER, created.sale.id);
    expect(getProductStock(db, SHOP, p1)).toBe(8);
    expect(cashTotal(db)).toBe(70000);
    expect(partyBalance(db, c1)).toBe(30000);

    // Finish collecting remaining due
    const paidOff = collectSaleDue(db, OWNER, { saleId: created.sale.id, amount: 30000 });
    expect(paidOff.sale.due).toBe(0);
    expect(partyBalance(db, c1)).toBe(0);
    expect(cashTotal(db)).toBe(100000);

    // Collecting on already-paid sale throws CONFLICT
    try {
      collectSaleDue(db, OWNER, { saleId: created.sale.id, amount: 100 });
      throw new Error('Expected CONFLICT');
    } catch (e) {
      expect((e as AppError).code).toBe('CONFLICT');
    }
  });

  it('lists sales with filters, totals, and shop isolation; lists sellable products & customers', () => {
    const db = createTestDb();
    seedShop(db, SHOP);
    seedShop(db, OTHER_SHOP);

    const catRow = newRow(SHOP, 'u_owner', DAY);
    db.insert(categories).values({ ...catRow, name: 'Lighting', kind: 'product' }).run();

    const p1 = seedProduct(db, {
      name: 'LED Panel',
      code: 'LP-01',
      stock: 10,
      sellPrice: 10000,
      categoryId: catRow.id,
    });
    const pOther = seedProduct(db, { name: 'Other Prod', stock: 5, shopId: OTHER_SHOP });
    const c1 = seedCustomer(db, 'Karim Store', '01811223344');

    const s1 = createSale(db, OWNER, {
      date: DAY - 86_400_000,
      items: [{ productId: p1, name: 'LED Panel', qty: 1, unitPrice: 10000 }],
      paid: 10000,
      method: 'cash',
    });
    createSale(db, OWNER, {
      partyId: c1,
      date: DAY,
      items: [{ productId: p1, name: 'LED Panel', qty: 2, unitPrice: 10000 }],
      paid: 5000,
      method: 'bkash',
    });
    createSale(
      db,
      { shopId: OTHER_SHOP, userId: 'u_owner', role: 'owner' },
      {
        date: DAY,
        items: [{ productId: pOther, name: 'Other Prod', qty: 1, unitPrice: 90000 }],
        paid: 90000,
      },
    );

    const all = listSales(db, SHOP);
    expect(all.totals).toEqual({ count: 2, total: 30000, paid: 15000, due: 15000 });

    const partialOnly = listSales(db, SHOP, { status: 'partial' });
    expect(partialOnly.rows).toHaveLength(1);
    expect(partialOnly.rows[0].partyName).toBe('Karim Store');

    const bySearch = listSales(db, SHOP, { search: '01811' });
    expect(bySearch.rows).toHaveLength(1);

    const byDate = listSales(db, SHOP, { fromDate: DAY - 1000, toDate: DAY + 1000 });
    expect(byDate.rows).toHaveLength(1);

    const byInvoice = listSales(db, SHOP, { search: s1.sale.invoice_no });
    expect(byInvoice.rows).toHaveLength(1);

    const sellable = listSellableProducts(db, SHOP, { categoryId: catRow.id, search: 'lp-01' });
    expect(sellable).toHaveLength(1);
    expect(sellable[0].stock).toBe(7);
    expect(sellable[0].categoryName).toBe('Lighting');

    const added = quickCreateCustomer(db, CASHIER, { name: 'Nadia Akter', phone: '01900001111' });
    expect(added.type).toBe('customer');
    expect(listCustomerOptions(db, SHOP, 'nadia')).toHaveLength(1);
  });
});
