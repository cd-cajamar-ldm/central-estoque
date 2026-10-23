/* ============================================================
   Web Worker — Múltiplos Descasados
   ============================================================
   Lê as planilhas no navegador (SheetJS) e grava o resultado no IndexedDB do
   módulo. Roda fora da thread da tela porque a QRY0390 vem com ~100 mil linhas
   e ler isso na thread principal congela a página inteira.

   Ordem obrigatória: ZBIQ0051 antes da QRY0390. A 051 é quem diz quais itens
   são componentes de múltiplo, e é por ela que a 390 é filtrada — sem a
   estrutura salva, não há como saber o que guardar, e o worker diz isso em vez
   de gravar 33 mil itens que ninguém vai ler.
   ============================================================ */
importScripts('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
importScripts('./rules.js');
importScripts('./db.js');

function parseNumber(v){
  if(v===undefined || v===null || v==='') return 0;
  if(typeof v === 'number') return v;
  let s = String(v).trim();
  if(!s) return 0;
  s = s.replace(/[^\d,.\-]/g,'');
  const hasComma = s.includes(','), hasDot = s.includes('.');
  if(hasComma && hasDot){
    if(s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g,'').replace(',','.');
    else s = s.replace(/,/g,'');
  } else if(hasComma){
    s = s.replace(/\./g,'').replace(',','.');
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function buildAliasResolver(headers, aliasMap){
  const resolved = {};
  const normHeaders = headers.map(h=>({raw:h, norm: mdNormKey(h)}));
  for(const canon in aliasMap){
    let found = null;
    for(const cand of aliasMap[canon]){
      const nc = mdNormKey(cand);
      const hit = normHeaders.find(h=>h.norm===nc);
      if(hit){ found = hit.raw; break; }
    }
    resolved[canon] = found;
  }
  return resolved;
}
function sheetToRows(wb){
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, {defval:null, raw:true});
}
function getVal(row, key){ return key ? row[key] : null; }
function validateColumns(resolved, required, label){
  const missing = required.filter(k=>!resolved[k]);
  if(missing.length) throw new Error(`${label}: colunas obrigatórias não encontradas: ${missing.join(', ')}`);
}
function post(type, payload){ self.postMessage({type, ...payload}); }

/* Os mesmos apelidos de coluna do Inventário — a extração da 390 virou
   automática (Snowflake) e trocou de nomes uma vez; manter os dois jogos de
   nomes evita que o módulo quebre se ela voltar ao formato antigo. */
const ALIAS_390 = {
  item: ['ID_ITEM_FILHO','Item'], itemPai: ['ITEM_PAI'],
  // 'Descrição2' entra ANTES de 'Descrição' de propósito: numa variante da
  // extração (saída do fluxo Snowflake com o item pela ótica do local) a
  // coluna 'Descrição' vem com o ENDEREÇO, não o nome do item — o nome certo
  // fica em 'Descrição2'. mdNormKey tira os underscores, então 'Descrição2' e
  // 'Descrição_2' normalizam igual; a ordem das COLUNAS no arquivo é quem
  // desempata (a de nome de item vem primeiro nessa variante). Nos formatos
  // de sempre, sem 'Descrição2' nenhuma, cai em 'Descrição' como já era.
  descricao: ['NOME_ITEM_FILHO','Descrição2','Descrição','Descricao'],
  descricaoPai: ['NOME_ITEM_PAI'],
  local: ['ID_LOCAL','Local'], descLocal: ['DESC_LOCAL'],
  quantidade: ['QTDE','Quantidade'], qtdeDisp: ['QTDE_DISP'],
  qtdeRom: ['QTDE_ROM','Quantidade Romaneada'],
  valoriza: ['VALORIZA'], valorUnitario: ['VALOR_UNITARIO'],
  classeSku: ['CURVA_ABC','Classe Sku'], ean: ['EAN','Ean'],
  restricao: ['RETRICAO','RESTRICAO','Restrição'],
  log: ['LOG_ITEM'], x1: ['X1'], x2: ['X2'], predio: ['PREDIO'],
  classeLocal: ['CLAL','Classe Local'],
  setor: ['NM_SETOR'], familia: ['NM_FAMILIA'], marca: ['NM_MARCA'],
  departamento: ['NM_DEPARTAMENTO'],
  atualizadoEm: ['ULTIMA_ATUALIZACAO']
};
const ALIAS_051 = {
  itemPai: ['item_vol_multiplo'], itemComponente: ['item_componente'],
  qtde: ['qtde'], inInterface: ['in_interface'], usuario: ['usuario'], datahora: ['datahora']
};
const ALIAS_278 = {
  item: ['Item'], nomeItem: ['Nome item','Nome Item'],
  precoCusto: ['Preço de custo','Preco de custo'], precoCompra: ['Preço de compra','Preco de compra']
};
const ALIAS_0160 = {
  item: ['Item'], local: ['Local'], restricao: ['Restrição','Restricao'],
  numEstoque: ['Num. Estoque','Num Estoque','NUM_ESTOQUE']
};

self.onmessage = async (e)=>{
  const msg = e.data;
  try{
    if(msg.type === 'process051') await runPipeline051(msg);
    else if(msg.type === 'process390') await runPipeline390(msg);
    else if(msg.type === 'process278') await runPipeline278(msg);
    else if(msg.type === 'process0160') await runPipeline0160(msg);
  }catch(err){
    post('erro', {origem: msg.type, message: err.message || String(err)});
  }
};

/* ---------- ZBIQ0051 — ESTRUTURA DO MÚLTIPLO ---------- */
async function runPipeline051({buf051}){
  post('progress', {stage:'Lendo ZBIQ0051...', pct:8});
  const wb = XLSX.read(buf051, {type:'array', cellDates:true});
  const rows = sheetToRows(wb);
  if(!rows.length) throw new Error('ZBIQ0051: planilha vazia.');
  const r = buildAliasResolver(Object.keys(rows[0]), ALIAS_051);
  validateColumns(r, ['itemPai','itemComponente'], 'ZBIQ0051');

  post('progress', {stage:'Montando a estrutura dos múltiplos...', pct:45});
  // A chave é componente+pai, não só o componente: um componente pode ser
  // parte de mais de um múltiplo (ex.: uma base usada em dois modelos de
  // elevador diferentes). Chave só por componente apagava essa segunda
  // ligação em silêncio — a última linha "vencia" e o componente sumia do
  // múltiplo anterior sem nenhum aviso, descasando a conta de bloquear/
  // liberar daquele pai. "Duplicata" agora é só a mesma linha (componente
  // + pai) repetida de verdade; componente em mais de um pai conta à parte.
  const porChave = new Map();
  const componentesVistos = new Set();
  let duplicatas = 0, semPai = 0, compartilhados = 0;
  for(const row of rows){
    const componente = mdNormItemKey(getVal(row, r.itemComponente));
    const pai = mdNormItemKey(getVal(row, r.itemPai));
    if(!componente || !pai){ semPai++; continue; }
    const chave = componente + '|' + pai;
    if(porChave.has(chave)) duplicatas++;
    else if(componentesVistos.has(componente)) compartilhados++;
    componentesVistos.add(componente);
    const qtde = parseNumber(getVal(row, r.qtde));
    porChave.set(chave, {
      componente, pai,
      qtde: qtde > 0 ? qtde : 1,
      inInterface: String(getVal(row, r.inInterface) ?? '').trim().toUpperCase(),
      usuario: String(getVal(row, r.usuario) ?? '').trim(),
      datahora: String(getVal(row, r.datahora) ?? '').trim()
    });
  }
  const linhas = Array.from(porChave.values());
  const pais = new Set(linhas.map(l=>l.pai));

  post('progress', {stage:'Gravando...', pct:80});
  await mdSalvarEstrutura(linhas, {
    importadoEm: new Date().toISOString(),
    linhas: rows.length, componentes: linhas.length, pais: pais.size,
    duplicatas, semPai, compartilhados
  });
  post('done051', {componentes: linhas.length, pais: pais.size, duplicatas, semPai, compartilhados});
}

/* ---------- QRY0390 — SALDO DE TODO ITEM DO CD ----------
   Guarda TODO item com saldo, componente de múltiplo ou não: Ajustes de
   Restrição e Auditoria de Restrição precisam de qualquer peça do CD, não só
   do que está na ZBIQ0051 — a estrutura só importa pra quem faz o pareamento
   de múltiplos (mdPais em app.js), que busca o componente por código e ignora
   o resto sozinho. O ITEM_PAI da 390 é ignorado de propósito — hoje ele repete
   o próprio item em toda linha, e confiar nele levaria a um módulo vazio sem
   nenhum aviso. */
async function runPipeline390({buf390}){
  post('progress', {stage:'Conferindo a estrutura salva...', pct:3});
  const estrutura = await mdGetEstrutura();
  if(!estrutura.length){
    throw new Error('importe a ZBIQ0051 antes — é ela que diz quais itens são componentes de múltiplo.');
  }
  const componentes = new Set(estrutura.map(l=>l.componente));

  post('progress', {stage:'Lendo QRY0390...', pct:8});
  const wb = XLSX.read(buf390, {type:'array', cellDates:true});
  const rows = sheetToRows(wb);
  if(!rows.length) throw new Error('QRY0390: planilha vazia.');
  const r = buildAliasResolver(Object.keys(rows[0]), ALIAS_390);
  validateColumns(r, ['item','local','quantidade'], 'QRY0390');

  post('progress', {stage:'Agregando por item...', pct:35});
  const porItem = new Map();
  const componentesComSaldo = new Set();
  let atualizadoEm = '', linhasUsadas = 0;
  for(const row of rows){
    const item = mdNormItemKey(getVal(row, r.item));
    if(!item) continue;

    const local = String(getVal(row, r.local) ?? '').trim();
    const restricao = String(getVal(row, r.restricao) ?? '').trim().toUpperCase();
    const qtde = parseNumber(getVal(row, r.quantidade));
    const disp = r.qtdeDisp ? parseNumber(getVal(row, r.qtdeDisp)) : qtde;
    const rom = r.qtdeRom ? parseNumber(getVal(row, r.qtdeRom)) : 0;

    linhasUsadas++;
    if(componentes.has(item)) componentesComSaldo.add(item);
    if(!atualizadoEm){
      const at = getVal(row, r.atualizadoEm);
      if(at) atualizadoEm = (at instanceof Date) ? at.toISOString() : String(at);
    }
    let it = porItem.get(item);
    if(!it){
      it = {
        item,
        nome: String(getVal(row, r.descricao) ?? '').trim(),
        // Nome do ITEM PAI (o múltiplo), não do componente — a 390 traz os
        // dois nomes, um por coluna. Sem isso, a tela de Descasados mostrava
        // o nome do componente marcado VALORIZA na linha do pai, que não é o
        // nome certo quando o pai tem nome próprio na 390.
        nomePai: String(getVal(row, r.descricaoPai) ?? '').trim(),
        ean: String(getVal(row, r.ean) ?? '').trim(),
        valorUnitario: parseNumber(getVal(row, r.valorUnitario)),
        // VALORIZA diz se o item carrega valor. Componente marcado como não
        // valorizado tem preço zero por regra, não por falta de dado — é o que
        // impede a tela de acusar "preço faltando" onde o certo é zero.
        valoriza: String(getVal(row, r.valoriza) ?? '').trim().toUpperCase(),
        curva: String(getVal(row, r.classeSku) ?? '').trim(),
        log: String(getVal(row, r.log) ?? '').trim(),
        setor: String(getVal(row, r.setor) ?? '').trim(),
        familia: String(getVal(row, r.familia) ?? '').trim(),
        marca: String(getVal(row, r.marca) ?? '').trim(),
        departamento: String(getVal(row, r.departamento) ?? '').trim(),
        qtde: 0, qtdeDisp: 0,
        // Saldo separado por RESTRIÇÃO. É o eixo do módulo: casar só acontece
        // entre peças vendáveis (WN), e o ajuste é sempre de uma restrição pra
        // outra. Sem esse corte, um componente com 5 peças em WN e 5 em 86
        // parece ter 10 disponíveis pra casar.
        porRestricao: {},
        // Endereços agregados por LOCAL + RESTRIÇÃO, pra somar e mostrar o saldo
        // total do endereço nas telas. Mas o coletor (10/12.MOVI) recusa mover
        // uma quantidade que precise juntar lotes diferentes — dá "IMPOSSÍVEL
        // FUNDIR". Por isso cada lote (linha da 390) também fica guardado à
        // parte em `refs`: quem monta o plano de ajuste aloca lote por lote,
        // nunca juntando dois num endereço só.
        porLocal: new Map(),
        locais: []
      };
      porItem.set(item, it);
    }
    it.qtde += qtde;
    it.qtdeDisp += disp;
    const acc = it.porRestricao[restricao] || (it.porRestricao[restricao] = {qtde:0, qtdeDisp:0});
    acc.qtde += qtde;
    acc.qtdeDisp += disp;
    if(!it.valorUnitario) it.valorUnitario = parseNumber(getVal(row, r.valorUnitario));
    const chave = local + '|' + restricao;
    let lugar = it.porLocal.get(chave);
    if(!lugar){
      lugar = {
        local,
        desc: String(getVal(row, r.descLocal) ?? '').trim(),
        x1: String(getVal(row, r.x1) ?? '').trim(),
        x2: String(getVal(row, r.x2) ?? '').trim(),
        predio: String(getVal(row, r.predio) ?? '').trim(),
        clal: String(getVal(row, r.classeLocal) ?? '').trim(),
        restricao,
        qtde: 0, qtdeDisp: 0, qtdeRom: 0, lotes: 0, refs: []
      };
      it.porLocal.set(chave, lugar);
    }
    lugar.qtde += qtde;
    lugar.qtdeDisp += disp;
    lugar.qtdeRom += rom;
    lugar.lotes++;
    lugar.refs.push({qtde, qtdeDisp: disp, qtdeRom: rom});
  }
  for(const it of porItem.values()){
    // Map não sobrevive à gravação estruturada do IndexedDB do jeito que a tela
    // espera ler; vira lista aqui, já ordenada pelo maior saldo — que é a ordem
    // em que os endereços serão consumidos no plano de ajuste.
    it.locais = Array.from(it.porLocal.values()).sort((a,b)=>b.qtde - a.qtde);
    delete it.porLocal;
  }

  post('progress', {stage:'Gravando saldos...', pct:85});
  const linhas = Array.from(porItem.values());
  // "Sem saldo" conta só componente de múltiplo (é o único universo conhecido
  // de antemão, pela ZBIQ0051) — não existe "total de itens esperados" pra
  // comparar quando o saldo cobre o CD inteiro.
  const semSaldo = componentes.size - componentesComSaldo.size;
  await mdSalvarSaldo(linhas, {
    importadoEm: new Date().toISOString(),
    atualizadoEm,
    linhas: rows.length, linhasUsadas,
    itens: linhas.length, componentesEstrutura: componentes.size, semSaldo
  });
  post('done390', {itens: linhas.length, linhas: rows.length, linhasUsadas, semSaldo});
}

/* ---------- SIGEQ278 — PREÇO DE CUSTO (opcional) ----------
   Existe porque a 390 traz VALOR_UNITARIO zerado nos componentes de múltiplo: o
   preço está no item PAI, e o pai não tem estoque próprio. Guarda só os pais
   que a estrutura conhece. */
async function runPipeline278({buf278}){
  post('progress', {stage:'Conferindo a estrutura salva...', pct:3});
  const estrutura = await mdGetEstrutura();
  if(!estrutura.length){
    throw new Error('importe a ZBIQ0051 antes — sem ela não há pai de múltiplo pra valorar.');
  }
  const pais = new Set(estrutura.map(l=>l.pai));

  post('progress', {stage:'Lendo SIGEQ278...', pct:20});
  const wb = XLSX.read(buf278, {type:'array', cellDates:true});
  const rows = sheetToRows(wb);
  if(!rows.length) throw new Error('SIGEQ278: planilha vazia.');
  const r = buildAliasResolver(Object.keys(rows[0]), ALIAS_278);
  validateColumns(r, ['item'], 'SIGEQ278');
  if(!r.precoCusto && !r.precoCompra){
    throw new Error('SIGEQ278: não encontrei "Preço de custo" nem "Preço de compra".');
  }

  post('progress', {stage:'Cruzando com os pais de múltiplo...', pct:55});
  const porItem = new Map();
  for(const row of rows){
    const item = mdNormItemKey(getVal(row, r.item));
    if(!item || !pais.has(item)) continue;
    const preco = parseNumber(getVal(row, r.precoCusto)) || parseNumber(getVal(row, r.precoCompra));
    if(!preco) continue;
    porItem.set(item, {item, preco, nome: String(getVal(row, r.nomeItem) ?? '').trim()});
  }

  post('progress', {stage:'Gravando preços...', pct:85});
  const linhas = Array.from(porItem.values());
  await mdSalvarPrecos(linhas, {
    importadoEm: new Date().toISOString(),
    linhas: rows.length, pais: linhas.length, paisEstrutura: pais.size
  });
  post('done278', {pais: linhas.length, semPreco: pais.size - linhas.length});
}

/* ---------- QRY0160 — ESTOQUE POR RESTRIÇÃO (opcional) ----------
   A QRY0390 soma a quantidade por item+local+restrição numa linha só, sem
   dizer se veio de 1 ou mais registros físicos de "Estoque" — é o que faz o
   coletor recusar a Alt.Restrição Local em massa com "IMPOSSÍVEL FUNDIR"
   quando há 2+. A QRY0160 traz um Num. Estoque por registro físico; contando
   quantos distintos caem no mesmo item+local+restrição dá o sinal de verdade.
   Atualiza uma vez por dia (a 390 atualiza a cada 10min): o número de estoques
   separados de um item/local não muda rápido o bastante pra isso importar. */
async function runPipeline0160({buf0160}){
  post('progress', {stage:'Lendo QRY0160...', pct:10});
  const wb = XLSX.read(buf0160, {type:'array', cellDates:true});
  const rows = sheetToRows(wb);
  if(!rows.length) throw new Error('QRY0160: planilha vazia.');
  const r = buildAliasResolver(Object.keys(rows[0]), ALIAS_0160);
  validateColumns(r, ['item','local','restricao','numEstoque'], 'QRY0160');

  post('progress', {stage:'Contando estoques por item/local/restrição...', pct:50});
  const porChave = new Map();
  for(const row of rows){
    const item = mdNormItemKey(getVal(row, r.item));
    if(!item) continue;
    const local = String(getVal(row, r.local) ?? '').trim();
    const restricao = String(getVal(row, r.restricao) ?? '').trim().toUpperCase();
    const numEstoque = String(getVal(row, r.numEstoque) ?? '').trim();
    if(!numEstoque) continue;
    const chave = item + '|' + local + '|' + restricao;
    let g = porChave.get(chave);
    if(!g){ g = {chave, item, local, restricao, nums: new Set()}; porChave.set(chave, g); }
    g.nums.add(numEstoque);
  }
  const linhas = Array.from(porChave.values()).map(g=>({chave: g.chave, item: g.item, local: g.local, restricao: g.restricao, estoques: g.nums.size}));
  const quebrados = linhas.filter(l=>l.estoques > 1).length;

  post('progress', {stage:'Gravando...', pct:85});
  await mdSalvarEstoques(linhas, {
    importadoEm: new Date().toISOString(),
    linhas: rows.length, combinacoes: linhas.length, quebrados
  });
  post('done0160', {combinacoes: linhas.length, quebrados});
}
