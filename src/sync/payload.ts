import type { SyncTableName } from './types';

const COMMON_COLS = [
  'id',
  'shop_id',
  'created_at',
  'updated_at',
  'deleted_at',
  'created_by',
] as const;

export const LOCAL_COLUMNS: Record<SyncTableName, readonly string[]> = {
  shops: [
    ...COMMON_COLS,
    'name',
    'slug',
    'phone',
    'address',
    'business_type',
    'logo_uri',
    'vat_percent',
    'invoice_footer',
    'payment_qr_uri',
    'decimal_enabled',
    'online_enabled',
    'online_theme',
    'delivery_inside',
    'delivery_outside',
    'shop_policy',
    'owner_id',
    'online_visits',
  ],
  shop_members: [...COMMON_COLS, 'user_id', 'email', 'name', 'role', 'status'],
  categories: [...COMMON_COLS, 'name', 'kind'],
  products: [
    ...COMMON_COLS,
    'name',
    'category_id',
    'unit',
    'code',
    'buy_price',
    'sell_price',
    'wholesale_price',
    'low_stock_alert',
    'warranty_days',
    'image_uri',
    'description',
    'online_visible',
    'featured',
  ],
  parties: [...COMMON_COLS, 'type', 'name', 'phone', 'address', 'note'],
  stock_movements: [...COMMON_COLS, 'product_id', 'qty', 'type', 'ref_id', 'note', 'date'],
  party_ledger: [...COMMON_COLS, 'party_id', 'amount', 'type', 'ref_id', 'date', 'note'],
  sales: [
    ...COMMON_COLS,
    'invoice_no',
    'party_id',
    'date',
    'subtotal',
    'discount',
    'vat',
    'total',
    'paid',
    'due',
    'method',
    'kind',
    'note',
  ],
  sale_items: [
    ...COMMON_COLS,
    'sale_id',
    'product_id',
    'name',
    'qty',
    'unit_price',
    'buy_price',
    'total',
    'warranty_until',
  ],
  purchases: [
    ...COMMON_COLS,
    'bill_no',
    'party_id',
    'date',
    'subtotal',
    'discount',
    'vat',
    'total',
    'paid',
    'due',
    'method',
    'note',
  ],
  purchase_items: [
    ...COMMON_COLS,
    'purchase_id',
    'product_id',
    'name',
    'qty',
    'unit_price',
    'total',
  ],
  expenses: [...COMMON_COLS, 'category_id', 'amount', 'date', 'method', 'note'],
  cash_entries: [...COMMON_COLS, 'amount', 'type', 'method', 'ref_id', 'date', 'note'],
  online_orders: [
    ...COMMON_COLS,
    'order_no',
    'customer_name',
    'phone',
    'address',
    'items_json',
    'subtotal',
    'delivery_charge',
    'total',
    'status',
    'sale_id',
    'note',
    'area',
  ],
};

const NUMERIC_COLUMNS = new Set<string>([
  'created_at',
  'updated_at',
  'deleted_at',
  'vat_percent',
  'decimal_enabled',
  'online_enabled',
  'delivery_inside',
  'delivery_outside',
  'online_visits',
  'buy_price',
  'sell_price',
  'wholesale_price',
  'low_stock_alert',
  'warranty_days',
  'online_visible',
  'featured',
  'qty',
  'date',
  'amount',
  'subtotal',
  'discount',
  'vat',
  'total',
  'paid',
  'due',
  'unit_price',
  'warranty_until',
  'delivery_charge',
]);

const LOCAL_NOT_NULL_DEFAULTS: Partial<Record<SyncTableName, Record<string, unknown>>> = {
  shops: {
    vat_percent: 0,
    decimal_enabled: 0,
    online_enabled: 0,
    delivery_inside: 0,
    delivery_outside: 0,
    online_visits: 0,
  },
  products: {
    unit: 'pcs',
    buy_price: 0,
    sell_price: 0,
    wholesale_price: 0,
    low_stock_alert: 0,
    warranty_days: 0,
    online_visible: 0,
    featured: 0,
  },
  sales: {
    invoice_no: '',
    subtotal: 0,
    discount: 0,
    vat: 0,
    total: 0,
    paid: 0,
    due: 0,
    method: 'cash',
    kind: 'pos',
  },
  sale_items: {
    unit_price: 0,
    buy_price: 0,
    total: 0,
  },
  purchases: {
    bill_no: '',
    subtotal: 0,
    discount: 0,
    vat: 0,
    total: 0,
    paid: 0,
    due: 0,
    method: 'cash',
  },
  purchase_items: {
    unit_price: 0,
    total: 0,
  },
  expenses: {
    method: 'cash',
  },
  cash_entries: {
    method: 'cash',
  },
  online_orders: {
    subtotal: 0,
    delivery_charge: 0,
    total: 0,
    status: 'pending',
  },
};

function coerceNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val === 'string' && val.trim() !== '') {
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Convert a local SQLite row into a complete Supabase PostgREST upsert payload:
 * - Strips `dirty` and `server_seq`
 * - Includes ALL columns of the remote table (with `null` for empty optionals)
 * - Adds extra remote-only columns for `purchases` and `purchase_items`
 */
export function toRemoteRow(
  table: SyncTableName,
  localRow: Record<string, unknown>,
): Record<string, unknown> {
  const cols = LOCAL_COLUMNS[table];
  const out: Record<string, unknown> = {};
  for (const col of cols) {
    const v = localRow[col];
    out[col] = v === undefined ? null : v;
  }
  if (table === 'shops') {
    out.shop_id = localRow.id;
    out.online_visits = coerceNumber(localRow.online_visits) ?? 0;
  } else if (table === 'purchases') {
    out.kind = null;
  } else if (table === 'purchase_items') {
    out.buy_price = coerceNumber(localRow.unit_price) ?? 0;
    out.warranty_until = null;
  }
  return out;
}

/**
 * Convert a remote Supabase row into a local SQLite row:
 * - Picks only local columns (strips `server_seq` and extra remote-only columns)
 * - Coerces bigint/numeric values returned as strings into JS numbers
 * - Applies safe defaults for local NOT NULL columns
 * - Sets `dirty: 0`
 */
export function toLocalRow(
  table: SyncTableName,
  remoteRow: Record<string, unknown>,
): Record<string, unknown> {
  const cols = LOCAL_COLUMNS[table];
  const defaults = LOCAL_NOT_NULL_DEFAULTS[table] ?? {};
  const out: Record<string, unknown> = {};
  for (const col of cols) {
    let val = remoteRow[col];
    if (col === 'shop_id' && table === 'shops' && (val === null || val === undefined)) {
      val = remoteRow.id;
    }
    if (NUMERIC_COLUMNS.has(col)) {
      val = coerceNumber(val);
    }
    if ((val === null || val === undefined) && col in defaults) {
      val = defaults[col];
    }
    out[col] = val === undefined ? null : val;
  }
  out.dirty = 0;
  return out;
}
