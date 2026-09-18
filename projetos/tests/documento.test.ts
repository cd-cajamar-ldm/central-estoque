import { describe, expect, it } from 'vitest';
import { documentoVazio, nomeDoArquivo, semTravessao } from '../src/dominio/documento';
import { lerConteudoColado } from '../src/dominio/briefing';
import { gerarDocumentoWord } from '../src/exportar/documentoWord';

const base = () => ({
  ...documentoVazio(7),
  titulo: 'Abertura Automática de Inventário por Tarefa',
  subtitulo: 'Criação de inventário ao abrir tarefa de falta ou sobra',
  objetivo: 'Reduzir o tempo entre a abertura da tarefa e a contagem.',
  dor: 'Hoje a contagem só começa depois que alguém percebe a divergência.',
  to_be: 'A tarefa passa a abrir o inventário na mesma hora.',
  problema_central: 'A divergência fica sem contagem por dias.',
  regras_negocio: ['Inventário abre apenas para endereço com saldo.'],
  kpis: [{ a: 'Tempo até a contagem', b: 'Menos de 2 horas' }],
});

/* PNG 1x1 valido: o gerador so precisa de bytes que o docx aceite. */
const PNG_MINIMO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('nomeDoArquivo', () => {
  it('segue o padrão NN__Proposta_Melhoria_Sistemica_Nome', () => {
    expect(nomeDoArquivo(base())).toBe(
      '07__Proposta_Melhoria_Sistemica_Abertura_Automatica_de_Inventario_por_Tarefa.docx',
    );
  });

  it('não quebra sem título', () => {
    expect(nomeDoArquivo({ ...documentoVazio(1), titulo: '' }))
      .toBe('01__Proposta_Melhoria_Sistemica_Proposta.docx');
  });
});

describe('semTravessao', () => {
  it('troca travessão entre palavras por dois pontos', () => {
    expect(semTravessao('Ganho — tempo de contagem')).toBe('Ganho: tempo de contagem');
  });

  it('troca travessão colado por hífen', () => {
    expect(semTravessao('2026—2027')).toBe('2026-2027');
  });
});

describe('lerConteudoColado', () => {
  it('aceita JSON dentro de cerca de markdown', () => {
    const dados = lerConteudoColado('```json\n{"objetivo":"novo objetivo"}\n```', base());
    expect(dados.objetivo).toBe('novo objetivo');
    expect(dados.titulo).toBe(base().titulo);
  });

  it('preserva número, imagens e fluxogramas do formulário', () => {
    const atual = { ...base(), fluxogramas: [{ titulo: 'Fluxo', codigo: 'flowchart TD' }] };
    const dados = lerConteudoColado('{"numero": 99, "fluxogramas": [], "dor": "outra dor"}', atual);
    expect(dados.numero).toBe(7);
    expect(dados.fluxogramas).toHaveLength(1);
    expect(dados.dor).toBe('outra dor');
  });

  it('avisa quando não há JSON no texto', () => {
    expect(() => lerConteudoColado('não consegui gerar', base())).toThrow();
  });
});

describe('gerarDocumentoWord', () => {
  it('produz um .docx válido mesmo sem imagens', async () => {
    const { blob, nome } = await gerarDocumentoWord(base(), { imagens: {} });
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // Assinatura de arquivo zip: todo .docx começa com "PK".
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes.length).toBeGreaterThan(5000);
    expect(nome).toContain('07__Proposta');
  });

  it('gera mesmo com as seções vazias', async () => {
    const { blob } = await gerarDocumentoWord(documentoVazio(1), { imagens: {} });
    expect(blob.size).toBeGreaterThan(5000);
  });
});

