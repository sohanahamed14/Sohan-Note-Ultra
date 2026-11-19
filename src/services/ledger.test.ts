/** @jest-environment node */
import { createTestDb } from '@/test/testDb';
import { getCashBalance } from './cash';
import {
  buildSmsUrl,
  buildStatementHtml,
  buildStatementText,
  buildWhatsAppUrl,
  collectDue,
  deleteLedgerEntry,
  listPartyLedger,
  normalizeBdPhone,
  payDue,
  recordGive,
  recordTake,
  restoreLedgerEntry,
  type LedgerContext,
} from './ledger';
import { createParty, getPartyBalance } from './parties';
import { postLedger } from './posting';

const ownerCtx: LedgerContext = { shopId: 'shop1', userId: 'u-owner', role: 'owner' };
const cashierCtx: LedgerContext = { shopId: 'shop1', userId: 'u-cashier', role: 'cashier' };

describe('ledger service', () => {
  it('records Give and Take with and without cashbox impact and computes running balance', () => {
    const db = createTestDb();
    const cust = createParty(db, ownerCtx, { type: 'customer', name: 'Salma' });

    const r1 = recordGive(db, cashierCtx, {
      partyId: cust.id,
      amount: 100000,
      method: 'cash',
      date: 1000,
      note: 'Loan',
      affectCash: true,
    });
    expect(r1.balance).toBe(100000);
    expect(r1.cashId).not.toBeNull();
    expect(getCashBalance(db, 'shop1')).toBe(-100000);

    const r2 = recordTake(db, cashierCtx, {
      partyId: cust.id,
      amount: 40000,
      method: 'bkash',
      date: 2000,
      note: 'Part return',
      affectCash: true,
    });
    expect(r2.balance).toBe(60000);
    expect(getCashBalance(db, 'shop1')).toBe(-60000);

    // Non-cash credit adjustment
    const r3 = recordGive(db, ownerCtx, {
      partyId: cust.id,
      amount: 10000,
      date: 3000,
      affectCash: false,
    });
    expect(r3.cashId).toBeNull();
    expect(r3.balance).toBe(70000);
    expect(getCashBalance(db, 'shop1')).toBe(-60000);

    const led = listPartyLedger(db, 'shop1', cust.id, { order: 'asc' });
    expect(led.openingBalance).toBe(0);
    expect(led.closingBalance).toBe(70000);
    expect(led.totalGiven).toBe(110000);
    expect(led.totalTaken).toBe(40000);
    expect(led.entries.map((e) => e.runningBalance)).toEqual([100000, 60000, 70000]);
    expect(led.entries[1]?.method).toBe('bkash');
    expect(led.entries[2]?.method).toBeNull();

    // Filtered range preserves opening balance before `from`
    const ranged = listPartyLedger(db, 'shop1', cust.id, { from: 2000, to: 3000, order: 'asc' });
    expect(ranged.openingBalance).toBe(100000);
    expect(ranged.closingBalance).toBe(70000);
    expect(ranged.entries).toHaveLength(2);
    expect(ranged.entries[0]?.runningBalance).toBe(60000);
  });

  it('rejects zero, negative, fractional amounts and missing party', () => {
    const db = createTestDb();
    const cust = createParty(db, ownerCtx, { type: 'customer', name: 'Test' });

    expect(() => recordGive(db, ownerCtx, { partyId: cust.id, amount: 0 })).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
    expect(() => recordTake(db, ownerCtx, { partyId: cust.id, amount: -500 })).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
    expect(() => recordGive(db, ownerCtx, { partyId: cust.id, amount: 10.5 })).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
    expect(() => recordGive(db, ownerCtx, { partyId: 'missing', amount: 1000 })).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('collectDue supports partial & full pay and rejects overpay', () => {
    const db = createTestDb();
    const cust = createParty(db, ownerCtx, {
      type: 'customer',
      name: 'Buyer',
      openingBalance: 50000,
    });

    // Overpay rejected
    expect(() =>
      collectDue(db, cashierCtx, { partyId: cust.id, amount: 60000, method: 'cash' }),
    ).toThrow(expect.objectContaining({ code: 'OVERPAY' }));
    expect(getPartyBalance(db, 'shop1', cust.id)).toBe(50000);

    // Partial collect
    const partial = collectDue(db, cashierCtx, {
      partyId: cust.id,
      amount: 20000,
      method: 'nagad',
    });
    expect(partial.balance).toBe(30000);
    expect(getCashBalance(db, 'shop1', { method: 'nagad' })).toBe(20000);

    // Full remaining collect
    const full = collectDue(db, cashierCtx, { partyId: cust.id, amount: 30000, method: 'cash' });
    expect(full.balance).toBe(0);
    expect(getCashBalance(db, 'shop1')).toBe(50000);

    // Collecting when settled is rejected as OVERPAY
    expect(() => collectDue(db, ownerCtx, { partyId: cust.id, amount: 100 })).toThrow(
      expect.objectContaining({ code: 'OVERPAY' }),
    );
  });

  it('payDue supports partial & full supplier payment and rejects overpay', () => {
    const db = createTestDb();
    const sup = createParty(db, ownerCtx, {
      type: 'supplier',
      name: 'Dealer',
      openingBalance: -80000,
    });

    expect(() => payDue(db, ownerCtx, { partyId: sup.id, amount: 90000 })).toThrow(
      expect.objectContaining({ code: 'OVERPAY' }),
    );

    const p1 = payDue(db, ownerCtx, { partyId: sup.id, amount: 30000, method: 'bank' });
    expect(p1.balance).toBe(-50000);
    expect(getCashBalance(db, 'shop1', { method: 'bank' })).toBe(-30000);

    const p2 = payDue(db, ownerCtx, { partyId: sup.id, amount: 50000, method: 'cash' });
    expect(p2.balance).toBe(0);
    expect(getCashBalance(db, 'shop1')).toBe(-80000);
  });

  it('delete reverses both ledger and cash, restore re-applies, blocks cashier & sale-linked rows', () => {
    const db = createTestDb();
    const cust = createParty(db, ownerCtx, {
      type: 'customer',
      name: 'Reversal Cust',
      openingBalance: 50000,
    });

    const collected = collectDue(db, ownerCtx, { partyId: cust.id, amount: 20000, method: 'cash' });
    expect(getPartyBalance(db, 'shop1', cust.id)).toBe(30000);
    expect(getCashBalance(db, 'shop1')).toBe(20000);

    // Cashier forbidden
    expect(() => deleteLedgerEntry(db, cashierCtx, collected.ledgerId)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );

    // Delete reverses both
    deleteLedgerEntry(db, ownerCtx, collected.ledgerId);
    expect(getPartyBalance(db, 'shop1', cust.id)).toBe(50000);
    expect(getCashBalance(db, 'shop1')).toBe(0);

    // Restore re-applies both
    restoreLedgerEntry(db, ownerCtx, collected.ledgerId);
    expect(getPartyBalance(db, 'shop1', cust.id)).toBe(30000);
    expect(getCashBalance(db, 'shop1')).toBe(20000);

    // Sale-linked ledger row cannot be deleted directly from party ledger
    const saleLedgerId = postLedger(db, {
      shopId: 'shop1',
      userId: 'u-owner',
      refId: 'sale-123',
      partyId: cust.id,
      amount: 10000,
      type: 'sale_due',
      date: Date.now(),
    });
    expect(() => deleteLedgerEntry(db, ownerCtx, saleLedgerId ?? '')).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
  });

  it('builds phone normalization, WhatsApp/SMS URLs, statement text, and escaped HTML', () => {
    expect(normalizeBdPhone('01711-223344')).toBe('8801711223344');
    expect(normalizeBdPhone('+880 1811 223344')).toBe('8801811223344');

    const msg = buildStatementText({
      shopName: 'Sohan Store',
      shopPhone: '01700000000',
      party: { name: 'A <B>', phone: '01711223344' },
      balance: 25000,
      entries: [],
    });
    expect(msg).toContain('Sohan Store');
    expect(msg).toContain('৳ 250');

    expect(buildWhatsAppUrl('01711223344', 'Hi')).toBe('https://wa.me/8801711223344?text=Hi');
    expect(buildWhatsAppUrl(null, 'Hi')).toBe('https://wa.me/?text=Hi');
    expect(buildSmsUrl('01711-223344', 'Hi')).toBe('sms:01711223344?body=Hi');

    const html = buildStatementHtml({
      shop: { name: 'Shop <1>', phone: '017', address: 'Dhaka' },
      party: { name: 'Client & Co', type: 'customer', phone: '018', address: null },
      openingBalance: 0,
      closingBalance: 25000,
      totalGiven: 25000,
      totalTaken: 0,
      entries: [],
    });
    expect(html).toContain('Shop &lt;1&gt;');
    expect(html).toContain('Client &amp; Co');
  });
});
