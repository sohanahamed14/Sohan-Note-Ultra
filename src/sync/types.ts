export const SYNC_ORDER = [
  'shops',
  'shop_members',
  'categories',
  'products',
  'parties',
  'stock_movements',
  'party_ledger',
  'sales',
  'sale_items',
  'purchases',
  'purchase_items',
  'expenses',
  'cash_entries',
  'online_orders',
] as const;

export type SyncTableName = (typeof SYNC_ORDER)[number];

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

export type SyncTableError = {
  table: SyncTableName;
  code: string;
  message: string;
};

export type SyncResult = {
  pushed: number;
  pulled: number;
  acceptedInvites: string[];
  revokedShops: string[];
  errors: SyncTableError[];
  syncedAt: number;
};

export type TransportError = {
  code?: string;
  message: string;
  isNetwork?: boolean;
};

export type TransportResult<T> = {
  data: T | null;
  error: TransportError | null;
};

export interface SyncTransport {
  getSessionUserId(): Promise<string | null>;
  acceptInvites(): Promise<TransportResult<string[]>>;
  upsert(table: SyncTableName, rows: Record<string, unknown>[]): Promise<TransportError | null>;
  listAccessibleShopIds(): Promise<TransportResult<string[]>>;
  pullPage(
    table: SyncTableName,
    shopId: string,
    afterSeq: number,
    limit: number,
  ): Promise<TransportResult<Record<string, unknown>[]>>;
  uploadImage?(shopId: string, localUri: string, relativePath: string): Promise<string>;
}
