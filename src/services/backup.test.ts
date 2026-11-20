/** @jest-environment node */
import { eq } from 'drizzle-orm';

import { newRow, touch } from '@/db/helpers';
import { online_orders, products, shops, stock_movements } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { createTestDb } from '@/test/testDb';
import type { SyncTransport } from '@/sync/types';
import {
  BACKUP_APP_ID,
  BACKUP_VERSION,
  backupNow,
  exportShopJson,
  getLastBackupAt,
  importShopJson,
  setLastBackupAt,
} from './backup';

jest.mock('@/db/client', () => ({ db: {} }));
jest.mock('@/sync/manager', () => ({
  ensureSyncRuntimeStarted: jest.fn(),
  useSyncStore: { getState: () => ({ refreshStats: jest.fn() }), setState: jest.fn() },
}));

const SHOP = 'shop-b1';

function seedShopData(db: AppDb) {
  db.insert(shops)
    .values({
      ...newRow(SHOP, 'u1', 1000),
      id: SHOP,
      shop_id: SHOP,
      name: 'Backup Shop',
      slug: 'backup-shop',
      owner_id: 'u1',
      online_visits: 12,
    })
    .run();
  db.insert(products)
    .values({
      ...newRow(SHOP, 'u1', 1100),
      id: 'p1',
      name: 'Sugar',
      buy_price: 9000,
      sell_price: 12000,
      online_visible: 1,
    })
    .run();
  db.insert(stock_movements)
    .values({
      ...newRow(SHOP, 'u1', 1100),
      id: 'sm1',
      product_id: 'p1',
      qty: 10,
      type: 'opening',
      date: 1100,
    })
    .run();
  db.insert(online_orders)
    .values({
      ...newRow(SHOP, 'u1', 1200),
      id: 'o1',
      order_no: 'ON-000010',
      customer_name: 'Karim',
      phone: '01700000000',
      address: 'Mirpur 10',
      items_json: '[]',
      subtotal: 12000,
      delivery_charge: 6000,
      total: 18000,
      note: 'Afternoon',
      area: 'inside',
    })
    .run();
}

describe('backup service', () => {
  it('exports full shop JSON (including soft-deleted rows) and restores into empty DB', () => {
    const db1 = createTestDb();
    seedShopData(db1);

    const json = exportShopJson(db1, SHOP, 'owner');
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(BACKUP_VERSION);
    expect(parsed.app).toBe(BACKUP_APP_ID);
    expect(parsed.tables.shops).toHaveLength(1);
    expect(parsed.tables.products).toHaveLength(1);
    expect(parsed.tables.online_orders[0].note).toBe('Afternoon');
    expect('dirty' in parsed.tables.products[0]).toBe(false);

    const db2 = createTestDb();
    const res = importShopJson(db2, json, { role: 'owner' });
    expect(res.shopId).toBe(SHOP);
    expect(res.importedRows).toBe(4);
    expect(db2.select().from(shops).get()?.online_visits).toBe(12);
    expect(db2.select().from(products).get()?.dirty).toBe(1);
    expect(db2.select().from(online_orders).get()?.area).toBe('inside');
    expect(getLastBackupAt(db2)).not.toBeNull();
  });

  it('merge mode preserves newer local rows; replace mode overwrites shop completely', () => {
    const db = createTestDb();
    seedShopData(db);
    const snapshot = exportShopJson(db, SHOP, 'owner');

    // Local edits after backup
    db.update(products)
      .set({ ...touch(5000), name: 'Sugar Newer' })
      .where(eq(products.id, 'p1'))
      .run();
    db.insert(products)
      .values({ ...newRow(SHOP, 'u1', 5100), id: 'p-extra', name: 'Salt', sell_price: 4000 })
      .run();

    // Merge keeps newer local p1 and extra product
    importShopJson(db, snapshot, { role: 'owner', targetShopId: SHOP, mode: 'merge' });
    expect(db.select().from(products).where(eq(products.id, 'p1')).get()?.name).toBe('Sugar Newer');
    expect(db.select().from(products).all()).toHaveLength(2);

    // Replace restores exact snapshot
    importShopJson(db, snapshot, { role: 'owner', targetShopId: SHOP, mode: 'replace' });
    expect(db.select().from(products).where(eq(products.id, 'p1')).get()?.name).toBe('Sugar');
    expect(db.select().from(products).all()).toHaveLength(1);
  });

  it('enforces owner permissions and validates corrupted/cross-shop backups', () => {
    const db = createTestDb();
    seedShopData(db);

    expect(() => exportShopJson(db, SHOP, 'cashier')).toThrow(AppError);
    expect(() => exportShopJson(db, SHOP, 'manager')).toThrow(AppError);
    expect(() => exportShopJson(db, 'missing', 'owner')).toThrow(AppError);

    const validJson = exportShopJson(db, SHOP, 'owner');
    expect(() => importShopJson(db, validJson, { role: 'cashier' })).toThrow(AppError);
    expect(() => importShopJson(db, '{not-json', { role: 'owner' })).toThrow(AppError);
    expect(() => importShopJson(db, JSON.stringify({ version: 99 }), { role: 'owner' })).toThrow(
      AppError,
    );
    expect(() =>
      importShopJson(db, validJson, { role: 'owner', targetShopId: 'other-shop' }),
    ).toThrow(AppError);

    // Tampered cross-shop row rejected
    const tampered = JSON.parse(validJson);
    tampered.tables.products[0].shop_id = 'evil-shop';
    expect(() => importShopJson(db, JSON.stringify(tampered), { role: 'owner' })).toThrow(AppError);
  });

  it('backupNow forces sync and updates kv.last_backup_at', async () => {
    const db = createTestDb();
    seedShopData(db);
    expect(getLastBackupAt(db)).toBeNull();

    const stubTransport: SyncTransport = {
      getSessionUserId: async () => 'u1',
      acceptInvites: async () => ({ data: [], error: null }),
      upsert: async () => null,
      listAccessibleShopIds: async () => ({ data: [SHOP], error: null }),
      pullPage: async () => ({ data: [], error: null }),
    };

    const res = await backupNow(db, { transport: stubTransport });
    expect(res.pushed).toBe(4);
    expect(res.errors).toEqual([]);
    expect(getLastBackupAt(db)).toBe(res.lastBackupAt);

    setLastBackupAt(db, 123456789);
    expect(getLastBackupAt(db)).toBe(123456789);
  });
});
