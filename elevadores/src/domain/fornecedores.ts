/* ============================================================
   Lista de compra por fornecedor.

   O comprador olha o estoque pelo fornecedor que ele atende, nao
   pela chave do conjunto. Aqui os componentes sao agrupados em
   Fornecedor (fabricante) -> Tonelada -> Item pai, e cada item pai
   mostra as bases e as colunas que existem no CD, o que esta
   descasado e quantas pecas faltam comprar.
   ============================================================ */
import type { Componente } from './tipos';
import { tipoComponente } from './equalizacao';
import { ratioDaTonelada } from '../config/regras';
import { montarKit, faltamDoTipo, porKitDe } from './kit';
import type { MontagemDoKit } from './kit';

/* Mapa de preco: item -> valor unitario. Serve tanto para o preco de
   custo do item pai (SIGEQ278, chave = item pai) quanto para o valor
   unitario por componente (QRY0390, chave = item componente). Mapa
   vazio quando a planilha correspondente nao foi importada: o valor
   entao sai zero, sem quebrar a tela. */
export type MapaPrecos = Map<string, number>;

export type SituacaoItem = 'CASADO' | 'DESCASADO' | 'SEM ESTOQUE';

/* Uma linha de componente do item pai. Traz o kit inteiro, nao so a
   base e a coluna: bomba, comando e motor tambem faltam no CD e o
   comprador precisa ver. */
export interface LinhaComponente {
  codigo: string;
  nome: string;
  /* BASE, COLUNA ou o que vier na planilha (BOMBA, COMANDO, MOTOR...). */
  tipo: string;
  /* Campo "in interface": o S deve ficar na coluna. */
  sn: string;
  /* Quantas unidades deste componente cada kit consome. */
  porKit: number;
  /* Quanto falta dele para o item fechar o alvo de kits. */
  faltam: number;
  cd: number;
  reversa: number;
  /* Quantos itens pai usam este mesmo componente. Acima de 1 o saldo do
     CD e o mesmo estoque nos dois lugares, entao a compra nao pode ser
     somada duas vezes. */
  paisQueUsam: number;
  /* Linha criada pelo sistema porque o kit nao tem esse lado cadastrado.
     Entra com saldo zero, para o comprador ver que falta o par. */
  ausente?: boolean;
}

export interface ItemFornecedor {
  item: string; // item pai (elevador)
  nome: string;
  marca: string;
  fabricante: string;
  tonelada: string;
  ratio: number;

  componentes: LinhaComponente[];
  bases: number;
  colunas: number;
  /* Colunas que as bases existentes pedem. */
  colunasNecessarias: number;
  deficit: number; // positivo falta coluna, negativo sobra coluna
  completos: number;
  /* Kits que dariam se o componente escasso fosse reposto. */
  alvo: number;
  /* Kits que dao para expedir com o produto inteiro, contando bomba,
     comando e o que mais compoe o kit. */
  expedivel: number;
  /* A montagem completa, com o que falta de cada componente. */
  montagem: MontagemDoKit;

  situacao: SituacaoItem;
  comprarColuna: number;
  comprarBase: number;
  /* Componentes do kit com saldo zero no CD, de qualquer tipo. */
  semSaldo: number;
  /* R$ parado: peca sem par (sobra depois de montar o que dava) vezes
     o preco do componente. So existe quando a SIGEQ278 foi importada;
     sem ela fica zero, nunca undefined. */
  valorParado: number;
  /* Componentes com sobra (peca sem par), e quantos deles a 278 nao
     conseguiu precificar - o lado que nao carrega o S na 051 vale
     zero, e por isso o R$ parado pode ficar subestimado (secao "mesma
     regra do Multiplos Descasados"). */
  componentesComSobra: number;
  componentesSemPreco: number;
}

export interface GrupoTonelada {
  tonelada: string;
  ratio: number;
  itens: ItemFornecedor[];
  descasados: number;
  comprarColuna: number;
  comprarBase: number;
  valorParado: number;
}

