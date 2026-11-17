/* ============================================================
   CENTRAL DE AJUSTES (aba Net) — modelo CD1
   Tudo sai das linhas cruas da QRY410 já processadas (d.linhasLogica), só os
   motivos que contam pro Net (legenda de Configurações). Por isso os filtros
   de Departamento / Fornecedor / Obs / Depósito funcionam sem reprocessar.

   Perda real × compensado: compara o Net do item no MÊS com o Net do item no
   ANO inteiro (todas as linhas do item, sem os filtros de recorte).
     • Net do ano ≈ Net do mês (≥ 95% da perda continua)  -> perda real
     • Net do ano ≥ ~0 (a perda voltou)                     -> compensado
     • no meio                                              -> parcial
   ============================================================ */
IR.caFiltro = IR.caFiltro || {depto:'', forn:'', obs:'', dep:''};

function irCaK(v, sinal){
  const s = v < 0 ? '−' : ((sinal===false || !v) ? '' : '+');
  const a = Math.abs(v||0);
  if(a >= 1e6) return s + (a/1e6).toLocaleString('pt-BR',{minimumFractionDigits:2, maximumFractionDigits:2}) + 'mi';
  return s + (a/1e3).toLocaleString('pt-BR',{minimumFractionDigits:1, maximumFractionDigits:1}) + 'k';
}
function irCaR(v, sinal){
  const s = v < 0 ? '−' : ((sinal && v > 0) ? '+' : '');
  return s + 'R$ ' + Math.round(Math.abs(v||0)).toLocaleString('pt-BR');
}
function irCaCor(v){ return v < 0 ? 'var(--danger)' : 'var(--blue)'; }
const IR_CA_CLASSE = {
  real:{rot:'Perda real', cor:'var(--danger)'},
  parcial:{rot:'Parcial', cor:'var(--orange)'},
  comp:{rot:'Compensado', cor:'#8FA3DE'}
};

/* Linhas do ano que contam pro Net, já com Obs classificada. Guardado por ano. */
function irCaLinhasAno(d){
  const leg = IR.net410Legenda || [];
  const chave = d.ano+'|'+(d.linhasLogica||[]).length+'|'+leg.length+'|'+JSON.stringify(leg).length;
  if(IR._caCache && IR._caCache.k===chave) return IR._caCache.linhas;
  const linhas = [];
  for(const l of (d.linhasLogica||[])){
    const cls = irClassificarMotivo410(l.obsWms || l.observacao, leg);
    if(!cls.considerarNet) continue;
    const dt = String(l.dtMov||'');
    linhas.push({
      item:l.item, nome:l.nome, depto:l.depto||'(sem depto)', forn:l.fornecedor||'', dep:l.deposito||'(sem depósito)',
      local:l.localDesc||'', obs:cls.id, mes:l.mes || dt.slice(0,7), dia:dt.slice(0,10), valor:l.valor||0
    });
  }
  IR._caCache = {k:chave, linhas};
  return linhas;
}
function irCaPassaFiltro(l){
  const f = IR.caFiltro;
  return (!f.depto || l.depto===f.depto) && (!f.forn || l.forn===f.forn) && (!f.obs || l.obs===f.obs) && (!f.dep || l.dep===f.dep);
}
function irCaSetFiltro(campo, v){ IR.caFiltro[campo] = v; irRenderView(); }

