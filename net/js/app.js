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
  var novos={}, resumo=[], logArq=[];
  for(var f of files){
    try {
      var wb=await lePlanilha(f), ex=extraiLinhas(wb);
      if(!ex.linhas.length){ toast('“'+f.name+'”: nenhuma linha de Lógica 301/302 encontrada. Confira se é a QRY410.', true); logArq.push({nome:f.name, linhas:0, erro:'Nenhuma linha de Lógica 301/302'}); continue; }
      ex.linhas.forEach(function(r){ (novos[r.mes]=novos[r.mes]||[]).push(r); });
      resumo.push(f.name);
      logArq.push({nome:f.name, linhas:ex.linhas.length});
    } catch(e){ toast('Erro ao ler “'+f.name+'”: '+e.message, true); logArq.push({nome:f.name, linhas:0, erro:e.message}); }
  }
  var totAdd=0, totUpd=0;
  var mesesAfetados=Object.keys(novos).sort();
  for(var m of mesesAfetados){
    var atual=S.meses[m] || {mes:m, linhas:[], arquivos:[]};
    var idx={}; atual.linhas.forEach(function(r,i){ idx[r.chave]=i; });
    var add=0, upd=0;
    novos[m].forEach(function(r){
      if(idx[r.chave]!==undefined){ atual.linhas[idx[r.chave]]=r; upd++; }
      else { idx[r.chave]=atual.linhas.length; atual.linhas.push(r); add++; }
    });
    totAdd+=add; totUpd+=upd;
    atual.arquivos=atual.arquivos.concat(resumo.map(function(n){return {nome:n, em:new Date().toISOString()};}));
    atual.atualizadoEm=new Date().toISOString();
    S.meses[m]=atual;
    try { await dbTx('readwrite',function(st){ return st.put(atual); }); } catch(e){}
  }
  if(logArq.length) registraImportacao({em:new Date().toISOString(), arquivos:logArq, novos:totAdd, atualizados:totUpd, meses:mesesAfetados});
  if(mesesAfetados.length){
    S.mesSel=mesesAfetados[mesesAfetados.length-1];
    toast('✓ QRY410 importada: '+mesesAfetados.map(mesLabel).join(', ')+'.');
  }
  render();
}