export interface GrupoFornecedor {
  fornecedor: string;
  marcas: string[];
  toneladas: GrupoTonelada[];
  itens: number;
  descasados: number;
  comprarColuna: number;
  comprarBase: number;
  /* Componentes deste fornecedor que servem mais de um elevador. */
  compartilhados: number;
  valorParado: number;
}

/* Nome que o comprador usa. O fabricante manda; a marca entra quando
   o fabricante nao veio preenchido. */
export function nomeDoFornecedor(c: { fabricante: string; marca: string }): string {
  return (String(c.fabricante ?? '').trim() || String(c.marca ?? '').trim() || '—');
}

/* Ordena tonelada de forma numerica: 2 t, 3 t, 3,2 t, 4 t. */
function ordemTonelada(t: string): number {
  return parseFloat(String(t ?? '').replace(',', '.')) || 0;
}

/* Base primeiro, coluna depois, o resto do kit em seguida. */
function ordemTipo(t: string): number {
  return t === 'BASE' ? 0 : t === 'COLUNA' ? 1 : 2;
}

function fecharItem(item: ItemFornecedor): ItemFornecedor {
  /* O kit e o que a estrutura do item diz que ele e. Nada de linha
     inventada: o 4570344 leva coluna e bomba, sem base nenhuma, e
     criar uma "base ausente" fazia a tela acusar descasamento e mandar
     comprar uma peca que o produto nao usa. */
  item.componentes.sort(
    (a, b) => ordemTipo(a.tipo) - ordemTipo(b.tipo) || a.tipo.localeCompare(b.tipo) ||
      a.codigo.localeCompare(b.codigo)
  );
  item.semSaldo = item.componentes.filter((c) => c.cd === 0).length;

  /* O casamento sai da composicao do kit, componente a componente, e
     nao da tonelada. Duas colunas diferentes no mesmo kit sao pecas
     distintas, e um produto de 4 t pode levar uma coluna so.

     Entra o kit inteiro, inclusive bomba e comando: eles nao mandam no
     casamento, que e do par base x coluna, mas limitam quantos kits
     dao para expedir de verdade. */
  const doKit = item.componentes;
  const montagem = montarKit(
    doKit.map((c) => ({ codigo: c.codigo, nome: c.nome, tipo: c.tipo, porKit: c.porKit, saldo: c.cd }))
  );
  item.montagem = montagem;
  item.completos = montagem.kits;
  item.expedivel = montagem.kitsCompletos;
  item.alvo = montagem.alvo;

  /* Devolve o que falta para a propria linha do componente, para a
     tela poder dizer QUAL peca falta em vez de "1 coluna". */
  for (const c of doKit) {
    c.faltam = montagem.componentes.find((m) => m.codigo === c.codigo)?.faltam ?? 0;
  }

  item.comprarBase = faltamDoTipo(montagem, 'BASE');
  item.comprarColuna = faltamDoTipo(montagem, 'COLUNA');
  /* Mantido para as telas que ainda leem o deficit em colunas. */
  item.colunasNecessarias = montagem.alvo;
  item.deficit = item.comprarColuna - item.comprarBase;

  if (montagem.semEstoque) {
    item.situacao = 'SEM ESTOQUE';
  } else {
    item.situacao = montagem.casado ? 'CASADO' : 'DESCASADO';
  }
  return item;
}

/* Preco do componente, na mesma ordem do modulo Multiplos Descasados:
   primeiro o valor unitario do proprio componente na QRY0390, quando
   existir. Ele costuma vir zerado nos componentes de kit - a
   valoracao do multiplo fica no pai, nao nas partes - e ai entra a
   SIGEQ278: o preco de custo do pai e atribuido so ao componente que
   carrega o S da 051 (in interface). O outro lado do par, sem preco
   proprio na 390 e sem o S, entra a zero: contar os dois dobraria o
   valor do mesmo conjunto parado. */
function precoComponente(codigo: string, sn: string, precoPai: number, precos390: MapaPrecos): number {
  const doProprioComponente = precos390.get(codigo) ?? 0;
  if (doProprioComponente > 0) return doProprioComponente;
  return sn === 'S' ? precoPai : 0;
}

