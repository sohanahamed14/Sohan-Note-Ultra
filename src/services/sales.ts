import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { active, newRow, touch } from '@/db/helpers';
import {
  categories,
  METHODS,
  parties,
  products,
  sale_items,
  sales,
  shops,
  stock_movements,
  type Method,
  type Party,
  type Product,
  type Role,
  type Sale,
  type SaleItem,
  type Shop,
} from '@/db/schema';
import type { AppDb } from '@/db/types';
import { addDays, now } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { nextInvoiceNo } from '@/lib/invoiceNo';
import { add, mulQty, percentOf, roundQty } from '@/lib/money';
import { can } from '@/services/permissions';
import { postCash, postLedger, postStock, restoreWithRefs, softDeleteWithRefs } from '@/services/posting';

export type SaleContext = {
  shopId: string;
  userId: string | null;
  role: Role;
};

export const SALE_KINDS = ['pos', 'quick', 'online'] as const;
export type SaleKind = (typeof SALE_KINDS)[number];
export type SalePaymentStatus = 'paid' | 'partial' | 'due';

const safeInt = z
  .number()
  .refine((n) => Number.isSafeInteger(n), 'Amount must be a whole integer (paisa)');

export const saleLineInputSchema = z.object({
  productId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1, 'Item name is required').max(160),
  qty: z
    .number()
    .finite('Invalid quantity')
    .refine((q) => roundQty(q) > 0, 'Quantity must be greater than zero'),
  unitPrice: safeInt.refine((n) => n >= 0, 'Unit price cannot be negative'),
  buyPrice: safeInt.refine((n) => n >= 0, 'Buy price cannot be negative').optional(),
  warrantyDays: z.number().int().min(0).max(36500).optional(),
});

export const createSaleSchema = z.object({
  kind: z.enum(SALE_KINDS).default('pos'),
  partyId: z.string().min(1).nullable().optional(),
  date: z.number().int().positive().optional(),
  items: z.array(saleLineInputSchema).min(1, 'Add at least one item'),
  discountType: z.enum(['amount', 'percent']).default('amount'),
  discountValue: z.number().finite('Invalid discount').min(0, 'Discount cannot be negative').default(0),
  vatPercent: z
    .number()
    .finite('Invalid VAT')
    .min(0, 'VAT cannot be negative')
    .max(100, 'VAT cannot exceed 100%')
    .default(0),
  paid: safeInt.refine((n) => n >= 0, 'Paid amount cannot be negative'),
  method: z.enum(METHODS).default('cash'),
  note: z.string().trim().max(500).nullable().optional(),
  allowNegativeStock: z.boolean().default(false),
});

export const createQuickSaleSchema = z.object({
  amount: safeInt.refine((n) => n > 0, 'Amount must be greater than zero'),
  paid: safeInt.refine((n) => n >= 0, 'Paid amount cannot be negative').optional(),
  partyId: z.string().min(1).nullable().optional(),
  method: z.enum(METHODS).default('cash'),
  date: z.number().int().positive().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  itemName: z.string().trim().min(1).max(160).optional(),
});

