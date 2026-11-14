/* ============================================================
   Controle de Validade — vencidos e próximos do vencimento.
   Bases: QRY0390 (estoque, com Data de Validade), SIGEQ278 (preço de custo
   p/ valorar) e ZBIQ0051 (múltiplos: qual componente carrega valor).
   Dados compartilhados em public.vl_dados (migração 007).
   ============================================================ */
const VL_TAB = 'vl_dados';
const VL_CORES_PROX = ['#FE5000', '#E5A21C', '#B5B81F', '#7DBE4B', '#4FA66A'];
const VL_COR_VENC = '#C83812', VL_COR_OK = '#1F8A52', VL_COR_E = '#1E33C7', VL_COR_R = '#0E7490';
const VL_MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const VL_TITULOS = {
  painel: ['Painel de validade', 'Quanto está vencido e perto de vencer — estoque × reversa.'],
  fornecedores: ['Por fornecedor', 'Valor vencido e a vencer, separado por fornecedor.'],
  mensal: ['Visão mensal', 'Valor por mês de vencimento. Meses passados já estão vencidos.'],
  itens: ['Itens e lotes', 'Detalhe de cada lote com validade.'],
  importacao: ['Importação', 'QRY0390 (estoque), SIGEQ278 (preço) e ZBIQ0051 (múltiplos).'],
  configuracoes: ['Configurações', 'Faixas de vencimento, classes da reversa e fornecedores.']
};
/* Marcas conhecidas -> nome do fornecedor. O que não estiver aqui cai na última
   palavra da descrição; tudo pode ser corrigido em Configurações. */
const VL_SEED = ('MAZA TEKBOND NORTON VONDER WURTH RADNAQ KALIPSO ONYX CARBOGRAFITE UNIPEGA QUIMATIC MOCOCA BIOLUB SCHEBOR DANNY EURODECOR NUTRIEX ' +
  'CENTRALSUL MARLUVAS TECBRIL DRYKO ORBI ESAB MAGMA RUST-OLEUM SOFT99 RADCOLOR STP CASCOLA VULCAFLEX SOUDAL BARDAHL BADEN LOCTITE WD-40 MTX VEDACIT ' +
  'PLASTCOR SANRO 3M STARRETT SHIELD BRASILUX KADESH AMAZONAS DISFLEX TRAMONTINA VOLK SAIT PULVITEC BEMFIXA LEDAN KARCHER LYNUS BOSCH ATOMOS ARCDAL ' +
  'AUTOSHINE GRAZIA HENKEL JEFLUB GALZER KOUBE BALMER TOYAMA GEDORE SUALL CHEMICOLOR MIRAX TIREBOR NOVE54 KLYO TBCC').split(' ');
/* Trechos da descrição que identificam o fornecedor mesmo sem a marca isolada. */
const VL_FRASES = [['MAXI RUBBER', 'MAXI RUBBER'], ['LIMPZ AUTO', 'LIMPZ AUTO'], ['SUAL PISCINAS', 'SUALL'], ['MAZA', 'MAZA']];
const VL_ALIAS = {VOND: 'VONDER', 'RUST OLEUM': 'RUST-OLEUM'};
const VL_NOISE = new Set(['AUTO', 'BLISTER', 'QUIMICA', 'RUBBER', 'PISCINAS', 'UNIDADE', 'KIT', 'PRETO', 'BRANCO', 'AZUL', 'CINZA', 'VERMELHO', 'PRETA']);

const VL = {
  rows: [], meta: null, hist: [],
  cfg: {faixas: [30, 60, 90], reversa: ['REV', 'AVA'], forn: {}},
  tab: 'painel', f: {area: '', forn: '', busca: '', faixa: ''}, sort: {k: 'valor', d: -1}, pag: 0,
  ocupado: false, msg: '', carregando: true
};

/* ---------- utilitários ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fInt = n => Math.round(n || 0).toLocaleString('pt-BR');
const fBRL = n => (n || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL', maximumFractionDigits: 0});
const fBRL2 = n => (n || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
function fBRLc(n){
  n = n || 0; const a = Math.abs(n);
  if(a >= 1e6) return 'R$ ' + (n / 1e6).toLocaleString('pt-BR', {maximumFractionDigits: 2}) + ' mi';
  if(a >= 1e4) return 'R$ ' + (n / 1e3).toLocaleString('pt-BR', {maximumFractionDigits: 0}) + ' mil';
  return fBRL(n);
}
const fPct = (a, b) => b > 0 ? (a / b * 100).toLocaleString('pt-BR', {maximumFractionDigits: 1}) + '%' : '—';
const fData = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '';
const fMes = ym => VL_MESES[+ym.slice(5, 7) - 1] + '/' + ym.slice(2, 4);
function toast(msg, erro){
  const t = document.getElementById('toast'); if(!t) return;
  t.textContent = msg; t.className = 'toast' + (erro ? ' error' : '');
  clearTimeout(window.__vlT); window.__vlT = setTimeout(() => { t.className = 'toast hidden'; }, 3200);
}
const somenteLeitura = () => !!window.LDM_SOMENTE_LEITURA;
function hojeISO(){ const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function diasAte(iso){ const a = Date.parse(hojeISO() + 'T00:00:00Z'), b = Date.parse(iso + 'T00:00:00Z'); return Math.round((b - a) / 864e5); }

/* ---------- faixas ---------- */
function faixas(){
  const dias = VL.cfg.faixas.slice().sort((a, b) => a - b);
  const lista = [{k: 'venc', nome: 'Vencido', cor: VL_COR_VENC, max: -1}];
  let ant = 0;
  dias.forEach((d, i) => {
    lista.push({k: 'f' + d, nome: i === 0 ? 'Vence em até ' + d + ' dias' : 'De ' + (ant + 1) + ' a ' + d + ' dias', cor: VL_CORES_PROX[i % VL_CORES_PROX.length], max: d});
    ant = d;
  });
  lista.push({k: 'ok', nome: 'Acima de ' + ant + ' dias', cor: VL_COR_OK, max: Infinity});
  return lista;
}
function faixaDe(dias, fx){ for(const f of fx) if(dias <= f.max) return f; return fx[fx.length - 1]; }

