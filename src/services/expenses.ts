import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { active, newRow, touch } from '@/db/helpers';
import {
  cash_entries,
  categories,
  expenses,
  METHODS,
  type Category,
  type Expense,
  type Method,
  type Role,
} from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { can, type Action } from './permissions';
import { postCash, restoreWithRefs, softDeleteWithRefs } from './posting';

export type ExpenseContext = {
  shopId: string;
  userId: string | null;
  role: Role;
};

export type ExpenseWithCategory = Expense & {
  categoryName: string;
};

export type ExpenseCategorySummary = {
  categoryId: string | null;
  categoryName: string;
  total: number;
  count: number;
};

export type ExpenseListResult = {
  items: ExpenseWithCategory[];
  total: number;
  byCategory: ExpenseCategorySummary[];
};

const positivePaisa = z
  .number()
  .int('Amount must be whole paisa')
  .positive('Amount must be greater than 0')
  .refine(Number.isSafeInteger, 'Amount out of range');

const epochMs = z
  .number()
  .int('Invalid date')
  .refine(Number.isSafeInteger, 'Invalid date');

export const expenseCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(60, 'Category name is too long'),
});

export const addExpenseSchema = z.object({
  amount: positivePaisa,
  categoryId: z.string().min(1).optional().nullable(),
  method: z.enum(METHODS).default('cash'),
  date: epochMs.optional(),
  note: z.string().trim().max(300, 'Note is too long').optional().nullable(),
});

export const updateExpenseSchema = z.object({
  amount: positivePaisa.optional(),
  categoryId: z.string().min(1).optional().nullable(),
  method: z.enum(METHODS).optional(),
  date: epochMs.optional(),
  note: z.string().trim().max(300, 'Note is too long').optional().nullable(),
});

export type AddExpenseInput = z.input<typeof addExpenseSchema>;
export type UpdateExpenseInput = z.input<typeof updateExpenseSchema>;

function assertCan(role: Role, action: Action): void {
  if (!can(role, action)) {
    throw new AppError('FORBIDDEN', 'You do not have permission for this action');
  }
}

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const res = schema.safeParse(input);
  if (!res.success) {
    throw new AppError('VALIDATION', res.error.issues[0]?.message ?? 'Invalid input');
  }
  return res.data;
}

