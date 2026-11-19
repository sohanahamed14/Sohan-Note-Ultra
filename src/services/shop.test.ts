/** @jest-environment node */
import { eq, isNull } from 'drizzle-orm';
import { newRow } from '@/db/helpers';
import { categories, expenses, products, sales, shop_members, shops } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { createTestDb } from '@/test/testDb';
import {
  cacheRemoteShopsAndMembers,
  createCategory,
  createShop,
  deleteCategory,
  exportShopDataJson,
  getLastBackupAt,
  getProfileCompletion,
  getShop,
  listCategories,
  listUserShops,
  resetShopData,
  setDecimalEnabled,
  setLastBackupAt,
  setPaymentQr,
  slugifyShopName,
  updateCategory,
  updateShop,
} from './shop';

const ACTOR = { userId: 'u-owner', email: 'Owner@Example.com', name: 'Sohan' };

describe('shop service', () => {
  it('slugifies shop names safely', () => {
    expect(slugifyShopName('Satarkul Gas Store!')).toBe('satarkul-gas-store');
    expect(slugifyShopName('AB')).toBe('shop-ab');
    expect(slugifyShopName('   ')).toBe('shop-store');
  });

  it('creates shop with unique slug and local mem_owner_<id> (dirty=0)', () => {
    const db = createTestDb();
    const s1 = createShop(
      db,
      { name: 'Satarkul Gas', business_type: 'Gas & Fuel', phone: '01840673882', address: 'Dhaka' },
      ACTOR,
    );
    expect(s1.shop_id).toBe(s1.id);
    expect(s1.slug).toBe('satarkul-gas');
    expect(s1.dirty).toBe(1);
    expect(s1.owner_id).toBe(ACTOR.userId);

    const ownerMember = db
      .select()
      .from(shop_members)
      .where(eq(shop_members.id, `mem_owner_${s1.id}`))
      .get();
    expect(ownerMember).toMatchObject({
      shop_id: s1.id,
      user_id: ACTOR.userId,
      email: 'owner@example.com',
      role: 'owner',
      status: 'active',
      dirty: 0,
    });

    // Second shop with same name gets suffixed unique slug
    const s2 = createShop(db, { name: 'Satarkul Gas' }, ACTOR);
    expect(s2.slug).toBe('satarkul-gas-2');

    // Explicit duplicate slug rejected
    expect(() => createShop(db, { name: 'Third', slug: 'satarkul-gas' }, ACTOR)).toThrow(AppError);
  });

  it('rejects empty shop name or missing actor userId', () => {
    const db = createTestDb();
    expect(() => createShop(db, { name: '   ' }, ACTOR)).toThrow(AppError);
    expect(() => createShop(db, { name: 'Valid' }, { userId: '', email: 'a@b.com' })).toThrow(
      AppError,
    );
  });

  it('lists owned and member shops with highest role', () => {
    const db = createTestDb();
    const own = createShop(db, { name: 'Own Shop' }, ACTOR);
    const other = createShop(db, { name: 'Other Shop' }, { userId: 'u-other', email: 'o@t.com' });

    db.insert(shop_members)
      .values({
        ...newRow(other.id, 'u-other'),
        user_id: ACTOR.userId,
        email: 'owner@example.com',
        role: 'manager',
        status: 'active',
      })
      .run();

    const list = listUserShops(db, ACTOR.userId, ACTOR.email);
    expect(list.map((e) => [e.shop.id, e.role])).toEqual([
      [own.id, 'owner'],
      [other.id, 'manager'],
    ]);
  });

  it('updates shop settings with owner-only permission & slug collision checks', () => {
    const db = createTestDb();
    const s1 = createShop(db, { name: 'Shop One' }, ACTOR);
    const s2 = createShop(db, { name: 'Shop Two' }, ACTOR);

    expect(() => updateShop(db, s1.id, 'manager', { name: 'Hacked' })).toThrow(AppError);
    expect(() => updateShop(db, s1.id, 'cashier', { name: 'Hacked' })).toThrow(AppError);
    expect(() => updateShop(db, s1.id, 'owner', { slug: s2.slug })).toThrow(AppError);
    expect(() => updateShop(db, s1.id, 'owner', { vat_percent: 150 })).toThrow(AppError);

    const updated = updateShop(db, s1.id, 'owner', {
      name: 'Shop One Plus',
      vat_percent: 5,
      invoice_footer: 'Thank you!',
    });
    expect(updated.name).toBe('Shop One Plus');
    expect(updated.vat_percent).toBe(5);
    expect(updated.invoice_footer).toBe('Thank you!');

    const dec = setDecimalEnabled(db, s1.id, 'owner', true);
    expect(dec.decimal_enabled).toBe(1);

    const qr = setPaymentQr(db, s1.id, 'owner', 'https://cdn.example/qr.png');
    expect(qr.payment_qr_uri).toBe('https://cdn.example/qr.png');
  });

  it('calculates profile completion percentage accurately', () => {
    const db = createTestDb();
    expect(getProfileCompletion(null).percent).toBe(0);

    const minimal = createShop(db, { name: 'Minimal' }, ACTOR);
    expect(getProfileCompletion(minimal).percent).toBe(20);

    const full = updateShop(db, minimal.id, 'owner', {
      business_type: 'Grocery',
      phone: '01711000000',
      address: 'Dhaka',
      logo_uri: 'https://cdn.example/logo.png',
    });
    const comp = getProfileCompletion(full);
    expect(comp.percent).toBe(100);
    expect(comp.completed).toBe(5);
  });

  it('manages custom categories CRUD with duplicate and permission checks', () => {
    const db = createTestDb();
    const shop = createShop(db, { name: 'Cat Shop' }, ACTOR);

    expect(() =>
      createCategory(db, shop.id, 'u-cash', 'cashier', { name: 'Drinks', kind: 'product' }),
    ).toThrow(AppError);

    const c1 = createCategory(db, shop.id, ACTOR.userId, 'owner', {
      name: 'Drinks',
      kind: 'product',
    });
    const c2 = createCategory(db, shop.id, ACTOR.userId, 'manager', {
      name: 'Rent',
      kind: 'expense',
    });

    // Case-insensitive duplicate in same kind rejected; same name in other kind allowed
    expect(() =>
      createCategory(db, shop.id, ACTOR.userId, 'owner', { name: 'drinks', kind: 'product' }),
    ).toThrow(AppError);
    createCategory(db, shop.id, ACTOR.userId, 'owner', { name: 'Drinks', kind: 'expense' });

    expect(listCategories(db, shop.id, 'product')).toHaveLength(1);
    expect(listCategories(db, shop.id, 'expense')).toHaveLength(2);

    const renamed = updateCategory(db, shop.id, 'owner', c1.id, { name: 'Beverages' });
    expect(renamed.name).toBe('Beverages');

    deleteCategory(db, shop.id, 'owner', c2.id);
    expect(listCategories(db, shop.id, 'expense')).toHaveLength(1);

    const deletedRow = db.select().from(categories).where(eq(categories.id, c2.id)).get();
    expect(deletedRow?.deleted_at).not.toBeNull();
  });

  it('exports shop data JSON and soft-resets shop operational data', () => {
    const db = createTestDb();
    const shop = createShop(db, { name: 'Reset Shop' }, ACTOR);

    createCategory(db, shop.id, ACTOR.userId, 'owner', { name: 'Snacks', kind: 'product' });
    db.insert(products)
      .values({ ...newRow(shop.id, ACTOR.userId), name: 'Chips', sell_price: 2000 })
      .run();
    db.insert(expenses)
      .values({ ...newRow(shop.id, ACTOR.userId), amount: 5000, date: 1000 })
      .run();
    db.insert(sales)
      .values({
        ...newRow(shop.id, ACTOR.userId),
        invoice_no: 'INV-1',
        date: 1000,
        subtotal: 2000,
        total: 2000,
      })
      .run();

    expect(() => exportShopDataJson(db, shop.id, 'manager')).toThrow(AppError);
    const parsed = JSON.parse(exportShopDataJson(db, shop.id, 'owner')) as {
      version: number;
      tables: { products: unknown[]; sales: unknown[]; expenses: unknown[] };
    };
    expect(parsed.version).toBe(1);
    expect(parsed.tables.products).toHaveLength(1);
    expect(parsed.tables.sales).toHaveLength(1);
    expect(parsed.tables.expenses).toHaveLength(1);

    expect(() => resetShopData(db, shop.id, 'cashier')).toThrow(AppError);
    const count = resetShopData(db, shop.id, 'owner');
    expect(count).toBe(4); // 1 category + 1 product + 1 expense + 1 sale

    // Shop and owner membership still active
    expect(getShop(db, shop.id)).not.toBeNull();
    expect(
      db.select().from(products).where(isNull(products.deleted_at)).all(),
    ).toHaveLength(0);
    expect(
      db.select().from(shop_members).where(isNull(shop_members.deleted_at)).all(),
    ).toHaveLength(1);
  });

  it('reads/writes last backup timestamp and caches remote shops with LWW', () => {
    const db = createTestDb();
    expect(getLastBackupAt(db)).toBeNull();
    setLastBackupAt(db, 1700000000000);
    expect(getLastBackupAt(db)).toBe(1700000000000);

    const local = createShop(db, { name: 'Local Newer' }, ACTOR);
    const remoteOlder = { ...local, name: 'Remote Stale', updated_at: local.updated_at - 1000 };
    const { dirty: _d, ...remotePayload } = remoteOlder;
    void _d;

    cacheRemoteShopsAndMembers(db, [remotePayload], []);
    // Local is dirty and newer, so remote stale write must not overwrite
    expect(getShop(db, local.id)?.name).toBe('Local Newer');

    // Remote newer write wins and clears dirty
    cacheRemoteShopsAndMembers(
      db,
      [{ ...remotePayload, name: 'Remote Newer', updated_at: local.updated_at + 1000 }],
      [],
    );
    const after = db.select().from(shops).where(eq(shops.id, local.id)).get();
    expect(after?.name).toBe('Remote Newer');
    expect(after?.dirty).toBe(0);
  });
});