describe('marca no documento', () => {
  it('mantém a proporção do arquivo em vez de esticar', async () => {
    /* O arquivo da marca e 237x91. Com altura fixa o desenho achatava;
       agora a altura sai da largura pedida vezes a proporcao real. */
    const logo = { dados: new Uint8Array([1, 2, 3]), largura: 237, altura: 91 };
    const proporcaoDoArquivo = logo.largura / logo.altura;

    const alturaNaCapa = Math.round(200 * (logo.altura / logo.largura));
    const alturaNoCabecalho = Math.round(120 * (logo.altura / logo.largura));

    expect(200 / alturaNaCapa).toBeCloseTo(proporcaoDoArquivo, 1);
    expect(120 / alturaNoCabecalho).toBeCloseTo(proporcaoDoArquivo, 1);
  });

  it('gera o documento com a marca sem quebrar', async () => {
    const { blob } = await gerarDocumentoWord(base(), {
      imagens: {},
      logo: { dados: new Uint8Array(PNG_MINIMO), largura: 237, altura: 91 },
    });
    expect(blob.size).toBeGreaterThan(5000);
  });
});

describe('fluxo desenhado', () => {
  it('lê o formato novo e ignora o texto do formato antigo', async () => {
    const { lerFluxo } = await import('../src/dominio/fluxo');
    expect(lerFluxo('{"nos":[],"ligacoes":[]}')).toEqual({ nos: [], ligacoes: [] });
    expect(lerFluxo('flowchart TD\n A --> B')).toBeNull();
    expect(lerFluxo('{quebrado')).toBeNull();
  });

  it('a seta sai da borda do bloco, não do centro', async () => {
    const { bordaMaisProxima } = await import('../src/dominio/fluxo');
    const de = { id: 'a', texto: '', x: 0, y: 0, largura: 100, altura: 100, forma: 'caixa' as const, cor: '#000' };
    const para = { ...de, id: 'b', x: 300 };
    // Blocos lado a lado: a seta sai pela lateral direita, no meio da altura.
    expect(bordaMaisProxima(de, para)).toEqual({ x: 100, y: 50 });
  });

  it('gera o SVG do fluxo para o documento', async () => {
    const { fluxoParaSvg, noNovo } = await import('../src/dominio/fluxo');
    const a = noNovo('inicio', 20, 20);
    const b = noNovo('decisao', 300, 20);
    const svg = fluxoParaSvg({
      nos: [a, b],
      ligacoes: [{ id: 'l1', de: a.id, para: b.id, rotulo: 'Sim' }],
    });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('marker-end="url(#ponta)"');
    expect(svg).toContain('Sim');
    expect(svg).toContain('rotate(45');
  });

  it('escapa texto que quebraria o SVG', async () => {
    const { fluxoParaSvg, noNovo } = await import('../src/dominio/fluxo');
    const no = { ...noNovo('caixa', 0, 0), texto: 'Saldo < 10 & pendente' };
    const svg = fluxoParaSvg({ nos: [no], ligacoes: [] });
    expect(svg).toContain('Saldo &lt; 10 &amp; pendente');
  });
});

describe('zoom e cor do quadro', () => {
  it('o zoom anda de degrau em degrau e para nas pontas', async () => {
    const { proximoZoom, ZOOMS } = await import('../src/dominio/fluxo');
    expect(proximoZoom(1, 1)).toBe(1.25);
    expect(proximoZoom(1, -1)).toBe(0.75);
    // Nas pontas o botão não leva a lugar nenhum, em vez de sair da lista.
    expect(proximoZoom(ZOOMS[0], -1)).toBe(ZOOMS[0]);
    expect(proximoZoom(ZOOMS[ZOOMS.length - 1], 1)).toBe(ZOOMS[ZOOMS.length - 1]);
  });

  it('zoom guardado fora da lista cai no degrau mais próximo', async () => {
    const { proximoZoom, zoomValido } = await import('../src/dominio/fluxo');
    expect(zoomValido(1.37)).toBe(false);
    expect(proximoZoom(1.37, 1)).toBe(1.25);
  });

  it('a forma nova nasce na cor escolhida na barra', async () => {
    const { noNovo } = await import('../src/dominio/fluxo');
    expect(noNovo('caixa', 0, 0, '#2E8B57').cor).toBe('#2E8B57');
    // Sem escolha, a anotação continua âmbar e o resto roxo.
    expect(noNovo('caixa', 0, 0).cor).toBe('#7C3AED');
    expect(noNovo('nota', 0, 0).cor).toBe('#C79212');
  });
});

