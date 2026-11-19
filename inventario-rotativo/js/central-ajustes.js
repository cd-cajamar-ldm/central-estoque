/* ============================================================
   CENTRAL DE AJUSTES (aba Net) — formato "Fechamento do Net"
   Ano → Mês → Dia, cruzando Motivo / Depósito / Departamento / Fornecedor /
   Usuário com um clique, em Valor (R$) ou Quantidade (peças).

   Base: linhas cruas da QRY410 já processadas (d.linhasLogica), só motivos que
   contam pro Net (legenda de Configurações). Motivo marcado como "não validar"
   (ex.: IMP — erro externo, já conhecido) continua no Net, mas sai dos ofensores
   e do "Caminho até zerar": o foco é o que aconteceu dentro da companhia.

   Situação do item = olhando o ANO inteiro do item (todas as linhas, sem recorte):
     • Equalizado         — perdeu e voltou: o Net do ano ficou ≤ 5% do giro
     • Perda (não voltou) — fecha o ano negativo
     • Ganho sem perda    — só ganhou no ano (possível duplicidade)
     • Ganhou mais que perdeu
   ============================================================ */
IR.caS = IR.caS || {mes:null, dia:'', f:{}, met:'v', ord:{c:'v', d:1}};
const IR_CA_DIMS = [['mot','Motivo'],['dep','Depósito'],['depto','Departamento'],['forn','Fornecedor'],['usr','Usuário']];
const IR_CA_CL = {perda:['Perda (não voltou)','#FE5000'], dup:['Ganho sem perda','#C8361B'], mais:['Ganhou mais que perdeu','#3A5BD9'], eq:['Equalizado','#1E8E4E']};
const IR_CA_MES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

/* Motivo que entra no Net mas não precisa de validação (padrão: IMP). */
function irLegendaValidar(item){ return item ? (item.validar===undefined ? item.id!=='IMP' : !!item.validar) : true; }

function irCaQtd(){ return IR.caS.met==='q'; }
function irCaK(v){
  const s = v < 0 ? '−' : (v > 0 ? '+' : ''); const a = Math.abs(v||0);
  if(irCaQtd()) return s + Math.round(a).toLocaleString('pt-BR');
  if(a >= 1e6) return s + (a/1e6).toLocaleString('pt-BR',{maximumFractionDigits:2}) + 'mi';
  if(a >= 1e3) return s + (a/1e3).toLocaleString('pt-BR',{maximumFractionDigits:1}) + 'k';
  return s + Math.round(a).toLocaleString('pt-BR');
}
function irCaR(v, sinal){
  const s = v < 0 ? '−' : ((sinal && v > 0) ? '+' : '');
  const n = Math.round(Math.abs(v||0)).toLocaleString('pt-BR');
  return irCaQtd() ? s + n + ' pç' : s + 'R$ ' + n;
}
function irCaCor(v){ return v < 0 ? '#FE5000' : '#001A72'; }

