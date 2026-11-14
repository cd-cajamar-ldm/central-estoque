/* ============================================================
   Controle de Validade — vencidos e próximos do vencimento.
   Bases: QRY0390 (estoque, com Data de Validade), SIGEQ278 (preço de custo
   p/ valorar) e ZBIQ0051 (múltiplos: qual componente carrega valor).
   Dados compartilhados em public.vl_dados (migração 007).
   ============================================================ */
const VL_VERSAO = 9; // subir a cada alteração (aparece no rodapé do menu; trocar também o ?v= no index.html e o CACHE_VERSION do sw.js)
const VL_TAB = 'vl_dados';
/* Cores da marca (azul #001A72 e laranja #FE5000): vermelho -> laranja -> âmbar -> azuis.
   Quanto mais perto de vencer, mais quente. */
const VL_CORES_PROX = ['#FE5000', '#F59E0B', '#7184C4', '#4B5FA8', '#33488E'];
const VL_COR_VENC = '#C83812', VL_COR_OK = '#001A72', VL_COR_E = '#001A72', VL_COR_R = '#0E7490';
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
  'AUTOSHINE GRAZIA HENKEL JEFLUB GALZER KOUBE BALMER TOYAMA GEDORE SUALL CHEMICOLOR MIRAX TIREBOR NOVE54 KLYO TBCC GT2000 MILITEC JAÇA RENKO').split(' ');
/* Trechos da descrição que identificam o fornecedor mesmo sem a marca isolada. */
const VL_FRASES = [['MAXI RUBBER', 'MAXI RUBBER'], ['LIMPZ AUTO', 'LIMPZ AUTO'], ['SUAL PISCINAS', 'SUALL'], ['MAZA', 'MAZA'],
  ['NOVE 54', 'NOVE54'], ['CAMISETA PRETA MALHA PV LOGO', 'CAMISAS LDM'], ['PROTEG LUB', 'PROTEG LUB'], ['BIO QUIMICA', 'BIO QUIMICA'], ['STP-', 'STP'], ['SUAVITE', 'RENKO']];
/* Última palavra que é abreviação de marca ("... AMARELA VD" = Vonder, "... PRATA 954" = Nove54). */
const VL_SUFIXO = {VD: 'VONDER', '954': 'NOVE54'};
/* Prefixo do código de barras (empresa dona do EAN) -> fornecedor. Levantado na
   própria QRY0390: itens sem marca na descrição que dividem o prefixo com
   centenas de itens de marca conhecida. Só vale quando a descrição não resolve. */
const VL_EAN = [['7893946', 'VONDER'], ['7898507096', 'ONYX'], ['7899228', 'MAZA'], ['7894120170', 'AMAZONAS'], ['78985510', 'RENKO'], ['7899674', 'TECBRIL']];
const VL_ALIAS = {VOND: 'VONDER', 'RUST OLEUM': 'RUST-OLEUM'};
const VL_NOISE = new Set(['AUTO', 'BLISTER', 'QUIMICA', 'RUBBER', 'PISCINAS', 'UNIDADE', 'KIT', 'PRETO', 'BRANCO', 'AZUL', 'CINZA', 'VERMELHO', 'PRETA']);

const VL = {
  rows: [], meta: null, hist: [],
  cfg: {faixas: [30, 60, 90], reversa: ['REV', 'AVA'], forn: {}},
  tab: 'painel', f: {area: '', forn: '', busca: '', faixa: '', de: '', ate: ''}, sort: {k: 'valor', d: -1}, pag: 0,
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
/* Valor curto pros gráficos: 682 · 4,9 mil · 1,2 mi (o valor exato fica no tooltip). */
const fK = n => { n = n || 0; const a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toLocaleString('pt-BR', {maximumFractionDigits: 1}) + ' mi' : a >= 1e3 ? (n / 1e3).toLocaleString('pt-BR', {maximumFractionDigits: a >= 1e4 ? 0 : 1}) + ' mil' : Math.round(n).toLocaleString('pt-BR'); };
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
function marcaDe(desc, ean){
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
  if(VL_SUFIXO[l]) return VL_SUFIXO[l];
  const e = String(ean || '');
  for(const [pre, m] of VL_EAN) if(e.indexOf(pre) === 0) return m;
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
    r.marca = marcaDe(r.d, r.e); r.forn = fornDe(r.marca);
    r.loc = (r.lo.split(/\s+/)[0] || r.cl || '—').toUpperCase(); // 1ª parte do endereço: TRI, MZP, GAI...
    r.dias = diasAte(r.v); r.faixa = faixaDe(r.dias, fx).k;
    r.valor = r.q * (r.c || 0);
    r.mes = r.v.slice(0, 7);
  });
}
function filtradas(ignorarFaixa){
  const b = VL.f.busca.trim().toLowerCase();
  return VL.rows.filter(r => (!VL.f.area || r.area === VL.f.area) && (!VL.f.forn || r.forn === VL.f.forn) && (!VL.f.de || r.mes >= VL.f.de) && (!VL.f.ate || r.mes <= VL.f.ate) &&
    (ignorarFaixa || !VL.f.faixa || r.faixa === VL.f.faixa) &&
    (!b || r.i.indexOf(b) >= 0 || r.d.toLowerCase().indexOf(b) >= 0 || r.l.toLowerCase().indexOf(b) >= 0 || r.forn.toLowerCase().indexOf(b) >= 0));
}
function somar(rows, chaveFn){
  const m = new Map();
  rows.forEach(r => {
    const k = chaveFn(r); let o = m.get(k);
    if(!o){ o = {k, valor: 0, q: 0, lotes: 0, f: {}, fq: {}, fi: {}, its: new Set()}; m.set(k, o); }
    o.valor += r.valor; o.q += r.q; o.lotes++; o.its.add(r.i);
    o.f[r.faixa] = (o.f[r.faixa] || 0) + r.valor; o.fq[r.faixa] = (o.fq[r.faixa] || 0) + r.q;
    (o.fi[r.faixa] = o.fi[r.faixa] || new Set()).add(r.i);
  });
  const out = Array.from(m.values()); out.forEach(o => { o.itens = o.its.size; }); return out;
}
const tot = rows => { const its = new Set(); const t = rows.reduce((a, r) => { a.valor += r.valor; a.q += r.q; a.lotes++; its.add(r.i); return a; }, {valor: 0, q: 0, lotes: 0}); t.itens = its.size; return t; };
/* Validade improvável (ex.: 30/03/2080, 30/01/3030): erro de cadastro na 390. Continua
   na conta (é o que o sistema diz), mas é sinalizada no painel e na planilha. */