/* ---------- cálculo do fechamento ---------- */
function linhasMes(mes){ var m=S.meses[mes||S.mesSel]; return m ? m.linhas : []; }
function fechamento(mes){
  var L=linhasMes(mes), por={}, fora={}, semLegenda={}, t={p:0,g:0,n301:0,n302:0,f301:0,f302:0,fn:0};
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

/* ---------- histórico de importações (só neste navegador) ---------- */
var LOG_KEY='ldm-net-importacoes';
function leLog(){ try { return JSON.parse(localStorage.getItem(LOG_KEY)||'[]'); } catch(e){ return []; } }
function registraImportacao(ent){ var l=leLog(); l.unshift(ent); try { localStorage.setItem(LOG_KEY, JSON.stringify(l.slice(0,40))); } catch(e){} }

/* ---------- situação de um mês (Painel e Importação) ---------- */
function mesAnteriorDe(m){ var y=+m.slice(0,4), mm=+m.slice(5,7)-1; if(mm<1){ mm=12; y--; } return y+'-'+String(mm).padStart(2,'0'); }
// Mês a fechar = mês anterior ao de hoje (em novembro fecha-se outubro).
function mesAlvo(){ var d=new Date(); return mesAnteriorDe(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')); }
function ultimoDia(m){ return new Date(+m.slice(0,4), +m.slice(5,7), 0).getDate(); }
function periodo(L){
  var min=99, max=0;
  L.forEach(function(r){ var d=parseInt(String(r.dtmov).slice(0,2),10); if(!isNaN(d)){ if(d<min) min=d; if(d>max) max=d; } });
  return max ? {ini:min, fim:max} : null;
}
function fmtDH(iso){ if(!iso) return ''; try { var d=new Date(iso); return d.toLocaleDateString('pt-BR')+' '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); } catch(e){ return ''; } }
function situacao(mes){
  var m=S.meses[mes]; if(!m) return null;
  var F=fechamento(mes), per=periodo(m.linhas), pend=[], ent=m.entregas||{};
  if(!F.t.n301) pend.push('Sem lançamentos da Lógica 301 (perdas)');
  if(!F.t.n302) pend.push('Sem lançamentos da Lógica 302 (ganhos)');
  var sl=Object.keys(F.semLegenda); if(sl.length) pend.push(sl.length+' prefixo(s) sem legenda: '+sl.join(', '));
  if(per && per.fim<ultimoDia(mes)) pend.push('A base vai só até o dia '+per.fim+' — confira se o mês está completo');
  var status = (ent.planilha && (ent.boletim||ent.pptx)) ? {cls:'ok', txt:'Enviado'} : pend.length ? {cls:'pend', txt:'Com pendências'} : {cls:'pronto', txt:'Pronto para enviar'};
  return {F:F, per:per, pend:pend, ent:ent, status:status, m:m};
}
function marcarEntrega(mes, tipo){
  var m=S.meses[mes]; if(!m) return;
  m.entregas=m.entregas||{}; m.entregas[tipo]=new Date().toISOString();
  dbTx('readwrite',function(st){ return st.put(m); }).catch(function(){});
  renderPainel();
}

/* ---------- PAINEL DE FECHAMENTO ---------- */
function passo(estado, n, titulo, detalhe, acao){
  var ic = estado==='ok' ? '✓' : estado==='pend' ? '!' : n;
  return '<li class="passo '+estado+'"><span class="passo-n">'+ic+'</span><div class="passo-txt"><strong>'+titulo+'</strong><span>'+detalhe+'</span></div>'+(acao||'')+'</li>';
}
function milR(v){ var a=Math.abs(v), s=v<0?'-':''; return a>=1e6 ? s+(a/1e6).toFixed(1).replace('.',',')+' mi' : a>=1e3 ? s+Math.round(a/1e3)+' mil' : s+a.toFixed(0); }
function graficoNet(meses){
  if(!meses.length) return '';
  var vals=meses.map(function(m){ return fechamento(m).net; });
  var mx=Math.max.apply(null, vals.map(Math.abs).concat([1]));
  var W=Math.max(320, meses.length*90+20), H=180, base=H/2-6, bw=38;
  var g=meses.map(function(m,i){
    var v=vals[i], h=Math.max(2, Math.abs(v)/mx*(H/2-34)), x=i*90+26, y=v>=0?base-h:base;
    var cor=v>=0?'#1F8A52':'#D83C1E';
    return '<rect x="'+x+'" y="'+y.toFixed(1)+'" width="'+bw+'" height="'+h.toFixed(1)+'" rx="5" fill="'+cor+'"/>'
      +'<text x="'+(x+bw/2)+'" y="'+(v>=0?y-6:y+h+13).toFixed(1)+'" text-anchor="middle" font-size="10.5" font-weight="700" fill="'+cor+'">'+esc(milR(v))+'</text>'
      +'<text x="'+(x+bw/2)+'" y="'+(H-4)+'" text-anchor="middle" font-size="11" fill="currentColor" opacity=".7">'+esc(MESES[+m.slice(5,7)-1].slice(0,3)+'/'+m.slice(2,4))+'</text>';
  }).join('');
  return '<svg class="graf-net" viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" role="img" aria-label="NET mês a mês"><line x1="10" x2="'+(W-10)+'" y1="'+base+'" y2="'+base+'" stroke="currentColor" opacity=".25"/>'+g+'</svg>';
}
function renderPainel(){
  var el=$('painel-corpo'); if(!el) return;
  var alvo=mesAlvo(), st=situacao(alvo), ant=situacao(mesAnteriorDe(alvo));
  var B='<button class="btn sec mini" type="button" data-goto="';
  var card;
  if(!st){
    card='<div class="fech-card"><div class="fech-cab"><div><span class="fech-eyebrow">FECHAMENTO DO MÊS</span><h2>'+esc(mesLabel(alvo))+'</h2></div><span class="status pend">Aguardando base</span></div>'
      +'<p class="fech-msg">A QRY410 de '+esc(mesLabel(alvo))+' ainda não foi importada. Extraia a base do mês fechado (dia 1 ao dia '+ultimoDia(alvo)+') e importe — o app separa as lógicas 301 e 302, aplica a legenda e monta o fechamento sozinho.</p>'
      +'<button class="btn" type="button" data-goto="importar">⬆ Importar QRY410 de '+esc(mesLabel(alvo))+'</button></div>';
  } else {
    var F=st.F, varNet = ant ? F.net-ant.F.net : null, sl=Object.keys(F.semLegenda);
    var passos=
      passo('ok',1,'Base QRY410 importada', fmtInt.format(F.total)+' linhas · '+fmtInt.format(F.t.n301)+' da 301 · '+fmtInt.format(F.t.n302)+' da 302'+(st.per?' · dias '+st.per.ini+' a '+st.per.fim:''), B+'importar">Atualizar base</button>')
      +passo(sl.length?'pend':'ok',2,'Prefixos classificados na legenda', sl.length?'Sem legenda: '+esc(sl.join(', '))+' — ficaram fora do NET':'Todos os prefixos do mês têm legenda', B+'legenda">Abrir legenda</button>')
      +passo(st.pend.length?'pend':'ok',3,'Fechamento conferido', st.pend.length?esc(st.pend.join(' · ')):'Sem pendências · NET de '+esc(brl(F.net)), B+'fechamento" data-sel="'+alvo+'">Ver fechamento</button>')
      +passo(st.ent.planilha?'ok':'todo',4,'Planilha da controladoria', st.ent.planilha?'Baixada em '+fmtDH(st.ent.planilha):'Ainda não baixada', '<button class="btn mini" type="button" data-baixar="'+alvo+'">⬇ Baixar</button>')
      +passo((st.ent.boletim||st.ent.pptx)?'ok':'todo',5,'Boletim e apresentação', (st.ent.boletim||st.ent.pptx)?'Gerado em '+fmtDH(st.ent.pptx||st.ent.boletim):'Ainda não gerados', B+'relatorio" data-sel="'+alvo+'">Abrir relatório</button>');
    card='<div class="fech-card"><div class="fech-cab"><div><span class="fech-eyebrow">FECHAMENTO DO MÊS</span><h2>'+esc(mesLabel(alvo))+'</h2></div><span class="status '+st.status.cls+'">'+st.status.txt+'</span></div>'
      +'<div class="kpis">'
      + kpi('k-perda','Perda · Lógica 301', brl(F.t.p), 'Perda por Inventário')
      + kpi('k-ganho','Ganho · Lógica 302', brl(F.t.g), 'Localização Inventário')
      + kpi('k-net '+(F.net<0?'neg':'pos'),'NET do mês', brl(F.net), varNet===null?'Ganho + Perda':(varNet>=0?'▲ ':'▼ ')+brl(Math.abs(varNet))+' vs '+esc(mesLabel(ant.m.mes)))
      + kpi('k-fora','Fora do NET', brl(F.fora.reduce(function(s,f){return s+f.p+f.g;},0)), fmtInt.format(F.t.f301+F.t.f302)+' linha(s) excluídas pelas regras')
      +'</div><h3 class="passos-tit">Checklist da entrega</h3><ol class="passos">'+passos+'</ol></div>';
  }
  var ms=Object.keys(S.meses).sort();
  var hist = ms.length ? ms.slice().reverse().map(function(m){
    var x=situacao(m), F=x.F;
    return '<tr class="clicavel" data-abrir="'+m+'"><td><strong>'+esc(mesLabel(m))+'</strong></td><td class="n neg">'+brl(F.t.p)+'</td><td class="n pos">'+brl(F.t.g)+'</td><td class="n '+(F.net<0?'neg':'pos')+'"><strong>'+brl(F.net)+'</strong></td><td class="n">'+fmtInt.format(F.total)+'</td><td><span class="status '+x.status.cls+'">'+x.status.txt+'</span></td><td class="muted">'+fmtDH(x.m.atualizadoEm)+'</td></tr>';
  }).join('') : '<tr><td colspan="7" class="muted">Nenhum mês importado ainda.</td></tr>';
  el.innerHTML = card
    + (ms.length ? '<div class="painel"><div class="painel-cab"><div><h3>NET mês a mês</h3><p>Valor líquido (Ganho 302 + Perda 301) de cada mês importado.</p></div></div><div class="graf-wrap">'+graficoNet(ms.slice(-12))+'</div></div>' : '')
    + '<div class="painel"><div class="painel-cab"><div><h3>Histórico de fechamentos</h3><p>Clique num mês para abrir o fechamento dele.</p></div></div>'
    + '<div class="tabela-wrap"><table class="tab"><thead><tr><th>Mês</th><th class="n">Perda (301)</th><th class="n">Ganho (302)</th><th class="n">NET</th><th class="n">Linhas</th><th>Status</th><th>Atualizado em</th></tr></thead><tbody>'+hist+'</tbody></table></div></div>';
}

/* ---------- IMPORTAR QRY410 ---------- */
function renderImportacao(){
  var el=$('imp-corpo'); if(!el) return;
  var ms=Object.keys(S.meses).sort().reverse();
  var bases = ms.length ? ms.map(function(m){
    var x=S.meses[m], per=periodo(x.linhas), n301=0, n302=0;
    x.linhas.forEach(function(r){ if(r.logica===301) n301++; else n302++; });
    var completo = per && per.ini===1 && per.fim===ultimoDia(m);
    var arqs=(x.arquivos||[]).map(function(a){return a.nome;}).filter(function(v,i,a){return a.indexOf(v)===i;});
    return '<tr><td><strong>'+esc(mesLabel(m))+'</strong></td><td class="n">'+fmtInt.format(n301)+'</td><td class="n">'+fmtInt.format(n302)+'</td>'
      +'<td>'+(per?String(per.ini).padStart(2,'0')+' a '+String(per.fim).padStart(2,'0')+'/'+m.slice(5,7):'—')+' '+(completo?'<span class="tag sim">mês completo</span>':'<span class="tag nao">confira</span>')+'</td>'
      +'<td class="arqs" title="'+esc(arqs.join(', '))+'">'+esc(arqs.join(', '))+'</td><td class="muted">'+fmtDH(x.atualizadoEm)+'</td>'
      +'<td><button class="x" type="button" data-remover="'+m+'" aria-label="Remover '+esc(mesLabel(m))+'">×</button></td></tr>';
  }).join('') : '<tr><td colspan="7" class="muted">Nenhuma base importada ainda.</td></tr>';
  var log=leLog();
  var logHtml = log.length ? log.map(function(l){
    var arq=(l.arquivos||[]).map(function(a){ return esc(a.nome)+(a.erro?' <span class="tag nao" title="'+esc(a.erro)+'">erro</span>':' <span class="muted">('+fmtInt.format(a.linhas)+')</span>'); }).join('<br>');
    return '<tr><td class="muted">'+fmtDH(l.em)+'</td><td>'+arq+'</td><td class="n">'+fmtInt.format(l.novos||0)+'</td><td class="n">'+fmtInt.format(l.atualizados||0)+'</td><td>'+esc((l.meses||[]).map(mesLabel).join(', ')||'—')+'</td></tr>';
  }).join('') : '<tr><td colspan="5" class="muted">Nenhuma importação registrada neste navegador.</td></tr>';
  var guia=$('imp-guia');
  if(guia) guia.innerHTML = '<div class="painel guia"><div class="painel-cab"><div><h3>Como extrair a QRY410</h3><p>A base do fechamento é a QRY410 — Perdas e Ganhos no CD.</p></div></div><ol class="guia-lista">'
    + '<li><strong>Período:</strong> do dia 1 ao último dia do mês fechado (ex.: 01/10 a 31/10).</li>'
    + '<li><strong>Lógicas:</strong> 301 (Perda por Inventário) e 302 (Localização Inventário). Pode vir num arquivo só ou em dois — o app junta.</li>'
    + '<li><strong>Formato:</strong> Excel (.xlsx) ou CSV, com o cabeçalho original da consulta.</li>'
    + '<li><strong>Colunas usadas:</strong> Logica, Vl.Mov., Dt.Mov., Observacao WMS, Sentido, Id Deposito, Item, Nome Depto e Movimento ERP.</li>'
    + '<li><strong>Reimportar não duplica:</strong> cada lançamento é identificado pelo Movimento ERP. Se a base for corrigida, é só importar de novo.</li>'
    + '</ol></div>';
  el.innerHTML =
    '<div class="painel"><div class="painel-cab"><div><h3>Bases importadas</h3><p>Uma linha por mês — o app separa pela Dt.Mov. de cada lançamento.</p></div></div>'
    + '<div class="tabela-wrap"><table class="tab"><thead><tr><th>Mês</th><th class="n">Linhas 301</th><th class="n">Linhas 302</th><th>Período da base</th><th>Arquivos</th><th>Atualizado</th><th></th></tr></thead><tbody>'+bases+'</tbody></table></div></div>'
    + '<div class="painel"><div class="painel-cab"><div><h3>Histórico de importações</h3><p>Cada arquivo importado neste navegador, com quantas linhas entraram ou foram atualizadas.</p></div></div>'
    + '<div class="tabela-wrap"><table class="tab"><thead><tr><th>Quando</th><th>Arquivo(s) · linhas lidas</th><th class="n">Novas</th><th class="n">Atualizadas</th><th>Meses</th></tr></thead><tbody>'+logHtml+'</tbody></table></div></div>';
}

/* ---------- renderização ---------- */
function $(id){ return document.getElementById(id); }
function render(){ renderMeses(); renderPainel(); renderImportacao(); renderFechamento(); renderLogica('301'); renderLogica('302'); renderLegenda(); if(window.NETREL) window.NETREL.render(); }

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
  if(!S.mesSel){ el.innerHTML='<div class="vazio"><h3>Importe a QRY410 do mês</h3><p>O fechamento é montado a partir da QRY410. Importe o arquivo do mês na aba <a href="#importar" data-goto="importar">Importar QRY410</a>.</p></div>'; return; }
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
/* Gerada com ExcelJS (carregado só na hora de baixar) para ter o visual da
   Oficina LDM: azul-marinho + laranja, cabeçalhos coloridos, linhas zebradas,
   valores positivos/negativos coloridos, filtros, painel congelado e abas
   coloridas. Os dados e as abas são os mesmos de antes. */
var EXCELJS_URL='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
function carregaScript(url){
  return new Promise(function(res,rej){
    var s=document.createElement('script'); s.src=url; s.onload=res; s.onerror=function(){ rej(new Error('não foi possível carregar '+url)); };
    document.head.appendChild(s);
  });
}
var XL = {
  navy:'FF0B1230', azul:'FF001A72', laranja:'FFFE5000', laranjaClaro:'FFFFF1E8', zebra:'FFF5F6FA', borda:'FFE3E6EF',
  verde:'FF1F8A52', verdeClaro:'FFE8F5EE', vermelho:'FFD83C1E', vermelhoClaro:'FFFDECEA', texto:'FF14172B', cinza:'FF6B7190', lilas:'FFC7CCEA', branco:'FFFFFFFF'
};
var FMT = {moeda:'#,##0.00;-#,##0.00', rs:'"R$ "#,##0.00;"R$ "-#,##0.00', inteiro:'#,##0;-#,##0', id:'0'};
function xlFill(c){ return {type:'pattern', pattern:'solid', fgColor:{argb:c}}; }
var xlBorda = {bottom:{style:'thin', color:{argb:XL.borda}}};

async function exporta(){
  if(typeof ExcelJS==='undefined'){
    try { toast('Preparando a planilha…'); await carregaScript(EXCELJS_URL); }
    catch(e){ toast('Gerador de planilha não carregou. Verifique a internet e recarregue.', true); return; }
  }
  var F=fechamento(), L=linhasMes(), mes=S.mesSel;
  var nomeMes=MESES[parseInt(mes.slice(5,7),10)-1], ano=mes.slice(0,4);
  var wb=new ExcelJS.Workbook();
  wb.creator='Oficina LDM · App NET'; wb.created=new Date();

  /* ===== 1) RESUMO NET (equivale à aba DINAMICA) ===== */
  var wr=wb.addWorksheet('RESUMO NET',{properties:{tabColor:{argb:XL.laranja}}, views:[{showGridLines:false, zoomScale:80}]});
  wr.columns=[{width:3},{width:12},{width:30},{width:28},{width:28},{width:22},{width:3}];
  for(var r=1;r<=3;r++){ for(var c=1;c<=7;c++) wr.getCell(r,c).fill=xlFill(XL.navy); }
  wr.getRow(1).height=10; wr.getRow(2).height=30; wr.getRow(3).height=22;
  wr.mergeCells('B2:F2'); wr.getCell('B2').value='NET CD CAJAMAR · '+nomeMes+'/'+ano;
  wr.getCell('B2').font={name:'Calibri', size:20, bold:true, color:{argb:XL.branco}}; wr.getCell('B2').alignment={vertical:'middle'};
  wr.mergeCells('B3:F3'); wr.getCell('B3').value='BOLETIM · FECHAMENTO MENSAL   ·   Consolidado de ajustes de estoque · gerado em '+new Date().toLocaleString('pt-BR');
  wr.getCell('B3').font={name:'Calibri', size:10, bold:true, color:{argb:XL.laranja}}; wr.getCell('B3').alignment={vertical:'top'};
  wr.getRow(4).height=4; for(c=1;c<=7;c++) wr.getCell(4,c).fill=xlFill(XL.laranja);

  // KPIs
  wr.getRow(6).height=18; wr.getRow(7).height=30;
  var kpis=[['B6:C6','B7:C7','PERDA · LÓGICA 301',F.t.p,XL.vermelho,false],['D6:D6','D7:D7','GANHO · LÓGICA 302',F.t.g,XL.verde,false],['E6:F6','E7:F7','NET DO MÊS',F.net,F.net<0?XL.vermelho:XL.verde,true]];
  kpis.forEach(function(k){
    if(k[0].split(':')[0]!==k[0].split(':')[1]) wr.mergeCells(k[0]);
    if(k[1].split(':')[0]!==k[1].split(':')[1]) wr.mergeCells(k[1]);
    var l=wr.getCell(k[0].split(':')[0]), v=wr.getCell(k[1].split(':')[0]);
    l.value=k[2]; l.font={name:'Calibri', size:9, bold:true, color:{argb:k[5]?XL.laranja:XL.cinza}};
    v.value=k[3]; v.numFmt=FMT.rs; v.font={name:'Calibri', size:18, bold:true, color:{argb:k[4]}};
    l.alignment={vertical:'bottom', horizontal:'left', indent:1}; v.alignment={vertical:'middle', horizontal:'left', indent:1};
    var cols=k[0].replace(/\d/g,'').split(':');
    for(var cc=cols[0].charCodeAt(0); cc<=cols[1].charCodeAt(0); cc++){
      var L1=String.fromCharCode(cc);
      [6,7].forEach(function(rr){
        var cel=wr.getCell(L1+rr); cel.fill=xlFill(k[5]?XL.laranjaClaro:XL.zebra);
        var cor=k[5]?XL.laranja:XL.borda, b={};
        if(rr===6) b.top={style:k[5]?'medium':'thin',color:{argb:cor}};
        if(rr===7) b.bottom={style:k[5]?'medium':'thin',color:{argb:cor}};
        if(cc===cols[0].charCodeAt(0)) b.left={style:k[5]?'medium':'thin',color:{argb:cor}};
        if(cc===cols[1].charCodeAt(0)) b.right={style:k[5]?'medium':'thin',color:{argb:cor}};
        cel.border=b;
      });
    }
  });

  function secao(row, txt){
    wr.getRow(row).height=22;
    var c=wr.getCell('B'+row); c.value=txt; c.font={name:'Calibri', size:12, bold:true, color:{argb:XL.azul}}; c.alignment={vertical:'bottom'};
  }
  function cabecalho(row, titulos, cor){
    wr.getRow(row).height=24;
    titulos.forEach(function(t,i){
      var c=wr.getCell(row,2+i); c.value=t; c.fill=xlFill(cor||XL.azul);
      c.font={name:'Calibri', size:10, bold:true, color:{argb:XL.branco}};
      c.alignment={vertical:'middle', horizontal:i>=2?'right':'left', indent:1, wrapText:true};
    });
  }
  function valor(c, v, cor, negrito){
    if(v===''||v==null){ c.value='–'; c.alignment={horizontal:'right', indent:1}; c.font={name:'Calibri', size:10, color:{argb:XL.cinza}}; return; }
    c.value=v; c.numFmt=FMT.rs; c.alignment={horizontal:'right', indent:1, vertical:'middle'};
    c.font={name:'Calibri', size:10, bold:!!negrito, color:{argb:cor||(v<0?XL.vermelho:(v>0?XL.verde:XL.texto))}};
  }

  secao(9,'RESUMO POR PREFIXO · mesma visão da tabela dinâmica');
  cabecalho(10,['Obs','Legenda','Perda por Inventário (301)','Localização Inventário (302)','NET']);
  var row=11;
  F.linhas.forEach(function(o,i){
    var R=wr.getRow(row); R.height=20;
    var fundo=i%2?XL.zebra:XL.branco;
    for(var c=2;c<=6;c++){ wr.getCell(row,c).fill=xlFill(fundo); wr.getCell(row,c).border=xlBorda; }
    var a=wr.getCell(row,2); a.value=o.prefixo; a.font={name:'Calibri', size:10, bold:true, color:{argb:XL.laranja}}; a.alignment={indent:1, vertical:'middle'};
    var b=wr.getCell(row,3); b.value=o.legenda; b.font={name:'Calibri', size:10, color:{argb:XL.texto}}; b.alignment={indent:1, vertical:'middle'};
    valor(wr.getCell(row,4), o.np?o.p:'', XL.vermelho);
    valor(wr.getCell(row,5), o.ng?o.g:'', XL.verde);
    valor(wr.getCell(row,6), o.net, null, true);
    row++;
  });
  wr.getRow(row).height=24;
  for(c=2;c<=6;c++){ var t=wr.getCell(row,c); t.fill=xlFill(XL.navy); t.font={name:'Calibri', size:11, bold:true, color:{argb:XL.branco}}; t.alignment={vertical:'middle', horizontal:c>=4?'right':'left', indent:1}; }
  wr.getCell(row,2).value='Total Geral';
  [[4,F.t.p],[5,F.t.g],[6,F.net]].forEach(function(p){ var t=wr.getCell(row,p[0]); t.value=p[1]; t.numFmt=FMT.rs; });
  wr.getCell(row,6).font={name:'Calibri', size:11, bold:true, color:{argb:F.net<0?'FFFF8A6B':'FF6EE7A0'}};
  row+=2;

  secao(row,'FORA DO NET · conferência (nada some sem explicação)'); row++;
  cabecalho(row,['Linhas','Motivo','Prefixos','Perda (301)','Ganho (302)'],XL.cinza); row++;
  if(!F.fora.length){ wr.getCell(row,2).value='Nada ficou fora do NET.'; wr.getCell(row,2).font={italic:true, color:{argb:XL.cinza}}; row++; }
  F.fora.forEach(function(f,i){
    var fundo=i%2?XL.zebra:XL.branco;
    for(var c=2;c<=6;c++){ wr.getCell(row,c).fill=xlFill(fundo); wr.getCell(row,c).border=xlBorda; }
    var n=wr.getCell(row,2); n.value=f.n; n.numFmt=FMT.inteiro; n.alignment={horizontal:'left', indent:1}; n.font={name:'Calibri', size:10, bold:true, color:{argb:XL.texto}};
    var m=wr.getCell(row,3); m.value=f.motivo; m.font={name:'Calibri', size:10, color:{argb:XL.texto}}; m.alignment={indent:1};
    var pp=wr.getCell(row,4); pp.value=Object.keys(f.pref).join(', '); pp.font={name:'Calibri', size:10, bold:true, color:{argb:XL.laranja}}; pp.alignment={horizontal:'right', indent:1};
    valor(wr.getCell(row,5), f.p, XL.vermelho); valor(wr.getCell(row,6), f.g, XL.verde);
    wr.getRow(row).height=20; row++;
  });
  row++;
  wr.mergeCells('B'+row+':F'+row);
  var nota=wr.getCell('B'+row);
  nota.value='Regras: só Lógica 301 e 302 · fora do NET: depósito(s) '+(CFG.depositosFora.join(', ')||'nenhum')+' e prefixos com "Considerar NET = NÃO" na legenda · NET = Ganho (302) + Perda (301).';
  nota.font={name:'Calibri', size:9, italic:true, color:{argb:XL.cinza}}; nota.alignment={wrapText:true, vertical:'top'}; wr.getRow(row).height=28;

  /* ===== 2..4) abas de dados ===== */
  var LARG = {cia:8, filial:7, item:10, nome:46, codigoterceiro:14, iddepto:9, nomedepto:28, idfornec:16, nomeforncedor:34, codfornec:14,
    dtmov:11, logica:8, 'nome#2':26, quantidade:11, sentido:9, referencia:11, vlmov:14, iddeposito:10, nomedeposito:18, numdoc:10,
    observacao:12, observacaowms:46, usuario:18, datahora:18, movimentoerp:14};
  var CENTRO = {cia:1, filial:1, iddepto:1, logica:1, iddeposito:1, sentido:1, dtmov:1};
  var IDS = {cia:1, filial:1, item:1, iddepto:1, idfornec:1, logica:1, referencia:1, iddeposito:1, numdoc:1, movimentoerp:1};

  function abaDados(nome, corAba, linhas, positivo, extras){
    var ws=wb.addWorksheet(nome,{properties:{tabColor:{argb:corAba}}, views:[{state:'frozen', xSplit:4, ySplit:1, showGridLines:false, zoomScale:80}]});
    var cols=COLUNAS.map(function(c){ return {header:c.t, key:c.k, width:LARG[c.k]||12}; })
      .concat(extras.map(function(e){ return {header:e.t, key:'x_'+e.k, width:e.w}; }));
    ws.columns=cols;
    var nRaw=COLUNAS.length, iVl=COLUNAS.findIndex(function(c){return c.k==='vlmov';})+1, iQt=COLUNAS.findIndex(function(c){return c.k==='quantidade';})+1;
    var H=ws.getRow(1); H.height=30;
    H.eachCell(function(c,i){
      c.fill=xlFill(i>nRaw?XL.laranja:XL.azul);
      c.font={name:'Calibri', size:10, bold:true, color:{argb:XL.branco}};
      c.alignment={vertical:'middle', horizontal:'center', wrapText:true};
      c.border={right:{style:'thin', color:{argb:'FF2A3A8E'}}};
    });
    linhas.forEach(function(r, idx){
      var a=avalia(r), obj={};
      COLUNAS.forEach(function(c){
        var v = c.k==='vlmov' ? (positivo?Math.abs(r.vl):r.vl) : c.k==='quantidade' ? (positivo?Math.abs(r.qtd):r.qtd) : r[c.k];
        if(IDS[c.k] && typeof v==='string' && /^\d+$/.test(v.trim()) && v.length<16) v=+v;
        obj[c.k] = v==null ? null : v;
      });
      extras.forEach(function(e){ obj['x_'+e.k]=e.v(a,r); });
      var R=ws.addRow(obj);
      R.height=15; // quebra de texto ligada, linha na altura padrão (como no modelo)
      var fundo=idx%2?XL.zebra:null;
      R.eachCell({includeEmpty:true}, function(c,i){
        if(fundo) c.fill=xlFill(fundo);
        c.font={name:'Calibri', size:10, color:{argb:XL.texto}};
        c.border=xlBorda;
        var k = i<=nRaw ? COLUNAS[i-1].k : null;
        if(k && IDS[k] && typeof c.value==='number') c.numFmt=FMT.id;
        c.alignment = (k && CENTRO[k]) ? {horizontal:'center', wrapText:true} : {wrapText:true};
      });
      var vl=R.getCell(iVl); vl.numFmt=FMT.moeda; vl.font={name:'Calibri', size:10, bold:true, color:{argb:r.vl<0?XL.vermelho:XL.verde}};
      R.getCell(iQt).numFmt=FMT.inteiro;
      extras.forEach(function(e,j){
        var c=R.getCell(nRaw+1+j);
        if(e.k==='obs'){ c.font={name:'Calibri', size:10, bold:true, color:{argb:XL.laranja}}; c.alignment={horizontal:'center', wrapText:true}; }
        if(e.k==='net'){
          var sim=c.value==='SIM';
          c.fill=xlFill(sim?XL.verdeClaro:XL.vermelhoClaro);
          c.font={name:'Calibri', size:10, bold:true, color:{argb:sim?XL.verde:XL.vermelho}}; c.alignment={horizontal:'center', wrapText:true};
        }
        if(e.k==='fora' && c.value){ c.font={name:'Calibri', size:10, italic:true, color:{argb:XL.cinza}}; }
      });
    });
    ws.autoFilter={from:{row:1,column:1}, to:{row:1, column:cols.length}};
    return ws;
  }
  var EXTRA_LOG=[
    {k:'obs', t:'OBS', w:9, v:function(a){return a.prefixo;}},
    {k:'leg', t:'Legenda', w:24, v:function(a){return a.legenda;}},
    {k:'net', t:'Considerar NET?', w:13, v:function(a){return a.noNet?'SIM':'NÃO';}},
    {k:'fora', t:'Motivo fora do NET', w:32, v:function(a){return a.motivoFora||'';}}
  ];
  abaDados('PERDA CAJAMAR (301)', XL.vermelho, L.filter(function(r){return r.logica===301;}), true, EXTRA_LOG);
  abaDados('GANHO CAJAMAR (302)', XL.verde, L.filter(function(r){return r.logica===302;}), true, EXTRA_LOG);
  abaDados('CONSOLIDADO', XL.azul, L, false, [
    {k:'obs', t:'OBS', w:9, v:function(a){return a.prefixo;}},
    {k:'leg', t:'Motivo', w:24, v:function(a){return a.legenda;}},
    {k:'set', t:'Setor', w:11, v:function(a){return a.setor;}},
    {k:'net', t:'Considerar NET?', w:13, v:function(a){return a.noNet?'SIM':'NÃO';}}
  ]);

  /* ===== 5) LEGENDA ===== */
  var wl=wb.addWorksheet('LEGENDA',{properties:{tabColor:{argb:XL.cinza}}, views:[{state:'frozen', ySplit:1, showGridLines:false, zoomScale:80}]});
  wl.columns=[{header:'ID',width:10},{header:'Legenda',width:26},{header:'Setor',width:11},{header:'MOTIVO',width:46},{header:'DESCRIÇÃO',width:70},{header:'CONSIDERAR NET?',width:17}];
  wl.getRow(1).height=26;
  wl.getRow(1).eachCell(function(c){ c.fill=xlFill(XL.azul); c.font={name:'Calibri', size:10, bold:true, color:{argb:XL.branco}}; c.alignment={vertical:'middle', horizontal:'center'}; });
  CFG.legenda.forEach(function(l,i){
    var R=wl.addRow([l.id,l.legenda,l.setor,l.motivo,l.descricao,l.net?'SIM':'NÃO']);
    R.eachCell({includeEmpty:true},function(c,j){
      if(i%2) c.fill=xlFill(XL.zebra);
      c.font={name:'Calibri', size:10, color:{argb:XL.texto}}; c.border=xlBorda; c.alignment={vertical:'middle', wrapText:true};
    });
    R.getCell(1).font={name:'Calibri', size:10, bold:true, color:{argb:XL.laranja}};
    var n=R.getCell(6); n.fill=xlFill(l.net?XL.verdeClaro:XL.vermelhoClaro); n.font={name:'Calibri', size:10, bold:true, color:{argb:l.net?XL.verde:XL.vermelho}}; n.alignment={horizontal:'center', vertical:'middle'};
  });
  wl.autoFilter={from:{row:1,column:1}, to:{row:1,column:6}};

  var buf=await wb.xlsx.writeBuffer();
  var blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='CONSOLIDADO - NET CDS - '+ano+' '+nomeMes+'.xlsx';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
  marcarEntrega(mes,'planilha');
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
  if((b=e.target.closest('[data-goto]'))){
    if(b.dataset.sel && S.meses[b.dataset.sel]){ S.mesSel=b.dataset.sel; render(); }
    if(b.tagName==='A'){ e.preventDefault(); if(window.netSwitchTab) window.netSwitchTab(b.dataset.goto); }
    return;
  }
  if((b=e.target.closest('[data-abrir]'))){ S.mesSel=b.dataset.abrir; render(); if(window.netSwitchTab) window.netSwitchTab('fechamento'); return; }
  if((b=e.target.closest('[data-baixar]'))){
    S.mesSel=b.dataset.baixar; render(); b.disabled=true;
    exporta().catch(function(err){ toast('Erro ao gerar a planilha: '+err.message, true); }).finally(function(){ b.disabled=false; });
    return;
  }
  if((b=e.target.closest('[data-remover]'))){
    var mr=b.dataset.remover;
    if(!confirm('Remover a base de '+mesLabel(mr)+' deste navegador? (Dá pra importar de novo depois.)')) return;
    delete S.meses[mr]; if(S.mesSel===mr) S.mesSel=null;
    try { await dbTx('readwrite',function(st){ return st.delete(mr); }); } catch(err){}
    render(); toast('Base removida.'); return;
  }
  if(e.target.id==='btnExportar'){ var bt=e.target; bt.disabled=true; exporta().catch(function(err){ toast('Erro ao gerar a planilha: '+err.message, true); }).finally(function(){ bt.disabled=false; }); return; }
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
  marcarEntrega: function(m,t){ marcarEntrega(m,t); },
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
