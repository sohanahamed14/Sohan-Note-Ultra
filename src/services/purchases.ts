import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { active, newRow, touch } from '@/db/helpers';
import {
  METHODS,
  parties,
  products,
  purchase_items,
  purchases,
  type Party,
  type Purchase,
  type PurchaseItem,
} from '@/db/schema';
import type { AppDb } from '@/db/types';
import { now } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { nextInvoiceNo } from '@/lib/invoiceNo';
import { add, mulQty, roundQty } from '@/lib/money';
import { can } from './permissions';
import { postCash, postLedger, postStock, restoreWithRefs, softDeleteWithRefs } from './posting';
import type { ServiceCtx } from './stock';

const paisaSchema = z
  .number()
  .int('Amount must be whole paisa')
  .min(0, 'Amount cannot be negative')
  .refine(Number.isSafeInteger, 'Amount out of range');

export const purchaseItemInputSchema = z.object({
  product_id: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  name: z.string().trim().min(1, 'Item name is required').max(120, 'Item name is too long'),
  unit: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : 'pcs')),
  qty: z.number().finite('Invalid quantity').positive('Quantity must be greater than zero'),
  unit_price: paisaSchema,
  sell_price: paisaSchema.optional(),
  add_to_inventory: z.boolean().optional().default(true),
});

export const createPurchaseSchema = z.object({
  party_id: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  items: z.array(purchaseItemInputSchema).min(1, 'Add at least one item'),
  discount: paisaSchema.default(0),
  vat: paisaSchema.default(0),
  paid: paisaSchema,
  method: z.enum(METHODS).default('cash'),
  date: z.number().int().positive().optional(),
  note: z
    .string()
    .trim()
    .max(500, 'Note is too long')
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  update_buy_price: z.boolean().optional().default(false),
});