const suspeita = r => r.dias > 13 * 365 || r.dias < -10 * 365;

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
const CAMPOS = ['i', 'd', 'l', 'v', 'lo', 'cl', 'r', 'q', 'c', 'm', 'e', 'qr'];
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
    const w = new Worker('js/worker.js?v=' + VL_VERSAO);
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
/* Linhas da 390 que ficam fora da conta por não ter data — valoradas aqui pra
   aparecer no painel como inconsistência (não somam nos números de validade). */
function qualidade(n, precos){
  const val = l => l.q * (precos[l.i] || 0);
  const wv = (n.wv || []).map(l => Object.assign({}, l, {valor: val(l)}));
  const sd = (n.semData || []).map(l => Object.assign({}, l, {valor: val(l)}));
  const soma = ls => ({linhas: ls.reduce((a, l) => a + (l.n || 1), 0), itens: new Set(ls.map(l => l.i)).size, q: ls.reduce((a, l) => a + l.q, 0), valor: ls.reduce((a, l) => a + l.valor, 0)});
  return {wv: Object.assign(soma(wv), {lista: wv}), semData: Object.assign(soma(sd), {lista: sd})};
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
      qual: novas ? qualidade(novas, precos) : antigo.qual,
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
  return '<div class="vl-anel"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="' + r + '" fill="none" stroke="var(--surface2)" stroke-width="11"/>' +
    '<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="' + cor + '" stroke-width="11" stroke-linecap="' + (p > 0.004 ? 'round' : 'butt') + '" stroke-dasharray="' + (c * p) + ' ' + c + '" transform="rotate(-90 50 50)"/></svg>' +
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
function mesesOpt(sel){ return Array.from(new Set(VL.rows.map(r => r.mes))).sort().map(m => '<option value="' + m + '"' + (m === sel ? ' selected' : '') + '>' + fMes(m) + '</option>').join(''); }
function filtrosBarra(comFaixa){
  const forns = Array.from(new Set(VL.rows.map(r => r.forn))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const chip = (v, t) => '<button class="chip' + (VL.f.area === v ? ' active' : '') + '" onclick="vlSet(\'area\',\'' + v + '\')">' + t + '</button>';
  return '<div class="filter-bar vl-filtros"><div class="vl-chips">' + chip('', 'Estoque + Reversa') + chip('E', 'Só estoque') + chip('R', 'Só reversa') + '</div>' +
    '<select onchange="vlSet(\'forn\',this.value)"><option value="">Todos os fornecedores</option>' + forns.map(f => '<option' + (f === VL.f.forn ? ' selected' : '') + '>' + esc(f) + '</option>').join('') + '</select>' +
    (comFaixa ? '<select onchange="vlSet(\'faixa\',this.value)"><option value="">Todas as faixas</option>' + VL.fx.map(f => '<option value="' + f.k + '"' + (f.k === VL.f.faixa ? ' selected' : '') + '>' + esc(f.nome) + '</option>').join('') + '</select>' : '') +
    '<label class="vl-per">Vence de <select onchange="vlSet(\'de\',this.value)"><option value="">início</option>' + mesesOpt(VL.f.de) + '</select> até <select onchange="vlSet(\'ate\',this.value)"><option value="">fim</option>' + mesesOpt(VL.f.ate) + '</select></label>' +
    (VL.f.area || VL.f.forn || VL.f.faixa || VL.f.de || VL.f.ate ? '<button class="btn btn-secondary" onclick="vlLimpar()">Limpar filtros</button>' : '') + '</div>';
}
function vazio(){
  if(VL.carregando) return '<p class="field-hint">Carregando...</p>';
  if(VL.erro) return '<div class="panel callout-warn callout"><strong>Atenção</strong>' + esc(VL.erro) + '</div>';
  return '<div class="empty-state panel"><div class="eicon">📅</div><h3>Nenhuma base importada ainda</h3><p>Importe a QRY0390 (estoque com Data de Validade), a SIGEQ278 (preço) e a ZBIQ0051 (múltiplos).</p>' +
    (somenteLeitura() ? '' : '<button class="btn btn-orange" onclick="vlTab(\'importacao\')">Ir para Importação</button>') + '</div>';
}
const AREAS = [['E', 'Estoque', VL_COR_E], ['R', 'Reversa', VL_COR_R]];
const AREA_TXT = {E: 'do estoque', R: 'da reversa'};
const n3 = (b, l) => '<div><b>' + b + '</b><span>' + l + '</span></div>';
/* Faixas de vencimento: item (SKU) em destaque, depois peças e valor; lote fica no rodapé do cartão. */
function faixasTiles(rows, a){
  const T = tot(rows), por = {}; somar(rows, r => r.faixa).forEach(o => { por[o.k] = o; });
  return '<div class="vl-faixas">' + VL.fx.map(f => {
    const o = por[f.k] || {valor: 0, q: 0, lotes: 0, itens: 0}, pc = T.valor ? o.valor / T.valor : 0;
    return '<div class="vl-ft" style="--c:' + f.cor + '" onclick="vlFaixa(\'' + a[0] + '\',\'' + f.k + '\')"' + tip(f.nome + ' — ' + a[1] + '\n' + fInt(o.itens) + ' itens · ' + fInt(o.q) + ' peças · ' + fInt(o.lotes) + ' lotes\nValor de custo: ' + fBRL2(o.valor) + '\n' + fPct(o.valor, T.valor) + ' do valor de custo ' + AREA_TXT[a[0]] + '\nClique para ver os itens') + '>' +
      '<div class="vl-ft-h">' + esc(f.nome) + '</div>' +
      '<div class="vl-ft-big">' + fInt(o.itens) + '<small>' + (o.itens === 1 ? 'item' : 'itens') + '</small></div>' +
      '<div class="vl-ft-l"><span>Peças</span><b>' + fInt(o.q) + '</b></div>' +
      '<div class="vl-ft-l"><span>Valor de custo</span><b>' + fBRL(o.valor) + '</b></div>' +
      '<div class="vl-ft-bar"><i style="width:' + Math.max(pc * 100, o.valor ? 1.5 : 0) + '%"></i></div>' +
      '<div class="vl-ft-p"><b>' + fPct(o.valor, T.valor) + '</b> do valor ' + AREA_TXT[a[0]] + ' · ' + fInt(o.lotes) + ' lotes</div></div>';
  }).join('') + '</div>';
}
function blocoVencido(rows, a){
  const T = tot(rows), V = tot(rows.filter(r => r.faixa === 'venc'));
  const lim = Math.max.apply(null, VL.cfg.faixas), P = tot(rows.filter(r => r.dias >= 0 && r.dias <= lim));
  return '<div class="panel vl-card"><div class="vl-card-h"><h3>Quanto ' + AREA_TXT[a[0]] + ' já venceu?</h3><p>Percentual do <b>valor de custo</b> dos itens com validade ' + AREA_TXT[a[0]] + ' que já passou da data.</p></div>' +
    '<div class="vl-venc">' + anel(T.valor ? V.valor / T.valor : 0, VL_COR_VENC, fPct(V.valor, T.valor), 'do valor vencido') +
    '<div class="vl-venc-txt"><p class="vl-frase"><b>' + fBRL(V.valor) + '</b> vencidos de <b>' + fBRL(T.valor) + '</b> em valor de custo com validade.</p>' +
    '<div class="vl-n3">' + n3(fInt(V.itens) + ' <em>de ' + fInt(T.itens) + '</em>', 'itens vencidos') + n3(fInt(V.q) + ' <em>de ' + fInt(T.q) + '</em>', 'peças vencidas') + n3(fPct(V.q, T.q), 'das peças') + '</div>' +
    '<div class="vl-prox"><span>Vencem nos próximos ' + lim + ' dias</span><b>' + fInt(P.itens) + ' itens · ' + fInt(P.q) + ' peças · ' + fBRL(P.valor) + '</b></div></div></div></div>';
}
/* Acumulado: o vencido soma do mais antigo até o mês passado; o a vencer soma do
   mês atual pra frente. Assim cada mês mostra "quanto já venceu até aqui" ou
   "quanto vence até aqui". */
function mesesArea(rows){
  const por = {}, hoje = hojeISO().slice(0, 7);
  rows.forEach(r => {
    const o = por[r.mes] = por[r.mes] || {ym: r.mes, v: 0, q: 0, lotes: 0, loc: {}, its: new Set()};
    o.v += r.valor; o.q += r.q; o.lotes++; o.its.add(r.i); o.loc[r.loc] = (o.loc[r.loc] || 0) + r.valor;
    if(r.dias < 0) o.jaVenc = (o.jaVenc || 0) + r.valor;
  });
  const ms = Object.values(por).sort((a, b) => a.ym.localeCompare(b.ym));
  let aV = 0, aF = 0;
  // No mês atual, o que já passou da data conta como vencido (bate com os cartões, que são por dia).
  ms.forEach(m => {
    m.passado = m.ym < hoje;
    if(m.passado){ aV += m.v; m.acc = aV; }
    else { const ja = m.ym === hoje ? (m.jaVenc || 0) : 0; aV += ja; aF += m.v - ja; m.acc = aF; m.jaNoMes = ja; }
  });
  return {ms, vencido: aV, aVencer: aF};
}
function tipMes(m){ // título do mês, número do mês, acumulado e onde está
  const locs = Object.entries(m.loc).sort((a, b) => b[1] - a[1]);
  const linhas = locs.slice(0, 8).map(l => l[0] + ': ' + fBRL(l[1]));
  if(locs.length > 8) linhas.push('Outros ' + (locs.length - 8) + ' locais: ' + fBRL(locs.slice(8).reduce((a, l) => a + l[1], 0)));
  return fMes(m.ym) + (m.passado ? ' · VENCIDO' : ' · a vencer') + '\nNo mês: ' + fInt(m.its.size) + ' itens · ' + fInt(m.q) + ' peças · ' + fBRL(m.v) + '\n' + (m.jaNoMes ? 'Já vencido neste mês: ' + fBRL(m.jaNoMes) + '\n' : '') +
    (m.passado ? 'Vencido acumulado até aqui: ' : 'A vencer acumulado até aqui: ') + fBRL(m.acc) + '\n— Onde está —\n' + linhas.join('\n');
}
function graficoMensal(rows, alt, cor){ // uma área por gráfico: estoque e reversa nunca na mesma coluna
  const A = mesesArea(rows), todos = A.ms;
  if(!todos.length) return '<p class="field-hint">Sem dados.</p>';
  // Janela de 12 meses pra trás e 12 pra frente: o que fica fora vira um resumo,
  // senão um mês distante com muito valor achata todas as colunas.
  const desl = n => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const ini = desl(-12), fim = desl(12);
  const meses = todos.filter(m => m.ym >= ini && m.ym <= fim);
  const antes = todos.filter(m => m.ym < ini).reduce((a, m) => a + m.v, 0), depois = todos.filter(m => m.ym > fim).reduce((a, m) => a + m.v, 0);
  const fora = '<div class="vl-fora"><span class="venc">Total vencido: <b>' + fBRL(A.vencido) + '</b></span><span>Total a vencer: <b>' + fBRL(A.aVencer) + '</b></span>' +
    (antes ? '<span class="venc">antes de ' + fMes(ini) + ': ' + fBRL(antes) + '</span>' : '') + (depois ? '<span>depois de ' + fMes(fim) + ': ' + fBRL(depois) + '</span>' : '') + '</div>';
  if(!meses.length) return fora;
  const max = Math.max.apply(null, meses.map(m => m.v)) || 1;
  return fora + '<div class="vl-mensal" style="height:' + alt + 'px">' + meses.map(m =>
    '<div class="vl-col' + (m.passado ? ' passado' : '') + '"' + tip(tipMes(m)) + '>' +
      '<span class="vl-col-v">' + (m.v ? fK(m.v) : '') + '</span>' +
      '<div class="vl-col-b" style="height:' + (m.v / max * 100) + '%;background:' + (m.passado ? VL_COR_VENC : cor) + '"></div>' +
      '<span class="vl-col-l">' + fMes(m.ym) + '</span><span class="vl-col-a">' + fK(m.acc) + '</span></div>'
  ).join('') + '</div><div class="vl-leg"><span><i style="background:' + VL_COR_VENC + '"></i>Mês que já venceu</span><span><i style="background:' + cor + '"></i>Mês a vencer</span><span><i class="vl-leg-acc"></i>Acumulado (embaixo do mês)</span><span>Valores em R$ de custo · mil = milhares</span></div>';
}
function topForn(rows, n){
  const lim = Math.max.apply(null, VL.cfg.faixas);
  const m = new Map();
  rows.filter(r => r.dias <= lim).forEach(r => {
    let o = m.get(r.forn); if(!o){ o = {k: r.forn, venc: 0, prox: 0, q: 0, its: new Set()}; m.set(r.forn, o); }
    if(r.dias < 0) o.venc += r.valor; else o.prox += r.valor; o.q += r.q; o.its.add(r.i);
  });
  const por = Array.from(m.values()).sort((a, b) => (b.venc + b.prox) - (a.venc + a.prox)).slice(0, n);
  if(!por.length) return '<p class="field-hint">Nenhum item vencido ou vencendo em até ' + lim + ' dias.</p>';
  const max = por[0].venc + por[0].prox || 1;
  return '<div class="vl-hbars">' + por.map(o => '<div class="vl-hrow" onclick="vlSet(\'forn\',\'' + esc(o.k).replace(/'/g, '&#39;') + '\')"' + tip(o.k + '\nVencido: ' + fBRL2(o.venc) + '\nVence em até ' + lim + ' dias: ' + fBRL2(o.prox) + '\n' + fInt(o.its.size) + ' itens · ' + fInt(o.q) + ' peças') + '>' +
    '<div class="vl-hl"><b>' + esc(o.k) + '</b><span>' + fInt(o.its.size) + ' itens · ' + fInt(o.q) + ' peças</span></div><div class="vl-ht"><i style="width:' + (o.venc / max * 100) + '%;background:' + VL_COR_VENC + '"></i><i style="width:' + (o.prox / max * 100) + '%;background:' + VL_CORES_PROX[0] + '"></i></div>' +
    '<span class="vl-hv">' + fBRL(o.venc + o.prox) + '</span></div>').join('') + '</div>' +
    '<div class="vl-leg"><span><i style="background:' + VL_COR_VENC + '"></i>Vencido</span><span><i style="background:' + VL_CORES_PROX[0] + '"></i>Vence em até ' + lim + ' dias</span></div>';
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
function hero(){
  const m = VL.meta || {};
  const per = VL.f.de || VL.f.ate ? 'Vencimento de ' + (VL.f.de ? fMes(VL.f.de) : 'início') + ' até ' + (VL.f.ate ? fMes(VL.f.ate) : 'fim') : '';
  return '<div class="vl-hero"><div><span class="vl-hero-tag">Controle de Validade · CD Cajamar</span><h2>Vencidos e a vencer — estoque e reversa</h2>' +
    '<p>Base QRY0390 de <b>' + (m.importadoEm ? fData(m.importadoEm.slice(0, 10)) : '—') + '</b> · situação em <b>' + fData(hojeISO()) + '</b> · valor = quantidade × preço de custo (SIGEQ278)' +
    (VL.f.forn ? ' · fornecedor <b>' + esc(VL.f.forn) + '</b>' : '') + (per ? ' · <b>' + per + '</b>' : '') + '</p></div></div>';
}
function secaoArea(a, ra){
  const T = tot(ra), desc = a[0] === 'E' ? 'Itens em locais de estoque (classes fora de ' + esc(VL.cfg.reversa.join(', ')) + ').' : 'Itens em locais da reversa (classes ' + esc(VL.cfg.reversa.join(', ')) + ').';
  return '<section class="vl-sec" style="--c:' + a[2] + '"><header class="vl-sec-h"><div><h2>' + a[1] + '</h2><p>' + desc + '</p></div>' +
    '<div class="vl-sec-tot">' + n3(fInt(T.itens), 'itens com validade') + n3(fInt(T.q), 'peças') + n3(fBRLc(T.valor), 'valor de custo') + n3(fInt(T.lotes), 'lotes') + '</div></header>' +
    '<h4 class="vl-tit">Itens por faixa de vencimento <span>Um item com lotes de datas diferentes aparece em mais de uma faixa · clique numa faixa para ver a lista</span></h4>' + faixasTiles(ra, a) +
    '<div class="vl-row2">' + blocoVencido(ra, a) +
    '<div class="panel vl-card"><div class="vl-card-h"><h3>Fornecedores com mais valor em risco</h3><p>Vencido + vence em até ' + Math.max.apply(null, VL.cfg.faixas) + ' dias, em valor de custo. Clique para filtrar.</p></div>' + topForn(ra, 8) + '</div></div>' +
    '<div class="panel vl-card"><div class="vl-card-h"><h3>Valor de custo por mês de vencimento</h3><p>Quanto vence em cada mês. Embaixo de cada mês, o acumulado. Passe o mouse para ver itens, peças e em quais locais está.</p></div>' + graficoMensal(ra, 200, a[2]) + '</div></section>';
}
function painelQualidade(rows){
  const q = (VL.meta || {}).qual, sus = rows.filter(suspeita), rom = rows.filter(r => r.qr > 0);
  const S = tot(sus), Rm = rom.reduce((a, r) => a + (r.qr || 0), 0);
  const li = (cor, tit, txt) => '<li style="--c:' + cor + '"><b>' + tit + '</b><span>' + txt + '</span></li>';
  return '<div class="panel vl-card"><div class="vl-card-h"><h3>Qualidade da base · pontos de atenção</h3><p>Diferenças encontradas na própria QRY0390. Estão na aba "Inconsistências" do Excel.</p></div><ul class="vl-qual">' +
    (q ? li(VL_COR_VENC, 'Restrição WV (fora do prazo de validade) sem data', fInt(q.wv.itens) + ' itens · ' + fInt(q.wv.q) + ' peças · ' + fBRL(q.wv.valor) + ' — <b>não entram</b> nos números acima porque a 390 não traz a data.') +
      li(VL_CORES_PROX[1], 'Itens com parte do saldo sem data de validade', fInt(q.semData.itens) + ' itens · ' + fInt(q.semData.q) + ' peças · ' + fBRL(q.semData.valor) + ' em linhas sem data — também ficam de fora.')
      : li(VL_CORES_PROX[1], 'Saldo sem data de validade', 'Reimporte a QRY0390 para calcular o que ficou de fora por não ter data.')) +
    li(VL_CORES_PROX[2], 'Validade improvável (antes de ' + (+hojeISO().slice(0, 4) - 10) + ' ou depois de ' + (+hojeISO().slice(0, 4) + 13) + ')', fInt(S.itens) + ' itens · ' + fInt(S.q) + ' peças · ' + fBRL(S.valor) + ' (ex.: 30/03/2080). Contam como "acima de ' + Math.max.apply(null, VL.cfg.faixas) + ' dias" — provável erro de cadastro.') +
    (rows.some(r => 'qr' in r) ? li(VL_CORES_PROX[3], 'Peças já romaneadas (separadas para pedido)', fInt(rom.length) + ' lotes · ' + fInt(Rm) + ' peças. Estão incluídas no saldo.') : '') +
    '</ul></div>';
}
function rodapeExport(){
  return '<div class="vl-export"><div><b>Enviar este retrato</b><span>A planilha traz todos os números e listas; o HTML abre no navegador com o painel como está agora, com os filtros aplicados.</span></div>' +
    '<button class="btn btn-secondary" onclick="vlBaixarHTML()">⬇ Baixar HTML</button><button class="btn btn-orange" onclick="vlExportar()">⬇ Exportar Excel</button></div>';
}
function viewPainel(){
  if(!VL.rows.length) return vazio();
  const rows = filtradas(true);
  const semPreco = tot(rows.filter(r => !r.c && !r.m));
  // Estoque e reversa nunca somados: cada área tem a sua seção completa.
  return hero() + (VL.snap ? '' : filtrosBarra(false)) +
    (semPreco.lotes ? '<div class="callout callout-warn"><strong>Itens sem preço</strong>' + fInt(semPreco.itens) + ' itens (' + fInt(semPreco.q) + ' peças) não têm preço de custo na SIGEQ278 e entram com valor zero.</div>' : '') +
    AREAS.filter(a => !VL.f.area || VL.f.area === a[0]).map(a => secaoArea(a, rows.filter(r => r.area === a[0]))).join('') +
    '<div class="vl-row2">' + painelQualidade(rows) +
    '<div class="panel vl-card"><div class="vl-card-h"><h3>Evolução do valor vencido</h3><p>Valor de custo vencido em cada dia em que a QRY0390 foi importada.</p></div>' + graficoHist() + '</div></div>' +
    (VL.snap ? '' : rodapeExport());
}
function vlFaixa(area, faixa){ VL.f.area = area; VL.f.faixa = faixa; VL.tab = 'itens'; VL.sort = {k: 'dias', d: 1}; VL.pag = 0; renderView(); }
function tabelaForn(rows){
  const por = somar(rows, r => r.forn);
  por.forEach(o => { o.venc = o.f.venc || 0; });
  const ord = VL.sort.k === 'valor' ? 'valor' : 'venc';
  por.sort((a, b) => ((b[ord] || 0) - (a[ord] || 0)) * (VL.sort.d === -1 ? 1 : -1));
  const T = tot(rows);
  return '<div class="table-wrap"><table class="vl-tab"><thead><tr><th>Fornecedor</th><th class="n">Itens</th><th class="n">Peças</th>' +
    VL.fx.map(f => '<th class="n"><i class="vl-dot" style="background:' + f.cor + '"></i>' + esc(f.nome) + '</th>').join('') + '<th class="n" onclick="vlOrd(\'valor\')">Total ↕</th><th class="n" onclick="vlOrd(\'venc\')">% vencido ↕</th></tr></thead><tbody>' +
    por.map(o => '<tr class="clicavel" onclick="vlVer(\'' + esc(o.k).replace(/'/g, '&#39;') + '\')"><td><b>' + esc(o.k) + '</b></td><td class="n">' + fInt(o.itens) + '</td><td class="n">' + fInt(o.q) + '</td>' +
      VL.fx.map(f => '<td class="n">' + (o.f[f.k] ? fBRL(o.f[f.k]) : '<span class="vl-zero">—</span>') + '</td>').join('') + '<td class="n"><b>' + fBRL(o.valor) + '</b></td><td class="n">' + fPct(o.venc, o.valor) + '</td></tr>').join('') +
    '</tbody><tfoot><tr><td><b>Total</b></td><td class="n">' + fInt(T.itens) + '</td><td class="n">' + fInt(T.q) + '</td>' + VL.fx.map(f => '<td class="n"><b>' + fBRL(rows.filter(r => r.faixa === f.k).reduce((a, r) => a + r.valor, 0)) + '</b></td>').join('') + '<td class="n"><b>' + fBRL(T.valor) + '</b></td><td></td></tr></tfoot></table></div>';
}
function viewFornecedores(){
  if(!VL.rows.length) return vazio();
  const rows = filtradas(true);
  return filtrosBarra(false) + AREAS.filter(a => !VL.f.area || VL.f.area === a[0]).map(a => '<div class="vl-secao" style="--c:' + a[2] + '"><h2>' + a[1] + '</h2>' + tabelaForn(rows.filter(r => r.area === a[0])) + '</div>').join('') +
    (rows.some(r => r.forn === 'A classificar') ? '<div class="callout callout-warn"><strong>Fornecedor a classificar</strong>Há itens sem marca reconhecida. ' + (somenteLeitura() ? '' : 'Ajuste em Configurações → Fornecedores.') + '</div>' : '') + rodapeExport();
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
    const ra = rows.filter(r => r.area === a[0]), ms = mesesArea(ra).ms, T = tot(ra);
    return '<div class="vl-secao" style="--c:' + a[2] + '"><h2>' + a[1] + '</h2><div class="panel"><h3>' + a[1] + ' · valor por mês de vencimento</h3>' + graficoMensal(ra, 230, a[2]) + '</div>' +
      '<div class="table-wrap vl-gap"><table class="vl-tab"><thead><tr><th>Mês</th><th>Situação</th><th class="n">Valor no mês (R$)</th><th class="n">Acumulado (R$)</th><th class="n">Peças</th><th class="n">Lotes</th><th>Principais locais</th></tr></thead><tbody>' +
      ms.map(m => '<tr' + tip(tipMes(m)) + '><td><b>' + fMes(m.ym) + '</b></td><td>' + (m.passado ? '<span class="tag tag-bad">Vencido</span>' : m.ym === hoje ? '<span class="tag tag-orange">Mês atual</span>' : '<span class="tag tag-good">A vencer</span>') + '</td><td class="n"><b>' + fBRL(m.v) + '</b></td><td class="n">' + fBRL(m.acc) + '</td><td class="n">' + fInt(m.q) + '</td><td class="n">' + fInt(m.lotes) + '</td>' +
        '<td class="vl-locs">' + Object.entries(m.loc).sort((x, y) => y[1] - x[1]).slice(0, 3).map(l => esc(l[0]) + ' ' + fBRLc(l[1])).join(' · ') + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td><b>Total</b></td><td></td><td class="n"><b>' + fBRL(T.valor) + '</b></td><td></td><td class="n">' + fInt(T.q) + '</td><td class="n">' + fInt(T.lotes) + '</td><td></td></tr></tfoot></table></div></div>';
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
const COM_EXPORT = new Set(['mensal', 'itens']);
const VIEWS = {painel: viewPainel, fornecedores: viewFornecedores, mensal: viewMensal, itens: viewItens, importacao: viewImportacao, configuracoes: viewConfig};
function renderMsg(){ const el = document.getElementById('vlMsg'); if(el) el.textContent = VL.ocupado ? '⏳ ' + VL.msg : ''; }
function renderView(){
  if(VL.erro && !VL.rows.length && VL.tab !== 'importacao' && VL.tab !== 'configuracoes'){ document.getElementById('viewRoot').innerHTML = vazio(); return; }
  if(somenteLeitura() && (VL.tab === 'importacao' || VL.tab === 'configuracoes')) VL.tab = 'painel';
  const el = document.getElementById('viewRoot'); if(!el) return;
  const y = document.querySelector('.page-scroll') ? document.querySelector('.page-scroll').scrollTop : 0;
  el.innerHTML = VIEWS[VL.tab]() + (COM_EXPORT.has(VL.tab) && VL.rows.length ? rodapeExport() : '');
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
function vlLimpar(){ VL.f = {area: '', forn: '', busca: '', faixa: '', de: '', ate: ''}; VL.pag = 0; renderView(); }
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
/* Planilha com layout padrão: cabeçalho azul, linhas zebradas, bordas, larguras,
   formato de moeda e filtro. tipos: R = R$, N = inteiro, P = %, vazio = texto. */
function folha(wb, nome, cab, linhas, larg, tipos, titulo){
  const X = XLSX, pre = titulo ? [[titulo[0]], [titulo[1]], []] : [], h = pre.length;
  const ws = X.utils.aoa_to_sheet(pre.concat([cab], linhas));
  const borda = {style: 'thin', color: {rgb: 'D5D8E0'}}, B = {top: borda, bottom: borda, left: borda, right: borda};
  const fmt = {R: '"R$" #,##0.00', N: '#,##0', P: '0.0%', C: '"R$" #,##0.0000'};
  cab.forEach((c, j) => {
    const cel = ws[X.utils.encode_cell({r: h, c: j})];
    if(cel) cel.s = {font: {bold: true, color: {rgb: 'FFFFFF'}, sz: 10}, fill: {fgColor: {rgb: '001A72'}}, alignment: {horizontal: 'center', vertical: 'center', wrapText: true}, border: B};
  });
  linhas.forEach((l, i) => {
    const total = String(l[0]).toUpperCase() === 'TOTAL' || String(l[1]).toUpperCase() === 'TOTAL';
    l.forEach((v, j) => {
      const cel = ws[X.utils.encode_cell({r: h + 1 + i, c: j})]; if(!cel) return;
      const t = tipos[j] || '';
      cel.s = {font: {sz: 10, bold: total}, border: B, alignment: {horizontal: t ? 'right' : 'left', vertical: 'center'},
        fill: {fgColor: {rgb: total ? 'FFEDE7' : (i % 2 ? 'F4F5F7' : 'FFFFFF')}}};
      if(t && typeof v === 'number') cel.z = fmt[t];
      if(cab[j].indexOf('Faixa') === 0 || cab[j] === 'Situação'){
        const cor = /^Vencido/.test(v) ? 'C83812' : /^Vence em até|^Mês atual/.test(v) ? 'FE5000' : /^De /.test(v) ? 'B5790A' : '1F8A52';
        cel.s.font = {sz: 10, bold: true, color: {rgb: cor}};
      }
    });
  });
  if(titulo){
    ws.A1.s = {font: {bold: true, sz: 14, color: {rgb: '001A72'}}}; ws.A2.s = {font: {sz: 10, color: {rgb: '6B7280'}}};
    ws['!merges'] = [{s: {r: 0, c: 0}, e: {r: 0, c: Math.max(cab.length - 1, 3)}}, {s: {r: 1, c: 0}, e: {r: 1, c: Math.max(cab.length - 1, 3)}}];
  }
  ws['!cols'] = larg.map(w => ({wch: w}));
  ws['!rows'] = []; ws['!rows'][h] = {hpt: 30};
  ws['!autofilter'] = {ref: X.utils.encode_range({s: {r: h, c: 0}, e: {r: h + linhas.length, c: cab.length - 1}})};
  X.utils.book_append_sheet(wb, ws, nome);
}
function vlExportar(){
  if(!VL.rows.length) return toast('Nada para exportar: importe a base primeiro.', true);
  const rows = filtradas(true), fx = VL.fx, X = XLSX, hoje = hojeISO().slice(0, 7);
  if(!rows.length) return toast('Nenhum lote nos filtros atuais.', true);
  const per = VL.f.de || VL.f.ate ? 'Vencimento de ' + (VL.f.de ? fMes(VL.f.de) : 'início') + ' até ' + (VL.f.ate ? fMes(VL.f.ate) : 'fim') : 'Todos os meses';
  const filtroTxt = [VL.f.area ? (VL.f.area === 'E' ? 'Só estoque' : 'Só reversa') : 'Estoque e Reversa (separados)', VL.f.forn || 'Todos os fornecedores', per].join(' · ');
  const tit = n => ['Controle de Validade — CD Cajamar · ' + n, 'Relatório de ' + fData(hojeISO()) + ' · base importada em ' + (VL.meta && VL.meta.importadoEm ? fData(VL.meta.importadoEm.slice(0, 10)) : '—') + ' · ' + filtroTxt + ' · valor = quantidade × preço de custo'];
  const sit = ym => ym < hoje ? 'Vencido' : ym === hoje ? 'Mês atual' : 'A vencer';
    const wb = X.utils.book_new();

  const resumo = [];
  AREAS.forEach(a => {
    const ra = rows.filter(r => r.area === a[0]);
    fx.forEach(f => { const rf = ra.filter(r => r.faixa === f.k), t = tot(rf); resumo.push([a[1], f.nome, t.itens, t.q, +t.valor.toFixed(2), t.valor && tot(ra).valor ? +(t.valor / tot(ra).valor).toFixed(4) : 0, t.lotes]); });
    const t = tot(ra); resumo.push([a[1], 'TOTAL', t.itens, t.q, +t.valor.toFixed(2), 1, t.lotes]);
  });
  folha(wb, 'Resumo', ['Área', 'Faixa (dias p/ vencer)', 'Itens (SKUs)', 'Peças', 'Valor de custo (R$)', '% do valor da área', 'Lotes'], resumo, [12, 26, 13, 12, 20, 14, 10], ['', '', 'N', 'N', 'R', 'P', 'N'], tit('Resumo por faixa'));

  const mes = [], loc = [];
  AREAS.forEach(a => {
    const ra = rows.filter(r => r.area === a[0]);
    mesesArea(ra).ms.forEach(m => {
      mes.push([a[1], fMes(m.ym), sit(m.ym), m.its.size, m.q, +m.v.toFixed(2), +m.acc.toFixed(2), m.lotes]);
      Object.entries(m.loc).sort((x, y) => y[1] - x[1]).forEach(l => loc.push([a[1], fMes(m.ym), sit(m.ym), l[0], +l[1].toFixed(2)]));
    });
  });
  folha(wb, 'Mensal', ['Área', 'Mês de vencimento', 'Situação', 'Itens (SKUs)', 'Peças', 'Valor de custo (R$)', 'Acumulado (R$)', 'Lotes'], mes, [12, 18, 12, 13, 12, 20, 18, 10], ['', '', '', 'N', 'N', 'R', 'R', 'N'], tit('Visão mensal'));
  folha(wb, 'Mensal por local', ['Área', 'Mês de vencimento', 'Situação', 'Local', 'Valor de custo (R$)'], loc, [12, 18, 12, 12, 20], ['', '', '', '', 'R'], tit('Valor por mês e local'));

  const forn = [];
  AREAS.forEach(a => somar(rows.filter(r => r.area === a[0]), r => r.forn).sort((x, y) => y.valor - x.valor).forEach(o => forn.push([a[1], o.k, o.itens, o.q].concat(fx.map(f => +(o.f[f.k] || 0).toFixed(2)), [+o.valor.toFixed(2), o.valor ? +((o.f.venc || 0) / o.valor).toFixed(4) : 0]))));
  folha(wb, 'Fornecedores', ['Área', 'Fornecedor', 'Itens (SKUs)', 'Peças'].concat(fx.map(f => f.nome + ' (R$)'), ['Total (R$)', '% vencido']), forn, [12, 26, 9, 11].concat(fx.map(() => 18), [18, 11]), ['', '', 'N', 'N'].concat(fx.map(() => 'R'), ['R', 'P']), tit('Por fornecedor'));

  const nm = {}; fx.forEach(f => { nm[f.k] = f.nome; });
  const it = rows.slice().sort((a, b) => a.area.localeCompare(b.area) || a.dias - b.dias).map(r => [r.area === 'R' ? 'Reversa' : 'Estoque', +r.i || r.i, r.d, r.forn, r.l, fData(r.v), fMes(r.mes), r.dias, nm[r.faixa], r.lo, r.cl, r.r, r.e || '', r.q, +(r.c || 0).toFixed(4), +r.valor.toFixed(2), [r.m ? 'Componente de múltiplo' : (!r.c ? 'Sem preço' : ''), suspeita(r) ? 'Validade improvável' : '', r.qr ? r.qr + ' pç romaneada(s)' : ''].filter(Boolean).join(' · ')]);
  folha(wb, 'Itens', ['Área', 'Item', 'Descrição', 'Fornecedor', 'Lote', 'Validade', 'Mês de vencimento', 'Dias p/ vencer', 'Faixa (dias p/ vencer)', 'Endereço', 'Classe local', 'Restrição', 'EAN', 'Quantidade', 'Custo unitário (R$)', 'Valor de custo (R$)', 'Obs.'],
    it, [10, 10, 52, 18, 10, 11, 12, 9, 22, 18, 9, 9, 15, 11, 14, 16, 30], ['', '', '', '', '', '', '', 'N', '', '', '', '', '', 'N', 'C', 'R', ''], tit('Itens e lotes'));
  const q = (VL.meta || {}).qual, inc = [], pc = r => r.area ? (r.area === 'R' ? 'Reversa' : 'Estoque') : (VL.cfg.reversa.indexOf(r.cl) >= 0 ? 'Reversa' : 'Estoque');
  rows.filter(suspeita).forEach(r => inc.push(['Validade improvável', pc(r), +r.i || r.i, r.d, r.lo, r.cl, r.r, fData(r.v), r.q, +r.valor.toFixed(2), 'Data fora do normal — conferir cadastro do lote']));
  if(q){
    q.wv.lista.forEach(l => inc.push(['Restrição WV sem data', pc(l), +l.i || l.i, l.d, l.lo, l.cl, l.r, '', l.q, +l.valor.toFixed(2), 'Bloqueado por validade, mas a 390 não traz a data — fora dos números']));
    q.semData.lista.forEach(l => inc.push(['Saldo sem data de validade', pc(l), +l.i || l.i, l.d, l.n > 1 ? l.n + ' linhas' : l.lo, l.cl, '', '', l.q, +l.valor.toFixed(2), 'Item tem validade em outras linhas; este saldo ficou fora dos números']));
  }
  rows.filter(r => r.qr > 0).forEach(r => inc.push(['Peças romaneadas', pc(r), +r.i || r.i, r.d, r.lo, r.cl, r.r, fData(r.v), r.q, +r.valor.toFixed(2), r.qr + ' de ' + r.q + ' peças já separadas para pedido (incluídas no saldo)']));
  folha(wb, 'Inconsistências', ['Tipo', 'Área', 'Item', 'Descrição', 'Endereço', 'Classe local', 'Restrição', 'Validade', 'Quantidade', 'Valor de custo (R$)', 'Observação'], inc,
    [24, 10, 10, 48, 18, 9, 9, 11, 11, 16, 58], ['', '', '', '', '', '', '', '', 'N', 'R', ''], tit('Pontos de atenção da base' + (q ? '' : ' (reimporte a 390 para ver o saldo sem data)')));
  X.writeFile(wb, 'Controle_de_Validade_' + hojeISO() + '.xlsx');
  toast('Planilha exportada.');
}

/* ---------- baixar HTML: retrato do painel, abre em qualquer navegador sem login ---------- */
async function vlBaixarHTML(){
  if(!VL.rows.length) return toast('Nada para baixar: importe a base primeiro.', true);
  try {
    const css = (await Promise.all(['css/theme.css', 'css/validade.css'].map(f => fetch(f + '?v=' + VL_VERSAO).then(r => r.text())))).join('\n').replace(/url\([^)]*\)/g, 'none');
    VL.snap = true;
    let corpo;
    try {
      corpo = viewPainel() + AREAS.filter(a => !VL.f.area || VL.f.area === a[0]).map(a => '<section class="vl-sec" style="--c:' + a[2] + '"><header class="vl-sec-h"><div><h2>' + a[1] + ' · por fornecedor</h2><p>Valor de custo por faixa de vencimento.</p></div></header>' + tabelaForn(filtradas(true).filter(r => r.area === a[0])) + '</section>').join('');
    } finally { VL.snap = false; }
    corpo = corpo.replace(/ onclick="[^"]*"/g, '');
    const doc = '<!DOCTYPE html><html lang="pt-BR" data-theme="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<title>Controle de Validade — ' + fData(hojeISO()) + '</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">' +
      '<style>' + css + '\nbody{background:var(--paper);margin:0;font-family:Inter,system-ui,sans-serif;color:var(--ink)}.vl-snap{max-width:1320px;margin:0 auto;padding:24px 20px 40px}.vl-hrow,.vl-ft,tr.clicavel{cursor:default}</style></head><body>' +
      '<div class="vl-snap">' + corpo + '<p class="vl-snap-pe">Gerado pelo Controle de Validade · Oficina LDM · ' + new Date().toLocaleString('pt-BR') + '</p></div><div id="vlTip" class="chart-tooltip hidden"></div>' +
      '<script>document.addEventListener("mouseover",function(e){var t=document.getElementById("vlTip"),el=e.target.closest&&e.target.closest("[data-tip]");if(!el){t.classList.add("hidden");return;}t.textContent=el.getAttribute("data-tip");t.classList.remove("hidden");});' +
      'document.addEventListener("mousemove",function(e){var t=document.getElementById("vlTip");if(!t.classList.contains("hidden")){var x=e.clientX+14,y=e.clientY+14;if(x+t.offsetWidth>innerWidth)x=e.clientX-t.offsetWidth-10;if(y+t.offsetHeight>innerHeight)y=e.clientY-t.offsetHeight-10;t.style.left=x+"px";t.style.top=y+"px";}});<\/script></body></html>';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([doc], {type: 'text/html'}));
    a.download = 'Controle_de_Validade_' + hojeISO() + '.html';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('HTML baixado.');
  } catch(e){ VL.snap = false; toast('Não consegui gerar o HTML: ' + (e.message || e), true); }
}

/* ---------- tooltip ---------- */
document.addEventListener('mouseover', e => {
  const t = document.getElementById('vlTip'), el = e.target.closest && e.target.closest('[data-tip]');
  if(!t) return;
  if(!el){ t.classList.add('hidden'); return; }
  t.textContent = el.getAttribute('data-tip'); t.classList.remove('hidden');
});
document.addEventListener('mousemove', e => {
  const t = document.getElementById('vlTip'); if(!t || t.classList.contains('hidden')) return;
  let x = e.clientX + 14, y = e.clientY + 14;
  if(x + t.offsetWidth > innerWidth) x = e.clientX - t.offsetWidth - 10;
  if(y + t.offsetHeight > innerHeight) y = e.clientY - t.offsetHeight - 10;
  t.style.left = x + 'px'; t.style.top = y + 'px';
});

/* ---------- início (chamado por acesso.js depois do login) ---------- */
async function vlInit(){
  try { const t = localStorage.getItem('vl-theme'); if(t) document.documentElement.setAttribute('data-theme', t); } catch(e){}
  const v = document.getElementById('sidebarVersao'); if(v) v.textContent = 'Validade · v' + VL_VERSAO;
  renderView();
  await carregar();
  VL.carregando = false;
  renderView();
}
