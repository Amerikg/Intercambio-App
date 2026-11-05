-- Reglas secretas del sorteo. Las tablas no tienen políticas RLS ni permisos para
-- anon/authenticated: solo se leen y modifican desde el SQL Editor (rol postgres).
-- Los pares concretos NO se guardan en el repositorio.
create table if not exists public.draw_giver_rules (
  giver_id uuid not null references public.participants (id) on delete cascade,
  recipient_id uuid not null references public.participants (id) on delete cascade,
  primary key (giver_id, recipient_id)
);

create table if not exists public.draw_receiver_rules (
  recipient_id uuid not null references public.participants (id) on delete cascade,
  giver_id uuid not null references public.participants (id) on delete cascade,
  primary key (recipient_id, giver_id)
);

alter table public.draw_giver_rules enable row level security;
alter table public.draw_receiver_rules enable row level security;
revoke all on public.draw_giver_rules from anon, authenticated;
revoke all on public.draw_receiver_rules from anon, authenticated;

-- Si quien regala tiene reglas, solo puede regalar a esas personas.
-- Si quien recibe tiene reglas, solo puede recibir de esas personas.
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
      and (
        not exists (select 1 from public.draw_giver_rules r where r.giver_id = p_givers[p_depth])
        or exists (
          select 1 from public.draw_giver_rules r
          where r.giver_id = p_givers[p_depth] and r.recipient_id = person.id
        )
      )
      and (
        not exists (select 1 from public.draw_receiver_rules r where r.recipient_id = person.id)
        or exists (
          select 1 from public.draw_receiver_rules r
          where r.recipient_id = person.id and r.giver_id = p_givers[p_depth]
        )
      )
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

revoke all on function private.try_assignment(uuid[], uuid[], text[], integer, uuid[], uuid[])
  from public, anon, authenticated;
