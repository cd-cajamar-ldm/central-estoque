export type Papel = 'admin' | 'editor' | 'leitor';
/* A situacao virou texto livre: a equipe cria as suas em Configuracao.
   As seis de fabrica continuam em dominio/situacoes.ts, que tambem diz
   o que cada uma significa (aberta, concluida ou cancelada). */
export type StatusProjeto = string;
export type Prioridade = 'baixa' | 'media' | 'alta' | 'critica';
export type StatusTarefa = 'pendente' | 'em_andamento' | 'concluida' | 'bloqueada';

export interface Pessoa {
  id: string;
  user_id: string | null;
  nome: string;
  email: string;
  area: string | null;
  papel: Papel;
  ativo: boolean;
}

export interface Projeto {
  id: string;
  /* Projeto que agrupa este. "Melhorias Bseller" e o pai; cada melhoria
     e um projeto filho, com marcos, tarefas, paginas e documento
     proprios. */
  projeto_pai_id: string | null;
  /* Preenchido, o projeto e um guarda-chuva e este e o nome dos itens
     de dentro no plural ("Melhorias", "Frentes", "Etapas"). Vazio, e um
     projeto comum, com marcos, tarefas, paginas e anexos proprios. */
  rotulo_filhos: string | null;
  codigo: string | null;
  /* Ligacao com o mundo de fora: o chamado aberto no BSeller e, quando
     existe, o ticket do time de desenvolvimento. */
  chamado: string | null;
  chamado_url: string | null;
  ticket_jira: string | null;
  nome: string;
  descricao: string | null;
  area: string | null;
  responsavel_id: string | null;
  status: StatusProjeto;
  prioridade: Prioridade;
  inicio_previsto: string | null;
  fim_previsto: string | null;
  inicio_real: string | null;
  fim_real: string | null;
  percentual: number;
  /* Posicao dentro da coluna do quadro (por status), definida ao
     arrastar. Nula: vai para o fim. */
  ordem: number | null;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface Marco {
  id: string;
  projeto_id: string;
  nome: string;
  descricao: string | null;
  data_prevista: string | null;
  data_real: string | null;
  concluido: boolean;
  ordem: number;
}

export interface Tarefa {
  id: string;
  projeto_id: string;
  marco_id: string | null;
  titulo: string;
  descricao: string | null;
  responsavel_id: string | null;
  status: StatusTarefa;
  inicio: string | null;
  prazo: string | null;
  concluida_em: string | null;
  ordem: number;
}

export interface Atualizacao {
  id: string;
  projeto_id: string;
  data: string;
  texto: string;
  status_reportado: StatusProjeto | null;
  percentual: number | null;
  riscos: string | null;
  proximos_passos: string | null;
  autor_id: string | null;
  /* Sem login, quem reporta se identifica pelo nome escolhido no
     formulario - e o unico registro de autoria que sobra. */
  autor_nome: string | null;
  criado_em: string;
}

export type Momento = 'antes' | 'depois' | 'evidencia' | 'documento';

export interface Anexo {
  id: string;
  projeto_id: string;
  marco_id: string | null;
  atualizacao_id: string | null;
  /* Caminho dentro do bucket. A URL publica e derivada dele, nunca
     guardada: se o projeto Supabase mudar de endereco, os anexos
     continuam encontraveis. */
  caminho: string;
  nome_arquivo: string;
  tipo_mime: string | null;
  tamanho_bytes: number | null;
  momento: Momento;
  legenda: string | null;
  /* Nome da cena que liga um "antes" ao seu "depois". */
  par: string | null;
  enviado_por: string | null;
  criado_em: string;
}

export const rotuloMomento: Record<Momento, string> = {
  antes: 'Antes', depois: 'Depois', evidencia: 'Evidência', documento: 'Documento',
};

export const MOMENTOS: Momento[] = ['antes', 'depois', 'evidencia', 'documento'];

export type TipoDeBloco = 'texto' | 'fluxo';

export interface Bloco {
  id: string;
  tipo: TipoDeBloco;
  /* Texto rico guarda HTML; fluxo guarda o codigo do diagrama. */
  conteudo: string;
}

export type StatusPagina = 'rascunho' | 'em_revisao' | 'aprovada' | 'concluida' | 'cancelada';

export const rotuloStatusPagina: Record<StatusPagina, string> = {
  rascunho: 'Rascunho',
  em_revisao: 'Em revisão',
  aprovada: 'Aprovada',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};

export const STATUS_PAGINA: StatusPagina[] = [
  'rascunho', 'em_revisao', 'aprovada', 'concluida', 'cancelada',
];

export interface Pagina {
  id: string;
  projeto_id: string;
  titulo: string;
  /* Onde a pagina esta no proprio ciclo: rascunho enquanto se escreve,
     aprovada quando vale, cancelada quando foi abandonada. */
  status: StatusPagina;
  blocos: Bloco[];
  ordem: number;
  atualizado_por: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface VersaoDePagina {
  id: string;
  pagina_id: string;
  titulo: string;
  blocos: Bloco[];
  salvo_por: string | null;
  criado_em: string;
}

/* Nomes de fabrica. A tela usa o que estiver configurado; isto e o
   que sobra quando nao ha configuracao nenhuma. */
export const rotuloStatus: Record<string, string> = {
  nao_iniciado: 'Não iniciado',
  em_andamento: 'Em andamento',
  em_risco: 'Em risco',
  pausado: 'Pausado',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

export const rotuloPrioridade: Record<Prioridade, string> = {
  baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica',
};

export const rotuloStatusTarefa: Record<StatusTarefa, string> = {
  pendente: 'Pendente', em_andamento: 'Em andamento', concluida: 'Concluída', bloqueada: 'Bloqueada',
};

export const rotuloPapel: Record<Papel, string> = {
  admin: 'Administrador', editor: 'Editor', leitor: 'Leitor',
};

export const PAPEIS: Papel[] = ['leitor', 'editor', 'admin'];
export const explicacaoDoPapel: Record<Papel, string> = {
  leitor: 'vê tudo, não altera nada',
  editor: 'vê tudo e altera o que ele mesmo criar',
  admin: 'vê e altera tudo, cadastra pessoas',
};

export const STATUS: StatusProjeto[] = ['nao_iniciado', 'em_andamento', 'em_risco', 'pausado', 'concluido', 'cancelado'];
export const PRIORIDADES: Prioridade[] = ['baixa', 'media', 'alta', 'critica'];
export const STATUS_TAREFA: StatusTarefa[] = ['pendente', 'em_andamento', 'concluida', 'bloqueada'];
