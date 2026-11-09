-- Importacao das tarefas da lista do ClickUp
-- https://app.clickup.com/90132635903/v/l/2ky55r7z-493
-- Transcrita de print da visao Lista em 09/11/2026 (o plano gratuito do
-- ClickUp nao exporta). Sem data de vencimento e sem prioridade na
-- origem: as tarefas entram com prioridade "media" e sem prazo.
--
-- O ClickUp desta lista tem situacoes proprias (Backlog, Pendente,
-- Mapeamento diario, Cancelado) que nao existem aqui. Para nao perder
-- essa informacao, cada uma virou um GRUPO do quadro (visao Tabela), e
-- a situacao do kanban foi aproximada:
--   Mapeamento diario -> em_andamento
--   Pendente, Backlog -> pendente
--   Cancelado         -> concluida (fora do trabalho ativo)
--
-- Rodar no SQL Editor do Supabase (projeto Estoque Project), DEPOIS das
-- migrations 001 e 002. Pode rodar mais de uma vez: se o quadro ja
-- existir, nada e inserido de novo.
do $$
declare
  v_dono   uuid;
  v_quadro uuid;
  g_diario uuid;
  g_pend   uuid;
  g_back   uuid;
  g_canc   uuid;
begin
  if exists (select 1 from tarefas.quadros where nome = 'Importado do ClickUp') then
    raise notice 'Quadro "Importado do ClickUp" ja existe - importacao ignorada.';
    return;
  end if;

  select user_id into v_dono from tarefas.pessoas
   where email = 'danilolima@lojadomecanico.com.br';

  insert into tarefas.quadros (nome, descricao, cor, criado_por)
  values ('Importado do ClickUp',
          'Tarefas trazidas da lista do ClickUp (2ky55r7z-493).',
          '#FA4616', v_dono)
  returning id into v_quadro;

  insert into tarefas.grupos (quadro_id, nome, cor, ordem) values
    (v_quadro, 'Mapeamento diário', '#FA4616', 0) returning id into g_diario;
  insert into tarefas.grupos (quadro_id, nome, cor, ordem) values
    (v_quadro, 'Pendente', '#6A6F94', 1) returning id into g_pend;
  insert into tarefas.grupos (quadro_id, nome, cor, ordem) values
    (v_quadro, 'Backlog', '#C79212', 2) returning id into g_back;
  insert into tarefas.grupos (quadro_id, nome, cor, ordem) values
    (v_quadro, 'Cancelado', '#D2453A', 3) returning id into g_canc;

  insert into tarefas.tarefas (quadro_id, grupo_id, titulo, status, ordem, criado_por) values
    (v_quadro, g_canc,   'Criação de 3D Resumo de inventari',     'concluida',    1,  v_dono),
    (v_quadro, g_back,   'Criar uma Analise de Perda/Ganho',      'pendente',     2,  v_dono),
    (v_quadro, g_pend,   'Ajuste Cadastro Compressores',          'pendente',     3,  v_dono),
    (v_quadro, g_diario, 'Report Ciclo Inventário',               'em_andamento', 4,  v_dono),
    (v_quadro, g_diario, 'Report Transitórios',                   'em_andamento', 5,  v_dono),
    (v_quadro, g_back,   'Reunião Gustavo - BASES',               'pendente',     6,  v_dono),
    (v_quadro, g_pend,   'Relatorio Grot',                        'pendente',     7,  v_dono),
    (v_quadro, g_pend,   'Relatorio de nota pendente de entrada', 'pendente',     8,  v_dono),
    (v_quadro, g_pend,   'Apresentação Projetos',                 'pendente',     9,  v_dono),
    (v_quadro, g_back,   'Atualização POP',                       'pendente',     10, v_dono);
end $$;
