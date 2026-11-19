import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { active } from '@/db/helpers';
import {
  CASH_TYPES,
  METHODS,
  cash_entries,
  categories,
  expenses,
  parties,
  party_ledger,
  products,
  purchases,
  sale_items,
  sales,
  stock_movements,
  type CashEntry,
  type Method,
  type Role,
} from '@/db/schema';
import type { AppDb } from '@/db/types';
import { startOfDay, toDateInput } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { add, mulQty, roundQty } from '@/lib/money';
import { can } from './permissions';

export type ReportKind =
  | 'pnl'
  | 'sales'
  | 'purchases'
  | 'expenses'
  | 'stock'
  | 'dues'
  | 'cashflow'
  | 'product-profit';

export type DateRange = { from: number; to: number };

export type ReportContext = {
  shopId: string;
  role: Role | null | undefined;
};

export type CategoryExpenseSummary = {
  categoryId: string | null;
  categoryName: string;
  count: number;
  amount: number;
  sharePercent: number;
};

export type ProfitAndLossReport = {
  kind: 'pnl';
  range: DateRange;
  salesCount: number;
  grossSales: number;
  totalDiscount: number;
  totalVat: number;
  netSales: number;
  salesCollected: number;
  salesDue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPercent: number;
  totalExpenses: number;
  expenseCount: number;
  netProfit: number;
  netMarginPercent: number;
  totalPurchases: number;
  expensesByCategory: CategoryExpenseSummary[];
};

export type MethodBreakdown = {
  method: Method;
  count: number;
  total: number;
  paid: number;
};

export type DailyTotal = {
  dateKey: string;
  date: number;
  count: number;
  total: number;
  paid: number;
  due: number;
};

export type SalesReportRow = {
  id: string;
  invoiceNo: string;
  date: number;
  partyName: string;
  kind: 'pos' | 'quick' | 'online';
  method: Method;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  paid: number;
  due: number;
  note: string | null;
};

export type SalesReport = {
  kind: 'sales';
  range: DateRange;
  count: number;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  paid: number;
  due: number;
  byMethod: MethodBreakdown[];
  byKind: { kind: 'pos' | 'quick' | 'online'; count: number; total: number }[];
  daily: DailyTotal[];
  rows: SalesReportRow[];
};

export type PurchasesReportRow = {
  id: string;
  billNo: string;
  date: number;
  partyName: string;
  method: Method;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  paid: number;
  due: number;
  note: string | null;
};

export type PurchasesReport = {
  kind: 'purchases';
  range: DateRange;
  count: number;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  paid: number;
  due: number;
  byMethod: MethodBreakdown[];
  daily: DailyTotal[];
  rows: PurchasesReportRow[];
};

export type ExpenseReportRow = {
  id: string;
  date: number;
  categoryId: string | null;
  categoryName: string;
  method: Method;
  amount: number;
  note: string | null;
};

export type ExpensesReport = {
  kind: 'expenses';
  range: DateRange;
  count: number;
  total: number;
  byCategory: CategoryExpenseSummary[];
  byMethod: { method: Method; count: number; total: number }[];
  rows: ExpenseReportRow[];
};

export type StockValuationRow = {
  productId: string;
  name: string;
  code: string | null;
  categoryName: string;
  unit: string;
  qty: number;
  buyPrice: number;
  sellPrice: number;
  costValue: number;
  sellValue: number;
  potentialProfit: number;
  lowStockAlert: number;
  isLowStock: boolean;
  isOutOfStock: boolean;
};

export type StockValuationReport = {
  kind: 'stock';
  generatedAt: number;
  totalProducts: number;
  inStockProducts: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalQty: number;
  totalCostValue: number;
  totalSellValue: number;
  potentialProfit: number;
  rows: StockValuationRow[];
};

export type DueReportRow = {
  partyId: string;
  name: string;
  phone: string | null;
  type: 'customer' | 'supplier' | 'employee';
  /** Signed paisa: >0 receivable (they owe us), <0 payable (we owe them). */
  balance: number;
  lastActivityAt: number | null;
};

export type DuesReport = {
  kind: 'dues';
  generatedAt: number;
  totalReceivable: number;
  totalPayable: number;
  netDue: number;
  receivableCount: number;
  payableCount: number;
  receivables: DueReportRow[];
  payables: DueReportRow[];
  rows: DueReportRow[];
};