interface AvaliacaoParada {
  valor: number;
  componentesComSobra: number;
  componentesSemPreco: number;
}

/* R$ da peca parada do item: sobra de cada componente (o que os kits
   montados nao consumiram, a mesma conta de saudeDoItem) vezes o
   preco dele. Conta tambem quantos componentes tem sobra e, desses,
   quantos ficaram sem preco - o lado que nao carrega o S vale zero,
   entao o total pode ser so o piso do valor parado, nao o valor
   inteiro (mesmo aviso do modulo Multiplos Descasados). */
function avaliarParadoDoItem(
  item: ItemFornecedor,
  precoPai: number,
  precos390: MapaPrecos
): AvaliacaoParada {
  const completos = item.montagem.kits;
  let valor = 0;
  let componentesComSobra = 0;
  let componentesSemPreco = 0;
  for (const c of item.componentes) {
    const sobra = Math.max(0, c.cd - completos * c.porKit);
    if (sobra <= 0) continue;
    componentesComSobra++;
    const preco = precoComponente(c.codigo, c.sn, precoPai, precos390);
    valor += sobra * preco;
    if (!preco) componentesSemPreco++;
  }
  return { valor, componentesComSobra, componentesSemPreco };
}

/* Monta a arvore Fornecedor -> Tonelada -> Item pai.

   Entram os kits que tem base ou coluna, que sao os elevadores do
   projeto. De cada kit vem o componente inteiro, incluindo bomba,
   comando e motor: eles nao entram na conta do casamento, mas faltam
   no CD do mesmo jeito e o comprador precisa ver. */
