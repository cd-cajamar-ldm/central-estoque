/* =========================================================================
   NET — Relatório da controladoria (boletim em imagem + apresentação PPTX)
   -------------------------------------------------------------------------
   Reproduz o formato do fechamento enviado à controladoria:
   - Boletim de 1 página (PNG): Entrada, Saída, NET, peso de cada OBS,
     NET por departamento (top 3 / bottom 3), NET por OBS e por setor.
   - Apresentação de 7 slides (PPTX): capa, resumo executivo, composição
     (cascata), NET por observação, NET por setor, NET por departamento e
     encerramento.
   Base: só os lançamentos que entram no NET (mesmas regras do fechamento).
   Os textos de "Leitura" são montados a partir dos números e podem ser
   editados antes de baixar — ficam salvos junto com o mês.
   ========================================================================= */
(function(){
'use strict';
var API = window.NET_API;
if(!API) return;

var COR = {laranja:'FE5000', azul:'001A72', escuro:'14172B', cinza:'6B7190', verde:'1F9D55', verdeClaro:'3DDC84', vermelho:'D83C1E', lilas:'8EA2FF'};
var PALETA = ['FE5000','001A72','FF8A4C','5468C9','FFB38A','8EA2FF','2A3A9E','B9C0DD','C83812','A6AECD'];
var IMG = 'brand/relatorio/';
var esc = API.esc;

/* ---------- formatação no padrão do relatório: "R$ -3.124.493,86" ---------- */
var f2 = new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2, maximumFractionDigits:2});
var f0 = new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0});
var f1 = new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1, maximumFractionDigits:1});
function rs(v){ v=v||0; return 'R$ '+(v<0?'-':'')+f2.format(Math.abs(v)); }
function rs0(v){ v=v||0; return 'R$ '+(v<0?'-':'')+f0.format(Math.abs(v)); }
function rsSinal(v){ return (v>0?'+':'')+rs(v); }
function mil(v, sinal){
  v=v||0; var a=Math.abs(v), t;
  if(a>=1e6) t=f1.format(a/1e6)+' mi';
  else if(a>=1e5) t=f0.format(a/1e3)+' mil';
  else if(a>=1e3) t=f1.format(a/1e3)+' mil';
  else t=f2.format(a);
  // padrão do report: "+R$ 10,4 mil" e "R$ -242 mil"
  return v<0 ? 'R$ -'+t : ((sinal&&v>0?'+':'')+'R$ '+t);
}
function milCurto(v){ v=v||0; var a=Math.abs(v), s=v<0?'-':'+'; return s+(a>=1e3? f1.format(a/1e3)+' mil' : f2.format(a)); }
function pctNet(M){ var r=M.vol?Math.abs(M.net)/M.vol:0; return r<0.0001 ? 'praticamente 0%' : pct(r,2); }
function pct(v, casas){ return (casas===2?f2:f1).format((v||0)*100)+'%'; }
function nomeMes(m){ return API.MESES[parseInt(m.slice(5,7),10)-1]; }
function mesAno(m){ return nomeMes(m)+' '+m.slice(0,4); }
function mesAnterior(m){ var y=+m.slice(0,4), mm=+m.slice(5,7)-1; if(mm<1){ mm=12; y--; } return y+'-'+String(mm).padStart(2,'0'); }

/* ---------- métricas do mês ---------- */
function metricas(mes){
  var m = API.getMes(mes); if(!m) return null;
  var L = [], deps = {};
  m.linhas.forEach(function(r){
    var c = API.avalia(r);
    if(!c.noNet){ if(c.motivoFora && c.motivoFora.indexOf('Depósito')===0) deps[r.nomedeposito||('Depósito '+r.iddeposito)]=1; return; }
    L.push({r:r, c:c});
  });
  var M = {mes:mes, entrada:0, saida:0, mov:L.length, itens:{}, deptos:{}, obs:{}, setor:{}, depto:{}, depositosFora:Object.keys(deps)};
  L.forEach(function(x){
    var r=x.r, v=r.vl, pfx=x.c.prefixo, set=(x.c.setor||'CD').toUpperCase(), dep=r.nomedepto||'(sem depto)';
    if(v>=0) M.entrada+=v; else M.saida+=v;
    M.itens[r.item]=1; M.deptos[dep]=1;
    var o = M.obs[pfx] = M.obs[pfx] || {prefixo:pfx, legenda:x.c.legenda, setor:set, e:0, s:0, mov:0};
    if(v>=0) o.e+=v; else o.s+=v; o.mov++;
    var st = M.setor[set] = M.setor[set] || {setor:set, e:0, s:0, mov:0, itens:{}};
    if(v>=0) st.e+=v; else st.s+=v; st.mov++; st.itens[r.item]=1;
    M.depto[dep] = (M.depto[dep]||0) + v;
  });
  M.net = M.entrada + M.saida;
  M.vol = M.entrada - M.saida;
  M.nItens = Object.keys(M.itens).length;
  M.nDeptos = Object.keys(M.deptos).length;
  M.obsLista = Object.keys(M.obs).map(function(k){ var o=M.obs[k]; o.net=o.e+o.s; o.vol=o.e-o.s; o.pv=M.vol?o.vol/M.vol:0; return o; })
    .sort(function(a,b){ return b.net-a.net; });
  M.setorLista = Object.keys(M.setor).map(function(k){ var s=M.setor[k]; s.net=s.e+s.s; s.vol=s.e-s.s; s.pv=M.vol?s.vol/M.vol:0; s.nItens=Object.keys(s.itens).length; s.medio=s.mov?s.net/s.mov:0; return s; })
    .sort(function(a,b){ return b.net-a.net; });
  var dl = Object.keys(M.depto).map(function(k){ return {nome:k, net:M.depto[k]}; });
  M.deptoGanhos = dl.filter(function(d){return d.net>0;}).sort(function(a,b){return b.net-a.net;});
  M.deptoPerdas = dl.filter(function(d){return d.net<0;}).sort(function(a,b){return a.net-b.net;});
  var top = M.deptoGanhos.slice(0,5).concat(M.deptoPerdas.slice(0,5));
  M.outrosDeptos = {n: dl.length-top.length, soma: dl.reduce(function(s,d){ return s+(top.indexOf(d)===-1?d.net:0); },0)};
  return M;
}
function variacao(a,b){ return b ? (a-b)/Math.abs(b) : null; }

