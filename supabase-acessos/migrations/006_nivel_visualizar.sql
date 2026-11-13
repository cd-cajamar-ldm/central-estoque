-- Nível de acesso por app: 'editar' (padrão, como já era) ou 'visualizar'.
-- Quem só visualiza lê os dados compartilhados, mas o banco recusa gravação.
alter table acessos.permissoes
  add column if not exists nivel text not null default 'editar';
alter table acessos.permissoes drop constraint if exists permissoes_nivel_check;
alter table acessos.permissoes add constraint permissoes_nivel_check check (nivel in ('editar','visualizar'));

create or replace function acessos.pode_editar(p_app_key text)
returns boolean language sql stable security definer set search_path = acessos, pg_temp
as $$
  select acessos.eh_admin() or exists (
    select 1 from acessos.permissoes perm
    join acessos.pessoas p on p.id = perm.pessoa_id
    where p.user_id = auth.uid() and p.ativo and perm.app_key = p_app_key and perm.nivel = 'editar'
  );
$$;

-- 'editar' | 'visualizar' | null (sem acesso). Admin sempre edita.
create or replace function public.ldm_nivel_acesso(p_app_key text)
returns text language sql stable security definer set search_path = acessos, public, pg_temp
as $$
  select case
    when acessos.eh_admin() then 'editar'
    else (select perm.nivel from acessos.permissoes perm
          join acessos.pessoas p on p.id = perm.pessoa_id
          where p.user_id = auth.uid() and p.ativo and perm.app_key = p_app_key limit 1)
  end;
$$;

-- Gravar nos dados compartilhados exige poder editar.
drop policy if exists md_dados_insercao on public.md_dados;
create policy md_dados_insercao on public.md_dados for insert to authenticated
  with check (acessos.pode_editar('multiplos'));
drop policy if exists md_dados_exclusao on public.md_dados;
create policy md_dados_exclusao on public.md_dados for delete to authenticated
  using (acessos.pode_editar('multiplos'));
drop policy if exists ir_dados_insercao on public.ir_dados;
create policy ir_dados_insercao on public.ir_dados for insert to authenticated
  with check (acessos.pode_editar('inventario'));
drop policy if exists ir_dados_exclusao on public.ir_dados;
create policy ir_dados_exclusao on public.ir_dados for delete to authenticated
  using (acessos.pode_editar('inventario'));
