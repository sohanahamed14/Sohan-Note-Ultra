import { and, asc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { active } from '@/db/helpers';
import {
  cash_entries,
  METHODS,
  parties,
  party_ledger,
  type LedgerEntry,
  type Method,
  type Party,
  type Role,
  type Shop,
} from '@/db/schema';
import type { AppDb } from '@/db/types';
import { formatDate, formatDateTime } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { formatTaka } from '@/lib/money';
import { getPartyBalance } from './parties';
import { can, type Action } from './permissions';
import { postCash, postLedger, restoreWithRefs, softDeleteWithRefs } from './posting';

export type LedgerContext = {
  shopId: string;
  userId: string | null;
  role: Role;
};

export type LedgerEntryWithBalance = LedgerEntry & {
  runningBalance: number;
  method: Method | null;
};

export type PartyLedgerResult = {
  entries: LedgerEntryWithBalance[];
  openingBalance: number;
  closingBalance: number;
  totalGiven: number;
  totalTaken: number;
};

export type LedgerMutationResult = {
  ledgerId: string;
  cashId: string | null;
  balance: number;
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

export const giveTakeSchema = z.object({
  partyId: z.string().min(1, 'Party is required'),
  amount: positivePaisa,
  method: z.enum(METHODS).default('cash'),
  date: epochMs.optional(),
  note: z.string().trim().max(300, 'Note is too long').optional().nullable(),
  affectCash: z.boolean().default(true),
});

export const settleDueSchema = z.object({
  partyId: z.string().min(1, 'Party is required'),
  amount: positivePaisa,
  method: z.enum(METHODS).default('cash'),
  date: epochMs.optional(),
  note: z.string().trim().max(300, 'Note is too long').optional().nullable(),
});

export type GiveTakeInput = z.input<typeof giveTakeSchema>;
export type SettleDueInput = z.input<typeof settleDueSchema>;

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

function cleanNote(v: string | null | undefined): string | undefined {
  if (v == null) return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function requireParty(db: AppDb, shopId: string, partyId: string): Party {
  const party = db
    .select()
    .from(parties)
    .where(and(active(parties, shopId), eq(parties.id, partyId)))
    .get();
  if (!party) throw new AppError('NOT_FOUND', 'Contact not found');
  return party;
}

export type ListPartyLedgerOptions = {
  from?: number;
  to?: number;
  order?: 'asc' | 'desc';
};

/** Running ledger for a party with chronological running balances and linked cash methods. */
export function listPartyLedger(
  db: AppDb,
  shopId: string,
  partyId: string,
  opts: ListPartyLedgerOptions = {},
): PartyLedgerResult {
  const openingBalance =
    opts.from !== undefined
      ? Number(
          db
            .select({ total: sql<number>`COALESCE(SUM(${party_ledger.amount}), 0)` })
            .from(party_ledger)
            .where(
              and(
                active(party_ledger, shopId),
                eq(party_ledger.party_id, partyId),
                lt(party_ledger.date, opts.from),
              ),
            )
            .get()?.total ?? 0,
        )
      : 0;

  const conds = [active(party_ledger, shopId), eq(party_ledger.party_id, partyId)];
  if (opts.from !== undefined) conds.push(gte(party_ledger.date, opts.from));
  if (opts.to !== undefined) conds.push(lte(party_ledger.date, opts.to));

  const rows = db
    .select()
    .from(party_ledger)
    .where(and(...conds))
    .orderBy(asc(party_ledger.date), asc(party_ledger.created_at), asc(party_ledger.id))
    .all();

  const methodMap = new Map<string, Method>();
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const cashRows = db
      .select({ refId: cash_entries.ref_id, method: cash_entries.method })
      .from(cash_entries)
      .where(and(active(cash_entries, shopId), inArray(cash_entries.ref_id, ids)))
      .all();
    for (const c of cashRows) {
      if (c.refId) methodMap.set(c.refId, c.method);
    }
  }

  let running = openingBalance;
  let totalGiven = 0;
  let totalTaken = 0;
  const entries: LedgerEntryWithBalance[] = rows.map((row) => {
    running += row.amount;
    if (row.amount > 0) totalGiven += row.amount;
    else if (row.amount < 0) totalTaken += -row.amount;
    return {
      ...row,
      runningBalance: running,
      method: methodMap.get(row.id) ?? null,
    };
  });

  if (opts.order !== 'asc') {
    entries.reverse();
  }

  return {
    entries,
    openingBalance,
    closingBalance: running,
    totalGiven,
    totalTaken,
  };
}

/** Record "You Gave" (+ ledger, optional − cash). */
export function recordGive(
  db: AppDb,
  ctx: LedgerContext,
  input: GiveTakeInput,
): LedgerMutationResult {
  assertCan(ctx.role, 'collectDue');
  const data = parseOrThrow(giveTakeSchema, input);

  return db.transaction((tx) => {
    const party = requireParty(tx, ctx.shopId, data.partyId);
    const date = data.date ?? Date.now();
    const note = cleanNote(data.note);
    const ledgerId = postLedger(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      refId: null,
      partyId: data.partyId,
      amount: data.amount,
      type: 'give',
      date,
      note,
    });
    if (!ledgerId) throw new AppError('VALIDATION', 'Amount must be greater than 0');

    const cashId = data.affectCash
      ? postCash(tx, {
          shopId: ctx.shopId,
          userId: ctx.userId,
          refId: ledgerId,
          date,
          amount: -data.amount,
          type: 'paid',
          method: data.method,
          note: note ?? `Paid to ${party.name}`,
        })
      : null;

    return {
      ledgerId,
      cashId,
      balance: getPartyBalance(tx, ctx.shopId, data.partyId),
    };
  });
}

/** Record "You Got / Take" (− ledger, optional + cash). */
export function recordTake(
  db: AppDb,
  ctx: LedgerContext,
  input: GiveTakeInput,
): LedgerMutationResult {
  assertCan(ctx.role, 'collectDue');
  const data = parseOrThrow(giveTakeSchema, input);

  return db.transaction((tx) => {
    const party = requireParty(tx, ctx.shopId, data.partyId);
    const date = data.date ?? Date.now();
    const note = cleanNote(data.note);
    const ledgerId = postLedger(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      refId: null,
      partyId: data.partyId,
      amount: -data.amount,
      type: 'take',
      date,
      note,
    });
    if (!ledgerId) throw new AppError('VALIDATION', 'Amount must be greater than 0');

    const cashId = data.affectCash
      ? postCash(tx, {
          shopId: ctx.shopId,
          userId: ctx.userId,
          refId: ledgerId,
          date,
          amount: data.amount,
          type: 'received',
          method: data.method,
          note: note ?? `Received from ${party.name}`,
        })
      : null;

    return {
      ledgerId,
      cashId,
      balance: getPartyBalance(tx, ctx.shopId, data.partyId),
    };
  });
}

