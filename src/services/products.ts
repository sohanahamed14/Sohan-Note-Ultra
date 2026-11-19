import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { active, newRow, touch } from '@/db/helpers';
import { categories, products, type Category, type Product } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { mulQty, roundQty } from '@/lib/money';
import { can } from './permissions';
import { postStock, restoreWithRefs, softDeleteWithRefs } from './posting';
import { getStock, getStockMap, type ServiceCtx } from './stock';

export { getStock, getStockMap, type ServiceCtx };

const paisaSchema = z
  .number()
  .int('Amount must be whole paisa')
  .min(0, 'Amount cannot be negative')
  .refine(Number.isSafeInteger, 'Amount out of range');

const flagSchema = z
  .union([z.boolean(), z.literal(0), z.literal(1)])
  .transform((v): 0 | 1 => (v === true || v === 1 ? 1 : 0));

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));

export const createProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required').max(120, 'Name is too long'),
  category_id: optionalTrimmed(64),
  unit: z
    .string()
    .trim()
    .min(1, 'Unit is required')
    .max(24, 'Unit is too long')
    .default('pcs'),
  code: optionalTrimmed(64),
  buy_price: paisaSchema.default(0),
  sell_price: paisaSchema.default(0),
  wholesale_price: paisaSchema.default(0),
  opening_stock: z
    .number()
    .finite('Invalid opening stock')
    .min(0, 'Opening stock cannot be negative')
    .default(0),
  low_stock_alert: z
    .number()
    .finite('Invalid low-stock alert')
    .min(0, 'Low-stock alert cannot be negative')
    .default(0),
  warranty_days: z
    .number()
    .int('Warranty days must be a whole number')
    .min(0, 'Warranty days cannot be negative')
    .max(36500, 'Warranty days is too large')
    .default(0),
  image_uri: optionalTrimmed(1024),
  description: optionalTrimmed(1000),
  online_visible: flagSchema.default(0),
  featured: flagSchema.default(0),
});

export const updateProductSchema = createProductSchema.omit({ opening_stock: true }).partial();

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(60, 'Category name is too long'),
});

export type CreateProductInput = z.input<typeof createProductSchema>;
export type UpdateProductInput = z.input<typeof updateProductSchema>;

export type ProductWithStock = Product & {
  stock: number;
  /** Integer paisa = buy_price * max(0, stock). Hide in UI when !can(role, 'viewCost'). */
  stockValue: number;
  isLowStock: boolean;
  categoryName: string | null;
};

export type ListProductsFilter = {
  search?: string;
  categoryId?: string | null;
  lowStockOnly?: boolean;
  onlineOnly?: boolean;
  featuredOnly?: boolean;
};

function enrichProduct(
  p: Product,
  stock: number,
  categoryName: string | null,
): ProductWithStock {
  const positiveQty = stock > 0 ? stock : 0;
  return {
    ...p,
    stock,
    stockValue: mulQty(p.buy_price, positiveQty),
    isLowStock: p.low_stock_alert > 0 && stock <= p.low_stock_alert,
    categoryName,
  };
}