/* Linhas do ano que contam pro Net. Guardado por ano/legenda. */
function irCaLinhasAno(d){
  const leg = IR.net410Legenda || [];
  const chave = d.ano+'|'+(d.linhasLogica||[]).length+'|'+JSON.stringify(leg);
  if(IR._caCache && IR._caCache.k===chave) return IR._caCache.linhas;
  const porId = new Map(leg.map(l=>[l.id, l]));
  const linhas = [];
  for(const l of (d.linhasLogica||[])){
    const cls = irClassificarMotivo410(l.obsWms || l.observacao, leg);
    if(!cls.considerarNet) continue;
    const dt = String(l.dtMov||'');
    linhas.push({
      item:l.item, nome:l.nome, depto:l.depto||'(sem depto)', forn:l.fornecedor||'(sem fornecedor)', dep:l.deposito||'(sem depósito)',
      usr:l.usuario||'(sem usuário)', doc:l.numDoc||'', mot: cls.id + (cls.legenda ? ' · '+cls.legenda : ''),
      validar: irLegendaValidar(porId.get(cls.id)), mes:l.mes || dt.slice(0,7), dia:dt.slice(0,10), v:l.valor||0, q:l.qtd||0
    });
  }
  IR._caCache = {k:chave, linhas};
  return linhas;
}
function irCaVal(l){ return irCaQtd() ? l.q : l.v; }
function irCaPassa(l, sem){ const f = IR.caS.f; return Object.keys(f).every(k=> k===sem || l[k]===f[k]); }
function irCaNoEscopo(l){ const S = IR.caS; return (!S.mes || l.mes===S.mes) && (!S.dia || l.dia===S.dia); }
function irCaSetMes(m){ const S = IR.caS; S.mes = (S.mes===m) ? '' : m; S.dia = ''; if(S.mes) IR.net410MesSel = S.mes; irRenderView(); }
function irCaSetDia(dd){ IR.caS.dia = IR.caS.dia===dd ? '' : dd; irRenderView(); }
function irCaSetF(k, v){ const f = IR.caS.f; if(f[k]===v) delete f[k]; else f[k] = v; irRenderView(); }
function irCaTiraF(k){ delete IR.caS.f[k]; irRenderView(); }
function irCaSetMet(m){ IR.caS.met = m; irRenderView(); }
function irCaOrdenar(c){ const o = IR.caS.ord; IR.caS.ord = o.c===c ? {c, d:-o.d} : {c, d:(c==='v'||c==='a')?1:-1}; irRenderView(); }

function irCaInfo(t){ return `<span class="ca-i">i<span class="ca-i-tt">${t}</span></span>`; }
function irCaPainel(t, corpo, dir, info, cls){
  return `<div class="panel ca-panel ${cls||''}"><div class="dx-panel-h"><h3>${t}${info?' '+irCaInfo(info):''}</h3>${dir?`<div class="cmp-legend">${dir}</div>`:''}</div>${corpo}</div>`;
}
function irCaLeg(cor, t, linha){ return `<span>${linha?`<span class="ca-leg-l" style="border-color:${cor}"></span>`:`<span class="cmp-dot" style="background:${cor};border-radius:3px"></span>`}${t}</span>`; }

