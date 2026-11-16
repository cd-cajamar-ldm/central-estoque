import { useCallback, useEffect, useMemo, useState } from 'react';
import Acesso from '@/paginas/Acesso';
import ListaQuadros from '@/paginas/ListaQuadros';
import DetalheQuadro from '@/paginas/DetalheQuadro';
import Pessoas from '@/paginas/Pessoas';
import Sidebar from '@/componentes/Sidebar';
import ZoomCtrl from '@/componentes/ZoomCtrl';
import { Aviso, Carregando } from '@/componentes/ui';
import { useQuadros } from '@/estado/dados';
import { ContextoPermissoes, permissoesDe, sair, useSessao } from '@/estado/sessao';
import { rotuloPapel } from '@/dominio/tipos';
import { escreverRota, lerRota } from '@/lib/rota';
import type { Aba, Rota } from '@/lib/rota';
import type { Quadro } from '@/dominio/tipos';

declare const __VERSAO__: string;

const TITULOS: Record<Aba, { titulo: string; sub: string }> = {
  quadros: { titulo: 'Quadros', sub: 'Quadros de tarefas da equipe.' },
  pessoas: { titulo: 'Pessoas', sub: 'Cadastro e controle de acesso ao módulo.' },
};

export default function App() {
  /* A posicao vive no endereco: atualizar a pagina tem de trazer de
     volta a mesma tela, e nao a lista de quadros. */
  const [rota, setRota] = useState(() => lerRota(window.location.hash));
  const [mobileAberto, setMobileAberto] = useState(false);
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

  const { titulo, sub } = selecionado ? { titulo: selecionado.nome, sub: selecionado.descricao ?? '' } : TITULOS[aba];

  return (
    <ContextoPermissoes.Provider value={permissoes}>
    <div className="flex overflow-hidden bg-papel" style={{ height: 'calc(100vh / var(--zoom, 1))' }}>
      <Sidebar
        aba={aba} onNavigate={(a) => ir({ aba: a, quadroId: null })}
        mobileOpen={mobileAberto} onFecharMobile={() => setMobileAberto(false)}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Faixa do topo com foto de planejamento ao fundo e degrade azul da
            marca (igual ao painel do Inventario Rotativo): o titulo fica no
            azul solido a esquerda e os post-its aparecem a direita. */}
        <header
          className="flex shrink-0 items-center gap-4 border-b-[3px] border-laranja bg-marca bg-cover px-6 py-5"
          style={{
            backgroundImage: 'linear-gradient(90deg, rgba(0,18,82,.96) 0%, rgba(0,18,82,.85) 45%, rgba(0,18,82,.35) 100%), url(./fotos/projetos-faixa.jpg)',
            backgroundPosition: 'center 40%',
          }}
        >
          <button
            type="button" aria-label="Abrir menu" onClick={() => setMobileAberto(true)}
            className="shrink-0 p-1 text-white sm:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <div className="min-w-0">
            <h1 className="truncate font-titulo text-2xl font-extrabold leading-tight text-white">{titulo}</h1>
            {sub && <p className="mt-0.5 truncate text-sm text-[#DCE1F7]">{sub}</p>}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-3 text-right text-xs">
            <div>
              <p className="font-bold text-white">{sessao.pessoa.nome}</p>
              <p className="text-[#C9D0F2]">{rotuloPapel[sessao.pessoa.papel]}</p>
            </div>
            <button className="rounded-lg bg-white/10 px-2.5 py-1.5 font-bold text-white backdrop-blur-sm hover:bg-laranja" onClick={() => void sair()}>Sair</button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-6 py-6">
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

        <footer className="shrink-0 pb-4 text-center text-[11px] text-tinta-suave">
          Central de Estoque · Loja do Mecânico · versão {__VERSAO__}
        </footer>
      </div>

      <ZoomCtrl />
    </div>
    </ContextoPermissoes.Provider>
  );
}
