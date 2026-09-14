import { describe, expect, it } from 'vitest';
import { blocosDoTexto, lerTextoCorrido } from '../src/dominio/texto';
import { documentoVazio } from '../src/dominio/documento';

/* O texto do pedido real da QRY0730, do jeito que chegou. */
const PEDIDO = `Solicitamos a inclusão de quatro novas colunas na consulta QRY0730 – Recebimento de Itens, mantendo a estrutura atual do relatório e acrescentando apenas as informações abaixo.

Novas colunas solicitadas:

LOTE_RECEBIMENTO
LOTE_TERCEIRO
DATA_VALIDADE_RECEBIDO
MECA_USUARIO

Objetivo da melhoria:

Disponibilizar informações complementares dos itens recebidos, permitindo maior rastreabilidade do processo de recebimento e apoiando as atividades de auditoria, conferência e identificação de desvios operacionais.

Comportamento atual:

Atualmente, a QRY0730 não disponibiliza os campos de lote, validade e usuário responsável pelo recebimento. Dessa forma, quando há necessidade de identificar quem realizou um recebimento ou qual lote foi informado, é necessário consultar cada RecDoc individualmente dentro do Bseller.

Esse processo é manual, demanda muito tempo e inviabiliza auditorias em grande volume, principalmente quando há necessidade de analisar diversos recebimentos ou identificar padrões de erro.

Comportamento esperado:

Manter todas as colunas atualmente existentes na consulta e incluir as seguintes informações:

LOTE_RECEBIMENTO
LOTE_TERCEIRO
DATA_VALIDADE_RECEBIDO
MECA_USUARIO

Justificativa:

A inclusão desses campos permitirá realizar auditorias de forma massiva, sem a necessidade de acessar cada recebimento individualmente no sistema.

Com essas informações disponíveis diretamente na consulta, será possível:

Identificar rapidamente o usuário responsável por cada recebimento;
Verificar os lotes informados durante o processo de recebimento;
Validar as datas de validade registradas;
Detectar padrões de erros operacionais;
Reduzir significativamente o tempo gasto em análises e investigações de divergências;
Aumentar a rastreabilidade e a eficiência das auditorias de recebimento.

A melhoria proporcionará maior agilidade para as áreas de Controle de Estoque e Qualidade, permitindo análises em massa e uma atuação mais rápida na identificação e correção de inconsistências.`;

const base = () => documentoVazio(7);

describe('blocosDoTexto', () => {
  it('separa pelos títulos que a pessoa já escreve', () => {
    const titulos = blocosDoTexto(PEDIDO).map((b) => b.titulo);
    expect(titulos).toEqual([
      '', 'Novas colunas solicitadas', 'Objetivo da melhoria',
      'Comportamento atual', 'Comportamento esperado', 'Justificativa',
    ]);
  });

  it('não confunde frase de abertura de lista com título', () => {
    const justificativa = blocosDoTexto(PEDIDO).find((b) => b.titulo === 'Justificativa')!;
    expect(justificativa.paragrafos[1]).toMatch(/^Com essas informações/);
    expect(justificativa.itens).toHaveLength(6);
  });

  it('linha curta sozinha é parágrafo, não lista de um item', () => {
    const [bloco] = blocosDoTexto('Objetivo:\n\nGanhar tempo');
    expect(bloco.itens).toEqual([]);
    expect(bloco.paragrafos).toEqual(['Ganhar tempo']);
  });

  it('aceita marcadores e cabeçalhos de markdown', () => {
    const [bloco] = blocosDoTexto('## Riscos\n- depende do time técnico');
    expect(bloco.titulo).toBe('Riscos');
    expect(bloco.itens).toEqual(['depende do time técnico']);
  });
});

