import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { active } from '@/db/helpers';
import {
  cash_entries,
  expenses,
  kv,
  online_orders,
  parties,
  party_ledger,
  products,
  purchases,
  sales,
  shops,
  stock_movements,
  sync_state,
  type Role,
} from '@/db/schema';
import type { AppDb } from '@/db/types';
import { endOfDay, endOfMonth, startOfDay, startOfMonth } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { formatTaka, roundQty } from '@/lib/money';
import { can } from './permissions';

export type DashboardPeriod = 'day' | 'month';

export type DashboardStats = {
  period: DashboardPeriod;
  from: number;
  to: number;
  /** Integer paisa; null when caller role lacks `viewCashbox`. */
  cashBalance: number | null;
  salesTotal: number;
  salesCount: number;
  purchasesTotal: number;
  purchasesCount: number;
  expenseTotal: number;
  expenseCount: number;
  /** Integer paisa ≥ 0: sum of positive party balances (they owe us / Given). */
  dueReceivable: number;
  /** Integer paisa ≥ 0: sum of abs(negative party balances) (we owe them / Taken). */
  duePayable: number;
  /** Total stock quantity across active products (3dp). */
  stockCount: number;
  lowStockCount: number;
  pendingOrdersCount: number;
};

export type SetupStepId =
  | 'shop_profile'
  | 'first_product'
  | 'first_contact'
  | 'first_sale'
  | 'payment_qr'
  | 'online_shop';

export type SetupStep = {
  id: SetupStepId;
  title: string;
  description: string;
  ctaLabel: string;
  route: string;
  completed: boolean;
};

export type SetupProgress = {
  completedCount: number;
  totalCount: number;
  percent: number;
  allDone: boolean;
  dismissed: boolean;
  steps: SetupStep[];
};

export type NotificationType = 'online_order' | 'low_stock';
export type NotificationSeverity = 'info' | 'warning' | 'danger';

export type NotificationItem = {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  createdAt: number;
  route: string;
  refId: string;
  read: boolean;
  dismissed: boolean;
};

const shopIdSchema = z.string().trim().min(1, 'Shop ID is required');

const statsOptsSchema = z.object({
  period: z.enum(['day', 'month']).default('day'),
  at: z.number().int().optional(),
  role: z.enum(['owner', 'manager', 'cashier']).nullable().optional(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const res = schema.safeParse(input);
  if (!res.success) {
    throw new AppError('VALIDATION', res.error.issues[0]?.message ?? 'Invalid input');
  }
  return res.data;
}

function toInt(val: unknown): number {
  const n = Number(val ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function readKv(db: AppDb, key: string): string | null {
  const row = db.select({ value: kv.value }).from(kv).where(eq(kv.key, key)).get();
  return row?.value ?? null;
}

function writeKv(db: AppDb, key: string, value: string): void {
  db.insert(kv)
    .values({ key, value })
    .onConflictDoUpdate({ target: kv.key, set: { value } })
    .run();
}

function readIdSet(db: AppDb, key: string): Set<string> {
  const raw = readKv(db, key);
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((v): v is string => typeof v === 'string'));
    }
  } catch {
    return new Set();
  }
  return new Set();
}

function writeIdSet(db: AppDb, key: string, ids: Set<string>): void {
  writeKv(db, key, JSON.stringify([...ids]));
}

function getActiveProductStockMap(db: AppDb, shopId: string): Map<string, number> {
  const rows = db
    .select({
      productId: stock_movements.product_id,
      qty: sql<number>`COALESCE(SUM(${stock_movements.qty}), 0)`,
    })
    .from(stock_movements)
    .where(active(stock_movements, shopId))
    .groupBy(stock_movements.product_id)
    .all();

  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.productId, roundQty(Number(r.qty ?? 0)));
  }
  return map;
}

/**
 * Aggregated metrics for S04 Home stats card + header badges.
 * All balances are derived directly from ledger/source tables.
 */
