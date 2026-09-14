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
  transEmail:null, transEmailAberto:false,
  pastaHandle:null, pastaArquivos:null, pastaUltimo:null, pastaPerm:null,
  pastaProcessando:false, pastaVarridoEm:null, pastaErro:null,
  est390Meta:null, est390Ficha:null, est390Locais:null, transSetores:null, transExpandido:null,
  est160File:null, est160Processing:false, est160Progress:{stage:'', pct:0},
  audIgnorarVirtuais:true, audPrefixos:null, transNomes:null,
  // Perdas e Ganhos (QRY410) — independente do ciclo, por ano.
  net410Anos:[], net410AnoSel:null, net410MesSel:null, net410Data:null, net410File:null,
  net410Processing:false, net410Progress:{stage:'', pct:0},
  divNetMesSel:null, // mês selecionado no painel "Por que o NET está distorcido?" (aba Divergências)
  divNetDiaSel:null, // dia selecionado (opcional) no mesmo painel — "" ou null = mês inteiro
  comparativoCiclos:null, // [{ciclo, ind}] de todos os ciclos já processados, pro gráfico do Dashboard
};

function irEsc(v){ if(v===undefined||v===null) return ''; return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
