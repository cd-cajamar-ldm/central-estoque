import { useEffect, useRef, useState } from 'react';
import {
  bordaMaisProxima, CORES_DO_FLUXO, ESPESSURAS, escreverFluxo, espessuraDo, fluxoVazio, lerFluxo,
  alinharNos, limitesDoFluxo, noDeImagem, noNovo, proximaPosicao, proximoZoom, rotuloDaForma,
  rotuloDoAlinhamento, ZOOM_PADRAO, ZOOMS, zoomValido,
} from '@/dominio/fluxo';
import { imagemDoEvento, reduzirImagem } from '@/lib/imagemColada';
import type { Alinhamento, Fluxo, FormaDoNo, NoDoFluxo } from '@/dominio/fluxo';

interface Props {
  conteudo: string;
  editando: boolean;
  aoMudar: (conteudo: string) => void;
}

const FORMAS: FormaDoNo[] = ['inicio', 'caixa', 'decisao', 'circulo', 'triangulo', 'nota'];

/* Desenhinho de cada alinhamento no botao: a barra e estreita, e o nome
   por extenso ("Centralizar na vertical") so cabe no title. E um desenho,
   e nao uma seta de texto (⇤, ⤒), porque as setas sao quase iguais entre
   si em fonte pequena — aqui a linha de referencia e as duas barras
   mostram para onde os blocos vao. */
function IconeAlinhar({ como }: { como: Alinhamento }) {
  /* Duas barras de tamanhos diferentes, para dar para ver que elas se
     movem ate a guia, e a guia na posicao do alinhamento. */
  const barras: Record<Alinhamento, { x: number; y: number; w: number; h: number }[]> = {
    esquerda: [{ x: 4, y: 3, w: 9, h: 3 }, { x: 4, y: 9, w: 6, h: 3 }],
    direita: [{ x: 3, y: 3, w: 9, h: 3 }, { x: 6, y: 9, w: 6, h: 3 }],
    centro: [{ x: 3.5, y: 3, w: 9, h: 3 }, { x: 5, y: 9, w: 6, h: 3 }],
    topo: [{ x: 3, y: 4, w: 3, h: 9 }, { x: 9, y: 4, w: 3, h: 6 }],
    base: [{ x: 3, y: 3, w: 3, h: 9 }, { x: 9, y: 6, w: 3, h: 6 }],
    meio: [{ x: 3, y: 3.5, w: 3, h: 9 }, { x: 9, y: 5, w: 3, h: 6 }],
  };
  const guia: Record<Alinhamento, [number, number, number, number]> = {
    esquerda: [3, 1, 3, 14], direita: [12, 1, 12, 14], centro: [7.5, 1, 7.5, 14],
    topo: [1, 3, 14, 3], base: [1, 12, 14, 12], meio: [1, 7.5, 14, 7.5],
  };
  const [x1, y1, x2, y2] = guia[como];
  return (
    <svg viewBox="0 0 15 15" className="h-3.5 w-3.5" aria-hidden="true">
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="1" strokeDasharray="2 1.5" />
      {barras[como].map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx="1" fill="currentColor" opacity={0.75} />
      ))}
    </svg>
  );
}

/* Quadro de fluxo com blocos que se arrastam e setas que os ligam, no
   espirito do Miro. Usa mouse e SVG direto, sem biblioteca de diagrama:
   o que a operacao desenha aqui sao caixas, losangos e setas, e isso
   cabe em algumas dezenas de linhas.

   O conteudo antigo era o codigo de um diagrama escrito em texto; ele
   continua legivel na tela, com um botao para comecar o quadro novo, em
   vez de sumir com o que ja estava escrito. */
