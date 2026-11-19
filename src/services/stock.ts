import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { active } from '@/db/helpers';
import {
  categories,
  products,
  stock_movements,
  type Product,
  type Role,
  type StockMovement,
} from '@/db/schema';
import type { AppDb } from '@/db/types';
import { now } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { add, mulQty, roundQty } from '@/lib/money';
import { can } from './permissions';
import { postStock } from './posting';

export type ServiceCtx = {
  shopId: string;
  userId: string | null;
  role: Role;
};

export const adjustStockSchema = z.object({
  productId: z.string().trim().min(1, 'Product is required'),
  mode: z.enum(['delta', 'set']).default('delta'),
  qty: z.number().finite('Invalid quantity'),
  date: z.number().int().positive().optional(),
  note: z.string().trim().max(300, 'Note is too long').nullable().optional(),
  allowNegative: z.boolean().optional(),
});

export type AdjustStockInput = z.input<typeof adjustStockSchema>;

export type AdjustStockResult = {
  movementId: string | null;
  previousStock: number;
  newStock: number;
};

export type StockMovementWithProduct = StockMovement & {
  productName: string;
  productUnit: string;
};

export type ListStockMovementsFilter = {
  productId?: string;
  type?: StockMovement['type'];
  from?: number;
  to?: number;
  limit?: number;
};

export type StockItem = Product & {
  stock: number;
  /** Integer paisa at buy_price; null when viewer lacks viewCost permission. */
  stockValue: number | null;
  sellValue: number;
  isLowStock: boolean;
  isOutOfStock: boolean;
  categoryName: string | null;
};

export type StockSummary = {
  totalProducts: number;
  totalUnits: number;
  lowStockCount: number;
  outOfStockCount: number;
  /** Integer paisa at buy_price; null when viewer lacks viewCost permission. */
  totalValue: number | null;
  totalSellValue: number;
  items: StockItem[];
};

export type StockSummaryOptions = {
  role?: Role | null;
  categoryId?: string | null;
  search?: string;
  filter?: 'all' | 'low' | 'out';
};

/** Derived stock quantity for one product (sum of active stock movements, rounded 3dp). */
export function getStock(db: AppDb, shopId: string, productId: string): number {
  const row = db
    .select({ total: sql<number>`COALESCE(SUM(${stock_movements.qty}), 0)` })
    .from(stock_movements)
    .where(and(active(stock_movements, shopId), eq(stock_movements.product_id, productId)))
    .get();
  return roundQty(Number(row?.total ?? 0));
}

/** Batch derived stock map (productId -> qty) for a shop. */
export function getStockMap(
  db: AppDb,
  shopId: string,
  productIds?: readonly string[],
): Map<string, number> {
  const map = new Map<string, number>();
  if (productIds && productIds.length === 0) return map;
  const where = productIds
    ? and(active(stock_movements, shopId), inArray(stock_movements.product_id, [...productIds]))
    : active(stock_movements, shopId);
  const rows = db
    .select({
      productId: stock_movements.product_id,
      total: sql<number>`COALESCE(SUM(${stock_movements.qty}), 0)`,
    })
    .from(stock_movements)
    .where(where)
    .groupBy(stock_movements.product_id)
    .all();
  for (const r of rows) {
    map.set(r.productId, roundQty(Number(r.total ?? 0)));
  }
  return map;
}

/** Manual stock adjustment (delta +/- or set exact target). */
export function adjustStock(
  db: AppDb,
  ctx: ServiceCtx,
  raw: AdjustStockInput,
): AdjustStockResult {
  if (!can(ctx.role, 'adjustStock')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to adjust stock');
  }
  const parsed = adjustStockSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid stock adjustment');
  }
  const input = parsed.data;

  return db.transaction((tx) => {
    const prod = tx
      .select({ id: products.id })
      .from(products)
      .where(and(active(products, ctx.shopId), eq(products.id, input.productId)))
      .get();
    if (!prod) throw new AppError('NOT_FOUND', 'Product not found');

    const previousStock = getStock(tx, ctx.shopId, input.productId);
    let delta: number;
    if (input.mode === 'set') {
      const target = roundQty(input.qty);
      if (target < 0) throw new AppError('VALIDATION', 'Stock cannot be set below zero');
      delta = roundQty(target - previousStock);
    } else {
      delta = roundQty(input.qty);
      if (delta < 0 && roundQty(previousStock + delta) < 0 && !input.allowNegative) {
        throw new AppError('INSUFFICIENT_STOCK', 'Cannot remove more stock than available');
      }
    }

    if (delta === 0) {
      return { movementId: null, previousStock, newStock: previousStock };
    }

    const movementId = postStock(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      refId: null,
      productId: input.productId,
      qty: delta,
      type: 'adjust',
      date: input.date ?? now(),
      note: input.note || undefined,
    });

    return {
      movementId,
      previousStock,
      newStock: roundQty(previousStock + delta),
    };
  });
}

