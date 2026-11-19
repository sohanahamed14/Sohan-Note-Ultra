import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { active, newRow, softDelete, touch } from '@/db/helpers';
import { parties, party_ledger, type Party, type Role } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { can, type Action } from './permissions';
import { postLedger } from './posting';

export const PARTY_TYPES = ['customer', 'supplier', 'employee'] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export type PartyContext = {
  shopId: string;
  userId: string | null;
  role: Role;
};

export type PartyWithBalance = Party & {
  /** Signed paisa: + they owe us (receivable), − we owe them (payable). */
  balance: number;
};

export type DueSummary = {
  totalReceivable: number;
  totalPayable: number;
  netBalance: number;
  count: number;
};

const safeIntPaisa = z
  .number()
  .int('Amount must be whole paisa')
  .refine(Number.isSafeInteger, 'Amount out of range');

const epochMs = z
  .number()
  .int('Invalid date')
  .refine(Number.isSafeInteger, 'Invalid date');

export const createPartySchema = z.object({
  type: z.enum(PARTY_TYPES),
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
  phone: z.string().trim().max(30, 'Phone is too long').optional().nullable(),
  address: z.string().trim().max(300, 'Address is too long').optional().nullable(),
  note: z.string().trim().max(500, 'Note is too long').optional().nullable(),
  openingBalance: safeIntPaisa.optional().default(0),
  openingDate: epochMs.optional(),
});

export const updatePartySchema = z.object({
  type: z.enum(PARTY_TYPES).optional(),
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long').optional(),
  phone: z.string().trim().max(30, 'Phone is too long').optional().nullable(),
  address: z.string().trim().max(300, 'Address is too long').optional().nullable(),
  note: z.string().trim().max(500, 'Note is too long').optional().nullable(),
});

export type CreatePartyInput = z.input<typeof createPartySchema>;
export type UpdatePartyInput = z.input<typeof updatePartySchema>;

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

/** Derived party balance (paisa): + they owe us, − we owe them. */
export function getPartyBalance(db: AppDb, shopId: string, partyId: string): number {
  const row = db
    .select({ total: sql<number>`COALESCE(SUM(${party_ledger.amount}), 0)` })
    .from(party_ledger)
    .where(and(active(party_ledger, shopId), eq(party_ledger.party_id, partyId)))
    .get();
  return Number(row?.total ?? 0);
}

function getBalanceMap(db: AppDb, shopId: string): Map<string, number> {
  const rows = db
    .select({
      partyId: party_ledger.party_id,
      total: sql<number>`COALESCE(SUM(${party_ledger.amount}), 0)`,
    })
    .from(party_ledger)
    .where(active(party_ledger, shopId))
    .groupBy(party_ledger.party_id)
    .all();
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.partyId, Number(r.total ?? 0));
  }
  return map;
}

export function getPartyById(
  db: AppDb,
  shopId: string,
  partyId: string,
): PartyWithBalance | null {
  const row = db
    .select()
    .from(parties)
    .where(and(active(parties, shopId), eq(parties.id, partyId)))
    .get();
  if (!row) return null;
  return { ...row, balance: getPartyBalance(db, shopId, partyId) };
}

export type ListPartiesOptions = {
  type?: PartyType;
  search?: string;
  onlyWithDue?: boolean;
  direction?: 'receivable' | 'payable';
};

