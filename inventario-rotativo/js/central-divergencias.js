/* ============================================================
   CENTRAL DE DIVERGÊNCIAS (aba Divergências) — mesmo formato da Central de Ajustes
   (aba Net), com a base do inventário: cada linha é um item num LOCAL (divergência
   de um local concluído, diferença ≠ 0, motivo que conta pro Net).

   Ano → Mês → Dia (dia = fechamento do local), cruzando Motivo / Rua / Setor /
   Classe do local / Usuário (quem fez a contagem que fechou o local), em Valor (R$)
   ou Quantidade (peças). Valor = diferença × preço da aba (mesma regra de preço da
   tela de auditoria: 410 congelada → 278 → 390).

   Situação do item, olhando o ANO inteiro do item (todas as linhas):
     • Equalizado         — perdeu e voltou: o Net do ano ficou ≤ 5% do giro
     • Perda (não voltou) — fecha o ano negativo
     • Ganho sem perda    — só ganhou no ano
     • Voltou e passou
   A tela de auditoria antiga continua acessível pelo botão "Auditoria" da tabela.
   ============================================================ */
IR.cdS = IR.cdS || {ano:null, meses:null, dias:[], f:{}, met:'v', tipo:'todos', visao:'item', ord:{c:'v', d:1}};
IR.cdObsOff = IR.cdObsOff || new Set();
const IR_CD_DIMS = [['mot','Motivo'],['rua','Rua'],['setor','Setor'],['classe','Classe do local'],['usr','Usuário']];

function irCdQtd(){ return IR.cdS.met==='q'; }
function irCdVal(l){ return irCdQtd() ? l.q : l.v; }
function irCdK(v){
  const s = v < 0 ? '−' : (v > 0 ? '+' : ''); const a = Math.abs(v||0);
  if(irCdQtd()) return s + Math.round(a).toLocaleString('pt-BR');
  if(a >= 1e6) return s + (a/1e6).toLocaleString('pt-BR',{maximumFractionDigits:2}) + 'mi';
  if(a >= 1e3) return s + (a/1e3).toLocaleString('pt-BR',{maximumFractionDigits:1}) + 'k';
  return s + Math.round(a).toLocaleString('pt-BR');
}
function irCdR(v, sinal){
  const s = v < 0 ? '−' : ((sinal && v > 0) ? '+' : '');
  const n = Math.round(Math.abs(v||0)).toLocaleString('pt-BR');
  return irCdQtd() ? s + n + ' pç' : s + 'R$ ' + n;
}
function irCdAnos(){ return Array.from(new Set((IR.ciclos||[]).map(c=>String(irCicloAno(c)||'')).filter(Boolean))).sort(); }

/* ---------- carga do ano: divergências, locais e quem contou ---------- */
function irCdPronto(){
  const S = IR.cdS, ctx = IR._cdCtx;
  return !!(ctx && ctx.ano===S.ano && IR.divAnoCache && IR.divAnoCache.ano===S.ano && !IR._cdCarregando);
}
async function irCdCarregar(){
  if(IR._cdCarregando) return;
  IR._cdCarregando = true;
  const S = IR.cdS, ano = S.ano;
  try{
    // Reaproveita a carga da aba (divergências do ano + preço da 410/390).
    IR.divEscopo = {tipo:'ano', ano};
    IR.divEscopoDados = null;
    await irCarregarDivEscopo();
    const ciclos = irDivCiclosDoAno(ano);
    const locais = new Map(), usr = new Map();
    for(const c of ciclos){
      const ls = await irGetByCiclo(IR_STORES.locais, c.id);
      for(const l of ls) if(l.idLocal && !locais.has(l.idLocal)) locais.set(l.idLocal, {desc:l.descricao||'', rua:irRuaDoLocal(l), setor:String(l.x1||'').trim(), classe:String(l.classeLocal||l.grupoClasse||'').trim()});
      const cs = c.id===(IR.cicloAtivo||{}).id && IR._cicloPesadoId===c.id ? IR.contagens : await irGetByCiclo(IR_STORES.contagens, c.id);
      const rod = new Map();
      for(const k of cs){
        if(!(k.idConferencia>=2) || !k.usuario || k.liquidada===false) continue;
        const ch = c.id+'|'+k.local+'|'+k.inventario;
        const at = rod.get(ch);
        if(!at || k.idConferencia>at.r) rod.set(ch, {r:k.idConferencia, u:k.usuario});
      }
      rod.forEach((v,k)=>usr.set(k, v.u));
    }
    IR._cdCtx = {ano, locais, usr};
    IR._cdCache = null;
  }catch(e){ console.warn('Central de Divergências: falha ao carregar', e); IR._cdCtx = {ano, locais:new Map(), usr:new Map()}; }
  finally{ IR._cdCarregando = false; }
}

