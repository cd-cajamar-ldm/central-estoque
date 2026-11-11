/* RG Reversa — gestão do estoque da logística reversa peça a peça.
 *
 * Duas bases, as duas exportadas do Bseller e importadas aqui no navegador:
 *   QRY0100 (RG - Produtividade)  → 1 linha = 1 RG. Vem só o período exportado,
 *                                    então o app ACUMULA: cada importação soma
 *                                    RGs novos e atualiza os que já existiam.
 *   QRY0390 (Estoque por Local)   → foto do saldo. Cada importação SUBSTITUI a
 *                                    anterior. Só as classes de local da reversa
 *                                    (CLASSES_REVERSA) são guardadas.
 *
 * Cruzando as duas por item + local sai a pergunta central do módulo: quanto do
 * estoque da reversa já está identificado por RG e quanto ainda não.
 *
 * Nada sai da máquina: os dados ficam no IndexedDB deste navegador. */
(function(){
'use strict';

var CLASSES_REVERSA = ['REV','AVA'];
var FAIXAS = [[0,7,'0 a 7 dias'],[8,15,'8 a 15 dias'],[16,30,'16 a 30 dias'],[31,60,'31 a 60 dias'],[61,90,'61 a 90 dias'],[91,1e9,'Mais de 90 dias']];
var PAGINA = 200;
var LOG_KEY = 'rg-reversa-log';

var TABS = {
  painel:['Painel','Visão geral do estoque da reversa e dos RGs.'],
  rgs:['Consulta de RGs','Cada RG é uma peça. Busque, filtre e abra a ficha.'],
  cobertura:['Estoque sem RG','Saldo da reversa que ainda não tem RG, por item e local.'],
  produtividade:['Produtividade','RGs gerados por dia e por operador.'],
  classificacao:['Classificação','Como as peças com RG foram classificadas.'],
  tempo:['Tempo parado','Há quanto tempo as peças estão na reversa.'],
  importacao:['Importação','Relatórios do Bseller que alimentam o app.']
};

var S = {
  rgs:[], est:null, tab:'painel',
  f:{ q:'', classif:'', classe:'', oper:'', sit:'', cobModo:'sem', cobQ:'', cobClasse:'', cobLocal:'', dia:'' },
  sort:{}, lim:{}, D:null, ocupado:''
};

/* ---------- utilidades ---------- */
function $(id){ return document.getElementById(id); }
function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function norm(v){ return String(v==null?'':v).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function int(n){ return Math.round(n||0).toLocaleString('pt-BR'); }
function reais(n){ return (n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
function pct(a,b){ return b>0 ? (a/b*100).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%' : '—'; }
function d2(n){ return (n<10?'0':'')+n; }
function dataBR(t){ if(!t) return '—'; var d=new Date(t); return d2(d.getDate())+'/'+d2(d.getMonth()+1)+'/'+d.getFullYear(); }
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
/* Datas do Bseller chegam como texto "dd/mm/aaaa hh:mm:ss"; aceita também
   célula de data e número serial do Excel, caso o relatório mude de formato. */
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

/* ---------- armazenamento (IndexedDB, um registro por base) ---------- */
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
function leLog(){ try { return JSON.parse(localStorage.getItem(LOG_KEY)||'[]'); } catch(e){ return []; } }
function gravaLog(ent){ var l=leLog(); l.unshift(ent); try { localStorage.setItem(LOG_KEY, JSON.stringify(l.slice(0,30))); } catch(e){} }

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
            if(h.indexOf('classe local')>=0 && h.indexOf('quantidade')>=0 && h.indexOf('item')>=0){ achou={tipo:'est',h:h,linhas:aoa.slice(i+1)}; return true; }
          }
          return false;
        });
        if(!achou) return rej(new Error('"'+file.name+'" não parece ser a QRY0100 (RG) nem a QRY0390 (Estoque por Local).'));
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
      /* Só o dia: na QRY0100 o horário vem com defeito (o minuto repete a hora,
         em formato 12h), então não dá para confiar nele. */
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

/* A QRY0390 tem três colunas "Descrição": a do item, a da classe e a do local.
   Cada uma vem logo depois da coluna que descreve. */
function montaEstoque(a, nome){
  var c=function(n){ return a.h.indexOf(n); };
  var desc=function(i){ return (i>=0 && a.h[i+1]==='descricao') ? i+1 : -1; };
  var iItem=c('item'), iEan=c('ean'), iCl=c('classe local'), iLoc=c('local'), iQ=c('quantidade'), iDt=c('data situacao'), iRes=c('restricao');
  var iItemD=desc(iItem), iClD=desc(iCl), iLocD=desc(iLoc);
  var m=new Map(), classes={}, linhasRev=0, un=0;
  a.linhas.forEach(function(l){
    var cl=String(l[iCl]||'').trim().toUpperCase();
    if(CLASSES_REVERSA.indexOf(cl)<0) return;
    var item=cod(l[iItem]), loc=cod(l[iLoc]); if(!item) return;
    var q=num(l[iQ]), t=iDt>=0 ? parseData(l[iDt]) : null;
    linhasRev++; un+=q;
    if(iClD>=0 && l[iClD]) classes[cl]=String(l[iClD]).trim();
    var k=item+'|'+loc, r=m.get(k);
    if(!r){ r={i:item, d:iItemD>=0?String(l[iItemD]||'').trim():'', e:iEan>=0?cod(l[iEan]):'', c:cl, l:loc, ld:iLocD>=0?String(l[iLocD]||'').trim():loc, q:0, t:null, r:''}; m.set(k,r); }
    r.q+=q;
    if(t && (!r.t || t<r.t)) r.t=t;
    var res=iRes>=0 ? String(l[iRes]||'').trim() : '';
    if(res && r.r.split(' ').indexOf(res)<0) r.r=(r.r?r.r+' ':'')+res;
  });
  return { rows:Array.from(m.values()), classes:classes, arquivo:nome, em:Date.now(), linhasArquivo:a.linhas.length, linhasReversa:linhasRev, unidades:un };
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
      var est=montaEstoque(a, f.name);
      if(!est.rows.length) throw new Error('"'+f.name+'" não tem saldo nas classes da reversa ('+CLASSES_REVERSA.join(', ')+').');
      S.est=est;
      gravaLog({em:Date.now(), tipo:'QRY0390 · Estoque', arquivo:f.name, resumo:int(est.linhasArquivo)+' linhas no arquivo · '+int(est.linhasReversa)+' da reversa · '+int(est.unidades)+' unidades'});
      msgs.push('estoque da reversa atualizado ('+int(est.unidades)+' un)');
      return dbSet('est', S.est);
    }).catch(function(e){ erros.push(e.message||String(e)); }).then(proximo);
  }
  /* setTimeout: dá tempo de a mensagem "Lendo…" aparecer antes de a leitura travar a tela. */
  setTimeout(function(){
    proximo().then(function(){
      S.ocupado=''; deriva(); render();
      if(erros.length) toast(erros.join(' '), true);
      else if(msgs.length) toast('Importado: '+msgs.join(' · ')+'.');
    });
  }, 60);
}

