import fs from 'fs';
import crypto from 'crypto';
import pg from 'pg';
import { env, migrationsDir } from './env.mjs';

async function connect() {
  const urls = [env.SUPABASE_POOLER_URL, env.SUPABASE_DB_URL].filter(Boolean);
  for (const connectionString of urls) {
    const c = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
    try { await c.connect(); return c; } catch (e) { console.warn('connect failed:', e.code ?? e.message); }
  }
  throw new Error('no working DB url');
}

const client = await connect();
await client.query(`create table if not exists public._migrations (
  name text primary key, checksum text not null, applied_at timestamptz not null default now())`);
const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) {
  const sql = fs.readFileSync(`${migrationsDir}/${f}`, 'utf8');
  const sum = crypto.createHash('sha256').update(sql).digest('hex');
  const { rows } = await client.query('select checksum from public._migrations where name=$1', [f]);
  if (rows[0]?.checksum === sum) { console.log('skip', f); continue; }
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query(
      'insert into public._migrations(name,checksum) values($1,$2) on conflict (name) do update set checksum=$2, applied_at=now()', [f, sum]);
    await client.query('commit');
    console.log('applied', f);
  } catch (e) {
    await client.query('rollback');
    console.error('FAILED', f, e.message);
    process.exitCode = 1;
    break;
  }
}
await client.query("notify pgrst, 'reload schema'");
await client.end();