export const quickSupplierSchema = z.object({
  name: z.string().trim().min(1, 'Supplier name is required').max(120, 'Name is too long'),
  phone: z
    .string()
    .trim()
    .max(30)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  address: z
    .string()
    .trim()
    .max(250)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type CreatePurchaseInput = z.input<typeof createPurchaseSchema>;
export type QuickSupplierInput = z.input<typeof quickSupplierSchema>;

export type PurchaseDetail = {
  purchase: Purchase;
  items: PurchaseItem[];
  supplier: Party | null;
};

export type PurchaseSummary = Purchase & {
  supplierName: string | null;
  itemCount: number;
};

export type PurchaseTotals = {
  count: number;
  total: number;
  paid: number;
  due: number;
};

export type PurchaseListFilter = {
  from?: number;
  to?: number;
  partyId?: string;
  status?: 'all' | 'paid' | 'due';
  search?: string;
};

export type PurchaseListResult = {
  items: PurchaseSummary[];
  totals: PurchaseTotals;
};

/** Lists active suppliers for the Buy supplier picker. */
export function listSuppliers(db: AppDb, shopId: string, search?: string): Party[] {
  const rows = db
    .select()
    .from(parties)
    .where(and(active(parties, shopId), eq(parties.type, 'supplier')))
    .all();
  const q = search?.trim().toLowerCase() ?? '';
  return rows
    .filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.phone?.toLowerCase().includes(q) ?? false) ||
        (p.address?.toLowerCase().includes(q) ?? false)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Quick-create a supplier directly from the Buy flow. */
export function quickAddSupplier(
  db: AppDb,
  ctx: ServiceCtx,
  raw: QuickSupplierInput,
): Party {
  if (!can(ctx.role, 'manageParties')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to add suppliers');
  }
  const parsed = quickSupplierSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid supplier');
  }
  const row: Party = {
    ...newRow(ctx.shopId, ctx.userId),
    type: 'supplier',
    name: parsed.data.name,
    phone: parsed.data.phone,
    address: parsed.data.address,
    note: null,
  };
  db.insert(parties).values(row).run();
  return row;
}

/**
 * Records a purchase in one atomic transaction:
 * purchase + purchase_items + stock(+) + cash(-paid) + supplier ledger(-due).
 */
export function createPurchase(
  db: AppDb,
  ctx: ServiceCtx,
  raw: CreatePurchaseInput,
): PurchaseDetail {
  if (!can(ctx.role, 'buy')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to record purchases');
  }
  const parsed = createPurchaseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid purchase');
  }
  const data = parsed.data;
  const date = data.date ?? now();

  const normalizedItems = data.items.map((item) => {
    const qty = roundQty(item.qty);
    if (qty <= 0) throw new AppError('VALIDATION', 'Quantity must be greater than zero');
    const lineTotal = mulQty(item.unit_price, qty);
    return {
      product_id: item.product_id,
      name: item.name,
      unit: item.unit,
      qty,
      unit_price: item.unit_price,
      sell_price: item.sell_price,
      add_to_inventory: item.add_to_inventory,
      total: lineTotal,
    };
  });

  const subtotal = add(...normalizedItems.map((i) => i.total));
  if (data.discount > subtotal) {
    throw new AppError('VALIDATION', 'Discount cannot exceed subtotal');
  }
  const total = add(subtotal, -data.discount, data.vat);
  if (data.paid > total) {
    throw new AppError('OVERPAY', 'Paid amount cannot exceed total');
  }
  const due = add(total, -data.paid);
  if (due > 0 && !data.party_id) {
    throw new AppError('VALIDATION', 'Select a supplier when there is a due amount');
  }

  const purchaseId = db.transaction((tx) => {
    if (data.party_id) {
      const supplier = tx
        .select({ id: parties.id })
        .from(parties)
        .where(and(active(parties, ctx.shopId), eq(parties.id, data.party_id)))
        .get();
      if (!supplier) throw new AppError('NOT_FOUND', 'Supplier not found');
    }

    for (const item of normalizedItems) {
      if (item.product_id) {
        const prod = tx
          .select({ id: products.id })
          .from(products)
          .where(and(active(products, ctx.shopId), eq(products.id, item.product_id)))
          .get();
        if (!prod) throw new AppError('NOT_FOUND', `Product not found: ${item.name}`);
      }
    }

    const billNo = nextInvoiceNo(tx, ctx.shopId, 'purchase', date);
    const pRow = newRow(ctx.shopId, ctx.userId);
    tx.insert(purchases)
      .values({
        ...pRow,
        bill_no: billNo,
        party_id: data.party_id,
        date,
        subtotal,
        discount: data.discount,
        vat: data.vat,
        total,
        paid: data.paid,
        due,
        method: data.method,
        note: data.note,
      })
      .run();

    const existingByName = new Map<string, { id: string; sell_price: number }>();
    const needLookup = normalizedItems.some((i) => !i.product_id && i.add_to_inventory);
    if (needLookup) {
      const activeProds = tx
        .select({ id: products.id, name: products.name, sell_price: products.sell_price })
        .from(products)
        .where(active(products, ctx.shopId))
        .all();
      for (const p of activeProds) {
        const key = p.name.trim().toLowerCase();
        if (!existingByName.has(key)) {
          existingByName.set(key, { id: p.id, sell_price: p.sell_price });
        }
      }
    }

    for (const item of normalizedItems) {
      let resolvedProductId = item.product_id;
      let autoCreated = false;

      if (!resolvedProductId && item.add_to_inventory) {
        const key = item.name.trim().toLowerCase();
        const existing = existingByName.get(key);
        if (existing) {
          resolvedProductId = existing.id;
          if (item.sell_price !== undefined && item.sell_price > 0 && existing.sell_price === 0) {
            tx.update(products)
              .set({ ...touch(), sell_price: item.sell_price })
              .where(and(active(products, ctx.shopId), eq(products.id, existing.id)))
              .run();
            existing.sell_price = item.sell_price;
          }
        } else {
          const prodRow = newRow(ctx.shopId, ctx.userId);
          const sellPrice = item.sell_price ?? item.unit_price;
          tx.insert(products)
            .values({
              ...prodRow,
              name: item.name,
              category_id: null,
              unit: item.unit,
              code: null,
              buy_price: item.unit_price,
              sell_price: sellPrice,
              wholesale_price: 0,
              low_stock_alert: 0,
              warranty_days: 0,
              image_uri: null,
              description: null,
              online_visible: 0,
              featured: 0,
            })
            .run();
          resolvedProductId = prodRow.id;
          autoCreated = true;
          existingByName.set(key, { id: prodRow.id, sell_price: sellPrice });
        }
      }

      tx.insert(purchase_items)
        .values({
          ...newRow(ctx.shopId, ctx.userId),
          purchase_id: pRow.id,
          product_id: resolvedProductId,
          name: item.name,
          qty: item.qty,
          unit_price: item.unit_price,
          total: item.total,
        })
        .run();

      if (resolvedProductId) {
        postStock(tx, {
          shopId: ctx.shopId,
          userId: ctx.userId,
          refId: pRow.id,
          date,
          productId: resolvedProductId,
          qty: item.qty,
          type: 'purchase',
          note: billNo,
        });

        if (data.update_buy_price && !autoCreated) {
          tx.update(products)
            .set({ ...touch(), buy_price: item.unit_price })
            .where(and(active(products, ctx.shopId), eq(products.id, resolvedProductId)))
            .run();
        }
      }
    }

    if (data.paid > 0) {
      postCash(tx, {
        shopId: ctx.shopId,
        userId: ctx.userId,
        refId: pRow.id,
        date,
        amount: -data.paid,
        type: 'purchase',
        method: data.method,
        note: billNo,
      });
    }

    if (due > 0 && data.party_id) {
      postLedger(tx, {
        shopId: ctx.shopId,
        userId: ctx.userId,
        refId: pRow.id,
        date,
        partyId: data.party_id,
        amount: -due,
        type: 'purchase_due',
        note: billNo,
      });
    }

    return pRow.id;
  });

  const detail = getPurchaseDetail(db, ctx.shopId, purchaseId);
  if (!detail) throw new AppError('UNKNOWN', 'Failed to load created purchase');
  return detail;
}