/* ---------- gráficos ---------- */
function irCaEixo(W, pl, pr, y, lo, hi, n){
  let s = ''; for(let k=0;k<n;k++){ const v = lo+(hi-lo)*k/(n-1); s += `<line x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)" stroke-opacity=".6"/><text x="${pl-6}" y="${y(v)+4}" font-size="10.5" text-anchor="end" style="fill:var(--ink-soft)">${irCaK(v)}</text>`; }
  return s + `<line x1="${pl}" x2="${W-pr}" y1="${y(0)}" y2="${y(0)}" style="stroke:var(--ink-soft)"/>`;
}
function irCaMesesSvg(rows, W, sel){
  const H = 270, pl = 58, pr = 10, pt = 18, pb = 28;
  const ac = []; let t = 0; rows.forEach(r=>{ t += r.v; ac.push(t); });
  const hi = Math.max(0, ...rows.map(r=>r.v), ...ac)*1.15 + 1, lo = Math.min(0, ...rows.map(r=>r.v), ...ac)*1.1 - 1;
  const y = v=> pt + (hi-v)/(hi-lo)*(H-pt-pb);
  const sl = (W-pl-pr)/Math.max(1, rows.length), bw = Math.min(42, sl*0.58);
  let s = `<svg width="${W}" height="${H}" style="display:block">` + irCaEixo(W, pl, pr, y, lo, hi, 5);
  rows.forEach((r,i)=>{
    const x = pl+i*sl+(sl-bw)/2, a = Math.min(y(0), y(r.v)), b = Math.max(y(0), y(r.v)), on = !sel || sel===r.mes;
    s += `<g style="cursor:pointer" onclick="irCaSetMes('${r.mes}')"><title>${r.rot}: ${irCaR(r.v)}</title><rect x="${pl+i*sl}" y="${pt}" width="${sl}" height="${H-pt-pb}" fill="transparent"/><rect x="${x}" y="${a}" width="${bw}" height="${Math.max(2,b-a)}" rx="4" fill="${irCaCor(r.v)}" opacity="${on?1:.35}"/></g>`;
    s += `<text x="${x+bw/2}" y="${r.v>=0?a-5:b+13}" font-size="10.5" font-weight="800" text-anchor="middle" fill="${irCaCor(r.v)}">${irCaK(r.v)}</text>`;
    s += `<text x="${x+bw/2}" y="${H-8}" font-size="11" font-weight="${sel===r.mes?800:600}" text-anchor="middle" style="fill:${sel===r.mes?'var(--ink)':'var(--ink-soft)'}">${r.rot}</text>`;
  });
  s += `<polyline points="${ac.map((v,i)=>(pl+i*sl+sl/2).toFixed(1)+','+y(v).toFixed(1)).join(' ')}" fill="none" style="stroke:var(--ca-linha)" stroke-width="2.2"/>`;
  s += ac.map((v,i)=>`<circle cx="${pl+i*sl+sl/2}" cy="${y(v)}" r="3" style="fill:var(--surface);stroke:var(--ca-linha)" stroke-width="2"/>`).join('');
  return s + '</svg>';
}
function irCaZeroSvg(net, passos, W){
  const H = 270, pl = 58, pr = 10, pt = 18, pb = 42;
  const vals = [net, 0, ...passos.map(p=>p.ate)];
  const hi = Math.max(...vals)*1.1 + 1, lo = Math.min(...vals)*1.1 - 1;
  const y = v=> pt + (hi-v)/(hi-lo)*(H-pt-pb);
  const n = passos.length + 1, sl = (W-pl-pr)/n, bw = Math.min(40, sl*0.6);
  let s = `<svg width="${W}" height="${H}" style="display:block">` + irCaEixo(W, pl, pr, y, lo, hi, 5);
  s += `<line x1="${pl}" x2="${W-pr}" y1="${y(0)}" y2="${y(0)}" stroke="#1E8E4E" stroke-dasharray="6 4" stroke-width="2"/><text x="${W-pr-2}" y="${y(0)-5}" font-size="11" font-weight="800" text-anchor="end" fill="#1E8E4E">zero</text>`;
  s += `<rect x="${pl+(sl-bw)/2}" y="${Math.min(y(0),y(net))}" width="${bw}" height="${Math.max(2,Math.abs(y(net)-y(0)))}" rx="4" fill="${irCaCor(net)}"/>`;
  s += `<text x="${pl+sl/2}" y="${H-26}" font-size="10.5" font-weight="800" text-anchor="middle" style="fill:var(--ink)">Net</text><text x="${pl+sl/2}" y="${H-12}" font-size="10" text-anchor="middle" style="fill:var(--ink-soft)">${irCaK(net)}</text>`;
  passos.forEach((p,i)=>{
    const x = pl+(i+1)*sl+(sl-bw)/2, a = y(p.ate), b = y(p.de);
    s += `<line x1="${x-(sl-bw)}" x2="${x}" y1="${b}" y2="${b}" stroke="#9AA3BF" stroke-dasharray="3 3"/>`;
    s += `<g style="cursor:pointer" onclick="irCaAbrirItem('${irEsc(p.item)}')"><title>${irEsc(p.item)} · ${irEsc(p.nome)} — localizar: ${irCaR(-p.v, true)} · Net vai a ${irCaR(p.ate)}</title><rect x="${x}" y="${Math.min(a,b)}" width="${bw}" height="${Math.max(2,Math.abs(b-a))}" rx="3" fill="#3A5BD9"/></g>`;
    s += `<text x="${x+bw/2}" y="${H-26}" font-size="9.5" font-weight="800" text-anchor="middle" style="fill:var(--ink)">${irEsc(p.item)}</text><text x="${x+bw/2}" y="${H-12}" font-size="10" text-anchor="middle" fill="#3A5BD9">${irCaK(-p.v)}</text>`;
  });
  return s + '</svg>';
}
function irCaDiasSvg(dias, W, sel){
  const H = 210, pl = 58, pr = 10, pt = 16, pb = 26;
  const vals = dias.map(d=>d.v);
  const hi = Math.max(0, ...vals)*1.2 + 1, lo = Math.min(0, ...vals)*1.15 - 1;
  const y = v=> pt + (hi-v)/(hi-lo)*(H-pt-pb);
  const sl = (W-pl-pr)/Math.max(1, dias.length), bw = Math.min(30, sl*0.6);
  let s = `<svg width="${W}" height="${H}" style="display:block">` + irCaEixo(W, pl, pr, y, lo, hi, 4);
  dias.forEach((d,i)=>{
    const x = pl+i*sl+(sl-bw)/2, a = Math.min(y(0), y(d.v)), b = Math.max(y(0), y(d.v)), on = !sel || sel===d.dia;
    s += `<g style="cursor:pointer" onclick="irCaSetDia('${d.dia}')"><title>${d.dia.slice(8,10)}/${d.dia.slice(5,7)}: ${irCaR(d.v)}</title><rect x="${pl+i*sl}" y="${pt}" width="${sl}" height="${H-pt-pb}" fill="transparent"/><rect x="${x}" y="${a}" width="${bw}" height="${Math.max(2,b-a)}" rx="3" fill="${irCaCor(d.v)}" opacity="${on?1:.35}"/></g>`;
    if(Math.abs(d.v) >= Math.max(...vals.map(Math.abs))*0.35) s += `<text x="${x+bw/2}" y="${d.v>=0?a-4:b+12}" font-size="10" font-weight="800" text-anchor="middle" fill="${irCaCor(d.v)}">${irCaK(d.v)}</text>`;
    s += `<text x="${x+bw/2}" y="${H-8}" font-size="10.5" font-weight="${sel===d.dia?800:500}" text-anchor="middle" style="fill:${sel===d.dia?'var(--ink)':'var(--ink-soft)'}">${d.dia.slice(8,10)}</text>`;
  });
  return s + '</svg>';
}