export function listarPorFornecedor(
  componentes: Componente[],
  precosPai: MapaPrecos = new Map(),
  precos390: MapaPrecos = new Map()
): GrupoFornecedor[] {
  const itens = new Map<string, ItemFornecedor>();
  const marcasPorFornecedor = new Map<string, Set<string>>();

  /* Primeiro descobre quais componentes servem mais de um elevador: o
     saldo deles e o mesmo estoque, e a compra nao pode dobrar. */
  const paisPorComponente = new Map<string, Set<string>>();
  for (const c of componentes) {
    const codigo = String(c.itemComponente ?? '').trim();
    const pai = String(c.itemVolMultiplo ?? '').trim();
    if (!codigo || !pai) continue;
    const pais = paisPorComponente.get(codigo) ?? new Set<string>();
    pais.add(pai);
    paisPorComponente.set(codigo, pais);
  }

  /* Quais itens pai sao elevadores do projeto: os que tem base ou
     coluna. O resto da planilha nao entra na lista de compra. */
  const kits = new Set<string>();
  for (const c of componentes) {
    if (tipoComponente(c) === 'OUTRO') continue;
    const pai = String(c.itemVolMultiplo ?? '').trim();
    if (pai) kits.add(pai);
  }

  for (const c of componentes) {
    const codigoPai = String(c.itemVolMultiplo ?? '').trim();
    if (!codigoPai || !kits.has(codigoPai)) continue;
    const bruto = tipoComponente(c);
    const tipo =
      bruto === 'OUTRO' ? String(c.componenteBaseColuna ?? '').trim().toUpperCase() || 'OUTRO' : bruto;

    const fornecedor = nomeDoFornecedor(c);
    let item = itens.get(codigoPai);
    if (!item) {
      item = {
        item: codigoPai,
        nome: c.nomeItemVolMultiplo,
        marca: c.marca,
        fabricante: fornecedor,
        tonelada: c.toneladaFixa || '—',
        ratio: ratioDaTonelada(c.toneladaFixa),
        componentes: [],
        bases: 0,
        colunas: 0,
        colunasNecessarias: 0,
        deficit: 0,
        completos: 0,
        expedivel: 0,
        alvo: 0,
        montagem: {
          kits: 0, kitsCompletos: 0, alvo: 0, componentes: [],
          limitantes: [], casado: false, semEstoque: true,
        },
        situacao: 'SEM ESTOQUE',
        comprarColuna: 0,
        comprarBase: 0,
        semSaldo: 0,
        valorParado: 0,
        componentesComSobra: 0,
        componentesSemPreco: 0,
      };
      itens.set(codigoPai, item);
    }

    const codigo = String(c.itemComponente ?? '').trim();
    item.componentes.push({
      codigo,
      nome: c.nomeItemComponente,
      tipo,
      sn: String(c.inInterface ?? '').trim().toUpperCase(),
      porKit: porKitDe(c),
      faltam: 0,
      cd: c.cd,
      reversa: c.reversa,
      paisQueUsam: paisPorComponente.get(codigo)?.size ?? 1,
    });
    /* So base e coluna entram na conta do casamento. */
    if (tipo === 'BASE') item.bases += c.cd;
    else if (tipo === 'COLUNA') item.colunas += c.cd;

    const marcas = marcasPorFornecedor.get(fornecedor) ?? new Set<string>();
    if (c.marca) marcas.add(c.marca);
    marcasPorFornecedor.set(fornecedor, marcas);
  }

  /* Agrupa os itens ja fechados por fornecedor e tonelada. */
  const grupos = new Map<string, Map<string, ItemFornecedor[]>>();
  for (const item of itens.values()) {
    fecharItem(item);
    const avaliacao = avaliarParadoDoItem(item, precosPai.get(item.item) ?? 0, precos390);
    item.valorParado = avaliacao.valor;
    item.componentesComSobra = avaliacao.componentesComSobra;
    item.componentesSemPreco = avaliacao.componentesSemPreco;
    const porTon = grupos.get(item.fabricante) ?? new Map<string, ItemFornecedor[]>();
    const lista = porTon.get(item.tonelada) ?? [];
    lista.push(item);
    porTon.set(item.tonelada, lista);
    grupos.set(item.fabricante, porTon);
  }

  const saida: GrupoFornecedor[] = [];
  for (const [fornecedor, porTon] of grupos) {
    const toneladas: GrupoTonelada[] = [];
    for (const [tonelada, lista] of porTon) {
      /* Quem tem mais peca a comprar aparece primeiro dentro da tonelada. */
      lista.sort(
        (a, b) =>
          b.comprarColuna + b.comprarBase - (a.comprarColuna + a.comprarBase) ||
          a.item.localeCompare(b.item)
      );
      toneladas.push({
        tonelada,
        ratio: lista[0].ratio,
        itens: lista,
        descasados: lista.filter((i) => i.situacao === 'DESCASADO').length,
        comprarColuna: lista.reduce((s, i) => s + i.comprarColuna, 0),
        comprarBase: lista.reduce((s, i) => s + i.comprarBase, 0),
        valorParado: lista.reduce((s, i) => s + i.valorParado, 0),
      });
    }
    toneladas.sort((a, b) => ordemTonelada(a.tonelada) - ordemTonelada(b.tonelada));

    const todos = toneladas.flatMap((t) => t.itens);
    saida.push({
      fornecedor,
      marcas: [...(marcasPorFornecedor.get(fornecedor) ?? [])].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      toneladas,
      itens: todos.length,
      descasados: todos.filter((i) => i.situacao === 'DESCASADO').length,
      comprarColuna: toneladas.reduce((s, t) => s + t.comprarColuna, 0),
      comprarBase: toneladas.reduce((s, t) => s + t.comprarBase, 0),
      compartilhados: new Set(
        todos.flatMap((i) => i.componentes.filter((c) => c.paisQueUsam > 1).map((c) => c.codigo))
      ).size,
      valorParado: toneladas.reduce((s, t) => s + t.valorParado, 0),
    });
  }

  /* Fornecedor com mais peca a comprar primeiro: e por onde o comprador
     comeca o dia. */
  saida.sort(
    (a, b) =>
      b.comprarColuna + b.comprarBase - (a.comprarColuna + a.comprarBase) ||
      a.fornecedor.localeCompare(b.fornecedor, 'pt-BR')
  );
  return saida;
}

/* Mensagem pronta para o comprador, em texto puro.

   Vai por e-mail, entao nada de tabela: um bloco por fornecedor, e
   dentro dele um bloco por elevador com o saldo de hoje, o que falta e
   os componentes que formam o conjunto. */
