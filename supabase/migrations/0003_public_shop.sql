-- 0003: public storefront RPCs + storage.
create or replace function public.get_public_shop(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.shops; v jsonb;
begin
  select * into s from public.shops where lower(slug) = lower(p_slug) and online_enabled = 1 and deleted_at is null;
  if not found then return null; end if;
  select jsonb_build_object(
    'shop', jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'phone', s.phone, 'address', s.address,
      'business_type', s.business_type, 'logo_uri', s.logo_uri, 'online_theme', s.online_theme,
      'delivery_inside', s.delivery_inside, 'delivery_outside', s.delivery_outside, 'shop_policy', s.shop_policy),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'category_id', p.category_id, 'category_name', c.name,
        'unit', p.unit, 'sell_price', p.sell_price, 'image_uri', p.image_uri, 'description', p.description,
        'featured', p.featured, 'in_stock', coalesce(st.q, 0) > 0) order by p.featured desc, p.name)
      from public.products p
      left join public.categories c on c.id = p.category_id and c.shop_id = p.shop_id and c.deleted_at is null
      left join lateral (select sum(m.qty) q from public.stock_movements m
                         where m.shop_id = p.shop_id and m.product_id = p.id and m.deleted_at is null) st on true
      where p.shop_id = s.id and p.online_visible = 1 and p.deleted_at is null), '[]'::jsonb))
  into v;
  return v;
end $$;

create or replace function public.record_shop_visit(p_slug text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.bump_visits', '1', true);
  update public.shops set online_visits = online_visits + 1
   where lower(slug) = lower(p_slug) and online_enabled = 1 and deleted_at is null;
  perform set_config('app.bump_visits', '', true);
end $$;

create or replace function public.place_online_order(
  p_slug text, p_customer_name text, p_phone text, p_address text, p_items jsonb, p_area text, p_note text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.shops; v_phone text; v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_item jsonb; v_qty numeric; v_pid text; p public.products;
  v_lines jsonb := '[]'::jsonb; v_sub bigint := 0; v_line bigint; v_delivery bigint; v_total bigint;
  v_no text; v_id text := gen_random_uuid()::text; v_count int; v_seen text[] := '{}';
begin
  select * into s from public.shops where lower(slug) = lower(p_slug) and online_enabled = 1 and deleted_at is null;
  if not found then raise exception 'shop_unavailable'; end if;
  if p_customer_name is null or char_length(btrim(p_customer_name)) not between 1 and 100 then raise exception 'invalid_name'; end if;
  v_phone := regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g');
  v_phone := regexp_replace(v_phone, '^(\+?88)', '');
  if v_phone !~ '^01[0-9]{9}$' then raise exception 'invalid_phone'; end if;
  if p_address is null or char_length(btrim(p_address)) not between 5 and 300 then raise exception 'invalid_address'; end if;
  if p_note is not null and char_length(p_note) > 300 then raise exception 'invalid_note'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'invalid_items';
  end if;
  if coalesce(p_area, 'inside') not in ('inside','outside') then raise exception 'invalid_area'; end if;

  select count(*) into v_count from public.online_orders
   where shop_id = s.id and phone = v_phone and status = 'pending' and created_at > v_now - 3600000;
  if v_count >= 5 then raise exception 'rate_limited'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := v_item ->> 'product_id';
    begin v_qty := round((v_item ->> 'qty')::numeric, 3);
    exception when others then raise exception 'invalid_qty'; end;
    if v_pid is null or v_qty is null or v_qty <= 0 or v_qty > 100000 then raise exception 'invalid_qty'; end if;
    if v_pid = any(v_seen) then raise exception 'duplicate_item'; end if;
    v_seen := v_seen || v_pid;
    select * into p from public.products
     where id = v_pid and shop_id = s.id and online_visible = 1 and deleted_at is null;
    if not found then raise exception 'invalid_product'; end if;
    v_line := round(p.sell_price * v_qty)::bigint;
    v_sub := v_sub + v_line;
    v_lines := v_lines || jsonb_build_object('product_id', p.id, 'name', p.name, 'qty', v_qty,
                                             'unit_price', p.sell_price, 'total', v_line);
  end loop;

  v_delivery := case when coalesce(p_area, 'inside') = 'outside' then s.delivery_outside else s.delivery_inside end;
  v_total := v_sub + v_delivery;
  v_no := 'ON-' || lpad(nextval('public.online_order_no_seq')::text, 6, '0');
  insert into public.online_orders (id, shop_id, created_at, updated_at, order_no, customer_name, phone, address,
    items_json, subtotal, delivery_charge, total, status, note, area)
  values (v_id, s.id, v_now, v_now, v_no, btrim(p_customer_name), v_phone, btrim(p_address),
    v_lines::text, v_sub, v_delivery, v_total, 'pending', nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_area, 'inside'));
  return jsonb_build_object('order_no', v_no, 'total', v_total);
end $$;

revoke all on function public.get_public_shop(text), public.record_shop_visit(text),
  public.place_online_order(text, text, text, text, jsonb, text, text) from public;
grant execute on function public.get_public_shop(text), public.record_shop_visit(text),
  public.place_online_order(text, text, text, text, jsonb, text, text) to anon, authenticated;

-- Storage: public read, members upload under <shop_id>/.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('public-images', 'public-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists public_images_read on storage.objects;
create policy public_images_read on storage.objects for select to anon, authenticated using (bucket_id = 'public-images');
drop policy if exists public_images_insert on storage.objects;
create policy public_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'public-images' and public.is_shop_member((storage.foldername(name))[1]));
drop policy if exists public_images_update on storage.objects;
create policy public_images_update on storage.objects for update to authenticated
  using (bucket_id = 'public-images' and public.is_shop_member((storage.foldername(name))[1]))
  with check (bucket_id = 'public-images' and public.is_shop_member((storage.foldername(name))[1]));
drop policy if exists public_images_delete on storage.objects;
create policy public_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'public-images' and public.is_shop_member((storage.foldername(name))[1]));
