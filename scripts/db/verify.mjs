import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { env } from './env.mjs';

const opt = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, opt);
const anon = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, opt);
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) failed++; };
const now = () => Date.now();
const rid = () => crypto.randomUUID();
const pw = 'Tst!' + rid();
const stamp = Date.now();
const emailA = `verify.a.${stamp}@example.com`;
const emailB = `Verify.B.${stamp}@Example.com`;
const users = [];

async function mk(email) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  const c = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, opt);
  const r = await c.auth.signInWithPassword({ email, password: pw });
  if (r.error) throw r.error;
  return { c, id: data.user.id };
}
const base = (shop) => ({ shop_id: shop, created_at: now(), updated_at: now() });
const tables = ['shop_members','categories','products','stock_movements','parties','party_ledger','sales','sale_items',
  'purchases','purchase_items','expenses','cash_entries','online_orders'];
const shopId = rid();
const slug = 'verify-' + stamp;
const prod = rid(), hidden = rid();

try {
  const A = await mk(emailA);
  const B = await mk(emailB);

  // 1. A creates shop + rows
  let r = await A.c.from('shops').insert({ id: shopId, ...base(shopId), name: 'Verify Shop', slug, owner_id: A.id, delivery_inside: 6000, delivery_outside: 12000 });
  check('A creates shop', !r.error, r.error?.message);
  r = await A.c.from('shop_members').select('*').eq('shop_id', shopId);
  check('owner membership auto-created', r.data?.length === 1 && r.data[0].role === 'owner' && r.data[0].user_id === A.id);
  r = await A.c.from('products').upsert([
    { id: prod, ...base(shopId), name: 'Rice', unit: 'kg', buy_price: 5000, sell_price: 10000, online_visible: 1 },
    { id: hidden, ...base(shopId), name: 'Secret', unit: 'pc', buy_price: 1, sell_price: 100, online_visible: 0 }]);
  check('A creates products', !r.error, r.error?.message);
  r = await A.c.from('stock_movements').insert({ id: rid(), ...base(shopId), product_id: prod, qty: 10.5, type: 'opening', date: now() });
  check('A creates stock movement', !r.error, r.error?.message);
  r = await A.c.from('shops').insert({ id: rid(), name: 'x', owner_id: B.id, created_at: 1, updated_at: 1 });
  check('A cannot create shop owned by B', !!r.error);

  // LWW + server_seq
  const before = (await A.c.from('products').select('server_seq,name').eq('id', prod).single()).data;
  await A.c.from('products').upsert({ id: prod, ...base(shopId), updated_at: 1, name: 'STALE', sell_price: 10000 });
  const mid = (await A.c.from('products').select('server_seq,name').eq('id', prod).single()).data;
  check('LWW: stale update ignored', mid.name === 'Rice' && mid.server_seq === before.server_seq);
  await A.c.from('products').upsert({ id: prod, ...base(shopId), updated_at: now() + 5, name: 'Rice', sell_price: 10000, online_visible: 1 });
  const after = (await A.c.from('products').select('server_seq').eq('id', prod).single()).data;
  check('server_seq bumps on update', after.server_seq > before.server_seq);

  // 2. B isolated
  for (const t of ['shops', 'products', 'stock_movements', 'shop_members']) {
    r = await B.c.from(t).select('*');
    check(`B cannot read ${t}`, !r.error && r.data.length === 0);
  }
  r = await B.c.from('products').insert({ id: rid(), ...base(shopId), name: 'evil' });
  check('B cannot insert into A shop', !!r.error);
  r = await B.c.from('products').upsert({ id: prod, ...base(shopId), updated_at: now() + 10, name: 'hijack' });
  check('B cannot upsert-hijack A row', !!r.error);
  r = await B.c.from('products').update({ name: 'hijack' }).eq('id', prod).select();
  check('B cannot update A row', !r.error && r.data.length === 0);
  r = await B.c.from('shops').update({ name: 'hijack' }).eq('id', shopId).select();
  check('B cannot update A shop', !r.error && r.data.length === 0);
  r = await B.c.from('shop_members').insert({ id: rid(), ...base(shopId), email: emailB, role: 'owner', status: 'active', user_id: B.id });
  check('B cannot self-add as owner', !!r.error);
  r = await B.c.rpc('accept_invites');
  check('accept_invites with no invite is empty', !r.error && r.data.length === 0);

  // 3. invite B
  const memId = rid();
  r = await A.c.from('shop_members').insert({ id: memId, ...base(shopId), email: emailB.toLowerCase(), name: 'Bee', role: 'cashier', status: 'invited' });
  check('A invites B', !r.error, r.error?.message);
  r = await B.c.from('products').select('id');
  check('B still blind before accept', r.data.length === 0);
  r = await B.c.rpc('accept_invites');
  check('B accept_invites (case-insensitive)', !r.error && r.data.length === 1 && r.data[0] === shopId, JSON.stringify(r));
  r = await B.c.from('products').select('id');
  check('B reads products after accept', r.data?.length === 2);
  r = await B.c.from('shops').select('id');
  check('B reads shop after accept', r.data?.length === 1);

  // cashier restrictions
  r = await B.c.from('shop_members').update({ role: 'owner' }).eq('id', memId).select();
  check('cashier cannot edit members', !r.error && r.data.length === 0);
  r = await B.c.from('shop_members').insert({ id: rid(), ...base(shopId), email: 'z@example.com', role: 'cashier' });
  check('cashier cannot insert member', !!r.error);
  r = await B.c.from('shop_members').delete().eq('id', memId).select();
  check('cashier cannot delete members', !r.error && r.data.length === 0);
  r = await B.c.from('shops').update({ name: 'hijack' }).eq('id', shopId).select();
  check('cashier cannot update shop', !r.error && r.data.length === 0);
  r = await B.c.from('shops').delete().eq('id', shopId).select();
  check('cashier cannot delete shop', !r.error && r.data.length === 0);
  r = await B.c.from('products').update({ name: 'Rice' }).eq('id', prod).select();
  check('cashier can edit data rows', !r.error && r.data.length === 1);

  // manager rules
  await A.c.from('shop_members').update({ role: 'manager', updated_at: now() + 20 }).eq('id', memId);
  r = await B.c.from('shop_members').insert({ id: rid(), ...base(shopId), email: 'o@example.com', role: 'owner' });
  check('manager cannot create owner', !!r.error);
  const m2 = rid();
  r = await B.c.from('shop_members').insert({ id: m2, ...base(shopId), email: 'c@example.com', role: 'cashier' });
  check('manager can create cashier', !r.error, r.error?.message);
  r = await B.c.from('shop_members').update({ role: 'owner' }).eq('id', memId).select();
  check('manager cannot promote self to owner', !!r.error || r.data.length === 0);
  r = await B.c.from('shops').delete().eq('id', shopId).select();
  check('manager cannot delete shop', !r.error && r.data.length === 0);
  r = await B.c.from('shops').update({ online_visits: 999, owner_id: B.id, updated_at: now() + 30 }).eq('id', shopId).select();
  check('manager update cannot change owner_id/visits', !r.error && r.data[0]?.owner_id === A.id && r.data[0]?.online_visits === 0);

  // 4. anon RPCs
  r = await anon.rpc('get_public_shop', { p_slug: slug });
  check('get_public_shop null when online disabled', !r.error && r.data === null);
  const order = (items, extra = {}) => anon.rpc('place_online_order', {
    p_slug: slug, p_customer_name: 'Cus', p_phone: '01712345678', p_address: 'House 1, Road 2', p_items: items, p_area: 'inside', p_note: null, ...extra });
  r = await order([{ product_id: prod, qty: 1 }]);
  check('order rejected when online disabled', !!r.error);
  await A.c.from('shops').update({ online_enabled: 1, updated_at: now() + 40 }).eq('id', shopId);
  r = await anon.rpc('get_public_shop', { p_slug: slug });
  const ps = r.data?.products ?? [];
  check('get_public_shop returns visible only + in_stock', ps.length === 1 && ps[0].id === prod && ps[0].in_stock === true && !('buy_price' in ps[0]), JSON.stringify(r));
  r = await anon.from('products').select('id');
  check('anon cannot read tables directly', !!r.error || r.data.length === 0);
  r = await anon.rpc('record_shop_visit', { p_slug: slug });
  check('record_shop_visit ok', !r.error, r.error?.message);
  check('visits counter incremented', (await A.c.from('shops').select('online_visits').eq('id', shopId).single()).data.online_visits === 1);

  // price tampering
  r = await order([{ product_id: prod, qty: 2.5, unit_price: 1, price: 1, total: 1 }]);
  check('order total computed server-side (25000+6000)', !r.error && r.data.total === 31000 && /^ON-/.test(r.data.order_no), JSON.stringify(r));
  const row = (await A.c.from('online_orders').select('*').eq('shop_id', shopId)).data[0];
  check('stored order uses server price', row.subtotal === 25000 && JSON.parse(row.items_json)[0].unit_price === 10000 && row.status === 'pending');
  r = await order([{ product_id: prod, qty: 1 }], { p_area: 'outside' });
  check('outside delivery charge', !r.error && r.data.total === 22000);
  r = await anon.from('online_orders').update({ total: 1 }).eq('shop_id', shopId).select();
  check('anon cannot tamper orders table', !!r.error || r.data.length === 0);
  const bad = {
    'hidden product': () => order([{ product_id: hidden, qty: 1 }]),
    'unknown product': () => order([{ product_id: 'nope', qty: 1 }]),
    'qty 0': () => order([{ product_id: prod, qty: 0 }]),
    'negative qty': () => order([{ product_id: prod, qty: -1 }]),
    'bad phone': () => order([{ product_id: prod, qty: 1 }], { p_phone: '12345' }),
    'empty items': () => order([]),
    '21 items': () => order(Array.from({ length: 21 }, () => ({ product_id: prod, qty: 1 }))),
    'bad area': () => order([{ product_id: prod, qty: 1 }], { p_area: 'moon' }),
    'empty name': () => order([{ product_id: prod, qty: 1 }], { p_customer_name: ' ' }),
  };
  for (const [k, f] of Object.entries(bad)) { r = await f(); check(`rejects ${k}`, !!r.error); }
  for (let i = 0; i < 2; i++) await order([{ product_id: prod, qty: 1 }]); // 4 pending now
  r = await order([{ product_id: prod, qty: 1 }]);
  check('5th pending allowed', !r.error, r.error?.message);
  r = await order([{ product_id: prod, qty: 1 }]);
  check('6th pending/hour blocked', !!r.error && /rate_limited/.test(r.error.message));
  r = await order([{ product_id: prod, qty: 1 }], { p_phone: '+8801811111111' });
  check('+880 phone normalized, other phone ok', !r.error);

  // 5. storage
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  r = await A.c.storage.from('public-images').upload(`${shopId}/t.png`, png, { contentType: 'image/png' });
  check('member uploads under <shop_id>/', !r.error, r.error?.message);
  r = await A.c.storage.from('public-images').upload(`other-shop/t.png`, png, { contentType: 'image/png' });
  check('member cannot upload to other folder', !!r.error);
  const outsider = await mk(`verify.c.${stamp}@example.com`);
  r = await outsider.c.storage.from('public-images').upload(`${shopId}/evil.png`, png, { contentType: 'image/png' });
  check('non-member cannot upload', !!r.error);
  const url = anon.storage.from('public-images').getPublicUrl(`${shopId}/t.png`).data.publicUrl;
  check('public read of image', (await fetch(url)).status === 200);
} catch (e) {
  console.error('ERROR', e);
  failed++;
} finally {
  const db = new pg.Client({ connectionString: env.SUPABASE_POOLER_URL ?? env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  for (const t of [...tables, 'shops']) await db.query(`delete from public.${t} where shop_id = $1`, [shopId]);
  await db.query(`delete from storage.objects where bucket_id='public-images' and name like $1`, [shopId + '/%']).catch(() => {});
  await db.end();
  for (const id of users) await admin.auth.admin.deleteUser(id);
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
  process.exit(failed ? 1 : 0);
}