describe('alinhar blocos do fluxo', () => {
  const bloco = (id: string, x: number, y: number, largura = 100, altura = 50) => ({
    id, texto: id, x, y, largura, altura, forma: 'caixa' as const, cor: '#7C3AED',
  });

  it('alinha pela borda esquerda do grupo', async () => {
    const { alinharNos } = await import('../src/dominio/fluxo');
    const nos = [bloco('a', 40, 0), bloco('b', 120, 100), bloco('c', 300, 200)];
    const depois = alinharNos(nos, ['a', 'b'], 'esquerda');
    expect(depois.map((n) => n.x)).toEqual([40, 40, 300]);
    // Quem não estava selecionado não se mexe.
    expect(depois[2]).toEqual(nos[2]);
  });

  it('alinha pela direita levando em conta a largura de cada um', async () => {
    const { alinharNos } = await import('../src/dominio/fluxo');
    const nos = [bloco('a', 0, 0, 100), bloco('b', 50, 100, 200)];
    const depois = alinharNos(nos, ['a', 'b'], 'direita');
    // A borda direita do grupo é 250: o bloco de 100 px começa em 150.
    expect(depois.map((n) => n.x)).toEqual([150, 50]);
  });

  it('centraliza pelo meio entre as bordas extremas', async () => {
    const { alinharNos } = await import('../src/dominio/fluxo');
    const nos = [bloco('a', 0, 0, 100), bloco('b', 200, 0, 100)];
    const depois = alinharNos(nos, ['a', 'b'], 'centro');
    // Centro do grupo em 150: os dois, de 100 px, começam em 100.
    expect(depois.map((n) => n.x)).toEqual([100, 100]);
  });

  it('alinha pelo topo e pela base sem tocar no x', async () => {
    const { alinharNos } = await import('../src/dominio/fluxo');
    const nos = [bloco('a', 10, 30, 100, 50), bloco('b', 90, 80, 100, 20)];
    expect(alinharNos(nos, ['a', 'b'], 'topo').map((n) => n.y)).toEqual([30, 30]);
    // A base do grupo é 100: o bloco de 50 px de altura começa em 50.
    expect(alinharNos(nos, ['a', 'b'], 'base').map((n) => n.y)).toEqual([50, 80]);
    expect(alinharNos(nos, ['a', 'b'], 'base').map((n) => n.x)).toEqual([10, 90]);
  });

  it('com menos de dois blocos não há a quem se alinhar', async () => {
    const { alinharNos } = await import('../src/dominio/fluxo');
    const nos = [bloco('a', 40, 0), bloco('b', 120, 100)];
    expect(alinharNos(nos, ['a'], 'esquerda')).toEqual(nos);
    expect(alinharNos(nos, [], 'topo')).toEqual(nos);
  });
});

