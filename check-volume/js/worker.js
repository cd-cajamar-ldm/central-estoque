/* Lê as planilhas do Check Volume fora da tela principal.
   O tipo é detectado pelo cabeçalho (a ordem/nome do arquivo não importa):
   - QRY0180 (entregas): tem ENTREGA + QT_PCS;
   - QRY0390 (estoque):  tem ID_ITEM_FILHO + EAN + QTDE_DISP;
   - cadastro de fotos (De-Para): tem Id Item + URL Foto.
   Feito para arquivos grandes (a QRY0180 passa de 40 MB): lê a planilha em modo
   "denso", sem montar um objeto por linha, e devolve só o que o app usa. */
importScripts('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');

function norm(s){ return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function num(v){
  if(typeof v === 'number') return v;
  let s = String(v == null ? '' : v).trim().replace(/[^\d,.\-]/g, '');
  if(!s) return 0;
  if(s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if(s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s); return isNaN(n) ? 0 : n;
}
function chave(v){
  if(v == null || v === '') return '';
  if(typeof v === 'number') return String(Math.round(v));
  return String(v).trim().replace(/\.0+$/, '');
}
const txt = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
function dia(v){
  if(v instanceof Date) return isNaN(v) ? '' : v.toISOString().slice(0, 10);
  if(typeof v === 'number' && v > 20000){ const d = new Date(Math.round((v - 25569) * 86400000)); return isNaN(d) ? '' : d.toISOString().slice(0, 10); }
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : '';
}

/* Linhas como arrays de valores, direto do modo denso (sem objetos por linha). */
function linhasDe(ws){
  const d = ws['!data'];
  if(d){
    const out = new Array(d.length);
    for(let r = 0; r < d.length; r++){
      const lin = d[r] || [], a = new Array(lin.length);
      for(let c = 0; c < lin.length; c++){ const x = lin[c]; a[c] = x ? x.v : null; }
      out[r] = a;
    }
    return out;
  }
  return XLSX.utils.sheet_to_json(ws, {header: 1, defval: null, raw: true});
}

/* ---------- leitura em fluxo (planilhas muito grandes) ----------
   Um .xlsx é um zip. Quando o XML da aba passa de ~150 MB (a QRY0180 completa), a
   biblioteca não consegue carregar tudo na memória e devolve "planilha vazia".
   Aqui o zip é aberto direto do arquivo, a aba é descompactada aos poucos
   (DecompressionStream) e só as colunas necessárias ficam na memória. */
const LIMITE_XML = 150 * 1024 * 1024;
async function lerZip(file){
  const fim = Math.max(0, file.size - 70000);
  const cauda = new DataView(await file.slice(fim).arrayBuffer());
  let eocd = -1;
  for(let i = cauda.byteLength - 22; i >= 0; i--){ if(cauda.getUint32(i, true) === 0x06054b50){ eocd = i; break; } }
  if(eocd < 0) throw new Error('arquivo não é um .xlsx válido (zip não reconhecido).');
  const total = cauda.getUint16(eocd + 10, true), cdTam = cauda.getUint32(eocd + 12, true), cdPos = cauda.getUint32(eocd + 16, true);
  if(cdPos === 0xFFFFFFFF) throw new Error('zip64 não suportado.');
  const cd = new DataView(await file.slice(cdPos, cdPos + cdTam).arrayBuffer());
  const dec = new TextDecoder(), ent = {};
  let o = 0;
  for(let n = 0; n < total && o + 46 <= cd.byteLength; n++){
    if(cd.getUint32(o, true) !== 0x02014b50) break;
    const nl = cd.getUint16(o + 28, true), el = cd.getUint16(o + 30, true), cl = cd.getUint16(o + 32, true);
    const nome = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + o + 46, nl));
    ent[nome] = {metodo: cd.getUint16(o + 10, true), comp: cd.getUint32(o + 20, true), tam: cd.getUint32(o + 24, true), pos: cd.getUint32(o + 42, true)};
    o += 46 + nl + el + cl;
  }
  return ent;
}
async function abrirEntrada(file, en){
  const lh = new DataView(await file.slice(en.pos, en.pos + 30).arrayBuffer());
  const ini = en.pos + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
  const bruto = file.slice(ini, ini + en.comp);
  if(en.metodo === 0) return bruto.stream();
  if(en.metodo !== 8) throw new Error('compactação do xlsx não suportada.');
  return bruto.stream().pipeThrough(new DecompressionStream('deflate-raw'));
}
/* Entrega o texto aos poucos; aoTexto devolve true para parar. */
async function lerTexto(file, en, aoTexto){
  const rd = (await abrirEntrada(file, en)).getReader(), td = new TextDecoder('utf-8');
  let lidos = 0;
  while(true){
    const {done, value} = await rd.read();
    if(done) break;
    lidos += value.length;
    if(aoTexto(td.decode(value, {stream: true}), lidos)){ try{ await rd.cancel(); }catch(e){} return; }
  }
  aoTexto(td.decode(), lidos);
}
async function textoInteiro(file, en){ let t = ''; await lerTexto(file, en, x => { t += x; }); return t; }
const colNum = ref => { let n = 0; for(let i = 0; i < ref.length; i++){ const c = ref.charCodeAt(i); if(c < 65 || c > 90) break; n = n * 26 + (c - 64); } return n - 1; };
const ENT = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'"};
const desx = t => t.indexOf('&') < 0 && t.indexOf('_x') < 0 ? t : t.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-fA-F]+);|_x([0-9a-fA-F]{4})_/g, (m, n, d, h, u) => n ? ENT[m] : String.fromCharCode(d ? +d : parseInt(h || u, 16)));
const RE_CEL = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
/* Valor de uma célula: número, texto direto ou "\u0001"+índice do texto compartilhado. */
function valorCelula(attrs, corpo){
  if(!corpo) return undefined;
  const t = (/\bt="([^"]*)"/.exec(attrs) || [])[1];
  if(t === 'inlineStr'){ let x = '', m; const re = /<t[^>]*>([\s\S]*?)<\/t>/g; while((m = re.exec(corpo))) x += m[1]; return desx(x); }
  const v = /<v>([\s\S]*?)<\/v>/.exec(corpo); if(!v) return undefined;
  if(t === 's') return '\u0001' + v[1];
  if(t === 'str' || t === 'e') return desx(v[1]);
  if(t === 'b') return v[1] === '1';
  const nn = Number(v[1]); return isNaN(nn) ? desx(v[1]) : nn;
}
/* Percorre as linhas da aba. aoLinha(numeroDaLinha, [[coluna, valor]...]). */
async function lerAba(file, en, aoLinha, progresso){
  let buf = '', fim = false;
  await lerTexto(file, en, (txt, lidos) => {
    buf += txt;
    let i;
    while((i = buf.indexOf('<row')) >= 0){
      const f = buf.indexOf('</row>', i), auto = buf.indexOf('/>', i), gt = buf.indexOf('>', i);
      let fechaEm, corpo = '';
      if(gt >= 0 && buf.charCodeAt(gt - 1) === 47){ fechaEm = gt + 1; }              // <row .../>
      else if(f >= 0){ fechaEm = f + 6; corpo = buf.slice(gt + 1, f); }
      else break;                                                                     // linha incompleta: espera mais texto
      const attrs = buf.slice(i + 4, gt), rn = Number((/\br="(\d+)"/.exec(attrs) || [])[1]) || 0;
      const cels = []; let m; RE_CEL.lastIndex = 0;
      while((m = RE_CEL.exec(corpo))){
        const ref = (/\br="([A-Z]+)\d+"/.exec(m[1]) || [])[1]; if(!ref) continue;
        const v = valorCelula(m[1], m[2]); if(v !== undefined) cels.push([colNum(ref), v]);
      }
      buf = buf.slice(fechaEm);
      if(aoLinha(rn, cels)){ fim = true; return true; }
    }
    if(progresso) progresso(lidos);
    return false;
  });
  return fim;
}
/* Textos compartilhados: resolve só os índices pedidos (Set de números). */
async function lerTextos(file, en, pedidos, parar){
  const out = new Map(); let idx = 0, buf = '', falta = pedidos.size;
  await lerTexto(file, en, txt => {
    buf += txt;
    let p;
    while((p = buf.indexOf('</si>')) >= 0 || /<si\s*\/>/.test(buf)){
      let trecho, corte;
      const a = buf.indexOf('<si'), v = /<si\s*\/>/.exec(buf);
      if(v && (p < 0 || v.index < a)){ trecho = ''; corte = v.index + v[0].length; }
      else { trecho = buf.slice(a, p); corte = p + 5; }
      if(pedidos.has(idx)){
        let x = '', m; const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
        while((m = re.exec(trecho))) x += m[1];
        out.set(idx, desx(x)); falta--;
      }
      idx++; buf = buf.slice(corte);
      if(parar && falta === 0) return true;
    }
    return false;
  });
  return out;
}
async function primeiraAba(file, ent){
  const wbx = ent['xl/workbook.xml'], rel = ent['xl/_rels/workbook.xml.rels'];
  if(wbx && rel){
    const w = await textoInteiro(file, wbx), r = await textoInteiro(file, rel);
    const id = (/<sheet\b[^>]*\br:id="([^"]+)"/.exec(w) || [])[1];
    if(id){
      const re = new RegExp('<Relationship\\b[^>]*\\bId="' + id + '"[^>]*>'), tag = (re.exec(r) || [])[0] || '';
      let alvo = (/Target="([^"]+)"/.exec(tag) || [])[1];
      if(alvo){ alvo = alvo.replace(/^\/?(xl\/)?/, ''); if(ent['xl/' + alvo]) return ent['xl/' + alvo]; }
    }
  }
  return ent['xl/worksheets/sheet1.xml'];
}
/* Devolve [cabeçalho, ...linhas] como arrays esparsos, só com as colunas pedidas por precisa(cab). */
async function lerGrande(file, ent, aba, precisa, prog){
  // 1) cabeçalho: primeira linha da aba (textos ainda como índices)
  let cabIdx = null;
  await lerAba(file, aba, (rn, cels) => { cabIdx = cels; return true; });
  if(!cabIdx || !cabIdx.length) throw new Error('planilha vazia.');
  const sst = ent['xl/sharedStrings.xml'];
  const pedH = new Set(cabIdx.filter(c => typeof c[1] === 'string' && c[1].charCodeAt(0) === 1).map(c => Number(c[1].slice(1))));
  const mapaH = sst && pedH.size ? await lerTextos(file, sst, pedH, true) : new Map();
  const cab = [];
  cabIdx.forEach(([c, v]) => { cab[c] = typeof v === 'string' && v.charCodeAt(0) === 1 ? (mapaH.get(Number(v.slice(1))) || '') : v; });
  const quer = precisa(cab.map(h => norm(h)));          // Set de colunas
  if(!quer || !quer.size) throw new Error('não reconheci a planilha (esperado QRY0180 de entregas, QRY0390 de estoque ou o cadastro com URL Foto).');
  // 2) linhas: só as colunas pedidas
  const linhas = [cab]; const usados = new Set(); let vistas = 0;
  await lerAba(file, aba, (rn, cels) => {
    if(rn === 1) return false;
    const L = [];
    for(const [c, v] of cels){
      if(!quer.has(c)) continue;
      L[c] = v;
      if(typeof v === 'string' && v.charCodeAt(0) === 1) usados.add(Number(v.slice(1)));
    }
    linhas.push(L); vistas++;
    return false;
  }, lidos => prog && prog(Math.min(99, Math.round(lidos / aba.tam * 100))));
  // 3) resolve os textos
  if(usados.size && sst){
    prog && prog('textos');
    const mapa = await lerTextos(file, sst, usados, true);
    for(let r = 1; r < linhas.length; r++){
      const L = linhas[r];
      for(const c of quer){ const v = L[c]; if(typeof v === 'string' && v.charCodeAt(0) === 1) L[c] = mapa.get(Number(v.slice(1))); }
    }
  }
  return linhas;
}

