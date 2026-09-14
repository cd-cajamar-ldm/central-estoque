/* ============================================================
   Inventário Rotativo — Camada IndexedDB
   100% client-side. Nenhum servidor, nenhuma API.
   ============================================================ */
const IR_DB_NAME = 'inventario_rotativo_v1';
const IR_DB_VERSION = 9;

const IR_STORES = {
  ciclos: 'ciclos',
  locais: 'locais_congelados',
  contagens: 'contagens',
  divergencias: 'divergencias',
  indicadores: 'indicadores',
  prioridadeConfig: 'prioridade_config',
  importMeta: 'import_meta',
  net410: 'net410', // resumo de Perdas e Ganhos (QRY410) por ano — independente do ciclo
  net410Legenda: 'net410_legenda', // legenda de motivos da 410 (AIR/ADE/LOJA/...), editável em Configurações
  net410Ignorados: 'net410_ignorados', // itens com motivo já conhecido, ocultos da análise de distorção do NET
  // Saldo atual do item por LOCAL (QRY0390), guardado só para os itens que
  // divergiram no ciclo — é o que a auditoria de validação precisa pra mandar o
  // auditor conferir também os locais onde o item tem saldo e não foi contado.
  estoqueItem: 'estoque_item',
  net410PadroesIgnorados: 'net410_padroes_ignorados', // trecho da Observação WMS (ex.: "SALDO") que oculta qualquer item que o carregue, sem precisar ignorar item por item
  // Estoque atual agregado por ENDEREÇO (QRY0390). Independente de ciclo: a
  // extração virou automática e é atualizada sozinha, então ela é a base do
  // controle de transitórios e da foto de estoque pra diretoria.
  estoqueLocal: 'estoque_local',
  // Ficha do item vinda da QRY0390 (EAN e descrição), por ITEM. Fica separada do
  // ciclo de propósito: o EAN não muda de ciclo pra ciclo, e assim a auditoria
  // tem código de barras sem exigir reprocessamento.
  itemInfo: 'item_info',
  // Ficha do ENDEREÇO vinda da QRY0390 (classe local, prédio, prefixos). A
  // QRY0160 não traz classe local, e é ela que diz de qual setor é o endereço —
  // então a 390 alimenta esse dicionário e a 160 consulta.
  localInfo: 'local_info'
};

function irOpenDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(IR_DB_NAME, IR_DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains(IR_STORES.ciclos)){
        db.createObjectStore(IR_STORES.ciclos, {keyPath:'id'});
      }
      if(!db.objectStoreNames.contains(IR_STORES.locais)){
        const s = db.createObjectStore(IR_STORES.locais, {keyPath:'id'});
        s.createIndex('cicloId', 'cicloId', {unique:false});
      }
      if(!db.objectStoreNames.contains(IR_STORES.contagens)){
        const s = db.createObjectStore(IR_STORES.contagens, {keyPath:'id'});
        s.createIndex('cicloId', 'cicloId', {unique:false});
        s.createIndex('local', 'local', {unique:false});
        s.createIndex('item', 'item', {unique:false});
        s.createIndex('usuario', 'usuario', {unique:false});
      }
      if(!db.objectStoreNames.contains(IR_STORES.divergencias)){
        const s = db.createObjectStore(IR_STORES.divergencias, {keyPath:'id'});
        s.createIndex('cicloId', 'cicloId', {unique:false});
        s.createIndex('diagnostico', 'diagnostico', {unique:false});
        s.createIndex('item', 'item', {unique:false});
      }
      if(!db.objectStoreNames.contains(IR_STORES.indicadores)){
        db.createObjectStore(IR_STORES.indicadores, {keyPath:'cicloId'});
      }
      if(!db.objectStoreNames.contains(IR_STORES.prioridadeConfig)){
        db.createObjectStore(IR_STORES.prioridadeConfig, {keyPath:'key'});
      }
      if(!db.objectStoreNames.contains(IR_STORES.importMeta)){
        db.createObjectStore(IR_STORES.importMeta, {keyPath:'cicloId'});
      }
      if(!db.objectStoreNames.contains(IR_STORES.net410)){
        db.createObjectStore(IR_STORES.net410, {keyPath:'ano'});
      }
      if(!db.objectStoreNames.contains(IR_STORES.net410Legenda)){
        db.createObjectStore(IR_STORES.net410Legenda, {keyPath:'id'});
      }
      if(!db.objectStoreNames.contains(IR_STORES.net410Ignorados)){
        db.createObjectStore(IR_STORES.net410Ignorados, {keyPath:'item'});
      }
      if(!db.objectStoreNames.contains(IR_STORES.estoqueItem)){
        const s = db.createObjectStore(IR_STORES.estoqueItem, {keyPath:'id'});
        s.createIndex('cicloId', 'cicloId', {unique:false});
      }
      if(!db.objectStoreNames.contains(IR_STORES.net410PadroesIgnorados)){
        db.createObjectStore(IR_STORES.net410PadroesIgnorados, {keyPath:'id'});
      }
      if(!db.objectStoreNames.contains(IR_STORES.estoqueLocal)){
        const s = db.createObjectStore(IR_STORES.estoqueLocal, {keyPath:'local'});
        s.createIndex('x1', 'x1', {unique:false});
      }
      if(!db.objectStoreNames.contains(IR_STORES.itemInfo)){
        db.createObjectStore(IR_STORES.itemInfo, {keyPath:'item'});
      }
      if(!db.objectStoreNames.contains(IR_STORES.localInfo)){
        db.createObjectStore(IR_STORES.localInfo, {keyPath:'local'});
      }
    };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}

let _irDbPromise = null;
function irDB(){
  if(!_irDbPromise) _irDbPromise = irOpenDB();
  return _irDbPromise;
}
async function irTx(storeName, mode){
  const db = await irDB();
  return db.transaction(storeName, mode).objectStore(storeName);
}

/* ---------- Ciclos ---------- */
async function irSaveCiclo(ciclo){
  const store = await irTx(IR_STORES.ciclos, 'readwrite');
  return new Promise((resolve, reject)=>{
    const req = store.put(ciclo);
    req.onsuccess = ()=>resolve();
    req.onerror = ()=>reject(req.error);
  });
}
async function irGetAllCiclos(){
  const store = await irTx(IR_STORES.ciclos, 'readonly');
  return new Promise((resolve, reject)=>{
    const req = store.getAll();
    req.onsuccess = ()=>resolve((req.result||[]).sort((a,b)=>b.numero-a.numero));
    req.onerror = ()=>reject(req.error);
  });
}
async function irGetCiclo(id){
  const store = await irTx(IR_STORES.ciclos, 'readonly');
  return new Promise((resolve, reject)=>{
    const req = store.get(id);
    req.onsuccess = ()=>resolve(req.result||null);
    req.onerror = ()=>reject(req.error);
  });
}

/* ---------- Locais congelados ---------- */
async function irClearCiclo(storeKey, cicloId){
  const store = await irTx(storeKey, 'readwrite');
  return new Promise((resolve, reject)=>{
    const idx = store.index('cicloId');
    const req = idx.openCursor(IDBKeyRange.only(cicloId));
    req.onsuccess = (e)=>{
      const cursor = e.target.result;
      if(cursor){ cursor.delete(); cursor.continue(); }
    };
    const tx = store.transaction;
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  });
}
async function irBulkPut(storeKey, rows){
  const store = await irTx(storeKey, 'readwrite');
  return new Promise((resolve, reject)=>{
    rows.forEach(r=>store.put(r));
    const tx = store.transaction;
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  });
}
async function irGetByCiclo(storeKey, cicloId){
  const store = await irTx(storeKey, 'readonly');
  return new Promise((resolve, reject)=>{
    const idx = store.index('cicloId');
    const out = [];
    const req = idx.openCursor(IDBKeyRange.only(cicloId));
    req.onsuccess = (e)=>{
      const cursor = e.target.result;
      if(cursor){ out.push(cursor.value); cursor.continue(); }
      else resolve(out);
    };
    req.onerror = ()=>reject(req.error);
  });
}
async function irGetAllByIndex(storeKey, indexName, value){
  const store = await irTx(storeKey, 'readonly');
  return new Promise((resolve, reject)=>{
    const idx = store.index(indexName);
    const out = [];
    const req = idx.openCursor(IDBKeyRange.only(value));
    req.onsuccess = (e)=>{
      const cursor = e.target.result;
      if(cursor){ out.push(cursor.value); cursor.continue(); }
      else resolve(out);
    };
    req.onerror = ()=>reject(req.error);
  });
}