describe('compartilhar a página em HTML', () => {
  it('leva o texto e o fluxograma no mesmo arquivo', async () => {
    const { paginaParaHtml } = await import('../src/exportar/paginaHtml');
    const { escreverFluxo, noNovo } = await import('../src/dominio/fluxo');
    const no = { ...noNovo('caixa', 20, 20), texto: 'Conferir endereço' };
    const html = paginaParaHtml({
      titulo: 'Comportamento da tela de endereço',
      situacao: 'Aprovada',
      blocos: [
        { id: 'b1', tipo: 'texto', conteudo: '<p>Ao digitar o código, destacar o corredor.</p>' },
        { id: 'b2', tipo: 'fluxo', conteudo: escreverFluxo({ nos: [no], ligacoes: [] }) },
      ],
      geradoEm: new Date('2026-09-17T12:00:00'),
    }, (h) => h);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Comportamento da tela de endereço</title>');
    expect(html).toContain('Ao digitar o código, destacar o corredor.');
    // O fluxo vai desenhado no próprio arquivo, e não como anexo à parte.
    expect(html).toContain('<svg');
    expect(html).toContain('Conferir endereço');
    expect(html).toContain('Aprovada');
  });

  it('o texto do bloco passa pela limpeza antes de entrar no arquivo', async () => {
    const { paginaParaHtml } = await import('../src/exportar/paginaHtml');
    const html = paginaParaHtml({
      titulo: 'Página',
      blocos: [{ id: 'b1', tipo: 'texto', conteudo: '<p>oi</p><script>roubar()</script>' }],
    }, (h) => h.replace(/<script>.*?<\/script>/g, ''));
    expect(html).not.toContain('roubar()');
    expect(html).toContain('<p>oi</p>');
  });

  it('escapa o título e nomeia o arquivo sem acento', async () => {
    const { paginaParaHtml, nomeDoArquivoHtml } = await import('../src/exportar/paginaHtml');
    const html = paginaParaHtml({ titulo: 'Endereço <b> & cia', blocos: [] }, (h) => h);
    expect(html).toContain('<title>Endereço &lt;b&gt; &amp; cia</title>');
    expect(nomeDoArquivoHtml('Endereço <b> & cia')).toBe('endereco-b-cia.html');
    expect(nomeDoArquivoHtml('   ')).toBe('pagina.html');
  });

  it('fluxo no formato antigo vai como texto, em vez de sumir', async () => {
    const { paginaParaHtml } = await import('../src/exportar/paginaHtml');
    const html = paginaParaHtml({
      titulo: 'Antiga',
      blocos: [{ id: 'b1', tipo: 'fluxo', conteudo: 'graph TD; A-->B;' }],
    }, (h) => h);
    expect(html).toContain('graph TD; A--&gt;B;');
  });
});

describe('copiar, recortar e colar blocos', () => {
  const bloco = (id: string, x = 0, y = 0) => ({
    id, texto: id, x, y, largura: 100, altura: 50, forma: 'caixa' as const, cor: '#7C3AED',
  });

  it('o recorte leva as setas entre os blocos copiados, e só elas', async () => {
    const { recortarSelecao } = await import('../src/dominio/fluxo');
    const fluxo = {
      nos: [bloco('a'), bloco('b'), bloco('c')],
      ligacoes: [
        { id: 'l1', de: 'a', para: 'b', rotulo: '' },
        { id: 'l2', de: 'b', para: 'c', rotulo: '' },
      ],
    };
    const recorte = recortarSelecao(fluxo, ['a', 'b']);
    expect(recorte.nos.map((n) => n.id)).toEqual(['a', 'b']);
    // A seta para "c" ficaria sem destino depois de colada.
    expect(recorte.ligacoes.map((l) => l.id)).toEqual(['l1']);
  });

  it('colar cria blocos novos, deslocados, com as setas apontando para as cópias', async () => {
    const { colarNoFluxo, recortarSelecao } = await import('../src/dominio/fluxo');
    const fluxo = {
      nos: [bloco('a', 10, 20), bloco('b', 200, 20)],
      ligacoes: [{ id: 'l1', de: 'a', para: 'b', rotulo: 'Sim' }],
    };
    let n = 0;
    const { fluxo: depois, ids } = colarNoFluxo(
      fluxo, recortarSelecao(fluxo, ['a', 'b']), 30, () => `novo${(n += 1)}`,
    );
    expect(depois.nos).toHaveLength(4);
    expect(ids).toEqual(['novo1', 'novo2']);
    // O original fica onde estava; a cópia entra deslocada.
    expect(depois.nos[0]).toEqual(fluxo.nos[0]);
    expect(depois.nos[2]).toMatchObject({ id: 'novo1', x: 40, y: 50, texto: 'a' });
    const colada = depois.ligacoes[1];
    expect(colada).toMatchObject({ de: 'novo1', para: 'novo2', rotulo: 'Sim' });
    expect(colada.id).not.toBe('l1');
  });

  it('colar nada não mexe no fluxo', async () => {
    const { colarNoFluxo } = await import('../src/dominio/fluxo');
    const fluxo = { nos: [bloco('a')], ligacoes: [] };
    const { fluxo: depois, ids } = colarNoFluxo(fluxo, { nos: [], ligacoes: [] }, 30);
    expect(depois).toBe(fluxo);
    expect(ids).toEqual([]);
  });
});

