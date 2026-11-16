-- Múltiplos Descasados: dados compartilhados entre quem tem acesso ao app.
-- Cada importação (estrutura, saldo, preço, estoques) e cada configuração vira
-- uma "versão" em partes; o cabeçalho (parte 0) é gravado por último, então
-- ninguém lê uma importação pela metade.
create table if not exists public.md_dados (
  chave text not null,
  versao text not null,
  parte int not null,
  dados jsonb,
  meta jsonb,
  atualizado_em timestamptz not null default now(),
  atualizado_por text default (auth.jwt() ->> 'email'),
  primary key (chave, versao, parte)
);
alter table public.md_dados enable row level security;

drop policy if exists md_dados_leitura on public.md_dados;
create policy md_dados_leitura on public.md_dados for select to authenticated
  using (acessos.pode_acessar('multiplos'));
drop policy if exists md_dados_insercao on public.md_dados;
create policy md_dados_insercao on public.md_dados for insert to authenticated
  with check (acessos.pode_acessar('multiplos'));
drop policy if exists md_dados_exclusao on public.md_dados;
create policy md_dados_exclusao on public.md_dados for delete to authenticated
  using (acessos.pode_acessar('multiplos'));

grant select, insert, delete on public.md_dados to authenticated;
