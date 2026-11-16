-- RG Reversa: dois níveis de acesso, escolhidos por pessoa em Configurações do hub.
--
--   Pode editar   → tudo: importar relatórios, apagar dados e usar o coletor.
--   Só visualizar → consulta o dashboard e usa o COLETOR (bipagem grava em rg_movimentacoes),
--                   mas o banco recusa importar relatórios (rg_dados, rg_locais) e apagar movimentações.
--
-- O nível já existe em acessos.permissoes.nivel e em acessos.pode_editar() (supabase-acessos/migrations/006).
-- Rodar à mão, uma vez, no SQL Editor do projeto Supabase. Quem já tinha acesso continua como 'editar'.

-- Movimentações: ler, bipar (insert) e marcar como exportado (update) seguem liberados a quem tem acesso;
-- apagar só quem edita.
drop policy if exists rg_mov_delete on public.rg_movimentacoes;
create policy rg_mov_delete on public.rg_movimentacoes for delete to authenticated
  using (acessos.pode_editar('rgreversa'));

-- Lista de locais e dados da última importação (alimentados pela importação do dashboard): só quem edita grava.
drop policy if exists rg_locais_insert on public.rg_locais;
create policy rg_locais_insert on public.rg_locais for insert to authenticated
  with check (acessos.pode_editar('rgreversa'));
drop policy if exists rg_locais_update on public.rg_locais;
create policy rg_locais_update on public.rg_locais for update to authenticated
  using (acessos.pode_editar('rgreversa')) with check (acessos.pode_editar('rgreversa'));
drop policy if exists rg_locais_delete on public.rg_locais;
create policy rg_locais_delete on public.rg_locais for delete to authenticated
  using (acessos.pode_editar('rgreversa'));

drop policy if exists rg_dados_insert on public.rg_dados;
create policy rg_dados_insert on public.rg_dados for insert to authenticated
  with check (acessos.pode_editar('rgreversa'));
drop policy if exists rg_dados_update on public.rg_dados;
create policy rg_dados_update on public.rg_dados for update to authenticated
  using (acessos.pode_editar('rgreversa')) with check (acessos.pode_editar('rgreversa'));
drop policy if exists rg_dados_delete on public.rg_dados;
create policy rg_dados_delete on public.rg_dados for delete to authenticated
  using (acessos.pode_editar('rgreversa'));
