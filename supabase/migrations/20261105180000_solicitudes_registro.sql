-- Solicitudes de personas que no aparecen en la lista. Se registran sin iniciar sesión:
-- la persona no recibe código hasta que administración la agregue a la lista.
create table if not exists public.registration_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  email text not null check (char_length(email) between 3 and 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

alter table public.registration_requests enable row level security;
revoke all on public.registration_requests from anon, authenticated;

create or replace function public.submit_registration_request(
  p_name text, p_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_name = '' or char_length(v_name) > 80 then
    raise exception 'Escribe un nombre válido.';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 200 then
    raise exception 'Escribe un correo válido.';
  end if;

  select id into v_id from public.registration_requests
  where email = v_email and status = 'pending';
  if v_id is not null then
    raise exception 'Ya enviaste una solicitud con este correo. Espera a que el administrador te agregue.';
  end if;

  if exists (select 1 from public.participants where lower(btrim(name)) = lower(v_name)) then
    raise exception 'Ese nombre ya está registrado. Elígelo en la lista para entrar.';
  end if;

  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Este correo ya está registrado. Elige tu nombre en la lista para entrar.';
  end if;

  if exists (
    select 1 from public.registration_requests
    where status = 'pending' and lower(btrim(name)) = lower(v_name)
  ) then
    raise exception 'Ya existe una solicitud pendiente con ese nombre.';
  end if;

  insert into public.registration_requests (name, email)
  values (v_name, v_email)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_registration_requests()
returns table (id uuid, name text, email text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Solo administración puede ver las solicitudes.';
  end if;
  return query
  select r.id, r.name, r.email, r.created_at
  from public.registration_requests as r
  where r.status = 'pending'
  order by r.created_at;
end;
$$;

-- Aprobar agrega a la persona a la lista; ya podrá elegir su nombre y recibir el código.
create or replace function public.admin_resolve_request(p_request_id uuid, p_approve boolean, p_subfamily text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.registration_requests;
begin
  if not private.is_admin() then
    raise exception 'Solo administración puede resolver solicitudes.';
  end if;

  select * into v_request from public.registration_requests
  where id = p_request_id and status = 'pending';
  if not found then
    raise exception 'La solicitud ya no está pendiente.';
  end if;

  if p_approve then
    if btrim(coalesce(p_subfamily, '')) = '' then raise exception 'Indica la familia del integrante.'; end if;
    insert into public.participants (name, subfamily)
    values (v_request.name, btrim(p_subfamily))
    on conflict do nothing;
  end if;

  update public.registration_requests
  set status = case when p_approve then 'approved' else 'rejected' end
  where id = p_request_id;
end;
$$;

revoke all on function public.submit_registration_request(text, text) from public;
revoke all on function public.admin_registration_requests() from public, anon;
revoke all on function public.admin_resolve_request(uuid, boolean, text) from public, anon;
grant execute on function public.submit_registration_request(text, text) to anon, authenticated;
grant execute on function public.admin_registration_requests() to authenticated;
grant execute on function public.admin_resolve_request(uuid, boolean, text) to authenticated;
