/** @jest-environment node */
import { createTestDb } from '@/test/testDb';
import {
  deleteCapitalEntry,
  getCapitalSummary,
  investCapital,
  listCapitalEntries,
  restoreCapitalEntry,
  withdrawCapital,
  type CapitalContext,
} from './capital';
import { addManualCash, getCashBalance } from './cash';

const ownerCtx: CapitalContext = { shopId: 'shop1', userId: 'u-owner', role: 'owner' };
const managerCtx: CapitalContext = { shopId: 'shop1', userId: 'u-mgr', role: 'manager' };
const cashierCtx: CapitalContext = { shopId: 'shop1', userId: 'u-cashier', role: 'cashier' };

describe('capital service', () => {
  it('invests and partially withdraws capital, updates cashbox, and rejects over-withdrawal', () => {
    const db = createTestDb();
    const c1 = investCapital(db, ownerCtx, {
      amount: 500000,
      method: 'bank',
      date: 1000,
      note: 'Initial seed',
    });
    expect(c1.type).toBe('capital_in');
    expect(getCapitalSummary(db, 'shop1')).toEqual({
      totalCapital: 500000,
      totalInvested: 500000,
      totalWithdrawn: 0,
      count: 1,
    });
    expect(getCashBalance(db, 'shop1', { method: 'bank' })).toBe(500000);

    // Over-withdrawal rejected with OVERPAY
    expect(() =>
      withdrawCapital(db, ownerCtx, { amount: 600000, method: 'bank', date: 2000 }),
    ).toThrow(expect.objectContaining({ code: 'OVERPAY' }));

    // Partial withdrawal
    const w1 = withdrawCapital(db, managerCtx, {
      amount: 150000,
      method: 'cash',
      date: 2000,
      note: 'Owner draw',
    });
    expect(w1.amount).toBe(-150000);
    expect(getCapitalSummary(db, 'shop1')).toEqual({
      totalCapital: 350000,
      totalInvested: 500000,
      totalWithdrawn: 150000,
      count: 2,
    });
    expect(getCashBalance(db, 'shop1')).toBe(350000);
    expect(listCapitalEntries(db, 'shop1', { type: 'capital_out' })).toHaveLength(1);
  });

  it('rejects cashier access and invalid amounts', () => {
    const db = createTestDb();
    expect(() => investCapital(db, cashierCtx, { amount: 10000 })).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
    expect(() => withdrawCapital(db, cashierCtx, { amount: 1000 })).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
    expect(() => investCapital(db, ownerCtx, { amount: 0 })).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
    expect(() => investCapital(db, ownerCtx, { amount: -100 })).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
    expect(() => withdrawCapital(db, ownerCtx, { amount: 500 })).toThrow(
      expect.objectContaining({ code: 'OVERPAY' }),
    );
  });

  it('delete and restore reverse and re-apply capital & cashbox, and reject non-capital rows', () => {
    const db = createTestDb();
    const inv = investCapital(db, ownerCtx, { amount: 200000, method: 'cash', date: 1000 });
    const w = withdrawCapital(db, ownerCtx, { amount: 50000, method: 'cash', date: 2000 });
    expect(getCapitalSummary(db, 'shop1').totalCapital).toBe(150000);
    expect(getCashBalance(db, 'shop1')).toBe(150000);

    expect(() => deleteCapitalEntry(db, cashierCtx, w.id)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );

    deleteCapitalEntry(db, ownerCtx, w.id);
    expect(getCapitalSummary(db, 'shop1').totalCapital).toBe(200000);
    expect(getCashBalance(db, 'shop1')).toBe(200000);

    restoreCapitalEntry(db, ownerCtx, w.id);
    expect(getCapitalSummary(db, 'shop1').totalCapital).toBe(150000);
    expect(getCashBalance(db, 'shop1')).toBe(150000);

    // Non-capital cash entry cannot be deleted via capital service
    const manual = addManualCash(db, ownerCtx, { direction: 'in', amount: 1000, method: 'cash' });
    expect(() => deleteCapitalEntry(db, ownerCtx, manual.id)).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
    expect(inv.id).toBeTruthy();
  });
});
