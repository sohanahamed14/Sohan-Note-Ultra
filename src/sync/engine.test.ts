/** @jest-environment node */
import { eq } from 'drizzle-orm';
import { newRow, touch } from '@/db/helpers';
import {
  online_orders,
  products,
  purchase_items,
  purchases,
  shop_members,
  shops,
} from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { createTestDb } from '@/test/testDb';
import {
  acceptInvites,
  countDirtyRows,
  getLastBackupAt,
  getSyncCursor,
  purgeRevokedShop,
  pushDirtyTable,
  syncNow,
} from './engine';
import { toLocalRow, toRemoteRow } from './payload';
import { SYNC_ORDER, type SyncTableName, type SyncTransport, type TransportError } from './types';

class FakeSyncServer implements SyncTransport {
  seq = 0;
  tables: Record<SyncTableName, Map<string, Record<string, unknown>>> = Object.fromEntries(
    SYNC_ORDER.map((t) => [t, new Map()]),
  ) as Record<SyncTableName, Map<string, Record<string, unknown>>>;

  userId: string | null = 'user-1';
  accessibleShopIds: Set<string> = new Set();
  invitedShopIds: string[] = [];
  failUpsert: Partial<Record<SyncTableName, TransportError>> = {};
  failPull: Partial<Record<SyncTableName, TransportError>> = {};
  failInvites: TransportError | null = null;
  uploadedImages: { shopId: string; localUri: string; relativePath: string }[] = [];
  onBeforeUpsert?: (table: SyncTableName, rows: Record<string, unknown>[]) => void;

  seedRemote(table: SyncTableName, row: Record<string, unknown>): number {
    this.seq += 1;
    const stored = { ...row, server_seq: this.seq };
    this.tables[table].set(String(row.id), stored);
    if (table === 'shops') {
      this.accessibleShopIds.add(String(row.id));
    }
    return this.seq;
  }

  async getSessionUserId(): Promise<string | null> {
    return this.userId;
  }

  async acceptInvites() {
    if (this.failInvites) return { data: null, error: this.failInvites };
    const ids = [...this.invitedShopIds];
    for (const id of ids) this.accessibleShopIds.add(id);
    this.invitedShopIds = [];
    return { data: ids, error: null };
  }

  async upsert(table: SyncTableName, rows: Record<string, unknown>[]) {
    this.onBeforeUpsert?.(table, rows);
    const err = this.failUpsert[table];
    if (err) return err;

    for (const r of rows) {
      if ('dirty' in r || 'server_seq' in r) {
        return { code: '42703', message: 'Forbidden column dirty/server_seq in payload' };
      }
      if (table === 'shops' && r.slug && !r.deleted_at) {
        const slug = String(r.slug).toLowerCase();
        for (const other of this.tables.shops.values()) {
          if (
            other.id !== r.id &&
            !other.deleted_at &&
            other.slug &&
            String(other.slug).toLowerCase() === slug
          ) {
            return { code: '23505', message: 'duplicate key value violates unique constraint shops_slug_uq' };
          }
        }
      }

      const existing = this.tables[table].get(String(r.id));
      if (existing && Number(r.updated_at) < Number(existing.updated_at)) {
        // Server LWW trigger silently ignores stale writes without bumping server_seq.
        continue;
      }

      this.seq += 1;
      const next: Record<string, unknown> = { ...r, server_seq: this.seq };
      if (table === 'shops') {
        next.shop_id = r.id;
        next.online_visits = existing ? existing.online_visits : 0;
        this.accessibleShopIds.add(String(r.id));
        if (!existing) {
          // Simulate shop_owner_membership trigger.
          this.seq += 1;
          const memId = `mem_owner_${String(r.id)}`;
          this.tables.shop_members.set(memId, {
            id: memId,
            shop_id: r.id,
            created_at: r.created_at,
            updated_at: r.created_at,
            deleted_at: null,
            created_by: r.owner_id,
            user_id: r.owner_id,
            email: 'owner@test.com',
            name: null,
            role: 'owner',
            status: 'active',
            server_seq: this.seq,
          });
        }
      }
      this.tables[table].set(String(r.id), next);
    }
    return null;
  }

  async listAccessibleShopIds() {
    return { data: Array.from(this.accessibleShopIds), error: null };
  }