/** Lists active purchases with supplier name, item count, and aggregate totals. */
export function listPurchases(
  db: AppDb,
  shopId: string,
  filter: PurchaseListFilter = {},
): PurchaseListResult {
  const conds = [active(purchases, shopId)];
  if (filter.from !== undefined) conds.push(gte(purchases.date, filter.from));
  if (filter.to !== undefined) conds.push(lte(purchases.date, filter.to));
  if (filter.partyId) conds.push(eq(purchases.party_id, filter.partyId));

  const rows = db
    .select({
      purchase: purchases,
      supplierName: parties.name,
    })
    .from(purchases)
    .leftJoin(parties, and(eq(parties.id, purchases.party_id), eq(parties.shop_id, shopId)))
    .where(and(...conds))
    .orderBy(desc(purchases.date), desc(purchases.created_at))
    .all();

  const itemCounts = db
    .select({
      purchaseId: purchase_items.purchase_id,
      count: sql<number>`COUNT(*)`,
    })
    .from(purchase_items)
    .where(active(purchase_items, shopId))
    .groupBy(purchase_items.purchase_id)
    .all();
  const countMap = new Map(itemCounts.map((r) => [r.purchaseId, Number(r.count ?? 0)]));

  const q = filter.search?.trim().toLowerCase() ?? '';
  const items: PurchaseSummary[] = rows
    .map((r) => ({
      ...r.purchase,
      supplierName: r.supplierName ?? null,
      itemCount: countMap.get(r.purchase.id) ?? 0,
    }))
    .filter((p) => {
      if (filter.status === 'paid' && p.due > 0) return false;
      if (filter.status === 'due' && p.due <= 0) return false;
      if (q) {
        const hit =
          p.bill_no.toLowerCase().includes(q) ||
          (p.supplierName?.toLowerCase().includes(q) ?? false) ||
          (p.note?.toLowerCase().includes(q) ?? false);
        if (!hit) return false;
      }
      return true;
    });

  const totals: PurchaseTotals = {
    count: items.length,
    total: add(...items.map((i) => i.total)),
    paid: add(...items.map((i) => i.paid)),
    due: add(...items.map((i) => i.due)),
  };

  return { items, totals };
}

/** Fetches one active purchase with its items and supplier. */
export function getPurchaseDetail(
  db: AppDb,
  shopId: string,
  id: string,
): PurchaseDetail | null {
  const purchase = db
    .select()
    .from(purchases)
    .where(and(active(purchases, shopId), eq(purchases.id, id)))
    .get();
  if (!purchase) return null;

  const items = db
    .select()
    .from(purchase_items)
    .where(and(active(purchase_items, shopId), eq(purchase_items.purchase_id, id)))
    .all();

  const supplier = purchase.party_id
    ? (db
        .select()
        .from(parties)
        .where(and(eq(parties.id, purchase.party_id), eq(parties.shop_id, shopId)))
        .get() ?? null)
    : null;

  return { purchase, items, supplier };
}

/** Soft-deletes purchase, its items, and reverses stock, cash, and supplier ledger postings. */
export function deletePurchase(db: AppDb, ctx: ServiceCtx, id: string): void {
  if (!can(ctx.role, 'delete')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to delete purchases');
  }
  db.transaction((tx) => {
    softDeleteWithRefs(tx, {
      shopId: ctx.shopId,
      table: purchases,
      id,
      items: { table: purchase_items, fk: 'purchase_id' },
    });
  });
}

/** Restores a soft-deleted purchase and re-applies its items, stock, cash, and ledger postings. */
export function restorePurchase(db: AppDb, ctx: ServiceCtx, id: string): void {
  if (!can(ctx.role, 'restore')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to restore purchases');
  }
  db.transaction((tx) => {
    restoreWithRefs(tx, {
      shopId: ctx.shopId,
      table: purchases,
      id,
      items: { table: purchase_items, fk: 'purchase_id' },
    });
  });
}
