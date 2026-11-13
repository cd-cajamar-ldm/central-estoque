/* ============================================================
   Inventário Rotativo — dados compartilhados (Supabase).
   O IndexedDB continua como cópia local; a tabela public.ir_dados guarda a
   versão compartilhada. Só roda na tela principal (os workers de importação
   gravam local; aqui detectamos que terminaram e enviamos). Ver
   supabase-acessos/migrations/005_inventario_dados.sql.

   Regras:
   - Cada "unidade" = um store inteiro (ex.: net410) ou um store de UM ciclo
     (ex.: contagens@2024-05). Ciclos: só os 2 mais recentes são sincronizados.
   - Alteração feita aqui (marcada como "suja") sempre sobe.
   - Se a nuvem tem versão que este navegador ainda não viu, ela vence.
   - Depois de baixar algo novo, avisa pra atualizar a página (não troca os
     dados por baixo da tela).
   ============================================================ */
const IR_NUVEM_TAB = 'ir_dados';
const IR_NUVEM_LIMITE = 600000; // caracteres por parte
const IR_NUVEM_CICLOS_RECENTES = 2;
const IR_NUVEM_LS = 'ir-nuvem-v1';

/* Stores inteiros, de ciclo a ciclo. */
const IR_NUVEM_GLOBAIS = [
  'ciclos','indicadores','import_meta','prioridade_config',
  'net410','net410_legenda','net410_ignorados','net410_padroes_ignorados',
  'estoque_local','item_info','local_info'
];
/* Stores com uma fatia por ciclo (chave "cicloId|..."). */
const IR_NUVEM_POR_CICLO = ['locais_congelados','contagens','divergencias','estoque_item'];

function irNuvemEstado(){
  try { return JSON.parse(localStorage.getItem(IR_NUVEM_LS) || '{}') || {}; } catch(e){ return {}; }
}
function irNuvemGuardar(est){ try { localStorage.setItem(IR_NUVEM_LS, JSON.stringify(est)); } catch(e){} }
/* est = { known:{unidade:{v,imp}}, sujo:{unidade:true} } */
function irNuvemMarcar(unidade){
  const est = irNuvemEstado(); est.sujo = est.sujo || {}; est.sujo[unidade] = true; irNuvemGuardar(est);
  irNuvemAgendar();
}

