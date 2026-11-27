/* ============================================================
   Check Volume — conferência de entregas por bipagem de EAN.
   Bases: QRY0180 (itens por entrega, com o local de coleta) e QRY0390
   (estoque: EAN de cada item e saldo por local).
   Bases compartilhadas em public.app_dados (app = 'checkvolume', migração 008).
   O andamento da conferência de cada entrega fica neste navegador
   (localStorage) — é rascunho de quem está bipando.
   ============================================================ */
const CV_VERSAO = 27; // subir a cada alteração (aparece no rodapé do menu; trocar também o ?v= no index.html e o CACHE_VERSION do sw.js)
const CV_TAB = 'app_dados', CV_APP = 'checkvolume';
const CV_TITULOS = {
  conferir: ['Conferir entrega', 'Informe a entrega e bipe os EANs das peças.'],
  entregas: ['Entregas', 'Entregas da QRY0180.'],
  historico: ['Registro de conferências', 'Todas as entregas bipadas, com ou sem divergência.'],
  gestao: ['Gestão de divergências', 'Uma linha por entrega divergente, com classificação e tratativa.'],
  dashboard: ['Dashboard de divergências', 'Indicadores das ocorrências registradas.'],
  configuracoes: ['Configurações', 'Regras das sugestões de outros locais.']
};
/* Picking × não picking por CLASSE do local (coluna CLAL) — as mesmas classes marcadas no Inventário Rotativo. */
const CL_PICKING = ['PPBA1', 'PPPC', 'MZN', 'MZN2', 'MZKT', 'BLO', 'DRV', 'GLP', 'RMOV', 'COF', 'ESC', 'MAC'];
const CL_NAO = ['PPAL1', 'MZN01', 'GLP23', 'UMA', 'SUPRI', 'SUPR2', 'REV', 'AVA', 'INB', 'OUT', 'DENT', 'DSAI', 'CARGA', 'CROSS', 'C.E', 'PALET', 'ATI', 'TSF', 'CAN', 'PAR', 'DEV', 'TRANS', 'TRP'];
const CV = {
  ent: [], itens: {}, saldo: [], meta: {}, cfg: {ignorar: [], restricoes: ['WN'], max: 5, clPicking: CL_PICKING, clNao: CL_NAO, incluirNao: false},
  fotos: new Map(),
  porEnt: new Map(), eanMap: new Map(), saldoItem: new Map(),
  tab: 'conferir', num: '', sess: null, linhas: [], desc: new Set(), pag: 0, busca: '',
  ocupado: false, msg: '', carregando: true, erro: '', ult: null, aberto: new Set(),
  and: [], abrindo: false, etqMap: new Map(), hf: {r: '', busca: '', de: '', ate: ''}, hpag: 0, finalizando: false, ctrl: [], conf: [], trat: [], atd: [], atdA: null, gf: {st: '', classe: '', busca: ''}, gaberta: new Set(), cf: {st: '', tipo: '', busca: '', de: '', ate: ''}, df: {de: '', ate: ''}, dx: {per: '30', de: '', ate: '', met: 'n', f: {}, vista: 'graf', sm: {k: 'q', d: -1}}, cpag: 0, cnovo: false, email: '', eanRows: [], eansExtra: new Map()
};

/* ---------- utilitários ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fInt = n => Math.round(n || 0).toLocaleString('pt-BR');
const fData = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '';
const somenteLeitura = () => !!window.LDM_SOMENTE_LEITURA;
const $ = id => document.getElementById(id);
function toast(msg, erro){
  const t = $('toast'); if(!t) return;
  t.textContent = msg; t.className = 'toast' + (erro ? ' error' : '');
  clearTimeout(window.__cvT); window.__cvT = setTimeout(() => { t.className = 'toast hidden'; }, 3200);
}
const normEan = s => String(s || '').trim().replace(/\D/g, '').replace(/^0+/, '');
const normLoc = s => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
/* Som da bipagem: bip agudo e curto para leitura certa; dois tons graves para erro (sobra / EAN não identificado). */
let _audio, _som = true;
try { _som = localStorage.getItem('cv-som') !== '0'; } catch(e){}
function audioCtx(){
  _audio = _audio || new (window.AudioContext || window.webkitAudioContext)();
  if(_audio.state === 'suspended') _audio.resume();
  return _audio;
}
function tom(freq, ini, dur, tipo, vol){
  const a = audioCtx(), t0 = a.currentTime + ini, o = a.createOscillator(), g = a.createGain();
  o.type = tipo; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.03);
}
function beep(tipo){
  if(!_som) return;
  try {
    if(tipo === 'ok') tom(1800, 0, 0.13, 'square', 0.3);
    else { tom(420, 0, 0.17, 'square', 0.35); tom(300, 0.21, 0.3, 'square', 0.35); }
  } catch(e){}
}
function cvSom(){
  _som = !_som;
  try { localStorage.setItem('cv-som', _som ? '1' : '0'); } catch(e){}
  const b = $('cvSomBtn'); if(b) b.textContent = _som ? '🔊 Som' : '🔇 Mudo';
  if(_som) beep('ok');
  const i = $('cvBip'); if(i) i.focus();
}
const btnSom = () => '<button class="btn btn-secondary" id="cvSomBtn" onclick="cvSom()" title="Ligar/desligar o som da bipagem">' + (_som ? '🔊 Som' : '🔇 Mudo') + '</button>';

/* ---------- nuvem (Supabase: public.app_dados) ---------- */
async function nuvemLer(chave){
  const { data: cab, error } = await cvSupa.from(CV_TAB).select('versao,dados,meta').eq('app', CV_APP).eq('chave', chave).eq('parte', 0).order('versao', {ascending: false}).limit(1);
  if(error) throw error;
  if(!cab || !cab.length) return null;
  const c = cab[0], n = (c.dados && c.dados.partes) || 0;
  let linhas = [];
  if(n){
    const { data, error: e2 } = await cvSupa.from(CV_TAB).select('parte,dados').eq('app', CV_APP).eq('chave', chave).eq('versao', c.versao).gt('parte', 0).order('parte');
    if(e2) throw e2;
    if(!data || data.length !== n) throw new Error('Base em atualização, tente de novo em instantes.');
    data.forEach(p => { linhas = linhas.concat(p.dados); });
  }
  return {dados: c.dados, meta: c.meta, linhas};
}
async function nuvemGravar(chave, meta, cabExtra, partes){
  if(somenteLeitura()) throw new Error('Seu acesso é só de visualização.');
  const versao = new Date().toISOString() + '-' + Math.random().toString(36).slice(2, 6);
  const tab = cvSupa.from(CV_TAB);
  for(let i = 0; i < partes.length; i++){
    const { error } = await tab.insert({app: CV_APP, chave, versao, parte: i + 1, dados: partes[i]});
    if(error) throw error;
    if(CV.ocupado){ CV.msg = 'Gravando ' + chave + ' na nuvem: parte ' + (i + 1) + ' de ' + partes.length + '...'; renderMsg(); }
  }
  const { error: e2 } = await tab.insert({app: CV_APP, chave, versao, parte: 0, dados: Object.assign({}, cabExtra, partes.length ? {partes: partes.length} : {}), meta: meta || null});
  if(e2) throw e2;
  await cvSupa.from(CV_TAB).delete().eq('app', CV_APP).eq('chave', chave).neq('versao', versao);
}
function dividir(linhas, limite){
  const partes = []; let atual = [], tam = 0;
  for(const l of linhas){
    const t = JSON.stringify(l).length;
    if(atual.length && tam + t > limite){ partes.push(atual); atual = []; tam = 0; }
    atual.push(l); tam += t;
  }
  if(atual.length) partes.push(atual);
  return partes;
}

/* Entregas guardadas em formato compacto (fmt 2): linhas [entrega,item,qtd,origem], cabeçalho por
   entrega e descrição por item — a QRY0180 completa passa de 40 MB. */
function montarEnt(linhas, cabs, descs, ops){
  ops = ops || [];
  const cab = new Map(cabs.map(x => [x[0], x])), ds = new Map(descs);
  return linhas.map(r => { const c = cab.get(r[0]) || []; return {e: r[0], i: r[1], q: r[2], o: r[3], d: ds.get(r[1]) || '', t: c[1] || '', ev: c[2] || '', li: c[3] || '', ca: c[4] || '', vo: c[5] || 0, mo: c[6] || '', op: (r[4] >= 0 && ops[r[4]]) || (r.length < 5 ? c[7] || '' : '')}; });
}
/* ---------- índices ---------- */
function indexar(){
  CV.porEnt = new Map();
  CV.ent.forEach(r => { let a = CV.porEnt.get(r.e); if(!a) CV.porEnt.set(r.e, a = []); a.push(r); });
  CV.eanMap = new Map();
  Object.keys(CV.itens).forEach(i => (CV.itens[i].e || []).forEach(e => { const k = normEan(e); if(k && !CV.eanMap.has(k)) CV.eanMap.set(k, i); }));
  CV.eansExtra = new Map();
  (CV.eanRows || []).forEach(r => { const k = normEan(r[1]); if(!k) return; let a = CV.eansExtra.get(r[0]); if(!a) CV.eansExtra.set(r[0], a = []); if(a.indexOf(r[1]) < 0) a.push(r[1]); if(!CV.eanMap.has(k)) CV.eanMap.set(k, r[0]); });
  CV.etqUlt = new Map();                                   /* últimos 9 dígitos da chave (pré-volume) -> entrega */
  CV.etqMap.forEach((e, k) => { if(k.length >= 29 && k.length < 44) CV.etqUlt.set(k.slice(-9), e); });
  CV.fotoMap = new Map();
  (CV.fotoRows || []).forEach(f => { CV.fotoMap.set(f[0], f[1]); const k = normEan(f[2]); if(k && !CV.eanMap.has(k)) CV.eanMap.set(k, f[0]); });
  CV.saldoItem = new Map();
  CV.saldo.forEach(s => { let a = CV.saldoItem.get(s[0]); if(!a) CV.saldoItem.set(s[0], a = []); a.push(s); });
}
async function carregar(){
  try {
    const [cfg, ent, ei, es, ft, ec, ed, en2, etq] = await Promise.all([nuvemLer('cfg'), nuvemLer('ent'), nuvemLer('est_itens'), nuvemLer('est_saldo'), nuvemLer('fotos'), nuvemLer('ent_cab'), nuvemLer('ent_desc'), nuvemLer('eans'), nuvemLer('ent_etq')]);
    if(cfg && cfg.dados && cfg.dados.cfg) Object.assign(CV.cfg, cfg.dados.cfg);
    CV.ent = !ent ? [] : (ent.dados && ent.dados.fmt === 2 ? montarEnt(ent.linhas, ec ? ec.linhas : [], ed ? ed.linhas : [], ent.dados.ops) : ent.linhas);
    CV.itens = {}; (ei ? ei.linhas : []).forEach(x => { CV.itens[x[0]] = {d: x[1], e: x[2]}; });
    CV.saldo = es ? es.linhas : [];
    CV.fotoRows = ft ? ft.linhas : [];
    CV.eanRows = en2 ? en2.linhas : [];
    CV.etqMap = new Map(etq ? etq.linhas : []);
    CV.meta = {ent: ent && ent.meta, est: es && es.meta, foto: ft && ft.meta, ean: en2 && en2.meta};
    indexar();
    CV.ctrl = await ctrlLer('ctrl').catch(() => []);
    CV.conf = await ctrlLer('conf').catch(() => []);
    CV.trat = await ctrlLer('trat').catch(() => []);
    CV.and = await ctrlLer('and').catch(() => []);
  } catch(e){
    CV.erro = 'Não consegui ler os dados: ' + (e.message || e) + (/app_dados|relation|does not exist/i.test(String(e.message)) ? ' — a tabela app_dados ainda não foi criada no banco (migração 008).' : '');
  }
}

/* ---------- conferência de uma entrega ---------- */
const sessKey = n => 'cv-sessao-' + n;
function lerSessao(n){
  try { const o = JSON.parse(localStorage.getItem(sessKey(n)) || 'null'); if(o) return o; } catch(e){}
  return {bips: {}, desc: {}, log: [], fin: false, ini: Date.now(), upd: 0};
}
function gravarSessao(){ if(CV.sess) CV.sess.upd = Date.now(); try { localStorage.setItem(sessKey(CV.num), JSON.stringify(CV.sess)); } catch(e){} lockAgenda(); }

/* Junta as linhas da entrega por item (um item pode vir em mais de uma linha). */
function montarLinhas(rows){
  const m = new Map();
  rows.forEach(r => {
    let x = m.get(r.i);
    if(!x){ x = {i: r.i, d: r.d || (CV.itens[r.i] && CV.itens[r.i].d) || '', prev: 0, orig: [], eans: Array.from(new Set(((CV.itens[r.i] && CV.itens[r.i].e) || []).concat(CV.eansExtra.get(r.i) || [])))}; m.set(r.i, x); }
    x.prev += r.q;
    const o = r.o || r.pk || r.de;
    if(o && x.orig.indexOf(o) < 0) x.orig.push(o);
  });
  return Array.from(m.values());
}
/* A etiqueta impressa tem 38 dígitos (20 + 9 zeros + 9 do pré-volume); a QRY0180 guarda 29 (sem os zeros do meio).
   Os dois formatos viram a mesma chave. */
function chaveCanon(d){ return d.length === 38 ? d.slice(0, 20) + d.slice(29) : d; }
function entDaChave(dig){
  const c = chaveCanon(dig);
  if(CV.etqMap.has(c)) return CV.etqMap.get(c);
  if(dig.length >= 29 && dig.length < 44) return CV.etqUlt.get(dig.slice(-9)) || '';   /* garantia: pelo pré-volume */
  return '';
}
/* ---------- Entrega em andamento na nuvem (trava) ----------
   Quem abre uma entrega "reserva" ela (chave 'and'); outra pessoa que tentar abrir é avisada. A reserva vence sozinha
   após LOCK_MIN minutos sem leitura. O andamento (contagem por item) também vai para a nuvem, então dá para continuar
   em outro aparelho ou assumir uma entrega parada. */
const LOCK_MIN = 30;
const nomeDe = e => String(e || '').split('@')[0];
const minDesde = iso => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
async function lockLer(ent){ try { return await ctrlLerUm('and', ent); } catch(e){ return undefined; } }   /* undefined = sem rede: segue sem trava */
function lockResumo(ent, sess, rows){
  return {id: ent, por: CV.email, upd: new Date().toISOString(), ini: new Date(sess.ini || Date.now()).toISOString(), bips: sess.bips, desc: sess.desc,
    leituras: (sess.log || []).length, bip: Object.keys(sess.bips || {}).reduce((a, i) => a + sess.bips[i], 0), itens: new Set(rows.map(r => r.i)).size,
    pecas: rows.reduce((a, r) => a + r.q, 0), t: rows[0] ? rows[0].t : '', meca: mecaEntrega(rows)};
}
async function lockGravaDe(ent, sess, rows){ try { await ctrlSalvar(lockResumo(ent, sess, rows), 'and'); } catch(e){} }
async function lockLibera(ent){ try { await ctrlExcluir(ent, 'and'); } catch(e){} }
let _lockT = null;
function lockAgenda(){                                       /* no máximo uma gravação a cada 3 s enquanto bipa */
  if(_lockT || somenteLeitura() || !CV.sess || CV.sess.fin) return;
  _lockT = setTimeout(lockGrava, 3000);
}
async function lockGrava(){
  _lockT = null;
  if(!CV.sess || CV.sess.fin || somenteLeitura() || CV.finalizando) return;
  const ent = CV.num, rows = CV.porEnt.get(ent) || [];
  try {
    const lk = await lockLer(ent);
    if(lk && lk.por && lk.por !== CV.email && minDesde(lk.upd) < LOCK_MIN){
      if(!CV._avisouTrava){ CV._avisouTrava = true; toast('Atenção: ' + nomeDe(lk.por) + ' assumiu esta entrega. Suas leituras não estão sendo salvas na nuvem.', true); }
      return;
    }
    await ctrlSalvar(lockResumo(ent, CV.sess, rows), 'and');
  } catch(e){}
}
function lockBloqueada(ent, lk){
  CV.num = ''; CV.sess = null; CV.linhas = [];
  CV.ult = {tipo: 'ean', txt: 'A entrega ' + ent + ' está sendo conferida por ' + nomeDe(lk.por) + ' (última leitura há ' + minDesde(lk.upd) + ' min). Peça para ela finalizar, ou use "Liberar" em Conferências feitas se ela abandonou.'};
  beep('erro'); renderView(); setTimeout(() => { const e = $('cvEnt'); if(e){ e.focus(); e.select(); } }, 0);
}
/* Aceita o número da entrega, a chave picking (etiqueta de picking) ou a chave da nota — as chaves viram a entrega. */
async function abrirEntrega(n){
  if(CV.abrindo) return;
  const bruto = String(n || '').trim(), dig = bruto.replace(/\D/g, '');
  if(!dig) return toast('Informe a entrega ou bipe a chave picking.', true);
  let ent = dig, viaChave = false;
  if(!CV.porEnt.has(ent)){ const e = entDaChave(dig); if(e){ ent = e; viaChave = true; } }
  const rows = CV.porEnt.get(ent);
  if(!rows){
    CV.num = ''; CV.sess = null; CV.linhas = [];
    CV.ult = {tipo: 'ean', txt: (dig.length >= 20 ? 'Chave ' + dig.slice(0, 12) + '… não encontrada' : 'Entrega ' + dig + ' não encontrada') + ' na QRY0180' + (CV.meta.ent && CV.meta.ent.importadoEm ? ' de ' + fData(CV.meta.ent.importadoEm.slice(0, 10)) : '') + '.' + (dig.length >= 20 && !CV.etqMap.size ? ' Aguarde a próxima atualização da QRY0180 para ler as chaves.' : '')};
    beep('erro'); renderView(); setTimeout(() => { const e = $('cvEnt'); if(e){ e.focus(); e.select(); } }, 0); return;
  }
  CV.abrindo = true;
  try {
    const sess = lerSessao(ent);
    if(!somenteLeitura()){
      const lk = await lockLer(ent);
      if(lk && lk.por && lk.por !== CV.email && minDesde(lk.upd) < LOCK_MIN) return lockBloqueada(ent, lk);
      /* Há andamento na nuvem mais novo que o deste aparelho (outro aparelho ou entrega parada de outra pessoa): continua dele. */
      if(lk && lk.bips && (!sess.upd || new Date(lk.upd).getTime() > sess.upd)){
        sess.bips = lk.bips; sess.desc = lk.desc || {}; sess.fin = false; sess.upd = new Date(lk.upd).getTime();
        if(lk.por !== CV.email) toast('Você assumiu a conferência de ' + nomeDe(lk.por) + ' (parada há ' + minDesde(lk.upd) + ' min).');
      }
      if(lk !== undefined){
        await lockGravaDe(ent, sess, rows);                    /* reserva a entrega */
        /* Duas pessoas abrindo ao mesmo tempo: confere de novo um instante depois (já com as duas gravações feitas). Quem perdeu a disputa é avisado e sai. */
        setTimeout(async () => {
          if(CV.num !== ent) return;
          const lk2 = await lockLer(ent);
          if(lk2 && lk2.por && lk2.por !== CV.email) lockBloqueada(ent, lk2);
        }, 900);
      }
    }
    CV._avisouTrava = false;
    CV.num = ent; CV.sess = sess; CV.linhas = montarLinhas(rows); CV.ult = null; CV.aberto = new Set(); CV.tab = 'conferir';
    renderView(); setTimeout(focoBip, 0);
    if(viaChave) toast('Chave picking → entrega ' + ent + '.');
    fotosDoSite(CV.linhas.map(x => x.i));
  } finally { CV.abrindo = false; }
}
function cvSituacao(x){
  const bip = CV.sess.bips[x.i] || 0;
  if(bip === x.prev) return 'ok';
  if(bip > x.prev) return 'sobra';
  return bip === 0 && !CV.sess.fin ? 'pend' : 'falta';
}
const ROT = {ok: 'Conferido', falta: 'Faltante', sobra: 'Sobra', pend: 'Pendente'};
function totais(){
  const t = {prev: 0, bip: 0, falta: 0, sobra: 0, ok: 0, pend: 0, ean: 0, itens: CV.linhas.length};
  CV.linhas.forEach(x => {
    const b = CV.sess.bips[x.i] || 0;
    t.prev += x.prev; t.bip += b; t.falta += Math.max(x.prev - b, 0); t.sobra += Math.max(b - x.prev, 0);
    if(b === x.prev) t.ok++; else if(b < x.prev) t.pend++;
  });
  Object.keys(CV.sess.desc).forEach(k => { t.ean += CV.sess.desc[k].n; });
  return t;
}