/** Collect customer receivable due (rejects overpay with OVERPAY). */
export function collectDue(
  db: AppDb,
  ctx: LedgerContext,
  input: SettleDueInput,
): LedgerMutationResult {
  assertCan(ctx.role, 'collectDue');
  const data = parseOrThrow(settleDueSchema, input);

  return db.transaction((tx) => {
    const party = requireParty(tx, ctx.shopId, data.partyId);
    const current = getPartyBalance(tx, ctx.shopId, data.partyId);
    if (current <= 0 || data.amount > current) {
      throw new AppError('OVERPAY', 'Amount exceeds receivable due balance');
    }
    const date = data.date ?? Date.now();
    const note = cleanNote(data.note);
    const ledgerId = postLedger(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      refId: null,
      partyId: data.partyId,
      amount: -data.amount,
      type: 'received',
      date,
      note: note ?? 'Due collected',
    });
    if (!ledgerId) throw new AppError('VALIDATION', 'Amount must be greater than 0');

    const cashId = postCash(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      refId: ledgerId,
      date,
      amount: data.amount,
      type: 'received',
      method: data.method,
      note: note ?? `Due collected from ${party.name}`,
    });

    return {
      ledgerId,
      cashId,
      balance: current - data.amount,
    };
  });
}

/** Pay supplier payable due (rejects overpay with OVERPAY). */
export function payDue(
  db: AppDb,
  ctx: LedgerContext,
  input: SettleDueInput,
): LedgerMutationResult {
  assertCan(ctx.role, 'collectDue');
  const data = parseOrThrow(settleDueSchema, input);

  return db.transaction((tx) => {
    const party = requireParty(tx, ctx.shopId, data.partyId);
    const current = getPartyBalance(tx, ctx.shopId, data.partyId);
    const payable = -current;
    if (current >= 0 || data.amount > payable) {
      throw new AppError('OVERPAY', 'Amount exceeds payable due balance');
    }
    const date = data.date ?? Date.now();
    const note = cleanNote(data.note);
    const ledgerId = postLedger(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      refId: null,
      partyId: data.partyId,
      amount: data.amount,
      type: 'paid',
      date,
      note: note ?? 'Due paid',
    });
    if (!ledgerId) throw new AppError('VALIDATION', 'Amount must be greater than 0');

    const cashId = postCash(tx, {
      shopId: ctx.shopId,
      userId: ctx.userId,
      refId: ledgerId,
      date,
      amount: -data.amount,
      type: 'paid',
      method: data.method,
      note: note ?? `Due paid to ${party.name}`,
    });

    return {
      ledgerId,
      cashId,
      balance: current + data.amount,
    };
  });
}