export function getDashboardStats(
  db: AppDb,
  shopId: string,
  opts?: { period?: DashboardPeriod; at?: number; role?: Role | null },
): DashboardStats {
  const validShopId = parseOrThrow(shopIdSchema, shopId);
  const parsed = parseOrThrow(statsOptsSchema, opts ?? {});
  const at = parsed.at ?? Date.now();
  const from = parsed.period === 'day' ? startOfDay(at) : startOfMonth(at);
  const to = parsed.period === 'day' ? endOfDay(at) : endOfMonth(at);

  const canViewCash = parsed.role ? can(parsed.role, 'viewCashbox') : true;

  let cashBalance: number | null = null;
  if (canViewCash) {
    const cashRow = db
      .select({ total: sql<number>`COALESCE(SUM(${cash_entries.amount}), 0)` })
      .from(cash_entries)
      .where(active(cash_entries, validShopId))
      .get();
    cashBalance = toInt(cashRow?.total);
  }

  const salesRow = db
    .select({
      total: sql<number>`COALESCE(SUM(${sales.total}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(sales)
    .where(and(active(sales, validShopId), gte(sales.date, from), lte(sales.date, to)))
    .get();

  const purchasesRow = db
    .select({
      total: sql<number>`COALESCE(SUM(${purchases.total}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(purchases)
    .where(and(active(purchases, validShopId), gte(purchases.date, from), lte(purchases.date, to)))
    .get();

  const expenseRow = db
    .select({
      total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(expenses)
    .where(and(active(expenses, validShopId), gte(expenses.date, from), lte(expenses.date, to)))
    .get();

  // Derive per-party net balances (excluding soft-deleted parties if party row exists)
  const deletedPartyIds = new Set(
    db
      .select({ id: parties.id })
      .from(parties)
      .where(and(eq(parties.shop_id, validShopId), sql`${parties.deleted_at} IS NOT NULL`))
      .all()
      .map((p) => p.id),
  );

  const partyBalances = db
    .select({
      partyId: party_ledger.party_id,
      balance: sql<number>`COALESCE(SUM(${party_ledger.amount}), 0)`,
    })
    .from(party_ledger)
    .where(active(party_ledger, validShopId))
    .groupBy(party_ledger.party_id)
    .all();

  let dueReceivable = 0;
  let duePayable = 0;
  for (const row of partyBalances) {
    if (deletedPartyIds.has(row.partyId)) continue;
    const bal = toInt(row.balance);
    if (bal > 0) dueReceivable += bal;
    else if (bal < 0) duePayable += Math.abs(bal);
  }

  // Stock count and low-stock alert count across active products
  const activeProducts = db
    .select({
      id: products.id,
      low_stock_alert: products.low_stock_alert,
    })
    .from(products)
    .where(active(products, validShopId))
    .all();

  const stockMap = getActiveProductStockMap(db, validShopId);
  let stockSum = 0;
  let lowStockCount = 0;
  for (const p of activeProducts) {
    const qty = stockMap.get(p.id) ?? 0;
    stockSum += qty;
    if (p.low_stock_alert > 0 && qty <= p.low_stock_alert) {
      lowStockCount += 1;
    }
  }

  const ordersRow = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(online_orders)
    .where(and(active(online_orders, validShopId), eq(online_orders.status, 'pending')))
    .get();

  return {
    period: parsed.period,
    from,
    to,
    cashBalance,
    salesTotal: toInt(salesRow?.total),
    salesCount: toInt(salesRow?.count),
    purchasesTotal: toInt(purchasesRow?.total),
    purchasesCount: toInt(purchasesRow?.count),
    expenseTotal: toInt(expenseRow?.total),
    expenseCount: toInt(expenseRow?.count),
    dueReceivable,
    duePayable,
    stockCount: roundQty(stockSum),
    lowStockCount,
    pendingOrdersCount: toInt(ordersRow?.count),
  };
}

/** Setup checklist progress shown in the S04 Home onboarding carousel. */
export function getSetupProgress(db: AppDb, shopId: string): SetupProgress {
  const validShopId = parseOrThrow(shopIdSchema, shopId);

  const shop = db
    .select()
    .from(shops)
    .where(and(eq(shops.id, validShopId), isNull(shops.deleted_at)))
    .get();

  const productCount = toInt(
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(products)
      .where(active(products, validShopId))
      .get()?.c,
  );
  const partyCount = toInt(
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(parties)
      .where(active(parties, validShopId))
      .get()?.c,
  );
  const saleCount = toInt(
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(sales)
      .where(active(sales, validShopId))
      .get()?.c,
  );

  const profileDone = Boolean(
    shop?.phone?.trim() && shop?.address?.trim() && shop?.business_type?.trim(),
  );
  const invoiceDone = Boolean(shop?.payment_qr_uri?.trim() || shop?.invoice_footer?.trim());
  const onlineDone = shop?.online_enabled === 1;

  const steps: SetupStep[] = [
    {
      id: 'shop_profile',
      title: 'Complete shop profile',
      description: 'Add phone number, address, and business type for invoices.',
      ctaLabel: profileDone ? 'Completed' : 'Edit profile',
      route: '/settings',
      completed: profileDone,
    },
    {
      id: 'first_product',
      title: 'Add your first product',
      description: 'Set buy/sell prices and opening stock to track profit automatically.',
      ctaLabel: productCount > 0 ? 'Completed' : 'Add product',
      route: '/products',
      completed: productCount > 0,
    },
    {
      id: 'first_contact',
      title: 'Add a customer or supplier',
      description: 'Keep due balances and statements organized in your ledger.',
      ctaLabel: partyCount > 0 ? 'Completed' : 'Add contact',
      route: '/contacts',
      completed: partyCount > 0,
    },
    {
      id: 'first_sale',
      title: 'Record your first sale',
      description: 'Create an invoice and update stock and cashbox in one tap.',
      ctaLabel: saleCount > 0 ? 'Completed' : 'Open Sell',
      route: '/sell',
      completed: saleCount > 0,
    },
    {
      id: 'payment_qr',
      title: 'Add payment QR or footer',
      description: 'Show bKash/Nagad QR and shop message on printed PDF invoices.',
      ctaLabel: invoiceDone ? 'Completed' : 'Configure',
      route: '/settings',
      completed: invoiceDone,
    },
    {
      id: 'online_shop',
      title: 'Launch your Online Shop',
      description: 'Share your web storefront link and receive orders directly.',
      ctaLabel: onlineDone ? 'Completed' : 'Open Online',
      route: '/(tabs)/online',
      completed: onlineDone,
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  const totalCount = steps.length;
  const percent = Math.round((completedCount / totalCount) * 100);
  const dismissed = readKv(db, `setup_dismissed:${validShopId}`) === '1';

  return {
    completedCount,
    totalCount,
    percent,
    allDone: completedCount === totalCount,
    dismissed,
    steps,
  };
}

export function dismissSetupCard(db: AppDb, shopId: string, dismissed = true): void {
  const validShopId = parseOrThrow(shopIdSchema, shopId);
  writeKv(db, `setup_dismissed:${validShopId}`, dismissed ? '1' : '0');
}

/**
 * Reads last backup / sync timestamp (epoch ms) from local `kv` (`last_backup_at`)
 * or falls back to the latest `sync_state.last_synced_at` for this shop.
 */
export function getLastBackupAt(db: AppDb, shopId: string): number | null {
  const validShopId = parseOrThrow(shopIdSchema, shopId);
  const shopScoped = readKv(db, `last_backup_at:${validShopId}`);
  const globalVal = readKv(db, 'last_backup_at');
  const kvCandidate = shopScoped ?? globalVal;
  let best: number | null = null;
  if (kvCandidate) {
    const parsed = Number(kvCandidate);
    if (Number.isFinite(parsed) && parsed > 0) best = Math.round(parsed);
  }

  const syncRow = db
    .select({ maxSynced: sql<number | null>`MAX(${sync_state.last_synced_at})` })
    .from(sync_state)
    .where(sql`${sync_state.key} LIKE ${`${validShopId}:%`}`)
    .get();
  const syncedAt = syncRow?.maxSynced ? Number(syncRow.maxSynced) : null;
  if (syncedAt && Number.isFinite(syncedAt) && (best === null || syncedAt > best)) {
    best = Math.round(syncedAt);
  }

  return best;
}

/** Counts unsynced local dirty rows across core tables for quick backup badge/status. */
export function getDirtyRecordCount(db: AppDb, shopId: string): number {
  const validShopId = parseOrThrow(shopIdSchema, shopId);
  const tables = [
    shops,
    products,
    stock_movements,
    parties,
    party_ledger,
    sales,
    purchases,
    expenses,
    cash_entries,
    online_orders,
  ] as const;
  let total = 0;
  for (const t of tables) {
    const row = db
      .select({ c: sql<number>`COUNT(*)` })
      .from(t)
      .where(and(eq(t.shop_id, validShopId), eq(t.dirty, 1)))
      .get();
    total += toInt(row?.c);
  }
  return total;
}

/**
 * Derives active notifications for S26 Notifications (pending online orders + low stock items).
 * Respects role permissions (cashiers do not receive online-shop management notifications).
 */
export function getNotifications(
  db: AppDb,
  shopId: string,
  opts?: { includeDismissed?: boolean; role?: Role | null; decimal?: boolean },
): NotificationItem[] {
  const validShopId = parseOrThrow(shopIdSchema, shopId);
  const includeDismissed = opts?.includeDismissed ?? false;
  const decimal = opts?.decimal ?? false;
  const canOnline = opts?.role ? can(opts.role, 'manageOnline') : true;
  const canStock = opts?.role ? can(opts.role, 'viewStock') : true;

  const readIds = readIdSet(db, `notif_read:${validShopId}`);
  const dismissedIds = readIdSet(db, `notif_dismissed:${validShopId}`);
  const items: NotificationItem[] = [];

  if (canOnline) {
    const pendingOrders = db
      .select()
      .from(online_orders)
      .where(and(active(online_orders, validShopId), eq(online_orders.status, 'pending')))
      .orderBy(desc(online_orders.created_at))
      .all();

    for (const o of pendingOrders) {
      const id = `order:${o.id}`;
      const dismissed = dismissedIds.has(id);
      if (dismissed && !includeDismissed) continue;
      items.push({
        id,
        type: 'online_order',
        severity: 'info',
        title: `New online order ${o.order_no}`,
        message: `${o.customer_name} · ${formatTaka(o.total, decimal)} · ${o.phone}`,
        createdAt: o.created_at,
        route: '/online/orders',
        refId: o.id,
        read: readIds.has(id),
        dismissed,
      });
    }
  }

  if (canStock) {
    const activeProducts = db
      .select()
      .from(products)
      .where(and(active(products, validShopId), sql`${products.low_stock_alert} > 0`))
      .orderBy(desc(products.updated_at))
      .all();
    const stockMap = getActiveProductStockMap(db, validShopId);

    for (const p of activeProducts) {
      const qty = stockMap.get(p.id) ?? 0;
      if (qty > p.low_stock_alert) continue;
      const id = `low_stock:${p.id}`;
      const dismissed = dismissedIds.has(id);
      if (dismissed && !includeDismissed) continue;
      const isOut = qty <= 0;
      items.push({
        id,
        type: 'low_stock',
        severity: isOut ? 'danger' : 'warning',
        title: isOut ? `Out of stock: ${p.name}` : `Low stock: ${p.name}`,
        message: `Current: ${roundQty(qty)} ${p.unit} (alert at ${roundQty(p.low_stock_alert)} ${p.unit})`,
        createdAt: p.updated_at,
        route: '/stock',
        refId: p.id,
        read: readIds.has(id),
        dismissed,
      });
    }
  }

  items.sort((a, b) => {
    if (a.read !== b.read) return a.read ? 1 : -1;
    return b.createdAt - a.createdAt;
  });

  return items;
}

export function getNotificationCount(
  db: AppDb,
  shopId: string,
  opts?: { role?: Role | null },
): number {
  return getNotifications(db, shopId, { role: opts?.role, includeDismissed: false }).filter(
    (n) => !n.read,
  ).length;
}

export function markNotificationRead(db: AppDb, shopId: string, notificationId: string): void {
  const validShopId = parseOrThrow(shopIdSchema, shopId);
  const id = parseOrThrow(z.string().min(1), notificationId);
  const readIds = readIdSet(db, `notif_read:${validShopId}`);
  readIds.add(id);
  writeIdSet(db, `notif_read:${validShopId}`, readIds);
}

export function markAllNotificationsRead(
  db: AppDb,
  shopId: string,
  opts?: { role?: Role | null },
): void {
  const validShopId = parseOrThrow(shopIdSchema, shopId);
  const current = getNotifications(db, validShopId, { role: opts?.role, includeDismissed: false });
  const readIds = readIdSet(db, `notif_read:${validShopId}`);
  for (const item of current) readIds.add(item.id);
  writeIdSet(db, `notif_read:${validShopId}`, readIds);
}

export function dismissNotification(db: AppDb, shopId: string, notificationId: string): void {
  const validShopId = parseOrThrow(shopIdSchema, shopId);
  const id = parseOrThrow(z.string().min(1), notificationId);
  const dismissedIds = readIdSet(db, `notif_dismissed:${validShopId}`);
  dismissedIds.add(id);
  writeIdSet(db, `notif_dismissed:${validShopId}`, dismissedIds);
}

export function restoreDismissedNotifications(db: AppDb, shopId: string): void {
  const validShopId = parseOrThrow(shopIdSchema, shopId);
  writeIdSet(db, `notif_dismissed:${validShopId}`, new Set());
}
