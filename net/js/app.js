/* =========================================================================
   NET — gestão do relatório de perdas e ganhos (QRY410) para a controladoria
   -------------------------------------------------------------------------
   Fluxo: importa a QRY410 (uma ou mais planilhas) -> separa Lógica 301
   (Perda por Inventário) e 302 (Localização Inventário / Ganho) -> classifica
   cada linha pelo prefixo da "Observação WMS" usando a Legenda -> aplica as
   regras do NET -> mostra o fechamento do mês e gera a planilha pronta.

   Regras do NET (as mesmas da tabela dinâmica da planilha manual):
   - só Lógica 301 e 302;
   - fora: depósitos marcados como fora do NET (padrão: 21 — Insumos);
   - fora: prefixos cuja Legenda diz "Considerar NET = NÃO" (ANF, BAI, INP...);
   - fora: prefixo sem legenda (aparece em alerta pra ser classificado).
   ========================================================================= */
(function(){
'use strict';

/* ---------- Legenda padrão (aba LEGENDA da planilha da controladoria) ---------- */
var LEGENDA_PADRAO = [
  {id:'INS', legenda:'Baixa Insumo', setor:'CD', motivo:'BAIXA DE AJUSTE DE ESTOQUE (DESCONSIDERAR PARA NET)', descricao:'REALIZAÇÃO DAS BAIXAS OU GANHOS DE CORREÇÃO DE ESTOQUE DOS INSUMOS NO CD', net:false},
  {id:'AIR', legenda:'Inventário Rotativo', setor:'CD', motivo:'AJUSTE DE INVENTÁRIO ROTATIVO / GLOBAL', descricao:'AJUSTES REALIZADOS DENTRO DO CICLO DE INVENTÁRIO GLOBAL E ROTATIVO', net:true},
  {id:'TID', legenda:'Troca de Identidade', setor:'CD', motivo:'TROCA DE IDENTIDADE', descricao:'USADO REALIZAÇÃO DE AJUSTE DE CADASTRO, COMPONETES, COR, VOLTAGEM ETC...', net:true},
  {id:'ARI LOT', legenda:'Ajuste de Lote', setor:'CD', motivo:'TROCA DE LOTE DO ITEM', descricao:'UTILIZADO PARA AJUSTE DE LOTE E DATA DEVIDO A DIGITAÇÃO NO RECEBIMENTO', net:true},
  {id:'AIN', legenda:'Não Localizado', setor:'CD', motivo:'AJUSTE DE INVENTÁRIO NEGATIVO', descricao:'AJUSTES REALIZADOS DE ITENS ENCOTRADO SEM SALDO NO ESTOQUE FORA DO CICLO DE INVENTÁRIO (PERDAS)', net:true},
  {id:'INV', legenda:'Inversão de etiqueta', setor:'REVERSA', motivo:'INVERSÃO (REVERSA)', descricao:'RETORNO DE CLIENTE POR INVERSÃO NO ENVIO DOS PRODUTOS', net:true},
  {id:'ANF', legenda:'Nota Fiscal', setor:'CD', motivo:'NOTA DIGITADA (DESCONSIDERAR PARA NET)', descricao:'BAIXA DE DEVOLUÇÃO FORNECEDOR (REVENDA OU REVERSA) E ITENS ENVIADOS PARA ASSISTENCIA TECNICA', net:false},
  {id:'PAR', legenda:'Recebimento Parcial', setor:'REVERSA', motivo:'RECEBIMENTO PARCIAL (REVERSA)', descricao:'BAIXA DE RETORNO PARCIAL DE ENTREGAS ENVIADASDOS CLIENTES PARA LOJA DO MECÂNICO', net:true},
  {id:'ARI', legenda:'Recebimento invertido', setor:'CD', motivo:'AJUSTE DE RECEBEMENTO', descricao:'AJUSTES SOLICITADOS PELO RECEBIMENTO POR FALTA, TROCA INVERSÃO ETC...', net:true},
  {id:'API', legenda:'Ajuste MCL Reversa', setor:'REVERSA', motivo:'AJUSTE DO MERCADO LIVRE', descricao:'RETORNO DE ENTREGAS ENVIADAS DIVERGÊNTES PARA O MERCADO LIVRE', net:true},
  {id:'AEE', legenda:'Itens Localizados', setor:'CD', motivo:'AJUSTE DE ESTOQUE ENCONTRADO', descricao:'AJUSTES REALIZADOS DE ITENS ENCOTRADO NO ESTOQUE FORA DO CICLO DE INVENTÁRIO (GANHOS)', net:true},
  {id:'LOJA', legenda:'Ajuste Loja', setor:'CD', motivo:'AJUSTE FEITO POR LOJA', descricao:'AJUSTE FALTA OU SOBRAS DE ITENS ORIUNDOS DE LOJA', net:true},
  {id:'QBR', legenda:'Quebra CD', setor:'CD', motivo:'AJUSTES DE QUEBRA (DESCONSIDERAR PARA NET)', descricao:'ITENS QUEBRADOS, VENCIDOS OU SEM CONDIÇÕES DE VENDA BAIXA POR NOTA FISCAL ATRAVÉS DE PEDIDO', net:false},
  {id:'EPI', legenda:'Baixa EPI', setor:'CD', motivo:'BAIXA DE ESTOQUE - EQUIPAMENTOS DE PROTEÇÃO (DESCONSIDERAR PARA NET)', descricao:'EPI - BAIXA DE EQUIPAMENTO DE SEGURANÇA E UNIFORMES', net:false},
  {id:'IMP', legenda:'Ajuste Importação', setor:'CD', motivo:'AJUSTE IMPORTAÇÃO', descricao:'IMP - AJUSTE IMPORTAÇÃO', net:true},
  {id:'ASR', legenda:'Sobra Recebimento', setor:'CD', motivo:'AJUSTE DE SOBRA DE RECEBIMENTO', descricao:'ITENS COM SOBRA DE FORNCEDOR', net:true},
  {id:'BAI', legenda:'Baixa Insumo', setor:'CD', motivo:'BAIXA DE ESTOQUE - EXPEDIÇÃO (DESCONSIDERAR PARA NET)', descricao:'REALIZAÇÃO DAS BAIXAS DOS INSUMOS CONSUMIDOS NO CD', net:false},
  {id:'INP', legenda:'Ajuste Pallets', setor:'CD', motivo:'INVENTÁRIO DE PALLETS (DESCONSIDERAR PARA NET)', descricao:'INP - AJUSTE INVENTARIO DE PALLETS', net:false},
  {id:'LIT', legenda:'Ajuste Litigio', setor:'CD', motivo:'Divergencia CD vs LOJA', descricao:'LIT - AJUSTE LITIGIO', net:true},
  {id:'AUD', legenda:'Auditoria KMPG', setor:'CD', motivo:'Auditoria KMPG', descricao:'AUD - AUDITORIA KMPG - AJUSTE REFERENTE AS DIVERGÊNCIAS AUDITADAS KPMG', net:true},
  {id:'AIP', legenda:'Inventário Pontual', setor:'CD', motivo:'Inventários fora do ciclo rotativo', descricao:'AIP - AJUSTE INVENTARIO PONTUAL', net:true},
  {id:'ADE', legenda:'Auditorias', setor:'CD', motivo:'Auditorias CD CAJAMAR', descricao:'ADE - AJUSTE AUDITORIA DE ESTOQUE', net:true},
  {id:'AIC', legenda:'Inventário de Curvas', setor:'CD', motivo:'Curva ABC', descricao:'AIC - AJUSTE INVENTARIO CURVA DE ESTOQUE', net:true},
  {id:'AIT', legenda:'Inventario de Transitorios', setor:'CD', motivo:'Transitorios', descricao:'', net:true},
  {id:'AII', legenda:'Inventário de Insumos', setor:'CD', motivo:'Almoxerifado', descricao:'', net:true}
];
var DEPOSITOS_FORA_PADRAO = [21];

/* Colunas da QRY410, na ordem da exportação. "chave" = nome normalizado do
   cabeçalho; "#2" = segunda coluna com o mesmo nome (a QRY410 tem dois "Nome"). */
var COLUNAS = [
  {k:'cia', t:'Cia'}, {k:'filial', t:'FIlial'}, {k:'item', t:'Item'}, {k:'nome', t:'Nome'},
  {k:'codigoterceiro', t:'Codigo Terceiro'}, {k:'iddepto', t:'Id Depto'}, {k:'nomedepto', t:'Nome Depto'},
  {k:'idfornec', t:'Id Fornec.'}, {k:'nomeforncedor', t:'Nome Forncedor', alt:['nomefornecedor']},
  {k:'codfornec', t:'Cod. Fornec'}, {k:'dtmov', t:'Dt.Mov.'}, {k:'logica', t:'Logica'},
  {k:'nome#2', t:'Nome'}, {k:'quantidade', t:'Quantidade'}, {k:'sentido', t:'Sentido'},
  {k:'referencia', t:'Referencia'}, {k:'vlmov', t:'Vl.Mov.'}, {k:'iddeposito', t:'Id Deposito'},
  {k:'nomedeposito', t:'Nome Deposito'}, {k:'numdoc', t:'Num Doc'}, {k:'observacao', t:'Observacao'},
  {k:'observacaowms', t:'Observacao WMS'}, {k:'usuario', t:'Usuário'}, {k:'datahora', t:'Data/Hora'},
  {k:'movimentoerp', t:'Movimento ERP'}
];
var OBRIGATORIAS = ['logica','vlmov','dtmov','observacaowms'];
var MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

/* ---------- utilidades ---------- */
function norm(s){ return String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]/g,''); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function num(v){
  if(typeof v==='number') return v;
  if(v==null||v==='') return 0;
  var s=String(v).trim();
  if(/,\d+$/.test(s)) s=s.replace(/\./g,'').replace(',','.');
  var n=parseFloat(s); return isNaN(n)?0:n;
}
var fmtBRL = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
var fmtInt = new Intl.NumberFormat('pt-BR');
function brl(v){ return fmtBRL.format(v||0); }
function limpa(s){ return String(s==null?'':s).replace(/_x000d_/gi,'').replace(/\r/g,'').trim(); }
function mesLabel(m){ return MESES[parseInt(m.slice(5,7),10)-1]+'/'+m.slice(0,4); }
function mesDeData(v){
  if(v instanceof Date && !isNaN(v)) return v.getFullYear()+'-'+String(v.getMonth()+1).padStart(2,'0');
  if(typeof v==='number' && v>20000){ // serial do Excel
    var d=new Date(Math.round((v-25569)*86400000)); return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
  }
  var s=String(v||'').trim(), m;
  if((m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return m[3]+'-'+m[2].padStart(2,'0');
  if((m=s.match(/^(\d{4})-(\d{2})/))) return m[1]+'-'+m[2];
  return null;
}
function dataTexto(v){
  if(v instanceof Date && !isNaN(v)) return String(v.getDate()).padStart(2,'0')+'/'+String(v.getMonth()+1).padStart(2,'0')+'/'+v.getFullYear();
  return limpa(v);
}

/* ---------- configuração (legenda + depósitos fora) ---------- */
var CFG_KEY='ldm-net-config';
function carregaCfg(){
  var c=null;
  try { c=JSON.parse(localStorage.getItem(CFG_KEY)||'null'); } catch(e){}
  if(!c || !Array.isArray(c.legenda)) c={legenda:JSON.parse(JSON.stringify(LEGENDA_PADRAO)), depositosFora:DEPOSITOS_FORA_PADRAO.slice()};
  if(!Array.isArray(c.depositosFora)) c.depositosFora=DEPOSITOS_FORA_PADRAO.slice();
  return c;
}
function salvaCfg(){ try { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); } catch(e){} }
var CFG = carregaCfg();

/* Prefixo = ID da legenda mais longo com que a Observação WMS começa
   (assim "ARI LOT" ganha de "ARI"). Sem legenda: as 3 primeiras letras. */
function classifica(obs){
  var o=limpa(obs).toUpperCase(), melhor=null;
  CFG.legenda.forEach(function(l){
    var id=String(l.id||'').trim().toUpperCase();
    if(!id || o.indexOf(id)!==0) return;
    var prox=o.charAt(id.length);
    if(prox && /[A-Z0-9]/.test(prox)) return; // "AIR" não casa com "AIRX"
    if(!melhor || id.length>melhor.id.length) melhor={id:id, l:l};
  });
  if(melhor) return {prefixo:melhor.id, legenda:melhor.l.legenda||'', setor:melhor.l.setor||'', considerar:!!melhor.l.net, conhecido:true};
  var p=(o.match(/^[A-Z0-9]+/)||[''])[0].slice(0,4)||'(vazio)';
  return {prefixo:p, legenda:'Sem legenda', setor:'', considerar:false, conhecido:false};
}
function avalia(r){
  var c=classifica(r.observacaowms);
  var dep=parseInt(r.iddeposito,10);
  var motivoFora=null;
  if(CFG.depositosFora.indexOf(dep)!==-1) motivoFora='Depósito '+dep+(r.nomedeposito?' ('+r.nomedeposito+')':'');
  else if(!c.conhecido) motivoFora='Prefixo sem legenda';
  else if(!c.considerar) motivoFora='Legenda: não considerar no NET';
  c.noNet=!motivoFora; c.motivoFora=motivoFora;
  return c;
}

/* ---------- armazenamento dos meses (IndexedDB) ---------- */
var DB=null;
function abreDB(){
  return new Promise(function(res){
    try {
      var rq=indexedDB.open('ldm-net',1);
      rq.onupgradeneeded=function(){ rq.result.createObjectStore('meses',{keyPath:'mes'}); };
      rq.onsuccess=function(){ DB=rq.result; res(); };
      rq.onerror=function(){ res(); };
    } catch(e){ res(); }
  });
}
function dbTx(modo, fn){
  return new Promise(function(res,rej){
    if(!DB) return res(null);
    var tx=DB.transaction('meses',modo), st=tx.objectStore('meses'), out=fn(st);
    tx.oncomplete=function(){ res(out && out.result!==undefined ? out.result : null); };
    tx.onerror=function(){ rej(tx.error); };
  });
}

/* ---------- estado ---------- */
var S = { meses:{}, mesSel:null, filtro:{'301':{q:'',pref:'',net:'todos',lim:200}, '302':{q:'',pref:'',net:'todos',lim:200}} };

/* ---------- importação ---------- */
function lePlanilha(file){
  return new Promise(function(res,rej){
    var fr=new FileReader();
    fr.onload=function(){
      try { res(XLSX.read(new Uint8Array(fr.result),{type:'array',cellDates:true})); } catch(e){ rej(e); }
    };
    fr.onerror=function(){ rej(fr.error); };
    fr.readAsArrayBuffer(file);
  });
}
function mapeiaCabecalho(h){
  var vistos={}, mapa={};
  h.forEach(function(c,i){
    var k=norm(c); if(!k) return;
    vistos[k]=(vistos[k]||0)+1;
    var chave=vistos[k]>1 ? k+'#'+vistos[k] : k;
    COLUNAS.forEach(function(col){
      if(mapa[col.k]!==undefined) return;
      if(col.k===chave || (col.alt && col.alt.indexOf(chave)!==-1)) mapa[col.k]=i;
    });
  });
  return mapa;
}
function extraiLinhas(wb){
  var linhas=[], abasLidas=[];
  wb.SheetNames.forEach(function(nome){
    var aoa=XLSX.utils.sheet_to_json(wb.Sheets[nome],{header:1,raw:true,defval:null,blankrows:false});
    // cabeçalho = primeira das 10 primeiras linhas que tem as colunas obrigatórias
    for(var hi=0; hi<Math.min(10,aoa.length); hi++){
      var mapa=mapeiaCabecalho(aoa[hi]||[]);
      if(OBRIGATORIAS.every(function(k){return mapa[k]!==undefined;})){
        var n=0;
        for(var i=hi+1;i<aoa.length;i++){
          var a=aoa[i]; if(!a) continue;
          var r={};
          COLUNAS.forEach(function(col){ r[col.k]= mapa[col.k]!==undefined ? a[mapa[col.k]] : null; });
          var log=parseInt(r.logica,10);
          if(log!==301 && log!==302){ continue; }
          r.logica=log;
          r.mes=mesDeData(r.dtmov);
          if(!r.mes) continue;
          r.dtmov=dataTexto(r.dtmov);
          if(r.datahora instanceof Date) r.datahora=r.datahora.toLocaleString('pt-BR');
          r.nome=limpa(r.nome); r['nome#2']=limpa(r['nome#2']); r.observacaowms=limpa(r.observacaowms);
          // valor e quantidade sempre com sinal: saída negativa, entrada positiva
          var sent=norm(r.sentido), sinal = sent ? (sent.indexOf('said')===0?-1:1) : (log===301?-1:1);
          r.vl=Math.abs(num(r.vlmov))*sinal;
          r.qtd=Math.abs(num(r.quantidade))*sinal;
          if(!r.sentido) r.sentido = sinal<0?'Saida':'Entrada';
          r.chave = r.movimentoerp!=null && r.movimentoerp!=='' ? 'erp:'+r.movimentoerp
                  : [r.item,r.dtmov,r.logica,r.vl,r.numdoc,r.iddeposito,r.datahora,r.observacaowms].join('|');
          linhas.push(r); n++;
        }
        abasLidas.push(nome+' ('+fmtInt.format(n)+')');
        break;
      }
    }
  });
  return {linhas:linhas, abas:abasLidas};
}
async function importa(files){
  if(typeof XLSX==='undefined'){ toast('Não foi possível carregar o leitor de planilhas. Verifique a internet e recarregue.', true); return; }
  var novos={}, resumo=[];
  for(var f of files){
    try {
      var wb=await lePlanilha(f), ex=extraiLinhas(wb);
      if(!ex.linhas.length){ toast('“'+f.name+'”: nenhuma linha de Lógica 301/302 encontrada. Confira se é a QRY410.', true); continue; }
      ex.linhas.forEach(function(r){ (novos[r.mes]=novos[r.mes]||[]).push(r); });
      resumo.push(f.name);
    } catch(e){ toast('Erro ao ler “'+f.name+'”: '+e.message, true); }
  }
  var mesesAfetados=Object.keys(novos).sort();
  for(var m of mesesAfetados){
    var atual=S.meses[m] || {mes:m, linhas:[], arquivos:[]};
    var idx={}; atual.linhas.forEach(function(r,i){ idx[r.chave]=i; });
    var add=0, upd=0;
    novos[m].forEach(function(r){
      if(idx[r.chave]!==undefined){ atual.linhas[idx[r.chave]]=r; upd++; }
      else { idx[r.chave]=atual.linhas.length; atual.linhas.push(r); add++; }
    });
    atual.arquivos=atual.arquivos.concat(resumo.map(function(n){return {nome:n, em:new Date().toISOString()};}));
    atual.atualizadoEm=new Date().toISOString();
    S.meses[m]=atual;
    try { await dbTx('readwrite',function(st){ return st.put(atual); }); } catch(e){}
  }
  if(mesesAfetados.length){
    S.mesSel=mesesAfetados[mesesAfetados.length-1];
    toast('✓ QRY410 importada: '+mesesAfetados.map(mesLabel).join(', ')+'.');
  }
  render();
}

/* ---------- cálculo do fechamento ---------- */
function linhasMes(){ var m=S.meses[S.mesSel]; return m ? m.linhas : []; }
function fechamento(){
  var L=linhasMes(), por={}, fora={}, semLegenda={}, t={p:0,g:0,n301:0,n302:0,f301:0,f302:0,fn:0};
  L.forEach(function(r){
    var c=avalia(r); r._c=c;
    if(r.logica===301) t.n301++; else t.n302++;
    if(!c.noNet){
      var kf=c.motivoFora; fora[kf]=fora[kf]||{motivo:kf, p:0, g:0, n:0, pref:{}};
      fora[kf][r.logica===301?'p':'g']+=r.vl; fora[kf].n++; fora[kf].pref[c.prefixo]=1;
      if(!c.conhecido){ semLegenda[c.prefixo]=(semLegenda[c.prefixo]||0)+1; }
      if(r.logica===301) t.f301++; else t.f302++;
      return;
    }
    var p=por[c.prefixo]=por[c.prefixo]||{prefixo:c.prefixo, legenda:c.legenda, setor:c.setor, p:0, g:0, np:0, ng:0};
    if(r.logica===301){ p.p+=r.vl; p.np++; t.p+=r.vl; } else { p.g+=r.vl; p.ng++; t.g+=r.vl; }
  });
  var linhas=Object.keys(por).sort().map(function(k){ var o=por[k]; o.net=o.p+o.g; return o; });
  return {linhas:linhas, fora:Object.keys(fora).map(function(k){return fora[k];}), semLegenda:semLegenda, t:t, net:t.p+t.g, total:L.length};
}

/* ---------- renderização ---------- */
function $(id){ return document.getElementById(id); }
function render(){ renderMeses(); renderFechamento(); renderLogica('301'); renderLogica('302'); renderLegenda(); if(window.NETREL) window.NETREL.render(); }

function renderMeses(){
  var ms=Object.keys(S.meses).sort().reverse();
  if(!S.mesSel || !S.meses[S.mesSel]) S.mesSel=ms[0]||null;
  var html = ms.length ? ms.map(function(m){
    return '<button type="button" class="mes-chip'+(m===S.mesSel?' on':'')+'" data-mes="'+m+'">'+esc(mesLabel(m))+'</button>';
  }).join('') : '';
  document.querySelectorAll('[data-meses]').forEach(function(el){ el.innerHTML = html || '<span class="muted">Nenhum mês importado ainda.</span>'; });
  document.querySelectorAll('[data-mes-atual]').forEach(function(el){ el.textContent = S.mesSel ? mesLabel(S.mesSel) : '—'; });
}

function kpi(cls, rot, val, sub){
  return '<div class="kpi '+cls+'"><span class="kpi-rot">'+rot+'</span><strong>'+val+'</strong><span class="kpi-sub">'+sub+'</span></div>';
}
function renderFechamento(){
  var el=$('fech-corpo'); if(!el) return;
  if(!S.mesSel){ el.innerHTML='<div class="vazio"><h3>Importe a QRY410 do mês</h3><p>Arraste o arquivo (ou os arquivos da 301 e da 302) na área acima. O app separa as lógicas, aplica a legenda e monta o fechamento sozinho.</p></div>'; return; }
  var F=fechamento(), m=S.meses[S.mesSel];
  var alerta = Object.keys(F.semLegenda).length
    ? '<div class="alerta"><strong>Prefixos sem legenda:</strong> '+Object.keys(F.semLegenda).map(function(p){return esc(p)+' ('+F.semLegenda[p]+')';}).join(', ')+'. Ficaram <strong>fora do NET</strong> até serem classificados na aba <a href="#legenda" data-goto="legenda">Legenda</a>.</div>' : '';
  var corpo = F.linhas.map(function(o){
    return '<tr><td><span class="pref">'+esc(o.prefixo)+'</span></td><td>'+esc(o.legenda)+'</td>'
      +'<td class="n neg">'+(o.np?brl(o.p):'—')+'</td><td class="n pos">'+(o.ng?brl(o.g):'—')+'</td>'
      +'<td class="n '+(o.net<0?'neg':'pos')+'"><strong>'+brl(o.net)+'</strong></td></tr>';
  }).join('');
  var foraHtml = F.fora.length ? F.fora.map(function(f){
    return '<tr><td>'+esc(f.motivo)+'</td><td>'+Object.keys(f.pref).map(function(p){return '<span class="pref">'+esc(p)+'</span>';}).join(' ')+'</td><td class="n">'+fmtInt.format(f.n)+'</td><td class="n neg">'+brl(f.p)+'</td><td class="n pos">'+brl(f.g)+'</td></tr>';
  }).join('') : '<tr><td colspan="5" class="muted">Nada ficou fora.</td></tr>';
  el.innerHTML =
    '<div class="kpis">'
    + kpi('k-perda','Perda · Lógica 301', brl(F.t.p), fmtInt.format(F.t.n301-F.t.f301)+' lançamento(s) no NET')
    + kpi('k-ganho','Ganho · Lógica 302', brl(F.t.g), fmtInt.format(F.t.n302-F.t.f302)+' lançamento(s) no NET')
    + kpi('k-net '+(F.net<0?'neg':'pos'),'NET do mês', brl(F.net), 'Ganho + Perda')
    + kpi('k-fora','Fora do NET', fmtInt.format(F.t.f301+F.t.f302)+' linha(s)', 'depósito 21, motivos “não considerar” e sem legenda')
    + '</div>'
    + alerta
    + '<div class="painel"><div class="painel-cab"><div><h3>Resumo por prefixo — '+esc(mesLabel(S.mesSel))+'</h3><p>Mesma visão da tabela dinâmica: Obs × Perda (301) / Ganho (302).</p></div>'
    + '<div class="acoes"><button class="btn sec" type="button" id="btnLimparMes">Remover mês</button><button class="btn" type="button" id="btnExportar">⬇ Baixar planilha da controladoria</button></div></div>'
    + '<div class="tabela-wrap"><table class="tab"><thead><tr><th>Obs</th><th>Legenda</th><th class="n">Perda por Inventário (301)</th><th class="n">Localização Inventário (302)</th><th class="n">NET</th></tr></thead><tbody>'+(corpo||'<tr><td colspan="5" class="muted">Nenhum lançamento considerado no NET.</td></tr>')+'</tbody>'
    + '<tfoot><tr><td colspan="2">Total Geral</td><td class="n neg">'+brl(F.t.p)+'</td><td class="n pos">'+brl(F.t.g)+'</td><td class="n '+(F.net<0?'neg':'pos')+'">'+brl(F.net)+'</td></tr></tfoot></table></div></div>'
    + '<div class="painel"><div class="painel-cab"><div><h3>O que ficou fora do NET</h3><p>Conferência: nada some sem explicação.</p></div></div>'
    + '<div class="tabela-wrap"><table class="tab"><thead><tr><th>Motivo</th><th>Prefixos</th><th class="n">Linhas</th><th class="n">Perda (301)</th><th class="n">Ganho (302)</th></tr></thead><tbody>'+foraHtml+'</tbody></table></div></div>'
    + '<p class="rodape-info">Base do mês: '+fmtInt.format(F.total)+' linha(s) da QRY410 ('+fmtInt.format(F.t.n301)+' da 301 · '+fmtInt.format(F.t.n302)+' da 302). Arquivos: '+esc((m.arquivos||[]).map(function(a){return a.nome;}).filter(function(v,i,a){return a.indexOf(v)===i;}).join(', '))+'.</p>';
}

function renderLogica(lg){
  var el=$('log-'+lg); if(!el) return;
  if(!S.mesSel){ el.innerHTML='<div class="vazio"><h3>Nenhum mês importado</h3><p>Importe a QRY410 na aba <a href="#fechamento" data-goto="fechamento">Fechamento do mês</a>.</p></div>'; return; }
  var f=S.filtro[lg], L=linhasMes().filter(function(r){ return r.logica===+lg; });
  L.forEach(function(r){ r._c=avalia(r); });
  var prefs={}; L.forEach(function(r){ prefs[r._c.prefixo]=r._c.legenda; });
  var q=norm(f.q);
  var F=L.filter(function(r){
    if(f.pref && r._c.prefixo!==f.pref) return false;
    if(f.net==='sim' && !r._c.noNet) return false;
    if(f.net==='nao' && r._c.noNet) return false;
    if(q && norm([r.item,r.nome,r.nomedepto,r.observacaowms,r.nomedeposito].join(' ')).indexOf(q)===-1) return false;
    return true;
  });
  var soma=F.reduce(function(s,r){return s+r.vl;},0), somaNet=F.reduce(function(s,r){return s+(r._c.noNet?r.vl:0);},0);
  var opts='<option value="">Todos os prefixos</option>'+Object.keys(prefs).sort().map(function(p){return '<option value="'+esc(p)+'"'+(p===f.pref?' selected':'')+'>'+esc(p)+' — '+esc(prefs[p])+'</option>';}).join('');
  var linhas=F.slice(0,f.lim).map(function(r){
    return '<tr class="'+(r._c.noNet?'':'fora')+'"><td>'+esc(r.dtmov)+'</td><td>'+esc(r.item)+'</td><td class="nome">'+esc(r.nome)+'</td><td>'+esc(r.nomedepto)+'</td><td>'+esc(r.iddeposito)+' · '+esc(r.nomedeposito)+'</td>'
      +'<td class="n">'+fmtInt.format(r.qtd)+'</td><td class="n '+(r.vl<0?'neg':'pos')+'">'+brl(r.vl)+'</td>'
      +'<td><span class="pref">'+esc(r._c.prefixo)+'</span> '+esc(r._c.legenda)+'</td>'
      +'<td>'+(r._c.noNet?'<span class="tag sim">Sim</span>':'<span class="tag nao" title="'+esc(r._c.motivoFora)+'">Não</span>')+'</td></tr>';
  }).join('');
  el.innerHTML =
    '<div class="filtros">'
    + '<input type="search" placeholder="Buscar item, nome, depto, observação…" value="'+esc(f.q)+'" data-f="q" data-lg="'+lg+'">'
    + '<select data-f="pref" data-lg="'+lg+'">'+opts+'</select>'
    + '<select data-f="net" data-lg="'+lg+'"><option value="todos"'+(f.net==='todos'?' selected':'')+'>Todas as linhas</option><option value="sim"'+(f.net==='sim'?' selected':'')+'>Só as que entram no NET</option><option value="nao"'+(f.net==='nao'?' selected':'')+'>Só as que ficam fora</option></select>'
    + '</div>'
    + '<div class="resumo-linha"><span><strong>'+fmtInt.format(F.length)+'</strong> linha(s)</span><span>Soma: <strong class="'+(soma<0?'neg':'pos')+'">'+brl(soma)+'</strong></span><span>No NET: <strong class="'+(somaNet<0?'neg':'pos')+'">'+brl(somaNet)+'</strong></span></div>'
    + '<div class="painel"><div class="tabela-wrap"><table class="tab"><thead><tr><th>Dt.Mov.</th><th>Item</th><th>Nome</th><th>Depto</th><th>Depósito</th><th class="n">Qtd</th><th class="n">Vl.Mov.</th><th>Obs / Legenda</th><th>NET?</th></tr></thead><tbody>'
    + (linhas||'<tr><td colspan="9" class="muted">Nenhuma linha com esses filtros.</td></tr>')+'</tbody></table></div>'
    + (F.length>f.lim?'<div class="mais"><button class="btn sec" type="button" data-mais="'+lg+'">Mostrar mais ('+fmtInt.format(F.length-f.lim)+' restantes)</button></div>':'')
    + '</div>';
}

function renderLegenda(){
  var el=$('leg-corpo'); if(!el) return;
  var uso={};
  linhasMes().forEach(function(r){ var p=classifica(r.observacaowms).prefixo; uso[p]=(uso[p]||0)+1; });
  var linhas=CFG.legenda.map(function(l,i){
    var u=uso[String(l.id||'').toUpperCase()]||0;
    return '<tr><td><input class="in-id" data-i="'+i+'" data-c="id" value="'+esc(l.id)+'"></td>'
      +'<td><input data-i="'+i+'" data-c="legenda" value="'+esc(l.legenda)+'" title="'+esc(l.legenda)+'"></td>'
      +'<td><input class="in-setor" data-i="'+i+'" data-c="setor" value="'+esc(l.setor)+'"></td>'
      +'<td><input data-i="'+i+'" data-c="motivo" value="'+esc(l.motivo)+'" title="'+esc(l.motivo)+'"></td>'
      +'<td><input data-i="'+i+'" data-c="descricao" value="'+esc(l.descricao)+'" title="'+esc(l.descricao)+'"></td>'
      +'<td><label class="switch"><input type="checkbox" data-i="'+i+'" data-c="net"'+(l.net?' checked':'')+'><span>'+(l.net?'SIM':'NÃO')+'</span></label></td>'
      +'<td class="n">'+(u?fmtInt.format(u):'<span class="muted">—</span>')+'</td>'
      +'<td><button class="x" type="button" data-del="'+i+'" aria-label="Remover '+esc(l.id)+'">×</button></td></tr>';
  }).join('');
  el.innerHTML =
    '<div class="painel"><div class="painel-cab"><div><h3>Legenda dos prefixos</h3><p>O prefixo é o começo da “Observação WMS” (ex.: <span class="pref">AIR</span> - AJUSTE INVENTARIO ROTATIVO). Aqui você diz o que cada um significa e se entra no NET. Alterações valem na hora.</p></div>'
    + '<div class="acoes"><button class="btn sec" type="button" id="btnLegPadrao">Restaurar padrão</button><button class="btn" type="button" id="btnLegAdd">+ Novo prefixo</button></div></div>'
    + '<div class="tabela-wrap"><table class="tab leg"><thead><tr><th>ID</th><th>Legenda</th><th>Setor</th><th>Motivo</th><th>Descrição</th><th>Considerar NET?</th><th class="n">Linhas no mês</th><th></th></tr></thead><tbody>'+linhas+'</tbody></table></div></div>'
    + '<div class="painel"><div class="painel-cab"><div><h3>Depósitos fora do NET</h3><p>Ids de depósito ignorados no NET (padrão: 21 — Insumos). Separe por vírgula.</p></div></div>'
    + '<div class="dep-linha"><input id="inDepFora" value="'+esc(CFG.depositosFora.join(', '))+'"><button class="btn sec" type="button" id="btnDepSalvar">Salvar</button></div></div>';
}

/* ---------- planilha da controladoria ---------- */
function exporta(){
  if(typeof XLSX==='undefined'){ toast('Leitor de planilhas não carregou.', true); return; }
  var F=fechamento(), L=linhasMes(), mes=S.mesSel;
  var nomeMes=MESES[parseInt(mes.slice(5,7),10)-1], ano=mes.slice(0,4);
  var wb=XLSX.utils.book_new();
  var cab=COLUNAS.map(function(c){return c.t;});
  var MOEDA='#,##0.00;[Red]-#,##0.00';

  function linhaBruta(r, positivo){
    return COLUNAS.map(function(c){
      if(c.k==='vlmov') return positivo?Math.abs(r.vl):r.vl;
      if(c.k==='quantidade') return positivo?Math.abs(r.qtd):r.qtd;
      var v=r[c.k]; return v==null?'':v;
    });
  }
  function fmtColuna(ws, colIdx, nLinhas, inicio){
    for(var i=inicio;i<inicio+nLinhas;i++){ var ref=XLSX.utils.encode_cell({r:i,c:colIdx}); if(ws[ref] && typeof ws[ref].v==='number') ws[ref].z=MOEDA; }
  }
  var iVl=COLUNAS.findIndex(function(c){return c.k==='vlmov';});

  // 1) RESUMO (equivale à aba DINAMICA)
  var res=[
    ['NET CD CAJAMAR — '+nomeMes+'/'+ano],
    ['Gerado pelo app NET (Oficina LDM) em '+new Date().toLocaleString('pt-BR')],
    ['Regras: só Lógica 301/302 · fora do NET: depósito(s) '+CFG.depositosFora.join(', ')+' e prefixos com “Considerar NET = NÃO” na legenda'],
    [],
    ['Obs','Legenda','Perda por Inventario (301)','Localização Inventário (WMS) (302)','Total Geral']
  ];
  F.linhas.forEach(function(o){ res.push([o.prefixo,o.legenda,o.np?o.p:'',o.ng?o.g:'',o.net]); });
  res.push(['Total Geral','',F.t.p,F.t.g,F.net]);
  res.push([]); res.push(['Fora do NET (conferência)']); res.push(['Motivo','Prefixos','Linhas','Perda (301)','Ganho (302)']);
  F.fora.forEach(function(f){ res.push([f.motivo,Object.keys(f.pref).join(', '),f.n,f.p,f.g]); });
  var wsR=XLSX.utils.aoa_to_sheet(res);
  var fimResumo=5+F.linhas.length+1; // linhas do resumo + Total Geral
  for(var c=2;c<=4;c++) fmtColuna(wsR,c,fimResumo-5,5);
  for(c=3;c<=4;c++) fmtColuna(wsR,c,res.length-fimResumo,fimResumo);
  wsR['!cols']=[{wch:30},{wch:28},{wch:26},{wch:30},{wch:16}];
  XLSX.utils.book_append_sheet(wb,wsR,'RESUMO NET');

  // 2) PERDA (301) e 3) GANHO (302) — como vêm da QRY410 (valores positivos) + classificação
  [['301','PERDA CAJAMAR (301)'],['302','GANHO CAJAMAR (302)']].forEach(function(par){
    var aoa=[cab.concat(['OBS','Legenda','Considerar NET?','Motivo fora'])];
    L.filter(function(r){return r.logica===+par[0];}).forEach(function(r){
      var a=avalia(r); aoa.push(linhaBruta(r,true).concat([a.prefixo,a.legenda,a.noNet?'SIM':'NÃO',a.motivoFora||'']));
    });
    var ws=XLSX.utils.aoa_to_sheet(aoa); fmtColuna(ws,iVl,aoa.length,1);
    ws['!cols']=cab.map(function(t){return {wch:Math.max(10,t.length+2)};}); ws['!cols'][3]={wch:44}; ws['!cols'][21]={wch:44};
    ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:aoa.length-1,c:aoa[0].length-1}})};
    XLSX.utils.book_append_sheet(wb,ws,par[1]);
  });

  // 4) CONSOLIDADO — 301 + 302 com sinal (saída negativa) + OBS/Motivo/Setor
  var con=[cab.concat(['OBS','Motivo','Setor','Considerar NET?'])];
  L.forEach(function(r){ var a=avalia(r); con.push(linhaBruta(r,false).concat([a.prefixo,a.legenda,a.setor,a.noNet?'SIM':'NÃO'])); });
  var wsC=XLSX.utils.aoa_to_sheet(con); fmtColuna(wsC,iVl,con.length,1);
  wsC['!cols']=cab.map(function(t){return {wch:Math.max(10,t.length+2)};}); wsC['!cols'][3]={wch:44}; wsC['!cols'][21]={wch:44};
  wsC['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:con.length-1,c:con[0].length-1}})};
  XLSX.utils.book_append_sheet(wb,wsC,'CONSOLIDADO');

  // 5) LEGENDA
  var leg=[['ID','Legenda','Setor','MOTIVO','DESCRIÇÃO','CONSIDERAR NET?']].concat(CFG.legenda.map(function(l){return [l.id,l.legenda,l.setor,l.motivo,l.descricao,l.net?'SIM':'NÃO'];}));
  var wsL=XLSX.utils.aoa_to_sheet(leg); wsL['!cols']=[{wch:10},{wch:26},{wch:10},{wch:50},{wch:70},{wch:16}];
  XLSX.utils.book_append_sheet(wb,wsL,'LEGENDA');

  XLSX.writeFile(wb,'CONSOLIDADO - NET CDS - '+ano+' '+nomeMes+'.xlsx');
  toast('✓ Planilha de '+nomeMes+'/'+ano+' gerada.');
}

