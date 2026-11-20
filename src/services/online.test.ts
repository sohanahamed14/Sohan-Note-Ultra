/** @jest-environment node */
import { and, eq, isNull, sum } from 'drizzle-orm';
import { newRow } from '@/db/helpers';
import {
  cash_entries,
  online_orders,
  parties,
  party_ledger,
  products,
  sale_items,
  sales,
  shops,
  stock_movements,
} from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { restoreWithRefs, softDeleteWithRefs } from '@/services/posting';
import { createTestDb } from '@/test/testDb';
import {
  buildOrderWhatsAppUrl,
  buildStorefrontUrl,
  convertOrderToSale,
  deleteOnlineOrder,
  fetchPublicShop,
  getOnlineOrder,
  getOnlineStats,
  listOnlineOrders,
  listOnlineProducts,
  normalizeBdPhone,
  normalizeSlug,
  parseOrderItems,
  placePublicOrder,
  recordPublicShopVisit,
  setProductFeatured,
  setProductOnlineVisibility,
  updateDeliveryCharges,
  updateOnlineOrderStatus,
  updateOnlineTheme,
  updateShopPolicy,
  updateStoreSettings,
  type PublicRpcClient,
} from './online';

const SHOP = 'shop-on-1';

function seedBase(db: AppDb) {
  db.insert(shops)
    .values({
      ...newRow(SHOP, 'u1', 1000),
      id: SHOP,
      shop_id: SHOP,
      name: 'Electro Mart',
      slug: 'electro-mart',
      phone: '01712345678',
      owner_id: 'u1',
      online_enabled: 1,
      delivery_inside: 6000,
      delivery_outside: 12000,
      online_visits: 42,
    })
    .run();

  db.insert(products)
    .values({
      ...newRow(SHOP, 'u1', 1000),
      id: 'p1',
      name: 'USB Cable',
      buy_price: 10000,
      sell_price: 20000,
      warranty_days: 90,
      online_visible: 1,
      featured: 1,
    })
    .run();
  db.insert(products)
    .values({
      ...newRow(SHOP, 'u1', 1000),
      id: 'p2',
      name: 'Power Bank',
      buy_price: 100000,
      sell_price: 150000,
      online_visible: 0,
      featured: 0,
    })
    .run();
  db.insert(stock_movements)
    .values({
      ...newRow(SHOP, 'u1', 1000),
      product_id: 'p1',
      qty: 10,
      type: 'opening',
      date: 1000,
    })
    .run();
}

function seedOrder(
  db: AppDb,
  overrides: Partial<typeof online_orders.$inferInsert> = {},
): string {
  const row = newRow(SHOP, null, 2000);
  db.insert(online_orders)
    .values({
      ...row,
      order_no: 'ON-000001',
      customer_name: 'Hasan',
      phone: '01812345678',
      address: 'House 12, Uttara',
      items_json: JSON.stringify([
        { product_id: 'p1', name: 'USB Cable', qty: 2, unit_price: 20000, total: 40000 },
      ]),
      subtotal: 40000,
      delivery_charge: 6000,
      total: 46000,
      status: 'pending',
      area: 'inside',
      note: 'Leave at gate',
      ...overrides,
    })
    .run();
  return overrides.id ?? row.id;
}

