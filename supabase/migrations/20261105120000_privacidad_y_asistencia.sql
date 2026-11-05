-- Ejecutar después de 20261105000000_intercambio.sql

-- Reemplaza la confirmación simple por una respuesta Sí/No.
drop function if exists public.confirm_attendance();

-- Lista de nombres visible antes de iniciar sesión (solo id y nombre).
create or replace function public.login_names()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name
  from public.participants as p
  where p.active
  order by p.name;
$$;

-- Vincula la cuenta que inició sesión con el nombre elegido.
create or replace function public.claim_participant(p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Inicia sesión primero.';
  end if;

  if exists (select 1 from public.participants where user_id = v_uid) then
    return;
  end if;

  update public.participants
  set user_id = v_uid
  where id = p_participant_id
    and active
    and user_id is null;

  if not found then
    raise exception 'Ese nombre ya está vinculado a otra cuenta. Pide ayuda al administrador.';
  end if;
end;
$$;

create or replace function public.set_attendance(p_attending boolean)
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

  if exists (select 1 from public.assignments) then
    raise exception 'El sorteo ya fue realizado.';
  end if;

  update public.participants
  set attendance_confirmed_at = case when p_attending then now() else null end,
      excluded_at = case when p_attending then null else now() end
  where user_id = (select auth.uid())
    and active;

  if not found then
    raise exception 'No hay un integrante vinculado a esta cuenta.';
  end if;
end;
$$;

-- Solo administración puede ver la familia de cada integrante.
create or replace function public.admin_roster()
returns table (
  id uuid,
  name text,
  subfamily text,
  user_id uuid,
  active boolean,
  attendance_confirmed_at timestamptz,
  excluded_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Solo administración puede ver esta información.';
  end if;

  return query
  select p.id, p.name, p.subfamily, p.user_id, p.active,
         p.attendance_confirmed_at, p.excluded_at
  from public.participants as p
  where p.active
  order by p.name;
end;
$$;

create or replace function public.admin_unlink_participant(p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Solo administración puede desvincular cuentas.';
  end if;

  if exists (select 1 from public.assignments) then
    raise exception 'El sorteo ya fue realizado.';
  end if;

  update public.participants
  set user_id = null
  where id = p_participant_id;
end;
$$;

-- Las demás cuentas ya no pueden leer la familia ni el user_id.
revoke select on public.participants from authenticated;
grant select (id, name, active, attendance_confirmed_at, excluded_at)
  on public.participants to authenticated;

grant usage on schema public to anon;

revoke all on function public.login_names() from public, anon, authenticated;
revoke all on function public.claim_participant(uuid) from public, anon, authenticated;
revoke all on function public.set_attendance(boolean) from public, anon, authenticated;
revoke all on function public.admin_roster() from public, anon, authenticated;
revoke all on function public.admin_unlink_participant(uuid) from public, anon, authenticated;

grant execute on function public.login_names() to anon, authenticated;
grant execute on function public.claim_participant(uuid) to authenticated;
grant execute on function public.set_attendance(boolean) to authenticated;
grant execute on function public.admin_roster() to authenticated;
grant execute on function public.admin_unlink_participant(uuid) to authenticated;
