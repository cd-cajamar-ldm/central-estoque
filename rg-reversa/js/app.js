/* RG Reversa — acompanhamento da implantação de RG na logística reversa.
 *
 * Meta do módulo: 100% do estoque da reversa identificado por RG (cada peça um RG).
 * Indicador principal: % de unidades da reversa que já têm RG.
 *
 * Bases (exportadas do Bseller e importadas aqui no navegador, guardadas no IndexedDB):
 *   QRY0100 (RG - Produtividade) → 1 linha = 1 RG. Acumula: cada importação soma os novos.
 *   QRY0390 (Estoque por Local)  → foto do saldo; substitui a anterior. Só as classes de reversa (CLASSES_REVERSA).
 *   ZBIQ0051 (Item x Múltiplo)   → liga item pai a componentes (para o indicador de múltiplos).
 * Cruzando RG x estoque por item + local sai a cobertura.
 *
 * Coletor / Movimentações: as bipagens vão para o Supabase (tabela public.rg_movimentacoes),
 * para o celular e o computador enxergarem o mesmo dado. */
(function(){
'use strict';

/* Classes de local que contam como reversa (classificação feita pelo administrador em 16/11/2026: REV, AVA e ATI).
   Neutras (DENT, PALET, CARGA, DSAI, UMA) e de estoque ficam de fora. Mudou a lista? Importe a QRY0390 de novo. */
var CLASSES_REVERSA = ['REV','AVA','ATI'];
var FAIXAS = [[0,30,'até 30 d','#1F8A52'],[31,90,'31–90 d','#E0A100'],[91,180,'91–180 d','#FE5000'],[181,365,'181–365 d','#C83812'],[366,1e9,'+ de 1 ano','#7A1E0A']];
var CORES_CLASSIF = ['#FE5000','#001A72','#1F8A52','#E0A100','#7D93E8','#8E99A8'];
var PAGINA = 200;
var LOG_KEY = 'rg-reversa-log', PEND_KEY = 'rg-reversa-pend';
/* Controle de mistos: zonas TRI e PIC ficam fora. */
var SEM_MONITOR = /^(TRI|PIC)/i;
var MISTO_FX = [[0,7,'até 7 d','#1F8A52'],[8,30,'8–30 d','#E0A100'],[31,90,'31–90 d','#FE5000'],[91,1e9,'+ de 90 d','#C83812']];
var RESTR = {WN:'Vendável',WA:'Reversa',WQ:'Quebra',RT:'Conferência',WE:'Amostra',LT:'Litígio',WV:'Validade',WL:'Não localizado',WI:'Insumos',WT:'Análise',WR:'Reparo',AT:'Múlt. reversa',SS:'Marca própria',DT:'Triagem',WD:'Obsoleto',WS:'Leilão',AI:'Múlt. incompleto'};

var TABS = {
  painel:['Dashboard','Implantação de RG na logística reversa — meta: 100% do estoque com RG.'],
  estoque:['Estoque × RG','Saldo da reversa por item e local.'],
  rgs:['Consulta de RGs','Cada RG é uma peça.'],
  prod:['Produtividade','Movimentações da equipe, fila da triagem, retrabalho e conferência com o coletor.'],
  movs:['Movimentações','Relatório do coletor para baixar em Excel ou colar no PuTTY.'],
  importacao:['Importação','Relatórios do Bseller que alimentam o dashboard.']
};

var S = {
  rgs:[], est:null, mult:null, preco:null, hist:[], mov:[], tab:'painel', D:null, ocupado:'', user:'', stamps:{}, nuvem:{ estado:'', msg:'' },
  movs:null, movsBusy:false, movsErro:'',
  mistos:null, mistosBusy:false, mistosErro:'', mistosAuto:false, fMisQ:'', fMisFx:-1,
  pAt:'30d', pDe:'', pAte:'', pGrp:'dia', pCmp:'media', pDia:null, pSer:'rg', colMov:null, colBusy:false, colErro:'',
  fm:{ de:'', ate:'', st:'pend', q:'' }, lim:{}, sort:{},
  col:null,
  classe:'', ritmo:null, anima:true, q:'', fClassif:'', fOper:'', cobModo:'sem', cobQ:'', cobLocal:'', cobFaixa:''
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
function opt(v, rot, sel){ return '<option value="'+esc(v)+'"'+(String(v)===String(sel)?' selected':'')+'>'+esc(rot)+'</option>'; }
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
            if(h.indexOf('preco de custo')>=0 && h.indexOf('item')>=0 && h.indexOf('nome item')>=0){ achou={tipo:'preco',h:h,linhas:aoa.slice(i+1)}; return true; }
            if(h.indexOf('data movimento')>=0 && h.indexOf('classe destino')>=0 && h.indexOf('rg')>=0){ achou={tipo:'mov',h:h,linhas:aoa.slice(i+1)}; return true; }
            if(h.indexOf('numero rg')>=0){ achou={tipo:'rg',h:h,linhas:aoa.slice(i+1)}; return true; }
            if(h.indexOf('item componente')>=0 && h.indexOf('item vol multiplo')>=0){ achou={tipo:'mult',h:h,linhas:aoa.slice(i+1)}; return true; }
            if(h.indexOf('classe local')>=0 && h.indexOf('quantidade')>=0 && h.indexOf('item')>=0){ achou={tipo:'est',h:h,linhas:aoa.slice(i+1)}; return true; }
          }
          return false;
        });
        if(!achou) return rej(new Error('"'+file.name+'" não parece ser a QRY0100, a QRY0110, a QRY0390, a SIGEQ278 nem a ZBIQ0051.'));
        res(achou);
      } catch(e){ rej(new Error('Não consegui abrir "'+file.name+'".')); }
    };
    fr.readAsArrayBuffer(file);
  });
}
/* hora (0–23) em que o RG foi criado; o minuto da QRY0100 vem com defeito, a hora não. null se o arquivo só tem a data. */
function horaDe(v){ var t=parseData(v); if(t==null) return null; var d=new Date(t); return (d.getHours()===0 && d.getMinutes()===0 && d.getSeconds()===0) ? null : d.getHours(); }
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
      dt:soDia(parseData(g(l,ix.dt))), h:horaDe(g(l,ix.dt)),
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
/* QRY0110: uma linha = uma movimentação de RG (de um local para outro), com data, hora e operador. */
function montaMov(a){
  var c=function(n){ return a.h.indexOf(n); };
  var ix={ t:c('data movimento'), rg:c('rg'), item:c('item'), oc:c('classe origem'), o:c('origem'), od:c('descricao origem'), dc:c('classe destino'), d:c('destino'), dd:c('descricao destino'), op:c('operador') };
  var g=function(l,i){ return i>=0 ? l[i] : null; };
  var out=[];
  a.linhas.forEach(function(l){
    var rg=cod(g(l,ix.rg)), t=parseData(g(l,ix.t)); if(!rg || !t) return;
    out.push({ t:t, rg:rg, item:cod(g(l,ix.item)), oc:String(g(l,ix.oc)||'').trim(), o:cod(g(l,ix.o)), od:String(g(l,ix.od)||'').trim(),
      dc:String(g(l,ix.dc)||'').trim(), d:cod(g(l,ix.d)), dd:String(g(l,ix.dd)||'').trim(), op:String(g(l,ix.op)||'').trim() });
  });
  return out;
}
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
/* SIGEQ278: preço de custo por item. Guardamos só os itens com custo maior que zero (o resto vale R$ 0). */
function montaPreco(a, nome){
  var iI=a.h.indexOf('item'), iC=a.h.indexOf('preco de custo');
  var rows=[], total=0;
  a.linhas.forEach(function(l){ var it=cod(l[iI]); if(!it) return; total++; var c=num(l[iC]); if(c>0) rows.push([it, Math.round(c*1e5)/1e5]); });
  return { rows:rows, itens:total, arquivo:nome, em:Date.now() };
}
function montaMult(a, nome){
  var iC=a.h.indexOf('item componente'), iP=a.h.indexOf('item vol multiplo'), iQ=a.h.indexOf('qtde'), iF=a.h.indexOf('in interface');
  var rows=[];
  /* 4ª posição: in_interface (S = este componente carrega o valor do kit; N = vale zero) */
  a.linhas.forEach(function(l){ var c=cod(l[iC]), p=cod(l[iP]); if(c && p) rows.push([c,p,iQ>=0?num(l[iQ]):1, iF>=0 ? String(l[iF]||'').trim().toUpperCase() : '']); });
  return { rows:rows, arquivo:nome, em:Date.now(), semFlag:iF<0 };
}

/* ---------- dados da última importação no servidor ---------- */
var GRUPOS=['rgs','est','mult','hist','mov','preco'];
function valorLocal(g){ return g==='rgs' ? S.rgs : g==='est' ? S.est : g==='mult' ? S.mult : g==='mov' ? S.mov : g==='preco' ? S.preco : S.hist; }
function temLocal(g){ var v=valorLocal(g); return (g==='rgs'||g==='hist'||g==='mov') ? v.length>0 : !!v; }
function poeLocal(g,v){ if(g==='rgs') S.rgs=v||[]; else if(g==='est') S.est=v; else if(g==='mult') S.mult=v; else if(g==='mov') S.mov=v||[]; else if(g==='preco') S.preco=v; else S.hist=v||[]; }
/* Acesso "só visualizar": consulta e coletor, mas não importa nem apaga dados. */
function leitura(){ return !!window.LDM_SOMENTE_LEITURA; }
function empurra(g){
  if(leitura()) return Promise.resolve();
  return RG.nuvem.salvaGrupo(window.rgSupa, g, valorLocal(g), S.user).then(function(em){ S.stamps[g]=em; });
}
function msgNuvem(e){
  var m=(e&&e.message)||String(e);
  return /rg_dados|relation|does not exist|schema cache/i.test(m) ? 'a tabela rg_dados ainda não existe no Supabase' : m;
}
/* Traz do servidor o que for mais novo que o deste aparelho; o que só existe aqui sobe (primeira vez). */
function sincroniza(){
  if(!window.rgSupa) return Promise.resolve(false);
  S.nuvem={ estado:'sync', msg:'Carregando os dados da última importação…' };
  var mudou=false;
  return RG.nuvem.metas(window.rgSupa).then(function(metas){
    var seq=Promise.resolve();
    GRUPOS.forEach(function(g){
      seq=seq.then(function(){
        var m=metas[RG.nuvem.chaveMeta(g)], st=S.stamps[g]||'';
        if(m && Date.parse(m.em)>(st?Date.parse(st):0)){
          return RG.nuvem.carregaGrupo(window.rgSupa,g).then(function(r){
            if(!r) return;
            poeLocal(g,r.valor); S.stamps[g]=r.em; mudou=true;
            return dbSet(g, valorLocal(g));
          });
        }
        if(!m && temLocal(g) && !leitura()) return empurra(g);
      });
    });
    return seq;
  }).then(function(){
    return dbSet('stamps',S.stamps).catch(function(){});
  }).then(function(){
    S.nuvem={ estado:'ok', msg:'' };
    if(mudou){ deriva(); }
    return mudou;
  }).catch(function(e){
    S.nuvem={ estado:'erro', msg:msgNuvem(e) };
    return false;
  });
}

function importar(files){
  if(leitura()){ toast('Seu acesso não permite importar relatórios.', true); return; }
  S.classe=''; S.ritmo=null; S.anima=true;
  if(!files || !files.length) return;
  if(typeof XLSX==='undefined'){ toast('A leitura de planilhas não carregou. Verifique a internet e atualize a página.', true); return; }
  S.ocupado='Lendo '+(files.length>1?files.length+' arquivos':'"'+files[0].name+'"')+'… arquivos grandes levam alguns segundos.';
  render();
  var fila=Array.prototype.slice.call(files), msgs=[], erros=[], mudados=new Set();
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
        msgs.push(int(add)+' RGs novos'); mudados.add('rgs');
        return dbSet('rgs', S.rgs);
      }
      if(a.tipo==='mov'){
        var nm=montaMov(a), mm=new Map(), ant=S.mov.length, atM=0;
        if(!nm.length) throw new Error('"'+f.name+'" não tem movimentações de RG.');
        S.mov.forEach(function(m){ mm.set(m.rg+'|'+m.t+'|'+m.d,m); });
        nm.forEach(function(m){ var k=m.rg+'|'+m.t+'|'+m.d; if(mm.has(k)) atM++; mm.set(k,m); });
        S.mov=Array.from(mm.values()).sort(function(x,y){ return x.t-y.t; });
        gravaLog({em:Date.now(), tipo:'QRY0110 · Movimentos', arquivo:f.name, resumo:int(nm.length)+' movimentações lidas · '+int(S.mov.length-ant)+' novas · '+int(atM)+' já existiam'});
        msgs.push(int(S.mov.length-ant)+' movimentações novas'); mudados.add('mov');
        return dbSet('mov', S.mov);
      }
      if(a.tipo==='preco'){
        var pc=montaPreco(a, f.name);
        if(!pc.rows.length) throw new Error('"'+f.name+'" não tem itens com preço de custo.');
        S.preco=pc;
        gravaLog({em:Date.now(), tipo:'SIGEQ278 · Preço de custo', arquivo:f.name, resumo:int(pc.itens)+' itens no arquivo · '+int(pc.rows.length)+' com preço de custo'});
        msgs.push('preços de custo ('+int(pc.rows.length)+' itens)'); mudados.add('preco');
        return dbSet('preco', S.preco);
      }
      if(a.tipo==='mult'){
        var mu=montaMult(a, f.name);
        if(!mu.rows.length) throw new Error('"'+f.name+'" não tem componentes de múltiplos.');
        S.mult=mu;
        gravaLog({em:Date.now(), tipo:'ZBIQ0051 · Múltiplos', arquivo:f.name, resumo:int(mu.rows.length)+' ligações pai x componente'});
        msgs.push('múltiplos ('+int(mu.rows.length)+' ligações)'); mudados.add('mult');
        return dbSet('mult', S.mult);
      }
      var est=montaEstoque(a, f.name);
      if(!est.rows.length) throw new Error('"'+f.name+'" não tem saldo nas classes da reversa ('+CLASSES_REVERSA.join(', ')+').');
      S.est=est;
      gravaLog({em:Date.now(), tipo:'QRY0390 · Estoque', arquivo:f.name, resumo:int(est.linhasArquivo)+' linhas no arquivo · '+int(est.linhasReversa)+' da reversa · '+int(est.unidades)+' unidades'});
      msgs.push('estoque da reversa ('+int(est.unidades)+' un)'); mudados.add('est');
      return dbSet('est', S.est).then(function(){
        /* a lista de locais (nome de cada local) vai para o Supabase: é o que o coletor mostra ao bipar */
        return RG.subeLocais(window.rgSupa, est.locais).then(function(n){ msgs.push(int(n)+' locais enviados ao coletor'); })
          .catch(function(e){ erros.push('Não consegui enviar a lista de locais ao coletor: '+((e&&e.message)||e)); });
      });
    }).catch(function(e){ erros.push(e.message||String(e)); }).then(proximo);
  }
  setTimeout(function(){
    /* antes de somar RGs novos, traz o que outro aparelho possa ter importado */
    sincroniza().then(proximo).then(function(){
      deriva(); snapshot(); mudados.add('hist');
      return dbSet('hist', S.hist).catch(function(){});
    }).then(function(){
      S.ocupado='Guardando os dados da importação no servidor…'; render();
      var seq=Promise.resolve();
      Array.from(mudados).forEach(function(g){ seq=seq.then(function(){ return empurra(g); }); });
      return seq.then(function(){ msgs.push('dados guardados no servidor'); return dbSet('stamps',S.stamps).catch(function(){}); })
        .catch(function(e){ erros.push('Não consegui guardar os dados no servidor: '+msgNuvem(e)); });
    }).then(function(){
      if(!(mudados.has('rgs')||mudados.has('est')||mudados.has('mov')) || leitura()) return;
      return registraMistos().then(function(r){ if(r) msgs.push('controle de mistos ('+int(r.novos)+' novos · '+int(r.resolvidos)+' resolvidos)'); })
        .catch(function(e){ erros.push(semTabelaMis(e) ? 'Controle de mistos: falta rodar a migração 005 no Supabase.' : 'Controle de mistos: '+msgNuvem(e)); });
    }).then(function(){
      S.ocupado=''; render();
      if(erros.length) toast(erros.join(' '), true);
      else if(msgs.length) toast('Importado: '+msgs.join(' · ')+'.');
    });
  }, 60);
}

