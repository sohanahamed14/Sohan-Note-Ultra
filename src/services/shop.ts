import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { active, newRow, softDelete, touch } from '@/db/helpers';
import {
  cash_entries,
  categories,
  expenses,
  kv,
  online_orders,
  parties,
  party_ledger,
  products,
  purchase_items,
  purchases,
  sale_items,
  sales,
  shop_members,
  shops,
  stock_movements,
  type Category,
  type Role,
  type Shop,
  type ShopMember,
} from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { can } from './permissions';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

const slugRegex = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/;

export const createShopSchema = z.object({
  name: z.string().trim().min(1, 'Shop name is required').max(100, 'Shop name is too long'),
  business_type: optionalText(60),
  phone: optionalText(30),
  address: optionalText(250),
  slug: optionalText(50).refine((v) => !v || slugRegex.test(v.toLowerCase()), {
    message: 'Slug must be 3-50 lowercase letters, numbers, or hyphens',
  }),
  logo_uri: optionalText(500),
});

export const updateShopSchema = z.object({
  name: z.string().trim().min(1, 'Shop name is required').max(100).optional(),
  business_type: optionalText(60),
  phone: optionalText(30),
  address: optionalText(250),
  slug: optionalText(50).refine((v) => !v || slugRegex.test(v.toLowerCase()), {
    message: 'Slug must be 3-50 lowercase letters, numbers, or hyphens',
  }),
  logo_uri: optionalText(500),
  vat_percent: z.number().min(0, 'VAT cannot be negative').max(100, 'VAT cannot exceed 100%').optional(),
  invoice_footer: optionalText(200),
  payment_qr_uri: optionalText(500),
  decimal_enabled: z.boolean().optional(),
  online_enabled: z.boolean().optional(),
  online_theme: optionalText(40),
  delivery_inside: z.number().int().min(0).optional(),
  delivery_outside: z.number().int().min(0).optional(),
  shop_policy: optionalText(2000),
});

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(60, 'Category name is too long'),
  kind: z.enum(['product', 'expense']),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(60, 'Category name is too long'),
});

export type CreateShopInput = z.input<typeof createShopSchema>;
export type UpdateShopInput = z.input<typeof updateShopSchema>;
export type CategoryInput = z.input<typeof categoryInputSchema>;

export type ShopActor = {
  userId: string;
  email: string;
  name?: string | null;
};

export type UserShopEntry = {
  shop: Shop;
  role: Role;
};

export type ProfileCompletionItem = {
  key: 'name' | 'business_type' | 'phone' | 'address' | 'logo_uri';
  label: string;
  done: boolean;
};

export type ProfileCompletion = {
  percent: number;
  completed: number;
  total: number;
  items: ProfileCompletionItem[];
};

const ROLE_RANK: Record<Role, number> = { owner: 0, manager: 1, cashier: 2 };
const LAST_BACKUP_KEY = 'last_backup_at';

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const res = schema.safeParse(input);
  if (!res.success) {
    const first = res.error.issues[0]?.message ?? 'Invalid input';
    throw new AppError('VALIDATION', first);
  }
  return res.data;
}

/** Converts shop name into a URL-safe slug (3-40 chars). */
export function slugifyShopName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (base.length >= 3) return base;
  return `shop-${base || 'store'}`;
}

function findSlugCollision(db: AppDb, slug: string, excludeShopId?: string): boolean {
  const rows = db
    .select({ id: shops.id })
    .from(shops)
    .where(and(sql`lower(${shops.slug}) = ${slug.toLowerCase()}`, isNull(shops.deleted_at)))
    .all();
  return rows.some((r) => r.id !== excludeShopId);
}

