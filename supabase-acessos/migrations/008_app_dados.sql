-- Dados de importação guardados no servidor para os apps que só usavam o
-- IndexedDB do navegador: Transitórios ('transitorios'), NET ('net') e
-- Central de Controle de Estoque / Auditoria de Divergências ('estoque').
-- Mesma ideia de md_dados / ir_dados / vl_dados, numa tabela só: a coluna "app"
-- é a chave do app no hub, e a permissão é a mesma do app.
-- Cada conjunto (store) é gravado em partes; a parte 0 (cabeçalho) entra por último.
create table if not exists public.app_dados (
  app text not null,
  chave text not null,
  versao text not null,
  parte int not null,
  dados jsonb,
  meta jsonb,
  atualizado_em timestamptz not null default now(),
  atualizado_por text default (auth.jwt() ->> 'email'),
  primary key (app, chave, versao, parte)
);
alter table public.app_dados enable row level security;

drop policy if exists app_dados_leitura on public.app_dados;
create policy app_dados_leitura on public.app_dados for select to authenticated
  using (acessos.pode_acessar(app));
drop policy if exists app_dados_insercao on public.app_dados;
create policy app_dados_insercao on public.app_dados for insert to authenticated
  with check (acessos.pode_editar(app));
drop policy if exists app_dados_exclusao on public.app_dados;
create policy app_dados_exclusao on public.app_dados for delete to authenticated
  using (acessos.pode_editar(app));

grant select, insert, delete on public.app_dados to authenticated;
