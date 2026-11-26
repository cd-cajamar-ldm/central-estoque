-- Aplicada no projeto Supabase "Estoque Project" (jfvnswafpeshyfweoadg).
-- Schema compartilhado de acesso entre TODOS os apps da Oficina LDM: uma
-- unica lista de pessoas e permissoes, em vez de cada modulo duplicar o
-- proprio cadastro (como tarefas.pessoas e projetos.pessoas fazem hoje).
create schema if not exists acessos;

create type acessos.papel as enum ('admin', 'colaborador');

-- Pessoas existem independentemente de login: da para cadastrar alguem que
-- ainda nao acessou o sistema. O vinculo com auth.users acontece depois,
-- pelo e-mail, no primeiro acesso (gatilho abaixo).
create table acessos.pessoas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  nome text not null,
  email text not null unique,
  papel acessos.papel not null default 'colaborador',
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index pessoas_user_id_idx on acessos.pessoas (user_id);

-- app_key usa as mesmas chaves ja existentes no catalogo do hub raiz
-- (ex.: 'multiplos', 'tarefas', 'net') -- uma unica fonte pros dois lados.
-- Uma autorizacao num app nao libera os outros.
create table acessos.permissoes (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references acessos.pessoas(id) on delete cascade,
  app_key text not null,
  criado_em timestamptz not null default now(),
  unique (pessoa_id, app_key)
);
create index permissoes_pessoa_idx on acessos.permissoes (pessoa_id);

-- ---------------------------------------------------------------
-- Funcoes de apoio as policies (mesma receita de projetos.eh_admin()).
-- SECURITY DEFINER de proposito: elas leem acessos.pessoas, que tem RLS.
-- Sem isso a policy de pessoas chamaria a si mesma em recursao.
-- ---------------------------------------------------------------
create or replace function acessos.tem_acesso()
returns boolean language sql stable security definer set search_path = acessos, pg_temp
as $$ select exists (select 1 from acessos.pessoas p where p.user_id = auth.uid() and p.ativo); $$;

create or replace function acessos.eh_admin()
returns boolean language sql stable security definer set search_path = acessos, pg_temp
as $$ select exists (select 1 from acessos.pessoas p where p.user_id = auth.uid() and p.ativo and p.papel = 'admin'::acessos.papel); $$;

-- Unica pergunta que um app protegido precisa fazer: esta pessoa pode
-- acessar ESTE app? Admin sempre pode, pra nao precisar cadastrar
-- permissao app por app pra si mesmo.
create or replace function acessos.pode_acessar(p_app_key text)
returns boolean language sql stable security definer set search_path = acessos, pg_temp
as $$
  select acessos.eh_admin() or exists (
    select 1 from acessos.permissoes perm
    join acessos.pessoas p on p.id = perm.pessoa_id
    where p.user_id = auth.uid() and p.ativo and perm.app_key = p_app_key
  );
$$;

create or replace function acessos.marcar_atualizacao()
returns trigger language plpgsql set search_path = acessos, pg_temp
as $$ begin new.atualizado_em := now(); return new; end; $$;

create trigger pessoas_atualizado_em before update on acessos.pessoas
  for each row execute function acessos.marcar_atualizacao();

-- Primeiro acesso: liga o login novo (Supabase Auth) ao cadastro feito
-- pelo administrador em acessos.pessoas, pelo e-mail.
create or replace function acessos.vincular_novo_usuario()
returns trigger language plpgsql security definer set search_path = acessos, pg_temp
as $$
declare
  v_email text := lower(new.email);
begin
  update acessos.pessoas set user_id = new.id
   where lower(email) = v_email and user_id is null;
  return new;
end;
$$;

create trigger acessos_vincular_novo_usuario after insert on auth.users
  for each row execute function acessos.vincular_novo_usuario();

-- So um administrador muda papel, situacao ou vinculo de outra pessoa (ou
-- da propria linha) -- ninguem se promove ou se reativa sozinho.
create or replace function acessos.impede_autopromocao()
returns trigger language plpgsql security definer set search_path = acessos, pg_temp
as $$
begin
  if (new.papel is distinct from old.papel
      or new.ativo is distinct from old.ativo
      or new.user_id is distinct from old.user_id)
     and auth.uid() is not null
     and not acessos.eh_admin() then
    raise exception 'somente um administrador pode alterar papel, vinculo ou situacao de acesso';
  end if;
  return new;
end;
$$;

create trigger pessoas_papel_protegido before update on acessos.pessoas
  for each row execute function acessos.impede_autopromocao();

-- ---------------------------------------------------------------
-- RLS: cada pessoa so le a propria linha; administrador le e escreve tudo.
-- ---------------------------------------------------------------
alter table acessos.pessoas enable row level security;
alter table acessos.permissoes enable row level security;

-- A propria linha e sempre visivel: e como a tela sabe dizer "seu e-mail
-- ainda nao tem acesso" em vez de mostrar um vazio sem motivo.
create policy pessoas_leitura on acessos.pessoas
  for select to authenticated using (acessos.eh_admin() or user_id = auth.uid());
create policy pessoas_insercao on acessos.pessoas
  for insert to authenticated with check (acessos.eh_admin());
create policy pessoas_alteracao on acessos.pessoas
  for update to authenticated
  using (acessos.eh_admin() or user_id = auth.uid())
  with check (acessos.eh_admin() or user_id = auth.uid());
create policy pessoas_exclusao on acessos.pessoas
  for delete to authenticated using (acessos.eh_admin());

create policy permissoes_leitura on acessos.permissoes
  for select to authenticated using (
    acessos.eh_admin()
    or exists (select 1 from acessos.pessoas p where p.id = permissoes.pessoa_id and p.user_id = auth.uid())
  );
-- Permissao e coisa de administrador: ninguem concede acesso a si mesmo.
create policy permissoes_escrita on acessos.permissoes
  for all to authenticated using (acessos.eh_admin()) with check (acessos.eh_admin());

-- ---------------------------------------------------------------
-- Ponte em "public": qualquer app chama via supabase.rpc('ldm_pode_acessar',
-- { p_app_key: '...' }) sem precisar trocar o schema configurado no
-- proprio cliente (cada app ja usa o seu, por createClient({db:{schema}})).
-- ---------------------------------------------------------------
create or replace function public.ldm_pode_acessar(p_app_key text)
returns boolean language sql stable security definer set search_path = acessos, public, pg_temp
as $$ select acessos.pode_acessar(p_app_key); $$;

-- ---------------------------------------------------------------
-- Seed do primeiro administrador (se a conta ja existir em auth.users --
-- por exemplo, por ja ter logado em Tarefas ou Projetos).
-- ---------------------------------------------------------------
insert into acessos.pessoas (user_id, nome, email, papel, ativo)
select u.id, coalesce(u.raw_user_meta_data->>'name', 'Administrador'), lower(u.email), 'admin', true
from auth.users u
where lower(u.email) = 'danilolima@lojadomecanico.com.br'
on conflict (email) do update set
  papel = 'admin',
  ativo = true,
  user_id = coalesce(acessos.pessoas.user_id, excluded.user_id);
