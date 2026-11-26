/* Aviso "Nova versão disponível" — o mesmo em todos os apps da Oficina LDM.
   Como funciona: cada deploy grava o commit em /version.js (pages.yml). O app anota o
   commit com que abriu e confere de novo a cada 5 minutos e sempre que a aba volta ao foco;
   se mudou, mostra a barra "Nova versão disponível — Atualizar agora". Não recarrega sozinho
   (ninguém perde o que estava fazendo). Se o app já tem uma barra .atualiza-bar na página,
   usa a dela; senão, cria uma igual à da Central.
   Uso: <script src="../vendor/atualizacao.js" defer></script> no index.html do app. */
(function(){
  'use strict';
  if(window.__ldmAtualiza) return;
  window.__ldmAtualiza = true;
  var tag = document.currentScript, url;
  try { url = new URL('../version.js', tag.src).href; } catch(e){ return; }
  var base = null, avisado = false;

  function lerCommit(){
    return fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), {cache: 'no-store'})
      .then(function(r){ return r.ok ? r.text() : Promise.reject(new Error('http ' + r.status)); })
      .then(function(t){ var m = /commit:\s*'([^']+)'/.exec(t); return m ? m[1] : null; });
  }
  function barra(){
    var b = document.querySelector('.atualiza-bar');
    if(b) return b;
    b = document.createElement('div');
    b.className = 'atualiza-bar ldm-atualiza';
    b.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9998;display:flex;align-items:center;gap:12px;background:#0B1230;color:#fff;padding:10px 14px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.28);font:12.5px Inter,system-ui,sans-serif;';
    b.innerHTML = '<span>Nova versão disponível.</span><button type="button" style="background:#FE5000;color:#fff;border:none;border-radius:7px;padding:6px 12px;font:800 12px Inter,system-ui,sans-serif;cursor:pointer">Atualizar agora</button>';
    b.querySelector('button').addEventListener('click', function(){ location.reload(); });
    document.body.appendChild(b);
    return b;
  }
  function mostrar(){ avisado = true; var b = barra(); b.hidden = false; b.style.display = b.classList.contains('ldm-atualiza') ? 'flex' : b.style.display; }
  function checar(){
    if(avisado || document.hidden) return;
    lerCommit().then(function(c){
      if(!c || c === 'local') return;      /* rodando local, sem deploy */
      if(base === null){ base = c; return; }
      if(c !== base) mostrar();
    }).catch(function(){ /* sem internet agora — tenta de novo depois */ });
  }
  checar();
  setInterval(checar, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) checar(); });
  window.addEventListener('online', checar);
})();