/* ---------- textos automáticos (títulos e leituras) ---------- */
function textosAuto(M, P){
  var T = {}, mN = nomeMes(M.mes), pN = P ? nomeMes(P.mes).toLowerCase() : '';
  var maisPos = M.obsLista[0], maisNeg = M.obsLista[M.obsLista.length-1];
  var maiorVol = M.obsLista.slice().sort(function(a,b){return b.vol-a.vol;})[0];
  var proxZero = Math.abs(M.net) < 0.02*M.vol;

  // Resumo executivo
  if(P && M.net>=0 && P.net<0) T.resumoTitulo = mN+' vira o NET para positivo';
  else if(P && M.net<0 && P.net>=0) T.resumoTitulo = mN+' vira o NET para negativo';
  else T.resumoTitulo = mN+' fecha o NET '+(M.net>=0?'positivo':'negativo')+' em '+mil(M.net,true);
  var vv = P ? variacao(M.vol,P.vol) : null;
  T.resumo = (vv!==null ? 'O volume de ajustes '+(vv>=0?'cresceu ':'caiu ')+pct(Math.abs(vv))+' sobre '+pN : 'O volume de ajustes foi de '+mil(M.vol))
    + (proxZero ? ', mas entradas e saídas quase se anularam: o NET fecha em '+mil(M.net,true)+(pctNet(M)==='praticamente 0%' ? ', praticamente zero frente ao volume.' : ', só '+pctNet(M)+' do volume.')
               : '; o NET fecha em '+mil(M.net,true)+', '+pctNet(M)+' do volume.');

  // Composição
  if(maisPos && maisNeg && maisPos.net>0 && maisNeg.net<0){
    T.composicaoTitulo = maisPos.legenda+' sustenta'+(/s$/i.test(maisPos.legenda)?'m':'')+' o mês; '+maisNeg.legenda+' é a maior perda';
    T.composicao = 'Sem o '+maisNeg.prefixo+' ('+maisNeg.legenda+', '+mil(maisNeg.net)+'), o NET seria de '+mil(M.net-maisNeg.net,true)+'. É o principal ponto de atenção do mês.';
  } else {
    T.composicaoTitulo = 'Composição do NET por código';
    T.composicao = 'O NET do mês fecha em '+mil(M.net,true)+'.';
  }

  // Por observação
  T.obsTitulo = maisNeg && maisNeg.net<0 ? maisNeg.prefixo+' é o código com maior perda no mês' : 'Todos os códigos fecham positivos no mês';
  T.obs = maiorVol ? maiorVol.prefixo+' movimenta '+f0.format(maiorVol.pv*100)+'% do volume e fecha em '+mil(maiorVol.net)+'.'
    + (maisNeg && maisNeg.net<0 && maisNeg!==maiorVol ? ' O '+maisNeg.prefixo+', com '+mil(maisNeg.net)+', é o maior ofensor'+(maisNeg.e===0?' (100% perda).':'.') : '') : '';

  // Setor
  var S = M.setorLista;
  if(S.length>=2 && S[0].net>0 && S[S.length-1].net<0){
    var a=S[0], b=S[S.length-1];
    T.setorTitulo = cap(a.setor)+' compensa o '+cap(b.setor)+(M.net>=0?' e garante o resultado positivo':', mas o mês fecha negativo');
    T.setor = 'A '+cap(a.setor)+' representa '+f0.format(a.pv*100)+'% do volume e gera '+mil(a.net,true)+'. O '+cap(b.setor)+', com '+f0.format(b.pv*100)+'% do volume, fecha em '+mil(b.net)+'.';
    T.boletim = cap(a.setor)+' fecha positivo ('+rs0(a.net).replace('R$ ','+R$ ')+') e o '+cap(b.setor)+' fica negativo ('+rs0(b.net)+'); o mês fecha '+(Math.abs(M.net)<0.02*M.vol?'levemente ':'')+(M.net>=0?'positivo':'negativo')+' em '+rs(M.net)+'.';
  } else {
    T.setorTitulo = 'NET por setor';
    T.setor = S.map(function(s){ return cap(s.setor)+': '+mil(s.net,true)+' ('+f0.format(s.pv*100)+'% do volume)'; }).join(' · ')+'.';
    T.boletim = 'O mês fecha '+(M.net>=0?'positivo':'negativo')+' em '+rs(M.net)+'.';
  }

  // Departamento
  var p5 = M.deptoPerdas.slice(0,5), soma5 = p5.reduce(function(s,d){return s+d.net;},0);
  T.deptoTitulo = p5.length>=2 ? p5[0].nome+' e '+p5[1].nome+' lideram as perdas' : (p5.length ? p5[0].nome+' lidera as perdas' : 'Nenhum departamento com perda no mês');
  T.depto = p5.length ? 'Os '+p5.length+' maiores ofensores somam '+mil(soma5)+'.' : 'Nenhum departamento fechou negativo.';
  if(P && p5.length){
    var ant = P.depto[p5[0].nome];
    if(ant<0) T.depto += ' '+p5[0].nome+' segue como ponto crítico (já aparecia em '+pN+', '+mil(ant)+').';
  }
  return T;
}
function cap(s){ s=String(s||'').toLowerCase(); return s.length<=3 ? s.toUpperCase() : s.charAt(0).toUpperCase()+s.slice(1); }

var CAMPOS = [
  ['boletim','Boletim (imagem) — leitura'],
  ['resumoTitulo','Slide 2 · Resumo executivo — título'], ['resumo','Slide 2 · Resumo executivo — leitura'],
  ['composicaoTitulo','Slide 3 · Composição — título'], ['composicao','Slide 3 · Composição — leitura'],
  ['obsTitulo','Slide 4 · Por observação — título'], ['obs','Slide 4 · Por observação — leitura'],
  ['setorTitulo','Slide 5 · Por setor — título'], ['setor','Slide 5 · Por setor — leitura'],
  ['deptoTitulo','Slide 6 · Por departamento — título'], ['depto','Slide 6 · Por departamento — leitura']
];
function textos(M, P){
  var auto = textosAuto(M,P), m = API.getMes(M.mes), ed = (m && m.leituras) || {}, T = {};
  CAMPOS.forEach(function(c){ T[c[0]] = (ed[c[0]]!=null && ed[c[0]]!=='') ? ed[c[0]] : auto[c[0]]; });
  return T;
}
function fonte(M){
  return 'Fonte: CONSOLIDADO NET CDS (CONSIDERAR NET = SIM'+(M.depositosFora.length?', exceto '+M.depositosFora.join(', '):'')+')';
}

/* =========================================================================
   BOLETIM (1 página, HTML -> PNG)
   ========================================================================= */