/* ---------- leitura / escrita local ---------- */
async function irNuvemLerUnidade(unidade){
  const [store, ciclo] = unidade.split('@');
  if(ciclo) return irGetByCiclo(store, ciclo);
  const st = await irTx(store, 'readonly');
  return new Promise((res, rej)=>{ const r = st.getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); });
}
async function irNuvemSubstituirUnidade(unidade, linhas){
  const [store, ciclo] = unidade.split('@');
  if(ciclo){
    await irClearCiclo(store, ciclo);
  } else {
    const st = await irTx(store, 'readwrite');
    await new Promise((res, rej)=>{ const r = st.clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
  }
  if(linhas.length) await irBulkPutTudo(store, linhas);
}
async function irNuvemCiclosRecentes(){
  const ciclos = await irGetAllCiclos(); // já vem do mais novo pro mais antigo
  return ciclos.slice(0, IR_NUVEM_CICLOS_RECENTES).map(c=>c.id);
}
async function irNuvemImpDoCiclo(cicloId){
  try { const m = await irGetImportMeta(cicloId); return m ? String(m.processedAt || '') : ''; } catch(e){ return ''; }
}

/* ---------- nuvem ---------- */
function irNuvemDividir(linhas){
  const partes = []; let atual = []; let tam = 0;
  for(const l of linhas){
    const t = JSON.stringify(l).length;
    if(atual.length && tam + t > IR_NUVEM_LIMITE){ partes.push(atual); atual = []; tam = 0; }
    atual.push(l); tam += t;
  }
  if(atual.length) partes.push(atual);
  return partes;
}
async function irNuvemPublicar(unidade){
  if(window.LDM_SOMENTE_LEITURA) return; // só visualiza: nada sobe
  const linhas = await irNuvemLerUnidade(unidade);
  const partes = irNuvemDividir(linhas);
  const ciclo = unidade.split('@')[1];
  const imp = ciclo ? await irNuvemImpDoCiclo(ciclo) : '';
  const versao = new Date().toISOString() + '-' + Math.random().toString(36).slice(2, 6);
  const tab = irSupa.from(IR_NUVEM_TAB);
  for(let i = 0; i < partes.length; i++){
    const { error } = await tab.insert({chave: unidade, versao, parte: i + 1, dados: partes[i]});
    if(error) throw error;
  }
  const { error: errCab } = await tab.insert({chave: unidade, versao, parte: 0, dados: {partes: partes.length, imp}});
  if(errCab) throw errCab;
  await irSupa.from(IR_NUVEM_TAB).delete().eq('chave', unidade).neq('versao', versao);
  const est = irNuvemEstado(); est.known = est.known || {}; est.sujo = est.sujo || {};
  est.known[unidade] = {v: versao, imp}; delete est.sujo[unidade];
  irNuvemGuardar(est);
}
async function irNuvemBaixar(unidade, cab){
  const total = (cab.dados && cab.dados.partes) || 0;
  let linhas = [];
  if(total){
    const { data, error } = await irSupa.from(IR_NUVEM_TAB).select('parte,dados')
      .eq('chave', unidade).eq('versao', cab.versao).gt('parte', 0).order('parte');
    if(error) throw error;
    if(!data || data.length !== total) throw new Error('Versão em atualização, tente de novo em instantes.');
    data.forEach(p=>{ linhas = linhas.concat(p.dados); });
  }
  await irNuvemSubstituirUnidade(unidade, linhas);
  const est = irNuvemEstado(); est.known = est.known || {}; est.sujo = est.sujo || {};
  est.known[unidade] = {v: cab.versao, imp: (cab.dados && cab.dados.imp) || ''};
  delete est.sujo[unidade];
  irNuvemGuardar(est);
}
async function irNuvemCabecalhos(){
  const { data, error } = await irSupa.from(IR_NUVEM_TAB).select('chave,versao,dados').eq('parte', 0);
  if(error) throw error;
  const por = {};
  (data || []).forEach(r=>{ if(!por[r.chave] || r.versao > por[r.chave].versao) por[r.chave] = r; });
  return por;
}

/* ---------- sincronização ---------- */
let _irNuvemOcupada = false;
let _irNuvemTimer = null;
function irNuvemAgendar(){
  clearTimeout(_irNuvemTimer);
  _irNuvemTimer = setTimeout(()=>irNuvemSincronizar(false), 3000);
}
/* Devolve true se baixou algo novo. */
async function irNuvemSincronizar(avisarProgresso){
  if(_irNuvemOcupada || typeof irSupa === 'undefined') return false;
  _irNuvemOcupada = true;
  let baixou = false;
  try {
    const cab = await irNuvemCabecalhos();
    const processar = async (unidade, ciclo)=>{
      const est = irNuvemEstado();
      const known = (est.known || {})[unidade];
      const sujo = !!(est.sujo || {})[unidade];
      const remoto = cab[unidade];
      // Reimportado aqui desde a última sincronização → sobe.
      let forcar = sujo;
      if(!forcar && ciclo && known && known.imp !== (await irNuvemImpDoCiclo(ciclo))) forcar = true;
      if(forcar){ await irNuvemPublicar(unidade); return; }
      if(remoto && (!known || remoto.versao !== known.v)){
        if(avisarProgresso && typeof irShowToast === 'function') irShowToast('Baixando dados da nuvem...');
        await irNuvemBaixar(unidade, remoto); baixou = true; return;
      }
      if(!remoto && !known){
        const linhas = await irNuvemLerUnidade(unidade);
        if(linhas.length){
          if(avisarProgresso && typeof irShowToast === 'function') irShowToast('Enviando dados para a nuvem...');
          await irNuvemPublicar(unidade);
        }
      }
    };
    // "ciclos" primeiro: ele define quais são os ciclos recentes.
    await processar('ciclos');
    for(const store of IR_NUVEM_GLOBAIS){ if(store !== 'ciclos') await processar(store); }
    const recentes = await irNuvemCiclosRecentes();
    for(const c of recentes){
      for(const store of IR_NUVEM_POR_CICLO) await processar(store + '@' + c, c);
    }
    if(baixou) irNuvemAvisarAtualizar();
    else if(avisarProgresso && typeof irShowToast === 'function') irShowToast('Nuvem em dia.');
  } catch(e){
    console.warn('Sincronização com a nuvem falhou', e);
    if(avisarProgresso && typeof irShowToast === 'function') irShowToast('Não consegui sincronizar com a nuvem: ' + ((e && e.message) || e), true);
  } finally {
    _irNuvemOcupada = false;
  }
  return baixou;
}
function irNuvemAvisarAtualizar(){
  const el = document.getElementById('irUpdateBar');
  if(!el) return;
  const sp = el.querySelector('span');
  if(sp) sp.textContent = 'Há dados novos na nuvem.';
  el.hidden = false;
}

/* Pós-importação: o worker gravou local; marca o que mudou pra subir. */
async function irNuvemMarcarPosImportacao(tipo){
  if(tipo === 'done' || tipo === 'doneRecalculo'){
    ['ciclos','indicadores','import_meta'].forEach(irNuvemMarcar);
    const recentes = await irNuvemCiclosRecentes();
    if(recentes[0]) IR_NUVEM_POR_CICLO.forEach(s=>irNuvemMarcar(s + '@' + recentes[0]));
  } else if(tipo === 'done390' || tipo === 'done160'){
    ['estoque_local','item_info','local_info','prioridade_config'].forEach(irNuvemMarcar);
  } else if(tipo === 'done410'){
    irNuvemMarcar('net410');
  }
}

/* Alterações feitas na tela (não passam pelo worker): envolve cada função de
   gravação pra marcar o store como alterado. */
function irNuvemEnvolver(nome, unidades){
  const orig = window[nome];
  if(typeof orig !== 'function') return;
  window[nome] = async function(){
    const r = await orig.apply(this, arguments);
    unidades.forEach(irNuvemMarcar);
    return r;
  };
}
function irNuvemVigiar(){
  irNuvemEnvolver('irSaveCiclo', ['ciclos']);
  irNuvemEnvolver('irDeleteCiclo', ['ciclos','indicadores','import_meta']);
  irNuvemEnvolver('irSavePrioridadeConfig', ['prioridade_config']);
  irNuvemEnvolver('irSaveProdMetaConfig', ['prioridade_config']);
  irNuvemEnvolver('irSetConfig', ['prioridade_config']);
  irNuvemEnvolver('irSaveNet410', ['net410']);
  irNuvemEnvolver('irDeleteNet410', ['net410']);
  irNuvemEnvolver('irSaveNet410LegendaItem', ['net410_legenda']);
  irNuvemEnvolver('irDeleteNet410LegendaItem', ['net410_legenda']);
  irNuvemEnvolver('irSaveNet410Ignorado', ['net410_ignorados']);
  irNuvemEnvolver('irRemoverNet410Ignorado', ['net410_ignorados']);
  irNuvemEnvolver('irSaveNet410PadraoIgnorado', ['net410_padroes_ignorados']);
  irNuvemEnvolver('irRemoverNet410PadraoIgnorado', ['net410_padroes_ignorados']);
  // Cada importação (worker) avisa o fim com uma mensagem "done...".
  const novoOrig = window.irNovoWorker;
  if(typeof novoOrig === 'function'){
    window.irNovoWorker = function(){
      const w = novoOrig.apply(this, arguments);
      w.addEventListener('message', ev=>{
        const t = ev.data && ev.data.type;
        if(t && /^done/.test(t) && t !== 'done843detect') irNuvemMarcarPosImportacao(t).catch(()=>{});
      });
      return w;
    };
  }
  // Primeira sincronização depois da tela aberta (e fora do callback de login).
  setTimeout(()=>irNuvemSincronizar(true), 800);
  setInterval(()=>{ if(!document.hidden) irNuvemSincronizar(false); }, 60000);
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) irNuvemSincronizar(false); });
}
