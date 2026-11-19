/** @jest-environment node */
import { createTestDb } from '@/test/testDb';
import {
  addManualCash,
  deleteManualCash,
  getCashBalance,
  getCashMethodBreakdown,
  listCashEntries,
  restoreManualCash,
  type CashContext,
} from './cash';
import { postCash } from './posting';

const ownerCtx: CashContext = { shopId: 'shop1', userId: 'u-owner', role: 'owner' };
const managerCtx: CashContext = { shopId: 'shop1', userId: 'u-mgr', role: 'manager' };
const cashierCtx: CashContext = { shopId: 'shop1', userId: 'u-cashier', role: 'cashier' };

describe('cash service', () => {
  it('records manual cash in/out, derives balance & method breakdown, filters entries', () => {
    const db = createTestDb();
    addManualCash(db, ownerCtx, {
      direction: 'in',
      amount: 100000,
      method: 'cash',
      date: 1000,
      note: 'Opening float',
    });
    addManualCash(db, managerCtx, {
      direction: 'out',
      amount: 25000,
      method: 'cash',
      date: 2000,
      note: 'Petty cash',
    });
    addManualCash(db, ownerCtx, {
      direction: 'in',
      amount: 50000,
      method: 'bkash',
      date: 3000,
    });
    // Another shop's cash should never affect shop1
    addManualCash(db, { shopId: 'shop2', userId: 'u2', role: 'owner' }, {
      direction: 'in',
      amount: 99900,
      method: 'cash',
      date: 1000,
    });

    expect(getCashBalance(db, 'shop1')).toBe(125000);
    expect(getCashBalance(db, 'shop1', { method: 'cash' })).toBe(75000);
    expect(getCashBalance(db, 'shop1', { method: 'bkash' })).toBe(50000);

    const breakdown = getCashMethodBreakdown(db, 'shop1');
    expect(breakdown.cash).toEqual({ balance: 75000, totalIn: 100000, totalOut: 25000 });
    expect(breakdown.bkash).toEqual({ balance: 50000, totalIn: 50000, totalOut: 0 });
    expect(breakdown.nagad).toEqual({ balance: 0, totalIn: 0, totalOut: 0 });

    const ranged = listCashEntries(db, 'shop1', { from: 2000, to: 3000 });
    expect(ranged.openingBalance).toBe(100000);
    expect(ranged.totalIn).toBe(50000);
    expect(ranged.totalOut).toBe(25000);
    expect(ranged.net).toBe(25000);
    expect(ranged.closingBalance).toBe(125000);
    expect(ranged.entries).toHaveLength(2);

    expect(listCashEntries(db, 'shop1', { direction: 'out' }).entries).toHaveLength(1);
    expect(listCashEntries(db, 'shop1', { method: 'bkash' }).entries).toHaveLength(1);
  });

  it('rejects cashier permissions and invalid amounts', () => {
    const db = createTestDb();
    expect(() =>
      addManualCash(db, cashierCtx, { direction: 'in', amount: 1000, method: 'cash' }),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() =>
      addManualCash(db, ownerCtx, { direction: 'in', amount: 0, method: 'cash' }),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    expect(() =>
      addManualCash(db, ownerCtx, { direction: 'out', amount: -500, method: 'cash' }),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    expect(() =>
      addManualCash(db, ownerCtx, { direction: 'in', amount: 12.5, method: 'cash' }),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
  });

  it('deletes and restores manual cash entries and blocks deleting linked/sale cash entries', () => {
    const db = createTestDb();
    const manual = addManualCash(db, ownerCtx, {
      direction: 'in',
      amount: 40000,
      method: 'cash',
      date: 1000,
    });
    expect(getCashBalance(db, 'shop1')).toBe(40000);

    expect(() => deleteManualCash(db, cashierCtx, manual.id)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );

    deleteManualCash(db, ownerCtx, manual.id);
    expect(getCashBalance(db, 'shop1')).toBe(0);

    restoreManualCash(db, ownerCtx, manual.id);
    expect(getCashBalance(db, 'shop1')).toBe(40000);

    const saleCashId = postCash(db, {
      shopId: 'shop1',
      userId: 'u-owner',
      refId: 'sale-1',
      date: 2000,
      amount: 10000,
      type: 'sale',
      method: 'cash',
    });
    expect(() => deleteManualCash(db, ownerCtx, saleCashId ?? '')).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
  });
});