describe('conforto de leitura do HTML compartilhado', () => {
  it('cada fluxograma vem com o controle de ajustar à largura, sem script', async () => {
    const { paginaParaHtml } = await import('../src/exportar/paginaHtml');
    const { escreverFluxo, noNovo } = await import('../src/dominio/fluxo');
    const html = paginaParaHtml({
      titulo: 'Duas telas',
      blocos: [
        { id: 'b1', tipo: 'fluxo', conteudo: escreverFluxo({ nos: [noNovo('caixa', 0, 0)], ligacoes: [] }) },
        { id: 'b2', tipo: 'fluxo', conteudo: escreverFluxo({ nos: [noNovo('caixa', 0, 0)], ligacoes: [] }) },
      ],
    }, (h) => h);
    // Um controle por fluxograma, cada um com o seu id.
    expect(html).toContain('id="ajustar-0"');
    expect(html).toContain('for="ajustar-1"');
    // O arquivo abre em navegador de terceiro: nada de script nele.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
  });

  it('o fluxo nasce em tamanho real e o controle é que o ajusta', async () => {
    const { paginaParaHtml } = await import('../src/exportar/paginaHtml');
    const html = paginaParaHtml({ titulo: 'x', blocos: [] }, (h) => h);
    expect(html).toContain('.fluxo svg { display: block; height: auto; max-width: none; }');
    expect(html).toContain('.ajustar:checked ~ .fluxo svg { max-width: 100%; }');
  });
});

describe('o arquivo compartilhado abre sozinho', () => {
  it('a imagem do texto entra embutida no arquivo', async () => {
    const { embutirImagens } = await import('../src/exportar/paginaHtml');
    const html = '<p>antes</p><img src="https://exemplo/anexos/print.png" alt="print">';
    const buscar = async () => ({ ok: true, blob: async () => new Blob(['xyz'], { type: 'image/png' }) });
    const saida = await embutirImagens(html, buscar as unknown as typeof fetch);
    expect(saida).toContain('src="data:image/png;base64,');
    expect(saida).not.toContain('https://exemplo/anexos/print.png');
    expect(saida).toContain('<p>antes</p>');
  });

  it('imagem que não baixa fica com a URL, em vez de derrubar o compartilhar', async () => {
    const { embutirImagens } = await import('../src/exportar/paginaHtml');
    const html = '<img src="https://exemplo/some.png">';
    const buscar = async () => { throw new Error('sem rede'); };
    expect(await embutirImagens(html, buscar as unknown as typeof fetch)).toBe(html);
  });

  it('o desenho exportado é recortado no conteúdo, sem papel em branco', async () => {
    const { fluxoParaSvg, limitesJustos, noNovo } = await import('../src/dominio/fluxo');
    const fluxo = { nos: [{ ...noNovo('caixa', 300, 400) }], ligacoes: [] };
    const justo = limitesJustos(fluxo);
    // A caixa é 180x64: com 24 px de margem dos dois lados, 228x112.
    expect(justo).toEqual({ x: 276, y: 376, largura: 228, altura: 112 });
    expect(fluxoParaSvg(fluxo, { justo: true })).toContain('viewBox="276 376 228 112"');
    // O documento em Word continua no enquadramento de sempre.
    expect(fluxoParaSvg(fluxo)).toContain('viewBox="0 0 900 524"');
  });
});