/* Linhas do ano (todas as que contam), guardadas por ano/legenda/preço. */
function irCdLinhasAno(){
  const S = IR.cdS, ctx = IR._cdCtx || {locais:new Map(), usr:new Map()};
  const divs = (IR.divAnoCache||{}).divs || [];
  const chave = S.ano+'|'+divs.length+'|'+JSON.stringify(IR.net410Legenda||[]).length+'|'+Object.keys(IR.div410Cache||{}).join(',')+'|'+(IR._itemInfo?1:0)+'|'+ctx.locais.size;
  if(IR._cdCache && IR._cdCache.k===chave) return IR._cdCache.linhas;
  const leg = new Map((IR.net410Legenda||[]).map(l=>[l.id, l.legenda]));
  const linhas = [];
  for(const d of irSoLocaisConcluidos(divs)){
    if(d.diferenca===0 || !irDivMotivoConta(d)) continue;
    const dia = irDivDiaDa(d); if(!dia) continue;
    const lo = ctx.locais.get(d.local) || {};
    const cod = String(d.motivo||'').trim().toUpperCase() || '(sem)';
    linhas.push({
      item:d.item, nome:d.itemNome||'', local:d.local, end:lo.desc || irDescLocal(d.local) || '',
      rua:lo.rua||'(sem rua)', setor:lo.setor||'(sem setor)', classe:lo.classe||'(sem classe)',
      usr:ctx.usr.get(d.cicloId+'|'+d.local+'|'+d.inventario) || '(sem usuário)',
      mot: cod + (leg.get(cod) ? ' · '+leg.get(cod) : ''), cod, inv:d.inventario||'',
      dia, mes:dia.slice(0,7), v:irDivValorDa(d).valor, q:d.diferenca
    });
  }
  IR._cdCache = {k:chave, linhas};
  return linhas;
}

/* ---------- estado ---------- */
function irCdPassa(l, sem){ const f = IR.cdS.f; return Object.keys(f).every(k=> k===sem || l[k]===f[k]); }
function irCdNoEscopo(l){ const S = IR.cdS; return (!(S.meses||[]).length || S.meses.includes(l.mes)) && (!S.dias.length || S.dias.includes(l.dia)); }
function irCdDefMeses(l){ const S = IR.cdS; S.meses = Array.from(new Set(l)).sort(); S.dias = S.dias.filter(dd=>S.meses.includes(dd.slice(0,7))); irRenderView(); }
function irCdSetMes(m){ const S = IR.cdS; if(!m) return irCdDefMeses([]); const l = (S.meses||[]).slice(); const i = l.indexOf(m); if(i>=0) l.splice(i,1); else l.push(m); irCdDefMeses(l); }
function irCdSetDia(dd){ const S = IR.cdS; const i = S.dias.indexOf(dd); if(i>=0) S.dias.splice(i,1); else S.dias.push(dd); irRenderView(); }
function irCdLimparDias(){ IR.cdS.dias = []; irRenderView(); }
function irCdSetF(k, v){ const f = IR.cdS.f; if(f[k]===v) delete f[k]; else f[k] = v; irRenderView(); }
function irCdTiraF(k){ delete IR.cdS.f[k]; irRenderView(); }
function irCdSetMet(m){ IR.cdS.met = m; irRenderView(); }
function irCdSetTipo(t){ IR.cdS.tipo = t; irRenderView(); }
function irCdSetVisao(v){ IR.cdS.visao = v; IR.cdS.ord = {c:'v', d:1}; irRenderView(); }
function irCdSetAno(a){ const S = IR.cdS; S.ano = String(a); S.meses = null; S.dias = []; S.f = {}; IR._cdCtx = null; irRenderView(); }
function irCdOrdenar(c){ const o = IR.cdS.ord; IR.cdS.ord = o.c===c ? {c, d:-o.d} : {c, d:(c==='v'||c==='a')?1:-1}; irRenderView(); }
function irCdAuditoria(on){ IR.divModoAuditoria = !!on; IR.divEscopo = {tipo:'ciclo'}; IR.divEscopoDados = null; if(!on) IR._cdCtx = null; irSwitchTab('divergencias'); }
function irToggleCdObs(v, on){
  if(v==='*'){ if(on) IR.cdObsOff = new Set(); else { const s = new Set(); irCdLinhasAno().forEach(l=>s.add(l.cod)); IR.cdObsOff = s; } }
  else if(on) IR.cdObsOff.delete(v); else IR.cdObsOff.add(v);
  irRenderView();
}
function irToggleCdMes(v, on){
  const S = IR.cdS; let l = (S.meses||[]).slice();
  if(v==='*') l = on ? Array.from(new Set(irCdLinhasAno().map(x=>x.mes))) : [];
  else { l = l.filter(x=>x!==v); if(on) l.push(v); }
  irCdDefMeses(l);
}
function irToggleCdDia(v, on){
  const S = IR.cdS;
  if(v==='*') S.dias = on ? Array.from(new Set(irCdLinhasAno().filter(l=>S.meses.includes(l.mes)).map(l=>l.dia))) : [];
  else { S.dias = S.dias.filter(x=>x!==v); if(on) S.dias.push(v); }
  irRenderView();
}
/* Mês e Dia no topo da tela (mesmo componente da aba Net). */
function irTopMesDiaCd(){
  if(!irCdPronto()) return ['',''];
  const S = IR.cdS, todas = irCdLinhasAno();
  const meses = Array.from(new Set(todas.map(l=>l.mes))).filter(Boolean).sort();
  const mOps = meses.map(m=>({v:m, t:IR_MES_NOMES[parseInt(m.slice(5,7),10)-1], c:'', on:(S.meses||[]).includes(m)}));
  const mHtml = irMsDrop('msCdMes', 'Mês', mOps, 'irToggleCdMes', {vazioTodos:true, resumo:(S.meses||[]).length ? irMsResumo(mOps) : 'Ano inteiro'});
  const dias = (S.meses||[]).length ? Array.from(new Set(todas.filter(l=>S.meses.includes(l.mes)).map(l=>l.dia))).sort() : [];
  const dOps = dias.map(dd=>({v:dd, t:dd.slice(8,10)+'/'+dd.slice(5,7)+' '+irDiaSemanaCurto(dd), c:'', on:S.dias.includes(dd)}));
  const dHtml = (S.meses||[]).length
    ? irMsDrop('msCdDia', 'Dia', dOps, 'irToggleCdDia', {vazioTodos:true, resumo:S.dias.length ? (S.dias.length<=2 ? S.dias.map(x=>x.slice(8,10)+'/'+x.slice(5,7)).join(', ') : S.dias.length+' dias') : 'Todos'})
    : `<label>Dia</label><details class="ms-drop" id="msCdDia" data-off="1"><summary>Escolha o mês</summary></details>`;
  return [mHtml, dHtml];
}