/* ---------- cruzamento RG x estoque ---------- */
function aberto(r){ var s=norm(r.sit); return !s || s==='aberto'; }
function deriva(){
  var D={ itemDesc:new Map(), localDesc:new Map(), cov:[], tot:{saldo:0, comRg:0, semRg:0, rgSemSaldo:0}, abertos:[], porClasse:new Map() };
  D.abertos=S.rgs.filter(aberto);
  var m=new Map();
  if(S.est) S.est.rows.forEach(function(r){
    if(r.d) D.itemDesc.set(r.i,r.d);
    D.localDesc.set(r.l,r.ld);
    m.set(r.i+'|'+r.l, {item:r.i, desc:r.d, ean:r.e, classe:r.c, local:r.l, localDesc:r.ld, saldo:r.q, rgs:0, t:r.t, restr:r.r});
  });
  D.abertos.forEach(function(r){
    var k=r.item+'|'+r.local, c=m.get(k);
    if(!c){ c={item:r.item, desc:D.itemDesc.get(r.item)||'', ean:r.ean, classe:r.classe, local:r.local, localDesc:D.localDesc.get(r.local)||r.local, saldo:0, rgs:0, t:null, restr:''}; m.set(k,c); }
    c.rgs++;
  });
  m.forEach(function(c){
    c.semRg=Math.max(0,c.saldo-c.rgs); c.rgSemSaldo=Math.max(0,c.rgs-c.saldo); c.dias=dias(c.t);
    D.tot.saldo+=c.saldo; D.tot.comRg+=Math.min(c.saldo,c.rgs); D.tot.semRg+=c.semRg; D.tot.rgSemSaldo+=c.rgSemSaldo;
    var pc=D.porClasse.get(c.classe); if(!pc){ pc={classe:c.classe, saldo:0, comRg:0, semRg:0, rgs:0}; D.porClasse.set(c.classe,pc); }
    pc.saldo+=c.saldo; pc.comRg+=Math.min(c.saldo,c.rgs); pc.semRg+=c.semRg; pc.rgs+=c.rgs;
    D.cov.push(c);
  });
  S.D=D;
}
function descItem(r){ return S.D.itemDesc.get(r.item)||''; }
function descLocal(l){ return S.D.localDesc.get(l)||l||'—'; }
function classeNome(c){ return (S.est && S.est.classes[c]) ? c+' · '+S.est.classes[c] : (c||'—'); }

/* ---------- peças de tela ---------- */
function kpi(numTxt, rot, sub, cor){
  return '<div class="kpi-card'+(cor?' '+cor:'')+'"><div class="num'+(String(numTxt).length>9?' rg-longo':'')+'">'+numTxt+'</div><div class="label">'+esc(rot)+'</div>'+(sub?'<div class="sub">'+sub+'</div>':'')+'</div>';
}
function hbars(lista, cor, fmt){
  if(!lista.length) return '<p class="field-hint">Sem dados.</p>';
  var max=Math.max.apply(null, lista.map(function(x){ return x[1]; }))||1;
  return lista.map(function(x){
    return '<div class="bi-hbar-row rg-largo"><div class="bi-hbar-label" title="'+esc(x[0])+'">'+esc(x[0])+'</div><div class="bi-hbar-track"><div class="bi-hbar-fill '+(cor||'')+'" style="width:'+(x[1]/max*100).toFixed(1)+'%"></div></div><div class="bi-hbar-val">'+(fmt?fmt(x[1],x):int(x[1]))+'</div></div>';
  }).join('');
}
function vbars(lista){
  if(!lista.length) return '<p class="field-hint">Sem dados.</p>';
  var max=Math.max.apply(null, lista.map(function(x){ return x[1]; }))||1;
  return '<div class="bi-vbars-scroll"><div class="bi-vbars">'+lista.map(function(x){
    return '<div class="bi-vbar-col"><div class="bi-vbar-val">'+int(x[1])+'</div><div class="bi-vbar orange" style="height:'+Math.max(2,x[1]/max*68).toFixed(1)+'%"></div><div class="bi-vbar-label">'+esc(x[0])+'</div></div>';
  }).join('')+'</div></div>';
}
function tagClassif(c){
  if(!c) return '<span class="tag tag-bad">Sem classificação</span>';
  var n=norm(c), cls = n.indexOf('open')>=0 ? 'tag-blue' : n.indexOf('saldo a')>=0 ? 'tag-good' : n.indexOf('saldo')>=0 ? 'tag-orange' : 'tag-muted';
  return '<span class="tag '+cls+'">'+esc(c)+'</span>';
}
function tagDias(n){
  if(n==null) return '—';
  var cls = n>90 ? 'tag-bad' : n>30 ? 'tag-orange' : 'tag-muted';
  return '<span class="tag '+cls+'">'+int(n)+' d</span>';
}
/* Tabela com ordenação por coluna e "mostrar mais". cols: {k, rot, num, fmt, val} */
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
        var r = (typeof x==='number' && typeof y==='number') ? x-y : String(x).localeCompare(String(y),'pt-BR',{numeric:true});
        return st.dir*r;
      });
    }
  }
  var lim=S.lim[id]||PAGINA, parte=linhas.slice(0,lim);
  var h='<div class="table-wrap"><table class="table-wide"><thead><tr>'+cols.map(function(c){
    var seta = st && st.k===c.k ? '<span class="arrow">'+(st.dir>0?'▲':'▼')+'</span>' : '';
    return '<th'+(c.num?' class="rg-num"':'')+' data-act="ordena" data-tb="'+id+'" data-k="'+c.k+'">'+esc(c.rot)+seta+'</th>';
  }).join('')+'</tr></thead><tbody>';
  if(!parte.length) h+='<tr><td colspan="'+cols.length+'" style="text-align:center;color:var(--ink-soft);padding:26px">Nada encontrado com esses filtros.</td></tr>';
  parte.forEach(function(r){
    h+='<tr'+(cfg.rg?' class="rg-click" data-act="ficha" data-rg="'+esc(r.rg)+'"':'')+'>'+cols.map(function(c){
      var t = c.fmt ? c.fmt(r) : esc(r[c.k]);
      return '<td'+(c.num?' class="rg-num"':'')+'>'+t+'</td>';
    }).join('')+'</tr>';
  });
  h+='</tbody></table></div>';
  if(linhas.length>lim) h+='<div class="rg-mais"><button class="btn btn-secondary" data-act="mais" data-tb="'+id+'">Mostrar mais ('+int(linhas.length-lim)+' restantes)</button></div>';
  return h;
}
function vazio(titulo, texto){
  return '<div class="panel"><div class="empty-state"><div class="eicon">📦</div><h3>'+esc(titulo)+'</h3><p>'+texto+'</p><p style="margin-top:16px"><button class="btn btn-orange" data-act="tab" data-tab="importacao">Ir para Importação</button></p></div></div>';
}
function avisoParcial(){
  if(!S.est || !S.rgs.length) return '';
  return '<div class="rg-aviso"><strong>Leitura da cobertura:</strong> o app só conhece os RGs que já foram importados (a QRY0100 traz o período exportado). Para a cobertura ficar certa, importe a QRY0100 de todo o período em que houve geração de RG.</div>';
}