  async pullPage(table: SyncTableName, shopId: string, afterSeq: number, limit: number) {
    const err = this.failPull[table];
    if (err) return { data: null, error: err };
    const scopeCol = table === 'shops' ? 'id' : 'shop_id';
    const matching = Array.from(this.tables[table].values())
      .filter((r) => String(r[scopeCol]) === shopId && Number(r.server_seq) > afterSeq)
      .sort((a, b) => Number(a.server_seq) - Number(b.server_seq))
      .slice(0, limit);
    return { data: matching, error: null };
  }

  async uploadImage(shopId: string, localUri: string, relativePath: string): Promise<string> {
    this.uploadedImages.push({ shopId, localUri, relativePath });
    return `https://cdn.example.com/public-images/${shopId}/${relativePath}`;
  }
}

function seedLocalShop(db: AppDb, shopId = 'shop-1', ownerId = 'user-1', at = 1000) {
  db.insert(shops)
    .values({
      ...newRow(shopId, ownerId, at),
      id: shopId,
      shop_id: shopId,
      name: 'Sohan Store',
      slug: 'sohan-store',
      owner_id: ownerId,
      online_enabled: 1,
    })
    .run();
  db.insert(shop_members)
    .values({
      ...newRow(shopId, ownerId, at),
      id: 'local-owner-placeholder',
      user_id: ownerId,
      email: 'owner@test.com',
      role: 'owner',
      status: 'active',
    })
    .run();
}

describe('sync payload mapping', () => {
  it('strips dirty, fills all remote columns, and adds extra remote purchase cols', () => {
    const remotePurchase = toRemoteRow('purchases', {
      id: 'pur-1',
      shop_id: 's1',
      created_at: 1,
      updated_at: 2,
      deleted_at: null,
      created_by: 'u1',
      dirty: 1,
      bill_no: 'BILL-1',
      party_id: null,
      date: 100,
      subtotal: 500,
      discount: 0,
      vat: 0,
      total: 500,
      paid: 500,
      due: 0,
      method: 'cash',
      note: null,
    });
    expect('dirty' in remotePurchase).toBe(false);
    expect(remotePurchase.kind).toBeNull();

    const remotePurchaseItem = toRemoteRow('purchase_items', {
      id: 'pi-1',
      shop_id: 's1',
      created_at: 1,
      updated_at: 2,
      deleted_at: null,
      created_by: 'u1',
      dirty: 1,
      purchase_id: 'pur-1',
      product_id: 'p1',
      name: 'Tea',
      qty: 2,
      unit_price: 250,
      total: 500,
    });
    expect(remotePurchaseItem.buy_price).toBe(250);
    expect(remotePurchaseItem.warranty_until).toBeNull();
  });

  it('coerces string numbers and applies local NOT NULL defaults on pull', () => {
    const localProd = toLocalRow('products', {
      id: 'p1',
      shop_id: 's1',
      created_at: '100',
      updated_at: '200',
      deleted_at: null,
      created_by: null,
      server_seq: '99',
      name: 'Rice',
      category_id: null,
      unit: null,
      code: null,
      buy_price: '5000',
      sell_price: '8000',
      wholesale_price: '7000',
      low_stock_alert: '5.5',
      warranty_days: '30',
      image_uri: null,
      description: null,
      online_visible: '1',
      featured: '0',
    });
    expect('server_seq' in localProd).toBe(false);
    expect(localProd.unit).toBe('pcs');
    expect(localProd.sell_price).toBe(8000);
    expect(localProd.low_stock_alert).toBe(5.5);
    expect(localProd.dirty).toBe(0);
  });
});

