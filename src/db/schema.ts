import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Money columns are integer paisa; qty is REAL (3dp); times are epoch ms. */

const common = {
  id: text('id').primaryKey(),
  shop_id: text('shop_id').notNull(),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
  deleted_at: integer('deleted_at'),
  created_by: text('created_by'),
  /** local only: 1 = needs push */
  dirty: integer('dirty').notNull().default(1),
};

export const ROLES = ['owner', 'manager', 'cashier'] as const;
export const METHODS = ['cash', 'bkash', 'nagad', 'card', 'bank', 'other'] as const;
export const CASH_TYPES = [
  'sale',
  'purchase',
  'expense',
  'received',
  'paid',
  'capital_in',
  'capital_out',
  'cash_in',
  'cash_out',
] as const;
export const LEDGER_TYPES = [
  'sale_due',
  'purchase_due',
  'received',
  'paid',
  'give',
  'take',
  'opening',
] as const;
export const STOCK_TYPES = ['opening', 'purchase', 'sale', 'adjust', 'restore'] as const;

export const shops = sqliteTable(
  'shops',
  {
    ...common,
    name: text('name').notNull(),
    slug: text('slug'),
    phone: text('phone'),
    address: text('address'),
    business_type: text('business_type'),
    logo_uri: text('logo_uri'),
    vat_percent: real('vat_percent').notNull().default(0),
    invoice_footer: text('invoice_footer'),
    payment_qr_uri: text('payment_qr_uri'),
    decimal_enabled: integer('decimal_enabled').notNull().default(0),
    online_enabled: integer('online_enabled').notNull().default(0),
    online_theme: text('online_theme'),
    delivery_inside: integer('delivery_inside').notNull().default(0),
    delivery_outside: integer('delivery_outside').notNull().default(0),
    shop_policy: text('shop_policy'),
    owner_id: text('owner_id').notNull(),
  },
  (t) => [index('shops_owner_idx').on(t.owner_id), index('shops_slug_idx').on(t.slug)],
);

export const shop_members = sqliteTable(
  'shop_members',
  {
    ...common,
    user_id: text('user_id'),
    email: text('email').notNull(),
    name: text('name'),
    role: text('role', { enum: ROLES }).notNull(),
    status: text('status', { enum: ['invited', 'active'] })
      .notNull()
      .default('invited'),
  },
  (t) => [
    index('members_shop_idx').on(t.shop_id, t.deleted_at),
    index('members_email_idx').on(t.email),
  ],
);

export const categories = sqliteTable(
  'categories',
  {
    ...common,
    name: text('name').notNull(),
    kind: text('kind', { enum: ['product', 'expense'] }).notNull(),
  },
  (t) => [index('categories_shop_idx').on(t.shop_id, t.kind, t.deleted_at)],
);

export const products = sqliteTable(
  'products',
  {
    ...common,
    name: text('name').notNull(),
    category_id: text('category_id'),
    unit: text('unit').notNull().default('pcs'),
    code: text('code'),
    buy_price: integer('buy_price').notNull().default(0),
    sell_price: integer('sell_price').notNull().default(0),
    wholesale_price: integer('wholesale_price').notNull().default(0),
    low_stock_alert: real('low_stock_alert').notNull().default(0),
    warranty_days: integer('warranty_days').notNull().default(0),
    image_uri: text('image_uri'),
    description: text('description'),
    online_visible: integer('online_visible').notNull().default(0),
    featured: integer('featured').notNull().default(0),
  },
  (t) => [
    index('products_shop_idx').on(t.shop_id, t.deleted_at),
    index('products_category_idx').on(t.category_id),
    index('products_dirty_idx').on(t.dirty),
  ],
);

export const stock_movements = sqliteTable(
  'stock_movements',
  {
    ...common,
    product_id: text('product_id').notNull(),
    qty: real('qty').notNull(),
    type: text('type', { enum: STOCK_TYPES }).notNull(),
    ref_id: text('ref_id'),
    note: text('note'),
    date: integer('date').notNull(),
  },
  (t) => [
    index('stock_product_idx').on(t.product_id, t.deleted_at),
    index('stock_ref_idx').on(t.ref_id),
    index('stock_shop_date_idx').on(t.shop_id, t.date),
  ],
);

export const parties = sqliteTable(
  'parties',
  {
    ...common,
    type: text('type', { enum: ['customer', 'supplier', 'employee'] }).notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    address: text('address'),
    note: text('note'),
  },
  (t) => [
    index('parties_shop_idx').on(t.shop_id, t.type, t.deleted_at),
    index('parties_phone_idx').on(t.phone),
  ],
);

export const party_ledger = sqliteTable(
  'party_ledger',
  {
    ...common,
    party_id: text('party_id').notNull(),
    /** + = they owe us, − = we owe them */
    amount: integer('amount').notNull(),
    type: text('type', { enum: LEDGER_TYPES }).notNull(),
    ref_id: text('ref_id'),
    date: integer('date').notNull(),
    note: text('note'),
  },
  (t) => [
    index('ledger_party_idx').on(t.party_id, t.deleted_at),
    index('ledger_ref_idx').on(t.ref_id),
    index('ledger_shop_date_idx').on(t.shop_id, t.date),
  ],
);

