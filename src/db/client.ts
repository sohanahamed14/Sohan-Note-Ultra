import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import * as schema from './schema';
import type { AppDb } from './types';

const sqlite = openDatabaseSync('sohan_note_ultra.db', { enableChangeListener: true });
sqlite.execSync('PRAGMA journal_mode = WAL;');
sqlite.execSync('PRAGMA foreign_keys = ON;');

export const expoDb = drizzle(sqlite, { schema });

/** Shared handle typed as `AppDb` so services run unchanged in tests. */
export const db: AppDb = expoDb;