/* ---------- cruzamento RG x estoque ---------- */
/* devolve uma função item → { v: preço unitário, sem: true se ficou sem preço } ou null se a SIGEQ278 não foi importada */
function mkValor(){
  if(!S.preco || !S.preco.rows || !S.preco.rows.length) return null;
  var P=new Map(S.preco.rows), MC=new Map();
  if(S.mult && !S.mult.semFlag) S.mult.rows.forEach(function(r){ if(r[3]) MC.set(r[0],{ pai:r[1], f:r[3] }); });
  return function(item){
    var m=MC.get(item);
    if(m){
      if(m.f==='N') return { v:0, sem:false };            /* componente N: zero de propósito */
      var vp=P.get(m.pai); if(vp>0) return { v:vp, sem:false };   /* componente S: preço do item pai */
      var vc=P.get(item)||0; return { v:vc, sem:vc<=0 };          /* pai sem preço: preço do próprio componente */
    }
    var c=P.get(item)||0; return { v:c, sem:c<=0 };
  };
}
function precoRg(r){ return (S.D && S.D.vu) ? S.D.vu(r.item) : r.preco; }
function aberto(r){ var s=norm(r.sit); return !s || s==='aberto'; }
function deriva(){
  var D={ itemDesc:new Map(), localDesc:new Map(), locCod:new Map(), locNome:new Map(), cov:[], tot:{saldo:0, comRg:0, semRg:0, rgSemSaldo:0}, abertos:[], porClasse:new Map(), rgMap:new Map(),
    faixas:FAIXAS.map(function(){ return 0; }), restr:new Map(), itens:new Map(), mult:{ itens:0, un:0, semRg:0 } };
  var cl=S.classe;
  D.rgs=S.rgs.filter(function(r){ return !cl || r.classe===cl; });
  D.abertos=D.rgs.filter(aberto);
  D.tot.linhas=0; D.tot.linhasOk=0;
  S.rgs.forEach(function(r){ D.rgMap.set(r.rg,r); });
  var multSet=new Set(); if(S.mult) S.mult.rows.forEach(function(r){ multSet.add(r[0]); });
  var m=new Map();
  if(S.est) S.est.rows.forEach(function(r){
    if(r.d) D.itemDesc.set(r.i,r.d);
    D.localDesc.set(r.l,r.ld);
    D.locCod.set(r.l, r.l); D.locNome.set(norm(r.ld), r.l);
    if(cl && r.c!==cl) return;
    m.set(r.i+'|'+r.l, {item:r.i, desc:r.d, ean:r.e, classe:r.c, local:r.l, localDesc:r.ld, saldo:r.q, rgs:0, t:r.t, x:r.x||{}});
  });
  D.abertos.forEach(function(r){
    var k=r.item+'|'+r.local, c=m.get(k);
    if(!c){ c={item:r.item, desc:D.itemDesc.get(r.item)||'', ean:r.ean, classe:r.classe, local:r.local, localDesc:D.localDesc.get(r.local)||r.local, saldo:0, rgs:0, t:null, x:{}}; m.set(k,c); }
    c.rgs++;
  });
  var itemMap=new Map();
  m.forEach(function(c){
    c.semRg=Math.max(0,c.saldo-c.rgs); c.rgSemSaldo=Math.max(0,c.rgs-c.saldo); c.dias=dias(c.t); c.mult=multSet.has(c.item); c.comRg=Math.min(c.saldo,c.rgs); c.fx=c.dias==null?-1:faixaDe(c.dias);
    if(c.saldo){ D.tot.linhas++; if(!c.semRg) D.tot.linhasOk++; }
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
  /* Valoração: valor = quantidade × preço de custo unitário (SIGEQ278), com a regra dos kits da ZBIQ0051 */
  D.vu=null; D.vo=null; D.vt={ total:0, com:0, sem:0 }; D.semPreco=new Map();
  var fv=mkValor();
  if(fv){
    var vcache=new Map();
    D.vo=function(item){ var o=vcache.get(item); if(!o){ o=fv(item); vcache.set(item,o); } return o; };
    D.vu=function(item){ return D.vo(item).v; };
    var addSem=function(item,desc,classe,un,rgs){ var sp=D.semPreco.get(item); if(!sp){ sp={ item:item, desc:desc||'', classe:classe||'', un:0, rgs:0 }; D.semPreco.set(item,sp); } sp.un+=un; sp.rgs+=rgs; if(!sp.desc && desc) sp.desc=desc; };
    D.cov.forEach(function(c){
      var o=D.vo(c.item); c.vu=o.v; c.valor=c.saldo*o.v; c.valorCom=c.comRg*o.v; c.valorSem=c.semRg*o.v;
      D.vt.total+=c.valor; D.vt.com+=c.valorCom; D.vt.sem+=c.valorSem;
      if(o.sem && c.saldo>0) addSem(c.item,c.desc,c.classe,c.saldo,0);
    });
    D.abertos.forEach(function(r){ if(D.vo(r.item).sem) addSem(r.item,D.itemDesc.get(r.item),r.classe,0,1); });
  }
  var pr=function(r){ return D.vu ? D.vu(r.item) : r.preco; };
  var mi=new Set(); D.cov.forEach(function(c){ if(c.mult) mi.add(c.item); }); D.mult.itens=mi.size;
  /* Situação de cada local — meta: 100% dos locais só com RG.
       rg = toda unidade do local tem RG · misto = RG e peça sem RG juntas · sem = nenhuma tem RG */
  var ml=new Map();
  D.cov.forEach(function(c){
    var l=ml.get(c.local); if(!l){ l={local:c.local, localDesc:c.localDesc, classe:c.classe, saldo:0, rgs:0, comRg:0, semRg:0, itens:0, itensMistos:0, somaDias:0, valorSem:0}; ml.set(c.local,l); }
    if(c.dias!=null) l.somaDias+=c.dias*c.saldo;
    l.saldo+=c.saldo; l.rgs+=c.rgs; l.comRg+=Math.min(c.saldo,c.rgs); l.semRg+=c.semRg; l.itens++; l.valorSem+=c.valorSem||0;
    if(c.rgs && c.semRg) l.itensMistos++;
  });
  D.locais=Array.from(ml.values());
  D.loc={total:D.locais.length, rg:0, misto:0, sem:0, unMisto:0};
  D.locais.forEach(function(l){
    l.st = l.rgs>0 ? (l.semRg>0 ? 'misto' : 'rg') : 'sem';
    l.p = l.saldo>0 ? l.comRg/l.saldo : (l.rgs>0?1:0);
    l.idade = l.saldo>0 ? Math.round(l.somaDias/l.saldo) : null;
    l.zona = String(l.localDesc||'').split(' ')[0]||'—';
    D.loc[l.st]++;
    if(l.st==='misto') D.loc.unMisto+=l.semRg;
    l.fora=SEM_MONITOR.test(String(l.localDesc||l.local||'').trim());
  });
  /* Início estimado de cada local misto: o local passou a ser misto quando RG e peça sem RG passaram a conviver,
     isto é, no mais recente dos dois começos (idade da peça sem RG mais antiga × idade do RG mais antigo). */
  /* Se a QRY0110 foi importada, a chegada do RG ao local é exata: é a data da última movimentação para lá. */
  var ultMov=new Map(); S.mov.forEach(function(m){ var o=ultMov.get(m.rg); if(!o || m.t>=o.t) ultMov.set(m.rg,m); });
  var rgAntigo=new Map(), rgExato=new Map();
  D.abertos.forEach(function(r){
    var m=ultMov.get(r.rg), ex=!!(m && m.d===r.local), t=ex ? soDia(m.t) : r.dt;
    if(!t) return;
    if(!rgAntigo.has(r.local) || t<rgAntigo.get(r.local)){ rgAntigo.set(r.local,t); rgExato.set(r.local,ex); }
  });
  var semAntigo=new Map(); D.cov.forEach(function(c){ if(c.semRg>0 && c.dias!=null && c.dias>(semAntigo.has(c.local)?semAntigo.get(c.local):-1)) semAntigo.set(c.local,c.dias); });
  D.locais.forEach(function(l){
    if(l.st!=='misto') return;
    var a=semAntigo.has(l.local)?semAntigo.get(l.local):null, b=rgAntigo.has(l.local)?dias(rgAntigo.get(l.local)):null;
    l.estDias = a!=null && b!=null ? Math.min(a,b) : (a!=null?a:b);
    /* exata quando quem define o início é a chegada do RG (o mais recente dos dois começos) e ela veio da QRY0110 */
    l.estExata = !!(b!=null && rgExato.get(l.local) && (a==null || b<=a));
  });
  /* Ritmo: RGs por dia, usando os dias com geração (últimos 14 dias corridos até o dado mais novo). */
  var porDia=new Map(); D.rgs.forEach(function(r){ if(r.dt) porDia.set(r.dt,(porDia.get(r.dt)||0)+1); });
  D.porDia=porDia;
  D.ultimoDia=porDia.size ? Math.max.apply(null,Array.from(porDia.keys())) : null;
  D.ritmo=0;
  if(D.ultimoDia){
    var ds=[]; for(var i=0;i<14;i++){ var t=D.ultimoDia-i*864e5; if(porDia.get(t)) ds.push(porDia.get(t)); }
    ds=ds.slice(0,7); D.ritmo=ds.length ? ds.reduce(function(a,b){ return a+b; },0)/ds.length : 0;
  }
  /* Série diária, operadores e classificação (dashboard). */
  D.dias=Array.from(porDia.entries()).sort(function(a,b){ return a[0]-b[0]; });
  var ops=new Map();
  D.rgs.forEach(function(r){
    var o=ops.get(r.oper); if(!o){ o={oper:r.oper, n:0, valor:0, dias:new Set()}; ops.set(r.oper,o); }
    o.n++; o.valor+=pr(r); if(r.dt) o.dias.add(r.dt);
  });
  D.ops=Array.from(ops.values()).sort(function(a,b){ return b.n-a.n; });
  var pessoasDia=0; D.ops.forEach(function(o){ o.nd=o.dias.size||1; o.media=o.n/o.nd; pessoasDia+=o.nd; });
  D.porPessoa = pessoasDia ? D.rgs.filter(function(r){ return r.dt; }).length/pessoasDia : 0;
  var mc=new Map();
  D.abertos.forEach(function(r){ var k=r.classif||'Sem classificação', o=mc.get(k); if(!o){ o={nome:k, n:0, valor:0}; mc.set(k,o); } o.n++; o.valor+=pr(r); });
  D.classif=Array.from(mc.values()).sort(function(a,b){ return b.n-a.n; });
  D.valor=D.abertos.reduce(function(s,r){ return s+pr(r); },0);
  D.semClassif=D.abertos.filter(function(r){ return !r.classif; }).length;
  S.D=D;
}
function faixaDe(n){ for(var i=0;i<FAIXAS.length;i++) if(n>=FAIXAS[i][0] && n<=FAIXAS[i][1]) return i; return FAIXAS.length-1; }
/* Soma n dias úteis (seg a sex) a uma data. */
function somaUteis(t, n){
  if(n>5000) return t+Math.round(n*7/5)*864e5;
  var d=new Date(t), k=0;
  while(k<n){ d.setDate(d.getDate()+1); var w=d.getDay(); if(w!==0 && w!==6) k++; }
  return d.getTime();
}
function descItem(r){ return S.D.itemDesc.get(r.item)||''; }
function descLocal(l){ return S.D.localDesc.get(l)||l||'—'; }
function classeNome(c){ return (S.est && S.est.classes[c]) ? c+' · '+S.est.classes[c] : (c||'—'); }
function ritmoAtual(){ return S.ritmo || Math.max(1,Math.round(S.D.ritmo)); }
function previsao(ritmo){
  var falta=S.D.tot.semRg; if(!falta) return {du:0, t:hoje0()};
  if(!ritmo) return null;
  var du=Math.ceil(falta/ritmo);
  return {du:du, t:somaUteis(hoje0(),du)};
}
function prazoTxt(du){
  if(du<=0) return 'concluído';
  if(du<60) return int(du)+' dias úteis';
  var meses=du/21;
  return meses<24 ? int(meses)+' meses' : (meses/12).toLocaleString('pt-BR',{maximumFractionDigits:1})+' anos';
}

/* Foto diária da cobertura: é dela que sai o gráfico de evolução. */
function snapshot(){
  var D=S.D; if(!S.est || !D || !D.tot.saldo) return;
  var hoje=hoje0(), ent={ d:hoje, saldo:D.tot.saldo, comRg:D.tot.comRg, semRg:D.tot.semRg, locRg:D.loc.rg, locTot:D.loc.total, misto:D.loc.misto, mi:D.locais.filter(function(l){ return l.st==='misto' && !l.fora; }).length };
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

function tip(){ return tipA(Array.prototype.slice.call(arguments).filter(Boolean).join('\n')); }
/* Anéis concêntricos: unidades, locais e linhas item × local. */
function aneis(lista){
  var h='<svg class="rgx-aneis" viewBox="0 0 220 220" role="img">', r0=98;
  lista.forEach(function(a,i){
    var r=r0-i*25, c=2*Math.PI*r, p=Math.max(0,Math.min(1,a.p)), vis=p>0?Math.max(p,0.012):0;
    h+='<circle cx="110" cy="110" r="'+r+'" fill="none" stroke="var(--surface2)" stroke-width="19"/>'+
       '<circle class="rgx-arco" cx="110" cy="110" r="'+r+'" fill="none" stroke="'+a.cor+'" stroke-width="19" stroke-linecap="round" transform="rotate(-90 110 110)" stroke-dasharray="'+c.toFixed(1)+'" stroke-dashoffset="'+c.toFixed(1)+'" data-off="'+(c*(1-vis)).toFixed(1)+'"'+tip(a.rot, int(a.a)+' de '+int(a.b), pct(a.a,a.b))+'/>';
  });
  h+='<text x="110" y="106" text-anchor="middle" class="rgx-aneis-n">'+pct(lista[0].a,lista[0].b)+'</text><text x="110" y="126" text-anchor="middle" class="rgx-aneis-l">COBERTURA</text></svg>';
  return h;
}

/* Curva de implantação: realizado + projeção até 100% no ritmo escolhido. */
function curva(ritmo){
  var D=S.D, T=D.tot, W=760, H=250, mx=44, my=16, mb=28, iw=W-mx-14, ih=H-my-mb;
  var prev=previsao(ritmo), hoje=hoje0();
  var t0=D.dias.length ? D.dias[0][0] : hoje, limite=hoje+3*365*864e5;
  var fim=prev ? Math.min(prev.t,limite) : limite, cortado=!prev || prev.t>limite;
  var t1=Math.max(fim, t0+7*864e5);
  var X=function(t){ return mx+(t-t0)/(t1-t0)*iw; }, Y=function(v){ return my+ih-(T.saldo?v/T.saldo:0)*ih; };
  var h='<svg class="rgx-curva" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img"><defs><linearGradient id="rgxG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FE5000" stop-opacity=".35"/><stop offset="1" stop-color="#FE5000" stop-opacity="0"/></linearGradient></defs>';
  [0,.25,.5,.75,1].forEach(function(f){ var y=my+ih-f*ih; h+='<line x1="'+mx+'" x2="'+(W-14)+'" y1="'+y+'" y2="'+y+'" class="rgx-grade'+(f===1?' meta':'')+'"/><text x="'+(mx-8)+'" y="'+(y+4)+'" text-anchor="end" class="rgx-eixo">'+(f*100)+'%</text>'; });
  /* eixo do tempo: até 6 marcas */
  for(var i=0;i<=5;i++){ var t=t0+(t1-t0)*i/5, d=new Date(t); h+='<text x="'+X(t)+'" y="'+(H-8)+'" text-anchor="'+(i===0?'start':i===5?'end':'middle')+'" class="rgx-eixo">'+d2(d.getDate())+'/'+d2(d.getMonth()+1)+'/'+String(d.getFullYear()).slice(2)+'</text>'; }
  /* realizado (acumulado de RGs) */
  var ac=0, pts=[[t0,0]];
  D.dias.forEach(function(x){ ac+=x[1]; pts.push([x[0]+864e5, Math.min(ac,T.saldo)]); });
  var feito=T.comRg;
  pts.push([Math.max(hoje,pts[pts.length-1][0]), feito]);
  var caminho=pts.map(function(p,i){ return (i?'L':'M')+X(p[0]).toFixed(1)+' '+Y(p[1]).toFixed(1); }).join(' ');
  var ultX=X(pts[pts.length-1][0]), ultY=Y(feito);
  h+='<path d="'+caminho+' L'+ultX.toFixed(1)+' '+(my+ih)+' L'+X(t0)+' '+(my+ih)+' Z" fill="url(#rgxG)"/><path d="'+caminho+'" class="rgx-real"/>';
  /* projeção */
  if(prev){
    var yFim = cortado ? Y(feito+(T.saldo-feito)*((limite-hoje)/(prev.t-hoje))) : Y(T.saldo);
    h+='<line x1="'+ultX.toFixed(1)+'" y1="'+ultY.toFixed(1)+'" x2="'+X(fim).toFixed(1)+'" y2="'+yFim.toFixed(1)+'" class="rgx-proj"/>';
    if(!cortado) h+='<circle cx="'+X(fim).toFixed(1)+'" cy="'+yFim.toFixed(1)+'" r="6" class="rgx-alvo"'+tip('Conclusão prevista',dataBR(prev.t),int(ritmo)+' RGs/dia')+'/>';
  }
  h+='<circle cx="'+ultX.toFixed(1)+'" cy="'+ultY.toFixed(1)+'" r="5.5" class="rgx-hoje"'+tip('Hoje',int(feito)+' un com RG',pct(feito,T.saldo))+'/></svg>';
  return h;
}

/* Treemap "squarified": área de cada bloco = unidades sem RG do local. */
function treemap(itens, W, H){
  var out=[];
  (function monta(lista,x,y,w,h){
    if(!lista.length || w<=0 || h<=0) return;
    var tot=lista.reduce(function(s,i){ return s+i.v; },0), area=w*h, vert=w>=h, lado=vert?h:w;
    var linha=[], soma=0, mn=Infinity, mxv=0, melhor=Infinity, i=0;
    for(;i<lista.length;i++){
      var a=lista[i].v/tot*area, ns=soma+a, nmax=Math.max(mxv,a), nmin=Math.min(mn,a);
      var pior=Math.max(lado*lado*nmax/(ns*ns), ns*ns/(lado*lado*nmin));
      if(linha.length && pior>melhor) break;
      linha.push({it:lista[i],a:a}); soma=ns; mxv=nmax; mn=nmin; melhor=pior;
    }
    var esp=soma/lado, off=0;
    linha.forEach(function(r){ var len=r.a/esp; out.push(vert?{it:r.it,x:x,y:y+off,w:esp,h:len}:{it:r.it,x:x+off,y:y,w:len,h:esp}); off+=len; });
    var resto=lista.slice(i);
    if(vert) monta(resto,x+esp,y,w-esp,h); else monta(resto,x,y+esp,w,h-esp);
  })(itens,0,0,W,H);
  return out;
}
function blocoTreemap(){
  var D=S.D, lista=D.locais.filter(function(l){ return l.semRg>0; }).sort(function(a,b){ return b.semRg-a.semRg; });
  if(!lista.length) return '<div class="rgx-ok">100% do estoque com RG</div>';
  var top=lista.slice(0,11), resto=lista.slice(11);
  var itens=top.map(function(l){ return {v:l.semRg, l:l}; });
  if(resto.length) itens.push({v:resto.reduce(function(s,l){ return s+l.semRg; },0), outros:resto.length});
  /* evita blocos invisíveis: piso de 1,2% da área */
  var tot=itens.reduce(function(s,i){ return s+i.v; },0);
  itens.forEach(function(i){ i.real=i.v; i.v=Math.max(i.v,tot*0.012); });
  itens.sort(function(a,b){ return b.v-a.v; });
  var W=100, H=46, cel=treemap(itens,W,H);
  return '<div class="rgx-tree">'+cel.map(function(c){
    var it=c.it, l=it.l, grande=c.w>13 && c.h>9, medio=c.w>6 && c.h>5;
    var nome=l?l.localDesc:'Outros', cls=l?(l.st==='misto'?'misto':'sem'):'outros';
    return '<button type="button" class="rgx-tree-c '+cls+'" style="left:'+(c.x/W*100).toFixed(3)+'%;top:'+(c.y/H*100).toFixed(3)+'%;width:'+(c.w/W*100).toFixed(3)+'%;height:'+(c.h/H*100).toFixed(3)+'%"'+
      (l?' data-act="local" data-l="'+esc(l.local)+'"':' data-act="tab" data-tab="estoque"')+
      tip(nome+(it.outros?' ('+int(it.outros)+' locais)':''), int(it.real)+' un sem RG', pct(it.real,D.tot.semRg)+' do que falta', l&&l.rgs?int(l.rgs)+' RGs no local':'')+'>'+
      (medio?'<b>'+esc(nome)+'</b>':'')+(grande?'<span>'+int(it.real)+'</span><em>'+pct(it.real,D.tot.semRg)+'</em>':'')+'</button>';
  }).join('')+'</div>';
}

function rosca(){
  var D=S.D, tot=D.abertos.length, r=62, c=2*Math.PI*r, off=0;
  if(!tot) return '<div class="rgx-ok">Sem RGs</div>';
  var h='<div class="rgx-rosca"><svg viewBox="0 0 170 170" role="img">';
  D.classif.forEach(function(o,i){
    var len=o.n/tot*c, cor=o.nome==='Sem classificação'?'#8E99A8':CORES_CLASSIF[i%CORES_CLASSIF.length]; o.cor=cor;
    h+='<circle class="rgx-fatia" cx="85" cy="85" r="'+r+'" fill="none" stroke="'+cor+'" stroke-width="24" stroke-dasharray="'+Math.max(0,len-1.5).toFixed(2)+' '+(c-len+1.5).toFixed(2)+'" stroke-dashoffset="'+(-off).toFixed(2)+'" transform="rotate(-90 85 85)" data-act="classif" data-c="'+esc(o.nome)+'"'+tip(o.nome,int(o.n)+' RGs · '+pct(o.n,tot),reais(o.valor))+'/>';
    off+=len;
  });
  h+='<text x="85" y="82" text-anchor="middle" class="rgx-rosca-n">'+int(tot)+'</text><text x="85" y="100" text-anchor="middle" class="rgx-aneis-l">RGs ABERTOS</text></svg><div class="rgx-rosca-leg">';
  D.classif.forEach(function(o){
    h+='<button type="button" class="rgx-leg-l" data-act="classif" data-c="'+esc(o.nome)+'"><i style="background:'+o.cor+'"></i><span>'+esc(o.nome)+'</span><b>'+int(o.n)+'</b><em>'+pct(o.n,tot)+'</em><small>'+reais(o.valor)+'</small></button>';
  });
  return h+'</div></div>';
}

function regua(){
  var D=S.D, tot=D.faixas.reduce(function(a,b){ return a+b; },0);
  if(!tot) return '<div class="rgx-ok">Nada pendente</div>';
  var h='<div class="rgx-regua">';
  FAIXAS.forEach(function(f,i){
    var v=D.faixas[i]; if(!v) return;
    h+='<button type="button" style="flex:'+Math.max(v/tot,0.035).toFixed(4)+';background:'+f[3]+'" data-act="faixa" data-fx="'+i+'"'+tip(f[2],int(v)+' un sem RG',pct(v,tot))+'>'+(v/tot>=0.09?'<b>'+pct(v,tot)+'</b>':'')+'</button>';
  });
  h+='</div><div class="rgx-regua-leg">';
  FAIXAS.forEach(function(f,i){ h+='<button type="button" data-act="faixa" data-fx="'+i+'"><i style="background:'+f[3]+'"></i><span>'+f[2]+'</span><b>'+int(D.faixas[i])+'</b></button>'; });
  return h+'</div>';
}

function mapaLocais(){
  var D=S.D, zonas=new Map(), porPrefixo=new Map();
  D.locais.forEach(function(l){ porPrefixo.set(l.zona,(porPrefixo.get(l.zona)||0)+1); });
  /* Zona grande demais (ex.: "R", com centenas de locais) é aberta por rua. */
  D.locais.forEach(function(l){
    var p=String(l.localDesc||'').split(' ');
    l.zonaMapa = porPrefixo.get(l.zona)>60 && p[1] ? p[0]+' '+p[1] : l.zona;
  });
  D.locais.forEach(function(l){ var z=zonas.get(l.zonaMapa); if(!z){ z={nome:l.zonaMapa, l:[], saldo:0}; zonas.set(l.zonaMapa,z); } z.l.push(l); z.saldo+=l.saldo; });
  var arr=Array.from(zonas.values()).sort(function(a,b){ return b.saldo-a.saldo; });
  var maxS=Math.max.apply(null,D.locais.map(function(l){ return l.saldo; }))||1;
  return '<div class="rgx-mapa">'+arr.map(function(z){
    z.l.sort(function(a,b){ return String(a.localDesc).localeCompare(String(b.localDesc),'pt-BR',{numeric:true}); });
    return '<div class="rgx-zona"><div class="rgx-zona-h"><b>'+esc(z.nome)+'</b><span>'+int(z.l.length)+' locais · '+int(z.saldo)+' un</span></div><div class="rgx-cels">'+z.l.map(function(l){
      /* intensidade = quanto saldo o local guarda (escala de raiz para não sumir os pequenos) */
      var op=(0.5+0.5*Math.pow(l.saldo/maxS,0.3)).toFixed(2);
      return '<button type="button" class="rgx-cel '+l.st+'" style="opacity:'+op+'" data-act="local" data-l="'+esc(l.local)+'"'+tip(l.localDesc,int(l.saldo)+' un · '+int(l.rgs)+' RGs',l.st==='rg'?'100% RG':l.st==='misto'?'Misto · '+pct(l.comRg,l.saldo)+' com RG':'Sem RG')+'></button>';
    }).join('')+'</div></div>';
  }).join('')+'</div>';
}

function ritmoDiario(){
  var D=S.D, dd=D.dias.slice(-30); if(!dd.length) return '<div class="rgx-ok">Sem RGs</div>';
  var max=Math.max.apply(null,dd.map(function(x){ return x[1]; }))||1, med=D.ritmo;
  return '<div class="rgx-dias"><div class="rgx-dias-med" style="bottom:calc(22px + '+(med/max*100).toFixed(1)+'% * .78)"><span>média '+int(med)+'</span></div>'+dd.map(function(x){
    return '<div class="rgx-dia"'+tip(dataBR(x[0]),int(x[1])+' RGs')+'><b>'+int(x[1])+'</b><i style="height:'+(x[1]/max*78).toFixed(1)+'%"></i><span>'+dataBR(x[0]).slice(0,5)+'</span></div>';
  }).join('')+'</div>';
}
/* Operadores: quando a QRY0100 não traz quem criou o RG, mostra quem MOVEU os RGs (QRY0110); sem nenhum dos dois, avisa. */
function rankingSemOperador(){
  var D=S.D;
  if(S.mov.length){
    var corte=hoje0()-29*864e5, mp=new Map();
    S.mov.forEach(function(m){ if(m.t<corte) return; var o=mp.get(m.op); if(!o){ o={ op:m.op, n:0, dias:new Set() }; mp.set(m.op,o); } o.n++; o.dias.add(soDia(m.t)); });
    var L=Array.from(mp.values()).sort(function(a,b){ return b.n-a.n; }), tot=L.reduce(function(t,o){ return t+o.n; },0)||1, max=L.length?L[0].n:1;
    if(L.length) return '<div class="rgx-mt-nota" style="margin:0 0 10px">A QRY0100 não traz quem criou o RG. Aqui: quem <b>moveu</b> os RGs nos últimos 30 dias (QRY0110).</div><div class="rgx-rank">'+L.slice(0,6).map(function(o,i){
      var nome=operNome(o.op), ini=nome.slice(0,2).toUpperCase();
      return '<div class="rgx-rank-l"'+tip(nome,int(o.n)+' movimentações em '+int(o.dias.size)+' dia(s)',int(o.n/o.dias.size)+' por dia')+'><span class="rgx-av p'+(i+1)+'">'+esc(ini)+'</span><span class="rgx-rank-n"><b>'+esc(nome)+'</b><i><u style="width:'+(o.n/max*100).toFixed(1)+'%"></u></i></span><span class="rgx-rank-v"><b>'+int(o.n)+'</b><em>'+int(o.n/o.dias.size)+'/dia · '+pct(o.n,tot)+'</em></span></div>';
    }).join('')+'</div>';
  }
  return '<div class="rgx-ok">A QRY0100 não traz o operador. Importe a QRY0110 para ver quem moveu os RGs.</div>';
}
function ranking(){
  var D=S.D;
  if(!D.ops.some(function(o){ return o.oper; })) return rankingSemOperador();
  var max=D.ops.length?D.ops[0].n:1, tot=D.rgs.length||1;
  return '<div class="rgx-rank">'+D.ops.slice(0,6).map(function(o,i){
    var nome=operNome(o.oper), ini=nome.slice(0,2).toUpperCase();
    return '<button type="button" class="rgx-rank-l" data-act="oper" data-o="'+esc(o.oper)+'"'+tip(nome,int(o.n)+' RGs em '+int(o.nd)+' dia(s)',int(o.media)+' por dia',reais(o.valor))+'><span class="rgx-av p'+(i+1)+'">'+esc(ini)+'</span><span class="rgx-rank-n"><b>'+esc(nome)+'</b><i><u style="width:'+(o.n/max*100).toFixed(1)+'%"></u></i></span><span class="rgx-rank-v"><b>'+int(o.n)+'</b><em>'+int(o.media)+'/dia · '+pct(o.n,tot)+'</em></span></button>';
  }).join('')+'</div>';
}


/* ---------- Dashboard ---------- */
function cartao(rot, chip, chipCls, numHtml, delta, barra, hint){
  return '<div class="dx-card"><div class="dx-card-top"><span class="dx-card-rot">'+rot+'</span>'+(chip?'<span class="dx-chip '+chipCls+'">'+chip+'</span>':'')+'</div><div class="dx-card-val">'+numHtml+(delta||'')+'</div>'+(barra||'')+'<div class="dx-card-hint">'+hint+'</div></div>';
}
function n(v, f, cls, id){ return '<span class="dx-num'+(cls?' '+cls:'')+'"'+(id?' id="'+id+'"':'')+' data-n="'+v+'" data-f="'+f+'">'+fmtN(v,f)+'</span>'; }
function fmtN(v, f){ return f==='pct' ? v.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%' : f==='brl' ? reais(v) : int(v); }
function atualizaSim(ritmo){
  var D=S.D, prev=previsao(ritmo);
  var set=function(id,v){ var e=$(id); if(e) e.textContent=v; };
  set('simV',int(ritmo)); set('simOps', D.porPessoa?int(Math.ceil(ritmo/D.porPessoa)):'—');
  set('simData', prev?dataBR(prev.t):'—'); set('simPrazo', prev?prazoTxt(prev.du):'');
  set('cdData', prev?dataBR(prev.t):'—'); set('cdPrazo', prev?prazoTxt(prev.du):''); set('cdRitmo', int(ritmo)+'/dia');
  var b=$('curvaBox'); if(b) b.innerHTML=curva(ritmo);
}
/* Entrada animada: números contam e arcos preenchem. */
function anima(){
  Array.prototype.forEach.call(document.querySelectorAll('.rgx-arco'),function(c){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ c.style.strokeDashoffset=c.dataset.off; }); }); });
  if(!S.anima || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  S.anima=false;
  var els=document.querySelectorAll('.dx-num[data-n]'), t0=null, dur=900;
  function passo(ts){
    if(!t0) t0=ts; var k=Math.min(1,(ts-t0)/dur), e=1-Math.pow(1-k,3);
    Array.prototype.forEach.call(els,function(el){ el.textContent=fmtN(parseFloat(el.dataset.n)*e, el.dataset.f); });
    if(k<1) requestAnimationFrame(passo);
  }
  requestAnimationFrame(passo);
}

function vPainel(){
  var D=S.D, T=D.tot, L=D.loc, tem=!!S.est;
  var hero='<div class="rv-hero rgx-hero"><div class="rv-hero-in">'+
    '<div class="rv-marca"><img src="brand/Logo_LDM_icon.png" alt=""><div><b>Oficina LDM</b><span>RG Reversa · CD Cajamar</span></div></div>'+
    '<div class="rv-hero-row"><div><h2>Implantação de RG</h2><span class="rgx-sub">Logística Reversa'+(tem?' · base de '+dataBR(S.est.em):'')+'</span></div>'+
    '</div></div></div>';
  if(!tem && !S.rgs.length && S.nuvem.estado==='sync'){
    return hero+'<div class="rv-body"><div class="panel rgx-vazio"><div class="rgx-vazio-ic">⏳</div><h3>Carregando a última importação…</h3></div></div>';
  }
  if(!tem){
    return hero+'<div class="rv-body"><div class="panel rgx-vazio"><div class="rgx-vazio-ic">⇄</div><h3>'+(leitura()?'Ainda não há dados importados':'Falta importar '+(S.rgs.length?'a QRY0390':'a QRY0100 e a QRY0390'))+'</h3><button class="btn btn-orange so-editor" data-act="tab" data-tab="importacao">Importar relatórios</button></div></div>';
  }
  if(S.mistos==null && !S.mistosBusy) setTimeout(carregaMistos,0);
  var MT=resumoMisto();
  var ritmo=ritmoAtual(), prev=previsao(ritmo);
  var cob=T.saldo?T.comRg/T.saldo*100:0;
  var ud=D.dias.length?D.dias[D.dias.length-1]:null, pd=D.dias.length>1?D.dias[D.dias.length-2]:null;
  var dlt = ud ? '<span class="dx-delta '+(pd && ud[1]<pd[1]?'down':'up')+'">'+(pd?(ud[1]>=pd[1]?'▲ ':'▼ '):'')+int(ud[1])+' em '+dm(ud[0])+'</span>' : '';
  var cards=
    cartao('Cobertura de RG','meta 100%',cob>=100?'ok':'nok', n(cob,'pct'), '', '<div class="dx-bar"><i style="width:'+Math.max(cob,0.6).toFixed(2)+'%;background:var(--orange)"></i><b style="left:calc(100% - 2px)"></b></div>', int(T.comRg)+' de '+int(T.saldo)+' unidades')+
    cartao('RGs gerados', int(D.ritmo)+'/dia','neutro', n(D.rgs.length,'int'), dlt, '', int(D.abertos.length)+' abertos · '+int(D.ops.length)+' operadores')+
    cartao('Falta identificar', pct(T.semRg,T.saldo), T.semRg?'nok':'ok', n(T.semRg,'int',T.semRg?'bad':''), '', '', int(T.linhas-T.linhasOk)+' linhas item × local')+
    cartao('Conclusão prevista', '<span id="cdRitmo">'+int(ritmo)+'/dia</span>','neutro', '<span class="dx-num" id="cdData">'+(prev?dataBR(prev.t):'—')+'</span>', '', '', '<span id="cdPrazo">'+(prev?prazoTxt(prev.du):'sem ritmo')+'</span>');
  var avisoKit=(S.preco && (!S.mult || S.mult.semFlag)) ? '<div class="rv-aviso" style="margin-bottom:12px"><strong>Kits:</strong> importe a ZBIQ0051 (com a coluna in_interface) para aplicar a regra dos kits no valor.</div>' : '';
  var faixa=avisoKit+'<div class="rv-faixa">'+
    tile('Locais 100% RG', int(L.rg), pct(L.rg,L.total)+' de '+int(L.total), L.rg===L.total?'good':'blue')+
    tile('Locais mistos', int(L.misto), int(L.unMisto)+' un sem RG', L.misto?'bad':'good')+
    tile('Locais sem RG', int(L.sem), pct(L.sem,L.total), '')+
    tile('Tempo em misto', MT.lista.length?int(MT.media)+' d':'—', MT.lista.length?'média · mais antigo '+int(MT.maior.dias)+' d':'nenhum misto', MT.lista.length?(MT.maior.dias>90?'bad':''):'good', MT.lista.length?'Locais mistos há '+int(MT.media)+' dias em média\nTRI e PIC ficam de fora':'')+
    (D.vu ? tile('Valor da reversa', reaisC(D.vt.total), reais(D.vt.total), '', 'Quantidade × preço de custo (SIGEQ278)')+
      tile('Valor com RG', reaisC(D.vt.com), pct(D.vt.com,D.vt.total)+' do valor', 'good')+
      tile('Valor sem RG', reaisC(D.vt.sem), 'falta identificar', D.vt.sem?'bad':'good')+
      '<button type="button" class="rv-tile rv-tile-btn" data-act="sempreco-xlsx"'+tip('Itens sem preço','Valem R$ 0. Clique para baixar a lista.')+'><div class="t1">Itens sem preço</div><div class="t2'+(D.semPreco.size?' bad':' good')+'">'+int(D.semPreco.size)+'</div><div class="t3">valem R$ 0 · baixar lista</div></button>'
     : tile('Valor identificado', reaisC(D.valor), reais(D.valor), '', 'Soma do PRECO da QRY0100. Importe a SIGEQ278 para valorar a reversa inteira.'))+
    tile('Sem classificação', int(D.semClassif), pct(D.semClassif,D.abertos.length), D.semClassif?'bad':'good')+
    tile('RG sem saldo', int(T.rgSemSaldo), 'divergência', T.rgSemSaldo?'bad':'good')+
    tile('Média por pessoa', int(D.porPessoa), 'RGs por dia', '')+
    tile('Múltiplos', S.mult?int(D.mult.un)+' un':'—', S.mult?int(D.mult.itens)+' itens · '+pct(D.mult.semRg,D.mult.un,0)+' sem RG':'ZBIQ0051', '')+
    '</div>';
  var rAneis=[
    {rot:'Unidades com RG', a:T.comRg, b:T.saldo, p:T.saldo?T.comRg/T.saldo:0, cor:'#FE5000'},
    {rot:'Locais 100% RG', a:L.rg, b:L.total, p:L.total?L.rg/L.total:0, cor:'var(--rv-blue)'},
    {rot:'Linhas item × local fechadas', a:T.linhasOk, b:T.linhas, p:T.linhas?T.linhasOk/T.linhas:0, cor:'#1F8A52'}
  ];
  var maxR=Math.max(5000, Math.ceil(ritmo*3/500)*500);
  var rs=Array.from(D.restr.entries()).sort(function(a,b){ return b[1]-a[1]; }).slice(0,8).map(function(x){ return {l:x[0]+' · '+(RESTR[x[0]]||'—'), v:x[1], t:x[0]+' · '+(RESTR[x[0]]||'restrição')+'\n'+int(x[1])+' un · '+pct(x[1],T.saldo), cor:'linear-gradient(90deg,var(--rv-blue),var(--rv-blue2))'}; });
  var top=Array.from(D.itens.values()).sort(function(a,b){ return b.semRg-a.semRg; }).slice(0,8).map(function(it){ return {l:it.item+' · '+(it.desc||''), v:it.semRg, txt:int(it.semRg), t:it.item+' · '+(it.desc||'')+'\n'+int(it.semRg)+' un sem RG de '+int(it.saldo)}; });
  var h3=function(tit, extra){ return '<div class="dx-panel-h"><h3>'+tit+'</h3>'+(extra||'')+'</div>'; };
  return hero+'<div class="rv-body rgx-body">'+
    '<section class="dx-cards">'+cards+'</section>'+faixa+
    '<div class="rgx-g rgx-g-a">'+
      '<div class="panel">'+h3('Progresso da implantação')+'<div class="rgx-aneis-box">'+aneis(rAneis)+'<div class="rgx-aneis-leg">'+rAneis.map(function(a){ return '<div><i style="background:'+a.cor+'"></i><span>'+a.rot+'</span><b>'+pct(a.a,a.b)+'</b><em>'+int(a.a)+' / '+int(a.b)+'</em></div>'; }).join('')+'</div></div></div>'+
      '<div class="panel">'+h3('Curva de implantação','<div class="cmp-legend"><span><span class="cmp-dot" style="background:#FE5000"></span>Realizado</span><span><span class="dx-meta-leg" style="border-color:var(--rv-blue)"></span>Projeção</span></div>')+
        '<div id="curvaBox">'+curva(ritmo)+'</div>'+
        '<div class="rgx-sim"><label for="simRitmo">Simular ritmo</label><input type="range" id="simRitmo" min="50" max="'+maxR+'" step="50" value="'+Math.min(maxR,Math.max(50,Math.round(ritmo/50)*50))+'"><div class="rgx-sim-v"><b id="simV">'+int(ritmo)+'</b><span>RGs/dia</span></div><div class="rgx-sim-v"><b id="simOps">'+(D.porPessoa?int(Math.ceil(ritmo/D.porPessoa)):'—')+'</b><span>pessoas</span></div><div class="rgx-sim-v dest"><b id="simData">'+(prev?dataBR(prev.t):'—')+'</b><span id="simPrazo">'+(prev?prazoTxt(prev.du):'')+'</span></div><button type="button" class="rgx-sim-r" data-act="ritmo-real" title="Voltar ao ritmo real">↺</button></div>'+
      '</div>'+
    '</div>'+
    '<div class="rgx-g rgx-g-b">'+
      '<div class="panel">'+h3('Onde falta RG','<div class="cmp-legend"><span><span class="cmp-dot" style="background:var(--rv-blue)"></span>Sem RG</span><span><span class="cmp-dot" style="background:#FE5000"></span>Misto</span></div>')+blocoTreemap()+'</div>'+
      '<div class="panel">'+h3('Classificação das peças')+rosca()+'</div>'+
    '</div>'+
    '<div class="panel">'+h3('Mapa dos locais','<div class="cmp-legend"><span><span class="cmp-dot" style="background:#1F8A52"></span>100% RG · '+int(L.rg)+'</span><span><span class="cmp-dot" style="background:#FE5000"></span>Misto · '+int(L.misto)+'</span><span><span class="cmp-dot" style="background:var(--rv-blue)"></span>Sem RG · '+int(L.sem)+'</span></div>')+mapaLocais()+'</div>'+
    '<div class="rgx-g rgx-g-m">'+
      '<div class="panel">'+h3('Locais mistos · há quanto tempo')+listaMisto(MT)+'</div>'+
      '<div class="panel">'+h3('Evolução dos locais mistos')+evolucaoMisto(MT)+'</div>'+
    '</div>'+
    '<div class="rgx-g rgx-g-c">'+
      '<div class="panel">'+h3('Idade do estoque sem RG')+regua()+'</div>'+
      '<div class="panel">'+h3('Ritmo diário')+ritmoDiario()+'</div>'+
      '<div class="panel">'+h3('Operadores')+ranking()+'</div>'+
    '</div>'+
    '<div class="rgx-g rgx-g-d">'+
      '<div class="panel">'+h3('Itens com mais unidades sem RG')+hbars(top,{cor:'linear-gradient(90deg,#FE5000,#FFB347)'})+'</div>'+
      '<div class="panel">'+h3('Estoque por restrição')+hbars(rs)+'</div>'+
    '</div>'+
    '<div class="rgx-rel"><button type="button" data-act="relatorio" title="Baixa um arquivo HTML com o resumo do dashboard para enviar">⤓ Relatório para a gestão (HTML)</button></div>'+
  '</div>';
}

/* ---------- Relatório em HTML (arquivo único, pronto para enviar por e-mail) ---------- */
function relatorioHtml(){
  var D=S.D, T=D.tot, L=D.loc, ritmo=ritmoAtual(), prev=previsao(ritmo), cob=T.saldo?T.comRg/T.saldo*100:0;
  var agora=new Date(), base=S.est?dataBR(S.est.em):'—';
  var kpi=function(rot,val,sub,cor){ return '<div class="k"><span>'+esc(rot)+'</span><b'+(cor?' style="color:'+cor+'"':'')+'>'+val+'</b><i>'+sub+'</i></div>'; };
  var barra=function(p,cor){ return '<div class="bar"><u style="width:'+Math.max(0,Math.min(100,p)).toFixed(1)+'%;background:'+cor+'"></u></div>'; };
  var tab=function(cab,linhas){ return '<table><thead><tr>'+cab.map(function(c,i){ return '<th'+(i?' class="n"':'')+'>'+esc(c)+'</th>'; }).join('')+'</tr></thead><tbody>'+linhas.map(function(l){ return '<tr>'+l.map(function(c,i){ return '<td'+(i?' class="n"':'')+'>'+c+'</td>'; }).join('')+'</tr>'; }).join('')+'</tbody></table>'; };
  var dd=D.dias.slice(-30), max=Math.max.apply(null,dd.map(function(x){ return x[1]; }).concat([1]));
  var W=720, H=150, bw=W/Math.max(dd.length,1);
  var svg=dd.length ? '<svg viewBox="0 0 '+W+' '+(H+22)+'" width="100%" role="img" aria-label="RGs gerados por dia">'+dd.map(function(x,i){
    var h=x[1]/max*H, X=i*bw+bw*.15;
    return '<rect x="'+X.toFixed(1)+'" y="'+(H-h).toFixed(1)+'" width="'+(bw*.7).toFixed(1)+'" height="'+h.toFixed(1)+'" rx="2" fill="#FE5000"/>'+
      '<text x="'+(X+bw*.35).toFixed(1)+'" y="'+(H+14)+'" font-size="9" text-anchor="middle" fill="#6B7280">'+dataBR(x[0]).slice(0,5)+'</text>'+
      (dd.length<=16 ? '<text x="'+(X+bw*.35).toFixed(1)+'" y="'+Math.max(10,H-h-4).toFixed(1)+'" font-size="9" text-anchor="middle" fill="#001A72" font-weight="700">'+int(x[1])+'</text>' : '');
  }).join('')+'</svg>' : '<p class="m">Sem RGs no período.</p>';
  var totF=D.faixas.reduce(function(a,b){ return a+b; },0)||1;
  var faixas=tab(['Idade do estoque sem RG','Unidades','%'], FAIXAS.map(function(f,i){ return ['<span class="dot" style="background:'+f[3]+'"></span>'+f[2], int(D.faixas[i]), pct(D.faixas[i],totF)]; }));
  var ops=tab(['Operador','RGs','Por dia'], D.ops.slice(0,8).map(function(o){ return [esc(operNome(o.oper)), int(o.n), int(o.media)]; }));
  var top=tab(['Item','Un sem RG'], Array.from(D.itens.values()).sort(function(a,b){ return b.semRg-a.semRg; }).slice(0,8).map(function(it){ return [esc(it.item+' · '+(it.desc||'')), int(it.semRg)]; }));
  var cls=tab(['Classificação (RGs abertos)','RGs','%'], D.classif.slice(0,6).map(function(c){ return [esc(c.nome), int(c.n), pct(c.n,D.abertos.length)]; }));
  var css='*{box-sizing:border-box}body{margin:0;background:#F3F4F8;color:#111827;font:14px/1.45 -apple-system,Segoe UI,Roboto,Arial,sans-serif}.w{max-width:860px;margin:0 auto;padding:20px 16px 36px}'+
    'header{background:#001A72;color:#fff;border-radius:16px;padding:22px 24px;border-bottom:5px solid #FE5000}header small{opacity:.8;letter-spacing:.08em;text-transform:uppercase;font-size:11px}header h1{margin:4px 0 2px;font-size:24px}header p{margin:0;opacity:.85;font-size:13px}'+
    '.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:14px 0}.k{background:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,26,114,.08)}.k span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;font-weight:700}.k b{display:block;font-size:28px;color:#001A72;margin:2px 0}.k i{font-style:normal;font-size:12px;color:#6B7280}'+
    '.bar{height:8px;background:#E5E7EB;border-radius:99px;overflow:hidden;margin-top:8px}.bar u{display:block;height:100%;border-radius:99px}'+
    'section{background:#fff;border-radius:14px;padding:16px 18px;margin:12px 0;box-shadow:0 1px 3px rgba(0,26,114,.08)}h2{margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#001A72}'+
    '.c2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}.c2 section{margin:0}'+
    'table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6B7280;padding:6px 4px;border-bottom:1px solid #E5E7EB}td{padding:6px 4px;border-bottom:1px solid #F0F1F5}.n{text-align:right;font-variant-numeric:tabular-nums}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px}'+
    '.m{color:#6B7280;font-size:12px}footer{text-align:center;color:#9CA3AF;font-size:11px;margin-top:18px}@media print{body{background:#fff}.w{padding:0}section,.k{box-shadow:none;border:1px solid #E5E7EB;break-inside:avoid}}';
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RG Reversa · Relatório '+dataBR(agora)+'</title><style>'+css+'</style></head><body><div class="w">'+
    '<header><small>Loja do Mecânico · CD Cajamar</small><h1>RG Reversa · Implantação de RG</h1><p>Base do estoque de '+base+' · relatório gerado em '+dataHoraBR(agora)+'</p></header>'+
    '<div class="g">'+
      '<div class="k"><span>Cobertura de RG</span><b>'+pct(T.comRg,T.saldo)+'</b><i>'+int(T.comRg)+' de '+int(T.saldo)+' unidades · meta 100%</i>'+barra(cob,'#FE5000')+'</div>'+
      (D.vu ? kpi('Valor da reversa', reaisC(D.vt.total), pct(D.vt.com,D.vt.total)+' já com RG · '+reaisC(D.vt.sem)+' sem RG') : '')+
      kpi('Falta identificar', int(T.semRg), pct(T.semRg,T.saldo)+' do estoque da reversa', T.semRg?'#C83812':'#1F8A52')+
      kpi('RGs gerados', int(D.rgs.length), int(D.abertos.length)+' abertos · '+int(D.ops.length)+' operadores')+
      kpi('Conclusão prevista', prev?dataBR(prev.t):'—', prev?prazoTxt(prev.du)+' no ritmo de '+int(ritmo)+'/dia':'sem ritmo calculado')+
    '</div>'+
    '<section><h2>Locais da reversa</h2><div class="g" style="margin:0">'+
      kpi('Locais 100% RG', int(L.rg), pct(L.rg,L.total)+' de '+int(L.total)+' locais','#1F8A52')+
      kpi('Locais mistos', int(L.misto), int(L.unMisto)+' un sem RG misturadas', L.misto?'#C83812':'#1F8A52')+
      kpi('Locais sem RG', int(L.sem), pct(L.sem,L.total)+' dos locais')+
    '</div></section>'+
    '<section><h2>RGs gerados por dia (últimos 30 dias com geração)</h2>'+svg+'<p class="m">Média recente: '+int(D.ritmo)+' RGs/dia · '+int(D.porPessoa)+' por pessoa/dia</p></section>'+
    '<div class="c2"><section><h2>Idade do estoque sem RG</h2>'+faixas+'</section><section><h2>Operadores</h2>'+ops+'</section></div>'+
    '<div class="c2" style="margin-top:12px"><section><h2>Itens com mais unidades sem RG</h2>'+top+'</section><section><h2>Classificação das peças</h2>'+cls+'</section></div>'+
    '<footer>RG Reversa · Central LDM · gerado automaticamente a partir dos relatórios QRY0100 e QRY0390</footer></div></body></html>';
}
function baixaRelatorio(){
  if(!S.est) return toast('Importe os relatórios antes de gerar o relatório.', true);
  var blob=new Blob([relatorioHtml()],{type:'text/html;charset=utf-8'}), a=document.createElement('a'), d=new Date();
  a.href=URL.createObjectURL(blob); a.download='RG_Reversa_Relatorio_'+d.getFullYear()+d2(d.getMonth()+1)+d2(d.getDate())+'.html';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){ URL.revokeObjectURL(a.href); },2000);
  toast('Relatório baixado. É só anexar no e-mail.');
}

