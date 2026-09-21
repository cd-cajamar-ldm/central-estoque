import { useState } from 'react';
import { Aviso } from '@/componentes/ui';
import { supabase } from '@/lib/supabase';

type Modo = 'entrar' | 'criar' | 'recuperar';

/* Mensagem do Supabase vem em ingles e sem contexto. Traduzir os casos
   que a equipe vai encontrar de verdade evita chamado por "Invalid
   login credentials". */
function emPortugues(mensagem: string): string {
  const m = mensagem.toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed')) return 'Confirme o e-mail pelo link que o Supabase enviou e tente de novo.';
  if (m.includes('user already registered')) return 'Este e-mail já tem acesso criado. Use "Entrar".';
  if (m.includes('password should be at least')) return 'A senha precisa de pelo menos 6 caracteres.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Muitas tentativas seguidas. Espere alguns minutos.';
  return mensagem;
}

export default function Acesso() {
  const [modo, setModo] = useState<Modo>('entrar');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setRecado(null);
    setEnviando(true);
    const limpo = email.trim().toLowerCase();
    try {
      if (modo === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({ email: limpo, password: senha });
        if (error) throw error;
      } else if (modo === 'criar') {
        const { error } = await supabase.auth.signUp({ email: limpo, password: senha });
        if (error) throw error;
        setRecado('Acesso criado. Se o e-mail já estiver cadastrado no módulo, você já entra; senão, peça a um administrador para cadastrá-lo.');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(limpo, {
          redirectTo: window.location.href,
        });
        if (error) throw error;
        setRecado('Se este e-mail tiver acesso, o link de troca de senha chega em instantes.');
      }
    } catch (falha) {
      setErro(emPortugues(falha instanceof Error ? falha.message : 'Não consegui completar a operação.'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy px-4 py-10">
      <div className="w-full max-w-sm">
        <img
          src="./brand/Logo_LDM_hor_2_Branco.png" alt="Loja do Mecânico"
          width={188} height={72} className="mx-auto mb-6 h-16 w-auto"
        />

        <div className="cartao p-6">
          <h1 className="font-titulo text-xl font-extrabold">Projetos</h1>
          <p className="mb-4 text-sm text-tinta-suave">
            CD Cajamar · acesso restrito a quem foi cadastrado no módulo.
          </p>

          <form onSubmit={enviar} className="space-y-3">
            <label className="block">
              <span className="rotulo">E-mail</span>
              <input
                type="email" required autoComplete="username" className="campo"
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@lojadomecanico.com.br"
              />
            </label>

            {modo !== 'recuperar' && (
              <label className="block">
                <span className="rotulo">Senha</span>
                <div className="relative">
                  <input
                    type={mostrarSenha ? 'text' : 'password'} required minLength={6} className="campo pr-16"
                    autoComplete={modo === 'criar' ? 'new-password' : 'current-password'}
                    value={senha} onChange={(e) => setSenha(e.target.value)}
                    placeholder="pelo menos 6 caracteres"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-roxo-escuro"
                    onClick={() => setMostrarSenha((v) => !v)}
                  >{mostrarSenha ? 'Ocultar' : 'Mostrar'}</button>
                </div>
              </label>
            )}

            {erro && <Aviso>{erro}</Aviso>}
            {recado && <p className="rounded-lg bg-roxo-suave px-3 py-2 text-sm text-roxo-escuro">{recado}</p>}

            <button type="submit" className="botao-primario w-full" disabled={enviando}>
              {enviando ? 'Enviando…'
                : modo === 'entrar' ? 'Entrar'
                : modo === 'criar' ? 'Criar acesso'
                : 'Enviar link de troca de senha'}
            </button>
          </form>

          <div className="mt-4 flex flex-wrap justify-between gap-2 text-xs font-bold text-roxo-escuro">
            {modo !== 'entrar' && <button onClick={() => setModo('entrar')}>← Já tenho acesso</button>}
            {modo !== 'criar' && <button onClick={() => setModo('criar')}>Primeiro acesso</button>}
            {modo !== 'recuperar' && <button onClick={() => setModo('recuperar')}>Esqueci a senha</button>}
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-white/60">
          <a href="../" className="hover:text-white">← Voltar para a Central</a>
        </p>
      </div>
    </div>
  );
}