function irCaDados(d, mesSel){
  const todas = irCaLinhasAno(d);
  const linhas = todas.filter(irCaPassaFiltro);
  // Net do item no ano: todas as linhas do item, sem recorte — a compensação pode ter vindo de outro depósito/Obs.
  const anoItem = new Map();
  for(const l of todas) anoItem.set(l.item, (anoItem.get(l.item)||0) + l.valor);
  const porMes = new Map();
  for(const l of linhas){
    const m = porMes.get(l.mes) || {ent:0, sai:0}; if(l.valor>0) m.ent += l.valor; else m.sai += l.valor; porMes.set(l.mes, m);
  }
  const doMes = linhas.filter(l=>l.mes===mesSel);
  let ent = 0, sai = 0;
  const soma = (mapa, k, v)=> mapa.set(k, (mapa.get(k)||0) + v);
  const porObsSai = new Map(), porDepto = new Map(), porForn = new Map(), porDep = new Map(), porObs = new Map(), porDia = new Map();
  const itens = new Map();
  for(const l of doMes){
    if(l.valor>0) ent += l.valor; else { sai += l.valor; soma(porObsSai, l.obs, l.valor); }
    soma(porDepto, l.depto, l.valor); soma(porDep, l.dep, l.valor); soma(porObs, l.obs, l.valor);
    if(l.forn) soma(porForn, l.forn, l.valor);
    soma(porDia, l.dia, l.valor);
    let it = itens.get(l.item);
    if(!it){ it = {item:l.item, nome:l.nome, depto:l.depto, forn:l.forn, mes:0, porDep:new Map(), porObs:new Map(), porLocal:new Map(), porDia:new Map()}; itens.set(l.item, it); }
    it.mes += l.valor;
    soma(it.porDep, l.dep, l.valor); soma(it.porObs, l.obs, l.valor); soma(it.porDia, l.dia, l.valor);
    if(l.local) soma(it.porLocal, l.local, l.valor);
  }
  const maisPesado = mapa => Array.from(mapa.entries()).sort((a,b)=>a[1]-b[1])[0];
  const lista = Array.from(itens.values()).map(it=>{
    const ano = anoItem.get(it.item)||0;
    let classe = null;
    if(it.mes < 0){
      classe = ano <= it.mes*0.95 ? 'real' : (ano >= it.mes*0.05 ? 'comp' : 'parcial');
    }
    const dep = maisPesado(it.porDep), obs = maisPesado(it.porObs), loc = maisPesado(it.porLocal);
    return {...it, ano, classe, dep: dep?dep[0]:'', obs: obs?obs[0]:'', local: loc?loc[0]:''};
  });
  const ofensores = lista.filter(i=>i.mes<0).sort((a,b)=>a.mes-b.mes);
  return {porMes, ent, sai, net:ent+sai, porObsSai, porDepto, porForn, porDep, porObs, porDia, ofensores, todas};
}

