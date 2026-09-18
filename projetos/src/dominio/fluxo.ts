/* Fluxo desenhado a mao, no espirito do Miro: caixas que se arrastam e
   setas que as ligam. O bloco guarda este JSON; antes ele guardava o
   codigo de um diagrama escrito em texto, que ninguem conseguia editar
   sem aprender a sintaxe. */

export type FormaDoNo = 'caixa' | 'decisao' | 'inicio' | 'nota' | 'circulo' | 'triangulo' | 'imagem';

export interface NoDoFluxo {
  id: string;
  texto: string;
  x: number;
  y: number;
  largura: number;
  altura: number;
  forma: FormaDoNo;
  cor: string;
  /* Print colado no quadro, guardado como data URI dentro do proprio
     bloco. Fica no JSON da pagina, e nao nos anexos, porque a imagem e
     parte do desenho: quem abre o fluxo tem de ve-la sem procurar
     arquivo. Por isso ela e reduzida antes de entrar. */
  imagem?: string;
  /* Giro do bloco, em graus. A decisao ja nasce virada 45 graus pela
     forma; este e o giro que a pessoa da por cima disso. */
  rotacao?: number;
  /* Espessura da linha da forma, em pixels. Serve para destacar o
     caminho principal do fluxo sem precisar de outra cor. */
  espessura?: number;
}

export interface LigacaoDoFluxo {
  id: string;
  de: string;
  para: string;
  rotulo: string;
  /* Seta tracejada para dependencia fraca, e ponta dos dois lados para
     ida e volta: e o que se desenha a mao num quadro. */
  tracejada?: boolean;
  dupla?: boolean;
}

export interface Fluxo {
  nos: NoDoFluxo[];
  ligacoes: LigacaoDoFluxo[];
}

export const CORES_DO_FLUXO = [
  { nome: 'Roxo', valor: '#7C3AED' },
  { nome: 'Azul', valor: '#2F6FE0' },
  { nome: 'Verde', valor: '#2E8B57' },
  { nome: 'Âmbar', valor: '#C79212' },
  { nome: 'Vermelho', valor: '#D2453A' },
  { nome: 'Cinza', valor: '#6A6F94' },
];

export const rotuloDaForma: Record<FormaDoNo, string> = {
  caixa: 'Etapa',
  decisao: 'Decisão',
  inicio: 'Início ou fim',
  nota: 'Anotação',
  circulo: 'Círculo',
  triangulo: 'Triângulo',
  imagem: 'Imagem',
};

export const ESPESSURAS = [1, 2, 3, 5, 8];

/* Zoom do quadro. Os passos sao fixos, e nao um multiplicador livre, para
   o botao sempre cair num numero redondo: quem esta desenhando quer "metade"
   ou "o dobro", nao 137%. */
export const ZOOMS = [0.25, 0.4, 0.5, 0.75, 1, 1.25, 1.5, 2];

export const ZOOM_PADRAO = 1;

/* O zoom vizinho na direcao pedida; nas pontas, fica onde esta. Um valor
   guardado que nao esta na lista (versao antiga, localStorage adulterado)
   cai no degrau mais proximo em vez de travar o botao. */
export function proximoZoom(atual: number, direcao: 1 | -1): number {
  const indice = ZOOMS.findIndex((z) => z === atual);
  if (indice < 0) {
    const perto = ZOOMS.reduce((a, b) => (Math.abs(b - atual) < Math.abs(a - atual) ? b : a), ZOOMS[0]);
    return perto;
  }
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, indice + direcao))];
}

export const zoomValido = (v: number): boolean => ZOOMS.includes(v);

export const espessuraDo = (no: NoDoFluxo): number => no.espessura ?? 2;

const TAMANHOS: Record<FormaDoNo, { largura: number; altura: number }> = {
  caixa: { largura: 180, altura: 64 },
  decisao: { largura: 170, altura: 96 },
  inicio: { largura: 150, altura: 52 },
  nota: { largura: 190, altura: 72 },
  circulo: { largura: 120, altura: 120 },
  triangulo: { largura: 140, altura: 120 },
  imagem: { largura: 320, altura: 200 },
};

/* Bloco de print: nasce do tamanho da imagem colada, limitado a 420 px
   de largura para nao empurrar o resto do quadro para fora da tela. */