/* Colunas que cada tipo de planilha usa (índices), a partir do cabeçalho já normalizado. */
function colunasPrecisas(cab){
  const idx = (...ns) => { for(const n of ns){ const i = cab.indexOf(norm(n)); if(i >= 0) return i; } return -1; };
  const tipos = [
    [['ENTREGA', 'QT_PCS'], ['ID_ITEM', 'NOME_ITEM', 'DESC_LOCAL_COLETA', 'LOCAL_PICKING', 'LOCAL_DESTINO', 'NOME_TRANSP', 'EVENTO_NOME', 'DT_LIMITE', 'CANAL', 'QT_VOL', 'MODELO_PEDIDO']],
    [['ID_ITEM_FILHO', 'QTDE_DISP'], ['NOME_ITEM_FILHO', 'EAN', 'DESC_LOCAL', 'CLAL', 'RETRICAO', 'RESTRICAO']],
    [['Id Item', 'URL Foto'], ['Id EAN']]
  ];
  for(const [obrig, extra] of tipos){
    const o = obrig.map(n => idx(n));
    if(o.every(i => i >= 0)) return new Set(o.concat(extra.map(n => idx(n)).filter(i => i >= 0)));
  }
  return null;
}

self.onmessage = async (e) => {
  const nome = e.data.nome, file = e.data.file;
  try{
    self.postMessage({tipo: 'prog', msg: 'Lendo ' + nome + '...'});
    let aoa = null, ent = null, aba = null;
    try{ ent = await lerZip(file); aba = await primeiraAba(file, ent); }catch(err){ ent = null; aba = null; }
    if(aba && (aba.tam > LIMITE_XML || e.data.forcarFluxo)){
      aoa = await lerGrande(file, ent, aba, colunasPrecisas, p => self.postMessage({tipo: 'prog', msg: p === 'textos' ? 'Lendo os textos de ' + nome + '...' : 'Lendo ' + nome + ' (arquivo grande): ' + p + '%'}));
    } else {
      const wb = XLSX.read(await file.arrayBuffer(), {type: 'array', dense: true, cellDates: true});
      const ws = wb.Sheets[wb.SheetNames[0]];
      if(!ws) throw new Error('não consegui ler a planilha (arquivo muito grande ou fora do padrão .xlsx).');
      self.postMessage({tipo: 'prog', msg: 'Organizando ' + nome + '...'});
      aoa = linhasDe(ws);
    }
    if(aoa.length < 2) throw new Error('planilha vazia.');
    const cab = (aoa[0] || []).map(h => norm(h));
    const col = (...nomes) => { for(const n of nomes){ const i = cab.indexOf(norm(n)); if(i >= 0) return i; } return -1; };
    const n = aoa.length - 1;

    const cEnt = col('ENTREGA'), cQt = col('QT_PCS');
    const cFilho = col('ID_ITEM_FILHO'), cDisp = col('QTDE_DISP');
    const cFotoId = col('Id Item'), cFotoUrl = col('URL Foto'), cFotoEan = col('Id EAN');

    if(cEnt >= 0 && cQt >= 0){ // QRY0180 — itens por entrega
      const c = {
        item: col('ID_ITEM'), desc: col('NOME_ITEM'), orig: col('DESC_LOCAL_COLETA'), pick: col('LOCAL_PICKING'), dest: col('LOCAL_DESTINO'),
        transp: col('NOME_TRANSP'), evento: col('EVENTO_NOME'), lim: col('DT_LIMITE'), canal: col('CANAL'), vol: col('QT_VOL'), modelo: col('MODELO_PEDIDO')
      };
      if(c.item < 0) throw new Error('QRY0180: coluna ID_ITEM não encontrada.');
      const linhas = [], cabs = new Map(), descs = new Map();
      for(let r = 1; r < aoa.length; r++){
        const L = aoa[r]; if(!L) continue;
        const ent = chave(L[cEnt]); if(!ent) continue;
        const item = chave(L[c.item]); if(!item) continue;
        const orig = txt(L[c.orig]) || txt(L[c.pick]) || txt(L[c.dest]);
        linhas.push([ent, item, num(L[cQt]), orig]);
        if(!cabs.has(ent)) cabs.set(ent, [ent, txt(L[c.transp]), txt(L[c.evento]), dia(L[c.lim]), txt(L[c.canal]), num(L[c.vol]), txt(L[c.modelo])]);
        if(!descs.has(item)){ const d = txt(L[c.desc]); if(d) descs.set(item, d); }
        if(r % 50000 === 0) self.postMessage({tipo: 'prog', msg: 'Organizando ' + nome + ': ' + r.toLocaleString('pt-BR') + ' de ' + n.toLocaleString('pt-BR') + ' linhas...'});
      }
      self.postMessage({tipo: 'ok', base: '180', nome, linhas: n, dados: {linhas, cabs: Array.from(cabs.values()), descs: Array.from(descs.entries())}});
    } else if(cFilho >= 0 && cDisp >= 0){ // QRY0390 — estoque (saldo por local) + EAN por item
      const c = {desc: col('NOME_ITEM_FILHO'), ean: col('EAN'), local: col('DESC_LOCAL'), clal: col('CLAL'), restr: col('RETRICAO', 'RESTRICAO')};
      if(c.local < 0) throw new Error('QRY0390: coluna DESC_LOCAL não encontrada.');
      const itens = {}, saldo = new Map();
      for(let r = 1; r < aoa.length; r++){
        const L = aoa[r]; if(!L) continue;
        const i = chave(L[cFilho]); if(!i) continue;
        const ean = chave(L[c.ean]);
        const it = itens[i] || (itens[i] = {d: txt(L[c.desc]), e: []});
        if(ean && it.e.indexOf(ean) < 0) it.e.push(ean);
        const q = num(L[cDisp]); if(q <= 0) continue;
        const loc = txt(L[c.local]), cl = txt(L[c.clal]), rs = txt(L[c.restr]);
        const k = i + '|' + loc + '|' + cl + '|' + rs;
        const x = saldo.get(k);
        if(x) x[2] += q; else saldo.set(k, [i, loc, q, cl, rs]);
      }
      self.postMessage({tipo: 'ok', base: '390', nome, linhas: n, dados: {itens, saldo: Array.from(saldo.values())}});
    } else if(cFotoId >= 0 && cFotoUrl >= 0){ // cadastro de itens com link da foto (De-Para)
      const BASE = 'https://img.lojadomecanico.com.br/IMAGENS/', vistos = new Set(), out = [];
      for(let r = 1; r < aoa.length; r++){
        const L = aoa[r]; if(!L) continue;
        const i = chave(L[cFotoId]), u = txt(L[cFotoUrl]); if(!i || !u || vistos.has(i)) continue;
        vistos.add(i);
        out.push([i, u.indexOf(BASE) === 0 ? u.slice(BASE.length) : u, cFotoEan >= 0 ? chave(L[cFotoEan]) : '']);
      }
      self.postMessage({tipo: 'ok', base: 'foto', nome, linhas: n, dados: out});
    } else {
      throw new Error('não reconheci a planilha (esperado QRY0180 de entregas, QRY0390 de estoque ou o cadastro com URL Foto).');
    }
  } catch(err){
    self.postMessage({tipo: 'erro', nome, msg: (err && err.message) || String(err)});
  }
};
