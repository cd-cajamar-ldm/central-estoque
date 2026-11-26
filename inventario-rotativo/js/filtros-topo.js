/* ============================================================
   FILTROS DO TOPO COM CAIXINHAS (lista suspensa com marcação)
   • Net (Central de Ajustes): Mês e Dia no topo, vários de uma vez.
   • Obs: dentro da tabela Ofensores (só ela é filtrada).
   ============================================================ */
IR.caObsOff = IR.caObsOff || new Set();

function irMsResumo(ops, vazioTodos){
  const on = ops.filter(o=>o.on);
  if(!ops.length) return '—';
  if(on.length===ops.length || (vazioTodos && !on.length)) return 'Todos';
  if(!on.length) return 'Nenhum';
  if(on.length<=2) return on.map(o=>o.c||o.t).join(', ');
  return on.length+' selecionados';
}
function irMsDrop(id, rot, ops, fn, opts){
  const o = opts||{};
  const lista = ops.map(op=>`<label class="ms-op"><input type="checkbox" ${op.on?'checked':''} ${o.bloq?'disabled':''} onchange="${fn}(${irEsc(JSON.stringify(op.v))}, this.checked)"><span>${op.c?`<b>${irEsc(op.c)}</b> `:''}${irEsc(op.t)}</span></label>`).join('');
  return `<label>${rot}</label><details class="ms-drop" id="${id}" ${o.desab?'data-off="1"':''}><summary>${irEsc(o.resumo || irMsResumo(ops, o.vazioTodos))}</summary>
    <div class="ms-pop">
      ${o.bloq?'':`<div class="ms-acoes"><button type="button" onclick="${fn}('*', true)">Todos</button><button type="button" onclick="${fn}('*', false)">Limpar</button></div>`}
      <div class="ms-lista">${lista || '<p class="field-hint">Nada para escolher.</p>'}</div>
      ${o.rodape||''}
    </div></details>`;
}
/* Fecha a lista ao clicar fora. */
document.addEventListener('click', ev=>{
  document.querySelectorAll('details.ms-drop[open]').forEach(d=>{ if(!d.contains(ev.target)) d.open = false; });
});

function irLegendaNome(cod){ const l = (IR.net410Legenda||[]).find(x=>x.id===cod); return l ? l.legenda : ''; }

function irRenderTopMulti(){
  const elObs = document.getElementById('tbFilterObs'), elMes = document.getElementById('tbFilterMeses'), elDia = document.getElementById('tbFilterDias');
  if(!elObs || !elMes || !elDia) return;
  const aberto = (IR._msAbertos||[]).concat(Array.from(document.querySelectorAll('details.ms-drop[open]')).map(d=>d.id));
  IR._msAbertos = null;
  const tab = IR.currentTab;
  const netTab = tab==='ciclo';
  elObs.hidden = true; elObs.innerHTML = ''; // Obs fica na tabela Ofensores (aba Net)
  const cdTab = tab==='divergencias' && !IR.divModoAuditoria && typeof irTopMesDiaCd==='function';
  elMes.hidden = elDia.hidden = !(netTab || cdTab);
  if(netTab){ const [m, d] = irTopMesDiaNet(); elMes.innerHTML = m; elDia.innerHTML = d; }
  else if(cdTab){ const [m, d] = irTopMesDiaCd(); elMes.innerHTML = m; elDia.innerHTML = d; if(!m) elMes.hidden = elDia.hidden = true; }
  else { elMes.innerHTML = elDia.innerHTML = ''; }
  aberto.forEach(id=>{ const d = document.getElementById(id); if(d) d.open = true; });
}

/* ---------- Net (Obs: filtro da tabela Ofensores) ---------- */
function irTopObsNet(){
  const d = IR.net410Data; if(!d || !(d.linhasLogica||[]).length) return '';
  const cods = new Map();
  irCaLinhasAno(d).forEach(l=>{ if(!cods.has(l.cod)) cods.set(l.cod, l.leg); });
  IR.caObsOff.forEach(c=>{ if(!cods.has(c)) cods.set(c, irLegendaNome(c)); });
  const ops = Array.from(cods.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([c,t])=>({v:c, c, t, on:!IR.caObsOff.has(c)}));
  return irMsDrop('msNetObs', 'Obs', ops, 'irToggleNetObs', {resumo: IR.caObsOff.size ? undefined : 'Todas'});
}
function irToggleNetObs(v, on){
  if(v==='*'){
    if(on) IR.caObsOff = new Set();
    else { const s = new Set(); irCaLinhasAno(IR.net410Data).forEach(l=>s.add(l.cod)); IR.caObsOff = s; }
  } else if(on) IR.caObsOff.delete(v); else IR.caObsOff.add(v);
  if(!window.LDM_SOMENTE_LEITURA){ try{ irSetConfig('net-obs-off', Array.from(IR.caObsOff)); }catch(e){} }
  irRenderView();
}
function irTopMesDiaNet(){
  const d = IR.net410Data; if(!d || !(d.linhasLogica||[]).length) return ['',''];
  const S = IR.caS;
  const meses = Array.from(new Set(irCaLinhasAno(d).map(l=>l.mes))).filter(Boolean).sort();
  const mOps = meses.map(m=>({v:m, t:IR_MES_NOMES[parseInt(m.slice(5,7),10)-1], c:'', on:(S.meses||[]).includes(m)}));
  const mHtml = irMsDrop('msNetMes', 'Mês', mOps, 'irToggleNetMes', {vazioTodos:true, resumo:(S.meses||[]).length ? irMsResumo(mOps) : 'Ano inteiro'});
  const dias = (S.meses||[]).length ? Array.from(new Set(irCaLinhasAno(d).filter(l=>S.meses.includes(l.mes)).map(l=>l.dia))).filter(Boolean).sort() : [];
  const dOps = dias.map(dd=>({v:dd, t:dd.slice(8,10)+'/'+dd.slice(5,7)+' '+irDiaSemanaCurto(dd), c:'', on:S.dias.includes(dd)}));
  const dHtml = (S.meses||[]).length
    ? irMsDrop('msNetDia', 'Dia', dOps, 'irToggleNetDia', {vazioTodos:true, resumo:S.dias.length ? (S.dias.length<=2 ? S.dias.map(x=>x.slice(8,10)+'/'+x.slice(5,7)).join(', ') : S.dias.length+' dias') : 'Todos'})
    : `<label>Dia</label><details class="ms-drop" id="msNetDia" data-off="1"><summary>Escolha o mês</summary></details>`;
  return [mHtml, dHtml];
}
function irDiaSemanaCurto(dd){ return ['dom','seg','ter','qua','qui','sex','sáb'][new Date(dd+'T12:00:00').getDay()]; }
function irToggleNetMes(v, on){
  const S = IR.caS; let l = (S.meses||[]).slice();
  if(v==='*') l = on ? Array.from(new Set(irCaLinhasAno(IR.net410Data).map(x=>x.mes))).filter(Boolean) : [];
  else { l = l.filter(x=>x!==v); if(on) l.push(v); }
  irCaDefMeses(l);
}
function irToggleNetDia(v, on){
  const S = IR.caS;
  if(v==='*') S.dias = on ? Array.from(new Set(irCaLinhasAno(IR.net410Data).filter(l=>S.meses.includes(l.mes)).map(l=>l.dia))) : [];
  else { S.dias = S.dias.filter(x=>x!==v); if(on) S.dias.push(v); }
  irRenderView();
}
