/* ============================================================
   Múltiplos Descasados — Camada IndexedDB
   100% client-side. Nenhum servidor, nenhuma API.
   ============================================================
   Banco PRÓPRIO (não é o do Inventário). O Inventário guarda a 390 inteira
   pro ciclo dele; aqui guarda a 390 inteira também — Ajustes de Restrição e
   Auditoria de Restrição precisam de toda peça do CD, não só componente de
   múltiplo (só o pareamento de múltiplos usa a ZBIQ0051 pra filtrar, em
   tempo de cálculo, não na hora de guardar).
   ============================================================ */
const MD_DB_NAME = 'multiplos_descasados_v1';
const MD_DB_VERSION = 5;

const MD_STORES = {
  // Estrutura do múltiplo (ZBIQ0051): uma linha por COMPONENTE, apontando pro
  // item pai. A chave é o componente porque cada componente pertence a um único
  // pai — é assim que a extração vem, e é o que permite descobrir o pai a partir
  // do item que apareceu no estoque.
  estrutura: 'estrutura',
  // Saldo de TODO item com estoque na QRY0390 (componente de múltiplo ou não),
  // já agregado por ITEM, com a lista de endereços junto.
  saldo: 'saldo',
  // Preço de custo por item (SIGEQ278), opcional — usado quando a 390 vem com
  // VALOR_UNITARIO zerado, que é o caso dos múltiplos hoje.
  preco: 'preco',
  // Contagem de "Num. Estoque" distintos por item+local+restrição (QRY0160),
  // opcional — a 390 soma a quantidade e esconde quantos registros físicos de
  // estoque existem ali; a 0160 traz um por registro, então dá pra contar de
  // verdade. Atualiza uma vez por dia (a 390 atualiza a cada 10min), mas é
  // suficiente: o número de estoques separados de um item/local não muda tão rápido.
  estoques: 'estoques',
  config: 'config'
};

/* Mesmo cuidado do Inventário: se o banco no disco estiver numa versão MAIOR
   que a do código (deploy revertido), o IndexedDB recusa abrir com VersionError
   e o módulo inteiro fica sem dados. Nesse caso reabrimos na versão existente —
   o esquema só cresce, então um banco mais novo tem todos os stores que este
   código conhece. */
function mdOpenDB(){
  return mdOpenDBNaVersao(MD_DB_VERSION).catch(err=>{
    if(!err || err.name !== 'VersionError') throw err;
    console.warn('Banco mais novo que o código — abrindo na versão existente.', err);
    return new Promise((resolve, reject)=>{
      const req = indexedDB.open(MD_DB_NAME);
      req.onsuccess = ()=>resolve(req.result);
      req.onerror = ()=>reject(req.error);
    });
  });
}
function mdOpenDBNaVersao(versao){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(MD_DB_NAME, versao);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      // v2: a chave da estrutura era só o componente — um componente que é
      // parte de mais de um múltiplo (ex.: uma base usada em dois modelos)
      // perdia a segunda ligação em silêncio, o segundo put() sobrescrevia o
      // primeiro. Recria o store com chave componente+pai; dado antigo salvo
      // sob o bug não tem valor pra manter — some com o store e volta vazio,
      // pedindo reimportar a ZBIQ0051.
      if(e.oldVersion < 2 && db.objectStoreNames.contains(MD_STORES.estrutura)){
        db.deleteObjectStore(MD_STORES.estrutura);
      }
      if(!db.objectStoreNames.contains(MD_STORES.estrutura)){
        const s = db.createObjectStore(MD_STORES.estrutura, {keyPath:'chave'});
        s.createIndex('pai', 'pai', {unique:false});
        s.createIndex('componente', 'componente', {unique:false});
      }
      if(!db.objectStoreNames.contains(MD_STORES.saldo)){
        db.createObjectStore(MD_STORES.saldo, {keyPath:'item'});
      }
      if(!db.objectStoreNames.contains(MD_STORES.preco)){
        db.createObjectStore(MD_STORES.preco, {keyPath:'item'});
      }
      if(!db.objectStoreNames.contains(MD_STORES.config)){
        db.createObjectStore(MD_STORES.config, {keyPath:'key'});
      }
      // v4: Auditoria de Restrição virou uma visão do próprio `saldo` (que agora
      // guarda todo item, não só componente) — o store separado ficou órfão.
      if(e.oldVersion >= 3 && e.oldVersion < 4 && db.objectStoreNames.contains('auditoria')){
        db.deleteObjectStore('auditoria');
      }
      if(!db.objectStoreNames.contains(MD_STORES.estoques)){
        db.createObjectStore(MD_STORES.estoques, {keyPath:'chave'});
      }
    };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}

