/* ============================================================
   QUEM CONTA NA PRODUTIVIDADE (Configurações)
   Períodos em que um colaborador NÃO conta (ex.: quem abre os inventários).
   Cada período: {id, usuario, de, ate, motivo} — de/ate em AAAA-MM-DD; vazio = sem limite.
   Vale pela DATA DE CADA CONTAGEM: fora dos períodos, a contagem volta a contar.
   Atinge só o que mede pessoas (Assertividade, painéis de Produtividade, aba
   Produtividade). Acurácia, divergências e Net não mudam.
   Guardado em config 'prod-excluidos' (vai para a nuvem com as demais configurações).
   ============================================================ */
const IR_PROD_EXCL_PADRAO = [{id:'padrao-gustavo', usuario:'MECA_GUSTAVOLEOPOLDINO', de:'', ate:'', motivo:'Abre os inventários'}];
IR.prodExcluidos = IR.prodExcluidos || null;
IR._prodExclVer = IR._prodExclVer || 0;
IR.peFiltro = IR.peFiltro || {busca:'', ver:'todos'};

function irProdExclLista(){ return Array.isArray(IR.prodExcluidos) ? IR.prodExcluidos : IR_PROD_EXCL_PADRAO; }
function irProdUsuarioConta(usuario, dia){
  if(!usuario) return true;
  const d = String(dia||'').slice(0,10);
  return !irProdExclLista().some(p=> p.usuario===usuario && (!p.de || !d || d>=p.de) && (!p.ate || !d || d<=p.ate));
}
function irDiaDaContagem(c){ return String(c.dataFimContagem || c.dataInicioContagem || c.dataSituacao || '').slice(0,10); }
async function irCarregarProdExcluidos(){
  try{ const v = await irGetConfig('prod-excluidos'); IR.prodExcluidos = Array.isArray(v) ? v : null; }catch(e){}
  IR._prodExclVer++;
}
async function irSalvarProdExcluidos(lista){
  if(window.LDM_SOMENTE_LEITURA){ irShowToast('Acesso só de visualização.', true); return; }
  IR.prodExcluidos = lista;
  IR._prodExclVer++;
  IR._assertCache = null; IR._dpCache = null;
  try{ await irSetConfig('prod-excluidos', lista); irShowToast('✓ Salvo.'); }
  catch(e){ irShowToast('Não consegui salvar: '+(e.message||e), true); }
  irRenderView();
}
function irPeHoje(){ const d = new Date(); const p = n=>String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
function irPeOntem(dia){ const d = new Date(dia+'T12:00:00'); d.setDate(d.getDate()-1); const p = n=>String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
function irPeData(d){ return d ? d.split('-').reverse().join('/') : ''; }
function irPeIdx(u){ return encodeURIComponent(u).replace(/[^A-Za-z0-9]/g,'_'); }

/* Não conta a partir da data escolhida. */
function irPeNaoConta(usuario){
  const k = irPeIdx(usuario);
  const de = (document.getElementById('pe-de-'+k)||{}).value || irPeHoje();
  const motivo = ((document.getElementById('pe-mot-'+k)||{}).value || '').trim();
  const lista = irProdExclLista().slice();
  lista.push({id:'p'+Date.now().toString(36), usuario, de, ate:'', motivo});
  irSalvarProdExcluidos(lista);
}
/* Volta a contar a partir da data escolhida: fecha o período aberto no dia anterior. */
function irPeVoltaContar(usuario){
  const k = irPeIdx(usuario);
  const desde = (document.getElementById('pe-de-'+k)||{}).value || irPeHoje();
  const lista = irProdExclLista().map(p=>{
    if(p.usuario!==usuario || p.ate) return p;
    if(p.de && p.de>=desde) return null;            // período que nem começou: some
    return {...p, ate: irPeOntem(desde)};
  }).filter(Boolean);
  irSalvarProdExcluidos(lista);
}
function irPeRemover(id){
  if(!confirm('Apagar este período? As contagens dele voltam a contar.')) return;
  irSalvarProdExcluidos(irProdExclLista().filter(p=>p.id!==id));
}
function irPeSetFiltro(campo, v){ IR.peFiltro[campo] = v; irRenderView(); if(campo==='busca'){ const el = document.getElementById('pe-busca'); if(el){ el.focus(); el.setSelectionRange(v.length, v.length); } } }

function irRenderProdPessoasPanel(){
  const so = !!window.LDM_SOMENTE_LEITURA;
  const lista = irProdExclLista();
  const hoje = irPeHoje();
  const contagensPor = new Map();
  for(const c of (IR.contagens||[])){ if(c.usuario && c.idConferencia>=2) contagensPor.set(c.usuario, (contagensPor.get(c.usuario)||0)+1); }
  lista.forEach(p=>{ if(!contagensPor.has(p.usuario)) contagensPor.set(p.usuario, 0); });
  let pessoas = Array.from(contagensPor.entries()).map(([u,n])=>{
    const periodos = lista.filter(p=>p.usuario===u).sort((a,b)=>String(a.de).localeCompare(String(b.de)));
    const aberto = periodos.find(p=> (!p.de || p.de<=hoje) && (!p.ate || p.ate>=hoje));
    return {u, n, periodos, conta: !aberto, aberto};
  }).sort((a,b)=> (a.conta-b.conta) || b.n-a.n);
  const nao = pessoas.filter(p=>!p.conta).length;
  const f = IR.peFiltro;
  pessoas = pessoas.filter(p=> (!f.busca || p.u.toLowerCase().includes(f.busca.toLowerCase())) && (f.ver==='todos' || (f.ver==='contam' ? p.conta : !p.conta)));
  const fb = (v, rot)=>`<button type="button" class="${f.ver===v?'on':''}" onclick="irPeSetFiltro('ver','${v}')">${rot}</button>`;
  const linha = p=>{
    const k = irPeIdx(p.u);
    const hist = p.periodos.length ? `<div class="pe-hist">${p.periodos.map(x=>`<span class="pe-per${x===p.aberto?' atual':''}" title="${irEsc(x.motivo||'')}">${x.de?irPeData(x.de):'início'} – ${x.ate?irPeData(x.ate):'hoje'}${x.motivo?' · '+irEsc(x.motivo):''}${so?'':`<button type="button" onclick="irPeRemover('${x.id}')" title="Apagar período">×</button>`}</span>`).join('')}</div>` : '';
    const acao = so ? '' : (p.conta
      ? `<div class="pe-acao"><input type="date" id="pe-de-${k}" value="${hoje}" title="A partir de"><input type="text" id="pe-mot-${k}" placeholder="Motivo (opcional)"><button type="button" class="btn btn-secondary" onclick="irPeNaoConta(${irEsc(JSON.stringify(p.u))})">Não conta a partir de</button></div>`
      : `<div class="pe-acao"><input type="date" id="pe-de-${k}" value="${hoje}" title="Volta a contar em"><button type="button" class="btn btn-primary" onclick="irPeVoltaContar(${irEsc(JSON.stringify(p.u))})">Volta a contar em</button></div>`);
    return `<div class="pe-l ${p.conta?'':'off'}">
      <div class="pe-n"><b>${irEsc(p.u)}</b><small>${irFmtInt(p.n)} contagens</small></div>
      <span class="pe-st ${p.conta?'ok':'no'}"><i></i>${p.conta?'Conta':'Não conta'}${!p.conta && p.aberto && p.aberto.de ? ' desde '+irPeData(p.aberto.de) : ''}</span>
      ${acao}${hist}
    </div>`;
  };
  return `<div class="panel pe-panel">
    <div class="pe-top"><h3>Quem conta na produtividade</h3><div class="pe-k"><div><b>${irFmtInt(contagensPor.size-nao)}</b>contam</div><div><b class="no">${irFmtInt(nao)}</b>não ${nao===1?'conta':'contam'}</div></div></div>
    <div class="pe-fil"><input type="text" id="pe-busca" placeholder="Buscar colaborador…" value="${irEsc(f.busca)}" oninput="irPeSetFiltro('busca', this.value)"><div class="ca-seg">${fb('todos','Todos')}${fb('contam','Contam')}${fb('nao','Não contam')}</div></div>
    <div class="pe-lista">${pessoas.map(linha).join('') || '<p class="field-hint">Ninguém.</p>'}</div>
  </div>`;
}
