/* ============================================================
   Check Volume — conferência de entregas por bipagem de EAN.
   Bases: QRY0180 (itens por entrega, com o local de coleta) e QRY0390
   (estoque: EAN de cada item e saldo por local).
   Bases compartilhadas em public.app_dados (app = 'checkvolume', migração 008).
   O andamento da conferência de cada entrega fica neste navegador
   (localStorage) — é rascunho de quem está bipando.
   ============================================================ */
const CV_VERSAO = 4; // subir a cada alteração (aparece no rodapé do menu; trocar também o ?v= no index.html e o CACHE_VERSION do sw.js)
const CV_TAB = 'app_dados', CV_APP = 'checkvolume';
const CV_TITULOS = {
  conferir: ['Conferir entrega', 'Informe a entrega e bipe os EANs das peças.'],
  entregas: ['Entregas', 'Entregas da QRY0180 importada.'],
  importacao: ['Importação', 'QRY0180 (entregas), QRY0390 (estoque) e cadastro de fotos.'],
  configuracoes: ['Configurações', 'Regras das sugestões de outros locais.']
};
const CV = {
  ent: [], itens: {}, saldo: [], meta: {}, cfg: {ignorar: ['REV', 'AVA'], restricoes: ['WN'], max: 5, picking: ['PP']},
  fotos: new Map(),
  porEnt: new Map(), eanMap: new Map(), saldoItem: new Map(),
  tab: 'conferir', num: '', sess: null, linhas: [], desc: new Set(), pag: 0, busca: '',
  ocupado: false, msg: '', carregando: true, erro: '', ult: null, aberto: new Set()
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
  CV.fotoMap = new Map();
  (CV.fotoRows || []).forEach(f => { CV.fotoMap.set(f[0], f[1]); const k = normEan(f[2]); if(k && !CV.eanMap.has(k)) CV.eanMap.set(k, f[0]); });
  CV.saldoItem = new Map();
  CV.saldo.forEach(s => { let a = CV.saldoItem.get(s[0]); if(!a) CV.saldoItem.set(s[0], a = []); a.push(s); });
}
async function carregar(){
  try {
    const [cfg, ent, ei, es, ft, ec, ed] = await Promise.all([nuvemLer('cfg'), nuvemLer('ent'), nuvemLer('est_itens'), nuvemLer('est_saldo'), nuvemLer('fotos'), nuvemLer('ent_cab'), nuvemLer('ent_desc')]);
    if(cfg && cfg.dados && cfg.dados.cfg) Object.assign(CV.cfg, cfg.dados.cfg);
    CV.ent = !ent ? [] : (ent.dados && ent.dados.fmt === 2 ? montarEnt(ent.linhas, ec ? ec.linhas : [], ed ? ed.linhas : []) : ent.linhas);
    CV.itens = {}; (ei ? ei.linhas : []).forEach(x => { CV.itens[x[0]] = {d: x[1], e: x[2]}; });
    CV.saldo = es ? es.linhas : [];
    CV.fotoRows = ft ? ft.linhas : [];
    CV.meta = {ent: ent && ent.meta, est: es && es.meta, foto: ft && ft.meta};
    indexar();
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
    if(!x){ x = {i: r.i, d: r.d || (CV.itens[r.i] && CV.itens[r.i].d) || '', prev: 0, orig: [], eans: (CV.itens[r.i] && CV.itens[r.i].e) || []}; m.set(r.i, x); }
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
    beep('erro'); renderView(); return;
  }
  CV.num = n; CV.sess = lerSessao(n); CV.linhas = montarLinhas(rows); CV.ult = null; CV.aberto = new Set(); CV.tab = 'conferir';
  renderView();
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
  if(!CV.sess) return;
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
function cvFinalizar(){ if(!CV.sess) return; CV.sess.fin = true; gravarSessao(); CV.aberto = new Set(); renderView(); }
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
  const v = inp.value.trim();
  if(v.length < 8) return;
  _cvAuto = setTimeout(() => { const x = inp.value.trim(); if(x.length >= 8){ inp.value = ''; bipar(x); } }, 150);
}
/* O campo do EAN volta a ter o foco sozinho, para o leitor sempre cair nele. */
function cvRefoca(inp){
  setTimeout(() => {
    const a = document.activeElement;
    if(CV.tab === 'conferir' && CV.sess && inp.isConnected && (!a || a === document.body || a.tagName === 'BUTTON')) inp.focus();
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
function fotoHtml(i, cls){
  const u = CV.fotoMap && CV.fotoMap.get(i);
  const ph = '<span class="' + cls + ' cv-semfoto" title="Sem foto">▣</span>';
  if(!u) return ph;
  return '<img class="' + cls + '" loading="lazy" referrerpolicy="no-referrer" src="' + esc(/^https?:/.test(u) ? u : FOTO_BASE + u) + '" alt="" onerror="this.outerHTML=\'<span class=\\\'' + cls + ' cv-semfoto\\\'>▣</span>\'">';
}
const ICON_SCAN = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M15 8v8M18 8v8"/></svg>';
function viewConferir(){
  if(CV.carregando) return '<p class="field-hint">Carregando as bases...</p>';
  const campoEnt = '<div><span class="cv-lab">Entrega</span><input id="cvEnt" class="cv-in" inputmode="numeric" autocomplete="off" placeholder="Número da entrega" value="' + esc(CV.num) + '"></div>';
  if(!CV.sess){
    return '<div class="cv-entrada"><form class="cv-busca" onsubmit="event.preventDefault();abrirEntrega($(\'cvEnt\').value)"><input id="cvEnt" inputmode="numeric" autocomplete="off" placeholder="Número da entrega" value="' + esc(CV.num) + '"><button class="btn btn-orange" type="submit">Carregar</button></form>' +
      (CV.ult ? '<div class="cv-bip-ult ean">' + esc(CV.ult.txt) + '</div>' : '') + '</div>';
  }
  const r0 = CV.porEnt.get(CV.num)[0];
  const semEan = CV.linhas.filter(x => !x.eans.length).length;
  return '<div class="cv-hd"><div class="cv-hd-ic">' + ICON_SCAN + '</div><div><h1>Check Volume</h1><p>Conferência de volumes por bipagem EAN · faltas, sobras e onde achar</p></div>' +
      '<div class="cv-chip"><div>Entrega<b>#' + esc(CV.num) + '</b></div>' + (r0.li ? '<div>Data limite<b>' + fData(r0.li) + '</b></div>' : '') + (r0.t ? '<div>Transportadora<b>' + esc(r0.t) + '</b></div>' : '') + '<span id="cvStatus"></span></div></div>' +
    '<div class="cv-row0"><form class="cv-card cv-ent" onsubmit="event.preventDefault();clearTimeout(_cvAuto);var i=$(\'cvBip\');var v=i.value;i.value=\'\';bipar(v);i.focus()">' +
      '<div><span class="cv-lab">Entrega</span><input class="cv-in" id="cvEntTroca" value="' + esc(CV.num) + '" onkeydown="if(event.key===\'Enter\'){event.preventDefault();abrirEntrega(this.value)}"></div>' +
      '<div><span class="cv-lab">Bipar EAN</span><input id="cvBip" class="cv-in cv-bipin" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="7908591703801" oninput="cvAutoBip(this)" onblur="cvRefoca(this)"></div>' +
      '<button class="btn btn-primary" type="submit">Registrar</button></form><div id="cvKpis" class="cv-card cv-kp"></div></div>' +
    (semEan ? '<div class="field-hint" style="color:var(--danger)">' + semEan + ' item(ns) sem EAN cadastrado — para eles, digite o código do item no campo de bipagem.</div>' : '') +
    '<div class="cv-row1"><div id="cvTabela" class="cv-left"></div><div class="cv-right"><div id="cvBipado"></div><div id="cvAnd" class="cv-and"></div><div id="cvAcoes"></div></div></div>' +
    '<div id="cvResultado"></div><div id="cvDesc"></div>';
}
function kpi(rot, v, cor, ic){ return '<div class="cv-k"><i style="background:' + cor + '">' + ic + '</i><div><small>' + rot + '</small><b>' + fInt(v) + '</b></div></div>'; }
/* Atualiza só os pedaços que mudam a cada bipagem (o campo de leitura nunca perde o foco). */
function atualizar(){
  if(CV.tab !== 'conferir' || !CV.sess || !$('cvKpis')) return renderView();
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
  $('cvTabela').innerHTML = '<div class="cv-card cv-tb"><h3>▣ Itens da entrega<s>toque numa linha com pendência para ver onde achar</s></h3><div class="cv-sc"><table class="cv-tab"><thead><tr><th>Foto</th><th>Código</th><th>Descrição</th><th class="n">Prevista</th><th class="n">Bipada</th><th class="n">Pendente</th><th>Status</th><th></th></tr></thead><tbody>' +
    ls.map(x => {
      const b = s.bips[x.i] || 0, st = cvSituacao(x), pen = Math.max(x.prev - b, 0), ab = CV.aberto.has(x.i);
      return '<tr class="' + (pen ? 'clicavel ' : '') + (st === 'falta' ? 'r-falta' : st === 'sobra' ? 'r-sobra' : '') + '"' + (pen ? ' onclick="cvToggle(\'' + esc(x.i) + '\')"' : '') + '><td>' + fotoHtml(x.i, 'cv-th') + '</td><td class="cv-mono">' + esc(x.i) + '</td><td class="cv-desc">' + esc(x.d) + '<div class="field-hint">EAN ' + (x.eans.length ? esc(x.eans.join(' / ')) : 'não cadastrado') + '</div></td>' +
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
    '<div class="table-wrap"><table class="cv-tab"><thead><tr><th>Entrega</th><th>Transportadora</th><th>Evento</th><th>Limite</th><th class="n">Itens</th><th class="n">Peças</th><th>Conferência</th><th></th></tr></thead><tbody>' +
    lista.slice(CV.pag * POR, CV.pag * POR + POR).map(o => { const st = statusEnt(o.e); return '<tr><td class="cv-mono"><b>' + esc(o.e) + '</b></td><td>' + esc(o.t) + '</td><td>' + esc(o.ev) + '</td><td>' + fData(o.li) + '</td><td class="n">' + o.itens + '</td><td class="n">' + fInt(o.pecas) + '</td><td>' + (st ? '<span class="cv-pill ' + (st === 'Finalizada' ? 'cv-ok' : 'cv-pend') + '">' + st + '</span>' : '<span class="field-hint">—</span>') + '</td><td class="n"><button class="btn btn-secondary" onclick="abrirEntrega(\'' + esc(o.e) + '\')">Conferir</button></td></tr>'; }).join('') + '</tbody></table></div>' +
    (pags > 1 ? '<div class="cv-pag"><button class="btn btn-secondary" onclick="cvPag(-1)"' + (CV.pag === 0 ? ' disabled' : '') + '>←</button><span>Página ' + (CV.pag + 1) + ' de ' + pags + '</span><button class="btn btn-secondary" onclick="cvPag(1)"' + (CV.pag >= pags - 1 ? ' disabled' : '') + '>→</button></div>' : '');
}
function viewImportacao(){
  const e = CV.meta.ent, s = CV.meta.est, f = CV.meta.foto;
  const linha = (rot, ok, txt) => '<div class="cv-st ' + (ok ? 'ok' : '') + '"><b>' + rot + '</b><span>' + txt + '</span></div>';
  return '<div class="panel"><h3>Importar bases</h3><div class="panel-sub">Selecione os arquivos de uma vez (ou só o que mudou) — o app reconhece cada um pelo cabeçalho. Cada importação <b>substitui</b> a anterior e fica disponível para todos com acesso.</div>' +
    '<label class="dropzone cv-drop" id="cvDrop"><div class="dz-icon">📥</div><div class="dz-title">Arraste ou clique para escolher</div><div class="dz-desc">QRY0180 (entregas) · QRY0390 (estoque) · cadastro com URL Foto — .xlsx</div>' +
    '<input type="file" id="cvArq" accept=".xlsx,.xls" multiple hidden onchange="importar(Array.from(this.files)); this.value=\'\'"></label>' +
    '<div class="cv-msg" id="cvMsg">' + (CV.ocupado ? '⏳ ' + esc(CV.msg) : '') + '</div>' + (CV.erroImp ? '<div class="cv-res div" style="margin-top:10px">⚠ ' + esc(CV.erroImp) + '</div>' : '') + '</div>' +
    '<div class="panel cv-gap"><h3>Situação das bases</h3>' +
    linha('QRY0180 · entregas', !!e, e ? esc(e.arquivo) + ' · ' + fInt(e.linhas) + ' linhas · <b>' + fInt(e.entregas) + ' entregas</b>' + (e.itens ? ' · ' + fInt(e.itens) + ' itens' : '') + ' · ' + fData((e.importadoEm || '').slice(0, 10)) + (e.por ? ' por ' + esc(e.por) : '') : 'Não importada.') +
    linha('QRY0390 · estoque', !!s, s ? esc(s.arquivo) + ' · ' + fInt(s.linhas) + ' linhas · <b>' + fInt(s.itens) + ' itens com EAN</b> · ' + fInt(s.locais) + ' saldos por local · ' + fData((s.importadoEm || '').slice(0, 10)) + (s.por ? ' por ' + esc(s.por) : '') : 'Não importada. Sem ela não há EAN para bipar nem sugestão de outros locais.') +
    linha('Cadastro · fotos', !!f, f ? esc(f.arquivo) + ' · ' + fInt(f.linhas) + ' linhas · <b>' + fInt(f.itens) + ' itens com foto</b> · ' + fData((f.importadoEm || '').slice(0, 10)) + (f.por ? ' por ' + esc(f.por) : '') : 'Não importada (opcional). Planilha De-Para com as colunas Id Item e URL Foto; sem ela a foto não aparece.') + '</div>' +
    '<div class="panel cv-gap"><h3>Como funciona</h3><div class="cv-regras"><p><b>Entrega:</b> itens, quantidades e local de coleta vêm da QRY0180.</p><p><b>EAN:</b> o EAN de cada item vem da QRY0390 (coluna EAN).</p><p><b>Locais alternativos:</b> saldo disponível (<code>QTDE_DISP</code>) da QRY0390 em outros locais, conforme as regras de Configurações. O saldo é o da data da importação.</p></div></div>';
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
const VIEWS = {conferir: viewConferir, entregas: viewEntregas, importacao: viewImportacao, configuracoes: viewConfig};
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
  if(CV.tab === 'conferir' && CV.sess) atualizar();
  if(sc) sc.scrollTop = y;
}
function cvTab(t){ CV.tab = t; CV.pag = 0; renderView(); cvCloseSidebarMobile(); if(t === 'conferir') setTimeout(() => { const i = $('cvBip') || $('cvEnt'); if(i) i.focus(); }, 0); }
function cvPag(n){ CV.pag += n; renderView(); }
let _cvBT; function cvBuscaEnt(v){ CV.busca = v; CV.pag = 0; clearTimeout(_cvBT); _cvBT = setTimeout(() => { renderView(); const i = $('cvBusca'); if(i){ i.focus(); i.setSelectionRange(v.length, v.length); } }, 250); }
function cvToggleSidebar(){ const el = $('sidebar'); if(matchMedia('(max-width:860px)').matches) el.classList.toggle('mobile-open'); else el.classList.toggle('collapsed'); }
function cvCloseSidebarMobile(){ if(matchMedia('(max-width:860px)').matches) $('sidebar').classList.remove('mobile-open'); }
function cvToggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const n = cur === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', n);
  try { localStorage.setItem('cv-theme', n); } catch(e){}
}
window.cvAplicarNivel = () => renderView();

/* ---------- início (chamado por acesso.js depois do login) ---------- */
async function cvInit(){
  try { const t = localStorage.getItem('cv-theme'); if(t) document.documentElement.setAttribute('data-theme', t); } catch(e){}
  const v = $('sidebarVersao'); if(v) v.textContent = 'Check Volume · v' + CV_VERSAO;
  renderView();
  await carregar();
  CV.carregando = false;
  renderView();
  setTimeout(() => { const i = $('cvEnt'); if(i) i.focus(); }, 0);
}
