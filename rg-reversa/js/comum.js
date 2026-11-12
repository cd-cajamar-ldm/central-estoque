/* RG Reversa — peças compartilhadas entre o dashboard e o coletor de mão.
 *
 *  - Código do local: o leitor lê o código de barras com zeros na frente e o prefixo da etiqueta
 *    (ex.: 005000687054). O código "puro" do WMS (687054) é o que a QRY0390 traz na coluna Local.
 *    No relatório o local sai no formato da etiqueta: 6 caracteres → "5000" antes; 7 → "500" antes.
 *  - Nomes dos locais: vêm da QRY0390 (importada no dashboard) e ficam numa tabela do Supabase
 *    (public.rg_locais), para o coletor mostrar o nome do local sem importar nada.
 *  - Relatório em Excel no visual do app (azul-marinho e laranja). */
(function(){
'use strict';
var RG = window.RG = window.RG || {};

/* ---------- código do local ---------- */
RG.localCodigo = function(raw){
  var t = String(raw == null ? '' : raw).trim();
  var v = t.replace(/\D/g, '');
  if(!v) return t;
  v = v.replace(/^0+/, '');
  if(v.length === 10 && v.indexOf('5000') === 0) return v.slice(4);   // 5000 + 6 dígitos
  if(v.length === 10 && v.indexOf('500') === 0) return v.slice(3);    // 500 + 7 dígitos
  return v;
};
RG.localImpresso = function(code){
  var c = String(code == null ? '' : code);
  if(c.length === 6) return '5000' + c;
  if(c.length === 7) return '500' + c;
  return c;
};
RG.localNorm = function(raw){ return RG.localImpresso(RG.localCodigo(raw)); };

/* ---------- nomes dos locais (cache + Supabase) ---------- */
var LOC = RG.locais = { mapa: new Map(), em: 0 };
RG.setLocais = function(rows, em){
  var m = new Map();
  (rows || []).forEach(function(r){ m.set(String(r[0]), { d: r[1] || '', c: r[2] || '' }); });
  LOC.mapa = m; LOC.em = em || Date.now();
};
RG.nomeLocal = function(raw){
  var c = RG.localCodigo(raw);
  return LOC.mapa.get(c) || null;
};

var idbP = null;
function idb(){
  if(!idbP) idbP = new Promise(function(res, rej){
    var rq = indexedDB.open('ldm-rg-locais', 1);
    rq.onupgradeneeded = function(){ rq.result.createObjectStore('kv'); };
    rq.onsuccess = function(){ res(rq.result); };
    rq.onerror = function(){ rej(rq.error); };
  });
  return idbP;
}
function idbGet(k){ return idb().then(function(d){ return new Promise(function(res, rej){ var r = d.transaction('kv').objectStore('kv').get(k); r.onsuccess = function(){ res(r.result); }; r.onerror = function(){ rej(r.error); }; }); }); }
function idbSet(k, v){ return idb().then(function(d){ return new Promise(function(res, rej){ var tx = d.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = function(){ res(); }; tx.onerror = function(){ rej(tx.error); }; }); }); }

/* Lê do aparelho (rápido, funciona sem internet) e atualiza do Supabase quando está velho ou se force=true. */
RG.carregaLocais = function(supa, force){
  var VELHO = 6 * 3600 * 1000;
  return idbGet('locais').catch(function(){ return null; }).then(function(c){
    if(c && c.rows && c.rows.length) RG.setLocais(c.rows, c.em);
    if(!force && c && c.em && Date.now() - c.em < VELHO) return { de: 'aparelho', n: LOC.mapa.size };
    return baixaLocais(supa).then(function(rows){
      RG.setLocais(rows, Date.now());
      return idbSet('locais', { rows: rows, em: LOC.em }).catch(function(){}).then(function(){ return { de: 'servidor', n: rows.length }; });
    }).catch(function(e){ return { de: 'aparelho', n: LOC.mapa.size, erro: (e && e.message) || String(e) }; });
  });
};
function baixaLocais(supa){
  var rows = [];
  function pagina(ini){
    return supa.from('rg_locais').select('codigo,descricao,classe').order('codigo').range(ini, ini + 999).then(function(r){
      if(r.error) throw r.error;
      (r.data || []).forEach(function(x){ rows.push([x.codigo, x.descricao, x.classe]); });
      return (r.data && r.data.length === 1000) ? pagina(ini + 1000) : rows;
    });
  }
  return pagina(0);
}
/* Dashboard: depois de importar a QRY0390, manda a lista de locais (todas as classes) para o coletor enxergar. */
RG.subeLocais = function(supa, rows){
  if(!rows || !rows.length) return Promise.resolve(0);
  var lotes = []; for(var i = 0; i < rows.length; i += 1000) lotes.push(rows.slice(i, i + 1000));
  return lotes.reduce(function(p, lote){
    return p.then(function(){
      return supa.from('rg_locais').upsert(lote.map(function(r){ return { codigo: r[0], descricao: r[1], classe: r[2], atualizado_em: new Date().toISOString() }; }), { onConflict: 'codigo' })
        .then(function(r){ if(r.error) throw r.error; });
    });
  }, Promise.resolve()).then(function(){
    RG.setLocais(rows, Date.now());
    return idbSet('locais', { rows: rows, em: LOC.em }).catch(function(){}).then(function(){ return rows.length; });
  });
};

/* ---------- versão em uso ---------- */
/* A versão é um número que sobe a cada alteração (rg-reversa/js/versao.js) — não depende do deploy do GitHub. */
RG.versao = function(){ return window.RG_VERSAO || { n: 0, data: '' }; };
RG.versaoTxt = function(){ var v = RG.versao(); return 'RG Reversa · v' + v.n + (v.data ? ' · ' + v.data : ''); };

/* ---------- aviso de versão nova ---------- */
/* O navegador guarda a página por alguns minutos. Esta checagem pergunta ao servidor (sem cache) qual é a versão
   publicada; se for maior que a da tela, mostra "Nova versão disponível" e o botão abre a página num endereço
   novo, que obriga o navegador a baixar tudo de novo. caminho = onde está versao.js em relação à página. */
RG.vigiaVersao = function(caminho){
  var atual = RG.versao().n;
  var url = new URL(caminho, location.href).href;
  function mostra(){
    if(document.getElementById('rgNovaVersao')) return;
    var b = document.createElement('div'); b.id = 'rgNovaVersao';
    b.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:999;background:#FE5000;color:#fff;padding:10px 14px;display:flex;gap:12px;align-items:center;justify-content:space-between;font:600 13px Inter,system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25)';
    b.innerHTML = '<span>Nova versão disponível.</span><button type="button" style="background:#fff;color:#FE5000;border:0;border-radius:8px;padding:8px 14px;font:700 13px Inter,system-ui,sans-serif">Atualizar agora</button>';
    b.querySelector('button').onclick = function(){ location.replace(location.pathname + '?r=' + Date.now() + location.hash); };
    document.body.appendChild(b);
  }
  function checa(){
    fetch(url + '?t=' + Date.now(), { cache: 'no-store' }).then(function(r){ return r.text(); }).then(function(t){
      var m = t.match(/n:\s*(\d+)/);
      if(m && +m[1] > atual) mostra();
    }).catch(function(){});
  }
  checa();
  setInterval(checa, 120000);
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) checa(); });
};