describe('online shop local services', () => {
  it('computes stats, updates store settings, delivery charges, policy, themes & enforces permissions', () => {
    const db = createTestDb();
    seedBase(db);
    seedOrder(db, { id: 'o1', status: 'pending', total: 46000 });
    seedOrder(db, { id: 'o2', order_no: 'ON-000002', status: 'delivered', total: 30000 });

    const stats = getOnlineStats(db, SHOP);
    expect(stats).toEqual({
      activeOrders: 1,
      pendingOrders: 1,
      onlineProducts: 1,
      featuredProducts: 1,
      earned: 30000,
      visits: 42,
      onlineEnabled: true,
      slug: 'electro-mart',
    });

    // Store settings: normalize slug, reject cashier, reject enabling without slug
    expect(() =>
      updateStoreSettings(db, { shopId: SHOP, role: 'cashier', name: 'Hack' }),
    ).toThrow(AppError);
    expect(() =>
      updateStoreSettings(db, { shopId: SHOP, role: 'owner', slug: null, online_enabled: true }),
    ).toThrow(AppError);
    expect(() =>
      updateStoreSettings(db, { shopId: SHOP, role: 'owner', slug: 'a' }),
    ).toThrow(AppError);

    const updated = updateStoreSettings(db, {
      shopId: SHOP,
      role: 'manager',
      slug: '  My Electro Shop! ',
      online_enabled: true,
    });
    expect(updated.slug).toBe('my-electro-shop');
    expect(updated.dirty).toBe(1);

    // Delivery charges
    expect(() =>
      updateDeliveryCharges(db, {
        shopId: SHOP,
        role: 'owner',
        delivery_inside: -1,
        delivery_outside: 0,
      }),
    ).toThrow(AppError);
    const del = updateDeliveryCharges(db, {
      shopId: SHOP,
      role: 'owner',
      delivery_inside: 0,
      delivery_outside: 15000,
    });
    expect(del.delivery_inside).toBe(0);
    expect(del.delivery_outside).toBe(15000);

    // Policy & theme
    const pol = updateShopPolicy(db, {
      shopId: SHOP,
      role: 'owner',
      shop_policy: '  7 days easy return  ',
    });
    expect(pol.shop_policy).toBe('7 days easy return');

    const th = updateOnlineTheme(db, {
      shopId: SHOP,
      role: 'owner',
      online_theme: 'emerald',
    });
    expect(th.online_theme).toBe('emerald');
  });

  it('toggles product online visibility and featured consistently', () => {
    const db = createTestDb();
    seedBase(db);

    expect(listOnlineProducts(db, SHOP, { filter: 'online' })).toHaveLength(1);
    expect(listOnlineProducts(db, SHOP, { filter: 'hidden' })).toHaveLength(1);

    // Featuring a hidden product auto-enables online_visible
    const feat = setProductFeatured(db, {
      shopId: SHOP,
      role: 'owner',
      productId: 'p2',
      featured: true,
    });
    expect(feat.featured).toBe(1);
    expect(feat.online_visible).toBe(1);

    // Hiding a featured product clears featured
    const hidden = setProductOnlineVisibility(db, {
      shopId: SHOP,
      role: 'owner',
      productId: 'p1',
      online_visible: false,
    });
    expect(hidden.online_visible).toBe(0);
    expect(hidden.featured).toBe(0);

    expect(() =>
      setProductOnlineVisibility(db, {
        shopId: SHOP,
        role: 'cashier',
        productId: 'p1',
        online_visible: true,
      }),
    ).toThrow(AppError);
  });

  it('manages order status transitions and delete rules', () => {
    const db = createTestDb();
    seedBase(db);
    const id = seedOrder(db);

    expect(listOnlineOrders(db, SHOP, { status: 'pending', search: 'hasan' })).toHaveLength(1);
    expect(getOnlineOrder(db, SHOP, id).order_no).toBe('ON-000001');

    // Cannot jump straight from pending -> delivered
    expect(() =>
      updateOnlineOrderStatus(db, { shopId: SHOP, role: 'owner', orderId: id, status: 'delivered' }),
    ).toThrow(AppError);

    const conf = updateOnlineOrderStatus(db, {
      shopId: SHOP,
      role: 'owner',
      orderId: id,
      status: 'confirmed',
    });
    expect(conf.status).toBe('confirmed');

    const deliv = updateOnlineOrderStatus(db, {
      shopId: SHOP,
      role: 'owner',
      orderId: id,
      status: 'delivered',
    });
    expect(deliv.status).toBe('delivered');

    // Delivered is terminal
    expect(() =>
      updateOnlineOrderStatus(db, { shopId: SHOP, role: 'owner', orderId: id, status: 'cancelled' }),
    ).toThrow(AppError);

    // Cashier cannot delete; owner can
    expect(() => deleteOnlineOrder(db, { shopId: SHOP, role: 'cashier', orderId: id })).toThrow(
      AppError,
    );
    deleteOnlineOrder(db, { shopId: SHOP, role: 'owner', orderId: id });
    expect(listOnlineOrders(db, SHOP)).toHaveLength(0);
  });

  it('converts order to sale atomically (partial pay, overpay rejected, delete/restore reverses postings)', () => {
    const db = createTestDb();
    seedBase(db);
    const id = seedOrder(db); // total 46000 (2x20000 + 6000 delivery)

    // Overpay rejected
    expect(() =>
      convertOrderToSale(db, {
        shopId: SHOP,
        userId: 'u1',
        role: 'owner',
        orderId: id,
        paid: 50000,
        method: 'cash',
      }),
    ).toThrow(AppError);

    // Partial payment: paid 20000, due 26000
    const { order, saleId, invoiceNo } = convertOrderToSale(db, {
      shopId: SHOP,
      userId: 'u1',
      role: 'owner',
      orderId: id,
      paid: 20000,
      method: 'bkash',
      date: 5000,
    });
    expect(invoiceNo).toMatch(/^INV-/);
    expect(order.sale_id).toBe(saleId);
    expect(order.status).toBe('confirmed');

    // Double conversion rejected
    expect(() =>
      convertOrderToSale(db, {
        shopId: SHOP,
        userId: 'u1',
        role: 'owner',
        orderId: id,
      }),
    ).toThrow(AppError);

    // Verify sale, sale_items (product + delivery), stock, cash, party ledger
    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get();
    expect(sale).toMatchObject({ kind: 'online', total: 46000, paid: 20000, due: 26000, method: 'bkash' });
    const items = db.select().from(sale_items).where(eq(sale_items.sale_id, saleId)).all();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ product_id: 'p1', buy_price: 10000, qty: 2, total: 40000 });
    expect(items[0].warranty_until).not.toBeNull();
    expect(items[1]).toMatchObject({ product_id: null, name: 'Delivery charge', total: 6000 });

    const stockQty = () =>
      Number(
        db
          .select({ s: sum(stock_movements.qty) })
          .from(stock_movements)
          .where(and(eq(stock_movements.product_id, 'p1'), isNull(stock_movements.deleted_at)))
          .get()?.s ?? 0,
      );
    const cashTotal = () =>
      Number(
        db
          .select({ s: sum(cash_entries.amount) })
          .from(cash_entries)
          .where(isNull(cash_entries.deleted_at))
          .get()?.s ?? 0,
      );
    const dueTotal = () =>
      Number(
        db
          .select({ s: sum(party_ledger.amount) })
          .from(party_ledger)
          .where(isNull(party_ledger.deleted_at))
          .get()?.s ?? 0,
      );

    expect([stockQty(), cashTotal(), dueTotal()]).toEqual([8, 20000, 26000]);
    expect(db.select().from(parties).all()).toHaveLength(1);

    // Deleting order while linked sale is active is rejected
    expect(() => deleteOnlineOrder(db, { shopId: SHOP, role: 'owner', orderId: id })).toThrow(
      AppError,
    );

    // Deleting the sale reverses stock, cash, ledger; restoring re-applies!
    const target = {
      shopId: SHOP,
      table: sales,
      id: saleId,
      items: { table: sale_items, fk: 'sale_id' },
    };
    db.transaction((tx) => softDeleteWithRefs(tx, target));
    expect([stockQty(), cashTotal(), dueTotal()]).toEqual([10, 0, 0]);

    db.transaction((tx) => restoreWithRefs(tx, target));
    expect([stockQty(), cashTotal(), dueTotal()]).toEqual([8, 20000, 26000]);
  });

  it('zero-paid conversion posts due without cash entry', () => {
    const db = createTestDb();
    seedBase(db);
    const id = seedOrder(db, { delivery_charge: 0, total: 40000 });
    const { saleId } = convertOrderToSale(db, {
      shopId: SHOP,
      userId: 'u1',
      role: 'owner',
      orderId: id,
      paid: 0,
    });
    expect(db.select().from(cash_entries).where(eq(cash_entries.ref_id, saleId)).all()).toHaveLength(0);
    expect(db.select().from(party_ledger).where(eq(party_ledger.ref_id, saleId)).get()?.amount).toBe(
      40000,
    );
  });
});