/* ---------- telas ---------- */
function vPainel(){
  if(!S.rgs.length && !S.est) return vazio('Nenhum relatório importado ainda','Importe a <strong>QRY0100 (RG - Produtividade)</strong> e a <strong>QRY0390 (Estoque por Local)</strong> do Bseller para ver o painel.');
  var D=S.D, ab=D.abertos, T=D.tot;
  var semCl=ab.filter(function(r){ return !r.classif; }).length;
  var valor=ab.reduce(function(s,r){ return s+r.preco; },0);
  var h='<div class="kpi-grid">';
  h+=kpi(int(ab.length),'RGs abertos', int(S.rgs.length)+' RGs na base','orange');
  h+=kpi(reais(valor),'Valor dos RGs abertos','soma do preço da QRY0100');
  h+=kpi(int(semCl),'RGs sem classificação', semCl?'aguardando avaliação':'tudo classificado', semCl?'bad':'good');
  if(S.est){
    h+=kpi(int(T.saldo),'Estoque na reversa (un)','classes '+CLASSES_REVERSA.join(' + '));
    h+=kpi(pct(T.comRg,T.saldo),'Cobertura de RG', int(T.comRg)+' un com RG', 'good');
    h+=kpi(int(T.semRg),'Unidades sem RG','ainda sem identificação', T.semRg?'warn':'good');
  }
  h+='</div>';
  if(!S.est) h+='<div class="rg-aviso"><strong>Falta o estoque:</strong> importe a QRY0390 (Estoque por Local) para ver quanto da reversa já tem RG.</div>';
  if(!S.rgs.length) h+='<div class="rg-aviso"><strong>Faltam os RGs:</strong> importe a QRY0100 (RG - Produtividade).</div>';
  if(S.est){
    var p=T.saldo>0 ? T.comRg/T.saldo*100 : 0;
    h+='<div class="panel"><h3>Cobertura do estoque da reversa por RG</h3><div class="panel-sub">De cada unidade em local de reversa, quantas já têm um RG vinculado (mesmo item e mesmo local).</div>'+
      '<div class="rg-cob"><span class="c-ok" style="width:'+p.toFixed(2)+'%"></span><span class="c-sem" style="width:'+(100-p).toFixed(2)+'%"></span></div>'+
      '<div class="rg-leg"><span><i style="background:var(--success)"></i>Com RG: <strong>'+int(T.comRg)+'</strong> ('+pct(T.comRg,T.saldo)+')</span><span><i style="background:var(--orange)"></i>Sem RG: <strong>'+int(T.semRg)+'</strong> ('+pct(T.semRg,T.saldo)+')</span>'+
      (T.rgSemSaldo?'<span><i style="background:var(--danger)"></i>RGs sem saldo no local: <strong>'+int(T.rgSemSaldo)+'</strong></span>':'')+'</div></div>';
    h+=avisoParcial();
  }
  h+='<div class="bi-grid-2">';
  h+='<div class="panel"><h3>RGs abertos por classificação</h3><div class="panel-sub">Resultado da avaliação de cada peça.</div>'+hbars(conta(ab,function(r){ return r.classif||'Sem classificação'; }),'orange',function(v){ return int(v)+' · '+pct(v,ab.length); })+'</div>';
  var porDia=conta(S.rgs,function(r){ return r.dt||0; }).sort(function(a,b){ return a[0]-b[0]; }).slice(-14).map(function(x){ return [x[0]?dataBR(x[0]).slice(0,5):'s/ data', x[1]]; });
  h+='<div class="panel"><h3>RGs gerados por dia</h3><div class="panel-sub">Últimos dias com geração de RG.</div>'+vbars(porDia)+'</div>';
  h+='</div>';
  if(S.est){
    h+='<div class="bi-grid-2">';
    var pcs=Array.from(D.porClasse.values()).sort(function(a,b){ return b.saldo-a.saldo; });
    h+='<div class="panel"><h3>Cobertura por classe de local</h3><div class="panel-sub">Saldo, RGs e o que falta em cada classe.</div>'+
      tabela('pclasse',[{k:'classe',rot:'Classe',fmt:function(r){ return esc(classeNome(r.classe)); }},{k:'saldo',rot:'Saldo',num:1,fmt:function(r){ return int(r.saldo); }},{k:'comRg',rot:'Com RG',num:1,fmt:function(r){ return int(r.comRg); }},{k:'semRg',rot:'Sem RG',num:1,fmt:function(r){ return int(r.semRg); }},{k:'cob',rot:'Cobertura',num:1,val:function(r){ return r.saldo?r.comRg/r.saldo:0; },fmt:function(r){ return pct(r.comRg,r.saldo); }}],pcs)+'</div>';
    var loc=new Map();
    D.cov.forEach(function(c){ if(c.semRg) loc.set(c.localDesc,(loc.get(c.localDesc)||0)+c.semRg); });
    var top=Array.from(loc.entries()).sort(function(a,b){ return b[1]-a[1]; }).slice(0,8);
    h+='<div class="panel"><div class="panel-head-row"><h3>Locais com mais estoque sem RG</h3><button class="btn-link" data-act="tab" data-tab="cobertura">Ver tudo →</button></div><div class="panel-sub">Onde está a maior parte das peças ainda sem RG.</div>'+hbars(top,'')+'</div>';
    h+='</div>';
  }
  return h;
}

