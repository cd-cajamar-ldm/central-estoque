import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { mensagemDeErro } from '@/estado/dados';
import type { Pessoa, Quadro } from '@/dominio/tipos';

/* Duas coisas diferentes moram aqui: estar logado e ter acesso.
   Qualquer e-mail consegue criar conta no Supabase; ver os quadros
   exige um cadastro ativo em tarefas.pessoas, feito antes por um
   administrador. O banco ja cobra isso nas policies — a tela so
   precisa saber em qual dos dois estados a pessoa esta para não
   mostrar uma lista vazia sem explicação. */

export interface UsuarioLogado {
  id: string;
  email: string;
}

export interface Sessao {
  carregando: boolean;
  usuario: UsuarioLogado | null;
  pessoa: Pessoa | null;
  erro: string | null;
  recarregar: () => Promise<void>;
}

export async function buscarCadastro(userId: string): Promise<Pessoa | null> {
  const { data, error } = await supabase
    .from('pessoas').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return (data as Pessoa | null) ?? null;
}

export function useSessao(): Sessao {
  const [usuario, setUsuario] = useState<UsuarioLogado | null>(null);
  const [pessoa, setPessoa] = useState<Pessoa | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregarCadastro = useCallback(async (u: UsuarioLogado | null) => {
    if (!u) { setPessoa(null); return; }
    try {
      setPessoa(await buscarCadastro(u.id));
      setErro(null);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }, []);

  useEffect(() => {
    let vivo = true;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      const u = data.session?.user;
      const logado = u ? { id: u.id, email: u.email ?? '' } : null;
      if (!vivo) return;
      setUsuario(logado);
      await carregarCadastro(logado);
      if (vivo) setCarregando(false);
    })();

    /* O Supabase renova o token sozinho e avisa por aqui; sem escutar,
       a tela continuaria com a sessão antiga depois de sair em outra
       aba. */
    const { data: assinatura } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      const u = sessao?.user;
      const logado = u ? { id: u.id, email: u.email ?? '' } : null;
      setUsuario(logado);
      void carregarCadastro(logado);
    });

    return () => { vivo = false; assinatura.subscription.unsubscribe(); };
  }, [carregarCadastro]);

  const recarregar = useCallback(async () => {
    await carregarCadastro(usuario);
  }, [carregarCadastro, usuario]);

  return { carregando, usuario, pessoa, erro, recarregar };
}

export const sair = () => supabase.auth.signOut();

/* A mesma regra do banco, repetida na tela — nao para proteger (quem
   protege e a policy), mas para o botao nao existir quando a acao vai
   ser recusada. Admin e editor organizam tudo; leitor so mexe no que e
   responsavel. */
export interface Permissoes {
  ehAdmin: boolean;
  podeCriar: boolean;
  podeEditarQuadro: (quadro: Quadro) => boolean;
  podeEditarTarefa: (tarefa: { responsavel_id: string | null }, pessoaDoResponsavel: Pessoa | undefined) => boolean;
  usuarioId: string | null;
}

export const PERMISSOES_FECHADAS: Permissoes = {
  ehAdmin: false, podeCriar: false, podeEditarQuadro: () => false, podeEditarTarefa: () => false, usuarioId: null,
};

export const ContextoPermissoes = createContext<Permissoes>(PERMISSOES_FECHADAS);

export const usePermissoes = () => useContext(ContextoPermissoes);

export function permissoesDe(sessao: Sessao): Permissoes {
  const papel = sessao.pessoa?.ativo ? sessao.pessoa.papel : null;
  const usuarioId = sessao.usuario?.id ?? null;
  const ehAdmin = papel === 'admin';
  const podeCriar = ehAdmin || papel === 'editor';
  return {
    ehAdmin,
    podeCriar,
    podeEditarQuadro: (quadro) => ehAdmin || (!!usuarioId && quadro.criado_por === usuarioId),
    podeEditarTarefa: (_tarefa, pessoaDoResponsavel) =>
      podeCriar || (!!usuarioId && pessoaDoResponsavel?.user_id === usuarioId),
    usuarioId,
  };
}