/** Chronological stock movement history (newest first), enriched with product name/unit. */
export function listStockMovements(
  db: AppDb,
  shopId: string,
  opts: ListStockMovementsFilter = {},
): StockMovementWithProduct[] {
  const conds = [active(stock_movements, shopId)];
  if (opts.productId) conds.push(eq(stock_movements.product_id, opts.productId));
  if (opts.type) conds.push(eq(stock_movements.type, opts.type));
  if (opts.from !== undefined) conds.push(gte(stock_movements.date, opts.from));
  if (opts.to !== undefined) conds.push(lte(stock_movements.date, opts.to));

  const baseQuery = db
    .select({
      movement: stock_movements,
      productName: products.name,
      productUnit: products.unit,
    })
    .from(stock_movements)
    .leftJoin(
      products,
      and(eq(products.id, stock_movements.product_id), eq(products.shop_id, shopId)),
    )
    .where(and(...conds))
    .orderBy(desc(stock_movements.date), desc(stock_movements.created_at));

  const rows = opts.limit ? baseQuery.limit(opts.limit).all() : baseQuery.all();

  return rows.map((r) => ({
    ...r.movement,
    qty: roundQty(r.movement.qty),
    productName: r.productName ?? 'Unknown product',
    productUnit: r.productUnit ?? 'pcs',
  }));
}

/** Shop stock valuation, low-stock counts, and filtered item list. Hides cost when role lacks viewCost. */
export function getStockSummary(
  db: AppDb,
  shopId: string,
  opts: StockSummaryOptions = {},
): StockSummary {
  const canViewCost = opts.role === undefined ? true : can(opts.role, 'viewCost');

  const prods = db.select().from(products).where(active(products, shopId)).all();
  const cats = db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(active(categories, shopId), eq(categories.kind, 'product')))
    .all();
  const catMap = new Map(cats.map((c) => [c.id, c.name]));
  const stockMap = getStockMap(db, shopId);

  let totalUnits = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let totalValuePaisa = 0;
  let totalSellValuePaisa = 0;

  const allItems: StockItem[] = prods.map((p) => {
    const stock = stockMap.get(p.id) ?? 0;
    const positiveQty = stock > 0 ? stock : 0;
    const costVal = mulQty(p.buy_price, positiveQty);
    const sellVal = mulQty(p.sell_price, positiveQty);
    const isLowStock = p.low_stock_alert > 0 && stock <= p.low_stock_alert;
    const isOutOfStock = stock <= 0;

    totalUnits = roundQty(totalUnits + positiveQty);
    if (isLowStock) lowStockCount += 1;
    if (isOutOfStock) outOfStockCount += 1;
    totalValuePaisa = add(totalValuePaisa, costVal);
    totalSellValuePaisa = add(totalSellValuePaisa, sellVal);

    return {
      ...p,
      buy_price: canViewCost ? p.buy_price : 0,
      stock,
      stockValue: canViewCost ? costVal : null,
      sellValue: sellVal,
      isLowStock,
      isOutOfStock,
      categoryName: p.category_id ? (catMap.get(p.category_id) ?? null) : null,
    };
  });

  const q = opts.search?.trim().toLowerCase() ?? '';
  const items = allItems
    .filter((item) => {
      if (opts.categoryId && item.category_id !== opts.categoryId) return false;
      if (opts.filter === 'low' && !item.isLowStock) return false;
      if (opts.filter === 'out' && !item.isOutOfStock) return false;
      if (q) {
        const match =
          item.name.toLowerCase().includes(q) ||
          (item.code?.toLowerCase().includes(q) ?? false) ||
          (item.categoryName?.toLowerCase().includes(q) ?? false);
        if (!match) return false;
      }
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    totalProducts: prods.length,
    totalUnits,
    lowStockCount,
    outOfStockCount,
    totalValue: canViewCost ? totalValuePaisa : null,
    totalSellValue: totalSellValuePaisa,
    items,
  };
}
