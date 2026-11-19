# Sync contract (client ⇄ Supabase)

Project `nhxxttkpnzqtsojmsiex`. Client uses publishable key only (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_KEY`).
Schema: `supabase/migrations/0001..0003`. Apply: `cd scripts/db && npm i && node migrate.mjs`. Check: `node verify.mjs`.

## Column rules
- Same table/column names as local SQLite (snake_case). Booleans are `smallint` 0/1 (no conversion). Money `bigint` paisa, time `bigint` epoch ms, qty `numeric(14,3)`. JSON returns numbers as numbers.
- **Never send** `dirty` or `server_seq` (server overwrites `server_seq`; unknown column `dirty` errors). Strip `dirty` before push.
- Extra server-side cols vs recon: `online_orders.note`, `online_orders.area` (add locally, nullable); `shops.online_visits` (read-only: server ignores client value) ; `shops.shop_id` = `id` (server sets).
- **Upsert payloads must contain ALL columns of that table** (PostgREST bulk upsert fills missing keys with null → NOT NULL violations). Send `null` for empty optionals.
- `shops.owner_id` must equal `auth.uid()` on insert and is immutable. `shops.slug` unique (case-insensitive, among non-deleted) → push fails with 23505; ask user for another slug.
- Owner membership is auto-created by trigger with id `mem_owner_<shop_id>`. Client should not push its own owner membership; it arrives on pull.
- Invited member: insert `shop_members` row `{role, email, status:'invited', user_id:null}`.

## Push (per table, ordered)
Order (no FKs, so order is only for readability): `shops, shop_members, categories, products, parties, stock_movements, party_ledger, sales, sale_items, purchases, purchase_items, expenses, cash_entries, online_orders`.
For each: `select * where dirty=1` in batches ≤200, `supabase.from(t).upsert(rows, {onConflict:'id'})`; on success clear `dirty` only where `updated_at` unchanged since read. Soft deletes are normal updates (`deleted_at` set). Never hard delete.
Server LWW: an update with `updated_at` < stored `updated_at` is silently ignored (no error, no `server_seq` bump); equal/newer wins. Errors 42501/RLS = no permission (keep dirty, surface); 23505 = slug clash.

## Pull (per shop)
1. After login: `rpc('accept_invites')` (returns shop ids of newly linked invites; ignore result).
2. `from('shops').select('*')` (RLS → only my shops) → shop list; for each shop id keep cursor `last_seq[shop_id][table]`.
3. For each table in order: loop `select * from t where shop_id=eq.<id> and server_seq>cursor order server_seq asc limit 1000` until fewer than 1000. Shops: `where id=<id>` + `server_seq>cursor`.
4. Apply locally: insert if absent; else overwrite only if `remote.updated_at >= local.updated_at` or local not dirty (LWW). Set `dirty=0`. Advance cursor to max `server_seq` seen. Pull also returns the client's own pushed rows (harmless).
5. Run pull after push; poll (e.g. 30s foreground) or use Realtime later. Revoked members get empty results (RLS) – on empty shop list, clear local data for that shop.

## Roles (enforced by RLS)
owner: all. manager: all data + members (not owner rows) + update shop; cannot delete shop. cashier: data rows CRUD only; cannot touch members/shops. UI should additionally hide cost/profit/reports for cashier (RLS doesn't).

## RPCs
- `accept_invites() → setof text` (auth).
- `get_public_shop(p_slug text) → jsonb|null` (anon) null unless `online_enabled=1`. `{shop:{id,name,slug,phone,address,business_type,logo_uri,online_theme,delivery_inside,delivery_outside,shop_policy}, products:[{id,name,category_id,category_name,unit,sell_price,image_uri,description,featured,in_stock}]}`.
- `place_online_order(p_slug, p_customer_name, p_phone, p_address, p_items jsonb, p_area text, p_note text) → {order_no,total}` (anon). `p_items=[{product_id,qty}]` (client prices ignored); `p_area` `inside|outside`; phone `01XXXXXXXXX` (`+880`/`88` prefix accepted). Errors (message): `shop_unavailable, invalid_name, invalid_phone, invalid_address, invalid_note, invalid_items, invalid_qty, invalid_product, duplicate_item, invalid_area, rate_limited`(5 pending/phone/hour).
- `record_shop_visit(p_slug text) → void` (anon).
Order appears for members in `online_orders` (status `pending`) on next pull.

## Storage
Bucket `public-images` (public read, 5 MB, jpeg/png/webp). Members upload to `<shop_id>/<filename>` (e.g. `<shop_id>/logo.png`, `<shop_id>/products/<product_id>.jpg`, `<shop_id>/qr.png`) with `upsert:true`. Store the public URL (`getPublicUrl`) in `logo_uri / image_uri / payment_qr_uri` — public URLs are required by the storefront.

## Human steps: Google login
1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID (Web application). Authorized redirect URI: `https://nhxxttkpnzqtsojmsiex.supabase.co/auth/v1/callback`. Copy Client ID + Secret.
2. Supabase Dashboard → Authentication → Providers → Google → enable, paste ID/Secret, save.
3. Authentication → URL Configuration: Site URL `http://localhost:8081`; Redirect URLs add `sohannote://auth-callback`, `http://localhost:8081`, `http://localhost:8081/**`, and future web domain (`https://<domain>`, `https://<domain>/**`). Expo Go dev redirect: add `exp://**` if testing in Expo Go.
4. Optional dev email/password: Authentication → Providers → Email enabled; create test user in dashboard.