/* ---------- tabelas (Estoque × RG e Consulta) ---------- */
function tagClassif(c){
  if(!c) return '<span class="tag tag-bad">Sem classificação</span>';
  var x=norm(c), cls = x.indexOf('open')>=0 ? 'tag-blue' : x.indexOf('saldo a')>=0 ? 'tag-good' : x.indexOf('saldo')>=0 ? 'tag-orange' : 'tag-muted';
  return '<span class="tag '+cls+'">'+esc(c)+'</span>';
}
function tagDias(d){
  if(d==null) return '—';
  return '<span class="rgx-dias-tag" style="--c:'+FAIXAS[faixaDe(d)][3]+'">'+int(d)+' d</span>';
}
function tabela(id, cols, linhas, cfg){
  cfg=cfg||{};
  var st=S.sort[id];
  if(st){
    var col=cols.filter(function(c){ return c.k===st.k; })[0];
    if(col){
      var v=col.val || function(r){ return r[col.k]; };
      linhas=linhas.slice().sort(function(a,b){
        var x=v(a), y=v(b);
        if(x==null) x=col.num?-Infinity:''; if(y==null) y=col.num?-Infinity:'';
        return st.dir*((typeof x==='number' && typeof y==='number') ? x-y : String(x).localeCompare(String(y),'pt-BR',{numeric:true}));
      });
    }
  }
  var lim=S.lim[id]||PAGINA, parte=linhas.slice(0,lim);
  var h='<div class="rgx-tb-wrap"><table class="rgx-tb"><thead><tr>'+cols.map(function(c){
    var seta = st && st.k===c.k ? (st.dir>0?' ▲':' ▼') : '';
    return '<th'+(c.num?' class="rgx-num"':'')+' data-act="ordena" data-tb="'+id+'" data-k="'+c.k+'">'+esc(c.rot)+seta+'</th>';
  }).join('')+'</tr></thead><tbody>';
  if(!parte.length) h+='<tr><td colspan="'+cols.length+'" class="rgx-nada">Nada encontrado</td></tr>';
  parte.forEach(function(r){
    h+='<tr'+(cfg.rg?' class="rgx-click" data-act="ficha" data-rg="'+esc(r.rg)+'"':cfg.local?' class="rgx-click" data-act="local" data-l="'+esc(r.local)+'"':'')+'>'+cols.map(function(c){ return '<td'+(c.num?' class="rgx-num"':'')+'>'+(c.fmt?c.fmt(r):esc(r[c.k]))+'</td>'; }).join('')+'</tr>';
  });
  h+='</tbody></table></div>';
  if(linhas.length>lim) h+='<div class="rgx-mais"><button class="btn btn-secondary" data-act="mais" data-tb="'+id+'">Mostrar mais · '+int(linhas.length-lim)+'</button></div>';
  return h;
}
function semDados(q){ return '<div class="panel rgx-vazio"><div class="rgx-vazio-ic">⇄</div><h3>'+(leitura()?'Ainda não há dados importados':'Falta importar '+q)+'</h3><button class="btn btn-orange so-editor" data-act="tab" data-tab="importacao">Importar relatórios</button></div>'; }

