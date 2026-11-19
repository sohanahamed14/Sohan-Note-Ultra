-- 0001_schema: synced tables mirroring replica/recon.md. Money = bigint paisa, time = bigint epoch ms.
create sequence if not exists public.server_seq_gen;
create sequence if not exists public.online_order_no_seq;

-- Common cols: id, shop_id, created_at, updated_at, deleted_at, created_by, server_seq (server-only).
create table if not exists public.shops (
  id text primary key, shop_id text, created_at bigint not null, updated_at bigint not null, deleted_at bigint, created_by text, server_seq bigint,
  name text not null, slug text, phone text, address text, business_type text, logo_uri text,
  vat_percent numeric(7,3) not null default 0, invoice_footer text, payment_qr_uri text,
  decimal_enabled smallint not null default 0 check (decimal_enabled in (0,1)),
  online_enabled smallint not null default 0 check (online_enabled in (0,1)),
  online_theme text, delivery_inside bigint not null default 0, delivery_outside bigint not null default 0, shop_policy text,
  owner_id uuid not null references auth.users(id) on delete cascade,
  online_visits bigint not null default 0
);
create unique index if not exists shops_slug_uq on public.shops (lower(slug)) where slug is not null and deleted_at is null;
create index if not exists shops_owner_idx on public.shops (owner_id);

create table if not exists public.shop_members (
  id text primary key, shop_id text not null, created_at bigint not null, updated_at bigint not null, deleted_at bigint, created_by text, server_seq bigint,
  user_id uuid, email text not null, name text,
  role text not null check (role in ('owner','manager','cashier')),
  status text not null default 'invited' check (status in ('invited','active'))
);
create index if not exists shop_members_user_idx on public.shop_members (user_id) where deleted_at is null;
create index if not exists shop_members_email_idx on public.shop_members (lower(email));

