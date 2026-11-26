/* Lê as planilhas do Check Volume fora da tela principal.
   O tipo é detectado pelo cabeçalho (a ordem/nome do arquivo não importa):
   - QRY0180 (entregas): tem ENTREGA + QT_PCS;
   - QRY0390 (estoque):  tem ID_ITEM_FILHO + EAN + QTDE_DISP. */
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
const txt = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

self.onmessage = (e) => {
  const nome = e.data.nome;
  try{
    self.postMessage({tipo: 'prog', msg: 'Lendo ' + nome + '...'});
    const wb = XLSX.read(e.data.buf, {type: 'array'});
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval: null, raw: true});
    if(!rows.length) throw new Error('planilha vazia.');
    const cab = Object.keys(rows[0]);

    const cEnt = achar(cab, ['ENTREGA']), cQt = achar(cab, ['QT_PCS']);
    const cFilho = achar(cab, ['ID_ITEM_FILHO']), cDisp = achar(cab, ['QTDE_DISP']);

    if(cEnt && cQt){ // QRY0180 — itens por entrega
      const c = {
        item: achar(cab, ['ID_ITEM']), desc: achar(cab, ['NOME_ITEM']), orig: achar(cab, ['DESC_LOCAL_COLETA']),
        pick: achar(cab, ['LOCAL_PICKING']), alto: achar(cab, ['LOCAL_ALTO']), cat: achar(cab, ['LOCAL_CATIVO']), dest: achar(cab, ['LOCAL_DESTINO']),
        transp: achar(cab, ['NOME_TRANSP']), evento: achar(cab, ['EVENTO_NOME']), lim: achar(cab, ['DT_LIMITE']), canal: achar(cab, ['CANAL']),
        vol: achar(cab, ['QT_VOL']), oper: achar(cab, ['OPERADOR']), modelo: achar(cab, ['MODELO_PEDIDO'])
      };
      if(!c.item) throw new Error('QRY0180: coluna ID_ITEM não encontrada.');
      const d10 = v => v instanceof Date ? v.toISOString().slice(0, 10) : '';
      const out = [];
      for(const r of rows){
        const ent = chave(r[cEnt]); if(!ent) continue;
        const o = txt(r[c.orig]);
        out.push({
          e: ent, i: chave(r[c.item]), d: txt(r[c.desc]), q: num(r[cQt]),
          o: o, pk: txt(r[c.pick]), al: txt(r[c.alto]), ct: txt(r[c.cat]), de: txt(r[c.dest]),
          t: txt(r[c.transp]), ev: txt(r[c.evento]), li: d10(r[c.lim]), ca: txt(r[c.canal]), vo: num(r[c.vol]), op: txt(r[c.oper]), mo: txt(r[c.modelo])
        });
      }
      self.postMessage({tipo: 'ok', base: '180', nome, linhas: rows.length, dados: out});
    } else if(cFilho && cDisp){ // QRY0390 — estoque (saldo por local) + EAN por item
      const c = {
        desc: achar(cab, ['NOME_ITEM_FILHO']), ean: achar(cab, ['EAN']), local: achar(cab, ['DESC_LOCAL']),
        clal: achar(cab, ['CLAL']), restr: achar(cab, ['RETRICAO', 'RESTRICAO'])
      };
      if(!c.local) throw new Error('QRY0390: coluna DESC_LOCAL não encontrada.');
      const itens = {}, saldo = new Map();
      for(const r of rows){
        const i = chave(r[cFilho]); if(!i) continue;
        const ean = chave(r[c.ean]);
        const it = itens[i] || (itens[i] = {d: txt(r[c.desc]), e: []});
        if(ean && it.e.indexOf(ean) < 0) it.e.push(ean);
        const q = num(r[cDisp]); if(q <= 0) continue;
        const loc = txt(r[c.local]), cl = txt(r[c.clal]), rs = txt(r[c.restr]);
        const k = i + '|' + loc + '|' + cl + '|' + rs;
        const x = saldo.get(k);
        if(x) x[2] += q; else saldo.set(k, [i, loc, q, cl, rs]);
      }
      self.postMessage({tipo: 'ok', base: '390', nome, linhas: rows.length, dados: {itens, saldo: Array.from(saldo.values())}});
    } else {
      throw new Error('não reconheci a planilha (esperado QRY0180 de entregas ou QRY0390 de estoque).');
    }
  } catch(err){
    self.postMessage({tipo: 'erro', nome, msg: err.message || String(err)});
  }
};