/* ---------- gráficos (desenhados na largura real via irFluid) ---------- */
function irCaColunasSvg(rows, W, dest){
  const H = 270, pl = 58, pr = 14, pt = 22, pb = 28;
  const ac = []; let t = 0; rows.forEach(r=>{ t += r.v; ac.push(t); });
  const hi = Math.max(0, ...rows.map(r=>r.v))*1.25 + Math.max(1, ...rows.map(r=>Math.abs(r.v)))*0.08;
  const lo = Math.min(0, ...rows.map(r=>r.v), ...ac)*1.08;
  const y = v=> pt + (hi-v)/((hi-lo)||1)*(H-pt-pb);
  const sl = (W-pl-pr)/Math.max(1, rows.length), bw = Math.min(48, sl*0.56);
  let s = `<svg width="${W}" height="${H}" style="display:block">`;
  for(let k=0;k<5;k++){ const v = lo+(hi-lo)*k/4; s += `<line x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)" stroke-opacity=".6"/><text x="${pl-6}" y="${y(v)+4}" font-size="10.5" text-anchor="end" style="fill:var(--ink-soft)">${irCaK(v,false)}</text>`; }
  s += `<line x1="${pl}" x2="${W-pr}" y1="${y(0)}" y2="${y(0)}" style="stroke:var(--ink-soft)"/>`;
  rows.forEach((r,i)=>{
    const x = pl + i*sl + (sl-bw)/2, a = Math.min(y(0), y(r.v)), b = Math.max(y(0), y(r.v));
    const on = dest==null || dest===i;
    s += `<g><title>${irEsc(r.rot)}: ${irCaR(r.v)}</title><rect x="${x}" y="${a}" width="${bw}" height="${Math.max(2,b-a)}" rx="4" style="fill:${irCaCor(r.v)}" fill-opacity="${on?1:.4}"/></g>`;
    s += `<text x="${x+bw/2}" y="${r.v>=0?a-5:b+13}" font-size="10.5" font-weight="800" text-anchor="middle" style="fill:${irCaCor(r.v)}">${irCaK(r.v)}</text>`;
    s += `<text x="${x+bw/2}" y="${H-8}" font-size="11" font-weight="${dest===i?800:600}" text-anchor="middle" style="fill:${dest===i?'var(--ink)':'var(--ink-soft)'}">${irEsc(r.rot)}</text>`;
  });
  if(rows.length>1){
    s += `<polyline points="${ac.map((v,i)=>(pl+i*sl+sl/2).toFixed(1)+','+y(v).toFixed(1)).join(' ')}" fill="none" style="stroke:var(--orange)" stroke-width="2.4" stroke-linejoin="round"/>`;
    s += ac.map((v,i)=>`<circle cx="${pl+i*sl+sl/2}" cy="${y(v)}" r="3" style="fill:var(--surface);stroke:var(--orange)" stroke-width="2"/>`).join('');
  }
  return s + '</svg>';
}
function irCaPonteSvg(ent, saidas, net, W){
  const H = 270, pl = 54, pr = 10, pt = 22, pb = 34;
  const passos = [{rot:'Entr.', v:ent, tp:'tot'}, ...saidas.map(([o,v])=>({rot:o, v, tp:'neg'})), {rot:'Net', v:net, tp:'fim'}];
  let t = 0; const seg = passos.map(p=>{
    if(p.tp==='tot'){ t = p.v; return [0, p.v]; }
    if(p.tp==='neg'){ const r = [t+p.v, t]; t += p.v; return r; }
    return [Math.min(0,p.v), Math.max(0,p.v)];
  });
  const hi = Math.max(ent, 1)*1.12, lo = Math.min(net, ...seg.map(s=>s[0]), 0)*1.2;
  const y = v=> pt + (hi-v)/((hi-lo)||1)*(H-pt-pb);
  const sl = (W-pl-pr)/passos.length, bw = Math.min(46, sl*0.62);
  let s = `<svg width="${W}" height="${H}" style="display:block">`;
  for(let k=0;k<5;k++){ const v = lo+(hi-lo)*k/4; s += `<line x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)" stroke-opacity=".6"/><text x="${pl-6}" y="${y(v)+4}" font-size="10.5" text-anchor="end" style="fill:var(--ink-soft)">${irCaK(v,false)}</text>`; }
  s += `<line x1="${pl}" x2="${W-pr}" y1="${y(0)}" y2="${y(0)}" style="stroke:var(--ink-soft)"/>`;
  passos.forEach((p,i)=>{
    const [a,b] = seg[i]; const x = pl + i*sl + (sl-bw)/2;
    const cor = p.tp==='tot' ? 'var(--success)' : (p.tp==='fim' ? irCaCor(p.v) : 'var(--danger)');
    s += `<g><title>${irEsc(p.rot)}: ${irCaR(p.v)}</title><rect x="${x}" y="${y(b)}" width="${bw}" height="${Math.max(2, y(a)-y(b))}" rx="3" style="fill:${cor}" fill-opacity="${p.tp==='neg' && i>1 ? .75 : 1}"/></g>`;
    s += `<text x="${x+bw/2}" y="${p.tp==='fim' ? y(a)+13 : y(b)-5}" font-size="10" font-weight="800" text-anchor="middle" style="fill:${cor}">${irCaK(p.v, p.tp==='tot')}</text>`;
    s += `<text x="${x+bw/2}" y="${H-12}" font-size="11" font-weight="800" text-anchor="middle" style="fill:var(--ink)">${irEsc(String(p.rot).slice(0,6))}</text>`;
  });
  return s + '</svg>';
}
function irCaDiaSvg(dias, W){
  const H = 220, pl = 54, pr = 10, pt = 18, pb = 28;
  const vals = dias.map(d=>d.v);
  const lo = Math.min(0, ...vals)*1.15, hi = Math.max(0, ...vals)*1.6 + Math.max(1, ...vals.map(Math.abs))*0.05;
  const y = v=> pt + (hi-v)/((hi-lo)||1)*(H-pt-pb);
  const sl = (W-pl-pr)/Math.max(1, dias.length), bw = Math.min(36, sl*0.58);
  const corte = Math.min(...vals)*0.35;
  let s = `<svg width="${W}" height="${H}" style="display:block">`;
  for(let k=0;k<4;k++){ const v = lo+(hi-lo)*k/3; s += `<line x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)" stroke-opacity=".6"/><text x="${pl-6}" y="${y(v)+4}" font-size="10.5" text-anchor="end" style="fill:var(--ink-soft)">${irCaK(v,false)}</text>`; }
  s += `<line x1="${pl}" x2="${W-pr}" y1="${y(0)}" y2="${y(0)}" style="stroke:var(--ink-soft)"/>`;
  dias.forEach((d,i)=>{
    const x = pl + i*sl + (sl-bw)/2, a = Math.min(y(0), y(d.v)), b = Math.max(y(0), y(d.v));
    const forte = d.v < 0 && d.v <= corte;
    const cor = d.v >= 0 ? '#8FA3DE' : (forte ? 'var(--danger)' : '#E7A796');
    s += `<rect x="${x}" y="${a}" width="${bw}" height="${Math.max(2,b-a)}" rx="3" style="fill:${cor}"/>`;
    if(forte) s += `<text x="${x+bw/2}" y="${b+13}" font-size="11" font-weight="800" text-anchor="middle" style="fill:var(--danger)">${irCaK(d.v)}</text>`;
    s += `<text x="${x+bw/2}" y="${H-8}" font-size="10.5" text-anchor="middle" style="fill:var(--ink-soft)">${d.dia.slice(8,10)}</text>`;
    s += `<rect x="${pl+i*sl}" y="${pt}" width="${sl}" height="${H-pt-pb}" fill="transparent" style="cursor:pointer" onmouseenter="irCaDiaTip(event,'${d.dia}')" onmousemove="irMoveDiaTooltip(event)" onmouseleave="irHideDiaTooltip()"/>`;
  });
  return s + '</svg>';
}
/* Balão do Net por dia: os ofensores SEM compensação (perda real) daquele dia. */
function irCaDiaTip(ev, dia){
  const tt = document.getElementById('irChartTooltip');
  const c = IR._caUltimo; if(!tt || !c) return;
  const itens = c.ofensores.filter(i=>i.classe==='real' && (i.porDia.get(dia)||0) < 0)
    .map(i=>({...i, vDia:i.porDia.get(dia)})).sort((a,b)=>a.vDia-b.vDia);
  const total = c.porDia.get(dia)||0;
  const mostra = itens.slice(0, 12);
  tt.innerHTML = `<div class="ct-title">${new Date(dia+'T00:00:00').toLocaleDateString('pt-BR')} · Net ${irCaR(total)}</div>
    ${mostra.length ? `<table><thead><tr><th>Item</th><th>Local</th><th>Obs</th><th style="text-align:right">Valor</th></tr></thead><tbody>
      ${mostra.map(i=>`<tr><td><b class="mono">${irEsc(i.item)}</b> ${irEsc(String(i.nome||'').slice(0,28))}</td><td>${irEsc(i.local||i.dep)}</td><td><b>${irEsc(i.obs)}</b></td><td class="mono" style="text-align:right;color:var(--danger);font-weight:800">${irCaR(i.vDia)}</td></tr>`).join('')}
    </tbody>${itens.length>mostra.length?`<tfoot><tr><td colspan="3">+${itens.length-mostra.length} itens</td><td class="mono" style="text-align:right">${irCaR(itens.slice(12).reduce((s,i)=>s+i.vDia,0))}</td></tr></tfoot>`:''}</table>`
    : `<div class="field-hint">Sem perda real neste dia.</div>`}`;
  tt.classList.remove('hidden', 'lt-wrap', 'lt-wrap-big'); tt.classList.add('ca-tip');
  irMoveDiaTooltip(ev);
}
function irCaHbar(lista, destacar){
  if(!lista.length) return '<p class="field-hint">—</p>';
  const mx = Math.max(...lista.map(([,v])=>Math.abs(v)), 1);
  return `<div class="ca-hbar">${lista.map(([r,v],i)=>`<div class="ca-hb" title="${irEsc(r)}: ${irCaR(v)}">
      <span class="${i===0&&destacar?'fw':''}">${irEsc(r)}</span>
      <div class="ca-hb-t"><i style="width:${(Math.abs(v)/mx*100).toFixed(1)}%;background:${v<0?(i===0&&destacar?'var(--danger)':'#E7A796'):'#8FA3DE'}"></i></div>
      <b style="color:${irCaCor(v)}">${irCaK(v)}</b></div>`).join('')}</div>`;
}
function irCaTop(mapa, n){ return Array.from(mapa.entries()).sort((a,b)=>a[1]-b[1]).slice(0, n||6); }
function irCaPainel(t, corpo, leg, cls){
  return `<div class="panel ca-panel ${cls||''}"><div class="dx-panel-h"><h3>${t}</h3>${leg?`<div class="cmp-legend">${leg}</div>`:''}</div>${corpo}</div>`;
}
function irCaLeg(cor, t, linha){ return `<span>${linha?`<span class="ca-leg-l" style="border-color:${cor}"></span>`:`<span class="cmp-dot" style="background:${cor};border-radius:3px"></span>`}${t}</span>`; }
function irCaSelect(campo, rot, valores){
  const atual = IR.caFiltro[campo]||'';
  return `<label class="ca-fil"><span>${rot}</span><select onchange="irCaSetFiltro('${campo}', this.value)">
    <option value="">Todos</option>${valores.map(v=>`<option value="${irEsc(v)}" ${v===atual?'selected':''}>${irEsc(v)}</option>`).join('')}</select></label>`;
}