export function mensagemDeCompra(
  grupos: GrupoFornecedor[],
  opcoes: { data?: Date; local?: string } = {}
): string {
  const data = opcoes.data ?? new Date();
  const local = opcoes.local ?? 'CD Cajamar';
  const itens = grupos.reduce((s, g) => s + g.itens, 0);
  const colunas = grupos.reduce((s, g) => s + g.comprarColuna, 0);
  const bases = grupos.reduce((s, g) => s + g.comprarBase, 0);

  const linhas: string[] = [
    `Itens descasados no CD - ${local}`,
    `Posicao de ${data.toLocaleDateString('pt-BR')}`,
    '',
    `${itens} elevador(es) na lista. Faltam ${colunas} coluna(s) e ${bases} base(s) para fechar os conjuntos.`,
  ];

  for (const g of grupos) {
    linhas.push('', `${g.fornecedor.toUpperCase()}`, '-'.repeat(g.fornecedor.length));
    for (const t of g.toneladas) {
      for (const i of t.itens) {
        linhas.push(
          `${i.item} - ${i.nome || 'sem descricao'} (${i.tonelada}, ratio 1:${i.ratio})`,
          `   No CD hoje: ${i.bases} base(s) e ${i.colunas} coluna(s). ${textoCompra(i)}.`
        );
        for (const c of i.componentes) {
          const repete = c.paisQueUsam > 1 ? ` [serve ${c.paisQueUsam} elevadores]` : '';
          const codigo = c.ausente ? '(sem cadastro)' : c.codigo;
          linhas.push(`   ${c.tipo.padEnd(7)} ${codigo.padEnd(14)} saldo ${c.cd}  ${c.nome}${repete}`);
        }
        if (i.semSaldo > 0) {
          linhas.push(`   ${i.semSaldo} componente(s) do kit estao com saldo zero no CD.`);
        }
      }
    }
    linhas.push(
      `Total ${g.fornecedor}: comprar ${g.comprarColuna} coluna(s) e ${g.comprarBase} base(s).`
    );
  }

  const repetidos = grupos.reduce((s, g) => s + g.compartilhados, 0);
  if (repetidos > 0) {
    linhas.push(
      '',
      `Atencao: ${repetidos} componente(s) servem mais de um elevador. O saldo do CD deles e o mesmo`,
      'estoque em todos, entao a quantidade a comprar nao pode ser somada duas vezes.'
    );
  }
  return linhas.join('\n');
}

/* O que comprar, em texto curto, igual na tela e na copia. */
export function textoCompra(i: {
  situacao: SituacaoItem;
  comprarColuna: number;
  comprarBase: number;
}): string {
  if (i.situacao === 'SEM ESTOQUE') return 'sem estoque';
  const partes: string[] = [];
  if (i.comprarColuna > 0) partes.push(`${i.comprarColuna} coluna(s)`);
  if (i.comprarBase > 0) partes.push(`${i.comprarBase} base(s)`);
  return partes.length > 0 ? `comprar ${partes.join(' e ')}` : 'equalizado';
}


/* ============================================================
   Saude do estoque por fornecedor.

   Responde "quanto do que esta parado vira elevador vendavel". A conta
   e por unidade, nao por SKU: um fornecedor com 100 elevadores
   possiveis e 10 travados esta 90% OK.

   Usa so o saldo do CD. Reversa fica de fora de proposito: peca em
   reversa nao esta disponivel para montar nem para vender.
   ============================================================ */
export interface SaudeFornecedor {
  fornecedor: string;
  /* SKUs de elevador deste fornecedor. */
  itens: number;
  itensDescasados: number;
  /* Elevadores que dao para montar hoje. */
  completos: number;
  /* Elevadores que dariam se o estoque estivesse equalizado. */
  potencial: number;
  /* Diferenca entre os dois: elevador que nao fecha por falta de peca. */
  descasados: number;
  pctCompleto: number;
  pctDescasado: number;
  /* Pecas em estoque que nao formam elevador nenhum: o que esta parado
     sem virar venda. */
  pecasParadas: number;
  /* R$ das pecas paradas, pelo preco de custo do item pai (SIGEQ278).
     Zero quando a planilha de preco nao foi importada. */
  valorParado: number;
  /* Quantos componentes descasados existem e, desses, quantos a 278
     nao conseguiu precificar - avisa quando o R$ parado e so o piso. */
  componentesComSobra: number;
  componentesSemPreco: number;
}