export const collectSaleDueSchema = z.object({
  saleId: z.string().min(1, 'Sale ID is required'),
  amount: safeInt.refine((n) => n > 0, 'Collection amount must be greater than zero'),
  method: z.enum(METHODS).default('cash'),
  date: z.number().int().positive().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export const quickCustomerSchema = z.object({
  name: z.string().trim().min(1, 'Customer name is required').max(120),
  phone: z.string().trim().max(32).nullable().optional(),
  address: z.string().trim().max(240).nullable().optional(),
});

export type SaleLineInput = z.input<typeof saleLineInputSchema>;
export type CreateSaleInput = z.input<typeof createSaleSchema>;
export type CreateQuickSaleInput = z.input<typeof createQuickSaleSchema>;
export type CollectSaleDueInput = z.input<typeof collectSaleDueSchema>;
export type QuickCustomerInput = z.input<typeof quickCustomerSchema>;

export type SaleTotals = {
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  lineTotals: number[];
};

export type SaleDetail = {
  sale: Sale;
  items: SaleItem[];
  party: Party | null;
  shop: Shop | null;
};

export type SaleListItem = Sale & {
  partyName: string | null;
  partyPhone: string | null;
  itemCount: number;
  paymentStatus: SalePaymentStatus;
};

export type SalesTotals = {
  count: number;
  total: number;
  paid: number;
  due: number;
};

export type SalesFilter = {
  fromDate?: number;
  toDate?: number;
  search?: string;
  status?: 'all' | SalePaymentStatus;
  method?: Method | 'all';
  kind?: 'all' | SaleKind;
  partyId?: string;
};

export type SellableProduct = {
  product: Product;
  categoryName: string | null;
  stock: number;
};

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const res = schema.safeParse(input);
  if (!res.success) {
    throw new AppError('VALIDATION', res.error.issues[0]?.message ?? 'Invalid input');
  }
  return res.data;
}

export function getSalePaymentStatus(sale: Pick<Sale, 'total' | 'paid' | 'due'>): SalePaymentStatus {
  if (sale.due <= 0) return 'paid';
  if (sale.paid > 0) return 'partial';
  return 'due';
}

/** Pure integer-paisa sale total calculator shared by service and checkout UI. */
export function calculateSaleTotals(params: {
  items: { qty: number; unitPrice: number }[];
  discountType?: 'amount' | 'percent';
  discountValue?: number;
  vatPercent?: number;
}): SaleTotals {
  const lineTotals = params.items.map((item) => mulQty(item.unitPrice, roundQty(item.qty)));
  const subtotal = add(...lineTotals);
  const discountType = params.discountType ?? 'amount';
  const discountValue = params.discountValue ?? 0;

  let discount = 0;
  if (discountType === 'percent') {
    if (!Number.isFinite(discountValue) || discountValue < 0 || discountValue > 100) {
      throw new AppError('VALIDATION', 'Discount percent must be between 0 and 100');
    }
    discount = percentOf(subtotal, discountValue);
  } else {
    if (!Number.isSafeInteger(discountValue) || discountValue < 0) {
      throw new AppError('VALIDATION', 'Discount amount must be whole paisa');
    }
    if (discountValue > subtotal) {
      throw new AppError('VALIDATION', 'Discount cannot exceed subtotal');
    }
    discount = discountValue;
  }

  const taxable = subtotal - discount;
  const vatPercent = params.vatPercent ?? 0;
  if (!Number.isFinite(vatPercent) || vatPercent < 0 || vatPercent > 100) {
    throw new AppError('VALIDATION', 'VAT percent must be between 0 and 100');
  }
  const vat = percentOf(taxable, vatPercent);
  const total = add(taxable, vat);
  return { subtotal, discount, vat, total, lineTotals };
}

/** Derived available stock for one product (Σ active stock_movements.qty). */
export function getProductStock(db: AppDb, shopId: string, productId: string): number {
  const row = db
    .select({ qty: sql<number>`COALESCE(SUM(${stock_movements.qty}), 0)` })
    .from(stock_movements)
    .where(and(active(stock_movements, shopId), eq(stock_movements.product_id, productId)))
    .get();
  return roundQty(Number(row?.qty ?? 0));
}

function getStockMap(db: AppDb, shopId: string, productIds?: string[]): Map<string, number> {
  const map = new Map<string, number>();
  if (productIds && productIds.length === 0) return map;
  const cond = productIds
    ? and(active(stock_movements, shopId), inArray(stock_movements.product_id, productIds))
    : active(stock_movements, shopId);
  const rows = db
    .select({
      productId: stock_movements.product_id,
      qty: sql<number>`COALESCE(SUM(${stock_movements.qty}), 0)`,
    })
    .from(stock_movements)
    .where(cond)
    .groupBy(stock_movements.product_id)
    .all();
  for (const r of rows) {
    map.set(r.productId, roundQty(Number(r.qty ?? 0)));
  }
  return map;
}

/**
 * Create a POS, quick, or online sale in a single atomic transaction:
 * sale + sale_items (buy_price snapshot + warranty_until) + stock− + cash+ + ledger+.
 */
export function createSale(db: AppDb, ctx: SaleContext, rawInput: CreateSaleInput): SaleDetail {
  if (!can(ctx.role, 'sell')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to create sales');
  }
  const input = parseOrThrow(createSaleSchema, rawInput);
  const totals = calculateSaleTotals({
    items: input.items.map((i) => ({ qty: i.qty, unitPrice: i.unitPrice })),
    discountType: input.discountType,
    discountValue: input.discountValue,
    vatPercent: input.vatPercent,
  });

  if (input.paid > totals.total) {
    throw new AppError('OVERPAY', 'Paid amount cannot exceed sale total');
  }
  const due = totals.total - input.paid;
  const partyId = input.partyId ?? null;
  if (due > 0 && !partyId) {
    throw new AppError('VALIDATION', 'Select a customer when there is a due amount');
  }

  const saleDate = input.date ?? now();
  const createdId = db.transaction((tx) => {
    if (partyId) {
      const party = tx
        .select({ id: parties.id })
        .from(parties)
        .where(and(active(parties, ctx.shopId), eq(parties.id, partyId)))
        .get();
      if (!party) throw new AppError('NOT_FOUND', 'Selected customer not found');
    }

    const linkedProductIds = Array.from(
      new Set(input.items.map((i) => i.productId).filter((id): id is string => Boolean(id))),
    );
    const productMap = new Map<string, Product>();
    if (linkedProductIds.length > 0) {
      const prodRows = tx
        .select()
        .from(products)
        .where(and(active(products, ctx.shopId), inArray(products.id, linkedProductIds)))
        .all();
      for (const p of prodRows) productMap.set(p.id, p);

      for (const pid of linkedProductIds) {
        if (!productMap.has(pid)) {
          throw new AppError('NOT_FOUND', 'One or more products were not found');
        }
      }

      if (!input.allowNegativeStock) {
        const stockMap = getStockMap(tx, ctx.shopId, linkedProductIds);
        const requestedByProduct = new Map<string, number>();
        for (const item of input.items) {
          if (!item.productId) continue;
          const prev = requestedByProduct.get(item.productId) ?? 0;
          requestedByProduct.set(item.productId, roundQty(prev + roundQty(item.qty)));
        }
        for (const [pid, reqQty] of requestedByProduct) {
          const avail = stockMap.get(pid) ?? 0;
          if (reqQty > avail) {
            const pName = productMap.get(pid)?.name ?? 'Product';
            throw new AppError(
              'INSUFFICIENT_STOCK',
              `Insufficient stock for ${pName} (available: ${avail})`,
            );
          }
        }
      }
    }

    const ts = now();
    const invoiceNo = nextInvoiceNo(tx, ctx.shopId, 'sale', saleDate);
    const saleRow = newRow(ctx.shopId, ctx.userId, ts);

    tx.insert(sales)
      .values({
        ...saleRow,
        invoice_no: invoiceNo,
        party_id: partyId,
        date: saleDate,
        subtotal: totals.subtotal,
        discount: totals.discount,
        vat: totals.vat,
        total: totals.total,
        paid: input.paid,
        due,
        method: input.method,
        kind: input.kind,
        note: input.note ?? null,
      })
      .run();

    for (let idx = 0; idx < input.items.length; idx++) {
      const item = input.items[idx];
      const qty = roundQty(item.qty);
      const lineTotal = totals.lineTotals[idx];
      const prod = item.productId ? productMap.get(item.productId) : undefined;
      const buyPriceSnapshot = prod ? prod.buy_price : (item.buyPrice ?? 0);
      const warrantyDays = item.warrantyDays ?? prod?.warranty_days ?? 0;
      const warrantyUntil = warrantyDays > 0 ? addDays(saleDate, warrantyDays) : null;

      tx.insert(sale_items)
        .values({
          ...newRow(ctx.shopId, ctx.userId, ts),
          sale_id: saleRow.id,
          product_id: prod ? prod.id : null,
          name: item.name,
          qty,
          unit_price: item.unitPrice,
          buy_price: buyPriceSnapshot,
          total: lineTotal,
          warranty_until: warrantyUntil,
        })
        .run();

      if (prod) {
        postStock(tx, {
          shopId: ctx.shopId,
          userId: ctx.userId,
          refId: saleRow.id,
          date: saleDate,
          productId: prod.id,
          qty: -qty,
          type: 'sale',
          note: invoiceNo,
        });
      }
    }

    if (input.paid > 0) {
      postCash(tx, {
        shopId: ctx.shopId,
        userId: ctx.userId,
        refId: saleRow.id,
        date: saleDate,
        amount: input.paid,
        type: 'sale',
        method: input.method,
        note: invoiceNo,
      });
    }

    if (due > 0 && partyId) {
      postLedger(tx, {
        shopId: ctx.shopId,
        userId: ctx.userId,
        refId: saleRow.id,
        date: saleDate,
        partyId,
        amount: due,
        type: 'sale_due',
        note: invoiceNo,
      });
    }

    return saleRow.id;
  });

  const detail = getSaleById(db, ctx.shopId, createdId);
  if (!detail) throw new AppError('UNKNOWN', 'Failed to load created sale');
  return detail;
}

/** Amount-only quick sale (no product inventory deduction). */
export function createQuickSale(
  db: AppDb,
  ctx: SaleContext,
  rawInput: CreateQuickSaleInput,
): SaleDetail {
  const input = parseOrThrow(createQuickSaleSchema, rawInput);
  const paid = input.paid ?? input.amount;
  const label = input.itemName ?? (input.note && input.note.length > 0 ? input.note : 'Quick sale');
  return createSale(db, ctx, {
    kind: 'quick',
    partyId: input.partyId ?? null,
    date: input.date,
    items: [
      {
        productId: null,
        name: label,
        qty: 1,
        unitPrice: input.amount,
        buyPrice: 0,
      },
    ],
    discountType: 'amount',
    discountValue: 0,
    vatPercent: 0,
    paid,
    method: input.method,
    note: input.note ?? null,
  });
}

/** Collect remaining due on a sale (updates sale paid/due + posts cash+ and party_ledger− with ref_id = saleId). */
export function collectSaleDue(
  db: AppDb,
  ctx: SaleContext,
  rawInput: CollectSaleDueInput,
): SaleDetail {
  if (!can(ctx.role, 'collectDue')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to collect due');
  }
  const input = parseOrThrow(collectSaleDueSchema, rawInput);
  const payDate = input.date ?? now();

  db.transaction((tx) => {
    const sale = tx
      .select()
      .from(sales)
      .where(and(active(sales, ctx.shopId), eq(sales.id, input.saleId)))
      .get();
    if (!sale) throw new AppError('NOT_FOUND', 'Sale not found');
    if (sale.due <= 0) throw new AppError('CONFLICT', 'This sale has no remaining due');
    if (input.amount > sale.due) {
      throw new AppError('OVERPAY', 'Collection amount exceeds remaining due');
    }
    if (!sale.party_id) {
      throw new AppError('VALIDATION', 'Sale has no customer linked for due collection');
    }

    const nextPaid = add(sale.paid, input.amount);
    const nextDue = sale.due - input.amount;
    tx.update(sales)
      .set({ paid: nextPaid, due: nextDue, ...touch() })
      .where(and(eq(sales.id, sale.id), eq(sales.shop_id, ctx.shopId)))
      .run();

    const noteText = input.note ?? `Due collected (${sale.invoice_no})`;
    postCash(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      refId: sale.id,
      date: payDate,
      amount: input.amount,
      type: 'received',
      method: input.method,
      note: noteText,
    });
    postLedger(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      refId: sale.id,
      date: payDate,
      partyId: sale.party_id,
      amount: -input.amount,
      type: 'received',
      note: noteText,
    });
  });

  const updated = getSaleById(db, ctx.shopId, input.saleId);
  if (!updated) throw new AppError('NOT_FOUND', 'Sale not found');
  return updated;
}