/* ---------- Exclusão de ciclo ----------
   Remove o ciclo e tudo que pende dele. Usado pra tirar da base um ciclo
   importado por engano — sem isso ele continuaria entrando nas visões por ano. */
async function irDeleteCiclo(cicloId){
  for(const store of [IR_STORES.locais, IR_STORES.contagens, IR_STORES.divergencias, IR_STORES.estoqueItem]){
    await irClearCiclo(store, cicloId);
  }
  for(const [store, key] of [[IR_STORES.indicadores, cicloId], [IR_STORES.importMeta, cicloId], [IR_STORES.ciclos, cicloId]]){
    const st = await irTx(store, 'readwrite');
    await new Promise((resolve, reject)=>{
      const req = st.delete(key);
      req.onsuccess = ()=>resolve();
      req.onerror = ()=>reject(req.error);
    });
  }
}

/* ---------- Estoque atual por item (QRY0390, por local) ---------- */
async function irGetEstoqueItem(cicloId, item){
  const store = await irTx(IR_STORES.estoqueItem, 'readonly');
  return new Promise((resolve, reject)=>{
    const req = store.get(cicloId+'|'+item);
    req.onsuccess = ()=>resolve(req.result||null);
    req.onerror = ()=>reject(req.error);
  });
}

/* ---------- Indicadores ---------- */
async function irSaveIndicadores(cicloId, data){
  const store = await irTx(IR_STORES.indicadores, 'readwrite');
  return new Promise((resolve, reject)=>{
    const req = store.put({cicloId, ...data});
    req.onsuccess = ()=>resolve();
    req.onerror = ()=>reject(req.error);
  });
}
async function irGetIndicadores(cicloId){
  const store = await irTx(IR_STORES.indicadores, 'readonly');
  return new Promise((resolve, reject)=>{
    const req = store.get(cicloId);
    req.onsuccess = ()=>resolve(req.result||null);
    req.onerror = ()=>reject(req.error);
  });
}

/* ---------- Prioridade config ---------- */
async function irGetPrioridadeConfig(){
  const store = await irTx(IR_STORES.prioridadeConfig, 'readonly');
  return new Promise((resolve, reject)=>{
    const req = store.get('pesos');
    req.onsuccess = ()=>resolve(req.result || null);
    req.onerror = ()=>reject(req.error);
  });
}
async function irSavePrioridadeConfig(pesos){
  const store = await irTx(IR_STORES.prioridadeConfig, 'readwrite');
  return new Promise((resolve, reject)=>{
    const req = store.put({key:'pesos', ...pesos});
    req.onsuccess = ()=>resolve();
    req.onerror = ()=>reject(req.error);
  });
}
async function irSeedPrioridadeConfigIfEmpty(){
  const existing = await irGetPrioridadeConfig();
  if(existing) return existing;
  const seed = {key:'pesos', valor:0.50, quantidade:0.20, recontagens:0.15, reincidencia:0.15};
  await irSavePrioridadeConfig(seed);
  return seed;
}

/* ---------- Meta de produtividade ----------
   Guardada no mesmo store de configuração (chave própria), pra não exigir
   migração de schema. Sem registro = sem meta cadastrada, e a aba
   Produtividade usa a média da equipe como referência, dizendo isso na tela. */
