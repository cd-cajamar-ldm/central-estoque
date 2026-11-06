/* Mesmos quatro nomes e cores do modulo de Projetos (coresStatusTarefa):
   a Central inteira fala a mesma lingua sobre o andamento de uma
   tarefa, mesmo em modulos diferentes. "Concluida" usa o verde de
   sucesso da Oficina LDM (--success em Inventário Rotativo). */
export const coresStatus = {
  pendente: '#6A6F94',
  em_andamento: '#2F6FE0',
  concluida: '#1F8A52',
  bloqueada: '#D2453A',
} as const;

/* "Alta" usa o laranja oficial da marca (FE5000, igual à sidebar e ao
   destaque de Inventário Rotativo). */
export const coresPrioridade = {
  baixa: '#6A6F94',
  media: '#2F6FE0',
  alta: '#FE5000',
  critica: '#D2453A',
} as const;
