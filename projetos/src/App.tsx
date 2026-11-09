import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Acesso from '@/paginas/Acesso';
import Painel from '@/paginas/Painel';
import ListaProjetos from '@/paginas/ListaProjetos';
import DetalheProjeto from '@/paginas/DetalheProjeto';
import Cronograma from '@/paginas/Cronograma';
import Pessoas from '@/paginas/Pessoas';
import Guia, { guiaJaVisto } from '@/componentes/Guia';
import ZoomCtrl from '@/componentes/ZoomCtrl';
import type { DestinoDoGuia } from '@/componentes/Guia';
import { Aviso, Carregando } from '@/componentes/ui';
import { useCarteira } from '@/estado/dados';
import { ContextoPermissoes, permissoesDe, sair, useSessao } from '@/estado/sessao';
import { ContextoSituacoes, useConfiguracao } from '@/estado/configuracao';
import { rotuloPapel } from '@/dominio/tipos';
import { escreverRota, lerRota } from '@/lib/rota';
import type { Aba, Rota } from '@/lib/rota';
import type { Projeto } from '@/dominio/tipos';

declare const __VERSAO__: string;

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: 'painel', rotulo: 'Painel' },
  { id: 'projetos', rotulo: 'Projetos' },
  { id: 'cronograma', rotulo: 'Cronograma' },
  { id: 'pessoas', rotulo: 'Pessoas' },
];