async function irGetProdMetaConfig(){
  const store = await irTx(IR_STORES.prioridadeConfig, 'readonly');
  return new Promise((resolve, reject)=>{
    const req = store.get('prod-meta');
    req.onsuccess = ()=>resolve(req.result || null);
    req.onerror = ()=>reject(req.error);
  });
}
async function irSaveProdMetaConfig(cfg){
  const store = await irTx(IR_STORES.prioridadeConfig, 'readwrite');
  return new Promise((resolve, reject)=>{
    const req = store.put({key:'prod-meta', ...cfg});
    req.onsuccess = ()=>resolve();
    req.onerror = ()=>reject(req.error);
  });
}

/* ---------- Import meta ---------- */
async function irSaveImportMeta(cicloId, meta){
  const store = await irTx(IR_STORES.importMeta, 'readwrite');
  return new Promise((resolve, reject)=>{
    const req = store.put({cicloId, ...meta, processedAt: new Date().toISOString()});
    req.onsuccess = ()=>resolve();
    req.onerror = ()=>reject(req.error);
  });
}
async function irGetImportMeta(cicloId){
  const store = await irTx(IR_STORES.importMeta, 'readonly');
  return new Promise((resolve, reject)=>{
    const req = store.get(cicloId);
    req.onsuccess = ()=>resolve(req.result||null);
    req.onerror = ()=>reject(req.error);
  });
}

/* ---------- Perdas e Ganhos (QRY410) — por ano, independente do ciclo ---------- */
async function irSaveNet410(ano, resumo){
  const store = await irTx(IR_STORES.net410, 'readwrite');
  return new Promise((resolve, reject)=>{
    const req = store.put({ano, ...resumo, processedAt: new Date().toISOString()});
    req.onsuccess = ()=>resolve();
    req.onerror = ()=>reject(req.error);
  });
}
async function irGetNet410(ano){
  const store = await irTx(IR_STORES.net410, 'readonly');
  return new Promise((resolve, reject)=>{
    const req = store.get(ano);
    req.onsuccess = ()=>resolve(req.result||null);
    req.onerror = ()=>reject(req.error);
  });
}
async function irGetAllNet410Anos(){
  const store = await irTx(IR_STORES.net410, 'readonly');
  return new Promise((resolve, reject)=>{
    const req = store.getAll();
    req.onsuccess = ()=>resolve((req.result||[]).map(r=>r.ano).sort((a,b)=>b-a));
    req.onerror = ()=>reject(req.error);
  });
}

/* ---------- Legenda de motivos da 410 (editável em Configurações) ---------- */
async function irGetNet410LegendaAll(){
  const store = await irTx(IR_STORES.net410Legenda, 'readonly');
  return new Promise((resolve, reject)=>{
    const req = store.getAll();
    req.onsuccess = ()=>resolve(req.result||[]);
    req.onerror = ()=>reject(req.error);
  });
}
async function irSaveNet410LegendaItem(item){
  const store = await irTx(IR_STORES.net410Legenda, 'readwrite');
  return new Promise((resolve, reject)=>{
    const req = store.put(item);
    req.onsuccess = ()=>resolve();
    req.onerror = ()=>reject(req.error);
  });
}
async function irDeleteNet410LegendaItem(id){
  const store = await irTx(IR_STORES.net410Legenda, 'readwrite');
  return new Promise((resolve, reject)=>{
    const req = store.delete(id);
    req.onsuccess = ()=>resolve();
    req.onerror = ()=>reject(req.error);
  });
}
// Semeia a legenda com os padrões de fábrica (IR_410_LEGENDA, de rules.js) na
// primeira vez que alguém abre a tela — depois disso, o que está no IndexedDB
// manda, o usuário pode editar/adicionar/remover à vontade.
/* Versão da semente da legenda. Quando um motivo novo entra no padrão de fábrica,
   sobe um número aqui e ele é acrescentado UMA VEZ às legendas que já existem —
   quem já usa o dash não ficaria sabendo de outro jeito, porque a semente só
   roda em banco vazio. Só uma vez porque o usuário pode apagar um motivo de
   propósito, e ressuscitá-lo a cada carregamento seria pior do que não ter
   acrescentado. */