/** Soft-delete sale, its items, and all stock/cash/ledger postings (moves to recycle bin). */
export function deleteSale(db: AppDb, ctx: SaleContext, saleId: string): void {
  if (!can(ctx.role, 'delete')) {
    throw new AppError('FORBIDDEN', 'Only owners and managers can delete sales');
  }
  db.transaction((tx) => {
    softDeleteWithRefs(tx, {
      shopId: ctx.shopId,
      table: sales,
      id: saleId,
      items: { table: sale_items, fk: 'sale_id' },
    });
  });
}

/** Restore a soft-deleted sale and re-apply all postings deleted with it. */
export function restoreSale(db: AppDb, ctx: SaleContext, saleId: string): void {
  if (!can(ctx.role, 'restore')) {
    throw new AppError('FORBIDDEN', 'Only owners and managers can restore sales');
  }
  db.transaction((tx) => {
    restoreWithRefs(tx, {
      shopId: ctx.shopId,
      table: sales,
      id: saleId,
      items: { table: sale_items, fk: 'sale_id' },
    });
  });
}

/** Fetch an active sale with its active line items, customer (if any), and shop info. */
export function getSaleById(db: AppDb, shopId: string, saleId: string): SaleDetail | null {
  const sale = db
    .select()
    .from(sales)
    .where(and(active(sales, shopId), eq(sales.id, saleId)))
    .get();
  if (!sale) return null;

  const items = db
    .select()
    .from(sale_items)
    .where(and(active(sale_items, shopId), eq(sale_items.sale_id, sale.id)))
    .all();

  const party = sale.party_id
    ? (db
        .select()
        .from(parties)
        .where(and(eq(parties.shop_id, shopId), eq(parties.id, sale.party_id)))
        .get() ?? null)
    : null;

  const shop =
    db
      .select()
      .from(shops)
      .where(and(eq(shops.id, shopId), isNull(shops.deleted_at)))
      .get() ?? null;

  return { sale, items, party, shop };
}

