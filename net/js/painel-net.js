/* =========================================================================
   Aba NET — painel do FLUXO AUTOMÁTICO (não é o fechamento da controladoria).
   -------------------------------------------------------------------------
   Os dados vêm da base QRY410 que o Inventário Rotativo guarda na nuvem, já
   resumida pelo servidor (net_fluxo: mês × item × depósito × observação) e, para
   os itens mais divergentes, com os lançamentos de cada um (net_fluxo_linhas).
   O fechamento da controladoria continua saindo SÓ da base importada à mão.

   NET do mês = RESULTADO DO MÊS + RECUPERAÇÃO DO ACUMULADO (tudo em R$).
   Para cada item, o NET dele no mês é comparado com o que o MESMO item já
   acumulava de janeiro até o mês anterior (o acumulado zera a cada ano):
   - recuperação: o item estava negativo (perdeu antes) e voltou, ou estava
     positivo (ganhou antes) e saiu. É valor que só desfaz o acumulado — cada
     centavo é ligado ao mês em que nasceu (do mais antigo ao mais novo).
   - resultado do mês: o que sobra do NET do item, sem depender do acumulado.
   Cada observação (código de 3 letras) aparece uma vez só.
   O teto anual (R$ 525 mil) é comparado com o NET acumulado do ano.
   ========================================================================= */