/* ---------- eventos ---------- */
var toastT=null;
function toast(msg, erro){
  var t=$('toast'); if(!t) return;
  t.textContent=msg; t.classList.toggle('erro',!!erro); t.classList.add('show');
  clearTimeout(toastT); toastT=setTimeout(function(){ t.classList.remove('show'); }, erro?6000:3000);
}

document.addEventListener('click', async function(e){
  var b;
  if((b=e.target.closest('.mes-chip'))){ S.mesSel=b.dataset.mes; render(); return; }
  if((b=e.target.closest('[data-goto]')) && b.tagName==='A'){ e.preventDefault(); if(window.netSwitchTab) window.netSwitchTab(b.dataset.goto); return; }
  if(e.target.id==='btnExportar'){ exporta(); return; }
  if(e.target.id==='btnLimparMes'){
    if(!confirm('Remover os dados de '+mesLabel(S.mesSel)+' deste navegador? (Dá pra importar de novo depois.)')) return;
    var m=S.mesSel; delete S.meses[m]; S.mesSel=null;
    try { await dbTx('readwrite',function(st){ return st.delete(m); }); } catch(err){}
    render(); toast('Mês removido.'); return;
  }
  if((b=e.target.closest('[data-mais]'))){ S.filtro[b.dataset.mais].lim+=300; renderLogica(b.dataset.mais); return; }
  if(e.target.id==='btnLegAdd'){ CFG.legenda.push({id:'',legenda:'',setor:'CD',motivo:'',descricao:'',net:true}); salvaCfg(); renderLegenda(); var ins=document.querySelectorAll('.in-id'); if(ins.length) ins[ins.length-1].focus(); return; }
  if(e.target.id==='btnLegPadrao'){ if(!confirm('Voltar a legenda para o padrão? Suas alterações na legenda serão perdidas.')) return; CFG.legenda=JSON.parse(JSON.stringify(LEGENDA_PADRAO)); salvaCfg(); render(); toast('Legenda restaurada.'); return; }
  if((b=e.target.closest('[data-del]'))){ var l=CFG.legenda[+b.dataset.del]; if(!confirm('Remover o prefixo '+(l.id||'(vazio)')+' da legenda?')) return; CFG.legenda.splice(+b.dataset.del,1); salvaCfg(); render(); return; }
  if(e.target.id==='btnDepSalvar'){
    CFG.depositosFora=$('inDepFora').value.split(/[,;\s]+/).map(function(v){return parseInt(v,10);}).filter(function(v){return !isNaN(v);});
    salvaCfg(); render(); toast('Depósitos fora do NET: '+(CFG.depositosFora.join(', ')||'nenhum')+'.'); return;
  }
});
document.addEventListener('input', function(e){
  var t=e.target;
  if(t.dataset.f && t.dataset.lg && t.dataset.f==='q'){
    S.filtro[t.dataset.lg].q=t.value; S.filtro[t.dataset.lg].lim=200;
    var pos=t.selectionStart; renderLogica(t.dataset.lg);
    var n=document.querySelector('[data-f="q"][data-lg="'+t.dataset.lg+'"]'); if(n){ n.focus(); try{ n.setSelectionRange(pos,pos); }catch(err){} }
  }
});
document.addEventListener('change', function(e){
  var t=e.target;
  if(t.dataset.f && t.dataset.lg && t.dataset.f!=='q'){ S.filtro[t.dataset.lg][t.dataset.f]=t.value; S.filtro[t.dataset.lg].lim=200; renderLogica(t.dataset.lg); return; }
  if(t.dataset.c && t.dataset.i!==undefined){
    var l=CFG.legenda[+t.dataset.i]; if(!l) return;
    l[t.dataset.c] = t.type==='checkbox' ? t.checked : (t.dataset.c==='id' ? t.value.trim().toUpperCase() : t.value);
    salvaCfg(); render(); return;
  }
  if(t.id==='fileInput' && t.files.length){ importa(Array.from(t.files)); t.value=''; }
});

