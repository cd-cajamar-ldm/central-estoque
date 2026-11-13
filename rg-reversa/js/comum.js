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

/* ---------- dados da última importação, guardados no Supabase (public.rg_dados) ---------- */
/* O navegador pode apagar os dados do site ao fechar (política da empresa, modo privado...). Por isso a última
   importação também fica no servidor: ao abrir o app em qualquer aparelho, os dados voltam sozinhos. */
RG.nuvem = (function(){
  var TAM = 3000, PAG = 5;
  function chunk(a, n){ var o = []; for(var i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o.length ? o : [[]]; }
  function salvaChave(supa, chave, valor, agora, usuario){
    var partes = Array.isArray(valor) ? chunk(valor, TAM) : [valor];
    return partes.reduce(function(p, d, i){
      return p.then(function(){
        return supa.from('rg_dados').upsert({ chave: chave, parte: i, dados: d, atualizado_em: agora, usuario: usuario || '' }, { onConflict: 'chave,parte' })
          .then(function(r){ if(r.error) throw r.error; });
      });
    }, Promise.resolve()).then(function(){
      return supa.from('rg_dados').delete().eq('chave', chave).gte('parte', partes.length);
    }).then(function(r){ if(r && r.error) throw r.error; });
  }
  function carregaChave(supa, chave){
    var partes = [];
    function pag(ini){
      return supa.from('rg_dados').select('parte,dados,atualizado_em,usuario').eq('chave', chave).order('parte').range(ini, ini + PAG - 1).then(function(r){
        if(r.error) throw r.error;
        (r.data || []).forEach(function(x){ partes.push(x); });
        return (r.data && r.data.length === PAG) ? pag(ini + PAG) : null;
      });
    }
    return pag(0).then(function(){
      if(!partes.length) return null;
      var v = Array.isArray(partes[0].dados) ? [].concat.apply([], partes.map(function(x){ return x.dados; })) : partes[0].dados;
      return { valor: v, em: partes[0].atualizado_em, usuario: partes[0].usuario };
    });
  }
  var N = {};
  N.chaveMeta = function(g){ return g === 'est' ? 'est_meta' : g === 'mult' ? 'mult_meta' : g; };
  /* quando (e quem) gravou cada chave — é a parte 0 de cada uma */
  N.metas = function(supa){
    return supa.from('rg_dados').select('chave,atualizado_em,usuario').eq('parte', 0).then(function(r){
      if(r.error) throw r.error;
      var m = {}; (r.data || []).forEach(function(x){ m[x.chave] = { em: x.atualizado_em, usuario: x.usuario }; }); return m;
    });
  };
  /* grupos: rgs (lista), est e mult (objeto com rows), hist (lista). Devolve o carimbo gravado. */
  N.salvaGrupo = function(supa, g, valor, usuario){
    var agora = new Date().toISOString();
    if(g === 'est' || g === 'mult'){
      var meta = {}; Object.keys(valor).forEach(function(k){ if(k !== 'rows' && k !== 'locais') meta[k] = valor[k]; });
      /* as linhas primeiro; o "meta" por último marca que a gravação terminou */
      return salvaChave(supa, g + '_rows', valor.rows, agora, usuario).then(function(){ return salvaChave(supa, g + '_meta', meta, agora, usuario); }).then(function(){ return agora; });
    }
    return salvaChave(supa, g, valor, agora, usuario).then(function(){ return agora; });
  };
  N.carregaGrupo = function(supa, g){
    if(g === 'est' || g === 'mult'){
      return carregaChave(supa, g + '_meta').then(function(m){
        if(!m) return null;
        return carregaChave(supa, g + '_rows').then(function(rw){
          var v = m.valor || {}; v.rows = rw ? rw.valor : []; if(g === 'est') v.locais = [];
          return { valor: v, em: m.em, usuario: m.usuario };
        });
      });
    }
    return carregaChave(supa, g);
  };
  return N;
})();

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
    (document.querySelector('.cl-screen') || document.body).appendChild(b);
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

/* Linhas para o PuTTY: uma por RG, em 3 colunas separadas por TAB — local de origem, RG, local de destino. */
RG.linhasBlocos = function(blocos){
  var out = [];
  blocos.forEach(function(b){
    var o = RG.localNorm(b.origem), d = RG.localNorm(b.destino);
    b.rgs.forEach(function(r){ out.push([o, r.rg, d].join('\t')); });
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
/* blocos: [{ origem, destino, rgs:[{rg, desc}], hora, operador }] · info: { titulo, data, operador }
   Uma linha por RG, em colunas: A local de origem · B RG · C local de destino (é o que vai para o PuTTY);
   D e E trazem o nome dos locais; o cartão de identificação fica à direita (H:I). */
RG.xlsx = function(blocos, info, nome){
  var ws = {}, merges = [], r = 1, totalRgs = 0, temDesc = false;
  function cel(rr, cc, v, s){ ws[XLSX.utils.encode_cell({ r: rr, c: cc })] = { v: v == null ? '' : String(v), t: 's', s: s }; }
  blocos.forEach(function(b){ b.rgs.forEach(function(x){ if(x.desc) temDesc = true; }); });
  var cab = est(AZUL, 'FFFFFF', { font: { bold: true, sz: 11 }, alignment: { horizontal: 'center' } });
  ['Local de origem', 'RG', 'Local de destino', 'Nome do local de origem', 'Nome do local de destino'].concat(temDesc ? ['Item'] : []).forEach(function(t, i){ cel(0, i, t, cab); });
  var altura = [{ hpt: 26 }];
  function nomeTxt(raw){ var n = RG.nomeLocal(raw); return n ? n.d + (n.c ? '  ·  ' + n.c : '') : ''; }
  blocos.forEach(function(b){
    var o = RG.localNorm(b.origem), d = RG.localNorm(b.destino), no = nomeTxt(b.origem), nd = nomeTxt(b.destino);
    b.rgs.forEach(function(x, i){
      var z = (r % 2) ? 'FFFFFF' : CINZA;
      cel(r, 0, o, est('E8ECF7', AZUL, { font: { name: 'Consolas', sz: 11, bold: true }, alignment: { horizontal: 'center' } }));
      cel(r, 1, x.rg, est(z, LARANJA, { font: { name: 'Consolas', sz: 11, bold: true }, alignment: { horizontal: 'center' } }));
      cel(r, 2, d, est('FFEDE7', 'B33700', { font: { name: 'Consolas', sz: 11, bold: true }, alignment: { horizontal: 'center' } }));
      cel(r, 3, no, est(z, TEXTO)); cel(r, 4, nd, est(z, TEXTO));
      if(temDesc) cel(r, 5, x.desc || '', est(z, TEXTO));
      altura[r] = { hpt: 20 }; r++; totalRgs++;
    });
  });
  /* cartão de identificação, à direita (colunas H:I) */
  var c0 = temDesc ? 7 : 6;
  var topo = est(AZUL, 'FFFFFF', { font: { bold: true, sz: 14 }, alignment: { horizontal: 'center' } });
  cel(0, c0, 'OFICINA LDM · RG REVERSA', topo); cel(0, c0 + 1, '', topo); merges.push({ s: { r: 0, c: c0 }, e: { r: 0, c: c0 + 1 } });
  var sub = est(LARANJA, 'FFFFFF', { font: { bold: true }, alignment: { horizontal: 'center' } });
  cel(1, c0, info.titulo || 'Movimentação de RGs', sub); cel(1, c0 + 1, '', sub); merges.push({ s: { r: 1, c: c0 }, e: { r: 1, c: c0 + 1 } });
  var rot = est(CINZA, '6B7280', { font: { bold: true, sz: 10 } }), val = est('FFFFFF', TEXTO, { font: { bold: true } });
  [['Data', info.data || ''], ['Operador', info.operador || ''], ['Total de RGs', totalRgs]].forEach(function(p, i){
    cel(2 + i, c0, p[0], rot); cel(2 + i, c0 + 1, p[1], val);
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(r, 6) - 1, c: c0 + 1 } });
  ws['!cols'] = [{ wch: 20 }, { wch: 22 }, { wch: 20 }, { wch: 34 }, { wch: 34 }].concat(temDesc ? [{ wch: 34 }] : []).concat([{ wch: 3 }, { wch: 22 }, { wch: 22 }]);
  ws['!merges'] = merges; ws['!rows'] = altura;
  ws['!autofilter'] = { ref: 'A1:' + XLSX.utils.encode_col(temDesc ? 5 : 4) + Math.max(r, 2) };
  var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Movimentação');
  XLSX.writeFile(wb, nome);
};
})();
