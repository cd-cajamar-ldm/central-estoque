export type Papel = 'admin' | 'editor' | 'leitor';
export type Prioridade = 'baixa' | 'media' | 'alta' | 'critica';
export type StatusTarefa = 'pendente' | 'em_andamento' | 'concluida' | 'bloqueada' | 'cancelada';

/* Situacoes que encerram a tarefa: nao contam como atrasada nem como
   trabalho em aberto. Cancelada e diferente de concluida — a tarefa saiu
   da fila sem ser feita. */
export const STATUS_ENCERRADOS: StatusTarefa[] = ['concluida', 'cancelada'];

export interface Pessoa {
  id: string;
  user_id: string | null;
  nome: string;
  email: string;
  area: string | null;
  papel: Papel;
  ativo: boolean;
}

export interface Quadro {
  id: string;
  nome: string;
  descricao: string | null;
  cor: string;
  arquivado: boolean;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface Grupo {
  id: string;
  quadro_id: string;
  nome: string;
  cor: string;
  ordem: number;
}

export interface Tarefa {
  id: string;
  quadro_id: string;
  grupo_id: string | null;
  titulo: string;
  descricao: string | null;
  responsavel_id: string | null;
  status: StatusTarefa;
  prioridade: Prioridade;
  prazo: string | null;
  concluida_em: string | null;
  ordem: number | null;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
}

export const rotuloPrioridade: Record<Prioridade, string> = {
  baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica',
};

export const rotuloStatus: Record<StatusTarefa, string> = {
  pendente: 'Pendente', em_andamento: 'Em andamento', concluida: 'Concluída', bloqueada: 'Bloqueada', cancelada: 'Cancelada',
};

export const rotuloPapel: Record<Papel, string> = {
  admin: 'Administrador', editor: 'Editor', leitor: 'Leitor',
};

export const PAPEIS: Papel[] = ['leitor', 'editor', 'admin'];
export const explicacaoDoPapel: Record<Papel, string> = {
  leitor: 'vê tudo, só mexe nas tarefas em que é o responsável',
  editor: 'vê e organiza qualquer quadro, tarefa e grupo',
  admin: 'faz tudo o que o editor faz, além de cadastrar pessoas e gerenciar quadros de outros',
};

export const PRIORIDADES: Prioridade[] = ['baixa', 'media', 'alta', 'critica'];
export const STATUS_TAREFA: StatusTarefa[] = ['pendente', 'em_andamento', 'concluida', 'bloqueada', 'cancelada'];

/* Paleta de cores para escolher ao criar um quadro ou um grupo — poucas
   opcoes, para a lista de quadros continuar legivel por cor. */
export const CORES_QUADRO = ['#16A34A', '#2F6FE0', '#FA4616', '#7C3AED', '#C79212', '#D2453A', '#0E9488', '#6A6F94'];
