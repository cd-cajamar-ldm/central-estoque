-- O quadro ordenava as atividades sempre por prioridade/prazo: arrastar
-- um cartao para outra posicao na mesma coluna nao tinha onde ficar
-- gravado, e a tela voltava ao lugar de sempre no proximo carregamento.
--
-- Esta coluna guarda a posicao manual. Numero fracionario (nao inteiro)
-- para caber uma atividade entre duas outras sem renumerar a coluna
-- inteira a cada arrasto.
alter table projetos.projetos
  add column if not exists ordem double precision;

comment on column projetos.projetos.ordem is
  'Posicao dentro da coluna do quadro (por status), definida ao arrastar. Nula = vai para o fim.';

-- Preenche quem ja existe com a ordem que a tela ja mostrava (prioridade,
-- critica primeiro), para o quadro nao embaralhar no primeiro carregamento
-- apos a migracao.
with numerada as (
  select id,
    row_number() over (
      partition by projeto_pai_id, status
      order by case prioridade
        when 'critica' then 0 when 'alta' then 1 when 'media' then 2 else 3
      end, criado_em
    ) as posicao
  from projetos.projetos
  where projeto_pai_id is not null
)
update projetos.projetos p
set ordem = numerada.posicao * 1000
from numerada
where p.id = numerada.id and p.ordem is null;
