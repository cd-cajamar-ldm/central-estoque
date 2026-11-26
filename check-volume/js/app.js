/* ============================================================
   Check Volume — conferência de entregas por bipagem de EAN.
   Bases: QRY0180 (itens por entrega, com o local de coleta) e QRY0390
   (estoque: EAN de cada item e saldo por local).
   Bases compartilhadas em public.app_dados (app = 'checkvolume', migração 008).
   O andamento da conferência de cada entrega fica neste navegador
   (localStorage) — é rascunho de quem está bipando.
   ============================================================ */
const CV_VERSAO = 8; // subir a cada alteração (aparece no rodapé do menu; trocar também o ?v= no index.html e o CACHE_VERSION do sw.js)
const CV_TAB = 'app_dados', CV_APP = 'checkvolume';
const CV_TITULOS = {
  conferir: ['Conferir entrega', 'Informe a entrega e bipe os EANs das peças.'],
  entregas: ['Entregas', 'Entregas da QRY0180 importada.'],
  controle: ['Controle de Entregas', 'Divergências apontadas e ocorrências fora da conferência.'],
  dashboard: ['Dashboard de divergências', 'Indicadores das ocorrências registradas.'],
  importacao: ['Importação', 'Bases do Check Volume.'],
  configuracoes: ['Configurações', 'Regras das sugestões de outros locais.']
};
const CV = {
  ent: [], itens: {}, saldo: [], meta: {}, cfg: {ignorar: ['REV', 'AVA'], restricoes: ['WN'], max: 5, picking: ['PP']},
  fotos: new Map(),
  porEnt: new Map(), eanMap: new Map(), saldoItem: new Map(),
  tab: 'conferir', num: '', sess: null, linhas: [], desc: new Set(), pag: 0, busca: '',
  ocupado: false, msg: '', carregando: true, erro: '', ult: null, aberto: new Set(),
  ctrl: [], cf: {st: '', tipo: '', busca: '', de: '', ate: ''}, df: {de: '', ate: ''}, cpag: 0, cnovo: false, email: '', eanRows: [], eansExtra: new Map()
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
let _audio;
function beep(tipo){
  try {
    _audio = _audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = _audio.createOscillator(), g = _audio.createGain();
    o.connect(g); g.connect(_audio.destination);
    o.type = tipo === 'ok' ? 'sine' : 'square'; o.frequency.value = tipo === 'ok' ? 880 : 220;
    g.gain.value = .08; o.start(); o.stop(_audio.currentTime + (tipo === 'ok' ? .08 : .28));
  } catch(e){}
}

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
function montarEnt(linhas, cabs, descs){
  const cab = new Map(cabs.map(x => [x[0], x])), ds = new Map(descs);
  return linhas.map(r => { const c = cab.get(r[0]) || []; return {e: r[0], i: r[1], q: r[2], o: r[3], d: ds.get(r[1]) || '', t: c[1] || '', ev: c[2] || '', li: c[3] || '', ca: c[4] || '', vo: c[5] || 0, mo: c[6] || ''}; });
}
/* ---------- índices ---------- */
function indexar(){
  CV.porEnt = new Map();
  CV.ent.forEach(r => { let a = CV.porEnt.get(r.e); if(!a) CV.porEnt.set(r.e, a = []); a.push(r); });
  CV.eanMap = new Map();
  Object.keys(CV.itens).forEach(i => (CV.itens[i].e || []).forEach(e => { const k = normEan(e); if(k && !CV.eanMap.has(k)) CV.eanMap.set(k, i); }));
  CV.eansExtra = new Map();
  (CV.eanRows || []).forEach(r => { const k = normEan(r[1]); if(!k) return; let a = CV.eansExtra.get(r[0]); if(!a) CV.eansExtra.set(r[0], a = []); if(a.indexOf(r[1]) < 0) a.push(r[1]); if(!CV.eanMap.has(k)) CV.eanMap.set(k, r[0]); });
  CV.fotoMap = new Map();
  (CV.fotoRows || []).forEach(f => { CV.fotoMap.set(f[0], f[1]); const k = normEan(f[2]); if(k && !CV.eanMap.has(k)) CV.eanMap.set(k, f[0]); });
  CV.saldoItem = new Map();
  CV.saldo.forEach(s => { let a = CV.saldoItem.get(s[0]); if(!a) CV.saldoItem.set(s[0], a = []); a.push(s); });
}
async function carregar(){
  try {
    const [cfg, ent, ei, es, ft, ec, ed, en2] = await Promise.all([nuvemLer('cfg'), nuvemLer('ent'), nuvemLer('est_itens'), nuvemLer('est_saldo'), nuvemLer('fotos'), nuvemLer('ent_cab'), nuvemLer('ent_desc'), nuvemLer('eans')]);
    if(cfg && cfg.dados && cfg.dados.cfg) Object.assign(CV.cfg, cfg.dados.cfg);
    CV.ent = !ent ? [] : (ent.dados && ent.dados.fmt === 2 ? montarEnt(ent.linhas, ec ? ec.linhas : [], ed ? ed.linhas : []) : ent.linhas);
    CV.itens = {}; (ei ? ei.linhas : []).forEach(x => { CV.itens[x[0]] = {d: x[1], e: x[2]}; });
    CV.saldo = es ? es.linhas : [];
    CV.fotoRows = ft ? ft.linhas : [];
    CV.eanRows = en2 ? en2.linhas : [];
    CV.meta = {ent: ent && ent.meta, est: es && es.meta, foto: ft && ft.meta, ean: en2 && en2.meta};
    indexar();
    CV.ctrl = await ctrlLer().catch(() => []);
  } catch(e){
    CV.erro = 'Não consegui ler os dados: ' + (e.message || e) + (/app_dados|relation|does not exist/i.test(String(e.message)) ? ' — a tabela app_dados ainda não foi criada no banco (migração 008).' : '');
  }
}

/* ---------- conferência de uma entrega ---------- */
const sessKey = n => 'cv-sessao-' + n;
function lerSessao(n){
  try { const o = JSON.parse(localStorage.getItem(sessKey(n)) || 'null'); if(o) return o; } catch(e){}
  return {bips: {}, desc: {}, log: [], fin: false, ini: Date.now()};
}
function gravarSessao(){ try { localStorage.setItem(sessKey(CV.num), JSON.stringify(CV.sess)); } catch(e){} }

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
function abrirEntrega(n){
  n = String(n || '').trim().replace(/\D/g, '');
  if(!n) return toast('Informe o número da entrega.', true);
  const rows = CV.porEnt.get(n);
  if(!rows){
    CV.num = ''; CV.sess = null; CV.linhas = [];
    CV.ult = {tipo: 'ean', txt: 'Entrega ' + n + ' não encontrada na QRY0180 importada' + (CV.meta.ent && CV.meta.ent.importadoEm ? ' em ' + fData(CV.meta.ent.importadoEm.slice(0, 10)) : '') + '.'};
    beep('erro'); renderView(); setTimeout(() => { const e = $('cvEnt'); if(e){ e.focus(); e.select(); } }, 0); return;
  }
  CV.num = n; CV.sess = lerSessao(n); CV.linhas = montarLinhas(rows); CV.ult = null; CV.aberto = new Set(); CV.tab = 'conferir';
  renderView(); setTimeout(focoBip, 0);
  fotosDoSite(CV.linhas.map(x => x.i));
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
  if(!CV.sess){ toast('Informe a entrega primeiro.', true); const e = $('cvEnt'); if(e) e.focus(); return; }
  const cod = String(codigo || '').trim(); if(!cod) return;
  const k = normEan(cod);
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
function cvFinalizar(){
  if(!CV.sess) return; CV.sess.fin = true; gravarSessao(); CV.aberto = new Set(); renderView();
  ctrlDaConferencia().then(n => { if(n) toast(n + ' divergência(s) registrada(s) em Controle de Entregas.'); }).catch(e => toast('Não consegui registrar no Controle de Entregas: ' + ((e && e.message) || e), true));
}
function cvReabrir(){ if(!CV.sess) return; CV.sess.fin = false; gravarSessao(); renderView(); setTimeout(focoBip, 0); }
function cvZerar(){
  if(!CV.sess || !confirm('Zerar toda a bipagem da entrega ' + CV.num + '?')) return;
  try { localStorage.removeItem(sessKey(CV.num)); } catch(e){}
  CV.sess = lerSessao(CV.num); CV.ult = null; renderView(); setTimeout(focoBip, 0);
}
function cvNova(){ CV.num = ''; CV.sess = null; CV.linhas = []; CV.ult = null; renderView(); setTimeout(() => { const i = $('cvEnt'); if(i) i.focus(); }, 0); }
/* Leitor de código de barras: ele digita o EAN e (na maioria) manda Enter. Se não mandar,
   a leitura é registrada sozinha quando a digitação para (leitor digita tudo em milissegundos). */
let _cvAuto;
function cvAutoBip(inp){
  clearTimeout(_cvAuto);
  if(!CV.sess) return;
  const v = inp.value.trim();
  if(v.length < 8) return;
  _cvAuto = setTimeout(() => { const x = inp.value.trim(); if(x.length >= 8){ inp.value = ''; bipar(x); } }, 150);
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
function cvToggle(i){ if(CV.aberto.has(i)) CV.aberto.delete(i); else CV.aberto.add(i); atualizar(); }

/* ---------- onde achar a peça faltante ---------- */
const ehPicking = loc => (CV.cfg.picking && CV.cfg.picking.length ? CV.cfg.picking : ['PP']).some(p => normLoc(loc).indexOf(p) === 0);
/* Sugestões: picking primeiro (os que cobrem a falta antes), depois o resto por saldo. */
function alternativas(x, falta, max){
  const orig = x.orig.map(normLoc);
  const ig = new Set((CV.cfg.ignorar || []).map(s => s.toUpperCase())), rs = new Set((CV.cfg.restricoes || []).map(s => s.toUpperCase()));
  const lista = (CV.saldoItem.get(x.i) || []).filter(s => !orig.includes(normLoc(s[1])) && !ig.has(String(s[3]).toUpperCase()) && (!rs.size || rs.has(String(s[4]).toUpperCase())));
  lista.sort((a, b) => (ehPicking(b[1]) - ehPicking(a[1])) || ((b[2] >= falta) - (a[2] >= falta)) || b[2] - a[2]);
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
    (alts.length ? alts.map((s, n) => '<div class="cv-loc"><span class="rot">' + (n ? 'Alternativa' : 'Sugestão') + '</span><code>' + esc(s[1]) + '</code><span class="cv-tp ' + (ehPicking(s[1]) ? 'pk' : '') + '">' + (ehPicking(s[1]) ? 'Picking' : 'Armazenagem') + '</span><span class="sd">saldo <b>' + fInt(s[2]) + '</b>' + (s[2] >= falta ? ' · cobre a falta' : ' · cobre parte') + '</span></div>').join('')
      : '<div class="cv-loc"><span class="rot">Alternativa</span><span class="cv-vazio">' + (CV.saldo.length ? 'nenhum outro local com saldo disponível.' : 'importe a QRY0390 para ver outros locais com saldo.') + '</span></div>');
}

/* ---------- telas ---------- */
function vazio(){ return '<div class="panel"><h3>Sem dados</h3><div class="panel-sub">' + esc(CV.erro) + '</div></div>'; }
function chipEnt(){
  const m = CV.meta.ent;
  return m && m.importadoEm ? 'QRY0180 de ' + fData(m.importadoEm.slice(0, 10)) + ' · ' + fInt(CV.porEnt.size) + ' entregas' : 'QRY0180 não importada';
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
      '<div><span class="cv-lab">Entrega</span><input class="cv-in" id="cvEnt" inputmode="numeric" autocomplete="off" placeholder="Entrega" value="' + esc(CV.num) + '" onkeydown="if(event.key===\'Enter\'){event.preventDefault();abrirEntrega(this.value)}"></div>' +
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
    if(!e.value.trim() && b.value.trim()){ b.value = ''; return bipar(''); }
    return abrirEntrega(e.value);
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
  $('cvAcoes').innerHTML = '<div class="cv-acoes2"><button class="btn btn-orange cv-atender" disabled title="Carregue uma entrega">⚑ Atender entrega</button><button class="cv-fin" disabled style="opacity:.45;cursor:not-allowed">Finalizar conferência</button></div>';
  $('cvTabela').innerHTML = '<div class="cv-card cv-tb"><h3>▣ Itens da entrega<s>' + esc(chipEnt()) + '</s></h3><div class="cv-sc"><table class="cv-tab"><thead><tr><th>Foto</th><th>Código</th><th>Descrição</th><th class="n">Prevista</th><th class="n">Bipada</th><th class="n">Pendente</th><th>Status</th><th></th></tr></thead><tbody><tr><td colspan="8" class="field-hint" style="padding:18px">Os itens da entrega aparecem aqui.</td></tr></tbody></table></div></div>';
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
  $('cvAcoes').innerHTML = '<div class="cv-acoes"><button class="btn btn-secondary" onclick="cvDesfazer()">↶ Desfazer</button><button class="btn btn-secondary" onclick="cvExportar()">Exportar</button><button class="btn btn-danger-text" onclick="cvZerar()">Zerar</button></div><div class="cv-acoes2">' +
    '<button class="btn btn-orange cv-atender" onclick="cvAtender()"' + (s.fin && diverge ? '' : ' disabled title="' + (s.fin ? 'Entrega sem divergência' : 'Finalize a conferência para habilitar') + '"') + '>⚑ Atender entrega</button>' +
    '<button class="cv-fin" onclick="cvFinalizar()">Finalizar conferência</button></div>';
  // tabela de itens
  const ordem = {falta: 0, sobra: 1, pend: 2, ok: 3};
  const ls = CV.linhas.slice().sort((a, b) => ordem[cvSituacao(a)] - ordem[cvSituacao(b)] || a.d.localeCompare(b.d));
  $('cvTabela').innerHTML = '<div class="cv-card cv-tb"><h3>▣ Itens da entrega<s>' + (CV.fotoMap && CV.fotoMap.size ? (n => n ? n + ' de ' + CV.linhas.length + ' itens sem foto' : 'toque numa linha com pendência para ver onde achar')(CV.linhas.filter(x => !urlFoto(x.i)).length) : 'sem fotos: importe o cadastro em Importação') + '</s></h3><div class="cv-sc"><table class="cv-tab"><thead><tr><th>Foto</th><th>Código</th><th>Descrição</th><th class="n">Prevista</th><th class="n">Bipada</th><th class="n">Pendente</th><th>Status</th><th></th></tr></thead><tbody>' +
    ls.map(x => {
      const b = s.bips[x.i] || 0, st = cvSituacao(x), pen = Math.max(x.prev - b, 0), ab = CV.aberto.has(x.i);
      return '<tr class="' + (pen ? 'clicavel ' : '') + (st === 'falta' ? 'r-falta' : st === 'sobra' ? 'r-sobra' : '') + '"' + (pen ? ' onclick="cvToggle(\'' + esc(x.i) + '\')"' : '') + '><td>' + fotoHtml(x.i, 'cv-th') + '</td><td class="cv-mono">' + esc(x.i) + '</td><td class="cv-desc">' + esc(x.d) + '<div class="field-hint">EAN ' + (x.eans.length ? esc(x.eans.slice(0, 3).join(' / ')) + (x.eans.length > 3 ? ' +' + (x.eans.length - 3) : '') : 'não cadastrado') + '</div></td>' +
        '<td class="n">' + fInt(x.prev) + '</td><td class="n"><b>' + fInt(b) + '</b></td><td class="n">' + fInt(pen) + (b > x.prev ? ' <span style="color:var(--danger)">(+' + fInt(b - x.prev) + ')</span>' : '') + '</td>' +
        '<td><span class="cv-pill cv-' + st + '">' + ROT[st] + '</span></td><td class="n">' + (b ? '<button class="btn-link" onclick="event.stopPropagation();cvMenos(\'' + esc(x.i) + '\')" title="Tirar uma bipagem">−1</button>' : '') + '</td></tr>' +
        (pen && ab ? '<tr class="cv-det"><td colspan="8"><b>Faltam ' + fInt(pen) + '</b> — onde achar:' + blocoLocais(x) + '</td></tr>' : '');
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
  let h = '<div class="cv-sec-t" style="margin-top:6px">Resultado da conferência</div><div class="cv-res ' + (ok ? 'ok' : 'div') + '">' +
    (ok ? '✓ Entrega conferida sem divergência.' : '⚠ Entrega com divergência — clique em “Atender entrega” para gerar o Excel com os locais.') +
    '<small>' + t.ok + ' de ' + t.itens + ' itens sem divergência · ' + faltas.length + ' com falta · ' + sobras.length + ' com sobra · ' + fInt(t.ean) + ' leitura(s) de EAN não identificado.</small></div>';
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
function cardBase(ic, titulo, sub, m, det){
  const ok = !!m;
  return '<label class="cv-bs ' + (ok ? 'ok' : '') + '"><span class="cv-bs-ic">' + ic + '</span><span class="cv-bs-t"><b>' + titulo + '</b><small>' + sub + '</small></span>' +
    '<span class="cv-bs-st">' + (ok ? '✓ ' + fData((m.importadoEm || '').slice(0, 10)) + ' · ' + det : 'Não importada') + '</span>' +
    (ok && m.por ? '<span class="cv-bs-por">' + esc(m.por) + '</span>' : '<span class="cv-bs-por"></span>') +
    '<span class="btn btn-orange cv-bs-btn">' + (ok ? 'Atualizar' : 'Importar') + '</span>' +
    '<input type="file" accept=".xlsx,.xls" multiple hidden onchange="importar(Array.from(this.files)); this.value=\'\'"></label>';
}
/* Quantos itens das entregas importadas têm foto no cadastro. */
function coberturaFotos(){
  if(CV._cob && CV._cobKey === CV.ent.length + '|' + (CV.fotoMap ? CV.fotoMap.size : 0)) return CV._cob;
  const it = new Set(CV.ent.map(r => r.i)); let c = 0;
  it.forEach(i => { if(CV.fotoMap && CV.fotoMap.has(i)) c++; });
  CV._cobKey = CV.ent.length + '|' + (CV.fotoMap ? CV.fotoMap.size : 0);
  return (CV._cob = {t: it.size, c});
}
function viewImportacao(){
  const e = CV.meta.ent, s = CV.meta.est, f = CV.meta.foto, n = CV.meta.ean;
  return '<div class="cv-bases" id="cvDrop">' +
    cardBase('📦', 'QRY0180', 'Entregas', e, e ? fInt(e.entregas) + ' entregas · ' + fInt(e.linhas) + ' linhas' : '') +
    cardBase('🏬', 'QRY0390', 'Estoque', s, s ? fInt(s.itens) + ' itens · ' + fInt(s.locais) + ' saldos' : '') +
    cardBase('▥', 'SIGEQ230', 'EANs por item', n, n ? fInt(n.eans) + ' EANs · ' + fInt(n.itens) + ' itens' : '') +
    cardBase('🖼', 'Cadastro', 'Fotos dos itens', f, f ? fInt(f.itens) + ' itens com foto' + (CV.ent.length ? ' · ' + (cb => cb.t ? Math.round(cb.c / cb.t * 100) + '% dos itens das entregas' : '')(coberturaFotos()) : '') : '') +
    '</div><div class="cv-msg" id="cvMsg">' + (CV.ocupado ? '⏳ ' + esc(CV.msg) : '') + '</div>' +
    (CV.erroImp ? '<div class="cv-res div">⚠ ' + esc(CV.erroImp) + '</div>' : '');
}
function viewConfig(){
  return '<div class="panel"><h3>Classes de local ignoradas nas sugestões</h3><div class="panel-sub">Coluna <code>CLAL</code> da QRY0390, separadas por vírgula. Locais dessas classes (ex.: reversa e avaria) não são sugeridos.</div><div class="filter-bar"><input type="text" id="cfgIg" value="' + esc(CV.cfg.ignorar.join(', ')) + '"></div></div>' +
    '<div class="panel cv-gap"><h3>Restrições aceitas</h3><div class="panel-sub">Coluna <code>RETRICAO</code> da QRY0390. Só saldo com essas restrições é sugerido (padrão <code>WN</code> = normal). Em branco = aceita todas.</div><div class="filter-bar"><input type="text" id="cfgRs" value="' + esc(CV.cfg.restricoes.join(', ')) + '"></div></div>' +
    '<div class="panel cv-gap"><h3>Locais de picking (prioridade nas sugestões)</h3><div class="panel-sub">Início da descrição do local, separado por vírgula (padrão <code>PP</code>, que pega PPP 006 042 00 e PP 009 027 03). Locais de picking aparecem primeiro nas sugestões e no Excel.</div><div class="filter-bar"><input type="text" id="cfgPk" value="' + esc((CV.cfg.picking || ['PP']).join(', ')) + '"></div></div>' +
    '<div class="panel cv-gap"><h3>Quantidade de sugestões por item</h3><div class="filter-bar"><input type="number" min="1" max="20" id="cfgMax" value="' + (CV.cfg.max || 5) + '"></div></div>' +
    '<div class="cv-gap"><button class="btn btn-orange" onclick="cvSalvarCfg()">Salvar configurações</button></div>';
}
async function cvSalvarCfg(){
  CV.cfg.ignorar = String($('cfgIg').value).toUpperCase().split(/[,;\s]+/).filter(Boolean);
  CV.cfg.restricoes = String($('cfgRs').value).toUpperCase().split(/[,;\s]+/).filter(Boolean);
  CV.cfg.picking = String($('cfgPk').value).toUpperCase().split(/[,;]+/).map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if(!CV.cfg.picking.length) CV.cfg.picking = ['PP'];
  CV.cfg.max = Math.min(Math.max(parseInt($('cfgMax').value, 10) || 5, 1), 20);
  try { await nuvemGravar('cfg', null, {cfg: CV.cfg}, []); toast('Configurações salvas.'); } catch(e){ toast(e.message || String(e), true); }
  renderView();
}

/* ---------- Controle de Entregas (divergências apontadas) ---------- */
/* Cada ocorrência é uma linha própria em app_dados (chave 'ctrl', versão = id): várias pessoas
   registram ao mesmo tempo sem sobrescrever o trabalho umas das outras. */
const TIPOS = ['Falta', 'Sobra', 'EAN não identificado', 'Avaria', 'Item não localizado', 'Outro'];
const TIPO_COR = {'Falta': '#F59E0B', 'Sobra': '#7E22CE', 'EAN não identificado': '#C83812', 'Avaria': '#0E7490', 'Item não localizado': '#6B7280', 'Outro': '#001A72'};
async function ctrlLer(){
  const out = []; let a = 0;
  while(true){
    const { data, error } = await cvSupa.from(CV_TAB).select('versao,dados').eq('app', CV_APP).eq('chave', 'ctrl').eq('parte', 0).order('versao').range(a, a + 999);
    if(error) throw error;
    (data || []).forEach(r => { if(r.dados) out.push(r.dados); });
    if(!data || data.length < 1000) break;
    a += 1000;
  }
  return out;
}
async function ctrlSalvar(reg){
  if(somenteLeitura()) throw new Error('Seu acesso é só de visualização.');
  await cvSupa.from(CV_TAB).delete().eq('app', CV_APP).eq('chave', 'ctrl').eq('versao', reg.id).eq('parte', 0);
  const { error } = await cvSupa.from(CV_TAB).insert({app: CV_APP, chave: 'ctrl', versao: reg.id, parte: 0, dados: reg});
  if(error) throw error;
  const i = CV.ctrl.findIndex(c => c.id === reg.id);
  if(i >= 0) CV.ctrl[i] = reg; else CV.ctrl.push(reg);
}
async function ctrlExcluir(id){
  if(somenteLeitura()) throw new Error('Seu acesso é só de visualização.');
  const { error } = await cvSupa.from(CV_TAB).delete().eq('app', CV_APP).eq('chave', 'ctrl').eq('versao', id).eq('parte', 0);
  if(error) throw error;
  CV.ctrl = CV.ctrl.filter(c => c.id !== id);
}
/* Ao finalizar uma conferência, as divergências viram ocorrências (sem duplicar se finalizar de novo). */
async function ctrlDaConferencia(){
  if(somenteLeitura() || !CV.sess || !CV.porEnt.get(CV.num)) return 0;
  const s = CV.sess, r0 = CV.porEnt.get(CV.num)[0], agora = new Date().toISOString(), novos = [];
  CV.linhas.forEach(x => {
    const b = s.bips[x.i] || 0;
    if(b < x.prev) novos.push({tipo: 'Falta', item: x.i, d: x.d, q: x.prev - b, orig: x.orig.join(' / ')});
    else if(b > x.prev) novos.push({tipo: 'Sobra', item: x.i, d: x.d, q: b - x.prev, orig: x.orig.join(' / ')});
  });
  Object.keys(s.desc).forEach(k => novos.push({tipo: 'EAN não identificado', item: k, d: s.desc[k].nome || '', q: s.desc[k].n, orig: ''}));
  const ids = new Set();
  for(const n of novos){
    const id = [CV.num, n.tipo === 'EAN não identificado' ? 'EAN' : n.tipo, n.item].join('|'); ids.add(id);
    const ant = CV.ctrl.find(c => c.id === id);
    if(ant && ant.q === n.q) continue;
    await ctrlSalvar(Object.assign({}, ant || {}, {id, ts: ant ? ant.ts : agora, por: ant ? ant.por : CV.email, ent: CV.num, item: n.item, d: n.d, tipo: n.tipo, q: n.q, orig: n.orig, t: r0.t || '', src: 'conferencia', st: ant ? ant.st : 'aberta', obs: ant ? (ant.obs || '') : ''}));
  }
  for(const c of CV.ctrl.filter(c => c.ent === CV.num && c.src === 'conferencia' && c.st === 'aberta' && !ids.has(c.id))) await ctrlExcluir(c.id);
  return novos.length;
}
const dtBR = iso => iso ? fData(iso.slice(0, 10)) + ' ' + iso.slice(11, 16) : '';
const hojeISO = () => new Date().toISOString().slice(0, 10);
function ctrlFiltradas(){
  const f = CV.cf, q = f.busca.trim().toLowerCase();
  return CV.ctrl.filter(c => (!f.st || c.st === f.st) && (!f.tipo || c.tipo === f.tipo) && (!f.de || c.ts.slice(0, 10) >= f.de) && (!f.ate || c.ts.slice(0, 10) <= f.ate) &&
    (!q || [c.ent, c.item, c.d, c.t, c.orig, c.obs, c.por].join(' ').toLowerCase().indexOf(q) >= 0)).sort((a, b) => b.ts.localeCompare(a.ts));
}
function viewControle(){
  if(CV.carregando) return '<p class="field-hint">Carregando...</p>';
  const POR = 100, lista = ctrlFiltradas(), ro = somenteLeitura();
  const pags = Math.max(1, Math.ceil(lista.length / POR)); if(CV.cpag >= pags) CV.cpag = pags - 1;
  const chip = (v, t) => '<button class="chip' + (CV.cf.st === v ? ' active' : '') + '" onclick="cvCF(\'st\',\'' + v + '\')">' + t + '</button>';
  const abertas = CV.ctrl.filter(c => c.st === 'aberta').length;
  let h = '<div class="filter-bar cv-fb">' + chip('', 'Todas · ' + CV.ctrl.length) + chip('aberta', 'Abertas · ' + abertas) + chip('atendida', 'Atendidas · ' + (CV.ctrl.length - abertas)) +
    '<select class="cv-in-s" onchange="cvCF(\'tipo\',this.value)"><option value="">Todos os tipos</option>' + TIPOS.map(t => '<option' + (CV.cf.tipo === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>' +
    '<input type="date" class="cv-in-s" value="' + CV.cf.de + '" onchange="cvCF(\'de\',this.value)" title="De"><input type="date" class="cv-in-s" value="' + CV.cf.ate + '" onchange="cvCF(\'ate\',this.value)" title="Até">' +
    '<input type="text" id="cvCBusca" class="cv-in-s" style="flex:1;min-width:180px" placeholder="Buscar entrega, item, transportadora..." value="' + esc(CV.cf.busca) + '" oninput="cvCBusca(this.value)">' +
    (ro ? '' : '<button class="btn btn-orange btn-sm" onclick="cvCNovo()">+ Nova ocorrência</button>') + '<button class="btn btn-secondary btn-sm" onclick="cvCExportar()">Exportar</button></div>';
  if(CV.cnovo && !ro){
    h += '<div class="cv-card cv-novo"><div><span class="cv-lab">Entrega</span><input id="cnEnt" class="cv-in-s" inputmode="numeric"></div><div><span class="cv-lab">Item (código)</span><input id="cnItem" class="cv-in-s" placeholder="opcional"></div>' +
      '<div><span class="cv-lab">Tipo</span><select id="cnTipo" class="cv-in-s">' + TIPOS.map(t => '<option' + (t === 'Avaria' ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div><div><span class="cv-lab">Qtd</span><input id="cnQtd" type="number" min="1" value="1" class="cv-in-s" style="width:70px"></div>' +
      '<div><span class="cv-lab">Local</span><input id="cnOrig" class="cv-in-s" placeholder="opcional"></div><div style="flex:1;min-width:200px"><span class="cv-lab">Observação</span><input id="cnObs" class="cv-in-s" style="width:100%"></div>' +
      '<button class="btn btn-orange btn-sm" onclick="cvCSalvarNovo()">Registrar</button><button class="btn btn-secondary btn-sm" onclick="cvCNovo()">Cancelar</button></div>';
  }
  h += '<div class="table-wrap"><table class="cv-tab cv-compact"><thead><tr><th>Data</th><th>Entrega</th><th>Item</th><th>Descrição</th><th>Tipo</th><th class="n">Qtd</th><th>Local</th><th>Transportadora</th><th>Observação</th><th>Por</th><th>Status</th><th></th></tr></thead><tbody>' +
    (lista.length ? lista.slice(CV.cpag * POR, CV.cpag * POR + POR).map(c => '<tr><td>' + dtBR(c.ts) + '</td><td class="cv-mono"><b>' + esc(c.ent) + '</b></td><td class="cv-mono">' + esc(c.item || '') + '</td><td class="cv-cut" title="' + esc(c.d) + '">' + esc(c.d) + '</td>' +
      '<td><span class="cv-pill" style="background:' + (TIPO_COR[c.tipo] || '#001A72') + '">' + esc(c.tipo) + '</span></td><td class="n"><b>' + fInt(c.q) + '</b></td><td class="cv-cut" title="' + esc(c.orig) + '">' + esc(c.orig || '') + '</td><td class="cv-cut">' + esc(c.t || '') + '</td>' +
      '<td class="cv-cut" title="' + esc(c.obs) + '">' + esc(c.obs || '') + '</td><td class="cv-cut" title="' + esc(c.por) + '">' + esc((c.por || '').split('@')[0]) + '</td>' +
      '<td><span class="cv-pill ' + (c.st === 'atendida' ? 'cv-ok' : 'cv-falta') + '">' + (c.st === 'atendida' ? 'Atendida' : 'Aberta') + '</span></td><td class="n cv-act">' + (ro ? '' :
      '<button class="btn-link" onclick="cvCAtender(\'' + esc(c.id).replace(/'/g, '') + '\')">' + (c.st === 'atendida' ? 'Reabrir' : 'Atender') + '</button> <button class="btn-link" onclick="cvCObs(\'' + esc(c.id).replace(/'/g, '') + '\')">Obs</button> <button class="btn-danger-text" onclick="cvCExcluir(\'' + esc(c.id).replace(/'/g, '') + '\')">Excluir</button>') + '</td></tr>').join('')
      : '<tr><td colspan="12" class="field-hint" style="padding:16px">Nenhuma ocorrência. As divergências aparecem aqui ao finalizar uma conferência.</td></tr>') + '</tbody></table></div>' +
    (pags > 1 ? '<div class="cv-pag"><button class="btn btn-secondary" onclick="cvCPag(-1)"' + (CV.cpag === 0 ? ' disabled' : '') + '>←</button><span>Página ' + (CV.cpag + 1) + ' de ' + pags + ' · ' + fInt(lista.length) + ' ocorrências</span><button class="btn btn-secondary" onclick="cvCPag(1)"' + (CV.cpag >= pags - 1 ? ' disabled' : '') + '>→</button></div>' : '');
  return h;
}
function cvCF(k, v){ CV.cf[k] = v; CV.cpag = 0; renderView(); }
function cvCPag(n){ CV.cpag += n; renderView(); }
let _cvCB; function cvCBusca(v){ CV.cf.busca = v; CV.cpag = 0; clearTimeout(_cvCB); _cvCB = setTimeout(() => { renderView(); const i = $('cvCBusca'); if(i){ i.focus(); i.setSelectionRange(v.length, v.length); } }, 250); }
function cvCNovo(){ CV.cnovo = !CV.cnovo; renderView(); }
function achaCtrl(id){ return CV.ctrl.find(c => c.id === id); }
async function cvCSalvarNovo(){
  const ent = String($('cnEnt').value).replace(/\D/g, ''), item = $('cnItem').value.trim(), tipo = $('cnTipo').value, q = Math.max(1, parseInt($('cnQtd').value, 10) || 1);
  if(!ent) return toast('Informe a entrega.', true);
  const rows = CV.porEnt.get(ent) || [], r = item ? rows.find(x => x.i === item) : null;
  const reg = {id: 'M|' + Date.now() + '|' + Math.random().toString(36).slice(2, 6), ts: new Date().toISOString(), por: CV.email, ent, item, d: r ? r.d : ((CV.itens[item] && CV.itens[item].d) || ''), tipo, q, orig: $('cnOrig').value.trim() || (r ? r.o : ''), t: rows[0] ? rows[0].t : '', src: 'manual', st: 'aberta', obs: $('cnObs').value.trim()};
  try { await ctrlSalvar(reg); CV.cnovo = false; toast('Ocorrência registrada.'); } catch(e){ toast((e && e.message) || String(e), true); }
  renderView();
}
async function cvCAtender(id){
  const c = achaCtrl(id); if(!c) return;
  const at = c.st !== 'atendida';
  try { await ctrlSalvar(Object.assign({}, c, {st: at ? 'atendida' : 'aberta', at: at ? new Date().toISOString() : '', atpor: at ? CV.email : ''})); } catch(e){ toast((e && e.message) || String(e), true); }
  renderView();
}
async function cvCObs(id){
  const c = achaCtrl(id); if(!c) return;
  const v = prompt('Observação:', c.obs || ''); if(v === null) return;
  try { await ctrlSalvar(Object.assign({}, c, {obs: v.trim()})); } catch(e){ toast((e && e.message) || String(e), true); }
  renderView();
}
async function cvCExcluir(id){
  if(!achaCtrl(id) || !confirm('Excluir esta ocorrência?')) return;
  try { await ctrlExcluir(id); } catch(e){ toast((e && e.message) || String(e), true); }
  renderView();
}
function cvCExportar(){
  if(!window.XLSX) return toast('Biblioteca de Excel ainda carregando, tente de novo.', true);
  const l = [['Data', 'Entrega', 'Item', 'Descrição', 'Tipo', 'Quantidade', 'Local', 'Transportadora', 'Observação', 'Registrado por', 'Origem', 'Status', 'Atendida em', 'Atendida por']];
  ctrlFiltradas().forEach(c => l.push([dtBR(c.ts), c.ent, c.item || '', c.d || '', c.tipo, c.q, c.orig || '', c.t || '', c.obs || '', c.por || '', c.src === 'manual' ? 'Manual' : 'Conferência', c.st === 'atendida' ? 'Atendida' : 'Aberta', dtBR(c.at || ''), c.atpor || '']));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, planilha(l, [17, 12, 11, 44, 20, 10, 18, 22, 30, 20, 12, 10, 17, 20]), 'Controle de Entregas');
  XLSX.writeFile(wb, 'controle-de-entregas.xlsx');
}

/* ---------- Dashboard das divergências ---------- */
function barrasH(lista, cor, max){
  const m = Math.max(1, ...lista.map(x => x[1]));
  return lista.length ? '<div class="cv-bh">' + lista.slice(0, max || 8).map(x => '<div class="cv-bh-l" title="' + esc(x[0]) + ': ' + fInt(x[1]) + '"><span class="n">' + esc(x[0] || '—') + '</span><span class="b"><i style="width:' + (x[1] / m * 100) + '%;background:' + (x[2] || cor) + '"></i></span><b>' + fInt(x[1]) + '</b></div>').join('') + '</div>' : '<div class="field-hint">Sem dados no período.</div>';
}
function conta(lista, fn){ const m = new Map(); lista.forEach(c => { const k = fn(c) || '—'; m.set(k, (m.get(k) || 0) + 1); }); return Array.from(m.entries()).sort((a, b) => b[1] - a[1]); }
function viewDashboard(){
  if(CV.carregando) return '<p class="field-hint">Carregando...</p>';
  const f = CV.df, L = CV.ctrl.filter(c => (!f.de || c.ts.slice(0, 10) >= f.de) && (!f.ate || c.ts.slice(0, 10) <= f.ate));
  const preset = d => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };
  const h0 = hojeISO(), at = L.filter(c => c.st === 'atendida').length, ab = L.length - at;
  const pecas = L.reduce((a, c) => a + (c.q || 0), 0), ents = new Set(L.map(c => c.ent)).size;
  const kp = (rot, v, cor) => '<div class="cv-kpi" style="--c:' + cor + '"><span>' + rot + '</span><b>' + v + '</b></div>';
  // por dia (últimos 30 dias com a janela do filtro)
  const dias = []; const ini = f.de || preset(29), fim = f.ate || h0;
  for(let d = new Date(ini + 'T12:00:00'), n = 0; d <= new Date(fim + 'T12:00:00') && n < 62; d.setDate(d.getDate() + 1), n++) dias.push(d.toISOString().slice(0, 10));
  const porDia = new Map(); L.forEach(c => { const k = c.ts.slice(0, 10); porDia.set(k, (porDia.get(k) || 0) + 1); });
  const mx = Math.max(1, ...dias.map(d => porDia.get(d) || 0));
  const colunas = '<div class="cv-col">' + dias.map(d => { const v = porDia.get(d) || 0; return '<div class="cv-col-i" title="' + fData(d) + ': ' + v + ' ocorrência(s)"><b>' + (v || '') + '</b><i style="height:' + (v / mx * 100) + '%"></i><span>' + d.slice(8) + '</span></div>'; }).join('') + '</div>';
  const pct = L.length ? Math.round(at / L.length * 100) : 0;
  return '<div class="filter-bar cv-fb"><button class="chip' + (!f.de && !f.ate ? ' active' : '') + '" onclick="cvDF(\'\',\'\')">Tudo</button><button class="chip" onclick="cvDF(\'' + preset(6) + '\',\'\')">7 dias</button><button class="chip" onclick="cvDF(\'' + preset(29) + '\',\'\')">30 dias</button>' +
    '<input type="date" class="cv-in-s" value="' + f.de + '" onchange="cvDF(this.value,CV.df.ate)"><input type="date" class="cv-in-s" value="' + f.ate + '" onchange="cvDF(CV.df.de,this.value)"></div>' +
    '<div class="cv-kpis">' + kp('Ocorrências', fInt(L.length), '#001A72') + kp('Abertas', fInt(ab), '#F59E0B') + kp('Atendidas', fInt(at), '#1F8A52') + kp('% atendidas', pct + '%', '#0E7490') + kp('Peças em divergência', fInt(pecas), '#C83812') + kp('Entregas afetadas', fInt(ents), '#7E22CE') + '</div>' +
    '<div class="cv-dgrid"><div class="cv-card cv-dc"><h4>Ocorrências por dia</h4>' + colunas + '</div>' +
    '<div class="cv-card cv-dc"><h4>Por tipo</h4>' + barrasH(conta(L, c => c.tipo).map(x => [x[0], x[1], TIPO_COR[x[0]]]), '#001A72') + '</div>' +
    '<div class="cv-card cv-dc"><h4>Situação</h4><div class="cv-donut"><div class="cv-donut-r" style="background:conic-gradient(#1F8A52 0 ' + pct + '%,#F59E0B ' + pct + '% 100%)"><span>' + pct + '%</span></div><div class="cv-leg"><div><i style="background:#1F8A52"></i>Atendidas ' + fInt(at) + '</div><div><i style="background:#F59E0B"></i>Abertas ' + fInt(ab) + '</div></div></div></div>' +
    '<div class="cv-card cv-dc"><h4>Itens com mais divergências</h4>' + barrasH(conta(L.filter(c => c.item), c => c.item + ' · ' + (c.d || '').slice(0, 26)), '#FE5000', 8) + '</div>' +
    '<div class="cv-card cv-dc"><h4>Por transportadora</h4>' + barrasH(conta(L, c => c.t), '#001A72', 8) + '</div>' +
    '<div class="cv-card cv-dc"><h4>Por local de origem</h4>' + barrasH(conta(L.filter(c => c.orig), c => c.orig.split(' / ')[0]), '#0E7490', 8) + '</div>' +
    '<div class="cv-card cv-dc"><h4>Por usuário</h4>' + barrasH(conta(L, c => (c.por || '').split('@')[0]), '#7E22CE', 8) + '</div>' +
    '<div class="cv-card cv-dc"><h4>Origem do registro</h4>' + barrasH(conta(L, c => c.src === 'manual' ? 'Manual' : 'Conferência'), '#33488E', 4) + '</div></div>';
}
function cvDF(de, ate){ CV.df = {de, ate}; renderView(); }

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
async function importar(files){
  if(somenteLeitura()) return toast('Seu acesso é só de visualização.', true);
  if(CV.ocupado || !files.length) return;
  CV.ocupado = true; CV.msg = 'Iniciando...'; CV.erroImp = ''; renderView();
  try {
    const sessao = (await cvSupa.auth.getSession()).data.session, por = sessao ? sessao.user.email : '';
    for(const f of files){
      const r = await lerArquivo(f);
      if(r.base === '180'){
        CV.msg = 'Gravando entregas na nuvem...'; renderMsg();
        const meta = {importadoEm: new Date().toISOString(), por, arquivo: r.nome, linhas: r.linhas, entregas: r.dados.cabs.length, itens: r.dados.descs.length};
        await nuvemGravar('ent_desc', null, {}, dividir(r.dados.descs, 400000));
        await nuvemGravar('ent_cab', null, {}, dividir(r.dados.cabs, 400000));
        await nuvemGravar('ent', meta, {fmt: 2}, dividir(r.dados.linhas, 400000));
        CV.ent = montarEnt(r.dados.linhas, r.dados.cabs, r.dados.descs); CV.meta.ent = meta;
      } else if(r.base === 'ean'){
        CV.msg = 'Gravando EANs na nuvem...'; renderMsg();
        const meta = {importadoEm: new Date().toISOString(), por, arquivo: r.nome, linhas: r.linhas, itens: new Set(r.dados.map(x => x[0])).size, eans: r.dados.length};
        await nuvemGravar('eans', meta, {}, dividir(r.dados, 400000));
        CV.eanRows = r.dados; CV.meta.ean = meta;
      } else if(r.base === 'foto'){
        CV.msg = 'Gravando cadastro de fotos na nuvem...'; renderMsg();
        const meta = {importadoEm: new Date().toISOString(), por, arquivo: r.nome, linhas: r.linhas, itens: r.dados.length};
        await nuvemGravar('fotos', meta, {}, dividir(r.dados, 400000));
        CV.fotoRows = r.dados; CV.meta.foto = meta;
      } else {
        CV.msg = 'Gravando estoque na nuvem (pode levar alguns instantes)...'; renderMsg();
        const itens = Object.keys(r.dados.itens).map(i => [i, r.dados.itens[i].d, r.dados.itens[i].e]);
        const meta = {importadoEm: new Date().toISOString(), por, arquivo: r.nome, linhas: r.linhas, itens: itens.length, locais: r.dados.saldo.length};
        await nuvemGravar('est_itens', null, {}, dividir(itens, 400000));
        await nuvemGravar('est_saldo', meta, {}, dividir(r.dados.saldo, 400000));
        CV.itens = r.dados.itens; CV.saldo = r.dados.saldo; CV.meta.est = meta;
      }
    }
    indexar();
    if(CV.num && CV.porEnt.get(CV.num)) CV.linhas = montarLinhas(CV.porEnt.get(CV.num));
    toast('Importação concluída.');
  } catch(e){
    console.error(e); CV.erroImp = (e && e.message) || String(e); toast('Importação não concluída — veja o aviso em vermelho.', true);
  } finally { CV.ocupado = false; CV.msg = ''; renderView(); }
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
function cvAtender(){
  if(!window.XLSX) return toast('Biblioteca de Excel ainda carregando, tente de novo.', true);
  if(!CV.sess) return;
  const s = CV.sess, nSug = 3;
  const faltas = CV.linhas.filter(x => (s.bips[x.i] || 0) < x.prev);
  const sobras = CV.linhas.filter(x => (s.bips[x.i] || 0) > x.prev);
  const tp = l => ehPicking(l) ? 'Picking' : 'Armazenagem';
  const cab1 = ['Entrega', 'Código', 'Descrição', 'EAN', 'Prevista', 'Bipada', 'Faltam', 'Local de coleta (origem)', 'Saldo hoje na origem'];
  for(let k = 1; k <= nSug; k++) cab1.push('Sugestão ' + k + ' · local', 'Tipo', 'Saldo');
  cab1.push('Observação');
  const l1 = [cab1], l2 = [['Entrega', 'Código', 'Descrição', 'Faltam', 'Prioridade', 'Local sugerido', 'Tipo', 'Saldo disponível', 'Cobre a falta?', 'Classe', 'Restrição']];
  faltas.forEach(x => {
    const b = s.bips[x.i] || 0, f = x.prev - b, alts = alternativas(x, f, Math.max(CV.cfg.max || 5, nSug));
    const lin = [CV.num, x.i, x.d, x.eans.join(' / '), x.prev, b, f, x.orig.join(' / '), saldoNaOrigem(x)];
    for(let k = 0; k < nSug; k++) lin.push(alts[k] ? alts[k][1] : '', alts[k] ? tp(alts[k][1]) : '', alts[k] ? alts[k][2] : '');
    const temPk = alts.some(a => ehPicking(a[1]));
    lin.push(alts.length ? (temPk ? '' : 'Sem saldo em picking — usar armazenagem e repor o picking') : 'Nenhum outro local com saldo disponível — verificar estoque/reposição');
    l1.push(lin);
    alts.forEach((a, k) => l2.push([CV.num, x.i, x.d, f, k + 1, a[1], tp(a[1]), a[2], a[2] >= f ? 'Sim' : 'Não, parcial', a[3], a[4]]));
  });
  const l3 = [['Entrega', 'Tipo', 'Código / EAN', 'Descrição', 'Quantidade', 'Observação']];
  sobras.forEach(x => l3.push([CV.num, 'Sobra', x.i, x.d, s.bips[x.i] - x.prev, 'Peças a mais do que o previsto — devolver ao local de origem ' + (x.orig[0] || '')]));
  Object.keys(s.desc).forEach(k => l3.push([CV.num, 'EAN não identificado', k, s.desc[k].nome || '', s.desc[k].n, s.desc[k].nome ? 'EAN de outro produto' : 'EAN sem cadastro na QRY0390']));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, planilha(l1, [12, 11, 44, 16, 9, 8, 8, 24, 12, 18, 12, 9, 18, 12, 9, 18, 12, 9, 40]), 'Atender entrega');
  XLSX.utils.book_append_sheet(wb, planilha(l2, [12, 11, 44, 8, 10, 18, 13, 12, 14, 9, 10]), 'Locais sugeridos');
  if(l3.length > 1) XLSX.utils.book_append_sheet(wb, planilha(l3, [12, 20, 18, 44, 11, 54]), 'Sobras e EAN');
  XLSX.writeFile(wb, 'atender-entrega-' + CV.num + '.xlsx');
  toast('Excel gerado: ' + faltas.length + ' item(ns) para atender.');
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
const VIEWS = {conferir: viewConferir, entregas: viewEntregas, controle: viewControle, dashboard: viewDashboard, importacao: viewImportacao, configuracoes: viewConfig};
function renderMsg(){ const el = $('cvMsg'); if(el) el.textContent = CV.ocupado ? '⏳ ' + CV.msg : ''; }
function renderView(){
  if(CV.erro && !CV.ent.length && !CV.saldo.length && CV.tab !== 'importacao' && CV.tab !== 'configuracoes'){ $('viewRoot').innerHTML = vazio(); return; }
  if(somenteLeitura() && (CV.tab === 'importacao' || CV.tab === 'configuracoes')) CV.tab = 'conferir';
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
function cvTab(t){ CV.tab = t; CV.pag = 0; CV.cpag = 0; renderView(); if(t === 'controle' || t === 'dashboard') ctrlLer().then(l => { CV.ctrl = l; if(CV.tab === t) renderView(); }).catch(() => {}); cvCloseSidebarMobile(); if(t === 'conferir') setTimeout(() => { const i = $('cvBip') || $('cvEnt'); if(i) i.focus(); }, 0); }
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
  cvInitTema();
  try { cvSupa.auth.getSession().then(r => { CV.email = (r.data.session && r.data.session.user.email) || ''; }); } catch(e){}
  const v = $('sidebarVersao'); if(v) v.textContent = 'Check Volume · v' + CV_VERSAO;
  renderView();
  await carregar();
  CV.carregando = false;
  renderView();
  setTimeout(() => { const i = $('cvEnt'); if(i) i.focus(); }, 0);
}