export function noDeImagem(imagem: string, larguraReal: number, alturaReal: number, x: number, y: number): NoDoFluxo {
  /* O piso de 80 px evita o bloco virar um risco na tela quando o que
     foi colado e minusculo. */
  const largura = Math.min(420, Math.max(80, larguraReal));
  const altura = Math.max(40, Math.round((alturaReal * largura) / (larguraReal || 1)));
  return {
    id: crypto.randomUUID(),
    texto: '',
    x, y, largura, altura,
    forma: 'imagem',
    cor: '#6A6F94',
    imagem,
  };
}

export function fluxoVazio(): Fluxo {
  return { nos: [], ligacoes: [] };
}

/* A cor vem de quem esta desenhando: a barra guarda a cor escolhida e a
   forma ja nasce nela, em vez de nascer roxa e ser repintada uma a uma.
   Sem escolha, a anotacao nasce ambar e o resto roxo, como sempre. */
export function noNovo(forma: FormaDoNo, x: number, y: number, cor?: string): NoDoFluxo {
  const { largura, altura } = TAMANHOS[forma];
  return {
    id: crypto.randomUUID(),
    texto: rotuloDaForma[forma],
    x, y, largura, altura, forma,
    cor: cor ?? (forma === 'nota' ? '#C79212' : '#7C3AED'),
  };
}

/* O conteudo do bloco pode ser o JSON novo ou o texto do diagrama
   antigo. Ler os dois evita perder o que ja foi desenhado antes. */
export function lerFluxo(conteudo: string): Fluxo | null {
  const limpo = conteudo.trim();
  if (!limpo.startsWith('{')) return null;
  try {
    const lido = JSON.parse(limpo) as Partial<Fluxo>;
    if (!Array.isArray(lido.nos) || !Array.isArray(lido.ligacoes)) return null;
    return { nos: lido.nos, ligacoes: lido.ligacoes };
  } catch {
    return null;
  }
}

export const escreverFluxo = (fluxo: Fluxo) => JSON.stringify(fluxo);

export interface Ponto {
  x: number;
  y: number;
}

/* A seta sai da borda da caixa, nao do centro: ligada centro a centro,
   ela atravessaria o proprio bloco. */
export function bordaMaisProxima(de: NoDoFluxo, para: NoDoFluxo): Ponto {
  const centroDe = { x: de.x + de.largura / 2, y: de.y + de.altura / 2 };
  const centroPara = { x: para.x + para.largura / 2, y: para.y + para.altura / 2 };
  const dx = centroPara.x - centroDe.x;
  const dy = centroPara.y - centroDe.y;
  if (dx === 0 && dy === 0) return centroDe;

  const meiaLargura = de.largura / 2;
  const meiaAltura = de.altura / 2;
  /* Qual borda a reta cruza primeiro: a lateral ou a de cima/baixo. */
  const escala = Math.min(
    dx === 0 ? Infinity : meiaLargura / Math.abs(dx),
    dy === 0 ? Infinity : meiaAltura / Math.abs(dy),
  );
  return { x: centroDe.x + dx * escala, y: centroDe.y + dy * escala };
}

/* Alinhamento de varios blocos.

   Desenhar a mao deixa tudo torto: tres caixas que deviam formar uma
   coluna ficam com dois pixels de diferenca cada, e o olho ve. Alinhar e
   levar todos ate a mesma referencia — a borda mais a esquerda do grupo,
   o centro medio, a base mais baixa —, que e como funciona em qualquer
   ferramenta de desenho. */
export type Alinhamento = 'esquerda' | 'centro' | 'direita' | 'topo' | 'meio' | 'base';

export const rotuloDoAlinhamento: Record<Alinhamento, string> = {
  esquerda: 'Alinhar à esquerda',
  centro: 'Centralizar na vertical',
  direita: 'Alinhar à direita',
  topo: 'Alinhar pelo topo',
  meio: 'Centralizar na horizontal',
  base: 'Alinhar pela base',
};

/* O giro com que o bloco aparece na tela: a decisao ja nasce virada 45
   graus pela forma, e por cima disso vem o giro dado a mao. */