/* ---------- marca / fornecedor ---------- */
function marcaDe(desc){
  const lim = t => t.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
  const toks = String(desc || '').toUpperCase().split(/\s+/).map(lim).filter(Boolean);
  if(!toks.length) return 'SEM MARCA';
  const ok = t => { t = VL_ALIAS[t] || t; return VL_SEED.indexOf(t) >= 0 ? t : null; };
  const ult = ok(toks[toks.length - 1]); if(ult) return ult;
  const pri = ok(toks[0]); if(pri) return pri;
  for(const t of toks){ const m = ok(t); if(m) return m; }
  const D = String(desc || '').toUpperCase();
  for(const [fr, m] of VL_FRASES) if(D.indexOf(fr) >= 0) return m;
  for(const sd of VL_SEED) if(sd.length >= 5 && D.indexOf(sd) >= 0) return sd; // marca colada: "300MLVONDER", "NUTRIEX-61093"
  const l = toks[toks.length - 1];
  if(/^[A-Z][A-Z-]{2,}$/.test(l) && !VL_NOISE.has(l)) return VL_ALIAS[l] || l;
  return 'SEM MARCA';
}
const fornDe = marca => VL.cfg.forn[marca] || (marca === 'SEM MARCA' ? 'A classificar' : marca);

/* ---------- preparo das linhas (derivados) ---------- */
function preparar(){
  const fx = faixas(), rev = new Set(VL.cfg.reversa);
  VL.fx = fx;
  VL.rows.forEach(r => {
    r.area = rev.has(r.cl) ? 'R' : 'E';
    r.marca = marcaDe(r.d); r.forn = fornDe(r.marca);
    r.dias = diasAte(r.v); r.faixa = faixaDe(r.dias, fx).k;
    r.valor = r.q * (r.c || 0);
    r.mes = r.v.slice(0, 7);
  });
}
function filtradas(ignorarFaixa){
  const b = VL.f.busca.trim().toLowerCase();
  return VL.rows.filter(r => (!VL.f.area || r.area === VL.f.area) && (!VL.f.forn || r.forn === VL.f.forn) &&
    (ignorarFaixa || !VL.f.faixa || r.faixa === VL.f.faixa) &&
    (!b || r.i.indexOf(b) >= 0 || r.d.toLowerCase().indexOf(b) >= 0 || r.l.toLowerCase().indexOf(b) >= 0 || r.forn.toLowerCase().indexOf(b) >= 0));
}
function somar(rows, chaveFn){
  const m = new Map();
  rows.forEach(r => {
    const k = chaveFn(r); let o = m.get(k);
    if(!o){ o = {k, valor: 0, q: 0, lotes: 0, f: {}}; m.set(k, o); }
    o.valor += r.valor; o.q += r.q; o.lotes++;
    o.f[r.faixa] = (o.f[r.faixa] || 0) + r.valor;
  });
  return Array.from(m.values());
}
const tot = rows => rows.reduce((a, r) => { a.valor += r.valor; a.q += r.q; a.lotes++; return a; }, {valor: 0, q: 0, lotes: 0});

/* ---------- IndexedDB local (cache das bases 278 e 051) ---------- */
function idb(){
  return new Promise((ok, no) => {
    const rq = indexedDB.open('ldm-validade', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => ok(rq.result); rq.onerror = () => no(rq.error);
  });
}
async function kvGet(k){ try { const d = await idb(); return await new Promise(ok => { const r = d.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => ok(r.result); r.onerror = () => ok(undefined); }); } catch(e){ return undefined; } }
async function kvSet(k, v){ try { const d = await idb(); await new Promise(ok => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = ok; t.onerror = ok; }); } catch(e){} }

