/* ============================================================
   MÚLTIPLOS DESCASADOS — app
   ============================================================
   Controle do item descasado no estoque: o componente que sobrou sem o par e
   por isso não pode virar pedido. A tela responde três coisas, nessa ordem —
   qual a dimensão do problema (peças e R$), onde ele está (pai, componente,
   endereço) e o que bloquear em 86.

   Banco próprio (multiplos_descasados_v1). O módulo não lê nem escreve no banco
   do Inventário: as bases são as mesmas (QRY0390, ZBIQ0051, SIGEQ278), mas o
   recorte guardado aqui é só o dos componentes de múltiplo.
   ============================================================ */
const MD_APP_VERSION = 'v1';
const MD = {
  estrutura:null, saldos:null, precos:null,
  estruturaMeta:null, saldoMeta:null, precoMeta:null,
  base:'qtde',          // 'qtde' = tudo que existe | 'qtdeDisp' = só o disponível
  soDescasados:true,
  busca:'',
  ordem:'valor',
  expandido:null,
  tela:'descasados',
  f051:null, f390:null, f278:null,
  proc:{'051':false,'390':false,'278':false},
  progresso:{'051':{stage:'',pct:0},'390':{stage:'',pct:0},'278':{stage:'',pct:0}},
  initErro:null,
  _cache:null, _cacheBase:null
};

const MD_ZOOM_MIN = 70, MD_ZOOM_MAX = 150, MD_ZOOM_STEP = 10;