/* ---------- balão do Net por dia ---------- */
function irCdDiaTip(ev, dia){
  const tt = document.getElementById('irChartTooltip'); const ctx = IR._cdDiaItens; if(!tt || !ctx) return;
  const g = new Map(); ctx.base.filter(l=>l.dia===dia).forEach(l=>{ const k = l.item+'|'+l.local; let o = g.get(k); if(!o){ o = {item:l.item, nome:l.nome, local:l.local, end:l.end, cod:l.cod, v:0}; g.set(k, o); } o.v += irCdVal(l); });
  const lst = Array.from(g.values()).filter(x=>x.v).sort((a,b)=>Math.abs(b.v)-Math.abs(a.v));
  const tot = lst.reduce((s,x)=>s+x.v,0), mostra = lst.slice(0, 14);
  tt.innerHTML = `<div class="ct-title">${dia.slice(8,10)}/${dia.slice(5,7)} · ${irCdR(tot)} · ${lst.length} item×local</div>
    <table><thead><tr><th>Item</th><th>Endereço</th><th>Obs</th><th style="text-align:right">Dia</th><th style="text-align:right">Net ano</th></tr></thead><tbody>
    ${mostra.map(x=>{ const a = (ctx.itAno.get(x.item)||{}).a||0; return `<tr><td><b class="mono">${irEsc(x.item)}</b> ${irEsc(String(x.nome).slice(0,26))}</td><td>${irEsc(x.end||x.local)}</td><td>${irEsc(x.cod)}</td><td class="mono" style="text-align:right;color:${irCaCor(x.v)};font-weight:800">${irCdR(x.v)}</td><td class="mono" style="text-align:right;color:${irCaCor(a)};font-weight:800">${irCdR(a)}</td></tr>`; }).join('')}
    </tbody>${lst.length>mostra.length?`<tfoot><tr><td colspan="5">+${lst.length-mostra.length}</td></tr></tfoot>`:''}</table>`;
  tt.classList.remove('hidden','lt-wrap','lt-wrap-big'); tt.classList.add('ca-tip');
  irMoveDiaTooltip(ev);
}