function cleanOpt(v: string | null | undefined): string | null {
  if (v == null) return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function listExpenseCategories(db: AppDb, shopId: string): Category[] {
  return db
    .select()
    .from(categories)
    .where(and(active(categories, shopId), eq(categories.kind, 'expense')))
    .orderBy(asc(categories.name))
    .all();
}

export function createExpenseCategory(db: AppDb, ctx: ExpenseContext, name: string): Category {
  assertCan(ctx.role, 'addExpense');
  const data = parseOrThrow(expenseCategorySchema, { name });
  const existing = listExpenseCategories(db, ctx.shopId).find(
    (c) => c.name.toLowerCase() === data.name.toLowerCase(),
  );
  if (existing) throw new AppError('CONFLICT', 'Expense category already exists');

  const base = newRow(ctx.shopId, ctx.userId);
  const row: Category = {
    ...base,
    name: data.name,
    kind: 'expense',
  };
  db.insert(categories).values(row).run();
  return row;
}

function resolveCategoryName(
  db: AppDb,
  shopId: string,
  categoryId: string | null | undefined,
): { id: string | null; name: string } {
  if (!categoryId) return { id: null, name: 'Uncategorized' };
  const cat = db
    .select()
    .from(categories)
    .where(
      and(active(categories, shopId), eq(categories.id, categoryId), eq(categories.kind, 'expense')),
    )
    .get();
  if (!cat) throw new AppError('NOT_FOUND', 'Expense category not found');
  return { id: cat.id, name: cat.name };
}

export type ListExpensesOptions = {
  from?: number;
  to?: number;
  /** Pass a category id, or 'uncategorized' to show expenses without a category. */
  categoryId?: string | 'uncategorized';
  method?: Method;
  search?: string;
};

export function listExpenses(
  db: AppDb,
  shopId: string,
  opts: ListExpensesOptions = {},
): ExpenseListResult {
  const conds = [active(expenses, shopId)];
  if (opts.from !== undefined) conds.push(gte(expenses.date, opts.from));
  if (opts.to !== undefined) conds.push(lte(expenses.date, opts.to));
  if (opts.method !== undefined) conds.push(eq(expenses.method, opts.method));

  const rows = db
    .select()
    .from(expenses)
    .where(and(...conds))
    .orderBy(desc(expenses.date), desc(expenses.created_at))
    .all();

  const catMap = new Map<string, string>();
  for (const c of listExpenseCategories(db, shopId)) {
    catMap.set(c.id, c.name);
  }

  const q = opts.search?.trim().toLowerCase() ?? '';
  const items: ExpenseWithCategory[] = [];
  const summaryMap = new Map<string, ExpenseCategorySummary>();
  let total = 0;

  for (const row of rows) {
    const catName = (row.category_id && catMap.get(row.category_id)) || 'Uncategorized';
    const effectiveCatId = row.category_id && catMap.has(row.category_id) ? row.category_id : null;

    if (opts.categoryId === 'uncategorized' && effectiveCatId !== null) continue;
    if (
      opts.categoryId &&
      opts.categoryId !== 'uncategorized' &&
      effectiveCatId !== opts.categoryId
    ) {
      continue;
    }
    if (q) {
      const hay = `${catName} ${row.note ?? ''} ${row.method}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }

    items.push({ ...row, categoryName: catName });
    total += row.amount;

    const key = effectiveCatId ?? '__uncategorized__';
    const prev = summaryMap.get(key);
    if (prev) {
      prev.total += row.amount;
      prev.count += 1;
    } else {
      summaryMap.set(key, {
        categoryId: effectiveCatId,
        categoryName: catName,
        total: row.amount,
        count: 1,
      });
    }
  }

  const byCategory = Array.from(summaryMap.values()).sort((a, b) => b.total - a.total);
  return { items, total, byCategory };
}

/** Add an expense and deduct its amount from cashbox in one transaction. */
export function addExpense(
  db: AppDb,
  ctx: ExpenseContext,
  input: AddExpenseInput,
): ExpenseWithCategory {
  assertCan(ctx.role, 'addExpense');
  const data = parseOrThrow(addExpenseSchema, input);

  return db.transaction((tx) => {
    const cat = resolveCategoryName(tx, ctx.shopId, data.categoryId);
    const now = Date.now();
    const date = data.date ?? now;
    const note = cleanOpt(data.note);
    const base = newRow(ctx.shopId, ctx.userId, now);
    const created: Expense = {
      ...base,
      category_id: cat.id,
      amount: data.amount,
      date,
      method: data.method,
      note,
    };
    tx.insert(expenses).values(created).run();

    postCash(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      refId: base.id,
      date,
      amount: -data.amount,
      type: 'expense',
      method: data.method,
      note: note ?? cat.name,
    });

    return {
      ...created,
      categoryName: cat.name,
    };
  });
}

/** Update an expense and keep its cashbox entry synchronized in one transaction. */
export function updateExpense(
  db: AppDb,
  ctx: ExpenseContext,
  id: string,
  input: UpdateExpenseInput,
): ExpenseWithCategory {
  assertCan(ctx.role, 'delete');
  const data = parseOrThrow(updateExpenseSchema, input);

  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(expenses)
      .where(and(active(expenses, ctx.shopId), eq(expenses.id, id)))
      .get();
    if (!existing) throw new AppError('NOT_FOUND', 'Expense not found');

    const nextCatId = data.categoryId !== undefined ? data.categoryId : existing.category_id;
    const cat = resolveCategoryName(tx, ctx.shopId, nextCatId);
    const nextAmount = data.amount ?? existing.amount;
    const nextDate = data.date ?? existing.date;
    const nextMethod = data.method ?? existing.method;
    const nextNote = data.note !== undefined ? cleanOpt(data.note) : existing.note;
    const t = touch();

    tx.update(expenses)
      .set({
        ...t,
        category_id: cat.id,
        amount: nextAmount,
        date: nextDate,
        method: nextMethod,
        note: nextNote,
      })
      .where(and(active(expenses, ctx.shopId), eq(expenses.id, id)))
      .run();

    const cashRow = tx
      .select()
      .from(cash_entries)
      .where(and(active(cash_entries, ctx.shopId), eq(cash_entries.ref_id, id)))
      .get();

    if (cashRow) {
      tx.update(cash_entries)
        .set({
          ...t,
          amount: -nextAmount,
          date: nextDate,
          method: nextMethod,
          note: nextNote ?? cat.name,
        })
        .where(eq(cash_entries.id, cashRow.id))
        .run();
    } else {
      postCash(tx, {
        shopId: ctx.shopId,
        userId: ctx.userId,
        refId: id,
        date: nextDate,
        amount: -nextAmount,
        type: 'expense',
        method: nextMethod,
        note: nextNote ?? cat.name,
      });
    }

    return {
      ...existing,
      ...t,
      category_id: cat.id,
      amount: nextAmount,
      date: nextDate,
      method: nextMethod,
      note: nextNote,
      categoryName: cat.name,
    };
  });
}

/** Soft-delete an expense and reverse its cashbox outflow. */
export function deleteExpense(db: AppDb, ctx: ExpenseContext, id: string): void {
  assertCan(ctx.role, 'delete');
  db.transaction((tx) => {
    softDeleteWithRefs(tx, { shopId: ctx.shopId, table: expenses, id });
  });
}

/** Restore a soft-deleted expense and re-apply its cashbox outflow. */
export function restoreExpense(db: AppDb, ctx: ExpenseContext, id: string): void {
  assertCan(ctx.role, 'restore');
  db.transaction((tx) => {
    restoreWithRefs(tx, { shopId: ctx.shopId, table: expenses, id });
  });
}
