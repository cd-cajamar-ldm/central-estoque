-- RG Reversa — última importação (RGs, estoque da reversa, múltiplos e evolução), guardada no servidor.
-- O navegador pode apagar os dados do site ao fechar; assim o dashboard volta sozinho em qualquer aparelho.
-- Cada "chave" é dividida em partes (linhas grandes), para não estourar o limite de cada gravação.
create table if not exists public.rg_dados (
  chave         text        not null,   -- rgs | est_meta | est_rows | mult_meta | mult_rows | hist
  parte         int         not null default 0,
  dados         jsonb       not null,
  atualizado_em timestamptz not null default now(),
  usuario       text,
  primary key (chave, parte)
);
alter table public.rg_dados enable row level security;

drop policy if exists rg_dados_select on public.rg_dados;
create policy rg_dados_select on public.rg_dados for select to authenticated
  using (public.ldm_pode_acessar('rgreversa'));
drop policy if exists rg_dados_insert on public.rg_dados;
create policy rg_dados_insert on public.rg_dados for insert to authenticated
  with check (public.ldm_pode_acessar('rgreversa'));
drop policy if exists rg_dados_update on public.rg_dados;
create policy rg_dados_update on public.rg_dados for update to authenticated
  using (public.ldm_pode_acessar('rgreversa')) with check (public.ldm_pode_acessar('rgreversa'));
drop policy if exists rg_dados_delete on public.rg_dados;
create policy rg_dados_delete on public.rg_dados for delete to authenticated
  using (public.ldm_pode_acessar('rgreversa'));

grant select, insert, update, delete on public.rg_dados to authenticated;