/** Soft-delete a standalone ledger entry and its linked cash posting. */
export function deleteLedgerEntry(db: AppDb, ctx: LedgerContext, id: string): void {
  assertCan(ctx.role, 'delete');
  db.transaction((tx) => {
    const row = tx
      .select()
      .from(party_ledger)
      .where(and(eq(party_ledger.shop_id, ctx.shopId), eq(party_ledger.id, id)))
      .get();
    if (!row) throw new AppError('NOT_FOUND', 'Ledger entry not found');
    if (row.ref_id !== null) {
      throw new AppError(
        'CONFLICT',
        'This entry belongs to a sale or purchase. Delete that record instead.',
      );
    }
    softDeleteWithRefs(tx, { shopId: ctx.shopId, table: party_ledger, id });
  });
}

/** Restore a soft-deleted standalone ledger entry and its linked cash posting. */
export function restoreLedgerEntry(db: AppDb, ctx: LedgerContext, id: string): void {
  assertCan(ctx.role, 'restore');
  db.transaction((tx) => {
    restoreWithRefs(tx, { shopId: ctx.shopId, table: party_ledger, id });
  });
}

export const LEDGER_TYPE_LABELS: Record<LedgerEntry['type'], string> = {
  sale_due: 'Sale Due',
  purchase_due: 'Purchase Due',
  received: 'Due Received',
  paid: 'Due Paid',
  give: 'Gave',
  take: 'Got',
  opening: 'Opening',
};

/** Normalize phone for WhatsApp (`01XXXXXXXXX` → `8801XXXXXXXXX`). */
export function normalizeBdPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length === 11 && digits.startsWith('01')) {
    return `88${digits}`;
  }
  return digits;
}

export function buildStatementText(params: {
  shopName: string;
  shopPhone?: string | null;
  party: Pick<Party, 'name' | 'phone'>;
  balance: number;
  entries: LedgerEntryWithBalance[];
  decimal?: boolean;
}): string {
  const dec = Boolean(params.decimal);
  const status =
    params.balance > 0
      ? `Receivable (Due): ${formatTaka(params.balance, dec)}`
      : params.balance < 0
        ? `Payable (Advance): ${formatTaka(-params.balance, dec)}`
        : 'Settled (৳ 0)';

  const lines = [
    `Statement from ${params.shopName}`,
    `Account: ${params.party.name}`,
    `Current Balance: ${status}`,
  ];

  const recent = params.entries.slice(0, 5);
  if (recent.length > 0) {
    lines.push('', 'Recent transactions:');
    for (const e of recent) {
      const sign = e.amount > 0 ? '+' : '-';
      const label = LEDGER_TYPE_LABELS[e.type];
      lines.push(
        `• ${formatDate(e.date)} — ${label}: ${sign}${formatTaka(Math.abs(e.amount), dec)}`,
      );
    }
  }
  if (params.shopPhone) {
    lines.push('', `Contact: ${params.shopPhone}`);
  }
  return lines.join('\n');
}

