-- RG Reversa — nomes dos locais (vindos da QRY0390, importada no dashboard).
-- O coletor lê esta tabela para mostrar o nome do local ao bipar, sem importar nada no celular.
create table if not exists public.rg_locais (
  codigo        text primary key,          -- código "puro" do local no WMS (ex.: 687054)
  descricao     text,                      -- ex.: TRI AGE 001 00
  classe        text,                      -- ex.: REV
  atualizado_em timestamptz not null default now()
);
alter table public.rg_locais enable row level security;

drop policy if exists rg_locais_select on public.rg_locais;
create policy rg_locais_select on public.rg_locais for select to authenticated
  using (public.ldm_pode_acessar('rgreversa'));
drop policy if exists rg_locais_insert on public.rg_locais;
create policy rg_locais_insert on public.rg_locais for insert to authenticated
  with check (public.ldm_pode_acessar('rgreversa'));
drop policy if exists rg_locais_update on public.rg_locais;
create policy rg_locais_update on public.rg_locais for update to authenticated
  using (public.ldm_pode_acessar('rgreversa')) with check (public.ldm_pode_acessar('rgreversa'));
drop policy if exists rg_locais_delete on public.rg_locais;
create policy rg_locais_delete on public.rg_locais for delete to authenticated
  using (public.ldm_pode_acessar('rgreversa'));

grant select, insert, update, delete on public.rg_locais to authenticated;
