-- Aplicada no projeto Supabase "Estoque Project" (jfvnswafpeshyfweoadg),
-- o mesmo banco do modulo de Projetos. Fica em schema proprio para nao
-- se misturar com as tabelas dos outros modulos do mesmo banco.
create schema if not exists tarefas;

create type tarefas.papel as enum ('admin', 'editor', 'leitor');
create type tarefas.prioridade as enum ('baixa', 'media', 'alta', 'critica');
-- Mesmos quatro nomes do modulo de Projetos (projetos.status_tarefa), para
-- a Central inteira falar a mesma lingua sobre o andamento de uma tarefa.
create type tarefas.status_tarefa as enum ('pendente', 'em_andamento', 'concluida', 'bloqueada');

-- Pessoas existem independentemente de login: da para apontar um
-- responsavel que ainda nao acessou o sistema. O vinculo com auth.users
-- acontece depois, pelo e-mail, no primeiro acesso. Cadastro proprio
-- deste modulo — nao e o mesmo de projetos.pessoas, mesmo que a mesma
-- pessoa (e o mesmo login) apareca nos dois.
create table tarefas.pessoas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  nome text not null,
  email text not null unique,
  area text,
  papel tarefas.papel not null default 'leitor',
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Um quadro de tarefas (estilo Monday/ClickUp): um espaco de trabalho
-- com suas proprias secoes (grupos) e tarefas. Quem cria um quadro e o
-- dono dele para fins de edicao/exclusao, mas a leitura e de todo mundo
-- com cadastro ativo — nao ha convite por quadro na primeira versao.
create table tarefas.quadros (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  cor text not null default '#16A34A',
  arquivado boolean not null default false,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Secao dentro de um quadro (a "linha" do Monday): agrupa tarefas na
-- visao Tabela. A visao Quadro (kanban) nao usa grupo como coluna — la
-- a coluna e a situacao (status_tarefa), igual em todo quadro.
create table tarefas.grupos (
  id uuid primary key default gen_random_uuid(),
  quadro_id uuid not null references tarefas.quadros(id) on delete cascade,
  nome text not null,
  cor text not null default '#6A6F94',
  ordem smallint not null default 0,
  criado_em timestamptz not null default now()
);

create table tarefas.tarefas (
  id uuid primary key default gen_random_uuid(),
  quadro_id uuid not null references tarefas.quadros(id) on delete cascade,
  -- Apagar o grupo nao apaga a tarefa: ela so fica sem secao na tabela
  -- ate alguem escolher outra.
  grupo_id uuid references tarefas.grupos(id) on delete set null,
  titulo text not null,
  descricao text,
  responsavel_id uuid references tarefas.pessoas(id) on delete set null,
  status tarefas.status_tarefa not null default 'pendente',
  prioridade tarefas.prioridade not null default 'media',
  prazo date,
  concluida_em date,
  -- Numero fracionario (nao inteiro) para caber uma tarefa entre duas
  -- outras ao arrastar no quadro, sem renumerar a coluna inteira.
  -- Nula = vai para o fim da coluna.
  ordem double precision,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index pessoas_user_id_idx on tarefas.pessoas (user_id);
create index quadros_criado_por_idx on tarefas.quadros (criado_por);
create index grupos_quadro_idx on tarefas.grupos (quadro_id, ordem);
create index tarefas_quadro_idx on tarefas.tarefas (quadro_id, status, ordem);
create index tarefas_grupo_idx on tarefas.tarefas (grupo_id);
create index tarefas_responsavel_idx on tarefas.tarefas (responsavel_id);
create index tarefas_prazo_idx on tarefas.tarefas (prazo);

-- PostgREST atende pelo papel do usuario autenticado; sem grant no
-- schema e nas tabelas nem a policy chega a ser avaliada. Diferente de
-- projetos, este modulo nasce exigindo login — nao ha fase "aberta".
grant usage on schema tarefas to authenticated;
grant select, insert, update, delete on all tables in schema tarefas to authenticated;
alter default privileges in schema tarefas grant select, insert, update, delete on tables to authenticated;