function donutSVG(M){
  var itens = M.obsLista.filter(function(o){return Math.abs(o.net)>0.005;}), tot = itens.reduce(function(s,o){return s+Math.abs(o.net);},0);
  var cx=150, cy=150, R=120, r=78, a0=-Math.PI/2, segs='', pos=0, neg=0;
  var tonsPos=['#FE5000','#FF6B2C','#FF8A4C','#FFA877','#FFC4A3'], tonsNeg=['#2E4596','#001A72','#5468C9','#8EA2FF','#B9C0DD'];
  itens.forEach(function(o){
    var frac = tot? Math.abs(o.net)/tot : 0, a1 = a0 + frac*2*Math.PI;
    o._cor = o.net>=0 ? tonsPos[pos++%tonsPos.length] : tonsNeg[neg++%tonsNeg.length];
    if(frac>=0.9999){ segs+='<circle cx="'+cx+'" cy="'+cy+'" r="'+((R+r)/2)+'" fill="none" stroke="'+o._cor+'" stroke-width="'+(R-r)+'"/>'; }
    else if(frac>0){
      var g = frac>0.5?1:0, p=function(rad,a){ return (cx+rad*Math.cos(a)).toFixed(2)+' '+(cy+rad*Math.sin(a)).toFixed(2); };
      segs += '<path d="M '+p(R,a0)+' A '+R+' '+R+' 0 '+g+' 1 '+p(R,a1)+' L '+p(r,a1)+' A '+r+' '+r+' 0 '+g+' 0 '+p(r,a0)+' Z" fill="'+o._cor+'" stroke="#fff" stroke-width="2"/>';
    }
    a0 = a1;
  });
  var corNet = M.net>=0?'#1F9D55':'#D83C1E';
  var svg = '<svg width="300" height="300" viewBox="0 0 300 300">'+segs
    + '<text x="150" y="140" text-anchor="middle" font-size="14" fill="#6B7190" font-family="Inter,Arial">NET '+esc(nomeMes(M.mes))+'</text>'
    + '<text x="150" y="168" text-anchor="middle" font-size="20" font-weight="800" fill="'+corNet+'" font-family="Inter,Arial">'+esc(rs(M.net))+'</text></svg>';
  var leg = itens.map(function(o){
    return '<div class="bl-dl"><span class="bl-dot" style="background:'+o._cor+'"></span><div><strong style="color:'+(o.net>=0?'#C83812':'#001A72')+'">'+esc(o.legenda)+'</strong><span>'+esc(o.prefixo)+' · '+esc(rs0(o.net))+'</span></div></div>';
  }).join('');
  return '<div class="bl-donut">'+svg+'<div class="bl-dlista">'+leg+'</div></div>';
}
function deptoSVG(M){
  var pos = M.deptoGanhos.slice(0,3), neg = M.deptoPerdas.slice(0,3).reverse(), rows = pos.concat(neg);
  var max = rows.reduce(function(m,d){return Math.max(m,Math.abs(d.net));},1);
  var W=500, rowH=58, x0=300, half=80, H=rows.length*rowH+10, out='';
  rows.forEach(function(d,i){
    var y=10+i*rowH, w=Math.max(2,Math.abs(d.net)/max*half), cor=d.net>=0?'#FE5000':'#001A72';
    // nome longo quebra em 2 linhas (cabe ~22 caracteres por linha)
    var nome=d.nome, l1=nome, l2='';
    if(nome.length>22){ var corte=nome.lastIndexOf(' ',22); if(corte<8) corte=22; l1=nome.slice(0,corte); l2=nome.slice(corte).trim(); if(l2.length>24) l2=l2.slice(0,23)+'…'; }
    var tx=x0-half-12;
    out += l2 ? '<text text-anchor="end" font-size="14" fill="#14172B" font-family="Inter,Arial"><tspan x="'+tx+'" y="'+(y+23)+'">'+esc(l1)+'</tspan><tspan x="'+tx+'" y="'+(y+41)+'">'+esc(l2)+'</tspan></text>'
              : '<text x="'+tx+'" y="'+(y+32)+'" text-anchor="end" font-size="15" fill="#14172B" font-family="Inter,Arial">'+esc(l1)+'</text>';
    out += '<rect x="'+(d.net>=0?x0:x0-w)+'" y="'+(y+10)+'" width="'+w+'" height="34" fill="'+cor+'"/>';
    out += '<text x="'+(W-4)+'" y="'+(y+31)+'" text-anchor="end" font-size="14" font-weight="800" fill="'+cor+'" font-family="Inter,Arial">'+esc(rs0(d.net))+'</text>';
  });
  out += '<line x1="'+x0+'" y1="4" x2="'+x0+'" y2="'+(H)+'" stroke="#B8BED3" stroke-width="2"/>';
  return '<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">'+out+'</svg>';
}
function corVal(v){ return v>0?'#1F9D55':(v<0?'#D83C1E':'#14172B'); }
function boletimHTML(M, T){
  var obsRows = M.obsLista.map(function(o){
    return '<tr><td><strong>'+esc(o.prefixo)+'</strong></td><td class="r az">'+(o.s?esc(rs(o.s)):'–')+'</td><td class="r la">'+(o.e?esc(rs(o.e)):'–')+'</td><td class="r b" style="color:'+corVal(o.net)+'">'+esc(rs(o.net))+'</td></tr>';
  }).join('');
  var setRows = M.setorLista.map(function(s){
    return '<tr><td><strong>'+esc(s.setor)+'</strong></td><td class="r az">'+esc(rs(s.s))+'</td><td class="r la">'+esc(rs(s.e))+'</td><td class="r b" style="color:'+corVal(s.net)+'">'+esc(rs(s.net))+'</td></tr>';
  }).join('');
  return '<div class="bl">'
   + '<div class="bl-head"><div><div class="bl-eye">BOLETIM · FECHAMENTO MENSAL</div><div class="bl-h1">NET · '+esc(mesAno(M.mes))+'</div><div class="bl-sub">Consolidado de ajustes de estoque · CD Cajamar</div></div><img src="'+IMG+'logo-branco.png" alt="Loja do Mecânico" class="bl-logo"></div>'
   + '<div class="bl-body">'
   + '<div class="bl-kpis"><div class="bl-kpi"><span>ENTRADA</span><strong style="color:#FE5000">'+esc(rs(M.entrada))+'</strong></div>'
   + '<div class="bl-kpi"><span>SAÍDA</span><strong style="color:#001A72">'+esc(rs(M.saida))+'</strong></div>'
   + '<div class="bl-kpi net"><span>NET DO MÊS</span><strong style="color:'+corVal(M.net)+'">'+esc(rs(M.net))+'</strong></div></div>'
   + '<div class="bl-row"><div class="bl-card"><h4>PESO DE CADA OBS NO NET</h4>'+donutSVG(M)+'<div class="bl-leg"><i style="background:#FE5000"></i>Contribuição positiva <i style="background:#001A72"></i>Contribuição negativa</div></div>'
   + '<div class="bl-card"><h4>NET POR NOME DEPTO</h4><div class="bl-dep">'+deptoSVG(M)+'</div><div class="bl-note">Top 3 positivos e Top 3 negativos, em R$.</div></div></div>'
   + '<div class="bl-row"><div><h4 class="bl-t">NET POR OBSERVAÇÃO (R$)</h4><table class="bl-tab"><thead><tr><th>OBS</th><th class="r">Saída</th><th class="r">Entrada</th><th class="r">NET</th></tr></thead><tbody>'+obsRows+'</tbody>'
   + '<tfoot><tr><td>Total Geral</td><td class="r">'+esc(rs(M.saida))+'</td><td class="r">'+esc(rs(M.entrada))+'</td><td class="r">'+esc(rs(M.net))+'</td></tr></tfoot></table></div>'
   + '<div><h4 class="bl-t">NET POR SETOR (R$)</h4><table class="bl-tab"><thead><tr><th>Setor</th><th class="r">Saída</th><th class="r">Entrada</th><th class="r">NET</th></tr></thead><tbody>'+setRows+'</tbody></table>'
   + '<div class="bl-leitura"><strong>Leitura:</strong> '+esc(T.boletim)+'</div></div></div>'
   + '</div>'
   + '<div class="bl-foot">BASE: AJUSTES COM "CONSIDERAR NET = SIM"'+(M.depositosFora.length?' (EXCETO '+esc(M.depositosFora.join(', ').toUpperCase())+')':'')+' · VALORES EM R$ · NET = ENTRADA + SAÍDA</div>'
   + '</div>';
}

