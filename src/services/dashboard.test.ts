/** @jest-environment node */
import { newRow } from '@/db/helpers';
import {
  expenses,
  kv,
  online_orders,
  parties,
  products,
  purchases,
  sales,
  shops,
  sync_state,
} from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { createTestDb } from '@/test/testDb';
import {
  dismissNotification,
  dismissSetupCard,
  getDashboardStats,
  getDirtyRecordCount,
  getLastBackupAt,
  getNotificationCount,
  getNotifications,
  getSetupProgress,
  markAllNotificationsRead,
  markNotificationRead,
  restoreDismissedNotifications,
} from './dashboard';
import { postCash, postLedger, postStock, restoreWithRefs, softDeleteWithRefs } from './posting';

const SHOP = 'shop-1';
const OTHER = 'shop-2';
const USER = 'user-1';
const TODAY = new Date(2026, 10, 15, 14, 30, 0).getTime(); // 15 Nov 2026 14:30
const EARLIER_THIS_MONTH = new Date(2026, 10, 2, 10, 0, 0).getTime(); // 2 Nov 2026
const LAST_MONTH = new Date(2026, 9, 25, 10, 0, 0).getTime(); // 25 Oct 2026

function seedShop(db: AppDb, id = SHOP, overrides: Partial<typeof shops.$inferInsert> = {}) {
  db.insert(shops)
    .values({
      ...newRow(id, USER, TODAY),
      id,
      shop_id: id,
      name: 'Sohan Store',
      owner_id: USER,
      ...overrides,
    })
    .run();
}

