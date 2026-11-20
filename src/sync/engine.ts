import { eq, sql } from 'drizzle-orm';
import { SYNCED_TABLES, kv, sync_state } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { LOCAL_COLUMNS, toLocalRow, toRemoteRow } from './payload';
import { detectImageFormat, isLocalFileUri } from './imageUtils';
import {
  SYNC_ORDER,
  type SyncResult,
  type SyncTableError,
  type SyncTableName,
  type SyncTransport,
  type TransportError,
} from './types';

async function defaultTransport(): Promise<SyncTransport> {
  const mod = await import('./supabaseTransport');
  return mod.createSupabaseTransport();
}

export const LAST_BACKUP_KEY = 'last_backup_at';
const DEFAULT_PUSH_BATCH = 200;
const DEFAULT_PULL_PAGE = 1000;

export function getLastBackupAt(db: AppDb): number | null {
  const row = db.select().from(kv).where(eq(kv.key, LAST_BACKUP_KEY)).get();
  if (!row) return null;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : null;
}

export function setLastBackupAt(db: AppDb, at: number = Date.now()): number {
  db.insert(kv)
    .values({ key: LAST_BACKUP_KEY, value: String(at) })
    .onConflictDoUpdate({ target: kv.key, set: { value: String(at) } })
    .run();
  return at;
}

export function countDirtyRows(db: AppDb, shopId?: string): number {
  let total = 0;
  for (const table of SYNC_ORDER) {
    const tbl = SYNCED_TABLES[table];
    const row = shopId
      ? db.get<{ c: number }>(
          sql`SELECT COUNT(*) AS c FROM ${tbl} WHERE dirty = 1 AND shop_id = ${shopId}`,
        )
      : db.get<{ c: number }>(sql`SELECT COUNT(*) AS c FROM ${tbl} WHERE dirty = 1`);
    total += Number(row?.c ?? 0);
  }
  return total;
}

export function getSyncCursor(db: AppDb, shopId: string, table: SyncTableName): number {
  const key = `${shopId}:${table}`;
  const row = db.select().from(sync_state).where(eq(sync_state.key, key)).get();
  return row ? Number(row.cursor) : 0;
}

export function setSyncCursor(
  db: AppDb,
  shopId: string,
  table: SyncTableName,
  cursor: number,
  syncedAt: number = Date.now(),
): void {
  const key = `${shopId}:${table}`;
  db.insert(sync_state)
    .values({ key, cursor, last_synced_at: syncedAt })
    .onConflictDoUpdate({
      target: sync_state.key,
      set: { cursor, last_synced_at: syncedAt },
    })
    .run();
}

function mapTableError(table: SyncTableName, err: TransportError): SyncTableError {
  if (err.code === '23505' && table === 'shops') {
    return {
      table,
      code: 'SLUG_TAKEN',
      message: 'This shop link slug is already taken. Please pick another slug in Store settings.',
    };
  }
  if (err.code === '42501') {
    return {
      table,
      code: 'FORBIDDEN',
      message: `Permission denied syncing ${table}: ${err.message}`,
    };
  }
  return {
    table,
    code: err.isNetwork ? 'NETWORK' : (err.code ?? 'SYNC_ERROR'),
    message: err.message,
  };
}

function isOwnOwnerMembership(row: Record<string, unknown>, userId: string | null): boolean {
  const id = String(row.id ?? '');
  const shopId = String(row.shop_id ?? '');
  if (id === `mem_owner_${shopId}`) return true;
  if (
    userId &&
    row.role === 'owner' &&
    row.user_id === userId &&
    (row.deleted_at === null || row.deleted_at === undefined)
  ) {
    return true;
  }
  return false;
}

