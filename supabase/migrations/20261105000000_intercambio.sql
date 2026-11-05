create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  subfamily text not null check (length(trim(subfamily)) between 1 and 80),
  user_id uuid unique references auth.users (id) on delete set null,
  active boolean not null default true,
  attendance_confirmed_at timestamptz,
  excluded_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists participants_name_subfamily_unique
  on public.participants (lower(name), lower(subfamily));

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  deadline timestamptz not null,
  draw_authorized boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.app_settings (id, deadline)
values (true, make_timestamptz(2026, 11, 23, 23, 59, 0, 'America/Mexico_City'))
on conflict (id) do nothing;

create table if not exists public.wishlists (
  participant_id uuid primary key references public.participants (id) on delete cascade,
  tastes text not null default '' check (length(tastes) <= 1000),
  wishlist text not null default '' check (length(wishlist) <= 1500),
  updated_at timestamptz not null default now()
);

create table if not exists public.assignments (
  giver_id uuid primary key references public.participants (id) on delete cascade,
  recipient_id uuid not null unique references public.participants (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (giver_id <> recipient_id)
);

create table if not exists public.assignment_views (
  participant_id uuid primary key references public.participants (id) on delete cascade,
  viewed_at timestamptz not null default now()
);

create table if not exists public.participant_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  requester_email text not null,
  proposed_name text not null check (length(trim(proposed_name)) between 1 and 80),
  proposed_subfamily text not null check (length(trim(proposed_subfamily)) between 1 and 80),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
);

create or replace function private.prevent_roster_change_after_draw()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.assignments) then
    raise exception 'La lista queda bloqueada después de realizar el sorteo.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists participants_roster_lock on public.participants;
create trigger participants_roster_lock
  before insert or delete or update of name, subfamily, active, attendance_confirmed_at, excluded_at
  on public.participants
  for each row execute function private.prevent_roster_change_after_draw();

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

create or replace function public.current_participant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from public.participants
  where user_id = (select auth.uid())
    and active
  limit 1;
$$;

create or replace function public.confirm_attendance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deadline timestamptz;
begin
  select deadline into v_deadline
  from public.app_settings
  where id = true;

  if now() >= v_deadline then
    raise exception 'El periodo de confirmación terminó.';
  end if;

  update public.participants
  set attendance_confirmed_at = now()
  where user_id = (select auth.uid())
    and active
    and excluded_at is null
    and attendance_confirmed_at is null;

  if not found then
    raise exception 'No hay un integrante pendiente vinculado a esta cuenta.';
  end if;
end;
$$;

create or replace function public.close_attendance()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deadline timestamptz;
  v_excluded integer;
begin
  if not private.is_admin() then
    raise exception 'Solo administración puede cerrar las confirmaciones.';
  end if;

  select deadline into v_deadline
  from public.app_settings
  where id = true
  for update;

  if now() < v_deadline then
    raise exception 'La fecha límite todavía no ha pasado.';
  end if;

  update public.participants
  set excluded_at = now()
  where active
    and attendance_confirmed_at is null
    and excluded_at is null;

  get diagnostics v_excluded = row_count;
  return v_excluded;
end;
$$;

create or replace function public.authorize_draw()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eligible integer;
begin
  if not private.is_admin() then
    raise exception 'Solo administración puede autorizar el sorteo.';
  end if;

  if exists (
    select 1 from public.assignments
  ) then
    raise exception 'El sorteo ya fue realizado.';
  end if;

  if exists (
    select 1
    from public.participants
    where active and excluded_at is null and attendance_confirmed_at is null
  ) then
    raise exception 'Todas las personas activas deben confirmar o quedar fuera al vencer el plazo.';
  end if;

  select count(*) into v_eligible
  from public.participants
  where active and excluded_at is null and attendance_confirmed_at is not null;

  if v_eligible < 2 then
    raise exception 'Se necesitan al menos dos participantes confirmados.';
  end if;

  update public.app_settings
  set draw_authorized = true
  where id = true;
end;
$$;

create or replace function private.try_assignment(
  p_givers uuid[],
  p_recipients uuid[],
  p_subfamilies text[],
  p_depth integer,
  p_used uuid[],
  p_result uuid[]
)
returns uuid[]
language plpgsql
set search_path = ''
as $$
declare
  v_recipient uuid;
  v_result uuid[];