const IR_410_LEGENDA_V = 2;
async function irSeedNet410LegendaIfEmpty(){
  const existing = await irGetNet410LegendaAll();
  if(!existing.length){
    const store = await irTx(IR_STORES.net410Legenda, 'readwrite');
    await new Promise((resolve, reject)=>{
      IR_410_LEGENDA.forEach(l=>store.put({...l}));
      const tx = store.transaction;
      tx.oncomplete = ()=>resolve();
      tx.onerror = ()=>reject(tx.error);
    });
    await irSetConfig('net410-legenda-v', IR_410_LEGENDA_V);
    return irGetNet410LegendaAll();
  }
  const versao = await irGetConfig('net410-legenda-v');
  if((versao||0) < IR_410_LEGENDA_V){
    const tem = new Set(existing.map(l=>String(l.id).toUpperCase()));
    const faltando = IR_410_LEGENDA.filter(l=>!tem.has(String(l.id).toUpperCase()));
    if(faltando.length){
      const store = await irTx(IR_STORES.net410Legenda, 'readwrite');
      await new Promise((resolve, reject)=>{
        faltando.forEach(l=>store.put({...l}));
        const tx = store.transaction;
        tx.oncomplete = ()=>resolve();
        tx.onerror = ()=>reject(tx.error);
      });
    }
    await irSetConfig('net410-legenda-v', IR_410_LEGENDA_V);
    return irGetNet410LegendaAll();
  }
  return existing;
}

/* ---------- Itens ignorados na análise de distorção do NET ---------- */
// Item com motivo já conhecido (ex.: troca de identidade já identificada e resolvida)
// — o usuário marca "já sei o motivo, não preciso ver de novo" e ele some dos
// rankings/listas do painel "Por que o NET está distorcido" até ser desmarcado.
async function irGetNet410IgnoradosAll(){
  const store = await irTx(IR_STORES.net410Ignorados, 'readonly');
  return new Promise((resolve, reject)=>{
    const req = store.getAll();
    req.onsuccess = ()=>resolve(req.result||[]);
    req.onerror = ()=>reject(req.error);
  });
}
async function irSaveNet410Ignorado(item, nome, motivo){
  const store = await irTx(IR_STORES.net410Ignorados, 'readwrite');
  return new Promise((resolve, reject)=>{
    const req = store.put({item, nome:nome||'', motivo:motivo||'', criadoEm:new Date().toISOString()});
    req.onsuccess = ()=>resolve();
    req.onerror = ()=>reject(req.error);
  });
}
async function irRemoverNet410Ignorado(item){
  const store = await irTx(IR_STORES.net410Ignorados, 'readwrite');
  return new Promise((resolve, reject)=>{
    const req = store.delete(item);
    req.onsuccess = ()=>resolve();
    req.onerror = ()=>reject(req.error);
  });
}