async function resolveLocalImagesForRow(
  db: AppDb,
  table: SyncTableName,
  row: Record<string, unknown>,
  transport: SyncTransport,
): Promise<Record<string, unknown>> {
  if (!transport.uploadImage) return row;
  const shopId = String(row.shop_id ?? row.id ?? '');
  const id = String(row.id ?? '');
  if (!shopId || !id) return row;

  const updated = { ...row };
  const tbl = SYNCED_TABLES[table];

  if (table === 'shops') {
    for (const col of ['logo_uri', 'payment_qr_uri'] as const) {
      const uri = updated[col];
      if (typeof uri === 'string' && isLocalFileUri(uri)) {
        const { ext } = detectImageFormat(uri);
        const relPath = col === 'logo_uri' ? `logo.${ext}` : `qr.${ext}`;
        const publicUrl = await transport.uploadImage(shopId, uri, relPath);
        updated[col] = publicUrl;
        db.run(
          sql`UPDATE ${tbl} SET ${sql.identifier(col)} = ${publicUrl} WHERE id = ${id} AND updated_at = ${Number(row.updated_at)}`,
        );
      }
    }
  } else if (table === 'products') {
    const uri = updated.image_uri;
    if (typeof uri === 'string' && isLocalFileUri(uri)) {
      const { ext } = detectImageFormat(uri);
      const publicUrl = await transport.uploadImage(shopId, uri, `products/${id}.${ext}`);
      updated.image_uri = publicUrl;
      db.run(
        sql`UPDATE ${tbl} SET image_uri = ${publicUrl} WHERE id = ${id} AND updated_at = ${Number(row.updated_at)}`,
      );
    }
  }
  return updated;
}