create table if not exists public.categories (
  id text primary key, shop_id text not null, created_at bigint not null, updated_at bigint not null, deleted_at bigint, created_by text, server_seq bigint,
  name text not null, kind text not null check (kind in ('product','expense'))
);
create table if not exists public.products (
  id text primary key, shop_id text not null, created_at bigint not null, updated_at bigint not null, deleted_at bigint, created_by text, server_seq bigint,
  name text not null, category_id text, unit text, code text,
  buy_price bigint not null default 0, sell_price bigint not null default 0, wholesale_price bigint not null default 0,
  low_stock_alert numeric(14,3) not null default 0, warranty_days integer not null default 0, image_uri text, description text,
  online_visible smallint not null default 0 check (online_visible in (0,1)), featured smallint not null default 0 check (featured in (0,1))
);
create table if not exists public.stock_movements (
  id text primary key, shop_id text not null, created_at bigint not null, updated_at bigint not null, deleted_at bigint, created_by text, server_seq bigint,
  product_id text not null, qty numeric(14,3) not null,
  type text not null check (type in ('opening','purchase','sale','adjust','restore')),
  ref_id text, note text, date bigint not null
);
create table if not exists public.parties (
  id text primary key, shop_id text not null, created_at bigint not null, updated_at bigint not null, deleted_at bigint, created_by text, server_seq bigint,
  type text not null check (type in ('customer','supplier','employee')),
  name text not null, phone text, address text, note text
);
create table if not exists public.party_ledger (
  id text primary key, shop_id text not null, created_at bigint not null, updated_at bigint not null, deleted_at bigint, created_by text, server_seq bigint,
  party_id text not null, amount bigint not null,
  type text not null check (type in ('sale_due','purchase_due','received','paid','give','take','opening')),
  ref_id text, date bigint not null, note text
);
create table if not exists public.sales (
  id text primary key, shop_id text not null, created_at bigint not null, updated_at bigint not null, deleted_at bigint, created_by text, server_seq bigint,
  invoice_no text, party_id text, date bigint not null,
  subtotal bigint not null default 0, discount bigint not null default 0, vat bigint not null default 0, total bigint not null default 0,
  paid bigint not null default 0, due bigint not null default 0,
  method text check (method in ('cash','bkash','nagad','card','bank','other')),
  kind text not null default 'pos' check (kind in ('pos','quick','online')), note text
);
create table if not exists public.sale_items (
  id text primary key, shop_id text not null, created_at bigint not null, updated_at bigint not null, deleted_at bigint, created_by text, server_seq bigint,
  sale_id text not null, product_id text, name text not null, qty numeric(14,3) not null,
  unit_price bigint not null default 0, buy_price bigint not null default 0, total bigint not null default 0, warranty_until bigint
);
create table if not exists public.purchases (
  id text primary key, shop_id text not null, created_at bigint not null, updated_at bigint not null, deleted_at bigint, created_by text, server_seq bigint,
  bill_no text, party_id text, date bigint not null,
  subtotal bigint not null default 0, discount bigint not null default 0, vat bigint not null default 0, total bigint not null default 0,
  paid bigint not null default 0, due bigint not null default 0,
  method text check (method in ('cash','bkash','nagad','card','bank','other')),
  kind text, note text
);
create table if not exists public.purchase_items (
  id text primary key, shop_id text not null, created_at bigint not null, updated_at bigint not null, deleted_at bigint, created_by text, server_seq bigint,
  purchase_id text not null, product_id text, name text not null, qty numeric(14,3) not null,
  unit_price bigint not null default 0, buy_price bigint not null default 0, total bigint not null default 0, warranty_until bigint
);
create table if not exists public.expenses (
  id text primary key, shop_id text not null, created_at bigint not null, updated_at bigint not null, deleted_at bigint, created_by text, server_seq bigint,
  category_id text, amount bigint not null, date bigint not null,
  method text check (method in ('cash','bkash','nagad','card','bank','other')), note text
);
create table if not exists public.cash_entries (
  id text primary key, shop_id text not null, created_at bigint not null, updated_at bigint not null, deleted_at bigint, created_by text, server_seq bigint,
  amount bigint not null,
  type text not null check (type in ('sale','purchase','expense','received','paid','capital_in','capital_out','cash_in','cash_out')),
  method text check (method in ('cash','bkash','nagad','card','bank','other')),
  ref_id text, date bigint not null, note text
);
-- note/area added beyond recon: needed by place_online_order(p_note, p_area).
create table if not exists public.online_orders (
  id text primary key, shop_id text not null, created_at bigint not null, updated_at bigint not null, deleted_at bigint, created_by text, server_seq bigint,
  order_no text not null, customer_name text not null, phone text not null, address text not null, items_json text not null,
  subtotal bigint not null default 0, delivery_charge bigint not null default 0, total bigint not null default 0,
  status text not null default 'pending' check (status in ('pending','confirmed','delivered','cancelled')),
  sale_id text, note text, area text
);

-- Generic trigger: LWW guard + server_seq.
create or replace function public.sync_row_trigger() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.updated_at < old.updated_at then
      return old; -- stale write: ignore
    end if;
    new.id := old.id;
    new.created_at := old.created_at;
    if tg_table_name = 'shops' then
      new.owner_id := old.owner_id;
      if coalesce(current_setting('app.bump_visits', true), '') <> '1' then
        new.online_visits := old.online_visits;
      end if;
    end if;
  end if;
  if tg_table_name = 'shops' then
    new.shop_id := new.id;
    if tg_op = 'INSERT' then new.online_visits := 0; end if;
  elsif tg_op = 'UPDATE' then
    new.shop_id := old.shop_id;
  end if;
  new.server_seq := nextval('public.server_seq_gen');
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['shops','shop_members','categories','products','stock_movements','parties','party_ledger',
    'sales','sale_items','purchases','purchase_items','expenses','cash_entries','online_orders'] loop
    execute format('drop trigger if exists sync_row on public.%I', t);
    execute format('create trigger sync_row before insert or update on public.%I for each row execute function public.sync_row_trigger()', t);
    execute format('create index if not exists %I on public.%I (shop_id, server_seq)', t || '_shop_seq_idx', t);
  end loop;
end $$;
