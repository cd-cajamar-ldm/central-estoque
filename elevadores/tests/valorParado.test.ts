/* ============================================================
   R$ parado: mesma logica do modulo Multiplos Descasados (SIGEQ278 +
   ZBIQ0051). So o lado que carrega o S no campo "in interface" vale o
   preco de custo do item pai; o outro lado do par entra a zero, e
   quando a sobra esta nele o total vira um piso, nao o valor inteiro.
   ============================================================ */
import { describe, it, expect } from 'vitest';
import { listarPorFornecedor, saudePorFornecedor } from '../src/domain/fornecedores';
import type { Componente } from '../src/domain/tipos';
import type { GrupoFornecedor, ItemFornecedor } from '../src/domain/fornecedores';

function comp(p: Partial<Componente>): Componente {
  return {
    itemVolMultiplo: '', nomeItemVolMultiplo: '', itemComponente: '', nomeItemComponente: '',
    quantidade: 1, inInterface: '', peso: 0, linhaProduto: '', marca: '', componenteBaseColuna: '',
    filtrar: '', cd: 0, reversa: 0, ds: 0, outros: 0, chave: '', toneladaFixa: '2 t', fabricante: '',
    ...p,
  };
}

function primeiroItem(grupos: GrupoFornecedor[]): ItemFornecedor {
  return grupos[0].toneladas[0].itens[0];
}

describe('valor parado (SIGEQ278)', () => {
  it('sem planilha de preco importada, o valor fica zero', () => {
    // Base (abundante) sem S: sobra fica sem preco de qualquer jeito.
    const item = [
      comp({ itemVolMultiplo: 'A', itemComponente: 'A1', componenteBaseColuna: 'BASE', cd: 10, inInterface: 'N', fabricante: 'JM' }),
      comp({ itemVolMultiplo: 'A', itemComponente: 'A2', componenteBaseColuna: 'COLUNA', cd: 1, inInterface: 'S', fabricante: 'JM' }),
    ];
    expect(primeiroItem(listarPorFornecedor(item)).valorParado).toBe(0);
    expect(saudePorFornecedor(listarPorFornecedor(item))[0].valorParado).toBe(0);
  });

  it('sobra no lado sem S: fica sem preco, e o item e marcado para o aviso', () => {
    // 10 bases (sem S), 1 coluna com S: monta 1 elevador, sobram 9
    // bases - e o lado que NAO carrega o preco do pai.
    const item = [
      comp({ itemVolMultiplo: 'A', itemComponente: 'A1', componenteBaseColuna: 'BASE', cd: 10, inInterface: 'N', fabricante: 'JM' }),
      comp({ itemVolMultiplo: 'A', itemComponente: 'A2', componenteBaseColuna: 'COLUNA', cd: 1, inInterface: 'S', fabricante: 'JM' }),
    ];
    const precos = new Map([['A', 500]]);
    const i = primeiroItem(listarPorFornecedor(item, precos));
    expect(i.valorParado).toBe(0);
    expect(i.componentesComSobra).toBe(1);
    expect(i.componentesSemPreco).toBe(1);
  });

  it('sobra no lado com S: valora pelo preco de custo do pai', () => {
    // 1 base (sem S), 10 colunas com S: monta 1 elevador, sobram 9
    // colunas - e o lado que carrega o preco do pai.
    const item = [
      comp({ itemVolMultiplo: 'B', itemComponente: 'B1', componenteBaseColuna: 'BASE', cd: 1, inInterface: 'N', fabricante: 'JM' }),
      comp({ itemVolMultiplo: 'B', itemComponente: 'B2', componenteBaseColuna: 'COLUNA', cd: 10, inInterface: 'S', fabricante: 'JM' }),
    ];
    const precos = new Map([['B', 500]]);
    const i = primeiroItem(listarPorFornecedor(item, precos));
    expect(i.valorParado).toBe(9 * 500);
    expect(i.componentesComSobra).toBe(1);
    expect(i.componentesSemPreco).toBe(0);
  });

  it('item sem preco cadastrado na 278 entra a zero, sem quebrar os outros', () => {
    const itens = [
      comp({ itemVolMultiplo: 'B', itemComponente: 'B1', componenteBaseColuna: 'BASE', cd: 1, inInterface: 'N', fabricante: 'JM' }),
      comp({ itemVolMultiplo: 'B', itemComponente: 'B2', componenteBaseColuna: 'COLUNA', cd: 10, inInterface: 'S', fabricante: 'JM' }),
      comp({ itemVolMultiplo: 'C', itemComponente: 'C1', componenteBaseColuna: 'BASE', cd: 1, inInterface: 'N', fabricante: 'JM' }),
      comp({ itemVolMultiplo: 'C', itemComponente: 'C2', componenteBaseColuna: 'COLUNA', cd: 10, inInterface: 'S', fabricante: 'JM' }),
    ];
    // So o item B tem preco na 278; C fica sem.
    const precos = new Map([['B', 500]]);
    const [g] = listarPorFornecedor(itens, precos);
    const total = saudePorFornecedor(listarPorFornecedor(itens, precos))[0];
    expect(total.valorParado).toBe(9 * 500);
    expect(g.valorParado).toBe(9 * 500);
  });

  it('agrega o R$ parado e o aviso de sem-preco no total do fornecedor', () => {
    const itens = [
      // Sobra sem preco (base, sem S).
      comp({ itemVolMultiplo: 'A', itemComponente: 'A1', componenteBaseColuna: 'BASE', cd: 10, inInterface: 'N', fabricante: 'JM' }),
      comp({ itemVolMultiplo: 'A', itemComponente: 'A2', componenteBaseColuna: 'COLUNA', cd: 1, inInterface: 'S', fabricante: 'JM' }),
      // Sobra com preco (coluna, com S).
      comp({ itemVolMultiplo: 'B', itemComponente: 'B1', componenteBaseColuna: 'BASE', cd: 1, inInterface: 'N', fabricante: 'JM' }),
      comp({ itemVolMultiplo: 'B', itemComponente: 'B2', componenteBaseColuna: 'COLUNA', cd: 10, inInterface: 'S', fabricante: 'JM' }),
    ];
    const precos = new Map([['A', 200], ['B', 500]]);
    const total = saudePorFornecedor(listarPorFornecedor(itens, precos))[0];
    expect(total.valorParado).toBe(9 * 500); // so o item B tem sobra do lado com preco
    expect(total.componentesComSobra).toBe(2); // A e B tem sobra
    expect(total.componentesSemPreco).toBe(1); // so A ficou sem preco
  });
});