function covFiltrada(){
  var q=norm(S.cobQ);
  return S.D.cov.filter(function(c){
    if(S.cobModo==='sem' && !c.semRg) return false;
    if(S.cobModo==='rgsem' && !c.rgSemSaldo) return false;
    if(S.cobModo==='ok' && (!c.saldo || c.semRg)) return false;
    if(S.cobLocal && c.local!==S.cobLocal) return false;
    if(S.cobFaixa!=='' && String(c.fx)!==S.cobFaixa) return false;
    if(q && norm(c.item+' '+c.ean+' '+c.desc+' '+c.localDesc).indexOf(q)<0) return false;
    return true;
  });
}
function barraCob(c){
  var p=c.saldo?c.comRg/c.saldo*100:(c.rgs?100:0);
  return '<div class="rgx-mini"><i style="width:'+p.toFixed(1)+'%"></i></div><span class="rgx-mini-v">'+pct(c.comRg,c.saldo)+'</span>';
}
var COLS_COV=[
  {k:'item',rot:'Item',fmt:function(r){ return '<span class="mono">'+esc(r.item)+'</span>'; }},
  {k:'desc',rot:'Descrição',fmt:function(r){ return '<div class="rgx-desc" title="'+esc(r.desc)+'">'+esc(r.desc||'—')+'</div>'; }},
  {k:'localDesc',rot:'Local',fmt:function(r){ return '<button type="button" class="rgx-link" data-act="local" data-l="'+esc(r.local)+'">'+esc(r.localDesc)+'</button>'; }},
  {k:'saldo',rot:'Saldo',num:1,fmt:function(r){ return int(r.saldo); }},
  {k:'rgs',rot:'RGs',num:1,fmt:function(r){ return int(r.rgs); }},
  {k:'semRg',rot:'Sem RG',num:1,fmt:function(r){ return r.semRg?'<strong>'+int(r.semRg)+'</strong>':'0'; }},
  {k:'p',rot:'Cobertura',val:function(r){ return r.saldo?r.comRg/r.saldo:0; },fmt:barraCob},
  {k:'dias',rot:'Idade',num:1,fmt:function(r){ return tagDias(r.dias); }}
];
function colsCov(){
  if(!S.D.vu) return COLS_COV;
  return COLS_COV.concat([
    {k:'vu',rot:'Custo un.',num:1,fmt:function(r){ return reais(r.vu||0); }},
    {k:'valorSem',rot:'Valor sem RG',num:1,fmt:function(r){ return reais(r.valorSem||0); }}
  ]);
}
function vEstoque(){
  if(!S.est) return semDados('QRY0390');
  var D=S.D, lista=covFiltrada();
  if(!S.sort.cov) S.sort.cov={k:S.cobModo==='rgsem'?'rgs':'semRg',dir:-1};
  var chip=function(m,rot,nn){ return '<button type="button" class="chip'+(S.cobModo===m?' active':'')+'" data-act="cob-modo" data-m="'+m+'">'+rot+' · '+int(nn)+'</button>'; };
  var locais=D.locais.slice().sort(function(a,b){ return b.semRg-a.semRg; });
  var ativos='';
  if(S.cobLocal) ativos+='<button type="button" class="chip active" data-act="tira-local">'+esc(descLocal(S.cobLocal))+' ✕</button>';
  if(S.cobFaixa!=='') ativos+='<button type="button" class="chip active" data-act="tira-faixa">'+FAIXAS[+S.cobFaixa][2]+' ✕</button>';
  return '<div class="panel"><div class="rgx-chips">'+
      chip('sem','Sem RG',D.cov.filter(function(c){ return c.semRg; }).length)+chip('ok','100% RG',D.cov.filter(function(c){ return c.saldo && !c.semRg; }).length)+chip('rgsem','RG sem saldo',D.cov.filter(function(c){ return c.rgSemSaldo; }).length)+chip('todos','Tudo',D.cov.length)+ativos+'</div>'+
    '<div class="filter-bar"><input type="text" id="fCobQ" placeholder="Item, EAN, descrição ou local" value="'+esc(S.cobQ)+'">'+
      '<select data-f="cobLocal">'+opt('','Todos os locais',S.cobLocal)+locais.map(function(l){ return opt(l.local,l.localDesc+' · '+int(l.semRg),S.cobLocal); }).join('')+'</select>'+
      '<button class="btn btn-primary" data-act="exporta-cov">Exportar Excel</button></div>'+
    '<div class="rgx-resumo"><span><b>'+int(lista.length)+'</b> linhas</span><span><b>'+int(lista.reduce(function(s,c){ return s+c.saldo; },0))+'</b> un em saldo</span><span><b>'+int(lista.reduce(function(s,c){ return s+c.semRg; },0))+'</b> sem RG</span></div>'+
    tabela('cov',colsCov(),lista)+'</div>';
}

function rgsFiltrados(){
  var q=norm(S.q);
  return S.D.rgs.filter(function(r){
    if(S.fClassif && (S.fClassif==='Sem classificação' ? r.classif : r.classif!==S.fClassif)) return false;
    if(S.fOper && r.oper!==S.fOper) return false;
    if(q && norm(r.rg+' '+r.item+' '+r.ean+' '+descItem(r)+' '+descLocal(r.local)+' '+r.oper).indexOf(q)<0) return false;
    return true;
  });
}
var COLS_RG=[
  {k:'rg',rot:'RG',fmt:function(r){ return '<span class="mono rgx-rgcod">'+esc(r.rg)+'</span>'; }},
  {k:'dt',rot:'Criado',fmt:function(r){ return dataBR(r.dt); }},
  {k:'item',rot:'Item',fmt:function(r){ return '<span class="mono">'+esc(r.item)+'</span>'; }},
  {k:'desc',rot:'Descrição',val:function(r){ return descItem(r); },fmt:function(r){ var d=descItem(r); return '<div class="rgx-desc" title="'+esc(d)+'">'+esc(d||'—')+'</div>'; }},
  {k:'classif',rot:'Classificação',fmt:function(r){ return tagClassif(r.classif); }},
  {k:'local',rot:'Local',val:function(r){ return descLocal(r.local); },fmt:function(r){ return esc(descLocal(r.local)); }},
  {k:'oper',rot:'Operador',fmt:function(r){ return esc(operNome(r.oper)); }},
  {k:'preco',rot:'Preço',num:1,fmt:function(r){ return reais(precoRg(r)); }}
];
function vRgs(){
  if(!S.rgs.length) return semDados('QRY0100');
  var D=S.D, lista=rgsFiltrados();
  var chip=function(v,rot,nn){ return '<button type="button" class="chip'+(S.fClassif===v?' active':'')+'" data-act="f-classif" data-c="'+esc(v)+'">'+esc(rot)+' · '+int(nn)+'</button>'; };
  return '<div class="panel"><div class="rgx-chips">'+chip('','Todos',D.abertos.length)+D.classif.map(function(o){ return chip(o.nome,o.nome,o.n); }).join('')+'</div>'+
    '<div class="filter-bar"><input type="text" id="fQ" placeholder="RG, item, EAN, descrição, local ou operador" value="'+esc(S.q)+'">'+
      '<select data-f="fOper">'+opt('','Todos os operadores',S.fOper)+D.ops.map(function(o){ return opt(o.oper,operNome(o.oper)+' · '+int(o.n),S.fOper); }).join('')+'</select>'+
      '<button class="btn btn-primary" data-act="exporta-rgs">Exportar Excel</button></div>'+
    '<div class="rgx-resumo"><span><b>'+int(lista.length)+'</b> RGs</span><span><b>'+reais(lista.reduce(function(s,r){ return s+precoRg(r); },0))+'</b></span></div>'+
    tabela('rgs',COLS_RG,lista,{rg:1})+'</div>';
}


