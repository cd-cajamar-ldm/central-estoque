/* ============================================================
   Auditoria de Divergências de Inventário — UI principal
   Módulo independente: importação, motor de regras, diagnóstico,
   dashboards, tela de auditoria, configurações e relatórios.
   Toda a persistência é local (IndexedDB) — sem servidor, sem API.

   Esta camada é só apresentação: nenhuma função aqui recalcula ou
   reinterpreta o diagnóstico/NET — tudo isso vem pronto do worker
   (audit-worker.js). As agregações por item/endereço/inventário
   feitas aqui (Top10, Matriz de Ofensores, painéis) são apenas
   reagrupamentos de exibição sobre os dados já processados.
   ============================================================ */

const AUD = {
  files: {f0114:null, f390:null, f845:null},
  processing:false,
  progress:{stage:'', pct:0},
  worker:null,
  netConfig:[],
  anos:[],
  currentAno:2026,
  indicadores:null,
  importMeta:null,
  kpiPrev:null,
  list:[],
  itemFilters:{search:'', local:'', inventario:'', diagnostico:'', prioridade:'', dia:''},
  validarTopN:15,
  itemSort:{key:'valorAbs', dir:'desc'},
  itemExpanded: new Set(),
  printScope:'pendentes'
};

function audFmtInt(n){ return Math.round(n||0).toLocaleString('pt-BR'); }
function audFmtNum(n, dec){ return (n||0).toLocaleString('pt-BR', {minimumFractionDigits:dec||0, maximumFractionDigits:dec||2}); }
function audFmtMoney(n){ return (n||0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'}); }
function audToday(){ return new Date().toISOString().slice(0,10); }

/* ============================================================
   INIT
   ============================================================ */
async function audModuleInit(){
  try{
    AUD.netConfig = await audSeedNetConfigIfEmpty();
    await audLoadAnosDisponiveis();
    if(AUD.anos.length){
      AUD.currentAno = AUD.anos[0];
      await audLoadMetaAndIndicadores(AUD.currentAno);
      await audLoadLista();
    }
  }catch(e){ console.error('Falha ao iniciar módulo de auditoria', e); }
}

async function audLoadAnosDisponiveis(){
  const metas = await audGetAllImportMeta();
  AUD.anos = metas.map(m=>m.ano).sort((a,b)=>b-a);
}
async function audLoadMetaAndIndicadores(ano){
  AUD.importMeta = await audGetImportMeta(ano);
  AUD.indicadores = await audGetIndicadores(ano);
  const hoje = audToday();
  const prevSnap = await audGetPreviousKpiSnapshot(ano, hoje);
  AUD.kpiPrev = prevSnap ? prevSnap.kpis : null;
}
async function audLoadLista(){
  AUD.list = await audGetDivergenciasByAno(AUD.currentAno);
}

/* ============================================================
   DISPATCH — chamado pelo renderView() do app principal
   ============================================================ */
function audRenderTab(tab){
  const needsData = tab!=='aud-import' && tab!=='aud-config';
  if(needsData && !AUD.indicadores){
    return audWrap(emptyState('Nenhuma auditoria processada ainda', 'Importe as três planilhas em Importação e clique em PROCESSAR AUDITORIA.', "switchTab('aud-import')", 'Ir para Importação'));
  }
  if(tab==='aud-import') return audWrap(audRenderImport());
  if(tab==='aud-home') return audWrap(audRenderHome());
  if(tab==='aud-audit') return audWrap(audRenderAuditoria());
  if(tab==='aud-offenders') return audWrap(audRenderOfensores());
  if(tab==='aud-enderecos') return audWrap(audRenderEnderecos());
  if(tab==='aud-inventarios') return audWrap(audRenderInventarios());
  if(tab==='aud-financeiro') return audWrap(audRenderFinanceiro());
  if(tab==='aud-config') return audWrap(audRenderConfig());
  if(tab==='aud-reports') return audWrap(audRenderRelatorios());
  return '';
}
function audOnRender(tab){
  if(tab==='aud-audit') audMountAuditoriaScroll();
  if(tab==='aud-reports') audFillHistory();
}

/* ============================================================
   HEADER COMPACTO — presente em todas as telas do módulo
   ============================================================ */
function audWrap(inner){
  return `<div class="aud-shell">${audRenderHeaderBar()}${inner}<div id="aud-print-sheet"></div></div>`;
}
function audRenderHeaderBar(){
  const m = AUD.importMeta;
  const dt = m ? new Date(m.processedAt) : null;
  const statusChip = (ok)=>`<span class="aud-hb-status ${ok?'ok':'pend'}">${ok?'OK':'Pendente'}</span>`;
  return `<div class="aud-headerbar">
    <a href="../" class="aud-hb-back" title="Voltar para a Central">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
      <span>Central</span>
    </a>
    <img class="aud-hb-logo" src="brand/Logo_LDM_hor_2.png" alt="Loja do Mecânico">
    <div class="aud-hb-sep"></div>
    <div class="aud-hb-group">Atualizado em <b>${dt?dt.toLocaleDateString('pt-BR'):'—'}</b></div>
    <div class="aud-hb-group">às <b>${dt?dt.toLocaleTimeString('pt-BR'):'—'}</b></div>
    <div class="aud-hb-sep"></div>
    <div class="aud-hb-group">QUERY 0114 ${statusChip(!!m)}</div>
    <div class="aud-hb-group">QUERY 390 ${statusChip(!!m)}</div>
    <div class="aud-hb-group">QUERY 845 ${statusChip(!!m)}</div>
    <div class="aud-hb-sep"></div>
    <div class="aud-hb-group">Registros importados <b class="mono">${m?audFmtInt(m.totalLinhas):'0'}</b></div>
    ${audAnoSelectorInline()}
    <button class="btn btn-primary" onclick="switchTab('aud-import')">Atualizar Auditoria</button>
  </div>`;
}
function audAnoSelectorInline(){
  if(AUD.anos.length<=1) return '';
  return `<select onchange="audChangeAno(this.value)" style="font-size:11px;border:1px solid var(--line);border-radius:4px;background:var(--paper);color:var(--ink);padding:3px 6px;">
    ${AUD.anos.map(a=>`<option value="${a}" ${a===AUD.currentAno?'selected':''}>${a}</option>`).join('')}
  </select>`;
}
async function audChangeAno(ano){
  AUD.currentAno = parseInt(ano,10);
  await audLoadMetaAndIndicadores(AUD.currentAno);
  await audLoadLista();
  renderView();
}
function audAnoSelector(){ return ''; }

/* ============================================================
   REGRA DE NEGÓCIO: "Considerar NET" = Não → ignorar completamente
   esse registro em KPIs, rankings, auditoria, exportação e painéis.
   O worker (audit-worker.js) já calcula r.considerarNet por linha;
   aqui só decidimos QUAIS linhas entram nas agregações de exibição —
   nenhum cálculo/diagnóstico é refeito ou alterado.
   ============================================================ */
function audNetFilteredList(){
  return AUD.list.filter(r=>r.considerarNet);
}

/* ============================================================
   AGREGAÇÕES DE APRESENTAÇÃO (não recalculam diagnóstico/NET)
   ============================================================ */
const AUD_PRIORIDADE_RANK = {alta:3, media:2, baixa:1};
function audAggregateBy(rows, keyFn){
  const map = new Map();
  for(const r of rows){
    const key = keyFn(r);
    if(!key) continue;
    let g = map.get(key);
    if(!g) g = {chave:key, valor:0, valorAbs:0, qtd:0, qtdAbs:0, ocorrencias:0, inventarios:new Set(), enderecos:new Set(), itens:new Set(), compensadas:0, pendentes:0, ultimaData:'', enderecoCounts:new Map(), diagCounts:new Map(), prioridadeMax:'baixa', ean:'', descricao:''};
    g.valor += r.vlDivergencia; g.valorAbs += Math.abs(r.vlDivergencia);
    g.qtd += r.diferenca; g.qtdAbs += Math.abs(r.diferenca);
    g.ocorrencias++;
    g.inventarios.add(r.inventario); g.enderecos.add(r.endereco); g.itens.add(r.itemWms);
    if(r.diagnostico==='compensacao_historica' || r.diagnostico==='compensacao_parcial') g.compensadas++;
    if(r.necessitaValidacao) g.pendentes++;
    if(r.dataFim && r.dataFim > g.ultimaData) g.ultimaData = r.dataFim;
    if(r.endereco) g.enderecoCounts.set(r.endereco, (g.enderecoCounts.get(r.endereco)||0)+1);
    if(r.diagnostico) g.diagCounts.set(r.diagnostico, (g.diagCounts.get(r.diagnostico)||0)+1);
    if((AUD_PRIORIDADE_RANK[r.prioridade]||0) > (AUD_PRIORIDADE_RANK[g.prioridadeMax]||0)) g.prioridadeMax = r.prioridade;
    if(!g.ean && r.ean) g.ean = r.ean;
    if(!g.descricao && r.descricao) g.descricao = r.descricao;
    map.set(key, g);
  }
  return Array.from(map.values()).map(g=>{
    let localPrincipal = '', maxCount = 0;
    for(const [end,cnt] of g.enderecoCounts) if(cnt>maxCount){ maxCount=cnt; localPrincipal=end; }
    let diagPredominante = '', maxDiag = 0;
    for(const [d,cnt] of g.diagCounts) if(cnt>maxDiag){ maxDiag=cnt; diagPredominante=d; }
    return {
      ...g,
      numInventarios: g.inventarios.size, numEnderecos: g.enderecos.size, numItens: g.itens.size,
      pctCompensado: g.ocorrencias ? (g.compensadas/g.ocorrencias*100) : 0,
      localPrincipal, diagnosticoPredominante: diagPredominante
    };
  });
}
function audAggItens(){ return audAggregateBy(audNetFilteredList(), r=>r.itemWms); }
function audAggEnderecos(){ return audAggregateBy(audNetFilteredList(), r=>r.endereco); }
function audAggInventarios(){ return audAggregateBy(audNetFilteredList(), r=>r.inventario); }

/* ============================================================
   IMPORTAÇÃO
   ============================================================ */
function audRenderImport(){
  const f = AUD.files;
  const dz = (key, label, desc, icon)=>`
    <div class="aud-dropzone ${f[key]?'has-file':''}">
      <input type="file" id="aud-file-${key}" accept=".xlsx,.xls" style="display:none" onchange="audOnFile('${key}', this.files[0])">
      <div class="aud-dz-icon">${icon}</div>
      <div class="aud-dz-title">${label}</div>
      <div class="aud-dz-desc">${desc}</div>
      ${f[key]
        ? `<div class="aud-dz-file mono">${esc(f[key].name)}<br>${(f[key].size/1024/1024).toFixed(2)} MB</div>
           <button class="btn-link" onclick="audRemoveFile('${key}')">Remover</button>`
        : `<button class="btn btn-secondary" onclick="document.getElementById('aud-file-${key}').click()">Selecionar arquivo</button>`}
    </div>`;

  const allSelected = f.f0114 && f.f390 && f.f845;

  return `
    <div class="panel">
      <h3>Importar planilhas do inventário</h3>
      <p class="field-hint" style="margin-bottom:14px;">Selecione as três planilhas exportadas do WMS (formato .xlsx). O processamento roda inteiramente no navegador — nenhum arquivo é enviado para servidor.</p>
      <div class="aud-dz-grid">
        ${dz('f0114','QUERY 0114','Divergências de inventário (base principal)','&#128203;')}
        ${dz('f390','QUERY 390','Estoque por local (posição atual)','&#128230;')}
        ${dz('f845','QUERY 845','Detalhe / observação do inventário','&#128269;')}
      </div>
      ${AUD.processing ? `
        <div class="aud-progress-wrap">
          <div class="aud-progress-stage">${esc(AUD.progress.stage)}</div>
          <div class="aud-progress-track"><div class="aud-progress-fill" style="width:${AUD.progress.pct}%"></div></div>
          <div class="aud-progress-pct mono">${AUD.progress.pct}%</div>
        </div>`
        : allSelected
          ? `<div class="action-bar" style="margin-top:16px;"><button class="btn btn-primary" style="font-size:14px;padding:10px 26px;" onclick="audProcessar()">PROCESSAR AUDITORIA</button></div>`
          : `<p class="field-hint" style="margin-top:14px;">Selecione os três arquivos para habilitar o processamento.</p>`
      }
    </div>
    ${AUD.importMeta ? audRenderUltimoProcessamento() : emptyState('Nenhuma auditoria processada ainda', 'Importe as três planilhas acima e clique em PROCESSAR AUDITORIA para gerar a lista priorizada de divergências.', 'document.getElementById(\'aud-file-f0114\').click()', 'Começar importação')}
  `;
}

function audRenderUltimoProcessamento(){
  const m = AUD.importMeta;
  return `<div class="panel">
    <h3>Último processamento — Ano ${AUD.currentAno}</h3>
    <div class="stat-grid">
      <div class="stat-card"><div class="num mono">${audFmtInt(m.totalLinhas)}</div><div class="label">Divergências tratadas</div></div>
      <div class="stat-card accent"><div class="num mono">${audFmtInt(m.necessitaValidacao)}</div><div class="label">Necessitam validação</div></div>
      <div class="stat-card"><div class="num mono">${audFmtInt(m.duplicidadesRemovidas)}</div><div class="label">Duplicidades removidas</div></div>
    </div>
    <p class="field-hint">Processado em ${new Date(m.processedAt).toLocaleString('pt-BR')}. <a href="#" onclick="switchTab('aud-home');return false;">Ir para a visão geral &rarr;</a></p>
  </div>`;
}

function audOnFile(key, file){
  if(!file) return;
  AUD.files[key] = file;
  renderView();
}
function audRemoveFile(key){
  AUD.files[key] = null;
  renderView();
}

async function audProcessar(){
  if(AUD.processing) return;
  if(!(AUD.files.f0114 && AUD.files.f390 && AUD.files.f845)) return;
  AUD.processing = true;
  AUD.progress = {stage:'Lendo arquivos...', pct:0};
  renderView();
  try{
    const [buf0114, buf390, buf845] = await Promise.all([
      AUD.files.f0114.arrayBuffer(), AUD.files.f390.arrayBuffer(), AUD.files.f845.arrayBuffer()
    ]);
    const worker = new Worker('audit/audit-worker.js');
    AUD.worker = worker;
    worker.onmessage = async (e)=>{
      const msg = e.data;
      if(msg.type==='progress'){
        AUD.progress = {stage: msg.stage, pct: msg.pct};
        audUpdateProgressUI();
      } else if(msg.type==='error'){
        AUD.processing = false;
        worker.terminate();
        showToast('Erro no processamento: '+msg.message, true);
        renderView();
      } else if(msg.type==='done'){
        AUD.processing = false;
        if(window.LDM_NUVEM) LDM_NUVEM.marcar();
        worker.terminate();
        AUD.files = {f0114:null, f390:null, f845:null};
        await audLoadAnosDisponiveis();
        if(msg.anos && msg.anos.length) AUD.currentAno = msg.anos[msg.anos.length-1];
        AUD.netConfig = await audGetNetConfig();
        await audLoadMetaAndIndicadores(AUD.currentAno);
        await audLoadLista();
        await audSaveKpiSnapshot(AUD.currentAno, audToday(), audBuildKpiSnapshot());
        showToast('✓ Auditoria processada: '+audFmtInt(msg.total)+' divergências, '+audFmtInt(msg.necessitaValidacao)+' precisam de validação.');
        if(msg.codigosNovos && msg.codigosNovos.length){
          setTimeout(()=>showToast('Atenção: '+msg.codigosNovos.length+' código(s) de legenda novo(s) — revise em Configurações NET.', true), 2600);
        }
        switchTab('aud-home');
      }
    };
    worker.onerror = (err)=>{
      AUD.processing = false;
      showToast('Erro no worker de processamento: '+err.message, true);
      renderView();
    };
    worker.postMessage({type:'process', buf0114, buf390, buf845, netConfig: AUD.netConfig}, [buf0114, buf390, buf845]);
  }catch(err){
    AUD.processing = false;
    showToast('Erro ao ler arquivos: '+err.message, true);
    renderView();
  }
}
function audUpdateProgressUI(){
  const stageEl = document.querySelector('.aud-progress-stage');
  const fillEl = document.querySelector('.aud-progress-fill');
  const pctEl = document.querySelector('.aud-progress-pct');
  if(stageEl && fillEl && pctEl){
    stageEl.textContent = AUD.progress.stage;
    fillEl.style.width = AUD.progress.pct+'%';
    pctEl.textContent = AUD.progress.pct+'%';
  } else renderView();
}

/* ============================================================
   KPI SNAPSHOT (para comparação dia-a-dia)
   ============================================================ */
function audBuildKpiSnapshot(){
  const ind = AUD.indicadores || {};
  const net = audNetFilteredList();
  const qtdDivergenteNet = net.reduce((s,r)=>s+r.diferenca,0);
  const valorDivergenteNet = net.reduce((s,r)=>s+r.vlDivergencia,0);
  const qtdAbsolutaNet = net.reduce((s,r)=>s+Math.abs(r.diferenca),0);
  const valorAbsolutoNet = net.reduce((s,r)=>s+Math.abs(r.vlDivergencia),0);
  const itensUnicosNet = new Set(net.map(r=>r.itemWms)).size;
  const necessitaValidacaoNet = net.filter(r=>r.necessitaValidacao).length;
  return {
    divergenciasImportadas: ind.totalImportadas||0,
    considerNetSim: ind.considerNetSim||0,
    considerNetNao: ind.considerNetNao||0,
    netQuantidade: qtdDivergenteNet, netValor: valorDivergenteNet,
    qtdAbsoluta: qtdAbsolutaNet, valorAbsoluto: valorAbsolutoNet,
    itensUnicos: itensUnicosNet,
    necessitaValidacao: necessitaValidacaoNet
  };
}
function audKpiDelta(atual, campo){
  if(!AUD.kpiPrev || AUD.kpiPrev[campo]===undefined) return '';
  const antes = AUD.kpiPrev[campo];
  if(antes===0 && atual===0) return '<span class="delta flat">= ontem</span>';
  const diff = atual-antes;
  const pct = antes!==0 ? (diff/Math.abs(antes)*100) : 100;
  const cls = diff>0?'up':(diff<0?'down':'flat');
  const seta = diff>0?'▲':(diff<0?'▼':'=');
  return `<span class="delta ${cls}">${seta} ${audFmtNum(Math.abs(pct),1)}% vs ontem</span>`;
}

/* ============================================================
   DASHBOARD (home) — 9 KPIs estratégicos + 3 tabelas resumidas
   Sem gráficos, sem excesso de indicadores.
   ============================================================ */
function audRenderHome(){
  return `
    ${audRenderKpiRow()}
    ${audRenderNetExplicacao()}
    ${audRenderResumoTables()}
  `;
}

function audRenderNetExplicacao(){
  const itens = audAggItens();
  if(!itens.length) return '';
  const negativos = itens.filter(i=>i.valor<0).sort((a,b)=>a.valor-b.valor);
  const positivos = itens.filter(i=>i.valor>0).sort((a,b)=>b.valor-a.valor);
  const somaNeg = negativos.reduce((s,i)=>s+i.valor,0);
  const somaPos = positivos.reduce((s,i)=>s+i.valor,0);
  const netTotal = somaNeg + somaPos;
  const maior = negativos[0];
  const linha = (list)=>list.slice(0,5).map(i=>`<div class="aud-rank-item">
    <span class="aud-rank-key">${esc(i.chave)} — ${esc(i.descricao||'')}</span>
    <span class="aud-rank-val mono ${i.valor>=0?'aud-pos':'aud-neg'}">${audFmtMoney(i.valor)}</span>
  </div>`).join('') || '<div class="field-hint">Sem registros</div>';
  return `<div class="panel" style="border-left:4px solid ${netTotal<0?'#C83812':'#1F8A52'};">
    <h3>Por que o NET está ${netTotal<0?'negativo':'positivo'}?</h3>
    <p class="field-hint" style="margin-bottom:10px;">
      ${maior ? `O item que mais puxa o NET para baixo é <b>${esc(maior.chave)} — ${esc(maior.descricao||'')}</b>, com ${audFmtMoney(maior.valor)} acumulado em ${maior.ocorrencias} divergência(s) no local <b>${esc(maior.localPrincipal||'—')}</b>.` : 'Nenhum item com saldo negativo no período.'}
      Perdas somam ${audFmtMoney(somaNeg)} e ganhos somam ${audFmtMoney(somaPos)} — saldo líquido ${audFmtMoney(netTotal)}.
    </p>
    <div class="two-col">
      <div>
        <h4 style="font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-soft);margin-bottom:6px;">Maiores perdas (puxam o NET para baixo)</h4>
        <div class="aud-rank-list">${linha(negativos)}</div>
      </div>
      <div>
        <h4 style="font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-soft);margin-bottom:6px;">Maiores ganhos (compensam o NET)</h4>
        <div class="aud-rank-list">${linha(positivos)}</div>
      </div>
    </div>
    <div class="form-actions" style="margin-top:10px;"><button class="btn btn-secondary" onclick="switchTab('aud-audit')">Ir para Auditoria e tratar</button></div>
  </div>`;
}

function audRenderKpiRow(){
  const k = audBuildKpiSnapshot();
  const kpis = [
    ['divergenciasImportadas','Divergências Importadas', audFmtInt(k.divergenciasImportadas), ''],
    ['considerNetSim','Consideradas no NET', audFmtInt(k.considerNetSim), ''],
    ['considerNetNao','Desconsideradas', audFmtInt(k.considerNetNao), ''],
    ['netQuantidade','NET Quantidade', audFmtInt(k.netQuantidade), 'orange'],
    ['netValor','NET Valor', audFmtMoney(k.netValor), 'orange'],
    ['qtdAbsoluta','Quantidade Absoluta', audFmtInt(k.qtdAbsoluta), ''],
    ['valorAbsoluto','Valor Absoluto', audFmtMoney(k.valorAbsoluto), ''],
    ['itensUnicos','Itens Únicos', audFmtInt(k.itensUnicos), ''],
    ['necessitaValidacao','Necessitam Validação', audFmtInt(k.necessitaValidacao), 'orange']
  ];
  return `<div class="aud-kpi-grid">
    ${kpis.map(([campo,label,val,cls])=>`<div class="aud-kpi ${cls}">
      <div class="num mono">${val}</div>
      <div class="label">${label}</div>
      ${audKpiDelta(k[campo], campo)}
    </div>`).join('')}
  </div>`;
}

function audRenderResumoTables(){
  const itens = audAggItens().sort((a,b)=>b.valorAbs-a.valorAbs).slice(0,20);
  const enderecos = audAggEnderecos().sort((a,b)=>b.valorAbs-a.valorAbs).slice(0,20);
  const invs = audAggInventarios().sort((a,b)=>b.valorAbs-a.valorAbs).slice(0,20);
  return `<div class="two-col">
    <div class="panel">
      <h3>Top 20 Itens Ofensores</h3>
      <div class="table-wrap"><table><thead><tr><th>Item</th><th>Descrição</th><th>Qtde Acumulada</th><th>Valor Acumulado</th></tr></thead>
      <tbody>${itens.map(i=>`<tr><td class="mono">${esc(i.chave)}</td><td>${esc(i.descricao||'—')}</td><td class="mono">${audFmtInt(i.qtd)}</td><td class="mono ${i.valor>=0?'aud-pos':'aud-neg'}">${audFmtMoney(i.valor)}</td></tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--ink-soft);">Sem registros</td></tr>'}</tbody></table></div>
    </div>
    <div class="panel">
      <h3>Top 20 Endereços</h3>
      <div class="table-wrap"><table><thead><tr><th>Endereço</th><th>Qtde Divergente</th><th>Valor Divergente</th><th>Nº Itens</th></tr></thead>
      <tbody>${enderecos.map(e=>`<tr><td>${esc(e.chave)}</td><td class="mono">${audFmtInt(e.qtd)}</td><td class="mono ${e.valor>=0?'aud-pos':'aud-neg'}">${audFmtMoney(e.valor)}</td><td class="mono">${e.numItens}</td></tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--ink-soft);">Sem registros</td></tr>'}</tbody></table></div>
    </div>
  </div>
  <div class="panel">
    <h3>Top Inventários</h3>
    <div class="table-wrap"><table><thead><tr><th>Inventário</th><th>Qtde Divergente</th><th>Valor Divergente</th></tr></thead>
    <tbody>${invs.map(i=>`<tr><td>${esc(i.chave)}</td><td class="mono">${audFmtInt(i.qtd)}</td><td class="mono ${i.valor>=0?'aud-pos':'aud-neg'}">${audFmtMoney(i.valor)}</td></tr>`).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--ink-soft);">Sem registros</td></tr>'}</tbody></table></div>
  </div>`;
}

/* ============================================================
   AUDITORIA — tabela única consolidada por item (sem cards)
   ============================================================ */
const AUD_ITEM_ROW_H = 32;
function audAuditoriaOccurrences(){
  const f = AUD.itemFilters;
  const search = f.search.trim().toLowerCase();
  return audNetFilteredList().filter(r=>{
    if(f.local && r.endereco!==f.local) return false;
    if(f.inventario && r.inventario!==f.inventario) return false;
    if(f.diagnostico && r.diagnostico!==f.diagnostico) return false;
    if(f.prioridade && r.prioridade!==f.prioridade) return false;
    if(f.dia && r.dataFim!==f.dia) return false;
    if(search){
      const hay = (r.itemWms+' '+r.ean+' '+r.descricao).toLowerCase();
      if(!hay.includes(search)) return false;
    }
    return true;
  });
}
function audAuditoriaItens(){
  const rows = audAggregateBy(audAuditoriaOccurrences(), r=>r.itemWms);
  const {key, dir} = AUD.itemSort;
  rows.sort((a,b)=>{
    let av=a[key], bv=b[key];
    if(typeof av==='string') av=av.toLowerCase(); if(typeof bv==='string') bv=bv.toLowerCase();
    if(av<bv) return dir==='asc'?-1:1;
    if(av>bv) return dir==='asc'?1:-1;
    return 0;
  });
  return rows;
}
function audRenderAuditoria(){
  if(!AUD.list.length){
    return emptyState('Nenhuma divergência carregada', 'Processe uma auditoria na aba Importação para ver a tabela consolidada aqui.', "switchTab('aud-import')", 'Ir para Importação');
  }
  const uniq = (field)=>Array.from(new Set(audNetFilteredList().map(r=>r[field]).filter(Boolean))).sort();
  const locais = uniq('endereco'), invs = uniq('inventario');
  const f = AUD.itemFilters;
  const diagOpts = Object.entries(AUD_DIAG).map(([k,v])=>`<option value="${k}" ${f.diagnostico===k?'selected':''}>${v.label}</option>`).join('');
  const cols = [
    ['chave','Item',90], ['ean','EAN',110], ['descricao','Descrição',240], ['localPrincipal','Local',110],
    ['qtd','Qtd',80], ['valorAbs','Valor',110], ['ocorrencias','Nº Div.',70], ['numInventarios','Invent.',70],
    ['diagnosticoPredominante','Diagnóstico',140], ['prioridadeMax','Prioridade',90]
  ];
  return `
    <div class="aud-toolbar">
      <div class="aud-search-wrap">
        <input type="text" id="aud-item-search" placeholder="Buscar por item, EAN ou descrição..." value="${esc(f.search)}" oninput="audItemOnSearch(this.value)">
      </div>
      <div class="aud-toolbar-actions">
        <select onchange="audItemSetFilter('local', this.value)">
          <option value="">Todos os locais</option>${locais.map(l=>`<option value="${esc(l)}" ${f.local===l?'selected':''}>${esc(l)}</option>`).join('')}
        </select>
        <select onchange="audItemSetFilter('inventario', this.value)">
          <option value="">Todos os inventários</option>${invs.map(i=>`<option value="${esc(i)}" ${f.inventario===i?'selected':''}>${esc(i)}</option>`).join('')}
        </select>
        <select onchange="audItemSetFilter('diagnostico', this.value)">
          <option value="">Todos os diagnósticos</option>${diagOpts}
        </select>
        <select onchange="audItemSetFilter('prioridade', this.value)">
          <option value="">Todas as prioridades</option>
          <option value="alta" ${f.prioridade==='alta'?'selected':''}>Alta</option>
          <option value="media" ${f.prioridade==='media'?'selected':''}>Média</option>
          <option value="baixa" ${f.prioridade==='baixa'?'selected':''}>Baixa</option>
        </select>
        <input type="date" value="${esc(f.dia)}" onchange="audItemSetFilter('dia', this.value)" title="Filtrar por dia">
        <button class="btn btn-secondary" onclick="audItemClearFilters()">Limpar</button>
        <button class="btn btn-secondary" onclick="audExportItensCsv()">Exportar (Item/EAN/Descrição/Local/Qtd)</button>
      </div>
    </div>
    <div class="aud-toolbar" style="background:rgba(254,80,0,.06);border:1px solid rgba(254,80,0,.25);border-radius:8px;padding:10px 14px;">
      <div class="aud-hb-group"><b>Validar hoje os</b>
        <input type="number" min="1" max="500" value="${AUD.validarTopN}" style="width:60px;" onchange="audSetValidarTopN(this.value)">
        <b>itens mais divergentes</b> (por valor)
      </div>
      <div class="aud-toolbar-actions">
        <button class="btn btn-primary" onclick="audPrintTopItens()">🖨️ Imprimir esses itens agora</button>
      </div>
    </div>
    <div class="aud-result-count" id="aud-item-count">${audFmtInt(audAuditoriaItens().length)} itens consolidados</div>
    <div class="aud-optable-wrap">
      <div class="aud-optable-scroll" id="aud-item-scroll" style="height:calc(100vh - 260px);">
        <table class="aud-optable">
          <thead><tr>${cols.map(([k,l,w])=>`<th style="width:${w}px;" onclick="audItemSort('${k}')">${l}${AUD.itemSort.key===k?`<span class="arrow">${AUD.itemSort.dir==='asc'?'▲':'▼'}</span>`:''}</th>`).join('')}</tr></thead>
          <tbody id="aud-item-window"></tbody>
        </table>
      </div>
    </div>
  `;
}
function audItemSort(key){
  if(AUD.itemSort.key===key) AUD.itemSort.dir = AUD.itemSort.dir==='asc'?'desc':'asc';
  else { AUD.itemSort.key = key; AUD.itemSort.dir = 'desc'; }
  renderView();
}
function audItemSetFilter(key, val){ AUD.itemFilters[key] = val; renderView(); }
function audItemClearFilters(){ AUD.itemFilters = {search:AUD.itemFilters.search, local:'', inventario:'', diagnostico:'', prioridade:'', dia:''}; renderView(); }
function audSetValidarTopN(val){ AUD.validarTopN = Math.max(1, parseInt(val,10)||15); }
let audItemSearchDebounce = null;
function audItemOnSearch(val){
  AUD.itemFilters.search = val;
  clearTimeout(audItemSearchDebounce);
  audItemSearchDebounce = setTimeout(()=>{
    audRenderAuditoriaWindow();
    const el = document.getElementById('aud-item-count');
    if(el) el.textContent = audFmtInt(audAuditoriaItens().length)+' itens consolidados';
  }, 180);
}

function audToggleExpandItem(item){
  if(AUD.itemExpanded.has(item)) AUD.itemExpanded.delete(item);
  else AUD.itemExpanded.add(item);
  audRenderAuditoriaWindow();
}
function audItemRowHtml(r){
  const diag = AUD_DIAG[r.diagnosticoPredominante] || {label:r.diagnosticoPredominante||'—', cor:'#7B80A0'};
  const expanded = AUD.itemExpanded.has(r.chave);
  let html = `<tr style="height:${AUD_ITEM_ROW_H}px;cursor:pointer;" onclick="audToggleExpandItem('${esc(r.chave)}')">
    <td class="mono">${expanded?'▾ ':'▸ '}${esc(r.chave)}</td>
    <td>${esc(r.ean||'—')}</td>
    <td title="${esc(r.descricao||'')}">${esc(r.descricao||'—')}</td>
    <td>${esc(r.localPrincipal||'—')}</td>
    <td class="mono ${r.qtd>=0?'aud-pos':'aud-neg'}">${audFmtInt(r.qtd)}</td>
    <td class="mono ${r.valor>=0?'aud-pos':'aud-neg'}">${audFmtMoney(r.valor)}</td>
    <td class="mono">${r.ocorrencias}</td>
    <td class="mono">${r.numInventarios}</td>
    <td><span class="stamp-tag" style="background:${diag.cor}22;color:${diag.cor};border:1px solid ${diag.cor}55;">${diag.label}</span></td>
    <td>${esc((r.prioridadeMax||'').toUpperCase())}</td>
  </tr>`;
  if(expanded){
    const occ = audAuditoriaOccurrences().filter(o=>o.itemWms===r.chave);
    html += `<tr><td colspan="10" style="padding:0;">
      <table style="width:100%;font-size:11px;">
        <thead><tr style="background:var(--surface2);"><th style="padding:4px 8px;">Endereço</th><th style="padding:4px 8px;">Inventário</th><th style="padding:4px 8px;">Qtd</th><th style="padding:4px 8px;">Valor</th><th style="padding:4px 8px;">Diagnóstico</th><th style="padding:4px 8px;">Prioridade</th><th style="padding:4px 8px;">Observação</th></tr></thead>
        <tbody>${occ.map(o=>{
          const d = AUD_DIAG[o.diagnostico]||{label:o.diagnostico};
          return `<tr><td style="padding:4px 8px;">${esc(o.endereco)}</td><td style="padding:4px 8px;">${esc(o.inventario)}</td><td style="padding:4px 8px;" class="mono">${audFmtInt(o.diferenca)}</td><td style="padding:4px 8px;" class="mono">${audFmtMoney(o.vlDivergencia)}</td><td style="padding:4px 8px;">${d.label}</td><td style="padding:4px 8px;">${esc(o.prioridade)}</td><td style="padding:4px 8px;">${esc(o.justificativa||'')}</td></tr>`;
        }).join('')}</tbody>
      </table>
    </td></tr>`;
  }
  return html;
}
function audMountAuditoriaScroll(){
  const el = document.getElementById('aud-item-scroll');
  if(!el) return;
  let ticking = false;
  const handler = ()=>{ if(ticking) return; ticking=true; requestAnimationFrame(()=>{ audRenderAuditoriaWindow(); ticking=false; }); };
  el.addEventListener('scroll', handler);
  audRenderAuditoriaWindow();
}
function audRenderAuditoriaWindow(){
  const el = document.getElementById('aud-item-scroll');
  const winEl = document.getElementById('aud-item-window');
  if(!el || !winEl) return;
  const rows = audAuditoriaItens();
  if(!rows.length){ winEl.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--ink-soft);padding:20px;">Nenhum item encontrado.</td></tr>`; return; }
  const viewH = el.clientHeight || 400;
  const scrollTop = el.scrollTop;
  const buffer = 8;
  const start = Math.max(0, Math.floor(scrollTop/AUD_ITEM_ROW_H) - buffer);
  const visibleCount = Math.ceil(viewH/AUD_ITEM_ROW_H) + buffer*2;
  const end = Math.min(rows.length, start+visibleCount);
  const topSpacer = start*AUD_ITEM_ROW_H;
  const bottomSpacer = (rows.length-end)*AUD_ITEM_ROW_H;
  winEl.innerHTML =
    `<tr style="height:${topSpacer}px;"><td colspan="10" style="padding:0;border:none;"></td></tr>`
    + rows.slice(start,end).map(audItemRowHtml).join('')
    + `<tr style="height:${bottomSpacer}px;"><td colspan="10" style="padding:0;border:none;"></td></tr>`;
}
function audExportItensCsv(){
  const rows = audAuditoriaItens();
  if(!rows.length){ showToast('Nada para exportar.', true); return; }
  const header = 'Item;EAN;Descricao;Local;Quantidade Divergente';
  const lines = rows.map(r=>[r.chave, r.ean||'', '"'+String(r.descricao||'').replace(/"/g,'""')+'"', r.localPrincipal||'', r.qtd].join(';'));
  const csv = '﻿'+header+'\n'+lines.join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'auditoria_'+AUD.currentAno+'.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============================================================
   MATRIZ DE OFENSORES — Índice de Criticidade (0-100)
   ============================================================ */
function audComputeCriticidade(itens){
  const maxValor = Math.max(1,...itens.map(i=>i.valorAbs));
  const maxQtd = Math.max(1,...itens.map(i=>i.qtdAbs));
  const maxOcorr = Math.max(1,...itens.map(i=>i.ocorrencias));
  const maxInv = Math.max(1,...itens.map(i=>i.numInventarios));
  const maxEnd = Math.max(1,...itens.map(i=>i.numEnderecos));
  return itens.map(i=>{
    const nValor = i.valorAbs/maxValor, nQtd = i.qtdAbs/maxQtd, nOcorr = i.ocorrencias/maxOcorr,
          nInv = i.numInventarios/maxInv, nEnd = i.numEnderecos/maxEnd,
          nNaoCompensado = 1 - (i.pctCompensado/100);
    // pesos: valor financeiro e recorrência pesam mais; distribuídos para somar 1
    const score = (nValor*0.30 + nQtd*0.15 + nOcorr*0.20 + nInv*0.15 + nEnd*0.10 + nNaoCompensado*0.10) * 100;
    return {...i, criticidade: Math.round(score)};
  }).sort((a,b)=>b.criticidade-a.criticidade);
}
function audCritColor(score){
  if(score>=70) return '#C83812';
  if(score>=40) return '#FE5000';
  return '#33488E';
}
function audRenderOfensores(){
  const itens = audComputeCriticidade(audAggItens());
  return `<div class="panel" style="padding:0;overflow:hidden;">
    <div class="aud-optable-toolbar"><b style="font-size:11.5px;color:var(--ink);">Matriz de Ofensores</b><span class="field-hint">Índice de Criticidade de 0 a 100, calculado a partir de valor, quantidade, ocorrências, recorrência e endereços — ordenado do maior para o menor</span></div>
    <div class="table-wrap" style="border:none;border-radius:0;">
      <table><thead><tr><th>Item</th><th>Valor Abs.</th><th>Qtde Abs.</th><th>Ocorrências</th><th>Inventários</th><th>Endereços</th><th>% Compensado</th><th>Criticidade</th></tr></thead>
      <tbody>${itens.slice(0,200).map(i=>`<tr>
        <td>${esc(i.chave)}</td>
        <td class="mono">${audFmtMoney(i.valorAbs)}</td>
        <td class="mono">${audFmtInt(i.qtdAbs)}</td>
        <td class="mono">${audFmtInt(i.ocorrencias)}</td>
        <td class="mono">${i.numInventarios}</td>
        <td class="mono">${i.numEnderecos}</td>
        <td class="mono">${i.pctCompensado.toFixed(0)}%</td>
        <td><span class="aud-crit-badge" style="background:${audCritColor(i.criticidade)};">${i.criticidade}</span></td>
      </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--ink-soft);">Sem registros</td></tr>'}</tbody></table>
    </div>
  </div>`;
}

/* ============================================================
   PAINEL DE ENDEREÇOS
   ============================================================ */
function audRenderEnderecos(){
  const enderecos = audAggEnderecos().sort((a,b)=>b.valorAbs-a.valorAbs);
  return `<div class="panel" style="padding:0;overflow:hidden;">
    <div class="aud-optable-toolbar"><b style="font-size:11.5px;color:var(--ink);">Painel de Endereços</b><span class="field-hint">${enderecos.length} endereços com divergência</span></div>
    <div class="table-wrap" style="border:none;border-radius:0;">
      <table><thead><tr><th>Endereço</th><th>Qtde Divergente</th><th>Valor</th><th>Itens</th><th>Inventários</th><th>Recorrência</th><th>% Compensação</th></tr></thead>
      <tbody>${enderecos.slice(0,200).map(e=>`<tr>
        <td>${esc(e.chave)}</td>
        <td class="mono">${audFmtInt(e.qtdAbs)}</td>
        <td class="mono ${e.valor>=0?'aud-pos':'aud-neg'}">${audFmtMoney(e.valor)}</td>
        <td class="mono">${e.numItens}</td>
        <td class="mono">${e.numInventarios}</td>
        <td class="mono">${e.ocorrencias}x</td>
        <td><span class="aud-mini-bar"><span style="width:${e.pctCompensado.toFixed(0)}%;"></span></span>${e.pctCompensado.toFixed(0)}%</td>
      </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--ink-soft);">Sem registros</td></tr>'}</tbody></table>
    </div>
  </div>`;
}

/* ============================================================
   PAINEL DE INVENTÁRIOS
   ============================================================ */
function audRenderInventarios(){
  const invs = audAggInventarios().sort((a,b)=>b.ocorrencias-a.ocorrencias);
  return `<div class="panel" style="padding:0;overflow:hidden;">
    <div class="aud-optable-toolbar"><b style="font-size:11.5px;color:var(--ink);">Painel de Inventários</b><span class="field-hint">${invs.length} inventários com divergência</span></div>
    <div class="table-wrap" style="border:none;border-radius:0;">
      <table><thead><tr><th>Inventário</th><th>Divergências</th><th>Valor</th><th>Itens</th><th>% Compensado</th><th>NET (líquido)</th></tr></thead>
      <tbody>${invs.slice(0,200).map(i=>`<tr>
        <td>${esc(i.chave)}</td>
        <td class="mono">${audFmtInt(i.ocorrencias)}</td>
        <td class="mono ${i.valor>=0?'aud-pos':'aud-neg'}">${audFmtMoney(i.valor)}</td>
        <td class="mono">${i.numItens}</td>
        <td><span class="aud-mini-bar"><span style="width:${i.pctCompensado.toFixed(0)}%;"></span></span>${i.pctCompensado.toFixed(0)}%</td>
        <td class="mono">${audFmtInt(i.qtd)}</td>
      </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--ink-soft);">Sem registros</td></tr>'}</tbody></table>
    </div>
  </div>`;
}

/* ============================================================
   PAINEL FINANCEIRO
   ============================================================ */
function audRenderFinanceiro(){
  const ind = AUD.indicadores;
  const topTable = (title, rows)=>`<div class="panel">
    <h3>${title}</h3>
    <div class="table-wrap"><table><thead><tr><th>Item</th><th>Descrição</th><th>Inventário</th><th>Endereço</th><th>Valor</th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td class="mono">${esc(r.item)}</td><td>${esc(r.descricao||'—')}</td><td>${esc(r.inventario)}</td><td>${esc(r.endereco||'—')}</td><td class="mono ${r.valor>0?'aud-pos':'aud-neg'}">${audFmtMoney(r.valor)}</td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--ink-soft);">Sem registros</td></tr>'}</tbody></table></div>
  </div>`;
  return `
    <div class="aud-kpi-grid">
      <div class="aud-kpi"><div class="num mono">${ind.maiorGanho?audFmtMoney(ind.maiorGanho.valor):'—'}</div><div class="label">Maior ganho financeiro</div></div>
      <div class="aud-kpi orange"><div class="num mono">${ind.maiorPerda?audFmtMoney(ind.maiorPerda.valor):'—'}</div><div class="label">Maior perda financeira</div></div>
      <div class="aud-kpi"><div class="num mono">${audFmtMoney(ind.valorDivergente)}</div><div class="label">Valor líquido divergente</div></div>
      <div class="aud-kpi"><div class="num mono">${audFmtMoney(ind.valorAbsoluto)}</div><div class="label">Valor absoluto total</div></div>
    </div>
    <div class="two-col">
      ${topTable('Top 20 maiores perdas', ind.top20Perdas)}
      ${topTable('Top 20 maiores ganhos', ind.top20Ganhos)}
    </div>
    <div class="panel">
      <h3>Pareto financeiro (top 20 perdas)</h3>
      <div class="table-wrap"><table><thead><tr><th>Item</th><th>Inventário</th><th>Valor</th><th>% Acumulado</th></tr></thead>
      <tbody>${ind.pareto.map(p=>`<tr><td class="mono">${esc(p.item)}</td><td>${esc(p.inventario)}</td><td class="mono aud-neg">${audFmtMoney(p.valor)}</td><td class="mono">${p.pctAcumulado.toFixed(1)}%</td></tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--ink-soft);">Sem registros</td></tr>'}</tbody></table></div>
    </div>
  `;
}

/* ============================================================
   CONFIGURAÇÕES — TABELA NET
   ============================================================ */
function audRenderConfig(){
  const rows = AUD.netConfig.slice().sort((a,b)=>{
    if(a.origem==='auto' && b.origem!=='auto') return -1;
    if(b.origem==='auto' && a.origem!=='auto') return 1;
    return a.cod.localeCompare(b.cod);
  });
  return `
    <div class="panel">
      <h3>Motor de regras — considerar no NET</h3>
      <p class="field-hint" style="margin-bottom:12px;">Defina, por código de legenda (extraído de "Obs inventario" da QUERY 845), se o ajuste deve entrar no cálculo do NET. Códigos novos detectados na importação aparecem automaticamente aqui como <b>Não</b>, sinalizados para revisão.</p>
      <div class="action-bar"><div></div><button class="btn btn-primary" onclick="audAddNetRow()">+ Adicionar código</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th style="width:90px;">Código</th><th>Descrição</th><th style="width:110px;">Considerar NET</th><th style="width:90px;">Origem</th><th style="width:60px;"></th></tr></thead>
        <tbody>
          ${rows.map(r=>`<tr ${r.origem==='auto'?'style="background:rgba(254,80,0,.06);"':''}>
            <td class="mono">${r.novo ? `<input value="${esc(r.cod)}" style="width:80px;" onchange="audNetRowRename('${esc(r.cod)}', this.value)">` : esc(r.cod)}</td>
            <td><input value="${esc(r.descricao)}" onchange="audUpdateNetRow('${esc(r.cod)}','descricao',this.value)"></td>
            <td><label class="aud-toggle"><input type="checkbox" ${r.net?'checked':''} onchange="audUpdateNetRow('${esc(r.cod)}','net',this.checked)"> Sim</label></td>
            <td>${r.origem==='auto'?'<span class="stamp-tag tag-alert">Novo</span>':'<span class="stamp-tag tag-muted">Semente</span>'}</td>
            <td><button class="btn-danger-text" onclick="audDeleteNetRow('${esc(r.cod)}')">Remover</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>
  `;
}
async function audUpdateNetRow(cod, field, value){
  const row = AUD.netConfig.find(r=>r.cod===cod);
  if(!row) return;
  row[field] = value;
  if(field==='descricao') row.revisar = /revisar/i.test(value);
  await audSaveNetConfig([row]);
  showToast('Regra atualizada.');
}
async function audAddNetRow(){
  const cod = 'NOVO'+(AUD.netConfig.length+1);
  const row = {cod, descricao:'', net:false, origem:'manual', novo:true};
  AUD.netConfig.push(row);
  await audSaveNetConfig([row]);
  renderView();
}
async function audNetRowRename(oldCod, newCod){
  newCod = newCod.trim().toUpperCase();
  if(!newCod) return;
  const row = AUD.netConfig.find(r=>r.cod===oldCod);
  if(!row) return;
  const db = await audDB();
  await new Promise((resolve,reject)=>{
    const tx = db.transaction(AUD_STORES.netConfig,'readwrite');
    tx.objectStore(AUD_STORES.netConfig).delete(oldCod);
    tx.oncomplete = resolve; tx.onerror = ()=>reject(tx.error);
  });
  row.cod = newCod; delete row.novo;
  await audSaveNetConfig([row]);
  AUD.netConfig = await audGetNetConfig();
  renderView();
  showToast('Código salvo: '+newCod);
}
async function audDeleteNetRow(cod){
  if(!confirm('Remover a regra "'+cod+'"?')) return;
  const db = await audDB();
  await new Promise((resolve,reject)=>{
    const tx = db.transaction(AUD_STORES.netConfig,'readwrite');
    tx.objectStore(AUD_STORES.netConfig).delete(cod);
    tx.oncomplete = resolve; tx.onerror = ()=>reject(tx.error);
  });
  AUD.netConfig = await audGetNetConfig();
  renderView();
  showToast('Regra removida.');
}

/* ============================================================
   RELATÓRIOS + IMPRESSÃO OPERACIONAL
   ============================================================ */
const AUD_PRINT_SCOPES = [
  ['todos','Todos'], ['perdas','Somente perdas'], ['ganhos','Somente ganhos'], ['pendentes','Somente pendentes'],
  ['altoValor','Somente alto valor'], ['altaPrioridade','Somente alta prioridade'], ['real','Somente divergências reais']
];
function audExportCsv(rows, filename){
  if(!rows || !rows.length){ showToast('Nada para exportar.', true); return; }
  const cols = ['inventario','local','endereco','itemWms','itemSige','descricao','ean','codTerceiro','qtdeLogica','qtdeFisica','diferenca','vlLogico','vlFisico','vlDivergencia','dataInicio','dataFim','codLegenda','descLegenda','considerarNet','diagnostico','prioridade','necessitaValidacao','situacaoLiquidada','justificativa','estoqueTotal','estoqueQtdNoEndereco','estoqueNumEnderecos','estoqueTotalLiquidado','estoqueNumEnderecosLiquidados','ano'];
  const header = cols.join(';');
  const lines = rows.map(r=>cols.map(c=>{
    let v = r[c];
    if(typeof v === 'string') v = '"'+v.replace(/"/g,'""')+'"';
    return v===undefined||v===null?'':v;
  }).join(';'));
  const csv = '﻿'+header+'\n'+lines.join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
function audRenderRelatorios(){
  return `
    <div class="panel">
      <h3>Exportar auditoria — Ano ${AUD.currentAno}</h3>
      <p class="field-hint" style="margin-bottom:12px;">Exporta a base tratada e diagnosticada do ano selecionado (apenas divergências consideradas no NET).</p>
      <div class="action-bar">
        <div class="btn-group">
          <button class="btn btn-primary" onclick="audExportCsv(audNetFilteredList().filter(r=>r.necessitaValidacao), 'auditoria_pendentes_'+AUD.currentAno+'.csv')">Exportar pendentes (CSV)</button>
          <button class="btn btn-secondary" onclick="audExportCsv(audNetFilteredList(), 'auditoria_completa_'+AUD.currentAno+'.csv')">Exportar base completa (CSV)</button>
          <button class="btn btn-secondary" onclick="audExportXlsx()">Exportar base completa (XLSX)</button>
        </div>
      </div>
    </div>
    <div class="panel">
      <h3>Exportar indicadores</h3>
      <div class="action-bar">
        <div class="btn-group">
          <button class="btn btn-secondary" onclick="audExportIndicadoresJson()">Exportar indicadores (JSON)</button>
          <button class="btn btn-secondary" onclick="audExportIndicadoresCsv()">Exportar indicadores (CSV)</button>
        </div>
      </div>
    </div>
    <div class="panel">
      <h3>Folha operacional de impressão</h3>
      <p class="field-hint" style="margin-bottom:10px;">Gera uma folha A4 enxuta para uso durante a conferência física — sem gráficos, KPIs ou menus.</p>
      <div class="aud-print-scope-bar">
        <label>Escopo:</label>
        <select id="aud-print-scope-select">${AUD_PRINT_SCOPES.map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select>
        <button class="btn btn-primary" onclick="audPrintFolha(document.getElementById('aud-print-scope-select').value)">Gerar e imprimir</button>
      </div>
    </div>
    <div class="panel">
      <h3>Histórico de processamentos</h3>
      <div class="table-wrap"><table><thead><tr><th>Ano</th><th>Linhas</th><th>Pendentes</th><th>Duplicidades removidas</th><th>Processado em</th></tr></thead>
      <tbody id="aud-history-tbody">
      <tr id="aud-history-body"><td colspan="5" style="text-align:center;color:var(--ink-soft);">Carregando...</td></tr>
      </tbody></table></div>
    </div>
  `;
}
function audPrintFolha(scope){
  let rows = audNetFilteredList();
  if(scope==='perdas') rows = rows.filter(r=>r.vlDivergencia<0);
  else if(scope==='ganhos') rows = rows.filter(r=>r.vlDivergencia>0);
  else if(scope==='pendentes') rows = rows.filter(r=>r.necessitaValidacao);
  else if(scope==='altoValor') rows = rows.filter(r=>Math.abs(r.vlDivergencia)>=1000);
  else if(scope==='altaPrioridade') rows = rows.filter(r=>r.prioridade==='alta');
  else if(scope==='real') rows = rows.filter(r=>r.diagnostico==='divergencia_real');

  const sheet = document.getElementById('aud-print-sheet');
  if(!rows.length){ showToast('Nenhum registro no escopo selecionado.', true); return; }
  const inventarios = Array.from(new Set(rows.map(r=>r.inventario))).slice(0,3).join(', ');
  sheet.innerHTML = `<div class="aud-print-page">
    <div class="aud-print-head">
      <div><h2>Folha Operacional de Auditoria de Inventário</h2>
      <div>Inventário(s): ${esc(inventarios)}${rows.length>3?' (+)':''}</div></div>
      <div style="text-align:right;">Data: ${new Date().toLocaleDateString('pt-BR')}<br>Itens: ${rows.length}<br>Página 1</div>
    </div>
    <table class="aud-print-table">
      <thead><tr><th>Item</th><th>EAN</th><th>Descrição</th><th>Endereço</th><th>Qtde Div.</th><th>Qtde Encontrada</th><th>Endereço Encontrado</th><th>Observações</th><th>Auditor</th><th>Data</th></tr></thead>
      <tbody>${rows.map(r=>`<tr>
        <td>${esc(r.itemWms)}</td><td>${esc(r.ean)}</td><td>${esc(r.descricao)}</td><td>${esc(r.endereco)}</td>
        <td>${audFmtInt(r.diferenca)}</td><td class="tall"></td><td class="tall"></td><td class="tall"></td><td class="tall"></td><td class="tall"></td>
      </tr>`).join('')}</tbody>
    </table>
  </div>`;
  setTimeout(()=>window.print(), 80);
}
function audPrintTopItens(){
  const itens = audAuditoriaItens().slice().sort((a,b)=>b.valorAbs-a.valorAbs).slice(0, AUD.validarTopN);
  const sheet = document.getElementById('aud-print-sheet');
  if(!itens.length){ showToast('Nenhum item para imprimir com os filtros atuais.', true); return; }
  const inventarios = Array.from(new Set(itens.flatMap(i=>Array.from(i.inventarios)))).slice(0,4).join(', ');
  sheet.innerHTML = `<div class="aud-print-page">
    <div class="aud-print-head">
      <div><h2>Folha Operacional — Validar Hoje (Top ${itens.length})</h2>
      <div>Inventário(s): ${esc(inventarios)}${itens.some(i=>i.numInventarios>4)?' (+)':''}</div></div>
      <div style="text-align:right;">Data: ${new Date().toLocaleDateString('pt-BR')}<br>Itens: ${itens.length}<br>Página 1</div>
    </div>
    <table class="aud-print-table">
      <thead><tr><th>Item</th><th>EAN</th><th>Descrição</th><th>Local Principal</th><th>Qtde Div. Acum.</th><th>Qtde Encontrada</th><th>Endereço Encontrado</th><th>Observações</th><th>Auditor</th><th>Data</th></tr></thead>
      <tbody>${itens.map(r=>`<tr>
        <td>${esc(r.chave)}</td><td>${esc(r.ean)}</td><td>${esc(r.descricao)}</td><td>${esc(r.localPrincipal)}</td>
        <td>${audFmtInt(r.qtd)}</td><td class="tall"></td><td class="tall"></td><td class="tall"></td><td class="tall"></td><td class="tall"></td>
      </tr>`).join('')}</tbody>
    </table>
  </div>`;
  setTimeout(()=>window.print(), 80);
}
function audExportXlsx(){
  const rows = audNetFilteredList();
  if(!rows.length){ showToast('Nada para exportar.', true); return; }
  const ws = XLSX.utils.json_to_sheet(rows.map(r=>({
    Inventario:r.inventario, Local:r.local, Endereco:r.endereco, ItemWMS:r.itemWms, ItemSIGE:r.itemSige,
    Descricao:r.descricao, EAN:r.ean, CodTerceiro:r.codTerceiro, QtdeLogica:r.qtdeLogica, QtdeFisica:r.qtdeFisica,
    Diferenca:r.diferenca, VlLogico:r.vlLogico, VlFisico:r.vlFisico, VlDivergencia:r.vlDivergencia,
    DataInicio:r.dataInicio, DataFim:r.dataFim, CodLegenda:r.codLegenda, DescLegenda:r.descLegenda,
    ConsiderarNET:r.considerarNet?'Sim':'Não', Diagnostico:(AUD_DIAG[r.diagnostico]||{}).label||r.diagnostico,
    Prioridade:r.prioridade, NecessitaValidacao:r.necessitaValidacao?'Sim':'Não', SituacaoLiquidada:r.situacaoLiquidada?'Sim':'Não',
    Justificativa:r.justificativa, EstoqueTotal:r.estoqueTotal, EstoqueNoEndereco:r.estoqueQtdNoEndereco,
    EstoqueNumEnderecos:r.estoqueNumEnderecos, EstoqueTotalLiquidado:r.estoqueTotalLiquidado,
    EstoqueNumEnderecosLiquidados:r.estoqueNumEnderecosLiquidados, Ano:r.ano
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Auditoria');
  XLSX.writeFile(wb, 'auditoria_'+AUD.currentAno+'.xlsx');
}
function audExportIndicadoresJson(){
  if(!AUD.indicadores){ showToast('Nada para exportar.', true); return; }
  const blob = new Blob([JSON.stringify(AUD.indicadores, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'indicadores_'+AUD.currentAno+'.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
function audExportIndicadoresCsv(){
  if(!AUD.indicadores){ showToast('Nada para exportar.', true); return; }
  const ind = AUD.indicadores;
  const simples = {
    totalImportadas:ind.totalImportadas, duplicidadesRemovidas:ind.duplicidadesRemovidas,
    considerNetSim:ind.considerNetSim, considerNetNao:ind.considerNetNao, itensUnicos:ind.itensUnicos,
    inventarios:ind.inventarios, enderecos:ind.enderecos,
    qtdDivergente:ind.qtdDivergente, valorDivergente:ind.valorDivergente, qtdPositiva:ind.qtdPositiva,
    qtdNegativa:ind.qtdNegativa, saldoLiquido:ind.saldoLiquido, qtdAbsoluta:ind.qtdAbsoluta,
    valorAbsoluto:ind.valorAbsoluto, necessitaValidacao:ind.necessitaValidacao
  };
  const lines = ['Indicador;Valor', ...Object.entries(simples).map(([k,v])=>`${k};${v}`)];
  const csv = '﻿'+lines.join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'indicadores_'+AUD.currentAno+'.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
async function audFillHistory(){
  const el = document.getElementById('aud-history-body');
  if(!el) return;
  const metas = await audGetAllImportMeta();
  if(!metas.length){ el.outerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--ink-soft);">Sem processamentos</td></tr>'; return; }
  el.outerHTML = metas.sort((a,b)=>b.ano-a.ano).map(m=>`<tr>
    <td>${m.ano}</td><td class="mono">${audFmtInt(m.totalLinhas)}</td><td class="mono">${audFmtInt(m.necessitaValidacao)}</td>
    <td class="mono">${audFmtInt(m.duplicidadesRemovidas)}</td><td>${new Date(m.processedAt).toLocaleString('pt-BR')}</td>
  </tr>`).join('');
}