/* ---------- Padrões de Observação ignorados na análise de distorção do NET ---------- */
// Trecho de texto (ex.: "SALDO") que, se aparecer na Observação WMS de qualquer
// movimento de um item, esconde esse item da análise inteira — pensado pra ajustes
// recorrentes (ex.: "SALDO INCLUIDO INDEVIDAMENTE...") que aparecem em itens
// diferentes mês a mês, sem precisar clicar "Ignorar" item por item toda vez.
async function irGetNet410PadroesIgnoradosAll(){
  const store = await irTx(IR_STORES.net410PadroesIgnorados, 'readonly');
  return new Promise((resolve, reject)=>{
    const req = store.getAll();
    req.onsuccess = ()=>resolve(req.result||[]);
    req.onerror = ()=>reject(req.error);
  });
}
async function irSaveNet410PadraoIgnorado(padrao){
  const texto = String(padrao||'').trim();
  if(!texto) return;
  const store = await irTx(IR_STORES.net410PadroesIgnorados, 'readwrite');
  return new Promise((resolve, reject)=>{
    const req = store.put({id: texto.toUpperCase(), padrao: texto, criadoEm:new Date().toISOString()});
    req.onsuccess = ()=>resolve();
    req.onerror = ()=>reject(req.error);
  });
}
async function irRemoverNet410PadraoIgnorado(id){
  const store = await irTx(IR_STORES.net410PadroesIgnorados, 'readwrite');
  return new Promise((resolve, reject)=>{
    const req = store.delete(id);
    req.onsuccess = ()=>resolve();
    req.onerror = ()=>reject(req.error);
  });
}
// Semeia com "SALDO" na primeira vez que a tela é aberta (ajuste do tipo "SALDO
// INCLUIDO INDEVIDAMENTE..." pedido explicitamente pelo usuário) — depois disso, o
// que está salvo manda, o usuário edita/adiciona/remove à vontade.
async function irSeedNet410PadroesIgnoradosIfEmpty(){
  const existing = await irGetNet410PadroesIgnoradosAll();
  if(existing.length) return existing;
  await irSaveNet410PadraoIgnorado('SALDO');
  return irGetNet410PadroesIgnoradosAll();
}

/* ---------- ESTOQUE ATUAL POR ENDEREÇO (QRY0390) ---------- */
async function irSalvarEstoqueLocais(linhas, meta){
  const store = await irTx(IR_STORES.estoqueLocal, 'readwrite');
  await new Promise((res, rej)=>{ const r = store.clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
  const CHUNK = 1500;
  for(let i=0;i<linhas.length;i+=CHUNK) await irBulkPut(IR_STORES.estoqueLocal, linhas.slice(i,i+CHUNK));
  await irSetConfig('estoque390-meta', meta);
}
async function irGetEstoqueLocais(){
  const store = await irTx(IR_STORES.estoqueLocal, 'readonly');
  return new Promise((res, rej)=>{ const r = store.getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); });
}
async function irGetEstoqueMeta(){ return irGetConfig('estoque390-meta'); }
async function irSalvarItemInfo(linhas){
  const store = await irTx(IR_STORES.itemInfo, 'readwrite');
  await new Promise((res, rej)=>{ const r = store.clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
  const CHUNK = 1500;
  for(let i=0;i<linhas.length;i+=CHUNK) await irBulkPut(IR_STORES.itemInfo, linhas.slice(i,i+CHUNK));
}
async function irSalvarLocalInfo(linhas){
  const store = await irTx(IR_STORES.localInfo, 'readwrite');
  await new Promise((res, rej)=>{ const r = store.clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
  const CHUNK = 1500;
  for(let i=0;i<linhas.length;i+=CHUNK) await irBulkPut(IR_STORES.localInfo, linhas.slice(i,i+CHUNK));
}
async function irGetLocalInfoTodos(){
  const store = await irTx(IR_STORES.localInfo, 'readonly');
  return new Promise((res, rej)=>{ const r = store.getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); });
}
async function irGetItemInfoTodos(){
  const store = await irTx(IR_STORES.itemInfo, 'readonly');
  return new Promise((res, rej)=>{ const r = store.getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); });
}
/* Config genérica (usa o store de prioridade, que já é chave/valor). */
async function irSetConfig(key, valor){
  const store = await irTx(IR_STORES.prioridadeConfig, 'readwrite');
  return new Promise((res, rej)=>{ const r = store.put({key, valor}); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
}
async function irGetConfig(key){
  const store = await irTx(IR_STORES.prioridadeConfig, 'readonly');
  return new Promise((res, rej)=>{ const r = store.get(key); r.onsuccess=()=>res(r.result ? r.result.valor : null); r.onerror=()=>rej(r.error); });
}