/* ---------- Controle de locais mistos (histórico no Supabase: tabela rg_misto) ---------- */
function fxMis(d){ for(var i=0;i<MISTO_FX.length;i++) if(d>=MISTO_FX[i][0] && d<=MISTO_FX[i][1]) return i; return MISTO_FX.length-1; }
function lotes(a,n){ var o=[]; for(var i=0;i<a.length;i+=n) o.push(a.slice(i,i+n)); return o; }
function semTabelaMis(e){ return /rg_misto|does not exist|schema cache|relation/i.test((e&&e.message)||String(e||'')); }
function carregaMistos(){
  if(S.mistosBusy) return;
  var sb=window.rgSupa; if(!sb){ S.mistos=[]; return; }
  S.mistosBusy=true; S.mistosErro='';
  sb.from('rg_misto').select('*').order('desde',{ascending:true}).limit(20000).then(function(r){
    if(r.error) throw r.error;
    S.mistos=r.data||[];
    /* primeira vez: quem edita começa o histórico sozinho */
    if(!S.mistos.length && !leitura() && S.D && S.est && S.D.loc.misto>0 && !S.mistosAuto){
      S.mistosAuto=true;
      return registraMistos().then(function(){ S.mistos=null; });
    }
  }).catch(function(e){ S.mistos=[]; S.mistosErro=semTabelaMis(e) ? 'tabela' : ((e&&e.message)||''); })
    .then(function(){ S.mistosBusy=false; if(S.mistos==null){ carregaMistos(); return; } if(S.tab==='painel') render(); });
}
/* Compara os locais mistos de agora com os períodos já registrados: abre o que virou misto, fecha o que deixou de ser. */
function registraMistos(){
  var sb=window.rgSupa; if(!sb || leitura() || !S.D || !S.est) return Promise.resolve(null);
  var iso=function(t){ return new Date(t).toISOString(); }, agora=Date.now();
  var atuais=S.D.locais.filter(function(l){ return l.st==='misto' && !l.fora; });
  var chk=function(r){ if(r.error) throw r.error; return r; };
  return sb.from('rg_misto').select('id,local,visto_em,resolvido_em').order('id',{ascending:true}).limit(20000).then(function(r){
    chk(r);
    var todos=r.data||[], abertos=new Map(), ultimo=0;
    todos.forEach(function(x){ var v=Date.parse(x.visto_em)||0; if(v>ultimo) ultimo=v; if(!x.resolvido_em) abertos.set(x.local,x); });
    var primeira=!todos.length, cur=new Set(), novos=[], mantem=[], fecha=[];
    atuais.forEach(function(l){
      cur.add(l.local);
      var a=abertos.get(l.local);
      if(a){ mantem.push(a.id); return; }
      var est=l.estDias!=null ? hoje0()-l.estDias*864e5 : agora;
      var desde=primeira ? est : Math.min(agora, Math.max(est, ultimo||est));
      novos.push({ local:l.local, local_desc:l.localDesc||l.local, desde:iso(desde), origem:(l.estExata||!primeira)?'medido':'estimado', visto_em:iso(agora) });
    });
    abertos.forEach(function(a,loc){ if(!cur.has(loc)) fecha.push(a.id); });
    var seq=Promise.resolve();
    lotes(novos,300).forEach(function(c){ seq=seq.then(function(){ return sb.from('rg_misto').insert(c).then(chk); }); });
    lotes(mantem,150).forEach(function(c){ seq=seq.then(function(){ return sb.from('rg_misto').update({visto_em:iso(agora)}).in('id',c).then(chk); }); });
    lotes(fecha,150).forEach(function(c){ seq=seq.then(function(){ return sb.from('rg_misto').update({visto_em:iso(agora), resolvido_em:iso(agora)}).in('id',c).then(chk); }); });
    return seq.then(function(){ S.mistos=null; return { novos:novos.length, mantidos:mantem.length, resolvidos:fecha.length, primeira:primeira }; });
  });
}
/* Lista dos locais mistos de agora com o tempo de cada um: usa o histórico (rg_misto); onde ainda não há, usa a estimativa. */
function mistoLista(){
  var D=S.D, abertos=new Map(), agora=Date.now();
  (S.mistos||[]).forEach(function(x){ if(!x.resolvido_em) abertos.set(x.local,x); });
  return D.locais.filter(function(l){ return l.st==='misto' && !l.fora; }).map(function(l){
    var x=abertos.get(l.local), d, o;
    if(x){ d=Math.max(0,Math.floor((agora-Date.parse(x.desde))/864e5)); o=x.origem; }
    else { d=l.estDias; o=l.estExata?'medido':'estimado'; }
    return d==null ? null : { local:l.local, desc:l.localDesc||l.local, dias:d, origem:o, semRg:l.semRg, rgs:l.rgs, valorSem:l.valorSem||0 };
  }).filter(Boolean);
}
function resumoMisto(){
  var L=mistoLista(), f=MISTO_FX.map(function(){ return 0; }), soma=0, maior=null, est=false, vsem=0;
  L.forEach(function(r){ vsem+=r.valorSem||0; f[fxMis(r.dias)]++; soma+=r.dias; if(!maior || r.dias>maior.dias) maior=r; if(r.origem==='estimado') est=true; });
  return { lista:L, faixas:f, media:L.length?soma/L.length:0, maior:maior, est:est, vsem:vsem };
}
function misFiltrados(M){
  var q=norm(S.fMisQ), fx=S.fMisFx;
  return M.lista.slice().sort(function(a,b){ return b.dias-a.dias; }).filter(function(r){
    return (fx<0 || fxMis(r.dias)===fx) && (!q || norm(r.desc+' '+r.local).indexOf(q)>=0);
  });
}
/* painel da esquerda: régua de faixas, filtros, busca, Excel e lista com rolagem (cabem centenas de locais) */
function listaMisto(M){
  if(!M.lista.length) return '<div class="rgx-ok">Nenhum local misto</div>';
  var tot=M.lista.length, lista=misFiltrados(M);
  var reg='<div class="rgx-regua rgx-regua-fina">'+MISTO_FX.map(function(f,i){
    var v=M.faixas[i]; if(!v) return '';
    return '<button type="button" style="flex:'+Math.max(v/tot,0.03).toFixed(4)+';background:'+f[3]+'" data-act="mis-fx" data-i="'+i+'"'+tip(f[2],int(v)+' locais mistos',pct(v,tot))+'>'+(v/tot>=0.08?'<b>'+pct(v,tot,0)+'</b>':'')+'</button>';
  }).join('')+'</div>';
  var chip=function(i,rot,n){ return '<button type="button" class="chip'+(S.fMisFx===i?' active':'')+'" data-act="mis-fx" data-i="'+i+'">'+esc(rot)+' · '+int(n)+'</button>'; };
  var linhas=lista.map(function(r){
    var c=MISTO_FX[fxMis(r.dias)][3];
    return '<button type="button" class="rgx-ml" data-act="local" data-l="'+esc(r.local)+'"'+tip(r.desc,int(r.dias)+' dias em misto'+(r.origem==='estimado'?' (estimado)':''),int(r.semRg)+' un sem RG · '+int(r.rgs)+' RGs')+'><span>'+esc(r.desc)+'</span><b style="color:'+c+'">'+int(r.dias)+' d</b><em>'+(r.origem==='estimado'?'est.':'')+'</em></button>';
  }).join('') || '<div class="rgx-ok" style="padding:18px">Nenhum local encontrado</div>';
  return reg+
    '<div class="rgx-chips" style="margin-top:12px">'+chip(-1,'Todos',tot)+MISTO_FX.map(function(f,i){ return chip(i,f[2],M.faixas[i]); }).join('')+'</div>'+
    '<div class="filter-bar" style="margin-top:8px"><input type="text" id="misQ" placeholder="Buscar local" value="'+esc(S.fMisQ)+'"><button class="btn btn-primary" data-act="mis-xlsx">Baixar Excel</button></div>'+
    '<div class="rgx-ml-wrap"><div class="rgx-ml-cab"><span>Local</span><span>Tempo</span><span></span></div>'+linhas+'</div>'+
    '<div class="rgx-mt-nota">'+int(lista.length)+' de '+int(tot)+' locais · do mais antigo para o mais novo'+(M.est?' · "est." = data estimada':'')+'</div>';
}
/* painel da direita: quantos locais estavam mistos a cada importação (meta: zero) */
function evolucaoMisto(M){
  var pts=S.hist.filter(function(h){ return (h.mi!=null?h.mi:h.misto)!=null; }).slice(-40).map(function(h){ var v=h.mi!=null?h.mi:h.misto; return { l:dm(h.d), y:v, t:dataBR(h.d)+'\n'+int(v)+' locais mistos' }; });
  var kp='<div class="rgx-mk"><span>hoje<b>'+int(M.lista.length)+'</b></span><span>média<b>'+(M.lista.length?int(M.media)+' d':'—')+'</b></span><span>mais antigo<b>'+(M.maior?int(M.maior.dias)+' d':'—')+'</b></span><span>+ de 90 d<b style="color:#C83812">'+int(M.faixas[3])+'</b></span>'+(S.D.vu?'<span>sem RG nos mistos<b>'+reaisC(M.vsem)+'</b></span>':'')+'</div>';
  var graf=pts.length>1 ? lineChart(pts) : '<div class="rv-empty" style="padding:30px 10px">A linha da evolução aparece a partir da segunda importação.</div>';
  return graf+kp;
}