begin
  if p_depth > cardinality(p_givers) then
    return p_result;
  end if;

  for v_recipient in
    select person.id
    from public.participants as person
    where person.id = any(p_recipients)
      and person.id <> p_givers[p_depth]
      and lower(trim(person.subfamily)) <> lower(trim(p_subfamilies[p_depth]))
      and not (person.id = any(p_used))
    order by random()
  loop
    v_result := private.try_assignment(
      p_givers,
      p_recipients,
      p_subfamilies,
      p_depth + 1,
      array_append(p_used, v_recipient),
      array_append(p_result, v_recipient)
    );
    if v_result is not null then
      return v_result;
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.create_draw()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_givers uuid[];
  v_subfamilies text[];
  v_recipients uuid[];
  v_result uuid[];
  v_count integer;
begin
  if not private.is_admin() then
    raise exception 'Solo administración puede realizar el sorteo.';
  end if;

  perform 1 from public.app_settings where id = true for update;
  if not exists (
    select 1 from public.app_settings where id = true and draw_authorized
  ) then
    raise exception 'El sorteo todavía no está autorizado.';
  end if;

  if exists (select 1 from public.assignments) then
    raise exception 'El sorteo ya fue realizado y no se puede repetir.';
  end if;

  select
    array_agg(id order by id),
    array_agg(subfamily order by id)
  into v_givers, v_subfamilies
  from public.participants
  where active and excluded_at is null and attendance_confirmed_at is not null;

  v_count := cardinality(v_givers);
  if v_count < 2 then
    raise exception 'Se necesitan al menos dos participantes confirmados.';
  end if;
  if exists (
    select 1
    from public.participants
    where active and excluded_at is null and attendance_confirmed_at is null
  ) then
    raise exception 'Hay confirmaciones pendientes.';
  end if;

  v_recipients := v_givers;
  v_result := private.try_assignment(v_givers, v_recipients, v_subfamilies, 1, '{}', '{}');
  if v_result is null or cardinality(v_result) <> v_count then
    raise exception 'No se encontró una asignación válida entre subfamilias.';
  end if;

  insert into public.assignments (giver_id, recipient_id)
  select v_givers[s.index], v_result[s.index]
  from generate_subscripts(v_givers, 1) as s(index);
end;
$$;

create or replace function public.admin_link_claim(p_claim_id uuid, p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if not private.is_admin() then
    raise exception 'Solo administración puede vincular integrantes.';
  end if;

  select user_id into v_user_id
  from public.participant_claims
  where id = p_claim_id and status = 'pending'
  for update;
  if v_user_id is null then
    raise exception 'La solicitud ya no está pendiente.';
  end if;

  update public.participants
  set user_id = v_user_id
  where id = p_participant_id
    and active
    and user_id is null;
  if not found then
    raise exception 'El integrante ya está vinculado o no está activo.';
  end if;

  update public.participant_claims
  set status = 'accepted'
  where id = p_claim_id;
end;
$$;

create or replace function public.mark_assignment_viewed()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant_id uuid;
begin
  select person.id into v_participant_id
  from public.participants as person
  where person.user_id = (select auth.uid())
    and person.active
    and person.excluded_at is null
    and exists (
      select 1 from public.assignments as assignment
      where assignment.giver_id = person.id
    );

  if v_participant_id is null then
    raise exception 'No hay un resultado asignado a esta cuenta.';
  end if;

  insert into public.assignment_views (participant_id)
  values (v_participant_id)
  on conflict (participant_id) do nothing;
end;
$$;

alter table public.participants enable row level security;
alter table public.admin_users enable row level security;
alter table public.app_settings enable row level security;
alter table public.wishlists enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_views enable row level security;
alter table public.participant_claims enable row level security;

drop policy if exists participants_read_authenticated on public.participants;
drop policy if exists participants_read_family on public.participants;
create policy participants_read_family on public.participants
  for select to authenticated
  using (public.current_participant_id() is not null or private.is_admin());
drop policy if exists participants_admin_write on public.participants;
create policy participants_admin_write on public.participants
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

drop policy if exists admin_users_read_self on public.admin_users;
create policy admin_users_read_self on public.admin_users
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists settings_read_authenticated on public.app_settings;
drop policy if exists settings_read_family on public.app_settings;
create policy settings_read_family on public.app_settings
  for select to authenticated
  using (public.current_participant_id() is not null or private.is_admin());
drop policy if exists settings_admin_write on public.app_settings;
create policy settings_admin_write on public.app_settings
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

drop policy if exists wishlists_read_authenticated on public.wishlists;
drop policy if exists wishlists_read_family on public.wishlists;
create policy wishlists_read_family on public.wishlists
  for select to authenticated
  using (public.current_participant_id() is not null or private.is_admin());
drop policy if exists wishlists_owner_write on public.wishlists;
create policy wishlists_owner_write on public.wishlists
  for all to authenticated
  using (participant_id = public.current_participant_id() or private.is_admin())
  with check (participant_id = public.current_participant_id() or private.is_admin());

drop policy if exists assignments_private_read on public.assignments;
create policy assignments_private_read on public.assignments
  for select to authenticated
  using (giver_id = public.current_participant_id() or private.is_admin());
drop policy if exists assignments_admin_write on public.assignments;
create policy assignments_admin_write on public.assignments
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

drop policy if exists assignment_views_admin_read on public.assignment_views;
create policy assignment_views_admin_read on public.assignment_views
  for select to authenticated using (private.is_admin());

drop policy if exists claims_owner_read on public.participant_claims;
create policy claims_owner_read on public.participant_claims
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());
drop policy if exists claims_owner_insert on public.participant_claims;
drop policy if exists claims_admin_insert on public.participant_claims;
drop policy if exists claims_admin_update on public.participant_claims;
create policy claims_admin_update on public.participant_claims
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