/** Lists active parties with derived ledger balances. */
export function listParties(
  db: AppDb,
  shopId: string,
  opts: ListPartiesOptions = {},
): PartyWithBalance[] {
  const cond = opts.type
    ? and(active(parties, shopId), eq(parties.type, opts.type))
    : active(parties, shopId);
  const rows = db.select().from(parties).where(cond).all();
  const balances = getBalanceMap(db, shopId);
  const q = opts.search?.trim().toLowerCase() ?? '';

  const list: PartyWithBalance[] = [];
  for (const row of rows) {
    const balance = balances.get(row.id) ?? 0;
    if (opts.onlyWithDue && balance === 0) continue;
    if (opts.direction === 'receivable' && balance <= 0) continue;
    if (opts.direction === 'payable' && balance >= 0) continue;
    if (q) {
      const hay = `${row.name} ${row.phone ?? ''}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    list.push({ ...row, balance });
  }

  const sortByAmount = Boolean(opts.onlyWithDue || opts.direction);
  list.sort((a, b) => {
    if (sortByAmount) {
      const diff = Math.abs(b.balance) - Math.abs(a.balance);
      if (diff !== 0) return diff;
    }
    return a.name.localeCompare(b.name);
  });
  return list;
}

export function getDueSummary(db: AppDb, shopId: string, type?: PartyType): DueSummary {
  const list = listParties(db, shopId, type ? { type } : undefined);
  let totalReceivable = 0;
  let totalPayable = 0;
  let count = 0;
  for (const p of list) {
    if (p.balance > 0) {
      totalReceivable += p.balance;
      count += 1;
    } else if (p.balance < 0) {
      totalPayable += -p.balance;
      count += 1;
    }
  }
  return {
    totalReceivable,
    totalPayable,
    netBalance: totalReceivable - totalPayable,
    count,
  };
}

export function createParty(
  db: AppDb,
  ctx: PartyContext,
  input: CreatePartyInput,
): PartyWithBalance {
  assertCan(ctx.role, 'manageParties');
  const data = parseOrThrow(createPartySchema, input);

  return db.transaction((tx) => {
    const now = Date.now();
    const base = newRow(ctx.shopId, ctx.userId, now);
    const created: Party = {
      ...base,
      type: data.type,
      name: data.name,
      phone: cleanOpt(data.phone),
      address: cleanOpt(data.address),
      note: cleanOpt(data.note),
    };
    tx.insert(parties).values(created).run();

    if (data.openingBalance !== 0) {
      postLedger(tx, {
        shopId: ctx.shopId,
        userId: ctx.userId,
        refId: null,
        partyId: base.id,
        amount: data.openingBalance,
        type: 'opening',
        date: data.openingDate ?? now,
        note: 'Opening balance',
      });
    }

    return {
      ...created,
      balance: data.openingBalance,
    };
  });
}

export function updateParty(
  db: AppDb,
  ctx: PartyContext,
  id: string,
  input: UpdatePartyInput,
): PartyWithBalance {
  assertCan(ctx.role, 'manageParties');
  const data = parseOrThrow(updatePartySchema, input);
  const existing = db
    .select()
    .from(parties)
    .where(and(active(parties, ctx.shopId), eq(parties.id, id)))
    .get();
  if (!existing) throw new AppError('NOT_FOUND', 'Contact not found');

  const patch: Partial<typeof parties.$inferInsert> = { ...touch() };
  if (data.type !== undefined) patch.type = data.type;
  if (data.name !== undefined) patch.name = data.name;
  if (data.phone !== undefined) patch.phone = cleanOpt(data.phone);
  if (data.address !== undefined) patch.address = cleanOpt(data.address);
  if (data.note !== undefined) patch.note = cleanOpt(data.note);

  db.update(parties)
    .set(patch)
    .where(and(active(parties, ctx.shopId), eq(parties.id, id)))
    .run();

  const updated = getPartyById(db, ctx.shopId, id);
  if (!updated) throw new AppError('NOT_FOUND', 'Contact not found');
  return updated;
}

export function deleteParty(db: AppDb, ctx: PartyContext, id: string): void {
  assertCan(ctx.role, 'delete');
  const existing = getPartyById(db, ctx.shopId, id);
  if (!existing) throw new AppError('NOT_FOUND', 'Contact not found');
  if (existing.balance !== 0) {
    throw new AppError('CONFLICT', 'Settle this contact balance before deleting');
  }
  softDelete(db, parties, ctx.shopId, id);
}

export function restoreParty(db: AppDb, ctx: PartyContext, id: string): PartyWithBalance {
  assertCan(ctx.role, 'restore');
  const row = db
    .select()
    .from(parties)
    .where(and(eq(parties.shop_id, ctx.shopId), eq(parties.id, id)))
    .get();
  if (!row) throw new AppError('NOT_FOUND', 'Contact not found');
  if (row.deleted_at === null) throw new AppError('CONFLICT', 'Contact is not deleted');

  db.update(parties)
    .set({ deleted_at: null, ...touch() })
    .where(and(eq(parties.shop_id, ctx.shopId), eq(parties.id, id)))
    .run();

  const restored = getPartyById(db, ctx.shopId, id);
  if (!restored) throw new AppError('NOT_FOUND', 'Contact not found');
  return restored;
}
