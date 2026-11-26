-- RG Reversa — movimentações feitas pelo coletor (celular).
-- Cada linha = 1 RG movido de um local de origem para um local de destino.
-- Todas as linhas bipadas de uma vez (um palete) compartilham o mesmo "lote".
-- Fica em "public" (como as pontes ldm_*) para não exigir expor schema novo
-- na API. O acesso exige a permissão 'rgreversa' (schema "acessos").
create table if not exists public.rg_movimentacoes (
  id            bigint generated always as identity primary key,
  lote          uuid        not null,
  criado_em     timestamptz not null default now(),
  user_id       uuid        default auth.uid(),
  operador      text,
  local_origem  text        not null,
  rg            text        not null,
  local_destino text        not null,
  exportado_em  timestamptz
);
create index if not exists rg_movimentacoes_criado_idx on public.rg_movimentacoes (criado_em desc);
create index if not exists rg_movimentacoes_lote_idx   on public.rg_movimentacoes (lote);

alter table public.rg_movimentacoes enable row level security;

drop policy if exists rg_mov_select on public.rg_movimentacoes;
create policy rg_mov_select on public.rg_movimentacoes for select to authenticated
  using (public.ldm_pode_acessar('rgreversa'));
drop policy if exists rg_mov_insert on public.rg_movimentacoes;
create policy rg_mov_insert on public.rg_movimentacoes for insert to authenticated
  with check (public.ldm_pode_acessar('rgreversa'));
drop policy if exists rg_mov_update on public.rg_movimentacoes;
create policy rg_mov_update on public.rg_movimentacoes for update to authenticated
  using (public.ldm_pode_acessar('rgreversa')) with check (public.ldm_pode_acessar('rgreversa'));
drop policy if exists rg_mov_delete on public.rg_movimentacoes;
create policy rg_mov_delete on public.rg_movimentacoes for delete to authenticated
  using (public.ldm_pode_acessar('rgreversa'));

grant select, insert, update, delete on public.rg_movimentacoes to authenticated;
