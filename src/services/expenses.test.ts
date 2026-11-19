/** @jest-environment node */
import { AppError } from '@/lib/errors';
import { createTestDb } from '@/test/testDb';
import { getCashBalance } from './cash';
import {
  addExpense,
  createExpenseCategory,
  deleteExpense,
  listExpenseCategories,
  listExpenses,
  restoreExpense,
  updateExpense,
  type ExpenseContext,
} from './expenses';

const ownerCtx: ExpenseContext = { shopId: 'shop1', userId: 'u-owner', role: 'owner' };
const cashierCtx: ExpenseContext = { shopId: 'shop1', userId: 'u-cashier', role: 'cashier' };
const otherCtx: ExpenseContext = { shopId: 'shop2', userId: 'u-other', role: 'owner' };

describe('expenses service', () => {
  it('creates categories, prevents duplicates, and lists sorted', () => {
    const db = createTestDb();
    const rent = createExpenseCategory(db, ownerCtx, 'Rent');
    const util = createExpenseCategory(db, cashierCtx, 'Electricity');
    expect(rent.kind).toBe('expense');
    expect(util.name).toBe('Electricity');
    expect(listExpenseCategories(db, 'shop1').map((c) => c.name)).toEqual(['Electricity', 'Rent']);

    expect(() => createExpenseCategory(db, ownerCtx, 'rent')).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
    expect(() => createExpenseCategory(db, ownerCtx, '  ')).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
  });

  it('adds expense, deducts cashbox, filters & summarizes by category', () => {
    const db = createTestDb();
    const cat = createExpenseCategory(db, ownerCtx, 'Transport');

    const e1 = addExpense(db, cashierCtx, {
      amount: 15000,
      categoryId: cat.id,
      method: 'cash',
      date: 1000,
      note: 'Rickshaw',
    });
    const e2 = addExpense(db, ownerCtx, {
      amount: 50000,
      categoryId: null,
      method: 'bkash',
      date: 2000,
      note: 'Snacks',
    });
    addExpense(db, otherCtx, { amount: 99900, date: 1500 });

    expect(e1.categoryName).toBe('Transport');
    expect(e2.categoryName).toBe('Uncategorized');
    expect(getCashBalance(db, 'shop1')).toBe(-65000);
    expect(getCashBalance(db, 'shop1', { method: 'bkash' })).toBe(-50000);

    const all = listExpenses(db, 'shop1');
    expect(all.total).toBe(65000);
    expect(all.items).toHaveLength(2);
    expect(all.byCategory[0]?.categoryName).toBe('Uncategorized');

    expect(listExpenses(db, 'shop1', { categoryId: cat.id }).total).toBe(15000);
    expect(listExpenses(db, 'shop1', { categoryId: 'uncategorized' }).total).toBe(50000);
    expect(listExpenses(db, 'shop1', { from: 1500, to: 2500 }).items).toHaveLength(1);
    expect(listExpenses(db, 'shop1', { search: 'rick' }).items).toHaveLength(1);
  });

  it('rejects zero/negative/fractional amounts and unknown category', () => {
    const db = createTestDb();
    expect(() => addExpense(db, ownerCtx, { amount: 0 })).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
    expect(() => addExpense(db, ownerCtx, { amount: -100 })).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
    expect(() => addExpense(db, ownerCtx, { amount: 12.3 })).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
    expect(() => addExpense(db, ownerCtx, { amount: 500, categoryId: 'nope' })).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('updates expense and syncs linked cash entry; blocks cashier edit/delete', () => {
    const db = createTestDb();
    const cat = createExpenseCategory(db, ownerCtx, 'Tea');
    const exp = addExpense(db, ownerCtx, {
      amount: 10000,
      categoryId: cat.id,
      method: 'cash',
      date: 1000,
    });
    expect(getCashBalance(db, 'shop1')).toBe(-10000);

    expect(() => updateExpense(db, cashierCtx, exp.id, { amount: 20000 })).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );

    const updated = updateExpense(db, ownerCtx, exp.id, {
      amount: 25000,
      method: 'nagad',
      note: 'Updated tea',
    });
    expect(updated.amount).toBe(25000);
    expect(getCashBalance(db, 'shop1', { method: 'cash' })).toBe(0);
    expect(getCashBalance(db, 'shop1', { method: 'nagad' })).toBe(-25000);
  });

  it('delete reverses cashbox outflow and restore re-applies it', () => {
    const db = createTestDb();
    const exp = addExpense(db, ownerCtx, { amount: 30000, method: 'cash', date: 1000 });
    expect(getCashBalance(db, 'shop1')).toBe(-30000);

    expect(() => deleteExpense(db, cashierCtx, exp.id)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );

    deleteExpense(db, ownerCtx, exp.id);
    expect(getCashBalance(db, 'shop1')).toBe(0);
    expect(listExpenses(db, 'shop1').items).toHaveLength(0);

    restoreExpense(db, ownerCtx, exp.id);
    expect(getCashBalance(db, 'shop1')).toBe(-30000);
    expect(listExpenses(db, 'shop1').items).toHaveLength(1);
    expect(() => restoreExpense(db, ownerCtx, exp.id)).toThrow(AppError);
  });
});
