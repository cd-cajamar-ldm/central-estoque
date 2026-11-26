-- Reforça o grant do 002 (rodar de novo não quebra nada — toda linha
-- abaixo é segura de repetir) e, no final, MOSTRA se o Postgres realmente
-- concedeu o acesso, em vez de só confiar que "deve ter funcionado".
grant usage on schema acessos to authenticated;
grant select, insert, update, delete on all tables in schema acessos to authenticated;
grant select, insert, update, delete on acessos.pessoas to authenticated;
grant select, insert, update, delete on acessos.permissoes to authenticated;
alter default privileges in schema acessos grant select, insert, update, delete on tables to authenticated;

-- ---------------------------------------------------------------
-- Frequência de acesso: quantas vezes e quando cada pessoa abriu cada
-- app. Cada app protegido chama public.ldm_registrar_acesso(app_key)
-- uma vez por visita, logo depois de confirmar que pode entrar.
-- ---------------------------------------------------------------
create table if not exists acessos.log (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references acessos.pessoas(id) on delete cascade,
  app_key text not null,
  acessado_em timestamptz not null default now()
);
create index if not exists log_pessoa_app_idx on acessos.log (pessoa_id, app_key);
create index if not exists log_acessado_em_idx on acessos.log (acessado_em desc);

alter table acessos.log enable row level security;

-- Cada pessoa só registra o PRÓPRIO acesso (nunca em nome de outra).
drop policy if exists log_insercao on acessos.log;
create policy log_insercao on acessos.log
  for insert to authenticated
  with check (exists (select 1 from acessos.pessoas p where p.id = log.pessoa_id and p.user_id = auth.uid()));

-- Histórico é dado sobre todo mundo: só administrador lê.
drop policy if exists log_leitura on acessos.log;
create policy log_leitura on acessos.log
  for select to authenticated using (acessos.eh_admin());

grant usage on schema acessos to authenticated;
grant select, insert on acessos.log to authenticated;

-- Registra "eu acessei agora", só se a pessoa realmente puder acessar
-- esse app (confere de novo — nunca confia só no que o navegador diz).
create or replace function public.ldm_registrar_acesso(p_app_key text)
returns void language plpgsql security definer set search_path = acessos, public, pg_temp
as $$
declare
  v_pessoa_id uuid;
begin
  if not acessos.pode_acessar(p_app_key) then return; end if;
  select id into v_pessoa_id from acessos.pessoas where user_id = auth.uid();
  if v_pessoa_id is not null then
    insert into acessos.log (pessoa_id, app_key) values (v_pessoa_id, p_app_key);
  end if;
end;
$$;

-- ---------------------------------------------------------------
-- Diagnóstico: confirme que as duas colunas abaixo vieram "true".
-- ---------------------------------------------------------------
select
  has_schema_privilege('authenticated', 'acessos', 'usage') as schema_liberado,
  has_table_privilege('authenticated', 'acessos.pessoas', 'select') as pessoas_liberado,
  has_table_privilege('authenticated', 'acessos.log', 'insert') as log_liberado;
