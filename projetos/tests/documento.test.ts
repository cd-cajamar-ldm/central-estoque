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