export const giroDo = (no: NoDoFluxo): number => (no.forma === 'decisao' ? 45 : 0) + (no.rotacao ?? 0);

/* A caixa que o bloco ocupa na tela, e nao o retangulo guardado nele.

   Um losango de 170x96 girado 45 graus ocupa 188x188 na tela, e o canto
   de cima fica bem acima do y guardado. Alinhar pelo retangulo do modelo
   deixava a decisao visivelmente fora da linha das caixas — para quem
   esta olhando, o alinhamento simplesmente nao funcionava. */
export function caixaVisual(no: NoDoFluxo): { x: number; y: number; largura: number; altura: number } {
  const giro = (giroDo(no) * Math.PI) / 180;
  const seno = Math.abs(Math.sin(giro));
  const cosseno = Math.abs(Math.cos(giro));
  const largura = no.largura * cosseno + no.altura * seno;
  const altura = no.largura * seno + no.altura * cosseno;
  /* O giro e em torno do centro, que nao se move: a caixa cresce para os
     dois lados a partir dele. */
  const centroX = no.x + no.largura / 2;
  const centroY = no.y + no.altura / 2;
  return { x: centroX - largura / 2, y: centroY - altura / 2, largura, altura };
}

export function alinharNos(nos: NoDoFluxo[], ids: string[], como: Alinhamento): NoDoFluxo[] {
  const alvo = nos.filter((n) => ids.includes(n.id));
  /* Com um bloco so nao ha a quem se alinhar: o desenho fica como esta. */
  if (alvo.length < 2) return nos;

  const caixas = alvo.map(caixaVisual);
  const esquerda = Math.min(...caixas.map((c) => c.x));
  const direita = Math.max(...caixas.map((c) => c.x + c.largura));
  const topo = Math.min(...caixas.map((c) => c.y));
  const base = Math.max(...caixas.map((c) => c.y + c.altura));
  /* O centro do grupo e o meio entre as bordas extremas, e nao a media
     das posicoes: com blocos de larguras diferentes, a media puxaria a
     coluna para o lado de quem tem mais vizinhos. */
  const centroX = (esquerda + direita) / 2;
  const centroY = (topo + base) / 2;

  const movidos = nos.map((n) => {
    if (!ids.includes(n.id)) return n;
    const caixa = caixaVisual(n);
    /* O que se alinha e a caixa da tela; o x/y guardado anda junto com
       ela, pela diferenca entre os dois. */
    const folgaX = n.x - caixa.x;
    const folgaY = n.y - caixa.y;
    const emX = (novoX: number) => ({ ...n, x: Math.round(novoX + folgaX) });
    const emY = (novoY: number) => ({ ...n, y: Math.round(novoY + folgaY) });
    switch (como) {
      case 'esquerda': return emX(esquerda);
      case 'direita': return emX(direita - caixa.largura);
      case 'centro': return emX(centroX - caixa.largura / 2);
      case 'topo': return emY(topo);
      case 'base': return emY(base - caixa.altura);
      case 'meio': return emY(centroY - caixa.altura / 2);
    }
  });

  /* Alinhar pela borda de um losango pode jogar o grupo para fora do
     quadro — a caixa girada comeca acima do y guardado, e ali nao ha
     como clicar no bloco de novo. Quando isso acontece, o grupo inteiro
     volta para dentro pelo mesmo tanto, e o alinhamento se mantem. */
  const alinhados = movidos.filter((n) => ids.includes(n.id)).map(caixaVisual);
  const faltaX = Math.max(0, -Math.min(...alinhados.map((c) => c.x)));
  const faltaY = Math.max(0, -Math.min(...alinhados.map((c) => c.y)));
  if (!faltaX && !faltaY) return movidos;
  return movidos.map((n) => (ids.includes(n.id)
    ? { ...n, x: Math.round(n.x + faltaX), y: Math.round(n.y + faltaY) }
    : n));
}

/* Distribuir: mesma distancia entre um bloco e o proximo.

   Alinhar poe todos na mesma linha; isto arruma o espaco entre eles. Sao
   coisas diferentes e as duas fazem falta: tres caixas alinhadas com
   80 px entre a primeira e a segunda e 200 px entre a segunda e a
   terceira continuam parecendo tortas.

   O primeiro e o ultimo ficam onde estao — eles definem o trecho —, e os
   do meio se espalham com folgas iguais entre as bordas, e nao entre os
   centros: com blocos de larguras diferentes, centros igualmente
   espacados deixam os vaos visivelmente desiguais. */
