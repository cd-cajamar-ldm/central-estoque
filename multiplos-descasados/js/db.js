/* ============================================================
   Múltiplos Descasados — Camada IndexedDB
   100% client-side. Nenhum servidor, nenhuma API.
   ============================================================
   Banco PRÓPRIO (não é o do Inventário). O Inventário guarda a 390 inteira,
   endereço por endereço, porque precisa dela pro ciclo; aqui só interessam os
   itens que a ZBIQ0051 declara como componente de múltiplo — cerca de mil de
   trinta e poucos mil. Guardar o resto seria carregar o navegador com dado que
   este módulo nunca lê.
   ============================================================ */
const MD_DB_NAME = 'multiplos_descasados_v1';
const MD_DB_VERSION = 1;

const MD_STORES = {
  // Estrutura do múltiplo (ZBIQ0051): uma linha por COMPONENTE, apontando pro
  // item pai. A chave é o componente porque cada componente pertence a um único
  // pai — é assim que a extração vem, e é o que permite descobrir o pai a partir
  // do item que apareceu no estoque.
  estrutura: 'estrutura',
  // Saldo do componente (QRY0390), já agregado por ITEM, com a lista de
  // endereços junto. Só dos itens que estão na estrutura.
  saldo: 'saldo',
  // Preço de custo por item (SIGEQ278), opcional — usado quando a 390 vem com
  // VALOR_UNITARIO zerado, que é o caso dos múltiplos hoje.
  preco: 'preco',
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
      if(!db.objectStoreNames.contains(MD_STORES.estrutura)){
        const s = db.createObjectStore(MD_STORES.estrutura, {keyPath:'componente'});
        s.createIndex('pai', 'pai', {unique:false});
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
  await mdSubstituirTudo(MD_STORES.estrutura, linhas);
  await mdSetConfig('estrutura-meta', meta);
}
async function mdGetEstrutura(){ return mdGetAll(MD_STORES.estrutura); }
async function mdGetEstruturaMeta(){ return mdGetConfig('estrutura-meta'); }

/* ---------- Saldo dos componentes (QRY0390) ---------- */
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

/* ---------- Config chave/valor ---------- */
async function mdSetConfig(key, valor){
  const store = await mdTx(MD_STORES.config, 'readwrite');
  return mdPromise(store.put({key, valor}));
}
async function mdGetConfig(key){
  const store = await mdTx(MD_STORES.config, 'readonly');
  return mdPromise(store.get(key)).then(r=>r ? r.valor : null);
}
