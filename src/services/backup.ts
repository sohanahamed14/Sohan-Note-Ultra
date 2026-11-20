import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { SYNCED_TABLES, type Role } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { toDateInput } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { can } from '@/services/permissions';
import {
  LAST_BACKUP_KEY,
  getLastBackupAt,
  setLastBackupAt,
  syncNow,
  type SyncNowOptions,
} from '@/sync/engine';
import { ensureSyncRuntimeStarted, useSyncStore } from '@/sync/manager';
import { LOCAL_COLUMNS, toLocalRow } from '@/sync/payload';
import { SYNC_ORDER, type SyncTableError, type SyncTableName } from '@/sync/types';

if (process.env.NODE_ENV !== 'test') {
  ensureSyncRuntimeStarted();
}

export { LAST_BACKUP_KEY, getLastBackupAt, setLastBackupAt };

export const BACKUP_VERSION = 1 as const;
export const BACKUP_APP_ID = 'sohan-note-ultra' as const;

const rowRecordSchema = z
  .object({
    id: z.string().min(1),
    shop_id: z.string().min(1),
    created_at: z.number().finite(),
    updated_at: z.number().finite(),
  })
  .passthrough();

const tablesShape = Object.fromEntries(
  SYNC_ORDER.map((t) => [t, z.array(rowRecordSchema).default([])]),
) as Record<SyncTableName, z.ZodDefault<z.ZodArray<typeof rowRecordSchema>>>;

export const BackupFileSchema = z.object({
  version: z.literal(BACKUP_VERSION),
  app: z.literal(BACKUP_APP_ID),
  exportedAt: z.number().int().positive(),
  shopId: z.string().min(1),
  tables: z.object(tablesShape),
});

export type BackupPayload = z.infer<typeof BackupFileSchema>;

export type BackupSyncResult = {
  pushed: number;
  pulled: number;
  lastBackupAt: number;
  errors: SyncTableError[];
};

export type ImportBackupResult = {
  shopId: string;
  importedRows: number;
  tables: Record<SyncTableName, number>;
};

/**
 * Force an immediate cloud sync and record `kv.last_backup_at`.
 */
export async function backupNow(db: AppDb, opts: SyncNowOptions = {}): Promise<BackupSyncResult> {
  const res = await syncNow(db, opts);
  const lastBackupAt =
    res.errors.length === 0 ? res.syncedAt : (getLastBackupAt(db) ?? setLastBackupAt(db));
  useSyncStore.getState().refreshStats();
  return {
    pushed: res.pushed,
    pulled: res.pulled,
    lastBackupAt,
    errors: res.errors,
  };
}

/**
 * Serialize all rows (including soft-deleted rows) for `shopId` as a versioned JSON backup.
 * Restricted to owners (`manageSettings`) because backups contain cost prices and employee rows.
 */
export function exportShopJson(db: AppDb, shopId: string, role: Role): string {
  if (!can(role, 'manageSettings')) {
    throw new AppError('FORBIDDEN', 'Only shop owners can export shop data');
  }
  if (!shopId) {
    throw new AppError('VALIDATION', 'Shop ID is required');
  }

  const shopRow = db.get<Record<string, unknown>>(
    sql`SELECT * FROM ${SYNCED_TABLES.shops} WHERE id = ${shopId}`,
  );
  if (!shopRow) {
    throw new AppError('NOT_FOUND', 'Shop not found');
  }

  const tables = {} as Record<SyncTableName, Record<string, unknown>[]>;
  for (const table of SYNC_ORDER) {
    const tbl = SYNCED_TABLES[table];
    const rows =
      table === 'shops'
        ? db.all<Record<string, unknown>>(sql`SELECT * FROM ${tbl} WHERE id = ${shopId}`)
        : db.all<Record<string, unknown>>(sql`SELECT * FROM ${tbl} WHERE shop_id = ${shopId}`);
    tables[table] = rows.map((row) => {
      const clean: Record<string, unknown> = {};
      for (const col of LOCAL_COLUMNS[table]) {
        clean[col] = row[col] ?? null;
      }
      return clean;
    });
  }

  const payload: BackupPayload = {
    version: BACKUP_VERSION,
    app: BACKUP_APP_ID,
    exportedAt: Date.now(),
    shopId,
    tables: tables as BackupPayload['tables'],
  };
  return JSON.stringify(payload, null, 2);
}

function upsertImportedRow(
  db: AppDb,
  table: SyncTableName,
  row: Record<string, unknown>,
  markDirty: boolean,
): void {
  const tbl = SYNCED_TABLES[table];
  const normalized = toLocalRow(table, row);
  normalized.dirty = markDirty ? 1 : 0;

  const cols = [...LOCAL_COLUMNS[table], 'dirty'];
  const colIdents = cols.map((c) => sql.identifier(c));
  const vals = cols.map((c) => sql`${normalized[c] ?? null}`);
  const updateSet = cols
    .filter((c) => c !== 'id')
    .map((c) => sql`${sql.identifier(c)} = excluded.${sql.identifier(c)}`);

  db.run(
    sql`INSERT INTO ${tbl} (${sql.join(colIdents, sql`, `)})
        VALUES (${sql.join(vals, sql`, `)})
        ON CONFLICT(id) DO UPDATE SET ${sql.join(updateSet, sql`, `)}`,
  );
}