/* ---------- Produtividade (QRY0110 · movimentações de RG) ---------- */
var CORES_OP=['#FE5000','#001A72','#1F8A52','#E0A100','#7D93E8','#8E99A8','#C83812'];
var PAUSA=600000; /* intervalo maior que 10 min entre duas bipagens conta como pausa */
function mediana(a){ if(!a.length) return null; var b=a.slice().sort(function(x,y){ return x-y; }), m=Math.floor(b.length/2); return b.length%2?b[m]:(b[m-1]+b[m])/2; }
function rotPer(){ return rangePer().rot; }
function produtividade(){
  var RP=rangePer(), corte=RP.de, fim=addDias(RP.ate,1);
  var M=S.mov.filter(function(m){ return m.t>=corte && m.t<fim; });
  var R={ M:M, n:M.length };
  /* origem da triagem = origem mais usada */
  var co=new Map(); S.mov.forEach(function(m){ co.set(m.o,(co.get(m.o)||0)+1); });
  var tri=null, mx=0; co.forEach(function(v,k){ if(v>mx){ mx=v; tri=k; } });
  R.tri=tri; R.triDesc=''; S.mov.forEach(function(m){ if(m.o===tri && m.od) R.triDesc=m.od; });
  /* por pessoa e por dia */
  var ops=new Map(), diasM=new Map(), horas=new Array(24).fill(0);
  M.forEach(function(m){
    var o=ops.get(m.op); if(!o){ o={ op:m.op, n:0, valor:0, dias:new Map(), ativo:0 }; ops.set(m.op,o); }
    o.n++; if(S.D.vu) o.valor+=S.D.vu(m.item);
    var d=soDia(m.t), od=o.dias.get(d); if(!od){ od={ n:0, ts:[] }; o.dias.set(d,od); } od.n++; od.ts.push(m.t);
    var dd=diasM.get(d); if(!dd){ dd={ d:d, n:0, por:new Map() }; diasM.set(d,dd); } dd.n++; dd.por.set(m.op,(dd.por.get(m.op)||0)+1);
    horas[new Date(m.t).getHours()]++;
  });
  R.horas=horas;
  ops.forEach(function(o){
    o.melhor=0; o.melhorD=null;
    o.dias.forEach(function(v,d){
      v.ts.sort(function(a,b){ return a-b; });
      var at=0; for(var i=1;i<v.ts.length;i++){ var g=v.ts[i]-v.ts[i-1]; if(g<=PAUSA) at+=g; }
      v.ativo=Math.max(at,60000); o.ativo+=v.ativo;
      if(v.n>o.melhor){ o.melhor=v.n; o.melhorD=d; }
    });
    o.nd=o.dias.size; o.media=o.n/o.nd; o.porHora=o.n/(o.ativo/36e5);
  });
  R.ops=Array.from(ops.values()).sort(function(a,b){ return b.n-a.n; });
  R.valor=R.ops.reduce(function(t,o){ return t+o.valor; },0);
  R.diasL=Array.from(diasM.values()).sort(function(a,b){ return a.d-b.d; });
  R.nDias=R.diasL.length; R.media=R.nDias ? R.n/R.nDias : 0;
  var at=R.ops.reduce(function(t,o){ return t+o.ativo; },0); R.porHora=at ? R.n/(at/36e5) : 0;
  /* retrabalho: RG movido de novo depois de armazenado */
  var porRg=new Map(); M.forEach(function(m){ var l=porRg.get(m.rg); if(!l){ l=[]; porRg.set(m.rg,l); } l.push(m); });
  R.rgsDist=porRg.size; R.rgsRepet=0; porRg.forEach(function(l){ if(l.length>1) R.rgsRepet++; });
  R.fora=M.filter(function(m){ return m.o!==tri; });
  var rt=new Map(); M.forEach(function(m){ var o=rt.get(m.op)||{ op:m.op, n:0, rt:0 }; o.n++; if(m.o!==tri) o.rt++; rt.set(m.op,o); });
  R.rtOps=Array.from(rt.values()).filter(function(o){ return o.rt>0; }).sort(function(a,b){ return b.rt-a.rt; });
  var ro=new Map(); R.fora.forEach(function(m){ var k=m.od||m.o; ro.set(k,(ro.get(k)||0)+1); });
  R.rtOrig=Array.from(ro.entries()).sort(function(a,b){ return b[1]-a[1]; }).slice(0,6);
  /* locais mais movimentados (destino) */
  var dl=new Map(); M.forEach(function(m){ var k=m.dd||m.d, o=dl.get(k); if(!o){ o={ l:k, n:0 }; dl.set(k,o); } o.n++; });
  R.destinos=Array.from(dl.values()).sort(function(a,b){ return b.n-a.n; });
  /* fila da triagem e tempo até armazenar (cruza com a QRY0100) */
  var saiu=new Set(); S.mov.forEach(function(m){ if(m.o===tri) saiu.add(m.rg); });
  var fila=S.D.abertos.filter(function(r){ return r.local===tri && !saiu.has(r.rg); });
  R.fila=fila.length; R.filaIdade=[0,0,0,0];
  var maiorFila=null;
  fila.forEach(function(r){ var d=dias(r.dt); if(d==null) return; R.filaIdade[d<=1?0:d<=3?1:d<=7?2:3]++; if(!maiorFila || d>maiorFila) maiorFila=d; });
  R.filaMax=maiorFila;
  var lead=[]; var visto=new Set();
  S.mov.forEach(function(m){ if(m.o!==tri || visto.has(m.rg)) return; visto.add(m.rg); var r=S.D.rgMap.get(m.rg); if(r && r.dt && m.t>=corte) lead.push(Math.max(0,Math.round((soDia(m.t)-r.dt)/864e5))); });
  R.lead=lead; R.leadMed=mediana(lead); R.leadDist=[0,0,0,0,0];
  lead.forEach(function(d){ R.leadDist[d===0?0:d===1?1:d===2?2:d<=5?3:4]++; });
  R.ultima=S.mov.length ? S.mov[S.mov.length-1].t : null;
  return R;
}
/* Conferência: o que foi bipado no coletor aparece na QRY0110? (a transferência massiva foi feita no sistema?) */
function carregaColetor(){
  if(S.colBusy) return;
  var sb=window.rgSupa; if(!sb){ S.colMov=[]; return; }
  S.colBusy=true; S.colErro='';
  var corte=new Date(rangePer().de).toISOString();
  sb.from('rg_movimentacoes').select('rg,local_origem,local_destino,operador,criado_em').gte('criado_em',corte).order('criado_em',{ascending:false}).limit(20000).then(function(r){
    if(r.error) throw r.error;
    S.colMov=r.data||[];
  }).catch(function(e){ S.colMov=[]; S.colErro=(e&&e.message)||'Não consegui ler as bipagens do coletor.'; })
    .then(function(){ S.colBusy=false; if(S.tab==='prod') render(); });
}
function confereColetor(R){
  var rows=S.colMov||[], porRg=new Map();
  S.mov.forEach(function(m){ var l=porRg.get(m.rg); if(!l){ l=[]; porRg.set(m.rg,l); } l.push(m); });
  var limite=R.ultima ? R.ultima-2*36e5 : 0, C={ total:rows.length, ok:0, pend:[], aguarda:0, atrasos:[] };
  rows.forEach(function(c){
    var rg=String(c.rg||'').replace(/\D/g,''), ts=Date.parse(c.criado_em), dest=RG.localCodigo(c.local_destino);
    var ms=porRg.get(rg)||[], achou=null;
    for(var i=0;i<ms.length;i++){ if(ms[i].t>=ts-36e5 && RG.localCodigo(ms[i].d)===dest){ achou=ms[i]; break; } }
    if(achou){ C.ok++; C.atrasos.push((achou.t-ts)/6e4); }
    else if(ts<=limite) C.pend.push({ rg:rg, dest:c.local_destino, op:c.operador||'', ts:ts, h:(R.ultima-ts)/36e5 });
    else C.aguarda++;
  });
  C.pend.sort(function(a,b){ return a.ts-b.ts; });
  C.atrasoMed=mediana(C.atrasos);
  return C;
}
function pBarrasDia(R){
  if(!R.diasL.length) return '<div class="rgx-ok">Sem movimentações</div>';
  var max=Math.max.apply(null,R.diasL.map(function(d){ return d.n; }))||1;
  var cor=function(op){ var i=R.ops.findIndex(function(o){ return o.op===op; }); return CORES_OP[i%CORES_OP.length]; };
  return '<div class="rgx-pd">'+R.diasL.map(function(d){
    var segs=Array.from(d.por.entries()).sort(function(a,b){ return b[1]-a[1]; });
    return '<div class="rgx-pd-c"'+tip(dataBR(d.d),int(d.n)+' movimentações',segs.map(function(x){ return operNome(x[0])+': '+int(x[1]); }).join(' · '))+'><b>'+int(d.n)+'</b><div class="rgx-pd-b" style="height:'+(d.n/max*100).toFixed(1)+'%">'+segs.map(function(x){ return '<i style="flex:'+x[1]+';background:'+cor(x[0])+'"></i>'; }).join('')+'</div><span>'+dm(d.d)+'</span></div>';
  }).join('')+'</div><div class="cmp-legend" style="margin-top:10px;flex-wrap:wrap">'+R.ops.slice(0,6).map(function(o,i){ return '<span><span class="cmp-dot" style="background:'+CORES_OP[i%CORES_OP.length]+'"></span>'+esc(operNome(o.op))+'</span>'; }).join('')+'</div>';
}
function pBarrasHora(R){
  var ini=6, fim=20, max=Math.max.apply(null,R.horas)||1;
  var pico=R.horas.indexOf(max);
  var h='<div class="rgx-ph">';
  for(var i=ini;i<=fim;i++) h+='<div class="rgx-ph-c"'+tip(d2(i)+'h',int(R.horas[i])+' movimentações')+'><b>'+(R.horas[i]?int(R.horas[i]):'')+'</b><div class="rgx-ph-b"><i style="height:'+(R.horas[i]/max*100).toFixed(1)+'%;'+(i===pico?'background:#FE5000':'')+'"></i></div><span>'+d2(i)+'</span></div>';
  return h+'</div>';
}
/* ---------- Filtros de período, comparação e ociosidade (criação de RG e movimentação) ---------- */
var WORK_H=[8,9,10,11,14,15,16,17]; /* horas de trabalho: 8h–12h e 14h–18h */
var DIAS_SEM=['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
var MESES=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
function addDias(t,n){ var d=new Date(t); return new Date(d.getFullYear(),d.getMonth(),d.getDate()+n).getTime(); }
function isoDia(t){ var d=new Date(t); return d.getFullYear()+'-'+d2(d.getMonth()+1)+'-'+d2(d.getDate()); }
function deIso(v){ var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v||''); return m ? new Date(+m[1],+m[2]-1,+m[3]).getTime() : null; }
function rangePer(){
  var h=hoje0(), a=S.pAt, d=new Date(h), de, ate=h, rot;
  if(a==='hoje'){ de=h; rot='Hoje'; }
  else if(a==='ontem'){ de=ate=addDias(h,-1); rot='Ontem'; }
  else if(a==='7d'){ de=addDias(h,-6); rot='Últimos 7 dias'; }
  else if(a==='mes'){ de=new Date(d.getFullYear(),d.getMonth(),1).getTime(); rot='Este mês'; }
  else if(a==='mesant'){ de=new Date(d.getFullYear(),d.getMonth()-1,1).getTime(); ate=new Date(d.getFullYear(),d.getMonth(),0).getTime(); rot='Mês passado'; }
  else if(a==='ano'){ de=new Date(d.getFullYear(),0,1).getTime(); rot='Este ano'; }
  else if(a==='tudo'){ de=0; rot='Todo o período'; }
  else if(a==='custom'){ de=deIso(S.pDe)||addDias(h,-29); ate=deIso(S.pAte)||h; if(ate<de){ var x=de; de=ate; ate=x; } rot=dataBR(de)+' a '+dataBR(ate); }
  else { de=addDias(h,-29); rot='Últimos 30 dias'; }
  var n=de? Math.round((ate-de)/864e5)+1 : 0, ad=null, aa=null;
  if(de){
    if(a==='mes'){ ad=new Date(d.getFullYear(),d.getMonth()-1,1).getTime(); aa=Math.min(new Date(d.getFullYear(),d.getMonth(),0).getTime(), addDias(ad,n-1)); }
    else if(a==='ano'){ ad=new Date(d.getFullYear()-1,0,1).getTime(); aa=addDias(ad,n-1); }
    else { aa=addDias(de,-1); ad=addDias(aa,-(n-1)); }
  }
  return { de:de, ate:ate, ad:ad, aa:aa, n:n, rot:rot };
}
function grupoIni(t,g){
  var d=new Date(t);
  if(g==='ano') return new Date(d.getFullYear(),0,1).getTime();
  if(g==='mes') return new Date(d.getFullYear(),d.getMonth(),1).getTime();
  if(g==='semana') return new Date(d.getFullYear(),d.getMonth(),d.getDate()-((d.getDay()+6)%7)).getTime();
  return soDia(t);
}
function grupoProx(t,g){ var d=new Date(t); return g==='ano' ? new Date(d.getFullYear()+1,0,1).getTime() : g==='mes' ? new Date(d.getFullYear(),d.getMonth()+1,1).getTime() : g==='semana' ? addDias(t,7) : addDias(t,1); }
function grupoRot(k,g){ var d=new Date(k); return g==='ano' ? ''+d.getFullYear() : g==='mes' ? MESES[d.getMonth()]+'/'+String(d.getFullYear()).slice(2) : g==='semana' ? 'sem '+dm(k) : dm(k); }
function grupoNome(g){ return {dia:'dia',semana:'semana',mes:'mês',ano:'ano'}[g]||'dia'; }
/* itens: [{ t: dia (ms), h: hora|null, op }] → mapa dia → { n, hrs[24], semH, ops } */
function itensRg(){ return S.D.rgs.filter(function(r){ return r.dt; }).map(function(r){ return { t:r.dt, h:r.h==null?null:r.h, op:r.oper||'' }; }); }
function itensMov(){ return S.mov.map(function(m){ return { t:soDia(m.t), h:new Date(m.t).getHours(), op:m.op||'' }; }); }
function agrupaDia(itens){
  var mp=new Map();
  itens.forEach(function(it){
    var o=mp.get(it.t); if(!o){ o={ d:it.t, n:0, hrs:new Array(24).fill(0), semH:0, ops:new Map() }; mp.set(it.t,o); }
    o.n++; if(it.h==null) o.semH++; else o.hrs[it.h]++;
    var k=it.op||''; var po=o.ops.get(k); if(!po){ po={ op:k, n:0, hrs:new Array(24).fill(0) }; o.ops.set(k,po); } po.n++; if(it.h!=null) po.hrs[it.h]++;
  });
  return mp;
}
function totalEm(itens,de,ate){ var f=addDias(ate,1), n=0; itens.forEach(function(it){ if(it.t>=de && it.t<f) n++; }); return n; }
function seriePorGrupo(itens,r,g){
  var cont=new Map(), f=addDias(r.ate,1);
  itens.forEach(function(it){ if(it.t<r.de || it.t>=f) return; var k=grupoIni(it.t,g); cont.set(k,(cont.get(k)||0)+1); });
  var ini=r.de? grupoIni(r.de,g) : (cont.size?Math.min.apply(null,Array.from(cont.keys())):null);
  if(ini==null) return [];
  var out=[], k=ini, lim=grupoIni(r.ate,g), guard=0;
  while(k<=lim && guard++<4000){
    var d=new Date(k), util=(g!=='dia') || (d.getDay()>0 && d.getDay()<6);
    if(cont.has(k) || util) out.push({ k:k, n:cont.get(k)||0 });
    k=grupoProx(k,g);
  }
  return out;
}
function deltaTxt(a,b,rot){
  if(b==null || !b) return '<span class="rgx-dl">sem base de comparação</span>';
  var p=(a-b)/b*100, up=p>=0;
  return '<span class="rgx-dl '+(up?'up':'dn')+'">'+(up?'▲ ':'▼ ')+pct(Math.abs(a-b),b,0)+(up?' acima':' abaixo')+' · '+esc(rot)+' ('+int(b)+')</span>';
}
/* análise de um dia: horas sem produção, capacidade usada, comparação e equipe */
function analiseDia(mp,dia,fim){
  var cur=mp.get(dia)||{ d:dia, n:0, hrs:new Array(24).fill(0), semH:0, ops:new Map() };
  var dias=Array.from(mp.values());
  var ant=dias.filter(function(x){ return x.d<dia && x.n>0; }).sort(function(a,b){ return b.d-a.d; })[0]||null;
  var dow=new Date(dia).getDay(), lim=addDias(dia,-30);
  var mesmos=dias.filter(function(x){ return x.d<dia && x.d>=lim && new Date(x.d).getDay()===dow && x.n>0; });
  var melhor=dias.filter(function(x){ return x.d!==dia; }).sort(function(a,b){ return b.n-a.n; })[0]||null;
  var A={ cur:cur, ant:ant, mesmos:mesmos, melhor:melhor };
  A.baseAnt=ant?ant.n:null;
  A.baseMedia=mesmos.length ? mesmos.reduce(function(t,x){ return t+x.n; },0)/mesmos.length : null;
  A.baseMelhor=melhor?melhor.n:null;
  var hrsMedia=new Array(24).fill(0); mesmos.forEach(function(x){ for(var i=0;i<24;i++) hrsMedia[i]+=x.hrs[i]/mesmos.length; });
  A.hrsBase = S.pCmp==='ant' ? (ant?ant.hrs:null) : S.pCmp==='melhor' ? (melhor?melhor.hrs:null) : (mesmos.length?hrsMedia:null);
  A.base = S.pCmp==='ant' ? A.baseAnt : S.pCmp==='melhor' ? A.baseMelhor : A.baseMedia;
  A.baseRot = S.pCmp==='ant' ? 'dia anterior' : S.pCmp==='melhor' ? 'melhor dia' : 'média de '+DIAS_SEM[dow]+'s';
  var agora=new Date(), eHoje=dia===hoje0();
  /* horas depois do último registro importado não contam como paradas (os dados ainda não chegaram) */
  var ate=23; if(eHoje) ate=Math.min(ate,agora.getHours()); if(fim && fim.dia===dia) ate=Math.min(ate,fim.hora);
  A.ate=ate; A.parcial=ate<17;
  A.horas=WORK_H.filter(function(h){ return h<=ate; });
  A.paradas=A.horas.filter(function(h){ return cur.hrs[h]===0; });
  A.ativas=WORK_H.filter(function(h){ return cur.hrs[h]>0; }).length;
  A.porHora=A.ativas ? (cur.n-cur.semH)/A.ativas : 0;
  A.cap=A.baseMelhor ? cur.n/Math.max(A.baseMelhor,cur.n) : null;
  A.semHora = cur.n>0 && cur.semH===cur.n;
  /* equipe */
  A.equipe=Array.from(cur.ops.values()).map(function(po){
    var outros=dias.filter(function(x){ return x.d!==dia && x.d>=lim && x.ops.has(po.op) && x.ops.get(po.op).n>0; });
    var media=outros.length ? outros.reduce(function(t,x){ return t+x.ops.get(po.op).n; },0)/outros.length : null;
    var at=WORK_H.filter(function(h){ return po.hrs[h]>0; }).length;
    return { op:po.op, n:po.n, ativas:at, porHora:at?po.n/at:0, media:media };
  }).sort(function(a,b){ return b.n-a.n; });
  return A;
}
function pHorasGraf(A){
  var cur=A.cur, mx=Math.max(1,Math.max.apply(null,cur.hrs), A.hrsBase?Math.max.apply(null,A.hrsBase.slice(6,20)):0);
  var pico=Math.max.apply(null,WORK_H.map(function(h){ return cur.hrs[h]; })), h='<div class="rgx-ph rgx-ph-g">';
  for(var i=7;i<=18;i++){
    var trab=WORK_H.indexOf(i)>=0, v=cur.hrs[i], parada=trab && A.horas.indexOf(i)>=0 && v===0, base=A.hrsBase?A.hrsBase[i]:null;
    h+='<div class="rgx-ph-c'+(parada?' par':'')+'"'+tip(d2(i)+'h',int(v)+(v===1?' registro':' registros'),trab?(parada?'Hora parada':'Hora de trabalho'):'Fora do horário',base!=null?'Referência: '+int(Math.round(base)):'')+'><b>'+(trab?int(v):(v?int(v):''))+'</b><div class="rgx-ph-b"><i style="height:'+(parada?100:(v/mx*100)).toFixed(1)+'%;'+(!trab?'background:#dfe3ee;':(v===pico && v>0)?'background:#FE5000;':'')+'"></i>'+(base!=null && trab?'<u style="bottom:'+(base/mx*100).toFixed(1)+'%"></u>':'')+'</div><span>'+d2(i)+'</span></div>';
  }
  return h+'</div><div class="cmp-legend" style="margin-top:10px;flex-wrap:wrap"><span><span class="cmp-dot" style="background:#7D93E8"></span>Produziu</span><span><span class="cmp-dot" style="background:#FE5000"></span>Pico</span><span><span class="cmp-dot" style="background:#f3c2b5"></span>Hora parada</span>'+(A.hrsBase?'<span><span class="dx-meta-leg" style="border-color:#001A72"></span>'+esc(A.baseRot)+'</span>':'')+'</div>';
}
function pCalor(mp,ser){
  var dias=Array.from(mp.values()).filter(function(x){ return x.n>0; }).sort(function(a,b){ return b.d-a.d; }).slice(0,10).reverse();
  if(!dias.length) return '<div class="rgx-ok">Sem dados</div>';
  var mx=1; dias.forEach(function(d){ WORK_H.forEach(function(h){ if(d.hrs[h]>mx) mx=d.hrs[h]; }); });
  var t='<div class="rgx-tb-wrap" style="border:0"><table class="rgx-hm"><tr><th></th>'+dias.map(function(d){ return '<th>'+dm(d.d)+'<br><em>'+DIAS_SEM[new Date(d.d).getDay()].slice(0,3)+'</em></th>'; }).join('')+'</tr>';
  for(var h=7;h<=18;h++){
    var trab=WORK_H.indexOf(h)>=0;
    t+='<tr><td class="l">'+d2(h)+'h</td>'+dias.map(function(d){
      var v=d.hrs[h];
      if(!trab) return '<td class="z"'+tip(dataBR(d.d)+' · '+d2(h)+'h',int(v)+' registros')+'>'+(v?int(v):'')+'</td>';
      if(!v) return '<td class="p"'+tip(dataBR(d.d)+' · '+d2(h)+'h','Hora parada')+'>0</td>';
      return '<td style="background:rgba(0,26,114,'+Math.min(1,.2+v/mx*.8).toFixed(2)+')"'+tip(dataBR(d.d)+' · '+d2(h)+'h',int(v)+' registros')+'>'+int(v)+'</td>';
    }).join('')+'</tr>';
  }
  return t+'</table></div>';
}
/* tudo da parte "Ociosidade" e "Tendência" da aba Produtividade */
function blocoOciosidade(){
  var RP=rangePer(), g=S.pGrp, ser=S.pSer;
  var itR=S.D.rgs.length?itensRg():[], itM=itensMov(), temH=itR.some(function(x){ return x.h!=null; });
  var itens=ser==='rg' ? itR : itM, mp=agrupaDia(itens);
  var ultimo=Array.from(mp.keys()).sort(function(a,b){ return b-a; })[0];
  var dia = S.pDia!=null ? S.pDia : (ultimo!=null ? ultimo : hoje0());
  var fim=null;
  if(ser==='mov' && S.mov.length){ var lm=S.mov[S.mov.length-1].t; fim={ dia:soDia(lm), hora:new Date(lm).getHours() }; }
  else if(ser==='rg' && itR.length){ var ld=Math.max.apply(null,itR.map(function(x){ return x.t; })); var hs=itR.filter(function(x){ return x.t===ld && x.h!=null; }).map(function(x){ return x.h; }); fim={ dia:ld, hora:hs.length?Math.max.apply(null,hs):23 }; }
  var A=analiseDia(mp,dia,fim), nome=ser==='rg'?'RGs criados':'Movimentações';
  var btn=function(act,att,v,rot,on){ return '<button type="button" class="pl'+(on?' on':'')+'" data-act="'+act+'" data-'+att+'="'+v+'">'+rot+'</button>'; };
  var PRE=[['hoje','Hoje'],['ontem','Ontem'],['7d','7 dias'],['30d','30 dias'],['mes','Este mês'],['mesant','Mês passado'],['ano','Este ano'],['tudo','Tudo'],['custom','De–até']];
  var barra='<div class="rgx-pbar"><div class="rgx-pl"><span class="lb">Período</span>'+PRE.map(function(x){ return btn('p-at','v',x[0],x[1],S.pAt===x[0]); }).join('')+
    (S.pAt==='custom'?'<input type="date" id="pDe" value="'+isoDia(RP.de)+'"><input type="date" id="pAte" value="'+isoDia(RP.ate)+'">':'')+'</div>'+
    '<div class="rgx-pl"><span class="lb">Agrupar</span>'+[['dia','Dia'],['semana','Semana'],['mes','Mês'],['ano','Ano']].map(function(x){ return btn('p-grp','v',x[0],x[1],g===x[0]); }).join('')+
    '<span class="lb" style="margin-left:14px">Comparar o dia com</span>'+[['ant','Dia anterior'],['media','Média do dia da semana'],['melhor','Melhor dia']].map(function(x){ return btn('p-cmp','v',x[0],x[1],S.pCmp===x[0]); }).join('')+'</div></div>';
  /* --- dia analisado --- */
  var seletor='<div class="rgx-pl" style="margin:0 0 12px"><span class="lb">Dia analisado</span><button type="button" class="pl" data-act="p-dia" data-d="-1">◀</button><input type="date" id="pDia" value="'+isoDia(dia)+'"><button type="button" class="pl" data-act="p-dia" data-d="1">▶</button>'+
    '<span class="rgx-dnome">'+DIAS_SEM[new Date(dia).getDay()]+', '+dataBR(dia)+'</span><span class="lb" style="margin-left:14px">Ver</span>'+btn('p-ser','v','rg','Criação de RG',ser==='rg')+btn('p-ser','v','mov','Movimentação',ser==='mov')+'</div>';
  var semHora = ser==='rg' && !temH;
  var parTxt=semHora ? '—' : int(A.paradas.length)+' de '+int(A.horas.length);
  var tilesDia='<div class="rv-faixa">'+
    tile(nome+' no dia', int(A.cur.n), '', '')+
    tile('Comparação', A.base!=null?(A.cur.n>=A.base?'▲ ':'▼ ')+pct(Math.abs(A.cur.n-A.base),A.base,0):'—', A.base!=null?esc(A.baseRot)+' ('+int(A.base)+')':'sem base de comparação', A.base==null?'':(A.cur.n>=A.base?'good':'bad'))+
    tile('Horas sem produção', parTxt, semHora?'reimporte a QRY0100 para ver a hora':(A.horas.length?pct(A.paradas.length,A.horas.length,0)+' do horário parado':'—'), !semHora && A.paradas.length?'bad':'good', 'Horário de trabalho: 8h–12h e 14h–18h')+
    tile('Capacidade usada', A.cap!=null?pct(A.cur.n,Math.max(A.baseMelhor||0,A.cur.n),0):'—', A.baseMelhor?'do melhor dia ('+int(A.baseMelhor)+')':'sem base', '')+
    tile('Por hora trabalhada', semHora?'—':int(A.porHora), 'nas horas em que produziu', '')+
    tile('Fila da triagem', int(S._filaAtual||0), 'esperando armazenar', S._filaAtual?'blue':'good', 'RGs criados que ainda estão na triagem')+
    '</div>';
  var graf = semHora ? '<div class="rv-aviso"><strong>Hora do RG:</strong> a QRY0100 já importada não guardou a hora da criação. Importe a QRY0100 de novo (ela atualiza os RGs) para ver por hora.</div>' : (A.cur.n? pHorasGraf(A) : '<div class="rgx-ok">Nenhum registro neste dia</div>');
  var temOp=A.equipe.some(function(e){ return e.op; });
  var equipe;
  if(!A.equipe.length) equipe='<div class="rgx-ok">Ninguém registrou neste dia</div>';
  else if(!temOp) equipe='<div class="rv-aviso"><strong>Sem operador:</strong> a QRY0100 não traz quem criou cada RG. Veja quem moveu na opção "Movimentação".</div>';
  else equipe='<div class="rgx-tb-wrap"><table class="rgx-tb"><thead><tr><th>Pessoa</th><th class="rgx-num">'+(ser==='rg'?'RGs':'Mov.')+'</th><th class="rgx-num">Horas ativas</th><th class="rgx-num">Por hora</th><th class="rgx-num">vs própria média</th></tr></thead><tbody>'+
    A.equipe.map(function(e){ var d=e.media?(e.n-e.media)/e.media:null; return '<tr><td><b>'+esc(operNome(e.op))+'</b></td><td class="rgx-num">'+int(e.n)+'</td><td class="rgx-num">'+int(e.ativas)+' h</td><td class="rgx-num">'+int(e.porHora)+'</td><td class="rgx-num '+(d==null?'':d>=0?'rgx-up':'rgx-dn')+'" style="font-weight:800">'+(d==null?'—':(d>=0?'▲ ':'▼ ')+Math.abs(Math.round(d*100))+'%')+'</td></tr>'; }).join('')+'</tbody></table></div>';
  var h3=function(tit){ return '<div class="dx-panel-h"><h3>'+tit+'</h3></div>'; };
  var diaHtml='<div class="panel" style="margin-top:14px">'+h3('Ociosidade do dia · '+nome.toLowerCase())+seletor+tilesDia+
    (A.parcial && A.cur.n ? '<div class="rgx-mt-nota" style="margin-top:8px">Dia incompleto: os dados vão até as '+d2(A.ate)+'h. As horas depois disso não contam como paradas e a comparação é do dia inteiro.</div>' : '')+
    '<div class="rgx-g rgx-g-d" style="margin-top:14px"><div class="panel" style="box-shadow:none;border:1px solid var(--line)">'+h3('Por hora')+graf+'</div><div class="panel" style="box-shadow:none;border:1px solid var(--line)">'+h3('Equipe no dia')+equipe+'<div class="rgx-mt-nota" style="margin-top:8px">Parado com fila grande = ociosidade de verdade. Parado sem fila = falta de serviço.</div></div></div></div>';
  /* --- tendência no período --- */
  var tend=function(itens,rot,cor){
    var sr=seriePorGrupo(itens,RP,g), tot=sr.reduce(function(t,x){ return t+x.n; },0);
    var ant=(RP.ad!=null)?totalEm(itens,RP.ad,RP.aa):null;
    var pts=sr.map(function(x){ return { l:grupoRot(x.k,g), y:x.n, t:grupoRot(x.k,g)+'\n'+int(x.n)+' '+rot.toLowerCase() }; });
    return { tot:tot, ant:ant, sr:sr, graf:barChart(pts,cor), dias:RP.n||sr.length };
  };
  var TR=tend(itR,'RGs criados'), TM=tend(itM,'Movimentações');
  var dias=function(T){ return T.sr.length?T.tot/Math.max(1,(g==='dia'?T.sr.length:(RP.n||T.sr.length))):0; };
  var tilesTend='<div class="rv-faixa" style="margin-top:14px">'+
    tile('RGs criados', int(TR.tot), RP.rot, '')+
    tile('Criação vs período anterior', TR.ant?((TR.tot>=TR.ant?'▲ ':'▼ ')+pct(Math.abs(TR.tot-TR.ant),TR.ant,0)):'—', TR.ant!=null?'antes: '+int(TR.ant):'sem período anterior', TR.ant?(TR.tot>=TR.ant?'good':'bad'):'')+
    tile('Movimentações', int(TM.tot), RP.rot, '')+
    tile('Movimentação vs período anterior', TM.ant?((TM.tot>=TM.ant?'▲ ':'▼ ')+pct(Math.abs(TM.tot-TM.ant),TM.ant,0)):'—', TM.ant!=null?'antes: '+int(TM.ant):'sem período anterior', TM.ant?(TM.tot>=TM.ant?'good':'bad'):'')+
    '</div>';
  var tendHtml=tilesTend+'<div class="rgx-g rgx-g-d" style="margin-top:14px"><div class="panel">'+h3('RGs criados por '+grupoNome(g))+(TR.sr.length?TR.graf:'<div class="rgx-ok">Sem RGs no período</div>')+'</div><div class="panel">'+h3('Movimentações por '+grupoNome(g))+(TM.sr.length?TM.graf:'<div class="rgx-ok">Sem movimentações no período</div>')+'</div></div>';
  var calor='<div class="panel" style="margin-top:14px">'+h3('Mapa de calor · horas × dias · '+nome.toLowerCase())+(semHora?'<div class="rv-aviso"><strong>Hora do RG:</strong> importe a QRY0100 de novo para ver a criação por hora.</div>':pCalor(mp,ser))+'</div>';
  return barra+diaHtml+tendHtml+calor;
}