/* Bipagem: cruza o EAN com os itens da entrega. */
function bipar(codigo){
  if(CV.finalizando) return;
  if(!CV.sess){ toast('Informe a entrega primeiro.', true); const e = $('cvEnt'); if(e) e.focus(); return; }
  const cod = String(codigo || '').trim(); if(!cod) return;
  const k = normEan(cod);
  if(k.length >= 20 && entDaChave(k)){ abrirEntrega(k); return; }   /* bipou a chave picking de outra entrega: troca de entrega */
  let item = k ? CV.eanMap.get(k) : null;
  let x = item ? CV.linhas.find(l => l.i === item) : null;
  if(!x) x = CV.linhas.find(l => l.i === cod || l.eans.some(e => normEan(e) === k && k)) || null; // digitou o código do item / EAN que só a 390 conhece
  if(CV.sess.fin){ CV.sess.fin = false; }
  const agora = Date.now();
  if(x){
    const antes = CV.sess.bips[x.i] || 0;
    CV.sess.bips[x.i] = antes + 1;
    const sobra = antes + 1 > x.prev;
    CV.sess.log.push({t: agora, i: x.i, e: cod, k: sobra ? 'sobra' : 'ok'});
    CV.ult = {tipo: sobra ? 'sobra' : 'ok', i: x.i, ean: cod, n: antes + 1, prev: x.prev, txt: (sobra ? 'SOBRA · ' : '✓ ') + x.i + ' — ' + x.d + ' · ' + (antes + 1) + ' de ' + x.prev};
    beep(sobra ? 'erro' : 'ok');
  } else {
    const d = CV.sess.desc[cod] || (CV.sess.desc[cod] = {n: 0, nome: ''});
    const outro = CV.eanMap.get(k); d.nome = outro ? ((CV.itens[outro] && CV.itens[outro].d) || '') + ' (item ' + outro + ')' : '';
    d.n++;
    CV.sess.log.push({t: agora, e: cod, k: 'ean'});
    CV.ult = {tipo: 'ean', ean: cod, txt: 'EAN NÃO IDENTIFICADO · ' + cod + (outro ? ' — pertence a outro produto: ' + d.nome : ' — não está nesta entrega')};
    beep('erro');
  }
  gravarSessao(); atualizar();
}
function cvDesfazer(){
  if(!CV.sess || !CV.sess.log.length) return toast('Nada para desfazer.', true);
  const l = CV.sess.log.pop();
  if(l.i){ CV.sess.bips[l.i] = Math.max((CV.sess.bips[l.i] || 0) - 1, 0); if(!CV.sess.bips[l.i]) delete CV.sess.bips[l.i]; }
  else if(CV.sess.desc[l.e]){ CV.sess.desc[l.e].n--; if(CV.sess.desc[l.e].n <= 0) delete CV.sess.desc[l.e]; }
  CV.ult = {tipo: '', txt: 'Última leitura desfeita.'}; gravarSessao(); atualizar();
}
function cvMenos(i){
  if(!CV.sess || !CV.sess.bips[i]) return;
  CV.sess.bips[i]--; if(!CV.sess.bips[i]) delete CV.sess.bips[i];
  const p = CV.sess.log.map(l => l.i).lastIndexOf(i); if(p >= 0) CV.sess.log.splice(p, 1);
  gravarSessao(); atualizar();
}
async function cvFinalizar(){
  if(!CV.sess || CV.finalizando) return;
  const t = totais(), num = CV.num;
  if(!somenteLeitura()){
    const lk = await lockLer(num);
    if(lk && lk.por && lk.por !== CV.email && minDesde(lk.upd) < LOCK_MIN && !confirm(nomeDe(lk.por) + ' assumiu a conferência da entrega ' + num + '.\n\nFinalizar mesmo assim vai sobrescrever o registro dela. Continuar?')) return;
  }
  const partes = [t.falta ? 'falta ' + t.falta : '', t.sobra ? 'sobra ' + t.sobra : '', t.ean ? t.ean + ' EAN não identificado' : ''].filter(Boolean).join(' · ');
  /* Com divergência: oferece o Excel de Atender entrega antes de zerar (depois dá para gerar pela Gestão de divergências). */
  if(partes && confirm('Entrega ' + num + ' com divergência (' + partes + ').\n\nAbrir o Atender entrega (conferência dos locais) antes de zerar a tela?')) cvAtender();
  CV.finalizando = true; CV.sess.fin = true; gravarSessao();
  toast('Salvando a conferência...');
  try {
    await confRegistrar();
    await ctrlDaConferencia();
    await lockLibera(num);
  } catch(e){
    CV.finalizando = false; renderView();
    return toast('Não consegui salvar a conferência (nada foi zerado, tente Finalizar de novo): ' + ((e && e.message) || e), true);
  }
  CV.finalizando = false;
  cvNova();                                                  /* zera a tela para a próxima entrega */
  toast('Entrega ' + num + ' finalizada' + (partes ? ' — divergência registrada: ' + partes : ' — sem divergência') + '.');
}
function cvReabrir(){ if(!CV.sess) return; CV.sess.fin = false; gravarSessao(); renderView(); setTimeout(focoBip, 0); }
function cvZerar(){
  if(!CV.sess || !confirm('Zerar toda a bipagem da entrega ' + CV.num + '?')) return;
  try { localStorage.removeItem(sessKey(CV.num)); } catch(e){}
  lockLibera(CV.num);
  CV.sess = lerSessao(CV.num); CV.ult = null; renderView(); setTimeout(focoBip, 0);
}
function cvNova(){ CV.num = ''; CV.sess = null; CV.linhas = []; CV.ult = null; renderView(); setTimeout(() => { const i = $('cvEnt'); if(i) i.focus(); }, 0); }
/* Leitor de código de barras: ele digita o EAN e (na maioria) manda Enter. Se não mandar,
   a leitura é registrada sozinha quando a digitação para (leitor digita tudo em milissegundos). */
let _cvAuto;
const TAM_EAN = [8, 12, 13, 14];
let _cvT0 = 0;
/* Campo da entrega: o leitor lê a chave picking inteira (29 dígitos) em milissegundos; mesmo sem Enter, abre a entrega. */
let _cvAE, _cvTE = 0;
function cvAutoEnt(inp){
  clearTimeout(_cvAE);
  if(inp.value.length === 1) _cvTE = Date.now();
  const n = inp.value.trim().length;
  if(n < 20 || (Date.now() - _cvTE) / n > 40) return;
  _cvAE = setTimeout(() => abrirEntrega(inp.value), 80);
}
function cvAutoBip(inp){
  clearTimeout(_cvAuto);
  if(!CV.sess){ if(inp.value.length === 1) _cvT0 = Date.now(); const n = inp.value.trim().length; if(n >= 20 && (Date.now() - _cvT0) / n <= 40) _cvAuto = setTimeout(() => { const v = inp.value; inp.value = ''; abrirEntrega(v); }, 80); return; }
  if(inp.value.length === 1) _cvT0 = Date.now();           /* começou a digitar */
  const n = inp.value.trim().length;
  if(TAM_EAN.indexOf(n) < 0) return;
  /* O leitor digita o código inteiro em milissegundos; à mão é bem mais devagar — nesse caso só o Enter registra. */
  if((Date.now() - _cvT0) / n > 40) return;
  _cvAuto = setTimeout(() => { const x = inp.value.trim(); if(TAM_EAN.indexOf(x.length) >= 0){ inp.value = ''; bipar(x); } }, 80);
}
/* O campo do EAN volta a ter o foco sozinho, para o leitor sempre cair nele. */
function cvRefoca(inp){
  setTimeout(() => {
    const a = document.activeElement;
    if(CV.tab === 'conferir' && CV.sess && inp.isConnected && (!a || a === document.body || a.tagName === 'BUTTON')) inp.focus();
    else if(CV.tab === 'conferir' && !CV.sess && $('cvEnt') && (!a || a === document.body)) $('cvEnt').focus();
  }, 60);
}
function focoBip(){ const i = $('cvBip'); if(i) i.focus(); }
function cvToggle(i){
  const sel = window.getSelection && String(window.getSelection() || '');
  if(sel) return;                                          /* está selecionando texto para copiar: não abre a linha */
  if(CV.aberto.has(i)) CV.aberto.delete(i); else CV.aberto.add(i); atualizar(); }

/* ---------- onde achar a peça faltante ---------- */
const normClasse = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim().split(/[\s·-]+/)[0];
/* 'pk' = classe de picking (local de coleta), 'nao' = classe que não é picking, '' = classe desconhecida. */
function tipoClasse(clal){
  const c = normClasse(clal); if(!c) return '';
  if((CV.cfg.clPicking || CL_PICKING).indexOf(c) >= 0) return 'pk';
  if((CV.cfg.clNao || CL_NAO).indexOf(c) >= 0) return 'nao';
  return '';
}
const tipoRot = s => ({pk: 'Picking', nao: 'Não picking'}[tipoClasse(s[3])] || 'Sem classe');
/* Sugestões: o próprio local da coleta vem primeiro quando ainda tem saldo (a peça pode estar lá); depois os
   locais de picking. Se "incluir não picking" estiver ligado, eles entram depois do picking. */
const ehOrigem = (x, s) => x.orig.some(o => normLoc(o) === normLoc(s[1]));
function alternativas(x, falta, max){
  const ig = new Set((CV.cfg.ignorar || []).map(s => s.toUpperCase())), rs = new Set((CV.cfg.restricoes || []).map(s => s.toUpperCase()));
  const lista = (CV.saldoItem.get(x.i) || []).filter(s => s[2] > 0 && (!rs.size || rs.has(String(s[4]).toUpperCase())) &&
    (ehOrigem(x, s) || (!ig.has(normClasse(s[3])) && (tipoClasse(s[3]) === 'pk' || CV.cfg.incluirNao))));
  lista.sort((a, b) => (ehOrigem(x, b) - ehOrigem(x, a)) || ((tipoClasse(b[3]) === 'pk') - (tipoClasse(a[3]) === 'pk')) || ((b[2] >= falta) - (a[2] >= falta)) || b[2] - a[2]);
  return lista.slice(0, max || CV.cfg.max || 5);
}
function saldoNaOrigem(x){
  const orig = new Set(x.orig.map(normLoc));
  return (CV.saldoItem.get(x.i) || []).filter(s => orig.has(normLoc(s[1]))).reduce((a, s) => a + s[2], 0);
}
function blocoLocais(x){
  const falta = x.prev - (CV.sess.bips[x.i] || 0);
  const alts = alternativas(x, falta);
  const so = saldoNaOrigem(x);
  return '<div class="cv-loc orig"><span class="rot">Coletado em</span>' + (x.orig.length ? x.orig.map(o => '<code>' + esc(o) + '</code>').join(' ') : '<span class="cv-vazio">origem não informada na QRY0180</span>') +
    (x.orig.length ? '<span class="sd">saldo disponível hoje na origem: <b>' + fInt(so) + '</b></span>' : '') + '</div>' +
    (alts.length ? alts.map((s, n) => '<div class="cv-loc"><span class="rot">' + (n ? 'Alternativa' : 'Sugestão') + '</span><code>' + esc(s[1]) + '</code><span class="cv-tp ' + (tipoClasse(s[3]) === 'pk' ? 'pk' : '') + '" title="Classe ' + esc(s[3] || '—') + '">' + tipoRot(s) + (ehOrigem(x, s) ? ' · local da coleta' : '') + '</span><span class="sd">saldo <b>' + fInt(s[2]) + '</b>' + (s[2] >= falta ? ' · cobre a falta' : ' · cobre parte') + '</span></div>').join('')
      : '<div class="cv-loc"><span class="rot">Alternativa</span><span class="cv-vazio">' + (CV.saldo.length ? (CV.cfg.incluirNao ? 'nenhum outro local com saldo disponível.' : 'nenhum outro local de picking com saldo disponível.') : 'importe a QRY0390 para ver outros locais com saldo.') + '</span></div>');
}

/* ---------- telas ---------- */
function vazio(){ return '<div class="panel"><h3>Sem dados</h3><div class="panel-sub">' + esc(CV.erro) + '</div></div>'; }
function chipEnt(){
  const m = CV.meta.ent;
  return m && m.importadoEm ? 'QRY0180 de ' + fData(m.importadoEm.slice(0, 10)) + ' · ' + fInt(CV.porEnt.size) + ' entregas' : 'QRY0180 ainda não chegou';
}
const FOTO_BASE = 'https://img.lojadomecanico.com.br/IMAGENS/';
const FOTO_SITE = 'https://img.lojadomecanico.com.br/256/';
function urlFoto(i){
  const u = CV.fotoMap && CV.fotoMap.get(i);
  if(u) return /^https?:/.test(u) ? u : FOTO_BASE + u;
  const f = fotoSiteGet(i);
  return f ? FOTO_SITE + f : '';
}
function fotoHtml(i, cls){
  const u = urlFoto(i);
  const ph = '<span class="' + cls + ' cv-semfoto" data-foto="' + esc(i) + '" title="Sem foto">▣</span>';
  if(!u) return ph;
  return '<img class="' + cls + '" data-foto="' + esc(i) + '" loading="lazy" referrerpolicy="no-referrer" src="' + esc(u) + '" alt="" onerror="this.outerHTML=\'<span class=\\\'' + cls + ' cv-semfoto\\\'>▣</span>\'">';
}
/* ---------- foto pelo site da Loja do Mecânico ----------
   Itens que não estão no cadastro De-Para: a página de busca do site (busca?q=<item>) traz o produto com
   o mesmo código do WMS (erpId) e a lista de fotos. Cada item é consultado uma vez por aparelho (e guardado). */