/* ---------- fichas (item / local) ---------- */
function irCdFicha(titulo, sub, tag, linhas, colsLocal){
  const a = linhas.reduce((s,l)=>s+irCdVal(l),0), neg = linhas.filter(l=>irCdVal(l)<0).reduce((s,l)=>s+irCdVal(l),0), pos = linhas.filter(l=>irCdVal(l)>0).reduce((s,l)=>s+irCdVal(l),0);
  let ac = 0;
  const el = document.getElementById('cdDrawer'); if(!el) return;
  el.innerHTML = `<div class="ca-dr-ov" onclick="irCdFechar()"></div><div class="ca-dr">
    <div class="ca-dr-h"><button type="button" onclick="irCdFechar()">✕</button><span class="mono">${irEsc(tag)}</span><b>${irEsc(titulo)}</b><small>${irEsc(sub)}</small></div>
    <div class="ca-dr-b">
      <div class="ca-dr-k"><div><span>Net do ano</span><b style="color:${irCaCor(a)}">${irCdR(a)}</b></div><div><span>Faltou no ano</span><b style="color:#FE5000">${irCdR(neg)}</b></div><div><span>Sobrou no ano</span><b style="color:#001A72">${irCdR(pos, true)}</b></div></div>
      <div class="ca-tab"><table><thead><tr><th>Data</th>${colsLocal?'<th>Local</th><th>Endereço</th>':'<th>Item</th><th>Descrição</th>'}<th>Obs</th><th>Inventário</th><th>Usuário</th><th class="num">Qtd</th><th class="num">Valor</th><th class="num">Acumulado</th></tr></thead><tbody>
      ${linhas.map(l=>{ ac += irCdVal(l); return `<tr><td>${l.dia.slice(8,10)}/${l.dia.slice(5,7)}</td>${colsLocal?`<td class="mono">${irEsc(l.local)}</td><td>${irEsc(l.end||'—')}</td>`:`<td class="mono">${irEsc(l.item)}</td><td>${irEsc(l.nome)}</td>`}<td title="${irEsc(l.mot)}">${irEsc(l.cod)}</td><td class="mono">${irEsc(l.inv)}</td><td>${irEsc(irProdNome(l.usr))}</td>
        <td class="num" style="color:${irCaCor(l.q)}">${l.q>0?'+':''}${Math.round(l.q).toLocaleString('pt-BR')}</td><td class="num" style="color:${irCaCor(l.v)}">${(l.v<0?'−':'+')+'R$ '+Math.round(Math.abs(l.v)).toLocaleString('pt-BR')}</td><td class="num" style="color:${irCaCor(ac)}">${irCdR(ac)}</td></tr>`; }).join('')}
      </tbody></table></div>
    </div></div>`;
  el.classList.add('on');
}
function irCdAbrirItem(item){
  const ls = irCdLinhasAno().filter(l=>l.item===item).sort((a,b)=>a.dia.localeCompare(b.dia)); if(!ls.length) return;
  irCdFicha(ls[0].nome, new Set(ls.map(l=>l.local)).size+' local(is) no ano', item, ls, true);
}
function irCdAbrirLocal(local){
  const ls = irCdLinhasAno().filter(l=>l.local===local).sort((a,b)=>a.dia.localeCompare(b.dia)); if(!ls.length) return;
  irCdFicha(ls[0].end || local, ls[0].rua+' · '+ls[0].classe, local, ls, false);
}
function irCdFechar(){ const el = document.getElementById('cdDrawer'); if(el){ el.classList.remove('on'); el.innerHTML = ''; } }

