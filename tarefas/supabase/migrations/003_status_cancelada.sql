-- Nova situacao "cancelada": a tarefa saiu da fila sem ser feita. Antes
-- ela so cabia em "concluida" (mentindo sobre a entrega) ou "bloqueada"
-- (sugerindo que ainda vai andar). Veio da importacao do ClickUp, que
-- tem essa situacao. Nao preenche concluida_em: o gatilho
-- marcar_conclusao so olha para 'concluida', e assim continua.
--
-- "add value" nao pode ser usado na mesma transacao que o novo valor:
-- rodar este arquivo sozinho, antes de qualquer script que use 'cancelada'.
alter type tarefas.status_tarefa add value if not exists 'cancelada';
