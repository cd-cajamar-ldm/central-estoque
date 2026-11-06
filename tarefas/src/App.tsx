import { useCallback, useEffect, useMemo, useState } from 'react';
import Acesso from '@/paginas/Acesso';
import ListaQuadros from '@/paginas/ListaQuadros';
import DetalheQuadro from '@/paginas/DetalheQuadro';
import Pessoas from '@/paginas/Pessoas';
import { Aviso, Carregando } from '@/componentes/ui';
import { useQuadros } from '@/estado/dados';
import { ContextoPermissoes, permissoesDe, sair, useSessao } from '@/estado/sessao';
import { rotuloPapel } from '@/dominio/tipos';
import { escreverRota, lerRota } from '@/lib/rota';
import type { Aba, Rota } from '@/lib/rota';
import type { Quadro } from '@/dominio/tipos';

declare const __VERSAO__: string;

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: 'quadros', rotulo: 'Quadros' },
  { id: 'pessoas', rotulo: 'Pessoas' },
];

export default function App() {
  /* A posicao vive no endereco: atualizar a pagina tem de trazer de
     volta a mesma tela, e nao a lista de quadros. */
  const [rota, setRota] = useState(() => lerRota(window.location.hash));
  const sessao = useSessao();

  useEffect(() => {
    const ouvir = () => setRota(lerRota(window.location.hash));
    window.addEventListener('hashchange', ouvir);
    return () => window.removeEventListener('hashchange', ouvir);
  }, []);

  const ir = useCallback((nova: Rota) => {
    setRota((atual) => (
      atual.aba === nova.aba && atual.quadroId === nova.quadroId ? atual : nova
    ));
    const endereco = escreverRota(nova);
    if (window.location.hash !== endereco) window.location.hash = endereco;
  }, []);

  const abrirQuadro = useCallback(
    (q: Quadro) => ir({ aba: 'quadros', quadroId: q.id }),
    [ir],
  );

  const pronto = !sessao.carregando && !!sessao.usuario;
  const carteira = useQuadros(pronto);
  const permissoes = useMemo(() => permissoesDe(sessao), [sessao]);

  const selecionado = rota.quadroId
    ? carteira.quadros.find((q) => q.id === rota.quadroId) ?? null
    : null;
  const aba = rota.aba;

  if (sessao.carregando) return <Carregando />;
  if (!sessao.usuario) return <Acesso />;

  if (!sessao.pessoa?.ativo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy px-4">
        <div className="cartao max-w-sm p-6 text-center">
          <h1 className="font-titulo text-lg font-extrabold">Acesso ainda não liberado</h1>
          <p className="mt-2 text-sm text-tinta-suave">
            O login de <strong>{sessao.usuario.email}</strong> funcionou, mas este e-mail não está
            cadastrado como pessoa ativa do módulo. Peça a um administrador para cadastrá-lo
            com exatamente este endereço.
          </p>
          <button className="botao-neutro mt-4" onClick={() => void sair()}>Sair</button>
        </div>
      </div>
    );
  }

  return (
    <ContextoPermissoes.Provider value={permissoes}>
    <div className="min-h-screen">
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-tela flex-wrap items-center gap-5 px-6 py-5 xl:px-10">
          <img
            src="./brand/Logo_LDM_hor_2_Branco.png" alt="Loja do Mecânico"
            width={188} height={72}
            className="h-14 w-auto drop-shadow-[0_2px_8px_rgba(0,0,0,.4)] sm:h-[72px]"
          />
          <span className="hidden h-12 w-px bg-white/20 sm:block" />
          <div className="mr-auto">
            <h1 className="font-titulo text-2xl font-extrabold leading-tight">Tarefas</h1>
            <p className="text-[13px] text-white/60">CD Cajamar · quadros de tarefas da equipe</p>
          </div>
          <div className="text-right text-xs">
            <p className="font-bold text-white/90">{sessao.pessoa.nome}</p>
            <p className="text-white/50">{rotuloPapel[sessao.pessoa.papel]}</p>
            <div className="mt-1 flex gap-3 font-bold text-white/70">
              <a href="../" className="hover:text-white">← Central</a>
              <button className="hover:text-white" onClick={() => void sair()}>Sair</button>
            </div>
          </div>
        </div>
        <nav className="mx-auto flex max-w-tela gap-1 px-6 xl:px-10">
          {ABAS.map((a) => (
            <button
              key={a.id}
              onClick={() => ir({ aba: a.id, quadroId: null })}
              className={`rounded-t-lg px-4 py-2 text-sm font-bold transition ${
                aba === a.id ? 'bg-papel text-navy' : 'text-white/70 hover:bg-white/10'
              }`}
            >{a.rotulo}</button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-tela px-6 py-6 xl:px-10">
        {carteira.erro && <Aviso>{carteira.erro}</Aviso>}
        {carteira.carregando ? <Carregando /> : selecionado ? (
          <DetalheQuadro
            quadro={selecionado}
            pessoas={carteira.pessoas}
            aoVoltar={() => ir({ aba: 'quadros', quadroId: null })}
          />
        ) : (
          <>
            {aba === 'quadros' && (
              <ListaQuadros quadros={carteira.quadros} aoAbrir={abrirQuadro} recarregar={carteira.recarregar} />
            )}
            {aba === 'pessoas' && <Pessoas pessoas={carteira.pessoas} recarregar={carteira.recarregar} />}
          </>
        )}
      </main>

      <footer className="pb-8 text-center text-[11px] text-tinta-suave">
        Central de Estoque · Loja do Mecânico · versão {__VERSAO__}
      </footer>
    </div>
    </ContextoPermissoes.Provider>
  );
}