/** List sales with filters and aggregate totals. */
export function listSales(
  db: AppDb,
  shopId: string,
  filter: SalesFilter = {},
): { rows: SaleListItem[]; totals: SalesTotals } {
  const conditions = [active(sales, shopId)];
  if (filter.fromDate !== undefined) conditions.push(gte(sales.date, filter.fromDate));
  if (filter.toDate !== undefined) conditions.push(lte(sales.date, filter.toDate));
  if (filter.method && filter.method !== 'all') conditions.push(eq(sales.method, filter.method));
  if (filter.kind && filter.kind !== 'all') conditions.push(eq(sales.kind, filter.kind));
  if (filter.partyId) conditions.push(eq(sales.party_id, filter.partyId));

  const rawSales = db
    .select()
    .from(sales)
    .where(and(...conditions))
    .orderBy(desc(sales.date), desc(sales.created_at))
    .all();

  if (rawSales.length === 0) {
    return { rows: [], totals: { count: 0, total: 0, paid: 0, due: 0 } };
  }

  const saleIds = rawSales.map((s) => s.id);
  const itemCounts = new Map<string, number>();
  const countRows = db
    .select({
      saleId: sale_items.sale_id,
      c: sql<number>`COUNT(*)`,
    })
    .from(sale_items)
    .where(and(active(sale_items, shopId), inArray(sale_items.sale_id, saleIds)))
    .groupBy(sale_items.sale_id)
    .all();
  for (const r of countRows) itemCounts.set(r.saleId, Number(r.c ?? 0));

  const partyIds = Array.from(
    new Set(rawSales.map((s) => s.party_id).filter((id): id is string => Boolean(id))),
  );
  const partyMap = new Map<string, { name: string; phone: string | null }>();
  if (partyIds.length > 0) {
    const pRows = db
      .select({ id: parties.id, name: parties.name, phone: parties.phone })
      .from(parties)
      .where(and(eq(parties.shop_id, shopId), inArray(parties.id, partyIds)))
      .all();
    for (const p of pRows) partyMap.set(p.id, { name: p.name, phone: p.phone });
  }

  const q = filter.search?.trim().toLowerCase() ?? '';
  const rows: SaleListItem[] = [];
  let sumTotal = 0;
  let sumPaid = 0;
  let sumDue = 0;

  for (const s of rawSales) {
    const paymentStatus = getSalePaymentStatus(s);
    if (filter.status && filter.status !== 'all' && paymentStatus !== filter.status) {
      continue;
    }
    const party = s.party_id ? partyMap.get(s.party_id) : undefined;
    if (q) {
      const haystack = [s.invoice_no, party?.name ?? '', party?.phone ?? '', s.note ?? '']
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) continue;
    }
    rows.push({
      ...s,
      partyName: party?.name ?? null,
      partyPhone: party?.phone ?? null,
      itemCount: itemCounts.get(s.id) ?? 0,
      paymentStatus,
    });
    sumTotal = add(sumTotal, s.total);
    sumPaid = add(sumPaid, s.paid);
    sumDue = add(sumDue, s.due);
  }

  return {
    rows,
    totals: { count: rows.length, total: sumTotal, paid: sumPaid, due: sumDue },
  };
}