/** Active product categories sorted alphabetically. */
export function listProductCategories(db: AppDb, shopId: string): Category[] {
  return db
    .select()
    .from(categories)
    .where(and(active(categories, shopId), eq(categories.kind, 'product')))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Quick-create a product category (owner/manager). */
export function createProductCategory(db: AppDb, ctx: ServiceCtx, rawName: string): Category {
  if (!can(ctx.role, 'manageProducts')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to manage categories');
  }
  const parsed = createCategorySchema.safeParse({ name: rawName });
  if (!parsed.success) {
    throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid category name');
  }
  const name = parsed.data.name;
  const existing = listProductCategories(db, ctx.shopId).find(
    (c) => c.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) {
    throw new AppError('CONFLICT', 'Category already exists');
  }
  const row = {
    ...newRow(ctx.shopId, ctx.userId),
    name,
    kind: 'product' as const,
  };
  db.insert(categories).values(row).run();
  return row;
}

/** Lists active products with derived stock, stockValue, low-stock flag, and category name. */
export function listProductsWithStock(
  db: AppDb,
  shopId: string,
  filter: ListProductsFilter = {},
): ProductWithStock[] {
  const prods = db.select().from(products).where(active(products, shopId)).all();
  const cats = listProductCategories(db, shopId);
  const catMap = new Map(cats.map((c) => [c.id, c.name]));
  const stockMap = getStockMap(db, shopId);

  const q = filter.search?.trim().toLowerCase() ?? '';
  return prods
    .map((p) =>
      enrichProduct(
        p,
        stockMap.get(p.id) ?? 0,
        p.category_id ? (catMap.get(p.category_id) ?? null) : null,
      ),
    )
    .filter((p) => {
      if (filter.categoryId && p.category_id !== filter.categoryId) return false;
      if (filter.lowStockOnly && !p.isLowStock) return false;
      if (filter.onlineOnly && p.online_visible !== 1) return false;
      if (filter.featuredOnly && p.featured !== 1) return false;
      if (q) {
        const hit =
          p.name.toLowerCase().includes(q) ||
          (p.code?.toLowerCase().includes(q) ?? false) ||
          (p.categoryName?.toLowerCase().includes(q) ?? false);
        if (!hit) return false;
      }
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Fetches one active product with derived stock, or null if missing/deleted. */
export function getProductById(db: AppDb, shopId: string, id: string): ProductWithStock | null {
  const prod = db
    .select()
    .from(products)
    .where(and(active(products, shopId), eq(products.id, id)))
    .get();
  if (!prod) return null;
  let categoryName: string | null = null;
  if (prod.category_id) {
    const cat = db
      .select({ name: categories.name })
      .from(categories)
      .where(and(active(categories, shopId), eq(categories.id, prod.category_id)))
      .get();
    categoryName = cat?.name ?? null;
  }
  const stock = getStock(db, shopId, prod.id);
  return enrichProduct(prod, stock, categoryName);
}

/** Creates a product and optional opening stock movement in one transaction. */
export function createProduct(
  db: AppDb,
  ctx: ServiceCtx,
  raw: CreateProductInput,
): ProductWithStock {
  if (!can(ctx.role, 'manageProducts')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to add products');
  }
  const parsed = createProductSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid product');
  }
  const data = parsed.data;
  const openingStock = roundQty(data.opening_stock);
  const lowStockAlert = roundQty(data.low_stock_alert);

  const createdId = db.transaction((tx) => {
    if (data.category_id) {
      const cat = tx
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            active(categories, ctx.shopId),
            eq(categories.id, data.category_id),
            eq(categories.kind, 'product'),
          ),
        )
        .get();
      if (!cat) throw new AppError('NOT_FOUND', 'Category not found');
    }

    const base = newRow(ctx.shopId, ctx.userId);
    tx.insert(products)
      .values({
        ...base,
        name: data.name,
        category_id: data.category_id,
        unit: data.unit,
        code: data.code,
        buy_price: data.buy_price,
        sell_price: data.sell_price,
        wholesale_price: data.wholesale_price,
        low_stock_alert: lowStockAlert,
        warranty_days: data.warranty_days,
        image_uri: data.image_uri,
        description: data.description,
        online_visible: data.online_visible,
        featured: data.featured,
      })
      .run();

    if (openingStock > 0) {
      postStock(tx, {
        shopId: ctx.shopId,
        userId: ctx.userId,
        refId: base.id,
        date: base.created_at,
        productId: base.id,
        qty: openingStock,
        type: 'opening',
        note: 'Opening stock',
      });
    }
    return base.id;
  });

  const created = getProductById(db, ctx.shopId, createdId);
  if (!created) throw new AppError('UNKNOWN', 'Failed to load created product');
  return created;
}

/** Updates an existing active product. */
export function updateProduct(
  db: AppDb,
  ctx: ServiceCtx,
  id: string,
  raw: UpdateProductInput,
): ProductWithStock {
  if (!can(ctx.role, 'manageProducts')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to edit products');
  }
  const parsed = updateProductSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid product');
  }
  const data = parsed.data;

  db.transaction((tx) => {
    const existing = tx
      .select({ id: products.id })
      .from(products)
      .where(and(active(products, ctx.shopId), eq(products.id, id)))
      .get();
    if (!existing) throw new AppError('NOT_FOUND', 'Product not found');

    if (data.category_id) {
      const cat = tx
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            active(categories, ctx.shopId),
            eq(categories.id, data.category_id),
            eq(categories.kind, 'product'),
          ),
        )
        .get();
      if (!cat) throw new AppError('NOT_FOUND', 'Category not found');
    }

    const patch: Partial<typeof products.$inferInsert> = { ...touch() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.category_id !== undefined) patch.category_id = data.category_id;
    if (data.unit !== undefined) patch.unit = data.unit;
    if (data.code !== undefined) patch.code = data.code;
    if (data.buy_price !== undefined) patch.buy_price = data.buy_price;
    if (data.sell_price !== undefined) patch.sell_price = data.sell_price;
    if (data.wholesale_price !== undefined) patch.wholesale_price = data.wholesale_price;
    if (data.low_stock_alert !== undefined) patch.low_stock_alert = roundQty(data.low_stock_alert);
    if (data.warranty_days !== undefined) patch.warranty_days = data.warranty_days;
    if (data.image_uri !== undefined) patch.image_uri = data.image_uri;
    if (data.description !== undefined) patch.description = data.description;
    if (data.online_visible !== undefined) patch.online_visible = data.online_visible;
    if (data.featured !== undefined) patch.featured = data.featured;

    tx.update(products)
      .set(patch)
      .where(and(active(products, ctx.shopId), eq(products.id, id)))
      .run();
  });

  const updated = getProductById(db, ctx.shopId, id);
  if (!updated) throw new AppError('NOT_FOUND', 'Product not found');
  return updated;
}

/** Soft-deletes a product and its ref-linked opening stock (moves to recycle bin). */
export function deleteProduct(db: AppDb, ctx: ServiceCtx, id: string): void {
  if (!can(ctx.role, 'delete')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to delete products');
  }
  db.transaction((tx) => {
    softDeleteWithRefs(tx, { shopId: ctx.shopId, table: products, id });
  });
}

/** Restores a soft-deleted product and its ref-linked opening stock. */
export function restoreProduct(db: AppDb, ctx: ServiceCtx, id: string): void {
  if (!can(ctx.role, 'restore')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to restore products');
  }
  db.transaction((tx) => {
    restoreWithRefs(tx, { shopId: ctx.shopId, table: products, id });
  });
}
