import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { percentualEfetivo } from '@/dominio/arvore';
import { comprimirImagem } from '@/lib/imagem';
import type { Anexo, Atualizacao, Marco, Momento, Pessoa, Projeto, Tarefa } from '@/dominio/tipos';

const BALDE = 'anexos-projetos';

/* Erro do PostgREST vira mensagem legivel. 42501 e a negativa de RLS:
   sem tradutor, o usuario ve um codigo e nao entende que faltou
   permissao. */
export function mensagemDeErro(erro: unknown): string {
  const e = erro as { code?: string; message?: string } | null;
  if (!e) return 'Erro desconhecido.';
  /* Duas negativas diferentes com o mesmo codigo: "permission denied
     for table" e requisicao que chegou sem sessao (token ausente ou
     vencido); a de policy e falta de direito sobre aquela linha. Dizer
     "voce nao pode editar" para quem so precisa entrar de novo manda a
     pessoa para o lado errado. */
  if (e.message?.includes('permission denied for table')) {
    return 'Sua sessão não chegou ao banco (expirou ou ainda não carregou). Recarregue a página e, se continuar, entre de novo.';
  }
  if (e.code === '42501' || e.message?.includes('row-level security')) {
    return 'Sem permissão: cada pessoa altera o que criou; o resto é só leitura.';
  }
  if (e.code === '23505') return 'Já existe um registro com este código ou e-mail.';
  if (e.message?.includes('exceeded the maximum allowed size')) {
    return 'Arquivo grande demais: o limite é 15 MB por anexo.';
  }
  if (e.message?.includes('mime type')) return 'Tipo de arquivo não aceito.';
  return e.message ?? 'Erro ao falar com o servidor.';
}

async function selecionar<T>(tabela: string, ordem: string, ascendente = true): Promise<T[]> {
  const { data, error } = await supabase.from(tabela).select('*').order(ordem, { ascending: ascendente });
  if (error) throw error;
  return (data ?? []) as T[];
}

/* O avanco nao e mais digitado: vem da conclusao das atividades (ou,
   na folha, da propria situacao). Normalizar aqui deixa painel,
   cronograma, planilha e regras de saude lendo o mesmo numero da tela,
   sem cada um refazer a conta — e sem depender de uma coluna que
   envelheceria a cada mudanca de situacao. */
export async function listarProjetos(): Promise<Projeto[]> {
  const lista = await selecionar<Projeto>('projetos', 'criado_em', false);
  return lista.map((p) => ({ ...p, percentual: percentualEfetivo(lista, p) }));
}
export const listarPessoas = () => selecionar<Pessoa>('pessoas', 'nome');

