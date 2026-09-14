/* ============================================================
   Web Worker — Inventário Rotativo
   Parsing (SheetJS) + cruzamento + cálculo de convergência,
   indicadores e prioridade de auditoria. Tudo fora da thread
   principal. Grava direto no IndexedDB (Workers têm acesso).
   ============================================================ */
importScripts('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
importScripts('./rules.js');
importScripts('./db.js');

// Incrementar sempre que um campo novo for adicionado aos indicadores — a UI usa isso
// pra avisar quando os dados salvos são de antes do ciclo ser reprocessado.
const IR_INDICADORES_VERSION = 9;

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
function isSim(v){ return String(v||'').trim().toUpperCase()==='SIM'; }
// Normaliza código de item OU LOCAL pra cruzar QRY0843/Base Congelada/SIGEQ278/ZBIQ0051
// mesmo quando um export guarda o código como texto com zero à esquerda (ex.:
// "02831399") e outro como número puro (2831399) — sem isso o cruzamento falhava
// silenciosamente: pra item, o preço nunca batia (precoUnitarioDoItem caía no fallback
// 0, zerando o valor divergente); pra local, a Base Congelada e a QRY0843 nunca se
// encontravam pro mesmo endereço físico, inflando "locais pendentes" bem acima do real.
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
  item: ['Item'], descricao: ['Descrição','Descricao'], codTerceiro: ['Cod Terceiro'],
  local: ['Local'], situacao: ['Situação','Situacao'], quantidade: ['Quantidade'], classeSku: ['Classe Sku']
};
const ALIAS_843 = {
  inventario: ['Inventario','Inventário'], local: ['Local'], descricaoLocal: ['Descrição Local'],
  dataSituacao: ['Data Situação','Data Situacao'],
  dataInicioContagem: ['Data Inicio Contagem','Data Início Contagem'], dataFimContagem: ['Data Fim Contagem'],
  obsInventario: ['Obs Inventario','Obs Inventário'], usuario: ['Usuário Conferencia','Usuario Conferencia'],
  situacaoInventario: ['Situação Inventario'], situacaoLocal: ['Situação Local'],
  idConferencia: ['Id Conferencia'], item: ['Id Item'], itemNome: ['Item Nome'], qtFis: ['QT_FIS']
};
const ALIAS_278 = {
  item: ['Item'], nomeItem: ['Nome item','Nome Item'],
  precoCusto: ['Preço de custo','Preco de custo'], precoCompra: ['Preço de compra','Preco de compra']
};
const ALIAS_051 = {
  itemPai: ['item_vol_multiplo'], itemComponente: ['item_componente'],
  qtde: ['qtde'], inInterface: ['in_interface'], usuario: ['usuario'], datahora: ['datahora']
};
const ALIAS_CONGELADA = {
  idLocal: ['Id Local'], descricao: ['Descrição','Descricao'], x1: ['X1'], x2: ['X2'],
  grupoClasse: ['Grupo Classe'], classeLocal: ['Classe Local'], regiao: ['Região','Regiao'],
  habilitado: ['Habilitado?','Habilitado'], estado: ['Estado'], noInventario: ['Inventario?','Inventário?'],
  qtdPecas: ['Qtd Peças','Qtd Pecas'], qtdItens: ['Qtd Itens'], pesoTotal: ['Peso Total'],
  filial: ['Filial'], predio: ['Predio','Prédio']
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
// Classificação de motivos (extrai o código do início de "Observacao WMS" e casa com
// a legenda) mora em rules.js (irClassificarMotivo410) — compartilhada com a UI, e
// parametrizada pela lista editável em Configurações (net410_legenda no IndexedDB).

self.onmessage = async (e)=>{
  const msg = e.data;
  if(msg.type === 'process'){
    try{ await runPipeline(msg); }
    catch(err){ self.postMessage({type:'error', message: err.message||String(err)}); }
  } else if(msg.type === 'process410'){
    try{ await runPipeline410(msg); }
    catch(err){ self.postMessage({type:'error410', message: err.message||String(err)}); }
  }
};
function post(type, data){ self.postMessage({type, ...data}); }

// Lê e concatena vários arquivos da mesma planilha, deduplicando linhas por uma chave
// composta (keyFields, nomes canônicos já resolvidos pelo alias). Usado nos slots que
// aceitam múltiplos arquivos por ciclo (extrações em pedaços, uploads repetidos etc).
function readMultiSheet(bufs, aliasMap, requiredCols, label, keyFields){
  let rowsRaw = [];
  for(const buf of bufs){
    const wb = XLSX.read(buf, {type:'array', cellDates:true});
    rowsRaw = rowsRaw.concat(sheetToRows(wb));
  }
  if(!rowsRaw.length) throw new Error(label+': planilha vazia.');
  const resolved = buildAliasResolver(Object.keys(rowsRaw[0]), aliasMap);
  validateColumns(resolved, requiredCols, label);
  if(bufs.length > 1){
    const lastResolved = buildAliasResolver(Object.keys(rowsRaw[rowsRaw.length-1]), aliasMap);
    validateColumns(lastResolved, requiredCols, label+' (último arquivo)');
  }
  if(bufs.length === 1) return {rows: rowsRaw, resolved, duplicatas: 0};
  const seen = new Set();
  const rows = [];
  let duplicatas = 0;
  for(const row of rowsRaw){
    const key = keyFields.map(f=>String(getVal(row, resolved[f]) ?? '')).join('|');
    if(seen.has(key)){ duplicatas++; continue; }
    seen.add(key);
    rows.push(row);
  }
  return {rows, resolved, duplicatas};
}

async function runPipeline({buf390, bufs843, bufsCongelada, bufs278, bufs051, cicloId, cicloNumero, dataAbertura, dataPrevistaTermino, prioridadeConfig}){
  post('progress', {stage:'Lendo planilhas...', pct:2});
  // QRY0390 (estoque atual) é opcional — o estoque é rotativo (vivo) e essa planilha
  // hoje não alimenta nenhum indicador calculado aqui, só é lida se o usuário mandar.
  let rows390 = [], r390 = null;
  if(buf390){
    const wb390 = XLSX.read(buf390, {type:'array', cellDates:true});
    rows390 = sheetToRows(wb390);
    if(rows390.length){
      r390 = buildAliasResolver(Object.keys(rows390[0]), ALIAS_390);
      validateColumns(r390, ['item','local','quantidade'], 'QRY0390');
    }
  }

  // QRY0843, Base Congelada, SIGEQ278 e ZBIQ0051 podem vir em vários arquivos (a
  // extração de origem tem limite de período/linhas, ou os dados chegam em pedaços por
  // ciclo). Concatena tudo e deduplica por uma chave natural de cada planilha.
  post('progress', {stage:'Lendo QRY0843 ('+bufs843.length+' arquivo(s))...', pct:4});
  const m843 = readMultiSheet(bufs843, ALIAS_843, ['local','item','idConferencia','qtFis','usuario'], 'QRY0843',
    ['local','idConferencia','item','usuario','dataFimContagem','dataInicioContagem']);
  const rows843 = m843.rows, r843 = m843.resolved;

  post('progress', {stage:'Lendo Base Congelada ('+bufsCongelada.length+' arquivo(s))...', pct:5});
  const mCong = readMultiSheet(bufsCongelada, ALIAS_CONGELADA, ['idLocal','noInventario'], 'Base congelada', ['idLocal']);
  const rowsCong = mCong.rows, rCong = mCong.resolved;

  post('progress', {stage:'Lendo SIGEQ278 ('+bufs278.length+' arquivo(s))...', pct:6});
  const m278 = readMultiSheet(bufs278, ALIAS_278, ['item','precoCusto'], 'SIGEQ278', ['item']);
  const rows278 = m278.rows, r278 = m278.resolved;

  post('progress', {stage:'Lendo ZBIQ0051 ('+bufs051.length+' arquivo(s))...', pct:7});
  const m051 = readMultiSheet(bufs051, ALIAS_051, ['itemPai','itemComponente','inInterface'], 'ZBIQ0051', ['itemComponente']);
  const rows051 = m051.rows, r051 = m051.resolved;

  const duplicatasTotais = m843.duplicatas + mCong.duplicatas + m278.duplicatas + m051.duplicatas;
  if(duplicatasTotais) post('progress', {stage:'Removidas '+duplicatasTotais+' linha(s) duplicada(s) entre arquivos importados...', pct:8});

  // Estoque atual por ITEM x LOCAL. É o que permite a auditoria de validação mandar
  // o auditor conferir também os locais onde o item TEM SALDO hoje e que não foram
  // contados no ciclo — sem isso só dá pra apontar onde já se sabe que divergiu.
  post('progress', {stage:'Indexando estoque atual (QRY0390)...', pct:10});
  const estoquePorItemLocal = new Map(); // item -> Map(local -> qtd)
  if(r390){
    for(const row of rows390){
      const item = irNormItemKey(getVal(row, r390.item));
      const local = irNormItemKey(getVal(row, r390.local));
      if(!item || !local) continue;
      const qtd = parseNumber(getVal(row, r390.quantidade));
      if(!estoquePorItemLocal.has(item)) estoquePorItemLocal.set(item, new Map());
      const porLocal = estoquePorItemLocal.get(item);
      porLocal.set(local, (porLocal.get(local)||0) + qtd);
    }
  }

  // Valoração dos itens (seção 7.4 do fluxo de equalização, mesma lógica reaproveitada
  // aqui): a SIGEQ278 só traz o preço do ITEM PAI quando o item é um "múltiplo" (kit
  // com mais de um componente físico). A ZBIQ0051 diz, por componente, se ele é quem
  // "carrega" o valor do kit (in_interface = S) ou não (N). Um item que não aparece na
  // ZBIQ0051 não é um múltiplo — valora normalmente pelo próprio preço na 278.
  post('progress', {stage:'Indexando preços (SIGEQ278)...', pct:14});
  const precoPorItem = new Map(); // item -> preço de custo
  const nomePorItem278 = new Map(); // item -> nome (fallback quando a QRY0843 vem sem "Item Nome")
  for(const row of rows278){
    const item = irNormItemKey(getVal(row, r278.item));
    if(!item) continue;
    precoPorItem.set(item, parseNumber(getVal(row, r278.precoCusto)));
    const nome = String(getVal(row, r278.nomeItem) ?? '').trim();
    if(nome) nomePorItem278.set(item, nome);
  }
  const valoracaoPorComponente = new Map(); // item_componente -> {itemPai, inInterface}
  for(const row of rows051){
    const itemComponente = irNormItemKey(getVal(row, r051.itemComponente));
    if(!itemComponente) continue;
    valoracaoPorComponente.set(itemComponente, {
      itemPai: irNormItemKey(getVal(row, r051.itemPai)),
      inInterface: String(getVal(row, r051.inInterface) ?? '').trim().toUpperCase()
    });
  }
  function precoUnitarioDoItem(item){
    const val = valoracaoPorComponente.get(item);
    if(!val) return precoPorItem.get(item) || 0; // não está na 051: não é múltiplo, valora por si só na 278
    if(val.inInterface !== 'S') return 0; // componente "N" do kit: não valora (só o "S" carrega o valor, senão duplica entre os componentes)
    // "S" — PROCX aninhado: tenta o item pai primeiro; se não achar item pai cadastrado
    // OU o item pai não tiver preço na 278, cai pro preço do próprio item na 278.
    const precoPai = val.itemPai ? precoPorItem.get(val.itemPai) : undefined;
    if(precoPai) return precoPai;
    return precoPorItem.get(item) || 0;
  }

  post('progress', {stage:'Processando base congelada...', pct:20});
  const locais = rowsCong.map(row=>{
    const idLocal = irNormItemKey(getVal(row, rCong.idLocal));
    return {
      id: cicloId+'|'+idLocal, cicloId, idLocal,
      descricao: String(getVal(row, rCong.descricao) ?? '').trim(),
      x1: String(getVal(row, rCong.x1) ?? '').trim(),
      x2: String(getVal(row, rCong.x2) ?? '').trim(),
      grupoClasse: String(getVal(row, rCong.grupoClasse) ?? '').trim(),
      classeLocal: String(getVal(row, rCong.classeLocal) ?? '').trim(),
      regiao: String(getVal(row, rCong.regiao) ?? '').trim(),
      habilitado: isSim(getVal(row, rCong.habilitado)),
      estado: String(getVal(row, rCong.estado) ?? '').trim(),
      isCongelado: true,
      qtdPecas: parseNumber(getVal(row, rCong.qtdPecas)),
      qtdItens: parseNumber(getVal(row, rCong.qtdItens)),
      pesoTotal: parseNumber(getVal(row, rCong.pesoTotal)),
      filial: String(getVal(row, rCong.filial) ?? '').trim(),
      predio: String(getVal(row, rCong.predio) ?? '').trim()
    };
  }).filter(l=>l.idLocal);
  // "Locais Orçados" = universo inteiro da Base Congelada (todo o CD), não um flag
  // específico dela — a coluna "Inventário?" é usada pelo usuário para outra finalidade.

  post('progress', {stage:'Processando contagens (QRY0843)...', pct:35});
  const contagens = [];
  let idx843 = 0, linhasSemDataDescartadas = 0;
  // Diagnostico da ingestao da 843 — sem isso o usuario nao tem como saber POR QUE uma
  // linha nao entrou (janela do ciclo? nao-AIR? nao liquidada?), e o numero "congela"
  // sem explicacao quando a janela do ciclo ja passou.
  let linhasForaDaJanela = 0, linhasNaoAir = 0, linhasNaoLiquidadas = 0;
  let dataMaisRecenteAceita = '', dataMaisRecenteForaDaJanela = '';
  for(const row of rows843){
    idx843++;
    const local = irNormItemKey(getVal(row, r843.local));
    const item = irNormItemKey(getVal(row, r843.item));
    const idConferencia = parseInt(parseNumber(getVal(row, r843.idConferencia)), 10) || 0;
    const obsInventario = String(getVal(row, r843.obsInventario) ?? '').trim();
    const situacaoInventario = String(getVal(row, r843.situacaoInventario) ?? '').trim();
    const situacaoLocal = String(getVal(row, r843.situacaoLocal) ?? '').trim();
    // "Id Item" vem vazio quando o local foi contado e confirmado SEM nenhum item (local
    // vazio) — isso ainda é um local válido e contado, só não gera uma linha de item.
    if(!local) continue;
    // Só eventos de Ajuste Inventário Rotativo (Obs começando em "AIR") entram no ciclo —
    // outras tratativas na mesma planilha (ex.: "ADE - Ajuste Auditoria de Estoque") não são deste módulo.
    if(!/^AIR/i.test(obsInventario)){ linhasNaoAir++; continue; }
    // "Contado" de verdade só quando o local E o inventário foram liquidados — sessões
    // Canceladas (ex.: reabertas depois) não contam como contagem válida.
    if(situacaoLocal!=='Liquidado' || situacaoInventario!=='Liquidado'){ linhasNaoLiquidadas++; continue; }
    const dataSituacao = isoDateTime(parseDateVal(getVal(row, r843.dataSituacao)));
    const dataInicioContagem = isoDateTime(parseDateVal(getVal(row, r843.dataInicioContagem)));
    const dataFimContagem = isoDateTime(parseDateVal(getVal(row, r843.dataFimContagem)));
    // O QRY0843 às vezes vem com sobra de linhas de fora da janela do ciclo (ex.: uma
    // auditoria liquidada do ciclo anterior ainda no export). Sem isolar pela data do
    // ciclo (Abertura–Término Previsto), essas linhas contaminavam a acurácia do ciclo
    // atual com dado de outro ciclo — a mesma origem do bug de saldo inflado corrigido
    // isolando por Id Inventario, só que pra fora da janela em vez de duplicado dentro
    // dela. Fica de fora tudo que não caiu dentro do período oficial do ciclo.
    //
    // A data de referência tem cadeia de fallback (Situação → Fim → Início) porque nem
    // toda linha traz a Data Situação preenchida. Antes, quando nenhuma data parseava,
    // o filtro de janela era PULADO e a linha entrava no ciclo atual de qualquer jeito —
    // era assim que local contado só no ciclo anterior aparecia como "Contado" no ciclo
    // vigente, inflando os contados e escondendo pendente de verdade. Agora é o contrário:
    // sem nenhuma data utilizável não há como provar que a linha é deste ciclo, então ela
    // fica de fora (e é contabilizada em linhasSemDataDescartadas, pra não sumir calada).
    const diaRef = (dataSituacao || dataFimContagem || dataInicioContagem || '').slice(0,10);
    if(!diaRef){ linhasSemDataDescartadas++; continue; }
    if((dataAbertura && diaRef<dataAbertura) || (dataPrevistaTermino && diaRef>dataPrevistaTermino)){
      linhasForaDaJanela++;
      if(diaRef>dataMaisRecenteForaDaJanela) dataMaisRecenteForaDaJanela = diaRef;
      continue;
    }
    if(diaRef>dataMaisRecenteAceita) dataMaisRecenteAceita = diaRef;
    contagens.push({
      id: cicloId+'|'+local+'|'+item+'|'+idConferencia+'|'+idx843,
      cicloId, inventario: String(getVal(row, r843.inventario) ?? '').trim(), local,
      descricaoLocal: String(getVal(row, r843.descricaoLocal) ?? '').trim(),
      dataSituacao, dataInicioContagem, dataFimContagem,
      obsInventario, situacaoInventario, situacaoLocal,
      usuario: String(getVal(row, r843.usuario) ?? '').trim(),
      idConferencia, item, itemNome: String(getVal(row, r843.itemNome) ?? '').trim(),
      qtFis: parseNumber(getVal(row, r843.qtFis))
    });
  }

  post('progress', {stage:'Calculando impacto de cancelamentos...', pct:38});
  // Rodada com trabalho de campo (Data Início Contagem preenchida) que terminou
  // CANCELADA — colaborador foi lá, começou a contar, mas o local não fechou porque
  // pediram pra ele parar (ex.: precisava coletar). Isso não entra em "contagens" (só
  // Liquidado entra ali) e por isso nunca aparecia em indicador nenhum — é um pedido
  // explícito do usuário pra medir o tempo perdido com esse tipo de interrupção.
  // Chave por (local + Id Conferência), não por linha, pra não contar a mesma rodada
  // várias vezes só porque ela tem uma linha por item.
  const cancelamentosPorSessao = new Map(); // "local|idConferencia" -> {local, dataInicioContagem, dataFimContagem}
  const visitasCanceladas = new Map(); // "local|inventario" -> {local, rodadas:Map(rodada -> Map(item -> qt))}
  for(const row of rows843){
    const local = irNormItemKey(getVal(row, r843.local));
    if(!local) continue;
    const obsInventario = String(getVal(row, r843.obsInventario) ?? '').trim();
    if(!/^AIR/i.test(obsInventario)) continue;
    const situacaoInventario = String(getVal(row, r843.situacaoInventario) ?? '').trim();
    const situacaoLocal = String(getVal(row, r843.situacaoLocal) ?? '').trim();
    if(situacaoLocal!=='Cancelado' && situacaoInventario!=='Cancelado') continue;
    const dataInicioContagem = isoDateTime(parseDateVal(getVal(row, r843.dataInicioContagem)));
    if(!dataInicioContagem) continue; // sem início registrado, sem evidência de trabalho de campo
    const dataSituacao = isoDateTime(parseDateVal(getVal(row, r843.dataSituacao)));
    const diaSituacao = (dataSituacao||dataInicioContagem).slice(0,10);
    if(dataAbertura && diaSituacao<dataAbertura) continue;
    if(dataPrevistaTermino && diaSituacao>dataPrevistaTermino) continue;
    const idConferencia = parseInt(parseNumber(getVal(row, r843.idConferencia)), 10) || 0;
    const chave = local+'|'+idConferencia;
    if(!cancelamentosPorSessao.has(chave)){
      cancelamentosPorSessao.set(chave, {
        local, dataInicioContagem,
        dataFimContagem: isoDateTime(parseDateVal(getVal(row, r843.dataFimContagem)))
      });
    }
    // Guarda as quantidades por item de cada rodada da visita cancelada, pra depois
    // saber se as rodadas chegaram a BATER antes do cancelamento (ver abaixo).
    const inv = String(getVal(row, r843.inventario) ?? '').trim();
    const chaveVisita = local+'|'+inv;
    if(!visitasCanceladas.has(chaveVisita)) visitasCanceladas.set(chaveVisita, {local, rodadas:new Map()});
    const vc = visitasCanceladas.get(chaveVisita);
    if(!vc.rodadas.has(idConferencia)) vc.rodadas.set(idConferencia, new Map());
    const item = irNormItemKey(getVal(row, r843.item));
    if(item) vc.rodadas.get(idConferencia).set(item, parseNumber(getVal(row, r843.qtFis)));
  }
  const locaisComCancelamentoSet = new Set();
  let tentativasCanceladas = 0, minutosPerdidosCancelamento = 0, sessoesComHorarioRegistrado = 0;
  for(const s of cancelamentosPorSessao.values()){
    locaisComCancelamentoSet.add(s.local);
    tentativasCanceladas++;
    if(s.dataFimContagem){
      const ini = new Date(s.dataInicioContagem).getTime(), fim = new Date(s.dataFimContagem).getTime();
      if(fim>ini){ minutosPerdidosCancelamento += (fim-ini)/60000; sessoesComHorarioRegistrado++; }
    }
  }
  // Separa o cancelamento em dois tipos, porque o custo dos dois é bem diferente:
  //  - INTERROMPIDO: começou a contar e cancelaram antes das rodadas baterem. Perdeu-se
  //    o tempo da contagem, mas o local ainda precisaria ser recontado de qualquer jeito.
  //  - CANCELADO DEPOIS DE BATER: as rodadas já tinham fechado (última bateu com a
  //    anterior) e mesmo assim o local foi cancelado — o trabalho estava PRONTO e foi
  //    jogado fora. É o desperdício mais caro, e o que interessa levar pra conversa.
  // "Bateu" usa o mesmo critério de convergência de sempre: as duas últimas rodadas da
  // visita têm exatamente os mesmos itens e as mesmas quantidades.
  const locaisCanceladosAposBater = new Set();
  const locaisCanceladosInterrompidos = new Set();
  for(const v of visitasCanceladas.values()){
    const rodadas = Array.from(v.rodadas.keys()).sort((a,b)=>a-b);
    let bateu = false;
    if(rodadas.length>=2 && rodadas[rodadas.length-1]>=2){
      const atual = v.rodadas.get(rodadas[rodadas.length-1]);
      const anterior = v.rodadas.get(rodadas[rodadas.length-2]);
      const itens = new Set([...atual.keys(), ...anterior.keys()]);
      bateu = itens.size>0;
      for(const it of itens){
        if((atual.get(it) ?? null) !== (anterior.get(it) ?? null)){ bateu = false; break; }
      }
    }
    if(bateu) locaisCanceladosAposBater.add(v.local);
    else locaisCanceladosInterrompidos.add(v.local);
  }
  // Um local com várias visitas canceladas pode cair nos dois grupos — nesse caso ele
  // conta como "após bater" (é o caso mais grave) e sai do grupo de interrompidos, pra
  // os dois números somarem exatamente o total de locais afetados.
  for(const l of locaisCanceladosAposBater) locaisCanceladosInterrompidos.delete(l);

  post('progress', {stage:'Calculando convergência por local...', pct:50});
  // Um local pode ser contado mais de uma vez no MESMO ciclo com um "Id Inventario"
  // diferente — não só o caso de sobra de auditoria antiga (já filtrado pela janela do
  // ciclo acima), mas também uma recontagem legítima: local com contagem errada, reaberto
  // com um Id Inventario novo pra corrigir. Cada (local + Id Inventario) é uma "visita"
  // independente — a Rodada 1/final de uma visita nunca se mistura com a de outra, e o
  // resultado das duas soma na acurácia (pedido explícito do usuário: as duas contagens
  // são reais e devem contar).
  const porVisitaBruto = new Map(); // chave "local|inventario" -> linhas
  const localDaVisita = new Map(); // chave -> local físico (pra agregar de volta)
  for(const c of contagens){
    const chave = c.local+'|'+(c.inventario||'');
    if(!porVisitaBruto.has(chave)){ porVisitaBruto.set(chave, []); localDaVisita.set(chave, c.local); }
    porVisitaBruto.get(chave).push(c);
  }
  // A Rodada 1 é AUTOMÁTICA: quando o inventário do local é aberto, o WMS congela a
  // quantidade sistêmica e grava a rodada 1 sozinho — ninguém foi lá contar nada. Uma
  // visita que só tem rodada 1 (aberta e depois liquidada, sem nenhuma rodada física)
  // portanto NÃO é um local contado. Sem esse corte, estrutura inteira que ninguém
  // contou no ciclo (BLO, ESC, BAS, BRA, MZP...) aparecia como "contada", inflando
  // locais contados/concluídos e escondendo pendente real. O resto do app já tratava a
  // rodada 1 assim (produtividade, contados por dia, tempo médio) — só a conta de
  // contados/pendentes estava fora do padrão.
  let visitasSemContagemFisica = 0;
  for(const [chave, lista] of Array.from(porVisitaBruto)){
    if(lista.some(c=>c.idConferencia>=2)) continue;
    porVisitaBruto.delete(chave);
    localDaVisita.delete(chave);
    visitasSemContagemFisica++;
  }
  // Toda visita aqui já passou pelo filtro de Liquidado na ingestão da 843 (só entra
  // linha com Situação Local E Situação Inventário = Liquidado — ver o continue lá em
  // cima). Ou seja, ela já está FECHADA pelo WMS, mesmo que tenha levado várias rodadas
  // pra chegar lá. Antes o app também exigia que a última rodada "batesse" com a
  // penúltima pra virar "concluída" (senão ficava "em_contagem" pra sempre) — isso
  // criava um problema real: quando uma contagem errada era corrigida por uma
  // recontagem num Id Inventario NOVO (visita separada), essa recontagem raramente
  // tinha 2 rodadas internas batendo, então ficava excluída da Acurácia/NET pra sempre,
  // e só a rodada errada original (já convergida sozinha) entrava — sobrando um saldo
  // fantasma que já tinha sido corrigido na prática (ex.: +64 sem o -64 que cancelava).
  // Pedido explícito do usuário: "desconsidere locais em aberto, somente se estiver
  // liquidado" — Liquidado já é suficiente, não precisa mais bater rodada a rodada.
  const statusPorVisita = new Map(); // chave -> {status, rodadas}
  for(const [chave, lista] of porVisitaBruto){
    const rodadas = Array.from(new Set(lista.map(c=>c.idConferencia))).sort((a,b)=>a-b);
    const maxRodada = rodadas[rodadas.length-1] || 0;
    statusPorVisita.set(chave, {status:'convergido', rodadas: maxRodada});
  }
  // Status do LOCAL físico (usado por locaisConcluidos/andamentoCiclo/KPI de locais) =
  // o melhor status entre as visitas dele — se a recontagem convergiu, o local está
  // concluído, mesmo que a contagem original (errada) nunca tivesse batido sozinha.
  const STATUS_PRIORIDADE = {convergido:3, encerrado_sem_convergencia:2, em_contagem:1};
  const statusPorLocal = new Map(); // local -> {status, rodadas}
  for(const [chave, st] of statusPorVisita){
    const local = localDaVisita.get(chave);
    const atual = statusPorLocal.get(local);
    if(!atual || STATUS_PRIORIDADE[st.status]>STATUS_PRIORIDADE[atual.status]) statusPorLocal.set(local, st);
  }
  // Peças físicas + divergências — tudo derivado só da QRY0843, sem QRY0114. Por item
  // dentro de CADA VISITA: a Rodada 1 é a quantidade SISTÊMICA e a última rodada em que
  // o item foi de fato recontado é a quantidade FÍSICA final — nunca soma rodada, nunca
  // mistura visita diferente. A divergência de cada visita concluída soma na acurácia do
  // local (peças físicas e divergência dobram se o local tiver 2 visitas concluídas).
  const pecasFisicasPorLocal = new Map(); // local físico -> soma de todas as visitas
  const divergencias = [];
  for(const [chave, lista] of porVisitaBruto){
    const local = localDaVisita.get(chave);
    const porItem = new Map(); // item -> {sistema, final, rodadaFinal, itemNome}
    for(const c of lista){
      if(!c.item) continue; // local vazio, sem item nesta linha
      let g = porItem.get(c.item);
      if(!g){ g = {sistema:null, final:0, rodadaFinal:-1, itemNome:c.itemNome}; porItem.set(c.item, g); }
      if(c.idConferencia===1) g.sistema = c.qtFis;
      if(c.idConferencia>=g.rodadaFinal){ g.final = c.qtFis; g.rodadaFinal = c.idConferencia; }
      if(c.itemNome) g.itemNome = c.itemNome;
    }
    let totalFisico = 0;
    const st = statusPorVisita.get(chave) || {status:'em_contagem', rodadas:0};
    // Dia em que a visita fechou = Data Situação da rodada de maior Id Conferência.
    // Fica gravado em cada divergência pra que os filtros por dia/mês/ano funcionem em
    // qualquer ciclo, sem precisar carregar as contagens daquele ciclo na memória.
    let rodadaTopo = -1, diaFechamento = '';
    for(const c of lista){
      if(c.idConferencia>=rodadaTopo && c.dataSituacao){ rodadaTopo = c.idConferencia; diaFechamento = c.dataSituacao.slice(0,10); }
    }
    for(const [item, g] of porItem){
      totalFisico += g.final;
      // REGRA: Rodada 1 é sempre a quantidade sistêmica, a última rodada é a física,
      // diferença = física − sistema. Sem exceção — se o item não tem linha na Rodada 1,
      // é porque o sistema não tinha esse item ali (sistema=0) e só o físico existia no
      // local: uma sobra real encontrada, não um dado ausente pra tratar como bug.
      const sistema = g.sistema ?? 0;
      const diferenca = g.final - sistema;
      const precoUnitario = precoUnitarioDoItem(item);
      // A QRY0843 às vezes vem sem "Item Nome" preenchido — nesse caso usa o nome
      // cadastrado na SIGEQ278 como alternativa, pra não sobrar código repetido no
      // lugar do nome nas listas de itens divergentes.
      const itemNome = g.itemNome || nomePorItem278.get(item) || '';
      // Componente "N" da 051 tem preço 0 por design (não carrega o valor do kit) — não
      // é uma lacuna de dado, então não deve aparecer no diagnóstico de "sem preço".
      const componenteSemValor = (valoracaoPorComponente.get(item)||{}).inInterface==='N';
      divergencias.push({
        id: cicloId+'|'+chave+'|'+item,
        cicloId, local, item, itemNome,
        qtdeSistema: sistema, qtdeFisica: g.final, diferenca,
        precoUnitario, vlFisico: g.final*precoUnitario, vlDivergencia: diferenca*precoUnitario,
        statusLocal: st.status, rodadasLocal: st.rodadas, diaFechamento,
        diagnostico: diferenca!==0 ? 'divergente' : 'correto', componenteSemValor
      });
    }
    pecasFisicasPorLocal.set(local, (pecasFisicasPorLocal.get(local)||0) + totalFisico);
  }

  post('progress', {stage:'Calculando prioridade de auditoria...', pct:78});
  // reincidência: item já teve divergência em ciclo anterior?
  const ciclosAnteriores = (await irGetAllCiclos()).filter(c=>c.id!==cicloId);
  const itensReincidentes = new Set();
  for(const c of ciclosAnteriores){
    const divsAnt = await irGetByCiclo(IR_STORES.divergencias, c.id);
    divsAnt.forEach(d=>{ if(d.diferenca!==0) itensReincidentes.add(d.item); });
  }
  const porItem = new Map();
  for(const d of divergencias){
    if(d.diferenca===0) continue;
    let g = porItem.get(d.item);
    if(!g) g = {valorAbs:0, qtdAbs:0, locais:new Set()};
    g.valorAbs += Math.abs(d.vlDivergencia);
    g.qtdAbs += Math.abs(d.diferenca);
    g.locais.add(d.local);
    porItem.set(d.item, g);
  }
  const maxValor = Math.max(1, ...Array.from(porItem.values()).map(g=>g.valorAbs));
  const maxQtd = Math.max(1, ...Array.from(porItem.values()).map(g=>g.qtdAbs));
  for(const d of divergencias){
    if(d.diferenca===0){ d.prioridade = 0; continue; }
    const g = porItem.get(d.item);
    const nValor = g.valorAbs/maxValor;
    const nQtd = g.qtdAbs/maxQtd;
    const nRecontagens = Math.min(1, Math.max(0, (d.rodadasLocal-2))/3);
    const nReincidencia = itensReincidentes.has(d.item) ? 1 : 0;
    d.prioridade = irCalcularPrioridade(prioridadeConfig, nValor, nQtd, nRecontagens, nReincidencia);
  }

  post('progress', {stage:'Calculando indicadores...', pct:90});
  const indicadores = calcularIndicadores({congelados: locais, contagens, divergencias, statusPorLocal, pecasFisicasPorLocal, dataAbertura, dataPrevistaTermino,
    locaisComCancelamento: locaisComCancelamentoSet.size, tentativasCanceladas, minutosPerdidosCancelamento, sessoesComHorarioRegistrado,
    locaisCanceladosAposBater: locaisCanceladosAposBater.size, locaisCanceladosInterrompidos: locaisCanceladosInterrompidos.size});

  // Só os itens que divergiram entram no store de estoque — guardar a QRY0390
  // inteira seria centenas de milhares de linhas sem uso.
  const itensDivergentes = new Set(divergencias.filter(d=>d.diferenca!==0).map(d=>d.item));
  const estoqueRows = [];
  for(const item of itensDivergentes){
    const porLocal = estoquePorItemLocal.get(item);
    if(!porLocal || !porLocal.size) continue;
    estoqueRows.push({
      id: cicloId+'|'+item, cicloId, item,
      locais: Array.from(porLocal.entries())
        .filter(([,q])=>q!==0)
        .map(([local, qtd])=>({local, qtd}))
        .sort((a,b)=>b.qtd-a.qtd)
    });
  }

  post('progress', {stage:'Gravando dados no IndexedDB...', pct:95});
  await irClearCiclo(IR_STORES.estoqueItem, cicloId);
  await irClearCiclo(IR_STORES.locais, cicloId);
  await irClearCiclo(IR_STORES.contagens, cicloId);
  await irClearCiclo(IR_STORES.divergencias, cicloId);
  const CHUNK = 1500;
  for(let i=0;i<locais.length;i+=CHUNK) await irBulkPut(IR_STORES.locais, locais.slice(i,i+CHUNK));
  for(let i=0;i<contagens.length;i+=CHUNK) await irBulkPut(IR_STORES.contagens, contagens.slice(i,i+CHUNK));
  for(let i=0;i<divergencias.length;i+=CHUNK) await irBulkPut(IR_STORES.divergencias, divergencias.slice(i,i+CHUNK));
  for(let i=0;i<estoqueRows.length;i+=CHUNK) await irBulkPut(IR_STORES.estoqueItem, estoqueRows.slice(i,i+CHUNK));
  await irSaveIndicadores(cicloId, indicadores);
  await irSaveImportMeta(cicloId, {
    totalLocaisCongelados: indicadores.locaisCongelados,
    totalContagens: contagens.length,
    totalDivergencias: divergencias.filter(d=>d.diferenca!==0).length,
    linhasSemDataDescartadas, visitasSemContagemFisica,
    totalLinhas843: rows843.length, linhasForaDaJanela, linhasNaoAir, linhasNaoLiquidadas,
    dataMaisRecenteAceita, dataMaisRecenteForaDaJanela,
    janelaAbertura: dataAbertura || '', janelaTermino: dataPrevistaTermino || '',
    itensComEstoque390: estoqueRows.length, temQry390: !!r390
  });

  post('progress', {stage:'Concluído.', pct:100});
  self.postMessage({type:'done', indicadores, totalDivergencias: divergencias.filter(d=>d.diferenca!==0).length, totalLocais: locais.length});
}

// d.toISOString() converte pra UTC — como parseDateVal monta o Date com os componentes
// LOCAIS (hora exata da planilha), isso deslocava todo horário em +3h (fuso do Brasil),
// jogando contagens pra coluna de hora errada na matriz de produtividade e, perto da
// virada do dia, até pro dia seguinte nos gráficos "por dia de fechamento". Monta a
// string manualmente, preservando o horário de parede sem passar por UTC.
function isoDateTime(d){
  if(!d) return '';
  const p = n => String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());
}