function ligaDrop(){
  var dz=$('dropzone'); if(!dz) return;
  ['dragenter','dragover'].forEach(function(ev){ dz.addEventListener(ev,function(e){ e.preventDefault(); dz.classList.add('over'); }); });
  ['dragleave','drop'].forEach(function(ev){ dz.addEventListener(ev,function(e){ e.preventDefault(); dz.classList.remove('over'); }); });
  dz.addEventListener('drop',function(e){ var fs=Array.from(e.dataTransfer.files||[]); if(fs.length) importa(fs); });
  dz.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); $('fileInput').click(); } });
}

/* ---------- API para o relatório (relatorio.js) ---------- */
window.NET_API = {
  meses: function(){ return Object.keys(S.meses).sort(); },
  mesSel: function(){ return S.mesSel; },
  getMes: function(m){ return S.meses[m]||null; },
  avalia: avalia,
  mesLabel: mesLabel,
  MESES: MESES,
  cfg: function(){ return CFG; },
  toast: toast,
  esc: esc,
  salvarMes: async function(m){ try { await dbTx('readwrite',function(st){ return st.put(S.meses[m]); }); } catch(e){} }
};

/* ---------- início ---------- */
(async function(){
  ligaDrop();
  await abreDB();
  try {
    var todos=await dbTx('readonly',function(st){ return st.getAll(); });
    (todos||[]).forEach(function(m){ S.meses[m.mes]=m; });
  } catch(e){}
  render();
})();
})();