async function baixarBoletim(M, T){
  if(typeof html2canvas==='undefined'){ API.toast('Gerador de imagem não carregou. Verifique a internet e recarregue.', true); return; }
  var host = document.createElement('div');
  host.style.cssText='position:fixed;left:-20000px;top:0;width:1200px;background:#fff;';
  host.innerHTML = boletimHTML(M,T);
  document.body.appendChild(host);
  try {
    await Promise.all(Array.from(host.querySelectorAll('img')).map(function(i){ return i.complete?0:new Promise(function(r){ i.onload=i.onerror=r; }); }));
    if(document.fonts && document.fonts.ready) await document.fonts.ready;
    var cv = await html2canvas(host.firstChild,{scale:1.6, backgroundColor:'#ffffff', useCORS:true, logging:false});
    var a = document.createElement('a');
    a.download = 'Boletim_NET_'+nomeMes(M.mes)+'_'+M.mes.slice(0,4)+'.png';
    a.href = cv.toDataURL('image/png');
    document.body.appendChild(a); a.click(); a.remove();
    API.toast('✓ Boletim de '+mesAno(M.mes)+' gerado.');
  } catch(e){ API.toast('Erro ao gerar o boletim: '+e.message, true); }
  finally { host.remove(); }
}

/* =========================================================================
   APRESENTAÇÃO (PPTX — 7 slides, 16:9)
   ========================================================================= */
var FONTE='Calibri', W=13.333;
function cabecalho(sl, eyebrow, titulo, escuro){
  sl.addText(eyebrow.toUpperCase(), {x:0.5,y:0.38,w:9,h:0.25,fontFace:FONTE,fontSize:9,bold:true,color:COR.laranja,charSpacing:4,margin:0});
  sl.addText(titulo, {x:0.5,y:0.66,w:10.3,h:0.55,fontFace:FONTE,fontSize:24,bold:true,color:escuro?'FFFFFF':COR.azul,margin:0,fit:'shrink'});
  sl.addImage({path:IMG+(escuro?'logo-branco.png':'logo-laranja.png'), x:11.33,y:0.42,w:1.5,h:0.334});
}
function rodape(sl, M, pag, escuro){
  sl.addShape('line',{x:0.5,y:7.0,w:12.33,h:0,line:{color:escuro?'2A3050':'E3E6EF',width:0.75}});
  sl.addText([
    {text:'Loja do Mecânico', options:{bold:true,color:escuro?'FFFFFF':COR.azul}},
    {text:'  ·  Fechamento NET · '+mesAno(M.mes)+'  ·  '+fonte(M), options:{color:escuro?'8E96B8':COR.cinza}}
  ], {x:0.5,y:7.05,w:11.5,h:0.28,fontFace:FONTE,fontSize:8,margin:0});
  sl.addText(String(pag).padStart(2,'0'), {x:12.33,y:7.05,w:0.5,h:0.28,fontFace:FONTE,fontSize:8,bold:true,color:COR.laranja,align:'right',margin:0});
}
function leitura(sl, txt, y, escuro){
  sl.addShape('rect',{x:0.5,y:y,w:12.33,h:0.62,fill:{color:escuro?'FFFFFF':'FFF4EE',transparency:escuro?93:0},line:{color:escuro?'2A3050':'FFE1D1',width:0.75}});
  sl.addShape('rect',{x:0.5,y:y,w:0.06,h:0.62,fill:{color:COR.laranja},line:{color:COR.laranja,width:0}});
  sl.addText([{text:'LEITURA     ',options:{bold:true,color:COR.laranja,charSpacing:2}},{text:txt,options:{color:escuro?'FFFFFF':COR.escuro}}],
    {x:0.75,y:y,w:11.9,h:0.62,fontFace:FONTE,fontSize:11,valign:'middle',margin:0,fit:'shrink'});
}
function pill(sl, x, y, txt, cor){
  sl.addText(txt,{x:x,y:y,w:0.85,h:0.24,fontFace:FONTE,fontSize:8,bold:true,color:cor,align:'center',valign:'middle',margin:0,
    fill:{color:cor,transparency:82},rectRadius:0.12,shape:'roundRect'});
}

