import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema';

/**
 * Synchronous drizzle sqlite database. Satisfied by expo-sqlite (device),
 * better-sqlite3 (tests) and by the `tx` passed to `db.transaction(...)`.
 */
export type AppDb = BaseSQLiteDatabase<'sync', unknown, typeof schema>;