function irRenderCentralAjustes(){
  const anos = IR.net410Anos||[];
  if(!anos.length) return `<div class="panel"><h3>Central de Ajustes</h3><p class="field-hint">Importe a QRY410 na aba <a href="#" onclick="irSwitchTab('importacao');return false;">Importação</a>.</p></div>`;
  const d = IR.net410Data;
  if(!d) return `<div class="panel"><p class="field-hint">Carregando...</p></div>`;
  if(!(d.linhasLogica||[]).length) return `<div class="panel"><h3>Central de Ajustes</h3><p class="field-hint">Reimporte a QRY410 na aba <a href="#" onclick="irSwitchTab('importacao');return false;">Importação</a>.</p></div>`;
  const meses = Array.from(new Set(irCaLinhasAno(d).map(l=>l.mes))).filter(Boolean).sort();
  const mesSel = IR.net410MesSel && meses.includes(IR.net410MesSel) ? IR.net410MesSel : meses[meses.length-1];
  const c = irCaDados(d, mesSel);
  IR._caUltimo = c;
  const mesIdx = parseInt(String(mesSel).slice(5,7),10)-1;
  const nomeMes = IR_MES_NOMES[mesIdx]||mesSel;
  const mesesRows = meses.map(m=>{ const x = c.porMes.get(m)||{ent:0,sai:0}; return {mes:m, rot:IR_MES_NOMES_ABREV[parseInt(m.slice(5,7),10)-1], v:x.ent+x.sai}; });
  const netAno = mesesRows.reduce((s,r)=>s+r.v,0);
  const iSel = mesesRows.findIndex(r=>r.mes===mesSel);
  const anterior = iSel>0 ? mesesRows[iSel-1].v : null;
  const varPct = anterior ? (c.net-anterior)/Math.abs(anterior) : null;

  const reais = c.ofensores.filter(i=>i.classe==='real');
  const comps = c.ofensores.filter(i=>i.classe!=='real');
  const vReal = reais.reduce((s,i)=>s+i.mes,0), vComp = comps.reduce((s,i)=>s+i.mes,0);
  const perdasItens = c.ofensores.reduce((s,i)=>s+i.mes,0);
  const maior = c.ofensores[0];
  const nLanc = c.todas.filter(l=>l.mes===mesSel && irCaPassaFiltro(l));
  const nSai = nLanc.filter(l=>l.valor<0).length, nEnt = nLanc.length-nSai;

  // Filtros (valores do ano)
  const valoresDe = k=> Array.from(new Set(c.todas.map(l=>l[k]).filter(Boolean))).sort((a,b)=>String(a).localeCompare(String(b)));
  const temForn = c.todas.some(l=>l.forn);
  const cab = `<div class="ca-cab">
    <div class="ca-cab-t"><b>Central de Ajustes</b><span>${irEsc(nomeMes)} · ${d.ano}</span></div>
    <div class="ca-fils">
      ${irCaSelect('depto','Departamento', valoresDe('depto'))}
      ${temForn ? irCaSelect('forn','Fornecedor', valoresDe('forn')) : ''}
      ${irCaSelect('obs','Obs', valoresDe('obs'))}
      ${irCaSelect('dep','Depósito', valoresDe('dep'))}
    </div></div>`;
  const kc = (rot, val, sub, cor, cls)=>`<div class="ca-kpi ${cls||''}"><span>${rot}</span><b style="color:${cor}">${val}</b><small>${sub||''}</small></div>`;
  const kpis = `<div class="ca-kpis">
    ${kc('Net do mês', irCaR(c.net), varPct==null?'':`${c.net<anterior?'▼':'▲'} ${Math.abs(Math.round(varPct*100))}% vs ${IR_MES_NOMES_ABREV[mesIdx-1]||''}`, irCaCor(c.net), 'destaque')}
    ${kc('Net do ano', irCaR(netAno), 'média '+irCaK(netAno/Math.max(1,mesesRows.length))+'/mês', irCaCor(netAno))}
    ${kc('Saídas', irCaR(c.sai), irFmtInt(nSai)+' lançamentos', 'var(--danger)')}
    ${kc('Entradas', irCaR(c.ent, true), irFmtInt(nEnt)+' lançamentos', 'var(--success)')}
    ${kc('Perda real', irCaR(vReal), irFmtInt(reais.length)+' itens'+(c.net<0?' · '+Math.round(vReal/c.net*100)+'% do Net':''), 'var(--danger)')}
    ${kc('Compensado no ano', irCaR(vComp), irFmtInt(comps.length)+' itens', 'var(--blue)')}
    ${kc('Itens com perda', irFmtInt(c.ofensores.length), irCaR(perdasItens), 'var(--ink)')}
    ${kc('Maior ofensor', maior?irEsc(maior.item):'—', maior?irCaR(maior.mes)+' · '+(IR_CA_CLASSE[maior.classe]||{}).rot:'', 'var(--danger)')}
  </div>`;

  const gMes = irCaPainel('Net mês a mês · '+d.ano, irFluid('caMes', w=>irCaColunasSvg(mesesRows, w, iSel), 270),
    irCaLeg('var(--blue)','ganho')+irCaLeg('var(--danger)','perda')+irCaLeg('var(--orange)','acumulado',true));
  const demais = c.net - vReal - vComp;
  const partes = [['Perda real', vReal, 'var(--danger)'], ['Compensado / parcial', vComp, '#8FA3DE'], ['Demais', demais, 'var(--line)']];
  const totAbs = partes.reduce((s,p)=>s+Math.abs(p[1]),0) || 1;
  let off = 0; const circ = 2*Math.PI*62;
  const donut = `<svg width="170" height="170" viewBox="0 0 170 170">${partes.map(p=>{ const f = Math.abs(p[1])/totAbs; const r = `<circle cx="85" cy="85" r="62" fill="none" style="stroke:${p[2]}" stroke-width="24" stroke-dasharray="${(f*circ).toFixed(1)} ${circ.toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 85 85)"/>`; off += f*circ; return r; }).join('')}
    <text x="85" y="84" text-anchor="middle" font-size="22" font-weight="800" style="fill:${irCaCor(c.net)};font-family:Poppins,Inter,sans-serif">${irCaK(c.net)}</text><text x="85" y="103" text-anchor="middle" font-size="11" style="fill:var(--ink-soft)">Net do mês</text></svg>`;
  const gComp = irCaPainel('O que é o Net de '+nomeMes.toLowerCase(), `<div class="ca-donut">${donut}<div class="ca-donut-l">${partes.map(p=>`<div><span><i style="background:${p[2]}"></i>${p[0]}</span><b style="color:${irCaCor(p[1])}">${irCaK(p[1])}</b></div>`).join('')}</div></div>`);

  const saidas = Array.from(c.porObsSai.entries()).sort((a,b)=>a[1]-b[1]);
  const gPonte = irCaPainel('Ponte do mês por Obs', irFluid('caPonte', w=>irCaPonteSvg(c.ent, saidas, c.net, w), 270));
  const gDep = irCaPainel('Net por departamento', irCaHbar(irCaTop(c.porDepto, 10), true));

  const top = c.ofensores.slice(0, 10);
  const mxTop = Math.max(1, ...top.map(i=>Math.abs(i.mes)));
  const gTop = irCaPainel('Top ofensores · mês × ano', `<div class="ca-top ca-top-h"><span>Item</span><span></span><span>Mês</span><span>Ano</span></div>
    ${top.map(i=>{ const k = IR_CA_CLASSE[i.classe]; return `<div class="ca-top" title="${irEsc(i.item)} — ${irEsc(i.nome)} · ${k.rot}">
      <span class="ca-top-n"><b class="mono">${irEsc(i.item)}</b> ${irEsc(i.nome)}</span>
      <div class="ca-hb-t ca-top-t"><i style="width:${(Math.abs(i.mes)/mxTop*100).toFixed(1)}%;background:${k.cor}"></i>${i.ano<0?`<em style="left:${(Math.min(Math.abs(i.ano),mxTop)/mxTop*100).toFixed(1)}%"></em>`:''}</div>
      <b style="color:var(--danger)">${irCaK(i.mes)}</b><b style="color:${irCaCor(i.ano)}">${i.ano?irCaK(i.ano):'0'}</b></div>`; }).join('')}`,
    irCaLeg(IR_CA_CLASSE.real.cor,'perda real')+irCaLeg(IR_CA_CLASSE.parcial.cor,'parcial')+irCaLeg(IR_CA_CLASSE.comp.cor,'compensado')+'<span><span class="ca-leg-tick"></span>Net do ano</span>');

  // Concentração (% das perdas por item, acumulado)
  const negs = c.ofensores.map(i=>i.mes);
  const totNeg = negs.reduce((s,v)=>s+v,0) || -1;
  const gPar = irCaPainel('Concentração das perdas', irFluid('caPar', W=>{
    const H = 240, pl = 40, n = Math.min(12, negs.length);
    const sl = (W-pl-10)/Math.max(1,n); let acc = 0;
    let s = `<svg width="${W}" height="${H}" style="display:block">`;
    for(let k=0;k<5;k++){ const yy = 20 + k*45; s += `<line x1="${pl}" x2="${W-10}" y1="${yy}" y2="${yy}" style="stroke:var(--line)" stroke-opacity=".6"/><text x="${pl-6}" y="${yy+4}" font-size="10.5" text-anchor="end" style="fill:var(--ink-soft)">${100-k*25}%</text>`; }
    const pts = [];
    for(let i=0;i<n;i++){ const v = negs[i]; acc += v; const h = v/totNeg*180;
      s += `<rect x="${pl+i*sl+3}" y="${200-h}" width="${Math.max(2,sl-6)}" height="${h}" rx="3" style="fill:${i===0?'var(--danger)':'#E7A796'}"/>`;
      pts.push([pl+i*sl+sl/2, 20+(1-acc/totNeg)*180]); }
    s += `<polyline points="${pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')}" fill="none" style="stroke:var(--orange)" stroke-width="2.4"/>`;
    pts.slice(0,3).forEach((p,i)=>{ s += `<text x="${p[0]+(i===0?12:0)}" y="${p[1]-8}" font-size="11" font-weight="800" text-anchor="${i===0?'start':'middle'}" style="fill:var(--orange)">${Math.round(negs.slice(0,i+1).reduce((a,b)=>a+b,0)/totNeg*100)}%</text>`; });
    s += `<text x="${pl}" y="${H-8}" font-size="10.5" style="fill:var(--ink-soft)">1 item = ${negs.length?Math.round(negs[0]/totNeg*100):0}% das perdas</text>`;
    return s+'</svg>'; }, 240));

  const gForn = temForn ? irCaPainel('Fornecedor', irCaHbar(irCaTop(c.porForn), true)) : '';
  const gDep2 = irCaPainel('Depósito', irCaHbar(irCaTop(c.porDep), true));
  const gObs = irCaPainel('Obs', irCaHbar(irCaTop(c.porObs), true));

  const dias = Array.from(c.porDia.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([dia,v])=>({dia, v}));
  const gDia = irCaPainel('Net por dia · '+nomeMes.toLowerCase(), irFluid('caDia', w=>irCaDiaSvg(dias, w), 220),
    irCaLeg('var(--danger)','dias fora da curva')+irCaLeg('#E7A796','perda')+irCaLeg('#8FA3DE','ganho'));

  const linhasTab = c.ofensores.slice(0, 40);
  const gTab = irCaPainel('Ofensores do mês', `<div class="table-wrap ca-tab"><table>
    <thead><tr><th>Item</th><th>Descrição</th><th>Depto</th>${temForn?'<th>Fornecedor</th>':''}<th>Depósito</th><th>Local</th><th>Obs</th><th style="text-align:right">Net mês</th><th style="text-align:right">Net ano</th><th>Situação</th></tr></thead>
    <tbody>${linhasTab.map(i=>{ const k = IR_CA_CLASSE[i.classe]; return `<tr>
      <td class="mono"><b>${irEsc(i.item)}</b></td><td>${irEsc(i.nome)}</td><td>${irEsc(i.depto)}</td>${temForn?`<td>${irEsc(i.forn||'—')}</td>`:''}
      <td><b>${irEsc(i.dep)}</b></td><td>${irEsc(i.local||'—')}</td><td>${irEsc(i.obs)}</td>
      <td class="mono" style="text-align:right;font-weight:800;color:var(--danger)">${irCaR(i.mes)}</td>
      <td class="mono" style="text-align:right;font-weight:800;color:${irCaCor(i.ano)}">${irCaR(i.ano)}</td>
      <td><span class="ca-badge" style="--c:${k.cor}">${k.rot}</span></td></tr>`; }).join('')}</tbody></table></div>`,
    Object.values(IR_CA_CLASSE).map(k=>`<span class="ca-badge" style="--c:${k.cor}">${k.rot}</span>`).join(''));

  return `<div class="ca-wrap">
    ${cab}${kpis}
    <div class="ca-g ca-g-a">${gMes}${gComp}</div>
    <div class="ca-g ca-g-b">${gPonte}${gDep}</div>
    <div class="ca-g ca-g-c">${gTop}${gPar}</div>
    <div class="ca-g ca-g-3">${gForn}${gDep2}${gObs}</div>
    ${gDia}
    ${gTab}
  </div>`;
}