function vProd(){
  if(!S.mov.length) return '<div class="panel rgx-vazio"><div class="rgx-vazio-ic">🔀</div><h3>'+(leitura()?'Ainda não há movimentações importadas':'Falta importar a QRY0110')+'</h3><button class="btn btn-orange so-editor" data-act="tab" data-tab="importacao">Importar relatórios</button></div>';
  if(!S.est && !S.rgs.length) return semDados('a QRY0100 e a QRY0390');
  if(S.colMov==null && !S.colBusy) setTimeout(carregaColetor,0);
  var R=produtividade(), C=confereColetor(R);
  S._filaAtual=R.fila;
  var h3=function(tit,extra){ return '<div class="dx-panel-h"><h3>'+tit+'</h3>'+(extra||'')+'</div>'; };
  var tiles='<div class="rv-faixa">'+
    tile('Movimentações', int(R.n), rotPer(), '')+
    tile('Média por dia', int(R.media), int(R.nDias)+' dias com movimento', '')+
    tile('RGs por hora', int(R.porHora), 'só horas bipando', '')+
    tile('Na fila da triagem', int(R.fila), R.filaMax!=null?'mais antigo '+int(R.filaMax)+' d':'sem fila', R.fila?'blue':'good')+
    tile('Até armazenar', R.leadMed!=null?int(R.leadMed)+' d':'—', 'mediana desde a criação do RG', '')+
    (S.D.vu ? tile('Valor movimentado', reaisC(R.valor), 'custo dos RGs movidos', '')+
    '' : '')+
    tile('Retrabalho', pct(R.fora.length,R.n), int(R.fora.length)+' mov. fora da triagem', R.fora.length?'bad':'good')+
    '</div>';
  var rank=tabela('pRank',[
    {k:'op',rot:'Operador',fmt:function(r){ return '<b>'+esc(operNome(r.op))+'</b>'; },val:function(r){ return operNome(r.op); }},
    {k:'n',rot:'Movimentações',num:true,fmt:function(r){ return int(r.n); }},
    {k:'nd',rot:'Dias',num:true,fmt:function(r){ return int(r.nd); }},
    {k:'media',rot:'Média/dia',num:true,fmt:function(r){ return int(r.media); }},
    {k:'porHora',rot:'RGs/hora',num:true,fmt:function(r){ return int(r.porHora); }},
    {k:'melhor',rot:'Melhor dia',num:true,fmt:function(r){ return int(r.melhor)+(r.melhorD?' · '+dm(r.melhorD):''); }}
  ].concat(S.D.vu?[{k:'valor',rot:'Valor movimentado',num:true,fmt:function(r){ return reaisC(r.valor); }}]:[]),R.ops);
  var filaTxt=['até 1 d','2–3 d','4–7 d','+ de 7 d'], filaCor=['#1F8A52','#E0A100','#FE5000','#C83812'];
  var filaMax=Math.max.apply(null,R.filaIdade)||1;
  var fila='<div class="rgx-fl">'+R.filaIdade.map(function(v,i){ return '<div class="rgx-fl-c"'+tip(filaTxt[i],int(v)+' RGs esperando')+'><b>'+int(v)+'</b><div class="rgx-fl-b"><i style="height:'+(v/filaMax*100).toFixed(1)+'%;background:'+filaCor[i]+'"></i></div><span>'+filaTxt[i]+'</span></div>'; }).join('')+'</div>'+
    '<div class="rgx-mt-nota">RGs criados que ainda estão em '+esc(R.triDesc||'triagem')+' · idade desde a criação do RG</div>';
  var leadTxt=['mesmo dia','1 dia','2 dias','3–5 dias','+ de 5 d'], leadMax=Math.max.apply(null,R.leadDist)||1;
  var lead=R.lead.length ? '<div class="rgx-fl">'+R.leadDist.map(function(v,i){ return '<div class="rgx-fl-c"'+tip(leadTxt[i],int(v)+' RGs')+'><b>'+int(v)+'</b><div class="rgx-fl-b"><i style="height:'+(v/leadMax*100).toFixed(1)+'%;background:'+(i<3?'#1F8A52':i===3?'#E0A100':'#C83812')+'"></i></div><span>'+leadTxt[i]+'</span></div>'; }).join('')+'</div><div class="rgx-mt-nota">Tempo entre criar o RG e armazená-lo · '+int(R.lead.length)+' RGs</div>' : '<div class="rgx-ok">Sem RGs da QRY0100 nas movimentações</div>';
  var retr='<div class="rgx-mk" style="margin:0 0 12px"><span>RGs movidos mais de 1 vez<b>'+int(R.rgsRepet)+'</b></span><span>de '+int(R.rgsDist)+' RGs<b>'+pct(R.rgsRepet,R.rgsDist)+'</b></span><span>mov. fora da triagem<b>'+int(R.fora.length)+'</b></span></div>'+
    (R.rtOps.length ? hbars(R.rtOps.slice(0,6).map(function(o){ return { l:operNome(o.op), v:o.rt, txt:int(o.rt)+' · '+pct(o.rt,o.n,0), t:operNome(o.op)+'\n'+int(o.rt)+' de '+int(o.n)+' movimentações foram de RG já armazenado', cor:'linear-gradient(90deg,#C83812,#FE8A5C)' }; })) : '<div class="rgx-ok">Nenhum retrabalho no período</div>')+
    (R.rtOrig.length ? '<div class="rgx-mt-nota" style="margin-top:10px">Mais saem de: '+R.rtOrig.slice(0,4).map(function(x){ return esc(x[0])+' ('+int(x[1])+')'; }).join(' · ')+'</div>' : '');
  var dest=hbars(R.destinos.slice(0,10).map(function(o){ return { l:o.l, v:o.n, txt:int(o.n)+' · '+pct(o.n,R.n,0), t:o.l+'\n'+int(o.n)+' RGs recebidos ('+pct(o.n,R.n)+')' }; }),{cor:'linear-gradient(90deg,#001A72,#4A63C8)'});
  var conf;
  if(S.colErro) conf='<div class="rv-aviso"><strong>Erro:</strong> '+esc(S.colErro)+'</div>';
  else if(S.colMov==null) conf='<div class="rv-empty">Carregando as bipagens do coletor…</div>';
  else if(!C.total) conf='<div class="rgx-ok">Nenhuma bipagem do coletor no período</div>';
  else {
    var julg=C.ok+C.pend.length;
    conf='<div class="rgx-mk" style="margin:0 0 12px"><span>Bipados no coletor<b>'+int(C.total)+'</b></span><span>Aparecem na QRY0110<b style="color:#1F8A52">'+int(C.ok)+'</b></span><span>Não aparecem<b style="color:'+(C.pend.length?'#C83812':'#1F8A52')+'">'+int(C.pend.length)+'</b></span><span>Ainda sem como conferir<b>'+int(C.aguarda)+'</b></span>'+(C.atrasoMed!=null?'<span>Tempo até o sistema<b>'+(C.atrasoMed<90?int(C.atrasoMed)+' min':int(C.atrasoMed/60)+' h')+'</b></span>':'')+'</div>'+
      (C.pend.length ? '<div class="filter-bar" style="margin-bottom:8px"><button class="btn btn-primary" data-act="cf-xlsx">Baixar Excel</button></div>'+tabela('pPend',[
        {k:'rg',rot:'RG',fmt:function(r){ return '<span class="rgx-mono">'+esc(r.rg)+'</span>'; }},
        {k:'dest',rot:'Destino bipado',fmt:function(r){ return esc(r.dest); }},
        {k:'op',rot:'Operador',fmt:function(r){ return esc(operNome(r.op)); }},
        {k:'ts',rot:'Bipado em',num:true,fmt:function(r){ return dataHoraBR(r.ts); }},
        {k:'h',rot:'Parado há',num:true,fmt:function(r){ return r.h<48?int(r.h)+' h':int(r.h/24)+' d'; }}
      ],C.pend) : '<div class="rgx-ok">Tudo o que foi bipado já aparece na QRY0110</div>')+
      '<div class="rgx-mt-nota">Só conta bipagem anterior ao último movimento importado ('+dataHoraBR(R.ultima)+'). Importe a QRY0110 de novo para conferir as mais novas.</div>';
  }
  return '<div class="rgx-mt-nota" style="margin:0 0 4px">Movimentações até '+dataHoraBR(R.ultima)+' · período: <b>'+esc(rotPer())+'</b></div>'+blocoOciosidade()+tiles+
    '<div class="rgx-g rgx-g-d"><div class="panel">'+h3('Movimentações por dia')+pBarrasDia(R)+'</div><div class="panel">'+h3('Horário de pico')+pBarrasHora(R)+'</div></div>'+
    '<div class="panel" style="margin-top:14px">'+h3('Ranking da equipe')+rank+'</div>'+
    '<div class="rgx-g rgx-g-d" style="margin-top:14px"><div class="panel">'+h3('Fila da triagem')+fila+'</div><div class="panel">'+h3('Do RG criado até armazenado')+lead+'</div></div>'+
    '<div class="rgx-g rgx-g-d"><div class="panel">'+h3('Retrabalho')+retr+'</div><div class="panel">'+h3('Locais mais movimentados')+dest+'</div></div>'+
    '<div class="panel" style="margin-top:14px">'+h3('Conferência com o coletor')+conf+'</div>';
}

/* ---------- painel lateral do local ---------- */
function abrePainel(local){
  var D=S.D, l=D.locais.filter(function(x){ return x.local===local; })[0]; if(!l) return;
  var itens=D.cov.filter(function(c){ return c.local===local; }).sort(function(a,b){ return b.semRg-a.semRg || b.saldo-a.saldo; });
  var st={rg:['100% RG','tag-good'],misto:['Misto','tag-orange'],sem:['Sem RG','tag-blue']}[l.st];
  var c=2*Math.PI*34, p=Math.max(0,Math.min(1,l.p));
  var h='<div class="rgx-pn-cab"><div><small>'+esc(classeNome(l.classe))+'</small><strong>'+esc(l.localDesc)+'</strong><span class="tag '+st[1]+'">'+st[0]+'</span></div><button type="button" data-act="fecha-painel" aria-label="Fechar">×</button></div>'+
    '<div class="rgx-pn-top"><svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="34" fill="none" stroke="var(--surface2)" stroke-width="9"/><circle cx="42" cy="42" r="34" fill="none" stroke="#FE5000" stroke-width="9" stroke-linecap="round" transform="rotate(-90 42 42)" stroke-dasharray="'+c.toFixed(1)+'" stroke-dashoffset="'+(c*(1-p)).toFixed(1)+'"/><text x="42" y="47" text-anchor="middle">'+pct(l.comRg,l.saldo)+'</text></svg>'+
    '<div class="rgx-pn-kp"><div><b>'+int(l.saldo)+'</b><span>saldo</span></div><div><b>'+int(l.rgs)+'</b><span>RGs</span></div><div><b class="bad">'+int(l.semRg)+'</b><span>sem RG</span></div><div><b>'+int(l.itens)+'</b><span>itens</span></div><div><b>'+(l.idade==null?'—':int(l.idade)+' d')+'</b><span>idade média</span></div></div></div>'+
    '<div class="rgx-pn-ac"><button class="btn btn-orange" data-act="ver-local" data-l="'+esc(local)+'">Ver todos os itens</button><button class="btn btn-secondary" data-act="exporta-local" data-l="'+esc(local)+'">Excel</button></div>'+
    '<div class="rgx-pn-lista">'+itens.slice(0,60).map(function(i){
      var pp=i.saldo?i.comRg/i.saldo*100:(i.rgs?100:0);
      return '<div class="rgx-pn-it"><div class="rgx-pn-it-t"><b>'+esc(i.desc||i.item)+'</b><span class="mono">'+esc(i.item)+'</span></div><div class="rgx-pn-it-n"><div class="rgx-mini"><i style="width:'+pp.toFixed(1)+'%"></i></div><span>'+int(i.rgs)+' / '+int(i.saldo)+'</span>'+tagDias(i.dias)+'</div></div>';
    }).join('')+(itens.length>60?'<div class="rgx-pn-mais">+ '+int(itens.length-60)+' itens</div>':'')+'</div>';
  var el=$('rgPainel'); el.innerHTML=h; el.classList.add('aberto'); $('rgPainelFundo').classList.add('aberto');
}
function fechaPainel(){ var el=$('rgPainel'); if(el){ el.classList.remove('aberto'); $('rgPainelFundo').classList.remove('aberto'); } }

/* ---------- ficha do RG ---------- */
function abreFicha(rg){
  var r=S.rgs.filter(function(x){ return x.rg===rg; })[0]; if(!r) return;
  var c=function(rot,val){ return '<div><span>'+esc(rot)+'</span><b>'+(val==null||val===''?'—':val)+'</b></div>'; };
  var cov=S.D.cov.filter(function(x){ return x.item===r.item && x.local===r.local; })[0];
  $('rgModal').innerHTML='<div class="rg-ficha" role="dialog" aria-modal="true"><div class="rg-ficha-cab"><div><small>RG</small><strong>'+esc(r.rg)+'</strong></div><button type="button" data-act="fecha-ficha" aria-label="Fechar">×</button></div>'+
    '<div class="rg-ficha-corpo"><div class="rg-ficha-item">'+esc(r.item)+' · '+esc(descItem(r)||'—')+'</div><div class="rg-campos">'+
    c('Classificação',tagClassif(r.classif))+c('Situação',esc(r.sit))+
    c('Local atual',esc(descLocal(r.local)))+c('Classe do local',esc(classeNome(r.classe)))+
    c('Criado em',dataBR(r.dt))+c('Operador',esc(operNome(r.oper)))+
    c('EAN',esc(r.ean))+c('Preço',reais(precoRg(r)))+
    c('Tipo de geração',esc(r.tipo))+c('Impressões',int(r.imp))+
    c('Entrega',esc(r.entrega))+c('NR',esc(r.nr))+
    (cov?c('Saldo do item no local',int(cov.saldo))+c('RGs do item no local',int(cov.rgs)):'')+
    '</div></div></div>';
  $('rgModal').hidden=false;
}
function fechaFicha(){ $('rgModal').hidden=true; $('rgModal').innerHTML=''; }

/* ---------- exportação ---------- */
function exporta(nome, cab, linhas){
  if(typeof XLSX==='undefined'){ toast('A exportação não carregou. Atualize a página.', true); return; }
  var ws=XLSX.utils.aoa_to_sheet([cab].concat(linhas));
  cab.forEach(function(_,i){ var cel=ws[XLSX.utils.encode_cell({r:0,c:i})]; if(cel) cel.s={font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'001A72'}}}; });
  ws['!cols']=cab.map(function(c){ return {wch:Math.max(12,String(c).length+4)}; });
  var wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Dados');
  var d=new Date();
  XLSX.writeFile(wb, nome+'_'+d.getFullYear()+d2(d.getMonth()+1)+d2(d.getDate())+'.xlsx');
}
var CAB_COV=['Item','Descrição','EAN','Classe Local','Local','Descrição Local','Saldo','RGs','Sem RG','RG sem saldo','Data Situação','Dias no local','Restrição','Custo unitário','Valor','Valor sem RG'];
function linhasCov(l){ return l.map(function(c){ return [c.item,c.desc,c.ean,c.classe,c.local,c.localDesc,c.saldo,c.rgs,c.semRg,c.rgSemSaldo,c.t?dataBR(c.t):'',c.dias,Object.keys(c.x||{}).join(' '),c.vu==null?'':c.vu,c.valor==null?'':c.valor,c.valorSem==null?'':c.valorSem]; }); }
function exportaRgs(){
  exporta('RG_Reversa_RGs',['RG','Criado em','Item','Descrição','EAN','Classificação','Classe Local','Local','Descrição Local','Operador','Preço','Situação'],
    rgsFiltrados().map(function(r){ return [r.rg,dataBR(r.dt),r.item,descItem(r),r.ean,r.classif,r.classe,r.local,descLocal(r.local),r.oper,precoRg(r),r.sit]; }));
}


