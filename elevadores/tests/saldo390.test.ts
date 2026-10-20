/* ============================================================
   Parser da QRY0390 (valor unitario por componente), opcional.
   Export avulso de sistema - nao a aba EstoqueAtual de dentro da
   planilha principal. Mesmos apelidos de coluna do modulo Multiplos
   Descasados (ID_ITEM_FILHO/Item, VALOR_UNITARIO).
   ============================================================ */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx-js-style';
import { lerSaldo390 } from '../src/parsers/planilha';

function wbDe(linhas: unknown[][]): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return wb;
}

describe('lerSaldo390 (QRY0390)', () => {
  it('le ID_ITEM_FILHO + VALOR_UNITARIO', () => {
    const wb = wbDe([
      ['ID_ITEM_FILHO', 'VALOR_UNITARIO'],
      ['2032028', 350],
    ]);
    expect(lerSaldo390(wb).get('2032028')).toBe(350);
  });

  it('aceita o alias Item, para exportacoes fora do padrao Snowflake', () => {
    const wb = wbDe([
      ['Item', 'VALOR_UNITARIO'],
      ['2032028', 200],
    ]);
    expect(lerSaldo390(wb).get('2032028')).toBe(200);
  });

  it('o item repete uma linha por local: a primeira ocorrencia nao-zero manda', () => {
    const wb = wbDe([
      ['ID_ITEM_FILHO', 'VALOR_UNITARIO'],
      ['2032028', 0],
      ['2032028', 350],
      ['2032028', 999],
    ]);
    expect(lerSaldo390(wb).get('2032028')).toBe(350);
  });

  it('ignora linha sem item e item com valor zerado em todas as linhas', () => {
    const wb = wbDe([
      ['ID_ITEM_FILHO', 'VALOR_UNITARIO'],
      ['', 100],
      ['2032029', 0],
      ['2032029', 0],
    ]);
    expect(lerSaldo390(wb).size).toBe(0);
  });

  it('planilha vazia devolve mapa vazio', () => {
    expect(lerSaldo390(wbDe([])).size).toBe(0);
  });
});