export default function App() {
  /* A posicao vive no endereco: atualizar a pagina tem de trazer de
     volta a mesma tela, e nao o painel. */
  const [rota, setRota] = useState(() => lerRota(window.location.hash));
  const [guiaAberto, setGuiaAberto] = useState(() => !guiaJaVisto());
  /* Onde a pessoa estava quando a visita comecou: ela anda pelas telas
     sozinha, e ao terminar tem de devolver o lugar. Na primeira visita,
     que abre sozinha, o lugar e por onde a pessoa entrou. */
  const rotaAntesDoGuia = useRef<Rota | null>(
    guiaJaVisto() ? null : lerRota(window.location.hash),
  );
  const sessao = useSessao();

  /* Voltar e avancar do navegador tambem mudam a tela. */
  useEffect(() => {
    const ouvir = () => setRota(lerRota(window.location.hash));
    window.addEventListener('hashchange', ouvir);
    return () => window.removeEventListener('hashchange', ouvir);
  }, []);

  const ir = useCallback((nova: Rota) => {
    /* Ir para onde ja se esta nao e navegacao: sem esta guarda, um
       desenho a toa vira outro desenho a toa. */
    setRota((atual) => (
      atual.aba === nova.aba && atual.projetoId === nova.projetoId ? atual : nova
    ));
    const endereco = escreverRota(nova);
    if (window.location.hash !== endereco) window.location.hash = endereco;
  }, []);

  const abrirProjeto = useCallback(
    (p: Projeto) => ir({ aba: 'projetos', projetoId: p.id }),
    [ir],
  );

  const fecharGuia = useCallback(() => {
    /* De volta para onde a pessoa estava antes de pedir a visita. */
    if (rotaAntesDoGuia.current) ir(rotaAntesDoGuia.current);
    rotaAntesDoGuia.current = null;
    setGuiaAberto(false);
  }, [ir]);
  /* Nada de dado antes de a sessao estar resolvida: consulta enviada sem
     token chega ao banco como visitante e volta recusada. */
  const pronto = !sessao.carregando && !!sessao.usuario;
  const carteira = useCarteira(pronto);
  const permissoes = useMemo(() => permissoesDe(sessao), [sessao]);
  const configuracao = useConfiguracao(pronto);

  /* O projeto aberto vem sempre da lista recarregada: guardar o objeto
     no estado deixaria a tela com dados velhos apos uma edicao. Quando o
     endereco aponta para um projeto que nao existe mais (link velho,
     item excluido), a tela cai na lista em vez de ficar em branco. */
  const selecionado = rota.projetoId
    ? carteira.projetos.find((p) => p.id === rota.projetoId) ?? null
    : null;
  const aba = rota.aba;

  if (sessao.carregando) return <Carregando />;
  if (!sessao.usuario) return <Acesso />;

  /* Logado sem cadastro ativo: o banco nao devolve nada para essa
     pessoa, entao a tela diz o motivo em vez de mostrar uma carteira
     vazia que pareceria defeito. */
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
    <ContextoSituacoes.Provider value={configuracao.situacoes}>
    <div className="min-h-screen">
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-tela flex-wrap items-center gap-5 px-6 py-5 xl:px-10">
          {/* O arquivo em brand/ tem 91 px de altura. Em 72 px a marca
              domina o cabecalho e ainda sobra pixel de origem; passar
              disso e esticar o PNG, que embaça. No celular cai para
              56 px para nao empurrar o titulo para a linha de baixo. */}
          <img
            src="./brand/Logo_LDM_hor_2_Branco.png" alt="Loja do Mecânico"
            width={188} height={72}
            className="h-14 w-auto drop-shadow-[0_2px_8px_rgba(0,0,0,.4)] sm:h-[72px]"
          />
          <span className="hidden h-12 w-px bg-white/20 sm:block" />
          <div className="mr-auto">
            <h1 className="font-titulo text-2xl font-extrabold leading-tight">Projetos</h1>
            <p className="text-[13px] text-white/60">CD Cajamar · acompanhamento de projetos e iniciativas</p>
          </div>
          <div className="text-right text-xs">
            <p className="font-bold text-white/90">{sessao.pessoa.nome}</p>
            <p className="text-white/50">{rotuloPapel[sessao.pessoa.papel]}</p>
            <div className="mt-1 flex gap-3 font-bold text-white/70">
              {/* O guia fica no alto, do lado direito: e onde se procura
                  ajuda, e nao atrapalha quem ja sabe usar. */}
              <button
                data-guia="botao-guia" className="hover:text-white"
                onClick={() => { rotaAntesDoGuia.current = rota; setGuiaAberto(true); }}
              >Guia</button>
              <a href="../" className="hover:text-white">← Central</a>
              <button className="hover:text-white" onClick={() => void sair()}>Sair</button>
            </div>
          </div>
        </div>
        <nav data-guia="abas" className="mx-auto flex max-w-tela gap-1 px-6 xl:px-10">
          {ABAS.map((a) => (
            <button
              key={a.id}
              onClick={() => ir({ aba: a.id, projetoId: null })}
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
          <DetalheProjeto
            projeto={selecionado}
            projetos={carteira.projetos}
            pessoas={carteira.pessoas}
            recarregarConfig={configuracao.recarregar}
            aoVoltar={() => ir({ aba: 'projetos', projetoId: null })}
            aoAbrir={abrirProjeto}
            recarregar={carteira.recarregar}
          />
        ) : (
          <>
            {aba === 'painel' && <Painel projetos={carteira.projetos} pessoas={carteira.pessoas} aoAbrir={abrirProjeto} />}
            {aba === 'projetos' && (
              <ListaProjetos
                projetos={carteira.projetos} pessoas={carteira.pessoas}
                aoAbrir={abrirProjeto} recarregar={carteira.recarregar}
              />
            )}
            {aba === 'cronograma' && <Cronograma projetos={carteira.projetos} aoAbrir={abrirProjeto} />}
            {aba === 'pessoas' && <Pessoas pessoas={carteira.pessoas} recarregar={carteira.recarregar} />}
          </>
        )}
      </main>

      <Guia
        aberto={guiaAberto}
        aoFechar={fecharGuia}
        aoNavegar={(destino: DestinoDoGuia) => {
          if (destino !== 'projeto') { ir({ aba: destino, projetoId: null }); return; }
          /* Passo que fala do que vive dentro de uma atividade: a visita
             abre uma de verdade. Projeto guarda-chuva nao serve, porque
             paginas, anexos e documento ficam nas atividades dele. */
          const exemplo = carteira.projetos.find((p) => p.projeto_pai_id)
            ?? carteira.projetos[0];
          if (exemplo) ir({ aba: 'projetos', projetoId: exemplo.id });
        }}
      />

      <footer className="pb-8 text-center text-[11px] text-tinta-suave">
        Central de Estoque · Loja do Mecânico · versão {__VERSAO__}
      </footer>

      <ZoomCtrl />
    </div>
    </ContextoSituacoes.Provider>
    </ContextoPermissoes.Provider>
  );
}