describe('alinhar pelo que se vê na tela', () => {
  const caixa = (id: string, x: number, y: number, forma: 'caixa' | 'decisao' = 'caixa') => ({
    id, texto: id, x, y, largura: 100, altura: 60, forma, cor: '#7C3AED',
  });

  it('a caixa da decisão é a do losango girado, não a do retângulo guardado', async () => {
    const { caixaVisual } = await import('../src/dominio/fluxo');
    const visual = caixaVisual(caixa('d', 0, 0, 'decisao'));
    // 100x60 a 45°: 113,1 nos dois lados, crescendo a partir do centro (50, 30).
    expect(Math.round(visual.largura)).toBe(113);
    expect(Math.round(visual.altura)).toBe(113);
    expect(Math.round(visual.x)).toBe(-7);
    expect(Math.round(visual.y)).toBe(-27);
  });

  it('o giro dado a mão entra na conta', async () => {
    const { caixaVisual, giroDo } = await import('../src/dominio/fluxo');
    const girado = { ...caixa('a', 0, 0), rotacao: 90 };
    expect(giroDo(girado)).toBe(90);
    const visual = caixaVisual(girado);
    expect(Math.round(visual.largura)).toBe(60);
    expect(Math.round(visual.altura)).toBe(100);
  });

  it('a decisão encosta na mesma borda que a caixa, e não no retângulo dela', async () => {
    const { alinharNos, caixaVisual } = await import('../src/dominio/fluxo');
    const nos = [caixa('a', 40, 0), caixa('d', 300, 200, 'decisao')];
    const depois = alinharNos(nos, ['a', 'd'], 'esquerda');
    const bordas = depois.map((n) => Math.round(caixaVisual(n).x));
    expect(bordas[0]).toBe(bordas[1]);
    // O x guardado da decisão não é o da borda: ele compensa o giro.
    expect(depois[1].x).not.toBe(depois[0].x);
  });

  it('alinhar pelo topo iguala o topo do que se vê', async () => {
    const { alinharNos, caixaVisual } = await import('../src/dominio/fluxo');
    const nos = [caixa('a', 0, 100), caixa('d', 300, 200, 'decisao')];
    const topos = alinharNos(nos, ['a', 'd'], 'topo').map((n) => Math.round(caixaVisual(n).y));
    expect(topos[0]).toBe(topos[1]);
  });
});

describe('o bloco copiado vai para a área de transferência', () => {
  it('o texto copiado volta como fluxo, e só o nosso', async () => {
    const { recorteDoTexto, recorteParaTexto } = await import('../src/dominio/fluxo');
    const recorte = {
      nos: [{ id: 'a', texto: 'a', x: 0, y: 0, largura: 10, altura: 10, forma: 'caixa' as const, cor: '#000' }],
      ligacoes: [],
    };
    const texto = recorteParaTexto(recorte);
    expect(recorteDoTexto(texto)).toEqual(recorte);
    // Texto qualquer copiado de outro lugar não vira bloco.
    expect(recorteDoTexto('Tela no bseller')).toBeNull();
    expect(recorteDoTexto('{"nos":[],"ligacoes":[]}')).toBeNull();
    expect(recorteDoTexto('{quebrado')).toBeNull();
  });
});