export type Eixo = 'horizontal' | 'vertical';

export const rotuloDaDistribuicao: Record<Eixo, string> = {
  horizontal: 'Mesma distância na horizontal',
  vertical: 'Mesma distância na vertical',
};

export function distribuirNos(nos: NoDoFluxo[], ids: string[], eixo: Eixo): NoDoFluxo[] {
  const alvo = nos.filter((n) => ids.includes(n.id));
  /* Com dois blocos nao ha vao do meio para acertar. */
  if (alvo.length < 3) return nos;

  const deitado = eixo === 'horizontal';
  const inicio = (c: { x: number; y: number }) => (deitado ? c.x : c.y);
  const tamanho = (c: { largura: number; altura: number }) => (deitado ? c.largura : c.altura);

  const emOrdem = alvo
    .map((n) => ({ no: n, caixa: caixaVisual(n) }))
    .sort((a, b) => inicio(a.caixa) - inicio(b.caixa));

  const primeiro = emOrdem[0];
  const ultimo = emOrdem[emOrdem.length - 1];
  const trecho = inicio(ultimo.caixa) + tamanho(ultimo.caixa) - inicio(primeiro.caixa);
  const ocupado = emOrdem.reduce((soma, item) => soma + tamanho(item.caixa), 0);
  /* Vao negativo (blocos sobrepostos) viraria uma pilha: ali o melhor
     que se pode fazer e encostar um no outro. */
  const vao = Math.max(0, (trecho - ocupado) / (emOrdem.length - 1));

  const posicoes = new Map<string, number>();
  let caminhado = inicio(primeiro.caixa);
  for (const item of emOrdem) {
    posicoes.set(item.no.id, caminhado);
    caminhado += tamanho(item.caixa) + vao;
  }

  return nos.map((n) => {
    const destino = posicoes.get(n.id);
    if (destino === undefined) return n;
    const caixa = caixaVisual(n);
    /* O x/y guardado anda junto com a caixa da tela, pela diferenca
       entre os dois — o mesmo que o alinhamento faz. */
    const folga = deitado ? n.x - caixa.x : n.y - caixa.y;
    return deitado
      ? { ...n, x: Math.round(destino + folga) }
      : { ...n, y: Math.round(destino + folga) };
  });
}

/* Copiar, recortar e colar dentro do quadro.

   Redesenhar a mao um bloco que ja existe — mesma cor, mesma espessura,
   mesmo texto quase igual — e trabalho que a copia resolve. O recorte
   leva junto as setas entre os blocos copiados (e so essas: uma seta que
   sai do grupo nao teria de onde sair depois de colada), e a colagem
   entra deslocada, para o bloco novo nao nascer exatamente por cima do
   original e parecer que nada aconteceu. */
export function recortarSelecao(fluxo: Fluxo, ids: string[]): Fluxo {
  const nos = fluxo.nos.filter((n) => ids.includes(n.id));
  return {
    nos,
    ligacoes: fluxo.ligacoes.filter((l) => ids.includes(l.de) && ids.includes(l.para)),
  };
}

/* O recorte tambem vai para a area de transferencia do sistema, como
   texto. Sem isso, um print copiado antes continuava valendo mais do que
   o bloco copiado agora: o navegador entrega a imagem antiga junto com o
   Ctrl+V e era ela que colava. Escrever aqui limpa a imagem de la e deixa
   claro o que foi copiado por ultimo — e ainda permite levar um bloco de
   uma pagina para outra. */
const MARCA_DO_RECORTE = 'fluxo-central-estoque/1';

export function recorteParaTexto(recorte: Fluxo): string {
  return JSON.stringify({ marca: MARCA_DO_RECORTE, ...recorte });
}