let _mdDbPromise = null;
function mdDB(){
  if(!_mdDbPromise) _mdDbPromise = mdOpenDB();
  return _mdDbPromise;
}
async function mdTx(storeName, mode){
  const db = await mdDB();
  return db.transaction(storeName, mode).objectStore(storeName);
}

function mdPromise(req){
  return new Promise((resolve, reject)=>{
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}
async function mdBulkPut(storeKey, rows){
  const store = await mdTx(storeKey, 'readwrite');
  return new Promise((resolve, reject)=>{
    rows.forEach(r=>store.put(r));
    const tx = store.transaction;
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  });
}
/* Bloco de 1.500 por transação — o mesmo tamanho medido no Inventário, onde
   transação maior (10 mil, 25 mil) chegou a dobrar o tempo. */
async function mdSubstituirTudo(storeKey, rows){
  const store = await mdTx(storeKey, 'readwrite');
  await mdPromise(store.clear());
  const BLOCO = 1500;
  for(let i=0; i<rows.length; i+=BLOCO) await mdBulkPut(storeKey, rows.slice(i, i+BLOCO));
}
async function mdGetAll(storeKey){
  const store = await mdTx(storeKey, 'readonly');
  return mdPromise(store.getAll()).then(r=>r||[]);
}

/* ---------- Estrutura (ZBIQ0051) ---------- */
async function mdSalvarEstrutura(linhas, meta){
  // chave do registro é componente+pai (ver onupgradeneeded) — um componente
  // pode estar em mais de um múltiplo, então só ele não serve de chave única.
  const comChave = linhas.map(l=>({...l, chave: l.componente+'|'+l.pai}));
  await mdSubstituirTudo(MD_STORES.estrutura, comChave);
  await mdSetConfig('estrutura-meta', meta);
}
async function mdGetEstrutura(){ return mdGetAll(MD_STORES.estrutura); }
async function mdGetEstruturaMeta(){ return mdGetConfig('estrutura-meta'); }

/* ---------- Saldo de todo item do CD (QRY0390) ---------- */
async function mdSalvarSaldo(linhas, meta){
  await mdSubstituirTudo(MD_STORES.saldo, linhas);
  await mdSetConfig('saldo-meta', meta);
}
async function mdGetSaldo(){ return mdGetAll(MD_STORES.saldo); }
async function mdGetSaldoMeta(){ return mdGetConfig('saldo-meta'); }

/* ---------- Preço de custo (SIGEQ278, opcional) ---------- */
async function mdSalvarPrecos(linhas, meta){
  await mdSubstituirTudo(MD_STORES.preco, linhas);
  await mdSetConfig('preco-meta', meta);
}
async function mdGetPrecos(){ return mdGetAll(MD_STORES.preco); }
async function mdGetPrecoMeta(){ return mdGetConfig('preco-meta'); }

/* ---------- Contagem de estoques por item+local+restrição (QRY0160, opcional) ---------- */
async function mdSalvarEstoques(linhas, meta){
  await mdSubstituirTudo(MD_STORES.estoques, linhas);
  await mdSetConfig('estoques-meta', meta);
}
async function mdGetEstoques(){ return mdGetAll(MD_STORES.estoques); }
async function mdGetEstoqueMeta(){ return mdGetConfig('estoques-meta'); }

/* ---------- Config chave/valor ---------- */
async function mdSetConfig(key, valor){
  const store = await mdTx(MD_STORES.config, 'readwrite');
  return mdPromise(store.put({key, valor}));
}
async function mdGetConfig(key){
  const store = await mdTx(MD_STORES.config, 'readonly');
  return mdPromise(store.get(key)).then(r=>r ? r.valor : null);
}
