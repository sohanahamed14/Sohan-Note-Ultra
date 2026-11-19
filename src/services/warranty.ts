import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { active } from '@/db/helpers';
import { parties, sale_items, sales } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { now, startOfDay } from '@/lib/date';

export const EXPIRING_SOON_DAYS = 30;
const DAY_MS = 86_400_000;

export type WarrantyStatus = 'active' | 'expiring' | 'expired';

export type WarrantyFilter = {
  search?: string;
  status?: 'all' | 'active' | 'expired';
  nowMs?: number;
};

export type WarrantyItem = {
  saleItemId: string;
  saleId: string;
  invoiceNo: string;
  saleDate: number;
  productId: string | null;
  productName: string;
  qty: number;
  unitPrice: number;
  warrantyUntil: number;
  partyId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  daysRemaining: number;
  status: WarrantyStatus;
};

export type WarrantySummary = {
  total: number;
  active: number;
  expiring: number;
  expired: number;
};

export function classifyWarranty(
  warrantyUntil: number,
  nowMs: number = now(),
): { status: WarrantyStatus; daysRemaining: number } {
  const todayStart = startOfDay(nowMs);
  const endDayStart = startOfDay(warrantyUntil);
  const daysRemaining = Math.round((endDayStart - todayStart) / DAY_MS);
  if (daysRemaining < 0) return { status: 'expired', daysRemaining };
  if (daysRemaining <= EXPIRING_SOON_DAYS) return { status: 'expiring', daysRemaining };
  return { status: 'active', daysRemaining };
}

/** List sold items with warranty end dates, searchable by customer, phone, product, or invoice #. */
export function listWarrantyItems(
  db: AppDb,
  shopId: string,
  filter: WarrantyFilter = {},
): { items: WarrantyItem[]; summary: WarrantySummary } {
  const refNow = filter.nowMs ?? now();
  const rows = db
    .select({
      saleItemId: sale_items.id,
      saleId: sales.id,
      invoiceNo: sales.invoice_no,
      saleDate: sales.date,
      productId: sale_items.product_id,
      productName: sale_items.name,
      qty: sale_items.qty,
      unitPrice: sale_items.unit_price,
      warrantyUntil: sale_items.warranty_until,
      partyId: sales.party_id,
    })
    .from(sale_items)
    .innerJoin(sales, eq(sale_items.sale_id, sales.id))
    .where(
      and(
        active(sale_items, shopId),
        active(sales, shopId),
        isNotNull(sale_items.warranty_until),
      ),
    )
    .all();

  if (rows.length === 0) {
    return { items: [], summary: { total: 0, active: 0, expiring: 0, expired: 0 } };
  }

  const partyIds = Array.from(
    new Set(rows.map((r) => r.partyId).filter((id): id is string => Boolean(id))),
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
  const summary: WarrantySummary = { total: 0, active: 0, expiring: 0, expired: 0 };
  const items: WarrantyItem[] = [];

  for (const r of rows) {
    if (r.warrantyUntil === null) continue;
    const party = r.partyId ? partyMap.get(r.partyId) : undefined;
    const { status, daysRemaining } = classifyWarranty(r.warrantyUntil, refNow);

    summary.total += 1;
    if (status === 'expired') summary.expired += 1;
    else {
      summary.active += 1;
      if (status === 'expiring') summary.expiring += 1;
    }

    if (filter.status === 'active' && status === 'expired') continue;
    if (filter.status === 'expired' && status !== 'expired') continue;

    if (q) {
      const hay = [party?.name ?? '', party?.phone ?? '', r.productName, r.invoiceNo]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }

    items.push({
      saleItemId: r.saleItemId,
      saleId: r.saleId,
      invoiceNo: r.invoiceNo,
      saleDate: r.saleDate,
      productId: r.productId,
      productName: r.productName,
      qty: r.qty,
      unitPrice: r.unitPrice,
      warrantyUntil: r.warrantyUntil,
      partyId: r.partyId,
      customerName: party?.name ?? null,
      customerPhone: party?.phone ?? null,
      daysRemaining,
      status,
    });
  }

  items.sort((a, b) => {
    if (filter.status === 'expired') return b.warrantyUntil - a.warrantyUntil;
    if (filter.status === 'active') return a.warrantyUntil - b.warrantyUntil;
    const aExp = a.status === 'expired' ? 1 : 0;
    const bExp = b.status === 'expired' ? 1 : 0;
    if (aExp !== bExp) return aExp - bExp;
    return aExp === 0 ? a.warrantyUntil - b.warrantyUntil : b.warrantyUntil - a.warrantyUntil;
  });

  return { items, summary };
}

export function getWarrantySummary(
  db: AppDb,
  shopId: string,
  nowMs?: number,
): WarrantySummary {
  return listWarrantyItems(db, shopId, { nowMs }).summary;
}