export function recorteDoTexto(texto: string): Fluxo | null {
  const limpo = texto.trim();
  if (!limpo.startsWith('{') || !limpo.includes(MARCA_DO_RECORTE)) return null;
  try {
    const lido = JSON.parse(limpo) as { marca?: string } & Partial<Fluxo>;
    if (lido.marca !== MARCA_DO_RECORTE) return null;
    if (!Array.isArray(lido.nos) || !Array.isArray(lido.ligacoes)) return null;
    return { nos: lido.nos, ligacoes: lido.ligacoes };
  } catch {
    return null;
  }
}

export interface Colagem {
  fluxo: Fluxo;
  /* Os blocos colados ja nascem selecionados: e neles que a pessoa vai
     mexer em seguida. */
  ids: string[];
}

export function colarNoFluxo(
  fluxo: Fluxo,
  recorte: Fluxo,
  deslocamento: number,
  novoId: () => string = () => crypto.randomUUID(),
): Colagem {
  if (!recorte.nos.length) return { fluxo, ids: [] };
  /* Id novo para cada bloco, e o de-para para as setas apontarem para as
     copias, e nao para os originais. */
  const dePara = new Map(recorte.nos.map((n) => [n.id, novoId()]));
  const nos = recorte.nos.map((n) => ({
    ...n,
    id: dePara.get(n.id) as string,
    x: n.x + deslocamento,
    y: n.y + deslocamento,
  }));
  const ligacoes = recorte.ligacoes.map((l) => ({
    ...l,
    id: novoId(),
    de: dePara.get(l.de) as string,
    para: dePara.get(l.para) as string,
  }));
  return {
    fluxo: { nos: [...fluxo.nos, ...nos], ligacoes: [...fluxo.ligacoes, ...ligacoes] },
    ids: nos.map((n) => n.id),
  };
}

export function limitesDoFluxo(fluxo: Fluxo): { largura: number; altura: number } {
  const largura = Math.max(900, ...fluxo.nos.map((n) => n.x + n.largura + 60));
  const altura = Math.max(420, ...fluxo.nos.map((n) => n.y + n.altura + 60));
  return { largura, altura };
}

/* Posicao livre para o proximo bloco: empilha em coluna e quebra para a
   direita, para dois blocos novos nao nascerem um sobre o outro. */
export function proximaPosicao(fluxo: Fluxo): Ponto {
  const total = fluxo.nos.length;
  const coluna = Math.floor(total / 4);
  const linha = total % 4;
  return { x: 60 + coluna * 260, y: 40 + linha * 110 };
}

/* A moldura justa em volta do desenho: onde ele comeca e onde termina,
   com uma margem de folga. A prancheta da tela tem chao de sobra para
   arrastar bloco, e esse chao vira papel em branco quando o fluxo sai
   daqui para um arquivo — meia tela de vazio embaixo do desenho. */
export function limitesJustos(fluxo: Fluxo, margem = 24): { x: number; y: number; largura: number; altura: number } {
  if (!fluxo.nos.length) return { x: 0, y: 0, largura: 2 * margem, altura: 2 * margem };
  /* Pela caixa da tela: o losango girado passa do retangulo guardado, e
     recortar pelo retangulo cortaria as pontas dele no arquivo. */
  const caixas = fluxo.nos.map(caixaVisual);
  const x = Math.min(...caixas.map((c) => c.x)) - margem;
  const y = Math.min(...caixas.map((c) => c.y)) - margem;
  const direita = Math.max(...caixas.map((c) => c.x + c.largura)) + margem;
  const base = Math.max(...caixas.map((c) => c.y + c.altura)) + margem;
  return { x, y, largura: direita - x, altura: base - y };
}

/* O Word nao desenha o quadro: o fluxo vira imagem. Gerar o SVG aqui,
   longe da tela, mantem o desenho do documento igual ao que se ve no
   app e deixa a funcao testavel sem navegador.

   `justo` corta o papel em branco em volta: e o que se quer num arquivo
   que alguem vai ler. O documento em Word continua no enquadramento de
   sempre, para o desenho nao mudar de tamanho de uma proposta para a
   outra. */