function rgsFiltrados(){
  var f=S.f, q=norm(f.q);
  return S.rgs.filter(function(r){
    if(f.classif && (f.classif==='__sem' ? r.classif : r.classif!==f.classif)) return false;
    if(f.classe && r.classe!==f.classe) return false;
    if(f.oper && r.oper!==f.oper) return false;
    if(f.sit && r.sit!==f.sit) return false;
    if(q){
      var alvo=norm(r.rg+' '+r.item+' '+r.ean+' '+descItem(r)+' '+descLocal(r.local)+' '+r.oper);
      if(alvo.indexOf(q)<0) return false;
    }
    return true;
  });
}
var COLS_RG=[
  {k:'rg',rot:'RG',fmt:function(r){ return '<span class="mono">'+esc(r.rg)+'</span>'; }},
  {k:'dt',rot:'Criado em',num:0,fmt:function(r){ return dataBR(r.dt); }},
  {k:'item',rot:'Item',fmt:function(r){ return '<span class="mono">'+esc(r.item)+'</span>'; }},
  {k:'desc',rot:'Descrição',val:function(r){ return descItem(r); },fmt:function(r){ var d=descItem(r); return '<div class="rg-desc" title="'+esc(d)+'">'+esc(d||'—')+'</div>'; }},
  {k:'classif',rot:'Classificação',fmt:function(r){ return tagClassif(r.classif); }},
  {k:'classe',rot:'Classe'},
  {k:'local',rot:'Local',val:function(r){ return descLocal(r.local); },fmt:function(r){ return esc(descLocal(r.local)); }},
  {k:'oper',rot:'Operador',fmt:function(r){ return esc(operNome(r.oper)); }},
  {k:'preco',rot:'Preço',num:1,fmt:function(r){ return reais(r.preco); }},
  {k:'idade',rot:'Idade',num:1,val:function(r){ return dias(r.dt); },fmt:function(r){ return tagDias(dias(r.dt)); }},
  {k:'sit',rot:'Situação',fmt:function(r){ return '<span class="tag '+(aberto(r)?'tag-good':'tag-muted')+'">'+esc(r.sit||'—')+'</span>'; }}
];
function vRgs(){
  if(!S.rgs.length) return vazio('Nenhum RG importado','Importe a <strong>QRY0100 (RG - Produtividade)</strong> do Bseller.');
  var f=S.f, lista=rgsFiltrados();
  var un=function(fn){ return conta(S.rgs,fn).map(function(x){ return x[0]; }).filter(Boolean).sort(); };
  var h='<div class="panel"><div class="filter-bar">'+
    '<input type="text" id="fQ" placeholder="Buscar por RG, item, EAN, descrição, local ou operador..." value="'+esc(f.q)+'">'+
    '<select data-f="classif">'+opt('','Classificação: todas',f.classif)+opt('__sem','Sem classificação',f.classif)+un(function(r){ return r.classif; }).map(function(v){ return opt(v,v,f.classif); }).join('')+'</select>'+
    '<select data-f="classe">'+opt('','Classe: todas',f.classe)+un(function(r){ return r.classe; }).map(function(v){ return opt(v,v,f.classe); }).join('')+'</select>'+
    '<select data-f="oper">'+opt('','Operador: todos',f.oper)+un(function(r){ return r.oper; }).map(function(v){ return opt(v,operNome(v),f.oper); }).join('')+'</select>'+
    '<select data-f="sit">'+opt('','Situação: todas',f.sit)+un(function(r){ return r.sit; }).map(function(v){ return opt(v,v,f.sit); }).join('')+'</select>'+
    '<button class="btn btn-secondary" data-act="limpa-filtros">Limpar</button>'+
    '<button class="btn btn-primary" data-act="exporta-rgs">Exportar Excel</button></div>'+
    '<div class="rg-resumo"><span><strong>'+int(lista.length)+'</strong> de '+int(S.rgs.length)+' RGs</span><span>Valor: <strong>'+reais(lista.reduce(function(s,r){ return s+r.preco; },0))+'</strong></span><span>Clique numa linha para abrir a ficha do RG.</span></div>'+
    '<div id="tbRgs">'+tabela('rgs',COLS_RG,lista,{rg:1})+'</div></div>';
  return h;
}

function covFiltrada(){
  var f=S.f, q=norm(f.cobQ);
  return S.D.cov.filter(function(c){
    if(f.cobModo==='sem' && !c.semRg) return false;
    if(f.cobModo==='rgsem' && !c.rgSemSaldo) return false;
    if(f.cobClasse && c.classe!==f.cobClasse) return false;
    if(f.cobLocal && c.localDesc!==f.cobLocal) return false;
    if(q && norm(c.item+' '+c.ean+' '+c.desc+' '+c.localDesc).indexOf(q)<0) return false;
    return true;
  });
}
var COLS_COV=[
  {k:'item',rot:'Item',fmt:function(r){ return '<span class="mono">'+esc(r.item)+'</span>'; }},
  {k:'desc',rot:'Descrição',fmt:function(r){ return '<div class="rg-desc" title="'+esc(r.desc)+'">'+esc(r.desc||'—')+'</div>'; }},
  {k:'classe',rot:'Classe'},
  {k:'localDesc',rot:'Local'},
  {k:'saldo',rot:'Saldo',num:1,fmt:function(r){ return int(r.saldo); }},
  {k:'rgs',rot:'RGs',num:1,fmt:function(r){ return int(r.rgs); }},
  {k:'semRg',rot:'Sem RG',num:1,fmt:function(r){ return r.semRg?'<strong>'+int(r.semRg)+'</strong>':'0'; }},
  {k:'rgSemSaldo',rot:'RG sem saldo',num:1,fmt:function(r){ return r.rgSemSaldo?'<span class="tag tag-bad">'+int(r.rgSemSaldo)+'</span>':'0'; }},
  {k:'dias',rot:'No local há',num:1,fmt:function(r){ return tagDias(r.dias); }}
];
function vCobertura(){
  if(!S.est) return vazio('Falta o estoque por local','Importe a <strong>QRY0390 (Estoque por Local)</strong> do Bseller. O app separa sozinho os locais de reversa (classes '+CLASSES_REVERSA.join(' e ')+').');
  var D=S.D, T=D.tot, f=S.f, lista=covFiltrada();
  if(!S.sort.cov) S.sort.cov={k:f.cobModo==='rgsem'?'rgSemSaldo':'semRg',dir:-1};
  var locais=conta(D.cov,function(c){ return c.localDesc; }).map(function(x){ return x[0]; }).sort();
  var h='<div class="kpi-grid">'+
    kpi(int(T.semRg),'Unidades sem RG', pct(T.semRg,T.saldo)+' do estoque da reversa','warn')+
    kpi(int(D.cov.filter(function(c){ return c.semRg; }).length),'Linhas item × local sem RG','posições a tratar')+
    kpi(int(T.comRg),'Unidades com RG', pct(T.comRg,T.saldo)+' de cobertura','good')+
    kpi(int(T.rgSemSaldo),'RGs sem saldo no local','RG aponta para um local sem a peça', T.rgSemSaldo?'bad':'good')+
    '</div>'+avisoParcial();
  var chip=function(m,rot){ return '<button class="chip'+(f.cobModo===m?' active':'')+'" data-act="cob-modo" data-m="'+m+'">'+rot+'</button>'; };
  h+='<div class="panel"><div class="rg-chips">'+chip('sem','Estoque sem RG')+chip('rgsem','RG sem saldo')+chip('todos','Tudo')+'</div>'+
    '<div class="filter-bar"><input type="text" id="fCobQ" placeholder="Buscar por item, EAN, descrição ou local..." value="'+esc(f.cobQ)+'">'+
    '<select data-f="cobClasse">'+opt('','Classe: todas',f.cobClasse)+Array.from(D.porClasse.keys()).sort().map(function(v){ return opt(v,classeNome(v),f.cobClasse); }).join('')+'</select>'+
    '<select data-f="cobLocal">'+opt('','Local: todos',f.cobLocal)+locais.map(function(v){ return opt(v,v,f.cobLocal); }).join('')+'</select>'+
    '<button class="btn btn-primary" data-act="exporta-cov">Exportar Excel</button></div>'+
    '<div class="rg-resumo"><span><strong>'+int(lista.length)+'</strong> linhas</span><span>Saldo: <strong>'+int(lista.reduce(function(s,c){ return s+c.saldo; },0))+'</strong></span><span>Sem RG: <strong>'+int(lista.reduce(function(s,c){ return s+c.semRg; },0))+'</strong></span></div>'+
    '<div id="tbCov">'+tabela('cov',COLS_COV,lista)+'</div></div>';
  return h;
}

