/* =========================================================================
   Aba NET — painel do FLUXO AUTOMÁTICO (não é o fechamento da controladoria).
   -------------------------------------------------------------------------
   Os dados vêm da base QRY410 que o Inventário Rotativo guarda na nuvem, já
   resumida pelo servidor (função net_fluxo: mês × item × depósito × observação).
   O fechamento da controladoria continua saindo SÓ da base importada à mão.

   Número real: o NET de um item, mês a mês, é comparado com a posição acumulada
   do mesmo item. Ganho que apenas devolve uma perda de meses anteriores (ou
   perda que apenas desfaz um ganho antigo) é "compensação"; o que sobra é
   ganho real ou perda real. NET = ganho real + perda real + compensações.
   ========================================================================= */
(function(){
'use strict';
var API = window.NET_API;
var COR = {gr:'#001A72', rec:'#FE5000', pr:'#C0392B', des:'#E7A096'};
var ST = {dados:null, calc:null, carregando:false, erro:null, mes:null, ord:'valor', em:null, pronto:false, quer:false};
var FLUID = {};

function $(id){ return document.getElementById(id); }
function esc(s){ return API.esc(s); }
var fBRL = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
var fInt = new Intl.NumberFormat('pt-BR');
function brl(v){ return fBRL.format(v||0); }
function sgn(v){ return (v>0.004?'+':'')+brl(v); }
function cor(v){ return v<0 ? '#D83C1E' : '#1F8A52'; }
function corSolta(v){ return v<0 ? 'var(--nd-neg,#D83C1E)' : 'var(--nd-pos,#1F8A52)'; }
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

/* ---------- cálculo ---------- */
function calcula(){
  var D = ST.dados || {}, meses = D.meses || [], itens = D.itens || [], deps = D.depositos || [], obs = D.obs || [];
  var NM = meses.length;
  var cls = obs.map(function(o){ return API.classifica(o); });
  var M = meses.map(function(m){ return {mes:m, net:0, gr:0, pr:0, rec:0, des:0, mot:{}, dep:{}, itens:[]}; });
  var porItem = new Map();
  (D.linhas || []).forEach(function(t){
    var c = cls[t[3]-1]; if(!c || !c.considerar) return;
    var m = t[0]-1, i = t[1]-1, gp = t[4], pp = t[5], q = t[6], n = gp+pp;
    var mm = M[m];
    var k = c.prefixo, mo = mm.mot[k] || (mm.mot[k] = {id:k, legenda:c.legenda, v:0});
    mo.v += n;
    var dn = deps[t[2]-1] || '';
    mm.dep[dn] = (mm.dep[dn]||0) + n;
    var a = porItem.get(i);
    if(!a){ a = {n:new Float64Array(NM), q:new Float64Array(NM)}; porItem.set(i, a); }
    a.n[m] += n; a.q[m] += q;
  });
  porItem.forEach(function(a, i){
    var P = 0;
    for(var m=0; m<NM; m++){
      var n = a.n[m];
      if(Math.abs(n) < 0.005) continue;
      var comp = 0;
      if(n > 0 && P < 0) comp = Math.min(n, -P);
      else if(n < 0 && P > 0) comp = -Math.min(-n, P);
      var real = n - comp;
      P += n;
      var mm = M[m];
      mm.net += n;
      if(real > 0) mm.gr += real; else mm.pr += real;
      if(comp > 0) mm.rec += comp; else mm.des += comp;
      mm.itens.push({i:i, n:n, q:a.q[m], real:real, comp:comp});
    }
  });
  ST.calc = {meses:M, itens:itens, nomes:D.nomes || {}, semDeposito: deps.length<=1 && (deps[0]||'')===''};
  if(!ST.mes || !meses.includes(ST.mes)) ST.mes = meses.length ? meses[meses.length-1] : null;
}

/* ---------- gráficos fluidos: desenham na largura real do painel ---------- */
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
  var H = 300, padL = 6, padR = 6, padT = 38, padB = 26, n = Math.max(1, rows.length);
  var cw = (W-padL-padR)/n, bw = Math.min(54, cw*.62);
  var mx = Math.max(1, Math.max.apply(null, rows.map(function(m){ return Math.max(m.gr+m.rec, -(m.pr+m.des)); })));
  var base = padT + (H-padT-padB)/2, half = (H-padT-padB)/2 - 4;
  function sc(v){ return Math.abs(v)/mx*half; }
  var g = '<line x1="'+padL+'" x2="'+(W-padR)+'" y1="'+base+'" y2="'+base+'" stroke="currentColor" opacity=".25"/>';
  rows.forEach(function(m,i){
    var cx = padL + (i+.5)*cw, x = cx-bw/2, on = m.mes === sel;
    var hg = sc(m.gr), hr = sc(m.rec), hp = sc(m.pr), hd = sc(m.des);
    g += '<g class="nd-col" data-m="'+m.mes+'" style="cursor:pointer">'
      + '<rect x="'+(cx-cw/2+1)+'" y="'+(padT-26)+'" width="'+(cw-2)+'" height="'+(H-padT-padB+30)+'" rx="9" fill="'+(on?'rgba(254,80,0,.10)':'transparent')+'"/>'
      + '<rect x="'+x+'" y="'+(base-hg)+'" width="'+bw+'" height="'+hg+'" rx="3" fill="'+COR.gr+'"/>'
      + '<rect x="'+x+'" y="'+(base-hg-hr)+'" width="'+bw+'" height="'+hr+'" rx="3" fill="'+COR.rec+'"/>'
      + '<rect x="'+x+'" y="'+base+'" width="'+bw+'" height="'+hp+'" rx="3" fill="'+COR.pr+'"/>'
      + '<rect x="'+x+'" y="'+(base+hp)+'" width="'+bw+'" height="'+hd+'" rx="3" fill="'+COR.des+'"/>'
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
function linhaDiv(rot, v, max, cl, extra){
  var w = Math.min(50, Math.abs(v)/max*50);
  var estilo = v>=0 ? 'left:50%;width:'+w+'%;' : 'left:'+(50-w)+'%;width:'+w+'%;';
  return '<div class="nd-row '+(extra||'')+'"><div class="nd-lab" title="'+esc(String(rot).replace(/<[^>]+>/g,''))+'">'+rot+'</div>'
    + '<div class="nd-trk"><i style="'+estilo+'background:'+cl+'"></i></div>'
    + '<div class="nd-val" style="color:'+(extra==='nd-tot'?cor(v):cor(v))+'">'+sgn(v)+'</div></div>';
}
function estratificacao(m){
  var itens = [['Ganho real', m.gr, COR.gr], ['Recupera perda anterior', m.rec, COR.rec], ['Perda real', m.pr, COR.pr], ['Desfaz ganho anterior', m.des, COR.des]];
  var max = Math.max(1, Math.max.apply(null, itens.map(function(x){ return Math.abs(x[1]); })), Math.abs(m.net));
  return itens.map(function(x){ return linhaDiv(x[0], x[1], max, x[2]); }).join('')
    + linhaDiv('= NET', m.net, max, '#0B1230', 'nd-tot');
}
function topLinhas(obj, max, vazio){
  var arr = Object.keys(obj).map(function(k){ return obj[k]; }).filter(function(x){ return Math.abs(x.v) >= 0.5; })
    .sort(function(a,b){ return Math.abs(b.v)-Math.abs(a.v); });
  if(!arr.length) return '<div class="nd-vazio">'+(vazio||'Sem movimento')+'</div>';
  var top = arr.slice(0, max), resto = arr.slice(max).reduce(function(s,x){ return s+x.v; }, 0);
  if(arr.length > max) top.push({rot:'Outros', v:resto});
  var mx = Math.max(1, Math.max.apply(null, top.map(function(x){ return Math.abs(x.v); })));
  return top.map(function(x){
    var rot = x.rot || ('<b>'+esc(x.id)+'</b>'+esc(x.legenda||''));
    return linhaDiv(rot, x.v, mx, x.v<0 ? COR.pr : COR.gr);
  }).join('');
}
function itensLista(m, sinal){
  var C = ST.calc, ord = ST.ord;
  var lista = m.itens.filter(function(x){ return sinal<0 ? x.n < -0.5 : x.n > 0.5; });
  lista.sort(function(a,b){
    return ord==='pecas' ? Math.abs(b.q)-Math.abs(a.q) : Math.abs(b.n)-Math.abs(a.n);
  });
  lista = lista.slice(0, 8);
  if(!lista.length) return '<div class="nd-vazio">Sem itens</div>';
  return lista.map(function(x){
    var cod = C.itens[x.i] || '', nome = C.nomes[cod] || '';
    var tot = Math.abs(x.real) + Math.abs(x.comp) || 1;
    var wr = Math.abs(x.real)/tot*100, wc = Math.abs(x.comp)/tot*100;
    var cR = x.n<0 ? COR.pr : COR.gr, cC = x.n<0 ? COR.des : COR.rec;
    return '<div class="nd-it"><div class="nd-it-n"><div><b>'+esc(cod)+'</b><span>'+esc(nome)+'</span></div>'
      + '<div class="nd-it-b" title="Real '+esc(brl(x.real))+' · Compensação '+esc(brl(x.comp))+'"><i style="width:'+wr+'%;background:'+cR+'"></i><i style="width:'+wc+'%;background:'+cC+'"></i></div></div>'
      + '<div class="nd-it-q">'+fInt.format(Math.round(x.q))+' pç</div>'
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
  var dep = ST.calc.semDeposito
    ? '<div class="nd-vazio"><b>Depósito indisponível</b>Reimporte a QRY410 no Inventário.</div>'
    : topLinhas(Object.keys(m.dep).reduce(function(o,k){ o[k] = {rot:esc(k||'(sem depósito)'), v:m.dep[k]}; return o; }, {}), 8);
  corpo.innerHTML =
    '<div class="nd-kpis">'
    + kpi('var(--orange)', 'NET de '+esc(mesLongo(m.mes)), sgn(m.net), ant ? sgn(m.net-ant.net)+' vs '+mesCurto(ant.mes) : '', 'nd-net '+(m.net<0?'neg':'pos'))
    + kpi(COR.gr, 'Ganho real', sgn(m.gr))
    + kpi(COR.pr, 'Perda real', sgn(m.pr))
    + kpi(COR.rec, 'Recupera perda anterior', sgn(m.rec))
    + kpi(COR.des, 'Desfaz ganho anterior', sgn(m.des))
    + '</div>'
    + '<div class="nd-grid nd-g2">'
    + '<div class="painel nd-p"><h3>NET mensal <small>clique num mês</small></h3>'+fluid('mensal', svgMensal, 300)
    + '<div class="nd-leg"><span><i style="background:'+COR.gr+'"></i>Ganho real</span><span><i style="background:'+COR.rec+'"></i>Recupera perda anterior</span><span><i style="background:'+COR.pr+'"></i>Perda real</span><span><i style="background:'+COR.des+'"></i>Desfaz ganho anterior</span><span>◆ NET</span></div></div>'
    + '<div class="painel nd-p nd-estr"><h3>Estratificação <small>'+esc(mesLongo(m.mes))+'</small></h3><div class="nd-estr-c">'+estratificacao(m)+'</div></div>'
    + '</div>'
    + '<div class="nd-grid nd-g3">'
    + '<div class="painel nd-p"><h3>NET por motivo <small>'+esc(mesLongo(m.mes))+'</small></h3>'+topLinhas(m.mot, 9)+'</div>'
    + '<div class="painel nd-p"><h3>NET por depósito <small>'+esc(mesLongo(m.mes))+'</small></h3>'+dep+'</div>'
    + '</div>'
    + '<div class="painel nd-p" style="margin-top:14px"><h3>Itens mais divergentes <small><span class="nd-ord"><button type="button" data-nd-ord="valor" class="'+(ST.ord==='valor'?'on':'')+'">Valor</button><button type="button" data-nd-ord="pecas" class="'+(ST.ord==='pecas'?'on':'')+'">Peças</button></span></small></h3>'
    + '<div class="nd-grid nd-g3" style="margin:0"><div><div class="nd-k-rot" style="margin-bottom:4px;color:'+COR.pr+'">Perdas</div>'+itensLista(m,-1)+'</div>'
    + '<div><div class="nd-k-rot" style="margin-bottom:4px;color:'+COR.gr+'">Ganhos</div>'+itensLista(m,1)+'</div></div></div>';
  ajusta();
}

async function carregar(forcar){
  if(ST.carregando) return;
  if(ST.calc && !forcar){ desenha(); return; }
  ST.carregando = true; ST.erro = null; desenha();
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
