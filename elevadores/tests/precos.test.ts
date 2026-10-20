/* ============================================================
   Parser da SIGEQ278 (preco de custo do item pai), opcional.
   Export cru de sistema: sheet unica, cabecalho na primeira linha,
   mesmos apelidos de coluna do modulo Multiplos Descasados.
   ============================================================ */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx-js-style';
import { lerPrecos } from '../src/parsers/planilha';

function wbDe(linhas: unknown[][]): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return wb;
}

describe('lerPrecos (SIGEQ278)', () => {
  it('le Item + Preço de custo', () => {
    const wb = wbDe([
      ['Item', 'Nome item', 'Preço de custo', 'Preço de compra'],
      ['2031435', 'Elevador X', 1500, 1600],
    ]);
    const mapa = lerPrecos(wb);
    expect(mapa.get('2031435')).toBe(1500);
  });

  it('cai para Preço de compra quando o de custo nao veio preenchido', () => {
    const wb = wbDe([
      ['Item', 'Preço de custo', 'Preço de compra'],
      ['2031435', null, 1600],
    ]);
    expect(lerPrecos(wb).get('2031435')).toBe(1600);
  });

  it('aceita variacao sem acento nos cabecalhos', () => {
    const wb = wbDe([
      ['Item', 'Preco de custo'],
      ['2031435', 900],
    ]);
    expect(lerPrecos(wb).get('2031435')).toBe(900);
  });

  it('ignora linha sem item e item sem preco nenhum', () => {
    const wb = wbDe([
      ['Item', 'Preço de custo', 'Preço de compra'],
      ['', 100, 200],
      ['2031436', null, null],
    ]);
    const mapa = lerPrecos(wb);
    expect(mapa.size).toBe(0);
  });

  it('planilha vazia devolve mapa vazio', () => {
    expect(lerPrecos(wbDe([])).size).toBe(0);
  });
});