export async function salvarProjeto(dados: Partial<Projeto> & { nome: string }, id?: string) {
  if (id) {
    const { error } = await supabase.from('projetos').update(dados).eq('id', id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await supabase.from('projetos')
    .insert(dados).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function excluirProjeto(id: string) {
  const { error } = await supabase.from('projetos').delete().eq('id', id);
  if (error) throw error;
}

export async function salvarPessoa(dados: Partial<Pessoa> & { nome: string; email: string }, id?: string) {
  const limpo = { ...dados, email: dados.email.trim().toLowerCase() };
  const { error } = id
    ? await supabase.from('pessoas').update(limpo).eq('id', id)
    : await supabase.from('pessoas').insert(limpo);
  if (error) throw error;
}

export async function excluirPessoa(id: string) {
  const { error } = await supabase.from('pessoas').delete().eq('id', id);
  if (error) throw error;
}

export async function salvarMarco(dados: Partial<Marco> & { projeto_id: string; nome: string }, id?: string) {
  const { error } = id
    ? await supabase.from('marcos').update(dados).eq('id', id)
    : await supabase.from('marcos').insert(dados);
  if (error) throw error;
}

export async function excluirMarco(id: string) {
  const { error } = await supabase.from('marcos').delete().eq('id', id);
  if (error) throw error;
}

export async function salvarTarefa(dados: Partial<Tarefa> & { projeto_id: string; titulo: string }, id?: string) {
  const { error } = id
    ? await supabase.from('tarefas').update(dados).eq('id', id)
    : await supabase.from('tarefas').insert(dados);
  if (error) throw error;
}

export async function excluirTarefa(id: string) {
  const { error } = await supabase.from('tarefas').delete().eq('id', id);
  if (error) throw error;
}

/* Devolve o id do lancamento para que as fotos do reporte sejam
   anexadas a ele, e nao soltas no projeto. */
export async function lancarAtualizacao(
  /* O avanco saiu do formulario de reporte: quem lanca conta o que
     aconteceu e a situacao; o percentual e consequencia dela. Lancamento
     antigo mantem o numero que ja tinha. */
  dados: Omit<Atualizacao, 'id' | 'criado_em' | 'autor_id' | 'percentual'>,
): Promise<string> {
  /* O autor sai da sessao, nao do formulario: a policy do banco exige
     que autor_id seja quem esta logado, e e por ele que o proprio autor
     consegue corrigir o lancamento depois. */
  const { data: sessao } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('atualizacoes')
    .insert({ ...dados, autor_id: sessao.user?.id ?? null }).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function excluirAtualizacao(id: string) {
  const { error } = await supabase.from('atualizacoes').delete().eq('id', id);
  if (error) throw error;
}

/* ---------------- Anexos ---------------- */

export function urlDoAnexo(caminho: string): string {
  return supabase.storage.from(BALDE).getPublicUrl(caminho).data.publicUrl;
}

/* Nome de arquivo vira caminho de URL: acento, espaco e barra quebram o
   endereco publico, entao o nome guardado no banco continua o original
   e o caminho fica sem eles. */
function caminhoSeguro(projetoId: string, nome: string): string {
  const limpo = nome
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(-80);
  return `${projetoId}/${crypto.randomUUID()}-${limpo}`;
}

export interface DadosDoAnexo {
  projetoId: string;
  momento: Momento;
  legenda?: string | null;
  par?: string | null;
  marcoId?: string | null;
  atualizacaoId?: string | null;
  enviadoPor?: string | null;
}

export async function enviarAnexo(arquivo: File, dados: DadosDoAnexo): Promise<void> {
  const pronto = await comprimirImagem(arquivo);
  const caminho = caminhoSeguro(dados.projetoId, pronto.name);

  const envio = await supabase.storage.from(BALDE).upload(caminho, pronto, {
    contentType: pronto.type || 'application/octet-stream',
    upsert: false,
  });
  if (envio.error) throw envio.error;

  const { error } = await supabase.from('anexos').insert({
    projeto_id: dados.projetoId,
    marco_id: dados.marcoId ?? null,
    atualizacao_id: dados.atualizacaoId ?? null,
    caminho,
    nome_arquivo: pronto.name,
    tipo_mime: pronto.type || null,
    tamanho_bytes: pronto.size,
    momento: dados.momento,
    legenda: dados.legenda ?? null,
    par: dados.par ?? null,
    enviado_por: dados.enviadoPor ?? null,
  });
  /* O registro no banco e o arquivo no balde precisam andar juntos: sem
     esta limpeza, uma falha aqui deixaria arquivo orfao ocupando espaco
     sem aparecer em lugar nenhum. */
  if (error) {
    await supabase.storage.from(BALDE).remove([caminho]);
    throw error;
  }
}

export async function excluirAnexo(anexo: Anexo): Promise<void> {
  const { error } = await supabase.from('anexos').delete().eq('id', anexo.id);
  if (error) throw error;
  await supabase.storage.from(BALDE).remove([anexo.caminho]);
}

export async function atualizarAnexo(id: string, dados: Partial<Anexo>): Promise<void> {
  const { error } = await supabase.from('anexos').update(dados).eq('id', id);
  if (error) throw error;
}

interface Carteira {
  projetos: Projeto[];
  pessoas: Pessoa[];
  carregando: boolean;
  erro: string | null;
  recarregar: () => Promise<void>;
}

/* Carteira inteira em memoria: sao dezenas de projetos, nao milhares.
   Carregar tudo de uma vez deixa filtro, painel e cronograma
   instantaneos e evita uma consulta por interacao. */
/* "pronto" e a sessao ja resolvida. Sem essa espera, a carteira sai
   pedindo dado no primeiro render, antes de o supabase-js ler o token
   guardado no navegador: a consulta vai como visitante, o banco recusa
   (permissao negada) e a tela abre vazia com aviso de permissao, mesmo
   com a pessoa logada. Em maquina rapida a corrida costuma dar certo;
   em maquina fria, nao — foi assim que o defeito apareceu. */
export function useCarteira(pronto = true): Carteira {
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  /* So a primeira carga troca a tela inteira por "Carregando…" — uma
     edicao qualquer (status, responsavel, arrastar no quadro) tambem
     recarrega a carteira, e sem esta guarda a pagina piscava e voltava
     pro topo a cada troca, porque o conteudo sumia e reaparecia menor
     por um instante. */
  const jaCarregouUmaVez = useRef(false);

  const recarregar = useCallback(async () => {
    if (!pronto) return;
    if (!jaCarregouUmaVez.current) setCarregando(true);
    try {
      const [p, q] = await Promise.all([listarProjetos(), listarPessoas()]);
      setProjetos(p);
      setPessoas(q);
      setErro(null);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      jaCarregouUmaVez.current = true;
      setCarregando(false);
    }
  }, [pronto]);

  useEffect(() => { void recarregar(); }, [recarregar]);

  return { projetos, pessoas, carregando, erro, recarregar };
}

interface Detalhe {
  marcos: Marco[];
  tarefas: Tarefa[];
  atualizacoes: Atualizacao[];
  anexos: Anexo[];
  carregando: boolean;
  erro: string | null;
  recarregar: () => Promise<void>;
}

export function useDetalheProjeto(projetoId: string | null): Detalhe {
  const [marcos, setMarcos] = useState<Marco[]>([]);
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [atualizacoes, setAtualizacoes] = useState<Atualizacao[]>([]);
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    if (!projetoId) { setMarcos([]); setTarefas([]); setAtualizacoes([]); setAnexos([]); return; }
    setCarregando(true);
    try {
      const [m, t, a, x] = await Promise.all([
        supabase.from('marcos').select('*').eq('projeto_id', projetoId).order('ordem'),
        supabase.from('tarefas').select('*').eq('projeto_id', projetoId).order('ordem'),
        supabase.from('atualizacoes').select('*').eq('projeto_id', projetoId).order('data', { ascending: false }),
        supabase.from('anexos').select('*').eq('projeto_id', projetoId).order('criado_em', { ascending: false }),
      ]);
      const falha = m.error ?? t.error ?? a.error ?? x.error;
      if (falha) throw falha;
      setMarcos((m.data ?? []) as Marco[]);
      setTarefas((t.data ?? []) as Tarefa[]);
      setAtualizacoes((a.data ?? []) as Atualizacao[]);
      setAnexos((x.data ?? []) as Anexo[]);
      setErro(null);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setCarregando(false);
    }
  }, [projetoId]);

  useEffect(() => { void recarregar(); }, [recarregar]);

  return { marcos, tarefas, atualizacoes, anexos, carregando, erro, recarregar };
}

/* Marcos e tarefas de todos os projetos, para o cronograma geral. */
export async function listarMarcosGerais(): Promise<Marco[]> {
  const { data, error } = await supabase.from('marcos').select('*').order('data_prevista');
  if (error) throw error;
  return (data ?? []) as Marco[];
}