/* ---------- tela ---------- */
function irRenderCentralDivergencias(){
  const S = IR.cdS;
  const anos = irCdAnos();
  if(!anos.length) return irEmptyState('Sem ciclos importados', 'Processe o ciclo na Importação.', "irSwitchTab('importacao')", 'Ir para Importação');
  if(!S.ano || !anos.includes(S.ano)){ S.ano = anos[anos.length-1]; IR._cdCtx = null; }
  if(!irCdPronto()){
    if(!IR._cdCarregando) irCdCarregar().finally(()=>{ if(IR.currentTab==='divergencias') irRenderView(); });
    return `<div class="panel"><p class="field-hint">Carregando as divergências de ${irEsc(S.ano)}...</p></div>`;
  }
  const todas = irCdLinhasAno();
  const meses = Array.from(new Set(todas.map(l=>l.mes))).filter(Boolean).sort();
  if(S.meses===null) S.meses = meses.length ? [meses[meses.length-1]] : [];
  S.meses = S.meses.filter(m=>meses.includes(m)); S.dias = S.dias.filter(dd=>S.meses.includes(dd.slice(0,7)));
  const qtd = irCdQtd();
  const base = todas.filter(l=>irCdPassa(l));
  const esc = base.filter(irCdNoEscopo);
  // Item no ANO (sem recorte) para a situação.
  const itAno = new Map();
  for(const l of todas){ let o = itAno.get(l.item); if(!o){ o = {a:0, neg:0, pos:0, r:0, q:0}; itAno.set(l.item, o); } const v = irCdVal(l); o.a += v; o.r += l.v; o.q += l.q; if(v<0) o.neg -= v; else o.pos += v; }
  const classe = i=>{ const o = itAno.get(i)||{a:0,neg:0,pos:0}, giro = Math.max(o.neg, o.pos);
    if(giro && Math.abs(o.a) <= giro*0.05) return 'eq'; if(o.a<0) return 'perda'; if(o.neg===0) return 'dup'; return 'mais'; };
  const pior = m=> Array.from(m.entries()).sort((x,y)=>x[1]-y[1])[0][0];
  const montaItens = linhas=>{
    const it = new Map();
    for(const l of linhas){
      let o = it.get(l.item); if(!o){ o = {item:l.item, nome:l.nome, v:0, vr:0, vq:0, mot:new Map(), locs:new Map()}; it.set(l.item, o); }
      const v = irCdVal(l); o.v += v; o.vr += l.v; o.vq += l.q; o.mot.set(l.cod, (o.mot.get(l.cod)||0)+v); o.locs.set(l.local, (o.locs.get(l.local)||0)+Math.abs(v));
    }
    return Array.from(it.values()).map(o=>{ const an = itAno.get(o.item)||{}; const locs = Array.from(o.locs.entries()).sort((x,y)=>y[1]-x[1]);
      return {...o, a:an.a||0, ar:an.r||0, aq:an.q||0, c:classe(o.item), m:pior(o.mot), loc:locs.length?locs[0][0]:'', nloc:locs.length}; });
  };
  const montaLocais = linhas=>{
    const lo = new Map();
    for(const l of linhas){
      let o = lo.get(l.local); if(!o){ o = {local:l.local, end:l.end, rua:l.rua, classe:l.classe, v:0, vr:0, vq:0, itens:new Set(), mot:new Map(), usr:new Map(), dia:''}; lo.set(l.local, o); }
      const v = irCdVal(l); o.v += v; o.vr += l.v; o.vq += l.q; o.itens.add(l.item); o.mot.set(l.cod, (o.mot.get(l.cod)||0)+v); o.usr.set(l.usr, (o.usr.get(l.usr)||0)+1); if(l.dia>o.dia) o.dia = l.dia;
    }
    return Array.from(lo.values()).map(o=>({...o, nitens:o.itens.size, m:pior(o.mot), u:Array.from(o.usr.entries()).sort((x,y)=>y[1]-x[1])[0][0], abs:Math.abs(o.v)}));
  };
  const itens = montaItens(esc);
  const ent = esc.reduce((s,l)=>s+Math.max(0,irCdVal(l)),0), sai = esc.reduce((s,l)=>s+Math.min(0,irCdVal(l)),0), net = ent+sai;
  const porMes = new Map(); base.forEach(l=>porMes.set(l.mes, (porMes.get(l.mes)||0)+irCdVal(l)));
  const netAno = Array.from(porMes.values()).reduce((a,b)=>a+b,0);
  const n = c=> itens.filter(x=>x.c===c).length;
  const vPerda = itens.filter(x=>x.c==='perda' && x.v<0).reduce((s,x)=>s+x.v,0);
  const vDup = itens.filter(x=>x.c==='dup').reduce((s,x)=>s+x.v,0);
  const vEq = itens.filter(x=>x.c==='eq').reduce((s,x)=>s+((itAno.get(x.item)||{}).neg||0),0);
  const maior = itens.slice().sort((a,b)=>a.a-b.a)[0];
  const nLoc = new Set(esc.map(l=>l.local)).size;
  const rotMes = m=> IR_CA_MES[parseInt(m.slice(5,7),10)-1];
  const lblMes = !S.meses.length ? 'Ano' : (S.meses.length<=3 ? S.meses.map(rotMes).join('+') : S.meses.length+' meses');
  const lbl = S.dias.length ? (S.dias.length===1 ? S.dias[0].slice(8,10)+'/'+S.dias[0].slice(5,7) : S.dias.length+' dias') : lblMes;

  // ----- capa
  const chips = Object.entries(S.f).map(([k,v])=>`<button type="button" class="ca-chip" onclick="irCdTiraF('${k}')">${IR_CD_DIMS.find(x=>x[0]===k)[1]}: ${irEsc(v)} ✕</button>`).join('')
    + (S.dias.length ? `<button type="button" class="ca-chip" onclick="irCdLimparDias()">${S.dias.length===1?'Dia':'Dias'} ${lbl} ✕</button>` : '');
  const selAno = anos.length>1 ? `<select class="cd-ano" onchange="irCdSetAno(this.value)">${anos.map(a=>`<option value="${a}" ${a===S.ano?'selected':''}>${a}</option>`).join('')}</select>` : '';
  const cab = `<section class="dx-hero ca-hero cd-hero"><div class="dx-hero-in">
      <div class="dx-marca"><span class="brand-logo dx-logo" aria-hidden="true"><img src="brand/Logo_LDM_icon.png" alt=""></span><div class="dx-marca-txt"><b>Oficina LDM</b><span>Inventário · CD Cajamar</span></div></div>
      <div class="dx-hero-row">
        <div class="dx-hero-tit"><h2>Central de Divergências</h2><span class="dx-tag">Inventário ${irEsc(S.ano)} · ${lbl}</span>${selAno}</div>
      </div>
      <div class="ca-esc"><button type="button" class="${!S.meses.length?'on':''}" onclick="irCdSetMes('')">Ano<small>${irCdK(netAno)}</small></button>${meses.map(m=>`<button type="button" class="${S.meses.includes(m)?'on':''}" onclick="irCdSetMes('${m}')">${rotMes(m)}<small>${irCdK(porMes.get(m)||0)}</small></button>`).join('')}</div>
      ${chips?`<div class="ca-chips">${chips}</div>`:''}
    </div></section>`;

  // ----- indicadores
  const kc = (rot, val, sub, cor, cls)=>`<div class="ca-kpi ${cls||''}"><span>${rot}</span><b style="color:${cor}">${val}</b><small>${sub||''}</small></div>`;
  const kpis = `<div class="ca-kpis">
    ${kc('Net · '+lbl, irCdR(net), (S.meses.length?'ano '+irCdR(netAno):meses.length+' meses'), irCaCor(net), 'destaque')}
    ${kc('Sobras', irCdR(ent, true), esc.filter(l=>irCdVal(l)>0).length.toLocaleString('pt-BR')+' item×local', '#001A72')}
    ${kc('Faltas', irCdR(sai), esc.filter(l=>irCdVal(l)<0).length.toLocaleString('pt-BR')+' item×local', '#FE5000')}
    ${kc('Locais divergentes', irFmtInt(nLoc), irFmtInt(itens.length)+' itens', '#001A72')}
    ${kc('Perda que não voltou', irCdR(vPerda), irFmtInt(n('perda'))+' itens fecham o ano negativos', '#FE5000')}
    ${kc('Ganho sem perda', irCdR(vDup, true), irFmtInt(n('dup'))+' itens · só sobrou no ano', '#C8361B')}
    ${kc('Equalizado', irCdR(vEq), irFmtInt(n('eq'))+' itens perderam e voltaram', '#1E8E4E')}
    ${kc('Maior ofensor', maior?irEsc(maior.item):'—', maior?irCdR(maior.a)+' no ano · '+irEsc(String(maior.nome).slice(0,26)):'', '#FE5000')}
  </div>`;

  // ----- gráficos (mesmos desenhos da aba Net)
  const rowsMes = meses.map(m=>({mes:m, rot:rotMes(m), v:porMes.get(m)||0}));
  const comoCd = s=> s.replace(/irCaSetMes\(/g, 'irCdSetMes(').replace(/irCaSetDia\(/g, 'irCdSetDia(').replace(/irCaDiaTip\(/g, 'irCdDiaTip(');
  const comQtd = fn=>{ const met = IR.caS.met; IR.caS.met = S.met; try{ return fn(); } finally{ IR.caS.met = met; } };
  const gMes = irCaPainel('NET', irFluid('cdMes', w=>comoCd(comQtd(()=>irCaMesesSvg(rowsMes, w, S.meses, netAno))), 270),
    irCaLeg('#001A72','sobra')+irCaLeg('#FE5000','falta')+irCaLeg('var(--ca-linha)','acumulado',true));
  const lado = (lst)=>{ const mx = Math.max(1, ...lst.map(x=>Math.abs(x.v)), ...lst.map(x=>Math.abs(x.a)));
    return lst.length ? lst.map(x=>`<div class="ca-md" onclick="irCdAbrirItem('${irEsc(x.item)}')" title="${irEsc(x.item)} — ${irEsc(x.nome)} · ${IR_CA_CL[x.c][0]}">
      <span class="ca-md-n"><b>${irEsc(x.item)}</b> ${irEsc(x.nome)}</span>
      <div class="ca-md-t"><i style="width:${(Math.abs(x.v)/mx*100).toFixed(1)}%;background:${IR_CA_CL[x.c][1]}"></i>${x.a && Math.sign(x.a)===Math.sign(x.v)?`<em style="left:${(Math.min(Math.abs(x.a),mx)/mx*100).toFixed(1)}%"></em>`:''}</div>
      <b style="color:${irCaCor(x.v)}">${irCdK(x.v)}</b><b class="ca-md-a" style="color:${irCaCor(x.a)}">${x.a?irCdK(x.a):'0'}</b></div>`).join('') : '<p class="field-hint">Nenhum.</p>'; };
  const topP = itens.filter(x=>x.v<0).sort((a,b)=>a.v-b.v).slice(0,8), topG = itens.filter(x=>x.v>0).sort((a,b)=>b.v-a.v).slice(0,8);
  const cabMd = `<div class="ca-md ca-md-h"><span>Item</span><span></span><span>${lbl}</span><span>Ano</span></div>`;
  const gTop = irCaPainel('Itens mais divergentes', `<div class="ca-md2"><div><div class="ca-md-tit p">Maiores faltas</div>${cabMd}${lado(topP)}</div><div><div class="ca-md-tit g">Maiores sobras</div>${cabMd}${lado(topG)}</div></div>
    <div class="cmp-legend ca-md-leg">${Object.entries(IR_CA_CL).map(([k,[t,c]])=>irCaLeg(c,t)).join('')}<span><span class="ca-leg-tick"></span>Net do ano</span></div>`);
  let gDia = '';
  if(S.meses.length){
    const pd = new Map(); base.filter(l=>S.meses.includes(l.mes)).forEach(l=>pd.set(l.dia, (pd.get(l.dia)||0)+irCdVal(l)));
    const dias = Array.from(pd.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([dia,v])=>({dia, v}));
    gDia = irCaPainel('Net por dia · '+lblMes, irFluid('cdDia', w=>comoCd(comQtd(()=>irCaDiasSvg(dias, w, S.dias))), 230), irCaLeg('#001A72','sobra')+irCaLeg('#FE5000','falta'));
    IR._cdDiaItens = {base:base.filter(l=>S.meses.includes(l.mes)), itAno};
  }
  const dims = IR_CD_DIMS.map(([k,rot])=>{
    const g = new Map(); todas.filter(l=>irCdPassa(l,k) && irCdNoEscopo(l)).forEach(l=>{ const nm = k==='usr' ? l.usr : l[k]; g.set(nm, (g.get(nm)||0)+irCdVal(l)); });
    const l = Array.from(g.entries()).sort((a,b)=>a[1]-b[1]); const mx = Math.max(1, ...l.map(x=>Math.abs(x[1])));
    const nomeVis = nm=> k==='usr' ? irProdNome(nm) : nm;
    return `<div class="panel ca-panel ca-dim"><div class="dx-panel-h"><h3>${rot}</h3><span class="ca-dim-n">${l.length}</span></div><div class="ca-dim-l">${l.map(([nome,v])=>`<div class="ca-hb2 ${S.f[k]===nome?'on':''}" onclick='irCdSetF("${k}", ${JSON.stringify(nome).replace(/'/g,"&#39;")})' title="${irEsc(nome)}: ${irCdR(v)}">
      <span>${irEsc(nomeVis(nome))}</span><b style="color:${irCaCor(v)}">${irCdK(v)}</b><div><i style="width:${(Math.abs(v)/mx*100).toFixed(1)}%;background:${irCaCor(v)};${v<0?'margin-left:auto':''}"></i></div></div>`).join('')}</div></div>`;
  }).join('');

  // ----- ofensores (itens ou locais)
  const off = IR.cdObsOff;
  const escTab = off.size ? esc.filter(l=>!off.has(l.cod)) : esc;
  const o = S.ord;
  const R$ = v=> (v<0?'−':(v>0?'+':''))+'R$ '+Math.round(Math.abs(v)).toLocaleString('pt-BR');
  const PC = v=> (v<0?'−':(v>0?'+':''))+Math.round(Math.abs(v)).toLocaleString('pt-BR');
  const th = (c,t,cls)=>`<th class="${cls||''} ${o.c===c?'on':''}" onclick="irCdOrdenar('${c}')">${t}<i>${o.c===c?(o.d>0?'▲':'▼'):'↕'}</i></th>`;
  const ordena = (arr, val)=> arr.slice().sort((a,b)=>{ const p = val(a,o.c), q = val(b,o.c); return (typeof p==='string' ? String(p).localeCompare(String(q),'pt-BR',{numeric:true}) : p-q)*o.d; }).slice(0, 300);
  const filtraTipo = x=> S.tipo==='perda' ? x.v<0 : (S.tipo==='ganho' ? x.v>0 : true);
  const seg = (fn, val, atual, rot)=>`<button type="button" class="${atual===val?'on':''}" onclick="${fn}('${val}')">${rot}</button>`;
  const cods = new Map(); todas.forEach(l=>{ if(!cods.has(l.cod)) cods.set(l.cod, l.mot.split(' · ')[1]||''); });
  const obsOps = Array.from(cods.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([c,t])=>({v:c, c, t, on:!off.has(c)}));
  const ctl = `<div class="ca-tctl">
      <div class="ca-obsf">${irMsDrop('msCdObs', 'Obs', obsOps, 'irToggleCdObs', {resumo: off.size ? undefined : 'Todas'})}</div>
      <div class="ca-seg">${seg('irCdSetVisao','item',S.visao,'Itens')}${seg('irCdSetVisao','local',S.visao,'Locais')}</div>
      <div class="ca-seg">${seg('irCdSetTipo','todos',S.tipo,'Todos')}${seg('irCdSetTipo','perda',S.tipo,'Faltas')}${seg('irCdSetTipo','ganho',S.tipo,'Sobras')}</div>
      <div class="ca-seg">${seg('irCdSetMet','v',S.met,'Valor R$')}${seg('irCdSetMet','q',S.met,'Quantidade')}</div>
      ${window.LDM_SOMENTE_LEITURA ? '' : `<button type="button" class="btn btn-secondary cd-aud" onclick="irCdAuditoria(true)">Auditoria</button>`}
    </div>`;
  let tab;
  if(S.visao==='local'){
    const lst = ordena(montaLocais(escTab).filter(filtraTipo), (x,c)=> c==='c' ? 0 : x[c]);
    tab = `<div class="ca-tab"><table><thead><tr>${th('local','Local')}${th('end','Endereço')}${th('rua','Rua')}${th('classe','Classe')}${th('nitens','Itens','num')}${th('m','Obs')}${th('vr','R$ '+lbl,'num')}${th('vq','Pç '+lbl,'num')}${th('u','Usuário')}${th('dia','Último dia')}</tr></thead><tbody>
      ${lst.map(x=>`<tr onclick="irCdAbrirLocal('${irEsc(x.local)}')"><td><span class="ca-cod">${irEsc(x.local)}</span></td><td class="ca-desc" title="${irEsc(x.end)}">${irEsc(x.end||'—')}</td><td>${irEsc(x.rua)}</td><td>${irEsc(x.classe)}</td><td class="num">${irFmtInt(x.nitens)}</td><td class="ca-sec"><b>${irEsc(x.m)}</b></td>
        <td class="num"><b style="color:${irCaCor(x.vr)}">${R$(x.vr)}</b></td><td class="num"><b style="color:${irCaCor(x.vq)}">${PC(x.vq)}</b></td><td>${irEsc(irProdNome(x.u))}</td><td>${x.dia.slice(8,10)}/${x.dia.slice(5,7)}</td></tr>`).join('')}
      </tbody></table></div>`;
  } else {
    const lst = ordena(montaItens(escTab).filter(filtraTipo), (x,c)=> c==='c' ? Object.keys(IR_CA_CL).indexOf(x.c) : x[c]);
    const mesItem = new Map(); base.forEach(l=>{ let m = mesItem.get(l.item); if(!m){ m = {}; mesItem.set(l.item, m); } m[l.mes] = (m[l.mes]||0)+irCdVal(l); });
    tab = `<div class="ca-tab"><table><thead><tr>${th('item','Item')}${th('nome','Descrição')}${th('loc','Local')}${th('m','Obs')}${th('vr','R$ '+lbl,'num')}${th('ar','R$ ano','num')}${th('vq','Pç '+lbl,'num')}${th('aq','Pç ano','num')}<th>Jan → Dez</th>${th('c','Situação')}</tr></thead><tbody>
      ${lst.map(x=>{ const m = mesItem.get(x.item)||{}; const mx = Math.max(1, ...Object.values(m).map(Math.abs));
        return `<tr onclick="irCdAbrirItem('${irEsc(x.item)}')"><td><span class="ca-cod">${irEsc(x.item)}</span></td><td class="ca-desc" title="${irEsc(x.nome)}">${irEsc(x.nome)}</td><td class="mono ca-doc" title="${irEsc(irDescLocal(x.loc)||'')}${x.nloc>1?' · '+x.nloc+' locais':''}">${irEsc(x.loc||'—')}${x.nloc>1?` <small>+${x.nloc-1}</small>`:''}</td><td class="ca-sec"><b>${irEsc(x.m)}</b></td>
          <td class="num"><b style="color:${irCaCor(x.vr)}">${R$(x.vr)}</b></td><td class="num"><b style="color:${irCaCor(x.ar)}">${R$(x.ar)}</b></td>
          <td class="num"><b style="color:${irCaCor(x.vq)}">${PC(x.vq)}</b></td><td class="num"><b style="color:${irCaCor(x.aq)}">${PC(x.aq)}</b></td>
          <td><div class="ca-hm">${meses.map(mm=>{ const v = m[mm]||0, t = Math.abs(v)/mx; return `<span title="${rotMes(mm)}: ${irCdR(v)}" style="${v?`background:${v<0?`rgba(254,80,0,${(.2+t*.8).toFixed(2)})`:`rgba(0,26,114,${(.2+t*.8).toFixed(2)})`}`:''};${S.meses.includes(mm)?'outline:2px solid var(--ink)':''}"></span>`; }).join('')}</div></td>
          <td><span class="ca-badge" style="--c:${IR_CA_CL[x.c][1]}">${IR_CA_CL[x.c][0]}</span></td></tr>`; }).join('')}
      </tbody></table></div>`;
  }
  const gTab = irCaPainel('Ofensores', ctl + tab);

  return `${cab}<div class="dx-body ca-wrap">
    ${kpis}
    <div class="ca-g ca-g-a">${gMes}${gTop}</div>
    ${gDia}
    <div class="ca-g ca-g-5">${dims}</div>
    ${gTab}
  </div><div id="cdDrawer" class="ca-drw"></div>`;
}
