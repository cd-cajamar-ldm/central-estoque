/* ============================================================
   Shell da aplicacao, no mesmo formato do Inventario Rotativo:
   menu lateral azul recolhivel, barra de topo com titulo, busca
   global e selo de contexto, e area de rolagem para a pagina.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useDados, useAcoes } from './store/useDados';
import { Importar } from './pages/Importar';
import { DashboardGeral } from './pages/DashboardGeral';
import { StatusProjeto } from './pages/StatusProjeto';
import { Elevadores } from './pages/Elevadores';
import { FOTOS_PAIS } from './dados/fotosPais';
import { LOGO_HORIZONTAL } from './dados/logo';
import { Botao, Vazio } from './components/ui';

type Pagina = 'geral' | 'projeto' | 'elevadores' | 'importacao';

const PAGINAS: Record<Pagina, { titulo: string; subtitulo: string }> = {
  geral: {
    titulo: 'Dashboard Geral',
    subtitulo: 'O que comprar de base e de coluna, por conjunto.',
  },
  projeto: {
    titulo: 'Status do Projeto',
    subtitulo: 'Acompanhamento das ações do plano, no formato PMO.',
  },
  elevadores: {
    titulo: 'Elevadores',
    subtitulo: 'Os itens pai do projeto, com foto e situação do conjunto.',
  },
  importacao: {
    titulo: 'Importação',
    subtitulo: 'Carregue a planilha de equalização do CD.',
  },
};

function Icone({ nome }: { nome: Pagina | 'tema' | 'menu' | 'voltar' }) {
  const comum = {
    width: 15,
    height: 15,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
  } as const;
  if (nome === 'geral')
    return (
      <svg {...comum}>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    );
  if (nome === 'projeto')
    return (
      <svg {...comum}>
        <path d="M3 3v18h18" />
        <path d="M7 15l4-6 4 3 5-8" />
      </svg>
    );
  if (nome === 'elevadores')
    return (
      <svg {...comum}>
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <path d="M12 2v20" />
        <path d="M8 7l0 0" />
      </svg>
    );
  if (nome === 'importacao')
    return (
      <svg {...comum}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    );
  if (nome === 'menu')
    return (
      <svg {...comum} width={16} height={16}>
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    );
  /* Mesma seta que o Inventario usa para voltar a Central, para os
     dois apps falarem a mesma lingua. */
  if (nome === 'voltar')
    return (
      <svg {...comum} width={14} height={14} strokeLinecap="round" strokeLinejoin="round">
        <line x1="19" y1="12" x2="5" y2="12" />
        <polyline points="12 19 5 12 12 5" />
      </svg>
    );
  return (
    <svg {...comum} width={14} height={14}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

export default function App() {
  const {
    dados, historico, ajustes, carregando, erro,
    importar, carregarDemo, limpar, ajustarResponsavel, desfazerAjuste,
  } = useDados();
  const [pagina, setPagina] = useState<Pagina>('geral');
  const [recolhido, setRecolhido] = useState(false);
  /* Abre no claro. O escuro entra so quando a pessoa clica: seguir a
     preferencia do sistema fazia o painel abrir escuro em maquina
     configurada assim, sem ninguem ter pedido. */
  const [tema, setTema] = useState<'claro' | 'escuro'>('claro');
  const [busca, setBusca] = useState('');
  const [confirmarTroca, setConfirmarTroca] = useState(false);
  const [apresentando, setApresentando] = useState(false);
  /* Zoom da area de conteudo, no mesmo formato do Inventario Rotativo:
     serve para caber mais na tela ou aumentar para ler de longe. */
  const [zoom, setZoom] = useState(100);

  /* O zoom fica escrito no <html> para os graficos saberem dele.

     O canvas e imagem: o CSS zoom estica o que ja foi desenhado, e o
     resultado sai borrado enquanto o texto ao lado continua nitido. O
     Chart.js nao tem como perceber isso sozinho - a largura em pixels
     de layout nao muda - entao o wrapper Grafico observa este atributo
     e redesenha na resolucao certa. */
  useEffect(() => {
    document.documentElement.dataset.zoom = String(zoom);
  }, [zoom]);

  const hoje = useMemo(() => new Date(), []);
  const acoes = useAcoes(dados?.acoes, hoje);

  /* As fotos ja vem embutidas por codigo do item pai; o que for importado
     do DE_PARA_LINK_FOTO entra por cima, para atualizar ou cobrir itens
     novos sem precisar mexer no codigo. */
  const fotos = useMemo(() => {
    const m = new Map<string, string>(Object.entries(FOTOS_PAIS));
    for (const [item, url] of dados?.fotos ?? []) m.set(String(item), url);
    return m;
  }, [dados]);

  /* Preco de custo do item pai (SIGEQ278), importado a parte. Mapa
     vazio quando nao foi importado: o dashboard mostra R$ 0 parado,
     nunca quebra por falta do arquivo. */
  const precos = useMemo(
    () => new Map<string, number>(dados?.precos ?? []),
    [dados]
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tema === 'escuro' ? 'dark' : 'light');
  }, [tema]);

  /* O app abre na importacao quando ainda nao ha dados. Os dados de
     exemplo so entram quando pedidos, pela URL (?exemplo=1) ou pelo
     botao da propria tela. */
  useEffect(() => {
    if (carregando || dados) return;
    if (new URLSearchParams(window.location.search).has('exemplo')) void carregarDemo();
  }, [carregando, dados, carregarDemo]);

  /* Modo apresentacao: esconde menu, filtros e controles, aumenta o
     texto e ocupa a tela toda. Serve para projetar o status em reuniao
     sem precisar de print nem de slide. */
  useEffect(() => {
    document.documentElement.classList.toggle('apresentando', apresentando);
    if (!apresentando) return;

    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setApresentando(false);
    };
    /* Sair pelo Esc do proprio navegador tambem precisa desligar o modo. */
    const aoTrocarTela = () => {
      if (!document.fullscreenElement) setApresentando(false);
    };
    window.addEventListener('keydown', aoTeclar);
    document.addEventListener('fullscreenchange', aoTrocarTela);
    return () => {
      window.removeEventListener('keydown', aoTeclar);
      document.removeEventListener('fullscreenchange', aoTrocarTela);
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    };
  }, [apresentando]);

  function alternarTema() {
    setTema(tema === 'escuro' ? 'claro' : 'escuro');
  }

  const semDados = !dados;
  const paginaAtual: Pagina = semDados ? 'importacao' : pagina;
  const cabecalho = PAGINAS[paginaAtual];

  /* Ir para a importacao descarta a planilha que esta em uso, entao
     pede confirmacao: e facil clicar no item do menu so para rever a
     tela e perder o que ja foi importado. */
  function irPara(p: Pagina) {
    if (p === 'importacao') {
      setConfirmarTroca(true);
      return;
    }
    setPagina(p);
  }

  function trocarPlanilha() {
    setConfirmarTroca(false);
    setPagina('geral');
    void limpar();
  }

  const itens: { id: Pagina; rotulo: string; secao?: string }[] = [
    { id: 'geral', rotulo: 'Dashboard Geral', secao: 'Visão geral' },
    { id: 'projeto', rotulo: 'Status do Projeto' },
    { id: 'elevadores', rotulo: 'Elevadores', secao: 'Operação' },
    { id: 'importacao', rotulo: 'Importação', secao: 'Sistema' },
  ];

  return (
    <div className="shell">
      <aside className={`sidebar ${recolhido ? 'collapsed' : ''}`}>
        <div className="brand">
          <div className="brand-logo-chip">
            <img src={LOGO_HORIZONTAL} alt="Loja do Mecânico" className="brand-logo-img" />
          </div>
          <button
            className="sidebar-toggle"
            onClick={() => setRecolhido((v) => !v)}
            title={recolhido ? 'Expandir menu' : 'Recolher menu'}
            aria-label={recolhido ? 'Expandir menu' : 'Recolher menu'}
            aria-expanded={!recolhido}
          >
            <Icone nome="menu" />
          </button>
        </div>

        {/* Nome do sistema abaixo do logo: com a marca maior nao sobra
            largura para os dois na mesma linha. */}
        <div className="eq-marca-nome">
          <strong>Equalização de Elevadores</strong>
          <span>CD Cajamar</span>
        </div>

        <nav className="sidebar-nav">
          {itens.map((it) => (
            <div key={it.id}>
              {it.secao && <div className="nav-section-label">{it.secao}</div>}
              <button
                className={`nav-item ${paginaAtual === it.id ? 'active' : ''}`}
                onClick={() => irPara(it.id)}
                disabled={semDados && it.id !== 'importacao'}
                style={semDados && it.id !== 'importacao' ? { opacity: 0.35 } : undefined}
                title={it.rotulo}
              >
                <Icone nome={it.id} />
                <span>{it.rotulo}</span>
              </button>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          {/* Volta para a Central, no mesmo lugar em que o Inventario
              coloca a dele: rodape do menu, acima do tema.

              O link existia so no index.html gerado, onde qualquer
              publicacao apagava. Aqui ele nasce do codigo e sobrevive
              ao build - e sai do canto superior direito, onde ficava
              por cima do selo de contexto. */}
          <a className="theme-toggle" href="../" title="Voltar para a Central">
            <Icone nome="voltar" />
            <span>Voltar para a Central</span>
          </a>
          {/* Com o menu recolhido sobra so o icone: o title e o que diz
              para que serve o botao. */}
          <button className="theme-toggle" onClick={alternarTema} title="Alternar tema">
            <Icone nome="tema" />
            <span>Alternar tema</span>
          </button>
          {/* Carimbo do build: e por ele que se sabe, sem abrir o
              inspetor, se o navegador esta servindo a versao nova ou
              uma guardada em cache. */}
          <div className="eq-versao" title={`Versão publicada: ${__VERSAO__}`}>
            {__VERSAO__}
          </div>
        </div>
      </aside>

      <main className="content">
        <div className="topbar">
          <div>
            <h1>{cabecalho.titulo}</h1>
            <p>{cabecalho.subtitulo}</p>
          </div>

          {dados && paginaAtual !== 'importacao' && (
            <input
              className="global-search"
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Pesquisa global (item, marca, fabricante)..."
              aria-label="Pesquisa global"
            />
          )}

          {dados && (
            <button
              className="btn btn-orange"
              onClick={() => setApresentando(true)}
              title="Tela cheia, sem menu nem filtros, para projetar em reunião"
            >
              Apresentar
            </button>
          )}

          {dados && (
            <div className="cycle-badge">
              {dados.demonstracao
                ? 'Dados de exemplo'
                : `${dados.arquivo}${dados.semPersistencia ? ' · só nesta sessão' : ''}`}
            </div>
          )}
        </div>

        {/* Na apresentacao o menu sai de cena e a marca iria junto, entao
            a identificacao volta como faixa no topo da projecao. */}
        {apresentando && (
          <div className="eq-marca-apresentacao">
            <img src={LOGO_HORIZONTAL} alt="Loja do Mecânico" />
            <div>
              <strong>{cabecalho.titulo}</strong>
              <span>Equalização de Elevadores · CD Cajamar</span>
            </div>
            <time>{new Date().toLocaleDateString('pt-BR')}</time>
          </div>
        )}

        {/* zoom amplia a tela inteira: caixas, tabelas e graficos, nao so
            o texto que usa medida relativa. */}
        <div className="page-scroll" style={{ zoom: `${zoom}%` }}>
          {carregando ? (
            <Vazio icone="⏳">Carregando dados salvos…</Vazio>
          ) : !dados ? (
            <Importar aoImportar={importar} aoVerExemplo={carregarDemo} erro={erro} />
          ) : paginaAtual === 'geral' ? (
            <DashboardGeral
              componentes={dados.componentes}
              fotos={fotos}
              precos={precos}
              busca={busca}
              divergencias={dados.divergencias}
              ajustes={ajustes}
              aoAjustar={(a) => void ajustarResponsavel(a)}
              aoDesfazer={(c) => void desfazerAjuste(c)}
            />
          ) : paginaAtual === 'projeto' ? (
            <StatusProjeto
              acoes={acoes}
              hoje={hoje}
              busca={busca}
              historico={historico}
              demonstracao={!!dados?.demonstracao}
              componentes={dados.componentes}
              divergencias={dados.divergencias}
              ajustes={ajustes}
            />
          ) : (
            <Elevadores componentes={dados.componentes} fotos={fotos} busca={busca} />
          )}
        </div>
      </main>

      {/* Fica flutuando no canto para nao empurrar o conteudo e continua
          ao alcance depois de rolar o painel inteiro. */}
      {dados && (
        <div className="zoom-ctrl zoom-ctrl-float">
          <button onClick={() => setZoom((z) => Math.max(60, z - 10))} title="Diminuir" aria-label="Diminuir a tela">
            −
          </button>
          <span>{zoom}%</span>
          <button onClick={() => setZoom((z) => Math.min(160, z + 10))} title="Aumentar" aria-label="Aumentar a tela">
            +
          </button>
          <button onClick={() => setZoom(100)} title="Voltar ao tamanho normal" aria-label="Tamanho normal" className="zoom-reset">
            ⤾
          </button>
        </div>
      )}

      {apresentando && (
        <button className="eq-sair-apresentacao" onClick={() => setApresentando(false)}>
          Sair da apresentação (Esc)
        </button>
      )}

      {confirmarTroca && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="tituloTroca"
          className="eq-modal-fundo"
          onClick={() => setConfirmarTroca(false)}
        >
          <div className="eq-modal" onClick={(e) => e.stopPropagation()}>
            <h3 id="tituloTroca">Importar outra planilha?</h3>
            <p>
              Os dados de <strong>{dados?.arquivo}</strong> saem da tela e você precisa escolher o
              arquivo de novo. A planilha no seu computador não é alterada.
            </p>
            <div className="eq-modal-acoes">
              <Botao aoClicar={() => setConfirmarTroca(false)}>Cancelar</Botao>
              <Botao variante="laranja" aoClicar={trocarPlanilha}>
                Importar outra
              </Botao>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
