/* =========================================================================
   Pasta conectada da QRY410 — alimenta a aba NET (fluxo automático).
   -------------------------------------------------------------------------
   Mesma ideia do Inventário Rotativo: o navegador guarda a permissão da pasta
   onde a QRY410 é atualizada e o app passa a ler o arquivo sozinho (a cada
   abertura e a cada 15 minutos), sem importar à mão.
   Isto NÃO mexe no fechamento da controladoria: a base do fechamento continua
   sendo a importada manualmente. Os dados da pasta ficam num banco só deles
   (ldm-net-fluxo), neste navegador.
   Só funciona em Chrome/Edge no computador (File System Access API).
   ========================================================================= */
(function(){
'use strict';
var API = window.NET_API;
var SUPORTA = typeof window.showDirectoryPicker === 'function';
var PADRAO = /(^|[^0-9])410([^0-9]|$)|livro\s*fiscal|\bnet\b/i;
var NIVEIS = 4, MAX_DIRS = 600, CADA_MS = 15*60*1000;
var P = {handle:null, perm:'prompt', ultimo:null, arquivo:null, ocupado:false, erro:null, varridoEm:null, timer:null, iniciado:false};
var DB = null;

function esc(s){ return API.esc(s); }
function quando(ms){ var d = new Date(ms); return d.toLocaleDateString('pt-BR')+' '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); }

/* ---------- banco próprio ---------- */
function abreDB(){
  if(DB) return Promise.resolve(DB);
  return new Promise(function(res){
    try {
      var rq = indexedDB.open('ldm-net-fluxo', 1);
      rq.onupgradeneeded = function(){
        var d = rq.result;
        ['cfg','dados','det'].forEach(function(n){ if(!d.objectStoreNames.contains(n)) d.createObjectStore(n); });
      };
      rq.onsuccess = function(){ DB = rq.result; res(DB); };
      rq.onerror = function(){ res(null); };
    } catch(e){ res(null); }
  });
}
function get(store, key){
  return abreDB().then(function(d){ return !d ? null : new Promise(function(res){
    var rq = d.transaction(store,'readonly').objectStore(store).get(key);
    rq.onsuccess = function(){ res(rq.result === undefined ? null : rq.result); }; rq.onerror = function(){ res(null); };
  }); });
}
function put(store, key, val){
  return abreDB().then(function(d){ return !d ? null : new Promise(function(res){
    var tx = d.transaction(store,'readwrite'); tx.objectStore(store).put(val, key);
    tx.oncomplete = function(){ res(true); }; tx.onerror = function(){ res(false); };
  }); });
}
function limpaDetalhes(){
  return abreDB().then(function(d){ return !d ? null : new Promise(function(res){
    var tx = d.transaction('det','readwrite'); tx.objectStore('det').clear(); tx.oncomplete = function(){ res(true); }; tx.onerror = function(){ res(false); };
  }); });
}

/* ---------- permissão e varredura ---------- */
function permissao(pedir){
  var h = P.handle;
  if(!h || !h.queryPermission) return Promise.resolve('granted');
  return h.queryPermission({mode:'read'}).then(function(st){
    if(st !== 'granted' && pedir) return h.requestPermission({mode:'read'});
    return st;
  });
}
async function varrer(){
  var achado = null, visitadas = 0;
  async function ler(dir, caminho, prof){
    if(visitadas++ > MAX_DIRS) return;
    var subs = [];
    for await (var entry of dir.values()){
      if(entry.kind === 'file'){
        if(!/\.xlsx?$/i.test(entry.name) || entry.name.indexOf('~$') === 0 || !PADRAO.test(entry.name)) continue;
        try {
          var f = await entry.getFile();
          if(!achado || f.lastModified > achado.file.lastModified) achado = {file:f, pasta:caminho};
        } catch(e){}
      } else if(entry.kind === 'directory' && prof > 0 && entry.name.charAt(0) !== '.' && entry.name.charAt(0) !== '~'){
        subs.push(entry);
      }
    }
    for(var k=0; k<subs.length; k++) await ler(subs[k], caminho+' › '+subs[k].name, prof-1);
  }
  await ler(P.handle, P.handle.name, NIVEIS);
  P.arquivo = achado; P.varridoEm = Date.now();
  return achado;
}

/* ---------- da planilha para o formato do painel ---------- */
function isoData(br){ var m = String(br||'').match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? m[3]+'-'+m[2]+'-'+m[1]+'T00:00:00' : ''; }
function isoDH(s){
  var m = String(s||'').match(/^(\d{2})\/(\d{2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return m ? m[3]+'-'+m[2]+'-'+m[1]+'T'+String(m[4]).padStart(2,'0')+':'+m[5]+':'+(m[6]||'00') : '';
}
function limpa(s){ return String(s==null?'':s).replace(/_x000d_/gi,'').replace(/\r/g,'').trim(); }
function construir(linhas){
  var fora = (API.cfg().depositosFora || []).map(Number);
  var idx = {m:{}, i:{}, d:{}, o:{}}, listas = {m:[], i:[], d:[], o:[]}, nomes = {}, tuplas = {}, det = {};
  function id(tipo, v){ var t = idx[tipo]; if(t[v] === undefined){ t[v] = listas[tipo].length; listas[tipo].push(v); } return t[v]; }
  linhas.forEach(function(r){
    var dep = parseInt(r.iddeposito, 10);
    if(fora.indexOf(dep) !== -1) return;
    var item = limpa(r.item), obs = limpa(r.observacaowms) || limpa(r.observacao), depNome = limpa(r.nomedeposito);
    if(!item || !r.mes) return;
    id('m', r.mes); id('i', item); id('d', depNome); id('o', obs);
    if(r.nome && !nomes[item]) nomes[item] = limpa(r.nome);
    var k = r.mes+'|'+item+'|'+depNome+'|'+obs, t = tuplas[k] || (tuplas[k] = {m:r.mes, i:item, d:depNome, o:obs, gp:0, pp:0, q:0});
    if(r.vl > 0) t.gp += r.vl; else t.pp += r.vl;
    t.q += r.qtd;
    (det[r.mes] = det[r.mes] || []).push({item:item, dt:isoData(r.dtmov), dh:isoDH(r.datahora), doc:limpa(r.numdoc), usuario:limpa(r.usuario),
      obs:obs, deposito:depNome, depto:limpa(r.nomedepto), qtd:r.qtd, valor:r.vl});
  });
  // índices 1..N na ordem alfabética, como a função do servidor
  ['m','i','d','o'].forEach(function(tp){ listas[tp].sort(); idx[tp] = {}; listas[tp].forEach(function(v,j){ idx[tp][v] = j+1; }); });
  var out = Object.keys(tuplas).map(function(k){
    var t = tuplas[k];
    return [idx.m[t.m], idx.i[t.i], idx.d[t.d], idx.o[t.o], Math.round(t.gp*100)/100, Math.round(t.pp*100)/100, Math.round(t.q)];
  });
  return {dados:{meses:listas.m, itens:listas.i, depositos:listas.d, obs:listas.o, nomes:nomes, linhas:out}, det:det};
}
function esperaXLSX(){
  return new Promise(function(res, rej){
    var n = 0; (function tenta(){ if(typeof XLSX !== 'undefined') return res(); if(++n > 100) return rej(new Error('leitor de planilhas não carregou')); setTimeout(tenta, 100); })();
  });
}

/* ---------- sincronização ---------- */
async function sincronizar(forcar){
  if(!P.handle || P.ocupado) return null;
  if(await permissao(false) !== 'granted'){ P.perm = 'prompt'; render(); return null; }
  P.perm = 'granted'; P.ocupado = true; P.erro = null; render();
  try {
    var a = await varrer();
    if(!a){ P.erro = 'Nenhuma planilha da QRY410 encontrada na pasta.'; return null; }
    var u = P.ultimo;
    if(!forcar && u && u.nome === a.file.name && u.modificadoEm === a.file.lastModified) return null;
    await esperaXLSX();
    var ex = API.extraiLinhas(await API.lePlanilha(a.file));
    if(!ex.linhas.length){ P.erro = 'A planilha "'+a.file.name+'" não tem linhas de Lógica 301/302.'; return null; }
    var ds = construir(ex.linhas);
    await limpaDetalhes();
    for(var m in ds.det) await put('det', m, ds.det[m]);
    P.ultimo = {nome:a.file.name, modificadoEm:a.file.lastModified, importadoEm:Date.now(), linhas:ex.linhas.length};
    await put('dados', 'fluxo', {dados:ds.dados, meta:P.ultimo});
    await put('cfg', 'ultimo', P.ultimo);
    return montaRetorno(ds.dados, P.ultimo);
  } catch(e){ P.erro = 'Não consegui ler a planilha: '+(e && e.message || e); return null; }
  finally { P.ocupado = false; render(); }
}
function montaRetorno(dados, meta){
  return {dados:dados, txt:'pasta · '+meta.nome+' · '+quando(meta.modificadoEm)};
}
function agendar(){
  if(P.timer || !P.handle) return;
  P.timer = setInterval(function(){
    sincronizar(false).then(function(r){ if(r && window.NETDASH) window.NETDASH.usarDados(r); }).catch(function(){});
  }, CADA_MS);
}

/* ---------- ações ---------- */
async function conectar(){
  if(!SUPORTA) return;
  try {
    // mesmo "id" do Inventário: o seletor já abre na pasta que ele usa
    var h = await window.showDirectoryPicker({mode:'read', id:'inv-bases'});
    P.handle = h; P.perm = 'granted'; P.erro = null; await put('cfg', 'handle', h);
    agendar(); render();
    var r = await sincronizar(true);
    if(r && window.NETDASH) window.NETDASH.usarDados(r);
  } catch(e){
    if(e && e.name === 'AbortError') return;
    P.erro = 'Não consegui abrir a pasta ('+(e && e.name || 'erro')+'). Se falar em política, o TI desligou esse recurso no Edge.'; render();
  }
}
async function reautorizar(){
  P.perm = await permissao(true); render();
  if(P.perm === 'granted'){ var r = await sincronizar(true); if(r && window.NETDASH) window.NETDASH.usarDados(r); }
}
async function desconectar(){
  P.handle = null; P.arquivo = null; P.ultimo = null; P.erro = null;
  if(P.timer){ clearInterval(P.timer); P.timer = null; }
  await put('cfg', 'handle', null); await put('cfg', 'ultimo', null); await put('dados', 'fluxo', null); await limpaDetalhes();
  render();
  if(window.NETDASH) window.NETDASH.usarDados(null);
}

/* ---------- tela (dentro de Configurações) ---------- */
function render(){
  var el = document.getElementById('pasta-corpo'); if(!el) return;
  var h = '<div class="painel"><div class="painel-cab"><div><h3>Pasta conectada</h3></div></div><div class="pasta-n">';
  if(!SUPORTA){
    h += '<p class="muted">Este navegador não permite conectar pasta. Use o Chrome ou o Edge no computador.</p>';
  } else if(!P.handle){
    h += '<p class="muted">Conecte a pasta onde a QRY410 é atualizada. A aba NET passa a ler o arquivo sozinha.</p>'
      + (P.erro ? '<p class="pasta-erro">'+esc(P.erro)+'</p>' : '')
      + '<div class="pasta-acoes"><button class="btn" type="button" data-pn="conectar">Conectar pasta</button></div>';
  } else if(P.perm !== 'granted'){
    h += '<p class="muted">O navegador pede para confirmar o acesso a <strong>'+esc(P.handle.name)+'</strong>.</p>'
      + '<div class="pasta-acoes"><button class="btn" type="button" data-pn="permitir">Permitir acesso</button><button class="btn sec" type="button" data-pn="desconectar">Desconectar</button></div>';
  } else {
    var a = P.arquivo, u = P.ultimo;
    h += '<table class="tab pasta-tab"><tbody>'
      + '<tr><td>Pasta</td><td><strong>'+esc(P.handle.name)+'</strong></td></tr>'
      + '<tr><td>Arquivo</td><td>'+(a ? esc(a.file.name)+'<span class="muted pasta-cam">'+esc(a.pasta)+'</span>' : '<span class="muted">não encontrado</span>')+'</td></tr>'
      + '<tr><td>Modificado</td><td>'+(a ? quando(a.file.lastModified) : '—')+'</td></tr>'
      + '<tr><td>Lido no app</td><td>'+(u ? quando(u.importadoEm)+' · '+new Intl.NumberFormat('pt-BR').format(u.linhas||0)+' linhas' : '—')+'</td></tr>'
      + '</tbody></table>'
      + (P.erro ? '<p class="pasta-erro">'+esc(P.erro)+'</p>' : '')
      + '<div class="pasta-acoes"><button class="btn" type="button" data-pn="atualizar"'+(P.ocupado?' disabled':'')+'>'+(P.ocupado?'Lendo…':'Atualizar agora')+'</button><button class="btn sec" type="button" data-pn="desconectar">Desconectar</button></div>';
  }
  el.innerHTML = h+'</div></div>';
}
document.addEventListener('click', function(e){
  var b = e.target.closest('[data-pn]'); if(!b) return;
  var a = b.dataset.pn;
  if(a === 'conectar') conectar();
  else if(a === 'permitir') reautorizar();
  else if(a === 'desconectar') desconectar();
  else if(a === 'atualizar') sincronizar(true).then(function(r){ if(r && window.NETDASH) window.NETDASH.usarDados(r); });
});

window.NETPASTA = {
  suporta: SUPORTA,
  conectada: function(){ return !!P.handle && P.perm === 'granted'; },
  render: render,
  /* ao entrar no app: recupera a pasta guardada e, se o navegador já deixa, lê sozinho */
  iniciar: async function(){
    if(P.iniciado) return; P.iniciado = true;
    if(!SUPORTA) return;
    try {
      P.handle = await get('cfg', 'handle'); P.ultimo = await get('cfg', 'ultimo');
      if(!P.handle) return;
      P.perm = await permissao(false); agendar(); render();
      if(P.perm === 'granted'){ var r = await sincronizar(false); if(r && window.NETDASH) window.NETDASH.usarDados(r); }
    } catch(e){ P.erro = String(e && e.message || e); }
  },
  sincronizar: sincronizar,
  dadosLocais: async function(){
    var r = await get('dados', 'fluxo');
    return r && r.dados ? montaRetorno(r.dados, r.meta) : null;
  },
  detalhe: async function(mes){ return (await get('det', mes)) || []; },
  _construir: construir
};
})();