function calcularIndicadores({congelados, contagens, divergencias, statusPorLocal, pecasFisicasPorLocal, dataAbertura, dataPrevistaTermino,
  locaisComCancelamento, tentativasCanceladas, minutosPerdidosCancelamento, sessoesComHorarioRegistrado,
  locaisCanceladosAposBater, locaisCanceladosInterrompidos}){
  const locaisCongelados = congelados.length;
  // Taxa de recontagem/cancelamento: local que teve trabalho de campo cancelado (não
  // fechou porque foi interrompido) sobre o total de locais orçados do ciclo.
  const taxaCancelamento = locaisCongelados>0 ? (locaisComCancelamento||0)/locaisCongelados : 0;
  const horasPerdidasCancelamento = (minutosPerdidosCancelamento||0)/60;

  const clamp01 = (n)=>Math.max(0, Math.min(1, n));

  // Acurácia Peças/Valor e Divergência Peças/Valor só podem considerar locais já
  // CONCLUÍDOS (rodadas bateram = "convergido", ou encerrado após 5 rodadas sem bater
  // = "encerrado_sem_convergencia" — mesmo critério já usado em locaisConcluidos/
  // andamentoCiclo). Local pendente/em contagem/em recontagem ainda pode mudar de
  // rodada no próximo reprocessamento, então não é um número final — incluir ele
  // nesses indicadores media divergência real (de local fechado) com instabilidade
  // temporária (de local que ainda está sendo trabalhado), distorcendo o resultado.
  const LOCAIS_CONCLUIDO = new Set(['convergido','encerrado_sem_convergencia']);
  const divergenciasConcluidas = divergencias.filter(d=>LOCAIS_CONCLUIDO.has(d.statusLocal));

  // Denominador da Acurácia Peças = peças físicas totais dos locais concluídos (última
  // rodada de contagem por local, derivada só da QRY0843: Rodada 1 sistêmica x rodada
  // final física — nunca soma rodada, sempre a última).
  const totalPecasFisicas = divergenciasConcluidas.reduce((s,d)=>s+d.qtdeFisica,0);
  const totalDiferencaAbs = divergenciasConcluidas.reduce((s,d)=>s+Math.abs(d.diferenca),0);
  const acuraciaPecas = clamp01(totalPecasFisicas>0 ? 1-(totalDiferencaAbs/totalPecasFisicas) : 1);
  const totalItensContados = divergenciasConcluidas.length;

  // "AIR" (X1) é tratado como um local normal, no mesmo padrão de qualquer outro —
  // entra em Acurácia Valor, na quebra por Rua e por Log sem nenhuma exclusão especial
  // (pedido explícito do usuário: "AIR local é como se fosse um local normal").
  // Acurácia Valor: valorado pela SIGEQ278 (preço de custo) cruzada com a ZBIQ0051
  // (S/N do componente no kit) — não mais pela QRY0114.
  const totalVlFisico = divergenciasConcluidas.reduce((s,d)=>s+d.vlFisico,0);
  const totalVlDivergenciaAbs = divergenciasConcluidas.reduce((s,d)=>s+Math.abs(d.vlDivergencia),0);
  const acuraciaValor = clamp01(totalVlFisico>0 ? 1-(totalVlDivergenciaAbs/totalVlFisico) : 1);
  const valorDivergenteLiquido = divergenciasConcluidas.reduce((s,d)=>s+d.vlDivergencia,0);
  const valorDivergenteAbsoluto = totalVlDivergenciaAbs;

  // Itens que divergiram em peça mas cujo preço não foi encontrado na SIGEQ278/ZBIQ0051
  // (precoUnitario=0) — o valor divergente desses fica artificialmente R$ 0,00, mesmo
  // com peça/local realmente divergente. Lista pra diagnóstico direto (Dashboard), em
  // vez do usuário ter que adivinhar por que um dia com contagem aparece zerado.
  const semPrecoPorItem = new Map();
  for(const d of divergencias){
    if(d.diferenca===0 || d.precoUnitario>0 || d.componenteSemValor) continue;
    let g = semPrecoPorItem.get(d.item);
    if(!g){ g = {item:d.item, nome:d.itemNome, pecasDivergentes:0, locais:0}; semPrecoPorItem.set(d.item, g); }
    g.pecasDivergentes += Math.abs(d.diferenca);
    g.locais++;
  }
  const itensSemPreco = Array.from(semPrecoPorItem.values()).sort((a,b)=>b.pecasDivergentes-a.pecasDivergentes).slice(0,30);

  // Acurácia Local (Posições) é medida sobre os locais CONTADOS (liquidados), não sobre
  // o total orçado do CD — mesma regra da Acurácia Peças ("1 − divergência ÷ total contado").
  const locaisContadosTotal = statusPorLocal.size;
  const locaisComDivergencia = new Set(divergencias.filter(d=>d.diferenca!==0).map(d=>d.local));
  const acuraciaLocal = clamp01(locaisContadosTotal>0 ? 1-(locaisComDivergencia.size/locaisContadosTotal) : 1);

  let locaisConcluidos = 0, locaisPendentes = 0, locaisEmContagem = 0, locaisNaoIniciados = 0;
  for(const l of congelados){
    const st = statusPorLocal.get(l.idLocal);
    if(!st){ locaisNaoIniciados++; continue; }
    if(st.status==='convergido' || st.status==='encerrado_sem_convergencia') locaisConcluidos++;
    else locaisEmContagem++;
  }
  locaisPendentes = locaisCongelados - locaisConcluidos;
  const andamentoCiclo = locaisCongelados>0 ? locaisConcluidos/locaisCongelados : 0;

  const itensDivergentes = divergenciasConcluidas.filter(d=>d.diferenca!==0).length;

  let qtdRecontagens = 0;
  for(const [, st] of statusPorLocal) if(st.rodadas>2) qtdRecontagens++;

  const contagensFisicas = contagens.filter(c=>c.idConferencia>=2 && c.dataInicioContagem && c.dataFimContagem);
  let somaMin = 0, nMin = 0;
  for(const c of contagensFisicas){
    const ini = new Date(c.dataInicioContagem).getTime(), fim = new Date(c.dataFimContagem).getTime();
    if(fim>ini){ somaMin += (fim-ini)/60000; nMin++; }
  }
  const tempoMedioContagemMin = nMin>0 ? somaMin/nMin : 0;

  const hoje = new Date();
  const abertura = dataAbertura ? new Date(dataAbertura) : hoje;
  const termino = dataPrevistaTermino ? new Date(dataPrevistaTermino) : null;
  const diasDecorridos = Math.max(1, Math.round((hoje-abertura)/86400000));
  const diasRestantes = irDiasUteisEntre(hoje, termino);

  let eficiencia = 0;
  if(termino){
    const diasTotalPlanejados = Math.max(1, Math.round((termino-abertura)/86400000));
    const locaisEsperadosHoje = Math.min(locaisCongelados, locaisCongelados * Math.min(1, diasDecorridos/diasTotalPlanejados));
    const idxQualidade = Math.min(1, acuraciaLocal/IR_META_ACURACIA);
    const idxVelocidade = locaisEsperadosHoje>0 ? Math.min(1, locaisConcluidos/locaisEsperadosHoje) : 1;
    eficiencia = 0.6*idxQualidade + 0.4*idxVelocidade;
  }

  // Quebra por Rua (X1 da Base Congelada) e por Log (Grupo Classe) — espelha os
  // relatórios de referência do usuário. "Posições" aqui é medida sobre os locais
  // já contados no grupo (não sobre o total congelado), igual ao relatório de origem.
  const locaisContadosSet = new Set(Array.from(statusPorLocal.keys()));
  // Peças/Valor usam SÓ locais concluídos (mesmo denominador do KPI do topo:
  // divergenciasConcluidas, não pecasFisicasPorLocal — que somava a física de local
  // ainda em contagem no denominador, mesmo com o numerador já restrito, distorcendo
  // o percentual). Posições/Locais Divergentes continuam sobre TODOS os locais já
  // contados (qualquer status), igual à Acurácia Local do topo — local em recontagem
  // que ainda diverge é uma posição divergente de verdade até fechar.
  function calcAcuraciasSubset(divsTodos, divsConcluidos, baseLocais){
    const totalPecasGrupo = divsConcluidos.reduce((s,d)=>s+d.qtdeFisica,0);
    const totalDiferencaAbs = divsConcluidos.reduce((s,d)=>s+Math.abs(d.diferenca),0);
    const acuraciaPecas = clamp01(totalPecasGrupo>0 ? 1-(totalDiferencaAbs/totalPecasGrupo) : 1);
    const totalVlFisico = divsConcluidos.reduce((s,d)=>s+d.vlFisico,0);
    const totalVlDivergenciaAbs = divsConcluidos.reduce((s,d)=>s+Math.abs(d.vlDivergencia),0);
    const acuraciaValor = clamp01(totalVlFisico>0 ? 1-(totalVlDivergenciaAbs/totalVlFisico) : 1);
    const locaisComDivergencia = new Set(divsTodos.filter(d=>d.diferenca!==0).map(d=>d.local));
    const acuraciaPosicoes = clamp01(baseLocais>0 ? 1-(locaisComDivergencia.size/baseLocais) : 1);
    return {
      acuraciaPecas, acuraciaValor, acuraciaPosicoes,
      pecasContadas: totalPecasGrupo, pecasDivergentes: totalDiferencaAbs,
      itensContados: divsConcluidos.length,
      locaisDivergentes: locaisComDivergencia.size,
      valorDivergenteLiquido: divsConcluidos.reduce((s,d)=>s+d.vlDivergencia,0),
      valorDivergenteAbsoluto: totalVlDivergenciaAbs,
      vlFisicoTotal: totalVlFisico
    };
  }
  function agruparPor(campo, rotuloVazio, baseCongelados){
    const base = baseCongelados || congelados;
    const chaves = Array.from(new Set(base.map(l=>l[campo] || rotuloVazio)));
    return chaves.map(chave=>{
      const locaisDoGrupo = base.filter(l=>(l[campo]||rotuloVazio)===chave);
      const idsGrupo = new Set(locaisDoGrupo.map(l=>l.idLocal));
      const locaisOrcados = locaisDoGrupo.length;
      const locaisContados = locaisDoGrupo.filter(l=>locaisContadosSet.has(l.idLocal)).length;
      const divsGrupoTodos = divergencias.filter(d=>idsGrupo.has(d.local));
      const divsGrupoConcluidos = divergenciasConcluidas.filter(d=>idsGrupo.has(d.local));
      return {
        chave, locaisOrcados, locaisContados,
        pctContado: locaisOrcados>0 ? locaisContados/locaisOrcados : 0,
        ...calcAcuraciasSubset(divsGrupoTodos, divsGrupoConcluidos, locaisContados)
      };
    }).sort((a,b)=>b.locaisOrcados-a.locaisOrcados);
  }
  // AIR entra na quebra por Rua normalmente, como qualquer outro local (sem exclusão).
  const porRua = agruparPor('x1', '(sem rua)');
  const porLog = agruparPor('grupoClasse', '(sem log)');

  // Locais distintos contados por dia. Cada local é contado UMA ÚNICA VEZ, no dia da
  // sua "Data Situação" na rodada final (maior Id Conferência) — esse é o campo que a
  // QRY0843 usa para marcar quando o status do local foi fechado, e é o mesmo critério
  // da base de referência do usuário (1 local = 1 dia). Usar a Data Início Contagem de
  // cada evento inflava/deslocava a contagem, pois um local pode ter linhas de contagem
  // em vários dias (recontagens) antes de fechar.
  const diaFinalPorLocal = new Map(); // local -> {dia, rodada}
  for(const c of contagens){
    if(c.idConferencia<=1 || !c.dataSituacao) continue;
    const dia = c.dataSituacao.slice(0,10);
    const atual = diaFinalPorLocal.get(c.local);
    if(!atual || c.idConferencia>atual.rodada) diaFinalPorLocal.set(c.local, {dia, rodada:c.idConferencia});
  }
  const porDiaMap = new Map();
  for(const {dia} of diaFinalPorLocal.values()){
    porDiaMap.set(dia, (porDiaMap.get(dia)||0)+1);
  }
  const contadosPorDia = Array.from(porDiaMap.entries())
    .map(([dia,total])=>({dia, total}))
    .sort((a,b)=>a.dia.localeCompare(b.dia));

  // Detalhe por dia x Rua (X1), para o tooltip do gráfico "Contados por Dia":
  // locais distintos (mesmo critério de dia final acima), peças contadas (soma do
  // QT_FIS do dia) e peças divergentes (soma de |Diferença| das divergências daquele dia,
  // casadas pelo Local).
  const congeladosPorId = new Map(congelados.map(l=>[l.idLocal, l]));
  const diaRuaMap = new Map(); // dia -> Map(rua -> {locais:Set, pecasContadas, pecasDivergentes})
  function getOrInitDiaRua(dia, rua){
    if(!diaRuaMap.has(dia)) diaRuaMap.set(dia, new Map());
    const porRuaDoDia = diaRuaMap.get(dia);
    if(!porRuaDoDia.has(rua)) porRuaDoDia.set(rua, {locais:new Set(), pecasContadas:0, pecasDivergentes:0});
    return porRuaDoDia.get(rua);
  }
  for(const [local, {dia}] of diaFinalPorLocal){
    const rua = (congeladosPorId.get(local)||{}).x1 || '(sem rua)';
    const g = getOrInitDiaRua(dia, rua);
    g.locais.add(local);
    g.pecasContadas += pecasFisicasPorLocal.get(local) || 0;
  }
  for(const d of divergencias){
    const final = diaFinalPorLocal.get(d.local);
    if(!final) continue;
    const rua = (congeladosPorId.get(d.local)||{}).x1 || '(sem rua)';
    const g = getOrInitDiaRua(final.dia, rua);
    g.pecasDivergentes += Math.abs(d.diferenca);
  }
  const porDiaRua = {};
  for(const [dia, porRuaDoDia] of diaRuaMap){
    porDiaRua[dia] = Array.from(porRuaDoDia.entries())
      .map(([rua,g])=>({rua, locais:g.locais.size, pecasContadas:g.pecasContadas, pecasDivergentes:g.pecasDivergentes}))
      .sort((a,b)=>b.locais-a.locais);
  }

  // Divergências por dia (peças, valor absoluto e locais) — mesmo critério de "dia
  // final" usado em contadosPorDia (Data Situação da rodada final do local), só que
  // aqui olha SÓ pros locais que fecharam com pelo menos 1 item divergente. Alimenta
  // o painel do Dashboard "Peças/Valor/Locais Divergentes por Dia" (mesmo layout do
  // gráfico de Produtividade, sem linha de meta) e o boletim.
  const diaDivMap = new Map(); // dia -> {pecas, valorAbs, locaisSet}
  for(const d of divergencias){
    if(d.diferenca===0) continue;
    const final = diaFinalPorLocal.get(d.local);
    if(!final) continue;
    if(!diaDivMap.has(final.dia)) diaDivMap.set(final.dia, {pecas:0, valorAbs:0, locaisSet:new Set()});
    const g = diaDivMap.get(final.dia);
    g.pecas += Math.abs(d.diferenca);
    g.valorAbs += Math.abs(d.vlDivergencia);
    g.locaisSet.add(d.local);
  }
  const divergentesPorDia = Array.from(diaDivMap.entries())
    .map(([dia,g])=>({dia, pecas:g.pecas, valor:g.valorAbs, locais:g.locaisSet.size}))
    .sort((a,b)=>a.dia.localeCompare(b.dia));

  // Consolidado por MÊS (YYYY-MM) — alimenta o painel "Evolução mensal" do Dashboard.
  // Cada local entra no mês do seu "dia final" (mesma regra de contadosPorDia), então
  // um local nunca é contado em dois meses. As acurácias seguem exatamente a mesma
  // regra dos KPIs do topo:
  //   • Peças e Valor  -> só locais CONCLUÍDOS (divergenciasConcluidas)
  //   • Locais         -> todos os locais já contados (qualquer status)
  const mesMap = new Map(); // 'YYYY-MM' -> agregados
  function getMes(mes){
    if(!mesMap.has(mes)) mesMap.set(mes, {
      mes, pecasContadas:0, pecasDivergentes:0, valorContado:0, valorDivergente:0,
      locaisContados:0, locaisDivergentesSet:new Set()
    });
    return mesMap.get(mes);
  }
  const mesFinalPorLocal = new Map(); // local -> 'YYYY-MM'
  for(const [local, {dia}] of diaFinalPorLocal){
    const mes = dia.slice(0,7);
    mesFinalPorLocal.set(local, mes);
    getMes(mes).locaisContados++;
  }
  for(const d of divergenciasConcluidas){
    const mes = mesFinalPorLocal.get(d.local);
    if(!mes) continue;
    const g = getMes(mes);
    g.pecasContadas   += d.qtdeFisica;
    g.pecasDivergentes += Math.abs(d.diferenca);
    g.valorContado    += d.vlFisico;
    g.valorDivergente += Math.abs(d.vlDivergencia);
  }
  for(const d of divergencias){
    if(d.diferenca===0) continue;
    const mes = mesFinalPorLocal.get(d.local);
    if(!mes) continue;
    getMes(mes).locaisDivergentesSet.add(d.local);
  }
  const porMes = Array.from(mesMap.values())
    .map(g=>{
      const locaisDivergentes = g.locaisDivergentesSet.size;
      return {
        mes: g.mes,
        pecasContadas: g.pecasContadas, pecasDivergentes: g.pecasDivergentes,
        valorContado: g.valorContado, valorDivergente: g.valorDivergente,
        locaisContados: g.locaisContados, locaisDivergentes,
        acuraciaPecas: clamp01(g.pecasContadas>0 ? 1-(g.pecasDivergentes/g.pecasContadas) : 1),
        acuraciaValor: clamp01(g.valorContado>0 ? 1-(g.valorDivergente/g.valorContado) : 1),
        acuraciaLocal: clamp01(g.locaisContados>0 ? 1-(locaisDivergentes/g.locaisContados) : 1)
      };
    })
    .sort((a,b)=>a.mes.localeCompare(b.mes));

  // Saldo líquido por item (para ranking de maiores sobras/faltas)
  const porItemSaldo = new Map();
  for(const d of divergencias){
    if(d.diferenca===0) continue;
    let g = porItemSaldo.get(d.item);
    if(!g) g = {item:d.item, descricao:d.itemNome, saldoQtd:0, saldoValor:0, locais:new Set()};
    g.saldoQtd += d.diferenca;
    g.saldoValor += d.vlDivergencia;
    g.locais.add(d.local);
    porItemSaldo.set(d.item, g);
  }
  const itensSaldo = Array.from(porItemSaldo.values()).map(g=>({...g, locais:g.locais.size}));
  const topItensPositivos = itensSaldo.filter(i=>i.saldoQtd>0).sort((a,b)=>b.saldoQtd-a.saldoQtd).slice(0,10);
  const topItensNegativos = itensSaldo.filter(i=>i.saldoQtd<0).sort((a,b)=>a.saldoQtd-b.saldoQtd).slice(0,10);
  const topItensPositivosValor = itensSaldo.filter(i=>i.saldoValor>0).sort((a,b)=>b.saldoValor-a.saldoValor).slice(0,10);
  const topItensNegativosValor = itensSaldo.filter(i=>i.saldoValor<0).sort((a,b)=>a.saldoValor-b.saldoValor).slice(0,10);

  // Produtividade por colaborador (exclui contagem 1 = abertura)
  const porUsuario = new Map();
  for(const c of contagens){
    if(c.idConferencia<=1 || !c.usuario) continue;
    let g = porUsuario.get(c.usuario);
    if(!g) g = {locais:new Set(), itens:0, contagens:0, minutos:0, nMin:0};
    g.locais.add(c.local); g.itens++; g.contagens++;
    if(c.dataInicioContagem && c.dataFimContagem){
      const ini=new Date(c.dataInicioContagem).getTime(), fim=new Date(c.dataFimContagem).getTime();
      if(fim>ini){ g.minutos += (fim-ini)/60000; g.nMin++; }
    }
    porUsuario.set(c.usuario, g);
  }
  const rankingProdutividade = Array.from(porUsuario.entries()).map(([usuario,g])=>({
    usuario, locais: g.locais.size, itens: g.itens, contagens: g.contagens,
    tempoMedioMin: g.nMin>0 ? g.minutos/g.nMin : 0
  })).sort((a,b)=>b.locais-a.locais);

  return {
    _v: IR_INDICADORES_VERSION,
    locaisCongelados, locaisContadosTotal, locaisConcluidos, locaisPendentes, locaisEmContagem, locaisNaoIniciados,
    andamentoCiclo, acuraciaPecas, acuraciaLocal, acuraciaValor, meta: IR_META_ACURACIA,
    itensDivergentes, itensContados: totalItensContados, valorDivergenteLiquido, valorDivergenteAbsoluto,
    locaisDivergentes: locaisComDivergencia.size, valorFisicoTotal: totalVlFisico,
    locaisComCancelamento: locaisComCancelamento||0, tentativasCanceladas: tentativasCanceladas||0,
    locaisCanceladosAposBater: locaisCanceladosAposBater||0, locaisCanceladosInterrompidos: locaisCanceladosInterrompidos||0,
    horasPerdidasCancelamento, sessoesComHorarioRegistrado: sessoesComHorarioRegistrado||0, taxaCancelamento,
    itensSemPreco, itensSemPrecoTotal: semPrecoPorItem.size,
    pecasContadas: totalPecasFisicas, pecasDivergentes: totalDiferencaAbs,
    qtdRecontagens, tempoMedioContagemMin, diasRestantes, eficiencia,
    rankingProdutividade, porRua, porLog, contadosPorDia, porDiaRua, divergentesPorDia, porMes,
    topItensPositivos, topItensNegativos, topItensPositivosValor, topItensNegativosValor
  };
}

/* ============================================================
   QRY410 — Perdas e Ganhos no CD
   Independente do ciclo rotativo: processa por ano (extraído de Dt.Mov.), não
   depende de nenhum arquivo dos outros slots. Ver irClassificarMotivo410() em
   rules.js pras regras de negócio (Id Depósito 21 fora, Saída = negativo, legenda
   de motivos — editável em Configurações).
   ============================================================ */
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
