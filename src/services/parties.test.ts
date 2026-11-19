/** @jest-environment node */
import { AppError } from '@/lib/errors';
import { createTestDb } from '@/test/testDb';
import {
  createParty,
  deleteParty,
  getDueSummary,
  getPartyBalance,
  getPartyById,
  listParties,
  restoreParty,
  updateParty,
  type PartyContext,
} from './parties';
import { postLedger } from './posting';

const ownerCtx: PartyContext = { shopId: 'shop1', userId: 'u-owner', role: 'owner' };
const cashierCtx: PartyContext = { shopId: 'shop1', userId: 'u-cashier', role: 'cashier' };
const otherShopCtx: PartyContext = { shopId: 'shop2', userId: 'u-other', role: 'owner' };

describe('parties service', () => {
  it('creates party with optional opening balance and derives balance', () => {
    const db = createTestDb();
    const cust = createParty(db, ownerCtx, {
      type: 'customer',
      name: '  Rahim Traders ',
      phone: '01711000001',
      address: 'Dhaka',
      openingBalance: 150000,
    });
    expect(cust.name).toBe('Rahim Traders');
    expect(cust.balance).toBe(150000);
    expect(getPartyBalance(db, 'shop1', cust.id)).toBe(150000);
    expect(getPartyById(db, 'shop1', cust.id)?.balance).toBe(150000);
    expect(getPartyById(db, 'shop2', cust.id)).toBeNull();

    const sup = createParty(db, cashierCtx, {
      type: 'supplier',
      name: 'Karim Wholesale',
      openingBalance: -50000,
    });
    expect(sup.balance).toBe(-50000);
    expect(getPartyBalance(db, 'shop1', sup.id)).toBe(-50000);
  });

  it('creates party with zero opening balance without inserting ledger row', () => {
    const db = createTestDb();
    const p = createParty(db, ownerCtx, { type: 'employee', name: 'Hasan', openingBalance: 0 });
    expect(p.balance).toBe(0);
    expect(getPartyBalance(db, 'shop1', p.id)).toBe(0);
  });

  it('validates party inputs (empty name, fractional paisa)', () => {
    const db = createTestDb();
    expect(() => createParty(db, ownerCtx, { type: 'customer', name: '   ' })).toThrow(AppError);
    expect(() =>
      createParty(db, ownerCtx, { type: 'customer', name: 'Bad', openingBalance: 12.5 }),
    ).toThrow(AppError);
  });

  it('lists parties with type, search, onlyWithDue, direction filters and isolates shops', () => {
    const db = createTestDb();
    createParty(db, ownerCtx, {
      type: 'customer',
      name: 'Alpha',
      phone: '01710000001',
      openingBalance: 20000,
    });
    createParty(db, ownerCtx, {
      type: 'customer',
      name: 'Beta',
      phone: '01810000002',
      openingBalance: 0,
    });
    createParty(db, ownerCtx, {
      type: 'customer',
      name: 'Gamma',
      phone: '01910000003',
      openingBalance: -10000,
    });
    createParty(db, ownerCtx, {
      type: 'supplier',
      name: 'Delta Sup',
      openingBalance: -80000,
    });
    createParty(db, otherShopCtx, {
      type: 'customer',
      name: 'Alpha',
      openingBalance: 99900,
    });

    expect(listParties(db, 'shop1', { type: 'customer' }).map((p) => p.name)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
    expect(listParties(db, 'shop1', { type: 'customer', onlyWithDue: true }).map((p) => p.name)).toEqual([
      'Alpha',
      'Gamma',
    ]);
    expect(listParties(db, 'shop1', { direction: 'receivable' }).map((p) => p.name)).toEqual([
      'Alpha',
    ]);
    expect(listParties(db, 'shop1', { direction: 'payable' }).map((p) => p.name)).toEqual([
      'Delta Sup',
      'Gamma',
    ]);
    expect(listParties(db, 'shop1', { search: '01810' }).map((p) => p.name)).toEqual(['Beta']);

    const summary = getDueSummary(db, 'shop1', 'customer');
    expect(summary).toEqual({
      totalReceivable: 20000,
      totalPayable: 10000,
      netBalance: 10000,
      count: 2,
    });
  });

  it('updates party fields and throws NOT_FOUND for missing party', () => {
    const db = createTestDb();
    const p = createParty(db, ownerCtx, { type: 'customer', name: 'Old Name', phone: '01700000000' });
    const updated = updateParty(db, cashierCtx, p.id, {
      name: 'New Name',
      phone: ' ',
      note: 'VIP',
    });
    expect(updated.name).toBe('New Name');
    expect(updated.phone).toBeNull();
    expect(updated.note).toBe('VIP');

    expect(() => updateParty(db, ownerCtx, 'missing', { name: 'X' })).toThrow(AppError);
  });

  it('blocks deleting non-zero balance party, blocks cashier delete, and supports delete + restore', () => {
    const db = createTestDb();
    const p = createParty(db, ownerCtx, {
      type: 'customer',
      name: 'Due Cust',
      openingBalance: 5000,
    });

    expect(() => deleteParty(db, cashierCtx, p.id)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
    expect(() => deleteParty(db, ownerCtx, p.id)).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    );

    // Settle balance to 0
    postLedger(db, {
      shopId: 'shop1',
      userId: 'u-owner',
      refId: null,
      partyId: p.id,
      amount: -5000,
      type: 'received',
      date: Date.now(),
    });
    expect(getPartyBalance(db, 'shop1', p.id)).toBe(0);

    deleteParty(db, ownerCtx, p.id);
    expect(getPartyById(db, 'shop1', p.id)).toBeNull();
    expect(listParties(db, 'shop1')).toHaveLength(0);

    expect(() => restoreParty(db, cashierCtx, p.id)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
    const restored = restoreParty(db, ownerCtx, p.id);
    expect(restored.id).toBe(p.id);
    expect(listParties(db, 'shop1')).toHaveLength(1);
    expect(() => restoreParty(db, ownerCtx, p.id)).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
  });
});