const FS_KEY = 'cv-foto-site', FS_NEG_DIAS = 3;
let _fs = null;
function fsCarrega(){ if(_fs) return _fs; try { _fs = JSON.parse(localStorage.getItem(FS_KEY) || '{}') || {}; } catch(e){ _fs = {}; } return _fs; }
function fsGuarda(){ try { localStorage.setItem(FS_KEY, JSON.stringify(_fs)); } catch(e){ /* cheio: segue sem guardar */ } }
function fotoSiteGet(i){ const e = fsCarrega()[i]; return e && e[0] ? e[0] : ''; }
function fotoSitePendente(i){ const e = fsCarrega()[i]; return !e || (!e[0] && Date.now() - e[1] > FS_NEG_DIAS * 864e5); }
async function buscarFotoSite(item){
  const r = await fetch('https://www.lojadomecanico.com.br/busca?q=' + encodeURIComponent(item), {referrerPolicy: 'no-referrer'});
  if(!r.ok) throw new Error('site ' + r.status);
  const h = await r.text();
  /* Só vale como "não achou" se for mesmo a página de resultados da busca; se o site pediu verificação (proteção
     contra robôs) ou veio outra coisa, é erro: não grava como sem foto e tenta de novo mais tarde. */
  if(!r.ok || /perfdrive|captcha/i.test(r.url) || h.indexOf('ldm_products') < 0) throw new Error('site indisponível para consulta');
  const m = new RegExp('"erpId":' + item.replace(/\D/g, '') + ',[\\s\\S]{0,30000}?"images":\\[("[^\\]]*)\\]').exec(h);
  if(!m) return '';
  const f = /"([^"]+)"/.exec(m[1]);
  return f ? f[1] : '';
}
let _fsFila = [], _fsRodando = 0;
function fotosDoSite(itens){
  itens.forEach(i => { if(!CV.fotoMap.has(i) && fotoSitePendente(i) && _fsFila.indexOf(i) < 0) _fsFila.push(i); });
  while(_fsRodando < 2 && _fsFila.length){
    const i = _fsFila.shift(); _fsRodando++;
    buscarFotoSite(i).then(f => { fsCarrega()[i] = [f, Date.now()]; fsGuarda(); if(f) trocarFoto(i); })
      .catch(() => { /* sem acesso ao site agora: tenta de novo na próxima entrega */ })
      .finally(() => { _fsRodando--; fotosDoSite([]); });
  }
}
/* Troca o ícone pela foto no lugar, sem redesenhar a tela. */
function trocarFoto(i){
  document.querySelectorAll('[data-foto="' + i + '"]').forEach(el => { const cls = (el.className || '').split(' ')[0]; if(cls) el.outerHTML = fotoHtml(i, cls); });
}
const ICON_SCAN = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M15 8v8M18 8v8"/></svg>';
function viewConferir(){
  if(CV.carregando) return '<p class="field-hint">Carregando as bases...</p>';
  const sess = !!CV.sess, r0 = sess ? CV.porEnt.get(CV.num)[0] : null;
  const semEan = sess ? CV.linhas.filter(x => !x.eans.length).length : 0;
  return '<div class="cv-hd"><div class="cv-hd-ic">' + ICON_SCAN + '</div><div><h1>Check Volume</h1><p>Conferência de volumes por bipagem EAN · faltas, sobras e onde achar</p></div>' +
      (sess ? '<div class="cv-chip"><div>Entrega<b>#' + esc(CV.num) + '</b></div>' + (r0.li ? '<div>Data limite<b>' + fData(r0.li) + '</b></div>' : '') + (r0.t ? '<div>Transportadora<b>' + esc(r0.t) + '</b></div>' : '') + '<span id="cvStatus"></span></div>' : '') + '</div>' +
    '<div class="cv-row0"><form class="cv-card cv-ent" onsubmit="event.preventDefault();cvSubmit()">' +
      '<div><span class="cv-lab">Entrega</span><input class="cv-in" id="cvEnt" inputmode="numeric" autocomplete="off" placeholder="Entrega" value="' + esc(CV.num) + '" oninput="cvAutoEnt(this)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();abrirEntrega(this.value)}"></div>' +
      '<div><span class="cv-lab">Bipar EAN</span><input id="cvBip" class="cv-in cv-bipin" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="7908591703801" oninput="cvAutoBip(this)" onblur="cvRefoca(this)"></div>' +
      '<button class="btn btn-primary" type="submit">' + (sess ? 'Registrar' : 'Carregar') + '</button></form><div id="cvKpis" class="cv-card cv-kp"></div></div>' +
    (semEan ? '<div class="field-hint" style="color:var(--danger)">' + semEan + ' item(ns) sem EAN cadastrado — para eles, digite o código do item no campo de bipagem.</div>' : '') +
    '<div class="cv-row1"><div id="cvTabela" class="cv-left"></div><div class="cv-right"><div id="cvBipado"></div><div id="cvAnd" class="cv-and"></div><div id="cvAcoes"></div></div></div>' +
    '<div id="cvResultado"></div><div id="cvDesc"></div>';
}
/* Enter no campo do EAN: com entrega carregada registra a leitura; sem entrega, carrega a entrega digitada. */
function cvSubmit(){
  clearTimeout(_cvAuto);
  const b = $('cvBip'), e = $('cvEnt');
  if(!CV.sess){
    const v = e.value.trim() || b.value.trim(); b.value = '';
    return abrirEntrega(v);
  }
  const v = b.value; b.value = ''; bipar(v); b.focus();
}
/* Tela de bipagem ainda sem entrega: mesma tela, zerada. */
function pintarVazio(){
  $('cvKpis').innerHTML = kpi('Total de peças', 0, '#001A72', '▣') + kpi('Bipadas', 0, '#0E7490', '✓') + kpi('Faltantes', 0, '#F59E0B', '!') + kpi('Sobras', 0, '#7E22CE', '⇄') +
    '<div class="cv-pg"><div class="t">Progresso da conferência<b>0%</b></div><div class="cv-bar"><u style="width:0"></u></div><div class="t">Informe a entrega para começar</div></div>';
  const u = CV.ult;
  $('cvBipado').innerHTML = u && u.tipo === 'ean' ? '<div class="cv-card cv-bp ean"><div class="h">? ' + esc(u.txt) + '</div></div>' : '<div class="cv-card cv-bp vazio"><div class="h">Item bipado</div><div class="c"><div class="d" style="color:var(--ink-soft)">Digite ou bipe o número da entrega e tecle Enter.</div></div></div>';
  $('cvAnd').innerHTML = '<div class="cv-card cv-tb"><h3>⟳ Conferência em andamento<s>0 leituras</s></h3><div class="cv-sc"><table class="cv-tab"><thead><tr><th>#</th><th>Hora</th><th>EAN</th><th>Descrição</th><th>Resultado</th></tr></thead><tbody><tr><td colspan="5" class="field-hint" style="padding:14px">Nenhuma leitura ainda.</td></tr></tbody></table></div></div>';
  $('cvAcoes').innerHTML = '<div class="cv-acoes">' + btnSom() + '</div><div class="cv-acoes2"><button class="btn btn-orange cv-atender" disabled title="Carregue uma entrega">⚑ Atender entrega</button><button class="cv-fin" disabled style="opacity:.45;cursor:not-allowed">Finalizar conferência</button></div>';
  $('cvTabela').innerHTML = '<div class="cv-card cv-tb"><h3>Itens da entrega<s>' + esc(chipEnt()) + '</s></h3><div class="cv-sc"><table class="cv-tab cv-compact cv-itens"><thead><tr><th>Foto</th><th>Código</th><th>Descrição</th><th>EAN</th><th class="n">Prev.</th><th class="n">Bip.</th><th class="n">Pend.</th><th>Status</th><th></th></tr></thead><tbody><tr><td colspan="9" class="field-hint" style="padding:18px">Os itens da entrega aparecem aqui.</td></tr></tbody></table></div></div>';
}
/* Descrição curta na tabela: primeira e última palavra (o texto completo fica no balão ao passar o mouse). */
function descCurta(d){
  const t = String(d || '').trim(), w = t.split(/\s+/);
  if(t.length <= 30 || w.length <= 2) return t;
  return w[0] + ' … ' + w[w.length - 1].replace(/\.+$/, '');
}
function kpi(rot, v, cor, ic){ return '<div class="cv-k"><i style="background:' + cor + '">' + ic + '</i><div><small>' + rot + '</small><b>' + fInt(v) + '</b></div></div>'; }
/* Atualiza só os pedaços que mudam a cada bipagem (o campo de leitura nunca perde o foco). */
function atualizar(){
  if(CV.tab !== 'conferir' || !$('cvKpis')) return renderView();
  if(!CV.sess) return pintarVazio();
  const t = totais(), s = CV.sess;
  const bip = Math.min(t.bip - t.sobra, t.prev);
  $('cvKpis').innerHTML = kpi('Total de peças', t.prev, '#001A72', '▣') + kpi('Bipadas', t.bip, '#0E7490', '✓') + kpi('Faltantes', t.falta, '#F59E0B', '!') + kpi('Sobras', t.sobra, '#7E22CE', '⇄') + (t.ean ? kpi('EAN não ident.', t.ean, '#C83812', '?') : '') +
    '<div class="cv-pg"><div class="t">Progresso da conferência<b>' + (t.prev ? Math.round(bip / t.prev * 100) : 0) + '%</b></div><div class="cv-bar"><u style="width:' + (t.prev ? bip / t.prev * 100 : 0) + '%"></u></div><div class="t">' + t.ok + ' de ' + t.itens + ' itens conferidos · ' + t.pend + ' pendentes</div></div>';
  $('cvStatus').innerHTML = s.fin ? '<span class="cv-pill ' + (t.falta || t.sobra || t.ean ? 'cv-falta' : 'cv-ok') + '">Finalizada</span>' : '<span class="cv-pill cv-pend">Em conferência</span>';
  // item bipado
  const u = CV.ult, xi = u && u.i ? CV.linhas.find(l => l.i === u.i) : null;
  $('cvBipado').innerHTML = xi ? '<div class="cv-card cv-bp ' + (u.tipo === 'sobra' ? 'sobra' : '') + '"><div class="h">' + (u.tipo === 'sobra' ? '⚠ Sobra — peça a mais' : '✓ Item bipado') + '</div><div class="c">' + fotoHtml(xi.i, 'cv-foto') +
      '<div><div class="e">EAN ' + esc(u.ean) + '</div><div class="d">' + esc(xi.d) + '</div><div style="margin:8px 0"><span class="cv-pill cv-' + (u.tipo === 'sobra' ? 'sobra' : (u.n >= u.prev ? 'ok' : 'falta')) + '">' + (u.n >= u.prev && u.tipo !== 'sobra' ? 'Conferido' : (u.tipo === 'sobra' ? 'Sobra' : 'Faltante')) + ' · ' + u.n + ' de ' + u.prev + '</span></div><div class="l">Local de origem<b>' + esc(xi.orig[0] || 'não informado') + '</b></div></div></div></div>'
    : (u && u.tipo === 'ean' ? '<div class="cv-card cv-bp ean"><div class="h">? EAN não identificado</div><div class="c"><div><div class="e">EAN ' + esc(u.ean) + '</div><div class="d">' + esc(u.txt.replace(/^EAN NÃO IDENTIFICADO · [^ ]+ — /, '')) + '</div></div></div></div>'
      : '<div class="cv-card cv-bp vazio"><div class="h">Item bipado</div><div class="c"><div class="d" style="color:var(--ink-soft)">' + esc(u ? u.txt : 'Aguardando a primeira leitura...') + '</div></div></div>');
  // conferência em andamento (histórico das leituras)
  const nome = i => { const l = CV.linhas.find(x => x.i === i); return l ? l.d : ''; };
  const log = s.log.slice().reverse().slice(0, 80);
  $('cvAnd').innerHTML = '<div class="cv-card cv-tb"><h3>⟳ Conferência em andamento<s>' + s.log.length + ' leituras</s></h3><div class="cv-sc"><table class="cv-tab"><thead><tr><th>#</th><th>Hora</th><th>EAN</th><th>Descrição</th><th>Resultado</th></tr></thead><tbody>' +
    (log.length ? log.map((l, k) => { const kk = l.k || (l.i ? 'ok' : 'ean'); return '<tr><td>' + (s.log.length - k) + '</td><td>' + new Date(l.t).toLocaleTimeString('pt-BR') + '</td><td class="cv-mono">' + esc(l.e || '') + '</td><td>' + (l.i ? esc(nome(l.i)) : '<span class="field-hint">— não está na entrega —</span>') + '</td><td><span class="cv-pill ' + (kk === 'ok' ? 'cv-ok' : kk === 'sobra' ? 'cv-sobra' : 'cv-falta') + '">' + (kk === 'ok' ? 'Conferido' : kk === 'sobra' ? 'Sobra' : 'EAN não ident.') + '</span></td></tr>'; }).join('') : '<tr><td colspan="5" class="field-hint" style="padding:14px">Nenhuma leitura ainda.</td></tr>') + '</tbody></table></div></div>';
  const diverge = t.falta || t.sobra || t.ean;
  $('cvAcoes').innerHTML = '<div class="cv-acoes"><button class="btn btn-secondary" onclick="cvDesfazer()">↶ Desfazer</button><button class="btn btn-secondary" onclick="cvExportar()">Exportar</button>' + btnSom() + '<button class="btn btn-danger-text" onclick="cvZerar()">Zerar</button></div><div class="cv-acoes2">' +
    '<button class="btn btn-orange cv-atender" onclick="cvAtender()"' + (diverge ? '' : ' disabled title="Entrega sem divergência"') + '>⚑ Atender entrega</button>' +
    '<button class="cv-fin" onclick="cvFinalizar()">Finalizar conferência</button></div>';
  // tabela de itens
  const ordem = {falta: 0, sobra: 1, pend: 2, ok: 3};
  const ls = CV.linhas.slice().sort((a, b) => ordem[cvSituacao(a)] - ordem[cvSituacao(b)] || a.d.localeCompare(b.d));
  $('cvTabela').innerHTML = '<div class="cv-card cv-tb"><h3>Itens da entrega<s>' + (CV.fotoMap && CV.fotoMap.size ? (n => n ? n + ' de ' + CV.linhas.length + ' itens sem foto' : 'toque numa linha com pendência para ver onde achar')(CV.linhas.filter(x => !urlFoto(x.i)).length) : 'sem fotos: a base Imagens ainda não chegou') + '</s></h3><div class="cv-sc"><table class="cv-tab cv-compact cv-itens"><thead><tr><th>Foto</th><th>Código</th><th>Descrição</th><th>EAN</th><th class="n">Prev.</th><th class="n">Bip.</th><th class="n">Pend.</th><th>Status</th><th></th></tr></thead><tbody>' +
    ls.map(x => {
      const b = s.bips[x.i] || 0, st = cvSituacao(x), pen = Math.max(x.prev - b, 0), ab = CV.aberto.has(x.i);
      return '<tr class="' + (pen ? 'clicavel ' : '') + (st === 'falta' ? 'r-falta' : st === 'sobra' ? 'r-sobra' : '') + '"' + (pen ? ' onclick="cvToggle(\'' + esc(x.i) + '\')"' : '') + '><td>' + fotoHtml(x.i, 'cv-th') + '</td><td class="cv-mono">' + esc(x.i) + '</td><td class="cv-desc" title="' + esc(x.d) + '">' + esc(descCurta(x.d)) + '</td><td class="cv-mono cv-eancol" title="' + esc(x.eans.join(' / ')) + '">' + (x.eans.length ? esc(x.eans[0]) + (x.eans.length > 1 ? ' +' + (x.eans.length - 1) : '') : '<span class="field-hint">não cadastrado</span>') + '</td>' +
        '<td class="n">' + fInt(x.prev) + '</td><td class="n"><b>' + fInt(b) + '</b></td><td class="n">' + fInt(pen) + (b > x.prev ? ' <span style="color:var(--danger)">(+' + fInt(b - x.prev) + ')</span>' : '') + '</td>' +
        '<td><span class="cv-pill cv-' + st + '">' + ROT[st] + '</span></td><td class="n">' + (b ? '<button class="btn-link" onclick="event.stopPropagation();cvMenos(\'' + esc(x.i) + '\')" title="Tirar uma bipagem">−1</button>' : '') + '</td></tr>' +
        (pen && ab ? '<tr class="cv-det"><td colspan="9"><b>Faltam ' + fInt(pen) + '</b> — onde achar:' + blocoLocais(x) + '</td></tr>' : '');
    }).join('') + '</tbody></table></div></div>';
  const dk = Object.keys(s.desc);
  $('cvDesc').innerHTML = dk.length ? '<div class="cv-sec-t">EAN não identificado<span>códigos bipados que não são desta entrega</span></div><div class="table-wrap"><table class="cv-tab"><thead><tr><th>EAN bipado</th><th>Observação</th><th class="n">Leituras</th></tr></thead><tbody>' +
    dk.map(k => '<tr><td class="cv-mono">' + esc(k) + '</td><td>' + (s.desc[k].nome ? 'Pertence a outro produto: ' + esc(s.desc[k].nome) : 'Não cadastrado em nenhum item da QRY0390') + '</td><td class="n"><b>' + s.desc[k].n + '</b></td></tr>').join('') + '</tbody></table></div>' : '';
  $('cvResultado').innerHTML = s.fin ? resultado(t) : '';
}
function resultado(t){
  const ok = !t.falta && !t.sobra && !t.ean;
  const faltas = CV.linhas.filter(x => (CV.sess.bips[x.i] || 0) < x.prev);
  const sobras = CV.linhas.filter(x => (CV.sess.bips[x.i] || 0) > x.prev);
  let h = '';
  if(faltas.length) h += '<div class="cv-sec-t">Faltantes — onde buscar<span>origem da coleta e locais com saldo (picking primeiro)</span></div>' + faltas.map(x => {
    const f = x.prev - (CV.sess.bips[x.i] || 0);
    return '<div class="cv-falta-card"><span class="qtd">faltam ' + fInt(f) + '</span><h4>' + esc(x.i) + ' — ' + esc(x.d) + '</h4><div class="sub">Prevista ' + fInt(x.prev) + ' · bipada ' + fInt(CV.sess.bips[x.i] || 0) + '</div>' + blocoLocais(x) + '</div>';
  }).join('');
  if(sobras.length) h += '<div class="cv-sec-t">Sobras<span>peças a mais do que o previsto</span></div><div class="table-wrap"><table class="cv-tab"><tbody>' + sobras.map(x => '<tr><td class="cv-mono">' + esc(x.i) + '</td><td>' + esc(x.d) + '</td><td class="n"><b>+' + fInt(CV.sess.bips[x.i] - x.prev) + '</b></td></tr>').join('') + '</tbody></table></div>';
  return h + '<div class="cv-acoes" style="margin-top:12px"><button class="btn btn-secondary" onclick="cvReabrir()">Reabrir conferência</button><button class="btn btn-secondary" onclick="cvNova()">Conferir outra entrega</button></div>';
}

function statusEnt(n){
  try { const o = JSON.parse(localStorage.getItem(sessKey(n)) || 'null'); if(!o) return ''; return o.fin ? 'Finalizada' : (Object.keys(o.bips).length || Object.keys(o.desc).length ? 'Em conferência' : ''); } catch(e){ return ''; }
}
function viewEntregas(){
  if(CV.carregando) return '<p class="field-hint">Carregando...</p>';
  const POR = 50, q = CV.busca.trim().toLowerCase();
  let lista = Array.from(CV.porEnt.entries()).map(([e, rs]) => ({e, rs, t: rs[0].t, ev: rs[0].ev, li: rs[0].li, pecas: rs.reduce((a, r) => a + r.q, 0), itens: new Set(rs.map(r => r.i)).size}));
  if(q) lista = lista.filter(o => o.e.includes(q) || (o.t || '').toLowerCase().includes(q) || (o.ev || '').toLowerCase().includes(q));
  const pags = Math.max(1, Math.ceil(lista.length / POR)); if(CV.pag >= pags) CV.pag = pags - 1;
  return '<div class="filter-bar"><input type="text" id="cvBusca" placeholder="Buscar entrega, transportadora ou evento..." value="' + esc(CV.busca) + '" oninput="cvBuscaEnt(this.value)"><span class="field-hint">' + fInt(lista.length) + ' entregas · ' + esc(chipEnt()) + '</span></div>' +
    '<div class="table-wrap"><table class="cv-tab cv-compact"><thead><tr><th>Entrega</th><th>Transportadora</th><th>Evento</th><th>Limite</th><th class="n">Itens</th><th class="n">Peças</th><th>Conferência</th><th></th></tr></thead><tbody>' +
    lista.slice(CV.pag * POR, CV.pag * POR + POR).map(o => { const st = statusEnt(o.e); return '<tr><td class="cv-mono"><b>' + esc(o.e) + '</b></td><td>' + esc(o.t) + '</td><td>' + esc(o.ev) + '</td><td>' + fData(o.li) + '</td><td class="n">' + o.itens + '</td><td class="n">' + fInt(o.pecas) + '</td><td>' + (st ? '<span class="cv-pill ' + (st === 'Finalizada' ? 'cv-ok' : 'cv-pend') + '">' + st + '</span>' : '<span class="field-hint">—</span>') + '</td><td class="n"><button class="btn btn-secondary btn-sm" onclick="abrirEntrega(\'' + esc(o.e) + '\')">Conferir</button></td></tr>'; }).join('') + '</tbody></table></div>' +
    (pags > 1 ? '<div class="cv-pag"><button class="btn btn-secondary" onclick="cvPag(-1)"' + (CV.pag === 0 ? ' disabled' : '') + '>←</button><span>Página ' + (CV.pag + 1) + ' de ' + pags + '</span><button class="btn btn-secondary" onclick="cvPag(1)"' + (CV.pag >= pags - 1 ? ' disabled' : '') + '>→</button></div>' : '');
}
/* Uma linha do quadro "Bases conectadas": de qual query veio e quando chegou. */
function linhaBase(cod, nome, m, det){
  const ok = !!m;
  const quando = ok && m.importadoEm ? fData(m.importadoEm.slice(0, 10)) + ' ' + new Date(m.importadoEm).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}) : '';
  return '<tr><td class="cv-mono"><b>' + cod + '</b></td><td>' + nome + '</td>' +
    '<td>' + (ok ? '<span class="cv-pill cv-ok">Conectada</span>' : '<span class="cv-pill cv-pend">Aguardando</span>') + '</td>' +
    '<td>' + (quando || '—') + '</td><td class="n">' + (ok ? det : '—') + '</td></tr>';
}
/* Quantos itens das entregas importadas têm foto no cadastro. */
function coberturaFotos(){
  if(CV._cob && CV._cobKey === CV.ent.length + '|' + (CV.fotoMap ? CV.fotoMap.size : 0)) return CV._cob;
  const it = new Set(CV.ent.map(r => r.i)); let c = 0;
  it.forEach(i => { if(CV.fotoMap && CV.fotoMap.has(i)) c++; });
  CV._cobKey = CV.ent.length + '|' + (CV.fotoMap ? CV.fotoMap.size : 0);
  return (CV._cob = {t: it.size, c});
}
function painelBases(){
  const e = CV.meta.ent, s = CV.meta.est, f = CV.meta.foto, n = CV.meta.ean;
  return '<div class="panel"><h3>Bases conectadas</h3><div class="panel-sub">Chegam sozinhas das queries da pasta Bases (Almoxarifado da Oficina).</div>' +
    '<div class="table-wrap"><table class="cv-tab cv-compact"><thead><tr><th>Query</th><th>Base</th><th>Situação</th><th>Atualizada em</th><th class="n">Tamanho</th></tr></thead><tbody>' +
    linhaBase('QRY0180', 'Pedidos', e, e ? fInt(e.entregas) + ' entregas' : '') +
    linhaBase('QRY0390', 'Estoque', s, s ? fInt(s.locais) + ' saldos' : '') +
    linhaBase('SIGEQ230', 'EANs por item', n, n ? fInt(n.eans) + ' EANs' : '') +
    linhaBase('Imagens', 'Fotos dos itens', f, f ? fInt(f.itens) + ' itens' : '') +
    '</tbody></table></div>' +
    (CV.erroImp ? '<div class="cv-res div">⚠ ' + esc(CV.erroImp) + '</div>' : '') +
    '<div class="cv-msg" id="cvMsg">' + (CV.ocupado ? '⏳ ' + esc(CV.msg) : '') + '</div>' +
    '<details class="cv-gap"><summary class="field-hint" style="cursor:pointer">Emergência: importar um arquivo à mão</summary>' +
    '<label class="btn btn-secondary btn-sm" style="margin-top:8px">Escolher arquivo<input type="file" accept=".xlsx,.xls" multiple hidden onchange="importar(Array.from(this.files)); this.value=\'\'"></label></details></div>';
}
function viewConfig(){
  return painelBases() + '<div class="panel cv-gap"><h3>Classes de local ignoradas nas sugestões</h3><div class="panel-sub">Coluna <code>CLAL</code> da QRY0390, separadas por vírgula. Locais dessas classes (ex.: reversa e avaria) não são sugeridos.</div><div class="filter-bar"><input type="text" id="cfgIg" value="' + esc(CV.cfg.ignorar.join(', ')) + '"></div></div>' +
    '<div class="panel cv-gap"><h3>Restrições aceitas</h3><div class="panel-sub">Coluna <code>RETRICAO</code> da QRY0390. Só saldo com essas restrições é sugerido (padrão <code>WN</code> = normal). Em branco = aceita todas.</div><div class="filter-bar"><input type="text" id="cfgRs" value="' + esc(CV.cfg.restricoes.join(', ')) + '"></div></div>' +
    '<div class="panel cv-gap"><h3>Classes de picking (locais de coleta)</h3><div class="panel-sub">Coluna <code>CLAL</code> da QRY0390, separadas por vírgula. Só locais dessas classes são sugeridos. Mesmas classes do Inventário Rotativo.</div><div class="filter-bar"><input type="text" id="cfgPk" value="' + esc((CV.cfg.clPicking || CL_PICKING).join(', ')) + '"></div></div>' +
    '<div class="panel cv-gap"><h3>Classes que não são picking</h3><div class="filter-bar"><input type="text" id="cfgNao" value="' + esc((CV.cfg.clNao || CL_NAO).join(', ')) + '"></div>' +
    '<label class="cv-chk"><input type="checkbox" id="cfgInc"' + (CV.cfg.incluirNao ? ' checked' : '') + '> Sugerir também locais não picking (depois do picking)</label></div>' +
    '<div class="panel cv-gap"><h3>Quantidade de sugestões por item</h3><div class="filter-bar"><input type="number" min="1" max="20" id="cfgMax" value="' + (CV.cfg.max || 5) + '"></div></div>' +
    '<div class="cv-gap"><button class="btn btn-orange" onclick="cvSalvarCfg()">Salvar configurações</button></div>';
}
async function cvSalvarCfg(){
  CV.cfg.ignorar = String($('cfgIg').value).toUpperCase().split(/[,;\s]+/).filter(Boolean);
  CV.cfg.restricoes = String($('cfgRs').value).toUpperCase().split(/[,;\s]+/).filter(Boolean);
  CV.cfg.clPicking = String($('cfgPk').value).toUpperCase().split(/[,;\s]+/).filter(Boolean);
  if(!CV.cfg.clPicking.length) CV.cfg.clPicking = CL_PICKING.slice();
  CV.cfg.clNao = String($('cfgNao').value).toUpperCase().split(/[,;\s]+/).filter(Boolean);
  CV.cfg.incluirNao = !!$('cfgInc').checked;
  CV.cfg.max = Math.min(Math.max(parseInt($('cfgMax').value, 10) || 5, 1), 20);
  try { await nuvemGravar('cfg', null, {cfg: CV.cfg}, []); toast('Configurações salvas.'); } catch(e){ toast(e.message || String(e), true); }
  renderView();
}

/* ---------- Controle de Entregas (divergências apontadas) ---------- */
/* Cada ocorrência é uma linha própria em app_dados (chave 'ctrl', versão = id): várias pessoas
   registram ao mesmo tempo sem sobrescrever o trabalho umas das outras. */
