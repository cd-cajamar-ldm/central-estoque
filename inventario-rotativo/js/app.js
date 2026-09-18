/* ============================================================
   Inventário Rotativo — UI principal
   App independente: importação, ciclos, contagens, divergências,
   produtividade, auditoria inteligente, histórico, comparativo.
   100% client-side (SheetJS + Web Worker + IndexedDB).
   ============================================================ */
const IR = {
  currentTab:'dashboard',
  ciclos:[], cicloAtivo:null,
  indicadores:null, importMeta:null,
  prioridadeConfig:null,
  net410Legenda:[], // legenda de motivos da 410 (editável em Configurações)
  net410Ignorados:[], // itens ocultos da análise de distorção do NET (motivo já conhecido)
  net410Padroes:[], // trechos da Observação WMS que escondem qualquer item que os carregue (ex.: "SALDO")
  netAuditoriaN:10, // quantos itens entram na "Gerar Auditoria" (top N por |saldo| do período atual)
  netAuditoriaGerada:null, // {geradoEm, mesLabel, linhas:[...]} — resultado da última geração
  files:{f390:null, f843:[null,null,null,null], fCong:[null,null,null,null], f278:[null,null,null,null], f051:[null,null,null,null]},
  processing:false, progress:{stage:'', pct:0},
  divergencias:[], locais:[], contagens:[],
  divEscopo:{tipo:'ciclo'}, divEscopoDados:null, divAnoCache:null, divSelecionados:null,
  divCorte:null, divCorteQtd:null, divBusca:'', divExpandido:null,
  // Base do corte (o que define ofensor) e sentidos ligados na tabela — multi-seleção.
  divBase:'valor', divSentidos:['perda','ganho'],
  // Cache da QRY410 do(s) ano(s) do escopo — é dela que sai o preço congelado.
  div410Cache:null,
  divSimExigeDesc:true,
  divOrdem:{col:'netValor', dir:'desc'}, divAuditoria:null,
  divSimFiltro:{de:'', ate:''},
  divSimOrdem:{col:'dia', dir:'desc'},
  prodFilters:{de:'', ate:'', usuario:'', setor:''},
  prodSort:{col:'locaisHora', dir:'desc'},
  prodMeta:null,
  dashFilters:{applyProdDate:true},
  compararA:null, compararB:null,
  novoCiclo:false, cicloParaExcluir:null, importExpandido:null,
  // Ciclo lido da própria QRY0843 anexada (número + janela de datas).
  cicloDetectado:null, detectandoCiclo:false,
  _porDiaRua:{},
  // Escopo dos painéis "Itens mais Divergentes" — por padrão soma só o ciclo ativo
  // (igual antes), mas dá pra expandir pra um ano inteiro (todos os ciclos abertos
  // naquele ano) ou todos os ciclos já processados. itemDivSaldo é o resultado já
  // calculado pro escopo atual (populado por irAtualizarItemDivSaldo).
  itemDivFiltro:{tipo:'ciclo'}, itemDivSaldo:null,
  // Estoque atual (QRY0390) — independente do ciclo, é a foto do CD agora.
  est390File:null, est390Processing:false, est390Progress:{stage:'', pct:0},
  pastaHandle:null, pastaArquivos:null, pastaUltimo:null, pastaPerm:null,
  pastaProcessando:false, pastaVarridoEm:null, pastaErro:null,
  // Varredura completa: TODOS os arquivos de cada base, não só o mais recente.
  // É o que permite enxergar vários ciclos de uma vez na mesma pasta.
  pastaTodos:null, pastaCiclos:null, pastaDeteccao:null, pastaImportados:null,
  pastaLendoCiclos:false, pastaFilaAtual:null, pastaAnosFechados:null,
  importManualAberto:false,
  est390Meta:null, est390Ficha:null, est390Locais:null,
  est160File:null, est160Processing:false, est160Progress:{stage:'', pct:0},
  audIgnorarVirtuais:true, audPrefixos:null,
  // Perdas e Ganhos (QRY410) — independente do ciclo, por ano.
  net410Anos:[], net410AnoSel:null, net410MesSel:null, net410Data:null, net410File:null,
  net410Processing:false, net410Progress:{stage:'', pct:0},
  divNetMesSel:null, // mês selecionado no painel "Por que o NET está distorcido?" (aba Divergências)
  divNetDiaSel:null, // dia selecionado (opcional) no mesmo painel — "" ou null = mês inteiro
  comparativoCiclos:null, // [{ciclo, ind}] de todos os ciclos já processados, pro gráfico do Dashboard
};

function irEsc(v){ if(v===undefined||v===null) return ''; return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function irFmtInt(n){ return Math.round(n||0).toLocaleString('pt-BR'); }
function irFmtNum(n, dec){ return (n||0).toLocaleString('pt-BR', {minimumFractionDigits:dec||0, maximumFractionDigits:dec===undefined?2:dec}); }
function irFmtMoney(n){ return (n||0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'}); }
// Formato compacto pros KPIs de valor: "R$121,3M" / "R$847,2K". Medido no navegador:
// e o unico formato que cabe na tile do KPI sem estourar os ~93px uteis e sem o
// auto-encolhimento de fonte entrar em acao (R$ 121.336.999,05 precisa de 174px a 17px).
// O valor exato continua disponivel no hint logo abaixo e na aba Indicadores.
function irFmtMoneyCompact(n){
  n = n||0;
  const abs = Math.abs(n);
  if(abs>=1000000) return 'R$'+(n/1000000).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'M';
  if(abs>=1000) return 'R$'+(n/1000).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'K';
  return 'R$'+n.toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:0});
}
// Valor cheio, sem centavos — usado no hint, onde cabe texto maior.
function irFmtMoneyInt(n){ return (n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:0,maximumFractionDigits:0}); }
function irFmtPct(n){ return ((n||0)*100).toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1})+'%'; }
/* Data só com dia (YYYY-MM-DD) é formatada na mão de propósito: new Date('2026-09-04')
   é interpretado como meia-noite UTC, e em fuso negativo (Brasil, UTC-3) o
   toLocaleDateString devolvia o dia ANTERIOR — a tela inteira mostrava tudo um dia
   atrás do que estava no filtro e no banco. Com hora junto, o Date é confiável. */
function irFmtDate(s){
  if(!s) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if(m) return m[3]+'/'+m[2]+'/'+m[1];
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}
/* Ano do ciclo, derivado da data de abertura — usado pra não confundir
   "Ciclo 1" de anos diferentes (mesmo número, ciclos distintos). */
/* O ano sai do próprio texto da data, não de um Date. "2026-01-01" passado pro
   Date é lido como meia-noite em UTC — que em Brasília (UTC−3) é 31/12/2025 às
   21h. Todo ciclo aberto em 1º de janeiro virava ciclo do ano anterior: o ciclo
   1/2026 aparecia como "Ciclo 1/2025", entrava na acurácia do ano errado e caía
   fora do ano corrente no seletor. */
function irCicloAno(c){
  const s = c && c.dataAbertura;
  if(!s) return null;
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(String(s).trim());
  if(m) return +m[1];
  const d = new Date(s); return isNaN(d.getTime()) ? null : d.getFullYear();
}
/* Término previsto de um ciclo recém-detectado.

   A detecção devolve como término a ÚLTIMA data de contagem do arquivo. Para
   ciclo fechado isso é o certo. Para o ciclo em curso, não: a última contagem é
   de hoje, a janela passa a terminar hoje e tudo que for contado de amanhã em
   diante é descartado — sem que nada na tela explique o congelamento dos
   números (é exatamente o aviso de "janela barrando contagens").

   Então: ciclo que ainda está recebendo contagem (última contagem nos últimos
   sete dias) usa o fim do trimestre. Nunca encolhe o que já foi detectado —
   contagem atrasada, depois do fim do trimestre, manda. */
function irTerminoDoCiclo(det){
  if(!det || !det.dataPrevistaTermino) return det && det.dataPrevistaTermino;
  if(!det.fimTrimestre) return det.dataPrevistaTermino;
  const limite = new Date(Date.now() - 7*86400000).toISOString().slice(0,10);
  if(det.dataPrevistaTermino < limite) return det.dataPrevistaTermino;
  return det.dataPrevistaTermino > det.fimTrimestre ? det.dataPrevistaTermino : det.fimTrimestre;
}
function irCicloLabel(c){ const ano = irCicloAno(c); return `Ciclo ${c.numero}${ano?'/'+ano:''}`; }
// Ordem cronológica de um ciclo: ano e número juntos num número só, pra comparar.
function irCicloOrdem(c){ return (irCicloAno(c)||0) * 10 + (c.numero||0); }
/* Status do ciclo, derivado em vez de lido cru do registro. Todo ciclo era
   gravado como "aberto" e só fechava se alguém clicasse em "Encerrar" — então
   os ciclos 1 e 2 continuavam aparecendo como abertos depois do 3 começar, que
   não descreve a realidade: os ciclos são trimestrais e sequenciais, começar um
   é fechar o anterior. Existindo ciclo mais novo, este está encerrado; o mais
   novo é o único cujo status gravado ainda vale (dá pra encerrar à mão quando
   ele termina e o seguinte ainda não começou). */
function irCicloStatus(c){
  if(!c) return 'encerrado';
  const ordem = irCicloOrdem(c);
  const temMaisNovo = (IR.ciclos||[]).some(o => irCicloOrdem(o) > ordem);
  return temMaisNovo ? 'encerrado' : (c.status || 'aberto');
}
function irCicloMaisNovo(lista){
  return (lista||[]).slice().sort((a,b)=>irCicloOrdem(b)-irCicloOrdem(a))[0] || null;
}
function irShowToast(msg, isError){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast'+(isError?' error':'');
  clearTimeout(window.__irToastTimer);
  window.__irToastTimer = setTimeout(()=>{ t.className='toast hidden'; }, 2600);
}
function irEmptyState(title, desc, onclickFn, btnLabel){
  return `<div class="empty-state panel"><div class="eicon">📦</div><h3>${irEsc(title)}</h3><p>${irEsc(desc)}</p>
    ${onclickFn ? `<button class="btn btn-primary" onclick="${onclickFn}">${irEsc(btnLabel)}</button>` : ''}</div>`;
}

/* ============================================================
   INIT / TEMA / NAVEGAÇÃO
   ============================================================ */
async function irInit(){
  const savedTheme = localStorage.getItem('ir-theme');
  if(savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
  const savedAppTheme = localStorage.getItem('ir-app-theme');
  if(savedAppTheme && savedAppTheme!=='padrao') document.documentElement.setAttribute('data-app-theme', savedAppTheme);
  irUpdateThemeLabel();
  irApplyZoom(parseInt(localStorage.getItem('ir-zoom'), 10) || 100);

  try{
    IR.prioridadeConfig = await irSeedPrioridadeConfigIfEmpty();
    IR.prodMeta = await irGetProdMetaConfig();
    IR.net410Legenda = await irSeedNet410LegendaIfEmpty();
    IR.net410Ignorados = await irGetNet410IgnoradosAll();
    IR.net410Padroes = await irSeedNet410PadroesIgnoradosIfEmpty();
    IR.ciclos = await irGetAllCiclos();
    if(IR.ciclos.length){
      IR.cicloAtivo = IR.ciclos.find(c=>irCicloStatus(c)==='aberto') || irCicloMaisNovo(IR.ciclos) || IR.ciclos[0];
      await irLoadCicloData(IR.cicloAtivo.id);
    }
    IR.est390Meta = await irGetEstoqueMeta();
    IR.est390Ficha = await irGetConfig('estoque390-ficha');
    const ign = await irGetConfig('auditoria-ignorar-virtuais');
    if(ign!=null) IR.audIgnorarVirtuais = ign;
    IR.audPrefixos = await irGetConfig('auditoria-prefixos');
    IR.net410Anos = await irGetAllNet410Anos();
    if(IR.net410Anos.length){
      IR.net410AnoSel = IR.net410Anos[0];
      IR.net410Data = await irGetNet410(IR.net410AnoSel);
      irSetNet410MesDefault();
    }
  }catch(e){
    // Guarda o erro: sem isso, uma falha ao ABRIR o banco (dados intactos, só
    // inacessíveis) aparecia na tela como "nenhum ciclo importado ainda" — que
    // manda o usuário reimportar tudo pra resolver um problema que não é esse.
    console.error('Falha ao iniciar', e);
    IR.initErro = (e && (e.name ? e.name+': '+e.message : e.message)) || String(e);
  }
  // Sem isso o navegador pode descartar o banco sozinho quando o disco aperta —
  // e o app perde ciclos inteiros sem nenhum aviso. Só pede; se negar, segue.
  IR.bancoInfo = {};
  try{
    if(navigator.storage && navigator.storage.persist){
      IR.bancoInfo.persistente = await navigator.storage.persisted() || await navigator.storage.persist();
    }
    const db = await irOpenDB();
    IR.bancoInfo.versao = db.version;
    db.close();
  }catch(_){}
  irMostrarVersao();
  irSwitchTab('dashboard');
  // Fora do try acima e sem await: se a pasta conectada falhar (permissão
  // revogada, política nova, arquivo só na nuvem), isso não pode impedir o app
  // de abrir — é conveniência, não dependência.
  irPastaCarregar().catch(()=>{});
}
async function irLoadCicloData(cicloId){
  IR.indicadores = await irGetIndicadores(cicloId);
  IR.importMeta = await irGetImportMeta(cicloId);
  IR.divergencias = await irGetByCiclo(IR_STORES.divergencias, cicloId);
  IR.locais = await irGetByCiclo(IR_STORES.locais, cicloId);
  IR.contagens = await irGetByCiclo(IR_STORES.contagens, cicloId);
  // Troca de ciclo ativo volta o escopo dos "Itens mais Divergentes" pro padrão
  // (só o ciclo atual) — senão ficaria somando um ciclo antigo com o novo ativo.
  IR.itemDivFiltro = {tipo:'ciclo'};
  IR.itemDivSaldo = irCalcItemSaldo(IR.divergencias);
  IR.comparativoCiclos = null; // recarrega no próximo render do Dashboard (irCarregarComparativoCiclos)
  // Sem await: a tela abre com o que tem e se refaz quando o recálculo terminar.
  irRecalcularSeMotorAntigo();
}
// Carrega os indicadores de TODOS os ciclos já processados (ordenados por ano+número)
// pro gráfico "Comparativo de Acurácias entre Ciclos" do Dashboard — cada ciclo já é
// isolado por cicloId no IndexedDB, então não há mistura entre eles aqui.
async function irCarregarComparativoCiclos(){
  const ciclosOrdenados = IR.ciclos.slice().sort((a,b)=>{
    const anoA = irCicloAno(a)||0, anoB = irCicloAno(b)||0;
    return anoA!==anoB ? anoA-anoB : a.numero-b.numero;
  });
  const pares = await Promise.all(ciclosOrdenados.map(async c=>({ciclo:c, ind: await irGetIndicadores(c.id)})));
  IR.comparativoCiclos = pares;
  irRenderView();
}
const IR_MOBILE_QUERY = '(max-width:640px)'; // precisa bater com o breakpoint do CSS (theme.css)
// No mobile o menu é um overlay (aberto/fechado); no desktop é o modo compacto de 56px.
// Cada um usa sua própria classe pra não haver estado intermediário entre os dois.
function irToggleSidebar(){
  const el = document.getElementById('sidebar');
  if(matchMedia(IR_MOBILE_QUERY).matches) el.classList.toggle('mobile-open');
  else el.classList.toggle('collapsed');
}
function irCloseSidebarMobile(){
  if(matchMedia(IR_MOBILE_QUERY).matches) document.getElementById('sidebar').classList.remove('mobile-open');
}
function irToggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark':'light');
  const next = cur==='dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('ir-theme', next);
  irUpdateThemeLabel();
}
const IR_APP_THEMES = [
  {key:'padrao', label:'Padrão (Loja do Mecânico)', swatch:'linear-gradient(90deg,#001A72,#FA4616)'},
  {key:'aurora', label:'Aurora Glass', swatch:'linear-gradient(90deg,#4B3F9E,#12B4D6)'},
  {key:'ember', label:'Ember Flow', swatch:'linear-gradient(90deg,#241209,#FF6A00)'},
  {key:'carbon', label:'Carbon Red', swatch:'linear-gradient(90deg,#1A1A1C,#E0142C)'}
];
function irSetAppTheme(theme){
  if(theme==='padrao') document.documentElement.removeAttribute('data-app-theme');
  else document.documentElement.setAttribute('data-app-theme', theme);
  localStorage.setItem('ir-app-theme', theme);
  irRenderView();
}
function irUpdateThemeLabel(){
  const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark':'light');
  const label = document.getElementById('themeToggleLabel');
  if(label) label.textContent = cur==='dark' ? 'Modo escuro' : 'Modo claro';
}
const IR_ZOOM_MIN = 70, IR_ZOOM_MAX = 150, IR_ZOOM_STEP = 10;
function irApplyZoom(pct){
  pct = Math.max(IR_ZOOM_MIN, Math.min(IR_ZOOM_MAX, pct));
  document.body.style.zoom = (pct/100);
  /* O zoom encolhe a unidade de viewport junto com o resto: a 80%, o .shell de
     100dvh ocupava 80% da tela e sobrava uma faixa branca embaixo — quanto menor
     o zoom, menos área útil, que é o contrário do que se espera dele. Dividir a
     altura pelo fator devolve a tela inteira em qualquer zoom. */
  document.documentElement.style.setProperty('--zoom', pct/100);
  const label = document.getElementById('zoomLabel');
  if(label) label.textContent = pct+'%';
  localStorage.setItem('ir-zoom', pct);
}
function irZoomIn(){ irApplyZoom((parseInt(localStorage.getItem('ir-zoom'),10)||100) + IR_ZOOM_STEP); }
function irZoomOut(){ irApplyZoom((parseInt(localStorage.getItem('ir-zoom'),10)||100) - IR_ZOOM_STEP); }

const IR_TAB_LABELS = {
  dashboard:['Dashboard Executivo','Visão geral do ciclo ativo.'],
  ciclo:['NET','Meta x realizado do ciclo e detalhe de NET por Log/Rua/Tipo.'],
  produtividade:['Produtividade','Ritmo, meta, qualidade e capacidade da equipe.'],
  setores:['Setores','Resumo por setor (rua) e ruas mais divergentes.'],
  divergencias:['Divergências','Itens com saldo final diferente do sistêmico.'],
  comparativo:['Comparativo entre Ciclos','Compare acurácia, produtividade e tendências.'],
  indicadores:['Indicadores','Todos os KPIs, com a fórmula de cada um.'],
  importacao:['Importação','Importe as planilhas e abra ou atualize um ciclo.'],
  configuracoes:['Configurações','Pesos do Índice de Prioridade de Auditoria.']
};
/* Abas que não são do ciclo rotativo: sem ciclo e sem contagem, o filtro de
   ciclo e mês do topo não tem sobre o que agir. Hoje nenhuma aba está nesse
   caso — Transitórios, que era a única, virou módulo próprio (../transitorios/). */
const IR_TAB_SEM_CICLO = new Set();
function irSwitchTab(tab){
  IR.currentTab = tab;
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  const [title, sub] = IR_TAB_LABELS[tab] || [tab, ''];
  document.getElementById('tabTitle').textContent = title;
  document.getElementById('tabSubtitle').textContent = sub;
  // Filtro de ciclo e mês só faz sentido onde existe ciclo. Em Transitórios ele
  // ficava no topo sem efeito nenhum sobre a tela, sugerindo um recorte que a
  // aba não faz.
  const filtros = document.getElementById('topbarFilters');
  if(filtros) filtros.hidden = IR_TAB_SEM_CICLO.has(tab);
  irRenderCycleBadge();
  irRenderView();
  irCloseSidebarMobile();
}
function irRenderCycleBadge(){
  const badge = document.getElementById('cycleBadge');
  if(!badge) return;
  if(!IR.ciclos.length){ badge.innerHTML = 'Nenhum ciclo ativo'; return; }
  // Sempre em dropdown, mesmo com um único ciclo — assim o seletor não "aparece do
  // nada" quando o segundo ciclo for processado.
  // Ordena por ano E número: só pelo número, "Ciclo 4/2025" subia acima do
  // "Ciclo 3/2026" e o ciclo em curso aparecia no meio da lista.
  /* Todos os ciclos, agrupados por ano — o do ano corrente primeiro. Antes a lista
     era só do ano do ciclo mais novo, e ciclo de ano fechado se alcançava pela aba
     Histórico; sem ela, este seletor é o único caminho, e esconder ano anterior
     deixaria o dado preso no banco. O agrupamento por ano evita que a lista vire uma
     fileira longa sem separação quando houver vários anos. */
  const ordenados = IR.ciclos.slice().sort((a,b)=>irCicloOrdem(b)-irCicloOrdem(a));
  const porAno = new Map();
  for(const c of ordenados){
    const ano = irCicloAno(c) || '—';
    if(!porAno.has(ano)) porAno.set(ano, []);
    porAno.get(ano).push(c);
  }
  const opcao = c=>`<option value="${c.id}" ${IR.cicloAtivo && c.id===IR.cicloAtivo.id ? 'selected' : ''}>${irCicloLabel(c)} — ${irCicloStatus(c)==='aberto'?'Aberto':'Encerrado'}</option>`;
  const grupos = Array.from(porAno.entries())
    .map(([ano, lista]) => porAno.size>1
      ? `<optgroup label="${irEsc(ano)}">${lista.map(opcao).join('')}</optgroup>`
      : lista.map(opcao).join('')).join('');
  badge.innerHTML = `<select id="cycleFilterSelect" onchange="irFiltrarCiclo(this.value)" title="Filtrar por ciclo">${grupos}</select>`;
  irRenderMonthFilter();
}
// Filtro de mês do topbar — lista os meses que o ciclo ativo realmente tem contagem
// (derivado de contadosPorDia), e aplica o intervalo do mês escolhido no mesmo
// prodFilters.de/ate que a aba Produtividade já usa. "Todos" limpa o filtro.
function irRenderMonthFilter(){
  const sel = document.getElementById('monthFilterSelect');
  if(!sel) return;
  const dias = ((IR.indicadores||{}).contadosPorDia)||[];
  const meses = Array.from(new Set(dias.map(d=>String(d.dia).slice(0,7)))).sort();
  const atual = IR.prodFilters.de ? String(IR.prodFilters.de).slice(0,7) : '';
  sel.innerHTML = `<option value="">Todos</option>` + meses.map(m=>{
    const nome = new Date(m+'-01T00:00:00').toLocaleDateString('pt-BR',{month:'long', year:'numeric'});
    return `<option value="${m}" ${m===atual?'selected':''}>${irEsc(nome.charAt(0).toUpperCase()+nome.slice(1))}</option>`;
  }).join('');
}
function irSetMonthFilter(mes){
  if(!mes){ IR.prodFilters.de = ''; IR.prodFilters.ate = ''; }
  else{
    const [ano, m] = mes.split('-').map(Number);
    IR.prodFilters.de = mes+'-01';
    IR.prodFilters.ate = mes+'-'+String(new Date(ano, m, 0).getDate()).padStart(2,'0');
  }
  irRenderView();
}
async function irFiltrarCiclo(cicloId){
  IR.cicloAtivo = IR.ciclos.find(c=>c.id===cicloId);
  IR.calMesIdx = null;
  // Meses disponíveis mudam junto com o ciclo — limpa o filtro pra não deixar um mês
  // do ciclo anterior aplicado (e inexistente) no novo.
  IR.prodFilters.de = ''; IR.prodFilters.ate = '';
  await irLoadCicloData(cicloId);
  irRenderCycleBadge();
  irRenderView();
}
function irRenderView(){
  const root = document.getElementById('viewRoot');
  /* A aba de Divergencias usa a identidade do modulo Projetos (roxo e
     navy). A troca e so de variaveis de cor, num galho so da arvore:
     as outras abas continuam com o azul e o laranja da marca. Fica antes
     de qualquer saida da funcao para valer tambem no aviso de "nenhum
     ciclo importado". */
  if(root) root.classList.toggle('tema-projetos', IR.currentTab==='divergencias');
  // Transitórios não depende de ciclo importado: é um controle próprio, não uma
  // leitura da contagem.
  const SEM_CICLO = new Set(['importacao','configuracoes']);
  const needsCiclo = !SEM_CICLO.has(IR.currentTab);
  if(needsCiclo && !IR.cicloAtivo){
    root.innerHTML = IR.initErro
      ? irEmptyState('Não foi possível ler os dados salvos',
          'Os ciclos continuam no navegador — o que falhou foi a leitura. Detalhe: '+irEsc(IR.initErro),
          'location.reload()', 'Tentar de novo')
      : irEmptyState('Nenhum ciclo importado ainda', 'Importe as planilhas na aba Importação para abrir o primeiro ciclo.', "irSwitchTab('importacao')", 'Ir para Importação');
    return;
  }
  const renderers = {
    dashboard: irRenderDashboard, ciclo: irRenderGestaoCiclo, produtividade: irRenderProdutividade,
    setores: irRenderSetores,
    divergencias: irRenderDivergencias,
    comparativo: irRenderComparativo, indicadores: irRenderIndicadores,
    importacao: irRenderImportacao, configuracoes: irRenderConfiguracoes
  };
  root.innerHTML = (renderers[IR.currentTab] || (()=>''))();
  if(IR.currentTab==='dashboard') irScrollVBarsToEnd();
  irFitKpiNumbers();
}
/* Encolhe o numero de cada tile de KPI ate ele caber na largura real disponivel.
   O grid dos blocos e auto-fit, entao a largura da tile muda de forma pouco previsivel
   conforme a tela (medido: 76px a 1500px, 86px a 1280px, 111px a 1920px) — chutar o
   tamanho da fonte pelo numero de caracteres errava nos dois sentidos, ora quebrando o
   numero no meio ("1.170.9 / 41"), ora deixando-o transbordar da tile. Aqui a medicao e
   feita no elemento real, entao vale pra qualquer valor, formato e largura de tela. */
function irFitKpiNumbers(){
  document.querySelectorAll('#viewRoot .kpi-tile').forEach(tile=>{
    const num = tile.querySelector('.num');
    if(!num) return;
    num.style.fontSize = ''; // volta ao tamanho da classe antes de medir
    const cs = getComputedStyle(tile);
    const util = tile.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if(util<=0) return;
    let size = parseFloat(getComputedStyle(num).fontSize);
    while(num.scrollWidth > util+1 && size > 9){
      size -= 0.5;
      num.style.fontSize = size+'px';
    }
  });
}
// Reajusta ao redimensionar a janela — a largura da tile muda junto.
addEventListener('resize', ()=>{
  clearTimeout(IR._fitKpiTimer);
  IR._fitKpiTimer = setTimeout(irFitKpiNumbers, 120);
});
// Gráficos "por dia" (Peças/Valor/Locais Divergentes por Dia) abrem rolados pro dia
// mais recente por padrão — é o que interessa de cara, sem precisar arrastar a barra.
function irScrollVBarsToEnd(){
  document.querySelectorAll('#viewRoot .bi-vbars-scroll').forEach(el=>{ el.scrollLeft = el.scrollWidth; });
}

/* ============================================================
   IMPORTAÇÃO
   ============================================================ */
/* Como cada base é reconhecida pelo NOME do arquivo. Um lugar só, usado pelo
   import manual e pela pasta conectada — dois lugares seria dois lugares pra
   esquecer de atualizar quando alguém renomeia uma extração.

   Os padrões são frouxos de propósito: o nome que sai do Snowflake é editado por
   quem baixa. "QRY0390" vira "QRY390 - Estoque Atual" e a 410 vira "NET - Livro
   Fiscal", sem número nenhum — por isso o apelido entra no padrão junto do
   código. */
const IR_PAT = {
  p390:  /0?390/i,
  p160:  /0?160/i,
  p410:  /(^|[^0-9])410([^0-9]|$)|livro\s*fiscal|\bnet\b/i,
  p843:  /0?843/i,
  pCong: /congelad|espelho/i,
  p278:  /278/i,
  p051:  /0?051|zbiq/i
};
const IR_FILE_TYPES = [
  // QRY0390 é opcional: o estoque é rotativo (vivo) e hoje não entra em nenhum cálculo
  // de indicador — não faz sentido travar o processamento do ciclo esperando por ela.
  {key:'f390', label:'QRY0390', desc:'Estoque por Local (opcional)', pattern:IR_PAT.p390, optional:true},
  {key:'f843', label:'QRY0843', desc:'Produtividade (peças, locais, itens e divergências)', pattern:IR_PAT.p843},
  {key:'fCong', label:'Base Congelada', desc:'Locais congelados do ciclo (planilha manual)', pattern:IR_PAT.pCong},
  {key:'f278', label:'SIGEQ278', desc:'Preço de custo/compra por item', pattern:IR_PAT.p278},
  {key:'f051', label:'ZBIQ0051', desc:'Item pai x componente (kits/múltiplos), S/N de valoração', pattern:IR_PAT.p051}
];
// Slots que aceitam vários arquivos dentro do MESMO ciclo (concatenados e deduplicados
// no worker) — úteis quando a extração de origem tem limite de linhas/tempo e precisa
// ser feita em pedaços. Cada arquivo ocupa uma "parte" numerada; reimportar na mesma
// parte troca o arquivo daquela parte. Isso NÃO tem relação com ciclo/ano — ciclos
// diferentes (ex: 2026 e 2027) são sempre importados um de cada vez, trocando os campos
// "Número do ciclo" e "Data de abertura" mais abaixo.
const IR_MULTI_KEYS = new Set(['f843', 'fCong', 'f278', 'f051']);
const IR_MULTI_DEFAULT_SLOTS = 4;
function irRenderImportacao(){
  const f = IR.files;
  const filled = (k)=> IR_MULTI_KEYS.has(k) ? (f[k]||[]).some(Boolean) : !!f[k];
  const allSelected = IR_FILE_TYPES.every(t=>t.optional || filled(t.key));
  const faltando = IR_FILE_TYPES.filter(t=>!t.optional && !filled(t.key));
  /* Uma LINHA por planilha, não um card. Com cinco cards abertos e quatro partes
     cada, a tela de importação passava de oitocentos pixels pra mostrar quatro
     nomes de arquivo. As partes ficam escondidas até serem necessárias — quem
     divide extração em pedaços é a exceção, não a regra. */
  const linha = (t)=>{
    const multi = IR_MULTI_KEYS.has(t.key);
    const slots = multi ? (f[t.key]||[]) : [];
    const arquivos = multi ? slots.filter(Boolean) : (f[t.key] ? [f[t.key]] : []);
    const ok = arquivos.length>0;
    const aberto = IR.importExpandido === t.key;
    // Um único filho na coluna do arquivo: nome e contagem de partes juntos, senão
    // o grid ganha uma célula extra e as ações caem pra linha de baixo.
    const resumo = !ok
      ? `<span class="imp-arquivo"><span class="imp-vazio">${t.optional?'opcional':'faltando'}</span></span>`
      : `<span class="imp-arquivo">
           <span class="imp-nome mono" title="${irEsc(arquivos.map(a=>a.name).join(' · '))}">${irEsc(arquivos[0].name)}</span>
           ${arquivos.length>1 ? `<span class="imp-partes">+${arquivos.length-1} parte${arquivos.length>2?'s':''}</span>` : ''}
         </span>`;
    const acoes = multi
      ? `<button class="btn-link" onclick="irImportToggle('${t.key}')">${aberto?'Fechar':'Partes'} ${aberto?'▾':'▸'}</button>`
      : (ok ? `<button class="btn-link" onclick="document.getElementById('ir-file-${t.key}').click()">Trocar</button>
              <button class="btn-link" onclick="irRemoveFile('${t.key}')">Remover</button>`
            : `<button class="btn-link" onclick="document.getElementById('ir-file-${t.key}').click()">Selecionar</button>`);
    let html = `<div class="imp-linha ${ok?'ok':(t.optional?'opt':'falta')}"
        ondragover="event.preventDefault()" ondrop="${multi?`irOnDropMultiKey(event,'${t.key}')`:`irOnDropSingle(event,'${t.key}')`}">
      <span class="imp-status">${ok?'✓':(t.optional?'·':'!')}</span>
      <span class="imp-label">${irEsc(t.label)}</span>
      <span class="imp-desc">${irEsc(t.desc)}</span>
      ${resumo}
      <span class="imp-acoes">${acoes}</span>
    </div>`;
    if(!multi) html = `<input type="file" id="ir-file-${t.key}" accept=".xlsx,.xls" style="display:none" onchange="irOnFile('${t.key}', this.files[0])">` + html;
    if(multi && aberto){
      html += `<div class="imp-partes-lista">
        <p class="field-hint">Extração que não sai de uma vez pode ser dividida aqui — todas as partes são do mesmo ciclo. Reimportar na mesma parte substitui o arquivo.</p>
        ${slots.map((file,i)=>`<div class="dz-period-row ${file?'has-file':''}">
          <span class="dz-period-label">Parte ${i+1}</span>
          <input type="file" id="ir-file-${t.key}-${i}" accept=".xlsx,.xls" style="display:none" onchange="irSetSlotFile('${t.key}', ${i}, this.files[0])">
          ${file
            ? `<span class="dz-file mono">${irEsc(file.name)}</span>
               <button class="btn-link" onclick="document.getElementById('ir-file-${t.key}-${i}').click()">Trocar</button>
               <button class="btn-link" onclick="irRemoveSlot('${t.key}', ${i})">Remover</button>`
            : `<button class="btn-link" onclick="document.getElementById('ir-file-${t.key}-${i}').click()">Selecionar</button>`}
        </div>`).join('')}
        <button class="btn-link" onclick="irAddSlot('${t.key}')">+ Adicionar parte</button>
      </div>`;
    }
    return html;
  };
  return `
    ${irRenderAvisoJanela()}
    ${irRenderPastaPanel()}
    <details class="panel imp-manual" ${IR.pastaHandle && IR.pastaPerm==='granted' ? '' : 'open'}
        ondragover="event.preventDefault()" ondrop="irOnDropMulti(event)">
      <summary>Importar planilhas à mão${IR.pastaHandle ? ' (sem usar a pasta conectada)' : ''}</summary>
      <input type="file" id="ir-file-all" accept=".xlsx,.xls" multiple style="display:none" onchange="irOnPickMultiAll(this.files)">
      <div class="imp-drop" ondragover="event.preventDefault()" ondrop="irOnDropMulti(event)"
           onclick="document.getElementById('ir-file-all').click()">
        <span class="imp-drop-icone">📂</span>
        <strong>Arraste todas as planilhas de uma vez</strong>
        <span>Cada arquivo é reconhecido pelo nome e vai pro lugar certo, inclusive quando vem em partes. Ou clique pra escolher.</span>
      </div>
      ${faltando.length ? '' : `<p class="field-hint imp-pronto">Todas as planilhas obrigatórias estão aqui.</p>`}
      <div class="imp-lista">${IR_FILE_TYPES.map(linha).join('')}</div>
      ${irRenderCicloDetectado()}
      <div class="two-col" style="margin-top:4px;">
        <div><label>Número do ciclo</label><input type="number" id="ir-inp-ciclo" min="1" value="${(()=>{
          const det = IR.cicloDetectado;
          if(det && det.numero) return det.numero;
          if(IR.cicloAtivo) return IR.cicloAtivo.numero;
          const anoAtual = new Date().getFullYear();
          const doAno = IR.ciclos.filter(c=>irCicloAno(c)===anoAtual);
          return doAno.length ? Math.max(...doAno.map(c=>c.numero))+1 : 1;
        })()}"></div>
        <div><label>Data de abertura</label><input type="date" id="ir-inp-abertura" value="${
          (IR.cicloDetectado && IR.cicloDetectado.dataAbertura) || (IR.cicloAtivo ? IR.cicloAtivo.dataAbertura : new Date().toISOString().slice(0,10))}"></div>
      </div>
      <div class="two-col">
        <div><label>Data prevista de término</label><input type="date" id="ir-inp-termino" value="${
          (IR.cicloDetectado && IR.cicloDetectado.dataPrevistaTermino) || (IR.cicloAtivo ? (IR.cicloAtivo.dataPrevistaTermino||'') : '')}"></div>
        <div></div>
      </div>
      ${IR.processing ? `
        <div class="progress-wrap">
          <div class="progress-stage">${irEsc(IR.progress.stage)}</div>
          <div class="progress-track"><div class="progress-fill orange" style="width:${IR.progress.pct}%"></div></div>
        </div>` : allSelected
          ? `<div class="form-actions"><button class="btn btn-primary" style="font-size:14px;padding:11px 28px;" onclick="irProcessar()">PROCESSAR CICLO</button></div>`
          : `<p class="field-hint" style="margin-top:14px;">Faltam ${faltando.map(t=>irEsc(t.label)).join(', ')} pra liberar o processamento.</p>`
      }
    </details>
    ${irRenderBasesAvulsas()}
    ${(()=>{ const n = irItensSemPrecoResumo();
      return n ? `<p class="field-hint imp-sem-preco">⚠️ ${irFmtInt(n)} itens divergiram em peça e ficaram sem preço — o valor divergente deles sai R$ 0,00 até a valoração ser corrigida na SIGEQ278 ou na ZBIQ0051.</p>` : ''; })()}
    ${irRenderDestino843()}
    ${irRenderDiagBanco()}
  `;
}
/* Uma linha dizendo o que o navegador realmente guardou. Quando um ciclo "some"
   da tela, é isso que separa as duas causas possíveis: o banco esvaziou de fato
   (navegador descartou os dados) ou o app não conseguiu ler o que continua lá. */
function irRenderDiagBanco(){
  const b = IR.bancoInfo || {};
  const partes = [
    `${irFmtInt((IR.ciclos||[]).length)} ciclo(s) salvos`,
    b.versao!=null ? `banco v${b.versao}` : null,
    b.persistente==null ? null : (b.persistente ? 'armazenamento protegido' : 'armazenamento não protegido — o navegador pode apagar')
  ].filter(Boolean);
  return `<p class="field-hint" style="margin-top:10px;">${irEsc(partes.join(' · '))}</p>`;
}
/* O painel de "último processamento" saiu da tela: KPIs e o diagnóstico linha a
   linha da 843 são coisa de investigação, não de rotina. O que ficou é o único
   pedaço que não era diagnóstico — o aviso de que a janela do ciclo está
   descartando contagem. Sem ele o número simplesmente congela a cada nova
   importação, sem nenhuma pista do porquê, que foi exatamente o que levou a
   criar esse bloco. */
function irRenderAvisoJanela(){
  const m = IR.importMeta;
  if(!m || m.totalLinhas843 == null) return '';
  const hoje = new Date().toISOString().slice(0,10);
  const janelaVencida = m.janelaTermino && m.janelaTermino < hoje;
  const perdendoContagem = m.dataMaisRecenteForaDaJanela && m.dataMaisRecenteAceita &&
                           m.dataMaisRecenteForaDaJanela > m.dataMaisRecenteAceita;
  if(!janelaVencida && !perdendoContagem) return '';
  const d = s => s ? irFmtDate(s) : '—';
  /* Sem a data que ficou de fora não há o que citar: o aviso ficava com um
     travessão no meio da frase ("traz contagem de até —"), que não diz nada.
     Nesse caso só a janela vencida é fato, e é só isso que o texto afirma. */
  const detalhe = perdendoContagem && m.dataMaisRecenteForaDaJanela
    ? `, e a 843 traz contagem de até <b>${d(m.dataMaisRecenteForaDaJanela)}</b> que ficou de fora por estar depois do término previsto`
    : ', que já venceu';
  return `<div class="callout callout-warn">
    <strong>⚠️ A janela deste ciclo está barrando contagens.</strong>
    O ciclo vai de <b>${d(m.janelaAbertura)}</b> até <b>${d(m.janelaTermino)}</b>${detalhe}.
    Tudo que for contado a partir de agora vai continuar sendo ignorado e os números não vão mudar.
    <b>Corrija o Término Previsto do ciclo</b> na tela de ciclos e reprocesse.
  </div>`;
}
/* O destino das linhas da QRY0843, em uma linha.

   "Contei no dia X e o dia X não apareceu no gráfico" não tinha resposta na tela:
   o processamento já contava quantas linhas caíram em cada filtro, mas nenhum
   desses números chegava a lugar nenhum. Aqui eles aparecem, junto com a última
   data do arquivo e a última aceita — que é o par que resolve a dúvida na hora:
   se a última do arquivo é maior que a aceita, o dia existe e foi descartado; se
   as duas são menores que o dia procurado, o arquivo é que não tem aquele dia. */
function irRenderDestino843(){
  const m = IR.importMeta;
  if(!m || m.totalLinhas843 == null) return '';
  // Linha não liquidada deixou de ser descartada: ela é gravada e alimenta só a
  // produtividade individual. Chamá-la de "descartada" aqui seria mentira.
  const desc = [
    ['fora da janela do ciclo', m.linhasForaDaJanela],
    ['motivo fora do NET', m.linhasForaDoNet],
    ['sem data utilizável', m.linhasSemDataDescartadas]
  ].filter(([,n])=>n>0);
  const total = m.totalLinhas843||0;
  const naoLiq = m.linhasNaoLiquidadas||0;
  const aceitas = total - desc.reduce((s,[,n])=>s+n,0);
  const d = s => s ? irFmtDate(s) : '—';
  return `<p class="field-hint" style="margin-top:10px;">
    QRY0843: ${irFmtInt(total)} linhas · ${irFmtInt(aceitas)} aceitas${m.dataMaisRecenteAceita?' (última contagem em '+d(m.dataMaisRecenteAceita)+')':''}${
      desc.length?' · descartadas: '+desc.map(([r,n])=>irFmtInt(n)+' '+r).join(', '):''}${
      naoLiq?' · '+irFmtInt(naoLiq)+' ainda não liquidadas (contam só na produtividade individual)':''}.${
      m.dataMaisRecenteNoArquivo ? ' Data mais recente no arquivo: <b>'+d(m.dataMaisRecenteNoArquivo)+'</b>.' : ''}
  </p>`;
}
/* Aviso do ciclo lido da 843. Diz de onde veio a leitura e se ela vai criar um
   ciclo novo ou regravar um que já existe — regravar por engano era o risco de
   deixar o número no chute do usuário. */
function irRenderCicloDetectado(){
  const cabecalho = '<p class="field-hint imp-secao"><strong>Ciclo deste processamento</strong></p>';
  if(IR.detectandoCiclo) return cabecalho+'<p class="field-hint">Lendo a QRY0843 pra identificar o ciclo...</p>';
  const d = IR.cicloDetectado;
  if(!d) return cabecalho;
  if(d.erro) return cabecalho+`<p class="field-hint neg">Não deu pra identificar o ciclo: ${irEsc(d.erro)} — preencha à mão.</p>`;
  const existente = IR.ciclos.find(c=>c.numero===d.numero && irCicloAno(c)===d.ano);
  const fonte = d.origem==='obs'
    ? `Obs Inventário (${irFmtInt((d.votos[0]||{}).linhas||0)} de ${irFmtInt(d.linhas)} linhas)`
    : `trimestre das contagens (Q${d.trimestre})`;
  return cabecalho+`<div class="det-ciclo ${existente?'regrava':''}">
    <strong>Ciclo ${d.numero}/${d.ano}</strong>
    <span>${irFmtDate(d.dataAbertura)} a ${irFmtDate(d.dataPrevistaTermino)} · identificado pela ${irEsc(fonte)}</span>
    <span>${existente ? 'Já existe — processar vai <strong>regravar</strong> esse ciclo.' : 'Ciclo novo — será criado na lista de ciclos.'}</span>
  </div>`;
}
function irImportToggle(key){ IR.importExpandido = IR.importExpandido===key ? null : key; irRenderView(); }
function irClassifyFile(file){
  const t = IR_FILE_TYPES.find(t=>t.pattern.test(file.name));
  return t ? t.key : null;
}
function irOnFile(key, file){ if(!file) return; IR.files[key] = file; irRenderView(); }
function irRemoveFile(key){ IR.files[key] = null; irRenderView(); }
// Slots multi-arquivo: cada posição do array é uma "parte" do mesmo ciclo — pode estar
// vazia (null) até o usuário selecionar um arquivo pra ela. Reimportar na mesma posição substitui.
function irSetSlotFile(key, index, file){
  if(!file) return;
  if(!IR.files[key]) IR.files[key] = [];
  IR.files[key][index] = file;
  irRenderView();
  if(key==='f843') irDetectarCiclo843();
}
/* Lê a 843 anexada num worker e pré-preenche o ciclo. O usuário continua podendo
   trocar na mão — a detecção é sugestão, não trava. */
function irDetectarCiclo843(){
  const bufsPromise = IR.files.f843.filter(Boolean).map(f=>f.arrayBuffer());
  if(!bufsPromise.length){ IR.cicloDetectado = null; irRenderView(); return; }
  IR.detectandoCiclo = true; IR.cicloDetectado = null; irRenderView();
  Promise.all(bufsPromise).then(bufs=>{
    const worker = irNovoWorker();
    worker.onmessage = ev=>{
      if(ev.data.type!=='done843detect') return;
      worker.terminate();
      IR.detectandoCiclo = false;
      IR.cicloDetectado = ev.data.erro ? {erro:ev.data.erro}
        : Object.assign({}, ev.data, {dataPrevistaTermino: irTerminoDoCiclo(ev.data)});
      irRenderView();
    };
    worker.onerror = ()=>{ worker.terminate(); IR.detectandoCiclo=false; irRenderView(); };
    worker.postMessage({type:'detect843', bufs843:bufs}, bufs);
  }).catch(()=>{ IR.detectandoCiclo=false; irRenderView(); });
}
function irRemoveSlot(key, index){
  IR.files[key].splice(index, 1);
  if(!IR.files[key].length) IR.files[key].push(null);
  irRenderView();
  if(key==='f843') irDetectarCiclo843();
}
function irAddSlot(key){
  IR.files[key].push(null);
  irRenderView();
}
// Encaixa arquivos soltos nas primeiras partes vazias; cria partes novas se faltar espaço.
function irAssignFilesToSlots(key, files){
  if(!files.length) return;
  if(!IR.files[key]) IR.files[key] = [];
  const arr = IR.files[key];
  let fi = 0;
  for(let i=0; i<arr.length && fi<files.length; i++){
    if(!arr[i]) arr[i] = files[fi++];
  }
  while(fi<files.length) arr.push(files[fi++]);
  irRenderView();
}
function irOnDropMultiKey(e, key){
  e.preventDefault();
  irAssignFilesToSlots(key, Array.from(e.dataTransfer.files||[]));
}
function irOnDropSingle(e, key){
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if(file) irOnFile(key, file);
}
// Identifica cada arquivo pelo nome e joga no slot certo — usado tanto ao arrastar
// quanto ao escolher vários arquivos de uma vez pelo seletor nativo do sistema.
function irClassifyAndAssignFiles(files){
  if(!files.length) return;
  let matched = 0, unmatched = [];
  const porChave = {};
  for(const file of files){
    const key = irClassifyFile(file);
    if(key && IR_MULTI_KEYS.has(key)){ (porChave[key]=porChave[key]||[]).push(file); matched++; }
    else if(key){ IR.files[key] = file; matched++; }
    else unmatched.push(file.name);
  }
  for(const key in porChave) irAssignFilesToSlots(key, porChave[key]);
  irRenderView();
  if(matched) irShowToast(matched+' arquivo(s) reconhecido(s) automaticamente.');
  if(unmatched.length) irShowToast('Não consegui identificar: '+unmatched.join(', ')+'. Selecione manualmente.', true);
}
function irOnDropMulti(e){
  e.preventDefault();
  irClassifyAndAssignFiles(Array.from(e.dataTransfer.files || []));
}
function irOnPickMultiAll(fileList){
  irClassifyAndAssignFiles(Array.from(fileList || []));
}
/* Processa UM ciclo. Separado da tela de propósito: a importação por pasta
   precisa rodar vários ciclos em fila, um atrás do outro, sem ler input nenhum.
   Devolve uma promessa que resolve true/false — é o que a fila espera pra saber
   se continua ou para. */
function irProcessarCiclo(op){
  if(IR.processing) return Promise.resolve(false);
  const files843 = (op.files843||[]).filter(Boolean), filesCong = (op.filesCong||[]).filter(Boolean),
        files278 = (op.files278||[]).filter(Boolean), files051 = (op.files051||[]).filter(Boolean);
  if(!(files843.length && filesCong.length && files278.length && files051.length)) return Promise.resolve(false);
  const numero = op.numero, dataAbertura = op.dataAbertura, dataPrevistaTermino = op.dataPrevistaTermino;
  if(!numero || !dataAbertura){ irShowToast('Informe o número do ciclo e a data de abertura.', true); return Promise.resolve(false); }

  // Ciclo é identificado por número + ano (não só o número) — evita que
  // "Ciclo 1" de um ano novo sobrescreva o "Ciclo 1" de um ano anterior.
  const anoNovo = irCicloAno({dataAbertura});
  const existente = IR.ciclos.find(c=>c.numero===numero && irCicloAno(c)===anoNovo);
  const cicloId = existente ? existente.id : 'ciclo-'+numero+'-'+anoNovo+'-'+Date.now().toString(36);
  const ciclo = {
    id: cicloId, numero, dataAbertura, dataPrevistaTermino: dataPrevistaTermino||null,
    dataEncerramento: existente ? existente.dataEncerramento : null,
    status: existente ? existente.status : 'aberto'
  };

  IR.processing = true; IR.progress = {stage:'Lendo arquivos...', pct:0};
  irRenderView();
  let _fim; const _p = new Promise(r=>{ _fim = r; });
  (async ()=>{
  try{
    const [buf390, bufs843, bufsCongelada, bufs278, bufs051] = await Promise.all([
      op.f390 ? op.f390.arrayBuffer() : Promise.resolve(null),
      Promise.all(files843.map(file=>file.arrayBuffer())),
      Promise.all(filesCong.map(file=>file.arrayBuffer())),
      Promise.all(files278.map(file=>file.arrayBuffer())),
      Promise.all(files051.map(file=>file.arrayBuffer()))
    ]);
    const worker = irNovoWorker();
    worker.onmessage = async (e)=>{
      const msg = e.data;
      if(msg.type==='progress'){ IR.progress = {stage:msg.stage, pct:msg.pct}; irUpdateProgressUI(); }
      else if(msg.type==='error'){
        IR.processing=false; worker.terminate();
        irShowToast('Erro no processamento: '+msg.message, true); irRenderView(); _fim(false);
      } else if(msg.type==='done'){
        IR.processing = false; worker.terminate();
        await irSaveCiclo(ciclo);
        // Processar um ciclo fecha os anteriores no registro, não só na exibição.
        // A data de encerramento vira a abertura deste, que é o que de fato
        // aconteceu: o ciclo anterior acabou quando o novo começou.
        const ordemNovo = irCicloOrdem(ciclo);
        for(const velho of IR.ciclos){
          if(irCicloOrdem(velho) >= ordemNovo || velho.status === 'encerrado') continue;
          velho.status = 'encerrado';
          if(!velho.dataEncerramento) velho.dataEncerramento = ciclo.dataAbertura;
          await irSaveCiclo(velho);
        }
        if(op.limparFiles) IR.files = {f390:null, f843:[null,null,null,null], fCong:[null,null,null,null], f278:[null,null,null,null], f051:[null,null,null,null]};
        IR.ciclos = await irGetAllCiclos();
        IR.cicloAtivo = IR.ciclos.find(c=>c.id===cicloId);
        await irLoadCicloData(cicloId);
        irShowToast('✓ Ciclo '+numero+'/'+anoNovo+' processado: '+irFmtInt(msg.totalLocais)+' locais, '+irFmtInt(msg.totalDivergencias)+' itens divergentes.');
        if(op.abrirDashboard) irSwitchTab('dashboard'); else irRenderView();
        _fim(true);
      }
    };
    worker.onerror = (err)=>{ IR.processing=false; irShowToast('Erro no worker: '+err.message, true); irRenderView(); _fim(false); };
    worker.postMessage({
      type:'process', buf390, bufs843, bufsCongelada, bufs278, bufs051,
      cicloId, cicloNumero:numero, dataAbertura, dataPrevistaTermino,
      prioridadeConfig: IR.prioridadeConfig
    }, [...(buf390 ? [buf390] : []), ...bufs843, ...bufsCongelada, ...bufs278, ...bufs051]);
  }catch(err){
    IR.processing=false; irShowToast('Erro ao ler arquivos: '+err.message, true); irRenderView(); _fim(false);
  }
  })();
  return _p;
}
// Botão PROCESSAR CICLO da importação manual: lê os campos da tela e delega.
async function irProcessar(){
  const f = IR.files;
  const numero = parseInt(document.getElementById('ir-inp-ciclo').value, 10);
  const dataAbertura = document.getElementById('ir-inp-abertura').value;
  const dataPrevistaTermino = document.getElementById('ir-inp-termino').value;
  return irProcessarCiclo({
    numero, dataAbertura, dataPrevistaTermino, f390:f.f390,
    files843:f.f843, filesCong:f.fCong, files278:f.f278, files051:f.f051,
    limparFiles:true, abrirDashboard:true
  });
}
function irUpdateProgressUI(){
  const stageEl = document.querySelector('.progress-stage');
  const fillEl = document.querySelector('.progress-fill');
  if(stageEl && fillEl){ stageEl.textContent = IR.progress.stage; fillEl.style.width = IR.progress.pct+'%'; }
  else irRenderView();
}
function irUpdateProgressUI410(){
  const stageEl = document.querySelector('.progress-stage');
  const fillEl = document.querySelector('.progress-fill');
  if(stageEl && fillEl){ stageEl.textContent = IR.net410Progress.stage; fillEl.style.width = IR.net410Progress.pct+'%'; }
  else irRenderView();
}

/* ============================================================
   DASHBOARD EXECUTIVO
   ============================================================ */
function irKpiTile(icon, val, label, cls, hint){
  // Valores longos (ex.: "R$ 114.927.853,46") quebravam no meio do número com o
  // tamanho de fonte padrão — reduz a fonte quando o texto passa de um limiar, em vez
  // de deixar o overflow-wrap partir dígitos no meio.
  // Limiares medidos no navegador: na largura de tela mais apertada a tile util fica
  // com ~84px, e a fonte mono 800 ocupa ~10,2px/char a 17px, ~8,4 a 14px, ~7,2 a 12px.
  // Dai os cortes abaixo — sem eles o numero quebrava no meio (ex.: "1.170.9 / 41").
  const tamanho = String(val).replace(/<[^>]*>/g,'').length;
  const numCls = tamanho>12 ? 'num-xs' : (tamanho>10 ? 'num-sm' : (tamanho>8 ? 'num-md' : ''));
  return `<div class="kpi-tile"><div class="kt-icon">${icon}</div><div class="num mono ${numCls} ${cls||''}">${val}</div><div class="label">${label}</div>${hint?`<div class="meta-hint">${hint}</div>`:''}</div>`;
}
function irKpiBlock(theme, icon, title, tilesHtml){
  return `<div class="kpi-block theme-${theme}">
    <div class="kpi-block-header"><span class="bh-icon">${icon}</span>${title}</div>
    <div class="kpi-block-body">${tilesHtml}</div>
  </div>`;
}
const IR_INDICADORES_VERSION = 17; // mantido em sincronia com worker.js
/* Versão do app, em sincronia com o CACHE_VERSION do sw.js. Ela vai na URL do
   Worker porque o navegador guarda js/worker.js no cache HTTP por conta própria:
   depois de um deploy, a página já vinha nova e o Worker continuava sendo o
   antigo, então o ciclo era reprocessado com o motor velho e o número não mudava.
   Com a versão na query, cada deploy é uma URL nova e o cache não alcança. */
const IR_APP_VERSION = 'v177';
function irNovoWorker(){ return new Worker('js/worker.js?v=' + IR_APP_VERSION); }
/* Ciclo calculado por um motor antigo é recalculado sozinho, com os dados que já
   estão no navegador.

   Os indicadores ficam gravados por ciclo. Quando uma regra de cálculo muda, o
   número na tela continua o da régua velha até alguém lembrar de reprocessar a
   planilha — e nada na tela diz isso. Como a base congelada, as contagens e as
   divergências estão no IndexedDB, dá pra refazer a conta sem pedir o arquivo. */
async function irRecalcularSeMotorAntigo(){
  if(IR._recalculando) return;
  /* Todos os ciclos, não só o aberto. A acurácia anual e o comparativo somam os
     indicadores gravados de cada ciclo: se um ciclo continuasse na régua antiga,
     o número do ano seria uma mistura de duas réguas — pior que um número velho,
     porque não dá pra saber de qual regra ele veio. O ciclo ativo vai primeiro,
     que é o que está na tela. */
  const pendentes = [];
  for(const c of (IR.ciclos||[])){
    const ind = await irGetIndicadores(c.id);
    if(ind && ind._v !== IR_INDICADORES_VERSION) pendentes.push(c);
  }
  if(!pendentes.length) return;
  const ativoId = (IR.cicloAtivo||{}).id;
  pendentes.sort((a,b)=> (b.id===ativoId) - (a.id===ativoId));
  IR._recalculando = true;
  irShowToast('Regra de cálculo mudou — recalculando '+pendentes.length+' ciclo(s)...');
  let falhou = 0;
  for(const c of pendentes){
    const ok = await irRecalcularCiclo(c.id);
    if(!ok) falhou++;
    if(c.id === ativoId){
      // Atualiza a tela assim que o ciclo aberto fica pronto, sem esperar o resto.
      IR.indicadores = await irGetIndicadores(c.id);
      irRenderView();
    }
  }
  IR.comparativoCiclos = null;
  await irCarregarComparativoCiclos();
  IR._recalculando = false;
  irRenderView();
  irShowToast(falhou
    ? (pendentes.length-falhou)+' ciclo(s) recalculado(s); '+falhou+' sem dados salvos — reprocesse na Importação.'
    : 'Ciclo(s) recalculado(s).', !!falhou);
}
function irRecalcularCiclo(cicloId){
  return new Promise(resolve=>{
    const w = irNovoWorker();
    w.onmessage = (e)=>{
      const m = e.data;
      if(m.type === 'doneRecalculo'){ w.terminate(); resolve(true); }
      else if(m.type === 'erroRecalculo'){ w.terminate(); resolve(false); }
    };
    w.onerror = ()=>{ w.terminate(); resolve(false); };
    w.postMessage({type:'recalcular', cicloId});
  });
}
// Versão no rodapé do menu: sem ela não dá pra saber, olhando a tela, se o
// navegador está com a build nova depois de um deploy.
function irMostrarVersao(){
  const el = document.getElementById('sidebarVersao');
  if(el) el.textContent = IR_APP_VERSION + ' · motor ' + IR_INDICADORES_VERSION;
}
// Filtro de data — só afeta a Produtividade, por isso fica logo acima do gráfico
// dela em vez de junto com o seletor de Ciclo (que é global pro Dashboard inteiro).
function irRenderDashDateFilterBar(){
  return `<div class="panel dash-filter-bar">
    <div class="dash-filter-group">
      <label>Período</label>
      <input type="date" value="${irEsc(IR.prodFilters.de)}" onchange="irProdSetFilter('de', this.value)">
      <span class="dash-filter-sep">–</span>
      <input type="date" value="${irEsc(IR.prodFilters.ate)}" onchange="irProdSetFilter('ate', this.value)">
      ${(IR.prodFilters.de||IR.prodFilters.ate) ? `<button class="btn-link" onclick="irProdSetFilter('de','');IR.prodFilters.ate='';irRenderView();">Limpar</button>` : ''}
    </div>
    <div class="dash-filter-group dash-filter-scope">
      <label>Aplicar período em</label>
      <button type="button" class="dash-filter-chip ${IR.dashFilters.applyProdDate?'active':''}" onclick="irToggleDashDateScope('applyProdDate')">Produtividade</button>
    </div>
  </div>`;
}
function irRenderDashboard(){
  const ind = IR.indicadores;
  if(!ind) return irEmptyState('Sem indicadores', 'Processe o ciclo na Importação.', "irSwitchTab('importacao')", 'Ir para Importação');
  if(IR.comparativoCiclos===null) irCarregarComparativoCiclos(); // async — re-renderiza quando chegar
  // Cada bloco tem sempre 3 bullets, no mesmo formato: ícone + acurácia (com meta),
  // + volume principal, + divergência/pendência. Os demais indicadores (itens
  // divergentes, recontagens, tempo médio etc.) continuam na aba Indicadores.
  const metaHint = `Meta: ${irFmtPct(ind.meta)}`;
  // O número que acompanha a meta é a taxa de CANCELAMENTO: locais cuja contagem
  // começou e foi interrompida antes de fechar (ex.: precisava coletar) sobre o
  // total de locais orçados do ciclo. Já foi rotulado como "Recontagem", o que
  // estava errado — recontagem é local que passou da rodada 2 (ind.qtdRecontagens,
  // exibido no bloco Locais). São coisas diferentes e não devem dividir o rótulo.
  const cancelHint = `Cancelamento: ${irFmtPct(ind.taxaCancelamento||0)}`;
  // Denominador das acurácias = SALDO LÓGICO (rodada 1), não o total contado exibido
  // ao lado. Sem essa dica o card mostra dois números com que é impossível refazer a
  // conta: 1 − divergentes ÷ contadas não reproduz a acurácia. Mostra a base junto.
  const basePecasHint = ind.pecasSaldoLogico ? `base: ${irFmtInt(ind.pecasSaldoLogico)} pç` : '';
  const baseValorHint = ind.valorSaldoLogico ? `base: ${irFmtMoneyInt(ind.valorSaldoLogico)}` : '';
  const blocoPecas = irKpiBlock('orange','📦','Peças',
    irKpiTile('🎯', irFmtPct(ind.acuraciaPecas), 'Acurácia Peças', ind.acuraciaPecas>=ind.meta?'good':'bad', metaHint+' · '+cancelHint) +
    irKpiTile('📦', irFmtInt(ind.pecasContadas), 'Peças Contadas', '', 'total físico'+(basePecasHint?' · '+basePecasHint:'')) +
    irKpiTile('⚠️', irFmtInt(ind.pecasDivergentes), 'Peças Divergentes', 'bad', irFmtInt(ind.itensDivergentes)+' itens × locais')
  );
  const blocoLocais = irKpiBlock('blue','📍','Locais',
    irKpiTile('🎯', irFmtPct(ind.acuraciaLocal), 'Acurácia Local', ind.acuraciaLocal>=ind.meta?'good':'bad', metaHint+' · base: '+irFmtInt(ind.locaisContadosTotal)+' contados') +
    irKpiTile('✅', irFmtInt(ind.locaisConcluidos), 'Concluídos', '', 'de '+irFmtInt(ind.locaisContadosTotal)+' contados') +
    irKpiTile('⏳', irFmtInt(ind.locaisPendentes), 'Pendentes', 'bad', irFmtInt(ind.qtdRecontagens)+' recontagens · '+cancelHint)
  );
  const blocoValor = irKpiBlock('black','💰','Valor',
    irKpiTile('🎯', irFmtPct(ind.acuraciaValor), 'Acurácia Valor', ind.acuraciaValor>=ind.meta?'good':'bad', metaHint+' · '+cancelHint) +
    irKpiTile('💰', irFmtMoneyCompact(ind.valorFisicoTotal), 'Valor Contado', '', irFmtMoneyInt(ind.valorFisicoTotal)+(baseValorHint?' · '+baseValorHint:'')) +
    irKpiTile('⚠️', irFmtMoneyCompact(ind.valorDivergenteAbsoluto), 'Valor Divergente', 'bad', irFmtMoneyInt(ind.valorDivergenteAbsoluto))
  );
  const blocoCiclo = irKpiBlock('neutral','🔄','Ciclo',
    irKpiTile('📊', irFmtPct(ind.andamentoCiclo), 'Andamento', '', irFmtInt(ind.locaisConcluidos)+' de '+irFmtInt(ind.locaisCongelados)) +
    irKpiTile('📅', ind.diasRestantes===null?'—':irFmtInt(ind.diasRestantes), 'Dias Restantes', '', 'dias úteis · exclui feriados') +
    irKpiTile('⚡', irFmtPct(ind.eficiencia), 'Eficiência', ind.eficiencia>=0.8?'good':(ind.eficiencia<0.5?'bad':''), 'qualidade x velocidade')
  );
  return `
    <div class="form-actions" style="margin:0 0 12px;">
      <button class="btn btn-secondary" onclick="irGerarRelatorioEmail()">📧 Preparar boletim para enviar por e-mail</button>
    </div>
    <div class="kpi-blocks">
      ${blocoPecas}${blocoLocais}${blocoValor}${blocoCiclo}
    </div>
    <div class="bi-grid-2">
      ${irRenderAcuraciaAnualPanel()}
      ${irRenderStatusInventarioPanel(ind)}
    </div>
    ${irRenderPorLogPanel(ind)}
    ${irRenderContadosPorDiaPanel(ind)}
    ${irRenderDivergentesPorDiaPanel(ind)}
    ${irRenderLogTablePanel(ind)}
    ${irRenderEvolucaoMensalPanel(ind)}
  `;
}
/* ============================================================
   Acurácia mensal — Peças, Locais e Valor (modelo "A3" aprovado)
   Por mês: duas colunas na MESMA escala (contado x divergente) e, no rodapé,
   uma faixa 95%→100% com a marca da meta mostrando a acurácia do mês.
   Cada métrica usa a cor padrão do Dashboard (Peças laranja, Locais azul,
   Valor grafite); a coluna de divergência usa o vermelho de alerta — no caso
   de Peças, um vermelho mais escuro, porque o laranja padrão e o vermelho
   padrão são indistinguíveis lado a lado (inclusive para daltônicos).
   ============================================================ */
const IR_MES_SERIES = {
  pecas:  {titulo:'Peças',  rotContado:'Peças contadas',  rotDiv:'Peças divergentes',
           cont:'var(--mes-pecas-cont)',  div:'var(--mes-pecas-div)',  acc:'var(--mes-pecas-cont)'},
  locais: {titulo:'Locais', rotContado:'Locais contados', rotDiv:'Locais divergentes',
           cont:'var(--mes-locais-cont)', div:'var(--mes-locais-div)', acc:'var(--mes-locais-cont)'},
  valor:  {titulo:'Valor',  rotContado:'Valor contado',   rotDiv:'Valor divergente',
           cont:'var(--mes-valor-cont)',  div:'var(--mes-valor-div)',  acc:'var(--mes-valor-cont)'}
};
const IR_MES_ABREV = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
function irMesLabel(mes){
  const [a,m] = String(mes||'').split('-');
  const i = parseInt(m,10)-1;
  return (IR_MES_ABREV[i]||m||'?')+'/'+String(a||'').slice(2);
}
// Acurácia null = mês sem base de cálculo. Na tabela vira traço, não "0,0%".
function irFmtPctOuTraco(v){ return v==null ? '—' : irFmtPct(v); }
/* Gráfico mensal de UMA métrica. `rows` = [{mes, contado, divergente, acuracia}],
   com acuracia null quando o mês não tem base pra calcular. */
/* Piso da faixa de acurácia. Padrão 95%, mas desce se algum mês ficar abaixo
   disso — senão a barrinha do mês pior vira um toco de 3px e não dá pra
   comparar nada (Acurácia Local costuma rodar na casa dos 93%). */
function irMesAccFloor(rows){
  // Mês sem base (acuracia null) fica de fora: ele não tem acurácia ruim, ele não
  // tem acurácia nenhuma — e deixá-lo entrar zerava o piso e achatava a régua.
  const validas = rows.map(r=>r.acuracia).filter(a=>a!=null);
  const min = Math.min(...validas, 0.95);
  return Math.max(0, Math.floor(min*100)/100 - 0.01);
}
function irBuildEvolucaoMensalSvg(rows, cfg, fmtVal){
  const meta = IR_META_ACURACIA;
  const lo = irMesAccFloor(rows);
  const W=1080, padL=86, padR=16, padT=26;
  const plotH=186, baseY=padT+plotH, plotW=W-padL-padR;
  const accTop=baseY+58, H=accTop+42;
  const maxVal = Math.max(...rows.map(r=>r.contado), 1)*1.05;
  const step = plotW/rows.length;
  const bw = Math.min(24, Math.max(10, step/3.2)), gapIn = 6;
  /* Altura pela raiz quadrada do valor. No linear, divergente ao lado de contado
     é sempre um toco: 50.846 contra 973.436 dá 5% da altura da barra vizinha, e
     a comparação mês a mês — que é pra que o gráfico existe — não se fazia. A
     raiz aproxima as duas sem igualá-las (os mesmos números viram 23%), então
     continua na cara qual é qual. As linhas de grade vão nos mesmos valores de
     sempre, só que nas posições da nova escala: elas se fecham em direção ao
     topo, que é o aviso visual de que o eixo não é linear. */
  const alt = v => (Math.sqrt(Math.max(0, v))/Math.sqrt(maxVal))*plotH;
  let grid='', bars='', faixa='';
  for(let i=0;i<=4;i++){
    const v = maxVal*i/4, y = baseY-alt(v);
    grid += `<line x1="${padL}" x2="${W-padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="mes-grid"/>`
         +  `<text x="${padL-9}" y="${(y+3.5).toFixed(1)}" text-anchor="end" class="mes-axis">${irEsc(fmtVal(v))}</text>`;
  }
  rows.forEach((r,i)=>{
    const cx = padL+step*i+step/2;
    const x1 = cx-bw-gapIn/2, x2 = cx+gapIn/2;
    const hC = alt(r.contado);
    const hD = Math.max(alt(r.divergente), 2);
    bars += `<rect x="${x1.toFixed(1)}" y="${(baseY-hC).toFixed(1)}" width="${bw.toFixed(1)}" height="${hC.toFixed(1)}" rx="4" fill="${cfg.cont}"><title>${irEsc(irMesLabel(r.mes))} — ${irEsc(cfg.rotContado)}: ${irEsc(fmtVal(r.contado))}</title></rect>`
         +  `<rect x="${x2.toFixed(1)}" y="${(baseY-hD).toFixed(1)}" width="${bw.toFixed(1)}" height="${hD.toFixed(1)}" rx="4" fill="${cfg.div}"><title>${irEsc(irMesLabel(r.mes))} — ${irEsc(cfg.rotDiv)}: ${irEsc(fmtVal(r.divergente))}</title></rect>`
         // Rótulos ancorados nas bordas EXTERNAS do par (contado alinhado à direita,
         // divergente à esquerda), não centralizados: rótulo largo — valor em R$, por
         // exemplo — centralizado invade a coluna vizinha.
         +  `<text x="${(x1+bw).toFixed(1)}" y="${(baseY-hC-7).toFixed(1)}" text-anchor="end" class="mes-val">${irEsc(fmtVal(r.contado))}</text>`
         +  `<text x="${x2.toFixed(1)}" y="${(baseY-hD-7).toFixed(1)}" text-anchor="start" class="mes-val">${irEsc(fmtVal(r.divergente))}</text>`
         +  `<text x="${cx.toFixed(1)}" y="${(baseY+22).toFixed(1)}" text-anchor="middle" class="mes-mon">${irEsc(irMesLabel(r.mes))}</text>`;
    // Faixa de acurácia: escala do piso → 100%, com traço na meta.
    // Mês sem base de cálculo (acuracia null) não tem acurácia: mostra o trilho vazio
    // e um traço no lugar do número. Pintar "0,0%" em vermelho aqui dizia que o mês
    // foi péssimo, quando ele só não tem o que medir ainda.
    const semDado = r.acuracia == null;
    const frac = semDado ? 0 : Math.max(0, Math.min(1, (r.acuracia-lo)/(1-lo)));
    const tw = Math.min(78, step*0.72), tx = cx-tw/2, ok = !semDado && r.acuracia>=meta;
    const mx = tx+tw*Math.max(0, Math.min(1,(meta-lo)/(1-lo)));
    const dica = semDado ? `${irEsc(irMesLabel(r.mes))}: sem base de cálculo no mês`
                         : `Acurácia ${irEsc(irMesLabel(r.mes))}: ${irFmtPct(r.acuracia)} (meta ${irFmtPct(meta)})`;
    faixa += `<rect x="${tx.toFixed(1)}" y="${accTop}" width="${tw.toFixed(1)}" height="7" rx="3.5" fill="var(--surface2)"><title>${dica}</title></rect>`
          +  (semDado ? '' : `<rect x="${tx.toFixed(1)}" y="${accTop}" width="${Math.max(tw*frac,3).toFixed(1)}" height="7" rx="3.5" fill="${ok?cfg.acc:'var(--danger)'}"><title>${dica}</title></rect>`)
          +  `<line x1="${mx.toFixed(1)}" x2="${mx.toFixed(1)}" y1="${accTop-3}" y2="${accTop+10}" class="mes-meta"/>`
          +  `<text x="${cx.toFixed(1)}" y="${accTop+27}" text-anchor="middle" class="mes-acc ${semDado?'vazio':(ok?'ok':'bad')}">${semDado?'—':irFmtPct(r.acuracia)}</text>`;
  });
  return `<div class="mes-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Acurácia mensal de ${irEsc(cfg.titulo)}">
    ${grid}${bars}
    <line x1="${padL}" x2="${W-padR}" y1="${baseY}" y2="${baseY}" class="mes-grid"/>
    <text x="${padL-9}" y="${accTop-8}" text-anchor="end" class="mes-band">ACURÁCIA</text>
    ${faixa}
  </svg></div>`;
}
function irEvolucaoMensalBloco(rows, cfg, fmtVal){
  return `<div class="mes-bloco">
    <div class="mes-legend">
      <span class="mes-lg"><span class="mes-sw" style="background:${cfg.cont}"></span>${irEsc(cfg.rotContado)}</span>
      <span class="mes-lg"><span class="mes-sw" style="background:${cfg.div}"></span>${irEsc(cfg.rotDiv)}</span>
      <span class="mes-legend-right">Acurácia na faixa ${irFmtPct(irMesAccFloor(rows))}→100% · traço = meta ${irFmtPct(IR_META_ACURACIA)}</span>
    </div>
    ${irBuildEvolucaoMensalSvg(rows, cfg, fmtVal)}
  </div>`;
}
/* Une o porMes de todos os ciclos do ano. Cada ciclo cobre um trimestre, então
   na prática é concatenação — mas soma por mês mesmo assim, pra um mês que caia
   na virada de dois ciclos não aparecer duas vezes. A acurácia é recalculada do
   total somado, não herdada do ciclo. */
function irPorMesDoAno(ano){
  const pares = (IR.comparativoCiclos||[]).filter(({ciclo}) => irCicloAno(ciclo) === ano);
  const acc = new Map();
  for(const {ind} of pares){
    for(const m of ((ind&&ind.porMes)||[])){
      if(!acc.has(m.mes)) acc.set(m.mes, {mes:m.mes, pecasContadas:0, pecasSaldoLogico:0, pecasDivergentes:0,
        locaisContados:0, locaisDivergentes:0, valorContado:0, valorSaldoLogico:0, valorDivergente:0});
      const a = acc.get(m.mes);
      a.pecasContadas += m.pecasContadas||0;   a.pecasDivergentes += m.pecasDivergentes||0;
      a.pecasSaldoLogico += (m.pecasSaldoLogico!=null ? m.pecasSaldoLogico : (m.pecasContadas||0));
      a.locaisContados += m.locaisContados||0; a.locaisDivergentes += m.locaisDivergentes||0;
      a.valorContado += m.valorContado||0;     a.valorDivergente += m.valorDivergente||0;
      a.valorSaldoLogico += (m.valorSaldoLogico!=null ? m.valorSaldoLogico : (m.valorContado||0));
    }
  }
  return Array.from(acc.values()).sort((x,y)=>x.mes.localeCompare(y.mes)).map(a=>({
    ...a,
    /* Sem base de cálculo = null, e não 0. Um mês entra aqui assim que tem local
       contado, mas Peças e Valor só ganham base quando algum local CONCLUI — então
       existe mês legítimo com locais contados e nenhuma peça/valor apurado ainda.
       Devolver 0 nesse caso pintava "0,0%" em vermelho, como se a acurácia fosse
       péssima, quando o que falta é dado; e ainda puxava o piso da faixa
       (irMesAccFloor) pra zero, achatando a régua de todos os outros meses. */
    acuraciaPecas:  a.pecasSaldoLogico>0 ? 1-a.pecasDivergentes/a.pecasSaldoLogico : null,
    acuraciaLocal:  a.locaisContados>0 ? 1-a.locaisDivergentes/a.locaisContados : null,
    acuraciaValor:  a.valorSaldoLogico>0 ? 1-a.valorDivergente/a.valorSaldoLogico : null
  }));
}
function irRenderEvolucaoMensalPanel(ind){
  const meses = irPorMesDoAno(irCicloAno(IR.cicloAtivo));
  if(!meses.length){
    return `<div class="panel">
      <h3>Acurácia mensal</h3>
      <p class="field-hint">Reprocesse os ciclos na Importação para habilitar a quebra por mês.</p>
    </div>`;
  }
  const linhas = m => ({
    pecas:  {mes:m.mes, contado:m.pecasContadas,  divergente:m.pecasDivergentes,  acuracia:m.acuraciaPecas},
    locais: {mes:m.mes, contado:m.locaisContados, divergente:m.locaisDivergentes, acuracia:m.acuraciaLocal},
    valor:  {mes:m.mes, contado:m.valorContado,   divergente:m.valorDivergente,   acuracia:m.acuraciaValor}
  });
  const dados = meses.map(linhas);
  const tabela = `<details class="mes-tabela"><summary>Ver os números em tabela</summary>
    <div class="table-wrap"><table>
      <thead><tr><th>Mês</th><th>Peças contadas</th><th>Peças div.</th><th>Acur. Peças</th>
        <th>Locais contados</th><th>Locais div.</th><th>Acur. Local</th>
        <th>Valor contado</th><th>Valor div.</th><th>Acur. Valor</th></tr></thead>
      <tbody>${meses.map(m=>`<tr>
        <td>${irEsc(irMesLabel(m.mes))}</td>
        <td class="mono">${irFmtInt(m.pecasContadas)}</td><td class="mono">${irFmtInt(m.pecasDivergentes)}</td><td class="mono">${irFmtPctOuTraco(m.acuraciaPecas)}</td>
        <td class="mono">${irFmtInt(m.locaisContados)}</td><td class="mono">${irFmtInt(m.locaisDivergentes)}</td><td class="mono">${irFmtPctOuTraco(m.acuraciaLocal)}</td>
        <td class="mono">${irFmtMoneyInt(m.valorContado)}</td><td class="mono">${irFmtMoneyInt(m.valorDivergente)}</td><td class="mono">${irFmtPctOuTraco(m.acuraciaValor)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </details>`;
  return `<div class="panel">
    <h3>Acurácia mensal</h3>
    ${irEvolucaoMensalBloco(dados.map(d=>d.pecas),  IR_MES_SERIES.pecas,  irFmtInt)}
    ${irEvolucaoMensalBloco(dados.map(d=>d.locais), IR_MES_SERIES.locais, irFmtInt)}
    ${irEvolucaoMensalBloco(dados.map(d=>d.valor),  IR_MES_SERIES.valor,  irFmtMoneyCompact)}
    ${tabela}
  </div>`;
}
// Impacto de locais que tiveram trabalho de campo iniciado (Data Início Contagem
// preenchida na 843) e terminaram CANCELADOS — o colaborador foi lá, começou a contar,
// mas foi interrompido (ex.: precisava coletar) e o local não fechou naquela rodada.
// Pedido explícito do usuário: quantificar o tempo perdido pra levar pra conversa com
// quem pede a interrupção ("perdemos X horas porque pediram pra cancelar o local").
function irRenderCancelamentoImpactoPanel(ind){
  const tentativas = ind.tentativasCanceladas||0;
  if(!tentativas) return '';
  const comHorario = ind.sessoesComHorarioRegistrado||0;
  const afetados = ind.locaisComCancelamento||0;
  const bateram = ind.locaisCanceladosAposBater||0;
  const horas = ind.horasPerdidasCancelamento||0;
  const diasPerdidos = horas/8;
  // Dias úteis já decorridos do ciclo — serve pra traduzir os dias perdidos em
  // "quantas pessoas em tempo integral isso consumiu" no mesmo período.
  const c = IR.cicloAtivo;
  const hoje = new Date();
  const diasDecorridos = (c && c.dataAbertura)
    ? irDiasUteisEntre(new Date(c.dataAbertura+'T12:00:00'), hoje) : null;
  const pessoasEquivalentes = (diasDecorridos>0) ? diasPerdidos/diasDecorridos : null;
  // Quatro números, não doze. Os outros — tentativas, média por tentativa, sem
  // horário, cobertura da medição, pessoas equivalentes — são aferição do próprio
  // indicador, não o indicador: interessam quando se duvida do número, e aí se
  // olha na aba Indicadores.
  return `<div class="panel">
    <h3>Impacto de cancelamentos</h3>
    <div class="kpi-blocks">
      ${irKpiBlock('black','⏱️','Cancelamento por interrupção',
        irKpiTile('📍', irFmtInt(ind.locaisComCancelamento||0), 'Locais Afetados', '', '') +
        irKpiTile('📊', irFmtPct(ind.taxaCancelamento||0), 'Taxa', (ind.taxaCancelamento||0)>0.1?'bad':'', 'sobre os locais do ciclo') +
        irKpiTile('💥', irFmtInt(bateram), 'Contagem Jogada Fora', bateram>0?'bad':'', 'bateu e foi cancelada') +
        irKpiTile('📅', horas?irFmtNum(diasPerdidos,1)+' dias':'—', 'Produtividade Perdida', '', 'jornada de 8h')
      )}
    </div>
  </div>`;
}

/* Quantos itens divergiram em peça sem preço encontrado. Era uma tabela inteira
   no Dashboard; virou uma linha na Importação, que é onde se resolve — o
   problema é de base (SIGEQ278/ZBIQ0051), não de inventário. Componentes "N" da
   051 não entram: são zerados por design, não é lacuna de dado. */
function irItensSemPrecoResumo(){
  const ind = IR.indicadores;
  if(!ind) return null;
  const total = ind.itensSemPrecoTotal || (ind.itensSemPreco||[]).length || 0;
  return total > 0 ? total : null;
}
/* Meta diária de posições contadas. Usada no gráfico de Contados por Dia (linha
   da meta) e no calendário. Estava logo antes do calendário e foi removida sem
   querer junto com a tabela de itens sem preço na v148 — como os dois painéis só
   tocam nela quando existe contagem por dia, a falta só aparecia com dado real. */
const IR_META_DIARIA = 962;
function irRenderCalendarioPanel(ind){
  const rows = ind.contadosPorDia||[];
  if(!rows.length) return '';
  const porDia = new Map(rows.map(r=>[r.dia, r.total]));
  const meses = Array.from(new Set(rows.map(r=>r.dia.slice(0,7)))).sort();
  if(IR.calMesIdx===undefined || IR.calMesIdx===null) IR.calMesIdx = meses.length-1;
  IR.calMesIdx = Math.max(0, Math.min(meses.length-1, IR.calMesIdx));
  const mes = meses[IR.calMesIdx];
  const diasSemana = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const [ano, mesNum] = mes.split('-').map(Number);
  const primeiroDia = new Date(ano, mesNum-1, 1);
  const ultimoDia = new Date(ano, mesNum, 0).getDate();
  const offset = primeiroDia.getDay();
  const cells = [];
  for(let i=0;i<offset;i++) cells.push('<div class="ir-cal-cell filler"></div>');
  for(let d=1; d<=ultimoDia; d++){
    const diaStr = mes+'-'+String(d).padStart(2,'0');
    const total = porDia.get(diaStr);
    if(total===undefined){
      cells.push(`<div class="ir-cal-cell neutral"><div class="cal-day">${d}</div></div>`);
    } else {
      const bateu = total>=IR_META_DIARIA;
      cells.push(`<div class="ir-cal-cell ${bateu?'good':'bad'}" title="${irFmtInt(total)} de ${irFmtInt(IR_META_DIARIA)}">
        <div class="cal-day">${d}</div>
        <div class="cal-icon">${bateu?'✅':'⚠️'}</div>
        <div class="cal-total mono">${irFmtInt(total)}</div>
      </div>`);
    }
  }
  const nomeMesRaw = primeiroDia.toLocaleDateString('pt-BR', {month:'long', year:'numeric'});
  const nomeMes = nomeMesRaw.charAt(0).toUpperCase()+nomeMesRaw.slice(1);
  const mesHtml = `<div class="ir-cal-month">
    <div class="ir-cal-month-nav">
      <button class="btn-cal-nav" onclick="irCalNavMonth(-1)" ${IR.calMesIdx<=0?'disabled':''} aria-label="Mês anterior">‹</button>
      <div class="ir-cal-month-title">${irEsc(nomeMes)}</div>
      <button class="btn-cal-nav" onclick="irCalNavMonth(1)" ${IR.calMesIdx>=meses.length-1?'disabled':''} aria-label="Próximo mês">›</button>
    </div>
    <div class="ir-cal-grid ir-cal-head">${diasSemana.map(d=>`<div class="ir-cal-dow">${d}</div>`).join('')}</div>
    <div class="ir-cal-grid">${cells.join('')}</div>
  </div>`;
  return `<div class="panel">
    <h3>Calendário de Metas</h3>
    <p class="panel-sub">Meta diária: ${irFmtInt(IR_META_DIARIA)} posições contadas · verde = bateu a meta, vermelho = abaixo da meta, cinza = sem contagem.</p>
    ${mesHtml}
  </div>`;
}
function irCalNavMonth(delta){
  IR.calMesIdx = (IR.calMesIdx||0) + delta;
  irRenderView();
}
function irRenderLogTablePanel(ind){
  const rows = irFiltrarLogsValidos(ind.porLog).map(r=>({
    ...r, locaisPendentes: irPendentesDaLinha(r)
  }));
  // Sem log válido a tabela sumia da tela sem explicação. Agora o painel continua
  // no lugar dizendo por que está vazio — some do Dashboard é o pior sintoma
  // possível pra quem usa o número todo dia.
  if(!rows.length){
    const logsNaBase = Array.from(new Set((ind.porLog||[]).map(r=>r.chave))).filter(Boolean);
    return `<div class="panel">
      <h3>Acurácia por Log</h3>
      <p class="field-hint">Nenhum dos logs considerados (${IR_LOGS_VALIDOS.join(', ')}) tem local contado neste ciclo.${logsNaBase.length?` Grupo Classe encontrado na base congelada: ${irEsc(logsNaBase.slice(0,12).join(', '))}.`:' A base congelada não trouxe Grupo Classe — reprocesse o ciclo na Importação.'}</p>
    </div>`;
  }
  const total = irCalcLogTotal(rows);
  total.locaisPendentes = rows.reduce((s,r)=>s+r.locaisPendentes, 0);
  const rowsComTotal = [...rows, total];
  const meta = ind.meta;
  return `<div class="panel">
    <h3>Acurácia por Log</h3>
    <p class="panel-sub">Locais orçados x contados (Grupo Classe da base congelada), peças e acurácias por log — só locais CONCLUÍDOS (mesma regra do KPI "Acurácia Peças/Valor" do topo).</p>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Log</th><th>Locais Orçados</th><th>Locais Contados</th><th>Locais Pendentes</th><th>Locais Divergentes</th>
        <th>Peças Contadas</th><th>Peças Divergentes</th>
        <th>Acurácia Peças</th><th>Acurácia Posições</th><th>Acurácia Valor</th>
      </tr></thead>
      <tbody>${rowsComTotal.map(r=>`<tr${r.isTotal?' style="font-weight:700;border-top:2px solid var(--line);"':''}>
        <td class="mono">${irEsc(r.chave)}</td>
        <td class="mono">${irFmtInt(r.locaisOrcados)}</td>
        <td class="mono">${irFmtInt(r.locaisContados)}</td>
        <td class="mono">${irFmtInt(r.locaisPendentes)}</td>
        <td class="mono">${irFmtInt(r.locaisDivergentes)}</td>
        <td class="mono">${irFmtInt(r.pecasContadas)}</td>
        <td class="mono">${irFmtInt(r.pecasDivergentes)}</td>
        <td class="mono" style="${irHeatStyle(r.acuraciaPecas, meta)}">${irFmtPct(r.acuraciaPecas)}</td>
        <td class="mono" style="${irHeatStyle(r.acuraciaPosicoes, meta)}">${irFmtPct(r.acuraciaPosicoes)}</td>
        <td class="mono" style="${irHeatStyle(r.acuraciaValor, meta)}">${irFmtPct(r.acuraciaValor)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    ${irRenderLogForaDaTabela(ind, rows)}
  </div>`;
}
/* O que a tabela deixou de fora, com nome e número.

   A tabela só lista LOG 1, 2, 3 e 6. Local em qualquer outro Grupo Classe (ou sem
   Grupo Classe nenhum) sai da tabela mas continua no KPI do topo — então o TOTAL
   daqui fica abaixo do KPI e parece conta errada. Esta linha fecha a diferença:
   listado + fora = KPI. */
function irRenderLogForaDaTabela(ind, listadas){
  const dentro = new Set(listadas.map(r=>r.chave));
  const fora = (ind.porLog||[]).filter(r=>!dentro.has(r.chave));
  const pecas = fora.reduce((s,r)=>s+(r.pecasContadas||0),0);
  const div = fora.reduce((s,r)=>s+(r.pecasDivergentes||0),0);
  if(!pecas && !div) return '';
  const nomes = fora.filter(r=>(r.pecasContadas||0)>0 || (r.pecasDivergentes||0)>0)
    .map(r=>r.chave).slice(0,8).join(', ');
  return `<p class="field-hint" style="margin-top:10px;">Fora da tabela: ${irFmtInt(pecas)} peças contadas e ${irFmtInt(div)} divergentes${nomes?' em '+irEsc(nomes):''} — a tabela lista só ${IR_LOGS_VALIDOS.join(', ')}, mas o KPI "Acurácia Peças" do topo inclui tudo. ${irFmtInt((ind.pecasDivergentes||0))} divergentes no ciclo = ${irFmtInt(div)} fora + ${irFmtInt((ind.pecasDivergentes||0)-div)} nos logs listados.</p>`;
}
function irHeatStyle(val, meta){
  const t = Math.max(0, Math.min(1, meta>0 ? val/meta : val));
  const r = Math.round(200 + (31-200)*t), g = Math.round(56 + (138-56)*t), b = Math.round(18 + (82-18)*t);
  return `background:rgba(${r},${g},${b},.14); color:rgb(${r},${g},${b});`;
}
/* ============================================================
   SETORES (Resumo por Setor + Ruas mais divergentes)
   ============================================================ */
function irRenderSetores(){
  const ind = IR.indicadores;
  if(!ind) return irEmptyState('Sem indicadores', 'Processe o ciclo na Importação.', "irSwitchTab('importacao')", 'Ir para Importação');
  return `
    ${irRenderPorRuaPanel(ind)}
    ${irRenderRuasMaisDivergentesPanel(ind)}
  `;
}
function irRenderPorRuaPanel(ind){
  const rows = (ind.porRua||[]).filter(r=>r.chave!=='(sem rua)').slice().sort((a,b)=>a.chave.localeCompare(b.chave));
  if(!rows.length) return '';
  const meta = ind.meta;
  // Pendente aqui usa a mesma regra do módulo de Inventário: local sem NENHUMA linha
  // Liquidada na 843 ainda, cruzado pela rua (X1) da base congelada.
  const rowsComPendentes = rows.map(r=>({...r, locaisPendentes: irPendentesDaLinha(r)}));
  const totalPendentes = rowsComPendentes.reduce((s,r)=>s+r.locaisPendentes,0);
  // A exportação lista os locais um a um, e pra isso precisa da base congelada em
  // memória. O número da coluna não precisa — e é por isso que ele não some mais.
  const podeExportar = irLocaisPendentesContagem().length > 0;
  const comPendente = rowsComPendentes.filter(r=>r.locaisPendentes>0);
  return `<div class="panel">
    <h3>Resumo por Setor</h3>
    <p class="panel-sub">Locais orçados x contados (coluna X1 da base congelada), peças e acurácias por rua.</p>
    ${totalPendentes>0 ? `<div class="form-actions pend-acoes" style="margin:0 0 12px;">
        <button class="btn-link" id="irPendBtn" onclick="irExportarLocaisPendentesCsv()">📤 Baixar locais pendentes (${irFmtInt(totalPendentes)})</button>
        ${comPendente.length>1?`<button class="btn-link" onclick="irPendMarcarTodas(false)">Limpar seleção</button>
        <button class="btn-link" onclick="irPendMarcarTodas(true)">Marcar todas</button>`:''}
      </div>
      ${podeExportar?'':`<p class="field-hint" style="margin:-4px 0 12px;">A lista endereço a endereço precisa da base congelada deste ciclo, que não está salva — reprocesse o ciclo na Importação para liberar o download.</p>`}`
    :''}
    <div class="table-wrap"><table>
      <thead><tr>
        <th class="pend-col">${totalPendentes>0?'<input type="checkbox" checked onchange="irPendMarcarTodas(this.checked)" title="Marcar/desmarcar todas">':''}</th>
        <th>Rua</th><th>Locais Orçados</th><th>Locais Contados</th><th>Locais Divergentes</th>
        <th>Locais Pendentes</th>
        <th>Peças Contadas</th><th>Peças Divergentes</th>
        <th>Acurácia Peças</th><th>Posições</th><th>Valores</th>
      </tr></thead>
      <tbody>${rowsComPendentes.map(r=>`<tr>
        ${/* Toda linha tem a caixa, inclusive a que não tem pendente — só que
             desabilitada. Antes a linha sem pendente vinha sem caixa nenhuma, e a
             coluna ficava com buracos que parecem falha de renderização. */''}
        <td class="pend-col">${r.locaisPendentes>0
          ? `<input type="checkbox" class="pend-chk" checked value="${irEsc(r.chave)}" data-pend="${r.locaisPendentes}" onchange="irPendAtualizarBotao()">`
          : `<input type="checkbox" disabled title="Nenhum local pendente nesta rua">`}</td>
        <td class="mono">${irEsc(r.chave)}</td>
        <td class="mono">${irFmtInt(r.locaisOrcados)}</td>
        <td class="mono">${irFmtInt(r.locaisContados)}</td>
        <td class="mono">${irFmtInt(r.locaisDivergentes)}</td>
        <td class="mono">${irFmtInt(r.locaisPendentes)}</td>
        <td class="mono">${irFmtInt(r.pecasContadas)}</td>
        <td class="mono">${irFmtInt(r.pecasDivergentes)}</td>
        <td class="mono" style="${irHeatStyle(r.acuraciaPecas, meta)}">${irFmtPct(r.acuraciaPecas)}</td>
        <td class="mono" style="${irHeatStyle(r.acuraciaPosicoes, meta)}">${irFmtPct(r.acuraciaPosicoes)}</td>
        <td class="mono" style="${irHeatStyle(r.acuraciaValor, meta)}">${irFmtPct(r.acuraciaValor)}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr style="font-weight:700;border-top:2px solid var(--line);">
        <td class="pend-col"></td>
        <td class="mono">${(ind.porRua||[]).some(r=>r.chave==='(sem rua)' && ((r.pecasContadas||0)>0 || (r.pecasDivergentes||0)>0)) ? 'TOTAL DAS RUAS LISTADAS' : 'TOTAL'}</td>
        <td class="mono">${irFmtInt(rowsComPendentes.reduce((s,r)=>s+r.locaisOrcados,0))}</td>
        <td class="mono">${irFmtInt(rowsComPendentes.reduce((s,r)=>s+r.locaisContados,0))}</td>
        <td class="mono">${irFmtInt(rowsComPendentes.reduce((s,r)=>s+r.locaisDivergentes,0))}</td>
        <td class="mono">${irFmtInt(totalPendentes)}</td>
        <td class="mono">${irFmtInt(rowsComPendentes.reduce((s,r)=>s+r.pecasContadas,0))}</td>
        <td class="mono">${irFmtInt(rowsComPendentes.reduce((s,r)=>s+r.pecasDivergentes,0))}</td>
        <td colspan="3"></td>
      </tr></tfoot>
    </table></div>
    ${(()=>{ // Mesmo caso da tabela por log: "(sem rua)" sai da lista mas conta no KPI.
      const sr = (ind.porRua||[]).find(r=>r.chave==='(sem rua)');
      if(!sr || (!(sr.pecasContadas||0) && !(sr.pecasDivergentes||0))) return '';
      return `<p class="field-hint" style="margin-top:10px;">Fora da tabela: ${irFmtInt(sr.pecasContadas||0)} peças contadas e ${irFmtInt(sr.pecasDivergentes||0)} divergentes em endereços sem X1 na base congelada — o KPI "Acurácia Peças" do topo inclui esses.</p>`;
    })()}
  </div>`;
}
// Só esses 4 logs têm base congelada confiável hoje (os demais — LOG 4, COFRE, ESC,
// MOVI, INV etc. — ficam de fora até o usuário corrigir a base congelada deles).
const IR_LOGS_VALIDOS = ['LOG 1','LOG 2','LOG 3','LOG 6'];
function irFiltrarLogsValidos(porLog){
  return (porLog||[]).filter(r=>IR_LOGS_VALIDOS.includes(r.chave) && r.locaisContados>0)
    .slice().sort((a,b)=>IR_LOGS_VALIDOS.indexOf(a.chave)-IR_LOGS_VALIDOS.indexOf(b.chave));
}
// Total agregado dos logs válidos — recalculado a partir dos totais brutos (peças/
// locais/valor), não é média das porcentagens, pra manter a mesma metodologia
// ponderada por volume usada em cada acurácia individual.
function irCalcLogTotal(rows){
  const sum = k => rows.reduce((s,r)=>s+(r[k]||0), 0);
  const pecasContadas = sum('pecasContadas'), pecasDivergentes = sum('pecasDivergentes');
  // Denominador da acurácia é o saldo lógico, igual ao KPI do topo.
  const pecasSaldoLogico = sum('pecasSaldoLogico') || pecasContadas;
  const vlFisicoTotal = sum('vlFisicoTotal'), valorDivergenteAbsoluto = sum('valorDivergenteAbsoluto');
  const vlSaldoLogico = sum('vlSaldoLogico') || vlFisicoTotal;
  const locaisContados = sum('locaisContados'), locaisDivergentes = sum('locaisDivergentes');
  return {
    // "TOTAL" sozinho lia como total do ciclo, e não é: a tabela só soma os logs
    // considerados. Com LOG 4, LOG 5 ou local sem Grupo Classe no ciclo, esse
    // número fica abaixo do KPI do topo e parece erro de cálculo.
    chave: 'TOTAL DOS LOGS LISTADOS', isTotal: true,
    acuraciaPecas: pecasSaldoLogico>0 ? Math.max(0,1-pecasDivergentes/pecasSaldoLogico) : 1,
    acuraciaValor: vlSaldoLogico>0 ? Math.max(0,1-valorDivergenteAbsoluto/vlSaldoLogico) : 1,
    acuraciaPosicoes: locaisContados>0 ? Math.max(0,1-locaisDivergentes/locaisContados) : 1,
    pecasContadas, pecasSaldoLogico, pecasDivergentes, vlFisicoTotal, vlSaldoLogico, valorDivergenteAbsoluto,
    locaisContados, locaisDivergentes, locaisOrcados: sum('locaisOrcados')
  };
}
function irRenderPorLogPanel(ind){
  const rows = irFiltrarLogsValidos(ind.porLog);
  if(!rows.length) return `<div class="panel"><h3>Acurácias e NET por Log</h3><p class="field-hint">Nenhum log com locais contados ainda.</p></div>`;
  const rowsComTotal = [...rows, irCalcLogTotal(rows)];
  IR._porLogMap = new Map(rowsComTotal.map(r=>[r.chave, r]));
  return `<div class="panel">
    <h3>Acurácias por Log</h3>
    <div class="bi-vbars bi-vbars-grouped">
      ${rowsComTotal.map(r=>`<div class="bi-vbar-col${r.isTotal?' bi-vbar-col-total':''}" onmouseenter="irShowLogTooltip(event,'${irEsc(r.chave)}')" onmousemove="irMoveDiaTooltip(event)" onmouseleave="irHideDiaTooltip()">
        <div class="bi-cluster" style="height:100px;">
          <div class="bi-cluster-bar">
            <div class="bi-cluster-val mono" style="color:var(--orange);">${irFmtPct(r.acuraciaPecas)}</div>
            <div class="bi-vbar orange" style="height:${Math.round(r.acuraciaPecas*100)}px;"></div>
          </div>
          <div class="bi-cluster-bar">
            <div class="bi-cluster-val mono" style="color:var(--blue);">${irFmtPct(r.acuraciaPosicoes)}</div>
            <div class="bi-vbar" style="height:${Math.round(r.acuraciaPosicoes*100)}px;"></div>
          </div>
          <div class="bi-cluster-bar">
            <div class="bi-cluster-val mono" style="color:var(--ink);">${irFmtPct(r.acuraciaValor)}</div>
            <div class="bi-vbar" style="height:${Math.round(r.acuraciaValor*100)}px;background:var(--ink);"></div>
          </div>
        </div>
        <div class="bi-vbar-label">${r.isTotal?'TOTAL':irEsc(r.chave)}</div>
      </div>`).join('')}
    </div>
    <p class="field-hint" style="margin-top:8px;">
      <span class="mono" style="color:var(--orange);">■</span> Peças &nbsp;
      <span class="mono" style="color:var(--blue);">■</span> Posições &nbsp;
      <span class="mono" style="color:#1D1F2A;">■</span> Valores
    </p>
  </div>`;
}
/* Gráfico de barras (Acurácias por Log) pro boletim — SVG estático com o
   rótulo da % acima de cada barra, cores fixas (vira imagem). */
function irBuildLogBarChartSvg(rows, opts){
  opts = opts||{};
  const colors = opts.colors || {pecas:'#FA4616', posicoes:'#001A72', valor:'#1D1F2A', grid:'#E4E7EE', axis:'#6B7280'};
  // W fixo = largura real do conteúdo dentro de .rp-panel-pad no boletim (920 de
  // .rp-page − 2×40 de padding do .rp-body − 2×20 de padding do .rp-panel-pad).
  // Usando esse valor exato (em vez de escalar por aspect-ratio) o SVG desenha 1:1
  // com o espaço disponível — sem sobrar espaço em branco e sem depender do
  // navegador calcular "height:auto" corretamente antes da captura do html2canvas.
  const W = 800, H = 280;
  const padL = 14, padR = 14, padT = 46, padB = 34;
  const plotW = W-padL-padR, plotH = H-padT-padB;
  const n = rows.length, groupW = plotW/n;
  const barW = Math.min(46, groupW/3*0.8), gap = 5;
  const series = [
    {key:'acuraciaPecas', color:colors.pecas},
    {key:'acuraciaPosicoes', color:colors.posicoes},
    {key:'acuraciaValor', color:colors.valor}
  ];
  let bars = '', labels = '', xLabels = '';
  rows.forEach((r,i)=>{
    const groupX = padL + i*groupW + (groupW-(barW*3+gap*2))/2;
    series.forEach((s,si)=>{
      const val = Math.max(0,Math.min(1,r[s.key]));
      const bh = val*plotH;
      const bx = groupX + si*(barW+gap);
      const by = padT+plotH-bh;
      bars += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="${s.color}" rx="2"/>`;
      labels += `<text x="${(bx+barW/2).toFixed(1)}" y="${(by-6).toFixed(1)}" font-size="12" text-anchor="middle" fill="${s.color}" font-weight="700">${Math.round(val*100)}%</text>`;
    });
    xLabels += `<text x="${(padL+i*groupW+groupW/2).toFixed(1)}" y="${H-12}" font-size="13" text-anchor="middle" fill="${colors.axis}" font-weight="600">${irEsc(r.chave)}</text>`;
  });
  const gridLines = [0,0.25,0.5,0.75,1].map(t=>{
    const y = padT+plotH-t*plotH;
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W-padR}" y2="${y.toFixed(1)}" stroke="${colors.grid}" stroke-width="1"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="display:block;">${gridLines}${bars}${labels}${xLabels}</svg>`;
}
/* Gráfico de barras (Contados por Dia) pro boletim, com a mesma linha de
   meta tracejada do painel do Dashboard — SVG estático, cores fixas. */
function irBuildContadosPorDiaSvg(rows, meta, opts){
  opts = opts||{};
  const colors = opts.colors || {bar:'#FA4616', grid:'#E4E7EE', axis:'#6B7280', label:'#1D1F2A', meta:'#001A72'};
  const campo = opts.campo || 'total';
  const fmt = opts.fmt || irFmtInt;
  // W fixo = mesma largura útil do painel do boletim (ver comentário em irBuildLogBarChartSvg).
  const W = 800, H = 260;
  const padL = 14, padR = 14, padT = 36, padB = 32;
  const plotW = W-padL-padR, plotH = H-padT-padB;
  // Slot mínimo por dia (data "dd/mm" + valor acima, sem colar no vizinho) — é uma
  // imagem estática (sem como rolar como no Dashboard ao vivo), então em vez de
  // espremer todo mundo até ficar ilegível, mostra só os últimos N dias, que são os
  // mais relevantes pro acompanhamento do ciclo. Rótulo em R$ é bem mais largo que um
  // inteiro simples ("R$ 1.234,56" vs "12") — precisa de mais espaço por dia, senão os
  // rótulos vizinhos colam um no outro.
  const MIN_SLOT = opts.minSlot || (fmt===irFmtMoney ? 56 : 34);
  const maxDias = Math.max(1, Math.floor(plotW/MIN_SLOT));
  const rowsVisiveis = rows.length > maxDias ? rows.slice(rows.length-maxDias) : rows;
  const omitidos = rows.length - rowsVisiveis.length;
  const n = rowsVisiveis.length;
  const max = Math.max(1, meta, ...rowsVisiveis.map(r=>r[campo]));
  const barW = Math.min(50, plotW/n*0.7);
  let bars = '', labels = '', xLabels = '';
  rowsVisiveis.forEach((r,i)=>{
    const cx = padL + (i+0.5)*(plotW/n);
    const bh = (r[campo]/max)*plotH;
    const bx = cx-barW/2, by = padT+plotH-bh;
    bars += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="${colors.bar}" rx="2"/>`;
    // Sem rótulo em dias com valor zero — só polui (um "R$ 0,00" atrás do outro,
    // grudados, ilegível) e não carrega informação nenhuma.
    if(r[campo]){
      labels += `<text x="${cx.toFixed(1)}" y="${(by-6).toFixed(1)}" font-size="10.5" text-anchor="middle" fill="${colors.label}" font-weight="700">${fmt(r[campo])}</text>`;
    }
    const dia = new Date(r.dia+'T00:00:00');
    xLabels += `<text x="${cx.toFixed(1)}" y="${H-12}" font-size="11.5" text-anchor="middle" fill="${colors.axis}" font-weight="600">${String(dia.getDate()).padStart(2,'0')}/${String(dia.getMonth()+1).padStart(2,'0')}</text>`;
  });
  // meta null/undefined = sem linha de meta (gráficos que não têm uma meta diária,
  // como os de divergência — só faz sentido pra "Contados por Dia").
  const metaY = padT+plotH-(meta/max)*plotH;
  const metaLine = (meta!==null && meta!==undefined) ? `<line x1="${padL}" y1="${metaY.toFixed(1)}" x2="${W-padR}" y2="${metaY.toFixed(1)}" stroke="${colors.meta}" stroke-width="1.5" stroke-dasharray="5 4"/>
    <text x="${W-padR}" y="${(metaY-6).toFixed(1)}" font-size="11.5" text-anchor="end" fill="${colors.meta}" font-weight="700">Meta ${irFmtInt(meta)}</text>` : '';
  const notaOmitidos = omitidos>0 ? `<text x="${padL}" y="14" font-size="11" fill="${colors.axis}">Mostrando os últimos ${n} de ${rows.length} dias</text>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="display:block;">${notaOmitidos}${bars}${labels}${xLabels}${metaLine}</svg>`;
}
/* Gráfico de colunas com linha de base no zero — pra série que tem mês positivo E
   negativo (NET da 410 por mês), diferente do resto dos gráficos de barra do app
   (que partem sempre de 0 pra cima). Barra positiva sobe da base, negativa desce;
   rótulo fica do lado de fora da barra (acima se positiva, abaixo se negativa). */
function irBuildColunasComBaseZeroSvg(rows, opts){
  opts = opts||{};
  const corPos = opts.corPos||'#001A72', corNeg = opts.corNeg||'#C0392B', corAxis = opts.corAxis||'#6B7280', corLabel = opts.corLabel||'#1D1F2A';
  const campo = opts.campo||'valor', fmt = opts.fmt||irFmtMoney, xLabel = opts.xLabel||(r=>r.label);
  const W = 800, H = 260;
  const padL = 14, padR = 14, padT = 34, padB = 30;
  const plotW = W-padL-padR, plotH = H-padT-padB;
  const n = rows.length;
  const maxAbs = Math.max(1, ...rows.map(r=>Math.abs(r[campo])));
  const baseY = padT + plotH/2;
  const barW = Math.min(56, plotW/n*0.62);
  let bars = '', labels = '', xLabels = '';
  const baseLine = `<line x1="${padL}" y1="${baseY.toFixed(1)}" x2="${W-padR}" y2="${baseY.toFixed(1)}" stroke="${corAxis}" stroke-width="1"/>`;
  rows.forEach((r,i)=>{
    const cx = padL + (i+0.5)*(plotW/n);
    const v = r[campo];
    const bh = Math.abs(v)/maxAbs*(plotH/2-8);
    const cor = v>=0 ? corPos : corNeg;
    const by = v>=0 ? baseY-bh : baseY;
    bars += `<rect x="${(cx-barW/2).toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="${cor}" rx="2"/>`;
    const labelY = v>=0 ? by-6 : by+bh+14;
    labels += `<text x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" font-size="11" text-anchor="middle" fill="${corLabel}" font-weight="700">${fmt(v)}</text>`;
    xLabels += `<text x="${cx.toFixed(1)}" y="${H-10}" font-size="11.5" text-anchor="middle" fill="${corAxis}" font-weight="600">${irEsc(xLabel(r))}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="display:block;">${baseLine}${bars}${labels}${xLabels}</svg>`;
}
/* Gráfico de barras agrupadas (3 séries por ciclo: Peças/Locais/Valor) — "Comparativo
   de Acurácias entre Ciclos" do Dashboard. Ciclo sem indicadores ainda (não processado)
   entra com barras cinza vazias, só pra manter o eixo com todos os ciclos cadastrados. */
function irBuildAcuraciaCiclosSvg(rows, opts){
  opts = opts||{};
  const meta = opts.meta!=null ? opts.meta : 0.97;
  const cores = {pecas:'#FA4616', locais:'#001A72', valor:'#1D1F2A', vazio:'#D8DCE3', axis:'#6B7280', label:'#1D1F2A', meta:'#6B7280'};
  // Largura do desenho por parâmetro: o mesmo gráfico aparece num painel de meia
  // largura, e escalar 800px pra dentro de ~560 encolhia o rótulo junto (13px
  // viravam 9). Desenhar já no tamanho de destino mantém o texto legível.
  const W = opts.W||800, H = opts.H||260;
  // padT abre a faixa do rótulo da meta: com 30 ele ainda encostava no valor de
  // uma barra perto de 100%, que é desenhado logo abaixo do topo da área útil.
  const padL = 14, padR = 14, padT = 46, padB = 32;
  const plotW = W-padL-padR, plotH = H-padT-padB;
  const n = Math.max(1, rows.length);
  const grupoW = plotW/n;
  const barW = Math.min(26, grupoW*0.15);
  /* O espaço entre as barras acompanha a largura delas: afinar a coluna aproxima
     os centros, e o rótulo ("100.0%", ~40px) é mais largo que a barra — com o
     vão fixo os percentuais de duas barras vizinhas se encostavam. O vão é o que
     sobra do grupo depois das três barras, limitado pra não espalhar demais. */
  const gap = Math.max(8, Math.min(22, (grupoW*0.72 - 3*barW)/2));
  const metaY = padT + plotH*(1-meta);
  let bars = '', labels = '', xLabels = '';
  rows.forEach((r,i)=>{
    const cx = padL + (i+0.5)*grupoW;
    const series = [{v:r.pecas, cor:cores.pecas}, {v:r.locais, cor:cores.locais}, {v:r.valor, cor:cores.valor}];
    const totalW = series.length*barW + (series.length-1)*gap;
    let bx = cx - totalW/2;
    series.forEach(s=>{
      const tem = s.v!==null && s.v!==undefined;
      const bh = tem ? Math.max(0,Math.min(1,s.v))*plotH : plotH*0.015;
      const by = padT+plotH-bh;
      bars += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="${tem?s.cor:cores.vazio}" rx="3"/>`;
      if(tem) labels += `<text x="${(bx+barW/2).toFixed(1)}" y="${(by-7).toFixed(1)}" font-size="13" text-anchor="middle" fill="${cores.label}" font-weight="800">${(s.v*100).toFixed(1)}%</text>`;
      bx += barW+gap;
    });
    xLabels += `<text x="${cx.toFixed(1)}" y="${H-10}" font-size="14" text-anchor="middle" fill="${cores.axis}" font-weight="800">${irEsc(r.label)}</text>`;
  });
  /* O rótulo da meta sai de cima da linha e vai pra faixa livre acima do gráfico:
     na linha ele ficava na mesma altura do valor da barra mais à direita (uma
     acurácia de 96% encosta na meta de 97%) e os dois textos se tocavam. */
  const metaLine = `<line x1="${padL}" y1="${metaY.toFixed(1)}" x2="${W-padR}" y2="${metaY.toFixed(1)}" stroke="${cores.meta}" stroke-width="1.5" stroke-dasharray="5 4"/>
    <text x="${W-padR}" y="${(padT-28).toFixed(1)}" font-size="13" text-anchor="end" fill="${cores.meta}" font-weight="700">- - Meta ${(meta*100).toFixed(0)}%</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;height:auto;">${metaLine}${bars}${labels}${xLabels}</svg>`;
}
function irRenderComparativoCiclosPanel(){
  // Só os ciclos do ano em curso. Misturar 2025 com 2026 numa barra ao lado da
  // outra sugere comparação que não existe: mudam meta, escopo e equipe entre um
  // ano e outro, e o ciclo velho só empurrava os do ano pra fora da tela.
  const ano = irCicloAno(IR.cicloAtivo);
  const pares = (IR.comparativoCiclos||[]).filter(({ciclo}) => irCicloAno(ciclo) === ano);
  if(!pares.length) return '';
  const rows = pares.map(({ciclo,ind})=>({
    label: irCicloLabel(ciclo),
    pecas: ind?ind.acuraciaPecas:null, locais: ind?ind.acuraciaLocal:null, valor: ind?ind.acuraciaValor:null
  }));
  // "Contado" é o físico; "base" é o saldo lógico que entra no denominador da
  // acurácia. Eram a mesma variável, e o tile "Contado" acabava exibindo o saldo
  // lógico com rótulo de físico. São dois acumuladores separados.
  let pecasContadas=0, pecasDivergentes=0, locaisContados=0, locaisDivergentes=0, valorContado=0, valorBase=0, valorDivergente=0, saldoLogico=0;
  let temValorContado=false;
  for(const {ind} of pares){
    if(!ind) continue;
    pecasContadas += ind.pecasContadas||0; pecasDivergentes += ind.pecasDivergentes||0;
    saldoLogico += (ind.pecasSaldoLogico!=null ? ind.pecasSaldoLogico : (ind.pecasContadas||0));
    locaisContados += ind.locaisContadosTotal||0;
    // locaisDivergentes é campo novo — ciclo processado antes dele existir cai no
    // fallback (soma de "locais" do divergentesPorDia, já existia e é equivalente).
    locaisDivergentes += ind.locaisDivergentes!=null ? ind.locaisDivergentes : (ind.divergentesPorDia||[]).reduce((s,d)=>s+(d.locais||0),0);
    // valorFisicoTotal também é novo, sem fallback confiável — só soma quando existe,
    // pra não mostrar R$ 0,00 como se fosse um valor real (ciclo precisa reprocessar).
    const baseVal = ind.valorSaldoLogico!=null ? ind.valorSaldoLogico : ind.valorFisicoTotal;
    if(baseVal!=null){ temValorContado = true; valorBase += baseVal; valorContado += (ind.valorFisicoTotal||0); }
    valorDivergente += ind.valorDivergenteAbsoluto||0;
  }
  return `<div class="panel">
    <h3>Comparativo de Acurácias entre Ciclos — ${irEsc(String(ano))}</h3>
    <p class="panel-sub">Peças, Locais e Valor de cada ciclo de ${irEsc(String(ano))}, com a meta de ${irFmtPct(IR_META_ACURACIA)}.</p>
    ${irBuildAcuraciaCiclosSvg(rows, {meta:IR_META_ACURACIA})}
    <div class="cmp-legend">
      <span><span class="cmp-dot" style="background:#FA4616;"></span>Peças</span>
      <span><span class="cmp-dot" style="background:#001A72;"></span>Locais</span>
      <span><span class="cmp-dot" style="background:#1D1F2A;"></span>Valor</span>
    </div>
    <div class="kpi-blocks" style="margin-top:14px;">
      ${irKpiBlock('orange','📦','Peças',
        irKpiTile('🎯', saldoLogico>0?irFmtPct(1-pecasDivergentes/saldoLogico):'—', 'Acurácia Geral', '', 'ciclos de '+ano+(saldoLogico>0?' · base: '+irFmtInt(saldoLogico)+' pç':'')) +
        irKpiTile('📦', irFmtInt(pecasContadas), 'Contadas', '', 'ciclos de '+ano) +
        irKpiTile('⚠️', irFmtInt(pecasDivergentes), 'Divergentes', 'bad', ''))}
      ${irKpiBlock('blue','📍','Locais',
        irKpiTile('🎯', locaisContados>0?irFmtPct(1-locaisDivergentes/locaisContados):'—', 'Acurácia Geral', '', 'ciclos de '+ano) +
        irKpiTile('📍', irFmtInt(locaisContados), 'Contados', '', 'ciclos de '+ano) +
        irKpiTile('⚠️', irFmtInt(locaisDivergentes), 'Divergentes', 'bad', ''))}
      ${irKpiBlock('black','💰','Valor',
        irKpiTile('🎯', temValorContado&&valorBase>0?irFmtPct(1-valorDivergente/valorBase):'—', 'Acurácia Geral', '', temValorContado?'ciclos de '+ano+' · base: '+irFmtMoneyInt(valorBase):'reprocesse o ciclo pra habilitar') +
        irKpiTile('💰', temValorContado?irFmtMoneyCompact(valorContado):'—', 'Contado', '', temValorContado?irFmtMoneyInt(valorContado):'') +
        irKpiTile('⚠️', irFmtMoneyCompact(valorDivergente), 'Divergente', 'bad', irFmtMoneyInt(valorDivergente)))}
    </div>
  </div>`;
}
/* Gráfico de rosca (donut) genérico — usado no "Status do Inventário" do
   Dashboard e no boletim. Cores em hex/var explícitos por parâmetro (não
   depende do tema) pra funcionar igual em qualquer contexto. */
/* Velocímetro (meio-círculo) — usado no painel "Saúde do Estoque" do Dashboard. */
function irGaugeSvg(pct, opts){
  opts = opts||{};
  const size = opts.size||220, stroke = opts.stroke||22;
  const p = Math.max(0, Math.min(1, pct));
  const cx = size/2, cy = size*0.56, r = (size-stroke)/2 - 4;
  const color = opts.color||'var(--orange)', track = opts.track||'var(--surface2)', textColor = opts.textColor||'var(--ink)';
  const angle = Math.PI - p*Math.PI;
  const polar = ang=>({x:cx+r*Math.cos(ang), y:cy-r*Math.sin(ang)});
  const startPt = polar(Math.PI), endPt = polar(0), valPt = polar(angle);
  const bgArc = `M${startPt.x.toFixed(1)},${startPt.y.toFixed(1)} A${r},${r} 0 0 1 ${endPt.x.toFixed(1)},${endPt.y.toFixed(1)}`;
  // O arco do velocímetro nunca passa de 180°, então o large-arc-flag é sempre 0
  // (só seria 1 se o trecho desenhado pudesse ultrapassar meia volta).
  const valArc = `M${startPt.x.toFixed(1)},${startPt.y.toFixed(1)} A${r},${r} 0 0 1 ${valPt.x.toFixed(1)},${valPt.y.toFixed(1)}`;
  return `<svg viewBox="0 0 ${size} ${(size*0.62).toFixed(0)}" width="${size}" height="${(size*0.62).toFixed(0)}">
    <path d="${bgArc}" fill="none" stroke="${track}" stroke-width="${stroke}" stroke-linecap="round"/>
    ${p>0 ? `<path d="${valArc}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"/>` : ''}
    <text x="${cx}" y="${cy-16}" text-anchor="middle" font-size="${Math.round(size*0.16)}" font-weight="800" fill="${textColor}">${irFmtPct(p)}</text>
    ${opts.label ? `<text x="${cx}" y="${cy+6}" text-anchor="middle" font-size="${Math.round(size*0.058)}" font-weight="700" fill="${color}">${irEsc(opts.label)}</text>` : ''}
  </svg>`;
}
// Saúde do Estoque = média das 3 acurácias já mostradas nos blocos (Peças/Local/Valor) —
// visão rápida de 1 número só pra saber se o ciclo está indo bem.
function irCalcSaudeEstoque(ind){ return (ind.acuraciaPecas + ind.acuraciaLocal + ind.acuraciaValor) / 3; }
function irRenderSaudeEstoquePanel(ind){
  const saude = irCalcSaudeEstoque(ind);
  const critico = ind.meta - 0.10;
  const cor = saude>=ind.meta ? 'var(--success)' : (saude>=critico ? 'var(--orange)' : 'var(--danger)');
  const statusTxt = saude>=ind.meta ? 'Saudável' : (saude>=critico ? 'Atenção' : 'Crítico');
  return `<div class="panel">
    <h3>Saúde do Estoque</h3>
    <p class="panel-sub">Média entre Acurácia Peças, Local e Valor — visão rápida da saúde geral do ciclo. Meta: ${irFmtPct(ind.meta)}.</p>
    <div class="gauge-row gauge-row-solo">
      ${irGaugeSvg(saude, {color:cor, label:statusTxt, size:300})}
    </div>
  </div>`;
}
function irDonutSvg(pct, opts){
  opts = opts||{};
  const size = opts.size||190, stroke = opts.stroke||28;
  const color = opts.color||'var(--orange)', track = opts.track||'var(--surface2)', textColor = opts.textColor||'var(--ink)';
  const r = (size-stroke)/2, c = size/2, circ = 2*Math.PI*r;
  const dash = Math.max(0,Math.min(1,pct))*circ;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${dash.toFixed(2)} ${circ.toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>
    <text x="${c}" y="${c+size*0.065}" text-anchor="middle" font-size="${Math.round(size*0.19)}" font-weight="800" fill="${textColor}">${irFmtPct(pct)}</text>
  </svg>`;
}
/* Agrupa contadosPorDia por mês (YYYY-MM) — usado pra preencher o espaço
   vazio do painel "Status do Inventário" com o total contado por mês. */
function irAgruparContadosPorMes(rows, dataAbertura){
  // Só considera meses a partir da abertura do ciclo — evita citar meses
  // fora do ciclo por causa de algum registro perdido/fora do período.
  const mesMin = dataAbertura ? String(dataAbertura).slice(0,7) : null;
  const map = new Map();
  for(const r of rows||[]){
    const mes = r.dia.slice(0,7);
    if(mesMin && mes<mesMin) continue;
    map.set(mes, (map.get(mes)||0)+r.total);
  }
  return Array.from(map.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([mes,total])=>{
    const nomeRaw = new Date(mes+'-01T00:00:00').toLocaleDateString('pt-BR', {month:'long', year:'numeric'});
    return {mes, label: nomeRaw.charAt(0).toUpperCase()+nomeRaw.slice(1), total};
  });
}
/* Acurácia do ANO, somando todos os ciclos daquele ano. Não é média das
   acurácias dos ciclos: um ciclo pequeno pesaria igual a um grande. Recalcula a
   partir dos totais — divergente sobre contado — que é a mesma conta do ciclo,
   só com a base maior. */
function irAcuraciaDoAno(ano){
  const pares = (IR.comparativoCiclos||[]).filter(({ciclo}) => irCicloAno(ciclo) === ano);
  if(!pares.length) return null;
  let pc=0, pd=0, lc=0, ld=0, vc=0, vd=0, temValor=false;
  for(const {ind} of pares){
    if(!ind) continue;
    // Base da acurácia = saldo lógico. Ciclo processado antes do motor 17 não tem
    // o campo; cai na física, que era o denominador de então — melhor um número
    // do ciclo velho na régua velha do que buraco na série.
    pc += (ind.pecasSaldoLogico!=null ? ind.pecasSaldoLogico : (ind.pecasContadas||0));
    pd += ind.pecasDivergentes||0;
    lc += ind.locaisContadosTotal||0;
    // locaisDivergentes é campo novo — ciclo antigo cai no equivalente que já existia.
    ld += ind.locaisDivergentes!=null ? ind.locaisDivergentes
        : (ind.divergentesPorDia||[]).reduce((x,d)=>x+(d.locais||0),0);
    // Base da acurácia de valor = valor do saldo lógico; ciclo antigo cai no físico.
    const baseValor = ind.valorSaldoLogico!=null ? ind.valorSaldoLogico : ind.valorFisicoTotal;
    if(baseValor!=null){ temValor = true; vc += baseValor; }
    vd += ind.valorDivergenteAbsoluto||0;
  }
  return {
    ano, ciclos: pares.length,
    pecas:  pc>0 ? 1-pd/pc : null,
    locais: lc>0 ? 1-ld/lc : null,
    valor:  (temValor && vc>0) ? 1-vd/vc : null,
    // Totais que geraram cada percentual — o painel mostra base x divergente lado a
    // lado, pra que o número possa ser conferido sem abrir outra tela. É a BASE da
    // conta (saldo lógico), não a quantidade física contada: rotulá-la como
    // "Contado" dava um par de números com que era impossível refazer o percentual.
    pecasBase: pc, pecasDivergentes: pd,
    locaisBase: lc, locaisDivergentes: ld,
    valorBase: temValor ? vc : null, valorDivergente: vd
  };
}
/* Acurácia anual num painel próprio, no lugar do medidor de Saúde do Estoque —
   que era média das três e escondia qual delas estava fora da meta. O título não
   leva o ano: ele muda sozinho todo janeiro, e carimbá-lo obrigaria a lembrar
   disso. O ano aparece como dado, no rodapé. */
function irRenderAcuraciaAnualPanel(){
  const ano = irCicloAno(IR.cicloAtivo);
  const ac = irAcuraciaDoAno(ano);
  if(!ac) return '';
  const linha = (rot, v, cor, base, divergente) => `<div class="acan-row">
    <div class="acan-label">${irEsc(rot)}</div>
    <div class="acan-qt"><span class="k">Base</span><span class="n mono">${base}</span></div>
    <div class="acan-qt"><span class="k">Divergente</span><span class="n mono bad">${divergente}</span></div>
    <div class="acan-track">
      <div class="acan-fill" style="width:${v==null?0:Math.round(Math.max(0,Math.min(1,v))*100)}%;background:${cor};"></div>
      <div class="acan-meta" style="left:${Math.round(IR_META_ACURACIA*100)}%;"></div>
    </div>
    <div class="acan-val mono ${v!=null && v>=IR_META_ACURACIA ? 'good':'bad'}">${v==null?'—':irFmtPct(v)}</div>
  </div>`;
  return `<div class="panel">
    <h3>Acurácia Anual</h3>
    ${linha('Peças',  ac.pecas,  '#FA4616', irFmtInt(ac.pecasBase), irFmtInt(ac.pecasDivergentes))}
    ${linha('Locais', ac.locais, '#001A72', irFmtInt(ac.locaisBase), irFmtInt(ac.locaisDivergentes))}
    ${linha('Valor',  ac.valor,  '#1D1F2A', ac.valorBase==null?'—':irFmtMoneyCompact(ac.valorBase), irFmtMoneyCompact(ac.valorDivergente))}
    <p class="field-hint acan-pe">${irEsc(String(ano))} · ${irFmtInt(ac.ciclos)} ciclo(s) · meta ${irFmtPct(IR_META_ACURACIA)}</p>
    ${irRenderAcuraciaPorCiclo(ano)}
  </div>`;
}
/* O acumulado do ano e a quebra por ciclo moram no mesmo painel: eram o mesmo
   gráfico duas vezes na página, um embaixo do outro. O de cima diz onde o ano
   está; este diz qual ciclo puxou pra lá. */
function irRenderAcuraciaPorCiclo(ano){
  const pares = (IR.comparativoCiclos||[]).filter(({ciclo}) => irCicloAno(ciclo) === ano);
  if(!pares.length) return '';
  const rows = pares.map(({ciclo,ind})=>({
    label: irCicloLabel(ciclo),
    pecas: ind?ind.acuraciaPecas:null, locais: ind?ind.acuraciaLocal:null, valor: ind?ind.acuraciaValor:null
  }));
  return `<div class="acan-ciclos">
    ${irBuildAcuraciaCiclosSvg(rows, {meta:IR_META_ACURACIA, W:560, H:230})}
    <div class="cmp-legend">
      <span><span class="cmp-dot" style="background:#FA4616;"></span>Peças</span>
      <span><span class="cmp-dot" style="background:#001A72;"></span>Locais</span>
      <span><span class="cmp-dot" style="background:#1D1F2A;"></span>Valor</span>
    </div>
  </div>`;
}
function irRenderStatusInventarioPanel(ind){
  // Mesma base do KPI "Andamento" (locaisConcluidos ÷ locaisCongelados) — antes esse
  // donut usava locaisContadosTotal (inclui locais ainda "em contagem", não fechados),
  // o que fazia o % daqui não bater com o card de Andamento do Ciclo.
  const total = ind.locaisCongelados||0, concluidos = ind.locaisConcluidos||0;
  const pct = total>0 ? concluidos/total : 0;

  return `<div class="panel">
    <h3>Status do Inventário</h3>
    <p class="panel-sub">Percentual de locais concluídos em relação ao total orçado do ciclo.</p>
    <div class="status-donut-row">
      ${irDonutSvg(pct)}
      <div class="status-donut-stats">
        <div class="status-donut-stat"><div class="n mono">${irFmtInt(total)}</div><div class="l">Locais totais (orçados)</div></div>
        <div class="status-donut-stat"><div class="n mono good">${irFmtInt(concluidos)}</div><div class="l">Locais concluídos</div></div>
        <div class="status-donut-stat"><div class="n mono bad">${irFmtInt(total-concluidos)}</div><div class="l">Ainda não concluídos</div></div>
      </div>
    </div>
    ${irRenderPioresRuas(ind)}
  </div>`;
}
/* Top 5 ruas com a pior acurácia de peças, no espaço que sobrava ao lado do donut.
   Só entra rua que já tem peça contada: rua ainda não contada fica em 100% (ou 0%)
   por falta de base e ocuparia o ranking sem significar nada. */
/* Ranking por PEÇAS DIVERGENTES, não por percentual de acurácia. Por percentual,
   uma rua com 3 peças contadas e 2 erradas (33%) ficava acima de uma com 133 mil
   peças e 9.436 erradas (92,9%) — o topo da lista enchia de rua irrelevante e a
   que realmente dói não aparecia. O volume absoluto é o que se cobra. A acurácia
   continua ali do lado, como leitura secundária. Vem do ciclo ativo (ind.porRua). */
/* Ruas que existem pra receber ajuste, não pra guardar estoque: a divergência
   delas é o próprio trabalho de acerto sendo registrado, não erro de contagem de
   ninguém. No ranking elas roubavam a vaga de uma rua operacional de verdade. Só
   saem DAQUI — no Resumo por Setor continuam, porque lá o número é o retrato do
   ciclo, não uma lista de quem cobrar. */
const IR_RUAS_AJUSTE = new Set(['AIR']);
function irRenderPioresRuas(ind){
  const rows = (ind.porRua||[])
    .filter(r => r.chave!=='(sem rua)' && !IR_RUAS_AJUSTE.has(String(r.chave||'').trim().toUpperCase())
                 && (r.pecasDivergentes||0) > 0)
    .slice().sort((a,b)=> (b.pecasDivergentes||0) - (a.pecasDivergentes||0)).slice(0,5);
  if(!rows.length) return '';
  const pior = Math.max(...rows.map(r => r.pecasDivergentes||0), 1);
  return `<div class="pior-ruas">
    <div class="pior-ruas-h">Top 5 ruas · mais peças divergentes</div>
    ${rows.map(r=>`<div class="pior-rua">
      <div class="pr-nome">${irEsc(r.chave)}</div>
      <div class="pr-track"><div class="pr-fill" style="width:${Math.round((r.pecasDivergentes||0)/pior*100)}%;"></div></div>
      <div class="pr-val mono bad">${irFmtInt(r.pecasDivergentes)}</div>
      <div class="pr-sub">de ${irFmtInt(r.pecasContadas)} pç contadas · ${irFmtPct(r.acuraciaPecas)} de acurácia</div>
    </div>`).join('')}
  </div>`;
}
function irShowLogTooltip(ev, chave){
  const r = (IR._porLogMap||new Map()).get(chave);
  const tt = document.getElementById('irChartTooltip');
  if(!tt || !r) return;
  tt.innerHTML = `<div class="ct-title">${irEsc(chave)}</div>
    <table>
      <tbody>
        <tr><td>Peças</td><td class="mono">${irFmtPct(r.acuraciaPecas)}</td></tr>
        <tr><td>Posições</td><td class="mono">${irFmtPct(r.acuraciaPosicoes)}</td></tr>
        <tr><td>Valores</td><td class="mono">${irFmtPct(r.acuraciaValor)}</td></tr>
        <tr><td>Locais contados</td><td class="mono">${irFmtInt(r.locaisContados)} de ${irFmtInt(r.locaisOrcados)}</td></tr>
        <tr><td>NET</td><td class="mono">${irFmtMoney(r.valorDivergenteLiquido)}</td></tr>
      </tbody>
    </table>`;
  tt.classList.remove('hidden');
  irMoveDiaTooltip(ev);
}
function irRenderContadosPorDiaPanel(ind){
  const rows = ind.contadosPorDia||[];
  if(!rows.length) return `<div class="panel"><h3>Contados por Dia</h3><p class="field-hint">Nenhuma contagem registrada ainda.</p></div>`;
  const max = Math.max(1, IR_META_DIARIA, ...rows.map(r=>r.total));
  const metaPct = Math.min(100, Math.round(IR_META_DIARIA/max*100));
  IR._porDiaRua = ind.porDiaRua||{};
  return `<div class="panel">
    <h3>Contados por Dia</h3>
    <div class="bi-vbars-scroll">
      <div class="bi-vbars bi-vbars-meta">
        <div class="bi-vbar-meta-line" style="bottom:${metaPct}%;"></div>
        <div class="bi-vbar-meta-tag" style="bottom:${metaPct}%;">Meta ${irFmtInt(IR_META_DIARIA)}</div>
        ${rows.map(r=>`<div class="bi-vbar-col" onmouseenter="irShowDiaTooltip(event,'${r.dia}')" onmousemove="irMoveDiaTooltip(event)" onmouseleave="irHideDiaTooltip()">
          <div class="bi-vbar-val">${irFmtInt(r.total)}</div>
          <div class="bi-vbar orange" style="height:${Math.round(r.total/max*100)}%;"></div>
          <div class="bi-vbar-label">${new Date(r.dia+'T00:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}</div>
        </div>`).join('')}
      </div>
    </div>
  </div>`;
}
// Peças/Valor/Locais divergentes por dia — mesmo estilo do gráfico "Contados por
// Dia" (barras por dia da Data Fim/Situação da rodada final do local), mas sem a
// linha de meta, já que aqui não existe uma meta diária de divergência. Ajuda a
// responder "quando o NET desviou" com números concretos, não só o total do mês.
function irRenderDivergentesPorDiaPanel(ind){
  const rows = ind.divergentesPorDia||[];
  if(!rows.length) return '';
  const diaLabel = (dia)=> new Date(dia+'T00:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
  const chart = (campo, cor, fmt, titulo)=>{
    const max = Math.max(1, ...rows.map(r=>r[campo]));
    return `<div class="panel">
      <h3>${titulo}</h3>
      <div class="bi-vbars-scroll">
        <div class="bi-vbars">
          ${rows.map(r=>`<div class="bi-vbar-col">
            <div class="bi-vbar-val">${fmt(r[campo])}</div>
            <div class="bi-vbar ${cor}" style="height:${Math.round(r[campo]/max*100)}%;"></div>
            <div class="bi-vbar-label">${diaLabel(r.dia)}</div>
          </div>`).join('')}
        </div>
      </div>
    </div>`;
  };
  return `<div class="bi-grid-3">
    ${chart('pecas','orange',irFmtInt,'Peças Divergentes por Dia')}
    ${chart('valor','ink',irFmtMoney,'Valor Divergente por Dia (abs.)')}
    ${chart('locais','blue',irFmtInt,'Locais Divergentes por Dia')}
  </div>`;
}
function irShowDiaTooltip(ev, dia){
  const rows = (IR._porDiaRua||{})[dia]||[];
  const tt = document.getElementById('irChartTooltip');
  if(!tt) return;
  const totalLocais = rows.reduce((s,r)=>s+r.locais,0);
  const totalPecas = rows.reduce((s,r)=>s+r.pecasContadas,0);
  const totalDiv = rows.reduce((s,r)=>s+r.pecasDivergentes,0);
  const dataLabel = new Date(dia+'T00:00:00').toLocaleDateString('pt-BR');
  tt.innerHTML = `<div class="ct-title">${dataLabel}</div>
    <table><thead><tr><th>Rua</th><th>Locais</th><th>Peças</th><th>Peças Div.</th></tr></thead>
    <tbody>${rows.length ? rows.map(r=>`<tr><td>${irEsc(r.rua)}</td><td class="mono">${irFmtInt(r.locais)}</td><td class="mono">${irFmtInt(r.pecasContadas)}</td><td class="mono">${irFmtInt(r.pecasDivergentes)}</td></tr>`).join('') : '<tr><td colspan="4">Sem detalhe</td></tr>'}</tbody>
    <tfoot><tr><td>Total</td><td class="mono">${irFmtInt(totalLocais)}</td><td class="mono">${irFmtInt(totalPecas)}</td><td class="mono">${irFmtInt(totalDiv)}</td></tr></tfoot>
    </table>`;
  tt.classList.remove('hidden');
  irMoveDiaTooltip(ev);
}
function irMoveDiaTooltip(ev){
  const tt = document.getElementById('irChartTooltip');
  if(!tt || tt.classList.contains('hidden')) return;
  const pad = 14;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  const rect = tt.getBoundingClientRect();
  if(x + rect.width > window.innerWidth) x = ev.clientX - rect.width - pad;
  if(y + rect.height > window.innerHeight) y = ev.clientY - rect.height - pad;
  tt.style.left = x+'px';
  tt.style.top = y+'px';
}
function irHideDiaTooltip(){
  const tt = document.getElementById('irChartTooltip');
  if(tt) tt.classList.add('hidden');
}
function irRenderRuasMaisDivergentesPanel(ind){
  const rows = (ind.porRua||[]).filter(r=>r.chave!=='(sem rua)').slice().sort((a,b)=>b.pecasDivergentes-a.pecasDivergentes);
  if(!rows.length) return `<div class="panel"><h3>Ruas mais divergentes</h3><p class="field-hint">Nenhuma divergência registrada ainda.</p></div>`;
  return `<div class="panel">
    <h3>Ruas mais divergentes</h3>
    <p class="panel-sub">Todas as ruas, ordenadas por peças divergentes absolutas (da maior para a menor).</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Rua</th><th>Peças Divergentes</th><th>Locais Divergentes</th><th>Valor Divergente</th></tr></thead>
      <tbody>${rows.map(r=>`<tr>
        <td class="mono">${irEsc(r.chave)}</td>
        <td class="mono">${irFmtInt(r.pecasDivergentes)}</td>
        <td class="mono">${irFmtInt(r.locaisDivergentes)}</td>
        <td class="mono">${irFmtMoney(r.valorDivergenteAbsoluto)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}
// Calcula o saldo líquido por item (peças e valor) direto das divergências carregadas
// do ciclo ativo — não depende de campos cacheados nos indicadores, então funciona
// mesmo em ciclos processados antes desses campos existirem (sem precisar reprocessar).
// Mesma regra de "locais concluídos" usada nos KPIs de Acurácia (worker.js) — local
// ainda em contagem/recontagem pode mudar de rodada no próximo reprocessamento, então
// não é um saldo final. Sem esse filtro, "Itens mais Divergentes" somava rodadas
// intermediárias do mesmo local (cada recontagem reabre e reconta o item do zero),
// inflando o saldo de itens muito recontados bem acima do que a QRY0144 mostra.
const IR_LOCAIS_CONCLUIDO = new Set(['convergido','encerrado_sem_convergencia']);
function irSoLocaisConcluidos(divergencias){
  return (divergencias||[]).filter(d=>IR_LOCAIS_CONCLUIDO.has(d.statusLocal));
}
function irCalcItemSaldo(divergencias){
  // Este ranking mede o TAMANHO DO ERRO de contagem por item — divergência
  // ABSOLUTA: Σ |físico − sistema|. Sobra num local e falta em outro não se
  // anulam; as duas foram erro. O saldo líquido (NET) continua calculado e
  // aparece ao lado como leitura complementar, mas não é o que ordena a lista.
  const map = new Map();
  for(const d of irSoLocaisConcluidos(divergencias)){
    if(d.diferenca===0) continue;
    let g = map.get(d.item);
    if(!g){ g = {item:d.item, descricao:d.itemNome, saldoQtd:0, saldoValor:0, absQtd:0, absValor:0, locais:new Set()}; map.set(d.item, g); }
    g.saldoQtd += d.diferenca;
    g.saldoValor += d.vlDivergencia;
    g.absQtd += Math.abs(d.diferenca);
    g.absValor += Math.abs(d.vlDivergencia);
    g.locais.add(d.local);
  }
  const itens = Array.from(map.values()).map(g=>({...g, locais:g.locais.size}));
  return {
    topItensAbsQtd:   itens.filter(i=>i.absQtd>0).sort((a,b)=>b.absQtd-a.absQtd).slice(0,20),
    topItensAbsValor: itens.filter(i=>i.absValor>0).sort((a,b)=>b.absValor-a.absValor).slice(0,20)
  };
}
// Busca as divergências do escopo escolhido pro painel "Itens mais Divergentes":
// só o ciclo ativo (padrão, já carregado em memória), um ano inteiro (soma de todos
// os ciclos abertos naquele ano) ou todos os ciclos já processados. É por isso que
// o saldo por item pode "não bater" com um relatório de fora (ex.: QRY0144) — aqui
// é sempre soma líquida (ganho − perda), mas só dentro do escopo escolhido.
async function irCarregarDivergenciasEscopo(escopo){
  if(escopo.tipo==='ano'){
    const ciclosDoAno = IR.ciclos.filter(c=>String(c.dataAbertura||'').slice(0,4)===String(escopo.ano));
    const listas = await Promise.all(ciclosDoAno.map(c=>irGetByCiclo(IR_STORES.divergencias, c.id)));
    return listas.flat();
  }
  if(escopo.tipo==='todos'){
    const listas = await Promise.all(IR.ciclos.map(c=>irGetByCiclo(IR_STORES.divergencias, c.id)));
    return listas.flat();
  }
  return IR.divergencias; // 'ciclo' — já está carregado em memória
}
async function irAtualizarItemDivSaldo(){
  const divs = await irCarregarDivergenciasEscopo(IR.itemDivFiltro);
  IR.itemDivSaldo = irCalcItemSaldo(divs);
  irRenderView();
}
function irOnItemDivEscopoChange(value){
  IR.itemDivFiltro = value.startsWith('ano:') ? {tipo:'ano', ano:value.slice(4)} : {tipo:value};
  irAtualizarItemDivSaldo();
}
function irItemDivEscopoLabel(){
  const f = IR.itemDivFiltro;
  if(f.tipo==='ano') return `no ano ${f.ano} (todos os ciclos)`;
  if(f.tipo==='todos') return 'em todos os ciclos já processados';
  return 'no ciclo atual';
}
function irRenderItemDivEscopoBar(){
  const anos = Array.from(new Set(IR.ciclos.map(c=>String(c.dataAbertura||'').slice(0,4)).filter(Boolean))).sort((a,b)=>b.localeCompare(a));
  const f = IR.itemDivFiltro;
  const valorAtual = f.tipo==='ano' ? 'ano:'+f.ano : f.tipo;
  return `<div class="panel dash-filter-bar" style="margin-bottom:14px;">
    <div class="dash-filter-group">
      <label>Escopo dos itens divergentes</label>
      <select onchange="irOnItemDivEscopoChange(this.value)">
        <option value="ciclo" ${valorAtual==='ciclo'?'selected':''}>Ciclo atual (${irEsc(irCicloLabel(IR.cicloAtivo))})</option>
        ${anos.map(a=>`<option value="ano:${a}" ${valorAtual==='ano:'+a?'selected':''}>Ano ${a} (todos os ciclos)</option>`).join('')}
        <option value="todos" ${valorAtual==='todos'?'selected':''}>Todos os ciclos já processados</option>
      </select>
    </div>
  </div>`;
}
// Alterna a lista "extra" (itens além dos primeiros visíveis) de um painel de itens
// mais divergentes — usado pra não deixar o Dashboard gigante por padrão.
function irToggleCollapse(id, btn){
  const el = document.getElementById(id);
  if(!btn.dataset.moreLabel) btn.dataset.moreLabel = btn.textContent;
  const abrir = el.style.display === 'none';
  el.style.display = abrir ? 'block' : 'none';
  btn.textContent = abrir ? 'Ver menos' : btn.dataset.moreLabel;
}
/* Descrição do item resumida à primeira e à última palavra ("DISCO … FORTG").
   A descrição inteira continua no title da linha, no hover. */
function irResumirDescricao(desc){
  const partes = String(desc||'').trim().split(/\s+/).filter(Boolean);
  if(partes.length<=2) return partes.join(' ');
  return partes[0]+' … '+partes[partes.length-1];
}
function irRenderTopItensPanel(saldo, kind){
  const isValor = kind==='valor';
  const itens = (isValor ? saldo.topItensAbsValor : saldo.topItensAbsQtd) || [];
  const titulo = isValor ? 'Itens mais Divergentes (Valor · ABS)' : 'Itens mais Divergentes (Peças · ABS)';
  const fmt = isValor ? irFmtMoney : irFmtInt;
  const getAbs = i => isValor ? i.absValor : i.absQtd;
  if(!itens.length) return `<div class="panel"><h3>${titulo}</h3><p class="field-hint">Nenhuma divergência registrada ainda.</p></div>`;
  const maxAbs = Math.max(1, ...itens.map(getAbs));
  const VISIVEL = 8;
  const row = i=>`<div class="bi-hbar-row${isValor?' bi-hbar-row-money':''}">
      <div class="bi-hbar-label" title="${irEsc(i.item)} — ${irEsc(i.descricao)}"><span class="mono">${irEsc(i.item)}</span> — ${irEsc(irResumirDescricao(i.descricao)||i.item)}</div>
      <div class="bi-hbar-track"><div class="bi-hbar-fill neg" style="width:${Math.round(getAbs(i)/maxAbs*100)}%;"></div></div>
      <div class="bi-hbar-val">${fmt(getAbs(i))}</div>
    </div>`;
  const visiveis = itens.slice(0, VISIVEL).map(row).join('');
  const resto = itens.slice(VISIVEL);
  const uid = 'ir-col-'+Math.random().toString(36).slice(2,9);
  const lista = resto.length
    ? `<button class="btn-link" style="margin:0 0 6px;" onclick="irToggleCollapse('${uid}', this)">Ver mais (+${resto.length})</button>
       ${visiveis}<div id="${uid}" style="display:none;">${resto.map(row).join('')}</div>`
    : visiveis;
  return `<div class="panel">
    <h3>${titulo}</h3>
    <p class="panel-sub">${isValor ? 'Divergência absoluta de valor por item' : 'Divergência absoluta de peças por item'}, ${irItemDivEscopoLabel()}.</p>
    ${lista}
  </div>`;
}
/* ============================================================
   RELATÓRIO PARA E-MAIL (impressão / salvar como PDF)
   ============================================================ */
// Helpers de markup do boletim (imagem gerada por html2canvas) — compartilhados entre
// o boletim geral (irGerarRelatorioEmail) e outros exports de imagem (ex.: produtividade).
const rpTile = (icon, val, label, cls, hint)=>`<div class="rp-tile">
  <div class="rp-tile-num ${cls||''}">${val}</div>
  <div class="rp-tile-label">${label}</div>
  ${hint?`<div class="rp-tile-hint">${hint}</div>`:''}
</div>`;
const rpBlock = (theme, icon, title, tilesHtml)=>`<div class="rp-block theme-${theme}">
  <div class="rp-block-header"><span class="rp-bh-icon">${icon}</span><span class="rp-bh-title">${title}</span></div>
  <div class="rp-block-body">${tilesHtml}</div>
</div>`;
const rpSectionTitle = (icon, texto, nota)=>`<div class="rp-section-title"><span class="rp-st-icon">${icon}</span><span class="rp-st-text">${texto}</span>${nota?`<span class="rp-st-note">${nota}</span>`:''}</div>`;
function irGerarRelatorioEmail(){
  const ind = IR.indicadores, c = IR.cicloAtivo;
  if(!ind || !c){ irShowToast('Sem dados de ciclo pra gerar relatório.', true); return; }
  const metaHint = `Meta: ${irFmtPct(ind.meta)}`;
  const sectionTitle = rpSectionTitle;
  // Cor da célula de acurácia: amarelo bem em cima da meta, vermelho abaixo,
  // verde acima — pedido explícito do usuário (ex.: meta 97% → 97% = amarelo).
  const rpAcColor = (val, meta)=>{
    const diff = val - meta;
    if(Math.abs(diff) < 0.0015) return '#C9A227';
    return diff > 0 ? '#1F8A52' : '#C0392B';
  };
  const rpAcTd = (val, meta)=>`<td style="color:${rpAcColor(val, meta)};font-weight:700;">${irFmtPct(val)}</td>`;

  const blocoPecas = rpBlock('orange','📦','Peças',
    rpTile('🎯', irFmtPct(ind.acuraciaPecas), 'Acurácia Peças', ind.acuraciaPecas>=ind.meta?'good':'bad', metaHint) +
    rpTile('📦', irFmtInt(ind.pecasContadas), 'Peças Contadas', '', 'total físico') +
    rpTile('⚠️', irFmtInt(ind.pecasDivergentes), 'Peças Divergentes', 'bad', irFmtInt(ind.itensDivergentes)+' itens')
  );
  const blocoLocais = rpBlock('blue','📍','Locais',
    rpTile('🎯', irFmtPct(ind.acuraciaLocal), 'Acurácia Local', ind.acuraciaLocal>=ind.meta?'good':'bad', metaHint) +
    rpTile('✅', irFmtInt(ind.locaisConcluidos), 'Concluídos', '', 'de '+irFmtInt(ind.locaisContadosTotal)+' contados') +
    rpTile('⏳', irFmtInt(ind.locaisPendentes), 'Pendentes', 'bad', irFmtInt(ind.qtdRecontagens)+' recontagens')
  );
  const blocoValor = rpBlock('black','💰','Valor',
    rpTile('🎯', irFmtPct(ind.acuraciaValor), 'Acurácia Valor', ind.acuraciaValor>=ind.meta?'good':'bad', metaHint) +
    rpTile('💰', irFmtMoney(ind.valorFisicoTotal), 'Valor Contado', '', 'total físico') +
    rpTile('⚠️', irFmtMoney(ind.valorDivergenteAbsoluto), 'Valor Divergente', 'bad', 'soma absoluta')
  );
  const blocoCiclo = rpBlock('neutral','🔄','Ciclo',
    rpTile('📊', irFmtPct(ind.andamentoCiclo), 'Andamento', '', irFmtInt(ind.locaisConcluidos)+' de '+irFmtInt(ind.locaisCongelados)) +
    rpTile('📅', ind.diasRestantes===null?'—':irFmtInt(ind.diasRestantes), 'Dias Restantes', '', 'dias úteis · exclui feriados') +
    rpTile('⚡', irFmtPct(ind.eficiencia), 'Eficiência', ind.eficiencia>=0.8?'good':(ind.eficiencia<0.5?'bad':''), 'qualidade x velocidade')
  );

  const rua = (ind.porRua||[]).filter(r=>r.chave!=='(sem rua)').slice().sort((a,b)=>b.pecasDivergentes-a.pecasDivergentes);
  const rowsLog = irFiltrarLogsValidos(ind.porLog);
  const rowsLogComTotal = rowsLog.length ? [...rowsLog, irCalcLogTotal(rowsLog)] : [];
  // Mesma base do KPI "Andamento" (locaisConcluidos), pra bater com o card de Ciclo.
  const pctContagem = ind.locaisCongelados>0 ? ind.locaisConcluidos/ind.locaisCongelados : 0;
  const rpDonutColors = {color:'#FA4616', track:'#EEF0F4', textColor:'#1D1F2A'};
  const rpLogColors = {pecas:'#FA4616', posicoes:'#001A72', valor:'#1D1F2A', grid:'#E4E7EE', axis:'#6B7280'};
  const porMes = irAgruparContadosPorMes(ind.contadosPorDia, c.dataAbertura);
  const maxMes = Math.max(1, ...porMes.map(m=>m.total));
  // NET mensal (QRY410) — a série do ano inteiro, ganho/perda de TODOS os ajustes do
  // CD (não só o ciclo rotativo). Diferente do "Divergente (líq.)" acima, que é só o
  // líquido do ciclo. Fica de fora se a 410 ainda não foi processada.
  const netMensalRows = (IR.net410Data && IR.net410Data.porMes || []).map(m=>({
    mes:m.mes, net:m.net, label: IR_MES_NOMES_ABREV[parseInt(m.mes.slice(5,7),10)-1]
  }));
  const netMensalTotal = netMensalRows.reduce((s,r)=>s+r.net,0);
  const html = `<div class="rp-page">
    <div class="rp-hero">
      <div class="rp-hero-top">
        <img src="brand/Logo_LDM_hor_branco.png" alt="Loja do Mecânico" class="rp-hero-logo">
        <div class="rp-hero-status">${irCicloStatus(c)==='aberto'?'Ciclo em andamento':'Ciclo encerrado'}</div>
      </div>
      <div class="rp-hero-badge">Boletim de Inventário</div>
      <h1>Andamento do ${irCicloLabel(c)}</h1>
      <p>Loja do Mecânico · Centro de Distribuição Cajamar</p>
    </div>
    <div class="rp-body">

    <div class="rp-blocks">
      ${blocoPecas}${blocoLocais}${blocoValor}${blocoCiclo}
    </div>

    ${netMensalRows.length ? `${sectionTitle('📈','NET Mensal em Colunas','QRY410 — mesmo valor da tabela abaixo, um mês por coluna pra facilitar a leitura lado a lado')}
    <div class="rp-panel rp-panel-pad">
      ${irBuildColunasComBaseZeroSvg(netMensalRows, {campo:'net', fmt:irFmtMoney, xLabel:r=>r.label, corPos:'#001A72', corNeg:'#C0392B'})}
      <div class="table-wrap" style="margin-top:14px;"><table class="rp-table">
        <thead><tr><th>Indicador</th>${netMensalRows.map(r=>`<th>${irEsc(r.label)}</th>`).join('')}<th>Total ${irEsc(String(IR.net410AnoSel||''))}</th></tr></thead>
        <tbody><tr><td>NET</td>${netMensalRows.map(r=>`<td style="color:${r.net>=0?'#001A72':'#C0392B'};font-weight:700;">${irFmtMoney(r.net)}</td>`).join('')}<td style="font-weight:800;">${irFmtMoney(netMensalTotal)}</td></tr></tbody>
      </table></div>
    </div>` : ''}

    ${sectionTitle('🟡','Status do Inventário','percentual de locais contados')}
    <div class="rp-panel rp-panel-pad">
      <div class="rp-donut-row">
        ${irDonutSvg(pctContagem, rpDonutColors)}
        <div class="rp-donut-stats">
          <div class="rp-donut-stat"><div class="n">${irFmtInt(ind.locaisCongelados)}</div><div class="l">Locais totais (orçados)</div></div>
          <div class="rp-donut-stat"><div class="n good">${irFmtInt(ind.locaisConcluidos)}</div><div class="l">Locais concluídos</div></div>
          <div class="rp-donut-stat"><div class="n bad">${irFmtInt(ind.locaisCongelados-ind.locaisConcluidos)}</div><div class="l">Ainda não concluídos</div></div>
        </div>
        ${porMes.length ? `<div class="rp-month-list">
          <div class="rp-month-title">Locais contados por mês</div>
          ${porMes.map(m=>`<div class="rp-month-row">
            <div class="rp-month-label">${irEsc(m.label)}</div>
            <div class="rp-month-track"><div class="rp-month-fill" style="width:${Math.round(m.total/maxMes*100)}%;"></div></div>
            <div class="rp-month-val">${irFmtInt(m.total)}</div>
          </div>`).join('')}
        </div>` : ''}
      </div>
    </div>

    ${rowsLog.length ? `${sectionTitle('📊','Acurácias por Log','peças, posições e valores — rótulo mostra a % de cada barra')}
    <div class="rp-panel rp-panel-pad">
      ${irBuildLogBarChartSvg(rowsLogComTotal, {colors:rpLogColors})}
      <p class="rp-chart-legend">
        <span style="color:${rpLogColors.pecas};">■</span> Peças &nbsp;
        <span style="color:${rpLogColors.posicoes};">■</span> Posições &nbsp;
        <span style="color:${rpLogColors.valor};">■</span> Valores
      </p>
    </div>

    ${sectionTitle('📶','Contagem por Log','% de locais contados sobre o orçado, por log')}
    <div class="rp-panel rp-panel-pad">
      ${rowsLog.map(r=>`<div class="rp-hbar-row">
        <div class="rp-hbar-label">${irEsc(r.chave)}</div>
        <div class="rp-hbar-track"><div class="rp-hbar-fill" style="width:${Math.round(Math.min(1,r.pctContado)*100)}%;"></div></div>
        <div class="rp-hbar-val">${irFmtPct(r.pctContado)}</div>
      </div>`).join('')}
    </div>` : ''}

    ${ind.contadosPorDia && ind.contadosPorDia.length ? `${sectionTitle('📅','Contados por Dia','locais contados por dia · linha tracejada = meta diária')}
    <div class="rp-panel rp-panel-pad">
      ${irBuildContadosPorDiaSvg(ind.contadosPorDia, IR_META_DIARIA)}
    </div>` : ''}

    ${ind.divergentesPorDia && ind.divergentesPorDia.length ? `${sectionTitle('⚠️','Peças Divergentes por Dia','soma da diferença absoluta, por dia de fechamento do local')}
    <div class="rp-panel rp-panel-pad">
      ${irBuildContadosPorDiaSvg(ind.divergentesPorDia, null, {colors:{bar:'#FA4616', grid:'#E4E7EE', axis:'#6B7280', label:'#1D1F2A'}, campo:'pecas', fmt:irFmtInt})}
    </div>
    ${sectionTitle('💰','Valor Divergente por Dia','soma do valor divergente absoluto (QRY0843), por dia de fechamento do local')}
    <div class="rp-panel rp-panel-pad">
      ${irBuildContadosPorDiaSvg(ind.divergentesPorDia, null, {colors:{bar:'#1D1F2A', grid:'#E4E7EE', axis:'#6B7280', label:'#1D1F2A'}, campo:'valor', fmt:irFmtMoney})}
    </div>
    ${sectionTitle('📍','Locais Divergentes por Dia','locais fechados com pelo menos 1 item divergente, por dia')}
    <div class="rp-panel rp-panel-pad">
      ${irBuildContadosPorDiaSvg(ind.divergentesPorDia, null, {colors:{bar:'#001A72', grid:'#E4E7EE', axis:'#6B7280', label:'#1D1F2A'}, campo:'locais', fmt:irFmtInt})}
    </div>` : ''}

    ${sectionTitle('🛣️','Ruas mais divergentes','todas as ruas, por peças divergentes')}
    <div class="rp-panel"><table class="rp-table">
      <thead><tr><th>Rua</th><th>Peças divergentes</th><th>Locais divergentes</th><th>Valor divergente</th><th>Acurácia Peças</th><th>Acurácia Locais</th><th>Acurácia Valor</th></tr></thead>
      <tbody>${rua.map(r=>`<tr>
        <td>${irEsc(r.chave)}</td>
        <td>${irFmtInt(r.pecasDivergentes)}</td>
        <td>${irFmtInt(r.locaisDivergentes)}</td>
        <td>${irFmtMoney(r.valorDivergenteAbsoluto)}</td>
        ${rpAcTd(r.acuraciaPecas, ind.meta)}
        ${rpAcTd(r.acuraciaPosicoes, ind.meta)}
        ${rpAcTd(r.acuraciaValor, ind.meta)}
      </tr>`).join('') || '<tr><td colspan="7">Sem divergências registradas.</td></tr>'}</tbody>
    </table></div>

    </div>
  </div>`;
  irBaixarBoletimImagem(html, `Boletim_Ciclo_${c.numero}_${new Date().toISOString().slice(0,10)}.png`);
}
/* Converte cada SVG de um bloco em <img> PNG antes da captura.

   O html2canvas desenha SVG inline pela conta dele e erra a escala quando o
   viewBox não bate com a caixa: no boletim as curvas saíam comprimidas num canto
   e o eixo com os dias sumia — a rosca, que é quadrada e bate com o viewBox,
   saía certa. Rasterizar aqui tira o SVG do caminho dele: o que chega é uma
   imagem comum, que ele sabe desenhar.

   Serializar exige um SVG que se baste sozinho: dentro de um data: URI não há
   folha de estilo nem variável CSS. Por isso os gráficos são desenhados com
   atributos literais (fill, font-size, stroke), sem class e sem var(). */
async function irRasterizarSVGs(raiz, escala){
  const svgs = Array.from(raiz.querySelectorAll('svg'));
  for(const svg of svgs){
    const vb = (svg.getAttribute('viewBox')||'').split(/\s+/).map(Number);
    const w = Number(svg.getAttribute('width')) || vb[2] || svg.clientWidth;
    const h = Number(svg.getAttribute('height')) || vb[3] || svg.clientHeight;
    if(!w || !h) continue;
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', w); clone.setAttribute('height', h);
    const texto = new XMLSerializer().serializeToString(clone);
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(texto);
    try{
      const img = await new Promise((ok, falhou)=>{
        const i = new Image();
        i.onload = ()=>ok(i); i.onerror = falhou;
        i.src = url;
      });
      const cv = document.createElement('canvas');
      cv.width = w * escala; cv.height = h * escala;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      const saida = document.createElement('img');
      saida.src = cv.toDataURL('image/png');
      saida.width = w; saida.height = h;
      // Herda a classe do SVG pra o CSS da folha continuar mandando no tamanho.
      // Escalar agora é seguro: é PNG a 3x, não mais um SVG pra ele interpretar.
      saida.className = svg.getAttribute('class') || '';
      saida.style.cssText = svg.getAttribute('style') || '';
      saida.style.display = 'block';
      svg.replaceWith(saida);
    }catch(err){ /* falhou a rasterização: deixa o SVG como está */ }
  }
}
async function irBaixarBoletimImagem(html, nomeArquivo, email){
  if(typeof html2canvas==='undefined'){ irShowToast('Não consegui carregar o gerador de imagem (sem internet?).', true); return; }
  const area = document.getElementById('irPrintArea');
  area.innerHTML = html;
  // Cobre a tela inteira (em vez de posicionar fora da viewport, que causava o
  // html2canvas "vazar" pedaços do menu/sidebar na imagem capturada) — assim a
  // captura fica isolada, só com o conteúdo do boletim.
  // align-items:flex-start é essencial aqui: sem isso, o align-items:stretch padrão do
  // flex esticava (e limitava) a altura do .rp-page à viewport, cortando o boletim pela
  // metade na imagem capturada pelo html2canvas.
  area.style.cssText = 'display:flex; justify-content:center; align-items:flex-start; position:fixed; inset:0; z-index:9999; overflow:auto; background:#F6F7FA;';
  irShowToast('Gerando boletim...');
  // O zoom da tela (document.body.style.zoom, o controle no canto inferior) é uma
  // propriedade CSS não padrão que o html2canvas não sabe medir — com ele diferente
  // de 100% a métrica de texto do canvas saía errada e as palavras vinham coladas,
  // sem espaço, na imagem capturada. Zera o zoom só durante a captura e restaura
  // (mesmo em caso de erro) logo depois.
  const zoomOriginal = document.body.style.zoom;
  document.body.style.zoom = 1;
  try{
    await new Promise(r=>setTimeout(r, 60)); // deixa o layout assentar antes de capturar
    const alvo = area.querySelector('.rp-page');
    await irRasterizarSVGs(alvo, 3);
    const canvas = await html2canvas(alvo, {
      backgroundColor:'#F6F7FA', scale:3, useCORS:true,
      width: alvo.scrollWidth, height: alvo.scrollHeight,
      windowWidth: alvo.scrollWidth, windowHeight: alvo.scrollHeight
    });
    const blob = await new Promise(resolve=>canvas.toBlob(resolve, 'image/png'));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nomeArquivo;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);

    const numero = IR.cicloAtivo ? IR.cicloAtivo.numero : '';
    const assunto = (email && email.assunto) || `Boletim Inventário — Ciclo ${numero}`;
    let compartilhou = false;
    /* Com destinatários configurados o mailto ganha da folha de compartilhamento:
       ela anexa a imagem sozinha, mas não deixa preencher quem recebe — e o
       pedido aqui é justamente não redigitar os responsáveis todo dia. Anexar
       fica manual; o corpo leva os números em texto pra o e-mail já valer alguma
       coisa mesmo antes de anexar. */
    if(email && (email.para || email.cc)){
      // RFC 6068 separa endereços por vírgula; o usuário digita com ponto e
      // vírgula, que é o que o Outlook mostra. Normaliza pra vírgula.
      const lista = v => (v||'').split(/[;,]/).map(x=>x.trim()).filter(Boolean).join(',');
      const q = [];
      if(email.cc) q.push('cc='+encodeURIComponent(lista(email.cc)));
      q.push('subject='+encodeURIComponent(assunto));
      q.push('body='+encodeURIComponent((email.corpo||'')+
        `\n\n— Anexe a imagem "${nomeArquivo}", baixada agora na sua pasta de downloads.`));
      window.open('mailto:'+encodeURIComponent(lista(email.para))+'?'+q.join('&'), '_blank');
      irShowToast('✓ Boletim baixado e e-mail aberto — anexe a imagem e envie.');
      return;
    }
    // Se o navegador suportar compartilhar arquivo (Web Share API), abre direto
    // a folha de compartilhamento nativa — o usuário escolhe o e-mail e já
    // manda com a imagem anexada, só falta escolher os destinatários.
    if(navigator.canShare){
      try{
        const file = new File([blob], nomeArquivo, {type:'image/png'});
        if(navigator.canShare({files:[file]})){
          await navigator.share({files:[file], title:assunto, text:assunto});
          compartilhou = true;
        }
      }catch(shareErr){
        if(shareErr && shareErr.name==='AbortError') compartilhou = true; // usuário cancelou, não é erro
      }
    }
    if(!compartilhou){
      // Sem suporte a compartilhar arquivo: abre um rascunho de e-mail vazio
      // (sem destinatário) pra o usuário só preencher quem recebe e anexar a
      // imagem que já foi baixada — o mailto não permite anexar automaticamente.
      const corpo = `Segue o boletim do Ciclo ${numero}.\n\nAnexe o arquivo "${nomeArquivo}" (baixado agora na pasta de downloads) antes de enviar.`;
      window.open(`mailto:?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`, '_blank');
      irShowToast('✓ Boletim baixado e rascunho de e-mail aberto — anexe a imagem e adicione os destinatários.');
    } else {
      irShowToast('✓ Boletim pronto — escolha os destinatários na tela de compartilhamento.');
    }
  }catch(err){
    irShowToast('Erro ao gerar o boletim: '+err.message, true);
  }finally{
    document.body.style.zoom = zoomOriginal;
    area.style.cssText = '';
    area.innerHTML = '';
  }
}
/* ============================================================
   QRY410 — PERDAS E GANHOS NO CD
   Independente do ciclo rotativo (por ano, não por cicloId) — ver worker.js
   runPipeline410() pras regras de negócio (Id Depósito 21 fora, Saída = negativo,
   legenda de motivos que entram ou não no NET).
   ============================================================ */
function irOnFile410(file){ if(!file) return; IR.net410File = file; irRenderView(); }
function irOnDropFile410(e){ e.preventDefault(); const file = e.dataTransfer.files[0]; if(file) irOnFile410(file); }
function irRemoveFile410(){ IR.net410File = null; irRenderView(); }
async function irSetNet410Ano(ano){
  ano = parseInt(ano, 10);
  IR.net410AnoSel = ano;
  IR.net410Data = await irGetNet410(ano);
  irSetNet410MesDefault();
  irRenderView();
}
// Mês "atual" = o mês mais recente com movimento nos dados importados (não a data de
// hoje — a QRY410 pode não ter sido atualizada até o mês corrente).
function irSetNet410MesDefault(){
  const rows = (IR.net410Data && IR.net410Data.porMes) || [];
  IR.net410MesSel = rows.length ? rows[rows.length-1].mes : null;
}
function irSetNet410Mes(mes){ IR.net410MesSel = mes; irRenderView(); }
function irProcessar410(){
  if(IR.net410Processing || !IR.net410File) return Promise.resolve(false);
  IR.net410Processing = true; IR.net410Progress = {stage:'Lendo arquivo...', pct:0};
  irRenderView();
  const file = IR.net410File;
  let _fim; const _p = new Promise(r=>{ _fim = r; });
  file.arrayBuffer().then(buf410=>{
    const worker = irNovoWorker();
    worker.onmessage = async (e)=>{
      const msg = e.data;
      if(msg.type==='progress'){ IR.net410Progress = {stage:msg.stage, pct:msg.pct}; irUpdateProgressUI410(); }
      else if(msg.type==='error410'){
        IR.net410Processing=false; worker.terminate();
        irShowToast('Erro no processamento da QRY410: '+msg.message, true); irRenderView(); _fim(false);
      } else if(msg.type==='done410'){
        IR.net410Processing = false; worker.terminate();
        for(const ano of msg.anos) await irSaveNet410(ano, msg.resumos[ano]);
        // Tudo que foi derivado da 410 antiga precisa cair aqui, senão a tela
        // segue mostrando o número da importação anterior até dar F5.
        IR.div410Cache = null;
        IR.est390Meta = await irGetEstoqueMeta();
        IR.est390Ficha = await irGetConfig('estoque390-ficha');
        const ign = await irGetConfig('auditoria-ignorar-virtuais');
        if(ign!=null) IR.audIgnorarVirtuais = ign;
        IR.audPrefixos = await irGetConfig('auditoria-prefixos');
        IR.net410Anos = await irGetAllNet410Anos();
        IR.net410File = null;
        IR.net410AnoSel = msg.anos[0];
        IR.net410Data = await irGetNet410(IR.net410AnoSel);
        irSetNet410MesDefault();
        irShowToast('✓ QRY410 processada: '+msg.anos.map(a=>a+'').join(', ')+'.');
        irRenderView(); _fim(true);
      }
    };
    worker.onerror = (err)=>{ IR.net410Processing=false; irShowToast('Erro no worker (QRY410): '+err.message, true); irRenderView(); _fim(false); };
    worker.postMessage({type:'process410', buf410}, [buf410]);
  }).catch(err=>{
    IR.net410Processing=false; irShowToast('Erro ao ler arquivo: '+err.message, true); irRenderView(); _fim(false);
  });
  return _p;
}
/* Painel de importação da QRY410 — fica na aba Importação (não na NET) pra não mexer
   no layout do Dashboard/NET com mais um dropzone. Processamento independente do
   'PROCESSAR CICLO' (ver irProcessar410). */
/* ---------- IMPORTAÇÃO DA QRY0390 (ESTOQUE ATUAL) ---------- */
function irOnFile390Est(f){ if(!f) return; IR.est390File = f; irRenderView(); }
function irOnDropFile390Est(e){ e.preventDefault(); const f = e.dataTransfer.files[0]; if(f) irOnFile390Est(f); }
function irRemoveFile390Est(){ IR.est390File = null; irRenderView(); }
/* Devolve uma promessa que resolve quando o worker termina (ou falha). Sem isso
   não dá pra encadear 390 -> 160 -> 410 na ordem certa: as três são assíncronas
   e disparar as três de uma vez faria a 160 ler fichas que a 390 ainda não
   gravou. Resolve também no erro — quem encadeia decide se segue. */
function irProcessarEst390(){
  if(IR.est390Processing || !IR.est390File) return Promise.resolve(false);
  IR.est390Processing = true; IR.est390Progress = {stage:'Lendo arquivo...', pct:0};
  irRenderView();
  let _fim; const _p = new Promise(r=>{ _fim = r; });
  IR.est390File.arrayBuffer().then(buf=>{
    const worker = irNovoWorker();
    worker.onmessage = async ev=>{
      const msg = ev.data;
      if(msg.type==='progress'){ IR.est390Progress = {stage:msg.stage, pct:msg.pct}; irUpdateProgressUI390(); }
      else if(msg.type==='error390'){
        IR.est390Processing = false; worker.terminate();
        irShowToast('Erro na QRY0390: '+msg.message, true); irRenderView(); _fim(false);
      } else if(msg.type==='done390'){
        IR.est390Processing = false; worker.terminate();
        IR.est390Ficha = await irGetConfig('estoque390-ficha');
        IR._itemInfo = null; IR._descLocalTodosCiclos = null; IR._descLocal = null;
        IR.est390File = null;
        irShowToast(irFmtInt(msg.itens)+' itens e '+irFmtInt(msg.locais)+' endereços fichados.');
        irRenderView(); _fim(true);
      }
    };
    worker.onerror = ()=>{ worker.terminate(); IR.est390Processing=false; irShowToast('Falha no processamento da QRY0390.', true); irRenderView(); _fim(false); };
    worker.postMessage({type:'process390', buf390:buf}, [buf]);
  }).catch(err=>{ IR.est390Processing=false; irShowToast('Erro ao ler a QRY0390: '+err.message, true); irRenderView(); _fim(false); });
  return _p;
}
function irUpdateProgressUI390(){
  const st = document.getElementById('ir-390-stage'), fi = document.getElementById('ir-390-fill');
  if(st && fi){ st.textContent = IR.est390Progress.stage; fi.style.width = IR.est390Progress.pct+'%'; }
}

/* As três bases que não pertencem a ciclo nenhum, num painel só. Antes eram três
   painéis inteiros, cada um com título, parágrafo explicativo e dropzone — três
   maneiras visualmente diferentes de fazer a mesma coisa, empilhadas embaixo do
   bloco do ciclo. Aqui viram três cartões iguais, na ordem em que precisam ser
   importadas, cada um mostrando o que já tem carregado. */
const IR_AVULSAS = [
  {id:'390', icone:'📦', titulo:'QRY0390', sub:'Estoque por endereço', input:'ir-file-390-est',
   onFile:'irOnFile390Est', onDrop:'irOnDropFile390Est', remove:'irRemoveFile390Est',
   processa:'irProcessarEst390', botao:'Processar estoque', arquivo:()=>IR.est390File,
   rodando:()=>IR.est390Processing, prog:()=>IR.est390Progress, idStage:'ir-390-stage', idFill:'ir-390-fill'},
  {id:'160', icone:'⏱️', titulo:'QRY0160', sub:'Data de movimento', input:'ir-file-160',
   onFile:'irOnFile160', onDrop:'irOnDropFile160', remove:'irRemoveFile160',
   processa:'irProcessar160', botao:'Processar pendência', arquivo:()=>IR.est160File,
   rodando:()=>IR.est160Processing, prog:()=>IR.est160Progress, idStage:'ir-160-stage', idFill:'ir-160-fill'},
  {id:'410', icone:'📄', titulo:'QRY410', sub:'Perdas e ganhos', input:'ir-file-410',
   onFile:'irOnFile410', onDrop:'irOnDropFile410', remove:'irRemoveFile410',
   processa:'irProcessar410', botao:'Processar QRY410', arquivo:()=>IR.net410File,
   rodando:()=>IR.net410Processing, prog:()=>IR.net410Progress, idStage:'ir-410-stage', idFill:'ir-410-fill'}
];
// O que cada base já tem no banco — uma linha, para saber se vale reimportar.
function irAvulsaEstado(id){
  if(id==='390'){
    const f = IR.est390Ficha;
    return f ? irFmtInt(f.locais)+' endereços · '+irFmtInt(f.itens)+' itens · '+irFmtDate(f.importadoEm) : 'nunca importada';
  }
  if(id==='160'){
    const m = IR.est390Meta;
    return (m && m.fonte==='160')
      ? irFmtInt(m.locais)+' endereços · '+irFmtInt(m.pecasTotal)+' peças · '+irFmtDate(m.importadoEm)
      : 'nunca importada';
  }
  const anos = IR.net410Anos || [];
  if(!anos.length) return 'nunca importada';
  // Linhas lidas e hora da importação. É o que responde "reimportei e o número não
  // mudou": se o total de linhas sai igual duas vezes seguidas, o arquivo é o
  // mesmo — a planilha atualizou a consulta mas não foi salva, ou a extração não
  // trouxe nada novo. Sem esse número, não dá pra separar isso de um bug na tela.
  const d = IR.net410Data;
  const partes = ['anos: '+anos.join(', ')];
  if(d && d.totalLinhas != null) partes.push(irFmtInt(d.totalLinhas)+' linhas em '+d.ano);
  // Data do movimento mais recente DENTRO do arquivo. É o que responde de vez
  // "reimportei e não mudou": a 410 vem de um dataflow com atualização própria,
  // então o arquivo pode estar salvo hoje e mesmo assim não ter movimento novo.
  // Sem esse dado, a única saída era abrir a planilha e procurar a última data.
  const ultimo = irNet410UltimoMovimento(d);
  if(ultimo) partes.push('movimento até '+irFmtDate(ultimo));
  if(d && d.processedAt) partes.push('lida '+irFmtDataHora(d.processedAt));
  return partes.join(' · ');
}
function irNet410UltimoMovimento(d){
  const dias = (d && d.porDia) || [];
  return dias.length ? dias[dias.length-1].dia : null;
}
// Data e hora curtas, pra comparar duas importações seguidas.
function irFmtDataHora(s){
  const dt = new Date(s);
  if(isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
}
function irRenderBasesAvulsas(){
  const temFicha = !!(IR._itemInfo && IR._itemInfo.size);
  const cartao = b=>{
    const arq = b.arquivo(), rodando = b.rodando(), prog = b.prog();
    return `<div class="av-card ${arq?'has-file':''}">
      <div class="av-top">
        <span class="av-icone">${b.icone}</span>
        <div class="av-nome"><strong>${irEsc(b.titulo)}</strong><span>${irEsc(b.sub)}</span></div>
      </div>
      <div class="av-estado">${irEsc(irAvulsaEstado(b.id))}</div>
      <input type="file" id="${b.input}" accept=".xlsx,.xls" style="display:none" onchange="${b.onFile}(this.files[0])">
      ${rodando ? `
        <div class="progress-wrap av-prog">
          <div class="progress-stage" id="${b.idStage}">${irEsc(prog.stage)}</div>
          <div class="progress-track"><div class="progress-fill orange" id="${b.idFill}" style="width:${prog.pct}%"></div></div>
        </div>`
      : arq ? `
        <div class="av-arquivo mono">${irEsc(arq.name)}</div>
        <div class="av-acoes">
          <button class="btn btn-primary" onclick="${b.processa}()">${irEsc(b.botao)}</button>
          <button class="btn-link" onclick="${b.remove}()">Remover</button>
        </div>`
      : `<div class="av-acoes"><button class="btn btn-secondary" onclick="document.getElementById('${b.input}').click()">Selecionar</button></div>`}
      ${b.id==='160' && !temFicha ? `<p class="av-aviso">Importe a QRY0390 antes: o valor e o LOG saem de lá.</p>` : ''}
    </div>`;
  };
  return `<div class="panel">
    <div class="ofe-head"><h3>Bases fora do ciclo</h3></div>
    <div class="av-grid" ondragover="event.preventDefault()">${IR_AVULSAS.map(cartao).join('')}</div>
  </div>`;
}

/* ============================================================
   PASTA CONECTADA (File System Access API)
   ============================================================
   O import manual continua sendo o caminho oficial. Isto aqui só tira do
   usuário a parte chata: achar sete arquivos em duas pastas, toda semana, na
   ordem certa. Ele autoriza a pasta uma vez, o navegador guarda a permissão e
   o dash passa a ler os arquivos sozinho.

   Só existe em navegador baseado em Chromium (Chrome/Edge no desktop) e pode
   ser desligado por política de grupo. Por isso NADA aqui é obrigatório: se a
   API não existe, o botão não aparece e a tela de importação segue igual. */
const IR_PASTA_SUPORTA = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
/* Cada base e como reconhecê-la pelo nome do arquivo. Os padrões do bloco do
   ciclo são os mesmos do IR_FILE_TYPES de propósito — um só lugar pra errar. */
const IR_PASTA_BASES = [
  {id:'390', label:'QRY0390', desc:'Estoque por endereço', pattern:IR_PAT.p390, auto:true},
  {id:'160', label:'QRY0160', desc:'Data de movimento',    pattern:IR_PAT.p160, auto:true},
  {id:'410', label:'QRY410',  desc:'Perdas e ganhos',      pattern:IR_PAT.p410, auto:true},
  {id:'843', label:'QRY0843', desc:'Ajustes do ciclo',     pattern:IR_PAT.p843, slot:'f843'},
  {id:'cong',label:'Base Congelada', desc:'Locais do ciclo', pattern:IR_PAT.pCong, slot:'fCong'},
  {id:'278', label:'SIGEQ278', desc:'Custo médio',         pattern:IR_PAT.p278, slot:'f278'},
  {id:'051', label:'ZBIQ0051', desc:'Item pai × componente', pattern:IR_PAT.p051, slot:'f051'}
];
function irPastaBaseDe(nome){
  if(!/\.xlsx?$/i.test(nome)) return null;
  const b = IR_PASTA_BASES.find(x=>x.pattern.test(nome));
  return b ? b.id : null;
}
/* Autorização da pasta. O handle sobrevive a fechar o navegador, mas a
   permissão pode voltar pra "prompt" — e reconceder exige clique do usuário,
   não dá pra fazer sozinho no carregamento da página. */
async function irPastaPermissao(handle, pedir){
  if(!handle || !handle.queryPermission) return 'granted';
  let st = await handle.queryPermission({mode:'read'});
  if(st !== 'granted' && pedir) st = await handle.requestPermission({mode:'read'});
  return st;
}
async function irPastaCarregar(){
  if(!IR_PASTA_SUPORTA) return;
  try{
    const h = await irGetConfig('pasta-handle');
    if(!h) return;
    IR.pastaHandle = h;
    IR.pastaUltimo = await irGetConfig('pasta-ultimo') || {};
    IR.pastaPerm = await irPastaPermissao(h, false);
    if(IR.pastaPerm === 'granted') await irPastaSincronizar();
  }catch(err){ IR.pastaErro = String(err && err.message || err); }
}
async function irPastaConectar(){
  if(!IR_PASTA_SUPORTA) return;
  try{
    const h = await window.showDirectoryPicker({mode:'read', id:'inv-bases'});
    IR.pastaHandle = h; IR.pastaPerm = 'granted'; IR.pastaErro = null;
    await irSetConfig('pasta-handle', h);
    irShowToast('Pasta conectada: '+h.name);
    await irPastaSincronizar();
  }catch(err){
    // Cancelar o seletor é AbortError e não é erro nenhum.
    if(err && err.name === 'AbortError') return;
    IR.pastaErro = 'Não consegui abrir a pasta ('+(err && err.name || 'erro')+'). Se a mensagem falar em política, o TI desligou esse recurso no Edge.';
    irRenderView();
  }
}
async function irPastaReautorizar(){
  if(!IR.pastaHandle) return;
  IR.pastaPerm = await irPastaPermissao(IR.pastaHandle, true);
  if(IR.pastaPerm === 'granted') await irPastaSincronizar(); else irRenderView();
}
async function irPastaDesconectar(){
  IR.pastaHandle = null; IR.pastaArquivos = null; IR.pastaTodos = null;
  IR.pastaCiclos = null; IR.pastaErro = null;
  await irSetConfig('pasta-handle', null);
  irRenderView();
}
/* Varre a pasta escolhida e as subpastas de primeiro nível — é o formato
   recomendado (_Atual + uma pasta por ciclo) sem obrigar ninguém a ele: quem
   deixar tudo solto na raiz também funciona.

   Quando a mesma base aparece em dois lugares, vence a MAIS RECENTE. É o que
   resolve a pasta do ciclo fechado esquecida ao lado da do ciclo aberto. */
/* Varre a pasta escolhida e as subpastas até IR_PASTA_NIVEIS de profundidade.
   Não dá pra assumir uma estrutura: cada área organiza do seu jeito — por
   finalidade ("01. Inventário Rotativo", "02. Endereços Transitórios", "03.
   Net"), por ciclo, ou tudo solto. Varrer fundo cobre todas, e o limite de
   pastas visitadas evita passear por uma árvore gigante do OneDrive.

   Quando a mesma base aparece em mais de um lugar, vence a MAIS RECENTE — é o
   que resolve o ciclo fechado ao lado do aberto. Por isso a tabela mostra o
   caminho de cada arquivo: é ali que se enxerga uma escolha errada. */
const IR_PASTA_NIVEIS = 4;
const IR_PASTA_MAX_DIRS = 600;
async function irPastaVarrer(){
  const h = IR.pastaHandle;
  if(!h) return;
  const achados = {};
  const todos = {};
  let visitadas = 0, estourou = false;
  const guardar = (base, file, caminho)=>{
    // Lista completa: cada ciclo tem a sua 843/congelada, e todas precisam
    // sobreviver à varredura. O "vence o mais recente" abaixo continua valendo
    // só para as bases fora do ciclo (390, 160, 410), que são foto única.
    (todos[base] = todos[base] || []).push({file, pasta:caminho});
    const atual = achados[base];
    if(!atual){ achados[base] = {file, pasta:caminho, copias:1}; return; }
    achados[base].copias++;
    if(file.lastModified > atual.file.lastModified){ achados[base].file = file; achados[base].pasta = caminho; return; }
    if(file.lastModified < atual.file.lastModified) return;
    // Empate de data: é o mesmo arquivo copiado pra mais de uma pasta de ciclo.
    // Sem critério, ficava a primeira alfabética — "Ciclo 1" ganhava do "Ciclo 3"
    // e o caminho exibido apontava a pasta errada. Compara numérico, então
    // "Ciclo 3" > "Ciclo 10" > "Ciclo 1" e o caminho bate com o ciclo em curso.
    if(caminho.localeCompare(atual.pasta, 'pt-BR', {numeric:true}) > 0){
      achados[base].file = file; achados[base].pasta = caminho;
    }
  };
  const lerDir = async (dir, caminho, profundidade)=>{
    if(visitadas++ > IR_PASTA_MAX_DIRS){ estourou = true; return; }
    const subs = [];
    for await (const entry of dir.values()){
      if(entry.kind === 'file'){
        const base = irPastaBaseDe(entry.name);
        if(!base) continue;
        // Arquivo temporário do Excel (~$algo.xlsx) não é planilha de verdade.
        if(entry.name.startsWith('~$')) continue;
        try{ guardar(base, await entry.getFile(), caminho); }catch(err){ /* só na nuvem ou sem permissão */ }
      } else if(entry.kind === 'directory' && profundidade > 0
                && !entry.name.startsWith('.') && !entry.name.startsWith('~')){
        subs.push(entry);
      }
    }
    for(const sub of subs) await lerDir(sub, caminho + ' › ' + sub.name, profundidade - 1);
  };
  try{
    await lerDir(h, h.name, IR_PASTA_NIVEIS);
    IR.pastaArquivos = achados;
    IR.pastaTodos = todos;
    IR.pastaVarridoEm = new Date().toISOString();
    IR.pastaErro = estourou
      ? 'A pasta tem muitas subpastas; parei em '+IR_PASTA_MAX_DIRS+'. Se faltar alguma base, conecte uma pasta mais específica.'
      : null;
  }catch(err){
    IR.pastaErro = 'Não consegui ler a pasta: '+(err && err.message || err);
  }
  irRenderView();
}
// Novo = nunca importado por aqui, ou com data de modificação diferente da última vez.
function irPastaNovo(baseId){
  const a = (IR.pastaArquivos||{})[baseId];
  if(!a) return false;
  const u = (IR.pastaUltimo||{})[baseId];
  return !u || u.modificadoEm !== a.file.lastModified || u.nome !== a.file.name;
}
function irPastaPendentes(){
  return IR_PASTA_BASES.filter(b=>irPastaNovo(b.id));
}
async function irPastaMarcar(baseId){
  const a = (IR.pastaArquivos||{})[baseId];
  if(!a) return;
  IR.pastaUltimo = Object.assign({}, IR.pastaUltimo||{}, {
    [baseId]: {nome:a.file.name, modificadoEm:a.file.lastModified, importadoEm:new Date().toISOString()}
  });
  await irSetConfig('pasta-ultimo', IR.pastaUltimo);
}
/* Processa o que mudou, na ordem 390 -> 160 -> 410, uma de cada vez. A ordem
   não é estética: a 160 lê as fichas que a 390 grava, e disparar as duas juntas
   faria a 160 subir sem preço e sem classe local.

   O bloco do ciclo NÃO é processado sozinho de propósito: ele depende do número
   do ciclo e da data de abertura, que são decisão de quem importa. O que dá pra
   automatizar é encher os campos de arquivo — o usuário confere e clica. */
async function irPastaAtualizar(forcar){
  if(IR.pastaProcessando) return;
  const pend = irPastaPendentes();
  if(!forcar && !pend.length){ irShowToast('Nenhuma base nova na pasta.'); return; }
  IR.pastaProcessando = true; irRenderView();
  const feitas = [];
  try{
    for(const base of IR_PASTA_BASES){
      if(!base.auto) continue;
      // "Reimportar tudo" ignora a data do arquivo. A checagem por data economiza
      // processamento, mas cria um beco: se a planilha atualizou a consulta sem
      // salvar, a data não muda, a base fica "em dia" e não há como forçar —
      // exatamente a situação de reimportar três vezes e o número não mudar.
      if(!forcar && !irPastaNovo(base.id)) continue;
      if(!IR.pastaArquivos[base.id]) continue;
      const arq = IR.pastaArquivos[base.id];
      let ok = false;
      if(base.id === '390'){ IR.est390File = arq.file; ok = await irProcessarEst390(); }
      else if(base.id === '160'){ IR.est160File = arq.file; ok = await irProcessar160(); }
      else if(base.id === '410'){ IR.net410File = arq.file; ok = await irProcessar410(); }
      if(ok){ await irPastaMarcar(base.id); feitas.push(base.label); }
      else break; // uma base que falhou derruba as seguintes, que dependem dela
    }
    // Bloco do ciclo: só preenche os campos.
    let slots = 0;
    for(const base of IR_PASTA_BASES){
      if(base.auto || !base.slot) continue;
      const arq = (IR.pastaArquivos||{})[base.id];
      if(!arq) continue;
      if(IR_MULTI_KEYS.has(base.slot)) irAssignFilesToSlots(base.slot, [arq.file]);
      else IR.files[base.slot] = arq.file;
      slots++;
    }
    if(feitas.length) irShowToast('Atualizado: '+feitas.join(', ')+'.');
    if(slots && !(IR.pastaCiclos||[]).length) irShowToast(slots+' arquivo(s) do ciclo prontos — confira o número do ciclo e clique em PROCESSAR CICLO.');
  } finally {
    IR.pastaProcessando = false; irRenderView();
  }
}
function irPastaQuando(baseId){
  const a = (IR.pastaArquivos||{})[baseId];
  if(!a) return '';
  const d = new Date(a.file.lastModified);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
}
function irRenderPastaPanel(){
  if(!IR_PASTA_SUPORTA) return '';
  if(!IR.pastaHandle){
    return `<div class="panel pasta-panel">
      <div class="ofe-head"><h3>Pasta conectada</h3></div>
      <p class="field-hint">Autorize a pasta das planilhas uma vez e o dash passa a buscar os arquivos sozinho — sem procurar arquivo a cada importação.</p>
      ${IR.pastaErro ? `<p class="pasta-erro">${irEsc(IR.pastaErro)}</p>` : ''}
      <div class="form-actions"><button class="btn btn-primary" onclick="irPastaConectar()">Conectar pasta</button></div>
    </div>`;
  }
  if(IR.pastaPerm !== 'granted'){
    return `<div class="panel pasta-panel">
      <div class="ofe-head"><h3>Pasta conectada</h3></div>
      <p class="field-hint">O navegador precisa que você confirme o acesso a <strong>${irEsc(IR.pastaHandle.name)}</strong> nesta sessão.</p>
      <div class="form-actions">
        <button class="btn btn-primary" onclick="irPastaReautorizar()">Permitir acesso</button>
        <button class="btn btn-secondary" onclick="irPastaDesconectar()">Desconectar</button>
      </div>
    </div>`;
  }
  const pend = irPastaPendentes();
  const linha = b=>{
    const arq = (IR.pastaArquivos||{})[b.id];
    const novo = irPastaNovo(b.id);
    return `<tr class="${novo?'pasta-novo':''}">
      <td><strong>${irEsc(b.label)}</strong><span class="pasta-desc">${irEsc(b.desc)}</span></td>
      <td class="mono">${arq
        ? irEsc(arq.file.name) + '<span class="pasta-caminho">' + irEsc(arq.pasta)
          + (arq.copias > 1 ? ` <em class="pasta-copias">+${arq.copias-1} em outra pasta</em>` : '') + '</span>'
        : '<span class="pasta-falta">não encontrado</span>'}</td>
      <td class="mono">${arq ? irEsc(irPastaQuando(b.id)) : '—'}</td>
      <td>${!arq ? '—' : novo
        ? `<span class="pasta-tag nova">${b.auto ? 'atualiza' : 'preenche'}</span>`
        : '<span class="pasta-tag ok">em dia</span>'}</td>
    </tr>`;
  };
  const pendCiclos = irPastaCiclosPendentes().length;
  const ocupado = IR.pastaProcessando || IR.processing || IR.pastaLendoCiclos;
  return `<div class="panel pasta-panel">
    <div class="pc-topo">
      <span class="pc-ic">📁</span>
      <span class="pc-tx">
        <strong class="mono">${irEsc(IR.pastaHandle.name)}</strong>
        <span>${IR.pastaVarridoEm ? 'Lida às '+irEsc(new Date(IR.pastaVarridoEm).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})) : 'Ainda não lida'}${
          pendCiclos ? ' · '+pendCiclos+' ciclo(s) novo(s)' : ''}${
          pend.length ? ' · '+pend.length+' base(s) fora do ciclo pra atualizar' : ''}</span>
      </span>
      <span class="pc-bt">
        <button class="btn btn-primary" onclick="irPastaSincronizar()" ${ocupado?'disabled':''}>${
          ocupado ? 'Trabalhando...' : 'Buscar novidades'}</button>
        <button class="btn-link" onclick="irPastaConectar()">Trocar pasta</button>
        <button class="btn-link" onclick="irPastaDesconectar()">Desconectar</button>
      </span>
    </div>
    ${IR.pastaErro ? `<p class="pasta-erro">${irEsc(IR.pastaErro)}</p>` : ''}
    ${irRenderPastaCiclos()}
    <details class="pc-det">
      <summary>Bases fora do ciclo (QRY0390, QRY0160, QRY410)</summary>
      <div class="table-wrap"><table class="pasta-table">
        <thead><tr><th>Base</th><th>Arquivo na pasta</th><th>Modificado em</th><th>Situação</th></tr></thead>
        <tbody>${IR_PASTA_BASES.map(linha).join('')}</tbody>
      </table></div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="irPastaAtualizar(true)" ${ocupado?'disabled':''}
          title="Reprocessa 390, 160 e 410 mesmo que a data do arquivo não tenha mudado">Reimportar bases fora do ciclo</button>
      </div>
    </details>
  </div>`;
}

/* ============================================================
   PASTA -> CICLOS (importação em lote)
   ============================================================
   A varredura já sabia achar as planilhas; o que ela fazia era jogar fora todas
   menos a mais recente de cada base — e por isso a importação continuava sendo
   ciclo a ciclo, na mão, toda vez.

   Aqui a lista completa (IR.pastaTodos) é agrupada POR CICLO: cada QRY0843
   encontrada é lida num worker, que devolve número, ano e janela de datas; as
   843 que caem no mesmo ciclo viram partes de um grupo só. A congelada, a
   SIGEQ278 e a ZBIQ0051 são encaixadas em cada grupo pela pasta em que estão e,
   quando isso não decide, pela data do arquivo.

   O que já foi importado fica registrado por ASSINATURA dos arquivos (nome,
   tamanho e data). Arquivo que não mudou não reprocessa — sem isso, abrir o
   dash reprocessaria anos de ciclo toda vez. */
const IR_PASTA_CICLO_BASES = [
  {id:'843',  slot:'files843',  label:'QRY0843'},
  {id:'cong', slot:'filesCong', label:'Base Congelada'},
  {id:'278',  slot:'files278',  label:'SIGEQ278'},
  {id:'051',  slot:'files051',  label:'ZBIQ0051'}
];
function irPastaChaveArq(file){ return file.name+'|'+file.size+'|'+file.lastModified; }
function irPastaCicloChave(g){ return g.numero+'/'+g.ano; }
// Lê UMA 843 e devolve o ciclo dela. O resultado fica em cache pela assinatura do
// arquivo: reler dez planilhas grandes a cada abertura do dash é caro e inútil.
function irPastaDetectar843(file){
  return file.arrayBuffer().then(buf=>new Promise(res=>{
    const w = irNovoWorker();
    w.onmessage = ev=>{ if(ev.data.type!=='done843detect') return; w.terminate(); res(ev.data); };
    w.onerror = ()=>{ w.terminate(); res({erro:'não consegui ler o arquivo'}); };
    w.postMessage({type:'detect843', bufs843:[buf]}, [buf]);
  })).catch(err=>({erro:String(err && err.message || err)}));
}
/* Escolhe os arquivos de uma base (congelada/278/051) para um ciclo.

   1. Mesma pasta da 843 — é o caso da pasta por ciclo, e o mais confiável.
   2. Se a pasta é compartilhada por mais de um ciclo (tudo solto na raiz), a
      pasta não distingue nada: vale a data do arquivo.
   3. A congelada é do ciclo: fora da janela dele, não serve. A 278 e a 051 são
      tabelas de preço/estrutura e valem a mais recente até o fim do ciclo. */
function irPastaEscolherBase(baseId, g, pastasCompartilhadas, pastasDeOutros){
  let lista = (IR.pastaTodos||{})[baseId] || [];
  if(!lista.length) return [];
  const compartilhada = Array.from(g.pastas).some(p=>pastasCompartilhadas.has(p));
  if(!compartilhada){
    const mesma = lista.filter(a=>g.pastas.has(a.pasta));
    if(mesma.length) return mesma;
    /* Arquivo que mora na pasta de OUTRO ciclo é daquele ciclo, não deste — sem
       isso, um ciclo sem congelada roubava a congelada do ciclo seguinte e
       processava com a base errada, o que é pior do que não processar. */
    lista = lista.filter(a=>!pastasDeOutros.has(a.pasta));
    if(!lista.length) return [];
  }
  const dia = 86400000;
  const inicio = new Date(g.dataAbertura+'T00:00:00').getTime();
  const fim = new Date((g.dataPrevistaTermino||g.dataAbertura)+'T23:59:59').getTime() + 60*dia;
  const ate = lista.filter(a=>a.file.lastModified <= fim);
  const cand = ate.length ? ate : lista;
  const maisNovo = arr => arr.slice().sort((a,b)=>b.file.lastModified-a.file.lastModified)[0];
  if(baseId === 'cong'){
    const janela = cand.filter(a=>a.file.lastModified >= inicio - 30*dia);
    return janela.length ? [maisNovo(janela)] : [];
  }
  return [maisNovo(cand)];
}
// Monta IR.pastaCiclos a partir da varredura. Não processa nada.
async function irPastaMapearCiclos(){
  const todos = IR.pastaTodos || {};
  const lista843 = todos['843'] || [];
  IR.pastaLendoCiclos = true; irRenderView();
  try{
    if(IR.pastaDeteccao == null) IR.pastaDeteccao = (await irGetConfig('pasta-deteccao')) || {};
    if(IR.pastaImportados == null) IR.pastaImportados = (await irGetConfig('pasta-ciclos')) || {};
    const cache = IR.pastaDeteccao;
    let mudouCache = false;
    const grupos = new Map();
    for(const arq of lista843){
      const chave = irPastaChaveArq(arq.file);
      let det = cache[chave];
      // Detecção gravada antes do fim de trimestre existir não sabe corrigir a
      // janela do ciclo aberto — vale reler o arquivo uma vez.
      if(det && !det.erro && !det.fimTrimestre) det = null;
      if(!det){ det = await irPastaDetectar843(arq.file); cache[chave] = det; mudouCache = true; }
      if(det.erro || !det.numero || !det.ano) continue;
      const termino = irTerminoDoCiclo(det);
      const k = det.numero+'/'+det.ano;
      let g = grupos.get(k);
      if(!g){
        g = {numero:det.numero, ano:det.ano, dataAbertura:det.dataAbertura,
             dataPrevistaTermino:termino, origem:det.origem,
             pastas:new Set(), arquivos:{'843':[]}};
        grupos.set(k, g);
      }
      if(det.dataAbertura < g.dataAbertura) g.dataAbertura = det.dataAbertura;
      if(termino > g.dataPrevistaTermino) g.dataPrevistaTermino = termino;
      g.pastas.add(arq.pasta);
      g.arquivos['843'].push(arq);
    }
    // Pasta que guarda 843 de mais de um ciclo não serve pra decidir nada.
    const contaPorPasta = new Map();
    for(const g of grupos.values()){
      for(const p of g.pastas) contaPorPasta.set(p, (contaPorPasta.get(p)||0)+1);
    }
    const compartilhadas = new Set(Array.from(contaPorPasta.entries()).filter(([,n])=>n>1).map(([p])=>p));
    for(const g of grupos.values()){
      const deOutros = new Set();
      for(const outro of grupos.values()){
        if(outro === g) continue;
        for(const p of outro.pastas) if(!g.pastas.has(p)) deOutros.add(p);
      }
      for(const b of IR_PASTA_CICLO_BASES){
        if(b.id === '843') continue;
        g.arquivos[b.id] = irPastaEscolherBase(b.id, g, compartilhadas, deOutros);
      }
      g.assinatura = IR_PASTA_CICLO_BASES
        .map(b=>(g.arquivos[b.id]||[]).map(a=>irPastaChaveArq(a.file)).sort().join(','))
        .join(' :: ');
    }
    IR.pastaCiclos = Array.from(grupos.values())
      .sort((a,b)=>(a.ano-b.ano) || (a.numero-b.numero));
    if(mudouCache) await irSetConfig('pasta-deteccao', cache);
  }catch(err){
    IR.pastaErro = 'Não consegui identificar os ciclos da pasta: '+(err && err.message || err);
  } finally {
    IR.pastaLendoCiclos = false; irRenderView();
  }
}
function irPastaCicloFaltando(g){
  return IR_PASTA_CICLO_BASES.filter(b=>!(g.arquivos[b.id]||[]).length).map(b=>b.label);
}
function irPastaCicloEstado(g){
  if(IR.pastaFilaAtual === irPastaCicloChave(g)) return 'processando';
  if(irPastaCicloFaltando(g).length) return 'incompleto';
  const reg = (IR.pastaImportados||{})[irPastaCicloChave(g)];
  return reg && reg.assinatura === g.assinatura ? 'importado' : 'pendente';
}
async function irPastaMarcarCiclo(g){
  IR.pastaImportados = Object.assign({}, IR.pastaImportados||{}, {
    [irPastaCicloChave(g)]: {assinatura:g.assinatura, importadoEm:new Date().toISOString()}
  });
  await irSetConfig('pasta-ciclos', IR.pastaImportados);
}
function irPastaCiclosPendentes(){
  return (IR.pastaCiclos||[]).filter(g=>irPastaCicloEstado(g)==='pendente');
}
/* A fila. Do ciclo mais antigo pro mais novo — é a ordem que o encerramento
   automático espera (processar um ciclo fecha os anteriores). Um erro para a
   fila: insistir nos seguintes só empilha mensagem de erro. */
async function irPastaProcessarCiclos(forcarChave){
  if(IR.pastaProcessando || IR.processing) return;
  const fila = (IR.pastaCiclos||[]).filter(g=>{
    if(irPastaCicloFaltando(g).length) return false;
    return forcarChave ? irPastaCicloChave(g)===forcarChave : irPastaCicloEstado(g)==='pendente';
  });
  if(!fila.length){ if(!forcarChave) irShowToast('Nenhum ciclo novo na pasta.'); return; }
  IR.pastaProcessando = true;
  try{
    for(const g of fila){
      IR.pastaFilaAtual = irPastaCicloChave(g);
      // O aviso de janela é do ciclo que acabou de rodar; deixá-lo na tela
      // durante o próximo faz a fila parecer estar barrando contagem que não é dela.
      IR.importMeta = null;
      irRenderView();
      const ok = await irProcessarCiclo({
        numero:g.numero, dataAbertura:g.dataAbertura, dataPrevistaTermino:g.dataPrevistaTermino,
        f390:null,
        files843:g.arquivos['843'].map(a=>a.file),
        filesCong:(g.arquivos['cong']||[]).map(a=>a.file),
        files278:(g.arquivos['278']||[]).map(a=>a.file),
        files051:(g.arquivos['051']||[]).map(a=>a.file),
        limparFiles:false, abrirDashboard:false
      });
      if(!ok){ irShowToast('Parei no Ciclo '+irPastaCicloChave(g)+' — os seguintes não foram processados.', true); break; }
      await irPastaMarcarCiclo(g);
    }
  } finally {
    IR.pastaProcessando = false; IR.pastaFilaAtual = null; irRenderView();
  }
}
/* Ponto de entrada único: relê a pasta, atualiza as bases fora do ciclo (390,
   160, 410 — a ordem importa e quem cuida disso é o irPastaAtualizar) e só então
   processa os ciclos novos. É o que roda ao conectar a pasta, ao abrir o dash
   com uma pasta já conectada e no botão "Buscar novidades". */
async function irPastaSincronizar(){
  if(IR.pastaProcessando || IR.processing) return;
  await irPastaVarrer();
  if(IR.pastaPerm && IR.pastaPerm !== 'granted') return;
  if(irPastaPendentes().length) await irPastaAtualizar();
  await irPastaMapearCiclos();
  await irPastaProcessarCiclos();
}
function irPastaAnoToggle(ano){
  const fechados = new Set(IR.pastaAnosFechados || []);
  if(fechados.has(ano)) fechados.delete(ano); else fechados.add(ano);
  IR.pastaAnosFechados = Array.from(fechados);
  irRenderView();
}
function irPastaCicloLinha(g){
  const estado = irPastaCicloEstado(g);
  const faltando = irPastaCicloFaltando(g);
  const marca = {importado:'✓', pendente:'•', incompleto:'!', processando:'⟳'}[estado];
  const reg = (IR.pastaImportados||{})[irPastaCicloChave(g)];
  const partes = (g.arquivos['843']||[]).length;
  let situacao;
  if(estado === 'processando'){
    // Estas duas classes são as que o irUpdateProgressUI() procura pra mexer no
    // texto e na barra sem redesenhar a tela inteira a cada mensagem do worker.
    situacao = `<span class="progress-stage">${irEsc(IR.progress.stage||'Processando...')}</span>
      <span class="pc-bar"><i class="progress-fill" style="width:${IR.progress.pct||0}%"></i></span>`;
  } else if(estado === 'incompleto'){
    situacao = 'Falta '+irEsc(faltando.join(' e '))+' na pasta';
  } else if(estado === 'importado'){
    situacao = 'Importado'+(reg && reg.importadoEm ? ' em '+irEsc(new Date(reg.importadoEm).toLocaleDateString('pt-BR')) : '')
      +' · '+partes+' planilha(s) da 843';
  } else {
    situacao = 'Pronto pra importar · '+partes+' planilha(s) da 843';
  }
  const acao = estado === 'processando' ? ''
    : estado === 'incompleto' ? ''
    : `<button class="btn-link" onclick="irPastaProcessarCiclos('${irPastaCicloChave(g)}')" ${IR.pastaProcessando?'disabled':''}>${estado==='importado'?'Reprocessar':'Importar'}</button>`;
  return `<div class="pc-linha ${estado}">
    <span class="pc-mk">${marca}</span>
    <span class="pc-nm"><strong>Ciclo ${g.numero}/${g.ano}</strong>
      <em>${irEsc(irFmtDate(g.dataAbertura))} a ${irEsc(irFmtDate(g.dataPrevistaTermino))}</em></span>
    <span class="pc-st">${situacao}</span>
    <span class="pc-ac">${acao}</span>
  </div>`;
}
function irRenderPastaCiclos(){
  const ciclos = IR.pastaCiclos || [];
  if(IR.pastaLendoCiclos && !ciclos.length) return `<p class="field-hint">Lendo as planilhas da pasta pra identificar os ciclos...</p>`;
  if(!ciclos.length) return `<p class="field-hint">Nenhuma QRY0843 reconhecida na pasta. Confira se o nome do arquivo tem "843".</p>`;
  const anos = Array.from(new Set(ciclos.map(g=>g.ano))).sort((a,b)=>b-a);
  const anoCorrente = anos[0];
  const fechados = new Set(IR.pastaAnosFechados || []);
  return anos.map(ano=>{
    const doAno = ciclos.filter(g=>g.ano===ano).sort((a,b)=>b.numero-a.numero);
    const aberto = ano===anoCorrente ? !fechados.has(ano) : fechados.has(ano);
    const importados = doAno.filter(g=>irPastaCicloEstado(g)==='importado').length;
    if(!aberto){
      return `<div class="pc-ano-fechado" onclick="irPastaAnoToggle(${ano})">
        <strong>› ${ano}</strong><span>${importados} de ${doAno.length} ciclo(s) importado(s)</span></div>`;
    }
    return `<div class="pc-ano" onclick="irPastaAnoToggle(${ano})"><h4>${ano}</h4>
        <span>${ano===anoCorrente?'ano corrente':''}</span></div>
      <div class="pc-lista">${doAno.map(irPastaCicloLinha).join('')}</div>`;
  }).join('');
}

/* ---------- IMPORTAÇÃO DA QRY0160 (PENDÊNCIA DE MOVIMENTAÇÃO) ---------- */
function irOnFile160(f){ if(!f) return; IR.est160File = f; irRenderView(); }
function irOnDropFile160(e){ e.preventDefault(); const f = e.dataTransfer.files[0]; if(f) irOnFile160(f); }
function irRemoveFile160(){ IR.est160File = null; irRenderView(); }
function irProcessar160(){
  if(IR.est160Processing || !IR.est160File) return Promise.resolve(false);
  IR.est160Processing = true; IR.est160Progress = {stage:'Lendo arquivo...', pct:0};
  irRenderView();
  let _fim; const _p = new Promise(r=>{ _fim = r; });
  IR.est160File.arrayBuffer().then(buf=>{
    const worker = irNovoWorker();
    worker.onmessage = async ev=>{
      const msg = ev.data;
      if(msg.type==='progress'){ IR.est160Progress = {stage:msg.stage, pct:msg.pct}; irUpdateProgressUI160(); }
      else if(msg.type==='error160'){
        IR.est160Processing = false; worker.terminate();
        irShowToast('Erro na QRY0160: '+msg.message, true); irRenderView(); _fim(false);
      } else if(msg.type==='done160'){
        IR.est160Processing = false; worker.terminate();
        IR.est390Meta = await irGetEstoqueMeta();
        IR.est390Locais = null; IR.est160File = null;
        irShowToast(irFmtInt(msg.locais)+' endereços com data de movimento.');
        irRenderView(); _fim(true);
      }
    };
    worker.onerror = ()=>{ worker.terminate(); IR.est160Processing=false; irShowToast('Falha no processamento da QRY0160.', true); irRenderView(); _fim(false); };
    worker.postMessage({type:'process160', buf160:buf}, [buf]);
  }).catch(err=>{ IR.est160Processing=false; irShowToast('Erro ao ler a QRY0160: '+err.message, true); irRenderView(); _fim(false); });
  return _p;
}
function irUpdateProgressUI160(){
  const st = document.getElementById('ir-160-stage'), fi = document.getElementById('ir-160-fill');
  if(st && fi){ st.textContent = IR.est160Progress.stage; fi.style.width = IR.est160Progress.pct+'%'; }
}
function irRenderNet410Panel(){
  const d = IR.net410Data;
  const anos = IR.net410Anos;
  return `<div class="panel">
    <h3>Perdas e Ganhos no CD (QRY410)</h3>
    <p class="panel-sub">Independente do ciclo rotativo — organizado por ano. Inventário Rotativo (AIR) é só mais um dos motivos que compõem o NET, junto com auditorias, curvas etc. Importe/atualize a QRY410 na aba Importação.</p>
    ${anos.length ? `<div class="two-col" style="max-width:340px;">
      <div><label>Ano</label><select onchange="irSetNet410Ano(this.value)">
        ${anos.map(a=>`<option value="${a}" ${a===IR.net410AnoSel?'selected':''}>${a}</option>`).join('')}
      </select></div>
      <div></div>
    </div>` : `<p class="field-hint">Nenhuma QRY410 processada ainda — importe na aba <a href="#" onclick="irSwitchTab('importacao');return false;">Importação</a>.</p>`}
  </div>
  ${d ? irRenderNet410Resultado(d) : ''}`;
}
const IR_MES_NOMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const IR_MES_NOMES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
// Gráfico de colunas do NET mês a mês — barra pra cima (verde) quando positivo, pra
// baixo (vermelho) quando negativo, em volta de uma linha de base no zero.
function irBuildNetMensalBarSvg(rows, opts){
  opts = opts||{};
  // Positivo não é sinônimo de "bom" aqui (é só o sentido do saldo) — por isso não
  // usa verde. Azul (mesmo tom de "Locais/Posições" no resto do app) pra positivo,
  // vermelho pra negativo.
  const colors = opts.colors || {pos:'#001A72', neg:'#C0392B', grid:'#E4E7EE', axis:'#6B7280', label:'#1D1F2A'};
  const W = 800, H = 320;
  const padL = 14, padR = 14, padT = 26, padB = 46;
  const plotW = W-padL-padR, plotH = H-padT-padB;
  const n = rows.length;
  const maxAbs = Math.max(1, ...rows.map(r=>Math.abs(r.net)));
  const baseY = padT + plotH/2;
  // Fator 0.86 (em vez de ir até a metade inteira do plotH) garante uma folga fixa
  // entre a ponta da maior barra e o rótulo do mês no eixo X — sem isso, o rótulo de
  // valor de uma barra grande (ex.: NET de março bem negativo) ficava colado ou
  // em cima do nome do mês.
  const barMaxH = (plotH/2)*0.86;
  const barW = Math.min(56, plotW/n*0.6);
  let bars = '', labels = '', xLabels = '';
  rows.forEach((r,i)=>{
    const cx = padL + (i+0.5)*(plotW/n);
    const h = Math.abs(r.net)/maxAbs*barMaxH;
    const pos = r.net>=0;
    const by = pos ? baseY-h : baseY;
    const color = pos ? colors.pos : colors.neg;
    bars += `<rect x="${(cx-barW/2).toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" rx="2"/>`;
    const labelY = pos ? by-6 : by+h+16;
    labels += `<text x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" font-size="11" text-anchor="middle" fill="${colors.label}" font-weight="700">${irFmtMoney(r.net)}</text>`;
    xLabels += `<text x="${cx.toFixed(1)}" y="${H-14}" font-size="12" text-anchor="middle" fill="${colors.axis}" font-weight="600">${IR_MES_NOMES_ABREV[parseInt(r.mes.slice(5,7),10)-1]}</text>`;
  });
  const zeroLine = `<line x1="${padL}" y1="${baseY.toFixed(1)}" x2="${W-padR}" y2="${baseY.toFixed(1)}" stroke="${colors.grid}" stroke-width="1.5"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="display:block;">${zeroLine}${bars}${labels}${xLabels}</svg>`;
}
// Tabela do NET com um mês por coluna (visão compacta, lado a lado) — usada na aba NET
// e reaproveitada no boletim, pra bater o ano do ciclo em uma linha só, mês a mês.
function irBuildNetMensalColunasTable(d, tableCls){
  const rows = d.porMes||[];
  if(!rows.length) return '';
  return `<div class="table-wrap"><table class="${tableCls||''}">
    <thead><tr><th>Indicador</th>${rows.map(m=>`<th>${IR_MES_NOMES_ABREV[parseInt(m.mes.slice(5,7),10)-1]}</th>`).join('')}<th>Total ${d.ano}</th></tr></thead>
    <tbody><tr>
      <td style="font-weight:700;">NET</td>
      ${rows.map(m=>`<td class="mono" style="color:${m.net>=0?'var(--blue)':'var(--danger)'};font-weight:700;">${irFmtMoney(m.net)}</td>`).join('')}
      <td class="mono" style="color:${d.totalNet>=0?'var(--blue)':'var(--danger)'};font-weight:700;">${irFmtMoney(d.totalNet)}</td>
    </tr></tbody>
  </table></div>`;
}
function irRenderNet410Resultado(d){
  const rows = d.porMes||[];
  return `
    <div class="panel">
      <h3>NET mensal em colunas — ${d.ano}</h3>
      <p class="panel-sub">Mesmo valor de NET da tabela abaixo, só que com um mês por coluna pra facilitar a leitura lado a lado.</p>
      ${irBuildNetMensalBarSvg(rows)}
      ${irBuildNetMensalColunasTable(d, 'table-wide')}
    </div>
    <div class="panel">
      <h3>Net mensal — ${d.ano}</h3>
      <p class="panel-sub">Só considera motivos válidos pro NET (ver tabela por Obs abaixo). ${irFmtInt(d.linhasExcluidasDeposito21)} linha(s) do Id Depósito 21 ficaram de fora. Total de linhas do ano: ${irFmtInt(d.totalLinhas)}.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Mês</th><th>Net</th><th>Net Absoluto</th><th>Ganhos</th><th>Perdas</th></tr></thead>
        <tbody>${rows.map(m=>`<tr>
          <td>${irEsc(IR_MES_NOMES[parseInt(m.mes.slice(5,7),10)-1]||m.mes)}</td>
          <td class="mono" style="color:${m.net>=0?'var(--blue)':'var(--danger)'};font-weight:700;">${irFmtMoney(m.net)}</td>
          <td class="mono">${irFmtMoney(m.netAbs)}</td>
          <td class="mono" style="color:var(--success);">${irFmtMoney(m.ganhos)}</td>
          <td class="mono" style="color:var(--danger);">${irFmtMoney(m.perdas)}</td>
        </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--ink-soft);">Sem movimentos no ano</td></tr>'}</tbody>
        <tfoot><tr style="font-weight:700;">
          <td>Acumulado</td>
          <td class="mono" style="color:${d.totalNet>=0?'var(--blue)':'var(--danger)'};">${irFmtMoney(d.totalNet)}</td>
          <td class="mono">${irFmtMoney(d.totalNetAbs)}</td>
          <td class="mono" style="color:var(--success);">${irFmtMoney(d.totalGanhos)}</td>
          <td class="mono" style="color:var(--danger);">${irFmtMoney(d.totalPerdas)}</td>
        </tr></tfoot>
      </table></div>
    </div>
    <div class="panel">
      <h3>Por motivo (Obs) — ${d.ano}</h3>
      <p class="panel-sub">Todos os motivos que apareceram no ano, considerados ou não pro NET (regra: sem legenda cadastrada conta como considerado).</p>
      <div class="table-wrap"><table class="table-wide">
        <thead><tr><th>Obs</th><th>Legenda</th><th>Considerar NET?</th><th>Saída</th><th>Entrada</th><th>Total Geral</th></tr></thead>
        <tbody>${(d.porObs||[]).map(o=>`<tr>
          <td class="mono">${irEsc(o.id)}</td>
          <td>${irEsc(o.legenda)||'—'}</td>
          <td><span class="tag ${o.considerarNet?'tag-good':'tag-muted'}">${o.considerarNet?'SIM':'NÃO'}</span></td>
          <td class="mono" style="color:var(--danger);">${o.saida?irFmtMoney(o.saida):'—'}</td>
          <td class="mono" style="color:var(--success);">${o.entrada?irFmtMoney(o.entrada):'—'}</td>
          <td class="mono" style="font-weight:700;">${irFmtMoney(o.totalGeral)}</td>
        </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--ink-soft);">Sem movimentos no ano</td></tr>'}</tbody>
      </table></div>
    </div>
    <h3 style="margin:20px 0 -6px;">Itens que mais impactam no ano — ${d.ano}</h3>
    <div class="bi-grid-2">
      ${irRenderNet410ItensPanel(d.topItensPositivos, false, 'Soma do valor no ano ('+d.ano+'), só motivos considerados pro NET.')}
      ${irRenderNet410ItensPanel(d.topItensNegativos, true, 'Soma do valor no ano ('+d.ano+'), só motivos considerados pro NET.')}
    </div>
    ${irRenderNet410ItensMesSection(d)}
  `;
}
function irRenderNet410ItensPanel(items, negativos, subtitulo){
  items = items||[];
  const titulo = negativos ? 'Itens que mais impactam negativamente' : 'Itens que mais impactam positivamente';
  const cls = negativos ? 'neg' : 'pos';
  if(!items.length) return `<div class="panel"><h3>${titulo}</h3><p class="field-hint">Nenhum.</p></div>`;
  const maxAbs = Math.max(1, ...items.map(i=>Math.abs(i.saldoValor)));
  return `<div class="panel">
    <h3>${titulo}</h3>
    <p class="panel-sub">${irEsc(subtitulo)}</p>
    ${items.map(i=>`<div class="bi-hbar-row bi-hbar-row-money">
      <div class="bi-hbar-label" title="${irEsc(i.nome)}">${irEsc(i.nome||i.item)}</div>
      <div class="bi-hbar-track"><div class="bi-hbar-fill ${cls}" style="width:${Math.round(Math.abs(i.saldoValor)/maxAbs*100)}%;"></div></div>
      <div class="bi-hbar-val">${i.saldoValor>0?'+':''}${irFmtMoney(i.saldoValor)}</div>
    </div>`).join('')}
  </div>`;
}
/* "Por que o NET do mês está tão negativo?" — mesmo ranking de itens, mas só do mês
   selecionado (padrão: o mês mais recente com movimento nos dados importados). */
function irRenderNet410ItensMesSection(d){
  const meses = d.porMes||[];
  if(!meses.length) return '';
  const mesSel = IR.net410MesSel && meses.some(m=>m.mes===IR.net410MesSel) ? IR.net410MesSel : meses[meses.length-1].mes;
  const m = meses.find(x=>x.mes===mesSel);
  const mesLabel = IR_MES_NOMES[parseInt(mesSel.slice(5,7),10)-1]||mesSel;
  return `
    <div class="two-col" style="max-width:340px;margin:20px 0 4px;">
      <div><label>Itens que mais impactam no mês</label><select onchange="irSetNet410Mes(this.value)">
        ${meses.map(x=>`<option value="${x.mes}" ${x.mes===mesSel?'selected':''}>${irEsc(IR_MES_NOMES[parseInt(x.mes.slice(5,7),10)-1]||x.mes)} (Net: ${irFmtMoney(x.net)})</option>`).join('')}
      </select></div>
      <div></div>
    </div>
    <div class="bi-grid-2">
      ${irRenderNet410ItensPanel(m.topItensPositivos, false, 'Soma do valor em '+mesLabel+', só motivos considerados pro NET.')}
      ${irRenderNet410ItensPanel(m.topItensNegativos, true, 'Soma do valor em '+mesLabel+', só motivos considerados pro NET.')}
    </div>
  `;
}
/* ============================================================
   GESTÃO DO CICLO
   ============================================================ */
/* Aba "NET" (ex-"Gestão do Ciclo") — comparação meta x realizado do ciclo e tabela
   detalhada de NET por combinação Log/Rua/Tipo. Primeiro rascunho: layout e colunas
   ainda serão ajustados conforme o usuário revisar. */
function irRenderGestaoCiclo(){
  const c = IR.cicloAtivo, ind = IR.indicadores;
  const metaRows = ind ? [
    {label:'Acurácia Peças', meta: ind.meta, real: ind.acuraciaPecas},
    {label:'Acurácia Locais', meta: ind.meta, real: ind.acuraciaLocal},
    {label:'Acurácia Valor', meta: ind.meta, real: ind.acuraciaValor},
    {label:'Andamento do ciclo', meta: 1, real: ind.andamentoCiclo}
  ] : [];
  return `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="margin-bottom:4px;">${irCicloLabel(c)} — ${irCicloStatus(c)==='aberto'?'Aberto':'Encerrado'}</h3>
          <p class="field-hint">Abertura: ${irFmtDate(c.dataAbertura)} · Término previsto: ${irFmtDate(c.dataPrevistaTermino)}${c.dataEncerramento?' · Encerrado em: '+irFmtDate(c.dataEncerramento):''}</p>
        </div>
        <div class="form-actions" style="margin:0;">
          ${irCicloStatus(c)==='aberto' ? `<button class="btn btn-secondary" onclick="irEncerrarCiclo()">Encerrar ciclo</button>` : ''}
          <button class="btn btn-primary" onclick="irSwitchTab('importacao')">Atualizar dados do ciclo</button>
        </div>
      </div>
      ${ind ? `<div class="progress-track" style="margin-top:14px;"><div class="progress-fill" style="width:${Math.min(100,ind.andamentoCiclo*100)}%;"></div></div>
      <p class="field-hint" style="margin-top:6px;">${irFmtInt(ind.locaisConcluidos)} de ${irFmtInt(ind.locaisCongelados)} locais concluídos (${irFmtPct(ind.andamentoCiclo)})</p>` : ''}
    </div>
    ${ind ? `<div class="panel">
      <h3>Como deveria estar x Como estamos</h3>
      <p class="panel-sub">Meta do ciclo comparada ao realizado até agora.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Indicador</th><th>Deveria estar (meta)</th><th>Estamos (realizado)</th><th>Diferença</th></tr></thead>
        <tbody>
          ${metaRows.map(r=>{
            const diff = r.real - r.meta, ok = diff>=0;
            return `<tr>
              <td>${r.label}</td>
              <td class="mono">${irFmtPct(r.meta)}</td>
              <td class="mono" style="${irHeatStyle(r.real, r.meta)}">${irFmtPct(r.real)}</td>
              <td class="mono" style="color:${ok?'var(--success)':'var(--danger)'};font-weight:700;">${ok?'+':''}${irFmtPct(diff)}</td>
            </tr>`;
          }).join('')}
          <tr>
            <td>NET (divergência líquida)</td>
            <td class="mono">${irFmtMoney(0)}</td>
            <td class="mono" style="color:${Math.abs(ind.valorDivergenteLiquido)<1?'var(--success)':'var(--danger)'};font-weight:700;">${irFmtMoney(ind.valorDivergenteLiquido)}</td>
            <td class="mono">${irFmtMoney(-ind.valorDivergenteLiquido)}</td>
          </tr>
        </tbody>
      </table></div>
    </div>` : ''}
    ${irRenderNet410Panel()}
    ${irRenderNetDistorcaoPanel()}
  `;
}
async function irEncerrarCiclo(){
  if(!confirm('Encerrar o ciclo '+IR.cicloAtivo.numero+'? Ele ficará registrado no histórico.')) return;
  IR.cicloAtivo.status = 'encerrado';
  IR.cicloAtivo.dataEncerramento = new Date().toISOString().slice(0,10);
  await irSaveCiclo(IR.cicloAtivo);
  IR.ciclos = await irGetAllCiclos();
  irShowToast('Ciclo encerrado.');
  irRenderView();
}

/* Versão condensada da Produtividade pro Dashboard: mesmo filtro de data (compartilha
   IR.prodFilters com a aba Produtividade completa), KPIs resumidos e top 5 do ranking —
   pensada pra caber numa tela só e servir de print rápido pro grupo. */
function irRenderDashProdutividade(){
  const contagens = irProdContagensBase(IR.dashFilters.applyProdDate);
  const p = irCalcProdutividade(contagens);
  return `<div class="panel">
    <h3>Produtividade</h3>
    <p class="panel-sub">Locais contados por colaborador, hora a hora${IR.dashFilters.applyProdDate ? ', no período selecionado acima' : ' (filtro de data desativado pra este painel)'}.</p>
    <div class="form-actions" style="margin:-6px 0 12px;"><button class="btn-link" onclick="irSwitchTab('produtividade')">Ver produtividade completa →</button></div>
    <div class="kpi-grid" style="margin-bottom:14px;">
      <div class="kpi-card orange"><div class="num mono">${irFmtInt(p.totalLocais)}</div><div class="label">Locais contados</div></div>
      <div class="kpi-card"><div class="num mono">${irFmtInt(p.totalItens)}</div><div class="label">Itens contados</div></div>
      <div class="kpi-card"><div class="num mono">${irFmtInt(p.totalPecas)}</div><div class="label">Peças contadas</div></div>
      <div class="kpi-card"><div class="num mono">${irFmtNum(p.itensPorHomemHora,1)}</div><div class="label">Itens / Homem-Hora</div></div>
    </div>
    ${irRenderProdMatriz(p, {limit:8})}
  </div>`;
}
/* ============================================================
   PRODUTIVIDADE
   ============================================================ */
function irProdSetFilter(key, val){ IR.prodFilters[key] = val; irRenderView(); }
function irProdToggleAbertura(){ IR.prodFilters.incluirAbertura = !IR.prodFilters.incluirAbertura; irRenderView(); }
function irToggleDashDateScope(key){ IR.dashFilters[key] = !IR.dashFilters[key]; irRenderView(); }
/* A produtividade individual é a única tela que enxerga contagem não liquidada:
   ela mede o esforço do conferente no dia em que ele contou, e uma contagem ainda
   em aberto já consumiu tempo de alguém. Como o status pode virar liquidado ou
   cancelado numa base seguinte, é esperado que o número se ajuste junto.
   O recorte de ajuste AIR vale aqui também — contagem de ADE ou AIC é esforço de
   outro programa, não do rotativo. */
/* Situação da linha na Produtividade: entra LIQUIDADO e entra CANCELADO, e só
   isso. Cancelado entra porque o conferente foi até o endereço e contou — o
   trabalho aconteceu, e descontá-lo da produtividade dele puniria o colaborador
   por uma interrupção que não foi ele quem causou. Linha em aberto (nem liquidada
   nem cancelada) fica fora: ainda não é um resultado, e vira liquidada ou
   cancelada na próxima base, quando então passa a contar.
   Nas acurácias nada disso entra — lá é só Liquidado, filtrado na ingestão da
   843 (situacaoLocal e situacaoInventario ambos 'Liquidado'). */
function irProdLinhaVale(c){
  if(c.liquidada!==false) return true; // liquidada (ou base antiga, que só gravava liquidada)
  return String(c.situacaoLocal||'').trim()==='Cancelado'
      || String(c.situacaoInventario||'').trim()==='Cancelado';
}
function irProdContagensBase(applyDate){
  const {de, ate, incluirAbertura} = IR.prodFilters;
  return IR.contagens.filter(c=>{
    if(String(c.motivo||'').trim().toUpperCase()!=='AIR') return false;
    if(!irProdLinhaVale(c)) return false;
    if((incluirAbertura ? c.idConferencia<1 : c.idConferencia<=1) || !c.usuario || !c.dataInicioContagem) return false;
    if(!applyDate) return true;
    const dia = c.dataInicioContagem.slice(0,10);
    if(de && dia<de) return false;
    if(ate && dia>ate) return false;
    return true;
  });
}
function irProdContagensFiltradas(){ return irProdContagensBase(true); }
const IR_HORA_INICIO = 6;  // 06:00 — início do expediente de inventário
const IR_HORA_FIM = 21;    // último bloco de hora do expediente (21:00–22:00)
/* Calcula ranking, matriz colaborador x hora e homem-hora a partir de um conjunto de
   contagens já filtrado. "Hora-homem" = nº de blocos de hora distintos (data+hora) em
   que cada colaborador registrou ao menos 1 contagem, somado entre todos — aproximação
   simples (sem ponto eletrônico), sinalizada na tela. A matriz colaborador x hora usa
   só a hora do dia (sem data), fixada na janela 06h–22h de expediente, somando os dias
   do período filtrado na mesma coluna. */
function irCalcProdutividade(contagens){
  const porUsuario = new Map();
  const horasPorUsuario = new Map();
  const matrizLocais = new Map(); // usuario -> Map(horaDia -> Set(locais))
  // Aqui a métrica é "local CONTADO" (esforço de cada colaborador), não "local
  // fechado" — um local recontado por mais de um colaborador conta pra todos que
  // participaram, de propósito (cada um fez trabalho real ali). Por isso o total
  // somado das linhas pode passar do total único de locais do ciclo — são métricas
  // diferentes: essa é "quem trabalhou onde", não deduplicação de local.
  for(const c of contagens){
    // Hora do bloco = Data Fim Contagem (quando o local foi de fato finalizado), não
    // Início — Início é só quando o colaborador abriu a contagem, podendo ficar em
    // aberto além do horário de trabalho dele (ex.: local pendurado, retomado depois
    // por outra pessoa ou fechado só no dia seguinte), o que jogava contagens pra
    // horários que ele nem estava trabalhando mais.
    const dataRef = c.dataFimContagem || c.dataInicioContagem;
    const horaCompleta = dataRef.slice(0,13); // YYYY-MM-DDTHH (p/ homem-hora)
    const horaDia = parseInt(dataRef.slice(11,13), 10); // 0-23 (p/ matriz)
    if(!porUsuario.has(c.usuario)) porUsuario.set(c.usuario, {usuario:c.usuario, locais:new Set(), itens:0, pecas:0, contagens:0, minutos:0, nMin:0, horas:new Set()});
    const gu = porUsuario.get(c.usuario);
    gu.locais.add(c.local); gu.itens++; gu.pecas += (c.qtFis||0); gu.contagens++; gu.horas.add(horaCompleta);
    if(c.dataInicioContagem && c.dataFimContagem){
      const ini=new Date(c.dataInicioContagem).getTime(), fim=new Date(c.dataFimContagem).getTime();
      if(fim>ini){ gu.minutos += (fim-ini)/60000; gu.nMin++; }
    }
    if(!horasPorUsuario.has(c.usuario)) horasPorUsuario.set(c.usuario, new Set());
    horasPorUsuario.get(c.usuario).add(horaCompleta);
    if(horaDia>=IR_HORA_INICIO && horaDia<=IR_HORA_FIM){
      if(!matrizLocais.has(c.usuario)) matrizLocais.set(c.usuario, new Map());
      const mu = matrizLocais.get(c.usuario);
      if(!mu.has(horaDia)) mu.set(horaDia, new Set());
      mu.get(horaDia).add(c.local);
    }
  }
  const ranking = Array.from(porUsuario.values()).map(g=>({
    usuario:g.usuario, locais:g.locais.size, itens:g.itens, pecas:g.pecas, contagens:g.contagens,
    tempoMedioMin: g.nMin>0 ? g.minutos/g.nMin : 0, horasAtivas: g.horas.size
  })).sort((a,b)=>b.locais-a.locais);
  const horasOrdenadas = [];
  for(let h=IR_HORA_INICIO; h<=IR_HORA_FIM; h++) horasOrdenadas.push(h);
  const matrizColaboradorHora = ranking.map(r=>({
    usuario: r.usuario,
    porHora: horasOrdenadas.map(h=>{
      const set = matrizLocais.has(r.usuario) ? matrizLocais.get(r.usuario).get(h) : null;
      return set ? set.size : 0;
    }),
    total: r.locais, pecas: r.pecas
  }));
  let horasHomem = 0;
  for(const set of horasPorUsuario.values()) horasHomem += set.size;
  const totalItens = contagens.length;
  const totalPecas = contagens.reduce((s,c)=>s+(c.qtFis||0),0);
  const totalLocais = new Set(contagens.map(c=>c.local)).size;
  return {
    ranking, horasOrdenadas, matrizColaboradorHora, horasHomem,
    itensPorHomemHora: horasHomem>0 ? totalItens/horasHomem : 0,
    pecasPorHomemHora: horasHomem>0 ? totalPecas/horasHomem : 0,
    totalItens, totalPecas, totalLocais
  };
}
function irRenderProdMatriz(p, opts){
  opts = opts||{};
  const linhas = opts.limit ? p.matrizColaboradorHora.slice(0, opts.limit) : p.matrizColaboradorHora;
  if(!linhas.length) return '<p class="field-hint">Nenhuma contagem no período selecionado.</p>';
  const horaLabel = h => String(h).padStart(2,'0')+'h';
  const totalPorHora = p.horasOrdenadas.map((h,i)=>linhas.reduce((s,r)=>s+r.porHora[i],0));
  const totalLocaisLinhas = linhas.reduce((s,r)=>s+r.total,0);
  const totalPecasLinhas = linhas.reduce((s,r)=>s+r.pecas,0);
  return `<div class="table-wrap"><table>
    <thead><tr>
      <th>Colaborador</th>
      ${p.horasOrdenadas.map(h=>`<th class="mono">${horaLabel(h)}</th>`).join('')}
      <th>Locais</th><th>Peças</th>
    </tr></thead>
    <tbody>
      ${linhas.map(r=>`<tr>
        <td>${irEsc(r.usuario.replace(/^MECA_/,''))}</td>
        ${r.porHora.map(v=>`<td class="mono">${v>0?irFmtInt(v):'—'}</td>`).join('')}
        <td class="mono" style="font-weight:700;">${irFmtInt(r.total)}</td>
        <td class="mono">${irFmtInt(r.pecas)}</td>
      </tr>`).join('')}
      <tr>
        <td style="font-weight:700;">Total</td>
        ${totalPorHora.map(v=>`<td class="mono" style="font-weight:700;">${irFmtInt(v)}</td>`).join('')}
        <td class="mono" style="font-weight:700;">${irFmtInt(opts.limit ? totalLocaisLinhas : p.totalLocais)}</td>
        <td class="mono" style="font-weight:700;">${irFmtInt(opts.limit ? totalPecasLinhas : p.totalPecas)}</td>
      </tr>
    </tbody>
  </table></div>`;
}
/* ============================================================
   PRODUTIVIDADE — análise completa
   Responde 5 perguntas: quanto a equipe produziu, qual a produtividade por
   hora, quem está acima/abaixo da meta, se a produção tem qualidade e se a
   capacidade fecha a meta do ciclo.

   Tudo sai dos dados que já existem no módulo (QRY0843 + Base Congelada).
   Dependências que a base AINDA NÃO tem, e que ficam declaradas na tela em vez
   de estimadas:
     • Ponto eletrônico / escala  -> homem-hora é aproximado por blocos de hora
       com registro de contagem, e "homem-hora disponível" não existe.
     • Turno                      -> filtro fica visível e desabilitado.
     • Tempo improdutivo          -> indicador aparece como indisponível.
     • Complexidade da posição    -> só há SKUs e peças por local; o índice
       composto fica preparado, sem peso inventado.
   ============================================================ */
const IR_PROD_META_PADRAO = {locaisPorHH:null, horasDia:8};
/* Semáforo padrão de atingimento: >=100% verde, 80–100% amarelo, <80% vermelho. */
function irProdSemaforo(pct){
  if(pct>=1) return {cls:'good', dot:'🟢', txt:'Acima da meta'};
  if(pct>=0.8) return {cls:'warn', dot:'🟡', txt:'Próximo da meta'};
  return {cls:'bad', dot:'🔴', txt:'Abaixo da meta'};
}
function irProdSetFiltroSel(key, val){ IR.prodFilters[key] = val; irRenderView(); }
function irProdSort(col){
  const s = IR.prodSort || {col:'locaisHora', dir:'desc'};
  IR.prodSort = (s.col===col) ? {col, dir: s.dir==='desc'?'asc':'desc'} : {col, dir:'desc'};
  irRenderView();
}
/* Setor (X1 da base congelada) de cada local, pro filtro por área. */
function irProdSetorPorLocal(){
  if(IR._setorPorLocal && IR._setorPorLocalCiclo===(IR.cicloAtivo||{}).id) return IR._setorPorLocal;
  const m = new Map();
  for(const l of (IR.locais||[])) m.set(l.idLocal, l.x1 || '(sem setor)');
  IR._setorPorLocal = m;
  IR._setorPorLocalCiclo = (IR.cicloAtivo||{}).id;
  return m;
}
/* Contagens da aba já com TODOS os filtros aplicados (período, colaborador, setor). */
function irProdContagensAnalise(){
  const {usuario, setor} = IR.prodFilters;
  const setorPorLocal = irProdSetorPorLocal();
  return irProdContagensFiltradas().filter(c=>{
    if(usuario && c.usuario!==usuario) return false;
    if(setor && (setorPorLocal.get(c.local)||'(sem setor)')!==setor) return false;
    return true;
  });
}
/* Histórico de rodadas por local — usa a base INTEIRA do ciclo (não a filtrada),
   porque saber se um local precisou de recontagem depende de todas as rodadas
   dele, mesmo as que caíram fora do período ou de outro colaborador. */
function irProdRodadasPorLocal(){
  const max = new Map();
  for(const c of (IR.contagens||[])){
    if(c.idConferencia<2) continue;
    const atual = max.get(c.local)||0;
    if(c.idConferencia>atual) max.set(c.local, c.idConferencia);
  }
  return max;
}
/* Núcleo de cálculo da aba. Recebe as contagens já filtradas e devolve tudo que
   os painéis precisam — por colaborador, por dia, por hora e consolidado. */
function irCalcProdAnalitica(contagens){
  const maxRodadaPorLocal = irProdRodadasPorLocal();
  const setorPorLocal = irProdSetorPorLocal();
  const porUsuario = new Map();
  const porDia = new Map();     // 'YYYY-MM-DD' -> {locais:Set, itens, pecas, blocos:Set}
  const porHora = new Map();    // 0-23 -> {locais:Set, itens, pecas, blocos:Set}
  const blocosGlobais = new Set();

  for(const c of contagens){
    // Mesma referência de horário já usada no módulo: Data Fim Contagem é quando o
    // local foi de fato finalizado (Início pode ficar pendurado fora do expediente).
    const dataRef = c.dataFimContagem || c.dataInicioContagem;
    if(!dataRef) continue;
    const dia = dataRef.slice(0,10);
    const bloco = dataRef.slice(0,13);           // YYYY-MM-DDTHH
    const hora = parseInt(dataRef.slice(11,13), 10);
    const blocoUsuario = c.usuario+'|'+bloco;    // homem-hora = usuário x bloco de hora

    if(!porUsuario.has(c.usuario)) porUsuario.set(c.usuario, {
      usuario:c.usuario, locais:new Set(), itens:0, pecas:0, contagens:0,
      blocos:new Set(), minutos:0, nMin:0,
      locaisPrimeira:new Set(), locaisPrimeiraOk:new Set(), locaisRecontagem:new Set()
    });
    const gu = porUsuario.get(c.usuario);
    gu.locais.add(c.local); gu.itens++; gu.pecas += (c.qtFis||0); gu.contagens++;
    gu.blocos.add(bloco);
    if(c.dataInicioContagem && c.dataFimContagem){
      const ini=new Date(c.dataInicioContagem).getTime(), fim=new Date(c.dataFimContagem).getTime();
      if(fim>ini){ gu.minutos += (fim-ini)/60000; gu.nMin++; }
    }
    // Qualidade: entre os locais em que o colaborador fez a PRIMEIRA contagem física
    // (rodada 2), quantos fecharam sem precisar de outra rodada.
    if(c.idConferencia===2){
      gu.locaisPrimeira.add(c.local);
      if((maxRodadaPorLocal.get(c.local)||2)<=2) gu.locaisPrimeiraOk.add(c.local);
    }
    if(c.idConferencia>=3) gu.locaisRecontagem.add(c.local);

    if(!porDia.has(dia)) porDia.set(dia, {dia, locais:new Set(), itens:0, pecas:0, blocos:new Set()});
    const gd = porDia.get(dia);
    gd.locais.add(c.local); gd.itens++; gd.pecas += (c.qtFis||0); gd.blocos.add(blocoUsuario);

    if(hora>=IR_HORA_INICIO && hora<=IR_HORA_FIM){
      if(!porHora.has(hora)) porHora.set(hora, {hora, locais:new Set(), itens:0, pecas:0, blocos:new Set()});
      const gh = porHora.get(hora);
      gh.locais.add(c.local); gh.itens++; gh.pecas += (c.qtFis||0); gh.blocos.add(blocoUsuario);
    }
    blocosGlobais.add(blocoUsuario);
  }

  const colaboradores = Array.from(porUsuario.values()).map(g=>{
    const hh = g.blocos.size;
    const locais = g.locais.size;
    const primeira = g.locaisPrimeira.size;
    return {
      usuario:g.usuario, locais, itens:g.itens, pecas:g.pecas, contagens:g.contagens,
      horasHomem: hh,
      locaisHora: hh>0 ? locais/hh : 0,
      itensHora:  hh>0 ? g.itens/hh : 0,
      pecasHora:  hh>0 ? g.pecas/hh : 0,
      tempoMedioMin: g.nMin>0 ? g.minutos/g.nMin : 0,
      minPorLocal: locais>0 ? hh*60/locais : 0,
      recontagens: g.locaisRecontagem.size,
      pctRecontagem: locais>0 ? g.locaisRecontagem.size/locais : 0,
      locaisPrimeira: primeira,
      pctPrimeira: primeira>0 ? g.locaisPrimeiraOk.size/primeira : null,
      // Contexto de complexidade que a base JÁ permite medir (SKUs e peças por posição).
      itensPorLocal: locais>0 ? g.itens/locais : 0,
      pecasPorLocal: locais>0 ? g.pecas/locais : 0
    };
  });

  const horasHomem = blocosGlobais.size;
  const totalLocais = new Set(contagens.map(c=>c.local)).size;
  const totalItens = contagens.length;
  const totalPecas = contagens.reduce((s,c)=>s+(c.qtFis||0),0);

  const dias = Array.from(porDia.values()).map(d=>({
    dia:d.dia, locais:d.locais.size, itens:d.itens, pecas:d.pecas, horasHomem:d.blocos.size,
    locaisHora: d.blocos.size>0 ? d.locais.size/d.blocos.size : 0,
    itensHora:  d.blocos.size>0 ? d.itens/d.blocos.size : 0,
    pecasHora:  d.blocos.size>0 ? d.pecas/d.blocos.size : 0
  })).sort((a,b)=>a.dia.localeCompare(b.dia));

  const horas = [];
  for(let h=IR_HORA_INICIO; h<=IR_HORA_FIM; h++){
    const g = porHora.get(h);
    horas.push({
      hora:h,
      locais: g?g.locais.size:0, itens: g?g.itens:0, pecas: g?g.pecas:0,
      horasHomem: g?g.blocos.size:0,
      locaisHora: (g&&g.blocos.size>0) ? g.locais.size/g.blocos.size : 0
    });
  }

  // Recontagem no nível da equipe: locais do recorte que precisaram de mais de uma
  // rodada física, sobre os locais do recorte.
  let locaisRecontados = 0;
  for(const local of new Set(contagens.map(c=>c.local))){
    if((maxRodadaPorLocal.get(local)||2)>=3) locaisRecontados++;
  }
  const setores = Array.from(new Set((IR.locais||[]).map(l=>l.x1||'(sem setor)'))).sort();

  return {
    colaboradores, dias, horas, horasHomem, totalLocais, totalItens, totalPecas,
    locaisRecontados, pctRecontagem: totalLocais>0 ? locaisRecontados/totalLocais : 0,
    locaisHora: horasHomem>0 ? totalLocais/horasHomem : 0,
    itensHora:  horasHomem>0 ? totalItens/horasHomem  : 0,
    pecasHora:  horasHomem>0 ? totalPecas/horasHomem  : 0,
    minPorLocal: totalLocais>0 ? horasHomem*60/totalLocais : 0,
    minPorItem:  totalItens>0  ? horasHomem*60/totalItens  : 0,
    setores, setorPorLocal
  };
}
/* Meta de locais/homem-hora. Quando não há meta cadastrada em Configurações, a
   referência é a média da própria equipe no recorte — e a tela diz isso, pra
   ninguém ler como meta oficial. */
function irProdMetaLocaisHH(a){
  const cfg = IR.prodMeta || IR_PROD_META_PADRAO;
  if(cfg.locaisPorHH>0) return {valor:cfg.locaisPorHH, origem:'cadastrada'};
  return {valor:a.locaisHora, origem:'media'};
}
/* Meta diária de locais do ciclo = locais congelados / dias úteis do ciclo. */
function irProdMetaDiaria(ind){
  const c = IR.cicloAtivo;
  if(!c || !c.dataAbertura || !c.dataPrevistaTermino) return null;
  const dias = irDiasUteisEntre(new Date(c.dataAbertura+'T12:00:00'), new Date(c.dataPrevistaTermino+'T12:00:00'));
  if(!dias) return null;
  return (ind.locaisCongelados||0)/dias;
}

/* ---------- CABEÇALHO DA ABA ---------- */
function irRenderProdHeader(ind){
  const c = IR.cicloAtivo;
  return `<div class="panel prod-hero">
    <img src="brand/Logo_LDM_hor_2.png" alt="Loja do Mecânico" class="prod-hero-logo">
    <div class="prod-hero-titles">
      <h2>Produtividade do Inventário</h2>
      <p>${c?irEsc(irCicloLabel(c)):'Sem ciclo'} · Centro de Distribuição Cajamar</p>
    </div>
    <div class="prod-hero-meta">
      <span>Atualizado em</span>
      <strong class="mono">${new Date().toLocaleString('pt-BR')}</strong>
    </div>
  </div>`;
}
/* ---------- FILTROS ---------- */
function irRenderProdFiltros(a){
  const f = IR.prodFilters;
  const usuarios = Array.from(new Set(irProdContagensBase(false).map(c=>c.usuario))).sort();
  const temFiltro = f.de||f.ate||f.usuario||f.setor;
  return `<div class="panel dash-filter-bar prod-filtros">
    <div class="dash-filter-group">
      <label>Período</label>
      <input type="date" value="${irEsc(f.de)}" onchange="irProdSetFilter('de', this.value)">
      <span class="dash-filter-sep">–</span>
      <input type="date" value="${irEsc(f.ate)}" onchange="irProdSetFilter('ate', this.value)">
    </div>
    <div class="dash-filter-group">
      <label>Colaborador</label>
      <select onchange="irProdSetFiltroSel('usuario', this.value)">
        <option value="">Todos (${usuarios.length})</option>
        ${usuarios.map(u=>`<option value="${irEsc(u)}" ${f.usuario===u?'selected':''}>${irEsc(String(u).replace(/^MECA_/,''))}</option>`).join('')}
      </select>
    </div>
    <div class="dash-filter-group">
      <label>Área / Setor</label>
      <select onchange="irProdSetFiltroSel('setor', this.value)">
        <option value="">Todos</option>
        ${a.setores.map(s=>`<option value="${irEsc(s)}" ${f.setor===s?'selected':''}>${irEsc(s)}</option>`).join('')}
      </select>
    </div>
    <div class="dash-filter-group">
      <label>Turno</label>
      <select disabled title="A base atual não traz turno."><option>Indisponível na base</option></select>
    </div>
    <label class="prod-filtro-check">
      <input type="checkbox" ${f.incluirAbertura?'checked':''} onchange="irProdToggleAbertura()">
      Incluir rodada 1 (abertura)
    </label>
    ${temFiltro ? `<button class="btn-link" onclick="irProdLimparFiltros()">Limpar filtros</button>` : ''}
    <button class="btn btn-secondary" style="margin-left:auto;" onclick="irCompartilharProdutividade()">📤 Compartilhar produtividade</button>
  </div>`;
}
function irProdLimparFiltros(){
  IR.prodFilters.de=''; IR.prodFilters.ate=''; IR.prodFilters.usuario=''; IR.prodFilters.setor='';
  irRenderView();
}
/* ---------- 6 CARDS PRINCIPAIS ---------- */
function irRenderProdCards(a, ind, meta, metaDiaria){
  // Comparação com o período anterior de mesmo tamanho — só quando há um período
  // fechado nos filtros, senão não existe "anterior" com que comparar.
  const comp = irProdComparativoAnterior();
  const deltaTxt = comp
    ? `<div class="delta ${comp.delta>=0?'down':'up'}">${comp.delta>=0?'▲':'▼'} ${irFmtPct(Math.abs(comp.delta))} vs. anterior</div>`
    : `<div class="sub">sem período para comparar</div>`;
  // Sem meta cadastrada, a referência É a média da equipe — comparar a equipe com
  // ela mesma daria 100% sempre, o que não informa nada. Nesse caso o card mostra a
  // origem da referência em vez de um atingimento falso.
  const temMeta = meta.origem==='cadastrada';
  const pctMeta = temMeta && meta.valor>0 ? a.locaisHora/meta.valor : 0;
  const sem = irProdSemaforo(pctMeta);
  const realizadoDia = a.dias.length ? a.totalLocais/a.dias.length : 0;
  const gapDia = metaDiaria!=null ? realizadoDia-metaDiaria : null;
  return `<div class="kpi-grid prod-cards">
    <div class="kpi-card orange">
      <div class="num mono">${irFmtInt(a.totalLocais)}</div>
      <div class="label">Posições inventariadas</div>
      ${deltaTxt}
    </div>
    <div class="kpi-card ${temMeta?sem.cls:'orange'}">
      <div class="num mono">${irFmtNum(a.locaisHora,1)}</div>
      <div class="label">Posições / Homem-hora</div>
      <div class="sub">${temMeta
        ? `${sem.dot} ${irFmtPct(pctMeta)} da meta (${irFmtNum(meta.valor,1)})`
        : 'sem meta cadastrada'}</div>
    </div>
    <div class="kpi-card">
      <div class="num mono">${irFmtNum(a.itensHora,1)}</div>
      <div class="label">Itens / Homem-hora</div>
      <div class="sub">${irFmtInt(a.totalItens)} itens no recorte</div>
    </div>
    <div class="kpi-card">
      <div class="num mono">${irFmtNum(a.pecasHora,1)}</div>
      <div class="label">Peças / Homem-hora</div>
      <div class="sub">${irFmtInt(a.totalPecas)} peças no recorte</div>
    </div>
    <div class="kpi-card ${metaDiaria!=null?irProdSemaforo(metaDiaria>0?realizadoDia/metaDiaria:0).cls:''}">
      <div class="num mono">${metaDiaria!=null&&metaDiaria>0?irFmtPct(realizadoDia/metaDiaria):'—'}</div>
      <div class="label">Atingimento da meta diária</div>
      <div class="sub">${metaDiaria!=null
        ? `${irFmtNum(realizadoDia,0)}/dia · meta ${irFmtNum(metaDiaria,0)} · gap ${gapDia>=0?'+':''}${irFmtNum(gapDia,0)}`
        : 'sem datas no ciclo'}</div>
    </div>
    <div class="kpi-card">
      <div class="num mono">${irFmtNum(a.minPorLocal,1)}</div>
      <div class="label">Tempo médio / posição</div>
      <div class="sub">minutos</div>
    </div>
  </div>`;
}
/* Período anterior de mesmo tamanho, pro delta do card 1. Só existe quando os dois
   extremos do filtro estão preenchidos. */
function irProdComparativoAnterior(){
  const {de, ate} = IR.prodFilters;
  if(!de || !ate) return null;
  const d0 = new Date(de+'T12:00:00'), d1 = new Date(ate+'T12:00:00');
  if(isNaN(d0)||isNaN(d1)||d1<d0) return null;
  const dias = Math.round((d1-d0)/86400000)+1;
  const antFim = new Date(d0); antFim.setDate(antFim.getDate()-1);
  const antIni = new Date(antFim); antIni.setDate(antIni.getDate()-dias+1);
  const iso = d => d.toISOString().slice(0,10);
  const dentro = (c, ini, fim) => {
    const dia = (c.dataFimContagem||c.dataInicioContagem||'').slice(0,10);
    return dia>=ini && dia<=fim;
  };
  const base = irProdContagensBase(false);
  const atual = new Set(base.filter(c=>dentro(c, de, ate)).map(c=>c.local)).size;
  const anterior = new Set(base.filter(c=>dentro(c, iso(antIni), iso(antFim))).map(c=>c.local)).size;
  if(!anterior) return null;
  return {atual, anterior, delta:(atual-anterior)/anterior};
}
/* ---------- EVOLUÇÃO DA PRODUTIVIDADE (dia a dia) ---------- */
function irRenderProdEvolucao(a, metaDiaria){
  if(!a.dias.length) return '';
  const media = a.totalLocais/a.dias.length;
  const W=1080, padL=64, padR=16, padT=22, padB=42, H=300;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const max = Math.max(...a.dias.map(d=>d.locais), metaDiaria||0, media)*1.12 || 1;
  const step = plotW/a.dias.length;
  const bw = Math.min(26, Math.max(6, step*0.5));
  let grid='', bars='';
  for(let i=0;i<=4;i++){
    const v=max*i/4, y=padT+plotH-(v/max)*plotH;
    grid += `<line x1="${padL}" x2="${W-padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="mes-grid"/>`
         +  `<text x="${padL-8}" y="${(y+3.5).toFixed(1)}" text-anchor="end" class="mes-axis">${irFmtInt(v)}</text>`;
  }
  const passo = Math.ceil(a.dias.length/14);
  a.dias.forEach((d,i)=>{
    const cx = padL+step*i+step/2;
    const h = (d.locais/max)*plotH;
    const tip = `${irFmtDate(d.dia)}
Locais: ${irFmtInt(d.locais)}
Homem-hora: ${irFmtInt(d.horasHomem)}
Locais/HH: ${irFmtNum(d.locaisHora,1)}
Itens/HH: ${irFmtNum(d.itensHora,1)}
Peças/HH: ${irFmtNum(d.pecasHora,1)}${metaDiaria?`
% da meta: ${irFmtPct(d.locais/metaDiaria)}`:''}`;
    bars += `<rect x="${(cx-bw/2).toFixed(1)}" y="${(padT+plotH-h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="var(--prod-bar)"><title>${irEsc(tip)}</title></rect>`;
    if(i%passo===0) bars += `<text x="${cx.toFixed(1)}" y="${H-22}" text-anchor="middle" class="mes-mon">${irEsc(d.dia.slice(8,10)+'/'+d.dia.slice(5,7))}</text>`;
  });
  const linha = (v, cls, rot) => {
    if(!v) return '';
    const y = padT+plotH-(v/max)*plotH;
    return `<line x1="${padL}" x2="${W-padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="${cls}"/>`
      + `<text x="${W-padR}" y="${(y-6).toFixed(1)}" text-anchor="end" class="prod-ref-lbl">${irEsc(rot)}</text>`;
  };
  return `<div class="panel">
    <h3>📈 Evolução da produtividade</h3>
    <p class="panel-sub">Locais por dia · meta diária e média da equipe.</p>
    <div class="mes-legend">
      <span class="mes-lg"><span class="mes-sw" style="background:var(--prod-bar)"></span>Locais inventariados</span>
      <span class="mes-lg"><span class="mes-sw prod-sw-meta"></span>Meta diária${metaDiaria?' ('+irFmtNum(metaDiaria,0)+')':' indisponível'}</span>
      <span class="mes-lg"><span class="mes-sw prod-sw-media"></span>Média da equipe (${irFmtNum(media,0)})</span>
    </div>
    <div class="mes-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Locais inventariados por dia">
      ${grid}${bars}
      <line x1="${padL}" x2="${W-padR}" y1="${padT+plotH}" y2="${padT+plotH}" class="mes-grid"/>
      ${linha(media,'prod-linha-media','média')}
      ${linha(metaDiaria,'prod-linha-meta','meta')}
    </svg></div>
  </div>`;
}
/* ---------- RANKING DE PRODUTIVIDADE ---------- */
const IR_PROD_COLS = [
  {key:'usuario',      lbl:'Colaborador', tipo:'txt'},
  {key:'locais',       lbl:'Locais'},
  {key:'itens',        lbl:'Itens'},
  {key:'pecas',        lbl:'Peças'},
  {key:'horasHomem',   lbl:'Homem-hora'},
  {key:'locaisHora',   lbl:'Locais/Hora'},
  {key:'itensHora',    lbl:'Itens/Hora'},
  {key:'pecasHora',    lbl:'Peças/Hora'},
  {key:'meta',         lbl:'Meta'},
  {key:'pctMeta',      lbl:'% Meta'},
  {key:'recontagens',  lbl:'Recontagens'},
  {key:'pctPrimeira',  lbl:'% 1ª Contagem'}
];
function irRenderProdRanking(a, meta){
  if(!a.colaboradores.length) return `<div class="panel"><h3>🏅 Ranking de produtividade</h3><p class="field-hint">Sem contagens no recorte selecionado.</p></div>`;
  const s = IR.prodSort || {col:'locaisHora', dir:'desc'};
  const linhas = a.colaboradores.map(r=>({
    ...r, meta: meta.valor, pctMeta: meta.valor>0 ? r.locaisHora/meta.valor : 0
  })).sort((x,y)=>{
    const dir = s.dir==='desc' ? -1 : 1;
    if(s.col==='usuario') return dir*String(x.usuario).localeCompare(String(y.usuario));
    const vx = x[s.col]==null?-1:x[s.col], vy = y[s.col]==null?-1:y[s.col];
    return dir*(vx-vy);
  });
  const seta = k => s.col===k ? (s.dir==='desc'?' ▼':' ▲') : '';
  return `<div class="panel">
    <h3>🏅 Ranking de produtividade</h3>
    <p class="panel-sub">Ordenado por <strong>${irEsc((IR_PROD_COLS.find(c=>c.key===s.col)||{}).lbl||'Locais/Hora')}</strong> · clique na coluna para reordenar.</p>
    <div class="table-wrap"><table class="prod-rank">
      <thead><tr>
        <th>#</th>
        ${IR_PROD_COLS.map(c=>`<th class="prod-th" onclick="irProdSort('${c.key}')">${irEsc(c.lbl)}${seta(c.key)}</th>`).join('')}
      </tr></thead>
      <tbody>${linhas.map((r,i)=>{
        const sem = irProdSemaforo(r.pctMeta);
        return `<tr>
          <td class="mono">${i+1}</td>
          <td>${sem.dot} ${irEsc(String(r.usuario).replace(/^MECA_/,''))}</td>
          <td class="mono">${irFmtInt(r.locais)}</td>
          <td class="mono">${irFmtInt(r.itens)}</td>
          <td class="mono">${irFmtInt(r.pecas)}</td>
          <td class="mono">${irFmtInt(r.horasHomem)}</td>
          <td class="mono" style="font-weight:700;">${irFmtNum(r.locaisHora,1)}</td>
          <td class="mono">${irFmtNum(r.itensHora,1)}</td>
          <td class="mono">${irFmtNum(r.pecasHora,1)}</td>
          <td class="mono">${irFmtNum(r.meta,1)}</td>
          <td class="mono prod-${sem.cls}">${irFmtPct(r.pctMeta)}</td>
          <td class="mono">${irFmtInt(r.recontagens)}</td>
          <td class="mono">${r.pctPrimeira==null?'—':irFmtPct(r.pctPrimeira)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <p class="field-hint" style="margin-top:8px;">🟢 ≥100% · 🟡 80–100% · 🔴 &lt;80% · meta ${irFmtNum(meta.valor,1)} locais/HH ${meta.origem==='media'?'(média da equipe)':'(cadastrada)'}</p>
  </div>`;
}
/* ---------- RITMO DA OPERAÇÃO (hora a hora) ---------- */
function irRenderProdRitmo(a){
  const horas = a.horas;
  const temDado = horas.some(h=>h.locais>0);
  if(!temDado) return '';
  const comDado = horas.filter(h=>h.locais>0);
  const pico = comDado.reduce((m,h)=>h.locaisHora>m.locaisHora?h:m, comDado[0]);
  const vale = comDado.reduce((m,h)=>h.locaisHora<m.locaisHora?h:m, comDado[0]);
  const W=1080, padL=64, padR=16, padT=22, padB=42, H=300;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const max = Math.max(...horas.map(h=>h.locais))*1.12 || 1;
  const maxProd = Math.max(...horas.map(h=>h.locaisHora)) || 1;
  const step = plotW/horas.length;
  const bw = Math.min(26, step*0.5);
  let grid='', bars='', pts=[];
  for(let i=0;i<=4;i++){
    const v=max*i/4, y=padT+plotH-(v/max)*plotH;
    grid += `<line x1="${padL}" x2="${W-padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="mes-grid"/>`
         +  `<text x="${padL-8}" y="${(y+3.5).toFixed(1)}" text-anchor="end" class="mes-axis">${irFmtInt(v)}</text>`;
  }
  horas.forEach((h,i)=>{
    const cx=padL+step*i+step/2, hh=(h.locais/max)*plotH;
    const tip = `${String(h.hora).padStart(2,'0')}h
Locais: ${irFmtInt(h.locais)}
Itens: ${irFmtInt(h.itens)}
Peças: ${irFmtInt(h.pecas)}
Homem-hora: ${irFmtInt(h.horasHomem)}
Locais/HH: ${h.horasHomem?irFmtNum(h.locaisHora,1):'sem base'}`;
    bars += `<rect x="${(cx-bw/2).toFixed(1)}" y="${(padT+plotH-hh).toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" rx="3" fill="var(--prod-bar)"><title>${irEsc(tip)}</title></rect>`
         +  `<text x="${cx.toFixed(1)}" y="${H-22}" text-anchor="middle" class="mes-mon">${String(h.hora).padStart(2,'0')}h</text>`;
    if(h.horasHomem>0) pts.push([cx, padT+plotH-(h.locaisHora/maxProd)*plotH*0.9]);
  });
  const linha = pts.length>1 ? `<polyline points="${pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')}" class="prod-linha-prod"/>` : '';
  return `<div class="panel">
    <h3>⏱️ Ritmo da operação</h3>
    <p class="panel-sub">Volume por hora (06h–21h) · linha = locais/HH, escala própria.</p>
    <div class="mes-legend">
      <span class="mes-lg"><span class="mes-sw" style="background:var(--prod-bar)"></span>Locais inventariados</span>
      <span class="mes-lg"><span class="mes-sw prod-sw-prod"></span>Locais / homem-hora</span>
      <span class="mes-legend-right">Passe o mouse para ver itens, peças e homem-hora da hora</span>
    </div>
    <div class="mes-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ritmo da operação por hora">
      ${grid}${bars}
      <line x1="${padL}" x2="${W-padR}" y1="${padT+plotH}" y2="${padT+plotH}" class="mes-grid"/>
      ${linha}
    </svg></div>
    <div class="prod-destaques">
      ${pico.hora!==vale.hora ? `
      <div class="prod-destaque good"><span>🟢 Pico de produtividade</span><strong>${String(pico.hora).padStart(2,'0')}h · ${irFmtNum(pico.locaisHora,1)} locais/HH</strong></div>
      <div class="prod-destaque bad"><span>🔴 Menor produtividade</span><strong>${String(vale.hora).padStart(2,'0')}h · ${irFmtNum(vale.locaisHora,1)} locais/HH</strong></div>`
      : `<div class="prod-destaque"><span>Ritmo ao longo do dia</span><strong>Uniforme — nenhuma hora se destaca</strong></div>`}
      <div class="prod-destaque"><span>Maior volume</span><strong>${(()=>{const m=comDado.reduce((x,h)=>h.locais>x.locais?h:x,comDado[0]);return String(m.hora).padStart(2,'0')+'h · '+irFmtInt(m.locais)+' locais';})()}</strong></div>
    </div>
  </div>`;
}
/* ---------- CAPACIDADE OPERACIONAL ---------- */
function irRenderProdCapacidade(a, meta){
  const capacidade = a.horasHomem*meta.valor;
  const util = capacidade>0 ? a.totalLocais/capacidade : 0;
  const gap = a.totalLocais-capacidade;
  return `<div class="panel">
    <h3>🧰 Capacidade operacional</h3>
    <p class="panel-sub">Capacidade teórica = homem-hora × meta locais/HH.</p>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="num mono">${irFmtInt(a.colaboradores.length)}</div><div class="label">Colaboradores ativos</div></div>
      <div class="kpi-card"><div class="num mono">${irFmtInt(a.horasHomem)}</div><div class="label">Homem-hora utilizado</div><div class="sub">disponível: sem escala na base</div></div>
      <div class="kpi-card"><div class="num mono">${irFmtInt(capacidade)}</div><div class="label">Capacidade teórica (locais)</div></div>
      <div class="kpi-card orange"><div class="num mono">${irFmtInt(a.totalLocais)}</div><div class="label">Produção realizada</div></div>
      <div class="kpi-card ${irProdSemaforo(util).cls}"><div class="num mono">${irFmtPct(util)}</div><div class="label">Capacidade utilizada</div></div>
      <div class="kpi-card ${gap>=0?'good':'bad'}"><div class="num mono">${gap>=0?'+':''}${irFmtInt(gap)}</div><div class="label">Gap de produção</div></div>
    </div>
    <div class="prod-barra"><div class="prod-barra-fill ${irProdSemaforo(util).cls}" style="width:${Math.min(100,util*100).toFixed(1)}%;"></div></div>
    <p class="field-hint">${irFmtPct(util)} da capacidade teórica.</p>
  </div>`;
}
/* ---------- PROJEÇÃO DE FECHAMENTO ---------- */
function irRenderProdProjecao(a, ind){
  const metaCiclo = ind.locaisCongelados||0;
  const realizado = ind.locaisConcluidos||0;
  const diasTrab = a.dias.length;
  const diasRest = ind.diasRestantes;
  const mediaDia = diasTrab>0 ? a.totalLocais/diasTrab : 0;
  const falta = Math.max(0, metaCiclo-realizado);
  const necessarioDia = (diasRest && diasRest>0) ? falta/diasRest : null;
  const projecao = (diasRest!=null) ? realizado + mediaDia*diasRest : null;
  const ok = projecao!=null && projecao>=metaCiclo;
  return `<div class="panel">
    <h3>🎯 Projeção de fechamento</h3>
    <p class="panel-sub">Projeção = realizado + (média diária × dias úteis restantes).</p>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="num mono">${irFmtInt(metaCiclo)}</div><div class="label">Meta do ciclo</div><div class="sub">locais congelados</div></div>
      <div class="kpi-card orange"><div class="num mono">${irFmtInt(realizado)}</div><div class="label">Realizado</div><div class="sub">${metaCiclo>0?irFmtPct(realizado/metaCiclo):'—'} da meta</div></div>
      <div class="kpi-card"><div class="num mono">${irFmtInt(diasTrab)}</div><div class="label">Dias trabalhados</div><div class="sub">no recorte</div></div>
      <div class="kpi-card"><div class="num mono">${diasRest==null?'—':irFmtInt(diasRest)}</div><div class="label">Dias restantes</div><div class="sub">dias úteis</div></div>
      <div class="kpi-card"><div class="num mono">${irFmtNum(mediaDia,0)}</div><div class="label">Média diária atual</div><div class="sub">necessário: ${necessarioDia==null?'—':irFmtNum(necessarioDia,0)}/dia</div></div>
      <div class="kpi-card ${projecao==null?'':(ok?'good':'bad')}">
        <div class="num mono">${projecao==null?'—':irFmtInt(projecao)}</div>
        <div class="label">Projeção de fechamento</div>
        <div class="sub">${projecao==null?'sem data de término no ciclo':(ok?'🟢 Meta projetada':'🔴 Risco de não atingimento')} · gap ${projecao==null?'—':(projecao-metaCiclo>=0?'+':'')+irFmtInt(projecao-metaCiclo)}</div>
      </div>
    </div>
  </div>`;
}
/* ---------- PRODUTIVIDADE × QUALIDADE (dispersão com 4 quadrantes) ---------- */
function irRenderProdQualidade(a, meta){
  const pts = a.colaboradores.filter(c=>c.pctPrimeira!=null && c.horasHomem>0);
  if(pts.length<2) return `<div class="panel"><h3>🎯 Produtividade × Qualidade</h3><p class="field-hint">São necessários ao menos 2 colaboradores com primeira contagem registrada no recorte.</p></div>`;
  const mediaQual = pts.reduce((s,c)=>s+c.pctPrimeira,0)/pts.length;
  const W=1080, padL=64, padR=20, padT=20, padB=44, H=380;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const maxX = Math.max(...pts.map(c=>c.locaisHora), meta.valor)*1.15 || 1;
  const minY = Math.min(...pts.map(c=>c.pctPrimeira), mediaQual)*0.98;
  const maxY = 1;
  const spanY = Math.max(0.02, maxY-minY);
  const px = v => padL + (v/maxX)*plotW;
  const py = v => padT + plotH - ((v-minY)/spanY)*plotH;
  const cutX = px(meta.valor), cutY = py(mediaQual);
  // O rótulo fica ancorado no lado externo do quadrante e some quando o quadrante
  // é estreito demais pra caber o texto — melhor sem legenda do que com legenda
  // vazando por cima do quadrante vizinho.
  const quad = (x,y,w,h,cls,txt,dir) => {
    const rect = `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0,w).toFixed(1)}" height="${Math.max(0,h).toFixed(1)}" class="prod-quad ${cls}"/>`;
    if(w < txt.length*6.2 + 16) return rect;
    const tx = dir==='end' ? x+w-8 : x+8;
    return rect + `<text x="${tx.toFixed(1)}" y="${(y+16).toFixed(1)}" text-anchor="${dir||'start'}" class="prod-quad-lbl">${irEsc(txt)}</text>`;
  };
  const bolas = pts.map(c=>{
    const x=px(c.locaisHora), y=py(c.pctPrimeira);
    const tip = `${String(c.usuario).replace(/^MECA_/,'')}
Locais/HH: ${irFmtNum(c.locaisHora,1)}
1ª contagem correta: ${irFmtPct(c.pctPrimeira)}
Locais: ${irFmtInt(c.locais)} · Homem-hora: ${irFmtInt(c.horasHomem)}`;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" class="prod-dot"><title>${irEsc(tip)}</title></circle>`;
  }).join('');
  return `<div class="panel">
    <h3>🎯 Produtividade × Qualidade</h3>
    <p class="panel-sub">X = locais/HH · Y = % 1ª contagem · cortes na meta (${irFmtNum(meta.valor,1)}) e na média de qualidade (${irFmtPct(mediaQual)}).</p>
    <div class="mes-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Dispersão produtividade x qualidade">
      ${quad(cutX, padT, padL+plotW-cutX, cutY-padT, 'q-ref', 'Referência — rápido e certo', 'end')}
      ${quad(padL, padT, cutX-padL, cutY-padT, 'q-opo', 'Oportunidade de ganho')}
      ${quad(cutX, cutY, padL+plotW-cutX, padT+plotH-cutY, 'q-risco', 'Velocidade com risco', 'end')}
      ${quad(padL, cutY, cutX-padL, padT+plotH-cutY, 'q-acao', 'Prioridade de ação')}
      <line x1="${cutX.toFixed(1)}" x2="${cutX.toFixed(1)}" y1="${padT}" y2="${padT+plotH}" class="prod-corte"/>
      <line x1="${padL}" x2="${padL+plotW}" y1="${cutY.toFixed(1)}" y2="${cutY.toFixed(1)}" class="prod-corte"/>
      ${bolas}
      <line x1="${padL}" x2="${padL+plotW}" y1="${padT+plotH}" y2="${padT+plotH}" class="mes-grid"/>
      <text x="${padL}" y="${H-14}" class="mes-mon">0</text>
      <text x="${padL+plotW}" y="${H-14}" text-anchor="end" class="mes-mon">${irFmtNum(maxX,1)} locais/HH</text>
      <text x="${padL-8}" y="${(padT+10)}" text-anchor="end" class="mes-axis">${irFmtPct(maxY)}</text>
      <text x="${padL-8}" y="${(padT+plotH)}" text-anchor="end" class="mes-axis">${irFmtPct(minY)}</text>
    </svg></div>
  </div>`;
}
/* ---------- RECONTAGEM ---------- */
function irRenderProdRecontagem(a){
  const comRec = a.colaboradores.filter(c=>c.recontagens>0).sort((x,y)=>y.pctRecontagem-x.pctRecontagem);
  const mediaPorColab = a.colaboradores.length ? a.colaboradores.reduce((s,c)=>s+c.recontagens,0)/a.colaboradores.length : 0;
  const pior = comRec[0];
  const max = Math.max(1, ...a.colaboradores.map(c=>c.pctRecontagem));
  return `<div class="panel">
    <h3>🔁 Recontagem</h3>
    <p class="panel-sub">Local recontado = precisou de mais de uma rodada física.</p>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="num mono">${irFmtInt(a.locaisRecontados)}</div><div class="label">Locais recontados</div></div>
      <div class="kpi-card ${a.pctRecontagem>0.1?'bad':''}"><div class="num mono">${irFmtPct(a.pctRecontagem)}</div><div class="label">% de recontagem</div><div class="sub">sobre os locais do recorte</div></div>
      <div class="kpi-card"><div class="num mono">${irFmtNum(mediaPorColab,1)}</div><div class="label">Média por colaborador</div></div>
      <div class="kpi-card ${pior?'bad':''}"><div class="num mono" style="font-size:16px;">${pior?irEsc(String(pior.usuario).replace(/^MECA_/,'')):'—'}</div><div class="label">Maior índice</div><div class="sub">${pior?irFmtPct(pior.pctRecontagem)+' dos locais dele':'sem recontagens no recorte'}</div></div>
    </div>
    ${a.colaboradores.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Colaborador</th><th>Locais</th><th>Recontagens</th><th>% Recontagem</th><th style="width:34%;"></th></tr></thead>
      <tbody>${a.colaboradores.slice().sort((x,y)=>y.pctRecontagem-x.pctRecontagem).map(c=>`<tr>
        <td>${irEsc(String(c.usuario).replace(/^MECA_/,''))}</td>
        <td class="mono">${irFmtInt(c.locais)}</td>
        <td class="mono">${irFmtInt(c.recontagens)}</td>
        <td class="mono">${irFmtPct(c.pctRecontagem)}</td>
        <td><div class="prod-barra mini"><div class="prod-barra-fill ${c.pctRecontagem>0.1?'bad':'warn'}" style="width:${(c.pctRecontagem/max*100).toFixed(1)}%;"></div></div></td>
      </tr>`).join('')}</tbody>
    </table></div>` : ''}
  </div>`;
}
/* ---------- TEMPO E EFICIÊNCIA + COMPLEXIDADE ---------- */
function irRenderProdTempo(a){
  return `<div class="panel">
    <h3>⏳ Tempo e eficiência</h3>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="num mono">${irFmtInt(a.horasHomem)}</div><div class="label">Homem-hora total</div></div>
      <div class="kpi-card"><div class="num mono">${irFmtInt(a.horasHomem)}</div><div class="label">Homem-hora produtivo</div></div>
      <div class="kpi-card"><div class="num mono">—</div><div class="label">Homem-hora improdutivo</div><div class="sub">indisponível na base</div></div>
      <div class="kpi-card"><div class="num mono">${irFmtNum(a.minPorLocal,1)}</div><div class="label">Tempo médio / posição</div><div class="sub">minutos</div></div>
      <div class="kpi-card"><div class="num mono">${irFmtNum(a.minPorItem,2)}</div><div class="label">Tempo médio / item</div><div class="sub">minutos</div></div>
      <div class="kpi-card"><div class="num mono">${irFmtNum(a.dias.length?a.horasHomem/a.dias.length:0,1)}</div><div class="label">Homem-hora / dia</div></div>
    </div>
    <p class="field-hint">Tempo improdutivo exige apontamento de pausa/deslocamento — fora da QRY0843.</p>
  </div>
  <div class="panel">
    <h3>🧩 Produtividade ajustada por complexidade</h3>
    <p class="panel-sub">Índice pendente de dados e de pesos. Abaixo, a densidade real por colaborador.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Componente</th><th>Situação na base atual</th></tr></thead>
      <tbody>
        <tr><td>SKUs (itens distintos) na posição</td><td>✅ disponível — QRY0843</td></tr>
        <tr><td>Peças na posição</td><td>✅ disponível — QRY0843 (QT_FIS)</td></tr>
        <tr><td>Necessidade de recontagem</td><td>✅ disponível — rodadas por local</td></tr>
        <tr><td>Quantidade de endereços por posição</td><td>❌ não disponível</td></tr>
        <tr><td>Altura / acessibilidade da posição</td><td>❌ não disponível</td></tr>
        <tr><td>Peso da complexidade no índice</td><td>❌ não definido pela operação</td></tr>
      </tbody>
    </table></div>
    ${a.colaboradores.length ? `<div class="table-wrap" style="margin-top:10px;"><table>
      <thead><tr><th>Colaborador</th><th>Itens / posição</th><th>Peças / posição</th><th>Locais/Hora</th></tr></thead>
      <tbody>${a.colaboradores.slice().sort((x,y)=>y.pecasPorLocal-x.pecasPorLocal).map(c=>`<tr>
        <td>${irEsc(String(c.usuario).replace(/^MECA_/,''))}</td>
        <td class="mono">${irFmtNum(c.itensPorLocal,1)}</td>
        <td class="mono">${irFmtNum(c.pecasPorLocal,1)}</td>
        <td class="mono">${irFmtNum(c.locaisHora,1)}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : ''}
  </div>`;
}
/* ---------- DIAGNÓSTICO AUTOMÁTICO ---------- */
function irRenderProdDiagnostico(a, ind, meta, metaDiaria){
  if(!a.colaboradores.length) return '';
  // Diagnóstico em linhas curtas "rótulo -> número": o número é o que decide, o
  // texto só nomeia o que está sendo medido.
  const fatos = [];
  const alertas = [];
  const temMeta = meta.origem==='cadastrada';
  const pctMeta = temMeta && meta.valor>0 ? a.locaisHora/meta.valor : 0;
  const sem = irProdSemaforo(pctMeta);
  alertas.push(temMeta
    ? {cls:sem.cls, txt:`${sem.dot} ${irFmtPct(pctMeta)} da meta`}
    : {cls:'warn', txt:'🟡 Sem meta cadastrada'});
  fatos.push({lbl:'Ritmo da equipe', val:irFmtNum(a.locaisHora,1)+' locais/HH',
              sub: temMeta ? `meta ${irFmtNum(meta.valor,1)}` : 'referência: média da equipe'});

  const comDado = a.horas.filter(h=>h.horasHomem>0);
  if(comDado.length>1){
    const pico = comDado.reduce((m,h)=>h.locaisHora>m.locaisHora?h:m, comDado[0]);
    const vale = comDado.reduce((m,h)=>h.locaisHora<m.locaisHora?h:m, comDado[0]);
    if(pico.hora!==vale.hora){
      fatos.push({lbl:'Melhor hora', val:String(pico.hora).padStart(2,'0')+'h', sub:irFmtNum(pico.locaisHora,1)+' locais/HH', cls:'good'});
      fatos.push({lbl:'Pior hora',   val:String(vale.hora).padStart(2,'0')+'h', sub:irFmtNum(vale.locaisHora,1)+' locais/HH', cls:'bad'});
    }
  }
  const abaixo = a.colaboradores.filter(c=>meta.valor>0 && c.locaisHora/meta.valor<0.8);
  fatos.push({lbl:'Abaixo de 80% da meta', val:irFmtInt(abaixo.length)+' de '+irFmtInt(a.colaboradores.length),
              sub: abaixo.length ? abaixo.slice(0,3).map(c=>String(c.usuario).replace(/^MECA_/,'')).join(', ')+(abaixo.length>3?'…':'') : 'nenhum',
              cls: abaixo.length?'bad':'good'});
  alertas.push(abaixo.length
    ? {cls:'bad', txt:`🔴 ${abaixo.length} abaixo de 80%`}
    : {cls:'good', txt:'🟢 Todos acima de 80%'});

  fatos.push({lbl:'Recontagem', val:irFmtPct(a.pctRecontagem), sub:irFmtInt(a.locaisRecontados)+' locais',
              cls: a.pctRecontagem>0.1?'bad':''});
  if(a.pctRecontagem>0.1) alertas.push({cls:'bad', txt:`🔴 Recontagem ${irFmtPct(a.pctRecontagem)}`});

  const metaCiclo = ind.locaisCongelados||0, realizado = ind.locaisConcluidos||0;
  const mediaDia = a.dias.length ? a.totalLocais/a.dias.length : 0;
  if(ind.diasRestantes!=null && metaCiclo>0){
    const projecao = realizado + mediaDia*ind.diasRestantes;
    const ok = projecao>=metaCiclo;
    fatos.push({lbl:'Projeção do ciclo', val:irFmtPct(projecao/metaCiclo),
                sub:`${irFmtInt(projecao)} de ${irFmtInt(metaCiclo)}`, cls: ok?'good':'bad'});
    alertas.push(ok
      ? {cls:'good', txt:'🟢 Projeção bate a meta'}
      : {cls:'bad',  txt:`🔴 Faltam ${irFmtInt(metaCiclo-projecao)} locais`});
  }
  const ordem = a.colaboradores.slice().sort((x,y)=>y.locaisHora-x.locaisHora);
  const melhor = ordem[0], menor = ordem[ordem.length-1];
  if(melhor && menor && melhor!==menor){
    fatos.push({lbl:'Maior produtividade', val:irFmtNum(melhor.locaisHora,1), sub:String(melhor.usuario).replace(/^MECA_/,''), cls:'good'});
    fatos.push({lbl:'Menor produtividade', val:irFmtNum(menor.locaisHora,1), sub:String(menor.usuario).replace(/^MECA_/,''), cls:'bad'});
  }
  return `<div class="panel">
    <h3>🧠 Diagnóstico</h3>
    <div class="prod-alertas">${alertas.map(al=>`<span class="prod-alerta ${al.cls}">${irEsc(al.txt)}</span>`).join('')}</div>
    <div class="prod-fatos">${fatos.map(f=>`<div class="prod-fato ${f.cls||''}">
      <span class="prod-fato-lbl">${irEsc(f.lbl)}</span>
      <strong class="mono">${irEsc(f.val)}</strong>
      <span class="prod-fato-sub">${irEsc(f.sub||'')}</span>
    </div>`).join('')}</div>
  </div>`;
}
function irRenderProdutividade(){
  const ind = IR.indicadores;
  if(!ind) return irEmptyState('Sem dados', 'Processe o ciclo na Importação.', "irSwitchTab('importacao')", 'Ir para Importação');
  const contagens = irProdContagensAnalise();
  const a = irCalcProdAnalitica(contagens);
  const p = irCalcProdutividade(contagens); // pódio, matriz hora a hora e exports
  const meta = irProdMetaLocaisHH(a);
  const metaDiaria = irProdMetaDiaria(ind);
  if(!contagens.length){
    return `${irRenderProdHeader(ind)}${irRenderProdFiltros(a)}
      <div class="panel"><p class="field-hint">Nenhuma contagem no recorte.</p></div>`;
  }
  return `
    ${irRenderProdHeader(ind)}
    ${irRenderProdFiltros(a)}
    ${IR.prodFilters.incluirAbertura ? `<p class="field-hint" style="color:var(--orange);margin:-8px 0 12px;">Rodada 1 incluída — é sistêmica, não é conferência.</p>` : ''}
    ${irRenderProdCards(a, ind, meta, metaDiaria)}
    <p class="field-hint" style="margin:-8px 0 14px;">${irFmtInt(a.horasHomem)} homem-hora no recorte · blocos de hora com contagem registrada (sem ponto eletrônico).</p>
    ${irRenderProdDiagnostico(a, ind, meta, metaDiaria)}
    ${irRenderProdEvolucao(a, metaDiaria)}
    ${irRenderProdRanking(a, meta)}
    ${irRenderProdRitmo(a)}
    ${irRenderProdCapacidade(a, meta)}
    ${irRenderProdProjecao(a, ind)}
    ${irRenderProdQualidade(a, meta)}
    ${irRenderProdRecontagem(a)}
    ${irRenderProdTempo(a)}
    <div class="panel">
      <div class="panel-head-row">
        <h3>🏆 Pódio da equipe (por locais contados)</h3>
        <button class="btn btn-secondary" onclick="irExportarRankingImagem()">🖼️ Exportar ranking (imagem)</button>
      </div>
      ${irRenderPodio(p.ranking)}
    </div>
    <div class="panel">
      <h3>Locais por colaborador, hora a hora</h3>
      <p class="panel-sub">Cada célula é o número de locais distintos que o colaborador contou naquele horário. Janela de expediente: 06h–22h (soma os dias do recorte).</p>
      ${irRenderProdMatriz(p)}
    </div>
  `;
}
// Medalha pros 3 primeiros do ranking; do 4º em diante volta pro número da posição.
function irMedalha(i){
  return i===0 ? '🥇' : i===1 ? '🥈' : i===2 ? '🥉' : (i+1);
}
const IR_PODIO_META = [
  {medalha:'🥇', titulo:'1º lugar', cls:'ouro'},
  {medalha:'🥈', titulo:'2º lugar', cls:'prata'},
  {medalha:'🥉', titulo:'3º lugar', cls:'bronze'}
];
/* Pódio dos 3 primeiros colaboradores por locais contados. Ordem visual 2º–1º–3º
   (como pódio de verdade), com o 1º no degrau mais alto. Abaixo de 3 colaboradores
   no período, mostra só quem existe, sem inventar posição vazia. */
function irRenderPodio(ranking){
  if(!ranking || !ranking.length) return '';
  const top = ranking.slice(0,3);
  const ordemVisual = top.length===3 ? [1,0,2] : top.map((_,i)=>i);
  return `<div class="podio">${ordemVisual.map(i=>{
    const r = top[i], m = IR_PODIO_META[i];
    return `<div class="podio-card ${m.cls} ${i===0?'campeao':''}">
      <div class="podio-medalha">${m.medalha}</div>
      <div class="podio-pos">${m.titulo}</div>
      <div class="podio-nome">${irEsc(String(r.usuario).replace(/^MECA_/,''))}</div>
      <div class="podio-num mono">${irFmtInt(r.locais)}</div>
      <div class="podio-lbl">locais contados</div>
      <div class="podio-sub mono">${irFmtInt(r.itens)} itens · ${irFmtInt(r.pecas||0)} peças</div>
    </div>`;
  }).join('')}</div>`;
}
/* Exporta só o ranking (pódio + lista completa) como imagem, respeitando o mesmo
   filtro de data/abertura da aba. Reusa o pipeline de captura do boletim. */
function irExportarRankingImagem(){
  const c = IR.cicloAtivo;
  if(!c){ irShowToast('Sem ciclo ativo.', true); return; }
  const p = irCalcProdutividade(irProdContagensFiltradas());
  if(!p.ranking.length){ irShowToast('Sem contagens no período selecionado.', true); return; }
  const maxLocais = Math.max(1, ...p.ranking.map(r=>r.locais));
  const periodoTxt = (IR.prodFilters.de||IR.prodFilters.ate)
    ? `Período: ${IR.prodFilters.de?irFmtDate(IR.prodFilters.de):'início'} a ${IR.prodFilters.ate?irFmtDate(IR.prodFilters.ate):'hoje'}`
    : 'Ciclo inteiro';
  const html = `<div class="rp-page">
    <div class="rp-hero">
      <div class="rp-hero-top">
        <img src="brand/Logo_LDM_hor_branco.png" alt="Loja do Mecânico" class="rp-hero-logo">
        <div class="rp-hero-status">${irEsc(periodoTxt)}</div>
      </div>
      <div class="rp-hero-badge">Ranking da Equipe</div>
      <h1>${irEsc(irCicloLabel(c))}</h1>
      <p>Loja do Mecânico · Centro de Distribuição Cajamar</p>
      <div class="rp-hero-meta"><span>Gerado em ${new Date().toLocaleString('pt-BR')}</span></div>
    </div>
    <div class="rp-body">
      ${rpSectionTitle('🏆','Pódio','os 3 colaboradores com mais locais contados no período')}
      ${irRenderPodio(p.ranking)}
      ${rpSectionTitle('📋','Ranking completo','por locais contados')}
      <div class="rp-panel"><table class="rp-table rp-table-dense">
        <thead><tr><th>#</th><th>Colaborador</th><th>Locais</th><th>Itens</th><th>Peças</th><th>Horas ativas</th><th>Min/contagem</th></tr></thead>
        <tbody>${p.ranking.map((r,i)=>`<tr>
          <td style="font-weight:700;">${irMedalha(i)}</td>
          <td>${irEsc(String(r.usuario).replace(/^MECA_/,''))}</td>
          <td style="font-weight:700;">${irFmtInt(r.locais)}</td>
          <td>${irFmtInt(r.itens)}</td>
          <td>${irFmtInt(r.pecas||0)}</td>
          <td>${irFmtInt(r.horasAtivas)}h</td>
          <td>${irFmtNum(r.tempoMedioMin,1)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      ${rpSectionTitle('⏰','Locais por colaborador, hora a hora','janela 06h–22h de expediente')}
      <div class="rp-panel">${irBuildProdMatrizRpTable(p)}</div>
      <p class="rp-footer">Gerado automaticamente pelo módulo Inventário.</p>
    </div>
  </div>`;
  irBaixarBoletimImagem(html, `Ranking_Ciclo_${c.numero}_${new Date().toISOString().slice(0,10)}.png`);
}
/* Tabela da matriz colaborador x hora no formato de imagem (rp-table), pro botão
   "Compartilhar produtividade" — mesma matriz de irRenderProdMatriz, mas com o
   markup usado nos exports de imagem (boletim). */
function irBuildProdMatrizRpTable(p){
  if(!p.matrizColaboradorHora.length) return '<p style="padding:16px;color:#6B7280;">Nenhuma contagem no período selecionado.</p>';
  const horaLabel = h => String(h).padStart(2,'0')+'h';
  const totalPorHora = p.horasOrdenadas.map((h,i)=>p.matrizColaboradorHora.reduce((s,r)=>s+r.porHora[i],0));
  return `<table class="rp-table rp-table-dense">
    <thead><tr><th>Colaborador</th>${p.horasOrdenadas.map(h=>`<th>${horaLabel(h)}</th>`).join('')}<th>Locais</th><th>Peças</th></tr></thead>
    <tbody>
      ${p.matrizColaboradorHora.map(r=>`<tr>
        <td>${irEsc(r.usuario.replace(/^MECA_/,''))}</td>
        ${r.porHora.map(v=>`<td>${v>0?irFmtInt(v):'—'}</td>`).join('')}
        <td style="font-weight:700;">${irFmtInt(r.total)}</td>
        <td>${irFmtInt(r.pecas)}</td>
      </tr>`).join('')}
      <tr>
        <td style="font-weight:700;">Total</td>
        ${totalPorHora.map(v=>`<td style="font-weight:700;">${irFmtInt(v)}</td>`).join('')}
        <td style="font-weight:700;">${irFmtInt(p.totalLocais)}</td>
        <td style="font-weight:700;">${irFmtInt(p.totalPecas)}</td>
      </tr>
    </tbody>
  </table>`;
}
/* Gera e baixa uma imagem só com a produtividade da equipe (fora do boletim
   principal) — respeita o mesmo filtro de data/abertura da aba Produtividade. */
function irCompartilharProdutividade(){
  const c = IR.cicloAtivo;
  if(!c){ irShowToast('Sem ciclo ativo.', true); return; }
  const contagens = irProdContagensFiltradas();
  const p = irCalcProdutividade(contagens);
  if(!p.ranking.length){ irShowToast('Sem contagens no período selecionado.', true); return; }
  const agora = new Date().toLocaleString('pt-BR');
  const periodoTxt = (IR.prodFilters.de||IR.prodFilters.ate)
    ? `Período: ${IR.prodFilters.de?irFmtDate(IR.prodFilters.de):'início'} a ${IR.prodFilters.ate?irFmtDate(IR.prodFilters.ate):'hoje'}`
    : 'Ciclo inteiro';
  const html = `<div class="rp-page">
    <div class="rp-hero">
      <div class="rp-hero-top">
        <img src="brand/Logo_LDM_hor_branco.png" alt="Loja do Mecânico" class="rp-hero-logo">
        <div class="rp-hero-status">${irEsc(periodoTxt)}</div>
      </div>
      <div class="rp-hero-badge">Produtividade da Equipe</div>
      <h1>${irEsc(irCicloLabel(c))}</h1>
      <p>Loja do Mecânico · Centro de Distribuição Cajamar</p>
      <div class="rp-hero-meta"><span>Gerado em ${agora}</span></div>
    </div>
    <div class="rp-body">
      <div class="rp-blocks">
        ${rpBlock('orange','👥','Equipe',
          rpTile('🧑‍🔧', irFmtInt(p.ranking.length), 'Colaboradores ativos', '', '') +
          rpTile('📍', irFmtInt(p.totalLocais), 'Locais contados', '', '') +
          rpTile('📦', irFmtInt(p.totalPecas), 'Peças contadas', '', '')
        )}
        ${rpBlock('blue','⚡','Ritmo',
          rpTile('🔢', irFmtInt(p.totalItens), 'Itens contados', '', '') +
          rpTile('⏱️', irFmtNum(p.itensPorHomemHora,1), 'Itens / Homem-Hora', '', '') +
          rpTile('⏱️', irFmtNum(p.pecasPorHomemHora,1), 'Peças / Homem-Hora', '', '')
        )}
      </div>
      ${rpSectionTitle('⏰','Locais por colaborador, hora a hora','janela 06h–22h de expediente')}
      <div class="rp-panel">${irBuildProdMatrizRpTable(p)}</div>
      <p class="rp-footer">Gerado automaticamente pelo módulo Inventário.</p>
    </div>
  </div>`;
  irBaixarBoletimImagem(html, `Produtividade_Ciclo_${c.numero}_${new Date().toISOString().slice(0,10)}.png`);
}

/* ============================================================
   DIVERGÊNCIAS
   ============================================================ */
// Descrição completa só cabe truncada — junta palavras do início até ~42 caracteres
// (o suficiente pra identificar o item na maioria dos casos, sem quebrar a linha) e
// fecha com a última palavra; o texto completo fica no title (tooltip ao passar o
// mouse). Só corta quando realmente precisa — descrições curtas passam inteiras.
function irTruncDesc(nome){
  const s = String(nome||'').trim();
  if(!s) return '—';
  const partes = s.split(/\s+/);
  if(partes.length<=2) return irEsc(s);
  const LIMITE = 42;
  let out = partes[0], i = 1;
  while(i<partes.length-1 && (out+' '+partes[i]).length<=LIMITE){ out += ' '+partes[i]; i++; }
  if(i>=partes.length-1) return irEsc(s);
  return irEsc(out+' … '+partes[partes.length-1]);
}
// Evidência = a prova documental de cada lançamento que formou o saldo do item (Num
// Doc, quem fez, quando, sentido, qtd, valor e a Observação WMS original) — pra
// responder "evidencie essa divergência" sem precisar abrir a QRY410 original.
function irBuildMovEvidenciaTable(movs){
  const row = (m)=>{
    const dh = m.dataHora ? new Date(m.dataHora) : null;
    // getUTC* — mesmo motivo do resto da 410: SheetJS monta a data com componentes
    // UTC, então ler com getters locais desloca a hora em fusos negativos (Brasil).
    const dhLabel = dh ? `${String(dh.getUTCDate()).padStart(2,'0')}/${String(dh.getUTCMonth()+1).padStart(2,'0')}/${dh.getUTCFullYear()} ${String(dh.getUTCHours()).padStart(2,'0')}:${String(dh.getUTCMinutes()).padStart(2,'0')}` : '—';
    return `<tr>
      <td class="mono">${irEsc(m.numDoc||'—')}</td>
      <td>${irEsc(m.usuario||'—')}</td>
      <td class="mono">${dhLabel}</td>
      <td>${irEsc(m.sentido||'—')}</td>
      <td class="mono">${irFmtInt(m.qtd)}</td>
      <td class="mono">${irFmtMoney(m.valor)}</td>
      <td style="font-size:11px;">${irEsc(m.obsWms||'—')}</td>
    </tr>`;
  };
  return `<div class="table-wrap" style="margin:0 0 4px 24px;">
    <table>
      <thead><tr><th>Num Doc</th><th>Usuário</th><th>Data/Hora</th><th>Sentido</th><th>Qtd</th><th>Valor</th><th>Observação WMS</th></tr></thead>
      <tbody>${movs.map(row).join('')}</tbody>
    </table>
  </div>`;
}
function irToggleMovEvidencia(uid, btn){
  const el = document.getElementById(uid);
  if(!el) return;
  const abrindo = el.style.display==='none';
  el.style.display = abrindo ? '' : 'none';
  if(abrindo){
    btn.dataset.labelVer = btn.dataset.labelVer || btn.textContent;
    btn.textContent = 'Ocultar';
  } else {
    btn.textContent = btn.dataset.labelVer || 'Ver';
  }
}
// "Gerar Auditoria" — pega os Top N itens que já estão na tela (mesmo período/
// filtro que o usuário está vendo) e cruza CADA UM com TODOS os locais onde ele
// está divergente no ciclo ativo (não só o "local mais divergente" já mostrado na
// tabela) — um item pode ter mais de um local divergente, e o local pode até se
// repetir entre itens diferentes; a lista final é o que se entrega pro colaborador
// ir auditar fisicamente.
function irGerarAuditoriaNet(){
  const input = document.getElementById('ir-net-audit-n');
  const n = Math.max(1, parseInt(input && input.value, 10) || 10);
  IR.netAuditoriaN = n;
  const itens = (IR._netComCoberturaAtual || []).slice(0, n);
  if(!itens.length){ irShowToast('Sem itens nesse período pra gerar auditoria.', true); return; }
  const linhas = [];
  for(const i of itens){
    const locais = (IR.divergencias||[]).filter(d=>d.item===i.item && d.diferenca!==0)
      .sort((a,b)=>Math.abs(b.vlDivergencia)-Math.abs(a.vlDivergencia));
    if(!locais.length){
      linhas.push({item:i.item, nome:i.nome, saldoValor:i.saldoValor, local:null});
    } else {
      // Um item pode aparecer em mais de um local (e o local pode se repetir entre
      // itens diferentes) — lista TODOS, sem esconder nenhum, pra garantir que o
      // auditor não deixe de conferir uma posição.
      for(const l of locais) linhas.push({item:i.item, nome:i.nome, saldoValor:i.saldoValor, local:l.local, qtdeSistema:l.qtdeSistema, qtdeFisica:l.qtdeFisica, diferenca:l.diferenca, vlDivergencia:l.vlDivergencia});
    }
  }
  IR.netAuditoriaGerada = {geradoEm: new Date().toLocaleString('pt-BR'), mesLabel: IR._netMesLabelAtual, n, itensCount: itens.length, linhas};
  irRenderView();
}
function irRenderAuditoriaNetGerada(){
  const g = IR.netAuditoriaGerada;
  const row = (l)=>`<tr>
    <td class="mono">${irEsc(l.item)}</td>
    <td title="${irEsc(l.nome||'')}">${irTruncDesc(l.nome)}</td>
    <td class="mono" style="color:${l.saldoValor>=0?'var(--blue)':'var(--danger)'};font-weight:700;">${l.saldoValor>=0?'+':''}${irFmtMoney(l.saldoValor)}</td>
    <td class="mono">${l.local ? irEsc(l.local) : '<span class="field-hint">fora do ciclo atual</span>'}</td>
    <td class="mono">${l.qtdeSistema!==undefined?irFmtInt(l.qtdeSistema):'—'}</td>
    <td class="mono">${l.qtdeFisica!==undefined?irFmtInt(l.qtdeFisica):'—'}</td>
    <td class="mono" style="color:${l.diferenca>0?'var(--success)':(l.diferenca<0?'var(--danger)':'var(--ink)')};font-weight:700;">${l.diferenca!==undefined?(l.diferenca>0?'+':'')+irFmtInt(l.diferenca):'—'}</td>
  </tr>`;
  return `<div class="panel" style="background:var(--surface2);margin-bottom:16px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:4px;">
      <h3 style="margin:0;">Auditoria Direcionada — Top ${g.n} de ${irEsc(g.mesLabel)}</h3>
      <button class="btn btn-secondary" onclick="irBaixarAuditoriaNetImagem()">📥 Baixar / Compartilhar</button>
    </div>
    <p class="field-hint" style="margin-bottom:12px;">Gerado em ${irEsc(g.geradoEm)} · ${g.itensCount} ${g.itensCount===1?'item':'itens'} · ${g.linhas.length} ${g.linhas.length===1?'local a conferir':'locais a conferir'}.</p>
    <div class="table-wrap"><table class="table-dense">
      <thead><tr><th>Item</th><th>Descrição</th><th>Saldo no período</th><th>Local</th><th>Qtde Sistema</th><th>Qtde Física</th><th>Diferença</th></tr></thead>
      <tbody>${g.linhas.map(row).join('')}</tbody>
    </table></div>
  </div>`;
}
async function irBaixarAuditoriaNetImagem(){
  const g = IR.netAuditoriaGerada;
  if(!g) return;
  const c = IR.cicloAtivo;
  const row = (l)=>`<tr>
    <td>${irEsc(l.item)}</td>
    <td>${irEsc(l.nome||'')}</td>
    <td>${l.saldoValor>=0?'+':''}${irFmtMoney(l.saldoValor)}</td>
    <td>${l.local ? irEsc(l.local) : 'fora do ciclo atual'}</td>
    <td>${l.qtdeSistema!==undefined?irFmtInt(l.qtdeSistema):'—'}</td>
    <td>${l.qtdeFisica!==undefined?irFmtInt(l.qtdeFisica):'—'}</td>
    <td>${l.diferenca!==undefined?(l.diferenca>0?'+':'')+irFmtInt(l.diferenca):'—'}</td>
  </tr>`;
  const html = `<div class="rp-page">
    <div class="rp-hero">
      <div class="rp-hero-top">
        <img src="brand/Logo_LDM_hor_branco.png" alt="Loja do Mecânico" class="rp-hero-logo">
      </div>
      <div class="rp-hero-badge">Auditoria Direcionada</div>
      <h1>Top ${g.n} itens de ${irEsc(g.mesLabel)}</h1>
      <p>Loja do Mecânico · Centro de Distribuição Cajamar${c?' · '+irEsc(irCicloLabel(c)):''}</p>
    </div>
    <div class="rp-body">
      <p class="rp-footer" style="margin:0 0 14px;">Gerado em ${irEsc(g.geradoEm)} · ${g.itensCount} itens · ${g.linhas.length} locais a conferir</p>
      <div class="rp-panel"><table class="rp-table">
        <thead><tr><th>Item</th><th>Descrição</th><th>Saldo no período</th><th>Local</th><th>Qtde Sistema</th><th>Qtde Física</th><th>Diferença</th></tr></thead>
        <tbody>${g.linhas.map(row).join('')}</tbody>
      </table></div>
      <p class="rp-footer">Gerado automaticamente pelo módulo Inventário.</p>
    </div>
  </div>`;
  irBaixarBoletimImagem(html, `Auditoria_Direcionada_${new Date().toISOString().slice(0,10)}.png`);
}
async function irIgnorarNet410Item(item, nome){
  await irSaveNet410Ignorado(item, nome);
  IR.net410Ignorados = await irGetNet410IgnoradosAll();
  irShowToast(`"${nome||item}" não vai mais aparecer nessa análise — gerenciar em Configurações.`);
  irRenderView();
}
// Um item entra na análise com qualquer movimento (Observação WMS) batendo com algum
// padrão ignorado (ex.: "SALDO") — não precisa bater com TODOS os movimentos do item,
// já que um único ajuste desse tipo já é motivo suficiente pra não confiar no saldo do
// período todo pra esse item.
function irItemTemPadraoIgnorado(item, padroes){
  if(!padroes.length) return false;
  const movs = item.movimentos||[];
  return movs.some(mv=>{
    const obs = String(mv.obsWms||'').toUpperCase();
    return padroes.some(p=>obs.includes(p.padrao.toUpperCase()));
  });
}
async function irAdicionarNet410Padrao(){
  const input = document.getElementById('ir-net410-padrao-novo');
  const texto = input ? input.value.trim() : '';
  if(!texto){ irShowToast('Informe um trecho da Observação WMS.', true); return; }
  await irSaveNet410PadraoIgnorado(texto);
  IR.net410Padroes = await irGetNet410PadroesIgnoradosAll();
  if(input) input.value = '';
  irShowToast(`Itens com "${texto}" na Observação WMS não vão mais aparecer na análise do NET.`);
  irRenderView();
}
async function irRemoverNet410PadraoUI(id){
  await irRemoverNet410PadraoIgnorado(id);
  IR.net410Padroes = await irGetNet410PadroesIgnoradosAll();
  irShowToast('Padrão removido — itens com esse trecho voltam a aparecer na análise.');
  irRenderView();
}
function irSetDivNetMes(mes){ IR.divNetMesSel = mes; IR.divNetDiaSel = null; irRenderView(); }
function irSetDivNetDia(dia){ IR.divNetDiaSel = dia || null; irRenderView(); }
function irToggleNetItensResto(uid, btn){
  const el = document.getElementById(uid);
  if(!el) return;
  const abrindo = el.style.display==='none';
  el.style.display = abrindo ? '' : 'none';
  btn.textContent = abrindo ? 'Ver menos' : btn.dataset.labelFechado;
}
// Maiores ganhos/perdas separados por valor e por peças — em vez de uma lista só
// misturando os dois sinais ordenada por |saldo| (confuso: um ganho grande e uma
// perda grande apareciam lado a lado sem destaque visual do sinal). Mesmo estilo de
// barra horizontal já usado em "Itens mais Divergentes" do Dashboard, pra manter a
// linguagem visual consistente e a linha sempre de 1 altura só.
function irRenderNetTopLists(comCobertura){
  const VISIVEL = 6;
  const bloco = (titulo, campo, fmt)=>{
    const pos = comCobertura.filter(i=>i[campo]>0).sort((a,b)=>b[campo]-a[campo]);
    const neg = comCobertura.filter(i=>i[campo]<0).sort((a,b)=>a[campo]-b[campo]);
    const maxAbs = Math.max(1, ...pos.map(i=>i[campo]), ...neg.map(i=>Math.abs(i[campo])));
    const row = (i, cls)=>`<div class="bi-hbar-row bi-hbar-row-money">
      <div class="bi-hbar-label" title="${irEsc(i.item)} — ${irEsc(i.nome||'')}"><span class="mono">${irEsc(i.item)}</span> — ${irEsc(i.nome||i.item)}</div>
      <div class="bi-hbar-track"><div class="bi-hbar-fill ${cls}" style="width:${Math.round(Math.abs(i[campo])/maxAbs*100)}%;"></div></div>
      <div class="bi-hbar-val">${i[campo]>0?'+':''}${fmt(i[campo])}</div>
    </div>`;
    const list = (items, cls)=>{
      if(!items.length) return '<p class="field-hint">Nenhum.</p>';
      const visiveis = items.slice(0, VISIVEL).map(i=>row(i,cls)).join('');
      const resto = items.slice(VISIVEL);
      if(!resto.length) return visiveis;
      const uid = 'ir-nettop-'+Math.random().toString(36).slice(2,9);
      return `<button class="btn-link" style="margin:0 0 6px;" onclick="irToggleCollapse('${uid}', this)">Ver mais (+${resto.length})</button>
        ${visiveis}<div id="${uid}" style="display:none;">${resto.map(i=>row(i,cls)).join('')}</div>`;
    };
    return `<div><h4 style="margin:0 0 10px;font-size:13px;">${titulo}</h4>
      <div class="bi-grid-2">
        <div><p class="field-hint" style="margin-bottom:6px;font-weight:700;color:var(--success);">MAIORES GANHOS</p>${list(pos,'pos')}</div>
        <div><p class="field-hint" style="margin-bottom:6px;font-weight:700;color:var(--danger);">MAIORES PERDAS</p>${list(neg,'neg')}</div>
      </div>
    </div>`;
  };
  return `<div class="panel">
    ${bloco('Por Valor (R$)', 'saldoValor', irFmtMoney)}
    <div class="divider" style="height:1px;background:var(--line);margin:18px 0;"></div>
    ${bloco('Por Quantidade (peças)', 'saldoQtd', irFmtInt)}
  </div>`;
}
// "Por que o NET está distorcido?" — a 410 acumula TODOS os ajustes do CD (o
// Inventário Rotativo/AIR é só um dos motivos), então quando o NET do mês está
// estranhamente alto ou baixo, o auditor precisa saber rápido quais itens específicos
// explicam a maior parte do número — não só uma lista de "top itens" arbitrária, mas
// itens suficientes pra cobrir a maior parte do NET, com local e quantidade pra ir
// direto validar fisicamente.
function irRenderNetDistorcaoPanel(){
  if(!IR.net410Anos.length){
    return `<div class="panel"><p class="field-hint">Nenhuma QRY410 processada ainda — importe na aba <a href="#" onclick="irSwitchTab('importacao');return false;">Importação</a> pra usar essa análise.</p></div>`;
  }
  const d = IR.net410Data;
  if(!d) return '';
  const meses = d.porMes||[];
  if(!meses.length) return `<div class="panel"><p class="field-hint">Sem movimentos no ano ${d.ano}.</p></div>`;
  if(!IR.divNetMesSel || !meses.some(m=>m.mes===IR.divNetMesSel)) IR.divNetMesSel = meses[meses.length-1].mes;
  const mSel = meses.find(mm=>mm.mes===IR.divNetMesSel);
  // Dia é opcional — "ver as divergências de ontem" sem esperar o mês fechar. Os
  // dias do seletor são só os que tiveram movimento dentro do mês escolhido.
  const diasDoMes = (d.porDia||[]).filter(dd=>dd.dia.slice(0,7)===IR.divNetMesSel).sort((a,b)=>a.dia.localeCompare(b.dia));
  if(IR.divNetDiaSel && !diasDoMes.some(dd=>dd.dia===IR.divNetDiaSel)) IR.divNetDiaSel = null;
  const m = IR.divNetDiaSel ? diasDoMes.find(dd=>dd.dia===IR.divNetDiaSel) : mSel;
  const mesLabel = IR.divNetDiaSel
    ? new Date(IR.divNetDiaSel+'T00:00:00').toLocaleDateString('pt-BR')
    : IR_MES_NOMES[parseInt(mSel.mes.slice(5,7),10)-1]+'/'+mSel.mes.slice(0,4);
  const pctAIR = m.net!==0 ? Math.abs(m.netAIR/m.net) : 0;

  // Itens ignorados (motivo já conhecido, ex.: troca de identidade já identificada)
  // saem da análise inteira — não só da lista, também da cobertura acumulada e da
  // movimentação bruta, senão eles continuariam pesando nos % mesmo escondidos.
  const ignoradosSet = new Set((IR.net410Ignorados||[]).map(i=>i.item));
  const padroes = IR.net410Padroes||[];

  // Junta os itens positivos e negativos do mês, ordena por |saldo| — são os que
  // mais pesam na distorção do NET, seja puxando pra cima ou pra baixo.
  const todosOrdenados = [...(m.topItensPositivos||[]), ...(m.topItensNegativos||[])]
    .filter(i=>!ignoradosSet.has(i.item) && !irItemTemPadraoIgnorado(i, padroes))
    .sort((a,b)=>Math.abs(b.saldoValor)-Math.abs(a.saldoValor));
  // Cobertura acumulada usa a MOVIMENTAÇÃO BRUTA (soma de |saldo| de todos os itens),
  // não o NET do mês — quando dois itens grandes se cancelam (ex.: +19.452 de um lado,
  // -19.452 do outro, sobrando quase nada de NET), usar o NET pequeno como base faria
  // a % de cada item explodir pra bem além de 100%, o que não significa nada. A soma
  // bruta sempre vai de 0% a 100% de forma sensata.
  const totalMovimentoBruto = todosOrdenados.reduce((s,i)=>s+Math.abs(i.saldoValor), 0);
  let acumulado = 0;
  const comCobertura = todosOrdenados.map(i=>{
    acumulado += Math.abs(i.saldoValor);
    return {...i,
      pctDoNet: m.netAbs>0 ? Math.abs(i.saldoValor)/m.netAbs : 0,
      pctAcumulado: totalMovimentoBruto>0 ? acumulado/totalMovimentoBruto : 0};
  });
  // Cache pro botão "Gerar Auditoria" — evita recalcular tudo de novo só pra pegar
  // os top N itens do período que já está na tela.
  IR._netComCoberturaAtual = comCobertura;
  IR._netMesLabelAtual = mesLabel;
  // Cancelamento forte = a movimentação bruta é bem maior que o NET final, ou seja,
  // ganhos e perdas grandes quase se anulam — vale alertar, porque é o padrão clássico
  // de item com contagem trocada (ex.: duas variantes de cor do mesmo modelo).
  const cancelamentoForte = m.netAbs>0 && totalMovimentoBruto >= m.netAbs*3;
  // Mostra itens até cobrir 90% da movimentação bruta do mês (com pelo menos 5, pra dar
  // contexto mesmo quando 1-2 itens já dominam) — o resto fica atrás de "ver mais",
  // sem sumir, mas sem poluir a leitura principal.
  const COBERTURA_ALVO = 0.90;
  let corte = comCobertura.findIndex(i=>i.pctAcumulado>=COBERTURA_ALVO);
  if(corte===-1) corte = comCobertura.length-1;
  corte = Math.max(corte, Math.min(4, comCobertura.length-1));
  const visiveis = comCobertura.slice(0, corte+1);
  const resto = comCobertura.slice(corte+1);

  // Itens processados com uma versão anterior da 410 (antes de Ganhos/Saldo no
  // Ano/Quantidade existirem) não têm esses campos — sem isso não dá pra mostrar
  // as colunas novas, então avisa em vez de exibir tudo vazio silenciosamente.
  const dadosDesatualizados = comCobertura.some(i=>i.ganhos===undefined || i.saldoAno===undefined);

  // Local mais divergente pro item no ciclo ATIVO (a 410 não tem local/endereço —
  // só a QRY0843 do ciclo em andamento tem isso). Ajuda o auditor a saber pra onde ir
  // fisicamente validar. Pode não achar nada se o item não estiver no ciclo atual.
  const localMaisDivergente = (item)=>{
    const divs = (IR.divergencias||[]).filter(d=>d.item===item && d.diferenca!==0);
    if(!divs.length) return null;
    divs.sort((a,b)=>Math.abs(b.vlDivergencia)-Math.abs(a.vlDivergencia));
    return divs[0];
  };

  const row = (i)=>{
    // Motivo principal = maior |valor| dentre TODOS os motivos do item (AIR incluso),
    // já vem ordenado do worker — substitui as antigas colunas separadas "AIR" e
    // "Outros motivos", que ficavam as duas vazias quando o item não tinha nenhum
    // motivo classificado nos dados (sinal de reprocessamento pendente).
    const motivoTop = (i.porObs||[])[0];
    const ehAIR = motivoTop && motivoTop.id==='AIR';
    const local = localMaisDivergente(i.item);
    const outrosLocais = local ? (IR.divergencias||[]).filter(d=>d.item===i.item && d.diferenca!==0).length - 1 : 0;
    // Compensado no ano = o mês pesa no NET mas ao longo do ano esse item se anula
    // (ou quase) — ganho de um mês/ciclo cobrindo perda de outro. É essa comparação
    // que permite justificar um NET mensal alto sem estar "sujo".
    const compensado = i.saldoAno!==undefined && Math.abs(i.saldoValor)>0 && Math.abs(i.saldoAno) < Math.abs(i.saldoValor)*0.3;
    const uid = 'ir-mov-'+irEsc(i.item)+'-'+Math.random().toString(36).slice(2,7);
    const movs = i.movimentos||[];
    const linhaPrincipal = `<tr>
      <td class="mono">${irEsc(i.item)}</td>
      <td title="${irEsc(i.nome||'')}">${irTruncDesc(i.nome)}</td>
      <td class="mono" style="color:var(--blue);">${i.ganhos?'+'+irFmtMoney(i.ganhos):'—'}</td>
      <td class="mono" style="font-weight:700;color:${i.saldoValor>=0?'var(--blue)':'var(--danger)'};white-space:nowrap;">${i.saldoValor>=0?'+':''}${irFmtMoney(i.saldoValor)} <span class="field-hint">(${i.saldoQtd!==undefined?(i.saldoQtd>0?'+':'')+irFmtInt(i.saldoQtd)+' pçs':'—'})</span></td>
      <td class="mono" style="font-weight:700;color:${i.saldoAno>=0?'var(--ink)':'var(--danger)'};">${i.saldoAno!==undefined?(i.saldoAno>=0?'+':'')+irFmtMoney(i.saldoAno):'—'}${compensado?' <span class="tag tag-muted">compensado</span>':''}</td>
      <td class="mono">${irFmtPct(i.pctDoNet)}</td>
      <td class="mono" style="font-weight:700;">${irFmtPct(i.pctAcumulado)}</td>
      <td style="font-size:11.5px;">${motivoTop ? `<span style="color:${ehAIR?'var(--orange)':'var(--ink)'};font-weight:700;">${irEsc(irLegenda410(motivoTop.id, IR.net410Legenda))}</span><br>${irFmtMoney(motivoTop.valor)}` : '—'}</td>
      <td style="font-size:11.5px;">${local ? `${irEsc(local.local)}<div class="field-hint">dif. ${local.diferenca>0?'+':''}${irFmtInt(local.diferenca)} pçs${outrosLocais>0?' · +'+outrosLocais:''}</div>` : '<span class="field-hint">fora do ciclo atual</span>'}</td>
      <td><span class="tag ${ehAIR?'tag-good':'tag-muted'}">${ehAIR?'Validar no inventário':'Não é do inventário'}</span></td>
      <td>${movs.length ? `<button class="btn-link" onclick="irToggleMovEvidencia('${uid}', this)">Ver ${movs.length}</button>` : '<span class="field-hint">—</span>'}</td>
      <td><button class="btn-link" title="Já sei o motivo — esconder esse item da análise" onclick="irIgnorarNet410Item('${irEsc(i.item)}','${irEsc((i.nome||'').replace(/'/g,"\\'"))}')">Ignorar</button></td>
    </tr>`;
    if(!movs.length) return linhaPrincipal;
    return linhaPrincipal + `<tr id="${uid}" style="display:none;"><td colspan="12" style="padding:0 0 10px;">${irBuildMovEvidenciaTable(movs)}</td></tr>`;
  };

  const periodoCurto = IR.divNetDiaSel ? 'dia' : 'mês';
  const thead = `<thead><tr><th>Item</th><th>Descrição</th><th>Ganhos no ${periodoCurto}</th><th>Saldo no ${periodoCurto}</th><th>Saldo no ano</th><th>% do NET</th><th>% Acum. movimentação</th><th>Motivo principal</th><th>Local mais divergente (ciclo atual)</th><th>Ação sugerida</th><th>Evidência</th><th></th></tr></thead>`;
  let tabela;
  if(!comCobertura.length){
    tabela = `<p class="field-hint">Nenhum item com saldo válido pro NET nesse ${periodoCurto==='dia'?'dia':'mês'}.</p>`;
  } else {
    const uid = 'ir-net-resto-'+Math.random().toString(36).slice(2,9);
    const coberturaVisivel = visiveis.length ? irFmtPct(visiveis[visiveis.length-1].pctAcumulado) : '0%';
    // Botão de "ver mais" ANTES da tabela — pra recolher de novo sem precisar rolar
    // até o fim de uma lista que pode ter centenas de linhas.
    tabela = `<p class="field-hint" style="margin-bottom:8px;">Esses <strong>${visiveis.length}</strong> ${visiveis.length===1?'item explica':'itens explicam'} <strong>${coberturaVisivel}</strong> da movimentação de ${irEsc(mesLabel)} (${irFmtMoney(totalMovimentoBruto)} em ganhos e perdas somados em módulo).</p>
    ${resto.length ? `<button class="btn-link" style="margin-bottom:8px;" data-label-fechado="Ver mais ${resto.length} até 100% da movimentação" onclick="irToggleNetItensResto('${uid}', this)">Ver mais ${resto.length} até 100% da movimentação</button>` : ''}
    <div class="table-wrap"><table class="table-wide table-dense">
      ${thead}
      <tbody>${visiveis.map(row).join('')}</tbody>
      ${resto.length ? `<tbody id="${uid}" style="display:none;">${resto.map(row).join('')}</tbody>` : ''}
    </table></div>`;
  }

  return `<div class="panel">
    <div class="form-actions" style="align-items:flex-end;flex-wrap:wrap;gap:10px;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--line);">
      <div style="max-width:160px;"><label>Top N itens</label><input type="number" id="ir-net-audit-n" min="1" max="100" value="${IR.netAuditoriaN}"></div>
      <button class="btn btn-primary" onclick="irGerarAuditoriaNet()">🔍 Gerar Auditoria</button>
      <p class="field-hint" style="margin:0 0 8px;max-width:38ch;">Monta a lista dos itens mais divergentes do período com todos os locais onde cada um está divergente no ciclo atual — pra entregar pro colaborador auditar fisicamente.</p>
    </div>
    ${IR.netAuditoriaGerada ? irRenderAuditoriaNetGerada() : ''}
    ${dadosDesatualizados ? `<p class="field-hint" style="color:var(--danger);margin-bottom:12px;">⚠️ Alguns dados desse ano foram processados antes de Ganhos, Saldo no Ano e Quantidade existirem nessa análise — aparecem como "—" abaixo. Reimporte a QRY410 na aba <a href="#" onclick="irSwitchTab('importacao');return false;">Importação</a> pra atualizar.</p>` : ''}
    ${cancelamentoForte ? `<p class="field-hint" style="color:var(--orange);margin-bottom:12px;">⚠️ A movimentação bruta de ${irEsc(mesLabel)} (${irFmtMoney(totalMovimentoBruto)}) é bem maior que o NET final (${irFmtMoney(m.netAbs)}) — sinal de que ganhos e perdas grandes estão se cancelando. Vale checar se não é troca de contagem entre itens parecidos (ex.: mesma peça em cores/variações diferentes).</p>` : ''}
    ${ignoradosSet.size ? `<p class="field-hint" style="margin-bottom:12px;">${ignoradosSet.size} ${ignoradosSet.size===1?'item ignorado não aparece':'itens ignorados não aparecem'} nessa análise (motivo já conhecido) — <a href="#" onclick="irSwitchTab('configuracoes');return false;">gerenciar em Configurações</a>.</p>` : ''}
    ${padroes.length ? `<p class="field-hint" style="margin-bottom:12px;">Itens com "${padroes.map(p=>irEsc(p.padrao)).join('", "')}" na Observação WMS não aparecem nessa análise — <a href="#" onclick="irSwitchTab('configuracoes');return false;">gerenciar em Configurações</a>.</p>` : ''}
    <div class="two-col" style="max-width:620px;margin-bottom:14px;grid-template-columns:1fr 1fr 1fr;">
      <div><label>Ano</label><select onchange="irSetNet410Ano(this.value)">
        ${IR.net410Anos.map(a=>`<option value="${a}" ${a===IR.net410AnoSel?'selected':''}>${a}</option>`).join('')}
      </select></div>
      <div><label>Mês</label><select onchange="irSetDivNetMes(this.value)">
        ${meses.map(mm=>`<option value="${mm.mes}" ${mm.mes===IR.divNetMesSel?'selected':''}>${irEsc(IR_MES_NOMES[parseInt(mm.mes.slice(5,7),10)-1])}</option>`).join('')}
      </select></div>
      <div><label>Dia (opcional)</label><select onchange="irSetDivNetDia(this.value)">
        <option value="">Mês inteiro</option>
        ${diasDoMes.map(dd=>`<option value="${dd.dia}" ${dd.dia===IR.divNetDiaSel?'selected':''}>${new Date(dd.dia+'T00:00:00').toLocaleDateString('pt-BR')}</option>`).join('')}
      </select></div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card ${m.net>=0?'good':'bad'}"><div class="num mono">${irFmtMoney(m.net)}</div><div class="label">NET de ${irEsc(mesLabel)}</div></div>
      <div class="kpi-card orange"><div class="num mono">${irFmtMoney(m.netAIR)}</div><div class="label">Vindo do Inventário (AIR)</div></div>
      <div class="kpi-card"><div class="num mono">${irFmtMoney(m.netOutros)}</div><div class="label">Vindo de outros motivos</div></div>
      <div class="kpi-card"><div class="num mono">${irFmtPct(pctAIR)}</div><div class="label">% do NET vindo do inventário</div></div>
    </div>
    ${irRenderNetTopLists(comCobertura)}
    ${tabela}
  </div>`;
}
/* ============================================================
   DIVERGÊNCIAS — ofensores do NET

   A tela responde uma coisa só: o NET do período está em X; quais itens
   causaram isso. Uma linha por ITEM.

   Um item só é OFENSOR quando a perda (ou a sobra) sobrevive ao ano. Perder
   R$ 5.000 no mês e ganhar os mesmos R$ 5.000 em outro ciclo do ano deixa o
   ano em zero — houve erro de contagem, mas não houve perda: o item vira
   COMPENSADO e sai da lista.

   Rotina do auditor: abre a tela, lê os ofensores de perda e de ganho, marca,
   gera a auditoria e imprime. A auditoria lista os locais onde o item TEM
   SALDO hoje (QRY0390) — é onde ele vai conferir.
   ============================================================ */
const IR_DIV_CORTE_PADRAO = 1000;   // |NET R$| mínimo para o item ser ofensor
const IR_DIV_CORTE_QTD_PADRAO = 10; // |NET peças| mínimo quando o corte é por quantidade
// Corte vigente e o campo do item ao qual ele se aplica. Trocar a base troca as
// duas coisas de uma vez: o que é ofensor e o que a tabela ordena por padrão.
function irDivBase(){
  return (IR.divBase==='qtd')
    ? {campo:'netQtd', campoAno:'netQtdAno', corte: IR.divCorteQtd==null?IR_DIV_CORTE_QTD_PADRAO:IR.divCorteQtd,
       lbl:'peças', fmt:irFmtInt, passo:1}
    : {campo:'netValor', campoAno:'netValorAno', corte: IR.divCorte==null?IR_DIV_CORTE_PADRAO:IR.divCorte,
       lbl:'R$', fmt:irFmtMoney, passo:100};
}
function irDivSetBase(base){
  IR.divBase = base;
  IR.divOrdem = {col: base==='qtd'?'netQtd':'netValor', dir:'desc'};
  irRenderView();
}
// Chips de sentido: clicar liga/desliga. Nunca deixa a tabela sem nenhum ligado —
// desligar o último volta a ligar todos, senão a tela some sem explicação.
function irDivToggleSentido(s){
  const atual = new Set(IR.divSentidos || ['perda','ganho']);
  if(atual.has(s)) atual.delete(s); else atual.add(s);
  IR.divSentidos = atual.size ? Array.from(atual) : ['perda','ganho','compensado'];
  irRenderView();
}

function irDivSetEscopo(value){
  IR.divEscopo = value.startsWith('ano:') ? {tipo:'ano', ano:value.slice(4)}
              : value.startsWith('mes:') ? {tipo:'mes', mes:value.slice(4)}
              : value.startsWith('ciclo:') ? {tipo:'ciclo', cicloId:value.slice(6)}
              : value==='ciclos' ? {tipo:'ciclos', cicloIds:(IR.divEscopo.cicloIds && IR.divEscopo.cicloIds.length)
                    ? IR.divEscopo.cicloIds
                    : [IR.divEscopo.cicloId || (IR.cicloAtivo||{}).id].filter(Boolean)}
              : value==='periodo' ? {tipo:'periodo', de:IR.divEscopo.de || '', ate:IR.divEscopo.ate || ''}
              : {tipo:'ciclo'};
  IR.divEscopoDados = null; IR.divSelecionados = new Set(); IR.divAuditoria = null;
  irRenderView(); // o render dispara a carga do novo escopo e desenha quando estiver pronto
}
// Intervalo livre de datas. Vazio de um lado é aberto daquele lado: só "até"
// pega tudo desde o começo, só "de" pega dali em diante.
/* Liga e desliga um ciclo na seleção múltipla. Nunca deixa vazio: desmarcar o
   último volta a marcar o ciclo ativo, senão a tela some sem explicação. */
function irDivToggleCiclo(id){
  const atual = new Set(IR.divEscopo.cicloIds || []);
  if(atual.has(id)) atual.delete(id); else atual.add(id);
  const ids = atual.size ? Array.from(atual) : [(IR.cicloAtivo||{}).id].filter(Boolean);
  IR.divEscopo = {tipo:'ciclos', cicloIds: ids};
  IR.divEscopoDados = null; IR.divSelecionados = new Set(); IR.divAuditoria = null;
  irRenderView();
}
function irDivSetPeriodo(campo, valor){
  const e = IR.divEscopo;
  IR.divEscopo = {tipo:'periodo', de: e.de||'', ate: e.ate||'', [campo]: valor};
  IR.divSelecionados = new Set(); IR.divAuditoria = null;
  IR.divEscopoDados = null;
  irRenderView();
}
function irDivSetCorte(v){
  const n = parseFloat(String(v).replace(/\./g,'').replace(',','.'));
  const val = isNaN(n) ? 0 : Math.max(0, n);
  if(IR.divBase==='qtd') IR.divCorteQtd = val; else IR.divCorte = val;
  irRenderView();
}
function irDivSetBusca(v){ IR.divBusca = String(v||'').trim(); irRenderView(); }
/* Cabeçalho clicável: 1º clique ordena decrescente, 2º inverte. */
function irDivOrdenar(col){
  const o = IR.divOrdem || {col:'netValor', dir:'desc'};
  IR.divOrdem = (o.col===col) ? {col, dir: o.dir==='desc'?'asc':'desc'} : {col, dir:'desc'};
  irRenderView();
}
function irDivAnoDoEscopo(){
  const e = IR.divEscopo;
  if(e.tipo==='ano') return String(e.ano);
  if(e.tipo==='mes') return String(e.mes).slice(0,4);
  if(e.tipo==='periodo' && (e.de || e.ate)) return String(e.de || e.ate).slice(0,4);
  if(e.tipo==='ciclos'){
    const cs = irDivCiclosSelecionados();
    if(cs.length) return String(irCicloAno(cs[0])||'');
  }
  const c = e.cicloId ? IR.ciclos.find(x=>x.id===e.cicloId) : IR.cicloAtivo;
  return String((c||{}).dataAbertura||'').slice(0,4);
}
function irDivCiclosDoAno(ano){
  return IR.ciclos.filter(c=>String(c.dataAbertura||'').slice(0,4)===String(ano));
}
/* Anos que o escopo toca. Um intervalo de datas pode atravessar o ano e uma
   seleção de ciclos também — o cache precisa carregar todos, senão a metade de
   fora some sem aviso. */
function irDivAnosDoEscopo(){
  const e = IR.divEscopo;
  if(e.tipo==='periodo' && (e.de || e.ate))
    return Array.from(new Set([e.de, e.ate].filter(Boolean).map(d=>String(d).slice(0,4)))).sort();
  if(e.tipo==='ciclos')
    return Array.from(new Set(irDivCiclosSelecionados().map(c=>String(irCicloAno(c)||'')).filter(Boolean))).sort();
  const a = irDivAnoDoEscopo();
  return a ? [a] : [];
}
function irDivCiclosSelecionados(){
  const ids = new Set(IR.divEscopo.cicloIds || []);
  return (IR.ciclos||[]).filter(c=>ids.has(c.id));
}
async function irCarregarDivEscopo(){
  const e = IR.divEscopo;
  const anos = irDivAnosDoEscopo();
  const chave = anos.join(',');
  if(chave && (!IR.divAnoCache || IR.divAnoCache.ano!==chave)){
    const ciclos = anos.flatMap(a=>irDivCiclosDoAno(a));
    const listas = await Promise.all(ciclos.map(c=>irGetByCiclo(IR_STORES.divergencias, c.id)));
    IR.divAnoCache = {ano: chave, divs: listas.flat()};
  }
  if(e.tipo==='ciclos'){
    const ids = new Set(e.cicloIds || []);
    IR.divEscopoDados = ((IR.divAnoCache||{}).divs || []).filter(d=>ids.has(d.cicloId));
  }
  else if(e.tipo==='ciclo' && (!e.cicloId || e.cicloId===(IR.cicloAtivo||{}).id)) IR.divEscopoDados = IR.divergencias;
  else if(e.tipo==='ciclo') IR.divEscopoDados = await irGetByCiclo(IR_STORES.divergencias, e.cicloId);
  else IR.divEscopoDados = (IR.divAnoCache||{}).divs || [];
  // A 410 do(s) mesmo(s) ano(s) — é dela que sai o preço congelado. Esperada aqui
  // dentro, e não em paralelo: quem carregava depois fazia a tela desenhar com o
  // preço da 278, e dois segundos mais tarde trocar tudo com o preço da 410.
  const anos410 = Array.from(new Set(anos.concat([String(new Date().getFullYear())])));
  const falta410 = anos410.filter(a=>!(IR.div410Cache||{})[a]);
  if(falta410.length) await irDivCarregar410(falta410);
  // A ficha da 390 entra aqui, e não só na hora de gerar a auditoria: ela é a
  // terceira fonte de preço, então sem ela a lista mostrava R$ 0,00 num item que
  // a auditoria, gerada depois, já valorava — dois números diferentes na mesma tela.
  await irCarregarItemInfo();
}
/* A aba só desenha quando os dois caches estão prontos: as divergências do escopo
   e a QRY410 dos anos que ele toca. Antes ela desenhava na hora com o que tinha em
   memória (só o ciclo ativo, valorado pela 278) e se redesenhava sozinha quando o
   resto chegava — o número piscava e trocava na frente do usuário. */
function irDivEscopoPronto(){
  if(!IR.divAnoCache || IR.divEscopoDados===null || !IR._itemInfo) return false;
  const anos = irDivAnosDoEscopo();
  if(IR.divAnoCache.ano !== anos.join(',')) return false;
  const anos410 = Array.from(new Set(anos.concat([String(new Date().getFullYear())])));
  return anos410.every(a=>!!(IR.div410Cache||{})[a]);
}
function irDivCarregando(){
  return `<div class="panel div-carregando"><span class="div-spinner"></span>Carregando divergências e preços do período...</div>`;
}
/* Dia do fechamento da visita. Ciclos processados antes do campo existir caem no
   fallback pelas contagens do ciclo carregado. */
function irDivDiaDa(d){
  if(d.diaFechamento) return d.diaFechamento;
  return irDivDiaPorLocalLegado().get(d.local) || '';
}
function irDivDiaPorLocalLegado(){
  if(IR._divDiaLegado && IR._divDiaLegadoCiclo===(IR.cicloAtivo||{}).id) return IR._divDiaLegado;
  const fim = new Map();
  for(const c of (IR.contagens||[])){
    if(c.idConferencia<2 || !c.dataSituacao || c.liquidada===false) continue;
    const a = fim.get(c.local);
    if(!a || c.idConferencia>a.rodada) fim.set(c.local, {rodada:c.idConferencia, dia:c.dataSituacao.slice(0,10)});
  }
  const m = new Map();
  for(const [local, v] of fim) m.set(local, v.dia);
  IR._divDiaLegado = m; IR._divDiaLegadoCiclo = (IR.cicloAtivo||{}).id;
  return m;
}
function irDivMesesDisponiveis(){
  const base = (IR.divAnoCache||{}).divs || IR.divergencias || [];
  return Array.from(new Set(base.map(d=>irDivDiaDa(d).slice(0,7)).filter(Boolean))).sort();
}
function irDivDiasDisponiveis(){
  const base = (IR.divAnoCache||{}).divs || IR.divergencias || [];
  return Array.from(new Set(base.map(d=>irDivDiaDa(d)).filter(Boolean))).sort();
}
/* ---------- PREÇO UNITÁRIO DA DIVERGÊNCIA ----------
   A SIGEQ278 é custo MÉDIO: quando o item zera no CD o preço some, e a
   divergência daquele item vira R$ 0 — some justo o que mais interessa. A QRY410
   congela o preço no momento do lançamento, então ela é a fonte boa.

   Preço implícito da 410 = |valor lançado| ÷ |quantidade lançada| no item/mês.
   A cascata, do mais específico pro mais genérico:
     1. preço da 410 no MÊS em que o local fechou;
     2. último preço da 410 no ano antes desse mês;
     3. preço da 278 que veio no processamento;
     4. zero (componente de kit que não valora).
   Cada divergência guarda de onde veio o preço, pra tabela poder mostrar. */
/* Descrição do endereço, com duas fontes. A Base Congelada só tem os locais DESTE
   ciclo; a auditoria, porém, lista todo endereço onde o item tem saldo hoje
   (QRY0390), e boa parte deles não foi congelada — apareciam com um traço, como se
   o local estivesse faltando. A QRY0843 traz a descrição de tudo que foi contado,
   então serve de segunda fonte; o que sobra é rotulado, não deixado em branco. */
function irDescLocalMapa(){
  if(IR._descLocal && IR._descLocalCiclo===(IR.cicloAtivo||{}).id) return IR._descLocal;
  const m = new Map(IR._descLocalTodosCiclos || []);
  for(const c of (IR.contagens||[])) if(c.local && c.descricaoLocal && !m.has(c.local)) m.set(c.local, c.descricaoLocal);
  for(const l of (IR.locais||[])) if(l.idLocal && l.descricao) m.set(l.idLocal, l.descricao);
  IR._descLocal = m; IR._descLocalCiclo = (IR.cicloAtivo||{}).id;
  return m;
}
/* Terceira fonte: a Base Congelada de TODOS os ciclos já importados. Um endereço
   que não entrou no ciclo atual quase sempre entrou em algum anterior, e a
   descrição dele serve igual. Roda uma vez, sob demanda. */
async function irCarregarDescLocaisTodosCiclos(){
  if(IR._descLocalTodosCiclos || IR._descLocalCarregando) return;
  IR._descLocalCarregando = true;
  try{
    const m = new Map();
    for(const c of (IR.ciclos||[])){
      const ls = await irGetByCiclo(IR_STORES.locais, c.id);
      for(const l of ls) if(l.idLocal && l.descricao && !m.has(l.idLocal)) m.set(l.idLocal, l.descricao);
    }
    IR._descLocalTodosCiclos = m;
    IR._descLocal = null; // força remontar o mapa com a fonte nova
  }catch(err){ IR._descLocalTodosCiclos = new Map(); }
  finally{ IR._descLocalCarregando = false; }
}
function irDescLocal(local){ return irDescLocalMapa().get(local) || ''; }
/* EAN e descrição do item, vindos da QRY0390 importada à parte. É a única base com
   código de barras, e como ela não depende de ciclo, a auditoria passa a ter EAN
   mesmo em ciclo processado antes disso existir. */
async function irCarregarItemInfo(){
  if(IR._itemInfo || IR._itemInfoLoading) return;
  IR._itemInfoLoading = true;
  try{
    const linhas = await irGetItemInfoTodos();
    IR._itemInfo = new Map(linhas.map(l=>[l.item, l]));
  }catch(err){ IR._itemInfo = new Map(); }
  finally{ IR._itemInfoLoading = false; }
}
function irItemInfo(item){ return (IR._itemInfo && IR._itemInfo.get(irDivNormItem(item))) || null; }
function irDivNormItem(v){
  const s = String(v ?? '').trim();
  if(s==='') return '';
  const n = Number(s);
  return (Number.isFinite(n) && Number.isInteger(n)) ? String(n) : s;
}
async function irDivCarregar410(anos){
  if(IR._div410Loading) return;
  IR._div410Loading = true;
  try{
    const cache = Object.assign({}, IR.div410Cache||{});
    for(const ano of anos) cache[ano] = (await irGetNet410(Number(ano))) || {vazio:true};
    IR.div410Cache = cache;
  }catch(err){
    IR.div410Cache = Object.assign({}, IR.div410Cache||{}, {erro:String(err)});
  }finally{
    IR._div410Loading = false;
  }
}
// item -> {porMes: Map(mes -> preço), meses: [mes ordenado]}
function irDivPrecos410(){
  const anos = Object.keys(IR.div410Cache||{}).filter(k=>/^\d{4}$/.test(k));
  const chave = anos.sort().join(',');
  if(IR._precos410 && IR._precos410Chave===chave) return IR._precos410;
  const mapa = new Map();
  for(const ano of anos){
    const dados = (IR.div410Cache||{})[ano];
    for(const linha of ((dados||{}).porMes || [])){
      for(const i of (linha.topItensPositivos||[]).concat(linha.topItensNegativos||[])){
        const k = irDivNormItem(i.item);
        const qtd = Math.abs(i.saldoQtd||0);
        if(!k || qtd < 0.005) continue;
        const preco = Math.abs(i.saldoValor||0) / qtd;
        if(!(preco > 0)) continue;
        if(!mapa.has(k)) mapa.set(k, {porMes:new Map(), meses:[]});
        mapa.get(k).porMes.set(linha.mes, preco);
      }
    }
  }
  for(const g of mapa.values()) g.meses = Array.from(g.porMes.keys()).sort();
  IR._precos410 = mapa; IR._precos410Chave = chave;
  return mapa;
}
// Preço a usar numa linha de divergência, com a origem junto.
function irDivPrecoDa(d){
  const g = irDivPrecos410().get(irDivNormItem(d.item));
  if(g){
    const mes = irDivDiaDa(d).slice(0,7);
    if(g.porMes.has(mes)) return {preco: g.porMes.get(mes), origem:'410'};
    // Último preço lançado ANTES do fechamento — o item pode ter zerado depois.
    let anterior = null;
    for(const m of g.meses){ if(m <= mes) anterior = m; else break; }
    if(anterior) return {preco: g.porMes.get(anterior), origem:'410 ant.'};
  }
  if(d.precoUnitario) return {preco: d.precoUnitario, origem:'278'};
  // Terceira fonte: o preço unitário da QRY0390, que é o custo de hoje e existe
  // pra praticamente todo item com saldo. Sem ela, item fora da 410 e sem preço
  // na 278 aparecia divergindo R$ 0,00 — e um item de valor zero era tratado
  // como se não tivesse divergência de dinheiro nenhuma.
  const info = irItemInfo(d.item);
  if(info && info.valorUnitario) return {preco: info.valorUnitario, origem:'390'};
  return {preco: 0, origem: (info && info.valoriza==='N') ? 'não valora' : 'sem preço'};
}
function irDivValorDa(d){
  const {preco, origem} = irDivPrecoDa(d);
  return {valor: d.diferenca * preco, preco, origem};
}

/* Todas as linhas de um item no ANO, valoradas e marcadas se estão dentro ou fora
   do período filtrado. É o que responde "cadê a contrapartida" sem trocar o filtro. */
function irDivLinhasDoAno(item){
  const noPeriodo = new Set(irDivDivsDoEscopo().map(d=>d.id));
  return irDivLinhasValidas((IR.divAnoCache||{}).divs || IR.divergencias)
    .filter(d=>d.item===item)
    .map(d=>{
      const v = irDivValorDa(d);
      return Object.assign({}, d, {vlDivergencia:v.valor, precoUsado:v.preco, precoOrigem:v.origem,
        foraDoPeriodo: !noPeriodo.has(d.id)});
    })
    .sort((a,b)=>String(b.diaFechamento||'').localeCompare(String(a.diaFechamento||''))
                 || Math.abs(b.vlDivergencia)-Math.abs(a.vlDivergencia));
}
function irDivAgruparPorItem(divs){
  const map = new Map();
  for(const d of divs){
    let g = map.get(d.item);
    if(!g){ g = {item:d.item, descricao:d.itemNome, ean:d.ean||'', netQtd:0, netValor:0, locais:[], origens:new Set()}; map.set(d.item, g); }
    const v = irDivValorDa(d);
    g.netQtd += d.diferenca;
    g.netValor += v.valor;
    g.locais.push(Object.assign({}, d, {vlDivergencia: v.valor, precoUsado: v.preco, precoOrigem: v.origem}));
    g.origens.add(v.origem);
    if(!g.descricao && d.itemNome) g.descricao = d.itemNome;
    if(!g.ean && d.ean) g.ean = d.ean;
  }
  return map;
}
/* Núcleo: NET do escopo + NET do ano, e a classificação em ofensor/compensado. */
/* Motivo que não conta pro NET (ANF de nota fiscal, BAI de insumo, QBR de quebra,
   EPI, INP de pallets) não é divergência de estoque e não pode aparecer na aba. O
   worker já barra na importação, mas a checagem também roda aqui: ciclo processado
   antes dessa regra continua no banco com essas linhas, e reprocessar é decisão do
   usuário. A legenda é a mesma editável em Configurações. */
function irDivMotivoConta(d){
  if(!d.motivo) return true; // divergência antiga, gravada antes do motivo existir
  const m = (IR.net410Legenda||[]).find(x=>x.id===d.motivo);
  return !m || m.considerarNet !== false;
}
function irDivLinhasValidas(lista){
  return irSoLocaisConcluidos(lista || []).filter(d=>d.diferenca!==0 && irDivMotivoConta(d));
}
// Divergências do período escolhido no filtro do topo. Isolado porque a
// conciliação com a QRY410 precisa exatamente do mesmo recorte.
function irDivDivsDoEscopo(){
  const e = IR.divEscopo;
  let divs = irDivLinhasValidas(IR.divEscopoDados || IR.divergencias);
  if(e.tipo==='mes') divs = divs.filter(d=>irDivDiaDa(d).slice(0,7)===e.mes);
  if(e.tipo==='periodo'){
    if(e.de)  divs = divs.filter(d=>irDivDiaDa(d) >= e.de);
    if(e.ate) divs = divs.filter(d=>irDivDiaDa(d) <= e.ate);
  }
  return divs;
}
function irDivCalcItens(){
  // O corte pode ser em R$ ou em peças — é a base escolhida nos chips que decide
  // qual dos dois define quem é ofensor.
  const base = irDivBase();
  const corte = base.corte;
  const divs = irDivDivsDoEscopo();
  const noEscopo = irDivAgruparPorItem(divs);
  const noAno = irDivAgruparPorItem(irDivLinhasValidas((IR.divAnoCache||{}).divs));
  const busca = (IR.divBusca||'').toLowerCase();
  const itens = Array.from(noEscopo.values()).map(g=>{
    const a = noAno.get(g.item) || {netQtd:g.netQtd, netValor:g.netValor};
    const noPeriodo = base.campo==='netQtd' ? g.netQtd : g.netValor;
    const noAnoBase = base.campo==='netQtd' ? a.netQtd : a.netValor;
    const relevante = Math.abs(noPeriodo) >= corte;
    /* Compensado = pesou no escopo, mas o ano desmancha. Erro de contagem houve;
       perda não. Não é ofensor.

       A conta é pelo VALOR: item que ganhou 15 mil num ciclo e perdeu 15 mil em
       outro fecha o ano em zero e sai da lista, mesmo que as peças não batam.

       Mas item que não tem preço em fonte nenhuma vale zero SEMPRE, no período e
       no ano — pelo valor ele seria "compensado" por construção, e sumia da
       auditoria mesmo tendo peça divergente de verdade. Quando não há valor em
       lugar nenhum, quem decide é a quantidade do ano. */
    const zero = base.campo==='netQtd' ? 0.5 : 0.005;
    const temBase = Math.abs(noPeriodo) > zero || Math.abs(noAnoBase) > zero;
    const compensado = relevante && (temBase
      ? Math.abs(noAnoBase) < Math.max(corte, zero)
      : Math.abs(a.netQtd) < 0.5);
    return {...g,
      nLocais: g.locais.length,
      netQtdAno: a.netQtd, netValorAno: a.netValor,
      relevante, compensado,
      ofensor: relevante && !compensado,
      sentido: noPeriodo<0 ? 'perda' : 'ganho'
    };
  }).filter(i=>{
    if(!busca) return true;
    return String(i.item).toLowerCase().includes(busca) || String(i.descricao||'').toLowerCase().includes(busca);
  });
  const o = IR.divOrdem || {col:'netValor', dir:'desc'};
  const dir = o.dir==='desc' ? -1 : 1;
  itens.sort((x,y)=>{
    if(o.col==='item') return dir*String(x.item).localeCompare(String(y.item));
    if(o.col==='descricao') return dir*String(x.descricao||'').localeCompare(String(y.descricao||''));
    if(o.col==='situacao') return dir*String(x.ofensor?x.sentido:'compensado').localeCompare(String(y.ofensor?y.sentido:'compensado'));
    // Colunas numéricas ordenam pelo valor COM SINAL: 1º clique traz o maior ganho
    // no topo e a maior perda no fim, 2º clique inverte. Ordenar por módulo
    // embaralhava perda e ganho na mesma ponta.
    return dir*((x[o.col]||0) - (y[o.col]||0));
  });
  const ofensores = itens.filter(i=>i.ofensor);
  const somaBase = arr => arr.reduce((s,i)=>s+(base.campo==='netQtd'?i.netQtd:i.netValor), 0);
  return {
    itens, ofensores, base,
    perdas: ofensores.filter(i=>i.sentido==='perda'),
    ganhos: ofensores.filter(i=>i.sentido==='ganho'),
    perdaBase: somaBase(ofensores.filter(i=>i.sentido==='perda')),
    ganhoBase: somaBase(ofensores.filter(i=>i.sentido==='ganho')),
    perdaQtd: ofensores.filter(i=>i.sentido==='perda').reduce((s,i)=>s+i.netQtd,0),
    ganhoQtd: ofensores.filter(i=>i.sentido==='ganho').reduce((s,i)=>s+i.netQtd,0),
    compensados: itens.filter(i=>i.compensado),
    netValor: Array.from(noEscopo.values()).reduce((s,i)=>s+i.netValor,0),
    netQtd: Array.from(noEscopo.values()).reduce((s,i)=>s+i.netQtd,0),
    totalItens: noEscopo.size,
    // Cada LINHA divergente é um par item x local: o mesmo item divergindo em três
    // endereços são três divergências pro auditor, não uma.
    totalLinhas: divs.length,
    totalLocais: new Set(divs.map(d=>d.local)).size,
    perdaOfensores: ofensores.filter(i=>i.netValor<0).reduce((s,i)=>s+i.netValor,0),
    ganhoOfensores: ofensores.filter(i=>i.netValor>0).reduce((s,i)=>s+i.netValor,0),
    nPerda: ofensores.filter(i=>i.netValor<0).length,
    nGanho: ofensores.filter(i=>i.netValor>0).length,
    corte
  };
}
/* NET do mês corrente, sempre — independe do período escolhido no filtro. É o
   número que o auditor precisa ver ao abrir a tela, mesmo olhando outro recorte. */
function irDivNetMesVigente(){
  const mes = new Date().toISOString().slice(0,7);
  // O NET do mês é o do livro fiscal — mesmo número do gráfico NET Mensal. Sai da
  // QRY410 direto, não da contagem: são bases diferentes e não fecham entre si.
  const dados = (IR.div410Cache||{})[mes.slice(0,4)];
  const linha = ((dados||{}).porMes || []).find(m=>m.mes===mes);
  if(linha){
    const itens = (linha.topItensPositivos||[]).concat(linha.topItensNegativos||[]);
    return {
      mes, fonte:'410',
      valor: linha.net,
      qtd: itens.reduce((s,i)=>s+(i.saldoQtd||0), 0),
      itens: itens.length
    };
  }
  const divs = irDivLinhasValidas((IR.divAnoCache||{}).divs || IR.divergencias)
    .filter(d=>irDivDiaDa(d).slice(0,7)===mes);
  return {
    mes, fonte:'contagem',
    valor: divs.reduce((s,d)=>s+irDivValorDa(d).valor,0),
    qtd: divs.reduce((s,d)=>s+d.diferenca,0),
    itens: new Set(divs.map(d=>d.item)).size
  };
}

/* ---------- ITENS SIMILARES TROCADOS ----------
   Assinatura de troca de contagem: no MESMO local, o item A sobra exatamente o
   que o item B falta, e os dois se parecem. É o que o estoque aponta depois; aqui
   sai no mesmo dia da contagem.

   A semelhança é medida de dois jeitos, e basta um: descrições que compartilham
   boa parte das palavras, ou códigos vizinhos (mesmo prefixo). Item trocado
   costuma ser variante do mesmo produto — cor, voltagem, capacidade. */
function irDivTokens(desc){
  return String(desc||'').toUpperCase()
    .replace(/[^A-Z0-9]+/g,' ').trim().split(' ')
    .filter(t=>t.length>=3);
}
function irDivSemelhanca(a, b){
  const A = new Set(irDivTokens(a)), B = new Set(irDivTokens(b));
  if(!A.size || !B.size) return 0;
  let inter = 0;
  for(const t of A) if(B.has(t)) inter++;
  return inter / (A.size + B.size - inter);   // Jaccard
}
/* Palavras iguais no COMEÇO da descrição. A família do produto vem na frente
   ("COMPRESSOR DE AR ...", "SERRA CIRCULAR ...") e a especificação depois, então
   prefixo separa variante de produto diferente melhor que contagem de palavras:
   "COMPRESSOR DE AR 3HP 15/175L" e "COMPRESSOR DE AR 2HP 10/100L" dividem só 2 de
   6 palavras — Jaccard baixo — mas são claramente o mesmo produto. */
function irDivPrefixoComum(a, b){
  const A = String(a||'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().split(' ').filter(Boolean);
  const B = String(b||'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().split(' ').filter(Boolean);
  let n = 0;
  while(n<A.length && n<B.length && A[n]===B[n]) n++;
  return n;
}
const IR_DIV_PREFIXO_MIN = 2;
function irDivCodigosVizinhos(a, b){
  const x = String(a).replace(/\D/g,''), y = String(b).replace(/\D/g,'');
  if(x.length!==y.length || x.length<4) return false;
  return x.slice(0,-2)===y.slice(0,-2);       // diferem só nos 2 últimos dígitos
}
const IR_DIV_SEMELHANCA_MIN = 0.45;
/* Id Inventário da divergência. Ciclos processados antes do campo existir têm o
   id no formato ciclo|local|inventario|item — dá pra recuperar de lá. */
function irDivInventario(d){
  if(d.inventario) return d.inventario;
  const p = String(d.id||'').split('|');
  return p.length>=4 ? p[2] : '';
}
function irDivSimSetFiltro(k, v){
  if(!IR.divSimFiltro) IR.divSimFiltro = {de:'', ate:''};
  IR.divSimFiltro[k] = v;
  irRenderView();
}
function irDivSimToggleDesc(){ IR.divSimExigeDesc = IR.divSimExigeDesc===false; irRenderView(); }
function irDivSimLimpar(){ IR.divSimFiltro = {de:'', ate:''}; irRenderView(); }
/* Cabeçalho clicável da tabela de similares. Mesma convenção da tabela de
   ofensores: 1º clique ordena decrescente, 2º inverte. */
function irDivSimOrdenar(col){
  const o = IR.divSimOrdem || {col:'dia', dir:'desc'};
  IR.divSimOrdem = (o.col===col) ? {col, dir: o.dir==='desc'?'asc':'desc'} : {col, dir:'desc'};
  irRenderView();
}
// Colunas da tabela de similares. num = ordena por número (e por MÓDULO quando o
// sinal não é o que interessa, como no desequilíbrio: o maior impacto no topo).
const IR_SIM_COLS = [
  {key:'dia',           lbl:'Dia'},
  {key:'local',         lbl:'Local'},
  {key:'inventario',    lbl:'Inventário'},
  {key:'qtd',           lbl:'Qtde',            num:true},
  {key:'itemSobra',     lbl:'Sobrou'},
  {key:'itemFalta',     lbl:'Faltou'},
  {key:'semelhanca',    lbl:'Semelhança',      num:true},
  {key:'desequilibrio', lbl:'Desequilíbrio R$', num:true, abs:true}
];
function irDivSimOrdenarPares(pares){
  const o = IR.divSimOrdem || {col:'dia', dir:'desc'};
  const col = IR_SIM_COLS.find(c=>c.key===o.col) || IR_SIM_COLS[0];
  const dir = o.dir==='desc' ? -1 : 1;
  return pares.slice().sort((x,y)=>{
    const a = x[col.key], b = y[col.key];
    const cmp = col.num
      ? (col.abs ? Math.abs(a||0)-Math.abs(b||0) : (a||0)-(b||0))
      : String(a||'').localeCompare(String(b||''));
    // Desempate estável pelo risco: dentro do mesmo dia, o par mais caro primeiro.
    return dir*cmp || y.risco-x.risco;
  });
}
/* Pares de troca. Dois cuidados que a primeira versão não tinha:

   1. O par é dentro da mesma VISITA (local + Id Inventário). Agrupar só por local
      fazia o mesmo item parear consigo mesmo, quando o local foi inventariado duas
      vezes — sobrando num inventário e faltando no outro.
   2. Semelhança de DESCRIÇÃO é obrigatória. Código vizinho virou só um selo: dois
      códigos seguidos podem ser produtos sem nenhuma relação.

   Este painel ignora o filtro de período do topo — ele tem o próprio de/até,
   porque a pergunta aqui é "o que trocaram ontem", não "o que pesa no ciclo". */
function irDivParesSimilares(){
  const f = IR.divSimFiltro || {de:'', ate:''};
  let divs = irDivLinhasValidas((IR.divAnoCache||{}).divs || IR.divergencias);
  if(f.de)  divs = divs.filter(d=>irDivDiaDa(d) >= f.de);
  if(f.ate) divs = divs.filter(d=>irDivDiaDa(d) <= f.ate);
  const porVisita = new Map();
  for(const d of divs){
    const chave = d.local+'|'+irDivInventario(d);
    if(!porVisita.has(chave)) porVisita.set(chave, []);
    porVisita.get(chave).push(d);
  }
  const pares = [];
  // Diagnóstico do funil. Sem ele, uma tabela vazia não diz se o problema é o
  // filtro de data, a quantidade que não espelha ou a descrição que não bate.
  const diag = {divs:divs.length, visitas:porVisita.size, visitasComOsDois:0,
                qtdEspelhada:0, reprovadosPelaDescricao:0, mesmoCodigo:0, semDia:0};
  for(const d of divs) if(!irDivDiaDa(d)) diag.semDia++;
  const exigeDesc = IR.divSimExigeDesc !== false;
  for(const [chave, lista] of porVisita){
    if(lista.length<2) continue;
    const sobra = lista.filter(d=>d.diferenca>0);
    const falta = lista.filter(d=>d.diferenca<0);
    if(sobra.length && falta.length) diag.visitasComOsDois++;
    const usados = new Set();
    for(const a of sobra){
      for(const b of falta){
        if(usados.has(b.id)) continue;
        if(a.item === b.item){ diag.mesmoCodigo++; continue; }   // mesmo código não é troca
        if(a.diferenca !== -b.diferenca) continue;               // troca é 1 pra 1
        diag.qtdEspelhada++;
        const sem = irDivSemelhanca(a.itemNome, b.itemNome);
        const pref = irDivPrefixoComum(a.itemNome, b.itemNome);
        // Basta um dos dois: mesma família no início da descrição, ou muitas
        // palavras em comum. Código vizinho sozinho não entra — dois códigos
        // seguidos podem ser martelo e luva.
        const pareceu = pref >= IR_DIV_PREFIXO_MIN || sem >= IR_DIV_SEMELHANCA_MIN;
        if(!pareceu){ diag.reprovadosPelaDescricao++; if(exigeDesc) continue; }
        usados.add(b.id);
        const vA = irDivValorDa(a).valor, vB = irDivValorDa(b).valor;
        pares.push({
          idSobra:a.id, idFalta:b.id,
          local: a.local, inventario: irDivInventario(a), dia: irDivDiaDa(a),
          itemSobra:a.item, nomeSobra:a.itemNome, itemFalta:b.item, nomeFalta:b.itemNome,
          qtd: a.diferenca,
          valorSobra: vA, valorFalta: vB,
          desequilibrio: vA + vB,
          risco: Math.max(Math.abs(vA), Math.abs(vB)),
          semelhanca: sem, prefixo: pref, vizinhos: irDivCodigosVizinhos(a.item, b.item)
        });
        break;
      }
    }
  }
  pares.sort((x,y)=>String(y.dia).localeCompare(String(x.dia)) || y.risco-x.risco);
  return {pares, diag};
}

/* Rótulo do período + os ciclos que ele realmente cobre. Filtrar "janeiro" com o
   seletor de ciclo em 3/2026 não olha o ciclo 3: olha o que fechou em janeiro,
   que é outro ciclo. O título tem que dizer isso, senão engana. */
function irDivPeriodoLabel(){
  const base = irDivEscopoLabel();
  if(IR.divEscopo.tipo==='ciclo') return base;
  const ids = new Set(irDivDivsDoEscopo().map(d=>d.cicloId).filter(Boolean));
  if(!ids.size) return base;
  const nomes = IR.ciclos.filter(c=>ids.has(c.id)).map(c=>irCicloLabel(c));
  return nomes.length ? base+' · '+nomes.join(' + ') : base;
}
function irDivEscopoLabel(){
  const e = IR.divEscopo;
  if(e.tipo==='ano') return 'ano '+e.ano;
  if(e.tipo==='mes') return irMesLabel(e.mes);
  if(e.tipo==='ciclos'){
    const cs = irDivCiclosSelecionados();
    return cs.length ? cs.map(c=>irCicloLabel(c)).join(' + ') : 'selecione os ciclos';
  }
  if(e.tipo==='periodo'){
    if(e.de && e.ate) return irFmtDate(e.de)+' a '+irFmtDate(e.ate);
    if(e.de)  return 'de '+irFmtDate(e.de);
    if(e.ate) return 'até '+irFmtDate(e.ate);
    return 'todo o histórico';
  }
  const c = e.cicloId ? IR.ciclos.find(x=>x.id===e.cicloId) : IR.cicloAtivo;
  return c ? irCicloLabel(c) : 'ciclo atual';
}
function irDivToggleItem(item){
  if(!IR.divSelecionados) IR.divSelecionados = new Set();
  if(IR.divSelecionados.has(item)) IR.divSelecionados.delete(item); else IR.divSelecionados.add(item);
  irRenderView();
}
function irDivMarcarTodos(){
  const {ofensores} = irDivCalcItens();
  IR.divSelecionados = new Set(ofensores.map(i=>i.item));
  irRenderView();
}
function irDivLimparSelecao(){ IR.divSelecionados = new Set(); IR.divAuditoria = null; irRenderView(); }
function irDivExpandir(item){
  IR.divExpandido = IR.divExpandido===item ? null : item;
  irRenderView();
}

/* ---------- AUDITORIA — locais com saldo (QRY0390) ---------- */
async function irDivGerarAuditoria(){
  const sel = Array.from(IR.divSelecionados||[]);
  if(!sel.length){ irShowToast('Marque ao menos um item.', true); return; }
  try{
    await irCarregarDescLocaisTodosCiclos();
    await irCarregarItemInfo();
    const {itens} = irDivCalcItens();
    const porItem = new Map(itens.map(i=>[i.item, i]));
    const cicloId = (IR.cicloAtivo||{}).id;
    const linhas = [];
    let semEstoque = 0, semDescricao = 0, ocultosVirtuais = 0;
    for(const item of sel){
      const g = porItem.get(item);
      if(!g) continue;
      const info = irItemInfo(item) || {};
      const ean = g.ean || info.ean || '';
      const descricaoItem = g.descricao || info.descricao || '';
      // Onde o item divergiu no período — é o endereço que o auditor confere
      // primeiro, e ele não é necessariamente um dos que têm saldo hoje.
      const ondeDivergiu = g.locais.filter(d=>d.diferenca!==0);
      // Onde foi a ÚLTIMA divergência dentro do filtro: é o endereço mais fresco,
      // e o primeiro lugar onde o auditor deve olhar.
      const porData = ondeDivergiu.slice().sort((a,b)=>
        String(irDivDiaDa(b)).localeCompare(String(irDivDiaDa(a))));
      // O endereço de correção não é onde a peça estava: procura o último ANTES
      // dele. Se todos forem de correção, aí sim mostra o que tem.
      const ult = porData.find(d=>!irAudEhCorrecao(d.local)) || porData[0];
      const ultimaDiv = ult
        ? ult.local + (irDescLocal(ult.local) ? ' · '+irDescLocal(ult.local) : '') + ' · ' + irFmtDate(irDivDiaDa(ult))
        : '';
      // Estoque atual: primeiro a ficha da QRY0390 avulsa, que é a foto de hoje e
      // já vem com a descrição do endereço; o do ciclo entra só como reserva, pra
      // quem ainda não importou a 390 nova.
      let est = null;
      if(info.locais && info.locais.length) est = {locais: info.locais};
      else { try{ est = cicloId ? await irGetEstoqueItem(cicloId, item) : null; }catch(err){ est = null; } }
      // Sem saldo na QRY0390 o item zerou no CD — não há endereço de estoque pra
      // conferir. Em vez de uma linha vazia, a auditoria manda o auditor pro LOCAL
      // DO AJUSTE: é lá que a peça estava, e é o lugar mais provável de ela ainda
      // estar (caiu atrás, foi pro endereço vizinho, ficou no chão do corredor).
      if(!est || !est.locais || !est.locais.length){
        semEstoque++;
        for(const d of ondeDivergiu){
          linhas.push({item, ean, descricao:descricaoItem, local:d.local, descricaoLocal:irDescLocal(d.local),
            saldo:null, diferenca:g.netQtd, valor:g.netValor, ultimaDiv});
        }
        if(!ondeDivergiu.length){
          linhas.push({item, ean, descricao:descricaoItem, local:'', descricaoLocal:'',
            saldo:null, diferenca:g.netQtd, valor:g.netValor, ultimaDiv});
        }
        continue;
      }
      const posicoes = IR.audIgnorarVirtuais===false ? est.locais
        : est.locais.filter(x=>!irAudEhVirtual(x.local, x.desc));
      if(!posicoes.length && est.locais.length) ocultosVirtuais += est.locais.length;
      for(const s of (posicoes.length ? posicoes : est.locais)){
        // A QRY0390 nova traz a descrição do endereço junto com o saldo — é a
        // fonte mais confiável, porque cobre todo o CD e não só o que foi
        // congelado em algum ciclo.
        const desc = s.desc || irDescLocal(s.local);
        if(!desc) semDescricao++;
        // Endereço sem descrição em nenhuma base fica em branco de propósito: o
        // código do local já basta pro auditor achar, e um rótulo no lugar da
        // descrição só polui a folha impressa.
        linhas.push({item, ean, descricao:descricaoItem, local:s.local,
          descricaoLocal: desc, saldo:s.qtd, diferenca:g.netQtd, valor:g.netValor, ultimaDiv});
      }
    }
    /* Ordem da folha: descrição do endereço. O auditor confere andando pelo CD, e a
       ordem que interessa a ele é a do corredor — BLM 010 005, 010 007, 010 009 —, não
       a ordem em que os itens foram marcados na tela. Endereço sem descrição vai pro
       fim: sem rótulo não dá pra encaixar na rota, e no meio da lista ele só quebra a
       sequência. Dentro da mesma descrição, desempata pelo código do local e pelo item,
       pra folha sair igual toda vez que for gerada. */
    linhas.sort((a,b)=>{
      const da = String(a.descricaoLocal||''), db = String(b.descricaoLocal||'');
      if(!da !== !db) return da ? -1 : 1;
      return da.localeCompare(db, 'pt-BR')
          || String(a.local||'').localeCompare(String(b.local||''), 'pt-BR')
          || String(a.item||'').localeCompare(String(b.item||''), 'pt-BR');
    });
    IR.divAuditoria = {
      geradoEm: new Date().toLocaleString('pt-BR'),
      escopo: irDivEscopoLabel(),
      itens: sel.length, linhas, semEstoque, semDescricao, ocultosVirtuais,
      // Sem ficha da 390 não há EAN nem saldo por endereço — é a causa mais comum
      // de a folha sair capenga, e o aviso evita procurar bug onde não tem.
      semFicha: !(IR._itemInfo && IR._itemInfo.size)
    };
    irRenderView();
    const el = document.querySelector('.aud-panel');
    if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
  }catch(err){
    irShowToast('Falha ao gerar auditoria: '+(err && err.message || err), true);
  }
}
function irDivImprimirAuditoria(){ window.print(); }
function irDivExportarAuditoria(){
  const g = IR.divAuditoria;
  if(!g || !g.linhas.length){ irShowToast('Nada para exportar.', true); return; }
  const data = (document.getElementById('ir-aud-data')||{}).value || '';
  const cols = g.tipo==='similares'
    ? [['dia','Dia'],['local','Local'],['descricaoLocal','Desc. Local'],['inventario','Inv.'],
       ['itemSobra','Sobrou'],['nomeSobra','Descrição (sobrou)'],['itemFalta','Faltou'],
       ['nomeFalta','Descrição (faltou)'],['qtd','Qtde'],['desequilibrio','Desequil.'],
       ['ondeConferir','Onde Conferir']]
    : [['item','Item'],['ean','EAN'],['descricao','Descrição'],['local','Local'],
       ['descricaoLocal','Desc. Local'],['saldo','Qtde'],['diferenca','Qtde Div.'],['valor','Valor Div.'],
       ['ultimaDiv','Últ. Divergência']];
  const cab = cols.map(c=>c[1]).concat(['Contagem','Data']);
  const linhas = g.linhas.map(l=>cols.map(([k])=>l[k]==null?'':l[k]).concat(['', data]));
  // Colunas de dinheiro saem formatadas como moeda na planilha — número cru vira
  // texto ambíguo na mão de quem abre o arquivo.
  const moeda = cab.map(h=>/Valor|Desequil/.test(h));
  irDivBaixarPlanilha(cab, linhas, (g.tipo==='similares'?'auditoria_similares_':'auditoria_')+String(g.escopo).replace(/\W+/g,'_'), moeda);
}
/* Excel de um item: onde ele divergiu, com a descrição do local. */
function irDivExportarItem(item){
  const {itens} = irDivCalcItens();
  const g = itens.find(i=>i.item===item);
  if(!g){ irShowToast('Item fora do recorte atual.', true); return; }
  const cab = ['Item','Descrição','Local','Descrição do Local','Rua','Log','Dia do Fechamento','Motivo',
    'Qtde Sistema','Qtde Física','Diferença','Valor Divergente'];
  const linhas = g.locais.slice().sort((a,b)=>Math.abs(b.vlDivergencia)-Math.abs(a.vlDivergencia)).map(d=>{
    const l = {descricao: irDescLocal(d.local)};
    return [g.item, g.descricao||'', d.local, l.descricao||'', l.x1||'', l.grupoClasse||'',
      irDivDiaDa(d), d.motivo||'', d.qtdeSistema, d.qtdeFisica, d.diferenca, d.vlDivergencia];
  });
  irDivBaixarPlanilha(cab, linhas, 'item_'+String(item).replace(/\W+/g,'_'));
}
/* .xlsx pelo SheetJS que o app já carrega; CSV quando ele não estiver disponível. */
/* Borda fina em volta de TODA célula — cabeçalho e dados. Sem ela a folha da
   auditoria sai como um bloco de texto corrido, e quem está conferindo endereço por
   endereço perde a linha no meio do caminho. Quem escreve o estilo é o
   xlsx-js-style carregado no index.html; a build community do xlsx descarta .s. */
const IR_XLS_BORDA = {style:'thin', color:{rgb:'FF9AA1B4'}};
const IR_XLS_GRADE = {top:IR_XLS_BORDA, bottom:IR_XLS_BORDA, left:IR_XLS_BORDA, right:IR_XLS_BORDA};
function irDivBaixarPlanilha(cabecalho, linhas, nomeBase, colsMoeda){
  if(typeof XLSX!=='undefined' && XLSX.utils){
    const ws = XLSX.utils.aoa_to_sheet([cabecalho, ...linhas]);
    ws['!cols'] = cabecalho.map(h=>({wch: /Descrição/.test(h) ? 40 : Math.max(12, h.length+2)}));
    // Cabeçalho congelado: rolando 300 linhas de auditoria, sem isso não dá pra saber
    // mais qual coluna é qual.
    ws['!freeze'] = {xSplit:0, ySplit:1, topLeftCell:'A2', activePane:'bottomLeft', state:'frozen'};
    ws['!autofilter'] = {ref: XLSX.utils.encode_range({s:{r:0,c:0}, e:{r:linhas.length, c:cabecalho.length-1}})};
    for(let c=0;c<cabecalho.length;c++){
      for(let r=0;r<=linhas.length;r++){
        // Célula vazia não existe na planilha e por isso não ganharia borda — a coluna
        // "Contagem", que é justamente onde o auditor escreve à mão, sairia sem grade.
        // Então cria a célula em branco só pra ela receber a moldura.
        const end = XLSX.utils.encode_cell({r, c});
        if(!ws[end]) ws[end] = {t:'s', v:''};
        const cel = ws[end];
        cel.s = r===0
          ? {font:{bold:true, sz:10, color:{rgb:'FFFFFFFF'}}, fill:{fgColor:{rgb:'FF001A72'}},
             alignment:{horizontal:'center', vertical:'center', wrapText:true}, border:IR_XLS_GRADE}
          : {font:{sz:10}, alignment:{vertical:'center'}, border:IR_XLS_GRADE};
        if(r>0 && colsMoeda && colsMoeda[c] && typeof cel.v === 'number'){
          cel.t = 'n'; cel.z = 'R$ #,##0.00;[Red]-R$ #,##0.00';
        }
      }
    }
    // Garante que o range da planilha cobre as células em branco que acabamos de criar.
    ws['!ref'] = XLSX.utils.encode_range({s:{r:0,c:0}, e:{r:linhas.length, c:cabecalho.length-1}});
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dados');
    XLSX.writeFile(wb, nomeBase+'.xlsx');
    return;
  }
  const esc = v => typeof v==='string' ? '"'+v.replace(/"/g,'""')+'"' : String(v==null?'':v).replace('.', ',');
  const csv = '﻿'+cabecalho.join(';')+'\n'+linhas.map(r=>r.map(esc).join(';')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nomeBase+'.csv'; a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- RENDER ---------- */
function irRenderDivFiltros(){
  const e = IR.divEscopo;
  const b = irDivBase();
  const meses = irDivMesesDisponiveis();
  const dias = irDivDiasDisponiveis();
  const anos = Array.from(new Set(IR.ciclos.map(c=>String(c.dataAbertura||'').slice(0,4)).filter(Boolean))).sort((a,b)=>b.localeCompare(a));
  const val = e.tipo==='ano' ? 'ano:'+e.ano : e.tipo==='mes' ? 'mes:'+e.mes
            : e.tipo==='ciclos' ? 'ciclos'
            : e.tipo==='periodo' ? 'periodo' : 'ciclo:'+(e.cicloId || (IR.cicloAtivo||{}).id || '');
  return `<div class="panel ofe-filtros">
    <div class="ofe-filtro">
      <label>Período</label>
      <select onchange="irDivSetEscopo(this.value)">
        <optgroup label="Ciclo">${IR.ciclos.map(c=>`<option value="ciclo:${irEsc(c.id)}" ${val==='ciclo:'+c.id?'selected':''}>${irEsc(irCicloLabel(c))}</option>`).join('')}</optgroup>
        <optgroup label="Mês">${meses.map(m=>`<option value="mes:${m}" ${val==='mes:'+m?'selected':''}>${irEsc(irMesLabel(m))}</option>`).join('')}</optgroup>
        <optgroup label="Ano">${anos.map(a=>`<option value="ano:${a}" ${val==='ano:'+a?'selected':''}>${a}</option>`).join('')}</optgroup>
        <optgroup label="Vários"><option value="ciclos" ${val==='ciclos'?'selected':''}>Somar ciclos</option></optgroup>
        <optgroup label="Datas"><option value="periodo" ${val==='periodo'?'selected':''}>Escolher de/até</option></optgroup>
      </select>
    </div>
    ${e.tipo==='ciclos' ? `
      <div class="ofe-filtro"><label>Ciclos</label>
        <div class="conc-chips" style="margin:0;">
          ${IR.ciclos.map(c=>`<button class="conc-chip ${(e.cicloIds||[]).includes(c.id)?'on':''}" onclick="irDivToggleCiclo('${irEsc(c.id)}')">${irEsc(irCicloLabel(c))}</button>`).join('')}
        </div>
      </div>
    ` : ''}
    ${e.tipo==='periodo' ? `
      <div class="ofe-filtro"><label>De</label>
        <input type="date" min="${dias[0]||''}" max="${dias[dias.length-1]||''}" value="${irEsc(e.de||'')}" onchange="irDivSetPeriodo('de', this.value)"></div>
      <div class="ofe-filtro"><label>Até</label>
        <input type="date" min="${dias[0]||''}" max="${dias[dias.length-1]||''}" value="${irEsc(e.ate||'')}" onchange="irDivSetPeriodo('ate', this.value)"></div>
      ${(e.de||e.ate)?`<button class="btn-link" onclick="irDivSetEscopo('periodo');irDivSetPeriodo('de','');irDivSetPeriodo('ate','')">Limpar datas</button>`:''}
    ` : ''}
    <div class="ofe-filtro">
      <label>Analisar por</label>
      <div class="conc-chips" style="margin:0;">
        <button class="conc-chip ${IR.divBase!=='qtd'?'on':''}" onclick="irDivSetBase('valor')">Valor R$</button>
        <button class="conc-chip ${IR.divBase==='qtd'?'on':''}" onclick="irDivSetBase('qtd')">Quantidade</button>
      </div>
    </div>

    <div class="ofe-filtro">
      <label>Corte (${b.lbl})</label>
      <input type="number" min="0" step="${b.passo}" value="${b.corte}" onchange="irDivSetCorte(this.value)">
    </div>
    <div class="ofe-filtro ofe-filtro-busca">
      <label>Item</label>
      <input type="text" placeholder="código ou descrição" value="${irEsc(IR.divBusca||'')}" oninput="irDivSetBusca(this.value)">
    </div>
  </div>`;
}
function irRenderDivResumo(c){
  const cell = (rot, val, cls, sub) => `<div class="ofe-num ${cls||''}">
    <span class="ofe-num-lbl">${irEsc(rot)}</span>
    <strong class="mono">${val}</strong>
    ${sub?`<span class="ofe-num-sub">${irEsc(sub)}</span>`:''}
  </div>`;
  const mv = irDivNetMesVigente();
  const ind = irDivIndevido(c);
  return `<div class="panel ofe-resumo">
    ${cell('NET de '+irMesLabel(mv.mes), (mv.valor>0?'+':'')+irFmtMoney(mv.valor), mv.valor<0?'neg':'pos', irFmtInt(mv.qtd)+' peças · '+(mv.fonte==='410'?'QRY410':'contagem'))}
    ${cell('Ganho indevido', '+'+irFmtMoney(ind.ganho), 'pos', irFmtInt(ind.nGanho)+(ind.nGanho===1?' item':' itens')+' · +'+irFmtInt(ind.ganhoQtd)+' peças')}
    ${cell('Perda indevida', irFmtMoney(ind.perda), 'neg', irFmtInt(ind.nPerda)+(ind.nPerda===1?' item':' itens')+' · '+irFmtInt(ind.perdaQtd)+' peças')}
    ${cell('Divergências no período', irFmtInt(c.totalLinhas), '', irFmtInt(c.totalItens)+' itens · '+irFmtInt(c.totalLocais)+' locais')}
    ${cell('Divergências similares', irFmtInt(ind.nPares), '', irFmtMoney(ind.valorPares)+' em jogo')}
  </div>`;
}
/* Indevido = o que sobrou depois de tirar tudo que se equaliza. Duas equalizações:
   a contrapartida no ano (o item perdeu num ciclo e achou em outro, e o corte já
   tira esses da lista) e a troca entre similares (a peça não sumiu, foi contada no
   código errado). O que resta é ganho ou perda que ninguém explica — é o número
   que vira prejuízo. */
function irDivIndevido(c){
  const pares = irDivParesSimilares().pares;
  const explicado = new Map();
  for(const p of pares){
    explicado.set(p.idSobra, (explicado.get(p.idSobra)||0) + p.valorSobra);
    explicado.set(p.idFalta, (explicado.get(p.idFalta)||0) + p.valorFalta);
  }
  const r = {ganho:0, perda:0, ganhoQtd:0, perdaQtd:0, nGanho:0, nPerda:0,
             nPares:pares.length, valorPares:pares.reduce((s,p)=>s+p.risco,0)};
  for(const i of c.ofensores){
    let troca = 0, trocaQtd = 0;
    for(const d of i.locais) if(explicado.has(d.id)){ troca += explicado.get(d.id); trocaQtd += d.diferenca; }
    const valor = i.netValor - troca;
    const qtd = i.netQtd - trocaQtd;
    if(Math.abs(valor) < 0.005) continue;
    if(valor > 0){ r.ganho += valor; r.ganhoQtd += qtd; r.nGanho++; }
    else { r.perda += valor; r.perdaQtd += qtd; r.nPerda++; }
  }
  return r;
}
const IR_OFE_COLS = [
  {key:'item',        lbl:'Item'},
  {key:'descricao',   lbl:'Descrição'},
  {key:'netValor',    lbl:'Divergência',      num:true},
  {key:'netQtd',      lbl:'NET peças',        num:true},
  {key:'netValorAno', lbl:'NET R$ (ano)',     num:true, ano:true},
  {key:'netQtdAno',   lbl:'NET peças (ano)',  num:true, ano:true},
  {key:'nLocais',     lbl:'Locais',           num:true},
  {key:'situacao',    lbl:'Situação'}
];
function irRenderDivTabela(c){
  const sel = IR.divSelecionados || new Set();
  // Chips de sentido, multi-seleção: perda, ganho e compensado entram e saem da
  // lista sem mexer no cálculo — o corte e a base continuam os mesmos.
  const on = new Set(IR.divSentidos || ['perda','ganho']);
  const lista = c.itens.filter(i=>{
    if(!i.relevante) return false;
    if(i.compensado) return on.has('compensado');
    return on.has(i.sentido);
  });
  const o = IR.divOrdem || {col:'netValor', dir:'desc'};
  const seta = k => o.col===k ? (o.dir==='desc'?' ▾':' ▴') : '';
  const num = (v, fmt) => `<td class="mono ${v<0?'neg':(v>0?'pos':'')}">${v>0?'+':''}${fmt(v)}</td>`;
  const linha = i=>{
    const aberto = IR.divExpandido===i.item;
    // Item sem preço nem na 410 nem na 278: componente de kit que não valora.
    // Ele diverge em peça, mas não em dinheiro — e o selo diz isso.
    const semPreco = i.origens && i.origens.size===1 && i.origens.has('zero');
    const tag = semPreco
      ? '<span class="ofe-tag comp">não valora</span>'
      : i.compensado
      ? '<span class="ofe-tag comp">compensado</span>'
      : `<span class="ofe-tag ${i.netValor<0?'perda':'ganho'}">${i.netValor<0?'perda':'ganho'}</span>`;
    let html = `<tr class="${sel.has(i.item)?'sel':''} ${i.compensado?'comp':''}">
      <td><input type="checkbox" ${sel.has(i.item)?'checked':''} onchange="irDivToggleItem('${irEsc(i.item)}')"></td>
      <td class="mono">${irEsc(i.item)}</td>
      <td title="${irEsc(i.descricao||'')}">${irEsc(irResumirDescricao(i.descricao))}</td>
      ${num(i.netValor, irFmtMoney)}
      ${num(i.netQtd, irFmtInt)}
      <td class="mono ofe-ano ${i.netValorAno<0?'neg':(i.netValorAno>0?'pos':'')}">${i.netValorAno>0?'+':''}${irFmtMoney(i.netValorAno)}</td>
      <td class="mono ofe-ano ${i.netQtdAno<0?'neg':(i.netQtdAno>0?'pos':'')}">${i.netQtdAno>0?'+':''}${irFmtInt(i.netQtdAno)}</td>
      <td class="mono"><button class="btn-link" onclick="irDivExpandir('${irEsc(i.item)}')">${irFmtInt(i.nLocais)} ${aberto?'▾':'▸'}</button></td>
      <td>${tag}</td>
      <td><button class="btn-link" onclick="irDivExportarItem('${irEsc(i.item)}')">Excel</button></td>
    </tr>`;
    if(aberto){
      // O ANO inteiro, não só o período: a contrapartida quase sempre está num dia
      // fora do filtro, e sem ela não dá pra dizer se a divergência é real.
      const locais = irDivLinhasDoAno(i.item);
      html += `<tr class="ofe-detalhe"><td></td><td colspan="9">
        <table class="ofe-sub"><thead><tr>
          <th>Local</th><th>Descrição do Local</th><th>Dia</th><th>Motivo</th><th>Sistema</th><th>Físico</th><th>Diferença</th><th>Valor</th><th>Preço unit.</th>
        </tr></thead><tbody>${locais.map(d=>{
          const l = {descricao: irDescLocal(d.local)};
          return `<tr class="${d.foraDoPeriodo?'ofe-fora':''}">
            <td class="mono">${irEsc(d.local)}</td>
            <td>${irEsc(l.descricao||'—')}</td>
            <td class="mono">${irFmtDate(irDivDiaDa(d))}</td>
            <td class="mono">${irEsc(d.motivo||'')}</td>
            <td class="mono">${irFmtInt(d.qtdeSistema)}</td>
            <td class="mono">${irFmtInt(d.qtdeFisica)}</td>
            <td class="mono ${d.diferenca<0?'neg':'pos'}">${d.diferenca>0?'+':''}${irFmtInt(d.diferenca)}</td>
            <td class="mono ${d.vlDivergencia<0?'neg':'pos'}">${d.vlDivergencia>0?'+':''}${irFmtMoney(d.vlDivergencia)}</td>
            <td class="mono">${irFmtMoney(d.precoUsado||0)}<span class="sim-desc">${irEsc(d.precoOrigem||'')}</span></td>
          </tr>`;
        }).join('')}</tbody></table>
      </td></tr>`;
    }
    return html;
  };
  const chip = (k, lbl, n, cls) => `<button class="conc-chip ${cls||''} ${on.has(k)?'on':''}" onclick="irDivToggleSentido('${k}')">${irEsc(lbl)} <b>${irFmtInt(n)}</b></button>`;
  return `<div class="panel">
    <div class="ofe-head">
      <h3>Divergências</h3>
      <div class="ofe-acoes">
        ${sel.size?`<button class="btn-link" onclick="irDivLimparSelecao()">Limpar (${sel.size})</button>`:''}
        <button class="btn btn-secondary" onclick="irDivMarcarTodos()">Marcar todos</button>
        <button class="btn btn-primary" onclick="irDivGerarAuditoria()">Gerar auditoria (${sel.size})</button>
      </div>
    </div>
    <div class="conc-chips">
      ${chip('perda','Perdas', c.perdas.length, 'perda')}
      ${chip('ganho','Ganhos', c.ganhos.length, 'ganho')}
      ${chip('compensado','Compensados', c.compensados.length)}
    </div>
    ${lista.length ? `<div class="table-wrap"><div class="table-scroll" style="max-height:620px;">
      <table class="ofe-table">
        <thead><tr>
          <th></th>
          ${IR_OFE_COLS.map(col=>`<th class="${col.num?'num':''} ${col.ano?'ofe-ano':''}" onclick="irDivOrdenar('${col.key}')">${irEsc(col.lbl)}${seta(col.key)}</th>`).join('')}
          <th></th>
        </tr></thead>
        <tbody>${lista.map(linha).join('')}</tbody>
      </table>
    </div></div>` : `<p class="field-hint">${
      'Nenhum item acima de '+c.base.fmt(c.corte)+' em '+c.base.lbl+' neste período.'}</p>`}
  </div>`;
}
function irRenderDivAuditoria(){
  const g = IR.divAuditoria;
  if(!g) return '';
  const sim = g.tipo==='similares';
  return `<div class="panel aud-panel">
    <div class="ofe-head">
      <h3>${sim?'Auditoria de troca entre similares':'Auditoria de validação'}</h3>
      <div class="ofe-acoes">
        <button class="btn-link" onclick="irDivFecharAuditoria()">Voltar às divergências</button>
        <button class="btn btn-secondary" onclick="irDivExportarAuditoria()">Excel</button>
        <button class="btn btn-primary" onclick="irDivImprimirAuditoria()">Imprimir</button>
      </div>
    </div>
    <div class="aud-cab">
      <div class="ofe-filtro"><label>Data</label><input type="date" id="ir-aud-data" value="${new Date().toISOString().slice(0,10)}"></div>
      <label class="ofe-check"><input type="checkbox" ${IR.audIgnorarVirtuais!==false?'checked':''} onchange="irAudToggleVirtuais()">
        Ocultar ${irEsc(irAudPrefixos('virtual').join(', '))}</label>
      ${g.semFicha ? `<span class="aud-alerta">Sem a QRY0390 importada: a folha sai sem EAN e sem saldo por endereço. Importe o estoque na aba Importação.</span>` : ''}
      <span class="field-hint">${sim
        ? `${irFmtInt(g.itens)} ${g.itens===1?'par':'pares'} · ${irEsc(g.escopo)}`
        : `${irFmtInt(g.itens)} ${g.itens===1?'item':'itens'} · ${irFmtInt(g.linhas.length)} ${g.linhas.length===1?'local':'locais'} · ${irEsc(g.escopo)}${g.semEstoque?` · ${irFmtInt(g.semEstoque)} sem saldo no CD, apontados pro local do ajuste`:''}${g.ocultosVirtuais?` · ${irFmtInt(g.ocultosVirtuais)} só em endereço virtual`:''}`}</span>
    </div>
    <div class="table-wrap"><div class="table-scroll" style="max-height:520px;">
      <table class="aud-table ${sim?'aud-t-sim':'aud-t-item'}">
        ${sim ? `<thead><tr><th>Dia</th><th>Local</th><th>Desc. Local</th><th>Inv.</th>
          <th>Sobrou</th><th>Descrição</th><th>Faltou</th><th>Descrição</th>
          <th class="num">Qtde</th><th class="num">Desequil.</th><th>Onde conferir</th><th>Confere</th></tr></thead>
        <tbody>${g.linhas.map(l=>`<tr>
          <td class="mono">${irFmtDate(l.dia)}</td>
          <td class="mono">${irEsc(l.local)}</td>
          <td>${irEsc(l.descricaoLocal||'')}</td>
          <td class="mono">${irEsc(l.inventario||'')}</td>
          <td class="mono">${irEsc(l.itemSobra)}</td>
          <td class="aud-desc">${irEsc(l.nomeSobra)}</td>
          <td class="mono">${irEsc(l.itemFalta)}</td>
          <td class="aud-desc">${irEsc(l.nomeFalta)}</td>
          <td class="mono">${irFmtInt(l.qtd)}</td>
          <td class="mono ${l.desequilibrio<0?'neg':'pos'}">${Math.abs(l.desequilibrio)<0.005?'':(l.desequilibrio>0?'+':'')+irFmtMoney(l.desequilibrio)}</td>
          <td class="aud-ult">${irEsc(l.ondeConferir||'')}${l.correcao?`<span class="sim-desc">${irEsc(l.correcao)}</span>`:''}</td>
          <td class="aud-vazio"></td>
        </tr>`).join('')}</tbody>` : `<thead><tr><th>Item</th><th>EAN</th><th>Descrição</th><th>Local</th><th>Desc. Local</th>
          <th class="num">Qtde</th><th class="num">Qtde Div.</th><th class="num">Valor Div.</th>
          <th>Últ. divergência</th><th>Contagem</th></tr></thead>
        <tbody>${g.linhas.map(l=>`<tr>
          <td class="mono">${irEsc(l.item)}</td>
          <td class="mono">${irEsc(l.ean||'')}</td>
          <td class="aud-desc">${irEsc(l.descricao||'')}</td>
          <td class="mono">${irEsc(l.local||'')}</td>
          <td>${irEsc(l.descricaoLocal||'')}</td>
          <td class="mono">${l.saldo!=null?irFmtInt(l.saldo):''}</td>
          <td class="mono ${l.diferenca<0?'neg':'pos'}">${l.diferenca>0?'+':''}${irFmtInt(l.diferenca)}</td>
          <td class="mono ${l.valor<0?'neg':'pos'}">${l.valor>0?'+':''}${irFmtMoney(l.valor)}</td>
          <td class="aud-ult">${irEsc(l.ultimaDiv||'')}</td>
          <td class="aud-vazio"></td>
        </tr>`).join('')}</tbody>`}
      </table>
    </div></div>
  </div>`;
}
/* Painel de troca entre similares. Fica abaixo da tabela de ofensores: é outro
   tipo de erro — não é perda, é contagem trocada — e pede outra ação. */
function irRenderDivSimilares(){
  const f = IR.divSimFiltro || {de:'', ate:''};
  const {pares, diag} = irDivParesSimilares();
  const risco = pares.reduce((s,p)=>s+p.risco,0);
  const desiq = pares.reduce((s,p)=>s+Math.abs(p.desequilibrio),0);
  const ontem = new Date(Date.now()-86400000).toISOString().slice(0,10);
  const oSim = IR.divSimOrdem || {col:'dia', dir:'desc'};
  const pl = (n, um, muitos) => n===1 ? um : muitos;
  const setaSim = k => oSim.col===k ? (oSim.dir==='desc'?' ▾':' ▴') : '';
  const filtros = `<div class="sim-filtros">
    <div class="ofe-filtro"><label>De</label><input type="date" value="${irEsc(f.de)}" onchange="irDivSimSetFiltro('de', this.value)"></div>
    <div class="ofe-filtro"><label>Até</label><input type="date" value="${irEsc(f.ate)}" onchange="irDivSimSetFiltro('ate', this.value)"></div>
    <button class="btn btn-secondary" onclick="irDivSimSetFiltro('de','${ontem}');irDivSimSetFiltro('ate','${ontem}')">Ontem</button>
    <label class="ofe-check"><input type="checkbox" ${IR.divSimExigeDesc!==false?'checked':''} onchange="irDivSimToggleDesc()"> Exigir descrição parecida</label>
    ${(f.de||f.ate)?`<button class="btn-link" onclick="irDivSimLimpar()">Limpar</button>`:''}
  </div>`;
  return `<div class="panel">
    <div class="ofe-head">
      <h3>Itens similares trocados</h3>
      <div class="ofe-acoes">
        <span class="field-hint">${irFmtInt(pares.length)} ${pares.length===1?'par':'pares'} · ${irFmtMoney(risco)} em jogo · ${irFmtMoney(desiq)} de desequilíbrio</span>
        <button class="btn btn-secondary" onclick="irDivExportarSimilares()">Excel</button>
        <button class="btn btn-primary" onclick="irDivGerarAuditoriaSimilares()">Gerar auditoria</button>
      </div>
    </div>
    ${filtros}
    ${pares.length ? `<div class="table-wrap"><div class="table-scroll" style="max-height:460px;">
      <table class="sim-table">
        <thead><tr>
          ${IR_SIM_COLS.map(col=>`<th class="${col.num?'num':''}" onclick="irDivSimOrdenar('${col.key}')">${irEsc(col.lbl)}${setaSim(col.key)}</th>`).join('')}
        </tr></thead>
        <tbody>${irDivSimOrdenarPares(pares).map(p=>`<tr>
          <td class="mono">${irFmtDate(p.dia)}</td>
          <td class="mono">${irEsc(p.local)}</td>
          <td class="mono">${irEsc(p.inventario||'—')}</td>
          <td class="mono">${irFmtInt(p.qtd)}</td>
          <td><span class="mono">${irEsc(p.itemSobra)}</span><span class="sim-desc" title="${irEsc(p.nomeSobra||'')}">${irEsc(irResumirDescricao(p.nomeSobra))}</span></td>
          <td><span class="mono">${irEsc(p.itemFalta)}</span><span class="sim-desc" title="${irEsc(p.nomeFalta||'')}">${irEsc(irResumirDescricao(p.nomeFalta))}</span></td>
          <td class="mono">${irFmtPct(p.semelhanca)}<span class="sim-desc">${irFmtInt(p.prefixo)} palavras iguais no início${p.vizinhos?' · código vizinho':''}</span></td>
          <td class="mono ${Math.abs(p.desequilibrio)<0.01?'':(p.desequilibrio<0?'neg':'pos')}">${Math.abs(p.desequilibrio)<0.01?'—':(p.desequilibrio>0?'+':'')+irFmtMoney(p.desequilibrio)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div></div>` : `<div class="sim-diag">
      <p class="field-hint">Nenhum par com assinatura de troca${(f.de||f.ate)?' no período filtrado':''}. Onde a busca parou:</p>
      <ul class="sim-funil">
        <li><b>${irFmtInt(diag.divs)}</b> ${pl(diag.divs,'divergência','divergências')} no filtro${diag.semDia?` <span class="field-hint">(${irFmtInt(diag.semDia)} sem dia de fechamento — reprocesse o ciclo)</span>`:''}</li>
        <li><b>${irFmtInt(diag.visitas)}</b> ${pl(diag.visitas,'visita','visitas')} (local + inventário)</li>
        <li><b>${irFmtInt(diag.visitasComOsDois)}</b> com sobra <i>e</i> falta na mesma visita</li>
        <li><b>${irFmtInt(diag.qtdEspelhada)}</b> ${pl(diag.qtdEspelhada,'par','pares')} em que um sobra exatamente o que o outro falta</li>
        <li><b>${irFmtInt(diag.reprovadosPelaDescricao)}</b> ${diag.reprovadosPelaDescricao===1?'reprovado':'reprovados'} por descrição diferente</li>
      </ul>
    </div>`}
  </div>`;
}
/* Auditoria da troca: o auditor vai ao endereço e confere os DOIS códigos de uma
   vez. Não usa a QRY0390 — o par já diz onde olhar, e o que interessa é confirmar
   qual etiqueta está em qual peça. */
async function irDivGerarAuditoriaSimilares(){
  const {pares} = irDivParesSimilares();
  if(!pares.length){ irShowToast('Nenhum par de similares no filtro.', true); return; }
  try{
    await irCarregarDescLocaisTodosCiclos();
    await irCarregarItemInfo();
    /* O par sai do endereço onde a contagem bateu, e às vezes esse endereço é de
       correção — não adianta mandar o auditor pra lá. "Onde conferir" traz as
       posições em que os dois códigos têm saldo hoje, que é onde as etiquetas
       podem estar trocadas de verdade. */
    const ondeConferir = p => {
      const pos = [];
      for(const it of [p.itemSobra, p.itemFalta]){
        const info = irItemInfo(it);
        for(const l of ((info && info.locais) || [])){
          if(irAudEhCorrecao(l.local, l.desc)) continue;
          if(IR.audIgnorarVirtuais!==false && irAudEhVirtual(l.local, l.desc)) continue;
          pos.push(l.local + (l.desc ? ' · '+l.desc : ''));
          if(pos.length>=4) break;
        }
      }
      return Array.from(new Set(pos)).join(' | ');
    };
    IR.divAuditoria = {
      tipo:'similares',
      geradoEm: new Date().toLocaleString('pt-BR'),
      escopo: irDivSimEscopoLabel(),
      itens: pares.length,
      linhas: irDivSimOrdenarPares(pares).map(p=>({
        dia:p.dia, local:p.local, descricaoLocal:irDescLocal(p.local), inventario:p.inventario,
        itemSobra:p.itemSobra, nomeSobra:p.nomeSobra||'', itemFalta:p.itemFalta, nomeFalta:p.nomeFalta||'',
        qtd:p.qtd, desequilibrio:p.desequilibrio,
        correcao: irAudEhCorrecao(p.local) ? 'endereço de correção' : '',
        ondeConferir: ondeConferir(p)
      }))
    };
    irRenderView();
    const el = document.querySelector('.aud-panel');
    if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
  }catch(err){
    irShowToast('Falha ao gerar auditoria: '+(err && err.message || err), true);
  }
}
function irDivSimEscopoLabel(){
  const f = IR.divSimFiltro || {};
  if(f.de && f.ate) return irFmtDate(f.de)+' a '+irFmtDate(f.ate);
  if(f.de) return 'de '+irFmtDate(f.de);
  if(f.ate) return 'até '+irFmtDate(f.ate);
  return 'todo o período carregado';
}
function irDivExportarSimilares(){
  const {pares} = irDivParesSimilares();
  if(!pares.length){ irShowToast('Nada para exportar.', true); return; }
  const cab = ['Dia','Local','Inventário','Qtde Trocada','Item que Sobrou','Descrição (sobrou)',
    'Item que Faltou','Descrição (faltou)','Valor Sobra','Valor Falta','Desequilíbrio','Semelhança','Palavras Iguais no Início','Código Vizinho'];
  const linhas = pares.map(p=>[p.dia, p.local, p.inventario, p.qtd, p.itemSobra, p.nomeSobra||'',
    p.itemFalta, p.nomeFalta||'', p.valorSobra, p.valorFalta, p.desequilibrio,
    Math.round(p.semelhanca*100)/100, p.prefixo, p.vizinhos?'SIM':'']);
  const f = IR.divSimFiltro || {};
  const sufixo = (f.de||f.ate) ? (f.de||'inicio')+'_a_'+(f.ate||'hoje') : 'todos';
  irDivBaixarPlanilha(cab, linhas, 'similares_trocados_'+sufixo);
}
/* Endereços que não servem de destino de auditoria.

   CORREÇÃO (AIR, AIN, AEE, REC ...): não é onde a peça está, é onde o ajuste foi
   lançado. Apontar o auditor pra lá é mandá-lo conferir o próprio lançamento.

   VIRTUAL (DS, GAI): endereço de passagem, guarda o que vai entrar e sair. O saldo
   ali é real mas não é conferível como prateleira.

   As duas listas são editáveis e o filtro pode ser desligado inteiro — tem dia em
   que é justamente no transitório que se quer olhar. */
const IR_AUD_PREF_CORRECAO_PADRAO = ['AIR','AIN','AEE','REC','INS','ARI'];
const IR_AUD_PREF_VIRTUAL_PADRAO  = ['DS','GAI'];
function irAudPrefixos(tipo){
  const salvo = IR.audPrefixos && IR.audPrefixos[tipo];
  return salvo || (tipo==='correcao' ? IR_AUD_PREF_CORRECAO_PADRAO : IR_AUD_PREF_VIRTUAL_PADRAO);
}
// Prefixo do endereço = primeira palavra da descrição (AIR LOG 001 00 -> AIR).
// Quando não há descrição, não dá pra classificar e o endereço passa.
function irAudPrefixoDe(local, desc){
  const d = String(desc || irDescLocal(local) || '').trim();
  return d ? d.split(/\s+/)[0].toUpperCase() : '';
}
function irAudEhCorrecao(local, desc){ return irAudPrefixos('correcao').includes(irAudPrefixoDe(local, desc)); }
function irAudEhVirtual(local, desc){ return irAudPrefixos('virtual').includes(irAudPrefixoDe(local, desc)); }
async function irAudToggleVirtuais(){
  IR.audIgnorarVirtuais = IR.audIgnorarVirtuais===false;
  await irSetConfig('auditoria-ignorar-virtuais', IR.audIgnorarVirtuais);
  irShowToast(IR.audIgnorarVirtuais ? 'Endereços virtuais ocultos.' : 'Endereços virtuais visíveis.');
  irRenderView();
}
function irDivFecharAuditoria(){ IR.divAuditoria = null; irRenderView(); }
function irRenderDivergencias(){
  if(!IR.divergencias.length) return irEmptyState('Sem divergências carregadas', 'Processe o ciclo na Importação.', "irSwitchTab('importacao')", 'Ir para Importação');
  if(!irDivEscopoPronto()){
    // Uma carga por vez: o placeholder rerenderiza, e sem a trava ele dispararia
    // uma nova leitura a cada passada.
    if(!IR._divCarregando){
      IR._divCarregando = true;
      irCarregarDivEscopo().finally(()=>{ IR._divCarregando = false; irRenderView(); });
    }
    return irRenderDivFiltros() + irDivCarregando();
  }
  // Gerada a auditoria, ela toma a tela: é a folha que o auditor vai imprimir, e
  // deixar as divergências embaixo só fazia rolar página até achar.
  if(IR.divAuditoria) return irRenderDivAuditoria();
  const c = irDivCalcItens();
  return `
    ${irRenderDivFiltros()}
    ${irRenderDivResumo(c)}
    ${irRenderDivTabela(c)}
    ${irRenderDivSimilares()}
  `;
}
// Locais pendentes de CONTAGEM no ciclo VIGENTE — cruza a Base Congelada com a
// QRY0843: se existe qualquer linha do local com Situação Local e Situação Inventário
// = Liquidado, o local foi contado (entrou em campo, teve rodada liquidada), mesmo que
// ainda não tenha convergido (rodadas ainda divergindo). "Pendente" aqui é só quem não
// tem NENHUMA linha liquidada — quem ninguém foi contar ainda. Não confundir com
// "concluído" (usado na Acurácia), que exige convergência das rodadas, não só contagem.
// rua (opcional) filtra pela coluna X1 da base congelada, usado pelo botão por
// setor em "Resumo por Setor" — ordenado por DESCRIÇÃO do local, não pelo código.
/* Pendentes de uma linha das tabelas por rua/log: orçados menos contados, da
   PRÓPRIA linha.

   Antes esse número era contado ao vivo, varrendo a base congelada do ciclo em
   memória (IR.locais). Dá no mesmo enquanto ela está carregada — contado é o
   local com rodada física, pendente é o resto —, mas quando ela não está, a
   varredura não acha nada e a coluna inteira exibe zero. Zero é uma resposta
   plausível, então ninguém desconfia: a tabela mostrava "122 orçados, 2
   contados, 0 pendentes" na mesma linha.

   Pela subtração o número nasce das duas colunas ao lado, não pode contradizê-las
   e não depende de nada estar carregado. A varredura continua viva só onde ela é
   de fato necessária: a exportação, que lista endereço por endereço. */
function irPendentesDaLinha(r){
  return Math.max(0, (r.locaisOrcados||0) - (r.locaisContados||0));
}
function irLocaisPendentesContagem(rua){
  // Usa IR.contagens, não IR.divergencias — local confirmado VAZIO (Liquidado, sem
  // nenhum item) é um local válido e contado, mas não gera nenhuma linha em
  // divergencias (o loop que monta divergencias pula linha sem item). Usar só
  // divergencias marcava esses locais como "pendente" por engano, mesmo já contados.
  // Só rodada FÍSICA (idConferencia >= 2) conta como "local contado". A rodada 1 é o
  // congelamento automático do sistema na abertura do inventário — local que só tem
  // rodada 1 foi aberto e liquidado sem ninguém contar, então continua pendente.
  return irLocaisPendentesPor('x1', rua);
}
/* Mesma regra de pendente, recortando por qualquer campo da base congelada —
   'x1' pro Resumo por Setor, 'grupoClasse' pra Acurácia por Log. */
function irLocaisContadosSet(){
  // Memoizado por ciclo: montar esse Set varre TODAS as contagens do ciclo (milhões
  // de linhas na base real) e ele era remontado uma vez por rua e por log, a cada
  // render do Dashboard.
  const cicloId = (IR.cicloAtivo||{}).id;
  if(IR._contadosSet && IR._contadosSetCiclo===cicloId && IR._contadosSetN===(IR.contagens||[]).length) return IR._contadosSet;
  /* Só contagem liquidada e de ajuste AIR fecha local. Liquidada porque contagem em
     aberto ainda pode virar cancelada; AIR porque o indicador de contados/pendentes
     é do ciclo rotativo — local visitado só por uma auditoria (ADE) continua
     pendente pro ciclo, e sem esse recorte a lista de pendentes contradizia a
     coluna da tabela, que já sai do recorte AIR. */
  IR._contadosSet = new Set((IR.contagens||[])
    .filter(c=>c.idConferencia>=2 && c.liquidada!==false && String(c.motivo||'').trim().toUpperCase()==='AIR')
    .map(c=>c.local));
  IR._contadosSetCiclo = cicloId;
  IR._contadosSetN = (IR.contagens||[]).length;
  return IR._contadosSet;
}
function irLocaisPendentesPor(campo, valor){
  const contadosSet = irLocaisContadosSet();
  let base = (IR.locais||[]).filter(l=>!contadosSet.has(l.idLocal));
  if(valor) base = base.filter(l=>l[campo]===valor);
  return base.sort((a,b)=>String(a.descricao||'').localeCompare(String(b.descricao||''), undefined, {numeric:true}));
}
/* Seleção por linha no Resumo por Setor: quem cobra a contagem cobra rua por rua,
   e baixar o CD inteiro pra filtrar no Excel depois é trabalho jogado fora. */
function irPendRuasMarcadas(){
  return Array.from(document.querySelectorAll('.pend-chk:checked')).map(c=>c.value);
}
function irPendAtualizarBotao(){
  const btn = document.getElementById('irPendBtn');
  if(!btn) return;
  const n = Array.from(document.querySelectorAll('.pend-chk:checked'))
    .reduce((s,c)=>s + (parseInt(c.dataset.pend,10)||0), 0);
  const todas = document.querySelectorAll('.pend-chk').length;
  const marcadas = document.querySelectorAll('.pend-chk:checked').length;
  btn.textContent = '📤 Baixar locais pendentes ('+irFmtInt(n)+')'
    + (marcadas && marcadas<todas ? ' · '+marcadas+' de '+todas+' ruas' : '');
  btn.disabled = n === 0;
}
function irPendMarcarTodas(marcar){
  document.querySelectorAll('.pend-chk').forEach(c=>{ c.checked = !!marcar; });
  const cab = document.querySelector('thead .pend-col input');
  if(cab) cab.checked = !!marcar;
  irPendAtualizarBotao();
}
function irExportarLocaisPendentesCsv(rua){
  if(!IR.cicloAtivo){ irShowToast('Nenhum ciclo ativo.', true); return; }
  // Sem argumento, exporta o que estiver marcado na tabela; com argumento, só
  // aquela rua (usado por quem chama a função direto).
  const ruas = rua ? [rua] : irPendRuasMarcadas();
  const filtro = ruas.length ? new Set(ruas) : null;
  const pendentes = irLocaisPendentesContagem()
    .filter(l => !filtro || filtro.has(l.x1));
  if(!pendentes.length){
    // Distingue "não há pendente" de "não dá pra listar": o segundo caso tem
    // pendente na tela e some sem explicação se o aviso for o mesmo.
    irShowToast(irLocaisPendentesContagem().length===0
      ? 'A base congelada deste ciclo não está salva — reprocesse o ciclo na Importação para baixar a lista.'
      : 'Nenhum local pendente nas ruas marcadas.', true);
    return;
  }
  const header = 'Rua;Local;Descrição';
  const lines = pendentes.map(l=>{
    const desc = '"'+String(l.descricao||'').replace(/"/g,'""')+'"';
    return (l.x1||'')+';'+l.idLocal+';'+desc;
  });
  const csv = '﻿'+header+'\n'+lines.join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'locais_pendentes_ciclo_'+IR.cicloAtivo.numero
    + (ruas.length===1 ? '_'+ruas[0] : '') + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============================================================
   HISTÓRICO
   ============================================================ */
/* ============================================================
   COMPARATIVO ENTRE CICLOS
   ============================================================ */
function irRenderComparativo(){
  if(IR.ciclos.length<2) return irEmptyState('Precisa de ao menos 2 ciclos', 'Processe outro ciclo para poder comparar.', "irSwitchTab('importacao')", 'Ir para Importação');
  const opts = IR.ciclos.map(c=>`<option value="${c.id}">${irCicloLabel(c)}</option>`).join('');
  return `
    <div class="filter-bar">
      <select id="ir-cmp-a" onchange="irSetComparar('A', this.value)">${opts}</select>
      <span>vs.</span>
      <select id="ir-cmp-b" onchange="irSetComparar('B', this.value)">${opts}</select>
      <button class="btn btn-primary" onclick="irRenderComparativoResultado()">Comparar</button>
    </div>
    <div id="ir-cmp-result"></div>
  `;
}
function irSetComparar(which, id){ if(which==='A') IR.compararA=id; else IR.compararB=id; }
async function irRenderComparativoResultado(){
  const idA = IR.compararA || document.getElementById('ir-cmp-a').value;
  const idB = IR.compararB || document.getElementById('ir-cmp-b').value;
  const ciA = IR.ciclos.find(c=>c.id===idA), ciB = IR.ciclos.find(c=>c.id===idB);
  const indA = await irGetIndicadores(idA), indB = await irGetIndicadores(idB);
  const el = document.getElementById('ir-cmp-result');
  if(!indA || !indB){ el.innerHTML = '<p class="field-hint">Indicadores não encontrados para um dos ciclos.</p>'; return; }
  const linhas = [
    ['Acurácia Peças', irFmtPct(indA.acuraciaPecas), irFmtPct(indB.acuraciaPecas), indB.acuraciaPecas-indA.acuraciaPecas],
    ['Acurácia Local', irFmtPct(indA.acuraciaLocal), irFmtPct(indB.acuraciaLocal), indB.acuraciaLocal-indA.acuraciaLocal],
    ['Acurácia Valor', irFmtPct(indA.acuraciaValor), irFmtPct(indB.acuraciaValor), indB.acuraciaValor-indA.acuraciaValor],
    ['Andamento', irFmtPct(indA.andamentoCiclo), irFmtPct(indB.andamentoCiclo), indB.andamentoCiclo-indA.andamentoCiclo],
    ['Itens Divergentes', irFmtInt(indA.itensDivergentes), irFmtInt(indB.itensDivergentes), indB.itensDivergentes-indA.itensDivergentes],
    ['Valor Divergente (abs.)', irFmtMoney(indA.valorDivergenteAbsoluto), irFmtMoney(indB.valorDivergenteAbsoluto), indB.valorDivergenteAbsoluto-indA.valorDivergenteAbsoluto],
    ['Recontagens', irFmtInt(indA.qtdRecontagens), irFmtInt(indB.qtdRecontagens), indB.qtdRecontagens-indA.qtdRecontagens],
    ['Tempo Médio (min)', irFmtNum(indA.tempoMedioContagemMin,1), irFmtNum(indB.tempoMedioContagemMin,1), indB.tempoMedioContagemMin-indA.tempoMedioContagemMin],
    ['Eficiência', irFmtPct(indA.eficiencia), irFmtPct(indB.eficiencia), indB.eficiencia-indA.eficiencia]
  ];
  // Junta os Logs presentes em qualquer um dos dois ciclos (um ciclo pode não ter
  // contado ainda um Log que o outro já tem) — cada ciclo já vem com seus próprios
  // indicadores isolados por cicloId no IndexedDB, então não há mistura de dados aqui.
  const porLogA = new Map((indA.porLog||[]).filter(r=>r.chave!=='(sem log)').map(r=>[r.chave,r]));
  const porLogB = new Map((indB.porLog||[]).filter(r=>r.chave!=='(sem log)').map(r=>[r.chave,r]));
  const logsChaves = Array.from(new Set([...porLogA.keys(), ...porLogB.keys()])).sort();
  const linhasLog = logsChaves.map(chave=>{
    const rA = porLogA.get(chave), rB = porLogB.get(chave);
    const delta = (rB?rB.acuraciaPecas:null)!==null && (rA?rA.acuraciaPecas:null)!==null && rA && rB ? rB.acuraciaPecas-rA.acuraciaPecas : null;
    return {chave, rA, rB, delta};
  });
  el.innerHTML = `<div class="panel"><h3>${irCicloLabel(ciA)} vs. ${irCicloLabel(ciB)}</h3>
    <div class="table-wrap"><table><thead><tr><th>Indicador</th><th>${irCicloLabel(ciA)}</th><th>${irCicloLabel(ciB)}</th><th>Tendência</th></tr></thead>
    <tbody>${linhas.map(([label,a,b,delta])=>`<tr><td>${label}</td><td class="mono">${a}</td><td class="mono">${b}</td>
      <td><span class="tag ${delta>0?'tag-good':(delta<0?'tag-bad':'tag-muted')}">${delta>0?'▲ melhora':(delta<0?'▼ piora':'= igual')}</span></td></tr>`).join('')}</tbody>
    </table></div>
  </div>
  ${logsChaves.length ? `<div class="panel">
    <h3>Acurácia por Log — ${irCicloLabel(ciA)} vs. ${irCicloLabel(ciB)}</h3>
    <div class="table-wrap"><table><thead><tr>
      <th>Log</th>
      <th>Peças (${irCicloLabel(ciA)})</th><th>Peças (${irCicloLabel(ciB)})</th>
      <th>Locais (${irCicloLabel(ciA)})</th><th>Locais (${irCicloLabel(ciB)})</th>
      <th>Valor (${irCicloLabel(ciA)})</th><th>Valor (${irCicloLabel(ciB)})</th>
      <th>Tendência (Peças)</th>
    </tr></thead>
    <tbody>${linhasLog.map(({chave,rA,rB,delta})=>`<tr>
      <td class="mono">${irEsc(chave)}</td>
      <td class="mono">${rA?irFmtPct(rA.acuraciaPecas):'—'}</td>
      <td class="mono">${rB?irFmtPct(rB.acuraciaPecas):'—'}</td>
      <td class="mono">${rA?irFmtPct(rA.acuraciaPosicoes):'—'}</td>
      <td class="mono">${rB?irFmtPct(rB.acuraciaPosicoes):'—'}</td>
      <td class="mono">${rA?irFmtPct(rA.acuraciaValor):'—'}</td>
      <td class="mono">${rB?irFmtPct(rB.acuraciaValor):'—'}</td>
      <td>${delta===null ? '<span class="tag tag-muted">sem base</span>' : `<span class="tag ${delta>0?'tag-good':(delta<0?'tag-bad':'tag-muted')}">${delta>0?'▲ melhora':(delta<0?'▼ piora':'= igual')}</span>`}</td>
    </tr>`).join('')}</tbody>
    </table></div>
  </div>` : ''}`;
}

/* ============================================================
   INDICADORES (detalhado, com fórmula)
   ============================================================ */
function irRenderIndicadores(){
  const ind = IR.indicadores;
  if(!ind) return irEmptyState('Sem indicadores', 'Processe o ciclo na Importação.', "irSwitchTab('importacao')", 'Ir para Importação');
  const rows = [
    ['Acurácia Peças', irFmtPct(ind.acuraciaPecas), IR_KPI_FORMULAS.acuraciaPecas],
    ['Acurácia Local', irFmtPct(ind.acuraciaLocal), IR_KPI_FORMULAS.acuraciaLocal],
    ['Acurácia Valor', irFmtPct(ind.acuraciaValor), IR_KPI_FORMULAS.acuraciaValor],
    ['Andamento do Ciclo', irFmtPct(ind.andamentoCiclo), IR_KPI_FORMULAS.andamentoCiclo],
    ['Peças Contadas', irFmtInt(ind.pecasContadas), 'Soma do QT_FIS da última contagem de cada item, nos locais liquidados (QRY0843).'],
    ['Itens Contados', irFmtInt(ind.itensContados), 'Nº de pares (local, item) verificados na QRY0843, com valor cruzado da SIGEQ278/ZBIQ0051.'],
    ['Peças Divergentes', irFmtInt(ind.pecasDivergentes), 'Soma de |Diferença| entre rodada final e rodada 1 (sistêmico), derivado da QRY0843.'],
    ['Itens Divergentes', irFmtInt(ind.itensDivergentes), 'Nº de pares (local, item) da QRY0843 com Diferença ≠ 0.'],
    ['Qtd. de Recontagens', irFmtInt(ind.qtdRecontagens), IR_KPI_FORMULAS.qtdRecontagens],
    ['Tempo Médio por Contagem', irFmtNum(ind.tempoMedioContagemMin,1)+' min', IR_KPI_FORMULAS.tempoMedioContagem],
    ['Dias Restantes', ind.diasRestantes===null?'—':irFmtInt(ind.diasRestantes), IR_KPI_FORMULAS.diasRestantes],
    ['Eficiência', irFmtPct(ind.eficiencia), IR_KPI_FORMULAS.eficiencia]
  ];
  return `<div class="panel"><h3>Todos os indicadores</h3>
    <div class="table-wrap"><table><thead><tr><th>Indicador</th><th>Valor</th><th>Fórmula</th></tr></thead>
    <tbody>${rows.map(([l,v,f])=>`<tr><td>${l}</td><td class="mono">${v}</td><td class="field-hint">${irEsc(f)}</td></tr>`).join('')}</tbody>
    </table></div>
  </div>
  ${irRenderComposicaoDivergenciaPanel()}`;
}
/* De onde vêm as peças divergentes, parcela por parcela.

   Quando o número do dashboard não bate com o de outra planilha, a pergunta é
   sempre a mesma: o que um conta que o outro não conta. Responder isso lendo
   código não serve pra quem opera; responder somando linha por linha na mão é
   inviável. Este painel quebra o total em partes que se somam de volta ao total,
   e mede quanto cada regra discutível está pesando — com o número que a acurácia
   teria sem ela. */
const IR_DIV_CONCLUIDO = new Set(['convergido','encerrado_sem_convergencia']);
/* Número do inventário, pra achar a rodada de fechamento — mesma regra do motor. */
function irNumInventario(v){
  const n = parseInt(String(v||'').replace(/\D+/g,''), 10);
  return isNaN(n) ? -1 : n;
}
function irComposicaoDivergencia(){
  const concluidas = (IR.divergencias||[]).filter(d=>IR_DIV_CONCLUIDO.has(d.statusLocal));
  if(!concluidas.length) return null;
  /* A base é a MESMA do KPI: só ajuste AIR e só a rodada de fechamento. Sem isso o
     painel decomporia um total diferente do que está no dashboard — que é
     exatamente o tipo de contradição que ele existe pra resolver. O que ficou de
     fora vira número no rodapé, pra continuar visível. */
  const air = concluidas.filter(d=>String(d.motivo||'').trim().toUpperCase()==='AIR');
  const ultima = new Map();
  for(const d of air){
    const n = irNumInventario(d.inventario);
    if(!ultima.has(d.local) || n > ultima.get(d.local)) ultima.set(d.local, n);
  }
  const divs = air.filter(d=>irNumInventario(d.inventario) === ultima.get(d.local));
  if(!divs.length) return null;
  const absD = d => Math.abs(d.diferenca||0);
  const foraMotivo = concluidas.filter(d=>String(d.motivo||'').trim().toUpperCase()!=='AIR')
    .reduce((s,d)=>s+absD(d),0);
  const foraRodada = air.filter(d=>irNumInventario(d.inventario) !== ultima.get(d.local))
    .reduce((s,d)=>s+absD(d),0);
  const abs = d => Math.abs(d.diferenca||0);
  const total = divs.reduce((s,d)=>s+abs(d),0);
  const contadas = divs.reduce((s,d)=>s+(d.qtdeFisica||0),0);
  const saldo = divs.reduce((s,d)=>s+(d.qtdeSistema||0),0);
  const soma = f => divs.filter(f).reduce((s,d)=>s+abs(d),0);
  const conta = f => divs.filter(f).length;

  // Partes que se somam ao total: cada item cai em exatamente uma.
  const sobraPura  = d => (d.qtdeSistema||0)===0 && (d.qtdeFisica||0)>0;
  const faltaTotal = d => (d.qtdeFisica||0)===0 && (d.qtdeSistema||0)>0;
  const sobraParc  = d => (d.diferenca||0)>0 && !sobraPura(d);
  const faltaParc  = d => (d.diferenca||0)<0 && !faltaTotal(d);
  const partes = [
    ['Sobra pura — item sem linha na Rodada 1 (sistema = 0)', sobraPura],
    ['Falta total — item sumiu na rodada final (física = 0)', faltaTotal],
    ['Sobra parcial — contou mais do que o sistema tinha', sobraParc],
    ['Falta parcial — contou menos do que o sistema tinha', faltaParc]
  ].map(([rot,f])=>({rot, pecas:soma(f), itens:conta(f)}));

  // Regras que outra planilha pode não aplicar. Não se somam entre si (um item
  // pode cair em duas), por isso cada uma é medida sozinha, contra o total.
  const hipoteses = [
    ['Itens que o sistema não tinha no local (sobra pura)', sobraPura],
    ['Locais encerrados sem as rodadas baterem', d=>d.statusLocal==='encerrado_sem_convergencia']
  ].map(([rot,f])=>{
    const pecas = soma(f);
    const saldoFora = divs.filter(f).reduce((s,d)=>s+(d.qtdeSistema||0),0);
    const restoSaldo = saldo - saldoFora;
    return {rot, pecas, itens:conta(f),
      divSem: total - pecas,
      accSem: restoSaldo>0 ? Math.max(0, Math.min(1, 1-(total-pecas)/restoSaldo)) : null};
  });
  return {total, contadas, saldo, itens:divs.length, partes, hipoteses, foraMotivo, foraRodada,
    acuracia: saldo>0 ? Math.max(0, Math.min(1, 1-total/saldo)) : null};
}
function irRenderComposicaoDivergenciaPanel(){
  const c = irComposicaoDivergencia();
  if(!c) return `<div class="panel"><h3>Composição da divergência de peças</h3>
    <p class="field-hint">As divergências linha a linha deste ciclo não estão salvas no navegador — reprocesse o ciclo na Importação para abrir esta análise.</p></div>`;
  const pct = n => c.total>0 ? irFmtPct(n/c.total) : '—';
  return `<div class="panel">
    <h3>Composição da divergência de peças</h3>
    <p class="panel-sub">As ${irFmtInt(c.total)} peças divergentes, quebradas por origem. As quatro primeiras somam o total.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Origem</th><th>Peças</th><th>% do total</th><th>Itens</th></tr></thead>
      <tbody>${c.partes.map(p=>`<tr>
        <td>${irEsc(p.rot)}</td>
        <td class="mono">${irFmtInt(p.pecas)}</td>
        <td class="mono">${pct(p.pecas)}</td>
        <td class="mono">${irFmtInt(p.itens)}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr style="font-weight:700;border-top:2px solid var(--line);">
        <td>TOTAL</td><td class="mono">${irFmtInt(c.total)}</td><td class="mono">100,0%</td><td class="mono">${irFmtInt(c.itens)}</td>
      </tr></tfoot>
    </table></div>
    <p class="panel-sub" style="margin-top:18px;">Quanto cada regra pesa, e o que a acurácia seria sem ela. Aqui as linhas se sobrepõem — um item pode entrar em mais de uma.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Regra</th><th>Peças</th><th>Divergência sem ela</th><th>Acurácia sem ela</th></tr></thead>
      <tbody>${c.hipoteses.map(h=>`<tr>
        <td>${irEsc(h.rot)}</td>
        <td class="mono">${irFmtInt(h.pecas)}</td>
        <td class="mono">${irFmtInt(h.divSem)}</td>
        <td class="mono">${h.accSem==null?'—':irFmtPct(h.accSem)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="field-hint" style="margin-top:10px;">Hoje: ${irFmtInt(c.saldo)} peças de saldo lógico (base da acurácia) · ${irFmtInt(c.contadas)} contadas · ${irFmtInt(c.total)} divergentes · ${c.acuracia==null?'—':irFmtPct(c.acuracia)} de acurácia.${
      (c.foraMotivo||c.foraRodada) ? ' Fora do recorte do ciclo rotativo: '+irFmtInt(c.foraMotivo)+' peças em ajustes que não são AIR e '+irFmtInt(c.foraRodada)+' em rodadas anteriores do mesmo local.' : ''}</p>
  </div>`;
}

/* ============================================================
   CONFIGURAÇÕES
   ============================================================ */
function irRenderConfiguracoes(){
  const p = IR.prioridadeConfig || {valor:0.5, quantidade:0.2, recontagens:0.15, reincidencia:0.15};
  const soma = p.valor+p.quantidade+p.recontagens+p.reincidencia;
  const temaAtivo = localStorage.getItem('ir-app-theme') || 'padrao';
  return `
  <div class="panel">
    <h3>Aparência — Tema visual</h3>
    <p class="field-hint" style="margin-bottom:14px;">Experimente os temas e escolha o que preferir — o modo claro/escuro (botão no rodapé do menu) continua funcionando dentro de qualquer um deles.</p>
    <div class="theme-picker-grid">
      ${IR_APP_THEMES.map(t=>`<button type="button" class="theme-picker-card ${temaAtivo===t.key?'active':''}" onclick="irSetAppTheme('${t.key}')">
        <span class="theme-picker-swatch" style="background:${t.swatch};"></span>
        <span class="theme-picker-label">${irEsc(t.label)}</span>
        ${temaAtivo===t.key ? '<span class="theme-picker-check">✓</span>' : ''}
      </button>`).join('')}
    </div>
  </div>
  <div class="panel">
    <h3>Índice de Prioridade de Auditoria — pesos</h3>
    <p class="field-hint" style="margin-bottom:12px;">A soma deve ficar em 100%. Ajuste e salve para recalcular a prioridade no próximo processamento.</p>
    <div class="two-col">
      <div><label>Valor financeiro (%)</label><input type="number" id="ir-cfg-valor" min="0" max="100" value="${(p.valor*100).toFixed(0)}"></div>
      <div><label>Quantidade divergente (%)</label><input type="number" id="ir-cfg-qtd" min="0" max="100" value="${(p.quantidade*100).toFixed(0)}"></div>
    </div>
    <div class="two-col">
      <div><label>Nº de recontagens (%)</label><input type="number" id="ir-cfg-reconta" min="0" max="100" value="${(p.recontagens*100).toFixed(0)}"></div>
      <div><label>Reincidência histórica (%)</label><input type="number" id="ir-cfg-reinc" min="0" max="100" value="${(p.reincidencia*100).toFixed(0)}"></div>
    </div>
    <p class="field-hint" id="ir-cfg-soma" style="margin-top:8px;">Soma atual: ${(soma*100).toFixed(0)}%</p>
    <div class="form-actions"><button class="btn btn-primary" onclick="irSalvarPrioridadeConfig()">Salvar pesos</button></div>
  </div>
  ${irRenderCiclosConfig()}
  ${irRenderProdMetaConfig()}
  ${irRenderNet410LegendaConfig()}
  ${irRenderNet410IgnoradosConfig()}
  ${irRenderNet410PadroesConfig()}`;
}
/* Ciclos gravados na base, com exclusão. Serve pra tirar um ciclo importado por
   engano — enquanto ele existe, entra nas visões por ano e distorce o NET. */
function irRenderCiclosConfig(){
  const ciclos = (IR.ciclos||[]).slice().sort((a,b)=>String(b.dataAbertura||'').localeCompare(String(a.dataAbertura||'')));
  if(!ciclos.length) return '';
  return `<div class="panel">
    <h3>Ciclos gravados</h3>
    <p class="field-hint" style="margin-bottom:12px;">Excluir remove o ciclo e tudo que depende dele — locais congelados, contagens, divergências, indicadores e estoque. Não tem como desfazer; é preciso importar de novo.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Ciclo</th><th>Abertura</th><th>Término previsto</th><th>Status</th><th></th></tr></thead>
      <tbody>${ciclos.map(c=>`<tr>
        <td><strong>${irEsc(irCicloLabel(c))}</strong>${c.id===(IR.cicloAtivo||{}).id?' <span class="tag tag-orange">ativo</span>':''}</td>
        <td class="mono">${irFmtDate(c.dataAbertura)}</td>
        <td class="mono">${irFmtDate(c.dataPrevistaTermino)}</td>
        <td>${irEsc(c.status||'—')}</td>
        <td>${IR.cicloParaExcluir===c.id
          ? `<button class="btn-link" style="color:var(--danger);font-weight:800;" onclick="irExcluirCicloUI('${irEsc(c.id)}')">Confirmar exclusão</button>
             <button class="btn-link" onclick="irConfirmarExcluirCiclo('${irEsc(c.id)}')">Cancelar</button>`
          : `<button class="btn-link" style="color:var(--danger);" onclick="irConfirmarExcluirCiclo('${irEsc(c.id)}')">Excluir</button>`}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}
/* Confirmação na própria linha, não no confirm() do navegador: o Chrome oferece
   "não permitir que esta página crie mais diálogos" e, depois disso, todo
   confirm() volta falso — o botão parava de funcionar sem dizer nada. */
function irConfirmarExcluirCiclo(cicloId){
  IR.cicloParaExcluir = IR.cicloParaExcluir===cicloId ? null : cicloId;
  irRenderView();
}
async function irExcluirCicloUI(cicloId){
  const c = (IR.ciclos||[]).find(x=>x.id===cicloId);
  if(!c) return;
  IR.cicloParaExcluir = null;
  try{
    await irDeleteCiclo(cicloId);
    IR.ciclos = await irGetAllCiclos();
    IR.divAnoCache = null;
    if((IR.cicloAtivo||{}).id===cicloId){
      IR.cicloAtivo = IR.ciclos[0] || null;
      if(IR.cicloAtivo) await irLoadCicloData(IR.cicloAtivo.id);
      else { IR.divergencias=[]; IR.locais=[]; IR.contagens=[]; IR.indicadores=null; }
      irRenderCycleBadge();
    }
    irShowToast(irCicloLabel(c)+' excluído.');
    irRenderView();
  }catch(err){
    irShowToast('Falha ao excluir: '+(err && err.message || err), true);
  }
}
/* Meta de produtividade usada na aba Produtividade. Enquanto estiver vazia, a aba
   usa a média da própria equipe como referência e diz isso na tela — meta chutada
   valeria menos que nenhuma. */
function irRenderProdMetaConfig(){
  const m = IR.prodMeta || {};
  return `<div class="panel">
    <h3>Meta de produtividade do inventário</h3>
    <p class="field-hint" style="margin-bottom:12px;">Usada nos cards, no ranking e na capacidade da aba Produtividade. Deixe em branco enquanto a operação não definir a meta — a aba passa a usar a média da equipe como referência, sinalizando que não é meta oficial.</p>
    <div class="two-col">
      <div>
        <label>Meta de locais por homem-hora</label>
        <input type="number" id="ir-prod-meta-hh" min="0" step="0.1" value="${m.locaisPorHH>0?m.locaisPorHH:''}" placeholder="ex.: 12">
      </div>
      <div>
        <label>Jornada considerada (horas/dia)</label>
        <input type="number" id="ir-prod-meta-jornada" min="1" max="24" step="0.5" value="${m.horasDia||8}">
      </div>
    </div>
    <div class="form-actions"><button class="btn btn-primary" onclick="irSalvarProdMetaConfig()">Salvar meta</button></div>
  </div>`;
}
async function irSalvarProdMetaConfig(){
  const raw = document.getElementById('ir-prod-meta-hh').value;
  const locaisPorHH = raw==='' ? null : parseFloat(raw);
  const horasDia = parseFloat(document.getElementById('ir-prod-meta-jornada').value) || 8;
  if(locaisPorHH!==null && !(locaisPorHH>0)){ irShowToast('A meta de locais/homem-hora precisa ser maior que zero (ou vazia).', true); return; }
  const cfg = {locaisPorHH, horasDia};
  await irSaveProdMetaConfig(cfg);
  IR.prodMeta = {key:'prod-meta', ...cfg};
  irShowToast(locaisPorHH===null ? 'Meta removida — a aba volta a usar a média da equipe.' : 'Meta salva.');
  irRenderView();
}
// Padrões de Observação WMS (ex.: "SALDO") que escondem qualquer item que os carregue
// da análise "Por que o NET está distorcido" — diferente do ignorado item por item,
// vale pra qualquer item futuro que carregue esse mesmo tipo de ajuste.
function irRenderNet410PadroesConfig(){
  const lista = (IR.net410Padroes||[]).slice().sort((a,b)=>(a.criadoEm||'').localeCompare(b.criadoEm||''));
  const row = (p)=>`<tr>
    <td class="mono">${irEsc(p.padrao)}</td>
    <td class="field-hint">${p.criadoEm ? new Date(p.criadoEm).toLocaleDateString('pt-BR') : '—'}</td>
    <td><button class="btn-link" onclick="irRemoverNet410PadraoUI('${irEsc(p.id)}')">Remover</button></td>
  </tr>`;
  return `<div class="panel">
    <h3>Padrões de Observação ignorados na análise do NET</h3>
    <p class="field-hint" style="margin-bottom:12px;">Qualquer item com esse trecho na Observação WMS de algum movimento fica fora da análise "Por que o NET está distorcido", em qualquer mês — útil pra tipos de ajuste recorrentes (ex.: "SALDO INCLUIDO INDEVIDAMENTE...") que aparecem em itens diferentes com o tempo.</p>
    <div class="form-actions" style="margin-bottom:12px;">
      <input type="text" id="ir-net410-padrao-novo" placeholder="Ex.: SALDO" style="max-width:280px;">
      <button class="btn btn-secondary" onclick="irAdicionarNet410Padrao()">Adicionar padrão</button>
    </div>
    ${lista.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Trecho da Observação</th><th>Adicionado em</th><th></th></tr></thead>
      <tbody>${lista.map(row).join('')}</tbody>
    </table></div>` : `<p class="field-hint">Nenhum padrão cadastrado.</p>`}
  </div>`;
}
// Itens ignorados na análise "Por que o NET está distorcido" — marcados manualmente
// no painel de Divergências quando o motivo já é conhecido. Aqui dá pra ver a lista
// completa e trazer o item de volta pra análise a qualquer momento.
function irRenderNet410IgnoradosConfig(){
  const lista = (IR.net410Ignorados||[]).slice().sort((a,b)=>(a.criadoEm||'').localeCompare(b.criadoEm||''));
  const row = (i)=>`<tr>
    <td class="mono">${irEsc(i.item)}</td>
    <td>${irEsc(i.nome||'—')}</td>
    <td class="field-hint">${i.criadoEm ? new Date(i.criadoEm).toLocaleDateString('pt-BR') : '—'}</td>
    <td><button class="btn-link" onclick="irRestaurarNet410Item('${irEsc(i.item)}')">Restaurar</button></td>
  </tr>`;
  return `<div class="panel">
    <h3>Itens ignorados na análise do NET</h3>
    <p class="field-hint" style="margin-bottom:12px;">Itens marcados como "já sei o motivo" no painel "Por que o NET está distorcido" — ficam fora dos rankings e da cobertura até você restaurar aqui.</p>
    ${lista.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Item</th><th>Descrição</th><th>Ignorado em</th><th></th></tr></thead>
      <tbody>${lista.map(row).join('')}</tbody>
    </table></div>` : `<p class="field-hint">Nenhum item ignorado.</p>`}
  </div>`;
}
async function irRestaurarNet410Item(item){
  await irRemoverNet410Ignorado(item);
  IR.net410Ignorados = await irGetNet410IgnoradosAll();
  irRenderView();
}
// Legenda de motivos da 410 (AIR/ADE/LOJA/...) — editável aqui em vez de fixa no
// código, pra dar conta de motivo novo ou mudança de classificação sem precisar
// mexer em código. "Considera no NET" só vale a partir do próximo processamento da
// QRY410 (é usado durante a importação); o nome/legenda já atualiza na hora nos
// painéis que buscam ao vivo (ex.: "Motivo principal" em Divergências).
function irRenderNet410LegendaConfig(){
  const lista = (IR.net410Legenda||[]).slice().sort((a,b)=>a.id.localeCompare(b.id));
  const row = (l)=>`<tr>
    <td class="mono">${irEsc(l.id)}</td>
    <td><input type="text" value="${irEsc(l.legenda)}" onchange="irSetLegenda410Campo('${irEsc(l.id)}','legenda',this.value)"></td>
    <td style="text-align:center;"><input type="checkbox" ${l.considerarNet?'checked':''} onchange="irSetLegenda410Campo('${irEsc(l.id)}','considerarNet',this.checked)"></td>
    <td><button class="btn-link" onclick="irRemoverLegenda410('${irEsc(l.id)}')">Remover</button></td>
  </tr>`;
  return `<div class="panel">
    <h3>Legenda de motivos da QRY410</h3>
    <p class="field-hint" style="margin-bottom:12px;">Mapeia o código no início da "Observação WMS" (ex.: AIR, ADE, LOJA) pro nome exibido nos painéis de NET, e se esse motivo entra no cálculo do NET. Código não listado aqui conta como "considera no NET" por padrão. "Considera no NET" só vale a partir da próxima vez que reimportar a QRY410.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Código</th><th>Legenda</th><th style="text-align:center;">Considera no NET</th><th></th></tr></thead>
      <tbody>${lista.map(row).join('')}</tbody>
    </table></div>
    <div class="two-col" style="margin-top:14px;">
      <div><label>Novo código</label><input type="text" id="ir-cfg-legenda-id" placeholder="Ex.: XYZ" style="text-transform:uppercase;"></div>
      <div><label>Legenda</label><input type="text" id="ir-cfg-legenda-nome" placeholder="Ex.: Motivo Novo"></div>
    </div>
    <div class="form-actions"><button class="btn btn-secondary" onclick="irAdicionarLegenda410()">Adicionar código</button></div>
  </div>`;
}
async function irSetLegenda410Campo(id, campo, valor){
  const item = (IR.net410Legenda||[]).find(l=>l.id===id);
  if(!item) return;
  item[campo] = valor;
  await irSaveNet410LegendaItem({...item});
  irShowToast('Legenda salva.');
}
async function irRemoverLegenda410(id){
  IR.net410Legenda = (IR.net410Legenda||[]).filter(l=>l.id!==id);
  await irDeleteNet410LegendaItem(id);
  irRenderView();
}
async function irAdicionarLegenda410(){
  const id = document.getElementById('ir-cfg-legenda-id').value.trim().toUpperCase();
  const nome = document.getElementById('ir-cfg-legenda-nome').value.trim();
  if(!id){ irShowToast('Informe o código.', true); return; }
  if((IR.net410Legenda||[]).some(l=>l.id===id)){ irShowToast('Esse código já existe.', true); return; }
  const item = {id, legenda:nome, considerarNet:true};
  IR.net410Legenda = [...(IR.net410Legenda||[]), item];
  await irSaveNet410LegendaItem(item);
  irRenderView();
}
async function irSalvarPrioridadeConfig(){
  const valor = parseFloat(document.getElementById('ir-cfg-valor').value)/100;
  const quantidade = parseFloat(document.getElementById('ir-cfg-qtd').value)/100;
  const recontagens = parseFloat(document.getElementById('ir-cfg-reconta').value)/100;
  const reincidencia = parseFloat(document.getElementById('ir-cfg-reinc').value)/100;
  const soma = valor+quantidade+recontagens+reincidencia;
  if(Math.abs(soma-1)>0.01){ irShowToast('A soma dos pesos precisa ser 100% (atual: '+(soma*100).toFixed(0)+'%).', true); return; }
  const pesos = {valor, quantidade, recontagens, reincidencia};
  await irSavePrioridadeConfig(pesos);
  IR.prioridadeConfig = {key:'pesos', ...pesos};
  irShowToast('Pesos salvos. Serão aplicados no próximo processamento de ciclo.');
}