/* ---------- nuvem (Supabase) ---------- */
async function nuvemLer(chave){
  const { data: cab, error } = await vlSupa.from(VL_TAB).select('versao,dados,meta').eq('chave', chave).eq('parte', 0).order('versao', {ascending: false}).limit(1);
  if(error) throw error;
  if(!cab || !cab.length) return null;
  const c = cab[0], n = (c.dados && c.dados.partes) || 0;
  let linhas = [];
  if(n){
    const { data, error: e2 } = await vlSupa.from(VL_TAB).select('parte,dados').eq('chave', chave).eq('versao', c.versao).gt('parte', 0).order('parte');
    if(e2) throw e2;
    if(!data || data.length !== n) throw new Error('Base em atualização, tente de novo em instantes.');
    data.forEach(p => { linhas = linhas.concat(p.dados); });
  }
  return {dados: c.dados, meta: c.meta, linhas};
}
async function nuvemGravar(chave, meta, cabExtra, partes){
  if(somenteLeitura()) throw new Error('Seu acesso é só de visualização.');
  const versao = new Date().toISOString() + '-' + Math.random().toString(36).slice(2, 6);
  const tab = vlSupa.from(VL_TAB);
  for(let i = 0; i < partes.length; i++){
    const { error } = await tab.insert({chave, versao, parte: i + 1, dados: partes[i]});
    if(error) throw error;
  }
  const { error: e2 } = await tab.insert({chave, versao, parte: 0, dados: Object.assign({}, cabExtra, partes.length ? {partes: partes.length} : {}), meta: meta || null});
  if(e2) throw e2;
  await vlSupa.from(VL_TAB).delete().eq('chave', chave).neq('versao', versao);
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
const CAMPOS = ['i', 'd', 'l', 'v', 'lo', 'cl', 'r', 'q', 'c', 'm'];
const lerCampos = r => { const o = {}; CAMPOS.forEach(k => { o[k] = r[k]; }); return o; };

async function carregar(){
  try {
    const [base, cfg, hist] = await Promise.all([nuvemLer('base'), nuvemLer('cfg'), nuvemLer('hist')]);
    if(cfg && cfg.dados) Object.assign(VL.cfg, cfg.dados.cfg || {});
    VL.hist = (hist && hist.dados && hist.dados.pontos) || [];
    VL.rows = base ? base.linhas : []; VL.meta = base ? base.meta : null;
    preparar();
  } catch(e){
    VL.erro = 'Não consegui ler os dados: ' + (e.message || e) + (/relation|does not exist|vl_dados/i.test(String(e.message)) ? ' — a tabela vl_dados ainda não foi criada no banco (migração 007).' : '');
  }
}

/* ---------- importação ---------- */
function lerArquivo(file){
  return new Promise((ok, no) => {
    const w = new Worker('js/worker.js');
    w.onmessage = e => {
      const m = e.data;
      if(m.tipo === 'prog'){ VL.msg = m.msg; renderMsg(); return; }
      w.terminate();
      if(m.tipo === 'erro') no(new Error(m.nome + ': ' + m.msg)); else ok(m);
    };
    w.onerror = e => { w.terminate(); no(new Error(file.name + ': ' + (e.message || 'falha ao ler'))); };
    file.arrayBuffer().then(buf => w.postMessage({nome: file.name, buf}, [buf]), no);
  });
}
function valorar(rows, precos, est){
  const pais = {};
  Object.keys(est || {}).forEach(c => { pais[c] = est[c]; });
  rows.forEach(r => {
    const comp = pais[r.i];
    if(comp){ // componente de múltiplo: só quem tem in_interface = S carrega o valor do conjunto (preço do pai)
      r.m = 1; r.c = comp.s ? (precos[comp.p] || 0) : 0;
    } else { r.m = 0; r.c = precos[r.i] || 0; }
  });
}
async function importar(files){
  if(somenteLeitura()) return toast('Seu acesso é só de visualização.', true);
  if(VL.ocupado || !files.length) return;
  VL.ocupado = true; VL.msg = 'Iniciando...'; renderView();
  try {
    let novas = null; const arqs = {};
    for(const f of files){
      const r = await lerArquivo(f);
      if(r.base === '390'){ novas = r; arqs['390'] = {nome: r.nome, linhas: r.linhas}; }
      else if(r.base === '278'){ await kvSet('precos', r.dados); await kvSet('precos-meta', {nome: r.nome, em: new Date().toISOString(), n: r.comPreco}); }
      else if(r.base === '051'){
        const est = {}; r.dados.forEach(([c, p, s]) => { if(!est[c] || s) est[c] = {p, s}; });
        await kvSet('estrutura', est); await kvSet('estrutura-meta', {nome: r.nome, em: new Date().toISOString(), n: r.dados.length});
      }
    }
    VL.msg = 'Valorando e gravando na nuvem...'; renderMsg();
    const precos = (await kvGet('precos')) || {}, est = (await kvGet('estrutura')) || {};
    let rows = novas ? novas.dados : VL.rows.map(lerCampos);
    if(!novas && !VL.rows.length) throw new Error('Importe primeiro a QRY0390 (estoque).');
    valorar(rows, precos, est);
    const sessao = (await vlSupa.auth.getSession()).data.session;
    const antigo = VL.meta || {};
    const meta = {
      importadoEm: new Date().toISOString(), por: sessao ? sessao.user.email : '',
      arquivo390: novas ? novas.nome : antigo.arquivo390, linhas390: novas ? novas.linhas : antigo.linhas390,
      wvSemData: novas ? novas.wvSemData : antigo.wvSemData,
      preco: await kvGet('precos-meta') || null, estrutura: await kvGet('estrutura-meta') || null
    };
    await nuvemGravar('base', meta, {}, dividir(rows, 400000));
    VL.rows = rows; VL.meta = meta; preparar();
    await registrarHist();
    toast('Importação concluída: ' + fInt(rows.length) + ' lotes com validade.');
  } catch(e){
    console.error(e); toast(e.message || String(e), true);
  } finally { VL.ocupado = false; VL.msg = ''; renderView(); }
}
async function registrarHist(){
  const h = VL.hist.filter(p => p.d !== hojeISO());
  const p = {d: hojeISO()};
  ['E', 'R'].forEach(a => {
    const rs = VL.rows.filter(r => r.area === a);
    p['v' + a] = Math.round(tot(rs.filter(r => r.faixa === 'venc')).valor);
    p['t' + a] = Math.round(tot(rs).valor);
  });
  h.push(p);
  VL.hist = h.slice(-400);
  try { await nuvemGravar('hist', null, {pontos: VL.hist}, []); } catch(e){ console.warn('histórico não gravado', e); }
}
async function salvarCfg(){
  try { await nuvemGravar('cfg', null, {cfg: VL.cfg}, []); preparar(); toast('Configurações salvas.'); }
  catch(e){ toast(e.message || String(e), true); }
}

/* ---------- gráficos (HTML/SVG simples) ---------- */
function tip(el){ return ' data-tip="' + esc(el) + '"'; }
function anel(pct, cor, centro, sub){
  const r = 42, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct));
  return '<div class="vl-anel"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="' + r + '" fill="none" stroke="var(--surface2)" stroke-width="12"/>' +
    '<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="' + cor + '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + (c * p) + ' ' + c + '" transform="rotate(-90 50 50)"/></svg>' +
    '<div class="vl-anel-c"><b>' + centro + '</b><span>' + sub + '</span></div></div>';
}
function barraFaixas(o){ // barra empilhada 100% por faixa
  const t = Object.values(o.f).reduce((a, b) => a + b, 0) || 1;
  return '<div class="vl-stack">' + VL.fx.map(f => {
    const v = o.f[f.k] || 0; if(!v) return '';
    return '<i style="width:' + (v / t * 100) + '%;background:' + f.cor + '"' + tip(f.nome + ': ' + fBRL(v) + ' (' + fPct(v, t) + ')') + '></i>';
  }).join('') + '</div>';
}
function legenda(){ return '<div class="vl-leg">' + VL.fx.map(f => '<span><i style="background:' + f.cor + '"></i>' + esc(f.nome) + '</span>').join('') + '</div>'; }

