-- Datas de inicio e conclusao editaveis, e checklist dentro da tarefa.
--
-- Para o Resumo (balanco do dia, semana, mes ou ano) a tarefa precisa
-- dizer quando comecou, quando devia acabar (prazo, que ja existe) e
-- quando acabou de fato. A conclusao ja era gravada sozinha ao mudar a
-- situacao para "concluida"; agora ela tambem pode ser corrigida a mao
-- (ex.: a tarefa foi feita na sexta e so marcada na segunda).
--
-- O checklist e uma lista de itens {id, texto, feito} guardada na
-- propria tarefa: e sempre lido e gravado junto com ela, entao nao
-- precisa de tabela propria nem de regra de acesso nova (quem pode
-- mexer na tarefa pode marcar os itens).

alter table tarefas.tarefas
  add column if not exists inicio date,
  add column if not exists checklist jsonb not null default '[]'::jsonb;

create or replace function tarefas.marcar_conclusao()
returns trigger language plpgsql set search_path = tarefas, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'concluida' then
      new.concluida_em := coalesce(new.concluida_em, current_date);
    else
      new.concluida_em := null;
    end if;
    return new;
  end if;

  if new.status = 'concluida' then
    -- Acabou de ser concluida: vale a data digitada, senao hoje.
    -- Ja estava concluida e apagaram a data: volta a anterior (ou hoje).
    new.concluida_em := coalesce(new.concluida_em, old.concluida_em, current_date);
  else
    -- Saiu de concluida (ou nunca foi): nao tem data de conclusao.
    new.concluida_em := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tarefas_marcar_conclusao on tarefas.tarefas;
create trigger tarefas_marcar_conclusao before insert or update on tarefas.tarefas
  for each row execute function tarefas.marcar_conclusao();

create index if not exists tarefas_concluida_em_idx on tarefas.tarefas (concluida_em);
