/* =========================================================================
   Aba NET — painel do FLUXO AUTOMÁTICO (não é o fechamento da controladoria).
   -------------------------------------------------------------------------
   Os dados vêm da base QRY410 que o Inventário Rotativo guarda na nuvem, já
   resumida pelo servidor (net_fluxo: mês × item × depósito × observação) e, para
   os itens mais divergentes, com os lançamentos de cada um (net_fluxo_linhas).
   O fechamento da controladoria continua saindo SÓ da base importada à mão.

   Como o NET do mês é aberto (tudo em R$, a soma fecha no NET):
   - Do próprio mês: ganho novo e perda nova — itens que não tinham perda/ganho
     em aberto de meses anteriores.
   - De meses anteriores: devolve perda (o item perdeu antes e agora voltou) e
     estorna ganho (o item ganhou antes e agora saiu). Cada centavo é ligado ao
     mês de origem, do mais antigo para o mais novo (PEPS).
   ========================================================================= */
(function(){
'use strict';
var API = window.NET_API;
var COR = {gn:'#001A72', pn:'#C0392B', dev:'#FE5000', est:'#E7A096'};
var ST = {dados:null, calc:null, carregando:false, erro:null, mes:null, ord:'valor', em:null, pronto:false, quer:false, det:{}, detBusca:{}};
var FLUID = {};

function $(id){ return document.getElementById(id); }
function esc(s){ return API.esc(s); }
var fBRL = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
var fInt = new Intl.NumberFormat('pt-BR');
function brl(v){ return fBRL.format(v||0); }
function sgn(v){ return (v>0.004?'+':'')+brl(v); }
function cor(v){ return v<0 ? '#D83C1E' : '#1F8A52'; }
function compacto(v){
  var a = Math.abs(v), s = v<0 ? '-' : '+';
  if(a>=1e6) return s+(a/1e6).toFixed(1).replace('.',',')+' mi';
  if(a>=1e3) return s+(a/1e3).toFixed(1).replace('.',',')+' mil';
  return s+Math.round(a);
}
var MES3 = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
function mesCurto(m){ return MES3[+m.slice(5,7)-1]; }
function mesChip(m){ return MES3[+m.slice(5,7)-1]+'/'+m.slice(2,4); }
function mesLongo(m){ return API.MESES[+m.slice(5,7)-1]; }
function origens(mapa, max){
  var e = Object.keys(mapa).filter(function(k){ return Math.abs(mapa[k])>0.5; }).sort(function(a,b){ return mapa[b]-mapa[a]; });
  if(!e.length) return '';
  var t = e.slice(0, max||3).map(function(k){ return mesChip(k)+' '+compacto(Math.abs(mapa[k])).replace(/^[+-]/,''); }).join(' · ');
  return t + (e.length>(max||3) ? ' · +'+(e.length-(max||3)) : '');
}
function soma(o, k, v){ o[k] = (o[k]||0) + v; }

/* ---------- cálculo ---------- */
function calcula(){
  var D = ST.dados || {}, meses = D.meses || [], itens = D.itens || [], deps = D.depositos || [], obs = D.obs || [];
  var NM = meses.length;
  var cls = obs.map(function(o){ return API.classifica(o); });
  var M = meses.map(function(m){
    return {mes:m, net:0, g:0, p:0, gn:0, pn:0, dev:0, est:0, nGn:0, nPn:0, nDev:0, nEst:0, oDev:{}, oEst:{}, mot:{}, dep:{}, itens:[]};
  });
  var porItem = new Map();
  (D.linhas || []).forEach(function(t){
    var c = cls[t[3]-1]; if(!c || !c.considerar) return;
    var m = t[0]-1, i = t[1]-1, gp = t[4], pp = t[5], q = t[6], n = gp+pp;
    var mm = M[m];
    var mo = mm.mot[c.prefixo] || (mm.mot[c.prefixo] = {id:c.prefixo, legenda:c.legenda, g:0, p:0});
    mo.g += gp; mo.p += pp;
    var dn = deps[t[2]-1] || '';
    var dp = mm.dep[dn] || (mm.dep[dn] = {rot:dn, g:0, p:0});
    dp.g += gp; dp.p += pp;
    mm.g += gp; mm.p += pp;
    var a = porItem.get(i);
    if(!a){ a = {n:new Float64Array(NM), q:new Float64Array(NM)}; porItem.set(i, a); }
    a.n[m] += n; a.q[m] += q;
  });
  porItem.forEach(function(a, i){
    var fila = []; // posições em aberto do item: {m, v} (mesmo sinal)
    for(var m=0; m<NM; m++){
      var n = a.n[m];
      if(Math.abs(n) < 0.005) continue;
      var rem = n, comp = 0, orig = {};
      if(n > 0){
        while(rem > 0.005 && fila.length && fila[0].v < 0){
          var t1 = Math.min(rem, -fila[0].v); comp += t1; soma(orig, meses[fila[0].m], t1);
          fila[0].v += t1; rem -= t1; if(fila[0].v > -0.005) fila.shift();
        }
      } else {
        while(rem < -0.005 && fila.length && fila[0].v > 0){
          var t2 = Math.min(-rem, fila[0].v); comp -= t2; soma(orig, meses[fila[0].m], t2);
          fila[0].v -= t2; rem += t2; if(fila[0].v < 0.005) fila.shift();
        }
      }
      if(Math.abs(rem) > 0.005) fila.push({m:m, v:rem});
      var real = n - comp, mm = M[m];
      mm.net += n;
      if(real > 0.005){ mm.gn += real; mm.nGn++; } else if(real < -0.005){ mm.pn += real; mm.nPn++; }
      if(comp > 0.005){ mm.dev += comp; mm.nDev++; Object.keys(orig).forEach(function(k){ soma(mm.oDev, k, orig[k]); }); }
      else if(comp < -0.005){ mm.est += comp; mm.nEst++; Object.keys(orig).forEach(function(k){ soma(mm.oEst, k, orig[k]); }); }
      mm.itens.push({i:i, n:n, q:a.q[m], real:real, comp:comp, orig:orig});
    }
  });
  ST.calc = {meses:M, itens:itens, nomes:D.nomes || {}, semDeposito: deps.length<=1 && (deps[0]||'')===''};
  if(!ST.mes || !meses.includes(ST.mes)) ST.mes = meses.length ? meses[meses.length-1] : null;
}

/* ---------- gráficos que desenham na largura real do painel ---------- */
function fluid(key, build, altura){
  FLUID[key] = build;
  return '<div class="nd-fluid" data-k="'+key+'" style="min-height:'+altura+'px">'+build(720)+'</div>';
}
function ajusta(){
  var vr = $('nd-corpo'); if(!vr) return;
  vr.querySelectorAll('.nd-fluid').forEach(function(el){
    var b = FLUID[el.dataset.k], w = Math.floor(el.clientWidth);
    if(!b || w < 200 || String(w) === el.dataset.w) return;
    el.dataset.w = w; el.innerHTML = b(w);
  });
}
var tAj = null;
window.addEventListener('resize', function(){ clearTimeout(tAj); tAj = setTimeout(ajusta, 60); });

function svgMensal(W){
  var C = ST.calc, sel = ST.mes;
  var rows = C.meses.slice(-12);
  var H = 390, padL = 6, padR = 6, padT = 38, padB = 26, n = Math.max(1, rows.length);
  var cw = (W-padL-padR)/n, bw = Math.min(54, cw*.62);
  var mx = Math.max(1, Math.max.apply(null, rows.map(function(m){ return Math.max(m.gn+m.dev, -(m.pn+m.est)); })));
  var base = padT + (H-padT-padB)/2, half = (H-padT-padB)/2 - 4;
  function sc(v){ return Math.abs(v)/mx*half; }
  var g = '<line x1="'+padL+'" x2="'+(W-padR)+'" y1="'+base+'" y2="'+base+'" stroke="currentColor" opacity=".25"/>';
  rows.forEach(function(m,i){
    var cx = padL + (i+.5)*cw, x = cx-bw/2, on = m.mes === sel;
    var hg = sc(m.gn), hr = sc(m.dev), hp = sc(m.pn), hd = sc(m.est);
    g += '<g class="nd-col" data-m="'+m.mes+'" style="cursor:pointer"><title>'+esc(mesLongo(m.mes))+' · NET '+esc(sgn(m.net))+'</title>'
      + '<rect x="'+(cx-cw/2+1)+'" y="'+(padT-26)+'" width="'+(cw-2)+'" height="'+(H-padT-padB+30)+'" rx="9" fill="'+(on?'rgba(254,80,0,.10)':'transparent')+'"/>'
      + '<rect x="'+x+'" y="'+(base-hg)+'" width="'+bw+'" height="'+hg+'" rx="3" fill="'+COR.gn+'"/>'
      + '<rect x="'+x+'" y="'+(base-hg-hr)+'" width="'+bw+'" height="'+hr+'" rx="3" fill="'+COR.dev+'"/>'
      + '<rect x="'+x+'" y="'+base+'" width="'+bw+'" height="'+hp+'" rx="3" fill="'+COR.pn+'"/>'
      + '<rect x="'+x+'" y="'+(base+hp)+'" width="'+bw+'" height="'+hd+'" rx="3" fill="'+COR.est+'"/>'
      + '<path d="M'+cx+' '+(base-(m.net>=0?1:-1)*sc(m.net)-6)+' l6 6 l-6 6 l-6 -6 Z" fill="#fff" stroke="#0B1230" stroke-width="2"/>'
      + '<text x="'+cx+'" y="'+(padT-14)+'" text-anchor="middle" font-size="'+(cw<62?11:12.5)+'" font-weight="800" fill="'+cor(m.net)+'">'+esc(compacto(m.net))+'</text>'
      + '<text x="'+cx+'" y="'+(H-7)+'" text-anchor="middle" font-size="12" font-weight="'+(on?800:600)+'" fill="currentColor" opacity="'+(on?1:.6)+'">'+mesCurto(m.mes)+'</text>'
      + '</g>';
  });
  return '<svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" style="display:block">'+g+'</svg>';
}

/* ---------- peças da tela ---------- */
function kpi(c, rot, val, sub, extra){
  return '<div class="nd-k '+(extra||'')+'" style="--c:'+c+'"><span class="nd-k-rot">'+rot+'</span><strong>'+val+'</strong>'+(sub?'<span class="nd-k-sub">'+sub+'</span>':'')+'</div>';
}
function nIt(n){ return fInt.format(n)+(n===1?' item':' itens'); }
/* NET aberto em 2 grupos que somam o total */
function estrLinha(rot, v, max, cl, n, extra){
  var w = Math.min(50, Math.abs(v)/max*50);
  var est = v>=0 ? 'left:50%;width:'+w+'%;' : 'left:'+(50-w)+'%;width:'+w+'%;';
  return '<div class="nd-row '+(extra||'')+'"><div class="nd-lab">'+rot+(n!=null?'<span class="nd-n">'+nIt(n)+'</span>':'')+'</div>'
    + '<div class="nd-trk"><i style="'+est+'background:'+cl+'"></i></div>'
    + '<div class="nd-val" style="color:'+cor(v)+'">'+sgn(v)+'</div></div>';
}
function estratificacao(m){
  var max = Math.max(1, Math.abs(m.gn), Math.abs(m.pn), Math.abs(m.dev), Math.abs(m.est), Math.abs(m.net));
  var proprio = m.gn + m.pn, anterior = m.dev + m.est;
  return '<div class="nd-sub">Do próprio mês</div>'
    + estrLinha('Ganho novo', m.gn, max, COR.gn, m.nGn)
    + estrLinha('Perda nova', m.pn, max, COR.pn, m.nPn)
    + estrLinha('Subtotal do mês', proprio, max, '#5B6485', null, 'nd-subt')
    + '<div class="nd-sub">De meses anteriores</div>'
    + estrLinha('Devolve perda', m.dev, max, COR.dev, m.nDev)
    + estrLinha('Estorna ganho', m.est, max, COR.est, m.nEst)
    + estrLinha('Subtotal anteriores', anterior, max, '#5B6485', null, 'nd-subt')
    + estrLinha('= NET', m.net, max, '#0B1230', null, 'nd-tot');
}
/* perda / ganho / NET, com a barra do NET e cabeçalho dizendo o lado de cada coisa */
function tabelaPG(mapa, max, vazio, nomeFn){
  var arr = Object.keys(mapa).map(function(k){ var o = mapa[k]; return {rot:nomeFn(o), g:o.g, p:o.p, v:o.g+o.p}; })
    .filter(function(x){ return Math.abs(x.g) >= 0.5 || Math.abs(x.p) >= 0.5; })
    .sort(function(a,b){ return Math.abs(b.v)-Math.abs(a.v); });
  if(!arr.length) return '<div class="nd-vazio">'+vazio+'</div>';
  var top = arr.slice(0, max);
  if(arr.length > max){
    var r = arr.slice(max).reduce(function(s,x){ s.g += x.g; s.p += x.p; s.v += x.v; return s; }, {rot:'Outros', g:0, p:0, v:0});
    top.push(r);
  }
  var mx = Math.max(1, Math.max.apply(null, top.map(function(x){ return Math.abs(x.v); })));
  var tot = top.reduce(function(s,x){ s.g += x.g; s.p += x.p; s.v += x.v; return s; }, {g:0, p:0, v:0});
  function lin(x, extra){
    var w = Math.min(50, Math.abs(x.v)/mx*50);
    var est = x.v>=0 ? 'left:50%;width:'+w+'%;' : 'left:'+(50-w)+'%;width:'+w+'%;';
    return '<div class="nd-pg '+(extra||'')+'"><div class="nd-lab">'+x.rot+'</div>'
      + '<div class="nd-trk"><i style="'+est+'background:'+(x.v<0?COR.pn:COR.gn)+'"></i></div>'
      + '<div class="nd-pn">'+brl(x.p)+'</div><div class="nd-gn">'+sgn(x.g)+'</div>'
      + '<div class="nd-val" style="color:'+cor(x.v)+'">'+sgn(x.v)+'</div></div>';
  }
  return '<div class="nd-pg nd-pg-h"><div></div><div class="nd-trk-h"><span style="color:'+COR.pn+'">◀ perda</span><span style="color:'+COR.gn+'">ganho ▶</span></div><div>Perda</div><div>Ganho</div><div>NET</div></div>'
    + top.map(function(x){ return lin(x); }).join('')
    + lin({rot:'Total', g:tot.g, p:tot.p, v:tot.v}, 'nd-pg-t');
}
/* itens: fatos de cada lançamento (observação, documento, usuário, data, depto) */
function dataBr(dh, dt){
  var s = String(dh || dt || '');
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if(!m) return '';
  return m[3]+'/'+m[2]+(m[4] && (m[4]!=='00' || m[5]!=='00') ? ' '+m[4]+':'+m[5] : '');
}
function fatos(cod){
  var L = ST.det[ST.mes+'|'+cod];
  if(!L) return '<span class="nd-f nd-f-pend">carregando lançamento…</span>';
  var cs = L.filter(function(l){ return API.classifica(l.obs).considerar; });
  if(!cs.length) cs = L;
  if(!cs.length) return '<span class="nd-f nd-f-pend">sem lançamento</span>';
  var l = cs[0], c = API.classifica(l.obs);
  var us = String(l.usuario||'').replace(/^MECA_/,'');
  var out = '<span class="nd-f nd-f-o" title="'+esc(l.obs)+'"><b>'+esc(c.prefixo)+'</b>'+(c.legenda?' '+esc(c.legenda):'')+'</span>'
    + (l.doc ? '<span class="nd-f">Doc '+esc(l.doc)+'</span>' : '')
    + (us ? '<span class="nd-f">'+esc(us)+'</span>' : '')
    + (dataBr(l.dh, l.dt) ? '<span class="nd-f">'+dataBr(l.dh, l.dt)+'</span>' : '')
    + (l.deposito ? '<span class="nd-f">'+esc(l.deposito)+'</span>' : '')
    + (l.depto ? '<span class="nd-f">'+esc(l.depto)+'</span>' : '');
  if(cs.length > 1) out += '<span class="nd-f nd-f-mais">+'+(cs.length-1)+' lançamento'+(cs.length>2?'s':'')+'</span>';
  return out;
}
function listaItens(m, sinal){
  var ord = ST.ord;
  var lista = m.itens.filter(function(x){ return sinal<0 ? x.n < -0.5 : x.n > 0.5; });
  lista.sort(function(a,b){ return ord==='pecas' ? Math.abs(b.q)-Math.abs(a.q) : Math.abs(b.n)-Math.abs(a.n); });
  return lista.slice(0, 8);
}
function renderItens(lista){
  var C = ST.calc;
  if(!lista.length) return '<div class="nd-vazio">Sem itens</div>';
  return lista.map(function(x){
    var cod = C.itens[x.i] || '', nome = C.nomes[cod] || '';
    var unit = Math.abs(x.q) > 0.5 ? Math.abs(x.n/x.q) : null;
    var orig = Math.abs(x.comp) > 0.5 ? '<span class="nd-f nd-f-c" style="--c:'+(x.comp>0?COR.dev:COR.est)+'">'+(x.comp>0?'devolve perda de ':'estorna ganho de ')+esc(origens(x.orig, 3))+'</span>' : '';
    return '<div class="nd-it"><div class="nd-it-n"><div class="nd-it-t"><b>'+esc(cod)+'</b>'+esc(nome)+'</div>'
      + '<div class="nd-fs">'+fatos(cod)+orig+'</div></div>'
      + '<div class="nd-it-q">'+fInt.format(Math.round(x.q))+' pç</div>'
      + '<div class="nd-it-u">'+(unit!=null ? brl(unit)+'<small>/pç</small>' : '—')+'</div>'
      + '<div class="nd-it-v" style="color:'+cor(x.n)+'">'+sgn(x.n)+'</div></div>';
  }).join('');
}

/* ---------- tela ---------- */
function desenha(){
  var corpo = $('nd-corpo'), chips = $('nd-chips'), em = $('nd-em');
  if(!corpo) return;
  if(em) em.textContent = ST.em ? 'atualizado '+ST.em.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '';
  if(ST.carregando && !ST.calc){
    corpo.innerHTML = '<div class="nd-kpis"><div class="nd-skel"></div><div class="nd-skel"></div><div class="nd-skel"></div><div class="nd-skel"></div><div class="nd-skel"></div></div><div class="nd-grid nd-g2"><div class="nd-skel" style="height:340px"></div><div class="nd-skel" style="height:340px"></div></div>';
    if(chips) chips.innerHTML = '';
    return;
  }
  if(ST.erro){
    var falta = /net_fluxo|PGRST202|does not exist/i.test(ST.erro);
    corpo.innerHTML = '<div class="painel"><div class="nd-vazio"><b>'+(falta ? 'Falta ativar o painel no Supabase' : 'Não foi possível carregar o fluxo')+'</b>'
      + (falta ? 'Rode o arquivo supabase-acessos/migrations/009_net_fluxo.sql no SQL Editor.' : esc(ST.erro))+'</div></div>';
    if(chips) chips.innerHTML = '';
    return;
  }
  var C = ST.calc;
  if(!C || !C.meses.length){
    corpo.innerHTML = '<div class="painel"><div class="nd-vazio"><b>Sem dados do fluxo</b>Importe a QRY410 no Inventário Rotativo.</div></div>';
    if(chips) chips.innerHTML = '';
    return;
  }
  var idx = C.meses.findIndex(function(x){ return x.mes === ST.mes; });
  var m = C.meses[idx], ant = idx>0 ? C.meses[idx-1] : null;
  if(chips) chips.innerHTML = C.meses.slice(-12).map(function(x){
    return '<button type="button" class="mes-chip'+(x.mes===ST.mes?' on':'')+'" data-nd-mes="'+x.mes+'">'+mesChip(x.mes)+'</button>';
  }).join('');
  var dep = C.semDeposito
    ? '<div class="nd-vazio"><b>Depósito indisponível</b>Reimporte a QRY410 no Inventário.</div>'
    : tabelaPG(m.dep, 8, 'Sem movimento', function(o){ return esc(o.rot || '(sem depósito)'); });
  var mot = tabelaPG(m.mot, 9, 'Sem movimento', function(o){ return '<b>'+esc(o.id)+'</b>'+esc(o.legenda||''); });
  var lp = listaItens(m, -1), lg = listaItens(m, 1);
  corpo.innerHTML =
    '<div class="nd-kpis">'
    + kpi('var(--orange)', 'NET de '+esc(mesLongo(m.mes)), sgn(m.net), ant ? sgn(m.net-ant.net)+' vs '+mesCurto(ant.mes) : '', 'nd-net '+(m.net<0?'neg':'pos'))
    + kpi(COR.gn, 'Ganho novo', sgn(m.gn), nIt(m.nGn)+' sem perda anterior')
    + kpi(COR.pn, 'Perda nova', sgn(m.pn), nIt(m.nPn)+' sem ganho anterior')
    + kpi(COR.dev, 'Devolve perda anterior', sgn(m.dev), nIt(m.nDev)+(origens(m.oDev,2)?' · '+origens(m.oDev,2):''))
    + kpi(COR.est, 'Estorna ganho anterior', sgn(m.est), nIt(m.nEst)+(origens(m.oEst,2)?' · '+origens(m.oEst,2):''))
    + '</div>'
    + '<div class="nd-grid nd-g2">'
    + '<div class="painel nd-p"><h3>NET mensal <small>clique num mês</small></h3>'+fluid('mensal', svgMensal, 390)
    + '<div class="nd-leg"><span><i style="background:'+COR.gn+'"></i>Ganho novo</span><span><i style="background:'+COR.dev+'"></i>Devolve perda anterior</span><span><i style="background:'+COR.pn+'"></i>Perda nova</span><span><i style="background:'+COR.est+'"></i>Estorna ganho anterior</span><span>◆ NET</span></div></div>'
    + '<div class="painel nd-p nd-estr"><h3>NET aberto <small>'+esc(mesLongo(m.mes))+'</small></h3><div class="nd-estr-c">'+estratificacao(m)+'</div></div>'
    + '</div>'
    + '<div class="nd-grid nd-g3">'
    + '<div class="painel nd-p"><h3>NET por motivo <small>'+esc(mesLongo(m.mes))+'</small></h3>'+mot+'</div>'
    + '<div class="painel nd-p"><h3>NET por depósito <small>'+esc(mesLongo(m.mes))+'</small></h3>'+dep+'</div>'
    + '</div>'
    + '<div class="painel nd-p" style="margin-top:14px"><h3>Itens mais divergentes <small><span class="nd-ord"><button type="button" data-nd-ord="valor" class="'+(ST.ord==='valor'?'on':'')+'">Valor</button><button type="button" data-nd-ord="pecas" class="'+(ST.ord==='pecas'?'on':'')+'">Peças</button></span></small></h3>'
    + '<div class="nd-grid nd-g3" style="margin:0"><div><div class="nd-k-rot nd-it-h" style="color:'+COR.pn+'">Perdas</div>'+renderItens(lp)+'</div>'
    + '<div><div class="nd-k-rot nd-it-h" style="color:'+COR.gn+'">Ganhos</div>'+renderItens(lg)+'</div></div></div>';
  ajusta();
  buscaFatos(lp.concat(lg));
}

/* lançamentos dos itens listados (documento, usuário, data, observação) */
async function buscaFatos(lista){
  var C = ST.calc, mes = ST.mes;
  var cods = lista.map(function(x){ return C.itens[x.i]; }).filter(function(c){ return c && !ST.det[mes+'|'+c] && !ST.detBusca[mes+'|'+c]; });
  if(!cods.length) return;
  cods.forEach(function(c){ ST.detBusca[mes+'|'+c] = 1; });
  try {
    var r = await window.ldmSupa.rpc('net_fluxo_linhas', {p_mes:mes, p_itens:cods});
    if(r.error) throw r.error;
    var porCod = {};
    (r.data || []).forEach(function(l){ (porCod[l.item] = porCod[l.item] || []).push(l); });
    cods.forEach(function(c){ ST.det[mes+'|'+c] = porCod[c] || []; });
  } catch(e){
    cods.forEach(function(c){ ST.det[mes+'|'+c] = []; delete ST.detBusca[mes+'|'+c]; });
  }
  if(ST.mes === mes) desenha();
}

async function carregar(forcar){
  if(ST.carregando) return;
  if(ST.calc && !forcar){ desenha(); return; }
  ST.carregando = true; ST.erro = null; if(forcar){ ST.det = {}; ST.detBusca = {}; } desenha();
  try {
    var r = await window.ldmSupa.rpc('net_fluxo');
    if(r.error) throw r.error;
    ST.dados = r.data; calcula(); ST.em = new Date();
  } catch(e){ ST.erro = (e && (e.message || e.details)) || String(e); }
  ST.carregando = false; desenha();
}

document.addEventListener('click', function(e){
  var c = e.target.closest('[data-nd-mes]'); if(c){ ST.mes = c.dataset.ndMes; desenha(); return; }
  var g = e.target.closest('.nd-col'); if(g){ ST.mes = g.dataset.m; desenha(); return; }
  var o = e.target.closest('[data-nd-ord]'); if(o){ ST.ord = o.dataset.ndOrd; desenha(); return; }
  if(e.target.closest('#nd-atualizar')){ carregar(true); }
});

window.NETDASH = {
  abrir: function(){ ST.quer = true; if(ST.pronto) carregar(false); },
  pronto: function(){ ST.pronto = true; if(ST.quer) carregar(false); },
  redesenha: function(){ if(ST.calc){ calcula(); desenha(); } }
};
})();
