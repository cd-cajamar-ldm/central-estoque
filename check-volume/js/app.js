/* ============================================================
   Check Volume — conferência de entregas por bipagem de EAN.
   Bases: QRY0180 (itens por entrega, com o local de coleta) e QRY0390
   (estoque: EAN de cada item e saldo por local).
   Bases compartilhadas em public.app_dados (app = 'checkvolume', migração 008).
   O andamento da conferência de cada entrega fica neste navegador
   (localStorage) — é rascunho de quem está bipando.
   ============================================================ */
const CV_VERSAO = 1; // subir a cada alteração (aparece no rodapé do menu; trocar também o ?v= no index.html e o CACHE_VERSION do sw.js)
const CV_TAB = 'app_dados', CV_APP = 'checkvolume';
const CV_TITULOS = {
  conferir: ['Conferir entrega', 'Informe a entrega e bipe os EANs das peças.'],
  entregas: ['Entregas', 'Entregas da QRY0180 importada.'],
  importacao: ['Importação', 'QRY0180 (entregas) e QRY0390 (estoque).'],
  configuracoes: ['Configurações', 'Regras das sugestões de outros locais.']
};
const CV = {
  ent: [], itens: {}, saldo: [], meta: {}, cfg: {ignorar: ['REV', 'AVA'], restricoes: ['WN'], max: 5},
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

/* ---------- índices ---------- */
function indexar(){
  CV.porEnt = new Map();
  CV.ent.forEach(r => { let a = CV.porEnt.get(r.e); if(!a) CV.porEnt.set(r.e, a = []); a.push(r); });
  CV.eanMap = new Map();
  Object.keys(CV.itens).forEach(i => (CV.itens[i].e || []).forEach(e => { const k = normEan(e); if(k && !CV.eanMap.has(k)) CV.eanMap.set(k, i); }));
  CV.saldoItem = new Map();
  CV.saldo.forEach(s => { let a = CV.saldoItem.get(s[0]); if(!a) CV.saldoItem.set(s[0], a = []); a.push(s); });
}
async function carregar(){
  try {
    const [cfg, ent, ei, es] = await Promise.all([nuvemLer('cfg'), nuvemLer('ent'), nuvemLer('est_itens'), nuvemLer('est_saldo')]);
    if(cfg && cfg.dados && cfg.dados.cfg) Object.assign(CV.cfg, cfg.dados.cfg);
    CV.ent = ent ? ent.linhas : [];
    CV.itens = {}; (ei ? ei.linhas : []).forEach(x => { CV.itens[x[0]] = {d: x[1], e: x[2]}; });
    CV.saldo = es ? es.linhas : [];
    CV.meta = {ent: ent && ent.meta, est: es && es.meta};
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
    CV.sess.log.push({t: agora, i: x.i});
    const sobra = antes + 1 > x.prev;
    CV.ult = {tipo: sobra ? 'sobra' : 'ok', txt: (sobra ? 'SOBRA · ' : '✓ ') + x.i + ' — ' + x.d + ' · ' + (antes + 1) + ' de ' + x.prev};
    beep(sobra ? 'erro' : 'ok');
  } else {
    const d = CV.sess.desc[cod] || (CV.sess.desc[cod] = {n: 0, nome: ''});
    const outro = CV.eanMap.get(k); d.nome = outro ? ((CV.itens[outro] && CV.itens[outro].d) || '') + ' (item ' + outro + ')' : '';
    d.n++;
    CV.sess.log.push({t: agora, e: cod});
    CV.ult = {tipo: 'ean', txt: 'EAN NÃO IDENTIFICADO · ' + cod + (outro ? ' — pertence a outro produto: ' + d.nome : ' — não está nesta entrega')};
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
function focoBip(){ const i = $('cvBip'); if(i) i.focus(); }
function cvToggle(i){ if(CV.aberto.has(i)) CV.aberto.delete(i); else CV.aberto.add(i); atualizar(); }

/* ---------- onde achar a peça faltante ---------- */
function alternativas(x, falta){
  const orig = x.orig.map(normLoc);
  const ig = new Set((CV.cfg.ignorar || []).map(s => s.toUpperCase())), rs = new Set((CV.cfg.restricoes || []).map(s => s.toUpperCase()));
  const lista = (CV.saldoItem.get(x.i) || []).filter(s => !orig.includes(normLoc(s[1])) && !ig.has(String(s[3]).toUpperCase()) && (!rs.size || rs.has(String(s[4]).toUpperCase())));
  lista.sort((a, b) => ((b[2] >= falta) - (a[2] >= falta)) || b[2] - a[2]);
  return lista.slice(0, CV.cfg.max || 5);
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
    (alts.length ? alts.map((s, n) => '<div class="cv-loc"><span class="rot">' + (n ? 'Alternativa' : 'Sugestão') + '</span><code>' + esc(s[1]) + '</code><span class="sd">saldo <b>' + fInt(s[2]) + '</b>' + (s[2] >= falta ? ' · cobre a falta' : ' · cobre parte') + ' · classe ' + esc(s[3] || '—') + ' · restrição ' + esc(s[4] || '—') + '</span></div>').join('')
      : '<div class="cv-loc"><span class="rot">Alternativa</span><span class="cv-vazio">' + (CV.saldo.length ? 'nenhum outro local com saldo disponível.' : 'importe a QRY0390 para ver outros locais com saldo.') + '</span></div>');
}

/* ---------- telas ---------- */
function vazio(){ return '<div class="panel"><h3>Sem dados</h3><div class="panel-sub">' + esc(CV.erro) + '</div></div>'; }
function chipEnt(){
  const m = CV.meta.ent;
  return m && m.importadoEm ? 'QRY0180 de ' + fData(m.importadoEm.slice(0, 10)) + ' · ' + fInt(CV.porEnt.size) + ' entregas' : 'QRY0180 não importada';
}
function viewConferir(){
  if(CV.carregando) return '<p class="field-hint">Carregando as bases...</p>';
  let h = '<div class="panel"><h3>Entrega</h3><div class="panel-sub">Digite ou bipe o número da entrega. ' + esc(chipEnt()) + '.</div>' +
    '<form class="cv-busca" onsubmit="event.preventDefault();abrirEntrega($(\'cvEnt\').value)"><input id="cvEnt" inputmode="numeric" autocomplete="off" placeholder="Número da entrega" value="' + esc(CV.num) + '"><button class="btn btn-orange" type="submit">Carregar</button>' +
    (CV.sess ? '<button class="btn btn-secondary" type="button" onclick="cvNova()">Outra entrega</button>' : '') + '</form>' +
    (CV.ult && !CV.sess ? '<div class="cv-bip-ult ean">' + esc(CV.ult.txt) + '</div>' : '') + '</div>';
  if(!CV.sess) return h + (CV.ent.length ? '' : '<div class="panel cv-gap"><div class="panel-sub">Nenhuma entrega carregada. ' + (somenteLeitura() ? 'Peça a quem edita para importar a QRY0180 e a QRY0390.' : 'Vá em <b>Importação</b> e envie a QRY0180 e a QRY0390.') + '</div></div>');
  const r0 = CV.porEnt.get(CV.num)[0];
  const semEan = CV.linhas.filter(x => !x.eans.length).length;
  h += '<div class="panel cv-gap"><div class="panel-head-row"><h3 style="margin:0">Entrega ' + esc(CV.num) + '</h3><div id="cvStatus"></div></div>' +
    '<div class="cv-meta">' + [['Transportadora', r0.t], ['Canal', r0.ca], ['Modelo', r0.mo], ['Evento', r0.ev], ['Limite', fData(r0.li)], ['Volumes', r0.vo ? fInt(r0.vo) : '']].filter(a => a[1]).map(a => '<span>' + a[0] + ': <b>' + esc(a[1]) + '</b></span>').join('') + '</div>' +
    (semEan ? '<div class="field-hint" style="margin-top:8px;color:var(--danger)">' + semEan + ' item(ns) sem EAN na QRY0390 — para eles, digite o código do item no campo de bipagem.</div>' : '') +
    '<div class="cv-barra"><i id="cvProg"></i></div></div>' +
    '<div id="cvKpis" class="cv-kpis"></div>' +
    '<div id="cvBipBox" class="panel cv-bip"><h3>Bipagem</h3><div class="panel-sub">Bipe o EAN de cada peça. Cada leitura é contada na hora.</div>' +
    '<form class="cv-busca" onsubmit="event.preventDefault();var i=$(\'cvBip\');bipar(i.value);i.value=\'\';i.focus()"><input id="cvBip" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Bipe o EAN aqui"><button class="btn btn-primary" type="submit">Registrar</button></form>' +
    '<div id="cvUlt"></div>' +
    '<div class="cv-acoes"><button class="btn btn-secondary" onclick="cvDesfazer()">↶ Desfazer última</button><button class="btn btn-orange" onclick="cvFinalizar()">Finalizar conferência</button><button class="btn btn-secondary" onclick="cvExportar()">Exportar Excel</button><button class="btn btn-danger-text" onclick="cvZerar()">Zerar</button></div></div>' +
    '<div id="cvResultado"></div>' +
    '<div class="cv-sec-t">Itens da entrega<span>toque numa linha para ver onde achar a peça</span></div><div id="cvTabela"></div><div id="cvDesc"></div>';
  return h;
}
/* Atualiza só os pedaços que mudam a cada bipagem (o campo de leitura nunca perde o foco). */
function atualizar(){
  if(CV.tab !== 'conferir' || !CV.sess || !$('cvKpis')) return renderView();
  const t = totais(), s = CV.sess;
  const kp = (rot, v, cor) => '<div class="cv-kpi" style="--c:' + cor + '"><span>' + rot + '</span><b>' + fInt(v) + '</b></div>';
  $('cvKpis').innerHTML = kp('Peças previstas', t.prev, '#001A72') + kp('Peças bipadas', t.bip, '#0E7490') + kp('Peças faltantes', t.falta, '#F59E0B') + kp('Peças excedentes', t.sobra, '#C83812') +
    kp('Itens conferidos', t.ok, '#1F8A52') + kp('Itens pendentes', t.pend, '#6B7280') + kp('EAN não identificado', t.ean, '#7C3AED');
  $('cvProg').style.width = (t.prev ? Math.min(t.bip, t.prev) / t.prev * 100 : 0) + '%';
  const u = $('cvUlt'); u.innerHTML = CV.ult ? '<div class="cv-bip-ult ' + CV.ult.tipo + '">' + esc(CV.ult.txt) + '</div>' : '';
  $('cvStatus').innerHTML = s.fin ? '<span class="cv-pill ' + (t.falta || t.sobra || t.ean ? 'cv-falta' : 'cv-ok') + '">Finalizada</span>' : '<span class="cv-pill cv-pend">Em conferência</span>';
  // tabela
  const ordem = {falta: 0, sobra: 1, pend: 2, ok: 3};
  const ls = CV.linhas.slice().sort((a, b) => ordem[cvSituacao(a)] - ordem[cvSituacao(b)] || a.d.localeCompare(b.d));
  $('cvTabela').innerHTML = '<div class="table-wrap"><table class="cv-tab"><thead><tr><th>Código</th><th>Descrição</th><th class="n">Prevista</th><th class="n">Bipada</th><th class="n">Pendente</th><th>Situação</th><th></th></tr></thead><tbody>' +
    ls.map(x => {
      const b = s.bips[x.i] || 0, st = cvSituacao(x), pen = Math.max(x.prev - b, 0), ab = CV.aberto.has(x.i);
      return '<tr class="' + (pen ? 'clicavel' : '') + '"' + (pen ? ' onclick="cvToggle(\'' + esc(x.i) + '\')"' : '') + '><td class="cv-mono">' + esc(x.i) + '</td><td class="cv-desc">' + esc(x.d) + '<div class="field-hint">EAN ' + (x.eans.length ? esc(x.eans.join(' / ')) : 'não cadastrado') + '</div></td>' +
        '<td class="n">' + fInt(x.prev) + '</td><td class="n"><b>' + fInt(b) + '</b></td><td class="n">' + fInt(pen) + (b > x.prev ? ' <span style="color:var(--danger)">(+' + fInt(b - x.prev) + ')</span>' : '') + '</td>' +
        '<td><span class="cv-pill cv-' + st + '">' + ROT[st] + '</span></td><td class="n">' + (b ? '<button class="btn-link" onclick="event.stopPropagation();cvMenos(\'' + esc(x.i) + '\')" title="Tirar uma bipagem">−1</button>' : '') + '</td></tr>' +
        (pen && ab ? '<tr class="cv-det"><td colspan="7"><b>Faltam ' + fInt(pen) + '</b> — onde achar:' + blocoLocais(x) + '</td></tr>' : '');
    }).join('') + '</tbody></table></div>';
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
    (ok ? '✓ Entrega conferida sem divergência.' : '⚠ Entrega com divergência — precisa de tratativa.') +
    '<small>' + t.ok + ' de ' + t.itens + ' itens sem divergência · ' + faltas.length + ' com falta · ' + sobras.length + ' com sobra · ' + fInt(t.ean) + ' leitura(s) de EAN não identificado.</small></div>';
  if(faltas.length) h += '<div class="cv-sec-t">Faltantes — onde buscar<span>origem da coleta e outros locais com saldo</span></div>' + faltas.map(x => {
    const f = x.prev - (CV.sess.bips[x.i] || 0);
    return '<div class="cv-falta-card"><span class="qtd">faltam ' + fInt(f) + '</span><h4>' + esc(x.i) + ' — ' + esc(x.d) + '</h4><div class="sub">Prevista ' + fInt(x.prev) + ' · bipada ' + fInt(CV.sess.bips[x.i] || 0) + '</div>' + blocoLocais(x) + '</div>';
  }).join('');
  if(sobras.length) h += '<div class="cv-sec-t">Sobras<span>peças a mais do que o previsto</span></div><div class="table-wrap"><table class="cv-tab"><tbody>' + sobras.map(x => '<tr><td class="cv-mono">' + esc(x.i) + '</td><td>' + esc(x.d) + '</td><td class="n"><b>+' + fInt(CV.sess.bips[x.i] - x.prev) + '</b></td></tr>').join('') + '</tbody></table></div>';
  return h + '<div class="cv-acoes"><button class="btn btn-secondary" onclick="cvReabrir()">Reabrir conferência</button><button class="btn btn-orange" onclick="cvNova()">Conferir outra entrega</button></div>';
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
  const e = CV.meta.ent, s = CV.meta.est;
  const linha = (rot, ok, txt) => '<div class="cv-st ' + (ok ? 'ok' : '') + '"><b>' + rot + '</b><span>' + txt + '</span></div>';
  return '<div class="panel"><h3>Importar bases</h3><div class="panel-sub">Selecione os dois arquivos de uma vez (ou só o que mudou) — o app reconhece cada um pelo cabeçalho. Cada importação <b>substitui</b> a anterior e fica disponível para todos com acesso.</div>' +
    '<label class="dropzone cv-drop" id="cvDrop"><div class="dz-icon">📥</div><div class="dz-title">Arraste ou clique para escolher</div><div class="dz-desc">QRY0180 (entregas) · QRY0390 (estoque) — .xlsx</div>' +
    '<input type="file" id="cvArq" accept=".xlsx,.xls" multiple hidden onchange="importar(Array.from(this.files)); this.value=\'\'"></label>' +
    '<div class="cv-msg" id="cvMsg">' + (CV.ocupado ? '⏳ ' + esc(CV.msg) : '') + '</div></div>' +
    '<div class="panel cv-gap"><h3>Situação das bases</h3>' +
    linha('QRY0180 · entregas', !!e, e ? esc(e.arquivo) + ' · ' + fInt(e.linhas) + ' linhas · <b>' + fInt(e.entregas) + ' entregas</b> · ' + fData((e.importadoEm || '').slice(0, 10)) + (e.por ? ' por ' + esc(e.por) : '') : 'Não importada.') +
    linha('QRY0390 · estoque', !!s, s ? esc(s.arquivo) + ' · ' + fInt(s.linhas) + ' linhas · <b>' + fInt(s.itens) + ' itens com EAN</b> · ' + fInt(s.locais) + ' saldos por local · ' + fData((s.importadoEm || '').slice(0, 10)) + (s.por ? ' por ' + esc(s.por) : '') : 'Não importada. Sem ela não há EAN para bipar nem sugestão de outros locais.') + '</div>' +
    '<div class="panel cv-gap"><h3>Como funciona</h3><div class="cv-regras"><p><b>Entrega:</b> itens, quantidades e local de coleta vêm da QRY0180.</p><p><b>EAN:</b> o EAN de cada item vem da QRY0390 (coluna EAN).</p><p><b>Locais alternativos:</b> saldo disponível (<code>QTDE_DISP</code>) da QRY0390 em outros locais, conforme as regras de Configurações. O saldo é o da data da importação.</p></div></div>';
}
function viewConfig(){
  return '<div class="panel"><h3>Classes de local ignoradas nas sugestões</h3><div class="panel-sub">Coluna <code>CLAL</code> da QRY0390, separadas por vírgula. Locais dessas classes (ex.: reversa e avaria) não são sugeridos.</div><div class="filter-bar"><input type="text" id="cfgIg" value="' + esc(CV.cfg.ignorar.join(', ')) + '"></div></div>' +
    '<div class="panel cv-gap"><h3>Restrições aceitas</h3><div class="panel-sub">Coluna <code>RETRICAO</code> da QRY0390. Só saldo com essas restrições é sugerido (padrão <code>WN</code> = normal). Em branco = aceita todas.</div><div class="filter-bar"><input type="text" id="cfgRs" value="' + esc(CV.cfg.restricoes.join(', ')) + '"></div></div>' +
    '<div class="panel cv-gap"><h3>Quantidade de sugestões por item</h3><div class="filter-bar"><input type="number" min="1" max="20" id="cfgMax" value="' + (CV.cfg.max || 5) + '"></div></div>' +
    '<div class="cv-gap"><button class="btn btn-orange" onclick="cvSalvarCfg()">Salvar configurações</button></div>';
}
async function cvSalvarCfg(){
  CV.cfg.ignorar = String($('cfgIg').value).toUpperCase().split(/[,;\s]+/).filter(Boolean);
  CV.cfg.restricoes = String($('cfgRs').value).toUpperCase().split(/[,;\s]+/).filter(Boolean);
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
    w.onerror = e => { w.terminate(); no(new Error(file.name + ': ' + (e.message || 'falha ao ler'))); };
    file.arrayBuffer().then(buf => w.postMessage({nome: file.name, buf}, [buf]), no);
  });
}
async function importar(files){
  if(somenteLeitura()) return toast('Seu acesso é só de visualização.', true);
  if(CV.ocupado || !files.length) return;
  CV.ocupado = true; CV.msg = 'Iniciando...'; renderView();
  try {
    const sessao = (await cvSupa.auth.getSession()).data.session, por = sessao ? sessao.user.email : '';
    for(const f of files){
      const r = await lerArquivo(f);
      if(r.base === '180'){
        CV.msg = 'Gravando entregas na nuvem...'; renderMsg();
        const meta = {importadoEm: new Date().toISOString(), por, arquivo: r.nome, linhas: r.linhas, entregas: new Set(r.dados.map(x => x.e)).size};
        await nuvemGravar('ent', meta, {}, dividir(r.dados, 400000));
        CV.ent = r.dados; CV.meta.ent = meta;
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
    console.error(e); toast(e.message || String(e), true);
  } finally { CV.ocupado = false; CV.msg = ''; renderView(); }
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
