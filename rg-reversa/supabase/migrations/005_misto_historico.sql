-- RG Reversa — controle de quanto tempo cada local fica "misto" (RG e peça sem RG juntos).
--
-- Cada linha é um "episódio": o local virou misto em `desde` e deixou de ser em `resolvido_em`
-- (nulo = continua misto). O dashboard grava isso sozinho a cada importação de relatórios.
--   origem = 'estimado' → primeira vez que o controle rodou: o início é estimado pela idade do RG / da peça sem RG.
--   origem = 'medido'   → o app viu o local virar misto entre duas importações.
--
-- Rodar à mão, uma vez, no SQL Editor do Supabase. Pode rodar de novo sem problema.
create table if not exists public.rg_misto (
  id           bigint generated always as identity primary key,
  local        text        not null,              -- código do local
  local_desc   text,                              -- descrição do local (QRY0390)
  desde        timestamptz not null,              -- início do período misto
  origem       text        not null default 'medido' check (origem in ('estimado','medido')),
  visto_em     timestamptz not null default now(),-- última importação em que ainda estava misto
  resolvido_em timestamptz,                       -- quando deixou de ser misto
  criado_em    timestamptz not null default now()
);

-- só pode existir um período aberto por local
create unique index if not exists rg_misto_aberto_uq on public.rg_misto (local) where resolvido_em is null;
create index if not exists rg_misto_desde_idx on public.rg_misto (desde);

alter table public.rg_misto enable row level security;

drop policy if exists rg_misto_select on public.rg_misto;
create policy rg_misto_select on public.rg_misto for select to authenticated
  using (acessos.pode_acessar('rgreversa'));
drop policy if exists rg_misto_insert on public.rg_misto;
create policy rg_misto_insert on public.rg_misto for insert to authenticated
  with check (acessos.pode_editar('rgreversa'));
drop policy if exists rg_misto_update on public.rg_misto;
create policy rg_misto_update on public.rg_misto for update to authenticated
  using (acessos.pode_editar('rgreversa')) with check (acessos.pode_editar('rgreversa'));
drop policy if exists rg_misto_delete on public.rg_misto;
create policy rg_misto_delete on public.rg_misto for delete to authenticated
  using (acessos.pode_editar('rgreversa'));

grant select, insert, update, delete on public.rg_misto to authenticated;