/* ---------- views ---------- */
function filtrosBarra(comFaixa){
  const forns = Array.from(new Set(VL.rows.map(r => r.forn))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const chip = (v, t) => '<button class="chip' + (VL.f.area === v ? ' active' : '') + '" onclick="vlSet(\'area\',\'' + v + '\')">' + t + '</button>';
  return '<div class="filter-bar vl-filtros"><div class="vl-chips">' + chip('', 'Estoque + Reversa') + chip('E', 'Só estoque') + chip('R', 'Só reversa') + '</div>' +
    '<select onchange="vlSet(\'forn\',this.value)"><option value="">Todos os fornecedores</option>' + forns.map(f => '<option' + (f === VL.f.forn ? ' selected' : '') + '>' + esc(f) + '</option>').join('') + '</select>' +
    (comFaixa ? '<select onchange="vlSet(\'faixa\',this.value)"><option value="">Todas as faixas</option>' + VL.fx.map(f => '<option value="' + f.k + '"' + (f.k === VL.f.faixa ? ' selected' : '') + '>' + esc(f.nome) + '</option>').join('') + '</select>' : '') +
    (VL.f.area || VL.f.forn || VL.f.faixa ? '<button class="btn btn-secondary" onclick="vlLimpar()">Limpar filtros</button>' : '') + '</div>';
}
function vazio(){
  if(VL.carregando) return '<p class="field-hint">Carregando...</p>';
  if(VL.erro) return '<div class="panel callout-warn callout"><strong>Atenção</strong>' + esc(VL.erro) + '</div>';
  return '<div class="empty-state panel"><div class="eicon">📅</div><h3>Nenhuma base importada ainda</h3><p>Importe a QRY0390 (estoque com Data de Validade), a SIGEQ278 (preço) e a ZBIQ0051 (múltiplos).</p>' +
    (somenteLeitura() ? '' : '<button class="btn btn-orange" onclick="vlTab(\'importacao\')">Ir para Importação</button>') + '</div>';
}
const AREAS = [['E', 'Estoque', VL_COR_E], ['R', 'Reversa', VL_COR_R]];
function kpis(rows, nomeArea){
  const por = somar(rows, r => r.faixa), mp = {}; por.forEach(o => { mp[o.k] = o; });
  const total = tot(rows);
  return '<div class="kpi-grid">' + VL.fx.map(f => {
    const o = mp[f.k] || {valor: 0, q: 0, lotes: 0};
    return '<div class="kpi-card vl-kpi" style="--c:' + f.cor + '" onclick="vlSet(\'faixa\',\'' + (VL.f.faixa === f.k ? '' : f.k) + '\')">' +
      '<div class="label">' + esc(f.nome) + '</div><div class="num">' + fBRLc(o.valor) + '</div>' +
      '<div class="sub">' + fInt(o.q) + ' peças · ' + fInt(o.lotes) + ' lotes</div>' +
      '<div class="vl-mini"><i style="width:' + (total.valor ? o.valor / total.valor * 100 : 0) + '%;background:' + f.cor + '"></i></div>' +
      '<div class="sub">' + fPct(o.valor, total.valor) + ' do valor com validade ' + (nomeArea ? 'n' + (nomeArea === 'Estoque' ? 'o estoque' : 'a reversa') : '') + '</div></div>';
  }).join('') + '</div>';
}
function cartaoArea(nome, cor, rows){
  const t = tot(rows), venc = tot(rows.filter(r => r.faixa === 'venc')), prox = tot(rows.filter(r => r.dias >= 0 && r.dias <= Math.max.apply(null, VL.cfg.faixas)));
  const o = somar(rows, () => 'x')[0] || {f: {}};
  return '<div class="panel vl-area" style="--c:' + cor + '"><h3>' + nome + '</h3><div class="panel-sub">' + fInt(t.q) + ' peças · ' + fInt(t.lotes) + ' lotes com validade</div>' +
    '<div class="vl-area-row">' + anel(t.valor ? venc.valor / t.valor : 0, VL_COR_VENC, fPct(venc.valor, t.valor), 'vencido') +
    '<div class="vl-area-n"><div><span>Vencido</span><b style="color:' + VL_COR_VENC + '">' + fBRLc(venc.valor) + '</b><em>' + fInt(venc.q) + ' peças</em></div>' +
    '<div><span>Vence em até ' + Math.max.apply(null, VL.cfg.faixas) + ' dias</span><b style="color:' + VL_CORES_PROX[0] + '">' + fBRLc(prox.valor) + '</b><em>' + fInt(prox.q) + ' peças</em></div>' +
    '<div><span>Total com validade</span><b>' + fBRLc(t.valor) + '</b></div></div></div>' + barraFaixas(o) + '</div>';
}
function graficoMensal(rows, alt, cor){ // uma área por gráfico: estoque e reversa nunca na mesma coluna
  const por = {};
  rows.forEach(r => { const o = por[r.mes] = por[r.mes] || {ym: r.mes, v: 0, q: 0}; o.v += r.valor; o.q += r.q; });
  const todos = Object.values(por).sort((a, b) => a.ym.localeCompare(b.ym));
  if(!todos.length) return '<p class="field-hint">Sem dados.</p>';
  // Janela de 12 meses pra trás e 12 pra frente: o que fica fora vira um resumo,
  // senão um mês distante com muito valor achata todas as colunas.
  const desl = n => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const ini = desl(-12), fim = desl(12), hoje = hojeISO().slice(0, 7);
  const meses = todos.filter(m => m.ym >= ini && m.ym <= fim);
  const antes = todos.filter(m => m.ym < ini).reduce((a, m) => a + m.v, 0), depois = todos.filter(m => m.ym > fim).reduce((a, m) => a + m.v, 0);
  const fora = '<div class="vl-fora">' + (antes ? '<span class="venc">Vencido antes de ' + fMes(ini) + ': <b>' + fBRL(antes) + '</b></span>' : '') + (depois ? '<span>Vence depois de ' + fMes(fim) + ': <b>' + fBRL(depois) + '</b></span>' : '') + '</div>';
  if(!meses.length) return fora;
  const max = Math.max.apply(null, meses.map(m => m.v)) || 1;
  return fora + '<div class="vl-mensal" style="height:' + alt + 'px">' + meses.map(m => {
    const passado = m.ym < hoje;
    return '<div class="vl-col' + (passado ? ' passado' : '') + '"' + tip(fMes(m.ym) + ' · ' + fBRL(m.v) + ' · ' + fInt(m.q) + ' peças' + (passado ? ' · vencido' : '')) + '>' +
      '<span class="vl-col-v">' + (m.v ? fBRLc(m.v).replace('R$ ', '') : '') + '</span>' +
      '<div class="vl-col-b" style="height:' + (m.v / max * 100) + '%;background:' + (passado ? VL_COR_VENC : cor) + '"></div>' +
      '<span class="vl-col-l">' + fMes(m.ym) + '</span></div>';
  }).join('') + '</div><div class="vl-leg"><span><i style="background:' + VL_COR_VENC + '"></i>Mês já vencido</span><span><i style="background:' + cor + '"></i>A vencer</span></div>';
}
function topForn(rows, n){
  const por = somar(rows, r => r.forn).map(o => ({k: o.k, venc: o.f.venc || 0, prox: VL.fx.filter(f => f.k !== 'venc' && f.k !== 'ok').reduce((a, f) => a + (o.f[f.k] || 0), 0)}))
    .filter(o => o.venc + o.prox > 0).sort((a, b) => (b.venc + b.prox) - (a.venc + a.prox)).slice(0, n);
  if(!por.length) return '<p class="field-hint">Sem vencidos ou a vencer.</p>';
  const max = por[0].venc + por[0].prox;
  return '<div class="vl-hbars">' + por.map(o => '<div class="vl-hrow" onclick="vlSet(\'forn\',\'' + esc(o.k).replace(/'/g, '&#39;') + '\')">' +
    '<span class="vl-hl">' + esc(o.k) + '</span><div class="vl-ht"><i style="width:' + (o.venc / max * 100) + '%;background:' + VL_COR_VENC + '"' + tip('Vencido: ' + fBRL(o.venc)) + '></i><i style="width:' + (o.prox / max * 100) + '%;background:' + VL_CORES_PROX[0] + '"' + tip('A vencer: ' + fBRL(o.prox)) + '></i></div>' +
    '<span class="vl-hv">' + fBRLc(o.venc + o.prox) + '</span></div>').join('') + '</div>' +
    '<div class="vl-leg"><span><i style="background:' + VL_COR_VENC + '"></i>Vencido</span><span><i style="background:' + VL_CORES_PROX[0] + '"></i>A vencer (dentro das faixas)</span></div>';
}
function graficoHist(){ // estoque e reversa em linhas próprias, sem somar
  const p = VL.hist;
  if(!p.length) return '<p class="field-hint">Ainda não há registro. Cada importação da QRY0390 grava um ponto por dia.</p>';
  if(p.length < 2) return '<div class="vl-hist1"><div><span>Estoque vencido em ' + fData(p[0].d) + '</span><b style="color:' + VL_COR_E + '">' + fBRL(p[0].vE) + '</b></div><div><span>Reversa vencida em ' + fData(p[0].d) + '</span><b style="color:' + VL_COR_R + '">' + fBRL(p[0].vR) + '</b></div></div>' +
    '<p class="field-hint">Este é o ponto de partida. A linha de evolução precisa de pelo menos duas importações da QRY0390 em dias diferentes — importe de novo outro dia e o gráfico aparece.</p>';
  const W = 640, H = 160, pad = 28, max = Math.max.apply(null, p.map(x => Math.max(x.vE, x.vR))) || 1;
  const X = i => pad + i * (W - pad * 2) / (p.length - 1), Y = v => H - 22 - v / max * (H - 40);
  const linha = fn => p.map((x, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(fn(x)).toFixed(1)).join(' ');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="vl-linha"><path d="' + linha(x => x.vE) + '" fill="none" stroke="' + VL_COR_E + '" stroke-width="2.5"/><path d="' + linha(x => x.vR) + '" fill="none" stroke="' + VL_COR_R + '" stroke-width="2.5"/>' +
    p.map((x, i) => '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(x.vE).toFixed(1) + '" r="4" fill="' + VL_COR_E + '"' + tip(fData(x.d) + ' · estoque vencido ' + fBRL(x.vE)) + '/><circle cx="' + X(i).toFixed(1) + '" cy="' + Y(x.vR).toFixed(1) + '" r="4" fill="' + VL_COR_R + '"' + tip(fData(x.d) + ' · reversa vencida ' + fBRL(x.vR)) + '/>').join('') +
    '<text x="' + pad + '" y="' + (H - 4) + '" class="vl-ax">' + fData(p[0].d) + '</text><text x="' + (W - pad) + '" y="' + (H - 4) + '" text-anchor="end" class="vl-ax">' + fData(p[p.length - 1].d) + '</text></svg>' +
    '<div class="vl-leg"><span><i style="background:' + VL_COR_E + '"></i>Estoque</span><span><i style="background:' + VL_COR_R + '"></i>Reversa</span></div>';
}
function viewPainel(){
  if(!VL.rows.length) return vazio();
  const rows = filtradas(true), rf = filtradas(false);
  const semPreco = rows.filter(r => !r.c && !r.m).length;
  const m = VL.meta || {};
  return filtrosBarra(false) +
    '<p class="vl-ref">Base de ' + (m.importadoEm ? fData(m.importadoEm.slice(0, 10)) : '—') + ' · hoje é ' + fData(hojeISO()) + ' · valor = quantidade × preço de custo (SIGEQ278)' +
    (semPreco ? ' · <b class="vl-warn">' + fInt(semPreco) + ' lotes sem preço</b> (valor zerado)' : '') + '</p>' +
    // Estoque e reversa nunca somados: cada área tem o seu bloco de números.
    AREAS.filter(a => !VL.f.area || VL.f.area === a[0]).map(a => {
      const ra = rows.filter(r => r.area === a[0]);
      return '<div class="vl-secao" style="--c:' + a[2] + '"><h2>' + a[1] + '</h2>' + cartaoArea(a[1], a[2], ra) + '<div class="vl-gap"></div>' + kpis(ra, a[1]) +
        '<div class="panel"><h3>' + a[1] + ' · valor por mês de vencimento</h3><div class="panel-sub">Passe o mouse nas colunas para ver o detalhe.</div>' + graficoMensal(ra, 170, a[2]) + '</div></div>';
    }).join('') +
    '<div class="' + (VL.f.area ? '' : 'two-col ') + 'vl-gap">' + AREAS.filter(a => !VL.f.area || VL.f.area === a[0]).map(a => '<div class="panel" style="border-top:3px solid ' + a[2] + '"><h3>' + a[1] + ' · fornecedores com maior valor em risco</h3><div class="panel-sub">Vencido + a vencer. Clique para filtrar.</div>' + topForn(rows.filter(r => r.area === a[0]), 8) + '</div>').join('') + '</div>' +
    '<div class="vl-gap"><div class="panel"><h3>Evolução do valor vencido · estoque × reversa</h3><div class="panel-sub">Um ponto por dia em que a QRY0390 foi importada.</div>' + graficoHist() + '</div></div>';
}
function tabelaForn(rows){
  const por = somar(rows, r => r.forn);
  por.forEach(o => { o.venc = o.f.venc || 0; });
  const ord = VL.sort.k === 'valor' ? 'valor' : 'venc';
  por.sort((a, b) => ((b[ord] || 0) - (a[ord] || 0)) * (VL.sort.d === -1 ? 1 : -1));
  const T = tot(rows);
  return '<div class="table-wrap"><table class="vl-tab"><thead><tr><th>Fornecedor</th><th class="n">Lotes</th><th class="n">Peças</th>' +
    VL.fx.map(f => '<th class="n"><i class="vl-dot" style="background:' + f.cor + '"></i>' + esc(f.nome) + '</th>').join('') + '<th class="n" onclick="vlOrd(\'valor\')">Total ↕</th><th class="n" onclick="vlOrd(\'venc\')">% vencido ↕</th></tr></thead><tbody>' +
    por.map(o => '<tr class="clicavel" onclick="vlVer(\'' + esc(o.k).replace(/'/g, '&#39;') + '\')"><td><b>' + esc(o.k) + '</b></td><td class="n">' + fInt(o.lotes) + '</td><td class="n">' + fInt(o.q) + '</td>' +
      VL.fx.map(f => '<td class="n">' + (o.f[f.k] ? fBRL(o.f[f.k]) : '<span class="vl-zero">—</span>') + '</td>').join('') + '<td class="n"><b>' + fBRL(o.valor) + '</b></td><td class="n">' + fPct(o.venc, o.valor) + '</td></tr>').join('') +
    '</tbody><tfoot><tr><td><b>Total</b></td><td class="n">' + fInt(T.lotes) + '</td><td class="n">' + fInt(T.q) + '</td>' + VL.fx.map(f => '<td class="n"><b>' + fBRL(rows.filter(r => r.faixa === f.k).reduce((a, r) => a + r.valor, 0)) + '</b></td>').join('') + '<td class="n"><b>' + fBRL(T.valor) + '</b></td><td></td></tr></tfoot></table></div>';
}
function viewFornecedores(){
  if(!VL.rows.length) return vazio();
  const rows = filtradas(true);
  return filtrosBarra(false) + AREAS.filter(a => !VL.f.area || VL.f.area === a[0]).map(a => '<div class="vl-secao" style="--c:' + a[2] + '"><h2>' + a[1] + '</h2>' + tabelaForn(rows.filter(r => r.area === a[0])) + '</div>').join('') +
    (rows.some(r => r.forn === 'A classificar') ? '<div class="callout callout-warn"><strong>Fornecedor a classificar</strong>Há itens sem marca reconhecida. ' + (somenteLeitura() ? '' : 'Ajuste em Configurações → Fornecedores.') + '</div>' : '');
}
function dadosMensal(rows){
  const m = {};
  rows.forEach(r => { const o = m[r.mes] = m[r.mes] || {ym: r.mes, E: 0, R: 0, qE: 0, qR: 0, lotes: 0}; o[r.area] += r.valor; o['q' + r.area] += r.q; o.lotes++; });
  return Object.values(m).sort((a, b) => a.ym.localeCompare(b.ym));
}
function viewMensal(){
  if(!VL.rows.length) return vazio();
  const rows = filtradas(true), hoje = hojeISO().slice(0, 7);
  return filtrosBarra(false) + AREAS.filter(a => !VL.f.area || VL.f.area === a[0]).map(a => {
    const ra = rows.filter(r => r.area === a[0]), ms = dadosMensal(ra), T = tot(ra);
    return '<div class="vl-secao" style="--c:' + a[2] + '"><h2>' + a[1] + '</h2><div class="panel"><h3>' + a[1] + ' · valor por mês de vencimento</h3>' + graficoMensal(ra, 210, a[2]) + '</div>' +
      '<div class="table-wrap vl-gap"><table class="vl-tab"><thead><tr><th>Mês</th><th>Situação</th><th class="n">Valor (R$)</th><th class="n">Peças</th><th class="n">Lotes</th></tr></thead><tbody>' +
      ms.map(m => '<tr><td><b>' + fMes(m.ym) + '</b></td><td>' + (m.ym < hoje ? '<span class="tag tag-bad">Vencido</span>' : m.ym === hoje ? '<span class="tag tag-orange">Mês atual</span>' : '<span class="tag tag-good">A vencer</span>') + '</td><td class="n"><b>' + fBRL(m[a[0]]) + '</b></td><td class="n">' + fInt(m['q' + a[0]]) + '</td><td class="n">' + fInt(m.lotes) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td><b>Total</b></td><td></td><td class="n"><b>' + fBRL(T.valor) + '</b></td><td class="n">' + fInt(T.q) + '</td><td class="n">' + fInt(T.lotes) + '</td></tr></tfoot></table></div></div>';
  }).join('');
}
const COLS = [['i', 'Item'], ['d', 'Descrição'], ['forn', 'Fornecedor'], ['l', 'Lote'], ['v', 'Validade'], ['dias', 'Dias'], ['faixa', 'Faixa'], ['area', 'Área'], ['lo', 'Endereço'], ['q', 'Qtd'], ['c', 'Custo un.'], ['valor', 'Valor']];
function viewItens(){
  if(!VL.rows.length) return vazio();
  const rows = filtradas(false).slice(), k = VL.sort.k, d = VL.sort.d;
  rows.sort((a, b) => (typeof a[k] === 'string' ? a[k].localeCompare(b[k], 'pt-BR') : (a[k] || 0) - (b[k] || 0)) * d);
  const POR = 100, pags = Math.max(1, Math.ceil(rows.length / POR)); VL.pag = Math.min(VL.pag, pags - 1);
  const fx = {}; VL.fx.forEach(f => { fx[f.k] = f; });
  return filtrosBarra(true) + '<div class="filter-bar"><input type="text" id="vlBusca" placeholder="Buscar item, descrição, lote ou fornecedor..." value="' + esc(VL.f.busca) + '" oninput="vlBusca(this.value)"><span class="vl-ref">' + fInt(rows.length) + ' lotes · ' + fBRL(tot(rows).valor) + '</span></div>' +
    '<div class="table-wrap"><table class="vl-tab"><thead><tr>' + COLS.map(c => '<th onclick="vlOrd(\'' + c[0] + '\')"' + (['q', 'c', 'valor', 'dias'].includes(c[0]) ? ' class="n"' : '') + '>' + c[1] + (VL.sort.k === c[0] ? (d === 1 ? ' ▲' : ' ▼') : '') + '</th>').join('') + '</tr></thead><tbody>' +
    rows.slice(VL.pag * POR, VL.pag * POR + POR).map(r => '<tr><td class="mono">' + esc(r.i) + '</td><td class="vl-desc">' + esc(r.d) + '</td><td>' + esc(r.forn) + '</td><td>' + esc(r.l) + '</td><td>' + fData(r.v) + '</td><td class="n">' + r.dias + '</td>' +
      '<td><span class="vl-pill" style="background:' + fx[r.faixa].cor + '">' + esc(fx[r.faixa].nome) + '</span></td><td>' + (r.area === 'R' ? 'Reversa' : 'Estoque') + '</td><td>' + esc(r.lo) + '</td><td class="n">' + fInt(r.q) + '</td>' +
      '<td class="n">' + (r.c ? fBRL2(r.c) : '<span class="vl-zero">' + (r.m ? 'múltiplo' : 'sem preço') + '</span>') + '</td><td class="n"><b>' + fBRL(r.valor) + '</b></td></tr>').join('') + '</tbody></table></div>' +
    (pags > 1 ? '<div class="vl-pag"><button class="btn btn-secondary" onclick="vlPag(-1)"' + (VL.pag === 0 ? ' disabled' : '') + '>←</button><span>Página ' + (VL.pag + 1) + ' de ' + pags + '</span><button class="btn btn-secondary" onclick="vlPag(1)"' + (VL.pag >= pags - 1 ? ' disabled' : '') + '>→</button></div>' : '');
}
function viewImportacao(){
  const m = VL.meta || {}, pm = m.preco, em = m.estrutura;
  const linha = (rot, ok, txt) => '<div class="vl-st ' + (ok ? 'ok' : '') + '"><b>' + rot + '</b><span>' + txt + '</span></div>';
  return '<div class="panel"><h3>Importar bases</h3><div class="panel-sub">Selecione os arquivos de uma vez (ou só os que mudaram) — o app reconhece cada um pelo cabeçalho. A 390 <b>substitui</b> a base anterior; a 278 e a 051 ficam guardadas neste navegador e valoram qualquer 390 nova.</div>' +
    '<label class="dropzone vl-drop" id="vlDrop"><div class="dz-icon">📥</div><div class="dz-title">Arraste ou clique para escolher</div><div class="dz-desc">QRY0390 · SIGEQ278 · ZBIQ0051 (.xlsx)</div>' +
    '<input type="file" id="vlArq" accept=".xlsx,.xls" multiple hidden onchange="importar(Array.from(this.files)); this.value=\'\'"></label>' +
    '<div class="vl-msg" id="vlMsg">' + (VL.ocupado ? '⏳ ' + esc(VL.msg) : '') + '</div></div>' +
    '<div class="panel vl-gap"><h3>Situação das bases</h3>' +
    linha('QRY0390 · estoque', !!m.arquivo390, m.arquivo390 ? esc(m.arquivo390) + ' · ' + fInt(m.linhas390) + ' linhas · <b>' + fInt(VL.rows.length) + ' lotes com validade</b> · ' + fData((m.importadoEm || '').slice(0, 10)) + (m.por ? ' por ' + esc(m.por) : '') : 'Não importada.') +
    linha('SIGEQ278 · preço', !!(pm || VL.rows.some(r => r.c)), pm ? esc(pm.nome) + ' · ' + fInt(pm.n) + ' itens com preço · ' + fData(pm.em.slice(0, 10)) : 'Nenhuma 278 neste navegador. Sem ela o valor fica zerado.') +
    linha('ZBIQ0051 · múltiplos', !!em, em ? esc(em.nome) + ' · ' + fInt(em.n) + ' componentes · ' + fData(em.em.slice(0, 10)) : 'Nenhuma 051 neste navegador (opcional).') + '</div>' +
    '<div class="panel vl-gap"><h3>Como o valor é calculado</h3><div class="vl-regras"><p><b>Estoque</b> = classes de local fora da reversa. <b>Reversa</b> = classes ' + esc(VL.cfg.reversa.join(', ')) + '.</p>' +
    '<p><b>Valor</b> = quantidade × preço de custo da SIGEQ278.</p><p><b>Múltiplos (051):</b> o componente marcado <code>in_interface = S</code> carrega o preço do conjunto (pai); os demais componentes valem zero.</p>' +
    '<p><b>Só entram lotes com Data de Validade preenchida</b> na 390' + (m.wvSemData ? ' — ' + fInt(m.wvSemData) + ' linhas com restrição WV vieram sem data e ficaram de fora' : '') + '.</p></div></div>';
}
function viewConfig(){
  const marcas = somar(VL.rows, r => r.marca).sort((a, b) => b.valor - a.valor);
  return '<div class="panel"><h3>Faixas de vencimento</h3><div class="panel-sub">Dias separados por vírgula. Exemplo: <code>30, 60, 90</code> gera: vencido · até 30 · 31–60 · 61–90 · acima de 90.</div>' +
    '<div class="filter-bar"><input type="text" id="cfgFaixas" value="' + esc(VL.cfg.faixas.join(', ')) + '"></div></div>' +
    '<div class="panel vl-gap"><h3>Classes de local da reversa</h3><div class="panel-sub">Separadas por vírgula (coluna Classe Local da 390). Tudo que não estiver aqui conta como estoque.</div>' +
    '<div class="filter-bar"><input type="text" id="cfgRev" value="' + esc(VL.cfg.reversa.join(', ')) + '"></div></div>' +
    '<div class="panel vl-gap"><h3>Fornecedores</h3><div class="panel-sub">A marca é lida da descrição do item. Digite o nome do fornecedor para corrigir ou agrupar marcas (ex.: <code>VOND</code> → <code>VONDER</code>). Em branco = usa a própria marca.</div>' +
    '<div class="table-wrap" style="max-height:420px;overflow:auto"><table class="vl-tab"><thead><tr><th>Marca na descrição</th><th class="n">Lotes</th><th class="n">Valor</th><th>Fornecedor</th></tr></thead><tbody>' +
    marcas.map(o => '<tr><td>' + esc(o.k) + '</td><td class="n">' + fInt(o.lotes) + '</td><td class="n">' + fBRL(o.valor) + '</td><td><input type="text" class="vl-forn" data-m="' + esc(o.k) + '" value="' + esc(VL.cfg.forn[o.k] || '') + '" placeholder="' + esc(o.k === 'SEM MARCA' ? 'A classificar' : o.k) + '"></td></tr>').join('') + '</tbody></table></div></div>' +
    '<div class="vl-gap"><button class="btn btn-orange" onclick="vlSalvarCfg()">Salvar configurações</button></div>';
}
function vlSalvarCfg(){
  const f = String(document.getElementById('cfgFaixas').value).split(/[,;\s]+/).map(Number).filter(n => n > 0 && isFinite(n));
  if(!f.length) return toast('Informe pelo menos uma faixa em dias.', true);
  VL.cfg.faixas = Array.from(new Set(f)).sort((a, b) => a - b).slice(0, 5);
  VL.cfg.reversa = String(document.getElementById('cfgRev').value).toUpperCase().split(/[,;\s]+/).filter(Boolean);
  const forn = {}; document.querySelectorAll('.vl-forn').forEach(i => { const v = i.value.trim(); if(v) forn[i.dataset.m] = v; });
  VL.cfg.forn = forn;
  salvarCfg().then(renderView);
}

/* ---------- navegação / estado ---------- */
const VIEWS = {painel: viewPainel, fornecedores: viewFornecedores, mensal: viewMensal, itens: viewItens, importacao: viewImportacao, configuracoes: viewConfig};
function renderMsg(){ const el = document.getElementById('vlMsg'); if(el) el.textContent = VL.ocupado ? '⏳ ' + VL.msg : ''; }
function renderView(){
  if(VL.erro && !VL.rows.length && VL.tab !== 'importacao' && VL.tab !== 'configuracoes'){ document.getElementById('viewRoot').innerHTML = vazio(); return; }
  if(somenteLeitura() && (VL.tab === 'importacao' || VL.tab === 'configuracoes')) VL.tab = 'painel';
  const el = document.getElementById('viewRoot'); if(!el) return;
  const y = document.querySelector('.page-scroll') ? document.querySelector('.page-scroll').scrollTop : 0;
  el.innerHTML = VIEWS[VL.tab]();
  const t = VL_TITULOS[VL.tab];
  document.getElementById('tabTitle').textContent = t[0]; document.getElementById('tabSubtitle').textContent = t[1];
  document.querySelectorAll('.nav-item[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === VL.tab));
  const drop = document.getElementById('vlDrop');
  if(drop){
    ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('has-file'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('has-file'); }));
    drop.addEventListener('drop', e => importar(Array.from(e.dataTransfer.files)));
  }
  if(document.querySelector('.page-scroll')) document.querySelector('.page-scroll').scrollTop = y;
}
function vlTab(t){ VL.tab = t; VL.pag = 0; if(t === 'itens' && VL.sort.k === 'k') VL.sort = {k: 'valor', d: -1}; renderView(); vlCloseSidebarMobile(); }
function vlSet(k, v){ VL.f[k] = v; VL.pag = 0; renderView(); }
function vlLimpar(){ VL.f = {area: '', forn: '', busca: '', faixa: ''}; VL.pag = 0; renderView(); }
function vlVer(forn){ VL.f.forn = forn; VL.tab = 'itens'; VL.sort = {k: 'valor', d: -1}; VL.pag = 0; renderView(); }
function vlOrd(k){ VL.sort = {k, d: VL.sort.k === k ? -VL.sort.d : (['i', 'd', 'forn', 'l', 'area', 'lo', 'faixa'].includes(k) ? 1 : -1)}; renderView(); }
function vlPag(n){ VL.pag += n; renderView(); }
let _vlBT; function vlBusca(v){ VL.f.busca = v; VL.pag = 0; clearTimeout(_vlBT); _vlBT = setTimeout(() => { renderView(); const i = document.getElementById('vlBusca'); if(i){ i.focus(); i.setSelectionRange(v.length, v.length); } }, 250); }
function vlToggleSidebar(){ const el = document.getElementById('sidebar'); if(matchMedia('(max-width:860px)').matches) el.classList.toggle('mobile-open'); else el.classList.toggle('collapsed'); }
function vlCloseSidebarMobile(){ if(matchMedia('(max-width:860px)').matches) document.getElementById('sidebar').classList.remove('mobile-open'); }
function vlToggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const n = cur === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', n);
  try { localStorage.setItem('vl-theme', n); } catch(e){}
}
window.vlAplicarNivel = () => renderView();

/* ---------- exportar Excel ---------- */
function vlExportar(){
  if(!VL.rows.length) return toast('Nada para exportar: importe a base primeiro.', true);
  const rows = filtradas(true), fx = VL.fx, X = XLSX;
  const filtroTxt = [VL.f.area ? (VL.f.area === 'E' ? 'Só estoque' : 'Só reversa') : 'Estoque + Reversa', VL.f.forn || 'Todos os fornecedores'].join(' · ');
  const wb = X.utils.book_new();
  const resumo = [['Controle de Validade — CD Cajamar'], ['Data do relatório', fData(hojeISO())], ['Base importada em', VL.meta && VL.meta.importadoEm ? fData(VL.meta.importadoEm.slice(0, 10)) : ''], ['Filtro', filtroTxt], [],
    ['Área', 'Faixa', 'Lotes', 'Peças', 'Valor (R$)']];
  [['E', 'Estoque'], ['R', 'Reversa']].forEach(([a, nome]) => {
    fx.forEach(f => { const t = tot(rows.filter(r => r.area === a && r.faixa === f.k)); resumo.push([nome, f.nome, t.lotes, t.q, +t.valor.toFixed(2)]); });
    const t = tot(rows.filter(r => r.area === a)); resumo.push([nome, 'TOTAL', t.lotes, t.q, +t.valor.toFixed(2)]);
  });
  const T = tot(rows); resumo.push(['Geral', 'TOTAL', T.lotes, T.q, +T.valor.toFixed(2)]);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(resumo), 'Resumo');
  const forn = [['Área', 'Fornecedor', 'Lotes', 'Peças'].concat(fx.map(f => f.nome + ' (R$)'), ['Total (R$)', '% vencido'])];
  AREAS.forEach(a => somar(rows.filter(r => r.area === a[0]), r => r.forn).sort((x, y) => y.valor - x.valor).forEach(o => forn.push([a[1], o.k, o.lotes, o.q].concat(fx.map(f => +(o.f[f.k] || 0).toFixed(2)), [+o.valor.toFixed(2), o.valor ? +((o.f.venc || 0) / o.valor).toFixed(4) : 0]))));
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(forn), 'Fornecedores');
  const mes = [['Área', 'Mês', 'Situação', 'Valor (R$)', 'Peças', 'Lotes']], hoje = hojeISO().slice(0, 7);
  AREAS.forEach(a => dadosMensal(rows.filter(r => r.area === a[0])).forEach(m => mes.push([a[1], fMes(m.ym), m.ym < hoje ? 'Vencido' : m.ym === hoje ? 'Mês atual' : 'A vencer', +m[a[0]].toFixed(2), m['q' + a[0]], m.lotes])));
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(mes), 'Mensal');
  const nm = {}; fx.forEach(f => { nm[f.k] = f.nome; });
  const it = [['Item', 'Descrição', 'Fornecedor', 'Marca', 'Lote', 'Validade', 'Dias p/ vencer', 'Faixa', 'Área', 'Classe local', 'Endereço', 'Restrição', 'Quantidade', 'Custo unitário (R$)', 'Valor (R$)', 'Obs.']];
  rows.slice().sort((a, b) => a.dias - b.dias).forEach(r => it.push([+r.i || r.i, r.d, r.forn, r.marca, r.l, fData(r.v), r.dias, nm[r.faixa], r.area === 'R' ? 'Reversa' : 'Estoque', r.cl, r.lo, r.r, r.q, +(r.c || 0).toFixed(4), +r.valor.toFixed(2), r.m ? 'Componente de múltiplo' : (!r.c ? 'Sem preço' : '')]));
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(it), 'Itens');
  X.writeFile(wb, 'Controle_de_Validade_' + hojeISO() + '.xlsx');
  toast('Planilha exportada.');
}

/* ---------- tooltip ---------- */
document.addEventListener('mouseover', e => {
  const t = document.getElementById('vlTip'), el = e.target.closest && e.target.closest('[data-tip]');
  if(!t) return;
  if(!el){ t.classList.add('hidden'); return; }
  t.textContent = el.getAttribute('data-tip'); t.classList.remove('hidden');
});
document.addEventListener('mousemove', e => { const t = document.getElementById('vlTip'); if(t && !t.classList.contains('hidden')){ t.style.left = (e.clientX + 14) + 'px'; t.style.top = (e.clientY + 14) + 'px'; } });

/* ---------- início (chamado por acesso.js depois do login) ---------- */
async function vlInit(){
  try { const t = localStorage.getItem('vl-theme'); if(t) document.documentElement.setAttribute('data-theme', t); } catch(e){}
  const v = document.getElementById('sidebarVersao'); if(v && window.LDM_BUILD) v.textContent = 'v ' + (window.LDM_BUILD.commit || '');
  renderView();
  await carregar();
  VL.carregando = false;
  renderView();
}