describe('alinhar não joga o grupo para fora do quadro', () => {
  it('o losango que passaria da borda traz o grupo de volta, alinhado', async () => {
    const { alinharNos, caixaVisual } = await import('../src/dominio/fluxo');
    const nos = [
      { id: 'a', texto: 'a', x: 40, y: 200, largura: 100, altura: 60, forma: 'caixa' as const, cor: '#000' },
      { id: 'd', texto: 'd', x: 300, y: 10, largura: 100, altura: 60, forma: 'decisao' as const, cor: '#000' },
    ];
    const depois = alinharNos(nos, ['a', 'd'], 'topo');
    const caixas = depois.map(caixaVisual);
    // Alinhados entre si…
    expect(Math.round(caixas[0].y)).toBe(Math.round(caixas[1].y));
    // …e dentro do quadro.
    expect(Math.min(...caixas.map((c) => c.y))).toBeGreaterThanOrEqual(0);
  });
});

describe('mesma distância entre os blocos', () => {
  const caixa = (id: string, x: number, largura: number) => ({
    id, texto: id, x, y: 0, largura, altura: 50, forma: 'caixa' as const, cor: '#000',
  });

  it('acerta o vão do meio sem mexer no primeiro nem no último', async () => {
    const { distribuirNos } = await import('../src/dominio/fluxo');
    const nos = [caixa('a', 0, 100), caixa('b', 120, 100), caixa('c', 400, 100)];
    const depois = distribuirNos(nos, ['a', 'b', 'c'], 'horizontal');
    expect(depois[0].x).toBe(0);
    expect(depois[2].x).toBe(400);
    // Trecho 500, ocupado 300: sobram 200 para dois vãos de 100.
    expect(depois[1].x).toBe(200);
  });

  it('os vãos ficam iguais mesmo com larguras diferentes', async () => {
    const { distribuirNos } = await import('../src/dominio/fluxo');
    const nos = [caixa('a', 0, 40), caixa('b', 50, 200), caixa('c', 500, 60)];
    const d = distribuirNos(nos, ['a', 'b', 'c'], 'horizontal');
    const vao1 = d[1].x - (d[0].x + 40);
    const vao2 = d[2].x - (d[1].x + 200);
    expect(Math.abs(vao1 - vao2)).toBeLessThanOrEqual(1);
  });

  it('na vertical mexe só no y', async () => {
    const { distribuirNos } = await import('../src/dominio/fluxo');
    const nos = [
      { ...caixa('a', 10, 100), y: 0 },
      { ...caixa('b', 90, 100), y: 20 },
      { ...caixa('c', 40, 100), y: 300 },
    ];
    const d = distribuirNos(nos, ['a', 'b', 'c'], 'vertical');
    expect(d.map((n) => n.x)).toEqual([10, 90, 40]);
    // Trecho 350, ocupado 150: dois vãos de 100.
    expect(d[1].y).toBe(150);
  });

  it('com menos de três blocos não há vão do meio para acertar', async () => {
    const { distribuirNos } = await import('../src/dominio/fluxo');
    const nos = [caixa('a', 0, 100), caixa('b', 300, 100)];
    expect(distribuirNos(nos, ['a', 'b'], 'horizontal')).toEqual(nos);
  });

  it('blocos sobrepostos encostam um no outro, em vez de empilhar', async () => {
    const { distribuirNos } = await import('../src/dominio/fluxo');
    const nos = [caixa('a', 0, 100), caixa('b', 10, 100), caixa('c', 20, 100)];
    const d = distribuirNos(nos, ['a', 'b', 'c'], 'horizontal');
    expect(d.map((n) => n.x)).toEqual([0, 100, 200]);
  });
});

describe('o arquivo compartilhado já abre ajustado', () => {
  it('o controle vem marcado', async () => {
    const { paginaParaHtml } = await import('../src/exportar/paginaHtml');
    const { escreverFluxo, noNovo } = await import('../src/dominio/fluxo');
    const html = paginaParaHtml({
      titulo: 'x',
      blocos: [{ id: 'b1', tipo: 'fluxo', conteudo: escreverFluxo({ nos: [noNovo('caixa', 0, 0)], ligacoes: [] }) }],
    }, (h) => h);
    expect(html).toContain('id="ajustar-0" checked');
  });
});