export default function Fluxograma({ conteudo, editando, aoMudar }: Props) {
  const [fluxo, setFluxo] = useState<Fluxo>(() => lerFluxo(conteudo) ?? fluxoVazio());
  /* Selecao de varios blocos: Shift+clique junta, Ctrl+A pega todos.
     Sem isso nao ha o que alinhar — alinhar e uma operacao entre blocos,
     e ate agora so um bloco por vez podia estar selecionado. */
  const [selecionados, setSelecionados] = useState<string[]>([]);
  /* A barra de propriedades (texto, cor, giro) fala com um bloco so: com
     dois selecionados, o que aparece sao os botoes de alinhar. */
  const selecionado = selecionados.length === 1 ? selecionados[0] : null;
  const [ligandoDe, setLigandoDe] = useState<string | null>(null);
  /* A seta tambem se seleciona: sem isso, o Delete do teclado nao teria
     como saber que e ela que deve sair. */
  const [ligacaoSelecionada, setLigacaoSelecionada] = useState<string | null>(null);
  /* O arrasto so comeca depois de alguns pixels de movimento. Sem essa
     folga, um clique simples ja empurrava o bloco para o encaixe de 10
     em 10 px: o ponteiro terminava fora dele, o navegador mandava o
     clique para o fundo do quadro e a selecao se perdia no ato. */
  const FOLGA = 4;
  const arrastando = useRef<
    {
      id: string; grupo: string[]; dx: number; dy: number; x: number; y: number;
      moveu: boolean;
      /* Clique num bloco do grupo sem arrastar escolhe so ele. A troca
         nao pode ser no mousedown: ali ainda nao se sabe se o gesto e um
         clique ou o comeco de um arrasto do grupo inteiro. */
      colapsar: boolean;
    } | null
  >(null);
  /* Puxar o canto muda o tamanho; e o gesto que se espera de um quadro
     assim, e evita ficar clicando em + e − para chegar ao tamanho certo. */
  const esticando = useRef<{ id: string; x: number; y: number; largura: number; altura: number } | null>(null);
  /* Um clique que comeca no bloco e termina um pixel fora dele chega ao
     fundo do quadro como clique do fundo. Sem saber onde o gesto
     comecou, isso limpava a selecao que o proprio clique acabara de
     fazer. */
  const comecouNoFundo = useRef(false);
  /* O desenho como estava quando o arrasto comecou: e ele que volta no
     Ctrl+Z, e nao cada passo intermediario do gesto. */
  const antesDoGesto = useRef<Fluxo | null>(null);
  const tela = useRef<HTMLDivElement>(null);
  /* O quadro inteiro (barra + prancheta): e por ele que o teclado sabe se
     o Ctrl+Z e deste fluxograma e nao de outro na mesma pagina. */
  const quadro = useRef<HTMLDivElement>(null);
  /* A janela que rola em volta da prancheta: e nela que mora o zoom pela
     roda do mouse. */
  const janela = useRef<HTMLDivElement>(null);
  const [avisoDaImagem, setAvisoDaImagem] = useState<string | null>(null);

  /* Zoom do quadro.

     Antes estes botoes mexiam no tamanho da prancheta: o numero na barra
     crescia, o desenho continuava do mesmo tamanho e ninguem entendia o
     que tinha mudado. Aqui eles aproximam e afastam de verdade — o fluxo
     inteiro numa tela para achar o caminho, e de perto para escrever. O
     desenho nao muda, so a lente. A escolha fica no navegador porque e de
     quem esta olhando, nao parte do fluxo. */
  const [zoom, setZoom] = useState(() => {
    const guardado = Number(localStorage.getItem('projetos.zoom-fluxo'));
    return zoomValido(guardado) ? guardado : ZOOM_PADRAO;
  });

  function aplicarZoom(valor: number) {
    setZoom(valor);
    try { localStorage.setItem('projetos.zoom-fluxo', String(valor)); } catch { /* sem espaço: só não lembra */ }
  }

  const mudarZoom = (direcao: 1 | -1) => aplicarZoom(proximoZoom(zoom, direcao));

  /* Cor com que a proxima forma nasce. A equipe desenha sempre com as
     mesmas poucas cores (roxo o caminho, vermelho o problema, verde o que
     ja roda); escolher uma vez e sair criando evita repintar bloco a
     bloco depois. */
  const [corNova, setCorNova] = useState(() => {
    const guardada = localStorage.getItem('projetos.cor-fluxo');
    return CORES_DO_FLUXO.some((c) => c.valor === guardada) ? (guardada as string) : CORES_DO_FLUXO[0].valor;
  });

  function escolherCorNova(valor: string) {
    setCorNova(valor);
    try { localStorage.setItem('projetos.cor-fluxo', valor); } catch { /* sem espaço: só não lembra */ }
  }

  /* Desfazer e refazer.

     Tudo aqui se faz com a mao: um arrasto sem querer, um bloco excluido,
     uma cor trocada. Sem Ctrl+Z, o unico caminho de volta era o historico
     de versoes da pagina — que so existe depois de salvar. O limite de 50
     passos guarda o suficiente para uma sessao de desenho sem encher a
     memoria com copias do fluxo. */
  const LIMITE_DO_HISTORICO = 50;
  const [passado, setPassado] = useState<Fluxo[]>([]);
  const [futuro, setFuturo] = useState<Fluxo[]>([]);

  function lembrar(anterior: Fluxo) {
    setPassado((p) => [...p, anterior].slice(-LIMITE_DO_HISTORICO));
    setFuturo([]);
  }

  function desfazer() {
    if (!passado.length) return;
    const anterior = passado[passado.length - 1];
    setPassado(passado.slice(0, -1));
    setFuturo([...futuro, fluxo].slice(-LIMITE_DO_HISTORICO));
    setFluxo(anterior);
    aoMudar(escreverFluxo(anterior));
  }

  function refazer() {
    if (!futuro.length) return;
    const proximo = futuro[futuro.length - 1];
    setFuturo(futuro.slice(0, -1));
    setPassado([...passado, fluxo].slice(-LIMITE_DO_HISTORICO));
    setFluxo(proximo);
    aoMudar(escreverFluxo(proximo));
  }

  const legado = lerFluxo(conteudo) === null && conteudo.trim() !== '';

  /* Conteudo vindo de fora (troca de pagina, restauracao de versao)
     substitui o desenho; o que o proprio editor grava nao volta por
     aqui, senao o bloco piscaria a cada arrastada. */
  useEffect(() => {
    const lido = lerFluxo(conteudo);
    if (lido && escreverFluxo(lido) !== escreverFluxo(fluxo)) {
      setFluxo(lido);
      /* Outro desenho, outra historia: desfazer aqui devolveria o fluxo de
         outra pagina por cima desta. */
      setPassado([]);
      setFuturo([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conteudo]);

  function gravar(novo: Fluxo) {
    lembrar(fluxo);
    setFluxo(novo);
    aoMudar(escreverFluxo(novo));
  }

  function adicionar(forma: FormaDoNo) {
    const posicao = proximaPosicao(fluxo);
    const no = noNovo(forma, posicao.x, posicao.y, corNova);
    gravar({ ...fluxo, nos: [...fluxo.nos, no] });
    setSelecionados([no.id]);
  }

  function alterarNo(id: string, mudanca: Partial<NoDoFluxo>) {
    gravar({ ...fluxo, nos: fluxo.nos.map((n) => (n.id === id ? { ...n, ...mudanca } : n)) });
  }

  function removerNos(ids: string[]) {
    gravar({
      nos: fluxo.nos.filter((n) => !ids.includes(n.id)),
      /* Seta sem uma das pontas nao existe: some junto com o bloco. */
      ligacoes: fluxo.ligacoes.filter((l) => !ids.includes(l.de) && !ids.includes(l.para)),
    });
    setSelecionados([]);
  }

  /* Shift+clique junta e tira da selecao; clique simples recomeca dela.
     E o gesto de qualquer ferramenta de desenho, e o unico jeito de
     escolher a mao os blocos que se quer alinhar. */
  function escolher(id: string, juntando: boolean) {
    setSelecionados((atual) => {
      if (!juntando) return [id];
      return atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id];
    });
    setLigacaoSelecionada(null);
  }

  /* As setas do teclado empurram tudo o que esta selecionado junto: com
     dois blocos escolhidos, mover so um desfaria o que se acabou de
     alinhar. */
  function empurrar(dx: number, dy: number) {
    gravar({
      ...fluxo,
      nos: fluxo.nos.map((n) => (selecionados.includes(n.id)
        ? { ...n, x: Math.max(0, n.x + dx), y: Math.max(0, n.y + dy) }
        : n)),
    });
  }

  function alinhar(como: Alinhamento) {
    gravar({ ...fluxo, nos: alinharNos(fluxo.nos, selecionados, como) });
  }

  function ligar(paraId: string) {
    if (!ligandoDe || ligandoDe === paraId) { setLigandoDe(null); return; }
    const repetida = fluxo.ligacoes.some((l) => l.de === ligandoDe && l.para === paraId);
    if (!repetida) {
      gravar({
        ...fluxo,
        ligacoes: [...fluxo.ligacoes, { id: crypto.randomUUID(), de: ligandoDe, para: paraId, rotulo: '' }],
      });
    }
    setLigandoDe(null);
  }

  /* Colar print direto no quadro. Sem botao e sem anexo: copia-se a
     tela do coletor e cola-se aqui, que e como a pessoa ja trabalha.
     A imagem entra reduzida, como um bloco que se arrasta e se liga
     como qualquer outro. */
  async function colar(evento: React.ClipboardEvent) {
    if (!editando) return;
    const arquivo = imagemDoEvento(evento);
    if (!arquivo) return;
    evento.preventDefault();
    setAvisoDaImagem(null);
    try {
      const reduzida = await reduzirImagem(arquivo);
      const posicao = proximaPosicao(fluxo);
      const no = noDeImagem(reduzida.dados, reduzida.largura, reduzida.altura, posicao.x, posicao.y);
      gravar({ ...fluxo, nos: [...fluxo.nos, no] });
      setSelecionados([no.id]);
    } catch (falha) {
      setAvisoDaImagem(falha instanceof Error ? falha.message : 'Não consegui colar esta imagem.');
    }
  }

  /* Mudar o tamanho sem mexer na proporcao, que e o que se quer tanto
     para encaixar um print quanto para dar espaco a um texto maior. */
  function redimensionar(no: NoDoFluxo, fator: number) {
    const largura = Math.round(Math.min(900, Math.max(60, no.largura * fator)));
    const altura = Math.round(Math.min(700, Math.max(30, (no.altura * largura) / no.largura)));
    alterarNo(no.id, { largura, altura });
  }

  /* O giro fica entre 0 e 359 para o rotulo do botao nao virar "-45°"
     nem "375°". */
  function girar(no: NoDoFluxo, graus: number) {
    alterarNo(no.id, { rotacao: (((no.rotacao ?? 0) + graus) % 360 + 360) % 360 });
  }

  /* Teclado: setas empurram o bloco selecionado de 10 em 10 px, que e o
     encaixe da grade, e com Shift de 1 em 1 para o ajuste fino. Delete
     apaga o que estiver selecionado, bloco ou seta. Ctrl+Z e Ctrl+Y (ou
     Ctrl+Shift+Z, como no resto do mundo) andam no historico. */
  function aoTeclar(e: KeyboardEvent) {
    if (!editando) return;
    /* Quem esta digitando num campo tem prioridade: apagar letra e mover
       o cursor nao podem virar comando do quadro. */
    const alvo = e.target as HTMLElement | null;
    const escrevendo = !!alvo && (
      alvo.isContentEditable
      || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName)
    );
    if (escrevendo) return;

    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const tecla = e.key.toLowerCase();
      if (tecla === 'z' && !e.shiftKey) { e.preventDefault(); desfazer(); return; }
      if (tecla === 'y' || (tecla === 'z' && e.shiftKey)) { e.preventDefault(); refazer(); return; }
      if (tecla === 'a') {
        e.preventDefault();
        setSelecionados(fluxo.nos.map((n) => n.id));
        setLigacaoSelecionada(null);
        return;
      }
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (ligacaoSelecionada) {
        e.preventDefault();
        gravar({ ...fluxo, ligacoes: fluxo.ligacoes.filter((l) => l.id !== ligacaoSelecionada) });
        setLigacaoSelecionada(null);
        return;
      }
      if (selecionados.length) {
        e.preventDefault();
        removerNos(selecionados);
      }
      return;
    }

    if (e.key === 'Escape') { setSelecionados([]); setLigacaoSelecionada(null); setLigandoDe(null); return; }

    const passos: Record<string, [number, number]> = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    };
    const passo = passos[e.key];
    if (!passo || !selecionados.length) return;
    e.preventDefault();
    const distancia = e.shiftKey ? 1 : 10;
    empurrar(passo[0] * distancia, passo[1] * distancia);
  }

  /* O ouvinte fica na janela, e nao no quadro: depois de clicar num
     botao da barra o foco esta nele, e as setas nao chegariam ao
     desenho. So age quando ha algo selecionado neste quadro — ou, para o
     Ctrl+Z, quando o foco esta dentro deste quadro: desfazer costuma vir
     logo depois de excluir um bloco, quando ja nao ha selecao nenhuma. */
  useEffect(() => {
    if (!editando) return;
    const ouvir = (e: KeyboardEvent) => {
      const meu = selecionados.length || ligacaoSelecionada
        || (!!quadro.current && quadro.current.contains(document.activeElement));
      if (meu) aoTeclar(e);
    };
    window.addEventListener('keydown', ouvir);
    return () => window.removeEventListener('keydown', ouvir);
  });

  /* Ctrl + roda do mouse aproxima e afasta, como em qualquer mapa ou
     prancheta; sem o Ctrl a roda continua rolando a pagina.

     O ouvinte e posto na mao, e nao pelo onWheel do React, porque so
     assim ele nao e passivo: passivo, o preventDefault nao vale e o Ctrl
     +roda acabaria dando zoom na pagina inteira do navegador. */
  useEffect(() => {
    const area = janela.current;
    if (!area) return;
    const rodar = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      mudarZoom(e.deltaY < 0 ? 1 : -1);
    };
    area.addEventListener('wheel', rodar, { passive: false });
    return () => area.removeEventListener('wheel', rodar);
  });

  function comecarArrasto(e: React.MouseEvent, no: NoDoFluxo) {
    if (!editando) return;
    const area = tela.current?.getBoundingClientRect();
    if (!area) return;
    /* Com o quadro afastado, um pixel de tela vale mais de um pixel de
       desenho: sem dividir pelo zoom o bloco fugiria do ponteiro. */
    antesDoGesto.current = fluxo;
    /* Arrastar um bloco que ja faz parte da selecao leva o grupo inteiro
       junto; arrastar um de fora dela recomeca a selecao nele. */
    const grupo = selecionados.includes(no.id) ? selecionados : [no.id];
    arrastando.current = {
      id: no.id,
      grupo,
      dx: (e.clientX - area.left) / zoom - no.x,
      dy: (e.clientY - area.top) / zoom - no.y,
      x: e.clientX,
      y: e.clientY,
      moveu: false,
      colapsar: !e.shiftKey && selecionados.length > 1 && selecionados.includes(no.id),
    };
    /* A selecao se resolve aqui, no mousedown, e nao no clique: o clique
       chegaria depois e desfaria o Shift que acabou de juntar o bloco.
       Bloco ja selecionado e clicado sem Shift nao mexe na selecao, para
       o arrasto levar o grupo inteiro. */
    if (e.shiftKey) escolher(no.id, true);
    else if (!selecionados.includes(no.id)) escolher(no.id, false);
    setLigacaoSelecionada(null);
    /* Sem foco no quadro, as setas do teclado rolariam a pagina em vez
       de mover o bloco. */
    tela.current?.focus({ preventScroll: true });
  }

  function moverArrasto(e: React.MouseEvent) {
    const puxando = esticando.current;
    if (puxando) {
      const largura = Math.round(Math.min(900, Math.max(60, puxando.largura + (e.clientX - puxando.x) / zoom)));
      const altura = Math.round(Math.min(700, Math.max(30, puxando.altura + (e.clientY - puxando.y) / zoom)));
      setFluxo((f) => ({
        ...f,
        nos: f.nos.map((n) => (n.id === puxando.id ? { ...n, largura, altura } : n)),
      }));
      return;
    }

    const atual = arrastando.current;
    const area = tela.current?.getBoundingClientRect();
    if (!atual || !area) return;
    if (!atual.moveu) {
      if (Math.abs(e.clientX - atual.x) < FOLGA && Math.abs(e.clientY - atual.y) < FOLGA) return;
      atual.moveu = true;
    }
    const x = Math.max(0, (e.clientX - area.left) / zoom - atual.dx);
    const y = Math.max(0, (e.clientY - area.top) / zoom - atual.dy);
    /* Encaixe de 10 em 10 px: alinha os blocos sem precisar de mira. */
    setFluxo((f) => {
      const puxado = f.nos.find((n) => n.id === atual.id);
      if (!puxado) return f;
      /* O grupo anda pelo deslocamento do bloco que esta sob o ponteiro:
         assim as distancias entre eles nao mudam no caminho. */
      const dx = Math.round(x / 10) * 10 - puxado.x;
      const dy = Math.round(y / 10) * 10 - puxado.y;
      if (!dx && !dy) return f;
      return {
        ...f,
        nos: f.nos.map((n) => (atual.grupo.includes(n.id)
          ? { ...n, x: Math.max(0, n.x + dx), y: Math.max(0, n.y + dy) }
          : n)),
      };
    });
  }

  function terminarArrasto() {
    const mexeu = arrastando.current?.moveu || !!esticando.current;
    const colapsarEm = !mexeu && arrastando.current?.colapsar ? arrastando.current.id : null;
    if (colapsarEm) setSelecionados([colapsarEm]);
    const antes = antesDoGesto.current;
    arrastando.current = null;
    esticando.current = null;
    antesDoGesto.current = null;
    /* Clique sem arrasto nao mudou desenho nenhum: gravar aqui marcaria
       a pagina como alterada so por alguem ter selecionado um bloco. */
    if (!mexeu) return;
    /* O gesto inteiro e um passo so no historico: o arrasto passa por
       dezenas de posicoes, e desfazer uma a uma seria inutil. */
    if (antes) lembrar(antes);
    aoMudar(escreverFluxo(fluxo));
  }

  const medida = limitesDoFluxo(fluxo);
  /* Uma folga fixa em volta do desenho: sem chao sobrando nao da para
     arrastar um bloco para fora do aglomerado. A altura cresce menos que
     a largura, porque o fluxo se espalha mais para os lados e altura
     demais so gera rolagem vazia. */
  const largura = medida.largura + 400;
  const altura = medida.altura + 240;
  const noSelecionado = fluxo.nos.find((n) => n.id === selecionado) ?? null;

  if (legado) {
    return (
      <div className="rounded-xl border border-linha bg-white p-3">
        <p className="mb-2 text-xs text-tinta-suave">
          Este fluxo foi escrito no formato antigo, em texto. O conteúdo está preservado abaixo.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-papel p-3 text-xs">{conteudo}</pre>
        {editando && (
          <button
            className="botao-primario mt-3 py-1 text-xs"
            onClick={() => gravar(fluxoVazio())}
          >Começar o quadro novo</button>
        )}
      </div>
    );
  }

  return (
    <div ref={quadro} className="rounded-xl border border-linha bg-white">
      {editando && (
        <div className="flex flex-wrap items-center gap-2 border-b border-linha px-3 py-2">
          {FORMAS.map((forma) => (
            <button
              key={forma}
              className="rounded-lg border border-linha px-2 py-1 text-[11px] font-bold text-tinta-suave hover:border-roxo hover:text-roxo-escuro"
              onClick={() => adicionar(forma)}
            >+ {rotuloDaForma[forma]}</button>
          ))}

          <span className="mx-1 h-4 w-px bg-linha" />

          {/* Cor com que a proxima forma nasce. Fica junto dos botoes de
              forma porque e a mesma decisao: que bloco criar, e de que cor. */}
          <span className="flex items-center gap-1" title="Cor das novas formas">
            {CORES_DO_FLUXO.map((c) => (
              <button
                key={c.valor}
                title={`Novas formas em ${c.nome.toLowerCase()}`}
                onClick={() => escolherCorNova(c.valor)}
                className={`h-5 w-5 rounded-full border-2 ${
                  corNova === c.valor ? 'border-navy' : 'border-white'
                }`}
                style={{ backgroundColor: c.valor }}
              />
            ))}
          </span>

          <span className="mx-1 h-4 w-px bg-linha" />

          {/* Zoom: aproxima e afasta o desenho inteiro, para caber na tela
              ou para escrever de perto. Ctrl + roda do mouse faz o mesmo. */}
          <span className="flex items-center gap-1" title="Zoom (Ctrl + roda do mouse)">
            <button
              className="rounded-lg border border-linha px-2 py-1 text-[11px] font-bold text-tinta-suave hover:border-roxo hover:text-roxo-escuro"
              onClick={() => mudarZoom(-1)} disabled={zoom === ZOOMS[0]}
              title="Afastar"
            >−</button>
            <button
              className="rounded-lg px-1 text-[11px] font-bold text-tinta-suave hover:text-roxo-escuro"
              onClick={() => aplicarZoom(ZOOM_PADRAO)} title="Voltar a 100%"
            >{Math.round(zoom * 100)}%</button>
            <button
              className="rounded-lg border border-linha px-2 py-1 text-[11px] font-bold text-tinta-suave hover:border-roxo hover:text-roxo-escuro"
              onClick={() => mudarZoom(1)} disabled={zoom === ZOOMS[ZOOMS.length - 1]}
              title="Aproximar"
            >+</button>
          </span>

          <span className="mx-1 h-4 w-px bg-linha" />

          {/* Desfazer e refazer tambem em botao: quem desenha com o mouse
              nao larga dele para procurar o atalho. */}
          <span className="flex items-center gap-1">
            <button
              className="rounded-lg border border-linha px-2 py-1 text-[11px] font-bold text-tinta-suave hover:border-roxo hover:text-roxo-escuro disabled:opacity-40"
              onClick={desfazer} disabled={!passado.length} title="Desfazer (Ctrl+Z)"
            >↶</button>
            <button
              className="rounded-lg border border-linha px-2 py-1 text-[11px] font-bold text-tinta-suave hover:border-roxo hover:text-roxo-escuro disabled:opacity-40"
              onClick={refazer} disabled={!futuro.length} title="Refazer (Ctrl+Y)"
            >↷</button>
          </span>

          <span className="mx-1 h-4 w-px bg-linha" />

          {selecionados.length > 1 ? (
            <>
              {/* Alinhar: leva os blocos escolhidos ate a mesma borda ou
                  ao mesmo centro. So aparece com dois ou mais, porque com
                  um so nao ha a quem se alinhar. */}
              <span className="text-[11px] font-bold text-tinta-suave">
                {selecionados.length} blocos
              </span>
              <span className="flex items-center gap-1">
                {(['esquerda', 'centro', 'direita', 'topo', 'meio', 'base'] as Alinhamento[]).map((como) => (
                  <button
                    key={como}
                    title={rotuloDoAlinhamento[como]}
                    onClick={() => alinhar(como)}
                    className="rounded-lg border border-linha px-1.5 py-1.5 text-tinta-suave hover:border-roxo hover:text-roxo-escuro"
                  ><IconeAlinhar como={como} /></button>
                ))}
              </span>
              <button
                className="rounded-lg px-2 py-1 text-[11px] font-bold text-vermelho hover:bg-vermelho/5"
                onClick={() => removerNos(selecionados)}
              >Excluir {selecionados.length} blocos</button>
            </>
          ) : noSelecionado ? (
            <>
              {noSelecionado.forma === 'imagem' ? (
                <span className="text-[11px] font-bold text-tinta-suave">Imagem colada</span>
              ) : (
                <>
                  <input
                    className="campo w-44 py-1 text-xs" value={noSelecionado.texto}
                    onChange={(e) => alterarNo(noSelecionado.id, { texto: e.target.value })}
                    placeholder="Texto do bloco"
                  />
                  {/* Cores da casa a um clique e, ao lado, o seletor do
                      sistema para qualquer outra. */}
                  <span className="flex items-center gap-1">
                    {CORES_DO_FLUXO.map((c) => (
                      <button
                        key={c.valor}
                        title={c.nome}
                        onClick={() => alterarNo(noSelecionado.id, { cor: c.valor })}
                        className={`h-5 w-5 rounded-full border-2 ${
                          noSelecionado.cor === c.valor ? 'border-navy' : 'border-white'
                        }`}
                        style={{ backgroundColor: c.valor }}
                      />
                    ))}
                    <input
                      type="color" className="h-6 w-7 cursor-pointer rounded border border-linha"
                      value={noSelecionado.cor} title="Outra cor"
                      onChange={(e) => alterarNo(noSelecionado.id, { cor: e.target.value })}
                    />
                  </span>
                </>
              )}

              {noSelecionado.forma !== 'imagem' && (
                <label className="flex shrink-0 items-center gap-1 text-[11px] text-tinta-suave" title="Espessura da linha">
                  <select
                    className="campo w-20 py-1 text-xs"
                    value={espessuraDo(noSelecionado)}
                    onChange={(e) => alterarNo(noSelecionado.id, { espessura: Number(e.target.value) })}
                  >
                    {ESPESSURAS.map((v) => <option key={v} value={v}>{v} px</option>)}
                  </select>
                </label>
              )}

              {/* Girar e redimensionar valem para qualquer bloco, print
                  incluido: e o que se espera de um quadro deste tipo. */}
              <span className="flex items-center gap-1">
                <button
                  className="rounded-lg border border-linha px-1.5 py-1 text-[11px] font-bold text-tinta-suave hover:border-roxo hover:text-roxo-escuro"
                  title="Girar 15° à esquerda"
                  onClick={() => girar(noSelecionado, -15)}
                >↺</button>
                <button
                  className="rounded-lg border border-linha px-1.5 py-1 text-[11px] font-bold text-tinta-suave hover:border-roxo hover:text-roxo-escuro"
                  title="Girar 15° à direita"
                  onClick={() => girar(noSelecionado, 15)}
                >↻</button>
                {!!noSelecionado.rotacao && (
                  <button
                    className="rounded-lg px-1.5 py-1 text-[11px] font-bold text-tinta-suave hover:text-roxo-escuro"
                    title="Voltar ao ângulo original"
                    onClick={() => alterarNo(noSelecionado.id, { rotacao: 0 })}
                  >{noSelecionado.rotacao}°</button>
                )}
                <button
                  className="rounded-lg border border-linha px-1.5 py-1 text-[11px] font-bold text-tinta-suave hover:border-roxo hover:text-roxo-escuro"
                  title="Diminuir"
                  onClick={() => redimensionar(noSelecionado, 0.85)}
                >−</button>
                <button
                  className="rounded-lg border border-linha px-1.5 py-1 text-[11px] font-bold text-tinta-suave hover:border-roxo hover:text-roxo-escuro"
                  title="Aumentar"
                  onClick={() => redimensionar(noSelecionado, 1.18)}
                >+</button>
              </span>
              <button
                className={`rounded-lg px-2 py-1 text-[11px] font-bold ${
                  ligandoDe === noSelecionado.id
                    ? 'bg-roxo-escuro text-white'
                    : 'border border-linha text-tinta-suave hover:border-roxo hover:text-roxo-escuro'
                }`}
                onClick={() => setLigandoDe(ligandoDe === noSelecionado.id ? null : noSelecionado.id)}
              >
                {ligandoDe === noSelecionado.id ? 'Clique no bloco de destino' : '→ Seta para outro bloco'}
              </button>
              <button
                className="rounded-lg px-2 py-1 text-[11px] font-bold text-vermelho hover:bg-vermelho/5"
                onClick={() => removerNos([noSelecionado.id])}
              >Excluir bloco</button>
            </>
          ) : (
            <span className="text-[11px] text-tinta-suave">
              Clique num bloco para editar o texto, mudar a cor ou ligar a outro. Arraste ou use as
              setas do teclado para mover, Delete para apagar o que estiver selecionado, Ctrl+V
              para colar um print e Ctrl+Z para desfazer. Shift+clique escolhe vários blocos (Ctrl+A
              pega todos) e a barra alinha o grupo.
            </span>
          )}
        </div>
      )}

      {avisoDaImagem && (
        <p className="border-b border-linha bg-vermelho/5 px-3 py-1.5 text-[11px] font-bold text-vermelho">
          {avisoDaImagem}
        </p>
      )}

      {/* A janela e presa a altura da tela: prancheta grande rola por
          dentro, em vez de empurrar o resto da pagina para baixo e levar
          a barra de rolagem lateral para longe. */}
      <div ref={janela} className="max-h-[70vh] overflow-auto p-2">
        {/* O involucro tem o tamanho ja multiplicado pelo zoom: e ele que
            manda na barra de rolagem, porque o scale nao muda o espaco
            que o elemento ocupa no layout. */}
        <div style={{ width: largura * zoom, height: altura * zoom }}>
        <div
          ref={tela}
          data-quadro="fluxo"
          tabIndex={editando ? 0 : undefined}
          onPaste={(e) => void colar(e)}
          onMouseMove={moverArrasto}
          onMouseUp={terminarArrasto}
          onMouseLeave={terminarArrasto}
          onMouseDown={(e) => {
            comecouNoFundo.current = e.target === e.currentTarget;
            /* O quadro precisa do foco para o teclado valer nele, e nao
               na rolagem da pagina. */
            if (editando) tela.current?.focus({ preventScroll: true });
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && comecouNoFundo.current) {
              setSelecionados([]);
              setLigacaoSelecionada(null);
              setLigandoDe(null);
            }
          }}
          className="relative rounded-lg outline-none"
          style={{
            width: largura,
            height: altura,
            transform: zoom === 1 ? undefined : `scale(${zoom})`,
            transformOrigin: '0 0',
            backgroundImage: 'radial-gradient(#E7E8F5 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        >
          <svg width={largura} height={altura} className="pointer-events-none absolute inset-0">
            <defs>
              <marker id="ponta" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
                <path d="M0,0 L9,4.5 L0,9 z" fill="#6A6F94" />
              </marker>
              <marker id="ponta-inicio" markerWidth="9" markerHeight="9" refX="1" refY="4.5" orient="auto">
                <path d="M9,0 L0,4.5 L9,9 z" fill="#6A6F94" />
              </marker>
            </defs>
            {fluxo.ligacoes.map((l) => {
              const de = fluxo.nos.find((n) => n.id === l.de);
              const para = fluxo.nos.find((n) => n.id === l.para);
              if (!de || !para) return null;
              const inicio = bordaMaisProxima(de, para);
              const fim = bordaMaisProxima(para, de);
              return (
                <g key={l.id}>
                  <line
                    x1={inicio.x} y1={inicio.y} x2={fim.x} y2={fim.y}
                    stroke="#6A6F94" strokeWidth={2} markerEnd="url(#ponta)"
                    strokeDasharray={l.tracejada ? '6 4' : undefined}
                    markerStart={l.dupla ? 'url(#ponta-inicio)' : undefined}
                  />
                  {l.rotulo && (
                    <text
                      x={(inicio.x + fim.x) / 2} y={(inicio.y + fim.y) / 2 - 6}
                      textAnchor="middle" fontSize="11" fill="#6A6F94" fontFamily="Inter"
                    >{l.rotulo}</text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Controles da seta: fora do SVG, para serem clicaveis.

              Eles so aparecem na seta selecionada. A caixa de "Sim / Não"
              ficava aberta em toda seta, o tempo todo, e na maioria dos
              fluxos ninguem escreve nada nela: o quadro virava um campo
              de caixinhas vazias tapando o desenho. Fechada, a seta
              mostra so um ponto discreto; clicar nele abre o rotulo e o
              resto. */}
          {editando && fluxo.ligacoes.map((l) => {
            const de = fluxo.nos.find((n) => n.id === l.de);
            const para = fluxo.nos.find((n) => n.id === l.para);
            if (!de || !para) return null;
            const inicio = bordaMaisProxima(de, para);
            const fim = bordaMaisProxima(para, de);
            const meioX = (inicio.x + fim.x) / 2;
            const meioY = (inicio.y + fim.y) / 2;

            if (ligacaoSelecionada !== l.id) {
              return (
                <button
                  key={l.id}
                  title="Editar esta seta (rótulo, traço, remover)"
                  onMouseDown={() => {
                    setLigacaoSelecionada(l.id);
                    setSelecionados([]);
                    tela.current?.focus({ preventScroll: true });
                  }}
                  className="absolute z-10 h-3 w-3 rounded-full border border-linha bg-white opacity-40 hover:opacity-100 hover:border-roxo"
                  style={{ left: meioX - 6, top: meioY + 2 }}
                />
              );
            }

            return (
              <div
                key={l.id}
                onMouseDown={() => {
                  setSelecionados([]);
                  tela.current?.focus({ preventScroll: true });
                }}
                className="absolute z-20 flex items-center gap-1 rounded bg-white/90 ring-2 ring-roxo"
                style={{ left: meioX - 62, top: meioY + 2 }}
              >
                <input
                  className="w-20 rounded border border-linha bg-white px-1 py-0.5 text-[10px]"
                  value={l.rotulo} placeholder="Sim / Não"
                  onChange={(e) => gravar({
                    ...fluxo,
                    ligacoes: fluxo.ligacoes.map((x) => (x.id === l.id ? { ...x, rotulo: e.target.value } : x)),
                  })}
                />
                <button
                  className={`rounded border px-1 text-[10px] font-bold ${
                    l.dupla ? 'border-roxo bg-roxo-suave text-roxo-escuro' : 'border-linha bg-white text-tinta-suave'
                  }`}
                  title="Ponta dos dois lados"
                  onClick={() => gravar({
                    ...fluxo,
                    ligacoes: fluxo.ligacoes.map((x) => (x.id === l.id ? { ...x, dupla: !x.dupla } : x)),
                  })}
                >↔</button>
                <button
                  className={`rounded border px-1 text-[10px] font-bold ${
                    l.tracejada ? 'border-roxo bg-roxo-suave text-roxo-escuro' : 'border-linha bg-white text-tinta-suave'
                  }`}
                  title="Linha tracejada"
                  onClick={() => gravar({
                    ...fluxo,
                    ligacoes: fluxo.ligacoes.map((x) => (x.id === l.id ? { ...x, tracejada: !x.tracejada } : x)),
                  })}
                >┄</button>
                <button
                  className="rounded bg-white px-1 text-[10px] font-bold text-vermelho"
                  title="Remover seta"
                  onClick={() => gravar({ ...fluxo, ligacoes: fluxo.ligacoes.filter((x) => x.id !== l.id) })}
                >✕</button>
                <button
                  className="rounded bg-white px-1 text-[10px] font-bold text-tinta-suave"
                  title="Recolher"
                  onClick={() => setLigacaoSelecionada(null)}
                >⌄</button>
              </div>
            );
          })}

          {fluxo.nos.map((no) => (no.forma === 'imagem' ? (
            <img
              key={no.id}
              src={no.imagem}
              alt={no.texto || 'Print colado no fluxo'}
              draggable={false}
              onMouseDown={(e) => comecarArrasto(e, no)}
              onClick={() => ligandoDe && ligar(no.id)}
              className={`absolute rounded-lg border-2 bg-white object-contain ${
                editando ? 'cursor-grab active:cursor-grabbing' : ''
              } ${selecionados.includes(no.id) ? 'border-roxo shadow-alto' : 'border-linha shadow-card'}`}
              style={{
                left: no.x, top: no.y, width: no.largura, height: no.altura,
                transform: no.rotacao ? `rotate(${no.rotacao}deg)` : undefined,
              }}
            />
          ) : (
            <div
              key={no.id}
              onMouseDown={(e) => comecarArrasto(e, no)}
              onClick={() => ligandoDe && ligar(no.id)}
              className={`absolute flex items-center justify-center px-2 text-center text-xs font-semibold transition-shadow ${
                editando ? 'cursor-grab active:cursor-grabbing' : ''
              } ${selecionados.includes(no.id) ? 'shadow-alto ring-2 ring-roxo ring-offset-1' : 'shadow-card'} ${
                ligandoDe && ligandoDe !== no.id ? 'ring-2 ring-roxo ring-offset-1' : ''
              }`}
              style={{
                left: no.x,
                top: no.y,
                width: no.largura,
                height: no.altura,
                backgroundColor: no.forma === 'triangulo' ? undefined : `${no.cor}14`,
                border: no.forma === 'triangulo' ? undefined : `${espessuraDo(no)}px solid ${no.cor}`,
                color: '#161933',
                borderRadius: no.forma === 'inicio' || no.forma === 'circulo'
                  ? 999
                  : no.forma === 'nota' ? 4 : 10,
                transform: `rotate(${(no.forma === 'decisao' ? 45 : 0) + (no.rotacao ?? 0)}deg)`,
              }}
            >
              {/* O texto desgira o quanto a forma girou: losango com a
                  palavra de cabeca para baixo nao se le. */}
              {/* Triangulo nao se faz com borda de caixa: o contorno vem
                  de um poligono desenhado atras do texto. */}
              {no.forma === 'triangulo' && (
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                  <polygon
                    points="50,4 96,96 4,96" fill={`${no.cor}14`} stroke={no.cor}
                    strokeWidth={espessuraDo(no)} strokeLinejoin="round" vectorEffect="non-scaling-stroke"
                  />
                </svg>
              )}
              <span
                className="relative"
                style={{
                  transform: `rotate(${-((no.forma === 'decisao' ? 45 : 0) + (no.rotacao ?? 0))}deg)`,
                  marginTop: no.forma === 'triangulo' ? '18%' : undefined,
                }}
              >
                {no.texto}
              </span>
            </div>
          )))}

          {/* Alca de tamanho: so no bloco selecionado, para nao poluir o
              desenho com quadradinhos em cada caixa. */}
          {editando && noSelecionado && (
            <div
              onMouseDown={(e) => {
                e.stopPropagation();
                antesDoGesto.current = fluxo;
                esticando.current = {
                  id: noSelecionado.id,
                  x: e.clientX,
                  y: e.clientY,
                  largura: noSelecionado.largura,
                  altura: noSelecionado.altura,
                };
              }}
              title="Arraste para mudar o tamanho"
              className="absolute h-3 w-3 cursor-nwse-resize rounded-sm border-2 border-roxo bg-white"
              style={{
                left: noSelecionado.x + noSelecionado.largura - 6,
                top: noSelecionado.y + noSelecionado.altura - 6,
              }}
            />
          )}

          {!fluxo.nos.length && (
            <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-tinta-suave">
              {editando
                ? 'Comece adicionando uma etapa ou uma decisão na barra acima, ou clique aqui e cole um print com Ctrl+V.'
                : 'Fluxo ainda vazio.'}
            </p>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
