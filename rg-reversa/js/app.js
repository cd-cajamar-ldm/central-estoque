/* RG Reversa — acompanhamento da implantação de RG na logística reversa.
 *
 * Meta do módulo: 100% do estoque da reversa identificado por RG (cada peça um RG).
 * Indicador principal: % de unidades da reversa que já têm RG.
 *
 * Bases (exportadas do Bseller e importadas aqui no navegador, guardadas no IndexedDB):
 *   QRY0100 (RG - Produtividade) → 1 linha = 1 RG. Acumula: cada importação soma os novos.
 *   QRY0390 (Estoque por Local)  → foto do saldo; substitui a anterior. Só REV e AVA.
 *   ZBIQ0051 (Item x Múltiplo)   → liga item pai a componentes (para o indicador de múltiplos).
 * Cruzando RG x estoque por item + local sai a cobertura.
 *
 * Coletor / Movimentações: as bipagens vão para o Supabase (tabela public.rg_movimentacoes),
 * para o celular e o computador enxergarem o mesmo dado. */
(function(){
'use strict';

var CLASSES_REVERSA = ['REV','AVA'];
var FAIXAS = [[0,7,'0 a 7 dias'],[8,15,'8 a 15 dias'],[16,30,'16 a 30 dias'],[31,60,'31 a 60 dias'],[61,90,'61 a 90 dias'],[91,1e9,'+ de 90 dias']];
var PAGINA = 200;
var LOG_KEY = 'rg-reversa-log', PEND_KEY = 'rg-reversa-pend';
var RESTR = {WN:'Vendável',WA:'Reversa',WQ:'Quebra',RT:'Conferência',WE:'Amostra',LT:'Litígio',WV:'Validade',WL:'Não localizado',WI:'Insumos',WT:'Análise',WR:'Reparo',AT:'Múlt. reversa',SS:'Marca própria',DT:'Triagem',WD:'Obsoleto',WS:'Leilão',AI:'Múlt. incompleto'};

var TABS = {
  painel:['Dashboard','Implantação de RG na logística reversa — meta: 100% do estoque com RG.'],
  movs:['Movimentações','Relatório do coletor para baixar em Excel ou colar no PuTTY.'],
  importacao:['Importação','Relatórios do Bseller que alimentam o dashboard.']
};

var S = {
  rgs:[], est:null, mult:null, hist:[], tab:'painel', D:null, ocupado:'', user:'',
  movs:null, movsBusy:false, movsErro:'',
  fm:{ de:'', ate:'', st:'pend', q:'' }, lim:{}, sort:{},
  col:null
};

/* ---------- utilidades ---------- */
function $(id){ return document.getElementById(id); }
function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function norm(v){ return String(v==null?'':v).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function int(n){ return Math.round(n||0).toLocaleString('pt-BR'); }
function reais(n){ return (n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
function reaisC(n){ n=n||0; return n>=1e6 ? 'R$ '+(n/1e6).toLocaleString('pt-BR',{maximumFractionDigits:2})+' mi' : n>=1e4 ? 'R$ '+(n/1e3).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mil' : reais(n); }
function pctN(a,b){ return b>0 ? a/b*100 : 0; }
function pct(a,b,dec){ return b>0 ? (a/b*100).toLocaleString('pt-BR',{minimumFractionDigits:dec==null?1:dec,maximumFractionDigits:dec==null?1:dec})+'%' : '—'; }
function d2(n){ return (n<10?'0':'')+n; }
function dataBR(t){ if(!t) return '—'; var d=new Date(t); return d2(d.getDate())+'/'+d2(d.getMonth()+1)+'/'+d.getFullYear(); }
function dm(t){ var d=new Date(t); return d2(d.getDate())+'/'+d2(d.getMonth()+1); }
function dataHoraBR(t){ if(!t) return '—'; var d=new Date(t); return dataBR(t)+' '+d2(d.getHours())+':'+d2(d.getMinutes()); }
function hoje0(){ var d=new Date(); return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime(); }
function dias(t){ return t ? Math.max(0, Math.floor((hoje0()-t)/864e5)) : null; }
function operNome(o){ return String(o||'—').replace(/^MECA_/i,''); }
function cod(v){
  if(v==null || v==='') return '';
  if(typeof v==='number') return String(Math.round(v));
  return String(v).trim().replace(/\.0+$/,'');
}
function num(v){
  if(typeof v==='number') return v;
  if(v==null || v==='') return 0;
  var s=String(v).trim();
  if(/,/.test(s)) s=s.replace(/\./g,'').replace(',','.');
  var n=parseFloat(s); return isNaN(n)?0:n;
}
function parseData(v){
  if(v==null || v==='') return null;
  if(v instanceof Date) return isNaN(v) ? null : v.getTime();
  if(typeof v==='number'){
    if(v<20000 || v>90000) return null;
    var u=new Date(Math.round((v-25569)*864e5));
    return new Date(u.getUTCFullYear(),u.getUTCMonth(),u.getUTCDate(),u.getUTCHours(),u.getUTCMinutes(),u.getUTCSeconds()).getTime();
  }
  var s=String(v).trim();
  var m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m) return new Date(+m[3],+m[2]-1,+m[1],+(m[4]||0),+(m[5]||0),+(m[6]||0)).getTime();
  var t=Date.parse(s); return isNaN(t)?null:t;
}
function soDia(t){ if(!t) return null; var d=new Date(t); return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime(); }
function toast(msg, erro){
  var el=$('toast'); el.textContent=msg; el.className='toast'+(erro?' error':'');
  clearTimeout(toast.t); toast.t=setTimeout(function(){ el.className='toast hidden'; }, erro?7000:3500);
}
function conta(lista, fn){
  var m=new Map();
  lista.forEach(function(x){ var k=fn(x); m.set(k,(m.get(k)||0)+1); });
  return Array.from(m.entries()).sort(function(a,b){ return b[1]-a[1]; });
}

/* ---------- armazenamento local (IndexedDB) ---------- */
var dbP=null;
function db(){
  if(!dbP) dbP=new Promise(function(res,rej){
    var rq=indexedDB.open('ldm-rg-reversa',1);
    rq.onupgradeneeded=function(){ rq.result.createObjectStore('kv'); };
    rq.onsuccess=function(){ res(rq.result); };
    rq.onerror=function(){ rej(rq.error); };
  });
  return dbP;
}
function dbGet(k){ return db().then(function(d){ return new Promise(function(res,rej){ var r=d.transaction('kv').objectStore('kv').get(k); r.onsuccess=function(){ res(r.result); }; r.onerror=function(){ rej(r.error); }; }); }); }
function dbSet(k,v){ return db().then(function(d){ return new Promise(function(res,rej){ var tx=d.transaction('kv','readwrite'); tx.objectStore('kv').put(v,k); tx.oncomplete=function(){ res(); }; tx.onerror=function(){ rej(tx.error); }; }); }); }
function dbDel(k){ return db().then(function(d){ return new Promise(function(res,rej){ var tx=d.transaction('kv','readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete=function(){ res(); }; tx.onerror=function(){ rej(tx.error); }; }); }); }
function lsGet(k){ try { return JSON.parse(localStorage.getItem(k)||'[]'); } catch(e){ return []; } }
function lsSet(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
function gravaLog(ent){ var l=lsGet(LOG_KEY); l.unshift(ent); lsSet(LOG_KEY, l.slice(0,30)); }

/* ---------- leitura dos relatórios ---------- */
function leArquivo(file){
  return new Promise(function(res,rej){
    var fr=new FileReader();
    fr.onerror=function(){ rej(new Error('Não consegui ler o arquivo.')); };
    fr.onload=function(){
      try {
        var wb=XLSX.read(new Uint8Array(fr.result),{type:'array',cellDates:true});
        var achou=null;
        wb.SheetNames.some(function(n){
          var aoa=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,raw:true,defval:null,blankrows:false});
          for(var i=0;i<Math.min(aoa.length,12);i++){
            var h=(aoa[i]||[]).map(norm);
            if(h.indexOf('numero rg')>=0){ achou={tipo:'rg',h:h,linhas:aoa.slice(i+1)}; return true; }
            if(h.indexOf('item componente')>=0 && h.indexOf('item vol multiplo')>=0){ achou={tipo:'mult',h:h,linhas:aoa.slice(i+1)}; return true; }
            if(h.indexOf('classe local')>=0 && h.indexOf('quantidade')>=0 && h.indexOf('item')>=0){ achou={tipo:'est',h:h,linhas:aoa.slice(i+1)}; return true; }
          }
          return false;
        });
        if(!achou) return rej(new Error('"'+file.name+'" não parece ser a QRY0100, a QRY0390 nem a ZBIQ0051.'));
        res(achou);
      } catch(e){ rej(new Error('Não consegui abrir "'+file.name+'".')); }
    };
    fr.readAsArrayBuffer(file);
  });
}
function montaRgs(a){
  var c=function(n){ return a.h.indexOf(n); };
  var ix={ dt:c('data criacao'), filial:c('filial geracao'), oper:c('operador'), tipo:c('tipo de geracao'), rg:c('numero rg'),
    item:c('item'), ean:c('ean'), preco:c('preco'), entrega:c('entrega'), inst:c('instancia'), nr:c('nr'),
    classif:c('classificacao'), classe:c('classe local'), local:c('local atual'), imp:c('qtd impressoes'), sit:c('situacao') };
  var g=function(l,i){ return i>=0 ? l[i] : null; };
  var out=[];
  a.linhas.forEach(function(l){
    var rg=cod(g(l,ix.rg)); if(!rg) return;
    out.push({
      rg:rg,
      /* Só o dia: na QRY0100 o horário vem com defeito (o minuto repete a hora). */
      dt:soDia(parseData(g(l,ix.dt))),
      filial:cod(g(l,ix.filial)), oper:String(g(l,ix.oper)||'').trim(), tipo:String(g(l,ix.tipo)||'').trim(),
      item:cod(g(l,ix.item)), ean:cod(g(l,ix.ean)), preco:num(g(l,ix.preco)),
      entrega:cod(g(l,ix.entrega)), inst:cod(g(l,ix.inst)), nr:cod(g(l,ix.nr)),
      classif:String(g(l,ix.classif)||'').trim(), classe:String(g(l,ix.classe)||'').trim(),
      local:cod(g(l,ix.local)), imp:num(g(l,ix.imp)), sit:String(g(l,ix.sit)||'').trim()
    });
  });
  return out;
}
/* A QRY0390 tem três colunas "Descrição": a do item, a da classe e a do local —
   cada uma logo depois da coluna que descreve. */
function montaEstoque(a, nome){
  var c=function(n){ return a.h.indexOf(n); };
  var desc=function(i){ return (i>=0 && a.h[i+1]==='descricao') ? i+1 : -1; };
  var iItem=c('item'), iEan=c('ean'), iCl=c('classe local'), iLoc=c('local'), iQ=c('quantidade'), iDt=c('data situacao'), iRes=c('restricao');
  var iItemD=desc(iItem), iClD=desc(iCl), iLocD=desc(iLoc);
  var m=new Map(), classes={}, linhasRev=0, un=0, todos=new Map();
  a.linhas.forEach(function(l){
    var cl=String(l[iCl]||'').trim().toUpperCase();
    var lc=cod(l[iLoc]); if(lc && !todos.has(lc)) todos.set(lc,[lc, iLocD>=0?String(l[iLocD]||'').trim():'', cl]);
    if(CLASSES_REVERSA.indexOf(cl)<0) return;
    var item=cod(l[iItem]), loc=cod(l[iLoc]); if(!item) return;
    var q=num(l[iQ]), t=iDt>=0 ? parseData(l[iDt]) : null;
    linhasRev++; un+=q;
    if(iClD>=0 && l[iClD]) classes[cl]=String(l[iClD]).trim();
    var k=item+'|'+loc, r=m.get(k);
    if(!r){ r={i:item, d:iItemD>=0?String(l[iItemD]||'').trim():'', e:iEan>=0?cod(l[iEan]):'', c:cl, l:loc, ld:iLocD>=0?String(l[iLocD]||'').trim():loc, q:0, t:null, x:{}}; m.set(k,r); }
    r.q+=q;
    if(t && (!r.t || t<r.t)) r.t=t;
    var res=iRes>=0 ? String(l[iRes]||'').trim() : '';
    if(res) r.x[res]=(r.x[res]||0)+q;
  });
  return { rows:Array.from(m.values()), locais:Array.from(todos.values()), classes:classes, arquivo:nome, em:Date.now(), linhasArquivo:a.linhas.length, linhasReversa:linhasRev, unidades:un };
}
function montaMult(a, nome){
  var iC=a.h.indexOf('item componente'), iP=a.h.indexOf('item vol multiplo'), iQ=a.h.indexOf('qtde');
  var rows=[];
  a.linhas.forEach(function(l){ var c=cod(l[iC]), p=cod(l[iP]); if(c && p) rows.push([c,p,iQ>=0?num(l[iQ]):1]); });
  return { rows:rows, arquivo:nome, em:Date.now() };
}

function importar(files){
  if(!files || !files.length) return;
  if(typeof XLSX==='undefined'){ toast('A leitura de planilhas não carregou. Verifique a internet e atualize a página.', true); return; }
  S.ocupado='Lendo '+(files.length>1?files.length+' arquivos':'"'+files[0].name+'"')+'… arquivos grandes levam alguns segundos.';
  render();
  var fila=Array.prototype.slice.call(files), msgs=[], erros=[];
  function proximo(){
    if(!fila.length) return Promise.resolve();
    var f=fila.shift();
    return leArquivo(f).then(function(a){
      if(a.tipo==='rg'){
        var novos=montaRgs(a), mapa=new Map(), antes=S.rgs.length, atual=0;
        S.rgs.forEach(function(r){ mapa.set(r.rg,r); });
        novos.forEach(function(r){ if(mapa.has(r.rg)) atual++; mapa.set(r.rg,r); });
        S.rgs=Array.from(mapa.values());
        var add=S.rgs.length-antes;
        gravaLog({em:Date.now(), tipo:'QRY0100 · RG', arquivo:f.name, resumo:int(novos.length)+' RGs lidos · '+int(add)+' novos · '+int(atual)+' atualizados'});
        msgs.push(int(add)+' RGs novos');
        return dbSet('rgs', S.rgs);
      }
      if(a.tipo==='mult'){
        var mu=montaMult(a, f.name);
        if(!mu.rows.length) throw new Error('"'+f.name+'" não tem componentes de múltiplos.');
        S.mult=mu;
        gravaLog({em:Date.now(), tipo:'ZBIQ0051 · Múltiplos', arquivo:f.name, resumo:int(mu.rows.length)+' ligações pai x componente'});
        msgs.push('múltiplos ('+int(mu.rows.length)+' ligações)');
        return dbSet('mult', S.mult);
      }
      var est=montaEstoque(a, f.name);
      if(!est.rows.length) throw new Error('"'+f.name+'" não tem saldo nas classes da reversa ('+CLASSES_REVERSA.join(', ')+').');
      S.est=est;
      gravaLog({em:Date.now(), tipo:'QRY0390 · Estoque', arquivo:f.name, resumo:int(est.linhasArquivo)+' linhas no arquivo · '+int(est.linhasReversa)+' da reversa · '+int(est.unidades)+' unidades'});
      msgs.push('estoque da reversa ('+int(est.unidades)+' un)');
      return dbSet('est', S.est).then(function(){
        /* a lista de locais (nome de cada local) vai para o Supabase: é o que o coletor mostra ao bipar */
        return RG.subeLocais(window.rgSupa, est.locais).then(function(n){ msgs.push(int(n)+' locais enviados ao coletor'); })
          .catch(function(e){ erros.push('Não consegui enviar a lista de locais ao coletor: '+((e&&e.message)||e)); });
      });
    }).catch(function(e){ erros.push(e.message||String(e)); }).then(proximo);
  }
  setTimeout(function(){
    proximo().then(function(){
      S.ocupado=''; deriva(); snapshot();
      return dbSet('hist', S.hist).catch(function(){});
    }).then(function(){
      render();
      if(erros.length) toast(erros.join(' '), true);
      else if(msgs.length) toast('Importado: '+msgs.join(' · ')+'.');
    });
  }, 60);
}

/* ---------- cruzamento RG x estoque ---------- */
function aberto(r){ var s=norm(r.sit); return !s || s==='aberto'; }
function deriva(){
  var D={ itemDesc:new Map(), localDesc:new Map(), locCod:new Map(), locNome:new Map(), cov:[], tot:{saldo:0, comRg:0, semRg:0, rgSemSaldo:0}, abertos:[], porClasse:new Map(), rgMap:new Map(),
    faixas:FAIXAS.map(function(){ return 0; }), restr:new Map(), itens:new Map(), mult:{ itens:0, un:0, semRg:0 } };
  D.abertos=S.rgs.filter(aberto);
  S.rgs.forEach(function(r){ D.rgMap.set(r.rg,r); });
  var multSet=new Set(); if(S.mult) S.mult.rows.forEach(function(r){ multSet.add(r[0]); });
  var m=new Map();
  if(S.est) S.est.rows.forEach(function(r){
    if(r.d) D.itemDesc.set(r.i,r.d);
    D.localDesc.set(r.l,r.ld);
    D.locCod.set(r.l, r.l); D.locNome.set(norm(r.ld), r.l);
    m.set(r.i+'|'+r.l, {item:r.i, desc:r.d, ean:r.e, classe:r.c, local:r.l, localDesc:r.ld, saldo:r.q, rgs:0, t:r.t, x:r.x||{}});
  });
  D.abertos.forEach(function(r){
    var k=r.item+'|'+r.local, c=m.get(k);
    if(!c){ c={item:r.item, desc:D.itemDesc.get(r.item)||'', ean:r.ean, classe:r.classe, local:r.local, localDesc:D.localDesc.get(r.local)||r.local, saldo:0, rgs:0, t:null, x:{}}; m.set(k,c); }
    c.rgs++;
  });
  var itemMap=new Map();
  m.forEach(function(c){
    c.semRg=Math.max(0,c.saldo-c.rgs); c.rgSemSaldo=Math.max(0,c.rgs-c.saldo); c.dias=dias(c.t); c.mult=multSet.has(c.item);
    D.tot.saldo+=c.saldo; D.tot.comRg+=Math.min(c.saldo,c.rgs); D.tot.semRg+=c.semRg; D.tot.rgSemSaldo+=c.rgSemSaldo;
    var pc=D.porClasse.get(c.classe); if(!pc){ pc={classe:c.classe, saldo:0, comRg:0, semRg:0, rgs:0}; D.porClasse.set(c.classe,pc); }
    pc.saldo+=c.saldo; pc.comRg+=Math.min(c.saldo,c.rgs); pc.semRg+=c.semRg; pc.rgs+=c.rgs;
    if(c.semRg>0 && c.dias!=null) for(var i=0;i<FAIXAS.length;i++) if(c.dias>=FAIXAS[i][0] && c.dias<=FAIXAS[i][1]){ D.faixas[i]+=c.semRg; break; }
    Object.keys(c.x).forEach(function(s){ D.restr.set(s,(D.restr.get(s)||0)+c.x[s]); });
    if(c.semRg>0){ var it=itemMap.get(c.item); if(!it){ it={item:c.item, desc:c.desc, semRg:0, saldo:0}; itemMap.set(c.item,it); } it.semRg+=c.semRg; it.saldo+=c.saldo; }
    if(c.mult){ D.mult.un+=c.saldo; D.mult.semRg+=c.semRg; }
    D.cov.push(c);
  });
  D.itens=itemMap;
  var mi=new Set(); D.cov.forEach(function(c){ if(c.mult) mi.add(c.item); }); D.mult.itens=mi.size;
  /* Situação de cada local — meta: 100% dos locais só com RG.
       rg = toda unidade do local tem RG · misto = RG e peça sem RG juntas · sem = nenhuma tem RG */
  var ml=new Map();
  D.cov.forEach(function(c){
    var l=ml.get(c.local); if(!l){ l={local:c.local, localDesc:c.localDesc, classe:c.classe, saldo:0, rgs:0, comRg:0, semRg:0, itens:0, itensMistos:0}; ml.set(c.local,l); }
    l.saldo+=c.saldo; l.rgs+=c.rgs; l.comRg+=Math.min(c.saldo,c.rgs); l.semRg+=c.semRg; l.itens++;
    if(c.rgs && c.semRg) l.itensMistos++;
  });
  D.locais=Array.from(ml.values());
  D.loc={total:D.locais.length, rg:0, misto:0, sem:0, unMisto:0};
  D.locais.forEach(function(l){
    l.st = l.rgs>0 ? (l.semRg>0 ? 'misto' : 'rg') : 'sem';
    D.loc[l.st]++;
    if(l.st==='misto') D.loc.unMisto+=l.semRg;
  });
  /* Ritmo: RGs por dia, usando os dias com geração (últimos 14 dias corridos até o dado mais novo). */
  var porDia=new Map(); S.rgs.forEach(function(r){ if(r.dt) porDia.set(r.dt,(porDia.get(r.dt)||0)+1); });
  D.porDia=porDia;
  D.ultimoDia=porDia.size ? Math.max.apply(null,Array.from(porDia.keys())) : null;
  D.ritmo=0;
  if(D.ultimoDia){
    var ds=[]; for(var i=0;i<14;i++){ var t=D.ultimoDia-i*864e5; if(porDia.get(t)) ds.push(porDia.get(t)); }
    ds=ds.slice(0,7); D.ritmo=ds.length ? ds.reduce(function(a,b){ return a+b; },0)/ds.length : 0;
  }
  S.D=D;
}
/* Foto diária da cobertura: é dela que sai o gráfico de evolução. */
function snapshot(){
  var D=S.D; if(!S.est || !D || !D.tot.saldo) return;
  var hoje=hoje0(), ent={ d:hoje, saldo:D.tot.saldo, comRg:D.tot.comRg, semRg:D.tot.semRg, locRg:D.loc.rg, locTot:D.loc.total, misto:D.loc.misto };
  var i=S.hist.findIndex(function(h){ return h.d===hoje; });
  if(i>=0) S.hist[i]=ent; else S.hist.push(ent);
  S.hist.sort(function(a,b){ return a.d-b.d; });
}

/* ---------- peças de gráfico (SVG/HTML com tooltip) ---------- */
function tipA(txt){ return ' data-tip="'+esc(txt)+'"'; }
function niceTop(max){
  if(max<=0) return 1;
  var e=Math.pow(10,Math.floor(Math.log(max)/Math.LN10)), n=max/e;
  return (n<=1?1:n<=2?2:n<=5?5:10)*e;
}
function fmtEixo(v){ return v>=1000 ? int(v) : (Math.round(v*10)/10).toLocaleString('pt-BR'); }
function lineChart(pts, sufixo){
  if(!pts.length) return '<div class="rv-empty">Sem dados ainda.</div>';
  var W=560,H=220,pl=46,pr=18,pt=16,pb=30, max=0;
  pts.forEach(function(p){ if(p.y>max) max=p.y; });
  var top=niceTop(max*1.15||1); if(sufixo==='%' && top>100) top=100;
  var X=function(i){ return pts.length>1 ? pl+(W-pl-pr)*i/(pts.length-1) : pl+(W-pl-pr)/2; };
  var Y=function(v){ return pt+(H-pt-pb)*(1-v/top); };
  var s='<svg class="rv-svg" viewBox="0 0 '+W+' '+H+'"><defs><linearGradient id="rvA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#33488E" stop-opacity=".30"/><stop offset="1" stop-color="#33488E" stop-opacity="0"/></linearGradient></defs>';
  for(var g=0;g<=4;g++){ var v=top*g/4; s+='<line class="gr" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+Y(v)+'" y2="'+Y(v)+'"/><text x="'+(pl-8)+'" y="'+(Y(v)+4)+'" text-anchor="end">'+fmtEixo(v)+(sufixo||'')+'</text>'; }
  var path=pts.map(function(p,i){ return (i?'L':'M')+X(i).toFixed(1)+' '+Y(p.y).toFixed(1); }).join(' ');
  if(pts.length>1) s+='<path d="'+path+' L'+X(pts.length-1).toFixed(1)+' '+Y(0)+' L'+X(0).toFixed(1)+' '+Y(0)+' Z" fill="url(#rvA)"/>';
  s+='<path class="ln" d="'+path+'"/>';
  var passo=Math.max(1,Math.ceil(pts.length/7));
  pts.forEach(function(p,i){
    s+='<circle class="dot" cx="'+X(i).toFixed(1)+'" cy="'+Y(p.y).toFixed(1)+'" r="4.5"'+tipA(p.t)+'/>';
    if(i%passo===0 || i===pts.length-1) s+='<text x="'+X(i).toFixed(1)+'" y="'+(H-8)+'" text-anchor="middle">'+esc(p.l)+'</text>';
  });
  return s+'</svg>';
}
function barChart(pts, cor){
  if(!pts.length) return '<div class="rv-empty">Sem dados ainda.</div>';
  var W=560,H=220,pl=40,pr=10,pt=22,pb=30, max=0;
  pts.forEach(function(p){ if(p.y>max) max=p.y; });
  var top=niceTop(max*1.1||1), n=pts.length, bw=(W-pl-pr)/n, w=Math.max(3,bw*0.68);
  var Y=function(v){ return pt+(H-pt-pb)*(1-v/top); };
  var s='<svg class="rv-svg" viewBox="0 0 '+W+' '+H+'"><defs><linearGradient id="rvB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+(cor||'#FF7A3D')+'"/><stop offset="1" stop-color="#FE5000"/></linearGradient></defs>';
  for(var g=0;g<=4;g++){ var v=top*g/4; s+='<line class="gr" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+Y(v)+'" y2="'+Y(v)+'"/><text x="'+(pl-6)+'" y="'+(Y(v)+4)+'" text-anchor="end">'+fmtEixo(v)+'</text>'; }
  var passo=Math.max(1,Math.ceil(n/10));
  pts.forEach(function(p,i){
    var x=pl+i*bw+(bw-w)/2, y=Y(p.y);
    s+='<rect class="bar" x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+Math.max(0,Y(0)-y).toFixed(1)+'" rx="3" fill="url(#rvB)"'+tipA(p.t)+'/>';
    if(n<=16 && p.y>0) s+='<text x="'+(x+w/2).toFixed(1)+'" y="'+(y-5).toFixed(1)+'" text-anchor="middle" style="font-weight:700;fill:var(--ink)">'+int(p.y)+'</text>';
    if((i%passo===0 && (n-1-i)>=passo/2) || i===n-1) s+='<text x="'+(x+w/2).toFixed(1)+'" y="'+(H-9)+'" text-anchor="middle">'+esc(p.l)+'</text>';
  });
  return s+'</svg>';
}
/* Barras horizontais. item: {l, v, t, cor, v2 (segunda parte opcional), cor2, txt} */
function hbars(lista, cfg){
  cfg=cfg||{};
  if(!lista.length) return '<div class="rv-empty">'+(cfg.vazio||'Sem dados.')+'</div>';
  var max=cfg.max || Math.max.apply(null, lista.map(function(x){ return x.v+(x.v2||0); }))||1;
  return lista.map(function(x){
    var mx=x.max||max, w1=(x.v/mx*100).toFixed(1), w2=((x.v2||0)/mx*100).toFixed(1);
    return '<div class="rv-hb"'+(x.t?tipA(x.t):'')+'><div class="lb">'+esc(x.l)+'</div><div class="tk"><i style="width:'+w1+'%;background:'+(x.cor||cfg.cor||'linear-gradient(90deg,#FE5000,#FFB347)')+'"></i>'+(x.v2?'<i style="width:'+w2+'%;background:'+(x.cor2||'#CBD5E1')+'"></i>':'')+'</div><div class="vl">'+(x.txt!=null?x.txt:int(x.v))+'</div></div>';
  }).join('');
}
var PALETA=['#001A72','#FE5000','#8A93B8','#F59E0B','#1F8A52','#33488E','#C83812','#94A3B8'];
function donut(lista, centro){
  var tot=lista.reduce(function(s,x){ return s+x.v; },0);
  if(!tot) return '<div class="rv-empty">Sem dados.</div>';
  var R=54, C=2*Math.PI*R, off=0, s='<svg viewBox="0 0 140 140"><circle cx="70" cy="70" r="'+R+'" fill="none" stroke="var(--surface2)" stroke-width="18"/>';
  lista.forEach(function(x,i){
    var len=x.v/tot*C;
    s+='<circle cx="70" cy="70" r="'+R+'" fill="none" stroke="'+PALETA[i%PALETA.length]+'" stroke-width="18" stroke-dasharray="'+len.toFixed(2)+' '+(C-len).toFixed(2)+'" stroke-dashoffset="'+(-off).toFixed(2)+'"'+tipA(x.l+'\n'+int(x.v)+' RGs · '+pct(x.v,tot))+'/>';
    off+=len;
  });
  s+='</svg>';
  var leg='<div class="rv-donut-l">'+lista.map(function(x,i){ return '<div'+tipA(x.l+'\n'+int(x.v)+' RGs · '+pct(x.v,tot))+'><i style="background:'+PALETA[i%PALETA.length]+'"></i>'+esc(x.l)+'<b>'+pct(x.v,tot,0)+'</b></div>'; }).join('')+'</div>';
  return '<div class="rv-donut">'+s+leg+'</div>';
}
function ring(p){
  var R=64, C=2*Math.PI*R, f=Math.max(0,Math.min(1,p/100));
  return '<div class="rv-ring"><svg viewBox="0 0 150 150"><defs><linearGradient id="rvR" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FE5000"/><stop offset="1" stop-color="#FF7A4D"/></linearGradient></defs>'+
    '<circle class="tr" cx="75" cy="75" r="'+R+'" fill="none" stroke-width="15"/>'+
    '<circle class="pg" cx="75" cy="75" r="'+R+'" fill="none" stroke="url(#rvR)" stroke-width="15" stroke-linecap="round" stroke-dasharray="'+C.toFixed(2)+'" stroke-dashoffset="'+(C*(1-f)).toFixed(2)+'"/></svg>'+
    '<div class="rv-ring-c"><b>'+pct(p,100)+'</b><span>COM RG</span></div></div>';
}
function panel(tit, sub, corpo, extra){
  return '<div class="panel"><div class="panel-head-row"><h3>'+tit+'</h3>'+(extra||'')+'</div>'+(sub?'<div class="panel-sub">'+sub+'</div>':'')+corpo+'</div>';
}
function tile(t1,t2,t3,cls,tip){ return '<div class="rv-tile"'+(tip?tipA(tip):'')+'><div class="t1">'+t1+'</div><div class="t2 '+(cls||'')+'">'+t2+'</div><div class="t3">'+t3+'</div></div>'; }

/* ---------- Dashboard ---------- */
function vPainel(){
  var D=S.D, T=D.tot, ab=D.abertos, tem=!!S.est;
  var maxDt=D.ultimoDia;
  var hero='<div class="rv-hero"><div class="rv-hero-in">'+
    '<div class="rv-marca"><img src="brand/Logo_LDM_icon.png" alt=""><div><b>Oficina LDM</b><span>RG Reversa · CD Cajamar</span></div></div>'+
    '<div class="rv-hero-row"><div><h2>Dashboard RG Reversa</h2></div>'+
    '<div class="rv-hero-btns"><a class="rv-btn pri" href="coletor/">📲 Abrir coletor</a><button class="rv-btn sec" data-act="tab" data-tab="importacao">⬆ Importar relatórios</button></div></div></div></div>';
  if(!tem && !S.rgs.length){
    return hero+'<div class="rv-body"><div class="panel"><div class="empty-state"><div class="eicon">📦</div><h3>Nenhum relatório importado ainda</h3><p>Importe a <strong>QRY0100</strong> (RGs), a <strong>QRY0390</strong> (Estoque por Local) e a <strong>ZBIQ0051</strong> (Múltiplos) para ver os indicadores.</p><p style="margin-top:16px"><button class="btn btn-orange" data-act="tab" data-tab="importacao">Ir para Importação</button></p></div></div></div>';
  }
  var b='<div class="rv-body">';
  /* — cartões de topo — */
  var p=pctN(T.comRg,T.saldo), meta=100;
  b+='<div class="rv-top">';
  if(tem){
    b+='<div class="rv-card rv-main blue"'+tipA('Cobertura de RG\n'+int(T.comRg)+' de '+int(T.saldo)+' unidades da reversa\nMeta: 100%')+'>'+ring(p)+
      '<div class="rv-main-tx"><div class="rv-rot"><span>Cobertura de RG</span></div>'+
      '<div class="rv-num">'+int(T.comRg)+' <small>de '+int(T.saldo)+' un</small></div>'+
      '<div class="rv-meta-bar"><i style="width:'+Math.max(0.4,p).toFixed(2)+'%"></i><s title="Meta 100%"></s></div>'+
      '<div class="rv-hint">Faltam <b>'+int(T.semRg)+'</b> · meta 100%</div></div></div>';
    b+='<div class="rv-card"'+tipA('Unidades da reversa ainda sem RG\n'+pct(T.semRg,T.saldo)+' do estoque')+'><div class="rv-rot"><span>Unidades sem RG</span></div><div class="rv-num">'+int(T.semRg)+'</div><div class="rv-hint"><b>'+pct(T.semRg,T.saldo)+'</b> do estoque da reversa · REV + AVA</div></div>';
    b+='<div class="rv-card green"'+tipA('Locais em que toda unidade tem RG\nMeta: 100% dos locais')+'><div class="rv-rot"><span>Locais 100% RG</span><span class="rv-pill '+(D.loc.rg===D.loc.total?'ok':'info')+'">meta 100%</span></div><div class="rv-num">'+pct(D.loc.rg,D.loc.total)+'</div><div class="rv-hint"><b>'+int(D.loc.rg)+'</b> de <b>'+int(D.loc.total)+'</b> locais</div></div>';
    b+='<div class="rv-card '+(D.loc.misto?'red':'green')+'"'+tipA('Locais que misturam peças com RG e sem RG\n'+int(D.loc.unMisto)+' unidades sem RG dentro deles')+'><div class="rv-rot"><span>Locais mistos</span>'+(D.loc.misto?'<span class="rv-pill bad">atenção</span>':'<span class="rv-pill ok">ok</span>')+'</div><div class="rv-num">'+int(D.loc.misto)+'</div><div class="rv-hint"><b>'+int(D.loc.unMisto)+'</b> un. sem RG misturadas com peças com RG</div></div>';
  } else {
    b+='<div class="rv-card rv-main" style="grid-column:1/-1"><div class="rv-main-tx"><div class="rv-rot"><span>Falta o estoque</span></div><div class="rv-hint">Importe a <b>QRY0390</b> (Estoque por Local) para calcular a cobertura de RG da reversa.</div></div></div>';
  }
  b+='</div>';
  if(!S.rgs.length) b+='<div class="rv-aviso"><strong>Faltam os RGs:</strong> importe a QRY0100 (RG - Produtividade) para calcular a cobertura.</div>';
  /* — faixa de números — */
  var semCl=ab.filter(function(r){ return !r.classif; }).length;
  var valor=ab.reduce(function(s,r){ return s+r.preco; },0);
  var ult=maxDt?(D.porDia.get(maxDt)||0):0, ant=maxDt?(D.porDia.get(maxDt-864e5)||0):0;
  var f='<div class="rv-faixa">';
  f+=tile('RGs abertos',int(ab.length),int(S.rgs.length)+' RGs na base','blue');
  f+=tile('RGs no último dia',int(ult),maxDt?dataBR(maxDt)+' · véspera '+int(ant):'—','',maxDt?'Último dia com RG: '+dataBR(maxDt)+'\n'+int(ult)+' RGs\nDia anterior: '+int(ant):'');
  f+=tile('Ritmo (média 7 dias)',D.ritmo?int(D.ritmo)+'/dia':'—','dias com geração de RG','');
  f+=tile('Valor dos RGs abertos',reaisC(valor),reais(valor)+' · preço da QRY0100','');
  f+=tile('RGs sem classificação',int(semCl),semCl?'aguardando avaliação':'tudo classificado',semCl?'bad':'good');
  if(tem){
    f+=tile('RGs sem saldo no local',int(T.rgSemSaldo),T.rgSemSaldo?'RG existe, saldo não':'sem divergência',T.rgSemSaldo?'bad':'good','RGs abertos cujo item/local não tem saldo na QRY0390 (peça já movida ou baixada?)');
    f+=tile('Múltiplos na reversa',S.mult?int(D.mult.un)+' un':'—',S.mult?int(D.mult.itens)+' itens · '+pct(D.mult.semRg,D.mult.un,0)+' sem RG':'importe a ZBIQ0051','');
  }
  b+=f+'</div>';
  if(!tem) return hero+b+'</div>';
  /* — evolução — */
  var pts=S.hist.map(function(h){ var pp=pctN(h.comRg,h.saldo); return {l:dm(h.d), y:pp, t:dataBR(h.d)+'\nCobertura: '+pp.toLocaleString('pt-BR',{maximumFractionDigits:2})+'%\nCom RG: '+int(h.comRg)+' de '+int(h.saldo)+'\nLocais 100% RG: '+int(h.locRg)+' de '+int(h.locTot)}; });
  var evo=lineChart(pts,'%');
  if(pts.length<2) evo+='<div class="rv-hint" style="margin-top:6px">A linha ganha forma a cada nova importação da QRY0390: o app guarda uma foto da cobertura por dia.</div>';
  var ultimo=maxDt||hoje0(), ser=[], acum=0, base=0;
  S.rgs.forEach(function(r){ if(r.dt && r.dt<ultimo-29*864e5) base++; });
  acum=base;
  for(var i=29;i>=0;i--){ var t=ultimo-i*864e5, v=D.porDia.get(t)||0; acum+=v; ser.push({l:dm(t), y:v, t:dataBR(t)+'\n'+int(v)+' RGs gerados\nAcumulado: '+int(acum)}); }
  b+='<div class="rv-g12">'+
    panel('Evolução da cobertura de RG','% de unidades da reversa com RG, foto a foto.',evo)+
    panel('RGs gerados por dia','Últimos 30 dias até '+(maxDt?dataBR(maxDt):'—')+'.',barChart(ser))+'</div>';
  /* — classe + classificação — */
  var pcs=Array.from(D.porClasse.values()).sort(function(a,b){ return b.saldo-a.saldo; });
  var cl=hbars(pcs.map(function(c){ var nome=(S.est.classes[c.classe]?c.classe+' · '+S.est.classes[c.classe]:c.classe);
    return {l:nome, v:c.comRg, v2:c.semRg, max:c.saldo, cor:'linear-gradient(90deg,var(--rv-blue),var(--rv-blue2))', cor2:'linear-gradient(90deg,#FE5000,#FFB347)', txt:pct(c.comRg,c.saldo), t:nome+'\nSaldo: '+int(c.saldo)+' un\nCom RG: '+int(c.comRg)+' ('+pct(c.comRg,c.saldo)+')\nSem RG: '+int(c.semRg)}; }));
  cl+='<div class="rv-leg"><span><i style="background:var(--rv-blue)"></i>Com RG</span><span><i style="background:#FE5000"></i>Sem RG</span></div>';
  var cls=conta(ab,function(r){ return r.classif||'Sem classificação'; }).map(function(x){ return {l:x[0], v:x[1]}; });
  b+='<div class="bi-grid-2">'+panel('Cobertura por classe de local','Quanto de cada classe já tem RG.',cl)+panel('Classificação dos RGs abertos','Resultado da avaliação de cada peça.',donut(cls))+'</div>';
  /* — locais — */
  var mistos=D.locais.filter(function(l){ return l.st==='misto'; }).sort(function(a,b){ return b.semRg-a.semRg; }).slice(0,8).map(function(l){
    return {l:l.localDesc, v:l.comRg, v2:l.semRg, cor:'linear-gradient(90deg,var(--rv-blue),var(--rv-blue2))', cor2:'linear-gradient(90deg,#DC2626,#F97316)', txt:int(l.semRg)+' sem RG', t:l.localDesc+'\n'+int(l.comRg)+' un com RG\n'+int(l.semRg)+' un sem RG\n'+int(l.itensMistos)+' item(ns) misturado(s)'}; });
  var semLoc=D.locais.filter(function(l){ return l.semRg>0; }).sort(function(a,b){ return b.semRg-a.semRg; }).slice(0,8).map(function(l){
    return {l:l.localDesc, v:l.semRg, txt:int(l.semRg), t:l.localDesc+'\n'+int(l.semRg)+' un sem RG de '+int(l.saldo)+'\nCobertura do local: '+pct(l.comRg,l.saldo,0)}; });
  b+='<div class="bi-grid-2">'+panel('Locais mistos — maiores','Locais com peça com RG e sem RG juntas. Cada um deve virar 100% RG.',hbars(mistos,{vazio:'Nenhum local misto 🎉'}))+
    panel('Locais com mais estoque sem RG','Onde está a maior parte das peças ainda sem RG.',hbars(semLoc,{cor:'linear-gradient(90deg,var(--rv-blue),var(--rv-blue2))'}))+'</div>';
  /* — aging + restrição — */
  var maxF=Math.max.apply(null,D.faixas)||1;
  var ag=hbars(FAIXAS.map(function(fx,i){ var cor=i>=4?'linear-gradient(90deg,#DC2626,#F97316)':i>=2?'linear-gradient(90deg,#F59E0B,#FCD34D)':'linear-gradient(90deg,#10B981,#34D399)'; return {l:fx[2], v:D.faixas[i], cor:cor, t:fx[2]+'\n'+int(D.faixas[i])+' un sem RG\n'+pct(D.faixas[i],T.semRg)+' do que falta'}; }),{max:maxF});
  var rs=Array.from(D.restr.entries()).sort(function(a,b){ return b[1]-a[1]; }).map(function(x){ return {l:x[0]+' · '+(RESTR[x[0]]||'—'), v:x[1], t:x[0]+' · '+(RESTR[x[0]]||'restrição')+'\n'+int(x[1])+' un · '+pct(x[1],T.saldo)+' do estoque da reversa', cor:'linear-gradient(90deg,var(--rv-blue),var(--rv-blue2))'}; });
  b+='<div class="bi-grid-2">'+panel('Tempo parado do estoque sem RG','Há quanto tempo as unidades sem RG estão no local (data da situação).',ag)+
    panel('Estoque da reversa por restrição','Em que situação o WMS enxerga as unidades.',hbars(rs))+'</div>';
  /* — produtividade + itens — */
  var d30=ultimo-29*864e5;
  var op=conta(S.rgs.filter(function(r){ return r.dt && r.dt>=d30; }),function(r){ return operNome(r.oper); }).slice(0,8).map(function(x){ return {l:x[0], v:x[1], t:x[0]+'\n'+int(x[1])+' RGs nos últimos 30 dias\n≈ '+int(x[1]/30)+' por dia'}; });
  var top=Array.from(D.itens.values()).sort(function(a,b){ return b.semRg-a.semRg; }).slice(0,8).map(function(it){ return {l:it.item+' · '+(it.desc||''), v:it.semRg, txt:int(it.semRg), t:it.item+' · '+(it.desc||'')+'\n'+int(it.semRg)+' un sem RG de '+int(it.saldo)}; });
  b+='<div class="bi-grid-2">'+panel('Produtividade por operador','RGs gerados nos últimos 30 dias.',hbars(op,{cor:'linear-gradient(90deg,var(--rv-blue),var(--rv-blue2))'}))+
    panel('Itens com mais unidades sem RG','Onde o esforço de identificação rende mais.',hbars(top,{cor:'linear-gradient(90deg,var(--rv-blue),var(--rv-blue2))'}))+'</div>';
  return hero+b+'</div>';
}

/* ---------- Coletor: agora é um app à parte (coletor/) ---------- */
function versaoTxt(){ var bd=window.LDM_BUILD||{}; return 'RG Reversa · v'+(bd.commit||'local')+(bd.data&&bd.data!=='—'?' · '+bd.data:''); }

/* ---------- Movimentações ---------- */
function isoDia(t){ var d=new Date(t); return d.getFullYear()+'-'+d2(d.getMonth()+1)+'-'+d2(d.getDate()); }
function carregaMovs(){
  if(S.movsBusy) return;
  var f=S.fm; if(!f.de) f.de=isoDia(hoje0()-6*864e5); if(!f.ate) f.ate=isoDia(hoje0());
  S.movsBusy=true; S.movsErro='';
  var q=window.rgSupa.from('rg_movimentacoes').select('*').gte('criado_em', new Date(f.de+'T00:00:00').toISOString()).lt('criado_em', new Date(new Date(f.ate+'T00:00:00').getTime()+864e5).toISOString()).order('criado_em',{ascending:true}).order('id',{ascending:true}).limit(5000);
  if(f.st==='pend') q=q.is('exportado_em',null); else if(f.st==='exp') q=q.not('exportado_em','is',null);
  q.then(function(r){
    if(r.error) throw r.error;
    S.movs=r.data||[];
  }).catch(function(e){ S.movs=[]; S.movsErro=(e&&e.message)||'Não consegui carregar as movimentações.'; }).then(function(){ S.movsBusy=false; if(S.tab==='movs') render(); });
}
function movsFiltradas(){
  var q=norm(S.fm.q); if(!S.movs) return [];
  return q ? S.movs.filter(function(m){ return norm(m.rg+' '+m.local_origem+' '+m.local_destino+' '+m.operador).indexOf(q)>=0; }) : S.movs;
}
function locTxt(raw){ var n=RG.nomeLocal(raw); return '<b>'+esc(RG.localNorm(raw))+'</b>'+(n&&n.d?'<br><small style="color:var(--ink-soft)">'+esc(n.d)+'</small>':''); }
function vMovs(){
  if(S.movs==null && !S.movsBusy) setTimeout(carregaMovs,0);
  var f=S.fm; if(!f.de) f.de=isoDia(hoje0()-6*864e5); if(!f.ate) f.ate=isoDia(hoje0());
  var lista=movsFiltradas(), lotes=new Set(lista.map(function(m){ return m.lote; }));
  var h='<div class="panel"><div class="mv-bar">'+
    '<label>De<input type="date" id="mvDe" data-mv="de" value="'+f.de+'"></label><label>Até<input type="date" id="mvAte" data-mv="ate" value="'+f.ate+'"></label>'+
    '<label>Situação<select data-mv="st"><option value="pend"'+(f.st==='pend'?' selected':'')+'>Pendentes de exportação</option><option value="exp"'+(f.st==='exp'?' selected':'')+'>Já exportados</option><option value="todos"'+(f.st==='todos'?' selected':'')+'>Todos</option></select></label>'+
    '<label>Buscar<input type="text" id="mvQ" data-mv="q" placeholder="RG, local ou operador" value="'+esc(f.q)+'"></label>'+
    '<button class="btn btn-secondary" data-act="mv-load">Atualizar</button>'+
    '<div class="mv-acoes"><button class="btn btn-secondary" data-act="mv-copy"'+(lista.length?'':' disabled')+'>📋 Copiar tabela (PuTTY)</button><button class="btn btn-orange" data-act="mv-xlsx"'+(lista.length?'':' disabled')+'>⬇ Baixar Excel</button></div></div>';
  if(S.movsErro) h+='<div class="rv-aviso" style="margin-bottom:12px"><strong>Erro:</strong> '+esc(S.movsErro)+(/relation|does not exist|schema cache/i.test(S.movsErro)?' — a tabela <code>rg_movimentacoes</code> ainda não foi criada no Supabase (migração <code>rg-reversa/supabase/migrations/001_movimentacoes.sql</code>).':'')+'</div>';
  h+='<div class="rv-hint" style="margin-bottom:8px"><b>'+int(lista.length)+'</b> RGs em <b>'+int(lotes.size)+'</b> movimentação(ões). O relatório sai em uma coluna: <b>local de origem</b>, depois os <b>RGs</b> e, por último, o <b>local de destino</b> (um bloco por movimentação). Ao exportar, as linhas passam a "Exportado".</div>';
  h+='<div class="table-wrap"><table><thead><tr><th>Data/hora</th><th>Operador</th><th>Local origem</th><th>RG</th><th>Local destino</th><th>Situação</th></tr></thead><tbody>';
  if(S.movsBusy && !lista.length) h+='<tr><td colspan="6" style="text-align:center;padding:26px;color:var(--ink-soft)">Carregando…</td></tr>';
  else if(!lista.length) h+='<tr><td colspan="6" style="text-align:center;padding:26px;color:var(--ink-soft)">Nenhuma movimentação neste filtro.</td></tr>';
  var lim=S.lim.mv||PAGINA;
  lista.slice(0,lim).forEach(function(m){
    h+='<tr><td>'+dataHoraBR(m.criado_em)+'</td><td>'+esc(m.operador||'—')+'</td><td>'+locTxt(m.local_origem)+'</td><td><b>'+esc(m.rg)+'</b></td><td>'+locTxt(m.local_destino)+'</td><td>'+(m.exportado_em?'<span class="tag tag-good">Exportado</span>':'<span class="tag tag-orange">Pendente</span>')+'</td></tr>';
  });
  h+='</tbody></table></div>';
  if(lista.length>lim) h+='<div class="rv-mais"><button class="btn btn-secondary" data-act="mv-mais">Mostrar mais ('+int(lista.length-lim)+' restantes)</button></div>';
  return h+'</div>';
}
function marcaExportado(lista){
  var ids=lista.filter(function(m){ return !m.exportado_em; }).map(function(m){ return m.id; });
  if(!ids.length) return Promise.resolve();
  var partes=[]; for(var i=0;i<ids.length;i+=200) partes.push(ids.slice(i,i+200));
  var agora=new Date().toISOString();
  return partes.reduce(function(p,parte){ return p.then(function(){ return window.rgSupa.from('rg_movimentacoes').update({exportado_em:agora}).in('id',parte).then(function(r){ if(r.error) throw r.error; }); }); }, Promise.resolve())
    .then(function(){ S.movs=null; render(); }).catch(function(e){ toast('Exportei, mas não consegui marcar como exportado: '+(e.message||e), true); });
}
/* Relatório: coluna A = origem, RGs e destino (o que vai para o PuTTY); colunas ao lado dizem o que cada número é. */
function blocosMovs(lista){
  var ordem=[], g={};
  lista.forEach(function(m){
    if(!g[m.lote]){ g[m.lote]={ origem:m.local_origem, destino:m.local_destino, rgs:[], hora:dataHoraBR(m.criado_em), operador:m.operador||'' }; ordem.push(m.lote); }
    var rec=S.D && S.D.rgMap.get(m.rg), desc=rec ? (S.D.itemDesc.get(rec.item)||'') : '';
    g[m.lote].rgs.push({ rg:m.rg, desc:desc });
  });
  return ordem.map(function(l){ return g[l]; });
}
function mvXlsx(){
  var lista=movsFiltradas(); if(!lista.length) return;
  var blocos=blocosMovs(lista);
  var ops=Array.from(new Set(blocos.map(function(b){ return b.operador; }).filter(Boolean))).join(', ');
  RG.xlsx(blocos, { data:dataBR(Date.now()), operador:ops }, 'rg-reversa-movimentacoes-'+isoDia(Date.now())+'.xlsx');
  marcaExportado(lista);
}
function mvCopy(){
  var lista=movsFiltradas(); if(!lista.length) return;
  var l=RG.linhasBlocos(blocosMovs(lista));
  RG.copia(l.join('\n')).then(function(){ toast(int(l.length)+' linhas copiadas — cole no PuTTY.'); marcaExportado(lista); });
}
function copiaFallback(txt){ var t=document.createElement('textarea'); t.value=txt; t.style.position='fixed'; t.style.opacity='0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch(e){} t.remove(); }

/* ---------- Importação ---------- */
function vImportacao(){
  var rgDias=S.rgs.map(function(r){ return r.dt; }).filter(Boolean);
  var stRg = S.rgs.length ? '<span class="tag tag-good">Carregado</span> '+int(S.rgs.length)+' RGs'+(rgDias.length?' · de '+dataBR(Math.min.apply(null,rgDias))+' a '+dataBR(Math.max.apply(null,rgDias)):'') : '<span class="tag tag-muted">Ainda não importado</span>';
  var stEst = S.est ? '<span class="tag tag-good">Carregado</span> '+int(S.est.unidades)+' unidades · '+dataHoraBR(S.est.em) : '<span class="tag tag-muted">Ainda não importado</span>';
  var stMu = S.mult ? '<span class="tag tag-good">Carregado</span> '+int(S.mult.rows.length)+' ligações · '+dataHoraBR(S.mult.em) : '<span class="tag tag-muted">Ainda não importado</span>';
  var h='';
  if(S.ocupado) h+='<div class="rv-aviso" style="margin-bottom:14px"><strong>Aguarde.</strong> '+esc(S.ocupado)+'</div>';
  h+='<div class="rv-imp">'+
    '<div class="dropzone'+(S.rgs.length?' has-file':'')+'" data-act="escolher" data-drop="1" tabindex="0"><div class="dz-icon">🏷️</div><div class="dz-title">QRY0100 · RG - Produtividade</div><div class="dz-desc">Lista de RGs gerados. Cada importação <strong>soma</strong> os RGs novos e atualiza os existentes.</div><div class="rv-st">'+stRg+'</div></div>'+
    '<div class="dropzone'+(S.est?' has-file':'')+'" data-act="escolher" data-drop="1" tabindex="0"><div class="dz-icon">📦</div><div class="dz-title">QRY0390 · Estoque por Local</div><div class="dz-desc">Foto do saldo. <strong>Substitui</strong> a anterior. Guarda só as classes '+CLASSES_REVERSA.join(' e ')+'.</div><div class="rv-st">'+stEst+'</div></div>'+
    '<div class="dropzone'+(S.mult?' has-file':'')+'" data-act="escolher" data-drop="1" tabindex="0"><div class="dz-icon">🧩</div><div class="dz-title">ZBIQ0051 · Item x Múltiplo</div><div class="dz-desc">Liga item pai a componentes. <strong>Substitui</strong> a anterior. Alimenta o indicador de múltiplos.</div><div class="rv-st">'+stMu+'</div></div>'+
    '</div>';
  h+='<div class="panel" style="margin-top:14px"><h3>Como importar</h3><div class="panel-sub">Clique num quadro ou arraste os arquivos para cá. Pode soltar os três de uma vez — o app reconhece cada relatório sozinho. Os dados ficam salvos neste navegador.</div>'+
    '<ol style="margin:0 0 4px 18px;line-height:1.9"><li>Bseller: exporte a <strong>QRY0100</strong> (período desde a última importação), a <strong>QRY0390</strong> (CD inteiro) e a <strong>ZBIQ0051</strong>.</li><li>Solte os arquivos aqui.</li><li>A cada importação da QRY0390 o app guarda uma foto da cobertura — é ela que forma o gráfico de evolução.</li></ol></div>';
  var log=lsGet(LOG_KEY);
  h+='<div class="panel" style="margin-top:14px"><div class="panel-head-row"><h3>Histórico de importações</h3><div><button class="btn-danger-text" data-act="limpa" data-k="rgs">Apagar RGs</button> <button class="btn-danger-text" data-act="limpa" data-k="est">Apagar estoque</button> <button class="btn-danger-text" data-act="limpa" data-k="mult">Apagar múltiplos</button> <button class="btn-danger-text" data-act="limpa" data-k="hist">Apagar evolução</button></div></div>';
  if(!log.length) h+='<p class="field-hint">Nenhuma importação registrada neste navegador.</p>';
  else h+='<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Relatório</th><th>Arquivo</th><th>Resultado</th></tr></thead><tbody>'+log.map(function(l){ return '<tr><td>'+dataHoraBR(l.em)+'</td><td>'+esc(l.tipo)+'</td><td>'+esc(l.arquivo)+'</td><td>'+esc(l.resumo)+'</td></tr>'; }).join('')+'</tbody></table></div>';
  return h+'</div>';
}

/* ---------- navegação ---------- */
var VIEWS={ painel:vPainel, movs:vMovs, importacao:vImportacao };
function render(){
  var t=TABS[S.tab]; $('tabTitle').textContent=t[0]; $('tabSubtitle').textContent=t[1];
  Array.prototype.forEach.call(document.querySelectorAll('.nav-item[data-tab]'),function(b){ b.classList.toggle('active', b.dataset.tab===S.tab); });
  var h=(S.ocupado && S.tab!=='importacao') ? '<div class="rv-aviso" style="margin-bottom:14px"><strong>Aguarde.</strong> '+esc(S.ocupado)+'</div>' : '';
  var sc=document.querySelector('.page-scroll'), y=sc?sc.scrollTop:0;
  $('viewRoot').innerHTML=h+VIEWS[S.tab]();
  if(sc) sc.scrollTop=y;
}
function vaiPara(tab){
  if(!TABS[tab]) return;
  S.tab=tab;
  try { history.replaceState(null,'','#'+tab); } catch(e){}
  $('sidebar').classList.remove('mobile-open');
  if(tab==='movs') S.movs=null;
  render();
  var sc=document.querySelector('.page-scroll'); if(sc) sc.scrollTop=0;
}

/* ---------- tema, zoom, menu ---------- */
var SUN='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
var MOON='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
/* Mesmas chaves do Painel Oficina LDM (raiz): o tema e o zoom escolhidos lá valem aqui. */
function aplicaTema(escuro){
  document.documentElement.setAttribute('data-theme', escuro?'dark':'light');
  var b=$('themeSwitchBtn'); b.classList.toggle('on',escuro); b.querySelector('.theme-knob').innerHTML=escuro?MOON:SUN;
}
function temaEscuro(){ try { return localStorage.getItem('ldm-theme')==='dark'; } catch(e){ return false; } }
function aplicaZoom(p){
  p=Math.max(70,Math.min(150,p));
  document.body.style.zoom=p/100;
  document.documentElement.style.setProperty('--zoom',p/100);
  $('zoomLabel').textContent=p+'%';
  try { localStorage.setItem('ldm-zoom',p); } catch(e){}
  return p;
}
function zoomAtual(){ try { return parseInt(localStorage.getItem('ldm-zoom'),10)||100; } catch(e){ return 100; } }

/* ---------- eventos ---------- */
function acao(el, ev){
  var a=el.dataset.act;
  if(a==='tab') return vaiPara(el.dataset.tab);
  if(a==='sidebar'){ var sb=$('sidebar'); return sb.classList.toggle(matchMedia('(max-width:640px)').matches?'mobile-open':'collapsed'); }
  if(a==='fecha-sidebar') return $('sidebar').classList.remove('mobile-open');
  if(a==='tema'){ var e=!temaEscuro(); try { localStorage.setItem('ldm-theme',e?'dark':'light'); } catch(x){} return aplicaTema(e); }
  if(a==='zoom-mais') return aplicaZoom(zoomAtual()+10);
  if(a==='zoom-menos') return aplicaZoom(zoomAtual()-10);
  if(a==='escolher'){ $('fileInput').click(); return; }
  if(a==='limpa'){
    var k=el.dataset.k;
    if(!confirm('Apagar '+({rgs:'os RGs',est:'o estoque',mult:'os múltiplos',hist:'o histórico de evolução'}[k])+' deste navegador?')) return;
    if(k==='rgs') S.rgs=[]; if(k==='est') S.est=null; if(k==='mult') S.mult=null; if(k==='hist') S.hist=[];
    return dbDel(k).then(function(){ deriva(); render(); });
  }
  if(a==='mv-load'){ S.movs=null; return carregaMovs(); }
  if(a==='mv-mais'){ S.lim.mv=(S.lim.mv||PAGINA)+PAGINA; return render(); }
  if(a==='mv-xlsx') return mvXlsx();
  if(a==='mv-copy') return mvCopy();
}
function inicia(){
  var fi=document.createElement('input'); fi.type='file'; fi.id='fileInput'; fi.accept='.xlsx,.xls,.xlsb,.csv'; fi.multiple=true; fi.hidden=true; document.body.appendChild(fi);
  document.addEventListener('click', function(ev){ var el=ev.target.closest('[data-act]'); if(el) acao(el, ev); });
  document.addEventListener('change', function(ev){
    var t=ev.target;
    if(t.id==='fileInput'){ importar(t.files); t.value=''; return; }
    if(t.dataset && t.dataset.mv && t.dataset.mv!=='q'){ S.fm[t.dataset.mv]=t.value; S.lim.mv=0; S.movs=null; render(); }
  });
  var espera, colTimer;
  document.addEventListener('input', function(ev){
    var t=ev.target;
    /* O leitor de RG não manda Enter: o código entra sozinho quando a digitação para (leitor é rápido). */
    if(t.id==='colRg'){ clearTimeout(colTimer); colTimer=setTimeout(function(){ if(t.value.trim().length>=3 && document.activeElement===t) colCommit('rg', t); }, 280); return; }
    if(t.id==='mvQ'){ clearTimeout(espera); espera=setTimeout(function(){ S.fm.q=t.value; S.lim.mv=0; render(); var el=$('mvQ'); if(el){ el.focus(); var n=el.value.length; try { el.setSelectionRange(n,n); } catch(e){} } }, 220); }
  });
  document.addEventListener('keydown', function(ev){
    var t=ev.target;
    if((t.id==='colOrigem' || t.id==='colDestino' || t.id==='colRg') && ev.key==='Enter'){ ev.preventDefault(); clearTimeout(colTimer); colCommit(t.id==='colOrigem'?'origem':t.id==='colDestino'?'destino':'rg', t); }
    if(t.dataset && t.dataset.act==='escolher' && (ev.key==='Enter' || ev.key===' ')){ ev.preventDefault(); $('fileInput').click(); }
  });
  /* Tooltip: qualquer elemento com data-tip. */
  var tip=$('tip');
  document.addEventListener('mouseover', function(ev){
    var el=ev.target.closest && ev.target.closest('[data-tip]');
    if(!el){ tip.hidden=true; return; }
    var linhas=String(el.dataset.tip).split('\n');
    tip.innerHTML='<b>'+esc(linhas[0])+'</b>'+linhas.slice(1).map(function(l){ return '<br>'+esc(l); }).join('');
    tip.hidden=false;
  });
  document.addEventListener('mousemove', function(ev){
    if(tip.hidden) return;
    var x=ev.clientX+14, y=ev.clientY+16, w=tip.offsetWidth, h=tip.offsetHeight;
    if(x+w>innerWidth-8) x=ev.clientX-w-14; if(y+h>innerHeight-8) y=ev.clientY-h-14;
    tip.style.left=Math.max(6,x)+'px'; tip.style.top=Math.max(6,y)+'px';
  });
  document.addEventListener('mouseleave', function(){ tip.hidden=true; });
  /* Arrastar e soltar em qualquer lugar da tela. */
  ['dragenter','dragover'].forEach(function(n){ document.addEventListener(n,function(ev){ if(ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types||[],'Files')>=0){ ev.preventDefault(); Array.prototype.forEach.call(document.querySelectorAll('.dropzone'),function(d){ d.classList.add('over'); }); } }); });
  ['dragleave','drop'].forEach(function(n){ document.addEventListener(n,function(){ Array.prototype.forEach.call(document.querySelectorAll('.dropzone.over'),function(d){ d.classList.remove('over'); }); }); });
  document.addEventListener('drop', function(ev){
    if(ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length){ ev.preventDefault(); importar(ev.dataTransfer.files); }
  });
  $('brandLogo').addEventListener('click', function(){ this.classList.remove('spin'); void this.offsetWidth; this.classList.add('spin'); });
  aplicaTema(temaEscuro());
  aplicaZoom(zoomAtual());
  var v=$('sidebarVersao');
  if(v){
    var bd=window.LDM_BUILD||{};
    v.textContent='RG Reversa · v'+(bd.commit||'local')+(bd.data&&bd.data!=='—'?' · '+bd.data:'');
  }
  var rp=$('appRodape'); if(rp) rp.textContent=versaoTxt();
  RG.vigiaVersao('../version.js');
  var h=''; try { h=decodeURIComponent(location.hash.slice(1)); } catch(e){}
  if(TABS[h]) S.tab=h;
  deriva(); render();
}

/* Chamado pela trava de acesso (acesso.js) depois que o login e a permissão passam. */
var iniciado=false;
window.rgIniciar=function(){
  if(iniciado) return; iniciado=true;
  try { window.rgSupa.auth.getSession().then(function(r){ var u=r.data && r.data.session && r.data.session.user; S.user=u&&u.email ? u.email.split('@')[0] : ''; }); } catch(e){}
  Promise.all([dbGet('rgs'), dbGet('est'), dbGet('mult'), dbGet('hist')]).then(function(r){
    S.rgs=Array.isArray(r[0]) ? r[0] : [];
    S.est=r[1] && r[1].rows ? r[1] : null;
    S.mult=r[2] && r[2].rows ? r[2] : null;
    S.hist=Array.isArray(r[3]) ? r[3] : [];
  }).catch(function(){ toast('Não consegui abrir os dados salvos neste navegador.', true); }).then(function(){
    deriva(); render();
    RG.carregaLocais(window.rgSupa).then(function(){ if(S.tab==='movs') render(); });
  });
};
inicia();
})();
