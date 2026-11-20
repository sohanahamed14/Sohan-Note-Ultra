import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { active, newRow, softDelete, touch } from '@/db/helpers';
import {
  METHODS,
  categories,
  online_orders,
  parties,
  products,
  sales,
  shops,
  stock_movements,
  type Method,
  type OnlineOrder,
  type Product,
  type Role,
  type Shop,
} from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { formatTaka, roundQty } from '@/lib/money';
import { can } from '@/services/permissions';
import { createSale, type SaleLineInput } from '@/services/sales';

export const ONLINE_THEMES = [
  {
    id: 'classic',
    name: 'Classic Gold',
    description: 'Signature warm yellow header with royal blue actions',
    primary: '#F6BE25',
    onPrimary: '#1B1B1B',
    accent: '#1A5DD6',
    bg: '#FCFCFC',
    surface: '#FFFFFF',
  },
  {
    id: 'emerald',
    name: 'Fresh Emerald',
    description: 'Clean grocery & organic look with vibrant green',
    primary: '#10B981',
    onPrimary: '#FFFFFF',
    accent: '#047857',
    bg: '#F7FBF9',
    surface: '#FFFFFF',
  },
  {
    id: 'royal',
    name: 'Royal Blue',
    description: 'Modern electronics & tech storefront palette',
    primary: '#1A5DD6',
    onPrimary: '#FFFFFF',
    accent: '#1E3A8A',
    bg: '#F8FAFC',
    surface: '#FFFFFF',
  },
  {
    id: 'coral',
    name: 'Warm Coral',
    description: 'Boutique fashion & food storefront palette',
    primary: '#F97316',
    onPrimary: '#FFFFFF',
    accent: '#C2410C',
    bg: '#FFFBF7',
    surface: '#FFFFFF',
  },
  {
    id: 'slate',
    name: 'Minimal Slate',
    description: 'Bold dark header with crisp high-contrast cards',
    primary: '#1E293B',
    onPrimary: '#FFFFFF',
    accent: '#2563EB',
    bg: '#F8FAFC',
    surface: '#FFFFFF',
  },
] as const;

export type OnlineTheme = (typeof ONLINE_THEMES)[number];
export type OnlineThemeId = OnlineTheme['id'];

export function getOnlineTheme(id: string | null | undefined): OnlineTheme {
  return ONLINE_THEMES.find((t) => t.id === id) ?? ONLINE_THEMES[0];
}

export const ORDER_STATUSES = ['pending', 'confirmed', 'delivered', 'cancelled'] as const;
export type OnlineOrderStatus = (typeof ORDER_STATUSES)[number];
export type DeliveryArea = 'inside' | 'outside';

export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
export const BD_PHONE_REGEX = /^01[0-9]{9}$/;

export function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeBdPhone(raw: string): string {
  const cleaned = raw.replace(/[\s-]/g, '');
  return cleaned.replace(/^(\+?88)/, '');
}

