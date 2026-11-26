-- Controle de Validade: base processada (itens com data de validade, já valorados)
-- e configurações, compartilhadas entre quem tem acesso ao app 'validade'.
-- Mesmo formato de public.ir_dados: cada conjunto é gravado em partes e o
-- cabeçalho (parte 0) entra por último. Ler = pode_acessar; gravar = pode_editar.
create table if not exists public.vl_dados (
  chave text not null,
  versao text not null,
  parte int not null,
  dados jsonb,
  meta jsonb,
  atualizado_em timestamptz not null default now(),
  atualizado_por text default (auth.jwt() ->> 'email'),
  primary key (chave, versao, parte)
);
alter table public.vl_dados enable row level security;

drop policy if exists vl_dados_leitura on public.vl_dados;
create policy vl_dados_leitura on public.vl_dados for select to authenticated
  using (acessos.pode_acessar('validade'));
drop policy if exists vl_dados_insercao on public.vl_dados;
create policy vl_dados_insercao on public.vl_dados for insert to authenticated
  with check (acessos.pode_editar('validade'));
drop policy if exists vl_dados_exclusao on public.vl_dados;
create policy vl_dados_exclusao on public.vl_dados for delete to authenticated
  using (acessos.pode_editar('validade'));

grant select, insert, delete on public.vl_dados to authenticated;