function vProdutividade(){
  if(!S.rgs.length) return vazio('Nenhum RG importado','Importe a <strong>QRY0100 (RG - Produtividade)</strong> do Bseller.');
  var f=S.f;
  var diasL=conta(S.rgs,function(r){ return r.dt||0; }).map(function(x){ return x[0]; }).sort(function(a,b){ return b-a; });
  var lista=f.dia ? S.rgs.filter(function(r){ return String(r.dt||0)===f.dia; }) : S.rgs;
  var ops=new Map();
  lista.forEach(function(r){
    var o=ops.get(r.oper); if(!o){ o={oper:r.oper, n:0, valor:0, semCl:0, dias:new Set(), imp:0}; ops.set(r.oper,o); }
    o.n++; o.valor+=r.preco; if(!r.classif) o.semCl++; o.dias.add(r.dt); if(r.imp>2) o.imp++;
  });
  var arr=Array.from(ops.values()).sort(function(a,b){ return b.n-a.n; });
  arr.forEach(function(o){ o.nd=o.dias.size; o.media=o.n/(o.nd||1); });
  var nDias=new Set(lista.map(function(r){ return r.dt; })).size||1;
  var h='<div class="filter-bar"><select data-f="dia">'+opt('','Período: tudo que foi importado',f.dia)+diasL.map(function(d){ return opt(d, d?dataBR(d):'Sem data', f.dia); }).join('')+'</select></div>';
  h+='<div class="kpi-grid">'+
    kpi(int(lista.length),'RGs gerados', f.dia?'no dia':'em '+int(nDias)+' dia(s)','orange')+
    kpi(int(arr.length),'Operadores','geraram RG no período')+
    kpi(int(lista.length/nDias),'Média por dia','RGs por dia com geração')+
    kpi(arr.length?int(lista.length/nDias/arr.length):'—','Média por operador/dia','RGs por pessoa por dia')+
    kpi(reais(lista.reduce(function(s,r){ return s+r.preco; },0)),'Valor identificado','soma do preço')+
    '</div>';
  h+='<div class="bi-grid-2">';
  var porDia=conta(S.rgs,function(r){ return r.dt||0; }).sort(function(a,b){ return a[0]-b[0]; }).slice(-31).map(function(x){ return [x[0]?dataBR(x[0]).slice(0,5):'s/ data', x[1]]; });
  h+='<div class="panel"><h3>RGs por dia</h3><div class="panel-sub">Todos os dias importados.</div>'+vbars(porDia)+'</div>';
  h+='<div class="panel"><h3>RGs por operador</h3><div class="panel-sub">'+(f.dia?'No dia selecionado.':'No período importado.')+'</div>'+hbars(arr.map(function(o){ return [operNome(o.oper),o.n]; }),'orange',function(v){ return int(v)+' · '+pct(v,lista.length); })+'</div>';
  h+='</div>';
  h+='<div class="panel"><h3>Detalhe por operador</h3><div class="panel-sub">"Reimpressões" conta RGs com mais de 2 impressões de etiqueta.</div>'+
    tabela('prod',[{k:'oper',rot:'Operador',fmt:function(r){ return esc(operNome(r.oper)); }},{k:'n',rot:'RGs',num:1,fmt:function(r){ return int(r.n); }},{k:'nd',rot:'Dias',num:1},{k:'media',rot:'Média/dia',num:1,fmt:function(r){ return int(r.media); }},{k:'valor',rot:'Valor',num:1,fmt:function(r){ return reais(r.valor); }},{k:'semCl',rot:'Sem classificação',num:1,fmt:function(r){ return r.semCl?'<span class="tag tag-bad">'+int(r.semCl)+'</span>':'0'; }},{k:'imp',rot:'Reimpressões',num:1}],arr)+
    '<p class="field-hint" style="margin-top:10px">Produtividade por hora ainda não entra: na QRY0100 o horário vem com defeito (o minuto repete a hora). Só o dia é confiável.</p></div>';
  return h;
}

function vClassificacao(){
  if(!S.rgs.length) return vazio('Nenhum RG importado','Importe a <strong>QRY0100 (RG - Produtividade)</strong> do Bseller.');
  var ab=S.D.abertos, classes=conta(ab,function(r){ return r.classe||'—'; }).map(function(x){ return x[0]; });
  var m=new Map();
  ab.forEach(function(r){
    var k=r.classif||'', o=m.get(k); if(!o){ o={classif:k, n:0, valor:0, itens:new Set(), pc:{}}; m.set(k,o); }
    o.n++; o.valor+=r.preco; o.itens.add(r.item); o.pc[r.classe||'—']=(o.pc[r.classe||'—']||0)+1;
  });
  var arr=Array.from(m.values()).sort(function(a,b){ return b.n-a.n; });
  arr.forEach(function(o){ o.skus=o.itens.size; o.medio=o.n?o.valor/o.n:0; });
  var h='<div class="kpi-grid">'+arr.map(function(o){ return kpi(int(o.n), o.classif||'Sem classificação', pct(o.n,ab.length)+' · '+reais(o.valor), o.classif?'':'bad'); }).join('')+'</div>';
  var cols=[{k:'classif',rot:'Classificação',fmt:function(r){ return tagClassif(r.classif); }},{k:'n',rot:'RGs',num:1,fmt:function(r){ return int(r.n); }},{k:'part',rot:'%',num:1,val:function(r){ return r.n; },fmt:function(r){ return pct(r.n,ab.length); }},{k:'skus',rot:'Itens (SKU)',num:1},{k:'valor',rot:'Valor',num:1,fmt:function(r){ return reais(r.valor); }},{k:'medio',rot:'Preço médio',num:1,fmt:function(r){ return reais(r.medio); }}];
  classes.forEach(function(c){ cols.push({k:'c_'+c,rot:'Em '+c,num:1,val:function(r){ return r.pc[c]||0; },fmt:function(r){ return int(r.pc[c]||0); }}); });
  h+='<div class="panel"><h3>RGs abertos por classificação</h3><div class="panel-sub">Quantidade, valor e em qual classe de local as peças estão.</div>'+tabela('classif',cols,arr)+'</div>';
  h+='<div class="bi-grid-2">';
  h+='<div class="panel"><h3>Valor por classificação</h3><div class="panel-sub">Soma do preço das peças.</div>'+hbars(arr.map(function(o){ return [o.classif||'Sem classificação',o.valor]; }).sort(function(a,b){ return b[1]-a[1]; }),'',function(v){ return reais(v); })+'</div>';
  var itens=conta(ab,function(r){ return r.item; }).slice(0,10).map(function(x){ return [x[0]+' · '+(S.D.itemDesc.get(x[0])||''), x[1]]; });
  h+='<div class="panel"><h3>Itens com mais RGs</h3><div class="panel-sub">Os 10 itens que mais voltaram.</div>'+hbars(itens,'orange')+'</div>';
  h+='</div>';
  return h;
}