grant usage on schema public to authenticated;
grant usage on schema private to authenticated;
grant select, insert, update, delete on public.participants to authenticated;
grant select on public.admin_users to authenticated;
grant select, update on public.app_settings to authenticated;
grant select, insert, update, delete on public.wishlists to authenticated;
grant select, insert, update, delete on public.assignments to authenticated;
grant select on public.assignment_views to authenticated;
grant select, update on public.participant_claims to authenticated;
revoke all on public.participants, public.admin_users, public.app_settings,
  public.wishlists, public.assignments, public.assignment_views, public.participant_claims
  from public, anon;
revoke all on function private.is_admin() from public, anon;
revoke all on function public.current_participant_id() from public, anon;
revoke all on function public.confirm_attendance() from public, anon;
revoke all on function public.close_attendance() from public, anon;
revoke all on function public.authorize_draw() from public, anon;
revoke all on function public.create_draw() from public, anon;
revoke all on function public.admin_link_claim(uuid, uuid) from public, anon;
revoke all on function public.mark_assignment_viewed() from public, anon;
grant execute on function private.is_admin() to authenticated;
grant execute on function public.current_participant_id() to authenticated;
grant execute on function public.confirm_attendance() to authenticated;
grant execute on function public.close_attendance() to authenticated;
grant execute on function public.authorize_draw() to authenticated;
grant execute on function public.create_draw() to authenticated;
grant execute on function public.admin_link_claim(uuid, uuid) to authenticated;
grant execute on function public.mark_assignment_viewed() to authenticated;
revoke all on function private.try_assignment(uuid[], uuid[], text[], integer, uuid[], uuid[]) from public, anon, authenticated;

insert into public.participants (name, subfamily) values
  ('America', 'Familia 1'),
  ('Yunuen', 'Familia 1'),
  ('Mireya', 'Familia 2'),
  ('Valeria', 'Familia 2'),
  ('Ximena', 'Familia 2'),
  ('Marlene', 'Familia 3'),
  ('Josmar', 'Familia 3'),
  ('Jazieel', 'Familia 3'),
  ('Carlos', 'Familia 3'),
  ('Tita', 'Familia 4'),
  ('Sofia', 'Familia 4'),
  ('Leo', 'Familia 4'),
  ('Fer', 'Familia 4'),
  ('Michelle', 'Familia 5'),
  ('Omar', 'Familia 5'),
  ('Valentina', 'Familia 5'),
  ('Martha', 'Familia 6')
on conflict do nothing;
