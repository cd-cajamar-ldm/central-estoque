/* ============================================================
   Múltiplos Descasados — dados compartilhados (Supabase).
   O IndexedDB continua como cópia local (rápida/offline); a "verdade" fica na
   tabela public.md_dados. Só roda na tela principal (o worker de importação
   grava local e a tela envia depois). Ver supabase-acessos/migrations/004.
   ============================================================ */
const MD_NUVEM_TAB = 'md_dados';
const MD_NUVEM_BASES = {
  '051': {store:'estrutura', meta:'estrutura-meta'},
  '390': {store:'saldo', meta:'saldo-meta'},
  '278': {store:'preco', meta:'preco-meta'},
  '0160': {store:'estoques', meta:'estoques-meta'}
};
const MD_NUVEM_LIMITE = 400000; // caracteres por parte

function mdNuvemChaveCfg(key){ return 'cfg:' + key; }
function mdNuvemCfgSincronizavel(key){ return !/-meta$/.test(key) && key.indexOf('nuvem-') !== 0; }

async function mdNuvemVersoesLocais(){ return (await mdGetConfig('nuvem-versoes')) || {}; }
async function mdNuvemGuardarVersao(chave, versao){
  const v = await mdNuvemVersoesLocais();
  v[chave] = versao;
  await mdSetConfigLocal('nuvem-versoes', v);
}

async function mdNuvemPublicar(chave, meta, dadosCabecalho, partes){
  const versao = new Date().toISOString() + '-' + Math.random().toString(36).slice(2, 6);
  const tab = mdSupa.from(MD_NUVEM_TAB);
  for(let i = 0; i < partes.length; i++){
    const { error } = await tab.insert({chave, versao, parte: i + 1, dados: partes[i]});
    if(error) throw error;
  }
  const cab = Object.assign({}, dadosCabecalho, partes.length ? {partes: partes.length} : {});
  const { error: errCab } = await tab.insert({chave, versao, parte: 0, dados: cab, meta: meta || null});
  if(errCab) throw errCab;
  // Só depois do cabeçalho novo no lugar é seguro apagar as versões antigas.
  await mdSupa.from(MD_NUVEM_TAB).delete().eq('chave', chave).neq('versao', versao);
  await mdNuvemGuardarVersao(chave, versao);
}

function mdNuvemDividir(linhas){
  const partes = []; let atual = []; let tam = 0;
  for(const l of linhas){
    const t = JSON.stringify(l).length;
    if(atual.length && tam + t > MD_NUVEM_LIMITE){ partes.push(atual); atual = []; tam = 0; }
    atual.push(l); tam += t;
  }
  if(atual.length) partes.push(atual);
  return partes;
}

/* Envia uma base inteira (já gravada localmente) pra nuvem. */
async function mdNuvemEnviarBase(baseId){
  const b = MD_NUVEM_BASES[baseId];
  const linhas = await mdGetAll(b.store);
  const meta = await mdGetConfig(b.meta);
  await mdNuvemPublicar(b.store, meta, {}, mdNuvemDividir(linhas));
}

/* Chamado pelo mdSetConfig (db.js) — configuração pequena, 1 linha. */
async function mdNuvemConfig(key, valor){
  if(!mdNuvemCfgSincronizavel(key)) return;
  try {
    await mdNuvemPublicar(mdNuvemChaveCfg(key), null, {valor: valor === undefined ? null : valor}, []);
  } catch(e){
    console.warn('Configuração não enviada pra nuvem', e);
    if(typeof irShowToast === 'function') irShowToast('Salvou aqui, mas não consegui enviar a configuração pra nuvem.', true);
  }
}

async function mdNuvemCabecalhos(){
  const { data, error } = await mdSupa.from(MD_NUVEM_TAB).select('chave,versao,meta,dados').eq('parte', 0);
  if(error) throw error;
  const porChave = {};
  (data || []).forEach(r=>{
    if(!porChave[r.chave] || r.versao > porChave[r.chave].versao) porChave[r.chave] = r;
  });
  return porChave;
}

async function mdNuvemBaixarPartes(chave, versao, total){
  const { data, error } = await mdSupa.from(MD_NUVEM_TAB).select('parte,dados')
    .eq('chave', chave).eq('versao', versao).gt('parte', 0).order('parte');
  if(error) throw error;
  if(!data || data.length !== total) throw new Error('Versão em atualização, tente de novo em instantes.');
  let linhas = [];
  data.forEach(p=>{ linhas = linhas.concat(p.dados); });
  return linhas;
}

let _mdNuvemOcupada = false;
/* Traz da nuvem o que for mais novo; sobe o que só existe aqui (1º uso).
   Devolve true se algo local mudou. */
async function mdNuvemSincronizar(){
  if(_mdNuvemOcupada) return false;
  _mdNuvemOcupada = true;
  try {
    const cab = await mdNuvemCabecalhos();
    const locais = await mdNuvemVersoesLocais();
    let mudou = false;

    for(const baseId of Object.keys(MD_NUVEM_BASES)){
      const b = MD_NUVEM_BASES[baseId];
      const remoto = cab[b.store];
      if(remoto){
        if(locais[b.store] === remoto.versao) continue;
        const linhas = await mdNuvemBaixarPartes(b.store, remoto.versao, (remoto.dados && remoto.dados.partes) || 0);
        await mdSubstituirTudo(b.store, linhas);
        await mdSetConfigLocal(b.meta, remoto.meta);
        await mdNuvemGuardarVersao(b.store, remoto.versao);
        mudou = true;
      } else if((await mdGetAll(b.store)).length){
        await mdNuvemEnviarBase(baseId); // migra o que já estava neste navegador
      }
    }

    const cfgLocal = await mdGetAllConfig();
    const vistas = {};
    for(const chave of Object.keys(cab)){
      if(chave.indexOf('cfg:') !== 0) continue;
      const key = chave.slice(4);
      vistas[key] = true;
      if(locais[chave] === cab[chave].versao) continue;
      await mdSetConfigLocal(key, cab[chave].dados ? cab[chave].dados.valor : null);
      await mdNuvemGuardarVersao(chave, cab[chave].versao);
      mudou = true;
    }
    for(const c of cfgLocal){
      if(!mdNuvemCfgSincronizavel(c.key) || vistas[c.key]) continue;
      await mdNuvemPublicar(mdNuvemChaveCfg(c.key), null, {valor: c.valor}, []);
    }
    return mudou;
  } finally {
    _mdNuvemOcupada = false;
  }
}