function irEsc(v){ if(v===undefined||v===null) return ''; return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function irFmtInt(n){ return Math.round(n||0).toLocaleString('pt-BR'); }
function irFmtMoney(n){ return (n||0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'}); }
function irFmtDate(s){
  if(!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}
function irFmtDataHora(s){
  const d = new Date(s);
  if(isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
}
function irShowToast(msg, isError){
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.className = 'toast'+(isError?' error':'');
  clearTimeout(window.__mdToastTimer);
  window.__mdToastTimer = setTimeout(()=>{ t.className='toast hidden'; }, 2600);
}
function irEmptyState(title, desc, onclickFn, btnLabel){
  return `<div class="empty-state panel"><div class="eicon">🧩</div><h3>${irEsc(title)}</h3><p>${irEsc(desc)}</p>
    ${onclickFn ? `<button class="btn btn-primary" onclick="${onclickFn}">${irEsc(btnLabel)}</button>` : ''}</div>`;
}

/* ---------- Chrome (zoom, tema, menu) ---------- */
function irApplyZoom(pct){
  const v = Math.min(MD_ZOOM_MAX, Math.max(MD_ZOOM_MIN, pct||100));
  document.documentElement.style.setProperty('--zoom', v/100);
  document.documentElement.style.fontSize = (16*v/100)+'px';
  localStorage.setItem('ir-zoom', String(v));
  const el = document.getElementById('zoomLabel');
  if(el) el.textContent = v+'%';
}
function irZoomIn(){ irApplyZoom((parseInt(localStorage.getItem('ir-zoom'),10)||100) + MD_ZOOM_STEP); }
function irZoomOut(){ irApplyZoom((parseInt(localStorage.getItem('ir-zoom'),10)||100) - MD_ZOOM_STEP); }
function irToggleTheme(){
  const atual = document.documentElement.getAttribute('data-theme')==='light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', atual);
  localStorage.setItem('ir-theme', atual);
  irUpdateThemeLabel();
}
function irUpdateThemeLabel(){
  const el = document.getElementById('themeToggleLabel');
  if(el) el.textContent = document.documentElement.getAttribute('data-theme')==='light' ? 'Modo escuro' : 'Modo claro';
}
/* No celular o menu é um overlay (classe mobile-open, largura 0 -> 230px); no
   computador ele encolhe pra faixa de ícones (collapsed). São classes
   diferentes no theme.css — usar a errada deixa o botão do menu sem efeito
   nenhum no celular. */
const MD_MOBILE_QUERY = '(max-width:640px)';
function irToggleSidebar(){
  const sb = document.getElementById('sidebar');
  if(!sb) return;
  if(window.matchMedia(MD_MOBILE_QUERY).matches) sb.classList.toggle('mobile-open');
  else sb.classList.toggle('collapsed');
}
function irCloseSidebarMobile(){
  const sb = document.getElementById('sidebar');
  if(sb && window.matchMedia(MD_MOBILE_QUERY).matches) sb.classList.remove('mobile-open');
}

/* ============================================================
   CÁLCULO
   ============================================================ */
function mdPais(){
  if(MD._cache && MD._cacheBase === MD.base) return MD._cache;
  if(!MD.estrutura || !MD.saldos) return [];
  const saldos = new Map(MD.saldos.map(s=>[s.item, s]));
  const precos = new Map((MD.precos||[]).map(p=>[p.item, p.preco]));
  MD._cache = mdCalcularPais(MD.estrutura, saldos, precos, MD.base);
  MD._cacheBase = MD.base;
  return MD._cache;
}
function mdInvalidarCache(){ MD._cache = null; MD._cacheBase = null; }

function mdPaisFiltrados(){
  const termo = MD.busca.trim().toLowerCase();
  let lista = mdPais();
  if(MD.soDescasados) lista = lista.filter(p=>p.descasado);
  if(termo){
    lista = lista.filter(p=>
      p.pai.includes(termo) ||
      (p.nome||'').toLowerCase().includes(termo) ||
      p.componentes.some(c=>c.componente.includes(termo) || (c.nome||'').toLowerCase().includes(termo))
    );
  }
  const ordens = {
    valor: (a,b)=>b.sobraValor - a.sobraValor || b.sobraPecas - a.sobraPecas,
    pecas: (a,b)=>b.sobraPecas - a.sobraPecas || b.sobraValor - a.sobraValor,
    completos: (a,b)=>a.completos - b.completos || b.sobraValor - a.sobraValor,
    item: (a,b)=>a.pai.localeCompare(b.pai)
  };
  return lista.slice().sort(ordens[MD.ordem] || ordens.valor);
}

/* ============================================================
   TELA — DESCASADOS
   ============================================================ */
function mdTemDados(){ return !!(MD.estrutura && MD.estrutura.length && MD.saldos && MD.saldos.length); }

function mdSetBase(base){ MD.base = base; mdInvalidarCache(); irRenderView(); }
function mdSetOrdem(o){ MD.ordem = o; irRenderView(); }
function mdToggleSoDescasados(){ MD.soDescasados = !MD.soDescasados; irRenderView(); }
function mdBuscar(v){
  MD.busca = v;
  clearTimeout(window.__mdBuscaTimer);
  window.__mdBuscaTimer = setTimeout(()=>{ irRenderView(); document.getElementById('mdBusca')?.focus(); }, 220);
}
function mdToggleLinha(pai){ MD.expandido = MD.expandido===pai ? null : pai; irRenderView(); }

function mdKpis(resumo){
  return `<div class="kpi-grid">
    <div class="kpi-card bad"><div class="num">${irFmtInt(resumo.paisDescasados)}</div><div class="label">Múltiplos descasados</div></div>
    <div class="kpi-card bad"><div class="num">${irFmtInt(resumo.sobraPecas)}</div><div class="label">Peças a bloquear em 86</div></div>
    <div class="kpi-card bad"><div class="num">${irFmtMoney(resumo.sobraValor)}</div><div class="label">Valor descasado</div></div>
    <div class="kpi-card good"><div class="num">${irFmtInt(resumo.completos)}</div><div class="label">Múltiplos completos</div></div>
    <div class="kpi-card orange"><div class="num">${irFmtInt(resumo.paisIncompletos)}</div><div class="label">Sem um componente inteiro</div></div>
  </div>` + mdAvisoPreco(resumo);
}

/* O valor da tela só é o valor de verdade se as peças descasadas tiverem preço.
   Hoje a QRY0390 traz VALOR_UNITARIO zerado na quase totalidade dos componentes
   de múltiplo — sem a SIGEQ278, o total sai muito abaixo do real. Em vez de
   esconder o número atrás de um travessão (que some com os R$ que EXISTEM), a
   tela mostra o total e diz, com número, o quanto dele não pôde ser valorado. */
function mdAvisoPreco(resumo){
  if(!resumo.componentesSemPreco) return '';
  const semBase = !(MD.precos && MD.precos.length);
  return `<div class="panel md-aviso">
    <strong>${irFmtInt(resumo.componentesSemPreco)}</strong> dos ${irFmtInt(resumo.componentesComSobra)} componentes descasados estão sem preço${semBase ? '' : ' mesmo com a SIGEQ278 importada'} —
    o valor acima é o piso, não o total. ${semBase ? 'Importe a SIGEQ278 para valorar pelo preço de custo do item pai.' : ''}
  </div>`;
}

function mdBarraFiltros(){
  const chip = (ativo, onclick, texto)=>`<button class="chip ${ativo?'active':''}" onclick="${onclick}">${irEsc(texto)}</button>`;
  return `<div class="panel">
    <div class="md-filtros">
      <input id="mdBusca" class="md-busca" type="search" placeholder="Buscar item pai, componente ou descrição..."
             value="${irEsc(MD.busca)}" oninput="mdBuscar(this.value)">
      <div class="md-chips">
        ${chip(MD.base==='qtde', "mdSetBase('qtde')", 'Estoque total')}
        ${chip(MD.base==='qtdeDisp', "mdSetBase('qtdeDisp')", 'Só disponível')}
      </div>
      <div class="md-chips">
        ${chip(MD.soDescasados, 'mdToggleSoDescasados()', MD.soDescasados ? 'Só descasados' : 'Todos os múltiplos')}
      </div>
      <div class="md-chips">
        ${chip(MD.ordem==='valor', "mdSetOrdem('valor')", 'Por valor')}
        ${chip(MD.ordem==='pecas', "mdSetOrdem('pecas')", 'Por peças')}
        ${chip(MD.ordem==='completos', "mdSetOrdem('completos')", 'Menos completos')}
      </div>
    </div>
    <p class="field-hint">${irEsc(mdLegendaBase())}</p>
  </div>`;
}
function mdLegendaBase(){
  const b = MD.base==='qtdeDisp'
    ? 'Saldo disponível (QTDE_DISP): desconta o que já está reservado em romaneio.'
    : 'Saldo total (QTDE): tudo que existe no endereço, reservado ou não.';
  return b + ' O pai vem sempre da ZBIQ0051 — item que não está nela não é múltiplo e não aparece aqui.';
}

function mdTabelaPais(){
  const lista = mdPaisFiltrados();
  if(!lista.length){
    return `<div class="panel"><p class="field-hint">Nenhum múltiplo bate com o filtro atual.</p></div>`;
  }
  const linhas = lista.map(p=>{
    const aberto = MD.expandido === p.pai;
    const alerta = p.faltantes > 0
      ? `<span class="md-tag md-tag-bad">${p.faltantes} sem saldo</span>`
      : (p.completos === 0 ? `<span class="md-tag md-tag-bad">0 completos</span>` : '');
    const principal = `<tr class="md-linha ${aberto?'sel':''}" onclick="mdToggleLinha('${irEsc(p.pai)}')">
      <td class="mono md-left">${irEsc(p.pai)}</td>
      <td class="md-left">${irEsc(p.nome || '—')} ${alerta}</td>
      <td class="mono">${irFmtInt(p.nComponentes)}</td>
      <td class="mono">${irFmtInt(p.pecasTotal)}</td>
      <td class="mono ${p.completos?'pos':'neg'}">${irFmtInt(p.completos)}</td>
      <td class="mono neg">${irFmtInt(p.sobraPecas)}</td>
      <td class="mono ${p.sobraValor?'neg':''}">${irFmtMoney(p.sobraValor)}</td>
    </tr>`;
    if(!aberto) return principal;
    return principal + `<tr class="md-detalhe"><td colspan="7">${mdDetalhePai(p)}</td></tr>`;
  }).join('');

  return `<div class="panel">
    <div class="md-head">
      <h3>Múltiplos por item pai</h3>
      <span class="field-hint">${irFmtInt(lista.length)} ${lista.length===1?'múltiplo':'múltiplos'} · clique na linha para ver componentes e endereços</span>
    </div>
    <div class="table-wrap">
      <table class="aud-table">
        <thead><tr>
          <th>Item pai</th><th>Descrição</th><th class="num">Comp.</th><th class="num">Peças</th>
          <th class="num">Completos</th><th class="num">Descasadas</th><th class="num">Valor descasado</th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
  </div>`;
}

function mdDetalhePai(p){
  const comps = p.componentes.map(c=>{
    const locais = (c.locais||[]).slice(0, 6).map(l=>
      `<span class="md-local mono" title="${irEsc((l.desc||l.local)+' · '+(l.restricao||''))}">${irEsc(l.desc || l.local)} <b>${irFmtInt(l.qtde)}</b></span>`
    ).join('');
    const resto = (c.locais||[]).length > 6 ? `<span class="md-local md-local-mais">+${(c.locais.length-6)} endereços</span>` : '';
    return `<tr class="${c.sobra>0?'md-comp-sobra':''}">
      <td class="mono md-left">${irEsc(c.componente)}${c.inInterface==='S' ? ' <span class="md-tag md-tag-info" title="Componente que carrega o valor do múltiplo (in_interface = S)">valor</span>' : ''}</td>
      <td class="md-left">${irEsc(c.nome || (c.semFicha ? 'sem saldo na QRY0390' : '—'))}</td>
      <td class="mono">${irFmtInt(c.qtdePorMultiplo)}</td>
      <td class="mono ${c.saldo?'':'neg'}">${irFmtInt(c.saldo)}</td>
      <td class="mono ${c.sobra>0?'neg':''}">${irFmtInt(c.sobra)}</td>
      <td class="mono">${irFmtMoney(c.valorSobra)}</td>
      <td class="md-left">${locais}${resto}</td>
    </tr>`;
  }).join('');
  return `<div class="md-sub">
    <div class="md-sub-head">
      <strong>${irFmtInt(p.completos)}</strong> múltiplos completos ·
      <strong class="neg">${irFmtInt(p.sobraPecas)}</strong> peças descasadas
      ${p.valorMultiplo ? ' · múltiplo montado a '+irFmtMoney(p.valorMultiplo) : ''}
    </div>
    <div class="table-wrap">
      <table class="ofe-sub">
        <thead><tr>
          <th>Componente</th><th>Descrição</th><th>Por múltiplo</th><th>Saldo</th>
          <th>Descasadas</th><th>Valor</th><th>Onde está</th>
        </tr></thead>
        <tbody>${comps}</tbody>
      </table>
    </div>
  </div>`;
}

function mdRenderDescasados(){
  if(!mdTemDados()){
    const falta = !(MD.estrutura && MD.estrutura.length)
      ? 'Comece pela ZBIQ0051: é ela que diz quais itens são componentes de múltiplo. Depois importe a QRY0390 com o saldo.'
      : 'A estrutura já está aqui. Falta a QRY0390 com o saldo dos componentes.';
    return irEmptyState('Sem bases importadas', falta, "irSwitchTab('importacao')", 'Ir para a importação');
  }
  return mdKpis(mdResumo(mdPais())) + mdBarraFiltros() + mdTabelaPais();
}

/* ============================================================
   TELA — BLOQUEIO EM 86
   ============================================================
   Uma linha por peça a bloquear: é a lista que a operação executa. Ordenada por
   valor, porque é por onde começa quem tem meio turno pra fazer. */
function mdRenderBloqueio(){
  if(!mdTemDados()){
    return irEmptyState('Sem bases importadas', 'Importe a ZBIQ0051 e a QRY0390 para montar a lista de bloqueio.', "irSwitchTab('importacao')", 'Ir para a importação');
  }
  const lista = mdListaBloqueio(mdPais());
  if(!lista.length){
    return `<div class="panel"><h3>Nada a bloquear</h3><p class="field-hint">Todos os múltiplos com estoque estão casados na base ${MD.base==='qtdeDisp'?'disponível':'total'}.</p></div>`;
  }
  const totalPecas = lista.reduce((a,l)=>a+l.bloquear, 0);
  const totalValor = lista.reduce((a,l)=>a+l.valor, 0);
  const linhas = lista.map(l=>{
    const onde = (l.locais||[]).slice(0,3).map(x=>irEsc(x.desc || x.local)).join(' · ');
    return `<tr>
      <td class="mono md-left">${irEsc(l.componente)}</td>
      <td class="md-left">${irEsc(l.nome || '—')}</td>
      <td class="mono md-left">${irEsc(l.pai)}</td>
      <td class="mono">${irFmtInt(l.saldo)}</td>
      <td class="mono">${irFmtInt(l.completos)}</td>
      <td class="mono neg">${irFmtInt(l.bloquear)}</td>
      <td class="mono">${irFmtMoney(l.valor)}</td>
      <td class="md-left">${onde}</td>
    </tr>`;
  }).join('');
  return `<div class="panel">
    <div class="md-head">
      <h3>Bloqueio em 86</h3>
      <button class="btn btn-secondary" onclick="mdExportarBloqueio()">Exportar CSV</button>
    </div>
    <p class="field-hint">${irFmtInt(lista.length)} componentes · ${irFmtInt(totalPecas)} peças · ${irFmtMoney(totalValor)} — base ${MD.base==='qtdeDisp'?'disponível':'total'}.</p>
    <div class="table-wrap">
      <table class="aud-table">
        <thead><tr>
          <th>Componente</th><th>Descrição</th><th>Item pai</th><th class="num">Saldo</th>
          <th class="num">Completos</th><th class="num">Bloquear</th><th class="num">Valor</th><th>Onde está</th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
  </div>`;
}

function mdExportarBloqueio(){
  const lista = mdListaBloqueio(mdPais());
  if(!lista.length){ irShowToast('Não há peça descasada para exportar.'); return; }
  const cab = ['Item pai','Descrição do pai','Componente','Descrição','Carrega valor','Saldo','Por múltiplo','Múltiplos completos','Bloquear em 86','Preço unitário','Valor descasado','Endereços'];
  const cel = v=>{
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  };
  const num = n=>String((n||0).toFixed(2)).replace('.', ',');
  const linhas = lista.map(l=>[
    l.pai, l.nomePai, l.componente, l.nome, l.inInterface==='S' ? 'Sim' : 'Não',
    irFmtInt(l.saldo), irFmtInt(l.qtdePorMultiplo), irFmtInt(l.completos), irFmtInt(l.bloquear),
    num(l.preco), num(l.valor),
    (l.locais||[]).map(x=>(x.desc || x.local)+' ('+irFmtInt(x.qtde)+')').join(' | ')
  ].map(cel).join(';'));
  // BOM na frente: sem ele o Excel em pt-BR abre o arquivo como Latin-1 e come
  // todos os acentos das descrições.
  const csv = '﻿' + [cab.map(cel).join(';'), ...linhas].join('\r\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const hoje = new Date().toISOString().slice(0,10);
  a.href = url; a.download = `bloqueio-86-multiplos-descasados-${hoje}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
  irShowToast(irFmtInt(lista.length)+' linhas exportadas.');
}

/* ============================================================
   TELA — IMPORTAÇÃO
   ============================================================ */
const MD_BASES = [
  {id:'051', icone:'🧩', titulo:'ZBIQ0051', sub:'Estrutura do múltiplo', botao:'Processar estrutura',
   obrigatoria:true, msg:'process051', buf:'buf051'},
  {id:'390', icone:'📦', titulo:'QRY0390', sub:'Saldo por endereço', botao:'Processar saldo',
   obrigatoria:true, msg:'process390', buf:'buf390'},
  {id:'278', icone:'💰', titulo:'SIGEQ278', sub:'Preço de custo (opcional)', botao:'Processar preços',
   obrigatoria:false, msg:'process278', buf:'buf278'}
];
function mdArquivo(id){ return id==='051' ? MD.f051 : id==='390' ? MD.f390 : MD.f278; }
function mdSetArquivo(id, f){
  if(id==='051') MD.f051 = f; else if(id==='390') MD.f390 = f; else MD.f278 = f;
  irRenderView();
}
function mdOnFile(id, f){ if(f) mdSetArquivo(id, f); }
function mdOnDrop(id, e){ e.preventDefault(); const f = e.dataTransfer.files[0]; if(f) mdSetArquivo(id, f); }
function mdRemoveFile(id){ mdSetArquivo(id, null); }

function mdNovoWorker(){ return new Worker('js/worker.js?v=' + MD_APP_VERSION); }
function mdAtualizarProgresso(id){
  const st = document.getElementById('md-'+id+'-stage'), fi = document.getElementById('md-'+id+'-fill');
  const p = MD.progresso[id];
  if(st && fi){ st.textContent = p.stage; fi.style.width = p.pct+'%'; }
}
function mdProcessar(id){
  const base = MD_BASES.find(b=>b.id===id);
  const arq = mdArquivo(id);
  if(MD.proc[id] || !arq) return;
  MD.proc[id] = true;
  MD.progresso[id] = {stage:'Lendo arquivo...', pct:0};
  irRenderView();
  arq.arrayBuffer().then(buf=>{
    const worker = mdNovoWorker();
    worker.onmessage = async ev=>{
      const msg = ev.data;
      if(msg.type === 'progress'){
        MD.progresso[id] = {stage:msg.stage, pct:msg.pct};
        mdAtualizarProgresso(id);
        return;
      }
      if(msg.type === 'erro'){
        MD.proc[id] = false; worker.terminate();
        irShowToast(base.titulo+': '+msg.message, true);
        irRenderView();
        return;
      }
      MD.proc[id] = false; worker.terminate();
      mdSetArquivo(id, null);
      await mdRecarregar();
      if(msg.type === 'done051'){
        irShowToast(irFmtInt(msg.pais)+' múltiplos e '+irFmtInt(msg.componentes)+' componentes na estrutura.');
      } else if(msg.type === 'done390'){
        irShowToast(irFmtInt(msg.itens)+' componentes com saldo'+(msg.semSaldo ? ' · '+irFmtInt(msg.semSaldo)+' sem saldo' : '')+'.');
      } else if(msg.type === 'done278'){
        irShowToast(irFmtInt(msg.pais)+' pais de múltiplo com preço.');
      }
      irRenderView();
    };
    worker.onerror = ()=>{
      worker.terminate(); MD.proc[id] = false;
      irShowToast('Falha ao processar a '+base.titulo+'.', true);
      irRenderView();
    };
    const payload = {type: base.msg};
    payload[base.buf] = buf;
    worker.postMessage(payload, [buf]);
  }).catch(err=>{
    MD.proc[id] = false;
    irShowToast('Erro ao ler a '+base.titulo+': '+err.message, true);
    irRenderView();
  });
}

function mdEstadoBase(id){
  if(id==='051'){
    const m = MD.estruturaMeta;
    return m ? irFmtInt(m.pais)+' múltiplos · '+irFmtInt(m.componentes)+' componentes · '+irFmtDate(m.importadoEm) : 'nunca importada';
  }
  if(id==='390'){
    const m = MD.saldoMeta;
    if(!m) return 'nunca importada';
    const partes = [irFmtInt(m.itens)+' componentes com saldo'];
    if(m.semSaldo) partes.push(irFmtInt(m.semSaldo)+' sem saldo');
    if(m.atualizadoEm) partes.push('estoque de '+irFmtDate(m.atualizadoEm));
    partes.push('lida '+irFmtDataHora(m.importadoEm));
    return partes.join(' · ');
  }
  const m = MD.precoMeta;
  return m ? irFmtInt(m.pais)+' pais com preço · '+irFmtDate(m.importadoEm) : 'nunca importada';
}

function mdRenderImportacao(){
  const temEstrutura = !!(MD.estrutura && MD.estrutura.length);
  const cartao = b=>{
    const arq = mdArquivo(b.id), rodando = MD.proc[b.id], prog = MD.progresso[b.id];
    const inputId = 'md-file-'+b.id;
    return `<div class="av-card ${arq?'has-file':''}" ondrop="mdOnDrop('${b.id}', event)" ondragover="event.preventDefault()">
      <div class="av-top">
        <span class="av-icone">${b.icone}</span>
        <div class="av-nome"><strong>${irEsc(b.titulo)}</strong><span>${irEsc(b.sub)}</span></div>
      </div>
      <div class="av-estado">${irEsc(mdEstadoBase(b.id))}</div>
      <input type="file" id="${inputId}" accept=".xlsx,.xls" style="display:none" onchange="mdOnFile('${b.id}', this.files[0])">
      ${rodando ? `
        <div class="progress-wrap av-prog">
          <div class="progress-stage" id="md-${b.id}-stage">${irEsc(prog.stage)}</div>
          <div class="progress-track"><div class="progress-fill orange" id="md-${b.id}-fill" style="width:${prog.pct}%"></div></div>
        </div>`
      : arq ? `
        <div class="av-arquivo mono">${irEsc(arq.name)}</div>
        <div class="av-acoes">
          <button class="btn btn-primary" onclick="mdProcessar('${b.id}')">${irEsc(b.botao)}</button>
          <button class="btn-link" onclick="mdRemoveFile('${b.id}')">Remover</button>
        </div>`
      : `<div class="av-acoes"><button class="btn btn-secondary" onclick="document.getElementById('${inputId}').click()">Selecionar</button></div>`}
      ${b.id!=='051' && !temEstrutura ? `<p class="av-aviso">Importe a ZBIQ0051 antes: é ela que define quem é múltiplo.</p>` : ''}
    </div>`;
  };
  return `<div class="panel">
    <div class="ofe-head"><h3>Bases do módulo</h3></div>
    <p class="field-hint" style="margin-bottom:12px;">
      A ZBIQ0051 vem primeiro e define o universo: item que não está nela não é múltiplo.
      A QRY0390 traz o saldo, e só dos componentes dessa estrutura é guardado algo.
      A SIGEQ278 é opcional e serve para valorar — hoje a 390 vem com VALOR_UNITARIO zerado nos componentes,
      e o preço do conjunto está no item pai, que não tem estoque próprio.
    </p>
    <div class="av-grid">${MD_BASES.map(cartao).join('')}</div>
  </div>`;
}

/* ============================================================
   SHELL
   ============================================================ */
const MD_TELAS = {
  descasados:['Múltiplos Descasados','Componente sem par no estoque: dimensão, onde está e quanto vale.'],
  bloqueio:['Bloqueio em 86','Peça a peça, o que precisa sair de disponível.'],
  importacao:['Importação','ZBIQ0051, QRY0390 e SIGEQ278 — as bases do módulo.']
};
function irRenderView(){
  const raiz = document.getElementById('viewRoot');
  if(!raiz) return;
  if(MD.initErro){
    raiz.innerHTML = irEmptyState('Não consegui abrir o banco do navegador', MD.initErro, null, null);
    return;
  }
  raiz.innerHTML = MD.tela==='importacao' ? mdRenderImportacao()
                 : MD.tela==='bloqueio'   ? mdRenderBloqueio()
                 : mdRenderDescasados();
}
function irSwitchTab(tela){
  MD.tela = MD_TELAS[tela] ? tela : 'descasados';
  document.querySelectorAll('.nav-item[data-tab]').forEach(b=>b.classList.toggle('active', b.dataset.tab===MD.tela));
  const [titulo, sub] = MD_TELAS[MD.tela];
  const t = document.getElementById('tabTitle'), s = document.getElementById('tabSubtitle');
  if(t) t.textContent = titulo;
  if(s) s.textContent = sub;
  irCloseSidebarMobile();
  irRenderView();
}
async function mdRecarregar(){
  MD.estrutura = await mdGetEstrutura();
  MD.saldos = await mdGetSaldo();
  MD.precos = await mdGetPrecos();
  MD.estruturaMeta = await mdGetEstruturaMeta();
  MD.saldoMeta = await mdGetSaldoMeta();
  MD.precoMeta = await mdGetPrecoMeta();
  mdInvalidarCache();
}
async function irInit(){
  const temaSalvo = localStorage.getItem('ir-theme');
  if(temaSalvo) document.documentElement.setAttribute('data-theme', temaSalvo);
  const temaApp = localStorage.getItem('ir-app-theme');
  if(temaApp && temaApp!=='padrao') document.documentElement.setAttribute('data-app-theme', temaApp);
  irUpdateThemeLabel();
  irApplyZoom(parseInt(localStorage.getItem('ir-zoom'), 10) || 100);
  const versao = document.getElementById('sidebarVersao');
  if(versao) versao.textContent = MD_APP_VERSION;
  try{
    await mdRecarregar();
  }catch(e){
    console.error('Falha ao iniciar', e);
    MD.initErro = (e && (e.name ? e.name+': '+e.message : e.message)) || String(e);
  }
  irRenderView();
}
