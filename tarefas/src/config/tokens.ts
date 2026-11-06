/* Cores do modulo. O verde vem do card "Gerenciador de Tarefas" no hub
   (index.html da raiz) — verde porque e a cor de "concluida" no resto
   da Central, e um gerenciador de tarefas e sobre terminar coisas.
   Navy e laranja seguem a marca Loja do Mecanico. */
export const cores = {
  verde: { base: '#16A34A', escuro: '#166534', medio: '#15803D', claro: '#86EFAC', suave: '#ECFDF5' },
  navy: { base: '#0A0E3D', medio: '#161933', claro: '#2A3AA8' },
  laranja: '#FA4616',
  tinta: { base: '#161933', suave: '#6A6F94' },
  linha: '#E7E8F5',
  papel: '#F3F4FB',
  azul: '#2F6FE0',
  ambar: '#C79212',
  vermelho: '#D2453A',
} as const;

/* Mesmos quatro nomes e cores do modulo de Projetos (coresStatusTarefa):
   a Central inteira fala a mesma lingua sobre o andamento de uma
   tarefa, mesmo em modulos diferentes. */
export const coresStatus = {
  pendente: '#6A6F94',
  em_andamento: '#2F6FE0',
  concluida: '#16A34A',
  bloqueada: '#D2453A',
} as const;

export const coresPrioridade = {
  baixa: '#6A6F94',
  media: '#2F6FE0',
  alta: '#FA4616',
  critica: '#D2453A',
} as const;
