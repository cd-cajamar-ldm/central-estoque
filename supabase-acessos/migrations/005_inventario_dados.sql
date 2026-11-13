-- Inventário Rotativo: dados compartilhados entre quem tem acesso ao app.
-- Mesma ideia de public.md_dados (migração 004): cada conjunto de dados é
-- gravado em partes e o cabeçalho (parte 0) entra por último.
create table if not exists public.ir_dados (
  chave text not null,
  versao text not null,
  parte int not null,
  dados jsonb,
  meta jsonb,
  atualizado_em timestamptz not null default now(),
  atualizado_por text default (auth.jwt() ->> 'email'),
  primary key (chave, versao, parte)
);
alter table public.ir_dados enable row level security;

drop policy if exists ir_dados_leitura on public.ir_dados;
create policy ir_dados_leitura on public.ir_dados for select to authenticated
  using (acessos.pode_acessar('inventario'));
drop policy if exists ir_dados_insercao on public.ir_dados;
create policy ir_dados_insercao on public.ir_dados for insert to authenticated
  with check (acessos.pode_acessar('inventario'));
drop policy if exists ir_dados_exclusao on public.ir_dados;
create policy ir_dados_exclusao on public.ir_dados for delete to authenticated
  using (acessos.pode_acessar('inventario'));

grant select, insert, delete on public.ir_dados to authenticated;