export function buildStorefrontUrl(slug: string, baseUrl?: string): string {
  const envBase =
    baseUrl ??
    process.env.EXPO_PUBLIC_STOREFRONT_URL ??
    (typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://sohannote.app');
  return `${envBase.replace(/\/+$/, '')}/s/${encodeURIComponent(slug)}`;
}

export const OnlineOrderItemSchema = z.object({
  product_id: z.string().min(1),
  name: z.string().min(1),
  qty: z.number().positive(),
  unit_price: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export type OnlineOrderItem = z.infer<typeof OnlineOrderItemSchema>;

export function parseOrderItems(itemsJson: string): OnlineOrderItem[] {
  try {
    const raw: unknown = JSON.parse(itemsJson);
    const parsed = z.array(OnlineOrderItemSchema).safeParse(raw);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function buildOrderWhatsAppUrl(p: {
  shopPhone: string | null;
  shopName: string;
  orderNo: string;
  customerName: string;
  phone: string;
  address: string;
  area: DeliveryArea;
  items: OnlineOrderItem[];
  subtotal: number;
  deliveryCharge: number;
  total: number;
  note?: string | null;
}): string {
  const lines = [
    `New Order ${p.orderNo} - ${p.shopName}`,
    '',
    ...p.items.map(
      (i) => `- ${i.name} x ${i.qty} = ${formatTaka(i.total)}`,
    ),
    '',
    `Subtotal: ${formatTaka(p.subtotal)}`,
    `Delivery (${p.area === 'outside' ? 'Outside city' : 'Inside city'}): ${p.deliveryCharge === 0 ? 'Free' : formatTaka(p.deliveryCharge)}`,
    `Total: ${formatTaka(p.total)}`,
    '',
    `Customer: ${p.customerName}`,
    `Phone: ${p.phone}`,
    `Address: ${p.address}`,
    ...(p.note ? [`Note: ${p.note}`] : []),
  ];
  const encoded = encodeURIComponent(lines.join('\n'));
  const shopDigits = p.shopPhone ? normalizeBdPhone(p.shopPhone).replace(/\D/g, '') : '';
  const waNumber = BD_PHONE_REGEX.test(shopDigits) ? `88${shopDigits}` : shopDigits;
  return waNumber ? `https://wa.me/${waNumber}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

export type OnlineStats = {
  activeOrders: number;
  pendingOrders: number;
  onlineProducts: number;
  featuredProducts: number;
  earned: number;
  visits: number;
  onlineEnabled: boolean;
  slug: string | null;
};

export function getOnlineStats(db: AppDb, shopId: string): OnlineStats {
  const shop = db
    .select()
    .from(shops)
    .where(and(eq(shops.id, shopId), isNull(shops.deleted_at)))
    .get();
  if (!shop) throw new AppError('NOT_FOUND', 'Shop not found');

  const orderAgg = db.get<{ active: number; pending: number; earned: number }>(
    sql`SELECT
          COALESCE(SUM(CASE WHEN status IN ('pending', 'confirmed') THEN 1 ELSE 0 END), 0) AS active,
          COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
          COALESCE(SUM(CASE WHEN status = 'delivered' THEN total ELSE 0 END), 0) AS earned
        FROM ${online_orders}
        WHERE shop_id = ${shopId} AND deleted_at IS NULL`,
  );

  const prodAgg = db.get<{ online: number; featured: number }>(
    sql`SELECT
          COALESCE(SUM(CASE WHEN online_visible = 1 THEN 1 ELSE 0 END), 0) AS online,
          COALESCE(SUM(CASE WHEN online_visible = 1 AND featured = 1 THEN 1 ELSE 0 END), 0) AS featured
        FROM ${products}
        WHERE shop_id = ${shopId} AND deleted_at IS NULL`,
  );

  return {
    activeOrders: Number(orderAgg?.active ?? 0),
    pendingOrders: Number(orderAgg?.pending ?? 0),
    onlineProducts: Number(prodAgg?.online ?? 0),
    featuredProducts: Number(prodAgg?.featured ?? 0),
    earned: Number(orderAgg?.earned ?? 0),
    visits: Number(shop.online_visits ?? 0),
    onlineEnabled: shop.online_enabled === 1,
    slug: shop.slug ?? null,
  };
}

function assertManageOnline(role: Role): void {
  if (!can(role, 'manageOnline')) {
    throw new AppError('FORBIDDEN', 'Only owners and managers can manage the online shop');
  }
}

function getActiveShop(db: AppDb, shopId: string): Shop {
  const shop = db
    .select()
    .from(shops)
    .where(and(eq(shops.id, shopId), isNull(shops.deleted_at)))
    .get();
  if (!shop) throw new AppError('NOT_FOUND', 'Shop not found');
  return shop;
}

const StoreSettingsSchema = z.object({
  shopId: z.string().min(1),
  role: z.enum(['owner', 'manager', 'cashier']),
  name: z.string().trim().min(1, 'Shop name is required').max(120).optional(),
  slug: z.string().max(60).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  business_type: z.string().trim().max(80).nullable().optional(),
  logo_uri: z.string().max(500).nullable().optional(),
  online_enabled: z.boolean().optional(),
});

export type UpdateStoreSettingsInput = z.infer<typeof StoreSettingsSchema>;

export function updateStoreSettings(db: AppDb, input: UpdateStoreSettingsInput): Shop {
  const parsed = StoreSettingsSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid store settings');
  }
  const p = parsed.data;
  assertManageOnline(p.role);
  const current = getActiveShop(db, p.shopId);

  let nextSlug = current.slug;
  if (p.slug !== undefined) {
    if (p.slug === null || p.slug.trim() === '') {
      nextSlug = null;
    } else {
      const normalized = normalizeSlug(p.slug);
      if (!SLUG_REGEX.test(normalized)) {
        throw new AppError(
          'VALIDATION',
          'Store link must be 3-50 characters using lowercase letters, numbers, and hyphens',
        );
      }
      // Check local uniqueness against other active shops.
      const clash = db.get<{ id: string } | undefined>(
        sql`SELECT id FROM ${shops} WHERE lower(slug) = ${normalized} AND id <> ${p.shopId} AND deleted_at IS NULL`,
      );
      if (clash) {
        throw new AppError('CONFLICT', 'This store link is already used by another shop');
      }
      nextSlug = normalized;
    }
  }

  const nextEnabled =
    p.online_enabled !== undefined ? (p.online_enabled ? 1 : 0) : current.online_enabled;
  if (nextEnabled === 1 && !nextSlug) {
    throw new AppError('VALIDATION', 'Set a store link (slug) before enabling your online shop');
  }

  const patch: Partial<typeof shops.$inferInsert> = {
    ...touch(),
    slug: nextSlug,
    online_enabled: nextEnabled,
  };
  if (p.name !== undefined) patch.name = p.name;
  if (p.phone !== undefined) patch.phone = p.phone || null;
  if (p.address !== undefined) patch.address = p.address || null;
  if (p.business_type !== undefined) patch.business_type = p.business_type || null;
  if (p.logo_uri !== undefined) patch.logo_uri = p.logo_uri || null;

  db.update(shops).set(patch).where(eq(shops.id, p.shopId)).run();
  return getActiveShop(db, p.shopId);
}

const DeliveryChargesSchema = z.object({
  shopId: z.string().min(1),
  role: z.enum(['owner', 'manager', 'cashier']),
  delivery_inside: z.number().int().min(0, 'Delivery charge cannot be negative'),
  delivery_outside: z.number().int().min(0, 'Delivery charge cannot be negative'),
});

export function updateDeliveryCharges(
  db: AppDb,
  input: z.infer<typeof DeliveryChargesSchema>,
): Shop {
  const parsed = DeliveryChargesSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid delivery charges');
  }
  const p = parsed.data;
  assertManageOnline(p.role);
  getActiveShop(db, p.shopId);
  db.update(shops)
    .set({
      ...touch(),
      delivery_inside: p.delivery_inside,
      delivery_outside: p.delivery_outside,
    })
    .where(eq(shops.id, p.shopId))
    .run();
  return getActiveShop(db, p.shopId);
}

const ShopPolicySchema = z.object({
  shopId: z.string().min(1),
  role: z.enum(['owner', 'manager', 'cashier']),
  shop_policy: z.string().max(5000, 'Policy must be under 5000 characters').nullable(),
});

export function updateShopPolicy(db: AppDb, input: z.infer<typeof ShopPolicySchema>): Shop {
  const parsed = ShopPolicySchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid shop policy');
  }
  const p = parsed.data;
  assertManageOnline(p.role);
  getActiveShop(db, p.shopId);
  const cleaned = p.shop_policy?.trim() ? p.shop_policy.trim() : null;
  db.update(shops)
    .set({ ...touch(), shop_policy: cleaned })
    .where(eq(shops.id, p.shopId))
    .run();
  return getActiveShop(db, p.shopId);
}

const THEME_IDS = ONLINE_THEMES.map((t) => t.id) as [OnlineThemeId, ...OnlineThemeId[]];
const OnlineThemeSchema = z.object({
  shopId: z.string().min(1),
  role: z.enum(['owner', 'manager', 'cashier']),
  online_theme: z.enum(THEME_IDS),
});

export function updateOnlineTheme(db: AppDb, input: z.infer<typeof OnlineThemeSchema>): Shop {
  const parsed = OnlineThemeSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('VALIDATION', 'Invalid storefront theme');
  }
  const p = parsed.data;
  assertManageOnline(p.role);
  getActiveShop(db, p.shopId);
  db.update(shops)
    .set({ ...touch(), online_theme: p.online_theme })
    .where(eq(shops.id, p.shopId))
    .run();
  return getActiveShop(db, p.shopId);
}

export type OnlineProductRow = Product & {
  category_name: string | null;
  stock: number;
};

export function listOnlineProducts(
  db: AppDb,
  shopId: string,
  opts: { search?: string; filter?: 'all' | 'online' | 'hidden' | 'featured' } = {},
): OnlineProductRow[] {
  const rows = db.all<OnlineProductRow>(sql`
    SELECT
      p.*,
      c.name AS category_name,
      COALESCE((
        SELECT SUM(sm.qty)
        FROM ${stock_movements} sm
        WHERE sm.shop_id = p.shop_id
          AND sm.product_id = p.id
          AND sm.deleted_at IS NULL
      ), 0) AS stock
    FROM ${products} p
    LEFT JOIN ${categories} c
      ON c.id = p.category_id AND c.shop_id = p.shop_id AND c.deleted_at IS NULL
    WHERE p.shop_id = ${shopId} AND p.deleted_at IS NULL
    ORDER BY p.featured DESC, p.online_visible DESC, p.name ASC
  `);

  const q = opts.search?.trim().toLowerCase() ?? '';
  return rows
    .map((r) => ({ ...r, stock: roundQty(Number(r.stock ?? 0)) }))
    .filter((r) => {
      if (opts.filter === 'online' && r.online_visible !== 1) return false;
      if (opts.filter === 'hidden' && r.online_visible !== 0) return false;
      if (opts.filter === 'featured' && !(r.online_visible === 1 && r.featured === 1)) return false;
      if (q) {
        const hay = `${r.name} ${r.code ?? ''} ${r.category_name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
}

export function setProductOnlineVisibility(
  db: AppDb,
  p: { shopId: string; role: Role; productId: string; online_visible: boolean },
): Product {
  assertManageOnline(p.role);
  const existing = db
    .select()
    .from(products)
    .where(and(active(products, p.shopId), eq(products.id, p.productId)))
    .get();
  if (!existing) throw new AppError('NOT_FOUND', 'Product not found');

  db.update(products)
    .set({
      ...touch(),
      online_visible: p.online_visible ? 1 : 0,
      featured: p.online_visible ? existing.featured : 0,
    })
    .where(and(eq(products.id, p.productId), eq(products.shop_id, p.shopId)))
    .run();

  return db.select().from(products).where(eq(products.id, p.productId)).get()!;
}

export function setProductFeatured(
  db: AppDb,
  p: { shopId: string; role: Role; productId: string; featured: boolean },
): Product {
  assertManageOnline(p.role);
  const existing = db
    .select()
    .from(products)
    .where(and(active(products, p.shopId), eq(products.id, p.productId)))
    .get();
  if (!existing) throw new AppError('NOT_FOUND', 'Product not found');

  db.update(products)
    .set({
      ...touch(),
      featured: p.featured ? 1 : 0,
      online_visible: p.featured ? 1 : existing.online_visible,
    })
    .where(and(eq(products.id, p.productId), eq(products.shop_id, p.shopId)))
    .run();

  return db.select().from(products).where(eq(products.id, p.productId)).get()!;
}

export function listOnlineOrders(
  db: AppDb,
  shopId: string,
  opts: { status?: OnlineOrderStatus | 'all'; search?: string } = {},
): OnlineOrder[] {
  const rows = db
    .select()
    .from(online_orders)
    .where(active(online_orders, shopId))
    .orderBy(desc(online_orders.created_at))
    .all();

  const q = opts.search?.trim().toLowerCase() ?? '';
  return rows.filter((r) => {
    if (opts.status && opts.status !== 'all' && r.status !== opts.status) return false;
    if (q) {
      const hay = `${r.order_no} ${r.customer_name} ${r.phone} ${r.address}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function getOnlineOrder(db: AppDb, shopId: string, orderId: string): OnlineOrder {
  const order = db
    .select()
    .from(online_orders)
    .where(and(active(online_orders, shopId), eq(online_orders.id, orderId)))
    .get();
  if (!order) throw new AppError('NOT_FOUND', 'Online order not found');
  return order;
}

const ALLOWED_TRANSITIONS: Record<OnlineOrderStatus, readonly OnlineOrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: ['pending'],
};

export function updateOnlineOrderStatus(
  db: AppDb,
  p: { shopId: string; role: Role; orderId: string; status: OnlineOrderStatus },
): OnlineOrder {
  assertManageOnline(p.role);
  const order = getOnlineOrder(db, p.shopId, p.orderId);
  if (order.status === p.status) return order;
  if (!ALLOWED_TRANSITIONS[order.status].includes(p.status)) {
    throw new AppError(
      'CONFLICT',
      `Cannot change order status from ${order.status} to ${p.status}`,
    );
  }
  if (p.status === 'cancelled' && order.sale_id) {
    throw new AppError(
      'CONFLICT',
      'Order is already linked to a sale. Delete the sale first before cancelling.',
    );
  }
  db.update(online_orders)
    .set({ ...touch(), status: p.status })
    .where(and(eq(online_orders.id, p.orderId), eq(online_orders.shop_id, p.shopId)))
    .run();
  return getOnlineOrder(db, p.shopId, p.orderId);
}

export function deleteOnlineOrder(
  db: AppDb,
  p: { shopId: string; role: Role; orderId: string },
): void {
  if (!can(p.role, 'delete')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to delete orders');
  }
  const order = getOnlineOrder(db, p.shopId, p.orderId);
  if (order.sale_id) {
    const linkedSale = db
      .select({ id: sales.id })
      .from(sales)
      .where(and(active(sales, p.shopId), eq(sales.id, order.sale_id)))
      .get();
    if (linkedSale) {
      throw new AppError('CONFLICT', 'Delete the converted sale before deleting this order');
    }
  }
  softDelete(db, online_orders, p.shopId, p.orderId);
}

const ConvertToSaleSchema = z.object({
  shopId: z.string().min(1),
  userId: z.string().nullable(),
  role: z.enum(['owner', 'manager', 'cashier']),
  orderId: z.string().min(1),
  paid: z.number().int().min(0, 'Paid amount cannot be negative').optional(),
  method: z.enum(METHODS).default('cash'),
  date: z.number().int().positive().optional(),
  note: z.string().max(300).optional(),
});

export type ConvertOrderToSaleInput = z.input<typeof ConvertToSaleSchema>;

/**
 * Convert an online order into a real POS/online sale in ONE transaction:
 * - Creates or links customer party (by phone)
 * - Calls `createSale` from `src/services/sales.ts` (`kind: 'online'`, buy_price & warranty snapshots, stock−, cash+, ledger+)
 * - Links `online_orders.sale_id` and moves pending orders to confirmed
 */
export function convertOrderToSale(
  db: AppDb,
  input: ConvertOrderToSaleInput,
): { order: OnlineOrder; saleId: string; invoiceNo: string } {
  const parsed = ConvertToSaleSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid conversion input');
  }
  const p = parsed.data;
  assertManageOnline(p.role);
  if (!can(p.role, 'sell')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to record sales');
  }

  const order = getOnlineOrder(db, p.shopId, p.orderId);
  if (order.status === 'cancelled') {
    throw new AppError('CONFLICT', 'Cancelled orders cannot be converted to a sale');
  }
  if (order.sale_id) {
    throw new AppError('CONFLICT', 'This order has already been converted to a sale');
  }

  const items = parseOrderItems(order.items_json);
  if (items.length === 0) {
    throw new AppError('VALIDATION', 'Order has no valid items');
  }

  const total = order.total;
  const paid = p.paid ?? total;
  if (paid > total) {
    throw new AppError('OVERPAY', 'Paid amount cannot exceed order total');
  }
  const saleDate = p.date ?? Date.now();
  const method: Method = p.method;

  let saleId = '';
  let invoiceNo = '';

  db.transaction((tx) => {
    const normalizedPhone = normalizeBdPhone(order.phone);
    let party = tx
      .select()
      .from(parties)
      .where(
        and(
          active(parties, p.shopId),
          eq(parties.type, 'customer'),
          eq(parties.phone, normalizedPhone),
        ),
      )
      .get();

    if (!party) {
      const partyRow = newRow(p.shopId, p.userId, saleDate);
      tx.insert(parties)
        .values({
          ...partyRow,
          type: 'customer',
          name: order.customer_name,
          phone: normalizedPhone,
          address: order.address,
          note: 'Online shop customer',
        })
        .run();
      party = tx.select().from(parties).where(eq(parties.id, partyRow.id)).get()!;
    }

    const noteParts = [`Online order ${order.order_no}`];
    if (order.note) noteParts.push(order.note);
    if (p.note?.trim()) noteParts.push(p.note.trim());

    const saleLines: SaleLineInput[] = items.map((item) => {
      const prod = tx
        .select()
        .from(products)
        .where(and(active(products, p.shopId), eq(products.id, item.product_id)))
        .get();
      return {
        productId: prod ? prod.id : null,
        name: item.name,
        qty: roundQty(item.qty),
        unitPrice: item.unit_price,
        buyPrice: prod?.buy_price ?? 0,
        warrantyDays: prod?.warranty_days ?? 0,
      };
    });

    if (order.delivery_charge > 0) {
      saleLines.push({
        productId: null,
        name: 'Delivery charge',
        qty: 1,
        unitPrice: order.delivery_charge,
        buyPrice: 0,
        warrantyDays: 0,
      });
    }

    const detail = createSale(
      tx,
      { shopId: p.shopId, userId: p.userId, role: p.role },
      {
        kind: 'online',
        partyId: party.id,
        date: saleDate,
        items: saleLines,
        discountType: 'amount',
        discountValue: 0,
        vatPercent: 0,
        paid,
        method,
        note: noteParts.join(' · '),
        allowNegativeStock: true,
      },
    );

    saleId = detail.sale.id;
    invoiceNo = detail.sale.invoice_no;

    const nextStatus: OnlineOrderStatus =
      order.status === 'pending' ? 'confirmed' : order.status;
    tx.update(online_orders)
      .set({ ...touch(saleDate), sale_id: saleId, status: nextStatus })
      .where(and(eq(online_orders.id, p.orderId), eq(online_orders.shop_id, p.shopId)))
      .run();
  });

  return {
    order: getOnlineOrder(db, p.shopId, p.orderId),
    saleId,
    invoiceNo,
  };
}

// ============================================================================
// Public Storefront (anon RPCs — S24 /s/[slug])
// ============================================================================

export type PublicShopInfo = {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  address: string | null;
  business_type: string | null;
  logo_uri: string | null;
  online_theme: string | null;
  delivery_inside: number;
  delivery_outside: number;
  shop_policy: string | null;
};

export type PublicProduct = {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  unit: string | null;
  sell_price: number;
  image_uri: string | null;
  description: string | null;
  featured: number;
  in_stock: boolean;
};

export type PublicShopPayload = {
  shop: PublicShopInfo;
  products: PublicProduct[];
};

export interface PublicRpcClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
}

async function defaultRpcClient(): Promise<PublicRpcClient> {
  const { isSupabaseConfigured, supabase } = await import('@/lib/supabase');
  if (!isSupabaseConfigured) {
    throw new AppError('NETWORK', 'Storefront service is not configured');
  }
  return {
    async rpc(fn: string, args?: Record<string, unknown>) {
      const { data, error } = await supabase.rpc(fn, args);
      return {
        data,
        error: error ? { message: error.message, code: error.code } : null,
      };
    },
  };
}

export const PlacePublicOrderSchema = z.object({
  slug: z.string().trim().min(1, 'Shop link is missing'),
  customerName: z.string().trim().min(1, 'Enter your name').max(100, 'Name is too long'),
  phone: z
    .string()
    .transform((v) => normalizeBdPhone(v))
    .refine((v) => BD_PHONE_REGEX.test(v), 'Enter a valid BD mobile number (01XXXXXXXXX)'),
  address: z
    .string()
    .trim()
    .min(5, 'Enter your full delivery address (at least 5 characters)')
    .max(300, 'Address is too long'),
  area: z.enum(['inside', 'outside']).default('inside'),
  note: z.string().trim().max(300, 'Note is too long').nullable().optional(),
  items: z
    .array(
      z.object({
        product_id: z.string().min(1),
        qty: z.number().positive().max(100000),
      }),
    )
    .min(1, 'Add at least one item to your cart')
    .max(20, 'Maximum 20 different items per order')
    .refine(
      (items) => new Set(items.map((i) => i.product_id)).size === items.length,
      'Duplicate item in cart',
    ),
});

export type PlacePublicOrderInput = z.input<typeof PlacePublicOrderSchema>;

const PUBLIC_ORDER_ERROR_MAP: Record<string, [AppError['code'], string]> = {
  shop_unavailable: ['NOT_FOUND', 'This online shop is currently unavailable'],
  invalid_name: ['VALIDATION', 'Please enter a valid name'],
  invalid_phone: ['VALIDATION', 'Enter a valid Bangladesh phone number (01XXXXXXXXX)'],
  invalid_address: ['VALIDATION', 'Enter a complete delivery address (at least 5 characters)'],
  invalid_note: ['VALIDATION', 'Order note is too long (max 300 characters)'],
  invalid_items: ['VALIDATION', 'Your cart must contain 1 to 20 items'],
  invalid_qty: ['VALIDATION', 'Invalid item quantity'],
  invalid_product: ['NOT_FOUND', 'One or more products are no longer available'],
  duplicate_item: ['VALIDATION', 'Duplicate item in cart'],
  invalid_area: ['VALIDATION', 'Select Inside or Outside delivery area'],
  rate_limited: ['CONFLICT', 'Too many pending orders from this number. Please try again later.'],
};

function mapRpcError(message: string): AppError {
  for (const [key, [code, friendly]] of Object.entries(PUBLIC_ORDER_ERROR_MAP)) {
    if (message.includes(key)) return new AppError(code, friendly);
  }
  return new AppError('NETWORK', message || 'Could not complete request');
}

export async function fetchPublicShop(
  slug: string,
  client?: PublicRpcClient,
): Promise<PublicShopPayload | null> {
  const clean = slug.trim().toLowerCase();
  if (!clean) return null;
  const rpc = client ?? (await defaultRpcClient());
  const { data, error } = await rpc.rpc('get_public_shop', { p_slug: clean });
  if (error) {
    throw new AppError('NETWORK', error.message || 'Could not load shop');
  }
  if (!data || typeof data !== 'object') return null;
  const payload = data as PublicShopPayload;
  return {
    shop: {
      ...payload.shop,
      delivery_inside: Number(payload.shop.delivery_inside ?? 0),
      delivery_outside: Number(payload.shop.delivery_outside ?? 0),
    },
    products: (payload.products ?? []).map((pr) => ({
      ...pr,
      sell_price: Number(pr.sell_price ?? 0),
      featured: Number(pr.featured ?? 0),
      in_stock: Boolean(pr.in_stock),
    })),
  };
}

export async function recordPublicShopVisit(
  slug: string,
  client?: PublicRpcClient,
): Promise<void> {
  const clean = slug.trim().toLowerCase();
  if (!clean) return;
  try {
    const rpc = client ?? (await defaultRpcClient());
    await rpc.rpc('record_shop_visit', { p_slug: clean });
  } catch {
    // Visit tracking is best-effort and never blocks storefront browsing.
  }
}

export async function placePublicOrder(
  input: PlacePublicOrderInput,
  client?: PublicRpcClient,
): Promise<{ order_no: string; total: number }> {
  const parsed = PlacePublicOrderSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid order details');
  }
  const v = parsed.data;
  const rpc = client ?? (await defaultRpcClient());
  const { data, error } = await rpc.rpc('place_online_order', {
    p_slug: v.slug.toLowerCase(),
    p_customer_name: v.customerName,
    p_phone: v.phone,
    p_address: v.address,
    p_items: v.items.map((i) => ({ product_id: i.product_id, qty: roundQty(i.qty) })),
    p_area: v.area,
    p_note: v.note ? v.note : null,
  });
  if (error) {
    throw mapRpcError(error.message);
  }
  if (!data || typeof data !== 'object' || !('order_no' in data)) {
    throw new AppError('UNKNOWN', 'Unexpected response when placing order');
  }
  const res = data as { order_no: string; total: number };
  return { order_no: String(res.order_no), total: Number(res.total) };
}
