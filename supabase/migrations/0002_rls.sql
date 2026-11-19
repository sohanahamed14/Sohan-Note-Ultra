-- 0002_rls: helpers, policies, invites.
create or replace function public.is_shop_member(p_shop_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.shop_members m
    where m.shop_id = p_shop_id and m.user_id = auth.uid() and m.status = 'active' and m.deleted_at is null);
$$;
create or replace function public.shop_role(p_shop_id text) returns text
language sql stable security definer set search_path = public as $$
  select m.role from public.shop_members m
    where m.shop_id = p_shop_id and m.user_id = auth.uid() and m.status = 'active' and m.deleted_at is null
    order by case m.role when 'owner' then 0 when 'manager' then 1 else 2 end limit 1;
$$;
revoke all on function public.is_shop_member(text), public.shop_role(text) from public;
grant execute on function public.is_shop_member(text), public.shop_role(text) to authenticated;

-- Owner membership auto-created on shop insert (id = 'mem_owner_<shop_id>'; client must NOT create it).
create or replace function public.shop_owner_membership() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  select email into v_email from auth.users where id = new.owner_id;
  insert into public.shop_members (id, shop_id, created_at, updated_at, created_by, user_id, email, name, role, status)
  values ('mem_owner_' || new.id, new.id, new.created_at, new.created_at, new.owner_id::text, new.owner_id,
          coalesce(v_email, ''), null, 'owner', 'active')
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists shop_owner_membership on public.shops;
create trigger shop_owner_membership after insert on public.shops for each row execute function public.shop_owner_membership();

alter table public.shops enable row level security;
alter table public.shop_members enable row level security;

drop policy if exists shops_select on public.shops;
create policy shops_select on public.shops for select to authenticated
  using (owner_id = auth.uid() or public.is_shop_member(id));
drop policy if exists shops_insert on public.shops;
create policy shops_insert on public.shops for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists shops_update on public.shops;
create policy shops_update on public.shops for update to authenticated
  using (public.shop_role(id) in ('owner','manager')) with check (public.shop_role(id) in ('owner','manager'));
drop policy if exists shops_delete on public.shops;
create policy shops_delete on public.shops for delete to authenticated using (public.shop_role(id) = 'owner');

drop policy if exists members_select on public.shop_members;
create policy members_select on public.shop_members for select to authenticated using (public.is_shop_member(shop_id));
drop policy if exists members_insert on public.shop_members;
create policy members_insert on public.shop_members for insert to authenticated
  with check (public.shop_role(shop_id) = 'owner' or (public.shop_role(shop_id) = 'manager' and role <> 'owner'));
drop policy if exists members_update on public.shop_members;
create policy members_update on public.shop_members for update to authenticated
  using (public.shop_role(shop_id) = 'owner' or (public.shop_role(shop_id) = 'manager' and role <> 'owner'))
  with check (public.shop_role(shop_id) = 'owner' or (public.shop_role(shop_id) = 'manager' and role <> 'owner'));
drop policy if exists members_delete on public.shop_members;
create policy members_delete on public.shop_members for delete to authenticated
  using (public.shop_role(shop_id) = 'owner' or (public.shop_role(shop_id) = 'manager' and role <> 'owner'));

do $$
declare t text;
begin
  foreach t in array array['categories','products','stock_movements','parties','party_ledger','sales','sale_items',
    'purchases','purchase_items','expenses','cash_entries','online_orders'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists member_all on public.%I', t);
    execute format('create policy member_all on public.%I for all to authenticated using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id))', t);
  end loop;
end $$;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Link invited rows (by auth email, case-insensitive) to the caller. Returns affected shop ids.
create or replace function public.accept_invites() returns setof text
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then return; end if;
  return query
    update public.shop_members m
       set user_id = auth.uid(), status = 'active',
           updated_at = greatest(m.updated_at + 1, (extract(epoch from clock_timestamp()) * 1000)::bigint)
     where lower(m.email) = lower(v_email) and m.status = 'invited' and m.user_id is null and m.deleted_at is null
    returning m.shop_id;
end $$;
revoke all on function public.accept_invites() from public;
grant execute on function public.accept_invites() to authenticated;