export function buildWhatsAppUrl(phone: string | null | undefined, message: string): string {
  const normalized = phone ? normalizeBdPhone(phone) : '';
  const encoded = encodeURIComponent(message);
  return normalized ? `https://wa.me/${normalized}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

export function buildSmsUrl(phone: string | null | undefined, message: string): string {
  const cleaned = phone ? phone.replace(/[^\d+]/g, '') : '';
  const encoded = encodeURIComponent(message);
  return `sms:${cleaned}?body=${encoded}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildStatementHtml(params: {
  shop: Pick<Shop, 'name' | 'phone' | 'address'>;
  party: Pick<Party, 'name' | 'type' | 'phone' | 'address'>;
  openingBalance: number;
  closingBalance: number;
  totalGiven: number;
  totalTaken: number;
  entries: LedgerEntryWithBalance[];
  decimal?: boolean;
  from?: number;
  to?: number;
}): string {
  const dec = Boolean(params.decimal);
  const chronological = [...params.entries].sort(
    (a, b) => a.date - b.date || a.created_at - b.created_at,
  );
  const period =
    params.from && params.to
      ? `${formatDate(params.from)} — ${formatDate(params.to)}`
      : 'All time';
  const balLabel =
    params.closingBalance > 0
      ? `Receivable: ${formatTaka(params.closingBalance, dec)}`
      : params.closingBalance < 0
        ? `Payable: ${formatTaka(-params.closingBalance, dec)}`
        : 'Settled (৳ 0)';

  const rowsHtml = chronological
    .map((e) => {
      const give = e.amount > 0 ? formatTaka(e.amount, dec) : '—';
      const take = e.amount < 0 ? formatTaka(-e.amount, dec) : '—';
      const noteParts = [LEDGER_TYPE_LABELS[e.type]];
      if (e.method) noteParts.push(e.method.toUpperCase());
      if (e.note) noteParts.push(e.note);
      return `<tr>
        <td>${escapeHtml(formatDateTime(e.date))}</td>
        <td>${escapeHtml(noteParts.join(' · '))}</td>
        <td class="num red">${escapeHtml(give)}</td>
        <td class="num green">${escapeHtml(take)}</td>
        <td class="num bold">${escapeHtml(formatTaka(e.runningBalance, dec))}</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Party Statement — ${escapeHtml(params.party.name)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1B1B1B; padding: 24px; font-size: 13px; }
    .header { border-bottom: 3px solid #F6BE25; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; }
    .shop { font-size: 20px; font-weight: 700; }
    .muted { color: #6B6B6B; font-size: 12px; }
    .cards { display: flex; gap: 12px; margin: 16px 0; }
    .card { flex: 1; border: 1px solid #ECECEC; border-radius: 8px; padding: 10px 12px; background: #FCFCFC; }
    .card-val { font-size: 16px; font-weight: 700; margin-top: 4px; }
    .green { color: #2E9E5B; }
    .red { color: #E53935; }
    .bold { font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border-bottom: 1px solid #ECECEC; padding: 8px 6px; text-align: left; }
    th { background: #F2F2F2; font-size: 12px; color: #555; }
    .num { text-align: right; white-space: nowrap; }
    .footer { margin-top: 24px; font-size: 11px; color: #6B6B6B; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="shop">${escapeHtml(params.shop.name)}</div>
      ${params.shop.phone ? `<div class="muted">${escapeHtml(params.shop.phone)}</div>` : ''}
      ${params.shop.address ? `<div class="muted">${escapeHtml(params.shop.address)}</div>` : ''}
    </div>
    <div style="text-align:right">
      <div style="font-weight:700;font-size:15px">Account Statement</div>
      <div class="muted">Period: ${escapeHtml(period)}</div>
      <div class="muted">Generated: ${escapeHtml(formatDateTime(Date.now()))}</div>
    </div>
  </div>
  <div>
    <strong>${escapeHtml(params.party.name)}</strong> (${escapeHtml(params.party.type)})
    ${params.party.phone ? ` · ${escapeHtml(params.party.phone)}` : ''}
    ${params.party.address ? `<div class="muted">${escapeHtml(params.party.address)}</div>` : ''}
  </div>
  <div class="cards">
    <div class="card"><div class="muted">Opening Balance</div><div class="card-val">${escapeHtml(formatTaka(params.openingBalance, dec))}</div></div>
    <div class="card"><div class="muted">Total Given (+)</div><div class="card-val red">${escapeHtml(formatTaka(params.totalGiven, dec))}</div></div>
    <div class="card"><div class="muted">Total Taken (−)</div><div class="card-val green">${escapeHtml(formatTaka(params.totalTaken, dec))}</div></div>
    <div class="card"><div class="muted">Closing Balance</div><div class="card-val">${escapeHtml(balLabel)}</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Details</th>
        <th class="num">Gave (+)</th>
        <th class="num">Got (−)</th>
        <th class="num">Balance</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || '<tr><td colspan="5" style="text-align:center;color:#6B6B6B;padding:16px">No transactions in this period</td></tr>'}
    </tbody>
  </table>
  <div class="footer">Generated with Sohan Note Ultra</div>
</body>
</html>`;
}
