import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openDatabaseAsync, openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';
import * as schema from './schema';
import type { AppDb } from './types';

const DB_NAME = 'sohan_note_ultra.db';
const OPTIONS = { enableChangeListener: true };

let instance: ExpoSQLiteDatabase<typeof schema> | null = null;

function open(): ExpoSQLiteDatabase<typeof schema> {
  if (!instance) {
    if (Platform.OS === 'web') throw new Error('Database used before initDb() finished');
    instance = wrap(openDatabaseSync(DB_NAME, OPTIONS));
  }
  return instance;
}

function wrap(sqlite: SQLiteDatabase): ExpoSQLiteDatabase<typeof schema> {
  sqlite.execSync('PRAGMA journal_mode = WAL;');
  sqlite.execSync('PRAGMA foreign_keys = ON;');
  return drizzle(sqlite, { schema });
}

/** A just-reloaded web page can still hold the OPFS file lock for a moment. */
async function openWithRetry(attempts = 8): Promise<SQLiteDatabase> {
  for (let i = 1; ; i++) {
    try {
      return await openDatabaseAsync(DB_NAME, OPTIONS);
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

let initPromise: Promise<void> | null = null;

/** Must resolve before any screen touches the DB (web loads its SQLite worker asynchronously). */
export function initDb(): Promise<void> {
  initPromise ??= openWithRetry().then((sqlite) => {
    instance = wrap(sqlite);
  });
  return initPromise;
}

function lazy<T extends object>(): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const real = open() as unknown as Record<string | symbol, unknown>;
      const value = real[prop];
      return typeof value === 'function' ? value.bind(real) : value;
    },
  });
}

export const expoDb = lazy<ExpoSQLiteDatabase<typeof schema>>();

/** Shared handle typed as `AppDb` so services run unchanged in tests. */
export const db: AppDb = expoDb;