/* ---------- texto / área de transferência ---------- */
RG.copia = function(texto){
  return new Promise(function(res){
    var fallback = function(){
      var t = document.createElement('textarea'); t.value = texto; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch(e){} t.remove(); res();
    };
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(res).catch(fallback);
    else fallback();
  });
};

/* Linhas da coluna A (as que vão para o PuTTY): origem, RGs, destino — um bloco por movimentação. */
RG.linhasBlocos = function(blocos){
  var out = [];
  blocos.forEach(function(b){
    out.push(RG.localNorm(b.origem));
    b.rgs.forEach(function(r){ out.push(r.rg); });
    out.push(RG.localNorm(b.destino));
  });
  return out;
};

/* ---------- Excel no visual do app ---------- */
var AZUL = '001A72', LARANJA = 'FE5000', CINZA = 'F4F5F7', LINHA = 'D5D8E0', TEXTO = '1D1F2A';
function borda(){ var t = { style: 'thin', color: { rgb: LINHA } }; return { top: t, bottom: t, left: t, right: t }; }
function est(fundo, cor, extra){
  var s = { fill: { patternType: 'solid', fgColor: { rgb: fundo } }, font: { name: 'Calibri', sz: 11, color: { rgb: cor } }, alignment: { vertical: 'center' }, border: borda() };
  if(extra){ Object.keys(extra).forEach(function(k){ s[k] = Object.assign({}, s[k], extra[k]); }); }
  return s;
}
/* blocos: [{ origem, destino, rgs:[{rg, desc}], hora, operador }] · info: { titulo, data, operador } */
RG.xlsx = function(blocos, info, nome){
  var ws = {}, merges = [], altura = [], r = 0, totalRgs = 0;
  function cel(rr, cc, v, s){ ws[XLSX.utils.encode_cell({ r: rr, c: cc })] = { v: v == null ? '' : String(v), t: 's', s: s }; }
  blocos.forEach(function(b){
    var o = RG.nomeLocal(b.origem), d = RG.nomeLocal(b.destino);
    var cod = { font: { name: 'Consolas', sz: 12, bold: true } };
    cel(r, 0, RG.localNorm(b.origem), est(AZUL, 'FFFFFF', { font: cod.font }));
    cel(r, 1, 'Local de origem', est(AZUL, 'FFFFFF', { font: { bold: true } }));
    cel(r, 2, o ? o.d + (o.c ? '  ·  ' + o.c : '') : '', est(AZUL, 'FFFFFF'));
    altura[r] = { hpt: 24 }; r++;
    b.rgs.forEach(function(x, i){
      var f = i % 2 ? CINZA : 'FFFFFF';
      cel(r, 0, x.rg, est(f, TEXTO, { font: { name: 'Consolas', sz: 11 } }));
      cel(r, 1, 'RG', est(f, LARANJA, { font: { bold: true } }));
      cel(r, 2, 'Nº ' + (i + 1) + (x.desc ? '  ·  ' + x.desc : ''), est(f, TEXTO));
      altura[r] = { hpt: 20 }; r++; totalRgs++;
    });
    cel(r, 0, RG.localNorm(b.destino), est(LARANJA, 'FFFFFF', { font: cod.font }));
    cel(r, 1, 'Local de destino', est(LARANJA, 'FFFFFF', { font: { bold: true } }));
    cel(r, 2, d ? d.d + (d.c ? '  ·  ' + d.c : '') : '', est(LARANJA, 'FFFFFF'));
    altura[r] = { hpt: 24 }; r++;
  });
  /* cartão de identificação, à direita (colunas F:G) — fora da coluna A, que é a que vai para o PuTTY */
  var topo = est(AZUL, 'FFFFFF', { font: { bold: true, sz: 14 }, alignment: { horizontal: 'center' } });
  cel(0, 5, 'OFICINA LDM · RG REVERSA', topo); cel(0, 6, '', topo); merges.push({ s: { r: 0, c: 5 }, e: { r: 0, c: 6 } });
  var sub = est(LARANJA, 'FFFFFF', { font: { bold: true }, alignment: { horizontal: 'center' } });
  cel(1, 5, info.titulo || 'Movimentação de RGs', sub); cel(1, 6, '', sub); merges.push({ s: { r: 1, c: 5 }, e: { r: 1, c: 6 } });
  var rot = est(CINZA, '6B7280', { font: { bold: true, sz: 10 } }), val = est('FFFFFF', TEXTO, { font: { bold: true } });
  [['Data', info.data || ''], ['Operador', info.operador || ''], ['Movimentações', blocos.length], ['Total de RGs', totalRgs]].forEach(function(p, i){
    cel(2 + i, 5, p[0], rot); cel(2 + i, 6, p[1], val);
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(r, 6) - 1, c: 6 } });
  ws['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 46 }, { wch: 3 }, { wch: 3 }, { wch: 22 }, { wch: 22 }];
  ws['!merges'] = merges; ws['!rows'] = altura;
  var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Movimentação');
  XLSX.writeFile(wb, nome);
};
})();