describe('public storefront RPCs & helpers', () => {
  it('normalizes slugs, phones, URLs, WhatsApp order text and parses items safely', () => {
    expect(normalizeSlug('  Sohan Note!  ')).toBe('sohan-note');
    expect(normalizeBdPhone('+88 01712-345678')).toBe('01712345678');
    expect(buildStorefrontUrl('my-shop', 'https://shop.test/')).toBe('https://shop.test/s/my-shop');
    expect(parseOrderItems('not-json')).toEqual([]);

    const wa = buildOrderWhatsAppUrl({
      shopPhone: '01712345678',
      shopName: 'Electro Mart',
      orderNo: 'ON-000001',
      customerName: 'Hasan',
      phone: '01812345678',
      address: 'Uttara, Dhaka',
      area: 'inside',
      items: [{ product_id: 'p1', name: 'Cable', qty: 2, unit_price: 20000, total: 40000 }],
      subtotal: 40000,
      deliveryCharge: 6000,
      total: 46000,
      note: 'Fast please',
    });
    expect(wa).toContain('https://wa.me/8801712345678?text=');
    expect(decodeURIComponent(wa)).toContain('ON-000001');
  });

  it('fetches public shop, records visit silently, validates and submits public orders', async () => {
    const calls: { fn: string; args?: Record<string, unknown> }[] = [];
    const mockClient: PublicRpcClient = {
      async rpc(fn, args) {
        calls.push({ fn, args });
        if (fn === 'get_public_shop') {
          if (args?.p_slug === 'missing') return { data: null, error: null };
          return {
            data: {
              shop: {
                id: 's1',
                name: 'Demo Shop',
                slug: 'demo',
                phone: '01700000000',
                address: 'Dhaka',
                business_type: 'Retail',
                logo_uri: null,
                online_theme: 'classic',
                delivery_inside: '6000',
                delivery_outside: '12000',
                shop_policy: '7-day return',
              },
              products: [
                {
                  id: 'p1',
                  name: 'Mug',
                  category_id: null,
                  category_name: null,
                  unit: 'pcs',
                  sell_price: '25000',
                  image_uri: null,
                  description: 'Ceramic',
                  featured: 1,
                  in_stock: true,
                },
              ],
            },
            error: null,
          };
        }
        if (fn === 'record_shop_visit') {
          return { data: null, error: null };
        }
        if (fn === 'place_online_order') {
          if (args?.p_phone === '01999999999') {
            return { data: null, error: { message: 'rate_limited' } };
          }
          return { data: { order_no: 'ON-000099', total: 56000 }, error: null };
        }
        return { data: null, error: { message: 'unknown' } };
      },
    };

    expect(await fetchPublicShop('missing', mockClient)).toBeNull();
    const shopData = await fetchPublicShop('DEMO', mockClient);
    expect(shopData?.shop.delivery_inside).toBe(6000);
    expect(shopData?.products[0].sell_price).toBe(25000);

    await recordPublicShopVisit('demo', mockClient);
    expect(calls.some((c) => c.fn === 'record_shop_visit')).toBe(true);

    // Invalid phone rejected client-side
    await expect(
      placePublicOrder(
        {
          slug: 'demo',
          customerName: 'A',
          phone: '12345',
          address: 'Dhaka 1200',
          area: 'inside',
          items: [{ product_id: 'p1', qty: 1 }],
        },
        mockClient,
      ),
    ).rejects.toThrow(AppError);

    // Duplicate item rejected client-side
    await expect(
      placePublicOrder(
        {
          slug: 'demo',
          customerName: 'A',
          phone: '01712345678',
          address: 'Dhaka 1200',
          area: 'inside',
          items: [
            { product_id: 'p1', qty: 1 },
            { product_id: 'p1', qty: 2 },
          ],
        },
        mockClient,
      ),
    ).rejects.toThrow(AppError);

    // Valid order with +88 phone normalized
    const placed = await placePublicOrder(
      {
        slug: 'demo',
        customerName: 'Tarek',
        phone: '+88 01712-345678',
        address: 'House 5, Dhanmondi',
        area: 'inside',
        note: 'Call first',
        items: [{ product_id: 'p1', qty: 2 }],
      },
      mockClient,
    );
    expect(placed).toEqual({ order_no: 'ON-000099', total: 56000 });

    // Server rate_limited maps to CONFLICT AppError
    await expect(
      placePublicOrder(
        {
          slug: 'demo',
          customerName: 'Tarek',
          phone: '01999999999',
          address: 'House 5, Dhanmondi',
          area: 'inside',
          items: [{ product_id: 'p1', qty: 1 }],
        },
        mockClient,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