describe('lerTextoCorrido', () => {
  const { dados, mapa } = lerTextoCorrido(PEDIDO, base());

  it('leva cada bloco conhecido para o seu campo', () => {
    expect(dados.objetivo).toMatch(/^Disponibilizar informações complementares/);
    expect(dados.dor).toMatch(/^Atualmente, a QRY0730/);
    expect(dados.dor).toMatch(/Esse processo é manual/);
    expect(dados.to_be).toMatch(/^Manter todas as colunas/);
  });

  it('a abertura sem título vira resumo executivo quando há objetivo', () => {
    expect(dados.resumo_executivo).toMatch(/^Solicitamos a inclusão de quatro novas colunas/);
    expect(dados.objetivo).not.toMatch(/Solicitamos/);
  });

  it('título desconhecido não perde conteúdo: vira regra com o rótulo na frente', () => {
    expect(dados.regras_negocio).toContain('Novas colunas solicitadas: LOTE_RECEBIMENTO');
    expect(dados.regras_negocio).toContain('Novas colunas solicitadas: MECA_USUARIO');
  });

  it('lista dentro do comportamento esperado vira critério de aceite', () => {
    expect(dados.criterios_aceite).toEqual([
      'LOTE_RECEBIMENTO', 'LOTE_TERCEIRO', 'DATA_VALIDADE_RECEBIDO', 'MECA_USUARIO',
    ]);
  });

  it('justificativa vira ROI: itens nos ganhos, parágrafos no fechamento', () => {
    expect(dados.roi_bullets).toHaveLength(6);
    expect(dados.roi_bullets[0]).toBe('Identificar rapidamente o usuário responsável por cada recebimento');
    expect(dados.prioridade_justificativa).toMatch(/^A inclusão desses campos permitirá/);
    expect(dados.roi_fechamento).toMatch(/^A melhoria proporcionará maior agilidade/);
  });

  it('conta para a tela o que foi para onde', () => {
    expect(mapa).toContainEqual({ titulo: 'Comportamento atual', destino: 'Dor atual (AS IS)' });
    expect(mapa).toContainEqual({ titulo: 'Novas colunas solicitadas', destino: 'Regras de negócio' });
  });

  it('ler de novo substitui as listas em vez de duplicar', () => {
    const primeira = lerTextoCorrido(PEDIDO, base()).dados;
    const segunda = lerTextoCorrido(PEDIDO, primeira).dados;
    expect(segunda.criterios_aceite).toEqual(primeira.criterios_aceite);
    expect(segunda.roi_bullets).toEqual(primeira.roi_bullets);
  });

  it('preserva o que não vem do texto', () => {
    expect(dados.numero).toBe(7);
    expect(dados.elaborado_por).toBe(base().elaborado_por);
  });

  it('sem objetivo declarado, a abertura vira o objetivo', () => {
    const { dados: d } = lerTextoCorrido('Precisamos de uma coluna nova na consulta.', base());
    expect(d.objetivo).toBe('Precisamos de uma coluna nova na consulta.');
  });

  it('reconhece sinônimos e monta duplas de tabela', () => {
    const { dados: d } = lerTextoCorrido(
      'Riscos e dependências:\n- Agenda do time técnico | pode atrasar a entrega\nKPIs:\n- Tempo de auditoria: cair pela metade',
      base(),
    );
    expect(d.riscos).toEqual([{ a: 'Agenda do time técnico', b: 'pode atrasar a entrega' }]);
    expect(d.kpis).toEqual([{ a: 'Tempo de auditoria', b: 'cair pela metade' }]);
  });

  it('recusa texto vazio', () => {
    expect(() => lerTextoCorrido('   ', base())).toThrow(/Cole o texto/);
  });
});

/* O pedido escrito sem título nenhum, que é como a maioria escreve. */
const PEDIDO_SEM_TITULO = `Solicito a inclusão de duas colunas na QRY0191

A query 191 é utilizada para identificar quem realizou a reimpressão de um ean. Se duas pessoas realizarem a colagem de um ean incorreto no período próximo, não consigo identificar quem foi e aonde. Hoje é necessário eu entrar na plataforma senior e identificar quem é a pessoa e qual filial ela atual.

Solicito a inclusão de duas novas colunas sendo elas a filial de impressão e impressora, assim se tornando mais fácil o rastreio e a comunicação prévia.`;

describe('texto sem título', () => {
  it('a ordem dos parágrafos vira objetivo, dor e o que muda', () => {
    const { dados, mapa } = lerTextoCorrido(PEDIDO_SEM_TITULO, documentoVazio(1));
    expect(dados.objetivo).toBe('Solicito a inclusão de duas colunas na QRY0191');
    expect(dados.dor).toMatch(/^A query 191 é utilizada/);
    expect(dados.to_be).toMatch(/^Solicito a inclusão de duas novas colunas/);
    expect(mapa[0]).toEqual({ titulo: 'Abertura', destino: 'Objetivo, Dor atual (AS IS), O que muda (TO BE)' });
  });

  it('com dois parágrafos, o segundo é a dor', () => {
    const { dados } = lerTextoCorrido('Quero uma coluna nova.\n\nHoje não dá para saber quem imprimiu.', documentoVazio(1));
    expect(dados.objetivo).toBe('Quero uma coluna nova.');
    expect(dados.dor).toBe('Hoje não dá para saber quem imprimiu.');
    expect(dados.to_be).toBe('');
  });

  it('um parágrafo só continua sendo apenas o objetivo', () => {
    const { dados } = lerTextoCorrido('Quero uma coluna nova.', documentoVazio(1));
    expect(dados.objetivo).toBe('Quero uma coluna nova.');
    expect(dados.dor).toBe('');
  });

  it('quem escreveu os títulos manda: a distribuição não atropela', () => {
    const { dados } = lerTextoCorrido(PEDIDO, documentoVazio(1));
    expect(dados.dor).toMatch(/^Atualmente, a QRY0730/);
    expect(dados.objetivo).toMatch(/^Disponibilizar informações complementares/);
  });
});