function generateUniqueSlug(db: AppDb, name: string): string {
  const base = slugifyShopName(name);
  if (!findSlugCollision(db, base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base.slice(0, 44)}-${i}`;
    if (!findSlugCollision(db, candidate)) return candidate;
  }
  return `${base.slice(0, 36)}-${Date.now().toString(36)}`;
}

/** Creates a new shop and local owner membership (dirty=0; server trigger creates mem_owner_<id>). */
export function createShop(db: AppDb, input: CreateShopInput, actor: ShopActor): Shop {
  if (!actor.userId.trim()) {
    throw new AppError('FORBIDDEN', 'Sign in required to create a shop');
  }
  const data = parseOrThrow(createShopSchema, input);
  const desiredSlug = data.slug ? data.slug.toLowerCase() : null;
  if (desiredSlug && findSlugCollision(db, desiredSlug)) {
    throw new AppError('CONFLICT', 'Shop link slug is already in use');
  }

  return db.transaction((tx) => {
    const row = newRow('pending', actor.userId);
    const shopId = row.id;
    const slug = desiredSlug ?? generateUniqueSlug(tx, data.name);

    tx.insert(shops)
      .values({
        ...row,
        shop_id: shopId,
        name: data.name,
        slug,
        business_type: data.business_type ?? null,
        phone: data.phone ?? null,
        address: data.address ?? null,
        logo_uri: data.logo_uri ?? null,
        owner_id: actor.userId,
      })
      .run();

    // Server trigger creates id = 'mem_owner_<shop_id>'; keep dirty=0 locally so client never pushes it.
    tx.insert(shop_members)
      .values({
        id: `mem_owner_${shopId}`,
        shop_id: shopId,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: null,
        created_by: actor.userId,
        dirty: 0,
        user_id: actor.userId,
        email: actor.email.trim().toLowerCase(),
        name: actor.name?.trim() || null,
        role: 'owner',
        status: 'active',
      })
      .run();

    const created = tx.select().from(shops).where(eq(shops.id, shopId)).get();
    if (!created) throw new AppError('UNKNOWN', 'Failed to create shop');
    return created;
  });
}

export function getShop(db: AppDb, shopId: string): Shop | null {
  return (
    db
      .select()
      .from(shops)
      .where(and(eq(shops.id, shopId), isNull(shops.deleted_at)))
      .get() ?? null
  );
}

/** Lists all active shops the user owns or belongs to, with highest effective role. */
export function listUserShops(
  db: AppDb,
  userId: string,
  email?: string | null,
): UserShopEntry[] {
  const allShops = db
    .select()
    .from(shops)
    .where(isNull(shops.deleted_at))
    .orderBy(asc(shops.created_at))
    .all();

  const shopById = new Map<string, Shop>();
  for (const s of allShops) shopById.set(s.id, s);

  const roleByShop = new Map<string, Role>();
  for (const s of allShops) {
    if (s.owner_id === userId) {
      roleByShop.set(s.id, 'owner');
    }
  }

  const normalizedEmail = email?.trim().toLowerCase() ?? '';
  const members = db
    .select()
    .from(shop_members)
    .where(and(isNull(shop_members.deleted_at), eq(shop_members.status, 'active')))
    .all();

  for (const m of members) {
    const matchesUser =
      m.user_id === userId || (normalizedEmail !== '' && m.email.toLowerCase() === normalizedEmail);
    if (!matchesUser || !shopById.has(m.shop_id)) continue;
    const prev = roleByShop.get(m.shop_id);
    if (!prev || ROLE_RANK[m.role] < ROLE_RANK[prev]) {
      roleByShop.set(m.shop_id, m.role);
    }
  }

  const result: UserShopEntry[] = [];
  for (const s of allShops) {
    const role = roleByShop.get(s.id);
    if (role) result.push({ shop: s, role });
  }
  return result;
}

/** Updates shop profile and settings (owner only). */
export function updateShop(
  db: AppDb,
  shopId: string,
  role: Role,
  input: UpdateShopInput,
): Shop {
  if (!can(role, 'manageSettings')) {
    throw new AppError('FORBIDDEN', 'Only shop owners can update shop settings');
  }
  const existing = getShop(db, shopId);
  if (!existing) throw new AppError('NOT_FOUND', 'Shop not found');

  const data = parseOrThrow(updateShopSchema, input);
  const nextSlug =
    data.slug === undefined ? undefined : data.slug === null ? null : data.slug.toLowerCase();

  if (nextSlug && findSlugCollision(db, nextSlug, shopId)) {
    throw new AppError('CONFLICT', 'Shop link slug is already in use');
  }

  const patch: Partial<typeof shops.$inferInsert> = { ...touch() };
  if (data.name !== undefined) patch.name = data.name;
  if (data.business_type !== undefined) patch.business_type = data.business_type;
  if (data.phone !== undefined) patch.phone = data.phone;
  if (data.address !== undefined) patch.address = data.address;
  if (nextSlug !== undefined) patch.slug = nextSlug;
  if (data.logo_uri !== undefined) patch.logo_uri = data.logo_uri;
  if (data.vat_percent !== undefined) patch.vat_percent = data.vat_percent;
  if (data.invoice_footer !== undefined) patch.invoice_footer = data.invoice_footer;
  if (data.payment_qr_uri !== undefined) patch.payment_qr_uri = data.payment_qr_uri;
  if (data.decimal_enabled !== undefined) patch.decimal_enabled = data.decimal_enabled ? 1 : 0;
  if (data.online_enabled !== undefined) patch.online_enabled = data.online_enabled ? 1 : 0;
  if (data.online_theme !== undefined) patch.online_theme = data.online_theme;
  if (data.delivery_inside !== undefined) patch.delivery_inside = data.delivery_inside;
  if (data.delivery_outside !== undefined) patch.delivery_outside = data.delivery_outside;
  if (data.shop_policy !== undefined) patch.shop_policy = data.shop_policy;

  db.update(shops)
    .set(patch)
    .where(and(eq(shops.id, shopId), isNull(shops.deleted_at)))
    .run();

  const updated = getShop(db, shopId);
  if (!updated) throw new AppError('NOT_FOUND', 'Shop not found');
  return updated;
}

export function setDecimalEnabled(
  db: AppDb,
  shopId: string,
  role: Role,
  enabled: boolean,
): Shop {
  return updateShop(db, shopId, role, { decimal_enabled: enabled });
}

export function setPaymentQr(
  db: AppDb,
  shopId: string,
  role: Role,
  uri: string | null,
): Shop {
  return updateShop(db, shopId, role, { payment_qr_uri: uri });
}

/** Computes profile completion percentage across 5 core shop profile fields. */
export function getProfileCompletion(shop: Shop | null): ProfileCompletion {
  const items: ProfileCompletionItem[] = [
    { key: 'name', label: 'Shop name', done: Boolean(shop?.name?.trim()) },
    { key: 'business_type', label: 'Business type', done: Boolean(shop?.business_type?.trim()) },
    { key: 'phone', label: 'Phone number', done: Boolean(shop?.phone?.trim()) },
    { key: 'address', label: 'Shop address', done: Boolean(shop?.address?.trim()) },
    { key: 'logo_uri', label: 'Shop logo', done: Boolean(shop?.logo_uri?.trim()) },
  ];
  const completed = items.filter((i) => i.done).length;
  const total = items.length;
  const percent = Math.round((completed / total) * 100);
  return { percent, completed, total, items };
}

/* ---------- Custom Categories CRUD ---------- */

export function listCategories(
  db: AppDb,
  shopId: string,
  kind?: 'product' | 'expense',
): Category[] {
  const cond = kind
    ? and(active(categories, shopId), eq(categories.kind, kind))
    : active(categories, shopId);
  return db.select().from(categories).where(cond).orderBy(asc(categories.name)).all();
}

export function createCategory(
  db: AppDb,
  shopId: string,
  userId: string | null,
  role: Role,
  input: CategoryInput,
): Category {
  if (!can(role, 'manageSettings') && !can(role, 'manageProducts')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to manage categories');
  }
  const data = parseOrThrow(categoryInputSchema, input);
  const existing = db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        active(categories, shopId),
        eq(categories.kind, data.kind),
        sql`lower(${categories.name}) = ${data.name.toLowerCase()}`,
      ),
    )
    .get();
  if (existing) {
    throw new AppError('CONFLICT', 'Category already exists');
  }

  const row = newRow(shopId, userId);
  db.insert(categories)
    .values({ ...row, name: data.name, kind: data.kind })
    .run();

  const created = db.select().from(categories).where(eq(categories.id, row.id)).get();
  if (!created) throw new AppError('UNKNOWN', 'Failed to create category');
  return created;
}

export function updateCategory(
  db: AppDb,
  shopId: string,
  role: Role,
  id: string,
  input: { name: string },
): Category {
  if (!can(role, 'manageSettings') && !can(role, 'manageProducts')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to manage categories');
  }
  const data = parseOrThrow(updateCategorySchema, input);
  const current = db
    .select()
    .from(categories)
    .where(and(active(categories, shopId), eq(categories.id, id)))
    .get();
  if (!current) throw new AppError('NOT_FOUND', 'Category not found');

  const dup = db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        active(categories, shopId),
        eq(categories.kind, current.kind),
        sql`lower(${categories.name}) = ${data.name.toLowerCase()}`,
      ),
    )
    .all()
    .some((r) => r.id !== id);
  if (dup) throw new AppError('CONFLICT', 'Category already exists');

  db.update(categories)
    .set({ ...touch(), name: data.name })
    .where(and(active(categories, shopId), eq(categories.id, id)))
    .run();

  const updated = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!updated) throw new AppError('NOT_FOUND', 'Category not found');
  return updated;
}

export function deleteCategory(db: AppDb, shopId: string, role: Role, id: string): void {
  if (!can(role, 'delete') || (!can(role, 'manageSettings') && !can(role, 'manageProducts'))) {
    throw new AppError('FORBIDDEN', 'You do not have permission to delete categories');
  }
  softDelete(db, categories, shopId, id);
}

/* ---------- Data Export, Reset & Backup Timestamp ---------- */

const RESETTABLE_TABLES = [
  categories,
  products,
  stock_movements,
  parties,
  party_ledger,
  sales,
  sale_items,
  purchases,
  purchase_items,
  expenses,
  cash_entries,
  online_orders,
] as const;

/** Exports all active records for a shop as a JSON string (owner only). */
export function exportShopDataJson(db: AppDb, shopId: string, role: Role): string {
  if (!can(role, 'manageSettings')) {
    throw new AppError('FORBIDDEN', 'Only shop owners can export shop data');
  }
  const shop = getShop(db, shopId);
  if (!shop) throw new AppError('NOT_FOUND', 'Shop not found');

  const payload = {
    version: 1,
    exported_at: Date.now(),
    shop_id: shopId,
    tables: {
      shops: [shop],
      shop_members: db.select().from(shop_members).where(active(shop_members, shopId)).all(),
      categories: db.select().from(categories).where(active(categories, shopId)).all(),
      products: db.select().from(products).where(active(products, shopId)).all(),
      stock_movements: db
        .select()
        .from(stock_movements)
        .where(active(stock_movements, shopId))
        .all(),
      parties: db.select().from(parties).where(active(parties, shopId)).all(),
      party_ledger: db.select().from(party_ledger).where(active(party_ledger, shopId)).all(),
      sales: db.select().from(sales).where(active(sales, shopId)).all(),
      sale_items: db.select().from(sale_items).where(active(sale_items, shopId)).all(),
      purchases: db.select().from(purchases).where(active(purchases, shopId)).all(),
      purchase_items: db.select().from(purchase_items).where(active(purchase_items, shopId)).all(),
      expenses: db.select().from(expenses).where(active(expenses, shopId)).all(),
      cash_entries: db.select().from(cash_entries).where(active(cash_entries, shopId)).all(),
      online_orders: db.select().from(online_orders).where(active(online_orders, shopId)).all(),
    },
  };
  return JSON.stringify(payload, null, 2);
}

/** Soft-deletes all operational data for the shop in one transaction (keeps shop & members). */
export function resetShopData(db: AppDb, shopId: string, role: Role): number {
  if (!can(role, 'manageSettings')) {
    throw new AppError('FORBIDDEN', 'Only shop owners can reset shop data');
  }
  const shop = getShop(db, shopId);
  if (!shop) throw new AppError('NOT_FOUND', 'Shop not found');

  const at = Date.now();
  return db.transaction((tx) => {
    let total = 0;
    for (const table of RESETTABLE_TABLES) {
      const res = tx.run(
        sql`UPDATE ${table} SET deleted_at = ${at}, updated_at = ${at}, dirty = 1
            WHERE shop_id = ${shopId} AND deleted_at IS NULL`,
      ) as { changes?: number } | undefined;
      total += res?.changes ?? 0;
    }
    return total;
  });
}

export function getLastBackupAt(db: AppDb): number | null {
  const row = db.select().from(kv).where(eq(kv.key, LAST_BACKUP_KEY)).get();
  if (!row) return null;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function setLastBackupAt(db: AppDb, ts: number = Date.now()): void {
  db.insert(kv)
    .values({ key: LAST_BACKUP_KEY, value: String(ts) })
    .onConflictDoUpdate({ target: kv.key, set: { value: String(ts) } })
    .run();
}

/** Caches remote shops & memberships pulled after login using LWW (dirty=0). */
export function cacheRemoteShopsAndMembers(
  db: AppDb,
  remoteShops: Omit<Shop, 'dirty'>[],
  remoteMembers: Omit<ShopMember, 'dirty'>[],
): void {
  db.transaction((tx) => {
    for (const s of remoteShops) {
      const local = tx.select().from(shops).where(eq(shops.id, s.id)).get();
      if (!local) {
        tx.insert(shops)
          .values({
            ...s,
            shop_id: s.shop_id || s.id,
            dirty: 0,
          })
          .run();
      } else if (local.dirty === 0 || s.updated_at >= local.updated_at) {
        tx.update(shops)
          .set({
            ...s,
            shop_id: s.shop_id || s.id,
            dirty: 0,
          })
          .where(eq(shops.id, s.id))
          .run();
      }
    }

    for (const m of remoteMembers) {
      const local = tx.select().from(shop_members).where(eq(shop_members.id, m.id)).get();
      if (!local) {
        tx.insert(shop_members)
          .values({ ...m, dirty: 0 })
          .run();
      } else if (local.dirty === 0 || m.updated_at >= local.updated_at) {
        tx.update(shop_members)
          .set({ ...m, dirty: 0 })
          .where(eq(shop_members.id, m.id))
          .run();
      }
    }
  });
}