/** List active products with derived stock and category name for POS. */
export function listSellableProducts(
  db: AppDb,
  shopId: string,
  filter?: { search?: string; categoryId?: string | null },
): SellableProduct[] {
  const conds = [active(products, shopId)];
  if (filter?.categoryId) conds.push(eq(products.category_id, filter.categoryId));

  const prodRows = db
    .select()
    .from(products)
    .where(and(...conds))
    .orderBy(products.name)
    .all();

  if (prodRows.length === 0) return [];

  const catRows = db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(active(categories, shopId), eq(categories.kind, 'product')))
    .all();
  const catMap = new Map(catRows.map((c) => [c.id, c.name]));

  const stockMap = getStockMap(
    db,
    shopId,
    prodRows.map((p) => p.id),
  );

  const q = filter?.search?.trim().toLowerCase() ?? '';
  const result: SellableProduct[] = [];
  for (const product of prodRows) {
    if (q) {
      const catName = product.category_id ? (catMap.get(product.category_id) ?? '') : '';
      const hay = `${product.name} ${product.code ?? ''} ${catName}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    result.push({
      product,
      categoryName: product.category_id ? (catMap.get(product.category_id) ?? null) : null,
      stock: stockMap.get(product.id) ?? 0,
    });
  }
  return result;
}

/** List active customers for checkout customer picker. */
export function listCustomerOptions(db: AppDb, shopId: string, search?: string): Party[] {
  const rows = db
    .select()
    .from(parties)
    .where(and(active(parties, shopId), eq(parties.type, 'customer')))
    .orderBy(parties.name)
    .all();
  const q = search?.trim().toLowerCase() ?? '';
  if (!q) return rows;
  return rows.filter((p) => `${p.name} ${p.phone ?? ''}`.toLowerCase().includes(q));
}

/** Quick-create a customer directly from Checkout. */
export function quickCreateCustomer(
  db: AppDb,
  ctx: SaleContext,
  rawInput: QuickCustomerInput,
): Party {
  if (!can(ctx.role, 'manageParties')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to add customers');
  }
  const input = parseOrThrow(quickCustomerSchema, rawInput);
  const row = {
    ...newRow(ctx.shopId, ctx.userId),
    type: 'customer' as const,
    name: input.name,
    phone: input.phone || null,
    address: input.address || null,
    note: null,
  };
  db.insert(parties).values(row).run();
  return row;
}