function faixaDe(n){ for(var i=0;i<FAIXAS.length;i++) if(n>=FAIXAS[i][0] && n<=FAIXAS[i][1]) return i; return FAIXAS.length-1; }
function vTempo(){
  if(!S.rgs.length && !S.est) return vazio('Nenhum relatório importado ainda','Importe os relatórios do Bseller para ver o tempo parado.');
  var h='', D=S.D;
  if(S.est){
    var m=new Map(), tot=FAIXAS.map(function(){ return 0; }), semData=0;
    D.cov.forEach(function(c){
      if(!c.saldo) return;
      if(c.dias==null){ semData+=c.saldo; return; }
      var o=m.get(c.classe); if(!o){ o={classe:c.classe, f:FAIXAS.map(function(){ return 0; }), total:0}; m.set(c.classe,o); }
      var i=faixaDe(c.dias); o.f[i]+=c.saldo; o.total+=c.saldo; tot[i]+=c.saldo;
    });
    var total=tot.reduce(function(a,b){ return a+b; },0), velho=tot[4]+tot[5];
    h+='<div class="kpi-grid">'+
      kpi(int(total),'Unidades na reversa','com data no Bseller')+
      kpi(int(tot[0]+tot[1]),'Até 15 dias', pct(tot[0]+tot[1],total),'good')+
      kpi(int(tot[2]+tot[3]),'De 16 a 60 dias', pct(tot[2]+tot[3],total),'warn')+
      kpi(int(velho),'Mais de 60 dias', pct(velho,total),'bad')+'</div>';
    h+='<div class="bi-grid-2"><div class="panel"><h3>Estoque da reversa por tempo no local</h3><div class="panel-sub">Unidades por faixa de dias, contados da "Data Situação" da QRY0390.</div>'+hbars(FAIXAS.map(function(fx,i){ return [fx[2],tot[i]]; }),'orange',function(v){ return int(v)+' · '+pct(v,total); })+'</div>';
    var cols=[{k:'classe',rot:'Classe',fmt:function(r){ return esc(classeNome(r.classe)); }}];
    FAIXAS.forEach(function(fx,i){ cols.push({k:'f'+i,rot:fx[2].replace(' dias',' d'),num:1,val:function(r){ return r.f[i]; },fmt:function(r){ return int(r.f[i]); }}); });
    cols.push({k:'total',rot:'Total',num:1,fmt:function(r){ return '<strong>'+int(r.total)+'</strong>'; }});
    h+='<div class="panel"><h3>Por classe de local</h3><div class="panel-sub">Unidades em cada faixa.</div>'+tabela('tclasse',cols,Array.from(m.values()).sort(function(a,b){ return b.total-a.total; }))+'</div></div>';
    if(!S.sort.velhos) S.sort.velhos={k:'dias',dir:-1};
    var velhos=D.cov.filter(function(c){ return c.saldo && c.dias!=null && c.dias>60; });
    h+='<div class="panel"><div class="panel-head-row"><h3>Peças paradas há mais de 60 dias</h3><button class="btn btn-primary" data-act="exporta-velhos">Exportar Excel</button></div><div class="panel-sub">'+int(velhos.length)+' linhas item × local · '+int(velhos.reduce(function(s,c){ return s+c.saldo; },0))+' unidades.</div>'+tabela('velhos',COLS_COV,velhos)+'</div>';
    h+='<p class="field-hint">O tempo usa a "Data Situação" da QRY0390 — a data mais antiga do item naquele local. Se no Bseller essa data significar outra coisa, me avise que eu ajusto.</p>';
  } else {
    h+='<div class="rg-aviso"><strong>Falta o estoque:</strong> importe a QRY0390 para ver o tempo parado de todo o estoque da reversa.</div>';
  }
  if(S.rgs.length){
    var tr=FAIXAS.map(function(){ return 0; });
    D.abertos.forEach(function(r){ var n=dias(r.dt); if(n!=null) tr[faixaDe(n)]++; });
    h+='<div class="panel" style="margin-top:16px"><h3>RGs abertos por idade</h3><div class="panel-sub">Dias desde a criação do RG.</div>'+hbars(FAIXAS.map(function(fx,i){ return [fx[2],tr[i]]; }),'',function(v){ return int(v)+' · '+pct(v,D.abertos.length); })+'</div>';
  }
  return h;
}

