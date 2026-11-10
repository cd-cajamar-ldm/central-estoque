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

/* Item de checklist guardado dentro da propria tarefa (coluna jsonb). */
export interface ItemChecklist {
  id: string;
  texto: string;
  feito: boolean;
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
  /* Datas em AAAA-MM-DD. inicio e prazo (fim previsto) sao digitados;
     concluida_em e preenchida sozinha ao concluir e pode ser corrigida. */
  inicio: string | null;
  prazo: string | null;
  concluida_em: string | null;
  checklist: ItemChecklist[];
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

/* Paleta de cores para escolher ao criar um quadro. Comeca pelas cores
   da marca (laranja e azul LDM) e segue por tons que ficam legiveis com
   texto e ilustracao brancos na capa do quadro. Fora da paleta, o
   formulario ainda deixa escolher qualquer cor. */
export const CORES_QUADRO = [
  '#FE5000', '#001A72', '#16A34A', '#2F6FE0', '#FA4616', '#7C3AED',
  '#C79212', '#D2453A', '#0E9488', '#6A6F94', '#DB2777', '#0891B2',
  '#65A30D', '#9333EA', '#B45309', '#475569', '#1E3A8A', '#BE123C',
];