describe('dashboard service', () => {
  it('returns zeroed stats on an empty shop', () => {
    const db = createTestDb();
    seedShop(db);
    const stats = getDashboardStats(db, SHOP, { period: 'day', at: TODAY, role: 'owner' });
    expect(stats.cashBalance).toBe(0);
    expect(stats.salesTotal).toBe(0);
    expect(stats.salesCount).toBe(0);
    expect(stats.purchasesTotal).toBe(0);
    expect(stats.expenseTotal).toBe(0);
    expect(stats.dueReceivable).toBe(0);
    expect(stats.duePayable).toBe(0);
    expect(stats.stockCount).toBe(0);
    expect(stats.lowStockCount).toBe(0);
    expect(stats.pendingOrdersCount).toBe(0);
  });

  it('rejects empty shopId with VALIDATION error', () => {
    const db = createTestDb();
    expect(() => getDashboardStats(db, '', { period: 'day' })).toThrow(AppError);
  });

  it('computes day vs month stats accurately and isolates other shops', () => {
    const db = createTestDb();
    seedShop(db, SHOP);
    seedShop(db, OTHER);

    // Sales: today 1500.00, earlier this month 2000.00, last month 999.00, other shop 5000.00
    const sToday = newRow(SHOP, USER, TODAY);
    db.insert(sales)
      .values([
        {
          ...sToday,
          invoice_no: 'INV-1',
          date: TODAY,
          subtotal: 150000,
          total: 150000,
          paid: 100000,
          due: 50000,
        },
        {
          ...newRow(SHOP, USER, EARLIER_THIS_MONTH),
          invoice_no: 'INV-2',
          date: EARLIER_THIS_MONTH,
          subtotal: 200000,
          total: 200000,
          paid: 200000,
          due: 0,
        },
        {
          ...newRow(SHOP, USER, LAST_MONTH),
          invoice_no: 'INV-0',
          date: LAST_MONTH,
          subtotal: 99900,
          total: 99900,
          paid: 99900,
          due: 0,
        },
        {
          ...newRow(OTHER, USER, TODAY),
          invoice_no: 'INV-OTHER',
          date: TODAY,
          subtotal: 500000,
          total: 500000,
          paid: 500000,
          due: 0,
        },
      ])
      .run();

    // Expenses: today 250.00, earlier this month 400.00
    db.insert(expenses)
      .values([
        { ...newRow(SHOP, USER, TODAY), amount: 25000, date: TODAY },
        { ...newRow(SHOP, USER, EARLIER_THIS_MONTH), amount: 40000, date: EARLIER_THIS_MONTH },
      ])
      .run();

    // Purchases: today 800.00
    db.insert(purchases)
      .values({
        ...newRow(SHOP, USER, TODAY),
        bill_no: 'BILL-1',
        date: TODAY,
        subtotal: 80000,
        total: 80000,
        paid: 50000,
        due: 30000,
      })
      .run();

    // Cash entries: cumulative balance = +100000 +200000 -25000 -50000 = 225000
    postCash(db, {
      shopId: SHOP,
      userId: USER,
      refId: sToday.id,
      date: TODAY,
      amount: 100000,
      type: 'sale',
      method: 'cash',
    });
    postCash(db, {
      shopId: SHOP,
      userId: USER,
      refId: null,
      date: EARLIER_THIS_MONTH,
      amount: 200000,
      type: 'sale',
      method: 'bkash',
    });
    postCash(db, {
      shopId: SHOP,
      userId: USER,
      refId: null,
      date: TODAY,
      amount: -25000,
      type: 'expense',
      method: 'cash',
    });
    postCash(db, {
      shopId: SHOP,
      userId: USER,
      refId: null,
      date: TODAY,
      amount: -50000,
      type: 'purchase',
      method: 'cash',
    });
    postCash(db, {
      shopId: OTHER,
      userId: USER,
      refId: null,
      date: TODAY,
      amount: 999900,
      type: 'cash_in',
      method: 'cash',
    });

    // Parties & dues: c1 owes 500.00, s1 we owe 300.00, c2 settled (0)
    const c1 = newRow(SHOP, USER, TODAY);
    const s1 = newRow(SHOP, USER, TODAY);
    const c2 = newRow(SHOP, USER, TODAY);
    db.insert(parties)
      .values([
        { ...c1, type: 'customer', name: 'Rahim' },
        { ...s1, type: 'supplier', name: 'Dhaka Wholesale' },
        { ...c2, type: 'customer', name: 'Karim' },
      ])
      .run();
    postLedger(db, {
      shopId: SHOP,
      userId: USER,
      refId: sToday.id,
      date: TODAY,
      partyId: c1.id,
      amount: 50000,
      type: 'sale_due',
    });
    postLedger(db, {
      shopId: SHOP,
      userId: USER,
      refId: null,
      date: TODAY,
      partyId: s1.id,
      amount: -30000,
      type: 'purchase_due',
    });
    postLedger(db, {
      shopId: SHOP,
      userId: USER,
      refId: null,
      date: TODAY,
      partyId: c2.id,
      amount: 10000,
      type: 'sale_due',
    });
    postLedger(db, {
      shopId: SHOP,
      userId: USER,
      refId: null,
      date: TODAY,
      partyId: c2.id,
      amount: -10000,
      type: 'received',
    });

    // Products & stock: p1 has 12 (alert 5 -> ok), p2 has 3 (alert 5 -> low)
    const p1 = newRow(SHOP, USER, TODAY);
    const p2 = newRow(SHOP, USER, TODAY);
    db.insert(products)
      .values([
        { ...p1, name: 'Rice', buy_price: 5000, sell_price: 6000, low_stock_alert: 5 },
        { ...p2, name: 'Oil', buy_price: 15000, sell_price: 18000, low_stock_alert: 5 },
      ])
      .run();
    postStock(db, {
      shopId: SHOP,
      userId: USER,
      refId: null,
      date: TODAY,
      productId: p1.id,
      qty: 12,
      type: 'opening',
    });
    postStock(db, {
      shopId: SHOP,
      userId: USER,
      refId: null,
      date: TODAY,
      productId: p2.id,
      qty: 3,
      type: 'opening',
    });

    // Day stats (owner)
    const day = getDashboardStats(db, SHOP, { period: 'day', at: TODAY, role: 'owner' });
    expect(day.cashBalance).toBe(225000);
    expect(day.salesTotal).toBe(150000);
    expect(day.salesCount).toBe(1);
    expect(day.purchasesTotal).toBe(80000);
    expect(day.expenseTotal).toBe(25000);
    expect(day.dueReceivable).toBe(50000);
    expect(day.duePayable).toBe(30000);
    expect(day.stockCount).toBe(15);
    expect(day.lowStockCount).toBe(1);

    // Month stats (owner)
    const month = getDashboardStats(db, SHOP, { period: 'month', at: TODAY, role: 'owner' });
    expect(month.cashBalance).toBe(225000);
    expect(month.salesTotal).toBe(350000);
    expect(month.salesCount).toBe(2);
    expect(month.expenseTotal).toBe(65000);

    // Cashier cannot see cashBalance
    const cashier = getDashboardStats(db, SHOP, { period: 'day', at: TODAY, role: 'cashier' });
    expect(cashier.cashBalance).toBeNull();
    expect(cashier.salesTotal).toBe(150000);

    // Soft-deleting today's sale reverses sales, cash, and party due; restoring brings it back
    db.transaction((tx) => softDeleteWithRefs(tx, { shopId: SHOP, table: sales, id: sToday.id }));
    const afterDel = getDashboardStats(db, SHOP, { period: 'day', at: TODAY, role: 'owner' });
    expect(afterDel.salesTotal).toBe(0);
    expect(afterDel.cashBalance).toBe(125000);
    expect(afterDel.dueReceivable).toBe(0);

    db.transaction((tx) => restoreWithRefs(tx, { shopId: SHOP, table: sales, id: sToday.id }));
    const afterRestore = getDashboardStats(db, SHOP, { period: 'day', at: TODAY, role: 'owner' });
    expect(afterRestore.salesTotal).toBe(150000);
    expect(afterRestore.cashBalance).toBe(225000);
    expect(afterRestore.dueReceivable).toBe(50000);
  });

  it('tracks setup progress and dismiss state', () => {
    const db = createTestDb();
    seedShop(db, SHOP);
    const p0 = getSetupProgress(db, SHOP);
    expect(p0.completedCount).toBe(0);
    expect(p0.percent).toBe(0);
    expect(p0.dismissed).toBe(false);

    // Complete profile + payment qr + online + add product/party/sale
    db.update(shops)
      .set({
        phone: '01711000000',
        address: 'Dhaka',
        business_type: 'Grocery',
        invoice_footer: 'Thanks!',
        online_enabled: 1,
      })
      .run();
    db.insert(products).values({ ...newRow(SHOP, USER), name: 'Tea' }).run();
    db.insert(parties).values({ ...newRow(SHOP, USER), type: 'customer', name: 'Ali' }).run();
    db.insert(sales)
      .values({ ...newRow(SHOP, USER), invoice_no: 'INV-1', date: TODAY, subtotal: 100, total: 100 })
      .run();

    const pFull = getSetupProgress(db, SHOP);
    expect(pFull.completedCount).toBe(6);
    expect(pFull.percent).toBe(100);
    expect(pFull.allDone).toBe(true);

    dismissSetupCard(db, SHOP, true);
    expect(getSetupProgress(db, SHOP).dismissed).toBe(true);
    dismissSetupCard(db, SHOP, false);
    expect(getSetupProgress(db, SHOP).dismissed).toBe(false);
  });

  it('reads last backup timestamp from kv and sync_state', () => {
    const db = createTestDb();
    seedShop(db, SHOP);
    expect(getLastBackupAt(db, SHOP)).toBeNull();
    expect(getDirtyRecordCount(db, SHOP)).toBeGreaterThanOrEqual(1);

    db.insert(kv).values({ key: 'last_backup_at', value: String(1700000000000) }).run();
    expect(getLastBackupAt(db, SHOP)).toBe(1700000000000);

    db.insert(sync_state)
      .values({ key: `${SHOP}:sales`, cursor: 5, last_synced_at: 1700000050000 })
      .run();
    expect(getLastBackupAt(db, SHOP)).toBe(1700000050000);
  });

  it('builds notifications for pending orders and low stock, supports read/dismiss/restore and cashier filtering', () => {
    const db = createTestDb();
    seedShop(db, SHOP);

    const pLow = newRow(SHOP, USER, TODAY);
    const pOut = newRow(SHOP, USER, TODAY - 1000);
    const pOk = newRow(SHOP, USER, TODAY);
    db.insert(products)
      .values([
        { ...pLow, name: 'Sugar', unit: 'kg', low_stock_alert: 10 },
        { ...pOut, name: 'Salt', unit: 'kg', low_stock_alert: 5 },
        { ...pOk, name: 'Flour', unit: 'kg', low_stock_alert: 5 },
      ])
      .run();
    postStock(db, {
      shopId: SHOP,
      userId: USER,
      refId: null,
      date: TODAY,
      productId: pLow.id,
      qty: 4,
      type: 'opening',
    });
    postStock(db, {
      shopId: SHOP,
      userId: USER,
      refId: null,
      date: TODAY,
      productId: pOk.id,
      qty: 20,
      type: 'opening',
    });

    const ordPending = newRow(SHOP, USER, TODAY + 1000);
    const ordDelivered = newRow(SHOP, USER, TODAY);
    db.insert(online_orders)
      .values([
        {
          ...ordPending,
          order_no: 'ORD-001',
          customer_name: 'Nadia',
          phone: '01700000001',
          address: 'Mirpur',
          items_json: '[]',
          subtotal: 50000,
          total: 56000,
          status: 'pending',
        },
        {
          ...ordDelivered,
          order_no: 'ORD-002',
          customer_name: 'Hasan',
          phone: '01700000002',
          address: 'Uttara',
          items_json: '[]',
          subtotal: 20000,
          total: 20000,
          status: 'delivered',
        },
      ])
      .run();

    const ownerList = getNotifications(db, SHOP, { role: 'owner' });
    expect(ownerList).toHaveLength(3);
    expect(ownerList.map((n) => n.type)).toEqual(['online_order', 'low_stock', 'low_stock']);
    expect(ownerList.find((n) => n.refId === pOut.id)?.severity).toBe('danger');
    expect(ownerList.find((n) => n.refId === pLow.id)?.severity).toBe('warning');
    expect(getNotificationCount(db, SHOP, { role: 'owner' })).toBe(3);

    // Cashier sees only low-stock notifications, not online orders
    const cashierList = getNotifications(db, SHOP, { role: 'cashier' });
    expect(cashierList).toHaveLength(2);
    expect(cashierList.every((n) => n.type === 'low_stock')).toBe(true);

    // Mark single read
    markNotificationRead(db, SHOP, ownerList[0].id);
    expect(getNotificationCount(db, SHOP, { role: 'owner' })).toBe(2);

    // Mark all read
    markAllNotificationsRead(db, SHOP, { role: 'owner' });
    expect(getNotificationCount(db, SHOP, { role: 'owner' })).toBe(0);

    // Dismiss & restore
    dismissNotification(db, SHOP, ownerList[0].id);
    expect(getNotifications(db, SHOP, { role: 'owner' })).toHaveLength(2);
    restoreDismissedNotifications(db, SHOP);
    expect(getNotifications(db, SHOP, { role: 'owner' })).toHaveLength(3);
  });
});