const TIPOS = ['Falta', 'Sobra', 'Inversão', 'EAN não identificado', 'Avaria', 'Item não localizado', 'Pedido correto', 'Outro'];
const TIPO_COR = {'Falta': 'var(--tp1)', 'Sobra': 'var(--tp2)', 'Item não localizado': 'var(--tp3)', 'Avaria': 'var(--tp4)', 'EAN não identificado': 'var(--tp5)', 'Pedido correto': 'var(--tp6)', 'Inversão': 'var(--tp7)', 'Outro': 'var(--tp8)'};
/* Gestão por entrega: classificação da divergência e andamento da tratativa. */
const CLASSES = ['A classificar', 'Falta', 'Sobra', 'Inversão', 'Avaria', 'Pedido correto', 'Outro'];
const STATUS_TR = ['Aberta', 'Em tratativa', 'Aguardando retorno', 'Resolvida'];
const STATUS_COR = {'Aberta': '#F59E0B', 'Em tratativa': '#0E7490', 'Aguardando retorno': '#7E22CE', 'Resolvida': '#1F8A52'};
async function ctrlLer(chave){
  chave = chave || 'ctrl';
  const out = []; let a = 0;
  while(true){
    const { data, error } = await cvSupa.from(CV_TAB).select('versao,dados').eq('app', CV_APP).eq('chave', chave).eq('parte', 0).order('versao').range(a, a + 999);
    if(error) throw error;
    (data || []).forEach(r => { if(r.dados) out.push(r.dados); });
    if(!data || data.length < 1000) break;
    a += 1000;
  }
  return out;
}
async function ctrlSalvar(reg, chave){
  chave = chave || 'ctrl';
  if(somenteLeitura()) throw new Error('Seu acesso é só de visualização.');
  await cvSupa.from(CV_TAB).delete().eq('app', CV_APP).eq('chave', chave).eq('versao', reg.id).eq('parte', 0);
  const { error } = await cvSupa.from(CV_TAB).insert({app: CV_APP, chave, versao: reg.id, parte: 0, dados: reg});
  if(error){ const e = new Error(error.message || 'erro ao gravar'); e.code = error.code; e.conflito = error.code === '23505' || /duplicate|unique/i.test(error.message || ''); throw e; }
  const lista = chave === 'conf' ? CV.conf : chave === 'trat' ? CV.trat : chave === 'and' ? CV.and : chave === 'atd' ? CV.atd : CV.ctrl, i = lista.findIndex(c => c.id === reg.id);
  if(i >= 0) lista[i] = reg; else lista.push(reg);
}
async function ctrlExcluir(id, chave){
  chave = chave || 'ctrl';
  if(somenteLeitura()) throw new Error('Seu acesso é só de visualização.');
  const { error } = await cvSupa.from(CV_TAB).delete().eq('app', CV_APP).eq('chave', chave).eq('versao', id).eq('parte', 0);
  if(error) throw error;
  if(chave === 'and') CV.and = CV.and.filter(c => c.id !== id); else CV.ctrl = CV.ctrl.filter(c => c.id !== id);
}
/* Lê um registro direto da nuvem (a cópia da tela pode estar velha se outra pessoa mexeu). */
async function ctrlLerUm(chave, id){
  const { data, error } = await cvSupa.from(CV_TAB).select('dados').eq('app', CV_APP).eq('chave', chave).eq('versao', id).eq('parte', 0).limit(1);
  if(error) throw error;
  return (data && data[0] && data[0].dados) || null;
}
/* Altera só os campos pedidos sobre a versão MAIS RECENTE da nuvem: não apaga o que outra pessoa mudou nesse meio tempo. */
async function ctrlAtualiza(chave, id, campos){
  const lista = chave === 'conf' ? CV.conf : chave === 'trat' ? CV.trat : chave === 'and' ? CV.and : chave === 'atd' ? CV.atd : CV.ctrl;
  const conteudo = Object.keys(campos).filter(k => k !== 'upd' && k !== 'por' && k !== 'ent');   /* horário e autor da gravação sempre diferem entre duas pessoas */
  for(let t = 0; t < 4; t++){
    let ult = null;
    try { ult = await ctrlLerUm(chave, id); } catch(e){ /* sem rede para ler: usa a cópia da tela */ }
    ult = ult || lista.find(c => c.id === id) || {};
    try { await ctrlSalvar(Object.assign({}, ult, campos, {id}), chave); }
    catch(e){ if(e.conflito && t < 3) continue; throw e; }   /* outra pessoa gravou agora: lê a versão dela e soma */
    /* Confere um instante depois: se duas pessoas gravaram quase juntas, a última pode ter apagado a outra — regrava somando as duas. */
    await new Promise(r => setTimeout(r, 500));
    let conf = null;
    try { conf = await ctrlLerUm(chave, id); } catch(e){ return; }
    if(!conf || conteudo.every(k => JSON.stringify(conf[k]) === JSON.stringify(campos[k]))) return;
  }
}
/* Cada conferência finalizada vira um registro (chave 'conf', um por entrega): é a base da taxa de acerto,
   do tempo de conferência e da comparação entre mecas e conferentes no Dashboard. */
