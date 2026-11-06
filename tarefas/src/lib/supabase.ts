import { createClient } from '@supabase/supabase-js';

/* Mesmo projeto Supabase do modulo de Projetos ("Estoque Project") — a
   chave publicavel e a mesma, o que muda e o schema. A chave e, por
   definicao, publica: ela vai embutida em qualquer app de navegador. O
   que protege os dados e o RLS no banco (todo acesso exige sessao
   autenticada), nunca esta chave. As variaveis de ambiente permitem
   apontar para outro projeto sem recompilar o codigo-fonte. */
const URL_PADRAO = 'https://jfvnswafpeshyfweoadg.supabase.co';
const CHAVE_PADRAO = 'sb_publishable_x1ioDmPDsDZdTgcq6SOCGw_PlJeIw_m';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? URL_PADRAO,
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? CHAVE_PADRAO,
  {
    /* As tabelas do modulo vivem no schema "tarefas" para nao se
       misturar com os outros modulos do mesmo banco (inclusive o
       proprio modulo de Projetos, que tem a sua propria tabela
       "tarefas" dentro do schema "projetos"). */
    db: { schema: 'tarefas' },
    /* Com login de volta, a sessao fica guardada no navegador e o
       token se renova sozinho — sem isso a pessoa cairia na tela de
       acesso a cada recarga. detectSessionInUrl fica ligado por causa
       do link de troca de senha, que volta com o token no endereco. */
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  }
);
