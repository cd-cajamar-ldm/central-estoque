/* ============================================================
   Web Worker — Gestão de Transitórios
   ============================================================
   Só o que o transitório precisa: QRY0390 (ficha do item e do endereço),
   QRY0160 (saldo por endereço com data de movimento) e QRY410 (ganhos do ano,
   que viram a coluna "provável duplicidade").

   O cálculo do ciclo rotativo (843, congelada, 278, 051) não está aqui: é do
   Inventário, e nada nesta tela depende dele. Grava no MESMO IndexedDB —
   os dois módulos são da mesma origem, e é o que evita importar duas vezes.
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
function parseDateVal(v){
  if(v===undefined || v===null || v==='') return null;
  if(v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if(typeof v === 'number'){
    const d = XLSX.SSF.parse_date_code(v);
    if(!d) return null;
    return new Date(d.y, d.m-1, d.d, d.H||0, d.M||0, d.S||0);
  }
  const s = String(v).trim();
  let m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if(m){
    let [, dd, mm, yy, H, M, S] = m;
    yy = yy.length===2 ? ('20'+yy) : yy;
    const d = new Date(+yy, +mm-1, +dd, +(H||0), +(M||0), +(S||0));
    return isNaN(d.getTime()) ? null : d;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if(m) return new Date(+m[1], +m[2]-1, +m[3]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function irNormItemKey(v){
  const s = String(v ?? '').trim();
  if(s==='') return '';
  const n = Number(s);
  return (Number.isFinite(n) && Number.isInteger(n)) ? String(n) : s;
}
function buildAliasResolver(headers, aliasMap){
  const resolved = {};
  const normHeaders = headers.map(h=>({raw:h, norm: irNormKey(h)}));
  for(const canon in aliasMap){
    let found = null;
    for(const cand of aliasMap[canon]){
      const nc = irNormKey(cand);
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
const ALIAS_390 = {
  item: ['ID_ITEM_FILHO','Item'], itemPai: ['ITEM_PAI'],
  descricao: ['NOME_ITEM_FILHO','NOME_ITEM_PAI','Descrição','Descricao'],
  codTerceiro: ['Cod Terceiro'],
  local: ['ID_LOCAL','Local'],
  // Descrição do endereço: fecha a lacuna que fazia a auditoria imprimir o código
  // do local sem dizer onde ele fica.
  descLocal: ['DESC_LOCAL'],
  situacao: ['Situação','Situacao'],
  quantidade: ['QTDE','Quantidade'],
  qtdeDisp: ['QTDE_DISP'], qtdeRom: ['QTDE_ROM'],
  classeSku: ['CURVA_ABC','Classe Sku'],
  ean: ['EAN','Ean','Código de Barras','Codigo de Barras','Cod Barras','Cód.Barras','Cod.Barras'],
  valoriza: ['VALORIZA'], valorUnitario: ['VALOR_UNITARIO'],
  log: ['LOG_ITEM'], x1: ['X1'], x2: ['X2'], predio: ['PREDIO'], classeLocal: ['CLAL'],
  setor: ['NM_SETOR'], familia: ['NM_FAMILIA'], marca: ['NM_MARCA'],
  atualizadoEm: ['ULTIMA_ATUALIZACAO']
};
const ALIAS_160 = {
  item: ['Item'], descricao: ['Descrição item','Descricao item'], ean: ['EAN','Ean'],
  local: ['Local'], endereco: ['Endereço','Endereco'],
  x1: ['X1'], x2: ['X2'], x3: ['X3'], x4: ['X4'],
  restricao: ['Restrição','Restricao'], qtd: ['Qt'], qtdRom: ['Qt Rom'],
  operador: ['Operador'], dataMovimento: ['Data Movimento'], dataLimite: ['Data Limite'],
  numEstoque: ['Num. Estoque','Num Estoque']
};
const ALIAS_410 = {
  item: ['Item'], nomeItem: ['Nome'], dtMov: ['Dt.Mov.','Dt Mov','Data Mov'],
  quantidade: ['Quantidade'], sentido: ['Sentido'], vlMov: ['Vl.Mov.','Vl Mov'],
  idDeposito: ['Id Deposito','Id Depósito'], obsWms: ['Observacao WMS','Observação WMS'],
  // Evidência do lançamento (documento, quem fez, quando) — não entra em nenhum
  // cálculo, só fica junto do item pra provar o movimento quando alguém perguntar
  // "por que esse item mudou" (ex.: "item X, doc 460816, fulano, 13/08 17:38").
  numDoc: ['Num Doc','Num.Doc','Numero Doc'], usuario: ['Usuário','Usuario'], dataHora: ['Data/Hora','Data Hora']
};
function post(type, data){ self.postMessage({type, ...data}); }
function isoDateTime(d){
  if(!d) return '';
  const p = n => String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());
}
async function runPipeline390({buf390}){
  post('progress', {stage:'Lendo QRY0390...', pct:5});
  const wb = XLSX.read(buf390, {type:'array', cellDates:true});
  const rows = sheetToRows(wb);
  if(!rows.length) throw new Error('QRY0390: planilha vazia.');
  const r = buildAliasResolver(Object.keys(rows[0]), ALIAS_390);
  validateColumns(r, ['item','local','quantidade'], 'QRY0390');

  post('progress', {stage:'Agregando '+rows.length+' linha(s) por endereço...', pct:20});
  const porLocal = new Map();
  // Ficha do item: EAN e descrição. Gravada aqui porque a QRY0390 é a única base
  // com código de barras, e ela é atualizada sozinha — assim a auditoria tem EAN
  // sem depender de reprocessar ciclo nenhum.
  const porItem = new Map();
  let valorTotal = 0, pecasTotal = 0, atualizadoEm = '';
  let n = 0;
  for(const row of rows){
    if(++n % 20000 === 0) post('progress', {stage:'Linha '+n+' de '+rows.length+'...', pct:20+Math.round(n/rows.length*60)});
    const local = irNormItemKey(getVal(row, r.local));
    if(!local) continue;
    const item = irNormItemKey(getVal(row, r.item));
    if(item && !porItem.has(item)){
      porItem.set(item, {item,
        ean: String(getVal(row, r.ean) ?? '').trim(),
        descricao: String(getVal(row, r.descricao) ?? '').trim(),
        // Preço unitário da 390: terceira fonte de valor, depois da 410 e da 278.
        // VALORIZA diz se o item carrega valor — componente marcado como não
        // valorizado tem preço zero por regra, não por falta de dado.
        valorUnitario: parseNumber(getVal(row, r.valorUnitario)),
        valoriza: String(getVal(row, r.valoriza) ?? '').trim().toUpperCase(),
        log: String(getVal(row, r.log) ?? '').trim(),
        // Endereços onde o item tem saldo HOJE. Guardado aqui, e não só no
        // processamento do ciclo, pra auditoria enxergar o estoque atual sem
        // depender de quando o ciclo foi processado nem de a 390 ter sido anexada.
        locais: []});
    }
    const qtd = parseNumber(getVal(row, r.quantidade));
    // VALOR_ITEM_LOCAL não está no alias porque só existe no layout novo; quando
    // falta, o valor sai de quantidade x valor unitário.
    const vUnit = parseNumber(getVal(row, r.valorUnitario));
    const valor = parseNumber(getVal(row, 'VALOR_ITEM_LOCAL')) || (qtd * vUnit);
    let g = porLocal.get(local);
    if(!g){
      g = {local,
        desc: String(getVal(row, r.descLocal) ?? '').trim(),
        x1: String(getVal(row, r.x1) ?? '').trim(),
        x2: String(getVal(row, r.x2) ?? '').trim(),
        clal: String(getVal(row, r.classeLocal) ?? '').trim(),
        predio: String(getVal(row, r.predio) ?? '').trim(),
        log: String(getVal(row, r.log) ?? '').trim(),
        // Peças por LOG dentro do mesmo endereço: um transitório recebe carga de
        // mais de um LOG, e o relatório de pendência abre justamente por LOG.
        qtd:0, valor:0, itens:0, porLog:{}, _itens:new Set()};
      porLocal.set(local, g);
    }
    g.qtd += qtd;
    g.valor += valor;
    if(item && qtd){
      const gi = porItem.get(item);
      gi.locais.push({local, qtd, desc: String(getVal(row, r.descLocal) ?? '').trim()});
    }
    const lg = String(getVal(row, r.log) ?? '').trim() || 'S/CAD';
    g.porLog[lg] = (g.porLog[lg] || 0) + qtd;
    if(item) g._itens.add(item);
    valorTotal += valor; pecasTotal += qtd;
    if(!atualizadoEm){
      const d = parseDateVal(getVal(row, r.atualizadoEm));
      if(d && !isNaN(d.getTime())) atualizadoEm = isoDateTime(d);
    }
  }
  const linhas = Array.from(porLocal.values()).map(g=>{
    g.itens = g._itens.size; delete g._itens; return g;
  });

  post('progress', {stage:'Gravando estoque no IndexedDB...', pct:88});
  // Agrega o saldo por endereço dentro do item (o mesmo item pode aparecer em
  // várias linhas do mesmo local, por lote) e ordena do maior saldo pro menor.
  const fichas = Array.from(porItem.values()).map(g=>{
    const m = new Map();
    for(const l of g.locais){
      if(!m.has(l.local)) m.set(l.local, {local:l.local, qtd:0, desc:l.desc});
      const x = m.get(l.local); x.qtd += l.qtd; if(!x.desc && l.desc) x.desc = l.desc;
    }
    g.locais = Array.from(m.values()).filter(x=>x.qtd!==0).sort((a,b)=>b.qtd-a.qtd);
    return g;
  });
  await irSalvarItemInfo(fichas);
  // Ficha do endereço: é daqui que sai a CLASSE LOCAL, que define o setor dono do
  // transitório. A QRY0160 não tem essa coluna, então ela consulta este dicionário.
  await irSalvarLocalInfo(linhas.map(l=>({
    local:l.local, desc:l.desc, x1:l.x1, x2:l.x2, clal:l.clal, predio:l.predio, log:l.log
  })));
  // A QRY0390 grava só as FICHAS (item e endereço). O agregado por endereço é da
  // QRY0160, que tem a data de movimento — se as duas escrevessem no mesmo lugar,
  // reimportar a 390 apagaria as datas e a tabela de transitórios voltava a zero.
  await irSetConfig('estoque390-ficha', {
    atualizadoEm, importadoEm: new Date().toISOString(),
    linhas: rows.length, locais: linhas.length, itens: porItem.size, valorTotal, pecasTotal
  });
  post('progress', {stage:'Concluído.', pct:100});
  self.postMessage({type:'done390', locais: linhas.length, itens: porItem.size, valorTotal, pecasTotal});
}
async function runPipeline160({buf160}){
  post('progress', {stage:'Lendo QRY0160...', pct:5});
  const wb = XLSX.read(buf160, {type:'array', cellDates:true});
  const rows = sheetToRows(wb);
  if(!rows.length) throw new Error('QRY0160: planilha vazia.');
  const r = buildAliasResolver(Object.keys(rows[0]), ALIAS_160);
  validateColumns(r, ['item','local','qtd','dataMovimento'], 'QRY0160');

  post('progress', {stage:'Lendo as fichas da QRY0390...', pct:12});
  const ficha = new Map((await irGetItemInfoTodos()).map(f=>[f.item, f]));
  const fichaLocal = new Map((await irGetLocalInfoTodos()).map(f=>[f.local, f]));

  post('progress', {stage:'Agregando '+rows.length+' linha(s) por endereço...', pct:20});
  const porLocal = new Map();
  let valorTotal = 0, pecasTotal = 0, semFicha = 0, semClasse = 0, n = 0;
  const itensVistos = new Set();
  for(const row of rows){
    if(++n % 20000 === 0) post('progress', {stage:'Linha '+n+' de '+rows.length+'...', pct:20+Math.round(n/rows.length*60)});
    const local = irNormItemKey(getVal(row, r.local));
    if(!local) continue;
    const item = irNormItemKey(getVal(row, r.item));
    const qtd = parseNumber(getVal(row, r.qtd));
    const f = item ? ficha.get(item) : null;
    if(item && !f) semFicha++;
    const valor = qtd * ((f && f.valorUnitario) || 0);
    const d = parseDateVal(getVal(row, r.dataMovimento));
    const dia = d && !isNaN(d.getTime()) ? isoDateTime(d).slice(0,10) : '';
    let g = porLocal.get(local);
    if(!g){
      const fl = fichaLocal.get(local) || {};
      g = {local,
        desc: String(getVal(row, r.endereco) ?? '').trim() || fl.desc || '',
        x1: String(getVal(row, r.x1) ?? '').trim() || fl.x1 || '',
        x2: String(getVal(row, r.x2) ?? '').trim() || fl.x2 || '',
        clal: fl.clal || '', predio: fl.predio || '', log:'',
        // porDia guarda peças E valor: o gráfico de acúmulo por idade é em reais,
        // e sem o valor por dia não dá pra montar sem reprocessar tudo de novo.
        qtd:0, valor:0, itens:0, porLog:{}, porDia:{}, porDiaValor:{}, _itens:new Set()};
      porLocal.set(local, g);
    }
    g.qtd += qtd; g.valor += valor;
    if(dia){
      g.porDia[dia] = (g.porDia[dia] || 0) + qtd;
      g.porDiaValor[dia] = (g.porDiaValor[dia] || 0) + valor;
    }
    const lg = (f && f.log) || 'S/CAD';
    g.porLog[lg] = (g.porLog[lg] || 0) + qtd;
    if(!g.log) g.log = lg;
    if(item){ g._itens.add(item); itensVistos.add(item); }
    valorTotal += valor; pecasTotal += qtd;
  }
  const linhas = Array.from(porLocal.values()).map(g=>{ g.itens = g._itens.size; delete g._itens; return g; });
  for(const l of linhas) if(!l.clal) semClasse++;

  post('progress', {stage:'Gravando estoque no IndexedDB...', pct:88});
  await irSalvarEstoqueLocais(linhas, {
    fonte:'160', semClasse, importadoEm: new Date().toISOString(),
    linhas: rows.length, locais: linhas.length, itens: itensVistos.size,
    valorTotal, pecasTotal, semFicha
  });
  post('progress', {stage:'Concluído.', pct:100});
  self.postMessage({type:'done160', locais: linhas.length, valorTotal, pecasTotal, semFicha, semClasse, itens: itensVistos.size});
}
async function runPipeline410({buf410}){
  post('progress', {stage:'Lendo QRY410...', pct:5});
  const wb410 = XLSX.read(buf410, {type:'array', cellDates:true});
  const rows410 = sheetToRows(wb410);
  if(!rows410.length) throw new Error('QRY410: planilha vazia.');
  const r410 = buildAliasResolver(Object.keys(rows410[0]), ALIAS_410);
  validateColumns(r410, ['dtMov','sentido','vlMov'], 'QRY410');
  // Legenda editável em Configurações — semeia com o padrão de fábrica na primeira vez.
  const legenda410 = await irSeedNet410LegendaIfEmpty();

  post('progress', {stage:'Processando '+rows410.length+' linha(s) da QRY410...', pct:15});
  const porAno = new Map();
  function getAno(ano){
    if(!porAno.has(ano)) porAno.set(ano, {
      porMes:new Map(), porItemMes:new Map(),
      // porDia = mesma quebra, mas por dia — pra responder "o que aconteceu ontem"
      // rápido, sem esperar o mês fechar pra dar pra investigar.
      porDia:new Map(), porItemDia:new Map(),
      porObs:new Map(), porItem:new Map(), totalLinhas:0, linhasExcluidasDeposito21:0
    });
    return porAno.get(ano);
  }
  // Acumula um movimento num período (mês OU dia) — mesma lógica pros dois níveis,
  // só muda a chave e os Maps de destino.
  function acumularPeriodo(porPeriodo, porItemPeriodo, chave, sinal, valor, qtd, item, nomeItem, clsId, evid){
    if(!porPeriodo.has(chave)) porPeriodo.set(chave, {ganhos:0, perdas:0, ganhosAIR:0, perdasAIR:0});
    const gp = porPeriodo.get(chave);
    if(sinal>0){ gp.ganhos += valor; if(clsId==='AIR') gp.ganhosAIR += valor; }
    else if(sinal<0){ gp.perdas += valor; if(clsId==='AIR') gp.perdasAIR += valor; }
    if(!item) return;
    if(!porItemPeriodo.has(chave)) porItemPeriodo.set(chave, new Map());
    const itensDoPeriodo = porItemPeriodo.get(chave);
    if(!itensDoPeriodo.has(item)) itensDoPeriodo.set(item, {item, nome:nomeItem, saldoValor:0, ganhos:0, perdas:0, saldoQtd:0, ganhosQtd:0, perdasQtd:0, porObs:new Map(), movs:[]});
    const gi = itensDoPeriodo.get(item);
    gi.saldoValor += valor;
    gi.saldoQtd += qtd;
    if(sinal>0){ gi.ganhos += valor; gi.ganhosQtd += qtd; } else if(sinal<0){ gi.perdas += valor; gi.perdasQtd += qtd; }
    gi.porObs.set(clsId, (gi.porObs.get(clsId)||0) + valor);
    // Evidência do lançamento (doc/usuário/data) — cap de 300 por item/período só pra
    // não deixar um item com movimentação anormalmente repetitiva inflar o resumo.
    if(evid && gi.movs.length<300) gi.movs.push(evid);
  }
  // Monta o array final de um nível de período (mês ou dia) — cobertura, saldoAno
  // (sempre do ANO INTEIRO, não do período) e top itens, do mesmo jeito nos dois níveis.
  function finalizarPeriodos(porPeriodo, porItemPeriodo, porItemAno, chaveLabel){
    return Array.from(porPeriodo.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([chave,p])=>{
      const itensDoPeriodo = Array.from((porItemPeriodo.get(chave)||new Map()).values()).map(i=>{
        const saldoAIR = i.porObs.get('AIR')||0;
        const porObsArr = Array.from(i.porObs.entries()).map(([id,valor])=>({id, valor})).sort((a,b)=>Math.abs(b.valor)-Math.abs(a.valor));
        const itemAno = porItemAno.get(i.item) || {};
        const movimentos = (i.movs||[]).slice().sort((a,b)=>(a.dataHora||'').localeCompare(b.dataHora||''));
        return {item:i.item, nome:i.nome, saldoValor:i.saldoValor, ganhos:i.ganhos, perdas:i.perdas,
          saldoQtd:i.saldoQtd, ganhosQtd:i.ganhosQtd, perdasQtd:i.perdasQtd, saldoQtdAno: itemAno.saldoQtd||0,
          saldoAIR, saldoOutros:i.saldoValor-saldoAIR, saldoAno: itemAno.saldoValor||0, porObs:porObsArr, movimentos};
      });
      const net = p.ganhos+p.perdas;
      const netAIR = p.ganhosAIR+p.perdasAIR;
      return {
        [chaveLabel]: chave, ganhos:p.ganhos, perdas:p.perdas, net, netAbs: Math.abs(net), netAIR, netOutros: net-netAIR,
        // Sem slice aqui — a UI decide quantos mostrar com base na cobertura acumulada
        // da movimentação (não dá pra saber de antemão se os itens que explicam o
        // período são 5 ou 50).
        topItensPositivos: itensDoPeriodo.filter(i=>i.saldoValor>0).sort((a,b)=>b.saldoValor-a.saldoValor),
        topItensNegativos: itensDoPeriodo.filter(i=>i.saldoValor<0).sort((a,b)=>a.saldoValor-b.saldoValor)
      };
    });
  }
  let processadas = 0;
  for(const row of rows410){
    processadas++;
    if(processadas % 20000 === 0){
      post('progress', {stage:'Processando linha '+processadas+' de '+rows410.length+' (QRY410)...', pct:15+Math.round(processadas/rows410.length*60)});
    }
    const dt = parseDateVal(getVal(row, r410.dtMov));
    if(!dt) continue;
    // getFullYear()/getMonth() (hora LOCAL) não servem aqui: o SheetJS (cellDates:true)
    // monta esse Date usando os componentes UTC da célula (convenção dele pra evitar bug
    // de DST) — em fuso negativo (Brasil, UTC-3) uma data sem hora tipo "01/03 00:00"
    // vira 2026-03-01T00:00:00Z, que em hora local é 28/02 21:00. Ler com getFullYear()/
    // getMonth() jogava os lançamentos do dia 1º pro mês anterior, subtraindo valor de
    // março (e inflando fevereiro) — por isso as UTC, que refletem os componentes reais
    // da célula, sem passar pela conversão de fuso.
    const ano = dt.getUTCFullYear();
    const mes = ano+'-'+String(dt.getUTCMonth()+1).padStart(2,'0');
    const dia = mes+'-'+String(dt.getUTCDate()).padStart(2,'0');
    const g = getAno(ano);
    g.totalLinhas++;

    // Id Depósito 21 fica de fora de tudo (regra explícita do usuário).
    const idDeposito = parseInt(parseNumber(getVal(row, r410.idDeposito)), 10);
    if(idDeposito===21){ g.linhasExcluidasDeposito21++; continue; }

    const sentido = String(getVal(row, r410.sentido)||'').trim().toLowerCase();
    const vlAbs = Math.abs(parseNumber(getVal(row, r410.vlMov)));
    const qtdAbs = Math.abs(parseNumber(getVal(row, r410.quantidade)));
    const sinal = sentido==='saida' || sentido==='saída' ? -1 : (sentido==='entrada' ? 1 : 0);
    const valor = sinal*vlAbs;
    const qtd = sinal*qtdAbs;

    const cls = irClassificarMotivo410(getVal(row, r410.obsWms), legenda410);

    // Quebra por Obs: mostra TODOS os motivos (considerados ou não), pra transparência.
    if(!g.porObs.has(cls.id)) g.porObs.set(cls.id, {id:cls.id, legenda:cls.legenda, considerarNet:cls.considerarNet, saida:0, entrada:0});
    const go = g.porObs.get(cls.id);
    if(sinal<0) go.saida += valor;
    else if(sinal>0) go.entrada += valor;

    if(!cls.considerarNet) continue; // resto (mês/dia, item) só conta com motivos válidos pro NET

    const item = String(getVal(row, r410.item)||'').trim();
    const nomeItem = String(getVal(row, r410.nomeItem)||'').trim();

    // Saldo do item no ANO INTEIRO — usado tanto pro "saldo no ano" do painel mensal
    // quanto pro do painel diário (é sempre o mesmo número, o ano não muda por dia).
    if(item){
      if(!g.porItem.has(item)) g.porItem.set(item, {item, nome:nomeItem, saldoValor:0, saldoQtd:0});
      const gItem = g.porItem.get(item);
      gItem.saldoValor += valor;
      gItem.saldoQtd += qtd;
    }

    // Evidência (documento/usuário/data-hora do lançamento) — prova de quem fez o
    // ajuste e quando, pra responder "evidencie essa divergência" sem precisar abrir
    // a planilha original.
    const evid = {
      numDoc: String(getVal(row, r410.numDoc)||'').trim(),
      usuario: String(getVal(row, r410.usuario)||'').trim(),
      dataHora: isoDateTime(parseDateVal(getVal(row, r410.dataHora))),
      sentido: sinal>0?'Entrada':(sinal<0?'Saída':''),
      qtd: qtdAbs, valor: vlAbs, obsWms: String(getVal(row, r410.obsWms)||'').trim()
    };

    acumularPeriodo(g.porMes, g.porItemMes, mes, sinal, valor, qtd, item, nomeItem, cls.id, evid);
    acumularPeriodo(g.porDia, g.porItemDia, dia, sinal, valor, qtd, item, nomeItem, cls.id, evid);
  }

  post('progress', {stage:'Consolidando resumo por ano (QRY410)...', pct:80});
  const anos = Array.from(porAno.keys()).sort((a,b)=>b-a);
  const resumos = {};
  for(const ano of anos){
    const g = porAno.get(ano);
    const porMes = finalizarPeriodos(g.porMes, g.porItemMes, g.porItem, 'mes');
    const porDia = finalizarPeriodos(g.porDia, g.porItemDia, g.porItem, 'dia');
    const porObs = Array.from(g.porObs.values()).map(o=>({...o, totalGeral: o.saida+o.entrada}))
      .sort((a,b)=>Math.abs(b.totalGeral)-Math.abs(a.totalGeral));
    const itens = Array.from(g.porItem.values());
    const topItensPositivos = itens.filter(i=>i.saldoValor>0).sort((a,b)=>b.saldoValor-a.saldoValor).slice(0,20);
    const topItensNegativos = itens.filter(i=>i.saldoValor<0).sort((a,b)=>a.saldoValor-b.saldoValor).slice(0,20);
    const totalGanhos = porMes.reduce((s,m)=>s+m.ganhos,0);
    const totalPerdas = porMes.reduce((s,m)=>s+m.perdas,0);
    resumos[ano] = {
      ano, totalLinhas:g.totalLinhas, linhasExcluidasDeposito21:g.linhasExcluidasDeposito21,
      porMes, porDia, porObs, topItensPositivos, topItensNegativos,
      totalGanhos, totalPerdas, totalNet: totalGanhos+totalPerdas, totalNetAbs: Math.abs(totalGanhos+totalPerdas)
    };
  }
  post('progress', {stage:'Concluído.', pct:100});
  self.postMessage({type:'done410', anos, resumos});
}

self.onmessage = async (e)=>{
  const msg = e.data;
  if(msg.type === 'process390'){
    try{ await runPipeline390(msg); }
    catch(err){ self.postMessage({type:'error390', message: err.message||String(err)}); }
  } else if(msg.type === 'process160'){
    try{ await runPipeline160(msg); }
    catch(err){ self.postMessage({type:'error160', message: err.message||String(err)}); }
  } else if(msg.type === 'process410'){
    try{ await runPipeline410(msg); }
    catch(err){ self.postMessage({type:'error410', message: err.message||String(err)}); }
  }
};