/* ---------- Coletor: agora é um app à parte (coletor/) ---------- */
function versaoTxt(){ return RG.versaoTxt(); }

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
  h+='<div class="rv-hint" style="margin-bottom:8px"><b>'+int(lista.length)+'</b> RGs em <b>'+int(lotes.size)+'</b> movimentação(ões). O relatório sai com uma linha por RG, em 3 colunas: <b>local de origem · RG · local de destino</b>. Ao exportar, as linhas passam a "Exportado".</div>';
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
  RG.copia(RG.textoPutty(l)).then(function(){ toast(int(l.length)+' linhas (RGs) copiadas — cole no PuTTY.'); marcaExportado(lista); });
}
function copiaFallback(txt){ var t=document.createElement('textarea'); t.value=txt; t.style.position='fixed'; t.style.opacity='0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch(e){} t.remove(); }

/* ---------- Importação ---------- */
function vImportacao(){
  var rgDias=S.rgs.map(function(r){ return r.dt; }).filter(Boolean);
  var stRg = S.rgs.length ? '<span class="tag tag-good">Carregado</span> '+int(S.rgs.length)+' RGs'+(rgDias.length?' · de '+dataBR(Math.min.apply(null,rgDias))+' a '+dataBR(Math.max.apply(null,rgDias)):'') : '<span class="tag tag-muted">Ainda não importado</span>';
  var stEst = S.est ? '<span class="tag tag-good">Carregado</span> '+int(S.est.unidades)+' unidades · '+dataHoraBR(S.est.em) : '<span class="tag tag-muted">Ainda não importado</span>';
  var movDias=S.mov.map(function(m){ return m.t; });
  var stMov = S.mov.length ? '<span class="tag tag-good">Carregado</span> '+int(S.mov.length)+' movimentações'+(movDias.length?' · de '+dataBR(Math.min.apply(null,movDias))+' a '+dataBR(Math.max.apply(null,movDias)):'') : '<span class="tag tag-muted">Ainda não importado</span>';
  var stPreco = S.preco ? '<span class="tag tag-good">Carregado</span> '+int(S.preco.rows.length)+' itens com custo · '+dataHoraBR(S.preco.em) : '<span class="tag tag-muted">Ainda não importado</span>';
  var stMu = S.mult ? '<span class="tag tag-good">Carregado</span> '+int(S.mult.rows.length)+' ligações · '+dataHoraBR(S.mult.em) : '<span class="tag tag-muted">Ainda não importado</span>';
  var h='';
  if(S.ocupado) h+='<div class="rv-aviso" style="margin-bottom:14px"><strong>Aguarde.</strong> '+esc(S.ocupado)+'</div>';
  h+=S.nuvem.estado==='erro' ? '<div class="rv-aviso" style="margin-bottom:14px"><strong>Dados no servidor:</strong> '+esc(S.nuvem.msg)+'. Enquanto isso, a importação fica só neste navegador.</div>'
    : '<div class="rv-hint" style="margin-bottom:12px">☁ A última importação fica guardada no servidor'+(S.stamps.est?' · estoque de <b>'+dataHoraBR(S.stamps.est)+'</b>':'')+(S.stamps.rgs?' · RGs de <b>'+dataHoraBR(S.stamps.rgs)+'</b>':'')+' — ao abrir o app, ela volta sozinha.</div>';
  h+='<div class="rv-imp">'+
    '<div class="dropzone'+(S.rgs.length?' has-file':'')+'" data-act="escolher" data-drop="1" tabindex="0"><div class="dz-icon">🏷️</div><div class="dz-title">QRY0100 · RG - Produtividade</div><div class="dz-desc">Lista de RGs gerados. Cada importação <strong>soma</strong> os RGs novos e atualiza os existentes.</div><div class="rv-st">'+stRg+'</div></div>'+
    '<div class="dropzone'+(S.preco?' has-file':'')+'" data-act="escolher" data-drop="1" tabindex="0"><div class="dz-icon">💲</div><div class="dz-title">SIGEQ278 · Preço de custo</div><div class="dz-desc">Valor de cada item (usado também na regra dos kits da ZBIQ0051). <strong>Substitui</strong> a anterior. '+stPreco+'</div></div>'+
    '<div class="dropzone'+(S.mov.length?' has-file':'')+'" data-act="escolher" data-drop="1" tabindex="0"><div class="dz-icon">🔀</div><div class="dz-title">QRY0110 · RG - Movimentos</div><div class="dz-desc">Cada RG movido de um local para outro. Cada importação <strong>soma</strong> as novas movimentações. '+stMov+'</div></div>'+
    '<div class="dropzone'+(S.est?' has-file':'')+'" data-act="escolher" data-drop="1" tabindex="0"><div class="dz-icon">📦</div><div class="dz-title">QRY0390 · Estoque por Local</div><div class="dz-desc">Foto do saldo. <strong>Substitui</strong> a anterior. Guarda só as classes '+CLASSES_REVERSA.join(' e ')+'.</div><div class="rv-st">'+stEst+'</div></div>'+
    '<div class="dropzone'+(S.mult?' has-file':'')+'" data-act="escolher" data-drop="1" tabindex="0"><div class="dz-icon">🧩</div><div class="dz-title">ZBIQ0051 · Item x Múltiplo</div><div class="dz-desc">Liga item pai a componentes. <strong>Substitui</strong> a anterior. Alimenta o indicador de múltiplos.</div><div class="rv-st">'+stMu+'</div></div>'+
    '</div>';
  h+='<div class="panel" style="margin-top:14px"><h3>Como importar</h3><div class="panel-sub">Clique num quadro ou arraste os arquivos para cá. Pode soltar os três de uma vez — o app reconhece cada relatório sozinho. Os dados ficam salvos neste navegador.</div>'+
    '<ol style="margin:0 0 4px 18px;line-height:1.9"><li>Bseller: exporte a <strong>QRY0100</strong> (período desde a última importação), a <strong>QRY0390</strong> (CD inteiro) e a <strong>ZBIQ0051</strong>.</li><li>Solte os arquivos aqui.</li><li>A cada importação da QRY0390 o app guarda uma foto da cobertura — é ela que forma o gráfico de evolução.</li></ol></div>';
  var log=lsGet(LOG_KEY);
  h+='<div class="panel" style="margin-top:14px"><div class="panel-head-row"><h3>Histórico de importações</h3><div><button class="btn-danger-text" data-act="limpa" data-k="rgs">Apagar RGs</button> <button class="btn-danger-text" data-act="limpa" data-k="est">Apagar estoque</button> <button class="btn-danger-text" data-act="limpa" data-k="mult">Apagar múltiplos</button> <button class="btn-danger-text" data-act="limpa" data-k="mov">Apagar movimentos</button> <button class="btn-danger-text" data-act="limpa" data-k="preco">Apagar preços</button> <button class="btn-danger-text" data-act="limpa" data-k="hist">Apagar evolução</button></div></div>';
  if(!log.length) h+='<p class="field-hint">Nenhuma importação registrada neste navegador.</p>';
  else h+='<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Relatório</th><th>Arquivo</th><th>Resultado</th></tr></thead><tbody>'+log.map(function(l){ return '<tr><td>'+dataHoraBR(l.em)+'</td><td>'+esc(l.tipo)+'</td><td>'+esc(l.arquivo)+'</td><td>'+esc(l.resumo)+'</td></tr>'; }).join('')+'</tbody></table></div>';
  return h+'</div>';
}

/* ---------- navegação ---------- */
var VIEWS={ painel:vPainel, estoque:vEstoque, rgs:vRgs, prod:vProd, movs:vMovs, importacao:vImportacao };
function render(){
  var t=TABS[S.tab]; $('tabTitle').textContent=t[0]; $('tabSubtitle').textContent=t[1];
  Array.prototype.forEach.call(document.querySelectorAll('.nav-item[data-tab]'),function(b){ b.classList.toggle('active', b.dataset.tab===S.tab); });
  var h=(S.ocupado && S.tab!=='importacao') ? '<div class="rv-aviso" style="margin-bottom:14px"><strong>Aguarde.</strong> '+esc(S.ocupado)+'</div>' : '';
  var sc=document.querySelector('.page-scroll'), y=sc?sc.scrollTop:0;
  $('viewRoot').innerHTML=h+VIEWS[S.tab]();
  if(sc) sc.scrollTop=y;
  if(S.tab==='painel') anima();
}
/* Redesenha mantendo o foco no campo de busca enquanto a pessoa digita. */
function renderFoco(id){
  render();
  var el=$(id);
  if(el){ el.focus(); var k=el.value.length; try { el.setSelectionRange(k,k); } catch(e){} }
}
function vaiPara(tab){
  if(!TABS[tab]) return;
  if(tab==='movs' || (tab==='importacao' && leitura())) tab='painel'; // aba Movimentações escondida por enquanto
  S.tab=tab; S.anima=true; fechaPainel();
  try { history.replaceState(null,'','#'+tab); } catch(e){}
  $('sidebar').classList.remove('mobile-open');
  if(tab==='movs') S.movs=null;
  if(tab==='prod') S.colMov=null;
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
  if(a==='classe'){ S.classe=el.dataset.c; S.ritmo=null; S.anima=true; S.cobLocal=''; deriva(); return render(); }
  if(a==='ritmo-real'){ S.ritmo=null; var r=ritmoAtual(), s=$('simRitmo'); if(s) s.value=Math.max(50,Math.round(r/50)*50); return atualizaSim(r); }
  if(a==='local') return abrePainel(el.dataset.l);
  if(a==='fecha-painel') return fechaPainel();
  if(a==='ver-local'){ S.cobLocal=el.dataset.l; S.cobModo='todos'; S.cobQ=''; S.cobFaixa=''; S.sort.cov={k:'semRg',dir:-1}; S.lim.cov=PAGINA; return vaiPara('estoque'); }
  if(a==='exporta-local') return exporta('RG_Reversa_'+String(descLocal(el.dataset.l)).replace(/\s+/g,'_'), CAB_COV, linhasCov(S.D.cov.filter(function(c){ return c.local===el.dataset.l; })));
  if(a==='faixa'){ S.cobFaixa=el.dataset.fx; S.cobModo='sem'; S.cobLocal=''; S.cobQ=''; S.sort.cov={k:'semRg',dir:-1}; S.lim.cov=PAGINA; return vaiPara('estoque'); }
  if(a==='tira-local'){ S.cobLocal=''; return render(); }
  if(a==='tira-faixa'){ S.cobFaixa=''; return render(); }
  if(a==='classif'){ S.fClassif=el.dataset.c; S.fOper=''; S.q=''; S.lim.rgs=PAGINA; return vaiPara('rgs'); }
  if(a==='oper'){ S.fOper=el.dataset.o; S.fClassif=''; S.q=''; S.lim.rgs=PAGINA; return vaiPara('rgs'); }
  if(a==='f-classif'){ S.fClassif=el.dataset.c; S.lim.rgs=PAGINA; return render(); }
  if(a==='cob-modo'){ S.cobModo=el.dataset.m; S.sort.cov=null; S.lim.cov=PAGINA; return render(); }
  if(a==='ordena'){ var id=el.dataset.tb, k=el.dataset.k, st=S.sort[id]; S.sort[id]={k:k, dir: st && st.k===k ? -st.dir : -1}; return render(); }
  if(a==='mais'){ S.lim[el.dataset.tb]=(S.lim[el.dataset.tb]||PAGINA)+PAGINA; return render(); }
  if(a==='ficha') return abreFicha(el.dataset.rg);
  if(a==='fecha-ficha') return fechaFicha();
  if(a==='relatorio') return baixaRelatorio();
  if(a==='mis-fx'){ var mi=+el.dataset.i; S.fMisFx=S.fMisFx===mi?-1:mi; S.anima=false; return render(); }
  if(a==='mis-xlsx'){
    var ml=misFiltrados(resumoMisto()); if(!ml.length) return toast('Nada para exportar.', true);
    return exporta('RG_Reversa_Locais_Mistos',['Local','Código','Dias em misto','Un sem RG','RGs','Início'],ml.map(function(r){ return [r.desc,r.local,r.dias,r.semRg,r.rgs,r.origem==='estimado'?'estimado':'medido']; }));
  }
  if(a==='cf-xlsx'){
    var CC=confereColetor(produtividade()); if(!CC.pend.length) return toast('Nada para exportar.', true);
    return exporta('RG_Reversa_Bipados_sem_QRY0110',['RG','Destino bipado','Operador','Bipado em','Parado (horas)'],CC.pend.map(function(r){ return [r.rg,r.dest,operNome(r.op),dataHoraBR(r.ts),Math.round(r.h)]; }));
  }
  if(a==='sempreco-xlsx'){
    var sp=Array.from(S.D.semPreco.values()).sort(function(x,y){ return (y.un+y.rgs)-(x.un+x.rgs); });
    if(!sp.length) return toast('Todos os itens têm preço.', true);
    return exporta('RG_Reversa_Itens_sem_preco',['Item','Descrição','Classe','Unidades em estoque','RGs abertos'],sp.map(function(x){ return [x.item,x.desc,x.classe,x.un,x.rgs]; }));
  }
  if(a==='p-at'){ S.pAt=el.dataset.v; S.colMov=null; return render(); }
  if(a==='p-grp'){ S.pGrp=el.dataset.v; return render(); }
  if(a==='p-cmp'){ S.pCmp=el.dataset.v; return render(); }
  if(a==='p-ser'){ S.pSer=el.dataset.v; return render(); }
  if(a==='p-dia'){ var ba=S.pDia!=null?S.pDia:hoje0(); if(S.pDia==null){ var us=(S.pSer==='rg'&&S.rgs.length?itensRg():itensMov()).map(function(x){ return x.t; }); ba=us.length?Math.max.apply(null,us):hoje0(); } S.pDia=addDias(ba,+el.dataset.d); return render(); }
  if(a==='exporta-rgs') return exportaRgs();
  if(a==='exporta-cov') return exporta('RG_Reversa_Estoque_x_RG', CAB_COV, linhasCov(covFiltrada()));
  if(a==='escolher'){ if(leitura()) return toast('Seu acesso não permite importar relatórios.', true); $('fileInput').click(); return; }
  if(a==='limpa'){
    if(leitura()) return toast('Seu acesso não permite apagar dados.', true);
    var k=el.dataset.k;
    if(!confirm('Apagar '+({rgs:'os RGs',est:'o estoque',mult:'os múltiplos',mov:'as movimentações',preco:'os preços',hist:'o histórico de evolução'}[k])+' deste navegador?')) return;
    if(k==='rgs') S.rgs=[]; if(k==='est') S.est=null; if(k==='mult') S.mult=null; if(k==='hist') S.hist=[]; if(k==='mov') S.mov=[]; if(k==='preco') S.preco=null;
    return dbDel(k).then(function(){ S.anima=true; deriva(); render(); });
  }
  if(a==='mv-load'){ S.movs=null; return carregaMovs(); }
  if(a==='mv-mais'){ S.lim.mv=(S.lim.mv||PAGINA)+PAGINA; return render(); }
  if(a==='mv-xlsx') return mvXlsx();
  if(a==='mv-copy') return mvCopy();
}
function inicia(){
  var fi=document.createElement('input'); fi.type='file'; fi.id='fileInput'; fi.accept='.xlsx,.xls,.xlsb,.csv'; fi.multiple=true; fi.hidden=true; document.body.appendChild(fi);
  document.addEventListener('click', function(ev){
    if(ev.target.id==='rgModal') return fechaFicha();
    if(ev.target.id==='rgPainelFundo') return fechaPainel();
    var el=ev.target.closest('[data-act]'); if(el) acao(el, ev);
  });
  document.addEventListener('change', function(ev){
    var t=ev.target;
    if(t.id==='fileInput'){ importar(t.files); t.value=''; return; }
    if(t.id==='pDe' || t.id==='pAte'){ if(t.value){ S[t.id==='pDe'?'pDe':'pAte']=t.value; S.colMov=null; render(); } return; }
    if(t.id==='pDia'){ var dv=deIso(t.value); if(dv!=null){ S.pDia=dv; render(); } return; }
    if(t.dataset && t.dataset.f){ S[t.dataset.f]=t.value; S.lim.cov=0; S.lim.rgs=0; return render(); }
    if(t.dataset && t.dataset.mv && t.dataset.mv!=='q'){ S.fm[t.dataset.mv]=t.value; S.lim.mv=0; S.movs=null; render(); }
  });
  var espera, colTimer;
  document.addEventListener('input', function(ev){
    var t=ev.target;
    /* O leitor de RG não manda Enter: o código entra sozinho quando a digitação para (leitor é rápido). */
    if(t.id==='colRg'){ clearTimeout(colTimer); colTimer=setTimeout(function(){ if(t.value.trim().length>=3 && document.activeElement===t) colCommit('rg', t); }, 280); return; }
    if(t.id==='simRitmo'){ S.ritmo=+t.value; return atualizaSim(S.ritmo); }
    if(t.id==='fQ' || t.id==='fCobQ'){ clearTimeout(espera); espera=setTimeout(function(){ if(t.id==='fQ'){ S.q=t.value; S.lim.rgs=0; } else { S.cobQ=t.value; S.lim.cov=0; } renderFoco(t.id); }, 220); return; }
    if(t.id==='misQ'){ clearTimeout(espera); espera=setTimeout(function(){ S.fMisQ=t.value; S.anima=false; renderFoco('misQ'); }, 220); return; }
    if(t.id==='mvQ'){ clearTimeout(espera); espera=setTimeout(function(){ S.fm.q=t.value; S.lim.mv=0; render(); var el=$('mvQ'); if(el){ el.focus(); var n=el.value.length; try { el.setSelectionRange(n,n); } catch(e){} } }, 220); }
  });
  document.addEventListener('keydown', function(ev){
    var t=ev.target;
    if(ev.key==='Escape'){ if(!$('rgModal').hidden) fechaFicha(); else fechaPainel(); }
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
  if(v) v.textContent=RG.versaoTxt();
  var rp=$('appRodape'); if(rp) rp.textContent=versaoTxt();
  RG.vigiaVersao('js/versao.js');
  var h=''; try { h=decodeURIComponent(location.hash.slice(1)); } catch(e){}
  if(TABS[h]) S.tab=h;
  deriva(); render();
}

/* Chamado pela trava de acesso quando descobre que o nível é "só visualizar": sai da Importação e redesenha. */
window.rgAplicaNivel=function(){ if(S.tab==='importacao') vaiPara('painel'); else render(); };

/* Chamado pela trava de acesso (acesso.js) depois que o login e a permissão passam. */
var iniciado=false;
window.rgIniciar=function(){
  if(iniciado) return; iniciado=true;
  try { window.rgSupa.auth.getSession().then(function(r){ var u=r.data && r.data.session && r.data.session.user; S.user=u&&u.email ? u.email.split('@')[0] : ''; }); } catch(e){}
  /* pede ao navegador para não apagar os dados do site por falta de espaço */
  try { if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch(e){}
  Promise.all([dbGet('rgs'), dbGet('est'), dbGet('mult'), dbGet('hist'), dbGet('stamps'), dbGet('mov'), dbGet('preco')]).then(function(r){
    S.rgs=Array.isArray(r[0]) ? r[0] : [];
    S.est=r[1] && r[1].rows ? r[1] : null;
    S.mult=r[2] && r[2].rows ? r[2] : null;
    S.hist=Array.isArray(r[3]) ? r[3] : [];
    S.stamps=r[4] && typeof r[4]==='object' ? r[4] : {};
    S.mov=Array.isArray(r[5]) ? r[5] : [];
    S.preco=r[6] && r[6].rows ? r[6] : null;
  }).catch(function(){ toast('Não consegui abrir os dados salvos neste navegador.', true); }).then(function(){
    deriva();
    S.nuvem={ estado:'sync', msg:'Carregando os dados da última importação…' }; render();
    RG.carregaLocais(window.rgSupa).then(function(){ if(S.tab==='movs') render(); });
    return sincroniza();
  }).then(function(){ S.anima=true; deriva(); render(); if(S.nuvem.estado==='erro') toast('Dados do servidor: '+S.nuvem.msg, true); });
};
inicia();
})();
