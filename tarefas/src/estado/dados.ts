import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Grupo, Pessoa, Quadro, StatusTarefa, Tarefa } from '@/dominio/tipos';

/* Erro do PostgREST vira mensagem legivel. 42501 e a negativa de RLS:
   sem tradutor, o usuario ve um codigo e nao entende que faltou
   permissao. */
export function mensagemDeErro(erro: unknown): string {
  const e = erro as { code?: string; message?: string } | null;
  if (!e) return 'Erro desconhecido.';
  if (e.message?.includes('permission denied for table')) {
    return 'Sua sessão não chegou ao banco (expirou ou ainda não carregou). Recarregue a página e, se continuar, entre de novo.';
  }
  if (e.code === '42501' || e.message?.includes('row-level security')) {
    return 'Sem permissão: administrador e editor organizam qualquer quadro; quem só lê mexe no que é responsável.';
  }
  if (e.code === '23505') return 'Já existe um registro com este e-mail.';
  return e.message ?? 'Erro ao falar com o servidor.';
}

async function selecionar<T>(tabela: string, ordem: string, ascendente = true): Promise<T[]> {
  const { data, error } = await supabase.from(tabela).select('*').order(ordem, { ascending: ascendente });
  if (error) throw error;
  return (data ?? []) as T[];
}

export const listarQuadros = () => selecionar<Quadro>('quadros', 'criado_em', false);
export const listarPessoas = () => selecionar<Pessoa>('pessoas', 'nome');

export async function salvarQuadro(dados: Partial<Quadro> & { nome: string }, id?: string) {
  if (id) {
    const { error } = await supabase.from('quadros').update(dados).eq('id', id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await supabase.from('quadros').insert(dados).select('id').single();
  if (error) throw error;
  const novoId = (data as { id: string }).id;
  /* Todo quadro nasce com uma primeira secao — um quadro sem nenhum
     grupo deixaria a tabela sem onde colocar a primeira tarefa. */
  const { error: erroGrupo } = await supabase.from('grupos').insert({ quadro_id: novoId, nome: 'Geral', ordem: 0 });
  if (erroGrupo) throw erroGrupo;
  return novoId;
}

export async function excluirQuadro(id: string) {
  const { error } = await supabase.from('quadros').delete().eq('id', id);
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

export async function salvarGrupo(dados: Partial<Grupo> & { quadro_id: string; nome: string }, id?: string) {
  const { error } = id
    ? await supabase.from('grupos').update(dados).eq('id', id)
    : await supabase.from('grupos').insert(dados);
  if (error) throw error;
}

export async function excluirGrupo(id: string) {
  const { error } = await supabase.from('grupos').delete().eq('id', id);
  if (error) throw error;
}

export async function salvarTarefa(
  dados: Partial<Tarefa> & { quadro_id: string; titulo: string }, id?: string,
) {
  if (id) {
    const { error } = await supabase.from('tarefas').update(dados).eq('id', id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await supabase.from('tarefas').insert(dados).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function excluirTarefa(id: string) {
  const { error } = await supabase.from('tarefas').delete().eq('id', id);
  if (error) throw error;
}

/* Mudar a situacao arrastando no quadro (kanban): sem posicao
   especifica, a tarefa vai para o fim da coluna nova. */
export async function moverTarefa(tarefa: Tarefa, status: StatusTarefa) {
  await salvarTarefa({ quadro_id: tarefa.quadro_id, titulo: tarefa.titulo, status }, tarefa.id);
}

/* Soltar antes de outro cartao (ou no fim, com antesDeId nulo): mesma
   tecnica de posicao fracionaria do quadro de Projetos — cabe uma
   tarefa entre duas outras sem renumerar a coluna inteira. */
export async function reordenarTarefa(
  tarefa: Tarefa, todasDoQuadro: Tarefa[], status: StatusTarefa, antesDeId: string | null,
) {
  const daColuna = todasDoQuadro
    .filter((t) => t.status === status && t.id !== tarefa.id)
    .sort((a, b) => (a.ordem ?? Infinity) - (b.ordem ?? Infinity));

  const indiceAlvo = antesDeId ? daColuna.findIndex((t) => t.id === antesDeId) : -1;
  const seguinte = antesDeId ? daColuna[indiceAlvo] : undefined;
  const anterior = antesDeId ? daColuna[indiceAlvo - 1] : daColuna[daColuna.length - 1];

  const novaOrdem = anterior?.ordem != null && seguinte?.ordem != null
    ? (anterior.ordem + seguinte.ordem) / 2
    : anterior?.ordem != null ? anterior.ordem + 1000
    : seguinte?.ordem != null ? seguinte.ordem - 1000
    : 0;

  await salvarTarefa({ quadro_id: tarefa.quadro_id, titulo: tarefa.titulo, status, ordem: novaOrdem }, tarefa.id);
}

interface Carteira {
  quadros: Quadro[];
  pessoas: Pessoa[];
  carregando: boolean;
  erro: string | null;
  recarregar: () => Promise<void>;
}

export function useQuadros(pronto = true): Carteira {
  const [quadros, setQuadros] = useState<Quadro[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  /* So a primeira carga troca a tela inteira por "Carregando…" — uma
     edicao qualquer tambem recarrega a lista, e sem esta guarda a
     pagina piscava a cada troca. */
  const jaCarregouUmaVez = useRef(false);

  const recarregar = useCallback(async () => {
    if (!pronto) return;
    if (!jaCarregouUmaVez.current) setCarregando(true);
    try {
      const [q, p] = await Promise.all([listarQuadros(), listarPessoas()]);
      setQuadros(q);
      setPessoas(p);
      setErro(null);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      jaCarregouUmaVez.current = true;
      setCarregando(false);
    }
  }, [pronto]);

  useEffect(() => { void recarregar(); }, [recarregar]);

  return { quadros, pessoas, carregando, erro, recarregar };
}

interface DetalheQuadro {
  grupos: Grupo[];
  tarefas: Tarefa[];
  carregando: boolean;
  erro: string | null;
  recarregar: () => Promise<void>;
}

export function useDetalheQuadro(quadroId: string | null): DetalheQuadro {
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    if (!quadroId) { setGrupos([]); setTarefas([]); return; }
    setCarregando(true);
    try {
      const [g, t] = await Promise.all([
        supabase.from('grupos').select('*').eq('quadro_id', quadroId).order('ordem'),
        supabase.from('tarefas').select('*').eq('quadro_id', quadroId).order('criado_em'),
      ]);
      const falha = g.error ?? t.error;
      if (falha) throw falha;
      setGrupos((g.data ?? []) as Grupo[]);
      setTarefas((t.data ?? []) as Tarefa[]);
      setErro(null);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setCarregando(false);
    }
  }, [quadroId]);

  useEffect(() => { void recarregar(); }, [recarregar]);

  return { grupos, tarefas, carregando, erro, recarregar };
}