export type CashFlowTypeSummary = {
  type: CashEntry['type'];
  count: number;
  totalIn: number;
  totalOut: number;
  net: number;
};

export type CashFlowMethodSummary = {
  method: Method;
  openingBalance: number;
  totalIn: number;
  totalOut: number;
  net: number;
  closingBalance: number;
};

export type CashFlowRow = {
  id: string;
  date: number;
  type: CashEntry['type'];
  method: Method;
  amount: number;
  note: string | null;
};

export type CashFlowReport = {
  kind: 'cashflow';
  range: DateRange;
  openingBalance: number;
  totalIn: number;
  totalOut: number;
  netFlow: number;
  closingBalance: number;
  entryCount: number;
  byType: CashFlowTypeSummary[];
  byMethod: CashFlowMethodSummary[];
  daily: { dateKey: string; date: number; totalIn: number; totalOut: number; net: number }[];
  rows: CashFlowRow[];
};

export type ProductProfitRow = {
  key: string;
  productId: string | null;
  name: string;
  unit: string;
  qtySold: number;
  revenue: number;
  cogs: number;
  profit: number;
  marginPercent: number;
  saleCount: number;
};

export type ProductProfitReport = {
  kind: 'product-profit';
  range: DateRange;
  productCount: number;
  totalQtySold: number;
  totalRevenue: number;
  totalCogs: number;
  totalProfit: number;
  marginPercent: number;
  invoiceDiscountTotal: number;
  rows: ProductProfitRow[];
};

export type AnyReport =
  | ProfitAndLossReport
  | SalesReport
  | PurchasesReport
  | ExpensesReport
  | StockValuationReport
  | DuesReport
  | CashFlowReport
  | ProductProfitReport;

const shopIdSchema = z.string().trim().min(1, 'Shop ID is required');
const dateRangeSchema = z
  .object({
    from: z.number().int(),
    to: z.number().int(),
  })
  .refine((r) => r.from <= r.to, { message: 'Start date must be on or before end date' });

const methodFilterSchema = z.enum(METHODS).optional();

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const res = schema.safeParse(input);
  if (!res.success) {
    throw new AppError('VALIDATION', res.error.issues[0]?.message ?? 'Invalid report parameters');
  }
  return res.data;
}

function assertReportAccess(
  ctx: ReportContext,
  extra?: 'viewProfit' | 'viewCost',
): { shopId: string } {
  const shopId = parseOrThrow(shopIdSchema, ctx.shopId);
  if (!can(ctx.role, 'viewReports')) {
    throw new AppError('FORBIDDEN', 'Only owners and managers can view business reports');
  }
  if (extra && !can(ctx.role, extra)) {
    throw new AppError('FORBIDDEN', 'You do not have permission to view this report');
  }
  return { shopId };
}

function toInt(val: unknown): number {
  const n = Number(val ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 10000) / 100;
}

function loadCategoryMap(db: AppDb, shopId: string): Map<string, string> {
  const rows = db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(active(categories, shopId))
    .all();
  return new Map(rows.map((r) => [r.id, r.name]));
}