(function(){
'use strict';
var API = window.NET_API;
var COR = {rm:'#001A72', rc:'#FE5000', pn:'#C0392B', gn:'#001A72'};
/* Legenda de motivos: a MESMA do Inventário (ela decide o que entra no NET). Vem da nuvem junto com os
   dados; sem ela, usa a última guardada ou esta, que é o padrão de fábrica do Inventário. */
var LEG_PADRAO = [
  {id:'ARI LOT', legenda:'Ajuste de Lote', considerarNet:true}, {id:'INS', legenda:'Baixa Insumo', considerarNet:false},
  {id:'AIR', legenda:'Inventário Rotativo', considerarNet:true}, {id:'TID', legenda:'Troca de Identidade', considerarNet:true},
  {id:'AIN', legenda:'Não Localizado', considerarNet:true}, {id:'INV', legenda:'Inversão de etiqueta', considerarNet:true},
  {id:'ANF', legenda:'Nota Fiscal', considerarNet:false}, {id:'PAR', legenda:'Recebimento Parcial', considerarNet:true},
  {id:'ARI', legenda:'Recebimento invertido', considerarNet:true}, {id:'API', legenda:'Ajuste MCL Reversa', considerarNet:true},
  {id:'AEE', legenda:'Itens Localizados', considerarNet:true}, {id:'LOJA', legenda:'Ajuste Loja', considerarNet:true},
  {id:'QBR', legenda:'Quebra CD', considerarNet:false}, {id:'EPI', legenda:'Baixa EPI', considerarNet:false},
  {id:'IMP', legenda:'Ajuste Importação', considerarNet:true}, {id:'ASR', legenda:'Sobra Recebimento', considerarNet:true},
  {id:'BAI', legenda:'Baixa Insumo', considerarNet:false}, {id:'INP', legenda:'Ajuste Pallets', considerarNet:false},
  {id:'LIT', legenda:'Ajuste Litigio', considerarNet:true}, {id:'AUD', legenda:'Auditoria KPMG', considerarNet:true},
  {id:'AIP', legenda:'Inventário Pontual', considerarNet:true}, {id:'ADE', legenda:'Auditorias', considerarNet:true},
  {id:'AIC', legenda:'Inventário de Curvas', considerarNet:true}, {id:'AIT', legenda:'Inventario de Transitorios', considerarNet:true},
  {id:'AII', legenda:'Inventário de Insumos', considerarNet:false},
  {id:'SALDO INCLUIDO INDEVIDAMENTE', legenda:'Saldo incluído indevidamente via NF', considerarNet:false}
];
var LEG_KEY = 'ldm-net-leg410';
function legendaAtual(D){
  if(D && Array.isArray(D.legenda) && D.legenda.length){ try { localStorage.setItem(LEG_KEY, JSON.stringify(D.legenda)); } catch(e){} return D.legenda; }
  try { var c = JSON.parse(localStorage.getItem(LEG_KEY)||'null'); if(Array.isArray(c) && c.length) return c; } catch(e){}
  return LEG_PADRAO;
}
function classificaFluxo(obsRaw, leg){
  var texto = String(obsRaw||'').trim().toUpperCase();
  if(!texto) return {prefixo:'(sem obs)', legenda:'Sem observação', considerar:true};
  var melhor = null;
  leg.forEach(function(it){
    var cod = String(it.id||'').trim().toUpperCase();
    if(!cod) return;
    if(texto === cod || (texto.indexOf(cod) === 0 && /[^A-Z0-9]/.test(texto.charAt(cod.length)))){
      if(!melhor || cod.length > melhor.cod.length) melhor = {cod:cod, it:it};
    }
  });
  if(melhor) return {prefixo:melhor.it.id, legenda:melhor.it.legenda||'', considerar:melhor.it.considerarNet !== false};
  for(var k=0; k<leg.length; k++){ // observação escrita por extenso: procura a frase dentro do texto
    var ch = String(leg[k].id||'').trim().toUpperCase();
    if(ch.length >= 6 && texto.indexOf(ch) !== -1) return {prefixo:leg[k].id.split(' ')[0].slice(0,5), legenda:leg[k].legenda||'', considerar:leg[k].considerarNet !== false};
  }
  var cod = (texto.split(/[\s-]/)[0] || texto.slice(0,10)).trim();
  return {prefixo:cod || '(sem obs)', legenda:'', considerar:true};
}
var TETO_KEY = 'ldm-net-teto';
var ST = {escopo:'mes', dados:null, calc:null, carregando:false, erro:null, mes:null, ord:'valor', em:null, pronto:false, quer:false, det:{}, detBusca:{}, teto:525000};
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
function soma(o, k, v){ o[k] = (o[k]||0) + v; }
function origens(mapa, max){
  var e = Object.keys(mapa).filter(function(k){ return Math.abs(mapa[k])>0.5; }).sort(function(a,b){ return mapa[b]-mapa[a]; });
  if(!e.length) return '';
  var t = e.slice(0, max||3).map(function(k){ return mesCurto(k)+' '+compacto(mapa[k]).replace(/^\+/,''); }).join(' · ');
  return t + (e.length>(max||3) ? ' · +'+(e.length-(max||3)) : '');
}
function nIt(n){ return fInt.format(n)+(n===1?' item':' itens'); }

/* ---------- cálculo ---------- */
function calcula(){
  var D = ST.dados || {}, meses = D.meses || [], itens = D.itens || [], deps = D.depositos || [], obs = D.obs || [];
  var NM = meses.length;
  var leg = legendaAtual(D);
  var cls = obs.map(function(o){ return classificaFluxo(o, leg); });
  var M = meses.map(function(m){
    return {mes:m, net:0, g:0, p:0, rm:0, rc:0, rmG:0, rmP:0, rcPos:0, rcNeg:0, nG:0, nP:0, nRc:0, oRc:{}, mot:{}, dep:{}, itens:[], abNeg:{}, abPos:{}};
  });
  var porItem = new Map(), porIM = new Map(), itemObs = new Map(), fin = new Map();
  var criado = {neg:{}, pos:{}}, recup = {neg:{}, pos:{}}; // histórico: quanto nasceu e quanto voltou, por observação
  var velho = NM-3; // só entra no histórico o que nasceu há 2+ meses (deu tempo de voltar)
  (D.linhas || []).forEach(function(t){
    var c = cls[t[3]-1]; if(!c || !c.considerar) return;
    var m = t[0]-1, i = t[1]-1, gp = t[4], pp = t[5], q = t[6], n = gp+pp;
    var mm = M[m];
    var mo = mm.mot[c.prefixo] || (mm.mot[c.prefixo] = {id:c.prefixo, legenda:c.legenda, g:0, p:0, rm:0, rc:0});
    mo.g += gp; mo.p += pp;
    var dn = deps[t[2]-1] || '';
    var dp = mm.dep[dn] || (mm.dep[dn] = {rot:dn, g:0, p:0});
    dp.g += gp; dp.p += pp;
    mm.g += gp; mm.p += pp; mm.net += n;
    var a = porItem.get(i);
    if(!a){ a = {n:new Float64Array(NM), q:new Float64Array(NM)}; porItem.set(i, a); }
    a.n[m] += n; a.q[m] += q;
    var kim = i*NM+m, d = porIM.get(kim); if(!d){ d = {}; porIM.set(kim, d); }
    d[c.prefixo] = (d[c.prefixo]||0) + n;
    var ol = itemObs.get(kim); if(!ol){ ol = []; itemObs.set(kim, ol); }
    ol.push({pref:c.prefixo, legenda:c.legenda, txt:obs[t[3]-1], dep:dn, n:n});
  });
  function pesos(i, m, sinal){
    var dim = porIM.get(i*NM+m); if(!dim) return null;
    var ks = Object.keys(dim).filter(function(k){ return dim[k]*sinal > 0; }), tw = ks.reduce(function(s,k){ return s+dim[k]; }, 0);
    if(!tw) return null;
    var w = {}; ks.forEach(function(k){ w[k] = dim[k]/tw; }); return w;
  }
  function fecha(i, ano, fila){
    var tot = 0;
    fila.forEach(function(e){
      tot += e.v;
      if(!e.w) return;
      Object.keys(e.w).forEach(function(k){ soma(e.v<0 ? M[e.m].abNeg : M[e.m].abPos, k, Math.abs(e.v)*e.w[k]); });
    });
    var f = fin.get(i) || {}; f[ano] = tot; fin.set(i, f);
  }
  porItem.forEach(function(a, i){
    var fila = [], anoAtual = '';
    for(var m=0; m<NM; m++){
      var ano = meses[m].slice(0,4);
      if(ano !== anoAtual){ if(anoAtual) fecha(i, anoAtual, fila); fila = []; anoAtual = ano; } // o acumulado zera a cada ano
      var n = a.n[m];
      if(Math.abs(n) < 0.005) continue;
      var rem = n, comp = 0, orig = {};
      if(n > 0){
        while(rem > 0.005 && fila.length && fila[0].v < 0){
          var t1 = Math.min(rem, -fila[0].v); comp += t1; soma(orig, meses[fila[0].m], t1);
          if(fila[0].velho && fila[0].w) Object.keys(fila[0].w).forEach(function(k){ soma(recup.neg, k, t1*fila[0].w[k]); });
          fila[0].v += t1; rem -= t1; if(fila[0].v > -0.005) fila.shift();
        }
      } else {
        while(rem < -0.005 && fila.length && fila[0].v > 0){
          var t2 = Math.min(-rem, fila[0].v); comp -= t2; soma(orig, meses[fila[0].m], t2);
          if(fila[0].velho && fila[0].w) Object.keys(fila[0].w).forEach(function(k){ soma(recup.pos, k, t2*fila[0].w[k]); });
          fila[0].v -= t2; rem += t2; if(fila[0].v < 0.005) fila.shift();
        }
      }
      if(Math.abs(rem) > 0.005){
        var ent = {m:m, v:rem, w:pesos(i, m, rem>0?1:-1), velho:m <= velho};
        fila.push(ent);
        if(ent.velho && ent.w) Object.keys(ent.w).forEach(function(k){ soma(rem<0 ? criado.neg : criado.pos, k, Math.abs(rem)*ent.w[k]); });
      }
      var real = n - comp, mm = M[m];
      mm.rm += real; mm.rc += comp;
      if(real > 0.005){ mm.rmG += real; mm.nG++; } else if(real < -0.005){ mm.rmP += real; mm.nP++; }
      if(comp > 0.005){ mm.rcPos += comp; mm.nRc++; } else if(comp < -0.005){ mm.rcNeg += comp; mm.nRc++; }
      Object.keys(orig).forEach(function(k){ soma(mm.oRc, k, comp>0 ? orig[k] : -orig[k]); });
      mm.itens.push({i:i, n:n, q:a.q[m], real:real, comp:comp, orig:orig});
      // quebra por observação: só as observações que empurram no mesmo sentido do item
      var dim = porIM.get(i*NM+m);
      if(dim){
        var ks = Object.keys(dim).filter(function(k){ return dim[k]*n > 0; }), tw = ks.reduce(function(s,k){ return s+dim[k]; }, 0);
        if(tw) ks.forEach(function(k){ var f = dim[k]/tw, mo = mm.mot[k]; if(mo){ mo.rm += real*f; mo.rc += comp*f; } });
      }
    }
    if(anoAtual) fecha(i, anoAtual, fila);
  });
  // taxa histórica: quanto do que nasceu (perda ou ganho) voltou depois; pouca base → usa a taxa geral
  var gl = {neg:[0,0], pos:[0,0]};
  ['neg','pos'].forEach(function(sg){ Object.keys(criado[sg]).forEach(function(k){ gl[sg][0] += criado[sg][k]; gl[sg][1] += recup[sg][k]||0; }); });
  function taxa(sg, k){
    var c = criado[sg][k]||0, r = recup[sg][k]||0;
    if(c >= 2000) return {t:Math.min(1, r/c), base:c, volta:r};
    return {t:gl[sg][0] ? Math.min(1, gl[sg][1]/gl[sg][0]) : 0, base:gl[sg][0], volta:gl[sg][1], geral:true};
  }
  var idxItem = {}; itens.forEach(function(c, j){ idxItem[c] = j; });
  ST.calc = {meses:M, itens:itens, nomes:D.nomes || {}, semDeposito: deps.length<=1 && (deps[0]||'')==='', NM:NM,
             porItem:porItem, itemObs:itemObs, fin:fin, taxa:taxa, idxItem:idxItem};
  if(!ST.mes || !meses.includes(ST.mes)) ST.mes = meses.length ? meses[meses.length-1] : null;
}
/* junta vários meses: observações uma vez cada */
function junta(lista){
  var mot = {}, net = 0, rm = 0, rc = 0;
  lista.forEach(function(m){
    net += m.net; rm += m.rm; rc += m.rc;
    Object.keys(m.mot).forEach(function(k){
      var o = m.mot[k], a = mot[k] || (mot[k] = {id:o.id, legenda:o.legenda, g:0, p:0, rm:0, rc:0});
      a.g += o.g; a.p += o.p; a.rm += o.rm; a.rc += o.rc;
    });
  });
  var obs = Object.keys(mot).map(function(k){ var o = mot[k]; o.v = o.g + o.p; return o; })
    .sort(function(a,b){ return Math.abs(b.v)-Math.abs(a.v); });
  var abs = obs.reduce(function(s,o){ return s+Math.abs(o.v); }, 0);
  return {net:net, rm:rm, rc:rc, obs:obs, abs:abs};
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

/* NET mensal: cada coluna = resultado do mês (azul) + recuperação do acumulado (laranja); ◆ = NET; última coluna = total do ano */
function svgMensal(W){
  var ano = ST.mes.slice(0,4), ms = mesesDoAno(ano);
  var colunas = ms.map(function(m){ return {k:m.mes, net:m.net, rm:m.rm, rc:m.rc, on:m.mes===ST.mes}; });
  var tn = ms.reduce(function(s,m){ return s+m.net; }, 0);
  colunas.push({k:'total:'+ano, net:tn, rm:tn, rc:0, tot:true});
  var H = 400, padL = 6, padR = 6, padT = 40, padB = 26, n = colunas.length;
  var cw = (W-padL-padR)/n, bw = Math.min(54, cw*.62);
  var mxM = 1, mxT = 1;
  colunas.forEach(function(c){
    var up = Math.max(c.rm,0)+Math.max(c.rc,0), dn = Math.min(c.rm,0)+Math.min(c.rc,0);
    var m = Math.max(up, -dn, Math.abs(c.net));
    if(c.tot) mxT = Math.max(mxT, m); else mxM = Math.max(mxM, m);
  });
  var base = padT + (H-padT-padB)/2, half = (H-padT-padB)/2 - 4;
  var g = '<line x1="'+padL+'" x2="'+(W-padR)+'" y1="'+base+'" y2="'+base+'" stroke="currentColor" opacity=".25"/>';
  colunas.forEach(function(c){
    var i = colunas.indexOf(c), cx = padL + (i+.5)*cw, x = cx-bw/2, mx = c.tot ? mxT : mxM;
    function sc(v){ return Math.abs(v)/mx*half; }
    var yu = base, yd = base, cel = '';
    [[c.rm, c.tot ? (c.net>=0?'#1F8A52':'#D83C1E') : COR.rm], [c.rc, COR.rc]].forEach(function(p){
      var v = p[0]; if(Math.abs(v) < 0.5) return;
      var h = sc(v);
      if(v > 0){ yu -= h; cel += '<rect x="'+x+'" y="'+yu+'" width="'+bw+'" height="'+h+'" fill="'+p[1]+'"/>'; }
      else { cel += '<rect x="'+x+'" y="'+yd+'" width="'+bw+'" height="'+h+'" fill="'+p[1]+'" opacity=".62"/>'; yd += h; }
    });
    var ny = base - (c.net>=0?1:-1)*sc(c.net);
    if(c.tot) g += '<line x1="'+(cx-cw/2)+'" x2="'+(cx-cw/2)+'" y1="'+(padT-26)+'" y2="'+(H-padB+2)+'" stroke="currentColor" opacity=".2" stroke-dasharray="3 3"/>';
    g += '<g class="nd-col" data-m="'+c.k+'" style="cursor:pointer">'
      + '<rect x="'+(cx-cw/2+1)+'" y="'+(padT-28)+'" width="'+(cw-2)+'" height="'+(H-padT-padB+32)+'" rx="9" fill="'+(c.on?'rgba(254,80,0,.10)':(c.tot?'rgba(11,18,48,.05)':'transparent'))+'"/>'
      + cel
      + '<path d="M'+cx+' '+(ny-6)+' l6 6 l-6 6 l-6 -6 Z" fill="#fff" stroke="#0B1230" stroke-width="2"/>'
      + '<text x="'+cx+'" y="'+(padT-14)+'" text-anchor="middle" font-size="'+(cw<62?11:12.5)+'" font-weight="800" fill="'+cor(c.net)+'">'+esc(compacto(c.net))+'</text>'
      + '<text x="'+cx+'" y="'+(H-7)+'" text-anchor="middle" font-size="12" font-weight="'+((c.on||c.tot)?800:600)+'" fill="currentColor" opacity="'+((c.on||c.tot)?1:.6)+'">'+(c.tot?'Total '+ano:mesCurto(c.k))+'</text>'
      + '</g>';
  });
  return '<svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" style="display:block">'+g+'</svg>';
}

/* ---------- peças da tela ---------- */
function ponte(m, ant){
  var rc = m.rc, rm = m.rm;
  var oRc = origens(m.oRc, 4);
  function card(cls, rot, val, linhas){
    return '<div class="nd-b '+cls+'"><span class="nd-k-rot">'+rot+'</span><strong>'+val+'</strong><div class="nd-b-l">'+linhas.map(function(l){ return '<span>'+l+'</span>'; }).join('')+'</div></div>';
  }
  return '<div class="nd-ponte">'
    + card('nd-b-net '+(m.net<0?'neg':'pos'), 'NET de '+esc(mesLongo(m.mes)), sgn(m.net), [ant ? sgn(m.net-ant.net)+' vs '+mesCurto(ant.mes) : ''])
    + card('nd-b-rm', 'Resultado do mês', sgn(rm), ['ganhos '+compacto(m.rmG)+' · '+nIt(m.nG), 'perdas '+compacto(m.rmP)+' · '+nIt(m.nP)])
    + card('nd-b-rc', 'Recuperação do acumulado', sgn(rc), ['perdas devolvidas '+compacto(m.rcPos), 'ganhos estornados '+compacto(m.rcNeg), nIt(m.nRc)+(oRc?' · de '+oRc:'')])
    + '</div>';
}
/* teto anual: quanto do teto o NET do ano já consumiu e o peso de cada observação */
function painelTeto(mes){
  var ano = mes.slice(0,4), J = junta(acumulado(mes)), net = J.net, teto = ST.teto;
  var uso = net < 0 ? -net : 0, usoPct = Math.min(100, uso/teto*100);
  var linhas = J.obs.slice(0, 7).map(function(o){
    var w = Math.min(50, Math.abs(o.v)/teto*100*2);
    var est = o.v>=0 ? 'left:50%;width:'+w+'%;' : 'left:'+(50-w)+'%;width:'+w+'%;';
    return '<div class="nd-row"><div class="nd-lab"><b>'+esc(o.id)+'</b>'+esc(o.legenda||'')+'</div>'
      + '<div class="nd-trk"><i style="'+est+'background:'+(o.v<0?COR.pn:COR.gn)+'"></i></div>'
      + '<div class="nd-val" style="color:'+cor(o.v)+'">'+sgn(o.v)+'<span class="nd-n" style="text-align:right">'+pct(o.v, teto)+' do teto</span></div></div>';
  }).join('');
  return '<div class="painel nd-p nd-estr"><h3>Teto anual <small>jan–'+mesCurto(mes)+'/'+ano.slice(2)+'</small></h3>'
    + '<div class="nd-teto"><div class="nd-teto-v"><span>Teto</span><button type="button" id="nd-teto-ed" title="Alterar o teto">'+brl(teto)+' ✎</button></div>'
    + '<div class="nd-teto-v"><span>NET acumulado</span><b style="color:'+cor(net)+'">'+sgn(net)+'</b></div>'
    + '<div class="nd-teto-v"><span>Teto usado</span><b>'+pct(uso, teto)+'</b></div></div>'
    + '<div class="nd-teto-b"><i style="width:'+usoPct+'%"></i></div>'
    + '<div class="nd-sub">NET acumulado por observação</div><div class="nd-estr-c">'+linhas+'</div></div>';
}
/* tabela por observação: resultado do mês, recuperação e NET */
function tabelaObs(m){
  var C = ST.calc;
  var arr = junta([m]).obs.filter(function(o){ return Math.abs(o.g) >= 0.5 || Math.abs(o.p) >= 0.5; });
  if(!arr.length) return '<div class="nd-vazio">Sem movimento</div>';
  // previsão: o que ainda está em aberto (perda sem ganho / ganho sem perda) e a chance histórica de voltar
  arr.forEach(function(o){
    var ab = (m.abPos[o.id]||0) - (m.abNeg[o.id]||0);
    var sg = ab < 0 ? 'neg' : 'pos', t = C.taxa(sg, o.id);
    o.ab = ab; o.t = t.t; o.rev = Math.abs(ab) * t.t;           // o que tende a reverter
    o.prov = o.v + (ab < 0 ? o.rev : -o.rev);                    // NET provável
  });
  var top = arr.slice(0, 10);
  if(arr.length > 10){
    var r = arr.slice(10).reduce(function(s,o){ s.v += o.v; s.rev += (o.ab<0?o.rev:-o.rev); s.prov += o.prov; return s; }, {id:'Outras', legenda:'', v:0, rev:0, prov:0, t:null});
    r.revAbs = r.rev; top.push(r);
  }
  var mx = Math.max(1, Math.max.apply(null, top.map(function(o){ return Math.abs(o.v); })));
  var tot = top.reduce(function(s,o){ s.v += o.v; s.rev += (o.id==='Outras' ? o.rev : (o.ab<0?o.rev:-o.rev)); s.prov += o.prov; return s; }, {v:0, rev:0, prov:0, t:null});
  function lin(o, extra, nome){
    var w = Math.min(50, Math.abs(o.v)/mx*50);
    var est = o.v>=0 ? 'left:50%;width:'+w+'%;' : 'left:'+(50-w)+'%;width:'+w+'%;';
    var rev = o.id==='Outras' || nome ? o.rev : (o.ab<0 ? o.rev : -o.rev);
    var chance = o.t==null ? '' : '<span class="nd-n" style="text-align:right">'+Math.round(o.t*100)+'% '+(o.ab<0?'volta':'estorna')+'</span>';
    return '<div class="nd-pg nd-pg3 '+(extra||'')+'"><div class="nd-lab">'+(nome || '<b>'+esc(o.id)+'</b>'+esc(o.legenda||''))+'</div>'
      + '<div class="nd-trk"><i style="'+est+'background:'+(o.v<0?COR.pn:COR.gn)+'"></i></div>'
      + '<div class="nd-val" style="color:'+cor(o.v)+'">'+sgn(o.v)+'</div>'
      + '<div class="nd-gn" style="color:'+cor(rev)+'">'+(Math.abs(rev)<0.5?'—':sgn(rev))+chance+'</div>'
      + '<div class="nd-val" style="color:'+cor(o.prov)+'">'+sgn(o.prov)+'</div></div>';
  }
  return '<div class="nd-pg nd-pg3 nd-pg-h"><div></div><div class="nd-trk-h"><span style="color:'+COR.pn+'">◀ perda</span><span style="color:'+COR.gn+'">ganho ▶</span></div><div>NET</div><div>Pode mudar</div><div>NET provável</div></div>'
    + top.map(function(o){ return lin(o); }).join('')
    + lin(tot, 'nd-pg-t', 'Total');
}
/* perda / ganho / NET por depósito */
function tabelaDep(mapa){
  var arr = Object.keys(mapa).map(function(k){ var o = mapa[k]; return {rot:o.rot||'(sem depósito)', g:o.g, p:o.p, v:o.g+o.p}; })
    .filter(function(x){ return Math.abs(x.g) >= 0.5 || Math.abs(x.p) >= 0.5; }).sort(function(a,b){ return Math.abs(b.v)-Math.abs(a.v); });
  if(!arr.length) return '<div class="nd-vazio">Sem movimento</div>';
  var top = arr.slice(0, 8);
  if(arr.length > 8){ top.push(arr.slice(8).reduce(function(s,x){ s.g += x.g; s.p += x.p; s.v += x.v; return s; }, {rot:'Outros', g:0, p:0, v:0})); }
  var mx = Math.max(1, Math.max.apply(null, top.map(function(x){ return Math.abs(x.v); })));
  var tot = top.reduce(function(s,x){ s.g += x.g; s.p += x.p; s.v += x.v; return s; }, {g:0, p:0, v:0});
  function lin(x, extra, nome){
    var w = Math.min(50, Math.abs(x.v)/mx*50);
    var est = x.v>=0 ? 'left:50%;width:'+w+'%;' : 'left:'+(50-w)+'%;width:'+w+'%;';
    return '<div class="nd-pg '+(extra||'')+'"><div class="nd-lab">'+esc(nome||x.rot)+'</div>'
      + '<div class="nd-trk"><i style="'+est+'background:'+(x.v<0?COR.pn:COR.gn)+'"></i></div>'
      + '<div class="nd-pn">'+brl(x.p)+'</div><div class="nd-gn">'+sgn(x.g)+'</div>'
      + '<div class="nd-val" style="color:'+cor(x.v)+'">'+sgn(x.v)+'</div></div>';
  }
  return '<div class="nd-pg nd-pg-h"><div></div><div class="nd-trk-h"><span style="color:'+COR.pn+'">◀ perda</span><span style="color:'+COR.gn+'">ganho ▶</span></div><div>Perda</div><div>Ganho</div><div>NET</div></div>'
    + top.map(function(x){ return lin(x); }).join('') + lin(tot, 'nd-pg-t', 'Total');
}
function dataBr(dh, dt){
  var s = String(dh || dt || '');
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if(!m) return '';
  return m[3]+'/'+m[2]+(m[4] && (m[4]!=='00' || m[5]!=='00') ? ' '+m[4]+':'+m[5] : '');
}
function listaItens(m, sinal){
  var ord = ST.ord, C = ST.calc, base = m.itens;
  if(ST.escopo === 'ano'){ // acumulado de janeiro até o mês escolhido
    var ano = m.mes.slice(0,4), ate = C.meses.findIndex(function(x){ return x.mes === m.mes; }), acc = [];
    C.porItem.forEach(function(a, i){
      var n = 0, q = 0;
      for(var k=0; k<=ate; k++){ if(C.meses[k].mes.slice(0,4) === ano){ n += a.n[k]; q += a.q[k]; } }
      if(Math.abs(n) >= 0.005) acc.push({i:i, n:n, q:q});
    });
    base = acc;
  }
  var lista = base.filter(function(x){ return sinal<0 ? x.n < -0.5 : x.n > 0.5; });
  lista.sort(function(a,b){ return ord==='pecas' ? Math.abs(b.q)-Math.abs(a.q) : Math.abs(b.n)-Math.abs(a.n); });
  return lista.slice(0, 150);
}
function renderItens(lista){
  var C = ST.calc;
  if(!lista.length) return '<div class="nd-vazio">Sem itens</div>';
  return '<div class="nd-scroll" title="Clique para rolar">'+lista.map(function(x){
    var cod = C.itens[x.i] || '', nome = C.nomes[cod] || '';
    var unit = Math.abs(x.q) > 0.5 ? Math.abs(x.n/x.q) : null;
    return '<div class="nd-it" data-cod="'+esc(cod)+'"><div class="nd-it-t"><b>'+esc(cod)+'</b>'+esc(nome)+'</div>'
      + '<div class="nd-it-q">'+fInt.format(Math.round(x.q))+' pç</div>'
      + '<div class="nd-it-u">'+(unit!=null ? brl(unit)+'<small>/pç</small>' : '—')+'</div>'
      + '<div class="nd-it-v" style="color:'+cor(x.n)+'">'+sgn(x.n)+'</div></div>';
  }).join('')+'</div>';
}
/* a lista tem barra de rolagem discreta; a roda do mouse só rola a lista depois de um clique nela
   (antes disso a roda continua rolando a página). Arrastar a barra funciona sempre. */
document.addEventListener('mousedown', function(e){
  var s = e.target.closest && e.target.closest('.nd-scroll'); if(s) s.classList.add('ativo');
});
document.addEventListener('mouseout', function(e){
  var s = e.target.closest && e.target.closest('.nd-scroll');
  if(s && s.classList.contains('ativo') && !(e.relatedTarget && s.contains(e.relatedTarget))) s.classList.remove('ativo');
});
document.addEventListener('wheel', function(e){
  var s = e.target.closest && e.target.closest('.nd-scroll');
  if(!s || s.classList.contains('ativo') || e.ctrlKey) return;
  e.preventDefault();
  window.scrollBy(0, e.deltaY);
}, {passive:false});

/* ---------- balões ---------- */
var TIP = null, HOV = null;
function criaTip(){ if(!TIP){ TIP = document.createElement('div'); TIP.className = 'nd-tip'; document.body.appendChild(TIP); } }
/* balão do mês: cada observação uma vez, com resultado do mês, recuperação e NET; no total do ano, perda, ganho e NET */
function tipMesHtml(chave){
  var C = ST.calc, J, titulo, total = chave.indexOf('total:') === 0;
  if(total){ var ano = chave.slice(6); J = junta(mesesDoAno(ano)); titulo = 'Total '+ano; }
  else { var m = C.meses.find(function(x){ return x.mes === chave; }); if(!m) return ''; J = junta([m]); titulo = mesLongo(chave)+'/'+chave.slice(0,4); }
  var h = '<div class="nd-tm-h"><b>'+esc(titulo)+'</b><span style="color:'+cor(J.net)+'">NET '+sgn(J.net)+'</span></div>';
  if(!total) h += '<div class="nd-tm-sub">Resultado do mês <b style="color:'+cor(J.rm)+'">'+sgn(J.rm)+'</b> + Recuperação do acumulado <b style="color:'+cor(J.rc)+'">'+sgn(J.rc)+'</b></div>';
  h += '<div class="nd-tg nd-tg-h"><span>Observação</span>'+(total ? '<span>Perda</span><span>Ganho</span>' : '<span>Do mês</span><span>Recup.</span>')+'<span>NET</span><span>%</span></div>';
  J.obs.filter(function(o){ return Math.abs(o.v) >= 0.5 || Math.abs(o.g) >= 0.5; }).slice(0, 12).forEach(function(o){
    var a = total ? o.p : o.rm, b = total ? o.g : o.rc;
    h += '<div class="nd-tg"><span class="nd-tg-o"><b>'+esc(o.id)+'</b> '+esc(o.legenda||'')+'</span><span style="color:'+cor(a)+'">'+sgn(a)+'</span><span style="color:'+cor(b)+'">'+sgn(b)+'</span><span style="color:'+cor(o.v)+'"><b>'+sgn(o.v)+'</b></span><span>'+pct(Math.abs(o.v), J.abs)+'</span></div>';
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
  var c = classificaFluxo(l.obs, legendaAtual(ST.dados)), us = String(l.usuario||'').replace(/^MECA_/,'');
  var un = Math.abs(l.qtd) > 0.5 ? Math.abs(l.valor/l.qtd) : null;
  return '<div class="nd-tl"><div class="nd-tl-o">'+esc(l.obs||c.prefixo)+'</div>'
    + '<div class="nd-tl-g"><span>Documento</span><b>'+esc(l.doc||'—')+'</b><span>Usuário</span><b>'+esc(us||'—')+'</b>'
    + '<span>Data</span><b>'+(dataBr(l.dh, l.dt)||'—')+'</b><span>Departamento</span><b>'+esc(l.depto||'—')+'</b>'
    + (l.deposito ? '<span>Depósito</span><b>'+esc(l.deposito)+'</b>' : '')
    + '<span>Quantidade</span><b>'+fInt.format(Math.round(l.qtd))+' pç'+(un!=null?' × '+brl(un):'')+'</b>'
    + '<span>Valor</span><b style="color:'+cor(l.valor)+'">'+sgn(l.valor)+'</b></div></div>';
}
/* tudo o que se sabe do item no mês escolhido: posição, previsão e de onde veio */
function ficha(cod){
  var C = ST.calc, i = C.idxItem[cod], a = i == null ? null : C.porItem.get(i);
  if(!a) return null;
  var mi = C.meses.findIndex(function(x){ return x.mes === ST.mes; }), ano = ST.mes.slice(0,4);
  var antes = 0, depois = 0;
  for(var k=0; k<C.NM; k++){ if(C.meses[k].mes.slice(0,4) !== ano) continue; if(k < mi) antes += a.n[k]; else if(k > mi) depois += a.n[k]; }
  var reg = itemDoMes(cod) || {n:a.n[mi], q:a.q[mi], real:a.n[mi], comp:0, orig:{}};
  var aberto = (C.fin.get(i) || {})[ano] || 0;
  var obsMap = {};
  (C.itemObs.get(i*C.NM+mi) || []).forEach(function(o){ var k = o.txt || '', r = obsMap[k] || (obsMap[k] = {pref:o.pref, legenda:o.legenda, txt:o.txt, n:0, deps:{}}); r.n += o.n; if(o.dep) r.deps[o.dep] = 1; });
  var obsL = Object.keys(obsMap).map(function(k){ var r = obsMap[k]; r.dep = Object.keys(r.deps).join(', '); return r; }).sort(function(x,y){ return Math.abs(y.n)-Math.abs(x.n); });
  return {cod:cod, antes:antes, depois:depois, reg:reg, aberto:aberto, obsL:obsL, n:a.n[mi], q:a.q[mi]};
}
function cicloDe(txt){ var m = String(txt||'').match(/(\d+)\s*[ºo°]?\s*CICLO/i); return m ? m[1]+'º ciclo' : ''; }
function tipHtml(cod){
  var C = ST.calc, f = ficha(cod); if(!f) return '';
  var nome = C.nomes[cod] || '', x = f.reg, n = f.n, q = f.q;
  var unit = Math.abs(q) > 0.5 ? Math.abs(n/q) : null;
  // previsão: o que está em aberto hoje e a chance histórica de voltar
  var ab = f.aberto, prev = '';
  if(Math.abs(ab) < 0.5){
    prev = '<div class="nd-pv nd-pv-ok"><b>Compensado</b><span>o que saiu voltou — sem perda nem ganho em aberto</span></div>';
  } else {
    var sg = ab < 0 ? 'neg' : 'pos';
    var dom = f.obsL.filter(function(o){ return ab < 0 ? o.n < 0 : o.n > 0; })[0];
    var t = C.taxa(sg, dom ? dom.pref : '');
    var reaparece = Math.abs(ab) * t.t, fica = Math.abs(ab) - reaparece;
    prev = '<div class="nd-pv '+(ab<0?'nd-pv-neg':'nd-pv-pos')+'">'
      + '<div class="nd-pv-h"><b>'+(ab<0 ? 'Perda em aberto' : 'Ganho em aberto')+' '+sgn(ab)+'</b><span>'+(ab<0 ? 'nenhum ganho do item em contrapartida' : 'nenhuma perda do item em contrapartida')+'</span></div>'
      + '<div class="nd-pv-g"><span>'+(ab<0 ? 'Chance de reaparecer' : 'Chance de estorno (duplicado/ajuste)')+'</span><b>'+Math.round(t.t*100)+'%</b>'
      + '<span>'+(ab<0 ? 'Recuperável' : 'Risco de estorno')+'</span><b style="color:'+cor(ab<0 ? reaparece : -reaparece)+'">'+sgn(ab<0 ? reaparece : -reaparece)+'</b>'
      + '<span>'+(ab<0 ? 'Perda provável' : 'Ganho que deve ficar')+'</span><b style="color:'+cor(ab<0 ? -fica : fica)+'">'+sgn(ab<0 ? -fica : fica)+'</b></div>'
      + '<div class="nd-pv-b">base histórica'+(t.geral?' (geral)':' ('+esc(dom?dom.pref:'')+')')+': '+brl(t.volta)+' de '+brl(t.base)+' '+(ab<0?'voltaram':'foram estornados')+'</div></div>';
  }
  var pos = '<div class="nd-tp-n nd-tp-n4"><div><span>Antes do mês</span><strong style="color:'+cor(f.antes)+'">'+(Math.abs(f.antes)<0.5?'—':sgn(f.antes))+'</strong></div>'
    + '<div><span>Neste mês</span><strong style="color:'+cor(n)+'">'+sgn(n)+'</strong></div>'
    + '<div><span>Depois</span><strong style="color:'+cor(f.depois)+'">'+(Math.abs(f.depois)<0.5?'—':sgn(f.depois))+'</strong></div>'
    + '<div><span>Em aberto hoje</span><strong style="color:'+cor(ab)+'">'+(Math.abs(ab)<0.5?'—':sgn(ab))+'</strong></div></div>';
  var comp = Math.abs(x.comp) > 0.5 ? '<div class="nd-tp-c" style="--c:'+(x.comp>0?COR.rc:'#E7A096')+'">'+(x.comp>0?'Devolve perda de ':'Estorna ganho de ')+esc(origens(x.orig, 4))+'</div>' : '';
  var leg = legendaAtual(ST.dados);
  var obsH = f.obsL.length ? '<div class="nd-ob"><div class="nd-ob-t">Observação e inventário</div>'+f.obsL.slice(0,2).map(function(o){
      var ci = cicloDe(o.txt), cl = classificaFluxo(o.txt, leg);
      return '<div class="nd-ob-l"><div><b>'+esc(cl.prefixo)+'</b> '+esc(cl.legenda||'')+(ci?' <span class="nd-ob-c">'+esc(ci)+'</span>':'')+'</div>'
        + '<div class="nd-ob-x">'+esc(o.txt||'(sem observação)')+'</div>'
        + '<div class="nd-ob-v"><span>'+(o.dep?esc(o.dep):'')+'</span><b style="color:'+cor(o.n)+'">'+sgn(o.n)+'</b></div></div>';
    }).join('')+'</div>' : '';
  var L = ST.det[ST.mes+'|'+cod];
  var lan = !L ? '<div class="nd-tl-p">carregando lançamentos…</div>'
    : (L.length ? L.slice(0, 1).map(lancamentoHtml).join('') + (L.length>1 ? '<div class="nd-tl-p">+'+(L.length-1)+' lançamento'+(L.length>2?'s':'')+'</div>' : '') : '');
  return '<div class="nd-tp-h"><b>'+esc(cod)+'</b> '+esc(nome)+'</div>'
    + '<div class="nd-tp-n"><div><span>NET no mês</span><strong style="color:'+cor(n)+'">'+sgn(n)+'</strong></div>'
    + '<div><span>Peças</span><strong>'+fInt.format(Math.round(q))+'</strong></div>'
    + '<div><span>Custo/peça</span><strong>'+(unit!=null?brl(unit):'—')+'</strong></div></div>'
    + pos + comp + prev + obsH + lan;
}
function mostraTip(ev, cod){
  criaTip(); HOV = cod; TIP.className = 'nd-tip'; TIP.innerHTML = tipHtml(cod); TIP.style.display = 'block'; moveTip(ev);
  var mes = ST.mes, k = mes+'|'+cod;
  if(!ST.det[k] && !ST.detBusca[k]){
    ST.detBusca[k] = 1;
    var busca = ST.fonte === 'pasta' && window.NETPASTA
      ? window.NETPASTA.detalhe(mes).then(function(arr){ ST.det[k] = arr.filter(function(l){ return l.item === cod; }); })
      : window.ldmSupa.rpc('net_fluxo_linhas', {p_mes:mes, p_itens:[cod]}).then(function(r){
          if(r.error) throw r.error;
          ST.det[k] = (r.data || []).filter(function(l){ return l.item === cod; });
        });
    busca.catch(function(){ ST.det[k] = []; delete ST.detBusca[k]; }).then(function(){
      if(HOV === cod && ST.mes === mes && TIP){ TIP.innerHTML = tipHtml(cod); }
    });
  }
}
function moveTip(ev){
  if(!TIP || TIP.style.display === 'none') return;
  var pad = 16, r = TIP.getBoundingClientRect();
  var x = ev.clientX + pad, y = ev.clientY + pad;
  if(x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
  if(y + r.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - r.height - 8);
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
function preencheFiltros(C){
  var sa = $('nd-ano'), sm = $('nd-mes'); if(!sa || !sm) return;
  var anos = []; C.meses.forEach(function(x){ var a = x.mes.slice(0,4); if(anos.indexOf(a) < 0) anos.push(a); });
  anos.sort().reverse();
  var ano = ST.mes.slice(0,4);
  sa.innerHTML = anos.map(function(a){ return '<option value="'+a+'"'+(a===ano?' selected':'')+'>'+a+'</option>'; }).join('');
  sm.innerHTML = mesesDoAno(ano).map(function(x){ return '<option value="'+x.mes+'"'+(x.mes===ST.mes?' selected':'')+'>'+mesLongo(x.mes)+'</option>'; }).join('');
}
function desenha(){
  var corpo = $('nd-corpo'), chips = null, em = $('nd-em');
  if(!corpo) return;
  if(em) em.textContent = ST.fonteTxt || (ST.em ? 'nuvem · '+ST.em.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '');
  if(ST.carregando && !ST.calc){
    corpo.innerHTML = '<div class="nd-ponte"><div class="nd-skel"></div><div></div><div class="nd-skel"></div><div></div><div class="nd-skel"></div></div><div class="nd-grid nd-g2"><div class="nd-skel" style="height:340px"></div><div class="nd-skel" style="height:340px"></div></div>';
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
  preencheFiltros(C);
  var dep = C.semDeposito
    ? '<div class="nd-vazio"><b>Depósito indisponível</b>Reimporte a QRY410 no Inventário.</div>'
    : tabelaDep(m.dep);
  var lp = listaItens(m, -1), lg = listaItens(m, 1);
  corpo.innerHTML =
    ponte(m, ant)
    + '<div class="nd-grid nd-g2">'
    + '<div class="painel nd-p"><h3>NET mensal <small>passe o mouse num mês</small></h3>'+fluid('mensal', svgMensal, 400)
    + '<div class="nd-leg"><span><i style="background:'+COR.rm+'"></i>Resultado do mês</span><span><i style="background:'+COR.rc+'"></i>Recuperação do acumulado</span><span>◆ NET</span></div></div>'
    + painelTeto(m.mes)
    + '</div>'
    + '<div class="nd-grid nd-g3">'
    + '<div class="painel nd-p"><h3>NET por observação <small>'+esc(mesLongo(m.mes))+'</small></h3>'+tabelaObs(m)+'</div>'
    + '<div class="painel nd-p"><h3>NET por depósito <small>'+esc(mesLongo(m.mes))+'</small></h3>'+dep+'</div>'
    + '</div>'
    + '<div class="painel nd-p" style="margin-top:14px"><h3>Itens mais divergentes <small>'+(ST.escopo==='ano' ? 'jan–'+mesCurto(m.mes)+'/'+m.mes.slice(2,4) : esc(mesLongo(m.mes))+'/'+m.mes.slice(0,4))+' <span class="nd-ord"><button type="button" data-nd-esc="mes" class="'+(ST.escopo!=='ano'?'on':'')+'">Mês</button><button type="button" data-nd-esc="ano" class="'+(ST.escopo==='ano'?'on':'')+'">Ano</button></span> <span class="nd-ord"><button type="button" data-nd-ord="valor" class="'+(ST.ord==='valor'?'on':'')+'">Valor</button><button type="button" data-nd-ord="pecas" class="'+(ST.ord==='pecas'?'on':'')+'">Peças</button></span></small></h3>'
    + '<div class="nd-grid nd-g3" style="margin:0"><div><div class="nd-k-rot nd-it-h" style="color:'+COR.pn+'">Perdas · '+fInt.format(lp.length)+' itens</div>'+renderItens(lp)+'</div>'
    + '<div><div class="nd-k-rot nd-it-h" style="color:'+COR.gn+'">Ganhos · '+fInt.format(lg.length)+' itens</div>'+renderItens(lg)+'</div></div></div>';
  ajusta();
}

async function carregar(forcar){
  if(ST.carregando) return;
  if(ST.calc && !forcar){ desenha(); return; }
  ST.carregando = true; ST.erro = null; if(forcar){ ST.det = {}; ST.detBusca = {}; } desenha();
  try {
    var NP = window.NETPASTA, loc = null;
    // 1) arquivo da pasta conectada (se houver) — 2) nuvem (a base que o Inventário guarda)
    if(NP){
      if(forcar && NP.conectada()) loc = await NP.sincronizar(true);
      if(!loc) loc = await NP.dadosLocais();
    }
    if(loc){ ST.dados = loc.dados; ST.fonte = 'pasta'; ST.fonteTxt = loc.txt; }
    else {
      var r = await window.ldmSupa.rpc('net_fluxo');
      if(r.error) throw r.error;
      ST.dados = r.data; ST.fonte = 'nuvem'; ST.fonteTxt = '';
    }
    calcula(); ST.em = new Date();
    if(ST.fonte === 'nuvem') ST.fonteTxt = 'nuvem · '+ST.em.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  } catch(e){ ST.erro = (e && (e.message || e.details)) || String(e); }
  ST.carregando = false; desenha();
}

document.addEventListener('change', function(e){
  if(e.target.id === 'nd-ano'){
    var ms = mesesDoAno(e.target.value); if(!ms.length) return;
    var igual = ms.find(function(x){ return x.mes.slice(5) === ST.mes.slice(5); });
    ST.mes = (igual || ms[ms.length-1]).mes; desenha();
  } else if(e.target.id === 'nd-mes'){ ST.mes = e.target.value; desenha(); }
});
document.addEventListener('click', function(e){
  var g = e.target.closest('.nd-col'); if(g && /^\d{4}-\d{2}$/.test(g.dataset.m)){ ST.mes = g.dataset.m; desenha(); return; }
  var o = e.target.closest('[data-nd-ord]'); if(o){ ST.ord = o.dataset.ndOrd; desenha(); return; }
  var es = e.target.closest('[data-nd-esc]'); if(es){ ST.escopo = es.dataset.ndEsc; desenha(); return; }
  if(e.target.closest('#nd-teto-ed')){
    var v = prompt('Teto anual do NET (R$):', String(ST.teto));
    var n = v ? parseFloat(String(v).replace(/\./g,'').replace(',','.')) : NaN;
    if(n > 0){ ST.teto = n; try { localStorage.setItem(TETO_KEY, String(n)); } catch(x){} desenha(); }
    return;
  }
  if(e.target.closest('#nd-atualizar')){ carregar(true); }
});

window.NETDASH = {
  /* dados novos vindos da pasta conectada (ou null ao desconectar) */
  usarDados: function(loc){
    if(!loc){ ST.calc = null; ST.dados = null; ST.det = {}; ST.detBusca = {}; if(ST.pronto && ST.quer) carregar(false); return; }
    ST.dados = loc.dados; ST.fonte = 'pasta'; ST.fonteTxt = loc.txt; ST.det = {}; ST.detBusca = {};
    calcula(); ST.em = new Date(); desenha();
  },
  abrir: function(){ ST.quer = true; if(ST.pronto) carregar(false); },
  // A aba pode já ter sido aberta antes deste arquivo carregar (endereço terminando em #net):
  // por isso, ao ficar pronto, confere se a aba NET está à vista e carrega do mesmo jeito.
  pronto: function(){
    ST.pronto = true;
    if(window.NETPASTA) window.NETPASTA.iniciar();
    var v = document.querySelector('.view[data-view="net"]');
    if(ST.quer || (v && !v.hidden)) carregar(false);
  },
  redesenha: function(){ if(ST.calc){ calcula(); desenha(); } },
  _estado: function(){ return ST; }
};
})();