/* ---------- ficha do item ---------- */
function irCaAbrirItem(item){
  const d = IR.net410Data; if(!d) return;
  const todas = irCaLinhasAno(d).filter(l=>l.item===item).sort((a,b)=>a.dia.localeCompare(b.dia));
  if(!todas.length) return;
  const a = todas.reduce((s,l)=>s+irCaVal(l),0), neg = todas.filter(l=>irCaVal(l)<0).reduce((s,l)=>s+irCaVal(l),0), pos = todas.filter(l=>irCaVal(l)>0).reduce((s,l)=>s+irCaVal(l),0);
  let ac = 0;
  const el = document.getElementById('caDrawer'); if(!el) return;
  el.innerHTML = `<div class="ca-dr-ov" onclick="irCaFecharItem()"></div><div class="ca-dr">
    <div class="ca-dr-h"><button type="button" onclick="irCaFecharItem()">✕</button><span class="mono">${irEsc(item)}</span><b>${irEsc(todas[0].nome)}</b><small>${irEsc(todas[0].depto)} · ${irEsc(todas[0].forn)}</small></div>
    <div class="ca-dr-b">
      <div class="ca-dr-k"><div><span>Net do ano</span><b style="color:${irCaCor(a)}">${irCaR(a)}</b></div><div><span>Perdeu no ano</span><b style="color:#FE5000">${irCaR(neg)}</b></div><div><span>Voltou no ano</span><b style="color:#001A72">${irCaR(pos, true)}</b></div></div>
      <div class="ca-tab"><table><thead><tr><th>Data</th><th>Motivo</th><th>Depósito</th><th>Doc</th><th>Usuário</th><th class="num">Qtd</th><th class="num">Valor</th><th class="num">Acumulado</th></tr></thead><tbody>
      ${todas.map(l=>{ ac += irCaVal(l); return `<tr class="${l.validar?'':'ca-nv'}"><td>${l.dia.slice(8,10)}/${l.dia.slice(5,7)}</td><td>${irEsc(l.mot)}</td><td>${irEsc(l.dep)}</td><td class="mono">${irEsc(l.doc)}</td><td>${irEsc(String(l.usr).replace(/^MECA_/,''))}</td>
        <td class="num" style="color:${irCaCor(l.q)}">${l.q>0?'+':''}${Math.round(l.q).toLocaleString('pt-BR')}</td><td class="num" style="color:${irCaCor(l.v)}">${(l.v<0?'−':'+')+'R$ '+Math.round(Math.abs(l.v)).toLocaleString('pt-BR')}</td><td class="num" style="color:${irCaCor(ac)}">${irCaR(ac)}</td></tr>`; }).join('')}
      </tbody></table></div>
    </div></div>`;
  el.classList.add('on');
}
function irCaFecharItem(){ const el = document.getElementById('caDrawer'); if(el){ el.classList.remove('on'); el.innerHTML = ''; } }