function vImportacao(){
  var rgDias=S.rgs.map(function(r){ return r.dt; }).filter(Boolean);
  var stRg = S.rgs.length ? '<span class="tag tag-good">Carregado</span> '+int(S.rgs.length)+' RGs'+(rgDias.length?' · de '+dataBR(Math.min.apply(null,rgDias))+' a '+dataBR(Math.max.apply(null,rgDias)):'') : '<span class="tag tag-muted">Ainda não importado</span>';
  var stEst = S.est ? '<span class="tag tag-good">Carregado</span> '+int(S.est.unidades)+' unidades na reversa · importado em '+dataHoraBR(S.est.em) : '<span class="tag tag-muted">Ainda não importado</span>';
  var h='';
  if(S.ocupado) h+='<div class="rg-aviso"><strong>Aguarde.</strong> '+esc(S.ocupado)+'</div>';
  h+='<div class="rg-imp-grid">'+
    '<div class="dropzone'+(S.rgs.length?' has-file':'')+'" data-act="escolher" data-drop="1" tabindex="0"><div class="dz-icon">🏷️</div><div class="dz-title">QRY0100 · RG - Produtividade</div><div class="dz-desc">Lista de RGs gerados. Cada importação <strong>soma</strong> os RGs novos e atualiza os que já existiam.</div><div class="rg-imp-st">'+stRg+'</div></div>'+
    '<div class="dropzone'+(S.est?' has-file':'')+'" data-act="escolher" data-drop="1" tabindex="0"><div class="dz-icon">📦</div><div class="dz-title">QRY0390 · Estoque por Local</div><div class="dz-desc">Foto do saldo. Cada importação <strong>substitui</strong> a anterior. O app guarda só as classes '+CLASSES_REVERSA.join(' e ')+'.</div><div class="rg-imp-st">'+stEst+'</div></div>'+
    '</div>';
  h+='<div class="panel"><h3>Como importar</h3><div class="panel-sub">Clique num dos quadros acima ou arraste os arquivos para cá. Pode soltar os dois de uma vez — o app reconhece cada relatório sozinho.</div>'+
    '<ol style="margin:0 0 4px 18px;line-height:1.9">'+
    '<li>No Bseller, exporte a <strong>QRY0100</strong> (RG - Produtividade) em Excel, pegando o período desde a última importação.</li>'+
    '<li>Exporte a <strong>QRY0390</strong> (Estoque por Local) em Excel, do jeito que sai (o CD inteiro).</li>'+
    '<li>Solte os dois arquivos aqui. Os dados ficam salvos neste navegador.</li></ol></div>';
  var log=leLog();
  h+='<div class="panel"><div class="panel-head-row"><h3>Histórico de importações</h3><div><button class="btn-danger-text" data-act="limpa-rgs">Apagar RGs</button> <button class="btn-danger-text" data-act="limpa-est">Apagar estoque</button></div></div>';
  if(!log.length) h+='<p class="field-hint">Nenhuma importação registrada neste navegador.</p>';
  else h+='<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Relatório</th><th>Arquivo</th><th>Resultado</th></tr></thead><tbody>'+log.map(function(l){ return '<tr><td>'+dataHoraBR(l.em)+'</td><td>'+esc(l.tipo)+'</td><td>'+esc(l.arquivo)+'</td><td>'+esc(l.resumo)+'</td></tr>'; }).join('')+'</tbody></table></div>';
  h+='</div>';
  return h;
}

var VIEWS={ painel:vPainel, rgs:vRgs, cobertura:vCobertura, produtividade:vProdutividade, classificacao:vClassificacao, tempo:vTempo, importacao:vImportacao };

function render(){
  var t=TABS[S.tab]; $('tabTitle').textContent=t[0]; $('tabSubtitle').textContent=t[1];
  Array.prototype.forEach.call(document.querySelectorAll('.nav-item[data-tab]'),function(b){ b.classList.toggle('active', b.dataset.tab===S.tab); });
  var badge=$('cycleBadge');
  if(S.rgs.length){ var ds=S.rgs.map(function(r){ return r.dt; }).filter(Boolean); badge.textContent=int(S.rgs.length)+' RGs'+(ds.length?' · até '+dataBR(Math.max.apply(null,ds)):''); }
  else badge.textContent='Sem dados';
  var h = (S.ocupado && S.tab!=='importacao') ? '<div class="rg-aviso"><strong>Aguarde.</strong> '+esc(S.ocupado)+'</div>' : '';
  $('viewRoot').innerHTML=h+VIEWS[S.tab]();
}
function vaiPara(tab){
  if(!TABS[tab]) return;
  S.tab=tab;
  try { history.replaceState(null,'','#'+tab); } catch(e){}
  $('sidebar').classList.remove('mobile-open');
  render();
  var sc=document.querySelector('.page-scroll'); if(sc) sc.scrollTop=0;
}
/* Refaz só a tabela enquanto a pessoa digita, para o campo de busca não perder o foco. */
function soTabela(){
  if(S.tab==='rgs'){ render.keep='fQ'; }
  if(S.tab==='cobertura'){ render.keep='fCobQ'; }
  var id=render.keep; render();
  var el=id && $(id);
  if(el){ el.focus(); var n=el.value.length; try { el.setSelectionRange(n,n); } catch(e){} }
  render.keep=null;
}

/* ---------- ficha do RG ---------- */
function abreFicha(rg){
  var r=S.rgs.filter(function(x){ return x.rg===rg; })[0]; if(!r) return;
  var c=function(rot,val){ return '<div><span>'+esc(rot)+'</span><b>'+(val==null||val===''?'—':val)+'</b></div>'; };
  var cov=S.D.cov.filter(function(x){ return x.item===r.item && x.local===r.local; })[0];
  $('rgModal').innerHTML='<div class="rg-ficha" role="dialog" aria-modal="true"><div class="rg-ficha-cab"><div><small>RG</small><strong>'+esc(r.rg)+'</strong></div><button type="button" data-act="fecha-ficha" aria-label="Fechar">×</button></div>'+
    '<div class="rg-ficha-corpo"><div class="rg-ficha-item">'+esc(r.item)+' · '+esc(descItem(r)||'Descrição não encontrada no estoque')+'</div><div class="rg-campos">'+
    c('Classificação',tagClassif(r.classif))+c('Situação',esc(r.sit))+
    c('Local atual',esc(descLocal(r.local))+' <small style="color:var(--ink-soft);font-weight:400">('+esc(r.local)+')</small>')+c('Classe do local',esc(classeNome(r.classe)))+
    c('Criado em',dataBR(r.dt)+(r.dt?' · há '+int(dias(r.dt))+' dia(s)':''))+c('Operador',esc(operNome(r.oper)))+
    c('EAN',esc(r.ean))+c('Preço',reais(r.preco))+
    c('Tipo de geração',esc(r.tipo))+c('Filial',esc(r.filial))+
    c('Entrega',esc(r.entrega))+c('Instância',esc(r.inst))+
    c('NR',esc(r.nr))+c('Impressões da etiqueta',int(r.imp))+
    (cov?c('Saldo do item nesse local',int(cov.saldo)+' un')+c('RGs do item nesse local',int(cov.rgs)):'')+
    '</div></div></div>';
  $('rgModal').hidden=false;
}
function fechaFicha(){ $('rgModal').hidden=true; $('rgModal').innerHTML=''; }