export async function pushDirtyTable(
  db: AppDb,
  table: SyncTableName,
  transport: SyncTransport,
  opts: { userId?: string | null; batchSize?: number } = {},
): Promise<{ pushed: number; error?: SyncTableError; isNetworkError?: boolean }> {
  const batchSize = Math.min(Math.max(opts.batchSize ?? DEFAULT_PUSH_BATCH, 1), 200);
  const userId = opts.userId ?? null;
  const tbl = SYNCED_TABLES[table];
  let pushed = 0;

  while (true) {
    const dirtyRows = db.all<Record<string, unknown>>(
      sql`SELECT * FROM ${tbl} WHERE dirty = 1 ORDER BY updated_at ASC LIMIT ${batchSize}`,
    );
    if (dirtyRows.length === 0) break;

    const toPush: Record<string, unknown>[] = [];
    const skippedOwnerIds: { id: string; updated_at: number }[] = [];

    for (const rawRow of dirtyRows) {
      if (table === 'shop_members' && isOwnOwnerMembership(rawRow, userId)) {
        skippedOwnerIds.push({ id: String(rawRow.id), updated_at: Number(rawRow.updated_at) });
        continue;
      }
      toPush.push(rawRow);
    }

    if (skippedOwnerIds.length > 0) {
      db.transaction((tx) => {
        for (const s of skippedOwnerIds) {
          tx.run(
            sql`UPDATE ${tbl} SET dirty = 0 WHERE id = ${s.id} AND updated_at = ${s.updated_at}`,
          );
        }
      });
    }

    if (toPush.length === 0) {
      if (dirtyRows.length < batchSize) break;
      continue;
    }

    const prepared: { id: string; updated_at: number; payload: Record<string, unknown> }[] = [];
    for (const r of toPush) {
      try {
        const resolved = await resolveLocalImagesForRow(db, table, r, transport);
        prepared.push({
          id: String(r.id),
          updated_at: Number(r.updated_at),
          payload: toRemoteRow(table, resolved),
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Image upload failed';
        const isNet = e instanceof AppError && e.code === 'NETWORK';
        return {
          pushed,
          error: { table, code: isNet ? 'NETWORK' : 'UPLOAD_ERROR', message },
          isNetworkError: isNet,
        };
      }
    }

    const err = await transport.upsert(
      table,
      prepared.map((p) => p.payload),
    );
    if (err) {
      return { pushed, error: mapTableError(table, err), isNetworkError: !!err.isNetwork };
    }

    db.transaction((tx) => {
      for (const p of prepared) {
        tx.run(
          sql`UPDATE ${tbl} SET dirty = 0 WHERE id = ${p.id} AND updated_at = ${p.updated_at}`,
        );
      }
    });
    pushed += prepared.length;

    if (dirtyRows.length < batchSize) break;
  }

  return { pushed };
}

function upsertLocalRow(db: AppDb, table: SyncTableName, localRow: Record<string, unknown>): void {
  const tbl = SYNCED_TABLES[table];
  const cols = [...LOCAL_COLUMNS[table], 'dirty'];
  const colIdents = cols.map((c) => sql.identifier(c));
  const vals = cols.map((c) => sql`${localRow[c] ?? null}`);
  const updateSet = cols
    .filter((c) => c !== 'id')
    .map((c) => sql`${sql.identifier(c)} = excluded.${sql.identifier(c)}`);

  db.run(
    sql`INSERT INTO ${tbl} (${sql.join(colIdents, sql`, `)})
        VALUES (${sql.join(vals, sql`, `)})
        ON CONFLICT(id) DO UPDATE SET ${sql.join(updateSet, sql`, `)}`,
  );
}

export async function pullShopTable(
  db: AppDb,
  shopId: string,
  table: SyncTableName,
  transport: SyncTransport,
  opts: { pageSize?: number } = {},
): Promise<{ pulled: number; error?: SyncTableError; isNetworkError?: boolean }> {
  const pageSize = opts.pageSize ?? DEFAULT_PULL_PAGE;
  const tbl = SYNCED_TABLES[table];
  let cursor = getSyncCursor(db, shopId, table);
  let pulled = 0;

  while (true) {
    const res = await transport.pullPage(table, shopId, cursor, pageSize);
    if (res.error) {
      return {
        pulled,
        error: mapTableError(table, res.error),
        isNetworkError: !!res.error.isNetwork,
      };
    }
    const rows = res.data ?? [];
    if (rows.length === 0) break;

    let maxSeq = cursor;
    const now = Date.now();

    db.transaction((tx) => {
      for (const remote of rows) {
        const seq = Number(remote.server_seq ?? 0);
        if (seq > maxSeq) maxSeq = seq;

        const id = String(remote.id ?? '');
        if (!id) continue;

        const local = tx.get<{ updated_at: number; dirty: number } | undefined>(
          sql`SELECT updated_at, dirty FROM ${tbl} WHERE id = ${id}`,
        );
        const remoteUpdated = Number(remote.updated_at ?? 0);

        if (!local || local.dirty === 0 || remoteUpdated >= Number(local.updated_at)) {
          const normalized = toLocalRow(table, remote);
          upsertLocalRow(tx, table, normalized);
          pulled += 1;

          // Remove duplicate local-only owner membership placeholder once canonical mem_owner_<shop> arrives.
          if (table === 'shop_members' && id === `mem_owner_${shopId}` && normalized.user_id) {
            tx.run(
              sql`DELETE FROM ${tbl}
                  WHERE shop_id = ${shopId}
                    AND role = 'owner'
                    AND user_id = ${String(normalized.user_id)}
                    AND id <> ${id}`,
            );
          }
        }
      }
      setSyncCursor(tx, shopId, table, maxSeq, now);
    });

    cursor = maxSeq;
    if (rows.length < pageSize) break;
  }

  return { pulled };
}

export async function pullShop(
  db: AppDb,
  shopId: string,
  transport: SyncTransport,
  opts: { pageSize?: number } = {},
): Promise<{ pulled: number; errors: SyncTableError[]; isNetworkError: boolean }> {
  let pulled = 0;
  const errors: SyncTableError[] = [];
  let isNetworkError = false;

  for (const table of SYNC_ORDER) {
    const res = await pullShopTable(db, shopId, table, transport, opts);
    pulled += res.pulled;
    if (res.error) {
      errors.push(res.error);
      if (res.isNetworkError) {
        isNetworkError = true;
        break;
      }
    }
  }
  return { pulled, errors, isNetworkError };
}

/**
 * Clear local data for a previously synced shop that the user no longer has access to (RLS revoked).
 */
export function purgeRevokedShop(db: AppDb, shopId: string): void {
  db.transaction((tx) => {
    for (const table of SYNC_ORDER) {
      const tbl = SYNCED_TABLES[table];
      if (table === 'shops') {
        tx.run(sql`DELETE FROM ${tbl} WHERE id = ${shopId}`);
      } else {
        tx.run(sql`DELETE FROM ${tbl} WHERE shop_id = ${shopId}`);
      }
    }
    tx.run(sql`DELETE FROM ${sync_state} WHERE key LIKE ${`${shopId}:%`}`);
  });
}

export async function acceptInvites(transport?: SyncTransport): Promise<string[]> {
  const t = transport ?? (await defaultTransport());
  const res = await t.acceptInvites();
  if (res.error) {
    throw new AppError(res.error.isNetwork ? 'NETWORK' : 'UNKNOWN', res.error.message);
  }
  return res.data ?? [];
}

const activeSyncs = new WeakMap<AppDb, Promise<SyncResult>>();

export type SyncNowOptions = {
  transport?: SyncTransport;
  userId?: string | null;
  skipInvites?: boolean;
  batchSize?: number;
  pageSize?: number;
};

/**
 * Full bidirectional sync:
 * 1. accept_invites()
 * 2. Push dirty rows across all 14 tables in SYNC_ORDER (uploading local images first)
 * 3. Fetch accessible remote shops; purge local synced shops whose access was revoked
 * 4. Pull each accessible shop incrementally by server_seq (LWW)
 * 5. Record `last_backup_at` in `kv`
 */
export function syncNow(db: AppDb, opts: SyncNowOptions = {}): Promise<SyncResult> {
  const inFlight = activeSyncs.get(db);
  if (inFlight) return inFlight;

  const run = (async (): Promise<SyncResult> => {
    const transport = opts.transport ?? (await defaultTransport());
    const userId = opts.userId !== undefined ? opts.userId : await transport.getSessionUserId();
    if (!userId) {
      throw new AppError('NETWORK', 'Sign in with a cloud account to sync');
    }

    let acceptedInvites: string[] = [];
    const errors: SyncTableError[] = [];

    if (!opts.skipInvites) {
      const inv = await transport.acceptInvites();
      if (inv.error) {
        if (inv.error.isNetwork) {
          throw new AppError('NETWORK', inv.error.message);
        }
        errors.push({
          table: 'shop_members',
          code: inv.error.code ?? 'INVITE_ERROR',
          message: inv.error.message,
        });
      } else {
        acceptedInvites = inv.data ?? [];
      }
    }

    let pushed = 0;
    for (const table of SYNC_ORDER) {
      const res = await pushDirtyTable(db, table, transport, {
        userId,
        batchSize: opts.batchSize,
      });
      pushed += res.pushed;
      if (res.error) {
        errors.push(res.error);
        if (res.isNetworkError) {
          throw new AppError('NETWORK', res.error.message);
        }
      }
    }

    const remoteShopsRes = await transport.listAccessibleShopIds();
    if (remoteShopsRes.error) {
      throw new AppError(
        remoteShopsRes.error.isNetwork ? 'NETWORK' : 'UNKNOWN',
        remoteShopsRes.error.message,
      );
    }
    const remoteShopIds = remoteShopsRes.data ?? [];
    const remoteSet = new Set(remoteShopIds);

    // Purge local shops that were previously synced (dirty = 0) and are no longer accessible via RLS.
    const localSyncedShops = db.all<{ id: string }>(
      sql`SELECT id FROM ${SYNCED_TABLES.shops} WHERE dirty = 0`,
    );
    const revokedShops: string[] = [];
    for (const local of localSyncedShops) {
      if (!remoteSet.has(local.id)) {
        purgeRevokedShop(db, local.id);
        revokedShops.push(local.id);
      }
    }

    let pulled = 0;
    for (const sid of remoteShopIds) {
      const res = await pullShop(db, sid, transport, { pageSize: opts.pageSize });
      pulled += res.pulled;
      if (res.errors.length > 0) errors.push(...res.errors);
      if (res.isNetworkError) {
        throw new AppError('NETWORK', res.errors[res.errors.length - 1]?.message ?? 'Network error');
      }
    }

    const syncedAt = Date.now();
    if (errors.length === 0) {
      setLastBackupAt(db, syncedAt);
    }
    return { pushed, pulled, acceptedInvites, revokedShops, errors, syncedAt };
  })();

  activeSyncs.set(db, run);
  return run.finally(() => {
    if (activeSyncs.get(db) === run) {
      activeSyncs.delete(db);
    }
  });
}
