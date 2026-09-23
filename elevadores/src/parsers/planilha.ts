/* ============================================================
   Orquestrador de leitura da planilha (secao 6 do brief).
   Le APENAS as abas Multiplos e Projeto no XLSX.read (as abas
   EstoqueAtual e Cadastros tem centenas de milhares de linhas e
   travam a leitura - regressao 8.6), sempre com cellDates: true.
   ============================================================ */
import * as XLSX from 'xlsx-js-style';
import type { Componente, Acao } from '../domain/tipos';
import type { MapaPrecos } from '../domain/fornecedores';
import { lerMultiplos } from './lerMultiplos';
import { lerProjeto } from './lerProjeto';
import { lerDivergencias } from './lerDivergencias';
import type { DivergenciaSAC } from '../domain/divergencias';
import { normalizarCabecalho, paraNumero, paraTexto } from './utilData';
import { montarObjetos, criarSeletor } from './utilData';

/* A aba de divergencias entra na lista porque o XLSX.read so abre o
   que esta aqui: sem isso ela seria ignorada como EstoqueAtual. Os
   nomes alternativos cobrem a exportacao avulsa da tabela, que sai na
   aba Export. */
export const ABAS_UTEIS = ['Multiplos', 'Projeto', 'Divergencias SAC', 'Divergências SAC'] as const;

export interface DadosPlanilha {
  componentes: Componente[];
  acoes: Acao[];
  divergencias: DivergenciaSAC[];
}

function acharAba(wb: XLSX.WorkBook, nome: string): XLSX.WorkSheet | null {
  const alvo = normalizarCabecalho(nome);
  const encontrado = wb.SheetNames.find((n) => normalizarCabecalho(n) === alvo);
  return encontrado ? wb.Sheets[encontrado] : null;
}

function abaParaMatriz(ws: XLSX.WorkSheet | null): unknown[][] {
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  }) as unknown[][];
}

export function lerWorkbook(wb: XLSX.WorkBook): DadosPlanilha {
  const componentes = lerMultiplos(abaParaMatriz(acharAba(wb, 'Multiplos')));
  const acoes = lerProjeto(abaParaMatriz(acharAba(wb, 'Projeto')));
  /* A tabela de divergencias pode chegar na planilha inteira ou
     exportada sozinha, que sai na aba Export. */
  const abaDivergencias =
    acharAba(wb, 'Divergencias SAC') ?? acharAba(wb, 'Divergências SAC') ?? acharAba(wb, 'Export');
  const divergencias = lerDivergencias(abaParaMatriz(abaDivergencias));
  return { componentes, acoes, divergencias };
}

export function lerArquivo(data: ArrayBuffer | Uint8Array): DadosPlanilha {
  const wb = XLSX.read(data, {
    type: 'array',
    cellDates: true,
    // So as abas uteis, para nao travar em EstoqueAtual/Cadastros.
    sheets: ABAS_UTEIS as unknown as string[],
  });
  return lerWorkbook(wb);
}

/* ---------------------------------------------------------------
   Base auxiliar de fotos: DE_PARA_LINK_FOTO.xlsx, aba Export.
   Coluna E = Id Item (string), coluna AP = URL Foto. Cruzar com
   Item Vol.Multiplo. Id Item precisa ser comparado como string
   (regressao 8.4).
   --------------------------------------------------------------- */
export type MapaFotos = Map<string, string>;

export function lerFotos(wb: XLSX.WorkBook): MapaFotos {
  const ws = acharAba(wb, 'Export');
  const aoa = abaParaMatriz(ws);
  const mapa: MapaFotos = new Map();
  if (aoa.length === 0) return mapa;

  const { linhas } = montarObjetos(aoa, 0);
  for (const linha of linhas) {
    const s = criarSeletor(linha);
    const idItem = paraTexto(s('Id Item')); // sempre comparado como string
    const url = paraTexto(s('URL Foto'));
    if (idItem && url) mapa.set(String(idItem), url);
  }
  return mapa;
}

export function lerArquivoFotos(data: ArrayBuffer | Uint8Array): MapaFotos {
  const wb = XLSX.read(data, { type: 'array', cellDates: true, sheets: ['Export'] });
  return lerFotos(wb);
}

/* ---------------------------------------------------------------
   Preco de custo do item pai: SIGEQ278 (opcional).
   Mesma logica do modulo Multiplos Descasados (rules.js, ALIAS_278):
   a 390/Multiplos traz o valor unitario zerado nos componentes do
   kit - o preco esta no item pai, que nao tem saldo proprio. A 278 e
   um export cru de sistema, sheet unica, cabecalho na primeira linha.
   Preco de custo manda; preco de compra so entra quando o de custo
   nao veio preenchido.
   --------------------------------------------------------------- */
export function lerPrecos(wb: XLSX.WorkBook): MapaPrecos {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = abaParaMatriz(ws);
  const mapa: MapaPrecos = new Map();
  if (aoa.length === 0) return mapa;

  const { linhas } = montarObjetos(aoa, 0);
  for (const linha of linhas) {
    const s = criarSeletor(linha);
    const item = paraTexto(s('Item'));
    if (!item) continue;
    const custo = paraNumero(s('Preço de custo', 'Preco de custo'));
    const compra = paraNumero(s('Preço de compra', 'Preco de compra'));
    const preco = custo || compra;
    if (preco > 0) mapa.set(item, preco);
  }
  return mapa;
}

export function lerArquivoPrecos(data: ArrayBuffer | Uint8Array): MapaPrecos {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  return lerPrecos(wb);
}