function saudeDoItem(i: ItemFornecedor): { completos: number; potencial: number; paradas: number } {
  const completos = i.montagem.kits;
  /* Peca que sobrou depois de montar tudo que dava: nao vira venda
     enquanto o par nao chegar. */
  const paradas = i.montagem.componentes.reduce(
    (s, c) => s + Math.max(0, c.saldo - completos * c.porKit),
    0
  );
  return { completos, potencial: i.montagem.alvo, paradas };
}

export function saudePorFornecedor(grupos: GrupoFornecedor[]): SaudeFornecedor[] {
  const saida: SaudeFornecedor[] = grupos.map((g) => {
    const itens = g.toneladas.flatMap((t) => t.itens);
    let completos = 0;
    let potencial = 0;
    let pecasParadas = 0;
    let valorParado = 0;
    let componentesComSobra = 0;
    let componentesSemPreco = 0;
    for (const i of itens) {
      const s = saudeDoItem(i);
      completos += s.completos;
      potencial += s.potencial;
      pecasParadas += s.paradas;
      valorParado += i.valorParado;
      componentesComSobra += i.componentesComSobra;
      componentesSemPreco += i.componentesSemPreco;
    }
    const descasados = Math.max(0, potencial - completos);
    return {
      fornecedor: g.fornecedor,
      itens: itens.length,
      itensDescasados: itens.filter((i) => i.situacao === 'DESCASADO').length,
      completos,
      potencial,
      descasados,
      /* Sem potencial nenhum nao ha percentual: 0 de 0 nao e 0% nem
         100%, e ausencia de estoque. */
      pctCompleto: potencial > 0 ? (completos / potencial) * 100 : 0,
      pctDescasado: potencial > 0 ? (descasados / potencial) * 100 : 0,
      pecasParadas,
      valorParado,
      componentesComSobra,
      componentesSemPreco,
    };
  });
  /* Quem tem mais elevador travado aparece primeiro: e onde a compra
     destrava mais venda. */
  return saida.sort((a, z) => z.descasados - a.descasados || z.potencial - a.potencial);
}

/* Fornecedor sem nada no CD: nenhum elevador possivel e nenhuma peca
   parada. A linha dele so tem zero e traco, nao responde a pergunta do
   cartao e ainda empurra para baixo quem tem estoque de verdade. */
export function semNadaNoEstoque(l: SaudeFornecedor): boolean {
  return l.potencial === 0 && l.pecasParadas === 0;
}

export interface SaudeTotal {
  itens: number;
  completos: number;
  potencial: number;
  descasados: number;
  pctCompleto: number;
  pctDescasado: number;
  pecasParadas: number;
  valorParado: number;
  componentesComSobra: number;
  componentesSemPreco: number;
}

export function totalizarSaude(linhas: SaudeFornecedor[]): SaudeTotal {
  const soma = (f: (l: SaudeFornecedor) => number) => linhas.reduce((s, l) => s + f(l), 0);
  const completos = soma((l) => l.completos);
  const potencial = soma((l) => l.potencial);
  const descasados = Math.max(0, potencial - completos);
  return {
    itens: soma((l) => l.itens),
    completos,
    potencial,
    descasados,
    pctCompleto: potencial > 0 ? (completos / potencial) * 100 : 0,
    pctDescasado: potencial > 0 ? (descasados / potencial) * 100 : 0,
    pecasParadas: soma((l) => l.pecasParadas),
    valorParado: soma((l) => l.valorParado),
    componentesComSobra: soma((l) => l.componentesComSobra),
    componentesSemPreco: soma((l) => l.componentesSemPreco),
  };
}