describe('valor parado com QRY0390 (prioridade sobre a SIGEQ278)', () => {
  it('o valor unitario do proprio componente na 390 manda, mesmo sem o S', () => {
    // Base (sem S) tem sobra e preco proprio na 390: nao precisa do
    // pai nem do S para valorar.
    const item = [
      comp({ itemVolMultiplo: 'A', itemComponente: 'A1', componenteBaseColuna: 'BASE', cd: 10, inInterface: 'N', fabricante: 'JM' }),
      comp({ itemVolMultiplo: 'A', itemComponente: 'A2', componenteBaseColuna: 'COLUNA', cd: 1, inInterface: 'S', fabricante: 'JM' }),
    ];
    const saldo390 = new Map([['A1', 80]]);
    const i = primeiroItem(listarPorFornecedor(item, new Map(), saldo390));
    expect(i.valorParado).toBe(9 * 80);
    expect(i.componentesSemPreco).toBe(0);
  });

  it('sem preco na 390 para aquele componente, cai para o preco do pai (278) via S', () => {
    const item = [
      comp({ itemVolMultiplo: 'A', itemComponente: 'A1', componenteBaseColuna: 'BASE', cd: 10, inInterface: 'N', fabricante: 'JM' }),
      comp({ itemVolMultiplo: 'A', itemComponente: 'A2', componenteBaseColuna: 'COLUNA', cd: 1, inInterface: 'S', fabricante: 'JM' }),
    ];
    // A 390 so tem preco de outro item; A1 fica sem, cai pro pai.
    const precosPai = new Map([['A', 500]]);
    const saldo390 = new Map([['Z9', 999]]);
    const i = primeiroItem(listarPorFornecedor(item, precosPai, saldo390));
    // A sobra continua na base (sem S): sem preco proprio na 390 e
    // sem o S, o pai (278) nao se aplica a ela - mesmo resultado de
    // quando so a 278 foi importada.
    expect(i.valorParado).toBe(0);
    expect(i.componentesSemPreco).toBe(1);
  });

  it('preco da 390 no proprio componente com S vence, ignorando o do pai', () => {
    const item = [
      comp({ itemVolMultiplo: 'B', itemComponente: 'B1', componenteBaseColuna: 'BASE', cd: 1, inInterface: 'N', fabricante: 'JM' }),
      comp({ itemVolMultiplo: 'B', itemComponente: 'B2', componenteBaseColuna: 'COLUNA', cd: 10, inInterface: 'S', fabricante: 'JM' }),
    ];
    const precosPai = new Map([['B', 500]]); // preco do pai, seria usado sem a 390
    const saldo390 = new Map([['B2', 700]]); // preco do proprio componente com sobra
    const i = primeiroItem(listarPorFornecedor(item, precosPai, saldo390));
    expect(i.valorParado).toBe(9 * 700);
  });
});
