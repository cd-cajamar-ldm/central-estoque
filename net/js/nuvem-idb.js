/* ============================================================
   Dados do app guardados no servidor (Supabase: public.app_dados).
   Serve para apps que guardam as importações só no IndexedDB do navegador:
   se o navegador apagar os dados do site (ao fechar, modo privado, política
   da empresa), a última importação volta sozinha do servidor.

   Como funciona
   - Cada "store" do IndexedDB é uma unidade. Vai para o servidor em partes
     (parte 1..N com as linhas; a parte 0 é o cabeçalho e entra por último).
   - Ao abrir o app: se o servidor tem uma versão que este navegador ainda não
     viu, ela vence e substitui o store local; se o navegador tem algo que o
     servidor não tem (primeira vez) ou acabou de importar, sobe.
   - Depois de baixar, o app recarrega sozinho (se estava vazio) ou avisa.
   - Quem só visualiza (LDM_SOMENTE_LEITURA) lê, mas nunca grava.
   Configuração (cada app define window.LDM_NUVEM_CFG):
     { app:'net', dbName:'ldm-net', stores:['meses'] }
   Depois de uma importação o app chama LDM_NUVEM.marcar().
   ============================================================ */
(function(){
'use strict';
var N = window.LDM_NUVEM = {};
var TAB = 'app_dados', LIM = 600000, PAG = 5;
var tentativas = 0;
var cfg = null, DEFS = {}, ST = null, ocupado = false, timer = null, ui = null, agendado = null, trouxeAvisado = false;

function lsKey(){ return 'ldm-nuvem-' + cfg.app; }
function carrega(){ try { ST = JSON.parse(localStorage.getItem(lsKey()) || '{}') || {}; } catch(e){ ST = {}; } ST.known = ST.known || {}; ST.count = ST.count || {}; ST.sujo = ST.sujo || {}; }
function guarda(){ try { localStorage.setItem(lsKey(), JSON.stringify(ST)); } catch(e){} }
function pad(n){ return (n < 10 ? '0' : '') + n; }
function quando(t){ var d = new Date(t); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function msgErro(e){
  var m = (e && e.message) || String(e);
  return /app_dados|relation|does not exist|schema cache/i.test(m) ? 'a tabela app_dados ainda não existe no Supabase' : m;
}

/* ---------- IndexedDB cru (não depende do código do app) ---------- */
function abre(){
  return new Promise(function(res, rej){
    var rq = indexedDB.open(cfg.dbName);
    /* se o banco ainda não existe, NÃO cria um vazio (quebraria a criação correta pelo app) */
    rq.onupgradeneeded = function(e){ try { e.target.transaction.abort(); } catch(x){} };
    rq.onsuccess = function(){ res(rq.result); };
    rq.onerror = function(){ rej(new Error('o banco local ainda não foi criado')); };
    rq.onblocked = function(){ rej(new Error('banco local ocupado')); };
  });
}
function enc(v){
  return JSON.stringify(v, function(k, val){ var raw = this[k]; if(raw instanceof Date) return { $d: raw.toISOString() }; return val; });
}
function dec(txt){
  return JSON.parse(txt, function(k, val){ if(val && typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 1 && typeof val.$d === 'string') return new Date(val.$d); return val; });
}
function doApp(nome, chave){
  var pf = DEFS[nome] && DEFS[nome].prefixos; if(!pf) return true;
  return typeof chave === 'string' && pf.some(function(p){ return chave.indexOf(p) === 0; });
}
function contar(db, nome){
  return new Promise(function(res, rej){
    if(!db.objectStoreNames.contains(nome)) return res(0);
    var st = db.transaction(nome, 'readonly').objectStore(nome);
    if(DEFS[nome] && DEFS[nome].prefixos){
      var k = st.getAllKeys(); k.onsuccess = function(){ res((k.result || []).filter(function(x){ return doApp(nome, x); }).length); }; k.onerror = function(){ rej(k.error); };
      return;
    }
    var r = st.count();
    r.onsuccess = function(){ res(r.result || 0); }; r.onerror = function(){ rej(r.error); };
  });
}
function lerStore(db, nome){
  return new Promise(function(res, rej){
    var st = db.transaction(nome, 'readonly').objectStore(nome), kp = st.keyPath;
    if(kp != null){
      var r = st.getAll(); r.onsuccess = function(){ res({ kp: kp, linhas: (r.result || []).filter(function(l){ return doApp(nome, l && l.key); }) }); }; r.onerror = function(){ rej(r.error); };
    } else {
      var out = [], c = st.openCursor();
      c.onsuccess = function(e){ var cur = e.target.result; if(cur){ out.push({ k: cur.key, v: cur.value }); cur.continue(); } else res({ kp: null, linhas: out }); };
      c.onerror = function(){ rej(c.error); };
    }
  });
}
function substituir(db, nome, kp, linhas){
  return new Promise(function(res, rej){
    var tx = db.transaction(nome, 'readwrite'), st = tx.objectStore(nome);
    if(!(DEFS[nome] && DEFS[nome].prefixos)) st.clear();   /* store compartilhado: só soma as chaves deste app */
    linhas.forEach(function(l){ if(kp != null) st.put(l); else st.put(l.v, l.k); });
    tx.oncomplete = function(){ res(); }; tx.onerror = function(){ rej(tx.error); }; tx.onabort = function(){ rej(tx.error || new Error('gravação local cancelada')); };
  });
}

/* ---------- servidor ---------- */
function metasRemotas(){
  return window.ldmSupa.from(TAB).select('chave,versao,meta,atualizado_em,atualizado_por').eq('app', cfg.app).eq('parte', 0).order('atualizado_em', { ascending: false }).then(function(r){
    if(r.error) throw r.error;
    var m = {}; (r.data || []).forEach(function(x){ if(!m[x.chave]) m[x.chave] = x; }); return m;
  });
}
function baixar(nome, versao){
  var linhas = [];
  function pag(ini){
    return window.ldmSupa.from(TAB).select('parte,dados').eq('app', cfg.app).eq('chave', nome).eq('versao', versao).gt('parte', 0).order('parte').range(ini, ini + PAG - 1).then(function(r){
      if(r.error) throw r.error;
      (r.data || []).forEach(function(x){ (x.dados || []).forEach(function(l){ linhas.push(l); }); });
      return (r.data && r.data.length === PAG) ? pag(ini + PAG) : null;
    });
  }
  return pag(0).then(function(){ return dec(JSON.stringify(linhas)); });
}
function dividir(linhas){
  var partes = [], atual = [], tam = 0;
  linhas.forEach(function(l){
    var t = enc(l).length;
    if(atual.length && tam + t > LIM){ partes.push(atual); atual = []; tam = 0; }
    atual.push(l); tam += t;
  });
  if(atual.length) partes.push(atual);
  return partes;
}
function publicar(db, nome){
  var versao = new Date().toISOString(), lido, partes;
  return lerStore(db, nome).then(function(l){
    lido = l; partes = dividir(l.linhas.map(function(x){ return JSON.parse(enc(x)); }));
    return partes.reduce(function(p, dados, i){
      return p.then(function(){ return window.ldmSupa.from(TAB).insert({ app: cfg.app, chave: nome, versao: versao, parte: i + 1, dados: dados }).then(function(r){ if(r.error) throw r.error; }); });
    }, Promise.resolve());
  }).then(function(){
    /* o cabeçalho entra por último: é ele que marca a gravação como completa */
    return window.ldmSupa.from(TAB).insert({ app: cfg.app, chave: nome, versao: versao, parte: 0, meta: { partes: partes.length, linhas: lido.linhas.length, kp: lido.kp } }).then(function(r){ if(r.error) throw r.error; });
  }).then(function(){
    return window.ldmSupa.from(TAB).delete().eq('app', cfg.app).eq('chave', nome).neq('versao', versao).then(function(r){ if(r.error) throw r.error; });
  }).then(function(){
    ST.known[nome] = versao; ST.count[nome] = lido.linhas.length; delete ST.sujo[nome]; ST.em = Date.now(); guarda();
  });
}

/* ---------- sincronização ---------- */
function somenteLeitura(){ return !!window.LDM_SOMENTE_LEITURA; }
function sincronizar(inicial){
  if(ocupado) return Promise.resolve();
  ocupado = true; estado('sync');
  var db, trouxe = [];
  return abre().then(function(d){ db = d; return metasRemotas(); }).then(function(metas){
    return cfg.stores.reduce(function(p, nome){
      return p.then(function(){
        if(!db.objectStoreNames.contains(nome)) return;
        return contar(db, nome).then(function(local){
          var R = metas[nome];
          if(!R){ if(local > 0 && !somenteLeitura()) return publicar(db, nome); ST.count[nome] = local; return; }
          if(ST.sujo[nome] && !somenteLeitura()) return publicar(db, nome);
          if(R.versao !== ST.known[nome]){
            return baixar(nome, R.versao).then(function(linhas){
              return substituir(db, nome, R.meta && R.meta.kp != null ? R.meta.kp : null, linhas).then(function(){
                ST.known[nome] = R.versao; ST.count[nome] = linhas.length; ST.em = Date.parse(R.atualizado_em) || Date.now();
                trouxe.push({ nome: nome, tinhaLocal: local > 0 });
              });
            });
          }
          ST.count[nome] = local;
        });
      });
    }, Promise.resolve());
  }).then(function(){
    guarda(); ocupado = false; estado('ok');
    if(trouxe.length) aviso(trouxe, inicial);
  }).catch(function(e){
    ocupado = false;
    /* o app ainda está criando o banco local: tenta de novo daqui a pouco */
    if(/ainda não foi criado/.test(e && e.message) && tentativas++ < 6){ estado('sync'); setTimeout(function(){ sincronizar(inicial); }, 3000); return; }
    estado('erro', msgErro(e));
  }).then(function(){ try { if(db) db.close(); } catch(x){} });
}
/* Dados novos vieram do servidor: se este navegador estava vazio, recarrega uma vez para o app já mostrar tudo. */
function aviso(trouxe, inicial){
  var vazio = trouxe.every(function(t){ return !t.tinhaLocal; });
  var chave = 'ldm-nuvem-reload-' + cfg.app;
  if(inicial && vazio && !sessionStorage.getItem(chave)){ try { sessionStorage.setItem(chave, '1'); } catch(e){} location.reload(); return; }
  if(trouxeAvisado) return; trouxeAvisado = true;
  var b = document.createElement('div');
  b.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:999;background:#FE5000;color:#fff;padding:10px 14px;display:flex;gap:12px;align-items:center;justify-content:space-between;font:600 13px Inter,system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25)';
  b.innerHTML = '<span>Dados novos vieram do servidor.</span><button type="button" style="background:#fff;color:#FE5000;border:0;border-radius:8px;padding:8px 14px;font:700 13px Inter,system-ui,sans-serif">Atualizar a página</button>';
  b.querySelector('button').onclick = function(){ location.reload(); };
  document.body.appendChild(b);
}

/* ---------- envio depois de importar / alterar ---------- */
N.marcar = function(stores){
  if(!cfg || somenteLeitura()) return;
  (stores || cfg.stores).forEach(function(n){ ST.sujo[n] = true; });
  guarda(); estado('pend');
  clearTimeout(agendado); agendado = setTimeout(empurrar, 1500);
};
function empurrar(){
  if(ocupado){ agendado = setTimeout(empurrar, 1500); return Promise.resolve(); }
  var pend = cfg.stores.filter(function(n){ return ST.sujo[n]; });
  if(!pend.length || somenteLeitura()) return Promise.resolve();
  ocupado = true; estado('sync');
  var db;
  return abre().then(function(d){ db = d; return pend.reduce(function(p, n){ return p.then(function(){ return db.objectStoreNames.contains(n) ? publicar(db, n) : null; }); }, Promise.resolve()); })
    .then(function(){ ocupado = false; estado('ok'); })
    .catch(function(e){ ocupado = false; estado('erro', msgErro(e)); })
    .then(function(){ try { if(db) db.close(); } catch(x){} });
}
/* Mudança no número de registros (ex.: apagou um mês) também sobe. */
function vigia(){
  if(ocupado || somenteLeitura()) return;
  abre().then(function(db){
    return Promise.all(cfg.stores.map(function(n){ return contar(db, n).then(function(c){ if(ST.count[n] != null && c !== ST.count[n]) ST.sujo[n] = true; }); }))
      .then(function(){ try { db.close(); } catch(x){} });
  }).then(function(){ if(cfg.stores.some(function(n){ return ST.sujo[n]; })){ guarda(); empurrar(); } }).catch(function(){});
}

/* ---------- indicador na tela ---------- */
function estado(tipo, msg){
  if(!ui) return;
  var t = ui.querySelector('span');
  if(tipo === 'sync') t.textContent = '☁ Sincronizando…';
  else if(tipo === 'pend') t.textContent = '☁ Enviando…';
  else if(tipo === 'erro'){ t.textContent = '⚠ Servidor: ' + msg; ui.style.background = '#7A1F0A'; return; }
  else t.textContent = '☁ Guardado no servidor' + (ST.em ? ' · ' + quando(ST.em) : '');
  ui.style.background = '#0B1230';
}
function criaUI(){
  ui = document.createElement('div'); ui.id = 'ldmNuvemSt';
  ui.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:70;display:flex;gap:8px;align-items:center;background:#0B1230;color:#DDE3FA;border-radius:99px;padding:6px 8px 6px 12px;font:600 11px Inter,system-ui,sans-serif;box-shadow:0 8px 22px rgba(0,0,0,.35);max-width:calc(100vw - 24px)';
  ui.innerHTML = '<span></span><button type="button" data-a="sync" style="background:rgba(255,255,255,.14);color:#fff;border:0;border-radius:99px;padding:4px 10px;font:700 11px Inter,system-ui,sans-serif;cursor:pointer">Sincronizar</button><button type="button" data-a="sair" style="background:transparent;color:#AEB8E0;border:0;font:600 11px Inter,system-ui,sans-serif;cursor:pointer">Sair</button>';
  ui.addEventListener('click', function(e){
    var a = e.target.getAttribute && e.target.getAttribute('data-a');
    if(a === 'sync'){ trouxeAvisado = false; sincronizar(false); }
    if(a === 'sair'){ window.ldmSupa.auth.signOut().then(function(){ location.reload(); }); }
  });
  document.body.appendChild(ui);
}

N.iniciar = function(c){
  if(cfg) return;
  cfg = c; (c.stores || []).forEach(function(d, i){ if(typeof d === 'string') d = { nome: d }; DEFS[d.nome] = d; c.stores[i] = d.nome; });
  carrega(); criaUI(); estado('sync');
  try { if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch(e){}
  sincronizar(true).then(function(){ if(cfg.stores.some(function(n){ return ST.sujo[n]; })) empurrar(); });
  timer = setInterval(vigia, 60000);
  document.addEventListener('visibilitychange', function(){ if(document.hidden) vigia(); });
};
})();