async function confRegistrar(){
  if(somenteLeitura() || !CV.sess || !CV.porEnt.get(CV.num)) return;
  const s = CV.sess, r0 = CV.porEnt.get(CV.num)[0], t = totais();
  if(!s.log.length) return;                                 /* finalizou sem bipar nada: não conta */
  const ts = s.log.map(l => l.t), ini = Math.min.apply(null, ts), fim = Math.max.apply(null, ts);
  const antes = CV.conf.find(c => c.id === CV.num);
  const reg = {id: CV.num, ts: new Date().toISOString(), por: CV.email, ent: CV.num, t: r0.t || '', meca: mecaEntrega(CV.porEnt.get(CV.num)), ca: r0.ca || '', mo: r0.mo || '',
    itens: t.itens, pecas: t.prev, bip: t.bip, falta: t.falta, sobra: t.sobra, ean: t.ean, div: !!(t.falta || t.sobra || t.ean), dur: Math.round((fim - ini) / 1000), leituras: s.log.length};
  if(antes && antes.por && antes.por !== reg.por) reg.por = antes.por;
  await ctrlSalvar(reg, 'conf');
}
/* Ao finalizar uma conferência, as divergências viram ocorrências (sem duplicar se finalizar de novo). */
async function ctrlDaConferencia(){
  if(somenteLeitura() || !CV.sess || !CV.porEnt.get(CV.num)) return 0;
  const s = CV.sess, rows0 = CV.porEnt.get(CV.num), r0 = rows0[0], agora = new Date().toISOString(), novos = [];
  CV.linhas.forEach(x => {
    const b = s.bips[x.i] || 0;
    if(b < x.prev) novos.push({tipo: 'Falta', item: x.i, d: x.d, q: x.prev - b, orig: x.orig.join(' / '), prev: x.prev, bip: b});
    else if(b > x.prev) novos.push({tipo: 'Sobra', item: x.i, d: x.d, q: b - x.prev, orig: x.orig.join(' / '), prev: x.prev, bip: b});
  });
  Object.keys(s.desc).forEach(k => novos.push({tipo: 'EAN não identificado', item: k, d: s.desc[k].nome || '', q: s.desc[k].n, orig: ''}));
  const ids = new Set();
  for(const n of novos){
    const id = [CV.num, n.tipo === 'EAN não identificado' ? 'EAN' : n.tipo, n.item].join('|'); ids.add(id);
    const ant = CV.ctrl.find(c => c.id === id);
    if(ant && ant.q === n.q) continue;
    await ctrlSalvar(Object.assign({}, ant || {}, {id, ts: ant ? ant.ts : agora, por: ant ? ant.por : CV.email, ent: CV.num, item: n.item, d: n.d, tipo: n.tipo, q: n.q, orig: n.orig, t: r0.t || '', meca: (n.item && mecaDoItem(rows0, n.item)) || mecaEntrega(rows0), prev: n.prev, bip: n.bip, ca: r0.ca || '', mo: r0.mo || '', src: 'conferencia', st: ant ? ant.st : 'aberta', obs: ant ? (ant.obs || '') : ''}));
  }
  for(const c of CV.ctrl.filter(c => c.ent === CV.num && c.src === 'conferencia' && c.st === 'aberta' && !ids.has(c.id))) await ctrlExcluir(c.id);
  return novos.length;
}
const mecaNome = m => String(m || '').replace(/^MECA_/i, '') || 'Sem meca';
/* Meca = operador MECA_* da linha da QRY0180 (coluna OPERADOR). Usuários de sistema (ex.: NDD) não contam. */
const ehMeca = o => /^MECA_/i.test(o || '');
function mecaEntrega(rows){
  const m = new Map(); (rows || []).forEach(r => { if(ehMeca(r.op)) m.set(r.op, (m.get(r.op) || 0) + 1); });
  let best = '', n = 0; m.forEach((v, k) => { if(v > n){ n = v; best = k; } }); return best;
}
function mecaDoItem(rows, item){ const r = (rows || []).find(x => x.i === item && ehMeca(x.op)); return r ? r.op : ''; }
/* Registros antigos sem meca: completa pela QRY0180 importada (item primeiro, depois a entrega). */
function mecaDoReg(c){
  if(ehMeca(c.meca)) return c.meca;
  const rows = CV.porEnt.get(c.ent);
  return (c.item && mecaDoItem(rows, c.item)) || mecaEntrega(rows) || '';
}
const dtBR = iso => iso ? fData(iso.slice(0, 10)) + ' ' + iso.slice(11, 16) : '';
const hojeISO = () => new Date().toISOString().slice(0, 10);
function cvCNovo(){ CV.cnovo = !CV.cnovo; renderView(); }
function achaCtrl(id){ return CV.ctrl.find(c => c.id === id); }
async function cvCSalvarNovo(){
  const ent = String($('cnEnt').value).replace(/\D/g, ''), item = $('cnItem').value.trim(), tipo = $('cnTipo').value, q = Math.max(1, parseInt($('cnQtd').value, 10) || 1);
  if(!ent) return toast('Informe a entrega.', true);
  const rows = CV.porEnt.get(ent) || [], r = item ? rows.find(x => x.i === item) : null;
  const reg = {id: 'M|' + Date.now() + '|' + Math.random().toString(36).slice(2, 6), ts: new Date().toISOString(), por: CV.email, ent, item, d: r ? r.d : ((CV.itens[item] && CV.itens[item].d) || ''), tipo, q, orig: $('cnOrig').value.trim() || (r ? r.o : ''), t: rows[0] ? rows[0].t : '', meca: (item && mecaDoItem(rows, item)) || mecaEntrega(rows), ca: rows[0] ? (rows[0].ca || '') : '', mo: rows[0] ? (rows[0].mo || '') : '', src: 'manual', st: 'aberta', obs: $('cnObs').value.trim()};
  try { await ctrlSalvar(reg); CV.cnovo = false; toast('Ocorrência registrada.'); } catch(e){ toast((e && e.message) || String(e), true); }
  renderView();
}
async function cvCTipo(id, tipo){
  const c = achaCtrl(id); if(!c || c.tipo === tipo) return;
  try { await ctrlAtualiza('ctrl', id, {tipo}); } catch(e){ toast((e && e.message) || String(e), true); }
  renderView();
}
async function cvCAtender(id){
  const c = achaCtrl(id); if(!c) return;
  const at = c.st !== 'atendida';
  try { await ctrlAtualiza('ctrl', id, {st: at ? 'atendida' : 'aberta', at: at ? new Date().toISOString() : '', atpor: at ? CV.email : ''}); } catch(e){ toast((e && e.message) || String(e), true); }
  renderView();
}
async function cvCObs(id){
  const c = achaCtrl(id); if(!c) return;
  const v = prompt('Observação:', c.obs || ''); if(v === null) return;
  try { await ctrlAtualiza('ctrl', id, {obs: v.trim()}); } catch(e){ toast((e && e.message) || String(e), true); }
  renderView();
}
async function cvCExcluir(id){
  if(!achaCtrl(id) || !confirm('Excluir esta ocorrência?')) return;
  try { await ctrlExcluir(id); } catch(e){ toast((e && e.message) || String(e), true); }
  renderView();
}
/* ---------- Gestão de divergências: uma linha por entrega divergente ---------- */
const sq = v => String(v == null ? '' : v).replace(/'/g, '');
function classeAuto(ocs){
  const t = new Set(ocs.map(c => c.tipo));
  const base = ['Falta', 'Sobra'].filter(x => t.has(x));
  if(base.length === 1 && t.size === 1) return base[0];
  if(t.size === 1) return Array.from(t)[0];
  return 'A classificar';
}
/* Junta as ocorrências por entrega e as tratativas gravadas. */
function entregasDiv(){
  const m = new Map(), tr = new Map(CV.trat.map(t => [t.id, t]));
  CV.ctrl.forEach(c => { let g = m.get(c.ent); if(!g) m.set(c.ent, g = {ent: c.ent, ocs: [], t: c.t || '', meca: mecaDoReg(c), ts: c.ts}); g.ocs.push(c); if(c.ts < g.ts) g.ts = c.ts; if(!g.t && c.t) g.t = c.t; if(!g.meca) g.meca = mecaDoReg(c); });
  return Array.from(m.values()).map(g => {
    const t = tr.get(g.ent) || {};
    g.tr = t; g.classe = t.classe || classeAuto(g.ocs);
    g.st = t.st || (g.ocs.every(c => c.st === 'atendida') ? 'Resolvida' : 'Aberta');
    g.q = g.ocs.reduce((a, c) => a + (c.q || 0), 0); g.itens = new Set(g.ocs.map(c => c.item)).size;
    return g;
  }).sort((a, b) => b.ts.localeCompare(a.ts));
}
function gFiltradas(){
  const f = CV.gf, q = f.busca.trim().toLowerCase();
  return entregasDiv().filter(g => (!f.st || (f.st === 'abertas' ? g.st !== 'Resolvida' : g.st === f.st)) && (!f.classe || g.classe === f.classe) &&
    (!q || [g.ent, g.t, g.meca, g.classe, g.tr.resp, g.tr.trat].join(' ').toLowerCase().indexOf(q) >= 0));
}
function viewGestao(){
  if(CV.carregando) return '<p class="field-hint">Carregando...</p>';
  const ro = somenteLeitura(), todas = entregasDiv(), lista = gFiltradas();
  const nAb = todas.filter(g => g.st !== 'Resolvida').length;
  const chip = (v, t) => '<button class="chip' + (CV.gf.st === v ? ' active' : '') + '" onclick="cvGF(\'st\',\'' + v + '\')">' + t + '</button>';
  let h = '<div class="filter-bar cv-fb">' + chip('', 'Todas · ' + todas.length) + chip('abertas', 'Em aberto · ' + nAb) + STATUS_TR.map(st => chip(st, st + ' · ' + todas.filter(g => g.st === st).length)).join('') +
    '<select class="cv-in-s" onchange="cvGF(\'classe\',this.value)"><option value="">Todas as classificações</option>' + CLASSES.map(c => '<option' + (CV.gf.classe === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select>' +
    '<input type="text" id="cvGBusca" class="cv-in-s" style="flex:1;min-width:180px" placeholder="Buscar entrega, transportadora, meca, responsável..." value="' + esc(CV.gf.busca) + '" oninput="cvGBusca(this.value)">' +
    (ro ? '' : '<button class="btn btn-orange btn-sm" onclick="cvCNovo()">+ Nova ocorrência</button>') + '<button class="btn btn-secondary btn-sm" onclick="cvGExportar()">Exportar</button></div>';
  if(CV.cnovo && !ro){
    h += '<div class="cv-card cv-novo"><div><span class="cv-lab">Entrega</span><input id="cnEnt" class="cv-in-s" inputmode="numeric"></div><div><span class="cv-lab">Item (código)</span><input id="cnItem" class="cv-in-s" placeholder="opcional"></div>' +
      '<div><span class="cv-lab">Tipo</span><select id="cnTipo" class="cv-in-s">' + TIPOS.map(t => '<option' + (t === 'Avaria' ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div><div><span class="cv-lab">Qtd</span><input id="cnQtd" type="number" min="1" value="1" class="cv-in-s" style="width:70px"></div>' +
      '<div><span class="cv-lab">Local</span><input id="cnOrig" class="cv-in-s" placeholder="opcional"></div><div style="flex:1;min-width:200px"><span class="cv-lab">Observação</span><input id="cnObs" class="cv-in-s" style="width:100%"></div>' +
      '<button class="btn btn-orange btn-sm" onclick="cvCSalvarNovo()">Registrar</button><button class="btn btn-secondary btn-sm" onclick="cvCNovo()">Cancelar</button></div>';
  }
  h += '<div class="table-wrap"><table class="cv-tab cv-compact cv-gtab"><thead><tr><th></th><th>Entrega</th><th>Data</th><th>Transportadora</th><th>Meca</th><th class="n">Itens</th><th>Divergências</th><th class="n">Peças</th><th>Classificação</th><th>Status da tratativa</th><th>Responsável</th><th>Tratativa</th><th class="n">Idade</th></tr></thead><tbody>' +
    (lista.length ? lista.map(g => {
      const e = sq(g.ent), aberto = CV.gaberta.has(g.ent), cont = {};
      g.ocs.forEach(c => { cont[c.tipo] = (cont[c.tipo] || 0) + (c.q || 0); });
      const sel = (opts, atual, campo, cor) => ro ? '<span class="cv-pill" style="background:' + cor + '">' + esc(atual) + '</span>' : '<select class="cv-in-s cv-tipo-s" style="border-color:' + cor + '" onchange="cvGSet(\'' + e + '\',\'' + campo + '\',this.value)">' + opts.map(o => '<option' + (o === atual ? ' selected' : '') + '>' + o + '</option>').join('') + '</select>';
      const txt = (campo, v, rot) => ro ? esc(v || '') : '<span class="cv-edit" title="' + esc(v || 'Clique para editar') + '" onclick="cvGTexto(\'' + e + '\',\'' + campo + '\',\'' + rot + '\')">' + (v ? esc(v.length > 40 ? v.slice(0, 40) + '…' : v) : '<span class="field-hint">+ ' + rot.toLowerCase() + '</span>') + '</span>';
      return '<tr class="' + (g.st === 'Resolvida' ? 'g-ok' : '') + '"><td class="n" style="white-space:nowrap"><button class="btn-link" onclick="cvGAbre(\'' + e + '\')">' + (aberto ? '▾' : '▸') + '</button><button class="btn-link" title="Atender entrega (celular)" onclick="cvGAtender(\'' + e + '\')">📱</button></td><td class="cv-mono"><b>' + esc(g.ent) + '</b></td><td>' + fData(g.ts.slice(0, 10)) + '</td><td class="cv-cut">' + esc(g.t) + '</td><td class="cv-cut">' + esc(mecaNome(g.meca)) + '</td>' +
        '<td class="n">' + (g.itens > 1 ? '<b>' + g.itens + '</b>' : g.itens) + '</td><td>' + Object.keys(cont).map(t => '<span class="cv-pill" style="background:' + (TIPO_COR[t] || '#001A72') + '" title="' + esc(t) + '">' + esc(t.replace('EAN não identificado', 'EAN')) + ' ' + cont[t] + '</span>').join(' ') + '</td><td class="n"><b>' + fInt(g.q) + '</b></td>' +
        '<td>' + sel(CLASSES, g.classe, 'classe', TIPO_COR[g.classe] || '#6B7280') + '</td><td>' + sel(STATUS_TR, g.st, 'st', STATUS_COR[g.st]) + '</td><td class="cv-cut">' + txt('resp', g.tr.resp, 'Responsável') + '</td><td class="cv-cut" style="max-width:240px">' + txt('trat', g.tr.trat, 'Tratativa') + '</td><td class="n">' + (g.st === 'Resolvida' ? '—' : diasDesde(g.ts) + ' d') + '</td></tr>' +
        (aberto ? '<tr class="cv-det"><td></td><td colspan="12"><table class="cv-tab cv-compact"><thead><tr><th>Item</th><th>Descrição</th><th>Tipo</th><th class="n">Qtd</th><th>Local</th><th>Observação</th><th>Status</th><th></th></tr></thead><tbody>' + g.ocs.map(c => { const id = sq(c.id); return '<tr><td class="cv-mono">' + esc(c.item || '') + '</td><td class="cv-cut" title="' + esc(c.d || '') + '">' + esc(c.d || '') + '</td>' +
          '<td>' + (ro ? '<span class="cv-pill" style="background:' + (TIPO_COR[c.tipo] || '#001A72') + '">' + esc(c.tipo) + '</span>' : '<select class="cv-in-s cv-tipo-s" style="border-color:' + (TIPO_COR[c.tipo] || '#001A72') + '" onchange="cvCTipo(\'' + id + '\',this.value)">' + TIPOS.map(t => '<option' + (t === c.tipo ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>') + '</td><td class="n"><b>' + fInt(c.q) + '</b></td><td>' + esc(c.orig || '') + '</td><td class="cv-cut" title="' + esc(c.obs || '') + '">' + esc(c.obs || '') + '</td>' +
          '<td><span class="cv-pill ' + (c.st === 'atendida' ? 'cv-ok' : 'cv-falta') + '">' + (c.st === 'atendida' ? 'Atendida' : 'Aberta') + '</span></td><td class="n cv-act">' + (ro ? '' : '<button class="btn-link" onclick="cvCAtender(\'' + id + '\')">' + (c.st === 'atendida' ? 'Reabrir' : 'Atender') + '</button> <button class="btn-link" onclick="cvCObs(\'' + id + '\')">Obs</button> <button class="btn-danger-text" onclick="cvCExcluir(\'' + id + '\')">Excluir</button>') + '</td></tr>'; }).join('') + '</tbody></table></td></tr>' : '');
    }).join('') : '<tr><td colspan="13" class="field-hint" style="padding:16px">Nenhuma entrega divergente. Elas aparecem aqui quando uma conferência é finalizada com divergência.</td></tr>') + '</tbody></table></div>';
  return h;
}
function cvGF(k, v){ CV.gf[k] = v; renderView(); }
let _cvGB; function cvGBusca(v){ CV.gf.busca = v; clearTimeout(_cvGB); _cvGB = setTimeout(() => { renderView(); const i = $('cvGBusca'); if(i){ i.focus(); i.setSelectionRange(v.length, v.length); } }, 250); }
function cvGAbre(e){ if(CV.gaberta.has(e)) CV.gaberta.delete(e); else CV.gaberta.add(e); renderView(); }
/* Grava a tratativa da entrega (um registro por entrega, chave 'trat'). */
async function gSalvar(ent, campos){
  await ctrlAtualiza('trat', ent, Object.assign({}, campos, {ent, upd: new Date().toISOString(), por: CV.email}));
}
async function cvGSet(ent, campo, valor){
  const g = entregasDiv().find(x => x.ent === ent); if(!g) return;
  try {
    const eraResolvida = g.st === 'Resolvida';
    await gSalvar(ent, campo === 'st' && valor === 'Resolvida' ? {st: valor, resolvida: new Date().toISOString()} : {[campo]: valor});
    /* Resolver a entrega atende todas as ocorrências dela; reabrir devolve para aberta. */
    if(campo === 'st' && (valor === 'Resolvida') !== eraResolvida){
      for(const c of g.ocs) await ctrlAtualiza('ctrl', c.id, {st: valor === 'Resolvida' ? 'atendida' : 'aberta', at: valor === 'Resolvida' ? new Date().toISOString() : '', atpor: valor === 'Resolvida' ? CV.email : ''});
    }
  } catch(e){ toast((e && e.message) || String(e), true); }
  renderView();
}
async function cvGTexto(ent, campo, rot){
  const t = CV.trat.find(x => x.id === ent) || {};
  const v = prompt(rot + ' da entrega ' + ent + ':', t[campo] || ''); if(v === null) return;
  try { await gSalvar(ent, {[campo]: v.trim()}); } catch(e){ toast((e && e.message) || String(e), true); }
  renderView();
}
function cvGExportar(){
  if(!window.XLSX) return toast('Biblioteca de Excel ainda carregando, tente de novo.', true);
  const l = [['Entrega', 'Data', 'Transportadora', 'Meca', 'Classificação', 'Status da tratativa', 'Responsável', 'Tratativa', 'Itens', 'Peças', 'Divergências', 'Idade (dias)']];
  gFiltradas().forEach(g => l.push([g.ent, fData(g.ts.slice(0, 10)), g.t, mecaNome(g.meca), g.classe, g.st, g.tr.resp || '', g.tr.trat || '', g.itens, g.q, g.ocs.map(c => c.tipo + ' ' + c.q).join(' · '), g.st === 'Resolvida' ? '' : diasDesde(g.ts)]));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, planilha(l, [12, 11, 22, 22, 16, 18, 20, 44, 7, 7, 40, 11]), 'Gestão de divergências');
  XLSX.writeFile(wb, 'gestao-de-divergencias.xlsx');
}

/* ---------- Registro de conferências: toda entrega bipada, com ou sem divergência ---------- */
/* Conferências ainda não finalizadas ficam no aparelho (localStorage): entram na lista como "Em andamento". */
function sessoesAbertas(){
  const out = CV.and.map(a => ({id: a.id, ts: a.upd, por: a.por, ent: a.id, t: a.t || '', meca: a.meca || '', itens: a.itens || 0, pecas: a.pecas || 0, bip: a.bip || 0, andamento: true, leituras: a.leituras || 0, nuvem: true, parada: minDesde(a.upd)}));
  const naNuvem = new Set(CV.and.map(a => a.id));
  try {
    for(let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i); if(!k || k.indexOf('cv-sessao-') !== 0) continue;
      const ent = k.slice(10), o = JSON.parse(localStorage.getItem(k) || 'null');
      if(!o || o.fin || !o.log || !o.log.length || naNuvem.has(ent)) continue;
      const rows = CV.porEnt.get(ent) || [], ts = o.log[o.log.length - 1].t;
      out.push({id: ent, ts: new Date(ts).toISOString(), por: CV.email, ent, t: rows[0] ? rows[0].t : '', meca: mecaEntrega(rows), itens: new Set(rows.map(r => r.i)).size,
        pecas: rows.reduce((a, r) => a + r.q, 0), bip: Object.keys(o.bips || {}).reduce((a, i) => a + o.bips[i], 0), andamento: true, leituras: o.log.length, parada: minDesde(new Date(ts).toISOString())});
    }
  } catch(e){}
  return out;
}
async function cvLiberar(ent){
  if(!confirm('Liberar a entrega ' + ent + '? Use só se a conferência foi abandonada: quem estava conferindo perde a reserva.')) return;
  try { await ctrlExcluir(ent, 'and'); toast('Entrega ' + ent + ' liberada.'); } catch(e){ toast((e && e.message) || String(e), true); }
  renderView();
}
function hLista(){
  const f = CV.hf, q = f.busca.trim().toLowerCase();
  const todas = CV.conf.concat(sessoesAbertas());
  return todas.filter(c => (!f.r || (f.r === 'and' ? c.andamento : f.r === 'div' ? (!c.andamento && c.div) : (!c.andamento && !c.div))) && (!f.de || c.ts.slice(0, 10) >= f.de) && (!f.ate || c.ts.slice(0, 10) <= f.ate) &&
    (!q || [c.ent, c.t, c.por, mecaNome(ehMeca(c.meca) ? c.meca : mecaEntrega(CV.porEnt.get(c.ent)))].join(' ').toLowerCase().indexOf(q) >= 0)).sort((a, b) => b.ts.localeCompare(a.ts));
}
function viewHistorico(){
  if(CV.carregando) return '<p class="field-hint">Carregando...</p>';
  const POR = 100, lista = hLista(), tudo = CV.conf.length + sessoesAbertas().length;
  const pags = Math.max(1, Math.ceil(lista.length / POR)); if(CV.hpag >= pags) CV.hpag = pags - 1;
  const nDiv = CV.conf.filter(c => c.div).length, nAnd = tudo - CV.conf.length;
  const chip = (v, t) => '<button class="chip' + (CV.hf.r === v ? ' active' : '') + '" onclick="cvHF(\'r\',\'' + v + '\')">' + t + '</button>';
  const pecas = lista.reduce((a, c) => a + (c.bip || 0), 0);
  return '<div class="filter-bar cv-fb">' + chip('', 'Todas · ' + tudo) + chip('ok', 'Sem divergência · ' + (CV.conf.length - nDiv)) + chip('div', 'Com divergência · ' + nDiv) + chip('and', 'Em andamento · ' + nAnd) +
    '<input type="date" class="cv-in-s" value="' + CV.hf.de + '" onchange="cvHF(\'de\',this.value)" title="De"><input type="date" class="cv-in-s" value="' + CV.hf.ate + '" onchange="cvHF(\'ate\',this.value)" title="Até">' +
    '<input type="text" id="cvHBusca" class="cv-in-s" style="flex:1;min-width:180px" placeholder="Buscar entrega, transportadora, conferente, meca..." value="' + esc(CV.hf.busca) + '" oninput="cvHBusca(this.value)">' +
    '<button class="btn btn-secondary btn-sm" onclick="cvHExportar()">Exportar</button></div>' +
    '<div class="table-wrap"><table class="cv-tab cv-compact"><thead><tr><th>Data / hora</th><th>Entrega</th><th>Conferente</th><th>Meca</th><th>Transportadora</th><th class="n">Itens</th><th class="n">Previstas</th><th class="n">Bipadas</th><th class="n">Falta</th><th class="n">Sobra</th><th class="n">EAN n/id</th><th>Resultado</th><th class="n">Tempo</th><th></th></tr></thead><tbody>' +
    (lista.length ? lista.slice(CV.hpag * POR, CV.hpag * POR + POR).map(c => '<tr><td>' + dtBR(c.ts) + '</td><td class="cv-mono"><b>' + esc(c.ent) + '</b></td><td class="cv-cut">' + esc((c.por || '').split('@')[0]) + '</td><td class="cv-cut">' + esc(mecaNome(ehMeca(c.meca) ? c.meca : mecaEntrega(CV.porEnt.get(c.ent)))) + '</td><td class="cv-cut">' + esc(c.t || '') + '</td>' +
      '<td class="n">' + fInt(c.itens) + '</td><td class="n">' + fInt(c.pecas) + '</td><td class="n"><b>' + fInt(c.bip) + '</b></td>' +
      (c.andamento ? '<td class="n">—</td><td class="n">—</td><td class="n">—</td><td><span class="cv-pill cv-pend">Em andamento</span></td><td class="n" title="última leitura">há ' + fMin(c.parada * 60) + '</td>' :
      '<td class="n">' + (c.falta ? '<b style="color:#B45309">' + fInt(c.falta) + '</b>' : '0') + '</td><td class="n">' + (c.sobra ? '<b style="color:#7E22CE">' + fInt(c.sobra) + '</b>' : '0') + '</td><td class="n">' + (c.ean ? '<b style="color:var(--danger)">' + fInt(c.ean) + '</b>' : '0') + '</td><td><span class="cv-pill ' + (c.div ? 'cv-falta' : 'cv-ok') + '">' + (c.div ? 'Com divergência' : 'Sem divergência') + '</span></td><td class="n">' + (c.dur > 0 ? fMin(c.dur) : '—') + '</td>') +
      '<td class="n" style="white-space:nowrap"><button class="btn-link" onclick="abrirEntrega(\'' + sq(c.ent) + '\')">Abrir</button>' + (c.nuvem && !somenteLeitura() ? ' <button class="btn-danger-text" onclick="cvLiberar(\'' + sq(c.ent) + '\')">Liberar</button>' : '') + '</td></tr>').join('')
      : '<tr><td colspan="14" class="field-hint" style="padding:16px">Nenhuma conferência registrada. Cada entrega fica aqui ao clicar em Finalizar conferência.</td></tr>') + '</tbody></table></div>' +
    '<div class="field-hint" style="margin-top:8px">' + fInt(lista.length) + ' conferência(s) · ' + fInt(pecas) + ' peças bipadas</div>' +
    (pags > 1 ? '<div class="cv-pag"><button class="btn btn-secondary" onclick="cvHPag(-1)"' + (CV.hpag === 0 ? ' disabled' : '') + '>←</button><span>Página ' + (CV.hpag + 1) + ' de ' + pags + '</span><button class="btn btn-secondary" onclick="cvHPag(1)"' + (CV.hpag >= pags - 1 ? ' disabled' : '') + '>→</button></div>' : '');
}
function cvHF(k, v){ CV.hf[k] = v; CV.hpag = 0; renderView(); }
function cvHPag(n){ CV.hpag += n; renderView(); }
let _cvHB; function cvHBusca(v){ CV.hf.busca = v; CV.hpag = 0; clearTimeout(_cvHB); _cvHB = setTimeout(() => { renderView(); const i = $('cvHBusca'); if(i){ i.focus(); i.setSelectionRange(v.length, v.length); } }, 250); }
function cvHExportar(){
  if(!window.XLSX) return toast('Biblioteca de Excel ainda carregando, tente de novo.', true);
  const l = [['Data / hora', 'Entrega', 'Conferente', 'Meca', 'Transportadora', 'Itens', 'Peças previstas', 'Peças bipadas', 'Falta', 'Sobra', 'EAN não identificado', 'Resultado', 'Tempo (s)', 'Leituras']];
  hLista().forEach(c => l.push([dtBR(c.ts), c.ent, (c.por || '').split('@')[0], mecaNome(ehMeca(c.meca) ? c.meca : mecaEntrega(CV.porEnt.get(c.ent))), c.t || '', c.itens, c.pecas, c.bip, c.andamento ? '' : c.falta, c.andamento ? '' : c.sobra, c.andamento ? '' : c.ean, c.andamento ? 'Em andamento' : c.div ? 'Com divergência' : 'Sem divergência', c.dur || '', c.leituras || '']));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, planilha(l, [17, 12, 18, 22, 22, 7, 10, 10, 7, 7, 12, 17, 9, 9]), 'Conferências');
  XLSX.writeFile(wb, 'registro-de-conferencias.xlsx');
}

/* ---------- Auxiliares do dashboard ---------- */
function barrasH(lista, cor, max){
  const m = Math.max(1, ...lista.map(x => x[1]));
  return lista.length ? '<div class="cv-bh">' + lista.slice(0, max || 8).map(x => '<div class="cv-bh-l" title="' + esc(x[0]) + ': ' + fInt(x[1]) + '"><span class="n">' + esc(x[0] || '—') + '</span><span class="b"><i style="width:' + (x[1] / m * 100) + '%;background:' + (x[2] || cor) + '"></i></span><b>' + fInt(x[1]) + '</b></div>').join('') + '</div>' : '<div class="field-hint">Sem dados no período.</div>';
}
function conta(lista, fn){ const m = new Map(); lista.forEach(c => { const k = fn(c) || '—'; m.set(k, (m.get(k) || 0) + 1); }); return Array.from(m.entries()).sort((a, b) => b[1] - a[1]); }
/* Agrupa e soma: devolve [[chave, {n: ocorrências, q: peças, ents: Set de entregas}]] do maior para o menor. */
function agrupa(lista, fn){
  const m = new Map();
  lista.forEach(c => { const k = fn(c) || '—'; let g = m.get(k); if(!g) m.set(k, g = {n: 0, q: 0, ents: new Set(), ab: 0}); g.n++; g.q += c.q || 0; g.ents.add(c.ent); if(c.st !== 'atendida') g.ab++; });
  return Array.from(m.entries()).sort((a, b) => b[1].q - a[1].q || b[1].n - a[1].n);
}
const diasDesde = iso => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5));
const fMin = seg => seg >= 3600 ? (seg / 3600).toLocaleString('pt-BR', {maximumFractionDigits: 1}) + ' h' : seg >= 60 ? Math.round(seg / 60) + ' min' : Math.round(seg) + ' s';
const media = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
function ruaDe(loc){ const t = String(loc || '').trim().split(/\s+/); return t.length >= 2 ? t[0] + ' ' + t[1] : (t[0] || ''); }
function tabelaRank(cab, linhas, vazio){
  return '<div class="cv-sc2"><table class="cv-tab cv-compact"><thead><tr>' + cab.map((c, i) => '<th' + (i ? ' class="n"' : '') + '>' + c + '</th>').join('') + '</tr></thead><tbody>' +
    (linhas.length ? linhas.map(l => '<tr>' + l.map((c, i) => '<td' + (i ? ' class="n"' : ' class="cv-cut" style="max-width:220px"') + '>' + c + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + cab.length + '" class="field-hint" style="padding:12px">' + (vazio || 'Sem dados no período.') + '</td></tr>') + '</tbody></table></div>';
}
/* ---------- Dashboard interativo das divergências ---------- */
/* Clique em qualquer barra/linha/dia filtra o painel inteiro; os filtros ativos aparecem como chips. */
const DX_ROT = {tipo: 'Tipo', t: 'Transportadora', meca: 'Meca', item: 'Item', rua: 'Rua', ca: 'Canal', mo: 'Modelo', stt: 'Tratativa', dia: 'Dia'};
const DX_KL = ['tipo', 't', 'meca', 'item', 'rua', 'ca', 'mo', 'stt', 'dia'], DX_KC = ['t', 'meca', 'ca', 'mo', 'dia'];
const DX_ST = {'Aberta': ['▲', '#C83812'], 'Em tratativa': ['◐', '#B45309'], 'Aguardando retorno': ['◷', '#B45309'], 'Resolvida': ['✓', '#1F8A52']};
const DX_SEM = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const isoMais = (iso, n) => { const x = new Date(iso + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
function dxPeriodo(){
  const d = CV.dx, h = hojeISO();
  if(d.per === 'hoje') return {de: h, ate: ''};
  if(d.per === '7') return {de: isoMais(h, -6), ate: ''};
  if(d.per === '30') return {de: isoMais(h, -29), ate: ''};
  if(d.per === 'c') return {de: d.de, ate: d.ate};
  return {de: '', ate: ''};
}
function dxLinhas(){
  const tr = new Map(entregasDiv().map(g => [g.ent, g]));
  return CV.ctrl.map(c => {
    const dt = new Date(c.ts), g = tr.get(c.ent), loc = (c.orig || '').split(' / ')[0];
    return {ent: c.ent, tipo: c.tipo, q: c.q || 0, item: c.item || '', d: c.d || '', t: c.t || '', meca: mecaNome(mecaDoReg(c)), rua: loc ? ruaDe(loc) : '', ca: c.ca || '', mo: c.mo || '',
      dia: c.ts.slice(0, 10), h: dt.getHours(), wd: (dt.getDay() + 6) % 7, ab: c.st !== 'atendida', stt: g ? g.st : 'Aberta', ts: c.ts, g};
  });
}
function dxConfs(){
  return CV.conf.map(c => ({ent: c.ent, dia: c.ts.slice(0, 10), t: c.t || '', meca: mecaNome(ehMeca(c.meca) ? c.meca : mecaEntrega(CV.porEnt.get(c.ent))), ca: c.ca || '', mo: c.mo || '', div: !!c.div, dur: c.dur || 0, pecas: c.pecas || 0, bip: c.bip || 0, por: (c.por || '—').split('@')[0]}));
}
const dxOk = (r, f, keys, excl, de, ate) => !(de && r.dia < de) && !(ate && r.dia > ate) && keys.every(k => k === excl || !f[k] || r[k] === f[k]);
const dxTip = o => esc(JSON.stringify(o));
function dxNice(mx){ const st = [1, 2, 5]; let i = 0, s = 1; while(s * 4 < mx){ i++; s = st[i % 3] * Math.pow(10, Math.floor(i / 3)); } return s * 4; }
const dxPct = (a, b) => b ? Math.round(a / b * 100) : 0;
function dxSpark(v){
  if(v.length < 2) return '';
  const mx = Math.max(1, ...v), W = 90, H = 26;
  const pts = v.map((y, i) => (i / (v.length - 1) * W).toFixed(1) + ',' + (H - 2 - y / mx * (H - 4)).toFixed(1)).join(' ');
  return '<svg class="dx-spark" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><polyline points="' + pts + '" fill="none" stroke="var(--dxb)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>';
}
function dxDelta(cur, prev, menor, tem){
  if(!tem) return '';
  if(!prev && !cur) return '<small class="dx-d">■ sem variação</small>';
  if(!prev) return '<small class="dx-d">novo no período</small>';
  const p = Math.round((cur - prev) / prev * 100), bom = menor ? cur < prev : cur > prev;
  if(!p) return '<small class="dx-d">■ igual ao período anterior</small>';
  return '<small class="dx-d ' + (bom ? 'bom' : 'ruim') + '">' + (cur > prev ? '▲ +' : '▼ ') + p + '% vs. anterior</small>';
}
function dxKpi(rot, v, sub, spark, extra){ return '<div class="cv-kpi dx-kpi"><span>' + rot + '</span><b>' + v + '</b>' + (sub || '') + (extra || '') + spark + '</div>'; }
/* Barras horizontais clicáveis: cada barra filtra o painel inteiro pela dimensão. */
function dxBar(tit, k, ent, tot, opt){
  opt = opt || {}; const sel = CV.dx.f[k], mx = Math.max(1, ...ent.map(x => x.v)), max = opt.max || 8;
  const corpo = ent.length ? '<div class="dx-bars">' + ent.slice(0, max).map(x => {
    const on = sel === x.k, off = sel && !on;
    return '<button type="button" class="dx-b' + (on ? ' on' : '') + (off ? ' off' : '') + '"' + (k ? ' data-dx="f" data-k="' + k + '" data-v="' + esc(x.k) + '"' : ' style="cursor:default"') + ' data-tip="' + dxTip({t: x.label || x.k, r: [[opt.un || 'Total', fInt(x.v) + (tot ? ' (' + dxPct(x.v, tot) + '%)' : ''), x.cor || 'var(--dxb)']]}) + '"><span class="n">' + esc(x.label || x.k) + '</span><span class="b"><i style="width:' + Math.max(1.5, x.v / mx * 100) + '%;background:' + (x.cor || 'var(--dxb)') + '"></i></span><b>' + fInt(x.v) + '</b></button>';
  }).join('') + '</div>' + (ent.length > max ? '<div class="field-hint">+ ' + (ent.length - max) + ' não exibidos</div>' : '') : '<div class="field-hint">Sem dados no período.</div>';
  return '<div class="cv-card cv-dc"><h4>' + tit + '</h4>' + corpo + '</div>';
}
function dxContar(arr, fn, val){ const m = new Map(); arr.forEach(r => { const k = fn(r); if(!k) return; m.set(k, (m.get(k) || 0) + val(r)); }); return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({k, v})); }
function viewDashboard(){
  if(CV.carregando) return '<p class="field-hint">Carregando...</p>';
  const D = CV.dx, f = D.f, per = dxPeriodo(), de = per.de, ate = per.ate, h0 = hojeISO(), tem = !!de;
  const val = r => D.met === 'q' ? r.q : 1, un = D.met === 'q' ? 'peças' : 'ocorrências';
  const LL = dxLinhas(), CC = dxConfs();
  const L = excl => LL.filter(r => dxOk(r, f, DX_KL, excl, de, ate)), C = excl => CC.filter(r => dxOk(r, f, DX_KC, excl, de, ate));
  const La = L(), Ca = C(), soma = a => a.reduce((x, r) => x + val(r), 0), nEnt = a => new Set(a.map(r => r.ent)).size;
  let pde = '', pate = '';
  if(tem){ const fim = ate || h0, len = Math.round((new Date(fim + 'T12:00') - new Date(de + 'T12:00')) / 864e5) + 1; pate = isoMais(de, -1); pde = isoMais(pate, -(len - 1)); }
  const Lp = tem ? LL.filter(r => dxOk(r, f, DX_KL, 'dia', pde, pate)) : [], Cp = tem ? CC.filter(r => dxOk(r, f, DX_KC, 'dia', pde, pate)) : [];
  /* dias da linha do tempo */
  let ini = de, fim = ate || h0;
  if(!ini){ const ds = LL.map(r => r.dia).concat(CC.map(r => r.dia)).sort(); ini = ds.length ? ds[0] : isoMais(h0, -29); }
  const dias = []; for(let d = ini, n = 0; d <= fim && n < 400; d = isoMais(d, 1), n++) dias.push(d);
  if(dias.length > 90) dias.splice(0, dias.length - 90);
  const Lt = L('dia'), Ct = C('dia');
  /* ---- números ---- */
  const nConf = Ca.length, comDiv = Ca.filter(c => c.div).length, acur = nConf ? Math.round((nConf - comDiv) / nConf * 100) : null;
  const pConf = Cp.length, pAcur = pConf ? Math.round((pConf - Cp.filter(c => c.div).length) / pConf * 100) : null;
  const entDiv = nEnt(La), pecasDiv = La.reduce((a, r) => a + r.q, 0), pPecas = Lp.reduce((a, r) => a + r.q, 0);
  const egs = new Map(); La.forEach(r => { let g = egs.get(r.ent); if(!g) egs.set(r.ent, g = {ent: r.ent, t: r.t, meca: r.meca, n: 0, q: 0, v: 0, ts: r.ts, stt: r.stt, itens: new Set()}); g.n++; g.q += r.q; g.v += val(r); g.itens.add(r.item); if(r.ts < g.ts) g.ts = r.ts; });
  const EG = Array.from(egs.values()), abertas = EG.filter(g => g.stt !== 'Resolvida'), velha = abertas.length ? Math.max.apply(null, abertas.map(g => diasDesde(g.ts))) : 0;
  const tr = new Map(CV.trat.map(t => [t.id, t])), tRes = EG.filter(g => g.stt === 'Resolvida' && tr.get(g.ent) && tr.get(g.ent).resolvida).map(g => (new Date(tr.get(g.ent).resolvida) - new Date(g.ts)) / 36e5);
  const tMed = media(tRes), fHoras = x => x >= 48 ? (x / 24).toLocaleString('pt-BR', {maximumFractionDigits: 1}) + ' dias' : x.toLocaleString('pt-BR', {maximumFractionDigits: 1}) + ' h';
  const serie = (arr, fn) => dias.map(d => fn(arr.filter(r => r.dia === d)));
  const acurDia = dias.map(d => { const c = Ct.filter(x => x.dia === d); return c.length ? Math.round((c.length - c.filter(x => x.div).length) / c.length * 100) : null; });
  /* ---- chips de filtro ---- */
  const ativos = Object.keys(f).filter(k => f[k]);
  const chips = ativos.length ? '<div class="dx-chips">' + ativos.map(k => '<button type="button" class="dx-chip" data-dx="x" data-k="' + k + '" title="Remover filtro">' + DX_ROT[k] + ': <b>' + esc(k === 'dia' ? fData(f[k]) : f[k]) + '</b> ✕</button>').join('') + '<button type="button" class="dx-lim" data-dx="clear">Limpar tudo</button></div>' : '';
  const pre = (v, t) => '<button type="button" class="chip' + (D.per === v ? ' active' : '') + '" data-dx="per" data-v="' + v + '">' + t + '</button>';
  const barra = '<div class="dx-sticky"><div class="filter-bar cv-fb">' + pre('hoje', 'Hoje') + pre('7', '7 dias') + pre('30', '30 dias') + pre('tudo', 'Tudo') +
    '<input type="date" class="cv-in-s" value="' + (D.per === 'c' ? D.de : de) + '" onchange="cvDxData(\'de\',this.value)" title="De"><input type="date" class="cv-in-s" value="' + (D.per === 'c' ? D.ate : ate) + '" onchange="cvDxData(\'ate\',this.value)" title="Até">' +
    '<span class="dx-sep"></span><div class="dx-seg" role="group" aria-label="Medir por"><button type="button" class="' + (D.met === 'n' ? 'on' : '') + '" data-dx="met" data-v="n">Ocorrências</button><button type="button" class="' + (D.met === 'q' ? 'on' : '') + '" data-dx="met" data-v="q">Peças</button></div>' +
    '<div class="dx-seg" role="group" aria-label="Visual"><button type="button" class="' + (D.vista === 'graf' ? 'on' : '') + '" data-dx="vista" data-v="graf">Gráficos</button><button type="button" class="' + (D.vista === 'tab' ? 'on' : '') + '" data-dx="vista" data-v="tab">Tabela</button></div></div>' + chips + '</div>';
  /* ---- insights ---- */
  const ins = [];
  if(La.length){
    const pt = dxContar(La, r => r.tipo, r => r.q); if(pt.length) ins.push('<b>' + esc(pt[0].k) + '</b> responde por ' + dxPct(pt[0].v, pecasDiv) + '% das peças em divergência.');
    const pm = dxContar(La, r => r.meca, r => r.q).filter(x => x.k !== 'Sem meca'); if(pm.length && pm.length > 1 && dxPct(pm[0].v, pecasDiv) >= 20) ins.push('Meca <b>' + esc(pm[0].k) + '</b> concentra ' + dxPct(pm[0].v, pecasDiv) + '% das peças divergentes.');
    const pi = dxContar(La.filter(r => r.item), r => r.item, r => r.q); if(pi.length) ins.push('Item <b>' + esc(pi[0].k) + '</b> é o maior ofensor: ' + fInt(pi[0].v) + ' peça(s).');
    if(tem && Lp.length && nEnt(Lp)) { const a = entDiv, b = nEnt(Lp), p = Math.round((a - b) / b * 100); if(Math.abs(p) >= 10) ins.push('Entregas com divergência ' + (p > 0 ? '<b class="ruim">subiram ' + p + '%</b>' : '<b class="bom">caíram ' + Math.abs(p) + '%</b>') + ' em relação ao período anterior.'); }
    const velhas = abertas.filter(g => diasDesde(g.ts) > 3).length; if(velhas) ins.push('<b class="ruim">' + velhas + ' entrega(s)</b> seguem em aberto há mais de 3 dias.');
  }
  if(acur !== null && acur < 95) ins.push('Acuracidade de <b class="' + (acur < 90 ? 'ruim' : '') + '">' + acur + '%</b>, abaixo da meta de 95%.');
  const insH = ins.length ? '<div class="cv-card dx-ins"><h4>Resumo do analista</h4><ul>' + ins.slice(0, 5).map(x => '<li>' + x + '</li>').join('') + '</ul></div>' : '';
  /* ---- KPIs ---- */
  const aIcon = acur === null ? '' : acur >= 95 ? '<small class="dx-st" style="color:#1F8A52">✓ dentro da meta (95%)</small>' : acur >= 90 ? '<small class="dx-st" style="color:#B45309">◐ atenção — meta 95%</small>' : '<small class="dx-st" style="color:#C83812">▲ crítico — meta 95%</small>';
  const kpis = '<div class="cv-kpis cv-kpis-d dx-kpis">' +
    dxKpi('Entregas conferidas', fInt(nConf), dxDelta(nConf, pConf, false, tem), dxSpark(serie(Ct, a => a.length))) +
    dxKpi('Acuracidade', acur === null ? '—' : acur + '%', dxDelta(acur || 0, pAcur || 0, false, tem && acur !== null && pAcur !== null) + aIcon, dxSpark(acurDia.map(x => x == null ? 0 : x))) +
    dxKpi('Entregas divergentes', fInt(entDiv), dxDelta(entDiv, nEnt(Lp), true, tem), dxSpark(serie(Lt, a => nEnt(a)))) +
    dxKpi('Peças em divergência', fInt(pecasDiv), dxDelta(pecasDiv, pPecas, true, tem), dxSpark(serie(Lt, a => a.reduce((x, r) => x + r.q, 0)))) +
    dxKpi('Em aberto', fInt(abertas.length), '<small class="dx-d' + (velha > 3 ? ' ruim' : '') + '">' + (velha ? (velha > 3 ? '▲ ' : '') + 'mais antiga: ' + velha + ' dia(s)' : 'nenhuma pendente') + '</small>', '') +
    dxKpi('Tempo p/ resolver', tRes.length ? fHoras(tMed) : '—', '<small class="dx-d">' + tRes.length + ' entrega(s) resolvida(s)</small>', '') + '</div>';
  /* ---- linha do tempo: barras empilhadas por tipo + média móvel 7 dias ---- */
  const tipos = TIPOS.filter(t => Lt.some(r => r.tipo === t));
  const porDia = new Map(dias.map(d => [d, {}])); Lt.forEach(r => { const o = porDia.get(r.dia); if(o) o[r.tipo] = (o[r.tipo] || 0) + val(r); });
  const tot = dias.map(d => Object.keys(porDia.get(d)).reduce((a, t) => a + porDia.get(d)[t], 0));
  const lg = '<div class="dx-leg">' + tipos.map(t => '<button type="button" class="' + (f.tipo && f.tipo !== t ? 'off' : '') + '" data-dx="f" data-k="tipo" data-v="' + esc(t) + '"><i style="background:' + TIPO_COR[t] + '"></i>' + esc(t) + '</button>').join('') + (tipos.length ? '<span class="dx-ma"><i></i>média 7 dias</span>' : '') + '</div>';
  let tl;
  if(!tipos.length) tl = '<div class="field-hint" style="padding:30px 0">Sem dados no período.</div>';
  else if(D.vista === 'tab') tl = '<div class="cv-sc2"><table class="cv-tab cv-compact"><thead><tr><th>Dia</th>' + tipos.map(t => '<th class="n">' + esc(t) + '</th>').join('') + '<th class="n">Total</th></tr></thead><tbody>' + dias.slice().reverse().filter((d, i) => tot[dias.length - 1 - i]).map(d => { const i = dias.indexOf(d); return '<tr><td>' + fData(d) + '</td>' + tipos.map(t => '<td class="n">' + (porDia.get(d)[t] || '') + '</td>').join('') + '<td class="n"><b>' + tot[i] + '</b></td></tr>'; }).join('') + '</tbody></table></div>';
  else {
    const W = 900, H = 230, pl = 34, pr = 6, pt = 10, pb = 22, iw = W - pl - pr, ih = H - pt - pb, nice = dxNice(Math.max(1, ...tot)), bw = iw / dias.length, bar = Math.max(2, Math.min(30, bw * .72)), sx = i => pl + bw * i + bw / 2, sy = v => pt + ih - v / nice * ih;
    let g = '';
    for(let i = 0; i <= 4; i++){ const y = sy(nice / 4 * i); g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '" class="dx-grid"/><text x="' + (pl - 6) + '" y="' + (y + 3) + '" text-anchor="end" class="dx-ax">' + fInt(nice / 4 * i) + '</text>'; }
    const passo = Math.ceil(dias.length / 12);
    dias.forEach((d, i) => { if(i % passo === 0) g += '<text x="' + sx(i) + '" y="' + (H - 6) + '" text-anchor="middle" class="dx-ax">' + d.slice(8) + '/' + d.slice(5, 7) + '</text>'; });
    dias.forEach((d, i) => {
      if(f.dia === d) g += '<rect x="' + (pl + bw * i) + '" y="' + pt + '" width="' + bw + '" height="' + ih + '" class="dx-sel"/>';
      let cum = 0; tipos.forEach(t => { const v = porDia.get(d)[t] || 0; if(!v) return; const y0 = sy(cum), y1 = sy(cum + v); cum += v; g += '<rect x="' + (sx(i) - bar / 2) + '" y="' + y1 + '" width="' + bar + '" height="' + Math.max(1, y0 - y1) + '" fill="' + TIPO_COR[t] + '" class="dx-seg-r"/>'; });
    });
    const ma = tot.map((_, i) => { const s = tot.slice(Math.max(0, i - 6), i + 1); return media(s); });
    g += '<polyline class="dx-maline" fill="none" points="' + ma.map((v, i) => sx(i).toFixed(1) + ',' + sy(v).toFixed(1)).join(' ') + '"/>';
    dias.forEach((d, i) => { g += '<rect x="' + (pl + bw * i) + '" y="' + pt + '" width="' + bw + '" height="' + ih + '" class="dx-hit" data-dx="f" data-k="dia" data-v="' + d + '" data-tip="' + dxTip({t: fData(d) + ' — ' + fInt(tot[i]) + ' ' + un, r: tipos.filter(t => porDia.get(d)[t]).map(t => [t, fInt(porDia.get(d)[t]), TIPO_COR[t]]).concat([['Média 7 dias', ma[i].toLocaleString('pt-BR', {maximumFractionDigits: 1}), 'var(--dxb)']])}) + '"/>'; });
    tl = '<svg class="dx-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + un + ' por dia, por tipo">' + g + '</svg>';
  }
  /* ---- acuracidade por dia (linha própria: nunca no mesmo eixo) ---- */
  let ac;
  const pts = acurDia.map((v, i) => v == null ? null : [i, v]).filter(Boolean);
  if(!pts.length) ac = '<div class="field-hint" style="padding:30px 0">Sem conferências no período.</div>';
  else if(D.vista === 'tab') ac = '<div class="cv-sc2"><table class="cv-tab cv-compact"><thead><tr><th>Dia</th><th class="n">Conferidas</th><th class="n">C/ divergência</th><th class="n">Acuracidade</th></tr></thead><tbody>' + pts.slice().reverse().map(([i, v]) => { const c = Ct.filter(x => x.dia === dias[i]); return '<tr><td>' + fData(dias[i]) + '</td><td class="n">' + c.length + '</td><td class="n">' + c.filter(x => x.div).length + '</td><td class="n"><b>' + v + '%</b></td></tr>'; }).join('') + '</tbody></table></div>';
  else {
    const W = 900, H = 170, pl = 34, pr = 62, pt = 10, pb = 22, iw = W - pl - pr, ih = H - pt - pb, lo = Math.max(0, Math.min(80, Math.floor(Math.min.apply(null, pts.map(p => p[1])) / 10) * 10)), bw = iw / dias.length, sx = i => pl + bw * i + bw / 2, sy = v => pt + ih - (v - lo) / (100 - lo) * ih;
    let g = ''; for(let i = 0; i <= 4; i++){ const v = lo + (100 - lo) / 4 * i, y = sy(v); g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '" class="dx-grid"/><text x="' + (pl - 6) + '" y="' + (y + 3) + '" text-anchor="end" class="dx-ax">' + Math.round(v) + '%</text>'; }
    g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + sy(95) + '" y2="' + sy(95) + '" class="dx-meta"/><text x="' + (W - pr + 4) + '" y="' + (sy(95) + 3) + '" class="dx-ax">meta 95%</text>';
    const passo = Math.ceil(dias.length / 12); dias.forEach((d, i) => { if(i % passo === 0) g += '<text x="' + sx(i) + '" y="' + (H - 6) + '" text-anchor="middle" class="dx-ax">' + d.slice(8) + '/' + d.slice(5, 7) + '</text>'; });
    g += '<polyline class="dx-line" fill="none" points="' + pts.map(p => sx(p[0]).toFixed(1) + ',' + sy(p[1]).toFixed(1)).join(' ') + '"/>';
    pts.forEach(p => { g += '<circle cx="' + sx(p[0]) + '" cy="' + sy(p[1]) + '" r="4" class="dx-dot' + (p[1] < 90 ? ' crit' : p[1] < 95 ? ' warn' : '') + '"/>'; });
    dias.forEach((d, i) => { const c = Ct.filter(x => x.dia === d); if(!c.length) return; const a = acurDia[i]; g += '<rect x="' + (pl + bw * i) + '" y="' + pt + '" width="' + bw + '" height="' + ih + '" class="dx-hit" data-dx="f" data-k="dia" data-v="' + d + '" data-tip="' + dxTip({t: fData(d) + ' — acuracidade ' + a + '%', r: [['Conferidas', c.length, 'var(--dxb)'], ['Com divergência', c.filter(x => x.div).length, 'var(--tp2)']]}) + '"/>'; });
    ac = '<svg class="dx-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Acuracidade por dia">' + g + '</svg>';
  }
  /* ---- funil ---- */
  const cr = EG.length, res = EG.filter(g => g.stt === 'Resolvida').length;
  const fun = [['Entregas conferidas', nConf, 'var(--dxb)'], ['Com divergência', comDiv, 'var(--tp2)'], ['Divergências registradas', cr, 'var(--tp4)'], ['Resolvidas', res, '#1F8A52']];
  const funH = D.vista === 'tab' ? '<table class="cv-tab cv-compact"><thead><tr><th>Etapa</th><th class="n">Entregas</th><th class="n">% da etapa anterior</th></tr></thead><tbody>' + fun.map((x, i) => '<tr><td>' + x[0] + '</td><td class="n">' + fInt(x[1]) + '</td><td class="n">' + (i ? dxPct(x[1], fun[i - 1][1]) + '%' : '—') + '</td></tr>').join('') + '</tbody></table>' :
    '<div class="dx-bars">' + fun.map((x, i) => '<div class="dx-b" style="cursor:default" data-tip="' + dxTip({t: x[0], r: [['Entregas', fInt(x[1]), x[2]]].concat(i ? [['da etapa anterior', dxPct(x[1], fun[i - 1][1]) + '%', x[2]]] : [])}) + '"><span class="n">' + x[0] + '</span><span class="b"><i style="width:' + Math.max(1.5, x[1] / Math.max(1, fun[0][1]) * 100) + '%;background:' + x[2] + '"></i></span><b>' + fInt(x[1]) + (i ? ' <small>' + dxPct(x[1], fun[i - 1][1]) + '%</small>' : '') + '</b></div>').join('') + '</div>';
  /* ---- Pareto de itens ---- */
  const it = dxContar(L('item').filter(r => r.item), r => r.item + '|' + r.d, val), itTot = it.reduce((a, x) => a + x.v, 0); let acum = 0;
  const par = it.slice(0, 10).map(x => { acum += x.v; const t = x.k.split('|'); return {k: t[0], label: t[0] + ' · ' + descCurta(t[1]), v: x.v, ac: dxPct(acum, itTot)}; });
  const sIt = f.item, mxIt = Math.max(1, ...par.map(x => x.v));
  const parH = par.length ? '<div class="dx-bars">' + par.map(x => '<button type="button" class="dx-b dx-par' + (sIt === x.k ? ' on' : '') + (sIt && sIt !== x.k ? ' off' : '') + '" data-dx="f" data-k="item" data-v="' + esc(x.k) + '" data-tip="' + dxTip({t: x.label, r: [[un, fInt(x.v), 'var(--dxb)'], ['Acumulado', x.ac + '%', 'var(--dxb)']]}) + '"><span class="n">' + esc(x.label) + '</span><span class="b"><i style="width:' + Math.max(1.5, x.v / mxIt * 100) + '%;background:var(--dxb)"></i></span><b>' + fInt(x.v) + '</b><em>' + x.ac + '%</em></button>').join('') + '</div><div class="field-hint">Coluna da direita: % acumulado do total — poucos itens costumam explicar a maior parte.</div>' : '<div class="field-hint">Sem dados no período.</div>';
  /* ---- mecas ---- */
  const mm = new Map(), mk = n => { let g = mm.get(n); if(!g) mm.set(n, g = {k: n, conf: 0, dv: 0, q: 0, ents: new Set()}); return g; };
  C('meca').forEach(c => { const g = mk(c.meca); g.conf++; if(c.div) g.dv++; }); L('meca').forEach(r => { const g = mk(r.meca); g.q += r.q; g.ents.add(r.ent); });
  const mArr = Array.from(mm.values()).map(g => Object.assign(g, {taxa: g.conf ? g.dv / g.conf : (g.ents.size ? 1 : 0), ne: g.ents.size})).filter(g => g.k !== 'Sem meca' || g.q);
  const sm = D.sm, ord = (a, b) => ((b[sm.k] - a[sm.k]) * -sm.d) || b.q - a.q; mArr.sort(ord);
  const mxQ = Math.max(1, ...mArr.map(g => g.q)), th = (k, t) => '<th class="n"><button type="button" class="dx-th' + (sm.k === k ? ' on' : '') + '" data-dx="sort" data-v="' + k + '">' + t + (sm.k === k ? (sm.d < 0 ? ' ▼' : ' ▲') : '') + '</button></th>';
  const mecaH = '<div class="cv-sc2"><table class="cv-tab cv-compact dx-tb"><thead><tr><th>Meca</th>' + th('conf', 'Entregas') + th('ne', 'Com diverg.') + th('taxa', 'Taxa') + th('q', 'Peças') + '</tr></thead><tbody>' +
    (mArr.length ? mArr.slice(0, 15).map(g => '<tr class="dx-row' + (f.meca === g.k ? ' on' : (f.meca ? ' off' : '')) + '" data-dx="f" data-k="meca" data-v="' + esc(g.k) + '" data-tip="' + dxTip({t: g.k, r: [['Entregas conferidas', fInt(g.conf), 'var(--dxb)'], ['Com divergência', fInt(g.ne), 'var(--tp2)'], ['Peças', fInt(g.q), 'var(--tp1)']]}) + '"><td class="cv-cut" style="max-width:150px">' + esc(g.k) + '</td><td class="n">' + (g.conf ? fInt(g.conf) : '—') + '</td><td class="n">' + fInt(g.ne) + '</td><td class="n">' + (g.conf ? Math.round(g.taxa * 100) + '%' : '—') + '</td><td class="n dx-cel"><i style="width:' + Math.max(2, g.q / mxQ * 100) + '%"></i><b>' + fInt(g.q) + '</b></td></tr>').join('') : '<tr><td colspan="5" class="field-hint" style="padding:12px">Sem dados no período.</td></tr>') + '</tbody></table></div>';
  /* ---- mapa de calor dia da semana × hora ---- */
  const hm = new Map(); La.forEach(r => { const k = r.wd + '|' + r.h; hm.set(k, (hm.get(k) || 0) + val(r)); });
  const hs = La.map(r => r.h), h1 = hs.length ? Math.min.apply(null, hs) : 8, h2 = hs.length ? Math.max.apply(null, hs) : 18, mxH = Math.max(1, ...Array.from(hm.values()));
  let heat;
  if(!La.length) heat = '<div class="field-hint">Sem dados no período.</div>';
  else if(D.vista === 'tab') heat = '<div class="cv-sc2"><table class="cv-tab cv-compact"><thead><tr><th>Dia</th>' + Array.from({length: h2 - h1 + 1}, (_, i) => '<th class="n">' + (h1 + i) + 'h</th>').join('') + '</tr></thead><tbody>' + DX_SEM.map((s, w) => '<tr><td>' + s + '</td>' + Array.from({length: h2 - h1 + 1}, (_, i) => '<td class="n">' + (hm.get(w + '|' + (h1 + i)) || '') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  else heat = '<div class="dx-heat" style="grid-template-columns:34px repeat(' + (h2 - h1 + 1) + ',1fr)"><span></span>' + Array.from({length: h2 - h1 + 1}, (_, i) => '<span class="hh">' + (h1 + i) + '</span>').join('') +
    DX_SEM.map((s, w) => '<span class="hw">' + s + '</span>' + Array.from({length: h2 - h1 + 1}, (_, i) => { const v = hm.get(w + '|' + (h1 + i)) || 0; return '<i class="hc" style="--a:' + (v ? Math.round(18 + v / mxH * 82) : 0) + '%" data-tip="' + dxTip({t: s + ' · ' + (h1 + i) + 'h', r: [[un, fInt(v), 'var(--tp1)']]}) + '"></i>'; }).join('')).join('') + '</div><div class="dx-hleg">menos <i style="--a:18%"></i><i style="--a:45%"></i><i style="--a:72%"></i><i style="--a:100%"></i> mais</div>';
  /* ---- dimensões ---- */
  const tipoE = dxContar(L('tipo'), r => r.tipo, val).map(x => ({k: x.k, v: x.v, cor: TIPO_COR[x.k]})), totTipo = tipoE.reduce((a, x) => a + x.v, 0);
  const sttMap = new Map(); (() => { const m = new Map(); L('stt').forEach(r => { if(!m.has(r.ent)) m.set(r.ent, r.stt); }); m.forEach(st => sttMap.set(st, (sttMap.get(st) || 0) + 1)); })();
  const sttE = STATUS_TR.filter(st => sttMap.get(st)).map(st => ({k: st, label: DX_ST[st][0] + ' ' + st, v: sttMap.get(st), cor: DX_ST[st][1]}));
  const faixas = [['Hoje', 0, 0, 0], ['1 dia', 1, 1, 0], ['2 a 3 dias', 2, 3, 1], ['4 a 7 dias', 4, 7, 2], ['+ de 7 dias', 8, 9999, 2]], cF = ['#1F8A52', '#B45309', '#C83812'], iF = ['✓', '◐', '▲'];
  const ageE = faixas.map(x => ({k: x[0], label: iF[x[3]] + ' ' + x[0], v: abertas.filter(g => { const d = diasDesde(g.ts); return d >= x[1] && d <= x[2]; }).length, cor: cF[x[3]]})).filter(x => x.v);
  const tipoB = dxBar('Por tipo de divergência', 'tipo', tipoE, totTipo, {un}), sttB = dxBar('Situação da tratativa<span>entregas</span>', 'stt', sttE, 0, {un: 'Entregas'}), ageB = dxBar('Abertas por idade<span>entregas</span>', '', ageE, 0, {un: 'Entregas'});
  const dimB = (tit, k, fn) => dxBar(tit, k, dxContar(L(k), fn, val), soma(L(k)), {un});
  /* ---- entregas ofensoras e conferentes ---- */
  const ofE = EG.slice().sort((a, b) => b.v - a.v).slice(0, 10);
  const ofH = '<div class="cv-sc2"><table class="cv-tab cv-compact"><thead><tr><th>Entrega</th><th>Transportadora</th><th>Meca</th><th class="n">Itens</th><th class="n">Peças</th><th>Tratativa</th></tr></thead><tbody>' + (ofE.length ? ofE.map(g => '<tr class="dx-row" data-dx="ent" data-v="' + esc(g.ent) + '" title="Abrir em Gestão de divergências"><td class="cv-mono"><b>' + esc(g.ent) + '</b></td><td class="cv-cut" style="max-width:140px">' + esc(g.t) + '</td><td class="cv-cut" style="max-width:110px">' + esc(g.meca) + '</td><td class="n">' + g.itens.size + '</td><td class="n"><b>' + fInt(g.q) + '</b></td><td>' + DX_ST[g.stt][0] + ' ' + esc(g.stt) + '</td></tr>').join('') : '<tr><td colspan="6" class="field-hint" style="padding:12px">Sem dados no período.</td></tr>') + '</tbody></table></div>';
  const cm = new Map(); Ca.forEach(c => { const g = cm.get(c.por) || {n: 0, dv: 0, pc: 0, t: []}; g.n++; if(c.div) g.dv++; g.pc += c.bip; if(c.dur > 0) g.t.push(c.dur); cm.set(c.por, g); });
  const cfH = '<div class="cv-sc2"><table class="cv-tab cv-compact"><thead><tr><th>Conferente</th><th class="n">Entregas</th><th class="n">Peças</th><th class="n">% c/ diverg.</th><th class="n">Tempo médio</th></tr></thead><tbody>' + (cm.size ? Array.from(cm.entries()).sort((a, b) => b[1].n - a[1].n).slice(0, 10).map(([k, g]) => '<tr><td class="cv-cut" style="max-width:150px">' + esc(k) + '</td><td class="n">' + g.n + '</td><td class="n">' + fInt(g.pc) + '</td><td class="n">' + dxPct(g.dv, g.n) + '%</td><td class="n">' + (g.t.length ? fMin(media(g.t)) : '—') + '</td></tr>').join('') : '<tr><td colspan="5" class="field-hint" style="padding:12px">Sem dados no período.</td></tr>') + '</tbody></table></div>';
  return barra + insH + kpis +
    '<div class="cv-dgrid dx-grid4">' +
    '<div class="cv-card cv-dc s3"><h4>' + (D.met === 'q' ? 'Peças' : 'Ocorrências') + ' por dia<span>clique em um dia ou tipo para filtrar</span></h4>' + lg + tl + '</div>' +
    '<div class="cv-card cv-dc"><h4>Funil das entregas</h4>' + funH + '</div>' +
    '<div class="cv-card cv-dc s4"><h4>Acuracidade por dia<span>entregas conferidas sem divergência</span></h4>' + ac + '</div>' +
    tipoB + sttB + ageB +
    '<div class="cv-card cv-dc s2"><h4>Itens ofensores<span>Pareto — clique para filtrar</span></h4>' + parH + '</div>' +
    '<div class="cv-card cv-dc s2"><h4>Mecas<span>clique na linha para filtrar · ordene pelas colunas</span></h4>' + mecaH + '</div>' +
    dimB('Transportadora', 't', r => r.t) + dimB('Rua do local de origem', 'rua', r => r.rua) + dimB('Canal de venda', 'ca', r => r.ca) + dimB('Modelo do pedido', 'mo', r => r.mo) +
    '<div class="cv-card cv-dc s2"><h4>Mapa de calor<span>quando as divergências são registradas (dia × hora)</span></h4>' + heat + '</div>' +
    '<div class="cv-card cv-dc s2"><h4>Entregas ofensoras<span>clique para abrir a tratativa</span></h4>' + ofH + '</div>' +
    '<div class="cv-card cv-dc s2"><h4>Conferentes</h4>' + cfH + '</div>' +
    '</div>';
}
function cvDxData(k, v){ const D = CV.dx; if(D.per !== 'c'){ const p = dxPeriodo(); D.de = p.de; D.ate = p.ate; } D.per = 'c'; D[k] = v; renderView(); }
/* Cliques e tooltip do dashboard (delegados no painel: sobrevivem a cada novo desenho). */
function cvInitDash(){
  const root = $('viewRoot'), tip = $('cvTip'); if(!root || !tip) return;
  root.addEventListener('click', e => {
    const el = e.target.closest('[data-dx]'); if(!el || CV.tab !== 'dashboard') return;
    const D = CV.dx, a = el.dataset.dx, k = el.dataset.k, v = el.dataset.v;
    if(a === 'f') D.f[k] = D.f[k] === v ? '' : v;
    else if(a === 'x') D.f[k] = '';
    else if(a === 'clear') D.f = {};
    else if(a === 'per'){ D.per = v; }
    else if(a === 'met') D.met = v;
    else if(a === 'vista') D.vista = v;
    else if(a === 'sort'){ D.sm = D.sm.k === v ? {k: v, d: -D.sm.d} : {k: v, d: -1}; }
    else if(a === 'ent'){ CV.gf = {st: '', classe: '', busca: v}; CV.gaberta.add(v); cvTab('gestao'); return; }
    tip.classList.add('hidden'); renderView();
  });
  root.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-tip]'); if(!el || CV.tab !== 'dashboard'){ return; }
    let o; try { o = JSON.parse(el.dataset.tip); } catch(x){ return; }
    tip.textContent = '';
    const t = document.createElement('div'); t.className = 'ct-title'; t.textContent = o.t; tip.appendChild(t);
    (o.r || []).forEach(r => {
      const l = document.createElement('div'); l.className = 'dx-tl';
      const v = document.createElement('b'); v.textContent = r[1]; const sw = document.createElement('i'); sw.style.background = r[2]; const n = document.createElement('span'); n.textContent = r[0];
      l.appendChild(sw); l.appendChild(v); l.appendChild(n); tip.appendChild(l);
    });
    tip.classList.remove('hidden');
  });
  root.addEventListener('mousemove', e => {
    if(tip.classList.contains('hidden')) return;
    const w = tip.offsetWidth, h = tip.offsetHeight; let x = e.clientX + 14, y = e.clientY + 14;
    if(x + w > innerWidth - 8) x = e.clientX - w - 14; if(y + h > innerHeight - 8) y = e.clientY - h - 14;
    tip.style.left = Math.max(4, x) + 'px'; tip.style.top = Math.max(4, y) + 'px';
  });
  root.addEventListener('mouseout', e => { if(!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('[data-tip]')) tip.classList.add('hidden'); });
}

/* ---------- importação ---------- */
function lerArquivo(file){
  return new Promise((ok, no) => {
    const w = new Worker('js/worker.js?v=' + CV_VERSAO);
    w.onmessage = e => {
      const m = e.data;
      if(m.tipo === 'prog'){ CV.msg = m.msg; renderMsg(); return; }
      w.terminate();
      if(m.tipo === 'erro') no(new Error(m.nome + ': ' + m.msg)); else ok(m);
    };
    w.onerror = e => { w.terminate(); no(new Error(file.name + ': ' + (e.message || 'falha ao ler o arquivo (pouca memória no navegador?). Feche outras abas e tente de novo.'))); };
    try { w.postMessage({nome: file.name, file}); } catch(err){ w.terminate(); no(new Error(file.name + ': não consegui abrir o arquivo. Se ele está no OneDrive com “Sincronização pendente”, espere o ícone ficar verde ou copie para a Área de Trabalho.')); }
  });
}
async function importar(files, opts){
  opts = opts || {};
  if(somenteLeitura()) return toast('Seu acesso é só de visualização.', true);
  if(CV.ocupado || !files.length) return;
  CV.ocupado = true; CV.msg = 'Iniciando...'; CV.erroImp = ''; renderView();
  try {
    const sessao = (await cvSupa.auth.getSession()).data.session, por = sessao ? sessao.user.email : '';
    for(const f of files){
      const r = await lerArquivo(f);
      if(r.base === '180'){
        CV.msg = 'Gravando entregas na nuvem...'; renderMsg();
        const meta = {importadoEm: new Date().toISOString(), por, arquivo: r.nome, fonteModificado: f.lastModified || null, auto: !!opts.auto, linhas: r.linhas, entregas: r.dados.cabs.length, itens: r.dados.descs.length};
        await nuvemGravar('ent_desc', null, {}, dividir(r.dados.descs, 400000));
        await nuvemGravar('ent_cab', null, {}, dividir(r.dados.cabs, 400000));
        await nuvemGravar('ent_etq', null, {}, dividir(r.dados.chaves, 400000));
        CV.etqMap = new Map(r.dados.chaves);
        await nuvemGravar('ent', meta, {fmt: 2, ops: r.dados.ops}, dividir(r.dados.linhas, 400000));
        CV.ent = montarEnt(r.dados.linhas, r.dados.cabs, r.dados.descs, r.dados.ops); CV.meta.ent = meta;
      } else if(r.base === 'ean'){
        CV.msg = 'Gravando EANs na nuvem...'; renderMsg();
        const meta = {importadoEm: new Date().toISOString(), por, arquivo: r.nome, fonteModificado: f.lastModified || null, auto: !!opts.auto, linhas: r.linhas, itens: new Set(r.dados.map(x => x[0])).size, eans: r.dados.length};
        await nuvemGravar('eans', meta, {}, dividir(r.dados, 400000));
        CV.eanRows = r.dados; CV.meta.ean = meta;
      } else if(r.base === 'foto'){
        CV.msg = 'Gravando cadastro de fotos na nuvem...'; renderMsg();
        const meta = {importadoEm: new Date().toISOString(), por, arquivo: r.nome, fonteModificado: f.lastModified || null, auto: !!opts.auto, linhas: r.linhas, itens: r.dados.length};
        await nuvemGravar('fotos', meta, {}, dividir(r.dados, 400000));
        CV.fotoRows = r.dados; CV.meta.foto = meta;
      } else {
        CV.msg = 'Gravando estoque na nuvem (pode levar alguns instantes)...'; renderMsg();
        const itens = Object.keys(r.dados.itens).map(i => [i, r.dados.itens[i].d, r.dados.itens[i].e]);
        const meta = {importadoEm: new Date().toISOString(), por, arquivo: r.nome, fonteModificado: f.lastModified || null, auto: !!opts.auto, linhas: r.linhas, itens: itens.length, locais: r.dados.saldo.length};
        await nuvemGravar('est_itens', null, {}, dividir(itens, 400000));
        await nuvemGravar('est_saldo', meta, {}, dividir(r.dados.saldo, 400000));
        CV.itens = r.dados.itens; CV.saldo = r.dados.saldo; CV.meta.est = meta;
      }
    }
    indexar();
    if(CV.num && CV.porEnt.get(CV.num)) CV.linhas = montarLinhas(CV.porEnt.get(CV.num));
    toast(opts.auto ? 'Bases atualizadas sozinhas pelo Almoxarifado.' : 'Importação concluída.');
  } catch(e){
    console.error(e); CV.erroImp = (e && e.message) || String(e); toast('Importação não concluída — veja o aviso em vermelho.', true);
  } finally { CV.ocupado = false; CV.msg = ''; renderView(); }
}

/* ---------- Atualização automática pelo Almoxarifado da Oficina ----------
   O PC de atualização deixa os Excel (QRY0180, QRY0390, SIGEQ230, FOTOS) na pasta Bases do
   SharePoint; o Almoxarifado guarda uma cópia neste navegador. Ao abrir o Check Volume
   (e a cada 15 min aberto), se lá tiver um arquivo MAIS NOVO que o importado na nuvem,
   ele importa sozinho — e a nuvem passa a valer para todo mundo. Só quem pode editar. */
CV.autoFalhou = {};
const CV_ALMOX = [{id: 'QRY0180', meta: 'ent'}, {id: 'QRY0390', meta: 'est'}, {id: 'SIGEQ230', meta: 'ean'}, {id: 'FOTOS', meta: 'foto'}];
async function cvAutoAlmox(){
  const A = window.LDM_ALMOX;
  if(!A || somenteLeitura() || CV.ocupado || CV.carregando) return;
  try {
    const h = await A.pastaSalva();
    if(h && await A.permissao(h, false) === 'granted') await A.lerPasta(h);
  } catch(e){ /* sem pasta neste navegador: usa o que o Almoxarifado já tiver */ }
  const novos = [];
  for(const b of CV_ALMOX){
    try {
      const p = await A.pacote(b.id);
      const a = p.arquivos.filter(x => /\.xls[xm]?$/i.test(x.nome))[0];
      if(!a) continue;
      const m = CV.meta[b.meta];
      const jaTem = m ? (m.fonteModificado || Date.parse(m.importadoEm) || 0) : 0;
      if(a.modificado > jaTem && CV.autoFalhou[a.nome] !== a.modificado) novos.push(new File([a.blob], a.nome, {lastModified: a.modificado}));
    } catch(e){}
  }
  /* Um de cada vez: se um arquivo não for reconhecido, os outros entram assim mesmo,
     e o que falhou não é tentado de novo até chegar uma versão nova dele. */
  for(const f of novos){
    CV.erroImp = '';
    await importar([f], {auto: true});
    if(CV.erroImp) CV.autoFalhou[f.name] = f.lastModified;
  }
}

/* ---------- Atender entrega: Excel com o que faltou, onde foi coletado e onde pegar ---------- */
function planilha(aoa, larg){
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = larg.map(w => ({wch: w}));
  const ref = XLSX.utils.decode_range(ws['!ref']);
  for(let c = ref.s.c; c <= ref.e.c; c++){
    const cel = ws[XLSX.utils.encode_cell({r: 0, c})];
    if(cel) cel.s = {fill: {fgColor: {rgb: '001A72'}}, font: {bold: true, color: {rgb: 'FFFFFF'}}, alignment: {vertical: 'center', wrapText: true}};
  }
  ws['!rows'] = [{hpt: 30}];
  ws['!freeze'] = {xSplit: 0, ySplit: 1};
  return ws;
}
/* Monta o Excel de "Atender entrega". faltas: [{x:{i,d,eans,orig}, prev, b, f}], sobras: [{x, q}], desc: {ean: {n, nome}}. */
function atenderExcel(num, faltas, sobras, desc){
  if(!window.XLSX) return toast('Biblioteca de Excel ainda carregando, tente de novo.', true);
  const nSug = 3;
  let xAtual = null;
  const tp = a => tipoRot(a) + (xAtual && ehOrigem(xAtual, a) ? ' · local da coleta' : '');
  const cab1 = ['Entrega', 'Código', 'Descrição', 'EAN', 'Prevista', 'Bipada', 'Faltam', 'Local de coleta (origem)', 'Saldo hoje na origem'];
  for(let k = 1; k <= nSug; k++) cab1.push('Sugestão ' + k + ' · local', 'Tipo', 'Saldo');
  cab1.push('Observação');
  const l1 = [cab1], l2 = [['Entrega', 'Código', 'Descrição', 'Faltam', 'Prioridade', 'Local sugerido', 'Tipo', 'Saldo disponível', 'Cobre a falta?', 'Classe', 'Restrição']];
  faltas.forEach(({x, prev, b, f}) => {
    xAtual = x;
    const alts = alternativas(x, f, Math.max(CV.cfg.max || 5, nSug));
    const lin = [num, x.i, x.d, (x.eans || []).join(' / '), prev == null ? '' : prev, b == null ? '' : b, f, x.orig.join(' / '), saldoNaOrigem(x)];
    for(let k = 0; k < nSug; k++) lin.push(alts[k] ? alts[k][1] : '', alts[k] ? tp(alts[k]) : '', alts[k] ? alts[k][2] : '');
    const temPk = alts.some(a => tipoClasse(a[3]) === 'pk');
    lin.push(alts.length ? (temPk ? '' : 'Sem saldo em picking — só locais não picking') : (CV.cfg.incluirNao ? 'Nenhum outro local com saldo disponível — verificar estoque/reposição' : 'Nenhum outro local de picking com saldo disponível'));
    l1.push(lin);
    alts.forEach((a, k) => l2.push([num, x.i, x.d, f, k + 1, a[1], tp(a), a[2], a[2] >= f ? 'Sim' : 'Não, parcial', a[3], a[4]]));
  });
  const l3 = [['Entrega', 'Tipo', 'Código / EAN', 'Descrição', 'Quantidade', 'Observação']];
  sobras.forEach(({x, q}) => l3.push([num, 'Sobra', x.i, x.d, q, 'Peças a mais do que o previsto — devolver ao local de origem ' + (x.orig[0] || '')]));
  Object.keys(desc || {}).forEach(k => l3.push([num, 'EAN não identificado', k, desc[k].nome || '', desc[k].n, desc[k].nome ? 'EAN de outro produto' : 'EAN sem cadastro na QRY0390']));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, planilha(l1, [12, 11, 44, 16, 9, 8, 8, 24, 12, 18, 12, 9, 18, 12, 9, 18, 12, 9, 40]), 'Atender entrega');
  XLSX.utils.book_append_sheet(wb, planilha(l2, [12, 11, 44, 8, 10, 18, 13, 12, 14, 9, 10]), 'Locais sugeridos');
  if(l3.length > 1) XLSX.utils.book_append_sheet(wb, planilha(l3, [12, 20, 18, 44, 11, 54]), 'Sobras e EAN');
  XLSX.writeFile(wb, 'atender-entrega-' + num + '.xlsx');
  toast('Excel gerado: ' + faltas.length + ' item(ns) para atender.');
}
function cvAtender(){
  if(!CV.sess) return;
  const s = CV.sess;
  const faltas = CV.linhas.filter(x => (s.bips[x.i] || 0) < x.prev).map(x => ({x, prev: x.prev, b: s.bips[x.i] || 0, f: x.prev - (s.bips[x.i] || 0)}));
  const sobras = CV.linhas.filter(x => (s.bips[x.i] || 0) > x.prev).map(x => ({x, q: s.bips[x.i] - x.prev}));
  atdAbrir(CV.num, faltas, sobras, JSON.parse(JSON.stringify(s.desc || {})));
}
const eansDoItem = i => Array.from(new Set(((CV.itens[i] && CV.itens[i].e) || []).concat(CV.eansExtra.get(i) || [])));
/* Dados do atendimento a partir das ocorrências já gravadas (Gestão de divergências ou link). */
function atdDados(ent){
  const ocs = CV.ctrl.filter(c => c.ent === ent), desc = {};
  const mk = c => ({i: c.item, d: c.d, eans: eansDoItem(c.item), orig: c.orig ? c.orig.split(' / ') : []});
  const faltas = ocs.filter(c => c.tipo === 'Falta' || c.tipo === 'Item não localizado').map(c => ({x: mk(c), prev: c.prev, b: c.bip, f: c.q}));
  const sobras = ocs.filter(c => c.tipo === 'Sobra').map(c => ({x: mk(c), q: c.q}));
  ocs.filter(c => c.tipo === 'EAN não identificado').forEach(c => { desc[c.item] = {n: c.q, nome: c.d}; });
  return {faltas, sobras, desc};
}
function cvGAtender(ent){
  const d = atdDados(ent);
  if(!d.faltas.length && !d.sobras.length && !Object.keys(d.desc).length) return toast('Essa entrega não tem falta, sobra ou EAN não identificado.', true);
  atdAbrir(ent, d.faltas, d.sobras, d.desc);
}

/* ---------- Atendimento no celular: conferir, local por local, onde a peça está ---------- */
/* Cada item mostra a origem da coleta e os locais sugeridos; a pessoa marca "Achei" (com a quantidade) ou "Não tem".
   O andamento é gravado na nuvem (chave 'atd', um registro por entrega): qualquer aparelho abre e continua. */
function atdLocais(f){
  const x = f.x, falta = f.f, alts = alternativas(x, falta, 6), out = [], vis = new Set();
  const add = (loc, saldo, rot, cobre) => { const k = normLoc(loc); if(vis.has(k)) return; vis.add(k); out.push({loc, saldo, rot, cobre}); };
  x.orig.forEach(o => { if(!alts.some(s => normLoc(s[1]) === normLoc(o))) add(o, (CV.saldoItem.get(x.i) || []).filter(s => normLoc(s[1]) === normLoc(o)).reduce((a, s) => a + s[2], 0), 'Local da coleta', false); });
  alts.forEach(s => add(s[1], s[2], ehOrigem(x, s) ? 'Local da coleta' : tipoRot(s), s[2] >= falta));
  return out;
}
function atdEstado(i){
  const A = CV.atdA, f = A.faltas[i], m = A.m[f.x.i] || {}, locs = A.loc[i];
  const ach = locs.reduce((a, l) => a + (m[l.loc] && m[l.loc].s === 'ok' ? m[l.loc].q : 0), 0) + (m._outro && m._outro.s === 'ok' ? m._outro.q : 0);
  if(ach >= f.f) return {st: 'ok', ach};
  if(m._nl || (locs.length && locs.every(l => m[l.loc] && m[l.loc].s === 'no'))) return {st: 'nao', ach};
  return {st: 'pend', ach};
}
function atdAbrir(ent, faltas, sobras, desc){
  const A = CV.atdA = {ent, faltas, sobras, desc, m: {}, loc: faltas.map(atdLocais), idx: 0, todos: false};
  let el = $('cvAtd'); if(!el){ el = document.createElement('div'); el.id = 'cvAtd'; el.className = 'atd'; document.body.appendChild(el); }
  document.body.classList.add('atd-aberto'); atdRender();
  ctrlLerUm('atd', ent).then(r => { if(CV.atdA === A && r && r.itens){ A.m = r.itens; A.idx = atdProx(-1); atdRender(); } }).catch(() => {});
}
/* Próximo item ainda pendente depois de 'de' (volta ao início se preciso); -1 quando não sobra nenhum. */
function atdProx(de){
  const A = CV.atdA, n = A.faltas.length;
  for(let k = 1; k <= n; k++){ const i = (de + k + n) % n; if(atdEstado(i).st === 'pend') return i; }
  return -1;
}
function atdSel(i){ const A = CV.atdA; A.todos = false; A.idx = i; atdRender(); }
function atdIr(d){ const A = CV.atdA, n = A.faltas.length; if(!n) return; A.todos = false; A.idx = ((A.idx < 0 ? (d > 0 ? -1 : 0) : A.idx) + d + n) % n; atdRender(); }
function atdTodos(){ const A = CV.atdA; A.todos = !A.todos; if(!A.todos && A.idx < 0 && atdProx(-1) >= 0) A.idx = atdProx(-1); atdRender(); }
/* Resolveu o item da tela (achou ou não localizou): passa sozinho para o próximo pendente, até zerar a entrega. */
function atdAvanca(i){
  const A = CV.atdA; if(!A) return;
  if(atdEstado(i).st === 'pend') return;
  clearTimeout(A.tm); A.tm = setTimeout(() => { if(CV.atdA !== A || A.todos || A.idx !== i) return; A.idx = atdProx(i); atdRender(); }, 700);
}
function atdFechar(){ CV.atdA = null; const el = $('cvAtd'); if(el) el.remove(); document.body.classList.remove('atd-aberto'); }
function atdRender(){
  const A = CV.atdA, el = $('cvAtd'); if(!A || !el) return;
  const ro = somenteLeitura(), sts = A.faltas.map((_, i) => atdEstado(i)), nOk = sts.filter(s => s.st === 'ok').length, nNao = sts.filter(s => s.st === 'nao').length;
  const y = el.querySelector('.atd-body') ? el.querySelector('.atd-body').scrollTop : 0;
  const ROT = {ok: '✓ Atendido', nao: '✗ Não localizado', pend: 'Pendente'};
  const cards = A.faltas.map((f, i) => {
    const x = f.x, m = A.m[x.i] || {}, e = sts[i], falta = Math.max(f.f - e.ach, 0), ik = i;
    const locs = A.loc[i].map((l, li) => {
      const r = m[l.loc], sd = '<small>' + esc(l.rot) + ' · saldo <b>' + fInt(l.saldo) + '</b>' + (l.cobre ? ' · cobre' : '') + '</small>';
      if(r) return '<div class="atd-loc ' + (r.s === 'ok' ? 'ok' : 'no') + '"><div><code>' + esc(l.loc) + '</code>' + sd + '</div><div class="atd-r"><b>' + (r.s === 'ok' ? '✓ Achei ' + fInt(r.q) : '✗ Não tem') + '</b>' + (ro ? '' : '<button type="button" class="atd-lk" onclick="atdMarca(' + ik + ',' + li + ',\'x\')">desfazer</button>') + '</div></div>';
      const q0 = Math.max(1, Math.min(falta || 1, l.saldo || falta || 1));
      return '<div class="atd-loc"><div><code>' + esc(l.loc) + '</code>' + sd + '</div>' + (ro ? '' : '<div class="atd-r"><input type="number" inputmode="numeric" min="1" id="atq_' + ik + '_' + li + '" value="' + q0 + '" aria-label="Quantidade achada"><button type="button" class="atd-b ok" onclick="atdMarca(' + ik + ',' + li + ',\'ok\')">✓ Achei</button><button type="button" class="atd-b no" onclick="atdMarca(' + ik + ',' + li + ',\'no\')">✗ Não tem</button></div>') + '</div>';
    }).join('') || '<div class="atd-loc"><div class="field-hint">' + (CV.saldo.length ? 'Nenhum local com saldo no sistema.' : 'Importe a QRY0390 para ver locais.') + '</div></div>';
    const o = m._outro;
    const outro = o ? '<div class="atd-loc ok"><div><code>' + esc(o.loc) + '</code><small>Outro local</small></div><div class="atd-r"><b>✓ Achei ' + fInt(o.q) + '</b>' + (ro ? '' : '<button type="button" class="atd-lk" onclick="atdOutro(' + ik + ',true)">desfazer</button>') + '</div></div>' : (ro || e.st === 'ok' ? '' : '<div class="atd-loc"><div><small>Achou em outro local?</small></div><div class="atd-r"><button type="button" class="atd-b" onclick="atdOutro(' + ik + ')">+ Outro local</button></div></div>');
    return '<section class="atd-card ' + e.st + '"><header>' + fotoHtml(x.i, 'atd-foto') + '<div><div class="atd-cod">' + esc(x.i) + '</div><div class="atd-d">' + esc(x.d) + '</div><div class="atd-f">Faltam <b>' + fInt(f.f) + '</b>' + (e.ach ? ' · achadas <b>' + fInt(e.ach) + '</b>' : '') + '</div></div><span class="atd-st ' + e.st + '">' + ROT[e.st] + '</span></header>' + locs + outro +
      (ro || e.st === 'ok' ? '' : '<button type="button" class="atd-nl' + (m._nl ? ' on' : '') + '" onclick="atdNL(' + ik + ')">' + (m._nl ? '✗ Marcado como não localizado — desfazer' : 'Não localizei em nenhum local') + '</button>') + '</section>';
  }).join('');
  const extra = (A.sobras.length ? '<div class="atd-sec">Sobras — devolver ao local de origem</div>' + A.sobras.map(s => '<div class="atd-ex"><b>+' + fInt(s.q) + '</b> ' + esc(s.x.i) + ' · ' + esc(descCurta(s.x.d)) + '<small>origem ' + esc(s.x.orig[0] || '—') + '</small></div>').join('') : '') +
    (Object.keys(A.desc).length ? '<div class="atd-sec">EAN não identificado</div>' + Object.keys(A.desc).map(k => '<div class="atd-ex"><b>' + A.desc[k].n + '×</b> ' + esc(k) + '<small>' + esc(A.desc[k].nome || 'sem cadastro') + '</small></div>').join('') : '');
  el.innerHTML = '<div class="atd-top"><button type="button" class="atd-x" onclick="atdFechar()" aria-label="Fechar">✕</button><div><b>Atender entrega ' + esc(A.ent) + '</b><small>' + nOk + ' de ' + A.faltas.length + ' itens atendidos' + (nNao ? ' · ' + nNao + ' não localizado(s)' : '') + '</small></div></div>' +
    '<div class="atd-prog"><u style="width:' + (A.faltas.length ? (nOk + nNao) / A.faltas.length * 100 : 0) + '%"></u></div>' +
    (A.faltas.length ? '<div class="atd-nav"><button type="button" onclick="atdIr(-1)" aria-label="Item anterior">‹</button><div>' + (A.todos ? 'Todos os itens' : A.idx < 0 ? 'Entrega zerada' : 'Item <b>' + (A.idx + 1) + '</b> de ' + A.faltas.length) + '</div><button type="button" onclick="atdIr(1)" aria-label="Próximo item">›</button><button type="button" class="atd-tg" onclick="atdTodos()">' + (A.todos ? 'Um por vez' : 'Ver todos') + '</button></div>' : '') +
    (A.faltas.length > 1 ? '<div class="atd-chips">' + A.faltas.map((f, i) => '<button type="button" class="atd-chip ' + sts[i].st + (!A.todos && A.idx === i ? ' cur' : '') + '" onclick="atdSel(' + i + ')"><b>' + (i + 1) + '</b> ' + esc(f.x.i) + '<span>' + (sts[i].st === 'ok' ? '✓' : sts[i].st === 'nao' ? '✗' : 'faltam ' + fInt(Math.max(f.f - sts[i].ach, 0))) + '</span></button>').join('') + '</div>' : '') +
    '<div class="atd-body">' + (!A.faltas.length ? '<p class="field-hint" style="padding:16px">Sem itens faltantes nesta entrega.</p>' : A.todos ? cards : A.idx < 0 ? '<div class="atd-fim"><b>✓ Todos os itens tratados</b><p>' + nOk + ' atendido(s)' + (nNao ? ' · ' + nNao + ' não localizado(s)' : '') + '.</p><p>Toque em <b>Concluir atendimento</b> para registrar na Gestão de divergências.</p></div>' : cards.split('</section>')[A.idx] + '</section>') + extra + '</div>' +
    '<div class="atd-foot"><button type="button" class="btn btn-secondary" onclick="atdLink()">Copiar link</button><button type="button" class="btn btn-secondary" onclick="atenderExcel(CV.atdA.ent, CV.atdA.faltas, CV.atdA.sobras, CV.atdA.desc)">Excel</button>' + (ro ? '' : '<button type="button" class="btn btn-orange" onclick="atdConcluir()">Concluir atendimento</button>') + '</div>';
  const b = el.querySelector('.atd-body'); if(b) b.scrollTop = y;
}
async function atdSalva(item){
  const A = CV.atdA; if(!A || somenteLeitura()) return;
  try {
    const ult = await ctrlLerUm('atd', A.ent).catch(() => null), itens = Object.assign({}, (ult && ult.itens) || {}, {[item]: A.m[item] || {}});
    await ctrlAtualiza('atd', A.ent, {itens, upd: new Date().toISOString(), por: CV.email});
  } catch(e){ toast('Não foi possível gravar na nuvem: ' + ((e && e.message) || e), true); }
}
function atdMarca(i, li, acao){
  const A = CV.atdA, f = A.faltas[i], l = A.loc[i][li], m = A.m[f.x.i] = A.m[f.x.i] || {};
  if(acao === 'x') delete m[l.loc];
  else if(acao === 'no') m[l.loc] = {s: 'no', q: 0};
  else { const q = Math.max(1, parseInt(($('atq_' + i + '_' + li) || {}).value, 10) || 1); m[l.loc] = {s: 'ok', q}; delete m._nl; }
  atdRender(); atdSalva(f.x.i); atdAvanca(i);
}
function atdOutro(i, desfaz){
  const A = CV.atdA, f = A.faltas[i], m = A.m[f.x.i] = A.m[f.x.i] || {};
  if(desfaz) delete m._outro;
  else { const loc = (prompt('Em qual local você achou?') || '').trim().toUpperCase(); if(!loc) return; const q = Math.max(1, parseInt(prompt('Quantas peças achou?', String(Math.max(f.f - atdEstado(i).ach, 1))), 10) || 0); if(!q) return; m._outro = {s: 'ok', loc, q}; delete m._nl; }
  atdRender(); atdSalva(f.x.i); atdAvanca(i);
}
function atdNL(i){
  const A = CV.atdA, f = A.faltas[i], m = A.m[f.x.i] = A.m[f.x.i] || {};
  if(m._nl) delete m._nl; else m._nl = true;
  atdRender(); atdSalva(f.x.i); atdAvanca(i);
}
function atdLink(){
  const u = location.origin + location.pathname.replace(/[^/]*$/, '') + '?atender=' + encodeURIComponent(CV.atdA.ent);
  (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => toast('Link copiado — abra no celular.'), () => prompt('Copie o link:', u));
}
/* Concluir: o que foi achado vira "Atendida" na Gestão; o que não foi achado vira "Item não localizado". */
async function atdConcluir(){
  const A = CV.atdA; if(!A) return;
  const sts = A.faltas.map((_, i) => atdEstado(i)), pend = sts.filter(s => s.st === 'pend').length;
  if(pend && !confirm(pend + ' item(ns) ainda sem resposta. Concluir mesmo assim? Eles continuam abertos.')) return;
  try {
    for(let i = 0; i < A.faltas.length; i++){
      const it = A.faltas[i].x.i, m = A.m[it] || {}, e = sts[i], id = [A.ent, 'Falta', it].join('|'), c = CV.ctrl.find(r => r.ent === A.ent && r.item === it && (r.tipo === 'Falta' || r.tipo === 'Item não localizado'));
      if(!c || e.st === 'pend') continue;
      const locs = A.loc[i].filter(l => m[l.loc] && m[l.loc].s === 'ok').map(l => l.loc + ' (' + m[l.loc].q + ')').concat(m._outro ? [m._outro.loc + ' (' + m._outro.q + ')'] : []);
      if(e.st === 'ok') await ctrlAtualiza('ctrl', c.id, {st: 'atendida', at: new Date().toISOString(), atpor: CV.email, obs: 'Achado em ' + locs.join(', ')});
      else await ctrlAtualiza('ctrl', c.id, {tipo: 'Item não localizado', obs: 'Não localizado nos locais sugeridos'});
    }
    await ctrlAtualiza('atd', A.ent, {itens: A.m, done: new Date().toISOString(), upd: new Date().toISOString(), por: CV.email});
    toast('Atendimento concluído.'); atdFechar(); if(CV.tab === 'gestao' || CV.tab === 'dashboard') renderView();
  } catch(e){ toast((e && e.message) || String(e), true); }
}
async function atdPeloLink(){
  const ent = new URLSearchParams(location.search).get('atender'); if(!ent) return;
  try { CV.ctrl = await ctrlLer('ctrl'); } catch(e){}
  const d = atdDados(ent);
  if(!d.faltas.length && !d.sobras.length) return toast('Entrega ' + ent + ' sem itens para atender (finalize a conferência primeiro).', true);
  atdAbrir(ent, d.faltas, d.sobras, d.desc);
}

/* ---------- exportar ---------- */
function cvExportar(){
  if(!window.XLSX) return toast('Biblioteca de Excel ainda carregando, tente de novo.', true);
  if(!CV.sess) return;
  const itens = CV.linhas.map(x => {
    const b = CV.sess.bips[x.i] || 0, st = b === x.prev ? 'Conferido' : b > x.prev ? 'Sobra' : 'Faltante';
    return {Entrega: CV.num, Item: x.i, Descrição: x.d, EAN: x.eans.join(' / '), Prevista: x.prev, Bipada: b, Pendente: Math.max(x.prev - b, 0), Excedente: Math.max(b - x.prev, 0), Situação: st, 'Local de origem': x.orig.join(' / ')};
  });
  const locais = [];
  CV.linhas.filter(x => (CV.sess.bips[x.i] || 0) < x.prev).forEach(x => {
    const f = x.prev - (CV.sess.bips[x.i] || 0);
    alternativas(x, f).forEach(s => locais.push({Item: x.i, Descrição: x.d, Faltam: f, 'Local sugerido': s[1], Saldo: s[2], Classe: s[3], Restrição: s[4]}));
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itens), 'Conferência');
  if(locais.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(locais), 'Onde achar');
  const dk = Object.keys(CV.sess.desc);
  if(dk.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dk.map(k => ({'EAN bipado': k, Leituras: CV.sess.desc[k].n, Observação: CV.sess.desc[k].nome}))), 'EAN não identificado');
  XLSX.writeFile(wb, 'check-volume-' + CV.num + '.xlsx');
}

/* ---------- navegação / estado ---------- */
const VIEWS = {conferir: viewConferir, entregas: viewEntregas, historico: viewHistorico, gestao: viewGestao, dashboard: viewDashboard, configuracoes: viewConfig};
function renderMsg(){ const el = $('cvMsg'); if(el) el.textContent = CV.ocupado ? '⏳ ' + CV.msg : ''; }
function renderView(){
  if(CV.erro && !CV.ent.length && !CV.saldo.length && CV.tab !== 'configuracoes'){ $('viewRoot').innerHTML = vazio(); return; }
  if(somenteLeitura() && CV.tab === 'configuracoes') CV.tab = 'conferir';
  if(!VIEWS[CV.tab]) CV.tab = 'conferir';
  const el = $('viewRoot'); if(!el) return;
  const sc = document.querySelector('.page-scroll'), y = sc ? sc.scrollTop : 0;
  el.innerHTML = VIEWS[CV.tab]();
  const t = CV_TITULOS[CV.tab];
  $('tabTitle').textContent = t[0]; $('tabSubtitle').textContent = t[1];
  document.querySelectorAll('.nav-item[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === CV.tab));
  const drop = $('cvDrop');
  if(drop){
    ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('has-file'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('has-file'); }));
    drop.addEventListener('drop', e => importar(Array.from(e.dataTransfer.files)));
  }
  if(CV.tab === 'conferir' && $('cvKpis')) atualizar();
  if(sc) sc.scrollTop = y;
}
function cvTab(t){ CV.tab = t; CV.pag = 0; CV.cpag = 0; renderView(); if(t === 'dashboard' || t === 'gestao' || t === 'historico') Promise.all([ctrlLer('ctrl'), ctrlLer('conf'), ctrlLer('trat'), ctrlLer('and')]).then(r => { CV.ctrl = r[0]; CV.conf = r[1]; CV.trat = r[2]; CV.and = r[3]; if(CV.tab === t) renderView(); }).catch(() => {}); cvCloseSidebarMobile(); if(t === 'conferir') setTimeout(() => { const i = $('cvBip') || $('cvEnt'); if(i) i.focus(); }, 0); }
function cvPag(n){ CV.pag += n; renderView(); }
let _cvBT; function cvBuscaEnt(v){ CV.busca = v; CV.pag = 0; clearTimeout(_cvBT); _cvBT = setTimeout(() => { renderView(); const i = $('cvBusca'); if(i){ i.focus(); i.setSelectionRange(v.length, v.length); } }, 250); }
function cvToggleSidebar(){ const el = $('sidebar'); if(matchMedia('(max-width:860px)').matches) el.classList.toggle('mobile-open'); else el.classList.toggle('collapsed'); }
function cvCloseSidebarMobile(){ if(matchMedia('(max-width:860px)').matches) $('sidebar').classList.remove('mobile-open'); }
/* Tema: mesmo botão/menu da Central e a mesma preferência (ldm-theme) — claro/escuro vale para os dois. */
function cvInitTema(){
  const btn = $('layoutBtn'), panel = $('layoutPanel'), opts = document.querySelectorAll('.layout-opt[data-tema]');
  function aplicar(dark){
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    opts.forEach(o => o.classList.toggle('active', (o.dataset.tema === 'dark') === dark));
  }
  let dark = false;
  try { const t = localStorage.getItem('ldm-theme') || localStorage.getItem('cv-theme'); dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; } catch(e){}
  aplicar(dark);
  opts.forEach(o => o.addEventListener('click', () => { dark = o.dataset.tema === 'dark'; aplicar(dark); try { localStorage.setItem('ldm-theme', dark ? 'dark' : 'light'); } catch(e){} }));
  if(btn && panel){
    btn.addEventListener('click', e => { e.stopPropagation(); panel.hidden = !panel.hidden; btn.classList.toggle('on', !panel.hidden); });
    document.addEventListener('click', e => { if(!panel.hidden && !panel.contains(e.target) && e.target !== btn){ panel.hidden = true; btn.classList.remove('on'); } });
  }
}
window.cvAplicarNivel = () => renderView();

/* ---------- início (chamado por acesso.js depois do login) ---------- */
async function cvInit(){
  cvInitTema(); cvInitDash();
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { try { audioCtx(); } catch(e){} }, {once: true}));
  try { cvSupa.auth.getSession().then(r => { CV.email = (r.data.session && r.data.session.user.email) || ''; }); } catch(e){}
  const v = $('sidebarVersao'); if(v) v.textContent = 'Check Volume · v' + CV_VERSAO;
  renderView();
  await carregar();
  CV.carregando = false;
  renderView();
  atdPeloLink();
  setTimeout(() => { const i = $('cvEnt'); if(i) i.focus(); }, 0);
  cvAutoAlmox();
  setInterval(cvAutoAlmox, 15 * 60 * 1000);
}