/**
 * Restore a versioned JSON backup into local SQLite in a single transaction.
 * - `mode: 'merge'` (default): LWW merge per row (incoming wins if absent or `updated_at >= local`).
 * - `mode: 'replace'`: replaces all local rows for the backup's shop.
 * Restored rows are marked `dirty = 1` so the next cloud sync uploads them.
 */
export function importShopJson(
  db: AppDb,
  jsonString: string,
  opts: { role: Role; targetShopId?: string; mode?: 'merge' | 'replace' },
): ImportBackupResult {
  if (!can(opts.role, 'manageSettings')) {
    throw new AppError('FORBIDDEN', 'Only shop owners can restore a backup');
  }

  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(jsonString);
  } catch {
    throw new AppError('VALIDATION', 'Invalid backup file: malformed JSON');
  }

  const parsed = BackupFileSchema.safeParse(parsedRaw);
  if (!parsed.success) {
    throw new AppError(
      'VALIDATION',
      `Invalid backup format: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
    );
  }

  const data = parsed.data;
  if (opts.targetShopId && data.shopId !== opts.targetShopId) {
    throw new AppError(
      'CONFLICT',
      'Backup belongs to a different shop. Switch to that shop or confirm replace.',
    );
  }
  if (data.tables.shops.length !== 1 || data.tables.shops[0].id !== data.shopId) {
    throw new AppError('VALIDATION', 'Backup must contain exactly one matching shop record');
  }

  // Verify every row belongs to data.shopId to prevent cross-shop injection.
  for (const table of SYNC_ORDER) {
    for (const row of data.tables[table]) {
      const scope = table === 'shops' ? row.id : row.shop_id;
      if (scope !== data.shopId) {
        throw new AppError('VALIDATION', `Row in ${table} does not match backup shopId`);
      }
    }
  }

  const mode = opts.mode ?? 'merge';
  const counts = Object.fromEntries(SYNC_ORDER.map((t) => [t, 0])) as Record<SyncTableName, number>;
  let importedRows = 0;

  db.transaction((tx) => {
    if (mode === 'replace') {
      for (const table of SYNC_ORDER) {
        const tbl = SYNCED_TABLES[table];
        if (table === 'shops') {
          tx.run(sql`DELETE FROM ${tbl} WHERE id = ${data.shopId}`);
        } else {
          tx.run(sql`DELETE FROM ${tbl} WHERE shop_id = ${data.shopId}`);
        }
      }
    }

    for (const table of SYNC_ORDER) {
      const tbl = SYNCED_TABLES[table];
      for (const row of data.tables[table]) {
        if (mode === 'merge') {
          const existing = tx.get<{ updated_at: number } | undefined>(
            sql`SELECT updated_at FROM ${tbl} WHERE id = ${row.id}`,
          );
          if (existing && Number(row.updated_at) < Number(existing.updated_at)) {
            continue;
          }
        }
        upsertImportedRow(tx, table, row, true);
        counts[table] += 1;
        importedRows += 1;
      }
    }

    setLastBackupAt(tx, Date.now());
  });

  return { shopId: data.shopId, importedRows, tables: counts };
}

/**
 * Export shop backup JSON and trigger native share sheet or browser file download.
 */
export async function shareShopBackupFile(
  db: AppDb,
  shopId: string,
  role: Role,
): Promise<{ filename: string; uri: string | null }> {
  const json = exportShopJson(db, shopId, role);
  const filename = `sohan-note-backup-${toDateInput(Date.now())}.json`;
  const { Platform } = await import('react-native');

  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined' && typeof Blob !== 'undefined') {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    return { filename, uri: null };
  }

  const [{ File, Paths }, Sharing] = await Promise.all([
    import('expo-file-system'),
    import('expo-sharing'),
  ]);
  const file = new File(Paths.cache, filename);
  await file.write(json);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: 'Export shop backup',
    });
  }
  return { filename, uri: file.uri };
}

/**
 * Open system file picker to choose a JSON backup file and import it into local SQLite.
 * Returns null if the user cancels the picker.
 */
export async function pickAndImportBackupFile(
  db: AppDb,
  opts: { role: Role; targetShopId?: string; mode?: 'merge' | 'replace' },
): Promise<ImportBackupResult | null> {
  if (!can(opts.role, 'manageSettings')) {
    throw new AppError('FORBIDDEN', 'Only shop owners can restore a backup');
  }
  const [DocumentPicker, { Platform }] = await Promise.all([
    import('expo-document-picker'),
    import('react-native'),
  ]);

  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];

  let jsonText: string;
  if (Platform.OS === 'web') {
    const res = await fetch(asset.uri);
    jsonText = await res.text();
  } else {
    const { File } = await import('expo-file-system');
    jsonText = await new File(asset.uri).text();
  }
  return importShopJson(db, jsonText, opts);
}
