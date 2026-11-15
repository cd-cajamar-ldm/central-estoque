/* =========================================================================
   Aba NET — painel do FLUXO AUTOMÁTICO (não é o fechamento da controladoria).
   -------------------------------------------------------------------------
   Os dados vêm da base QRY410 que o Inventário Rotativo guarda na nuvem, já
   resumida pelo servidor (net_fluxo: mês × item × depósito × observação) e, para
   os itens mais divergentes, com os lançamentos de cada um (net_fluxo_linhas).
   O fechamento da controladoria continua saindo SÓ da base importada à mão.

   Tudo é fato, em R$: NET = soma dos lançamentos que entram no NET (Lógica 301
   e 302, legenda "considerar NET"). Cada observação (código de 3 letras) aparece
   uma vez só e as observações são agrupadas pelo que significam:
   Inventário, Fora de ciclo, Auditoria, Reversa e Outros.
   O teto anual (R$ 525 mil) é comparado com o NET acumulado do ano.
   ========================================================================= */
(function(){
'use strict';
var API = window.NET_API;
var GRUPOS = [
  {id:'inv', nome:'Inventário',    cor:'#001A72', obs:['AIR','AIC','AIP','AIT','AII']},
  {id:'fc',  nome:'Fora de ciclo', cor:'#FE5000', obs:['AIN','AEE']},
  {id:'aud', nome:'Auditoria',     cor:'#7B5EA7', obs:['ADE','AUD']},
  {id:'rev', nome:'Reversa',       cor:'#0E9AA7', obs:['INV','PAR','API']},
  {id:'out', nome:'Outros',        cor:'#9AA1BD', obs:[]}
];
var GRUPO_DE = {};
GRUPOS.forEach(function(g){ g.obs.forEach(function(o){ GRUPO_DE[o] = g; }); });
function grupoDe(cod){ return GRUPO_DE[String(cod).toUpperCase()] || GRUPOS[GRUPOS.length-1]; }
var COR = {pn:'#C0392B', gn:'#001A72'};
var TETO_KEY = 'ldm-net-teto';
var ST = {dados:null, calc:null, carregando:false, erro:null, mes:null, ord:'valor', em:null, pronto:false, quer:false, det:{}, detBusca:{}, teto:525000};
try { var t0 = parseFloat(localStorage.getItem(TETO_KEY)); if(t0 > 0) ST.teto = t0; } catch(e){}
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
function pct(v, base){ return base ? (v/base*100).toFixed(1).replace('.',',')+'%' : '—'; }
var MES3 = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
function mesCurto(m){ return MES3[+m.slice(5,7)-1]; }
function mesChip(m){ return MES3[+m.slice(5,7)-1]+'/'+m.slice(2,4); }
function mesLongo(m){ return API.MESES[+m.slice(5,7)-1]; }

/* ---------- cálculo ---------- */
function calcula(){
  var D = ST.dados || {}, meses = D.meses || [], itens = D.itens || [], deps = D.depositos || [], obs = D.obs || [];
  var NM = meses.length;
  var cls = obs.map(function(o){ return API.classifica(o); });
  var M = meses.map(function(m){ return {mes:m, net:0, g:0, p:0, mot:{}, dep:{}, itens:[]}; });
  var porItem = new Map();
  (D.linhas || []).forEach(function(t){
    var c = cls[t[3]-1]; if(!c || !c.considerar) return;
    var m = t[0]-1, i = t[1]-1, gp = t[4], pp = t[5], q = t[6];
    var mm = M[m];
    var mo = mm.mot[c.prefixo] || (mm.mot[c.prefixo] = {id:c.prefixo, legenda:c.legenda, g:0, p:0});
    mo.g += gp; mo.p += pp;
    var dn = deps[t[2]-1] || '';
    var dp = mm.dep[dn] || (mm.dep[dn] = {rot:dn, g:0, p:0});
    dp.g += gp; dp.p += pp;
    mm.g += gp; mm.p += pp; mm.net += gp+pp;
    var a = porItem.get(i);
    if(!a){ a = {n:new Float64Array(NM), q:new Float64Array(NM)}; porItem.set(i, a); }
    a.n[m] += gp+pp; a.q[m] += q;
  });
  porItem.forEach(function(a, i){
    for(var m=0; m<NM; m++){ if(Math.abs(a.n[m]) >= 0.005) M[m].itens.push({i:i, n:a.n[m], q:a.q[m]}); }
  });
  ST.calc = {meses:M, itens:itens, nomes:D.nomes || {}, semDeposito: deps.length<=1 && (deps[0]||'')===''};
  if(!ST.mes || !meses.includes(ST.mes)) ST.mes = meses.length ? meses[meses.length-1] : null;
}
/* junta vários meses: observações (uma vez cada), grupos e total */
function junta(lista){
  var mot = {}, net = 0;
  lista.forEach(function(m){
    net += m.net;
    Object.keys(m.mot).forEach(function(k){
      var o = m.mot[k], a = mot[k] || (mot[k] = {id:o.id, legenda:o.legenda, g:0, p:0});
      a.g += o.g; a.p += o.p;
    });
  });
  var gr = {};
  GRUPOS.forEach(function(g){ gr[g.id] = {g:g, v:0, obs:[]}; });
  Object.keys(mot).forEach(function(k){
    var o = mot[k], v = o.g + o.p, G = gr[grupoDe(o.id).id];
    G.v += v; G.obs.push({id:o.id, legenda:o.legenda, g:o.g, p:o.p, v:v});
  });
  var abs = 0;
  GRUPOS.forEach(function(g){ gr[g.id].obs.sort(function(a,b){ return Math.abs(b.v)-Math.abs(a.v); }); gr[g.id].obs.forEach(function(o){ abs += Math.abs(o.v); }); });
  return {net:net, grupos:GRUPOS.map(function(g){ return gr[g.id]; }), abs:abs};
}
function mesesDoAno(ano){ return ST.calc.meses.filter(function(m){ return m.mes.slice(0,4) === ano; }); }
function acumulado(mes){ return mesesDoAno(mes.slice(0,4)).filter(function(m){ return m.mes <= mes; }); }

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

/* NET mensal: cada coluna é o NET do mês aberto por grupo (cheio = positivo, para baixo = negativo); última coluna = total do ano */
function svgMensal(W){
  var ano = ST.mes.slice(0,4);
  var ms = mesesDoAno(ano), colunas = ms.map(function(m){ return {k:m.mes, rot:mesCurto(m.mes), J:junta([m]), on:m.mes===ST.mes}; });
  colunas.push({k:'total:'+ano, rot:'Total', J:junta(ms), tot:true});
  var H = 400, padL = 6, padR = 6, padT = 40, padB = 26, n = colunas.length;
  var cw = (W-padL-padR)/n, bw = Math.min(54, cw*.62);
  // cada grupo entra com o NET dele (positivo para cima, negativo para baixo); o Total do ano tem escala própria
  function lados(J){ var up = 0, dn = 0; J.grupos.forEach(function(G){ if(G.v>0) up += G.v; else dn += G.v; }); return {up:up, dn:dn}; }
  var mxM = 1, mxT = 1;
  colunas.forEach(function(c){ c.L = lados(c.J); var m = Math.max(c.L.up, -c.L.dn); if(c.tot) mxT = Math.max(mxT, m); else mxM = Math.max(mxM, m); });
  var base = padT + (H-padT-padB)/2, half = (H-padT-padB)/2 - 4;
  var g = '<line x1="'+padL+'" x2="'+(W-padR)+'" y1="'+base+'" y2="'+base+'" stroke="currentColor" opacity=".25"/>';
  colunas.forEach(function(c,i){
    var cx = padL + (i+.5)*cw, x = cx-bw/2, mx = c.tot ? mxT : mxM;
    function sc(v){ return Math.abs(v)/mx*half; }
    var yu = base, yd = base, cel = '';
    c.J.grupos.forEach(function(G){
      if(G.v > 0.5){ var h = sc(G.v); yu -= h; cel += '<rect x="'+x+'" y="'+yu+'" width="'+bw+'" height="'+h+'" fill="'+G.g.cor+'"/>'; }
      else if(G.v < -0.5){ var h2 = sc(G.v); cel += '<rect x="'+x+'" y="'+yd+'" width="'+bw+'" height="'+h2+'" fill="'+G.g.cor+'" opacity=".62"/>'; yd += h2; }
    });
    var net = c.J.net, ny = base - (net>=0?1:-1)*sc(net);
    if(c.tot) g += '<line x1="'+(cx-cw/2)+'" x2="'+(cx-cw/2)+'" y1="'+(padT-26)+'" y2="'+(H-padB+2)+'" stroke="currentColor" opacity=".2" stroke-dasharray="3 3"/>';
    g += '<g class="nd-col" data-m="'+c.k+'" style="cursor:pointer">'
      + '<rect x="'+(cx-cw/2+1)+'" y="'+(padT-28)+'" width="'+(cw-2)+'" height="'+(H-padT-padB+32)+'" rx="9" fill="'+(c.on?'rgba(254,80,0,.10)':(c.tot?'rgba(11,18,48,.05)':'transparent'))+'"/>'
      + cel
      + '<path d="M'+cx+' '+(ny-6)+' l6 6 l-6 6 l-6 -6 Z" fill="#fff" stroke="#0B1230" stroke-width="2"/>'
      + '<text x="'+cx+'" y="'+(padT-14)+'" text-anchor="middle" font-size="'+(cw<62?11:12.5)+'" font-weight="800" fill="'+cor(net)+'">'+esc(compacto(net))+'</text>'
      + '<text x="'+cx+'" y="'+(H-7)+'" text-anchor="middle" font-size="12" font-weight="'+((c.on||c.tot)?800:600)+'" fill="currentColor" opacity="'+((c.on||c.tot)?1:.6)+'">'+(c.tot?'Total '+ano:c.rot)+'</text>'
      + '</g>';
  });
  return '<svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" style="display:block">'+g+'</svg>';
}

/* ---------- peças da tela ---------- */
function kpi(c, rot, val, sub, extra){
  return '<div class="nd-k '+(extra||'')+'" style="--c:'+c+'"><span class="nd-k-rot">'+rot+'</span><strong>'+val+'</strong>'+(sub?'<span class="nd-k-sub">'+sub+'</span>':'')+'</div>';
}
function subObs(G){
  return G.obs.slice(0,3).map(function(o){ return esc(o.id)+' '+compacto(o.v); }).join(' · ') || '—';
}
/* teto anual: quanto do teto o NET do ano já consumiu e o peso de cada grupo */
function painelTeto(mes){
  var ano = mes.slice(0,4), ac = acumulado(mes), J = junta(ac), net = J.net, teto = ST.teto;
  var uso = net < 0 ? -net : 0, usoPct = Math.min(100, uso/teto*100);
  var linhas = J.grupos.filter(function(G){ return Math.abs(G.v) >= 0.5; }).sort(function(a,b){ return Math.abs(b.v)-Math.abs(a.v); }).map(function(G){
    var w = Math.min(50, Math.abs(G.v)/teto*100*1.6);
    var est = G.v>=0 ? 'left:50%;width:'+w+'%;' : 'left:'+(50-w)+'%;width:'+w+'%;';
    return '<div class="nd-row"><div class="nd-lab"><i class="nd-dot" style="background:'+G.g.cor+'"></i>'+G.g.nome+'<span class="nd-n">'+esc(G.obs.slice(0,4).map(function(o){ return o.id; }).join(' · '))+'</span></div>'
      + '<div class="nd-trk"><i style="'+est+'background:'+G.g.cor+'"></i></div>'
      + '<div class="nd-val" style="color:'+cor(G.v)+'">'+sgn(G.v)+'<span class="nd-n" style="text-align:right">'+pct(G.v, teto)+' do teto</span></div></div>';
  }).join('');
  var inv = J.grupos[0].v;
  return '<div class="painel nd-p nd-estr"><h3>Teto anual <small>jan–'+mesCurto(mes)+'/'+ano.slice(2)+'</small></h3>'
    + '<div class="nd-teto"><div class="nd-teto-v"><span>Teto</span><button type="button" id="nd-teto-ed" title="Alterar o teto">'+brl(teto)+' ✎</button></div>'
    + '<div class="nd-teto-v"><span>NET acumulado</span><b style="color:'+cor(net)+'">'+sgn(net)+'</b></div>'
    + '<div class="nd-teto-v"><span>Teto usado</span><b>'+pct(uso, teto)+'</b></div></div>'
    + '<div class="nd-teto-b"><i style="width:'+usoPct+'%"></i></div>'
    + '<div class="nd-sub">NET acumulado por grupo</div><div class="nd-estr-c">'+linhas+'</div>'
    + '<div class="nd-pg nd-pg-t" style="grid-template-columns:1fr auto;margin-top:6px"><div class="nd-lab">Inventário no teto</div><div class="nd-val" style="color:'+cor(inv)+'">'+sgn(inv)+' · '+pct(inv, teto)+'</div></div></div>';
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
function dataBr(dh, dt){
  var s = String(dh || dt || '');
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if(!m) return '';
  return m[3]+'/'+m[2]+(m[4] && (m[4]!=='00' || m[5]!=='00') ? ' '+m[4]+':'+m[5] : '');
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
    return '<div class="nd-it" data-cod="'+esc(cod)+'"><div class="nd-it-t"><b>'+esc(cod)+'</b>'+esc(nome)+'</div>'
      + '<div class="nd-it-q">'+fInt.format(Math.round(x.q))+' pç</div>'
      + '<div class="nd-it-u">'+(unit!=null ? brl(unit)+'<small>/pç</small>' : '—')+'</div>'
      + '<div class="nd-it-v" style="color:'+cor(x.n)+'">'+sgn(x.n)+'</div></div>';
  }).join('');
}

/* ---------- balões ---------- */
var TIP = null, HOV = null;
function criaTip(){ if(!TIP){ TIP = document.createElement('div'); TIP.className = 'nd-tip'; document.body.appendChild(TIP); } }
/* balão do mês (ou do total do ano): cada observação aparece uma vez, agrupada, com perda, ganho, NET e % */
function tipMesHtml(chave){
  var C = ST.calc, J, titulo;
  if(chave.indexOf('total:') === 0){ var ano = chave.slice(6); J = junta(mesesDoAno(ano)); titulo = 'Total '+ano; }
  else { var m = C.meses.find(function(x){ return x.mes === chave; }); if(!m) return ''; J = junta([m]); titulo = mesLongo(chave)+'/'+chave.slice(0,4); }
  var h = '<div class="nd-tm-h"><b>'+esc(titulo)+'</b><span style="color:'+cor(J.net)+'">NET '+sgn(J.net)+'</span></div>'
    + '<div class="nd-tg nd-tg-h"><span>Observação</span><span>Perda</span><span>Ganho</span><span>NET</span><span>%</span></div>';
  J.grupos.filter(function(G){ return G.obs.length; }).sort(function(a,b){ return Math.abs(b.v)-Math.abs(a.v); }).forEach(function(G){
    h += '<div class="nd-tg nd-tg-g"><span><i class="nd-dot" style="background:'+G.g.cor+'"></i>'+G.g.nome+'</span><span></span><span></span><span style="color:'+cor(G.v)+'">'+sgn(G.v)+'</span><span>'+pct(Math.abs(G.v), J.abs)+'</span></div>';
    G.obs.slice(0, 6).forEach(function(o){
      h += '<div class="nd-tg"><span class="nd-tg-o"><b>'+esc(o.id)+'</b> '+esc(o.legenda||'')+'</span><span style="color:#D83C1E">'+brl(o.p)+'</span><span style="color:#1F8A52">'+sgn(o.g)+'</span><span style="color:'+cor(o.v)+'">'+sgn(o.v)+'</span><span>'+pct(Math.abs(o.v), J.abs)+'</span></div>';
    });
  });
  return h;
}
function mostraTipMes(ev, chave){
  criaTip(); HOV = 'mes:'+chave; TIP.className = 'nd-tip nd-tip-mes'; TIP.innerHTML = tipMesHtml(chave); TIP.style.display = 'block'; moveTip(ev);
}
/* balão do item: o lançamento por trás do número */
function itemDoMes(cod){
  var C = ST.calc, m = C && C.meses.find(function(x){ return x.mes === ST.mes; });
  if(!m) return null;
  for(var k=0; k<m.itens.length; k++){ if(C.itens[m.itens[k].i] === cod) return m.itens[k]; }
  return null;
}
function lancamentoHtml(l){
  var c = API.classifica(l.obs), us = String(l.usuario||'').replace(/^MECA_/,'');
  var un = Math.abs(l.qtd) > 0.5 ? Math.abs(l.valor/l.qtd) : null;
  return '<div class="nd-tl"><div class="nd-tl-o">'+esc(l.obs||c.prefixo)+'</div>'
    + '<div class="nd-tl-g"><span>Documento</span><b>'+esc(l.doc||'—')+'</b><span>Usuário</span><b>'+esc(us||'—')+'</b>'
    + '<span>Data</span><b>'+(dataBr(l.dh, l.dt)||'—')+'</b><span>Departamento</span><b>'+esc(l.depto||'—')+'</b>'
    + (l.deposito ? '<span>Depósito</span><b>'+esc(l.deposito)+'</b>' : '')
    + '<span>Quantidade</span><b>'+fInt.format(Math.round(l.qtd))+' pç'+(un!=null?' × '+brl(un):'')+'</b>'
    + '<span>Valor</span><b style="color:'+cor(l.valor)+'">'+sgn(l.valor)+'</b></div></div>';
}
function tipHtml(cod){
  var C = ST.calc, x = itemDoMes(cod); if(!x) return '';
  var nome = C.nomes[cod] || '';
  var unit = Math.abs(x.q) > 0.5 ? Math.abs(x.n/x.q) : null;
  var L = ST.det[ST.mes+'|'+cod];
  var lan = !L ? '<div class="nd-tl-p">carregando lançamentos…</div>'
    : (L.length ? L.slice(0, 4).map(lancamentoHtml).join('') + (L.length>4 ? '<div class="nd-tl-p">+'+(L.length-4)+' lançamentos</div>' : '') : '<div class="nd-tl-p">sem lançamento detalhado</div>');
  return '<div class="nd-tp-h"><b>'+esc(cod)+'</b> '+esc(nome)+'</div>'
    + '<div class="nd-tp-n"><div><span>NET no mês</span><strong style="color:'+cor(x.n)+'">'+sgn(x.n)+'</strong></div>'
    + '<div><span>Peças</span><strong>'+fInt.format(Math.round(x.q))+'</strong></div>'
    + '<div><span>Custo/peça</span><strong>'+(unit!=null?brl(unit):'—')+'</strong></div></div>' + lan;
}
function mostraTip(ev, cod){
  criaTip(); HOV = cod; TIP.className = 'nd-tip'; TIP.innerHTML = tipHtml(cod); TIP.style.display = 'block'; moveTip(ev);
  var mes = ST.mes, k = mes+'|'+cod;
  if(!ST.det[k] && !ST.detBusca[k]){
    ST.detBusca[k] = 1;
    window.ldmSupa.rpc('net_fluxo_linhas', {p_mes:mes, p_itens:[cod]}).then(function(r){
      if(r.error) throw r.error;
      ST.det[k] = (r.data || []).filter(function(l){ return l.item === cod; });
    }).catch(function(){ ST.det[k] = []; delete ST.detBusca[k]; }).then(function(){
      if(HOV === cod && ST.mes === mes && TIP){ TIP.innerHTML = tipHtml(cod); }
    });
  }
}
function moveTip(ev){
  if(!TIP || TIP.style.display === 'none') return;
  var pad = 16, r = TIP.getBoundingClientRect();
  var x = ev.clientX + pad, y = ev.clientY + pad;
  if(x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
  if(y + r.height > window.innerHeight - 8) y = window.innerHeight - r.height - 8;
  if(x < 8) x = 8; if(y < 8) y = 8;
  var z = parseFloat(document.body.style.zoom) || 1; // o balão fica dentro do body com zoom
  TIP.style.left = (x/z)+'px'; TIP.style.top = (y/z)+'px';
}
function somaTip(){ if(TIP) TIP.style.display = 'none'; HOV = null; }
document.addEventListener('mouseover', function(e){
  var col = e.target.closest && e.target.closest('.nd-col');
  if(col){ if(HOV !== 'mes:'+col.dataset.m) mostraTipMes(e, col.dataset.m); return; }
  var it = e.target.closest && e.target.closest('.nd-it');
  if(it){ if(HOV !== it.dataset.cod) mostraTip(e, it.dataset.cod); }
  else if(HOV) somaTip();
});
document.addEventListener('mousemove', function(e){ if(HOV) moveTip(e); });
document.addEventListener('mouseleave', somaTip);

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
  var m = C.meses[idx], ant = idx>0 ? C.meses[idx-1] : null, J = junta([m]);
  if(chips) chips.innerHTML = C.meses.slice(-12).map(function(x){
    return '<button type="button" class="mes-chip'+(x.mes===ST.mes?' on':'')+'" data-nd-mes="'+x.mes+'">'+mesChip(x.mes)+'</button>';
  }).join('');
  var dep = C.semDeposito
    ? '<div class="nd-vazio"><b>Depósito indisponível</b>Reimporte a QRY410 no Inventário.</div>'
    : tabelaPG(m.dep, 8, 'Sem movimento', function(o){ return esc(o.rot || '(sem depósito)'); });
  var mot = tabelaPG(m.mot, 10, 'Sem movimento', function(o){ return '<i class="nd-dot" style="background:'+grupoDe(o.id).cor+'"></i><b>'+esc(o.id)+'</b>'+esc(o.legenda||''); });
  var lp = listaItens(m, -1), lg = listaItens(m, 1);
  var grupoCards = J.grupos.map(function(G){
    return kpi(G.g.cor, G.g.nome, sgn(G.v), subObs(G));
  }).join('');
  corpo.innerHTML =
    '<div class="nd-kpis">'
    + kpi('var(--orange)', 'NET de '+esc(mesLongo(m.mes)), sgn(m.net), ant ? sgn(m.net-ant.net)+' vs '+mesCurto(ant.mes) : '', 'nd-net '+(m.net<0?'neg':'pos'))
    + grupoCards
    + '</div>'
    + '<div class="nd-grid nd-g2">'
    + '<div class="painel nd-p"><h3>NET mensal <small>passe o mouse num mês</small></h3>'+fluid('mensal', svgMensal, 400)
    + '<div class="nd-leg">'+GRUPOS.map(function(g){ return '<span><i style="background:'+g.cor+'"></i>'+g.nome+'</span>'; }).join('')+'<span>◆ NET</span></div></div>'
    + painelTeto(m.mes)
    + '</div>'
    + '<div class="nd-grid nd-g3">'
    + '<div class="painel nd-p"><h3>NET por observação <small>'+esc(mesLongo(m.mes))+'</small></h3>'+mot+'</div>'
    + '<div class="painel nd-p"><h3>NET por depósito <small>'+esc(mesLongo(m.mes))+'</small></h3>'+dep+'</div>'
    + '</div>'
    + '<div class="painel nd-p" style="margin-top:14px"><h3>Itens mais divergentes <small><span class="nd-ord"><button type="button" data-nd-ord="valor" class="'+(ST.ord==='valor'?'on':'')+'">Valor</button><button type="button" data-nd-ord="pecas" class="'+(ST.ord==='pecas'?'on':'')+'">Peças</button></span></small></h3>'
    + '<div class="nd-grid nd-g3" style="margin:0"><div><div class="nd-k-rot nd-it-h" style="color:'+COR.pn+'">Perdas</div>'+renderItens(lp)+'</div>'
    + '<div><div class="nd-k-rot nd-it-h" style="color:'+COR.gn+'">Ganhos</div>'+renderItens(lg)+'</div></div></div>';
  ajusta();
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
  var g = e.target.closest('.nd-col'); if(g && /^\d{4}-\d{2}$/.test(g.dataset.m)){ ST.mes = g.dataset.m; desenha(); return; }
  var o = e.target.closest('[data-nd-ord]'); if(o){ ST.ord = o.dataset.ndOrd; desenha(); return; }
  if(e.target.closest('#nd-teto-ed')){
    var v = prompt('Teto anual do NET (R$):', String(ST.teto));
    var n = v ? parseFloat(String(v).replace(/\./g,'').replace(',','.')) : NaN;
    if(n > 0){ ST.teto = n; try { localStorage.setItem(TETO_KEY, String(n)); } catch(x){} desenha(); }
    return;
  }
  if(e.target.closest('#nd-atualizar')){ carregar(true); }
});

window.NETDASH = {
  abrir: function(){ ST.quer = true; if(ST.pronto) carregar(false); },
  pronto: function(){ ST.pronto = true; if(ST.quer) carregar(false); },
  redesenha: function(){ if(ST.calc){ calcula(); desenha(); } }
};
})();