describe('sync engine', () => {
  it('pushes dirty rows, skips own owner membership, dedupes on pull, uploads images, updates last_backup_at', async () => {
    const db = createTestDb();
    const server = new FakeSyncServer();
    seedLocalShop(db);

    db.insert(products)
      .values({
        ...newRow('shop-1', 'user-1', 1100),
        id: 'prod-1',
        name: 'Mango',
        sell_price: 15000,
        image_uri: 'file:///tmp/mango.png',
        online_visible: 1,
      })
      .run();

    db.insert(purchases)
      .values({
        ...newRow('shop-1', 'user-1', 1150),
        id: 'pur-1',
        bill_no: 'BILL-20261120-0001',
        date: 1150,
        subtotal: 10000,
        total: 10000,
      })
      .run();
    db.insert(purchase_items)
      .values({
        ...newRow('shop-1', 'user-1', 1150),
        id: 'pi-1',
        purchase_id: 'pur-1',
        product_id: 'prod-1',
        name: 'Mango',
        qty: 1,
        unit_price: 10000,
        total: 10000,
      })
      .run();

    // Seed an online order created by anon storefront on server with note & area!
    server.seedRemote('online_orders', {
      id: 'ord-1',
      shop_id: 'shop-1',
      created_at: 1200,
      updated_at: 1200,
      deleted_at: null,
      created_by: null,
      order_no: 'ON-000001',
      customer_name: 'Rahim',
      phone: '01711111111',
      address: 'Road 4, Banani',
      items_json: JSON.stringify([
        { product_id: 'prod-1', name: 'Mango', qty: 2, unit_price: 15000, total: 30000 },
      ]),
      subtotal: 30000,
      delivery_charge: 6000,
      total: 36000,
      status: 'pending',
      sale_id: null,
      note: 'Call before delivery',
      area: 'inside',
    });

    expect(countDirtyRows(db)).toBe(5);
    const res = await syncNow(db, { transport: server });
    expect(res.errors).toEqual([]);
    expect(res.pushed).toBe(4); // shop + product + purchase + purchase_item (own owner membership skipped)
    expect(countDirtyRows(db)).toBe(0);
    expect(getLastBackupAt(db)).toBe(res.syncedAt);

    // Local image uploaded and replaced with public URL
    expect(server.uploadedImages).toHaveLength(1);
    const syncedProd = db.select().from(products).where(eq(products.id, 'prod-1')).get();
    expect(syncedProd?.image_uri).toBe('https://cdn.example.com/public-images/shop-1/products/prod-1.png');

    // Canonical mem_owner_shop-1 replaced local-owner-placeholder (no duplicate owners)
    const members = db.select().from(shop_members).all();
    expect(members).toHaveLength(1);
    expect(members[0].id).toBe('mem_owner_shop-1');

    // Pulled online order preserves note & area
    const ord = db.select().from(online_orders).where(eq(online_orders.id, 'ord-1')).get();
    expect(ord).toMatchObject({
      order_no: 'ON-000001',
      note: 'Call before delivery',
      area: 'inside',
      dirty: 0,
    });
    expect(getSyncCursor(db, 'shop-1', 'online_orders')).toBeGreaterThan(0);
  });

  it('respects LWW on pull and preserves dirty flag when row mutates mid-push', async () => {
    const db = createTestDb();
    const server = new FakeSyncServer();
    seedLocalShop(db, 'shop-1', 'user-1', 1000);
    await syncNow(db, { transport: server });

    // Local dirty newer product must NOT be overwritten by older remote row
    db.insert(products)
      .values({
        ...newRow('shop-1', 'user-1', 5000),
        id: 'p-lww',
        name: 'Local Newer',
        sell_price: 2000,
      })
      .run();
    server.seedRemote('products', {
      ...toRemoteRow('products', {
        ...newRow('shop-1', 'user-1', 3000),
        id: 'p-lww',
        name: 'Remote Older',
        sell_price: 1000,
      }),
    });

    // Mutate local row during push to verify dirty stays 1 if updated_at changes concurrently!
    let mutatedOnce = false;
    server.onBeforeUpsert = (table) => {
      if (table === 'products' && !mutatedOnce) {
        mutatedOnce = true;
        db.update(products)
          .set({ ...touch(6000), name: 'Edited Mid-Push' })
          .where(eq(products.id, 'p-lww'))
          .run();
      }
    };

    await pushDirtyTable(db, 'products', server, { userId: 'user-1' });
    const afterMidEdit = db.select().from(products).where(eq(products.id, 'p-lww')).get();
    expect(afterMidEdit?.name).toBe('Edited Mid-Push');
    expect(afterMidEdit?.dirty).toBe(1);

    // Sync again with server having an older row — local dirty newer wins and gets pushed!
    const res = await syncNow(db, { transport: server });
    expect(res.errors).toEqual([]);
    expect(db.select().from(products).where(eq(products.id, 'p-lww')).get()?.name).toBe(
      'Edited Mid-Push',
    );
    expect(server.tables.products.get('p-lww')?.name).toBe('Edited Mid-Push');
  });

  it('paginates pull pages and surfaces 23505 slug clash & 42501 RLS errors without clearing dirty', async () => {
    const db = createTestDb();
    const server = new FakeSyncServer();
    seedLocalShop(db, 'shop-1', 'user-1', 1000);
    await syncNow(db, { transport: server });

    // Seed 5 products on server and pull with pageSize=2
    for (let i = 1; i <= 5; i++) {
      server.seedRemote('products', {
        ...toRemoteRow('products', {
          ...newRow('shop-1', 'user-1', 2000 + i),
          id: `rem-p-${i}`,
          name: `Item ${i}`,
          sell_price: i * 100,
        }),
      });
    }
    const pageRes = await syncNow(db, { transport: server, pageSize: 2 });
    expect(pageRes.pulled).toBe(5);
    expect(db.select().from(products).all()).toHaveLength(5);

    // Trigger 23505 slug collision on shops
    server.tables.shops.set('other-shop', {
      id: 'other-shop',
      shop_id: 'other-shop',
      slug: 'taken-slug',
      deleted_at: null,
      updated_at: 9999,
      server_seq: 999,
    });
    db.update(shops)
      .set({ ...touch(3000), slug: 'taken-slug' })
      .where(eq(shops.id, 'shop-1'))
      .run();
    const clashRes = await syncNow(db, { transport: server });
    expect(clashRes.errors[0]?.code).toBe('SLUG_TAKEN');
    expect(db.select().from(shops).where(eq(shops.id, 'shop-1')).get()?.dirty).toBe(1);

    // Fix slug, simulate 42501 RLS error on categories
    db.update(shops)
      .set({ ...touch(3500), slug: 'sohan-store' })
      .where(eq(shops.id, 'shop-1'))
      .run();
    server.failUpsert.products = { code: '42501', message: 'new row violates row-level security' };
    db.update(products)
      .set({ ...touch(4000), name: 'Blocked' })
      .where(eq(products.id, 'rem-p-1'))
      .run();
    const rlsRes = await syncNow(db, { transport: server });
    expect(rlsRes.errors[0]?.code).toBe('FORBIDDEN');
    expect(db.select().from(products).where(eq(products.id, 'rem-p-1')).get()?.dirty).toBe(1);
  });

  it('accepts invites, purges revoked synced shops, and preserves unsynced offline shops', async () => {
    const db = createTestDb();
    const server = new FakeSyncServer();
    seedLocalShop(db, 'shop-1', 'user-1', 1000);
    await syncNow(db, { transport: server });

    // Create a second offline-only shop (dirty=1)
    db.insert(shops)
      .values({
        ...newRow('shop-offline', 'user-1', 2000),
        id: 'shop-offline',
        shop_id: 'shop-offline',
        name: 'Offline Shop',
        owner_id: 'user-1',
      })
      .run();

    // Revoke shop-1 on server and fail shops push so shop-offline stays dirty=1
    server.accessibleShopIds.delete('shop-1');
    server.failUpsert.shops = { code: '42501', message: 'temp skip' };
    const res = await syncNow(db, { transport: server });
    expect(res.revokedShops).toEqual(['shop-1']);
    expect(db.select().from(shops).where(eq(shops.id, 'shop-1')).get()).toBeUndefined();
    expect(db.select().from(shops).where(eq(shops.id, 'shop-offline')).get()).toBeDefined();

    // Test acceptInvites standalone + network error throwing AppError(NETWORK)
    server.invitedShopIds = ['shop-invited'];
    expect(await acceptInvites(server)).toEqual(['shop-invited']);
    server.failInvites = { message: 'Network request failed', isNetwork: true };
    await expect(syncNow(db, { transport: server })).rejects.toThrow(AppError);

    // Direct purgeRevokedShop clears cursors too
    purgeRevokedShop(db, 'shop-offline');
    expect(db.select().from(shops).all()).toHaveLength(0);
  });

  it('rejects sync when unauthenticated', async () => {
    const db = createTestDb();
    const server = new FakeSyncServer();
    server.userId = null;
    await expect(syncNow(db, { transport: server })).rejects.toThrow(AppError);
  });
});