const orderTotals = {
  date: integer('date').notNull(),
  subtotal: integer('subtotal').notNull(),
  discount: integer('discount').notNull().default(0),
  vat: integer('vat').notNull().default(0),
  total: integer('total').notNull(),
  paid: integer('paid').notNull().default(0),
  due: integer('due').notNull().default(0),
  method: text('method', { enum: METHODS }).notNull().default('cash'),
  note: text('note'),
};

export const sales = sqliteTable(
  'sales',
  {
    ...common,
    invoice_no: text('invoice_no').notNull(),
    party_id: text('party_id'),
    ...orderTotals,
    kind: text('kind', { enum: ['pos', 'quick', 'online'] })
      .notNull()
      .default('pos'),
  },
  (t) => [
    index('sales_shop_date_idx').on(t.shop_id, t.date),
    index('sales_party_idx').on(t.party_id),
    index('sales_invoice_idx').on(t.shop_id, t.invoice_no),
  ],
);

export const sale_items = sqliteTable(
  'sale_items',
  {
    ...common,
    sale_id: text('sale_id').notNull(),
    product_id: text('product_id'),
    name: text('name').notNull(),
    qty: real('qty').notNull(),
    unit_price: integer('unit_price').notNull(),
    buy_price: integer('buy_price').notNull().default(0),
    total: integer('total').notNull(),
    warranty_until: integer('warranty_until'),
  },
  (t) => [
    index('sale_items_sale_idx').on(t.sale_id),
    index('sale_items_product_idx').on(t.product_id),
  ],
);

export const purchases = sqliteTable(
  'purchases',
  {
    ...common,
    bill_no: text('bill_no').notNull(),
    party_id: text('party_id'),
    ...orderTotals,
  },
  (t) => [
    index('purchases_shop_date_idx').on(t.shop_id, t.date),
    index('purchases_party_idx').on(t.party_id),
  ],
);

export const purchase_items = sqliteTable(
  'purchase_items',
  {
    ...common,
    purchase_id: text('purchase_id').notNull(),
    product_id: text('product_id'),
    name: text('name').notNull(),
    qty: real('qty').notNull(),
    unit_price: integer('unit_price').notNull(),
    total: integer('total').notNull(),
  },
  (t) => [
    index('purchase_items_purchase_idx').on(t.purchase_id),
    index('purchase_items_product_idx').on(t.product_id),
  ],
);

export const expenses = sqliteTable(
  'expenses',
  {
    ...common,
    category_id: text('category_id'),
    amount: integer('amount').notNull(),
    date: integer('date').notNull(),
    method: text('method', { enum: METHODS }).notNull().default('cash'),
    note: text('note'),
  },
  (t) => [
    index('expenses_shop_date_idx').on(t.shop_id, t.date),
    index('expenses_category_idx').on(t.category_id),
  ],
);

export const cash_entries = sqliteTable(
  'cash_entries',
  {
    ...common,
    /** + in, − out */
    amount: integer('amount').notNull(),
    type: text('type', { enum: CASH_TYPES }).notNull(),
    method: text('method', { enum: METHODS }).notNull().default('cash'),
    ref_id: text('ref_id'),
    date: integer('date').notNull(),
    note: text('note'),
  },
  (t) => [
    index('cash_shop_date_idx').on(t.shop_id, t.date),
    index('cash_ref_idx').on(t.ref_id),
    index('cash_type_idx').on(t.shop_id, t.type, t.deleted_at),
  ],
);

export const online_orders = sqliteTable(
  'online_orders',
  {
    ...common,
    order_no: text('order_no').notNull(),
    customer_name: text('customer_name').notNull(),
    phone: text('phone').notNull(),
    address: text('address').notNull(),
    items_json: text('items_json').notNull(),
    subtotal: integer('subtotal').notNull(),
    delivery_charge: integer('delivery_charge').notNull().default(0),
    total: integer('total').notNull(),
    status: text('status', { enum: ['pending', 'confirmed', 'delivered', 'cancelled'] })
      .notNull()
      .default('pending'),
    sale_id: text('sale_id'),
  },
  (t) => [index('orders_shop_status_idx').on(t.shop_id, t.status, t.deleted_at)],
);

/** Local-only key/value (never synced). */
export const kv = sqliteTable('kv', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** Local-only sync cursors, one row per `${shop_id}:${table}`. */
export const sync_state = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  cursor: integer('cursor').notNull().default(0),
  last_synced_at: integer('last_synced_at'),
});

export const SYNCED_TABLES = {
  shops,
  shop_members,
  categories,
  products,
  stock_movements,
  parties,
  party_ledger,
  sales,
  sale_items,
  purchases,
  purchase_items,
  expenses,
  cash_entries,
  online_orders,
} as const;

export type Role = (typeof ROLES)[number];
export type Method = (typeof METHODS)[number];
export type Shop = typeof shops.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Party = typeof parties.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type SaleItem = typeof sale_items.$inferSelect;
export type Purchase = typeof purchases.$inferSelect;
export type PurchaseItem = typeof purchase_items.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type CashEntry = typeof cash_entries.$inferSelect;
export type StockMovement = typeof stock_movements.$inferSelect;
export type LedgerEntry = typeof party_ledger.$inferSelect;
export type ShopMember = typeof shop_members.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type OnlineOrder = typeof online_orders.$inferSelect;