function loadPartyNameMap(db: AppDb, shopId: string): Map<string, string> {
  const rows = db
    .select({ id: parties.id, name: parties.name })
    .from(parties)
    .where(eq(parties.shop_id, shopId))
    .all();
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** 1. Profit & Loss Report: Net Sales − COGS (buy_price snapshot at sale) − Expenses */
export function getProfitAndLossReport(
  db: AppDb,
  ctx: ReportContext,
  range: DateRange,
): ProfitAndLossReport {
  const { shopId } = assertReportAccess(ctx, 'viewProfit');
  const validRange = parseOrThrow(dateRangeSchema, range);

  const saleRows = db
    .select()
    .from(sales)
    .where(
      and(active(sales, shopId), gte(sales.date, validRange.from), lte(sales.date, validRange.to)),
    )
    .all();

  const saleIds = new Set(saleRows.map((s) => s.id));
  let grossSales = 0;
  let totalDiscount = 0;
  let totalVat = 0;
  let netSales = 0;
  let salesCollected = 0;
  let salesDue = 0;

  for (const s of saleRows) {
    grossSales = add(grossSales, s.subtotal);
    totalDiscount = add(totalDiscount, s.discount);
    totalVat = add(totalVat, s.vat);
    netSales = add(netSales, s.total);
    salesCollected = add(salesCollected, s.paid);
    salesDue = add(salesDue, s.due);
  }

  let cogs = 0;
  if (saleIds.size > 0) {
    const itemRows = db
      .select({
        sale_id: sale_items.sale_id,
        qty: sale_items.qty,
        buy_price: sale_items.buy_price,
      })
      .from(sale_items)
      .where(active(sale_items, shopId))
      .all();
    for (const item of itemRows) {
      if (!saleIds.has(item.sale_id)) continue;
      cogs = add(cogs, mulQty(item.buy_price, item.qty));
    }
  }

  const expenseRows = db
    .select()
    .from(expenses)
    .where(
      and(
        active(expenses, shopId),
        gte(expenses.date, validRange.from),
        lte(expenses.date, validRange.to),
      ),
    )
    .all();

  const catMap = loadCategoryMap(db, shopId);
  const expByCat = new Map<string, { categoryId: string | null; name: string; count: number; amount: number }>();
  let totalExpenses = 0;
  for (const e of expenseRows) {
    totalExpenses = add(totalExpenses, e.amount);
    const key = e.category_id ?? '__uncategorized__';
    const existing = expByCat.get(key);
    if (existing) {
      existing.count += 1;
      existing.amount = add(existing.amount, e.amount);
    } else {
      expByCat.set(key, {
        categoryId: e.category_id,
        name: e.category_id ? (catMap.get(e.category_id) ?? 'Uncategorized') : 'Uncategorized',
        count: 1,
        amount: e.amount,
      });
    }
  }

  const expensesByCategory: CategoryExpenseSummary[] = [...expByCat.values()]
    .sort((a, b) => b.amount - a.amount)
    .map((c) => ({
      categoryId: c.categoryId,
      categoryName: c.name,
      count: c.count,
      amount: c.amount,
      sharePercent: pct(c.amount, totalExpenses),
    }));

  const purchaseRow = db
    .select({ total: sql<number>`COALESCE(SUM(${purchases.total}), 0)` })
    .from(purchases)
    .where(
      and(
        active(purchases, shopId),
        gte(purchases.date, validRange.from),
        lte(purchases.date, validRange.to),
      ),
    )
    .get();

  const grossProfit = netSales - cogs;
  const netProfit = grossProfit - totalExpenses;

  return {
    kind: 'pnl',
    range: validRange,
    salesCount: saleRows.length,
    grossSales,
    totalDiscount,
    totalVat,
    netSales,
    salesCollected,
    salesDue,
    cogs,
    grossProfit,
    grossMarginPercent: pct(grossProfit, netSales),
    totalExpenses,
    expenseCount: expenseRows.length,
    netProfit,
    netMarginPercent: pct(netProfit, netSales),
    totalPurchases: toInt(purchaseRow?.total),
    expensesByCategory,
  };
}

/** 2. Sales Report */
export function getSalesReport(
  db: AppDb,
  ctx: ReportContext,
  range: DateRange,
  filter?: { method?: Method; kind?: 'pos' | 'quick' | 'online'; partyId?: string },
): SalesReport {
  const { shopId } = assertReportAccess(ctx);
  const validRange = parseOrThrow(dateRangeSchema, range);
  const validMethod = parseOrThrow(methodFilterSchema, filter?.method);
  const validKind = parseOrThrow(z.enum(['pos', 'quick', 'online']).optional(), filter?.kind);

  const conds = [
    active(sales, shopId),
    gte(sales.date, validRange.from),
    lte(sales.date, validRange.to),
  ];
  if (validMethod) conds.push(eq(sales.method, validMethod));
  if (validKind) conds.push(eq(sales.kind, validKind));
  if (filter?.partyId) conds.push(eq(sales.party_id, filter.partyId));

  const rawRows = db
    .select()
    .from(sales)
    .where(and(...conds))
    .orderBy(desc(sales.date), desc(sales.created_at))
    .all();

  const partyNames = loadPartyNameMap(db, shopId);
  let subtotal = 0;
  let discount = 0;
  let vat = 0;
  let total = 0;
  let paid = 0;
  let due = 0;

  const methodMap = new Map<Method, MethodBreakdown>();
  const kindMap = new Map<'pos' | 'quick' | 'online', { kind: 'pos' | 'quick' | 'online'; count: number; total: number }>();
  const dailyMap = new Map<string, DailyTotal>();

  const rows: SalesReportRow[] = rawRows.map((s) => {
    subtotal = add(subtotal, s.subtotal);
    discount = add(discount, s.discount);
    vat = add(vat, s.vat);
    total = add(total, s.total);
    paid = add(paid, s.paid);
    due = add(due, s.due);

    const m = methodMap.get(s.method) ?? { method: s.method, count: 0, total: 0, paid: 0 };
    m.count += 1;
    m.total = add(m.total, s.total);
    m.paid = add(m.paid, s.paid);
    methodMap.set(s.method, m);

    const k = kindMap.get(s.kind) ?? { kind: s.kind, count: 0, total: 0 };
    k.count += 1;
    k.total = add(k.total, s.total);
    kindMap.set(s.kind, k);

    const dk = toDateInput(s.date);
    const d = dailyMap.get(dk) ?? {
      dateKey: dk,
      date: startOfDay(s.date),
      count: 0,
      total: 0,
      paid: 0,
      due: 0,
    };
    d.count += 1;
    d.total = add(d.total, s.total);
    d.paid = add(d.paid, s.paid);
    d.due = add(d.due, s.due);
    dailyMap.set(dk, d);

    return {
      id: s.id,
      invoiceNo: s.invoice_no,
      date: s.date,
      partyName: s.party_id ? (partyNames.get(s.party_id) ?? 'Walk-in') : 'Walk-in',
      kind: s.kind,
      method: s.method,
      subtotal: s.subtotal,
      discount: s.discount,
      vat: s.vat,
      total: s.total,
      paid: s.paid,
      due: s.due,
      note: s.note,
    };
  });

  return {
    kind: 'sales',
    range: validRange,
    count: rows.length,
    subtotal,
    discount,
    vat,
    total,
    paid,
    due,
    byMethod: [...methodMap.values()].sort((a, b) => b.total - a.total),
    byKind: [...kindMap.values()].sort((a, b) => b.total - a.total),
    daily: [...dailyMap.values()].sort((a, b) => a.date - b.date),
    rows,
  };
}

/** 3. Purchases Report */
export function getPurchasesReport(
  db: AppDb,
  ctx: ReportContext,
  range: DateRange,
  filter?: { method?: Method; partyId?: string },
): PurchasesReport {
  const { shopId } = assertReportAccess(ctx, 'viewCost');
  const validRange = parseOrThrow(dateRangeSchema, range);
  const validMethod = parseOrThrow(methodFilterSchema, filter?.method);

  const conds = [
    active(purchases, shopId),
    gte(purchases.date, validRange.from),
    lte(purchases.date, validRange.to),
  ];
  if (validMethod) conds.push(eq(purchases.method, validMethod));
  if (filter?.partyId) conds.push(eq(purchases.party_id, filter.partyId));

  const rawRows = db
    .select()
    .from(purchases)
    .where(and(...conds))
    .orderBy(desc(purchases.date), desc(purchases.created_at))
    .all();

  const partyNames = loadPartyNameMap(db, shopId);
  let subtotal = 0;
  let discount = 0;
  let vat = 0;
  let total = 0;
  let paid = 0;
  let due = 0;

  const methodMap = new Map<Method, MethodBreakdown>();
  const dailyMap = new Map<string, DailyTotal>();

  const rows: PurchasesReportRow[] = rawRows.map((p) => {
    subtotal = add(subtotal, p.subtotal);
    discount = add(discount, p.discount);
    vat = add(vat, p.vat);
    total = add(total, p.total);
    paid = add(paid, p.paid);
    due = add(due, p.due);

    const m = methodMap.get(p.method) ?? { method: p.method, count: 0, total: 0, paid: 0 };
    m.count += 1;
    m.total = add(m.total, p.total);
    m.paid = add(m.paid, p.paid);
    methodMap.set(p.method, m);

    const dk = toDateInput(p.date);
    const d = dailyMap.get(dk) ?? {
      dateKey: dk,
      date: startOfDay(p.date),
      count: 0,
      total: 0,
      paid: 0,
      due: 0,
    };
    d.count += 1;
    d.total = add(d.total, p.total);
    d.paid = add(d.paid, p.paid);
    d.due = add(d.due, p.due);
    dailyMap.set(dk, d);

    return {
      id: p.id,
      billNo: p.bill_no,
      date: p.date,
      partyName: p.party_id ? (partyNames.get(p.party_id) ?? 'Supplier') : 'Cash supplier',
      method: p.method,
      subtotal: p.subtotal,
      discount: p.discount,
      vat: p.vat,
      total: p.total,
      paid: p.paid,
      due: p.due,
      note: p.note,
    };
  });

  return {
    kind: 'purchases',
    range: validRange,
    count: rows.length,
    subtotal,
    discount,
    vat,
    total,
    paid,
    due,
    byMethod: [...methodMap.values()].sort((a, b) => b.total - a.total),
    daily: [...dailyMap.values()].sort((a, b) => a.date - b.date),
    rows,
  };
}

/** 4. Expenses Report */
export function getExpensesReport(
  db: AppDb,
  ctx: ReportContext,
  range: DateRange,
  filter?: { categoryId?: string; method?: Method },
): ExpensesReport {
  const { shopId } = assertReportAccess(ctx);
  const validRange = parseOrThrow(dateRangeSchema, range);
  const validMethod = parseOrThrow(methodFilterSchema, filter?.method);

  const conds = [
    active(expenses, shopId),
    gte(expenses.date, validRange.from),
    lte(expenses.date, validRange.to),
  ];
  if (validMethod) conds.push(eq(expenses.method, validMethod));
  if (filter?.categoryId) conds.push(eq(expenses.category_id, filter.categoryId));

  const rawRows = db
    .select()
    .from(expenses)
    .where(and(...conds))
    .orderBy(desc(expenses.date), desc(expenses.created_at))
    .all();

  const catMap = loadCategoryMap(db, shopId);
  let total = 0;
  const byCatMap = new Map<string, { categoryId: string | null; name: string; count: number; amount: number }>();
  const byMethodMap = new Map<Method, { method: Method; count: number; total: number }>();

  const rows: ExpenseReportRow[] = rawRows.map((e) => {
    total = add(total, e.amount);
    const categoryName = e.category_id
      ? (catMap.get(e.category_id) ?? 'Uncategorized')
      : 'Uncategorized';
    const cKey = e.category_id ?? '__uncategorized__';
    const c = byCatMap.get(cKey) ?? {
      categoryId: e.category_id,
      name: categoryName,
      count: 0,
      amount: 0,
    };
    c.count += 1;
    c.amount = add(c.amount, e.amount);
    byCatMap.set(cKey, c);

    const m = byMethodMap.get(e.method) ?? { method: e.method, count: 0, total: 0 };
    m.count += 1;
    m.total = add(m.total, e.amount);
    byMethodMap.set(e.method, m);

    return {
      id: e.id,
      date: e.date,
      categoryId: e.category_id,
      categoryName,
      method: e.method,
      amount: e.amount,
      note: e.note,
    };
  });

  const byCategory: CategoryExpenseSummary[] = [...byCatMap.values()]
    .sort((a, b) => b.amount - a.amount)
    .map((c) => ({
      categoryId: c.categoryId,
      categoryName: c.name,
      count: c.count,
      amount: c.amount,
      sharePercent: pct(c.amount, total),
    }));

  return {
    kind: 'expenses',
    range: validRange,
    count: rows.length,
    total,
    byCategory,
    byMethod: [...byMethodMap.values()].sort((a, b) => b.total - a.total),
    rows,
  };
}

/** 5. Stock Valuation Report (point-in-time derived from stock_movements) */
export function getStockValuationReport(
  db: AppDb,
  ctx: ReportContext,
  filter?: { categoryId?: string; status?: 'all' | 'low' | 'out' },
): StockValuationReport {
  const { shopId } = assertReportAccess(ctx, 'viewCost');
  const status = parseOrThrow(z.enum(['all', 'low', 'out']).default('all'), filter?.status);

  const conds = [active(products, shopId)];
  if (filter?.categoryId) conds.push(eq(products.category_id, filter.categoryId));

  const productRows = db
    .select()
    .from(products)
    .where(and(...conds))
    .all();

  const catMap = loadCategoryMap(db, shopId);
  const stockAgg = db
    .select({
      productId: stock_movements.product_id,
      qty: sql<number>`COALESCE(SUM(${stock_movements.qty}), 0)`,
    })
    .from(stock_movements)
    .where(active(stock_movements, shopId))
    .groupBy(stock_movements.product_id)
    .all();
  const stockMap = new Map(stockAgg.map((s) => [s.productId, roundQty(Number(s.qty ?? 0))]));

  const allRows: StockValuationRow[] = productRows.map((p) => {
    const qty = stockMap.get(p.id) ?? 0;
    const positiveQty = qty > 0 ? qty : 0;
    const costValue = mulQty(p.buy_price, positiveQty);
    const sellValue = mulQty(p.sell_price, positiveQty);
    const isOutOfStock = qty <= 0;
    const isLowStock = p.low_stock_alert > 0 && qty <= p.low_stock_alert;

    return {
      productId: p.id,
      name: p.name,
      code: p.code,
      categoryName: p.category_id ? (catMap.get(p.category_id) ?? 'Uncategorized') : 'Uncategorized',
      unit: p.unit,
      qty,
      buyPrice: p.buy_price,
      sellPrice: p.sell_price,
      costValue,
      sellValue,
      potentialProfit: sellValue - costValue,
      lowStockAlert: p.low_stock_alert,
      isLowStock,
      isOutOfStock,
    };
  });

  const rows = allRows
    .filter((r) => {
      if (status === 'low') return r.isLowStock;
      if (status === 'out') return r.isOutOfStock;
      return true;
    })
    .sort((a, b) => b.costValue - a.costValue || a.name.localeCompare(b.name));

  let inStockProducts = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let totalQty = 0;
  let totalCostValue = 0;
  let totalSellValue = 0;

  for (const r of rows) {
    if (r.qty > 0) inStockProducts += 1;
    if (r.isLowStock) lowStockCount += 1;
    if (r.isOutOfStock) outOfStockCount += 1;
    totalQty += r.qty;
    totalCostValue = add(totalCostValue, r.costValue);
    totalSellValue = add(totalSellValue, r.sellValue);
  }

  return {
    kind: 'stock',
    generatedAt: Date.now(),
    totalProducts: rows.length,
    inStockProducts,
    lowStockCount,
    outOfStockCount,
    totalQty: roundQty(totalQty),
    totalCostValue,
    totalSellValue,
    potentialProfit: totalSellValue - totalCostValue,
    rows,
  };
}

/** 6. Dues Report (Receivables & Payables derived from party_ledger) */
export function getDuesReport(
  db: AppDb,
  ctx: ReportContext,
  filter?: { partyType?: 'customer' | 'supplier' | 'employee'; direction?: 'all' | 'receivable' | 'payable' },
): DuesReport {
  const { shopId } = assertReportAccess(ctx);
  const partyType = parseOrThrow(
    z.enum(['customer', 'supplier', 'employee']).optional(),
    filter?.partyType,
  );
  const direction = parseOrThrow(
    z.enum(['all', 'receivable', 'payable']).default('all'),
    filter?.direction,
  );

  const partyConds = [active(parties, shopId)];
  if (partyType) partyConds.push(eq(parties.type, partyType));
  const partyRows = db
    .select()
    .from(parties)
    .where(and(...partyConds))
    .all();

  const ledgerAgg = db
    .select({
      partyId: party_ledger.party_id,
      balance: sql<number>`COALESCE(SUM(${party_ledger.amount}), 0)`,
      lastDate: sql<number | null>`MAX(${party_ledger.date})`,
    })
    .from(party_ledger)
    .where(active(party_ledger, shopId))
    .groupBy(party_ledger.party_id)
    .all();

  const ledgerMap = new Map(
    ledgerAgg.map((l) => [l.partyId, { balance: toInt(l.balance), lastDate: l.lastDate }]),
  );

  const receivables: DueReportRow[] = [];
  const payables: DueReportRow[] = [];

  for (const p of partyRows) {
    const agg = ledgerMap.get(p.id);
    if (!agg || agg.balance === 0) continue;
    const row: DueReportRow = {
      partyId: p.id,
      name: p.name,
      phone: p.phone,
      type: p.type,
      balance: agg.balance,
      lastActivityAt: agg.lastDate ? Number(agg.lastDate) : null,
    };
    if (agg.balance > 0) receivables.push(row);
    else payables.push(row);
  }

  receivables.sort((a, b) => b.balance - a.balance);
  payables.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

  const totalReceivable = receivables.reduce((sum, r) => add(sum, r.balance), 0);
  const totalPayable = payables.reduce((sum, r) => add(sum, Math.abs(r.balance)), 0);

  let rows: DueReportRow[];
  if (direction === 'receivable') {
    rows = receivables;
  } else if (direction === 'payable') {
    rows = payables;
  } else {
    rows = [...receivables, ...payables].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  }

  return {
    kind: 'dues',
    generatedAt: Date.now(),
    totalReceivable,
    totalPayable,
    netDue: totalReceivable - totalPayable,
    receivableCount: receivables.length,
    payableCount: payables.length,
    receivables,
    payables,
    rows,
  };
}

/** 7. Cash Flow Report (opening balance, period inflows/outflows, closing balance) */
export function getCashFlowReport(
  db: AppDb,
  ctx: ReportContext,
  range: DateRange,
  filter?: { method?: Method },
): CashFlowReport {
  const { shopId } = assertReportAccess(ctx);
  const validRange = parseOrThrow(dateRangeSchema, range);
  const validMethod = parseOrThrow(methodFilterSchema, filter?.method);

  const openingConds = [active(cash_entries, shopId), lt(cash_entries.date, validRange.from)];
  if (validMethod) openingConds.push(eq(cash_entries.method, validMethod));

  const openingByMethodRows = db
    .select({
      method: cash_entries.method,
      total: sql<number>`COALESCE(SUM(${cash_entries.amount}), 0)`,
    })
    .from(cash_entries)
    .where(and(...openingConds))
    .groupBy(cash_entries.method)
    .all();

  let openingBalance = 0;
  const methodOpening = new Map<Method, number>();
  for (const r of openingByMethodRows) {
    const val = toInt(r.total);
    methodOpening.set(r.method, val);
    openingBalance = add(openingBalance, val);
  }

  const periodConds = [
    active(cash_entries, shopId),
    gte(cash_entries.date, validRange.from),
    lte(cash_entries.date, validRange.to),
  ];
  if (validMethod) periodConds.push(eq(cash_entries.method, validMethod));

  const rawRows = db
    .select()
    .from(cash_entries)
    .where(and(...periodConds))
    .orderBy(desc(cash_entries.date), desc(cash_entries.created_at))
    .all();

  let totalIn = 0;
  let totalOut = 0;
  const typeMap = new Map<CashEntry['type'], CashFlowTypeSummary>();
  const methodMap = new Map<Method, CashFlowMethodSummary>();
  const dailyMap = new Map<
    string,
    { dateKey: string; date: number; totalIn: number; totalOut: number; net: number }
  >();

  // Seed methodMap with methods that have non-zero opening balance
  for (const [method, open] of methodOpening.entries()) {
    if (open !== 0) {
      methodMap.set(method, {
        method,
        openingBalance: open,
        totalIn: 0,
        totalOut: 0,
        net: 0,
        closingBalance: open,
      });
    }
  }

  const rows: CashFlowRow[] = rawRows.map((e) => {
    const inAmt = e.amount > 0 ? e.amount : 0;
    const outAmt = e.amount < 0 ? Math.abs(e.amount) : 0;
    totalIn = add(totalIn, inAmt);
    totalOut = add(totalOut, outAmt);

    const t = typeMap.get(e.type) ?? { type: e.type, count: 0, totalIn: 0, totalOut: 0, net: 0 };
    t.count += 1;
    t.totalIn = add(t.totalIn, inAmt);
    t.totalOut = add(t.totalOut, outAmt);
    t.net = add(t.net, e.amount);
    typeMap.set(e.type, t);

    const open = methodOpening.get(e.method) ?? 0;
    const m = methodMap.get(e.method) ?? {
      method: e.method,
      openingBalance: open,
      totalIn: 0,
      totalOut: 0,
      net: 0,
      closingBalance: open,
    };
    m.totalIn = add(m.totalIn, inAmt);
    m.totalOut = add(m.totalOut, outAmt);
    m.net = add(m.net, e.amount);
    m.closingBalance = add(m.openingBalance, m.net);
    methodMap.set(e.method, m);

    const dk = toDateInput(e.date);
    const d = dailyMap.get(dk) ?? {
      dateKey: dk,
      date: startOfDay(e.date),
      totalIn: 0,
      totalOut: 0,
      net: 0,
    };
    d.totalIn = add(d.totalIn, inAmt);
    d.totalOut = add(d.totalOut, outAmt);
    d.net = add(d.net, e.amount);
    dailyMap.set(dk, d);

    return {
      id: e.id,
      date: e.date,
      type: e.type,
      method: e.method,
      amount: e.amount,
      note: e.note,
    };
  });

  const typeOrder = new Map(CASH_TYPES.map((t, i) => [t, i]));
  const netFlow = totalIn - totalOut;

  return {
    kind: 'cashflow',
    range: validRange,
    openingBalance,
    totalIn,
    totalOut,
    netFlow,
    closingBalance: openingBalance + netFlow,
    entryCount: rows.length,
    byType: [...typeMap.values()].sort(
      (a, b) => (typeOrder.get(a.type) ?? 99) - (typeOrder.get(b.type) ?? 99),
    ),
    byMethod: [...methodMap.values()].sort((a, b) => b.closingBalance - a.closingBalance),
    daily: [...dailyMap.values()].sort((a, b) => a.date - b.date),
    rows,
  };
}

/** 8. Product-wise Profit Report */
export function getProductProfitReport(
  db: AppDb,
  ctx: ReportContext,
  range: DateRange,
  opts?: { sortBy?: 'profit' | 'revenue' | 'qty' },
): ProductProfitReport {
  const { shopId } = assertReportAccess(ctx, 'viewProfit');
  const validRange = parseOrThrow(dateRangeSchema, range);
  const sortBy = parseOrThrow(z.enum(['profit', 'revenue', 'qty']).default('profit'), opts?.sortBy);

  const saleRows = db
    .select({ id: sales.id, discount: sales.discount })
    .from(sales)
    .where(
      and(active(sales, shopId), gte(sales.date, validRange.from), lte(sales.date, validRange.to)),
    )
    .all();

  const saleIds = new Set(saleRows.map((s) => s.id));
  const invoiceDiscountTotal = saleRows.reduce((sum, s) => add(sum, s.discount), 0);

  if (saleIds.size === 0) {
    return {
      kind: 'product-profit',
      range: validRange,
      productCount: 0,
      totalQtySold: 0,
      totalRevenue: 0,
      totalCogs: 0,
      totalProfit: 0,
      marginPercent: 0,
      invoiceDiscountTotal: 0,
      rows: [],
    };
  }

  const productUnits = new Map(
    db
      .select({ id: products.id, unit: products.unit })
      .from(products)
      .where(eq(products.shop_id, shopId))
      .all()
      .map((p) => [p.id, p.unit]),
  );

  const items = db
    .select()
    .from(sale_items)
    .where(active(sale_items, shopId))
    .all();

  type Acc = {
    key: string;
    productId: string | null;
    name: string;
    unit: string;
    qtySold: number;
    revenue: number;
    cogs: number;
    saleIds: Set<string>;
  };

  const groups = new Map<string, Acc>();
  for (const item of items) {
    if (!saleIds.has(item.sale_id)) continue;
    const key = item.product_id ?? `custom:${item.name.trim().toLowerCase()}`;
    const lineCogs = mulQty(item.buy_price, item.qty);
    const existing = groups.get(key);
    if (existing) {
      existing.qtySold = roundQty(existing.qtySold + item.qty);
      existing.revenue = add(existing.revenue, item.total);
      existing.cogs = add(existing.cogs, lineCogs);
      existing.saleIds.add(item.sale_id);
    } else {
      groups.set(key, {
        key,
        productId: item.product_id,
        name: item.name,
        unit: item.product_id ? (productUnits.get(item.product_id) ?? 'pcs') : 'pcs',
        qtySold: roundQty(item.qty),
        revenue: item.total,
        cogs: lineCogs,
        saleIds: new Set([item.sale_id]),
      });
    }
  }

  let totalQtySold = 0;
  let totalRevenue = 0;
  let totalCogs = 0;

  const rows: ProductProfitRow[] = [...groups.values()].map((g) => {
    const profit = g.revenue - g.cogs;
    totalQtySold += g.qtySold;
    totalRevenue = add(totalRevenue, g.revenue);
    totalCogs = add(totalCogs, g.cogs);
    return {
      key: g.key,
      productId: g.productId,
      name: g.name,
      unit: g.unit,
      qtySold: g.qtySold,
      revenue: g.revenue,
      cogs: g.cogs,
      profit,
      marginPercent: pct(profit, g.revenue),
      saleCount: g.saleIds.size,
    };
  });

  rows.sort((a, b) => {
    if (sortBy === 'revenue') return b.revenue - a.revenue;
    if (sortBy === 'qty') return b.qtySold - a.qtySold;
    return b.profit - a.profit || b.revenue - a.revenue;
  });

  const totalProfit = totalRevenue - totalCogs;

  return {
    kind: 'product-profit',
    range: validRange,
    productCount: rows.length,
    totalQtySold: roundQty(totalQtySold),
    totalRevenue,
    totalCogs,
    totalProfit,
    marginPercent: pct(totalProfit, totalRevenue),
    invoiceDiscountTotal,
    rows,
  };
}