export function fluxoParaSvg(fluxo: Fluxo, opcoes: { justo?: boolean } = {}): string {
  const moldura = opcoes.justo
    ? limitesJustos(fluxo)
    : { x: 0, y: 0, ...limitesDoFluxo(fluxo) };
  const { largura, altura } = moldura;
  const escapar = (t: string) => t
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const setas = fluxo.ligacoes.map((l) => {
    const de = fluxo.nos.find((n) => n.id === l.de);
    const para = fluxo.nos.find((n) => n.id === l.para);
    if (!de || !para) return '';
    const i = bordaMaisProxima(de, para);
    const f = bordaMaisProxima(para, de);
    const meio = { x: (i.x + f.x) / 2, y: (i.y + f.y) / 2 - 6 };
    const traco = l.tracejada ? ' stroke-dasharray="6 4"' : '';
    const inicioDaSeta = l.dupla ? ' marker-start="url(#ponta-inicio)"' : '';
    return `<line x1="${i.x}" y1="${i.y}" x2="${f.x}" y2="${f.y}" stroke="#6A6F94" stroke-width="2"${traco}${inicioDaSeta} marker-end="url(#ponta)"/>`
      + (l.rotulo
        ? `<text x="${meio.x}" y="${meio.y}" text-anchor="middle" font-size="11" fill="#6A6F94" font-family="Arial">${escapar(l.rotulo)}</text>`
        : '');
  }).join('');

  const blocos = fluxo.nos.map((n) => {
    /* Print colado: entra no SVG como imagem embutida, e o Word recebe o
       desenho igual ao da tela. */
    if (n.forma === 'imagem') {
      return n.imagem
        ? `<image href="${n.imagem}" x="${n.x}" y="${n.y}" width="${n.largura}" height="${n.altura}" preserveAspectRatio="xMidYMid meet"/>`
        : '';
    }
    const cx = n.x + n.largura / 2;
    const cy = n.y + n.altura / 2;
    const raio = n.forma === 'inicio' ? n.altura / 2 : n.forma === 'nota' ? 4 : 10;
    const giro = (n.forma === 'decisao' ? 45 : 0) + (n.rotacao ?? 0);
    const linha = espessuraDo(n);
    const caixa = n.forma === 'circulo'
      ? `<ellipse cx="${cx}" cy="${cy}" rx="${n.largura / 2}" ry="${n.altura / 2}" fill="${n.cor}14" stroke="${n.cor}" stroke-width="${linha}"/>`
      : n.forma === 'triangulo'
        ? `<polygon points="${cx},${n.y} ${n.x + n.largura},${n.y + n.altura} ${n.x},${n.y + n.altura}" fill="${n.cor}14" stroke="${n.cor}" stroke-width="${linha}" stroke-linejoin="round"/>`
        : `<rect x="${n.x}" y="${n.y}" width="${n.largura}" height="${n.altura}" rx="${n.forma === 'decisao' ? 10 : raio}" fill="${n.cor}14" stroke="${n.cor}" stroke-width="${linha}"/>`;
    const forma = giro
      ? `<g transform="rotate(${giro} ${cx} ${cy})">${caixa}</g>`
      : caixa;
    /* Texto longo quebra em duas linhas: sem isso ele vaza da caixa. */
    const palavras = n.texto.split(' ');
    const meio = Math.ceil(palavras.length / 2);
    const linhas = n.texto.length > 22 && palavras.length > 1
      ? [palavras.slice(0, meio).join(' '), palavras.slice(meio).join(' ')]
      : [n.texto];
    const texto = linhas.map((linha, i) => (
      `<text x="${cx}" y="${cy + (i - (linhas.length - 1) / 2) * 15 + 4}" text-anchor="middle" font-size="12" font-weight="600" fill="#161933" font-family="Arial">${escapar(linha)}</text>`
    )).join('');
    return forma + texto;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}"`
    + ` viewBox="${moldura.x} ${moldura.y} ${largura} ${altura}">`
    + '<defs><marker id="ponta" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">'
    + '<path d="M0,0 L9,4.5 L0,9 z" fill="#6A6F94"/></marker>'
    + '<marker id="ponta-inicio" markerWidth="9" markerHeight="9" refX="1" refY="4.5" orient="auto">'
    + '<path d="M9,0 L0,4.5 L9,9 z" fill="#6A6F94"/></marker></defs>'
    + `<rect x="${moldura.x}" y="${moldura.y}" width="${largura}" height="${altura}" fill="#FFFFFF"/>`
    + `${setas}${blocos}</svg>`;
}
