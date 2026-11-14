/* Lê as planilhas (QRY0390, SIGEQ278, ZBIQ0051) fora da tela principal.
   O tipo é detectado pelo cabeçalho, então a ordem/nome do arquivo não importa. */
importScripts('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');

function norm(s){ return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function achar(cab, nomes){
  for(const n of nomes){ const k = norm(n); const h = cab.find(c => norm(c) === k); if(h) return h; }
  return null;
}
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
function iso(v){
  if(v == null || v === '') return '';
  if(v instanceof Date) return v.toISOString().slice(0, 10);
  if(typeof v === 'number'){ const d = new Date(Math.round((v - 25569) * 86400000)); return isNaN(d) ? '' : d.toISOString().slice(0, 10); }
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  const m2 = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m2 ? m2[0] : '';
}

self.onmessage = (e) => {
  const nome = e.data.nome;
  try{
    self.postMessage({tipo: 'prog', nome, msg: 'Lendo ' + nome + '...'});
    const wb = XLSX.read(e.data.buf, {type: 'array'});
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval: null, raw: true});
    if(!rows.length) throw new Error('planilha vazia.');
    const cab = Object.keys(rows[0]);

    const cVal = achar(cab, ['Data de Validade', 'Validade']);
    const cPai = achar(cab, ['item_vol_multiplo']);
    const cCusto = achar(cab, ['Preço de custo', 'Preco de custo']);

    if(cVal){ // QRY0390
      const c = {
        item: achar(cab, ['Item', 'ID_ITEM_FILHO']), desc: achar(cab, ['Descrição', 'Descricao', 'NOME_ITEM_FILHO']),
        lote: achar(cab, ['Lote']), cl: achar(cab, ['Classe Local', 'CLAL']), local: achar(cab, ['Descrição_2', 'DESC_LOCAL']),
        restr: achar(cab, ['Restrição', 'Restricao']), qtd: achar(cab, ['Quantidade', 'QTDE']), ean: achar(cab, ['EAN']),
        rom: achar(cab, ['Quantidade Romaneada', 'QTDE_ROM'])
      };
      if(!c.item || !c.qtd) throw new Error('QRY0390: colunas Item/Quantidade não encontradas.');
      const out = [], wv = [], semDataLinhas = []; let wvSemData = 0;
      const txt = (r, k) => String(k && r[k] != null ? r[k] : '').trim();
      for(const r of rows){
        const v = iso(r[cVal]);
        const restr = txt(r, c.restr).toUpperCase();
        const q = num(r[c.qtd]);
        const base = {i: chave(r[c.item]), d: txt(r, c.desc), lo: txt(r, c.local), cl: txt(r, c.cl).toUpperCase(), r: restr, q};
        if(!v){
          // Sem data não entra na conta de validade, mas é guardado pra aparecer como inconsistência.
          if(q > 0){ if(restr === 'WV'){ wvSemData++; wv.push(base); } else semDataLinhas.push(base); }
          continue;
        }
        if(q <= 0) continue;
        const lote = chave(r[c.lote]), qr = c.rom ? num(r[c.rom]) : 0;
        const o = Object.assign(base, {l: lote === '0' ? '' : lote, v, e: c.ean ? chave(r[c.ean]) : ''});
        if(qr > 0) o.qr = qr;
        out.push(o);
      }
      // Itens que têm validade em algumas linhas e não em outras: o saldo sem data fica de fora.
      const comData = new Set(out.map(o => o.i)), sd = new Map();
      semDataLinhas.filter(l => comData.has(l.i)).forEach(l => {
        const k = l.i + '|' + l.cl; let o = sd.get(k);
        if(!o){ o = {i: l.i, d: l.d, cl: l.cl, lo: l.lo, q: 0, n: 0}; sd.set(k, o); }
        o.q += l.q; o.n++;
      });
      self.postMessage({tipo: 'ok', base: '390', nome, linhas: rows.length, dados: out, wvSemData, wv, semData: Array.from(sd.values())});
    } else if(cCusto){ // SIGEQ278
      const cItem = achar(cab, ['Item']); const mapa = {}; let n = 0;
      for(const r of rows){
        const custo = num(r[cCusto]); const it = chave(r[cItem]);
        if(it && custo > 0){ mapa[it] = custo; n++; }
      }
      self.postMessage({tipo: 'ok', base: '278', nome, linhas: rows.length, dados: mapa, comPreco: n});
    } else if(cPai){ // ZBIQ0051
      const cComp = achar(cab, ['item_componente']); const cInt = achar(cab, ['in_interface']);
      const out = [];
      for(const r of rows){
        const comp = chave(r[cComp]), pai = chave(r[cPai]);
        if(comp && pai) out.push([comp, pai, String(r[cInt] == null ? '' : r[cInt]).trim().toUpperCase() === 'S' ? 1 : 0]);
      }
      self.postMessage({tipo: 'ok', base: '051', nome, linhas: rows.length, dados: out});
    } else {
      throw new Error('não reconheci o arquivo (esperado QRY0390, SIGEQ278 ou ZBIQ0051).');
    }
  }catch(err){
    self.postMessage({tipo: 'erro', nome, msg: (err && err.message) || String(err)});
  }
};
