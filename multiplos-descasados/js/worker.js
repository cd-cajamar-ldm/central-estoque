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
  descricao: ['NOME_ITEM_FILHO','NOME_ITEM_PAI','Descrição','Descricao'],
  local: ['ID_LOCAL','Local'], descLocal: ['DESC_LOCAL'],
  quantidade: ['QTDE','Quantidade'], qtdeDisp: ['QTDE_DISP'], qtdeRom: ['QTDE_ROM'],
  valoriza: ['VALORIZA'], valorUnitario: ['VALOR_UNITARIO'],
  classeSku: ['CURVA_ABC','Classe Sku'], ean: ['EAN','Ean'],
  restricao: ['RETRICAO','RESTRICAO','Restrição'],
  log: ['LOG_ITEM'], x1: ['X1'], x2: ['X2'], predio: ['PREDIO'], classeLocal: ['CLAL'],
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

self.onmessage = async (e)=>{
  const msg = e.data;
  try{
    if(msg.type === 'process051') await runPipeline051(msg);
    else if(msg.type === 'process390') await runPipeline390(msg);
    else if(msg.type === 'process278') await runPipeline278(msg);
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
  // A chave é o componente: a extração traz cada componente uma vez só, ligado
  // a um pai. Se um dia vier repetido, a última linha vence — e o número de
  // duplicatas volta pra tela pra ninguém descobrir isso por acaso.
  const porComponente = new Map();
  let duplicatas = 0, semPai = 0;
  for(const row of rows){
    const componente = mdNormItemKey(getVal(row, r.itemComponente));
    const pai = mdNormItemKey(getVal(row, r.itemPai));
    if(!componente || !pai){ semPai++; continue; }
    if(porComponente.has(componente)) duplicatas++;
    const qtde = parseNumber(getVal(row, r.qtde));
    porComponente.set(componente, {
      componente, pai,
      qtde: qtde > 0 ? qtde : 1,
      inInterface: String(getVal(row, r.inInterface) ?? '').trim().toUpperCase(),
      usuario: String(getVal(row, r.usuario) ?? '').trim(),
      datahora: String(getVal(row, r.datahora) ?? '').trim()
    });
  }
  const linhas = Array.from(porComponente.values());
  const pais = new Set(linhas.map(l=>l.pai));

  post('progress', {stage:'Gravando...', pct:80});
  await mdSalvarEstrutura(linhas, {
    importadoEm: new Date().toISOString(),
    linhas: rows.length, componentes: linhas.length, pais: pais.size,
    duplicatas, semPai
  });
  post('done051', {componentes: linhas.length, pais: pais.size, duplicatas, semPai});
}

/* ---------- QRY0390 — SALDO DOS COMPONENTES ----------
   Guarda só os itens que a estrutura conhece, com os endereços junto: é o que a
   tela precisa pra dizer ONDE está a peça descasada. O ITEM_PAI da 390 é
   ignorado de propósito — hoje ele repete o próprio item em toda linha, e
   confiar nele levaria a um módulo vazio sem nenhum aviso. */
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

  post('progress', {stage:'Cruzando com os componentes...', pct:35});
  const porItem = new Map();
  let atualizadoEm = '', linhasUsadas = 0;
  for(const row of rows){
    const item = mdNormItemKey(getVal(row, r.item));
    if(!item || !componentes.has(item)) continue;
    linhasUsadas++;
    if(!atualizadoEm){
      const at = getVal(row, r.atualizadoEm);
      if(at) atualizadoEm = (at instanceof Date) ? at.toISOString() : String(at);
    }
    let it = porItem.get(item);
    if(!it){
      it = {
        item,
        nome: String(getVal(row, r.descricao) ?? '').trim(),
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
        qtde: 0, qtdeDisp: 0, locais: []
      };
      porItem.set(item, it);
    }
    const qtde = parseNumber(getVal(row, r.quantidade));
    // QTDE_DISP pode não vir na extração antiga; sem ela, o disponível é a
    // própria quantidade, senão a visão "só disponível" zeraria o módulo.
    const disp = r.qtdeDisp ? parseNumber(getVal(row, r.qtdeDisp)) : qtde;
    it.qtde += qtde;
    it.qtdeDisp += disp;
    if(!it.valorUnitario) it.valorUnitario = parseNumber(getVal(row, r.valorUnitario));
    it.locais.push({
      local: String(getVal(row, r.local) ?? '').trim(),
      desc: String(getVal(row, r.descLocal) ?? '').trim(),
      x1: String(getVal(row, r.x1) ?? '').trim(),
      x2: String(getVal(row, r.x2) ?? '').trim(),
      predio: String(getVal(row, r.predio) ?? '').trim(),
      clal: String(getVal(row, r.classeLocal) ?? '').trim(),
      restricao: String(getVal(row, r.restricao) ?? '').trim(),
      qtde, qtdeDisp: disp
    });
  }
  for(const it of porItem.values()){
    it.locais.sort((a,b)=>b.qtde - a.qtde);
  }

  post('progress', {stage:'Gravando saldos...', pct:80});
  const linhas = Array.from(porItem.values());
  const semSaldo = componentes.size - linhas.length;
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