async function baixarPPTX(M, P, T){
  if(typeof PptxGenJS==='undefined'){ API.toast('Gerador de apresentação não carregou. Verifique a internet e recarregue.', true); return; }
  var pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Controle de Estoque · CD Cajamar';
  pptx.title = 'Fechamento NET · '+mesAno(M.mes);
  var verdeNet = M.net>=0?COR.verdeClaro:'FF6B57';

  /* 1 — CAPA */
  var s1 = pptx.addSlide(); s1.background = {path:IMG+'fundo-escuro.jpg'};
  s1.addImage({path:IMG+'logo-branco.png', x:0.6,y:0.55,w:1.9,h:0.423});
  s1.addText('BOLETIM · FECHAMENTO MENSAL',{x:0.6,y:1.95,w:6.5,h:0.3,fontFace:FONTE,fontSize:10,bold:true,color:COR.laranja,charSpacing:5,margin:0});
  s1.addText('NET de ajustes',{x:0.6,y:2.3,w:6.8,h:0.8,fontFace:FONTE,fontSize:40,bold:true,color:'FFFFFF',margin:0});
  s1.addText(mesAno(M.mes),{x:0.6,y:3.05,w:6.8,h:0.8,fontFace:FONTE,fontSize:40,bold:true,color:COR.laranja,margin:0});
  s1.addText('Consolidado de ajustes de estoque · CD Cajamar\nControle de Estoque · Apresentação à Controladoria',{x:0.6,y:4.0,w:6.8,h:0.6,fontFace:FONTE,fontSize:12,color:'B9C0DD',margin:0});
  s1.addShape('roundRect',{x:0.6,y:5.25,w:6.7,h:1.0,fill:{color:'FFFFFF',transparency:94},line:{color:'2A3050',width:0.75},rectRadius:0.08});
  [['ENTRADA',rs(M.entrada),COR.laranja],['SAÍDA',rs(M.saida),COR.lilas],['NET DO MÊS',rs(M.net),verdeNet]].forEach(function(k,i){
    var x=0.85+i*2.2;
    s1.addText(k[0],{x:x,y:5.42,w:2.1,h:0.22,fontFace:FONTE,fontSize:8,bold:true,color:'8E96B8',charSpacing:3,margin:0});
    s1.addText(k[1],{x:x,y:5.7,w:2.1,h:0.36,fontFace:FONTE,fontSize:15,bold:true,color:k[2],margin:0,fit:'shrink'});
  });
  s1.addShape('rect',{x:8.1,y:0,w:0.05,h:7.5,fill:{color:COR.laranja},line:{color:COR.laranja,width:0}});
  s1.addImage({path:IMG+'logo-vertical.png', x:9.15,y:1.85,w:3.11,h:3.6});

  /* 2 — RESUMO EXECUTIVO */
  var s2 = pptx.addSlide(); s2.background = {path:IMG+'fundo-escuro.jpg'};
  cabecalho(s2,'Resumo executivo',T.resumoTitulo,true);
  var pN = P ? 'vs '+nomeMes(P.mes).toLowerCase() : '';
  var cards = [
    ['ENTRADA', rs(M.entrada), COR.laranja, P?variacao(M.entrada,P.entrada):null, 'up', pN],
    ['SAÍDA', rs(M.saida), COR.lilas, P?variacao(Math.abs(M.saida),Math.abs(P.saida)):null, 'down', pN],
    ['NET DO MÊS', rs(M.net), verdeNet, P?(M.net-P.net):null, 'net', P?pN+' ('+rs(P.net)+')':''],
    ['VOLUME MOVIMENTADO', rs(M.vol), 'FFFFFF', P?variacao(M.vol,P.vol):null, 'neutro', '|entrada| + |saída|']
  ];
  cards.forEach(function(c,i){
    var x=0.5+i*3.13, w=2.95;
    s2.addShape('roundRect',{x:x,y:1.5,w:w,h:1.45,fill:{color:'FFFFFF',transparency:94},line:{color:i===2?COR.laranja:'2A3050',width:i===2?1.5:0.75},rectRadius:0.08});
    s2.addText([{text:'● ',options:{color:c[2]==='FFFFFF'?'FFFFFF':c[2]}},{text:c[0],options:{color:'B9C0DD'}}],{x:x+0.2,y:1.65,w:w-0.3,h:0.22,fontFace:FONTE,fontSize:8,bold:true,charSpacing:3,margin:0});
    s2.addText(c[1],{x:x+0.2,y:1.95,w:w-0.3,h:0.42,fontFace:FONTE,fontSize:17,bold:true,color:c[2],margin:0,fit:'shrink'});
    if(c[3]!==null){
      var bom = c[4]==='up'? c[3]>=0 : c[4]==='down'? c[3]<=0 : c[4]==='net'? c[3]>=0 : null;
      var corP = bom===null?'B9C0DD':(bom?COR.verdeClaro:'FF6B57');
      var txt = (c[3]>=0?'▲ ':'▼ ')+(c[4]==='net'? rs(Math.abs(c[3])) : pct(Math.abs(c[3])));
      s2.addText(txt,{x:x+0.2,y:2.5,w:c[4]==='net'?1.25:0.85,h:0.24,fontFace:FONTE,fontSize:8,bold:true,color:corP,align:'center',valign:'middle',margin:0,fill:{color:corP,transparency:82},shape:'roundRect',rectRadius:0.12});
      s2.addText(c[5],{x:x+(c[4]==='net'?1.5:1.1),y:2.5,w:w-1.6,h:0.24,fontFace:FONTE,fontSize:8,color:'8E96B8',valign:'middle',margin:0,fit:'shrink'});
    } else if(i===3){
      s2.addText(c[5],{x:x+0.2,y:2.5,w:w-0.3,h:0.24,fontFace:FONTE,fontSize:8,color:'8E96B8',valign:'middle',margin:0});
    }
  });
  [[f0.format(M.mov),'movimentos de ajuste'],[f0.format(M.nItens),'itens (SKUs) distintos'],[f0.format(M.nDeptos),'departamentos impactados'],[pct(M.vol?Math.abs(M.net)/M.vol:0,2),'NET sobre o volume movimentado']].forEach(function(st,i){
    var x=0.5+i*3.13;
    s2.addShape('line',{x:x,y:3.2,w:2.95,h:0,line:{color:COR.laranja,width:1.25}});
    s2.addText(st[0],{x:x,y:3.3,w:2.95,h:0.42,fontFace:FONTE,fontSize:20,bold:true,color:'FFFFFF',margin:0});
    s2.addText(st[1],{x:x,y:3.72,w:2.95,h:0.22,fontFace:FONTE,fontSize:9,color:'8E96B8',margin:0});
  });
  s2.addText('COMPOSIÇÃO DO VOLUME MOVIMENTADO POR CÓDIGO',{x:0.5,y:4.3,w:8,h:0.22,fontFace:FONTE,fontSize:8,bold:true,color:'B9C0DD',charSpacing:3,margin:0});
  s2.addText(rs(M.vol),{x:8.83,y:4.3,w:4,h:0.22,fontFace:FONTE,fontSize:9,bold:true,color:'FFFFFF',align:'right',margin:0});
  var porVol = M.obsLista.slice().sort(function(a,b){return b.vol-a.vol;}), xb=0.5;
  porVol.forEach(function(o,i){
    var w = 12.33*o.pv; if(w<0.01) return;
    s2.addShape('rect',{x:xb,y:4.6,w:w,h:0.24,fill:{color:PALETA[i%PALETA.length]},line:{color:'14172B',width:0.5}});
    xb+=w;
  });
  s2.addText(porVol.map(function(o,i){ return {text:'■ ',options:{color:PALETA[i%PALETA.length]}}; }).reduce(function(acc,q,i){
    acc.push(q); acc.push({text:porVol[i].prefixo+' '+pct(porVol[i].pv)+'      ',options:{color:'B9C0DD'}}); return acc; },[]),
    {x:0.5,y:4.95,w:12.33,h:0.25,fontFace:FONTE,fontSize:8,margin:0});
  leitura(s2,T.resumo,6.1,true);
  rodape(s2,M,2,true);

  /* 3 — COMPOSIÇÃO (cascata) */
  var s3 = pptx.addSlide(); s3.background = {path:IMG+'fundo-claro.jpg'};
  cabecalho(s3,'Composição do NET',T.composicaoTitulo,false);
  s3.addShape('roundRect',{x:0.5,y:1.45,w:12.33,h:4.4,fill:{color:'FFFFFF'},line:{color:'E3E6EF',width:0.75},rectRadius:0.08});
  var barras = M.obsLista.map(function(o){ return {rot:o.prefixo, sub:o.legenda, v:o.net}; });
  var cum=0, pts=[0];
  barras.forEach(function(b){ b.ini=cum; cum+=b.v; b.fim=cum; pts.push(cum); });
  barras.push({rot:'NET', sub:nomeMes(M.mes), v:M.net, ini:0, fim:M.net, res:true}); pts.push(M.net);
  var vmax=Math.max.apply(null,pts), vmin=Math.min.apply(null,pts); if(vmax===vmin){ vmax+=1; }
  var gTop=2.05, gBot=4.85, gx=0.9, gw=11.55, slot=gw/barras.length, bw=Math.min(0.85,slot*0.55);
  var Y=function(v){ return gTop + (vmax-v)/(vmax-vmin)*(gBot-gTop); };
  s3.addShape('line',{x:gx,y:Y(0),w:gw,h:0,line:{color:'B8BED3',width:0.75}});
  barras.forEach(function(b,i){
    var x=gx+i*slot+(slot-bw)/2, y1=Y(Math.max(b.ini,b.fim)), y2=Y(Math.min(b.ini,b.fim)), h=Math.max(0.02,y2-y1);
    var cor = b.res ? COR.verde : (b.v>=0?COR.azul:COR.vermelho);
    s3.addShape('rect',{x:x,y:y1,w:bw,h:h,fill:{color:cor},line:{color:cor,width:0}});
    s3.addText(b.res?rs(b.v):milCurto(b.v),{x:x-0.35,y:y1-0.27,w:bw+0.7,h:0.22,fontFace:FONTE,fontSize:8,bold:true,color:b.res?COR.verde:(b.v>=0?COR.azul:COR.vermelho),align:'center',margin:0});
    if(i<barras.length-1 && !b.res) s3.addShape('line',{x:x+bw,y:Y(b.fim),w:slot-bw,h:0,line:{color:'B8BED3',width:0.5,dashType:'dash'}});
    s3.addText([{text:b.rot+'\n',options:{bold:true,color:COR.azul,fontSize:9}},{text:b.sub,options:{color:COR.cinza,fontSize:7}}],{x:gx+i*slot,y:4.95,w:slot,h:0.45,fontFace:FONTE,align:'center',margin:0,fit:'shrink'});
  });
  s3.addText([{text:'■ ',options:{color:COR.azul}},{text:'contribuição positiva     ',options:{color:COR.cinza}},{text:'■ ',options:{color:COR.vermelho}},{text:'contribuição negativa     ',options:{color:COR.cinza}},{text:'■ ',options:{color:COR.verde}},{text:'resultado',options:{color:COR.cinza}}],
    {x:0.5,y:5.5,w:12.33,h:0.25,fontFace:FONTE,fontSize:8,align:'center',margin:0});
  leitura(s3,T.composicao,6.1,false);
  rodape(s3,M,3,false);

  /* 4 — NET POR OBSERVAÇÃO (tabela) */
  var s4 = pptx.addSlide(); s4.background = {path:IMG+'fundo-claro.jpg'};
  cabecalho(s4,'NET por observação',T.obsTitulo,false);
  var cw=[0.8,2.3,1.75,1.75,1.75,2.2,0.9,0.88], n=M.obsLista.length, rh=Math.min(0.36,4.2/(n+2));
  var hdr = ['OBS','Motivo','Saída','Entrada','NET','NET (escala)','% vol.','Mov.'].map(function(t,i){ return {text:t,options:{bold:true,color:'FFFFFF',fill:{color:COR.azul},align:i>=2?'right':'left'}}; });
  hdr[5].options.align='center';
  var linhas=[hdr];
  M.obsLista.forEach(function(o,i){
    var bg = i%2?'F8F9FD':'FFFFFF';
    linhas.push([
      {text:o.prefixo,options:{bold:true,color:COR.azul,fill:{color:bg}}},
      {text:o.legenda,options:{color:COR.cinza,fill:{color:bg}}},
      {text:o.s?rs(o.s):'–',options:{color:COR.azul,align:'right',fill:{color:bg}}},
      {text:o.e?rs(o.e):'–',options:{color:COR.laranja,align:'right',fill:{color:bg}}},
      {text:rs(o.net),options:{bold:true,color:o.net>=0?COR.verde:COR.vermelho,align:'right',fill:{color:bg}}},
      {text:'',options:{fill:{color:bg}}},
      {text:pct(o.pv),options:{color:COR.cinza,align:'right',fill:{color:bg}}},
      {text:f0.format(o.mov),options:{color:COR.cinza,align:'right',fill:{color:bg}}}
    ]);
  });
  var tf={bold:true,color:'FFFFFF',fill:{color:COR.escuro}};
  linhas.push([{text:'Total Geral',options:tf},{text:'',options:tf},{text:rs(M.saida),options:Object.assign({align:'right'},tf)},{text:rs(M.entrada),options:Object.assign({align:'right'},tf)},{text:rs(M.net),options:Object.assign({align:'right'},tf)},{text:'',options:tf},{text:'100%',options:Object.assign({align:'right'},tf)},{text:f0.format(M.mov),options:Object.assign({align:'right'},tf)}]);
  var ty=1.5;
  s4.addTable(linhas,{x:0.5,y:ty,w:12.33,colW:cw,rowH:rh,fontFace:FONTE,fontSize:9,valign:'middle',border:{type:'solid',color:'E3E6EF',pt:0.5},margin:[0,0.08,0,0.08]});
  var maxAbs = M.obsLista.reduce(function(m,o){return Math.max(m,Math.abs(o.net));},1);
  var cx0 = 0.5+cw.slice(0,5).reduce(function(a,b){return a+b;},0), cMid = cx0+cw[5]/2, half=cw[5]/2-0.15;
  M.obsLista.forEach(function(o,i){
    var y = ty+rh*(i+1)+rh/2-0.06, w=Math.max(0.03,Math.abs(o.net)/maxAbs*half);
    s4.addShape('rect',{x:cMid-half,y:y,w:half*2,h:0.12,fill:{color:'E3E6EF'},line:{color:'E3E6EF',width:0}});
    s4.addShape('rect',{x:o.net>=0?cMid:cMid-w,y:y,w:w,h:0.12,fill:{color:o.net>=0?COR.laranja:COR.azul},line:{width:0,color:o.net>=0?COR.laranja:COR.azul}});
    s4.addShape('line',{x:cMid,y:y-0.03,w:0,h:0.18,line:{color:'8E96B8',width:0.5}});
  });
  leitura(s4,T.obs,6.1,false);
  rodape(s4,M,4,false);

  /* 5 — NET POR SETOR */
  var s5 = pptx.addSlide(); s5.background = {path:IMG+'fundo-claro.jpg'};
  cabecalho(s5,'NET por setor',T.setorTitulo,false);
  var SL = M.setorLista.slice(0,3), gap=0.3, cwid=(12.33-gap*(SL.length-1))/Math.max(1,SL.length);
  SL.forEach(function(s,i){
    var x=0.5+i*(cwid+gap), y=1.55, acc=i===0?COR.laranja:COR.azul;
    s5.addShape('rect',{x:x,y:y,w:cwid,h:3.4,fill:{color:'FFFFFF'},line:{color:'E3E6EF',width:0.75},shadow:{type:'outer',blur:6,offset:2,angle:90,color:'001A72',opacity:0.08}});
    s5.addShape('rect',{x:x,y:y,w:0.07,h:3.4,fill:{color:acc},line:{color:acc,width:0}});
    s5.addText(s.setor,{x:x+0.35,y:y+0.25,w:cwid-2.2,h:0.32,fontFace:FONTE,fontSize:13,bold:true,color:COR.escuro,margin:0});
    s5.addText(pct(s.pv)+' do volume',{x:x+cwid-1.75,y:y+0.27,w:1.45,h:0.26,fontFace:FONTE,fontSize:8,bold:true,color:COR.cinza,align:'center',valign:'middle',margin:0,fill:{color:'F0F2F8'},shape:'roundRect',rectRadius:0.13});
    s5.addText(rs(s.net),{x:x+0.35,y:y+0.65,w:cwid-0.6,h:0.6,fontFace:FONTE,fontSize:26,bold:true,color:s.net>=0?COR.verde:COR.vermelho,margin:0,fit:'shrink'});
    s5.addText('NET do setor',{x:x+0.35,y:y+1.25,w:3,h:0.22,fontFace:FONTE,fontSize:8,color:COR.cinza,margin:0});
    s5.addShape('line',{x:x+0.35,y:y+1.58,w:cwid-0.7,h:0,line:{color:'E3E6EF',width:0.75}});
    [[f0.format(s.mov),'movimentos'],[f0.format(s.nItens),'itens distintos'],[rs(s.medio),'NET médio por movimento']].forEach(function(st,j){
      var sx=x+0.35+j*(cwid-0.7)/3;
      s5.addText(st[0],{x:sx,y:y+1.72,w:(cwid-0.7)/3,h:0.3,fontFace:FONTE,fontSize:12,bold:true,color:COR.escuro,margin:0,fit:'shrink'});
      s5.addText(st[1],{x:sx,y:y+2.02,w:(cwid-0.7)/3,h:0.22,fontFace:FONTE,fontSize:7.5,color:COR.cinza,margin:0});
    });
    var bwT=cwid-0.7, we = s.vol? bwT*s.e/s.vol : bwT/2;
    s5.addShape('roundRect',{x:x+0.35,y:y+2.5,w:Math.max(0.02,we),h:0.16,fill:{color:COR.laranja},line:{width:0,color:COR.laranja},rectRadius:0.08});
    s5.addShape('roundRect',{x:x+0.35+we,y:y+2.5,w:Math.max(0.02,bwT-we),h:0.16,fill:{color:COR.azul},line:{width:0,color:COR.azul},rectRadius:0.08});
    s5.addText([{text:'■ ',options:{color:COR.laranja}},{text:'Entrada  ',options:{color:COR.cinza}},{text:rs(s.e),options:{bold:true,color:COR.laranja}}],{x:x+0.35,y:y+2.8,w:bwT/2,h:0.25,fontFace:FONTE,fontSize:8.5,margin:0,fit:'shrink'});
    s5.addText([{text:'■ ',options:{color:COR.azul}},{text:'Saída  ',options:{color:COR.cinza}},{text:rs(s.s),options:{bold:true,color:COR.azul}}],{x:x+0.35+bwT/2,y:y+2.8,w:bwT/2,h:0.25,fontFace:FONTE,fontSize:8.5,margin:0,align:'right',fit:'shrink'});
  });
  leitura(s5,T.setor,6.1,false);
  rodape(s5,M,5,false);

  /* 6 — NET POR DEPARTAMENTO */
  var s6 = pptx.addSlide(); s6.background = {path:IMG+'fundo-claro.jpg'};
  cabecalho(s6,'NET por departamento',T.deptoTitulo,false);
  [['TOP 5 GANHOS',M.deptoGanhos.slice(0,5),[COR.laranja,COR.laranja,'FFA877','FFA877','FFA877']],
   ['TOP 5 PERDAS',M.deptoPerdas.slice(0,5),[COR.azul,COR.azul,'7783B5','7783B5','7783B5']]].forEach(function(p,i){
    var x=0.5+i*6.3, y=1.5, w=6.03;
    s6.addShape('rect',{x:x,y:y,w:w,h:3.75,fill:{color:'FFFFFF'},line:{color:'E3E6EF',width:0.75},shadow:{type:'outer',blur:6,offset:2,angle:90,color:'001A72',opacity:0.08}});
    s6.addText([{text:'● ',options:{color:i?COR.azul:COR.laranja}},{text:p[0],options:{color:COR.escuro}}],{x:x+0.25,y:y+0.2,w:4,h:0.25,fontFace:FONTE,fontSize:9,bold:true,charSpacing:3,margin:0});
    var mx = p[1].reduce(function(m,d){return Math.max(m,Math.abs(d.net));},1);
    if(!p[1].length) s6.addText('Nenhum departamento.',{x:x+0.25,y:y+0.7,w:5,h:0.3,fontFace:FONTE,fontSize:10,color:COR.cinza,margin:0});
    p[1].forEach(function(d,j){
      var ry=y+0.65+j*0.6;
      s6.addText(d.nome,{x:x+0.25,y:ry,w:2.25,h:0.4,fontFace:FONTE,fontSize:9,color:COR.escuro,valign:'middle',margin:0,fit:'shrink'});
      s6.addShape('roundRect',{x:x+2.6,y:ry+0.08,w:Math.max(0.05,Math.abs(d.net)/mx*2.0),h:0.24,fill:{color:p[2][j]},line:{width:0,color:p[2][j]},rectRadius:0.04});
      s6.addText(rs(d.net),{x:x+4.6,y:ry,w:1.25,h:0.4,fontFace:FONTE,fontSize:9,bold:true,color:i?COR.azul:COR.laranja,align:'right',valign:'middle',margin:0,fit:'shrink'});
    });
  });
  s6.addText([{text:'Outros '+f0.format(Math.max(0,M.outrosDeptos.n))+' departamentos somam ',options:{color:COR.cinza}},{text:rs(M.outrosDeptos.soma),options:{bold:true,color:M.outrosDeptos.soma>=0?COR.verde:COR.vermelho}}],
    {x:0.5,y:5.4,w:12.33,h:0.28,fontFace:FONTE,fontSize:9,margin:0});
  leitura(s6,T.depto,6.1,false);
  rodape(s6,M,6,false);

  /* 7 — ENCERRAMENTO */
  var s7 = pptx.addSlide(); s7.background = {color:COR.laranja};
  s7.addImage({path:IMG+'encerramento.jpg', x:0,y:0,w:W,h:7.5,sizing:{type:'cover',w:W,h:7.5}});
  s7.addShape('rect',{x:0,y:6.15,w:W,h:1.35,fill:{color:COR.azul},line:{color:COR.azul,width:0}});
  s7.addText('Fechamento NET · '+mesAno(M.mes),{x:0,y:6.25,w:W,h:0.4,fontFace:FONTE,fontSize:16,bold:true,color:'FFFFFF',align:'center',margin:0});
  s7.addText([{text:'Entrada  ',options:{color:'B9C0DD'}},{text:rs(M.entrada)+'          ',options:{bold:true,color:COR.laranja}},{text:'Saída  ',options:{color:'B9C0DD'}},{text:rs(M.saida)+'          ',options:{bold:true,color:COR.lilas}},{text:'NET  ',options:{color:'B9C0DD'}},{text:rs(M.net),options:{bold:true,color:verdeNet}}],
    {x:0,y:6.7,w:W,h:0.3,fontFace:FONTE,fontSize:11,align:'center',margin:0});
  s7.addText('Controle de Estoque · CD Cajamar',{x:0,y:7.05,w:W,h:0.25,fontFace:FONTE,fontSize:8,color:'8E96B8',align:'center',charSpacing:2,margin:0});

  await pptx.writeFile({fileName:'Fechamento_NET_'+nomeMes(M.mes)+'_'+M.mes.slice(0,4)+'.pptx'});
  API.toast('✓ Apresentação de '+mesAno(M.mes)+' gerada.');
}