/* ---------- exportação ---------- */
function exporta(nome, cab, linhas){
  if(typeof XLSX==='undefined'){ toast('A exportação não carregou. Atualize a página.', true); return; }
  var ws=XLSX.utils.aoa_to_sheet([cab].concat(linhas));
  cab.forEach(function(_,i){
    var cel=ws[XLSX.utils.encode_cell({r:0,c:i})];
    if(cel) cel.s={font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'FE5000'}}};
  });
  ws['!cols']=cab.map(function(c){ return {wch:Math.max(12,String(c).length+4)}; });
  var wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Dados');
  var d=new Date();
  XLSX.writeFile(wb, nome+'_'+d.getFullYear()+d2(d.getMonth()+1)+d2(d.getDate())+'.xlsx');
}
function exportaRgs(){
  exporta('RG_Reversa_RGs',['RG','Criado em','Item','Descrição','EAN','Classificação','Classe Local','Local','Descrição Local','Operador','Preço','Idade (dias)','Situação'],
    rgsFiltrados().map(function(r){ return [r.rg,dataBR(r.dt),r.item,descItem(r),r.ean,r.classif,r.classe,r.local,descLocal(r.local),r.oper,r.preco,dias(r.dt),r.sit]; }));
}
function linhasCov(l){ return l.map(function(c){ return [c.item,c.desc,c.ean,c.classe,c.local,c.localDesc,c.saldo,c.rgs,c.semRg,c.rgSemSaldo,c.t?dataBR(c.t):'',c.dias,c.restr]; }); }
var CAB_COV=['Item','Descrição','EAN','Classe Local','Local','Descrição Local','Saldo','RGs','Sem RG','RG sem saldo','Data Situação','Dias no local','Restrição'];

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
  if(a==='ordena'){ var id=el.dataset.tb, k=el.dataset.k, st=S.sort[id]; S.sort[id]={k:k, dir: st && st.k===k ? -st.dir : 1}; return render(); }
  if(a==='mais'){ S.lim[el.dataset.tb]=(S.lim[el.dataset.tb]||PAGINA)+PAGINA; return render(); }
  if(a==='ficha') return abreFicha(el.dataset.rg);
  if(a==='fecha-ficha') return fechaFicha();
  if(a==='escolher') return $('fileInput').click();
  if(a==='cob-modo'){ S.f.cobModo=el.dataset.m; S.sort.cov=null; S.lim.cov=PAGINA; return render(); }
  if(a==='limpa-filtros'){ S.f.q=''; S.f.classif=''; S.f.classe=''; S.f.oper=''; S.f.sit=''; $('globalSearch').value=''; return render(); }
  if(a==='exporta-rgs') return exportaRgs();
  if(a==='exporta-cov') return exporta('RG_Reversa_Estoque_x_RG', CAB_COV, linhasCov(covFiltrada()));
  if(a==='exporta-velhos') return exporta('RG_Reversa_Parados_60d', CAB_COV, linhasCov(S.D.cov.filter(function(c){ return c.saldo && c.dias!=null && c.dias>60; })));
  if(a==='limpa-rgs'){
    if(!S.rgs.length || !confirm('Apagar todos os '+int(S.rgs.length)+' RGs guardados neste navegador? Depois é só importar a QRY0100 de novo.')) return;
    S.rgs=[]; dbSet('rgs',[]); gravaLog({em:Date.now(),tipo:'QRY0100 · RG',arquivo:'—',resumo:'Base de RGs apagada'}); deriva(); render(); return toast('RGs apagados.');
  }
  if(a==='limpa-est'){
    if(!S.est || !confirm('Apagar o estoque por local guardado neste navegador? Depois é só importar a QRY0390 de novo.')) return;
    S.est=null; dbSet('est',null); gravaLog({em:Date.now(),tipo:'QRY0390 · Estoque',arquivo:'—',resumo:'Estoque apagado'}); deriva(); render(); return toast('Estoque apagado.');
  }
}

function inicia(){
  aplicaTema(temaEscuro());
  aplicaZoom(zoomAtual());
  var v=$('sidebarVersao');
  if(v && window.LDM_BUILD && window.LDM_BUILD.data && window.LDM_BUILD.data!=='—') v.textContent='Atualizado em '+window.LDM_BUILD.data;

  document.addEventListener('click', function(ev){
    var nav=ev.target.closest('.nav-item[data-tab]');
    if(nav) return vaiPara(nav.dataset.tab);
    if(ev.target.id==='rgModal') return fechaFicha();
    var el=ev.target.closest('[data-act]');
    if(el) acao(el, ev);
  });
  document.addEventListener('keydown', function(ev){
    if(ev.key==='Escape' && !$('rgModal').hidden) fechaFicha();
    if((ev.key==='Enter' || ev.key===' ') && ev.target.matches && ev.target.matches('.dropzone[data-act]')){ ev.preventDefault(); $('fileInput').click(); }
  });
  document.addEventListener('change', function(ev){
    var t=ev.target;
    if(t.id==='fileInput'){ importar(t.files); t.value=''; return; }
    if(t.dataset && t.dataset.f){ S.f[t.dataset.f]=t.value; S.lim={}; render(); }
  });
  var espera;
  document.addEventListener('input', function(ev){
    var t=ev.target;
    if(t.id==='fQ' || t.id==='fCobQ' || t.id==='globalSearch'){
      clearTimeout(espera);
      espera=setTimeout(function(){
        if(t.id==='fCobQ'){ S.f.cobQ=t.value; S.lim.cov=PAGINA; soTabela(); return; }
        S.f.q=t.value; S.lim.rgs=PAGINA;
        if(t.id==='globalSearch'){ if(S.tab!=='rgs'){ S.tab='rgs'; try { history.replaceState(null,'','#rgs'); } catch(e){} } render(); }
        else { $('globalSearch').value=t.value; soTabela(); }
      }, 220);
    }
  });
  /* Arrastar e soltar em qualquer lugar da tela. */
  ['dragenter','dragover'].forEach(function(n){ document.addEventListener(n,function(ev){ if(ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types||[],'Files')>=0){ ev.preventDefault(); Array.prototype.forEach.call(document.querySelectorAll('.dropzone[data-drop]'),function(d){ d.classList.add('over'); }); } }); });
  ['dragleave','drop'].forEach(function(n){ document.addEventListener(n,function(){ Array.prototype.forEach.call(document.querySelectorAll('.dropzone.over'),function(d){ d.classList.remove('over'); }); }); });
  document.addEventListener('drop', function(ev){
    if(ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length){ ev.preventDefault(); importar(ev.dataTransfer.files); }
  });
  $('brandLogo').addEventListener('click', function(){ this.classList.remove('spin'); void this.offsetWidth; this.classList.add('spin'); });

  var h=''; try { h=decodeURIComponent(location.hash.slice(1)); } catch(e){}
  if(TABS[h]) S.tab=h;
  deriva();
  Promise.all([dbGet('rgs'), dbGet('est')]).then(function(r){
    S.rgs=Array.isArray(r[0]) ? r[0] : [];
    S.est=r[1] && r[1].rows ? r[1] : null;
  }).catch(function(){ toast('Não consegui abrir os dados salvos neste navegador.', true); }).then(function(){ deriva(); render(); });
}
inicia();
})();