/* ---------- tela ---------- */
function irRenderCentralAjustes(){
  const anos = IR.net410Anos||[];
  if(!anos.length) return `<div class="panel"><h3>Central de Ajustes</h3><p class="field-hint">Importe a QRY410 na aba <a href="#" onclick="irSwitchTab('importacao');return false;">Importação</a>.</p></div>`;
  const d = IR.net410Data;
  if(!d) return `<div class="panel"><p class="field-hint">Carregando...</p></div>`;
  if(!(d.linhasLogica||[]).length) return `<div class="panel"><h3>Central de Ajustes</h3><p class="field-hint">Reimporte a QRY410 na aba <a href="#" onclick="irSwitchTab('importacao');return false;">Importação</a>.</p></div>`;
  const S = IR.caS, qtd = irCaQtd();
  const todas = irCaLinhasAno(d);
  const meses = Array.from(new Set(todas.map(l=>l.mes))).filter(Boolean).sort();
  if(S.mes===null || (S.mes && !meses.includes(S.mes))){ S.mes = meses[meses.length-1]; S.dia = ''; }
  const base = todas.filter(l=>irCaPassa(l));
  const esc = base.filter(irCaNoEscopo);
  // Item no ANO (sem recorte) para a situação.
  const itAno = new Map();
  for(const l of todas){ let o = itAno.get(l.item); if(!o){ o = {a:0, neg:0, pos:0}; itAno.set(l.item, o); } const v = irCaVal(l); o.a += v; if(v<0) o.neg -= v; else o.pos += v; }
  const classe = i=>{ const o = itAno.get(i)||{a:0,neg:0,pos:0}, giro = Math.max(o.neg, o.pos);
    if(giro && Math.abs(o.a) <= giro*0.05) return 'eq'; if(o.a<0) return 'perda'; if(o.neg===0) return 'dup'; return 'mais'; };
  // Itens do escopo (só motivos que precisam de validação).
  const it = new Map(); let nv = 0;
  for(const l of esc){
    if(!l.validar){ nv += irCaVal(l); continue; }
    let o = it.get(l.item); if(!o){ o = {item:l.item, nome:l.nome, v:0, mot:new Map(), dep:new Map()}; it.set(l.item, o); }
    const v = irCaVal(l); o.v += v; o.mot.set(l.mot, (o.mot.get(l.mot)||0)+v); o.dep.set(l.dep, (o.dep.get(l.dep)||0)+v);
  }
  const pior = m=> Array.from(m.entries()).sort((x,y)=>x[1]-y[1])[0][0];
  const itens = Array.from(it.values()).map(o=>({...o, a:(itAno.get(o.item)||{}).a||0, c:classe(o.item), m:pior(o.mot), d:pior(o.dep)}));
  const ent = esc.reduce((s,l)=>s+Math.max(0,irCaVal(l)),0), sai = esc.reduce((s,l)=>s+Math.min(0,irCaVal(l)),0), net = ent+sai;
  const porMes = new Map(); base.forEach(l=>porMes.set(l.mes, (porMes.get(l.mes)||0)+irCaVal(l)));
  const netAno = Array.from(porMes.values()).reduce((a,b)=>a+b,0);
  const n = c=> itens.filter(x=>x.c===c).length;
  const vPerda = itens.filter(x=>x.c==='perda' && x.v<0).reduce((s,x)=>s+x.v,0);
  const vDup = itens.filter(x=>x.c==='dup').reduce((s,x)=>s+x.v,0);
  const vEq = itens.filter(x=>x.c==='eq').reduce((s,x)=>s+((itAno.get(x.item)||{}).neg||0),0);
  const maior = itens.slice().sort((a,b)=>a.a-b.a)[0];
  const rotMes = m=> IR_CA_MES[parseInt(m.slice(5,7),10)-1];
  const lbl = S.dia ? S.dia.slice(8,10)+'/'+S.dia.slice(5,7) : (S.mes ? rotMes(S.mes) : 'Ano');

  // ----- capa
  const chips = Object.entries(S.f).map(([k,v])=>`<button type="button" class="ca-chip" onclick="irCaTiraF('${k}')">${IR_CA_DIMS.find(x=>x[0]===k)[1]}: ${irEsc(v)} ✕</button>`).join('')
    + (S.dia ? `<button type="button" class="ca-chip" onclick="irCaSetDia('${S.dia}')">Dia ${lbl} ✕</button>` : '');
  const cab = `<section class="dx-hero ca-hero"><div class="dx-hero-in">
      <div class="dx-marca"><span class="brand-logo dx-logo" aria-hidden="true"><img src="brand/Logo_LDM_icon.png" alt=""></span><div class="dx-marca-txt"><b>Oficina LDM</b><span>Inventário · CD Cajamar</span></div></div>
      <div class="dx-hero-row">
        <div class="dx-hero-tit"><h2>Central de Ajustes</h2><span class="dx-tag">Net ${d.ano} · ${lbl}</span></div>
        <div class="ca-seg ca-seg-hero"><button type="button" class="${qtd?'':'on'}" onclick="irCaSetMet('v')">Valor R$</button><button type="button" class="${qtd?'on':''}" onclick="irCaSetMet('q')">Quantidade</button></div>
      </div>
      <div class="ca-esc"><button type="button" class="${!S.mes?'on':''}" onclick="irCaSetMes('')">Ano<small>${irCaK(netAno)}</small></button>${meses.map(m=>`<button type="button" class="${S.mes===m?'on':''}" onclick="irCaSetMes('${m}')">${rotMes(m)}<small>${irCaK(porMes.get(m)||0)}</small></button>`).join('')}</div>
      ${chips?`<div class="ca-chips">${chips}</div>`:''}
    </div></section>`;

  // ----- indicadores
  const kc = (rot, val, sub, cor, info, cls)=>`<div class="ca-kpi ${cls||''}"><span>${rot} ${irCaInfo(info)}</span><b style="color:${cor}">${val}</b><small>${sub||''}</small></div>`;
  const kpis = `<div class="ca-kpis">
    ${kc('Net · '+lbl, irCaR(net), (S.mes?'ano '+irCaR(netAno):meses.length+' meses'), irCaCor(net), 'Entradas − saídas no período escolhido, com os filtros aplicados.', 'destaque')}
    ${kc('Entradas', irCaR(ent, true), esc.filter(l=>irCaVal(l)>0).length.toLocaleString('pt-BR')+' lançamentos', '#001A72', 'Tudo que aumentou o estoque no período.')}
    ${kc('Saídas', irCaR(sai), esc.filter(l=>irCaVal(l)<0).length.toLocaleString('pt-BR')+' lançamentos', '#FE5000', 'Tudo que reduziu o estoque no período.')}
    ${kc('Sem validação', irCaR(nv), 'motivos já conhecidos (ex.: IMP)', 'var(--ink-soft)', 'Motivos que entram no Net mas não precisam ser validados (marcados na legenda de Configurações). Ficam fora dos ofensores.')}
    ${kc('Perda que não voltou', irCaR(vPerda), irFmtInt(n('perda'))+' itens fecham o ano negativos', '#FE5000', 'Itens que perderam no período e continuam negativos no ano. É o que precisa ser localizado.')}
    ${kc('Ganho sem perda', irCaR(vDup, true), irFmtInt(n('dup'))+' itens · possível duplicidade', '#C8361B', 'Itens que ganharam sem ter perdido antes no ano. Se for duplicidade, corrigir piora o Net.')}
    ${kc('Equalizado', irCaR(vEq), irFmtInt(n('eq'))+' itens perderam e voltaram', '#1E8E4E', 'Volume que perdeu e depois voltou no ano: o Net desses itens ficou perto de zero.')}
    ${kc('Maior ofensor', maior?irEsc(maior.item):'—', maior?irCaR(maior.a)+' no ano · '+irEsc(String(maior.nome).slice(0,26)):'', '#FE5000', 'Item com o Net do ano mais negativo entre os que movimentaram no período.')}
  </div>`;

  // ----- gráficos
  const rowsMes = meses.map(m=>({mes:m, rot:rotMes(m), v:porMes.get(m)||0}));
  const gMes = irCaPainel('Net mês a mês', irFluid('caMes', w=>irCaMesesSvg(rowsMes, w, S.mes), 270),
    irCaLeg('#001A72','ganho')+irCaLeg('#FE5000','perda')+irCaLeg('var(--ca-linha)','acumulado',true), 'Barra = Net do mês. Linha = acumulado do ano. Clique num mês para abrir; clique de novo para voltar ao ano.');
  const perdas = itens.filter(x=>x.c==='perda' && x.v<0).sort((a,b)=>a.v-b.v);
  const passos = []; let acc = net, zera = 0;
  for(const x of perdas){ if(passos.length>=14) break; passos.push({item:x.item, nome:x.nome, v:x.v, de:acc, ate:acc-x.v}); acc -= x.v; if(net<0 && acc>=0){ zera = passos.length; break; } }
  const resto = perdas.slice(passos.length).reduce((s,x)=>s+x.v,0);
  const zLeg = net>=0 ? '<span>Net já positivo</span>' : (zera ? `<span class="ca-ok">${zera} ${zera===1?'item zera':'itens zeram'} o Net</span>` : `<span>${passos.length} maiores: ${irCaR(-passos.reduce((s,p)=>s+p.v,0), true)} · faltam ${irCaR(resto)} em ${irFmtInt(perdas.length-passos.length)} itens</span>`);
  const gZero = irCaPainel('Caminho até zerar', passos.length ? irFluid('caZero', w=>irCaZeroSvg(net, passos, w), 270) : '<p class="field-hint">Nenhuma perda sem retorno no período.</p>', zLeg,
    'Começa no Net do período e soma, item a item, as maiores perdas que NÃO voltaram no ano. Cada degrau mostra quanto o Net sobe se o item for localizado. Clique no degrau para ver os movimentos.');
  let gDia = '';
  if(S.mes){
    const pd = new Map(); base.filter(l=>l.mes===S.mes).forEach(l=>pd.set(l.dia, (pd.get(l.dia)||0)+irCaVal(l)));
    const dias = Array.from(pd.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([dia,v])=>({dia, v}));
    gDia = irCaPainel('Net por dia · '+rotMes(S.mes), irFluid('caDia', w=>irCaDiasSvg(dias, w, S.dia), 210), irCaLeg('#001A72','ganho')+irCaLeg('#FE5000','perda'), 'Clique num dia para olhar só ele.');
  }
  const dims = IR_CA_DIMS.map(([k,rot])=>{
    const g = new Map(); todas.filter(l=>irCaPassa(l,k) && irCaNoEscopo(l)).forEach(l=>g.set(l[k], (g.get(l[k])||0)+irCaVal(l)));
    const l = Array.from(g.entries()).sort((a,b)=>a[1]-b[1]); const mx = Math.max(1, ...l.map(x=>Math.abs(x[1])));
    return `<div class="panel ca-panel ca-dim"><div class="dx-panel-h"><h3>${rot}</h3><span class="ca-dim-n">${l.length}</span></div><div class="ca-dim-l">${l.map(([nome,v])=>`<div class="ca-hb2 ${S.f[k]===nome?'on':''}" onclick='irCaSetF("${k}", ${JSON.stringify(nome).replace(/'/g,"&#39;")})' title="${irEsc(nome)}: ${irCaR(v)}">
      <span>${irEsc(nome)}</span><b style="color:${irCaCor(v)}">${irCaK(v)}</b><div><i style="width:${(Math.abs(v)/mx*100).toFixed(1)}%;background:${irCaCor(v)};${v<0?'margin-left:auto':''}"></i></div></div>`).join('')}</div></div>`;
  }).join('');

  // ----- ofensores
  const o = S.ord;
  const val = (x,c)=> c==='c' ? Object.keys(IR_CA_CL).indexOf(x.c) : x[c];
  const lista = itens.slice().sort((a,b)=>{ const p = val(a,o.c), q = val(b,o.c); return (typeof p==='string' ? String(p).localeCompare(String(q),'pt-BR',{numeric:true}) : p-q)*o.d; }).slice(0, 300);
  const mesItem = new Map(); base.forEach(l=>{ let m = mesItem.get(l.item); if(!m){ m = {}; mesItem.set(l.item, m); } m[l.mes] = (m[l.mes]||0)+irCaVal(l); });
  const th = (c,t,cls)=>`<th class="${cls||''} ${o.c===c?'on':''}" onclick="irCaOrdenar('${c}')">${t}<i>${o.c===c?(o.d>0?'▲':'▼'):'↕'}</i></th>`;
  const tab = `<div class="ca-tab"><table><thead><tr>${th('item','Item')}${th('nome','Descrição')}${th('d','Depósito')}${th('m','Motivo')}${th('v','Net '+lbl,'num')}${th('a','Net ano','num')}<th>Jan → Dez</th>${th('c','Situação')}</tr></thead><tbody>
    ${lista.map(x=>{ const m = mesItem.get(x.item)||{}; const mx = Math.max(1, ...Object.values(m).map(Math.abs));
      return `<tr onclick="irCaAbrirItem('${irEsc(x.item)}')"><td><span class="ca-cod">${irEsc(x.item)}</span></td><td class="ca-desc" title="${irEsc(x.nome)}">${irEsc(x.nome)}</td><td class="ca-sec">${irEsc(x.d)}</td><td class="ca-sec">${irEsc(x.m)}</td>
        <td class="num"><b style="color:${irCaCor(x.v)}">${irCaR(x.v)}</b></td><td class="num"><b style="color:${irCaCor(x.a)}">${irCaR(x.a)}</b></td>
        <td><div class="ca-hm">${meses.map(mm=>{ const v = m[mm]||0, t = Math.abs(v)/mx; return `<span title="${rotMes(mm)}: ${irCaR(v)}" style="${v?`background:${v<0?`rgba(254,80,0,${(.2+t*.8).toFixed(2)})`:`rgba(0,26,114,${(.2+t*.8).toFixed(2)})`}`:''};${S.mes===mm?'outline:2px solid var(--ink)':''}"></span>`; }).join('')}</div></td>
        <td><span class="ca-badge" style="--c:${IR_CA_CL[x.c][1]}">${IR_CA_CL[x.c][0]}</span></td></tr>`; }).join('')}
    </tbody></table></div>`;
  const gTab = irCaPainel('Ofensores · '+lbl, tab, Object.entries(IR_CA_CL).map(([k,[t,c]])=>`<span class="ca-badge" style="--c:${c}">${t} · ${irFmtInt(n(k))}</span>`).join(''),
    '<b>Perda (não voltou)</b>: fecha o ano negativo. <b>Ganho sem perda</b>: entrou saldo sem perda antes — possível duplicidade. <b>Ganhou mais que perdeu</b>: voltou e passou. <b>Equalizado</b>: perdeu e voltou. Motivos marcados como "sem validação" não entram aqui. Clique na linha para ver os movimentos.');

  return `${cab}<div class="dx-body ca-wrap">
    ${kpis}
    <div class="ca-g ca-g-a">${gMes}${gZero}</div>
    ${gDia}
    <div class="ca-g ca-g-5">${dims}</div>
    ${gTab}
  </div><div id="caDrawer" class="ca-drw"></div>`;
}