/* =========================================================================
   TELA "Relatório" do app
   ========================================================================= */
function ajustaEscala(){
  var w = document.getElementById('relPreviewWrap'), inner = w && w.firstElementChild;
  if(!inner) return;
  var sc = Math.min(1, w.clientWidth/1200);
  inner.style.transform = 'scale('+sc+')';
  w.style.height = (inner.offsetHeight*sc)+'px';
}
function render(){
  var el = document.getElementById('rel-corpo'); if(!el) return;
  var mes = API.mesSel();
  if(!mes){ el.innerHTML='<div class="vazio"><h3>Nenhum mês importado</h3><p>Importe a QRY410 na aba <a href="#fechamento" data-goto="fechamento">Fechamento do mês</a> para gerar o relatório.</p></div>'; return; }
  var M = metricas(mes), pk = mesAnterior(mes), P = API.getMes(pk) ? metricas(pk) : null, T = textos(M,P);
  var ed = (API.getMes(mes).leituras)||{}, auto = textosAuto(M,P);
  var campos = CAMPOS.map(function(c){
    var editado = ed[c[0]]!=null && ed[c[0]]!=='' && ed[c[0]]!==auto[c[0]];
    return '<div class="rel-campo"><label>'+esc(c[1])+(editado?' <span class="tag sim">editado</span> <button type="button" class="link" data-rel-auto="'+c[0]+'">voltar ao automático</button>':'')+'</label>'
      + '<textarea rows="'+(/Titulo$/.test(c[0])?1:2)+'" data-rel-campo="'+c[0]+'">'+esc(T[c[0]])+'</textarea></div>';
  }).join('');
  el.innerHTML =
    '<div class="painel"><div class="painel-cab"><div><h3>Relatório da controladoria — '+esc(API.mesLabel(mes))+'</h3>'
    + '<p>'+(P ? 'Comparando com <strong>'+esc(API.mesLabel(pk))+'</strong> nos indicadores de variação.' : 'Importe também '+esc(API.mesLabel(pk))+' para a apresentação mostrar a variação contra o mês anterior.')+' Mesmo formato do último report: boletim de 1 página e apresentação de 7 slides.</p></div>'
    + '<div class="acoes"><button class="btn sec" type="button" id="btnBoletim">⬇ Boletim (imagem)</button><button class="btn" type="button" id="btnPPTX">⬇ Apresentação (PPTX)</button></div></div></div>'
    + '<div class="painel"><div class="painel-cab"><div><h3>Prévia do boletim</h3><p>É exatamente a imagem que será baixada.</p></div></div>'
    + '<div class="rel-prev" id="relPreviewWrap"><div class="rel-prev-in">'+boletimHTML(M,T)+'</div></div></div>'
    + '<div class="painel"><div class="painel-cab"><div><h3>Títulos e leituras</h3><p>Escritos automaticamente a partir dos números. Se quiser, ajuste o texto antes de baixar — fica salvo junto com o mês.</p></div></div>'
    + '<div class="rel-campos">'+campos+'</div></div>';
  requestAnimationFrame(ajustaEscala);
  Array.from(el.querySelectorAll('img')).forEach(function(i){ i.addEventListener('load', ajustaEscala); });
}
window.addEventListener('resize', ajustaEscala);
document.addEventListener('click', function(e){
  var mes = API.mesSel(); if(!mes) return;
  var t = e.target;
  if(t.id==='btnBoletim' || t.id==='btnPPTX'){
    var M = metricas(mes), pk=mesAnterior(mes), P = API.getMes(pk)?metricas(pk):null, T = textos(M,P);
    t.disabled = true;
    (t.id==='btnBoletim' ? baixarBoletim(M,T) : baixarPPTX(M,P,T)).catch(function(err){ API.toast('Erro: '+err.message, true); }).finally(function(){ t.disabled=false; });
    return;
  }
  var b = t.closest('[data-rel-auto]');
  if(b){ var m=API.getMes(mes); if(m.leituras) delete m.leituras[b.dataset.relAuto]; API.salvarMes(mes); render(); }
});
document.addEventListener('change', function(e){
  var t = e.target; if(!t.dataset || !t.dataset.relCampo) return;
  var mes = API.mesSel(), m = API.getMes(mes); if(!m) return;
  m.leituras = m.leituras || {}; m.leituras[t.dataset.relCampo] = t.value.trim();
  API.salvarMes(mes); render();
});

window.NETREL = { render: render, metricas: metricas, textosAuto: textosAuto };
render();
})();
