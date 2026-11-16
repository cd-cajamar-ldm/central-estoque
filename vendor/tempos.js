/* Modo de medição: só liga quando o endereço tem ?tempos=1 (nada muda para o uso normal).
   Mostra, numa caixa no canto da tela, quanto tempo cada etapa da abertura levou e quais arquivos/consultas foram
   mais lentos — para descobrir onde o tempo está indo. Nada sai do aparelho: os números só aparecem na tela. */
(function(){
  if(!/[?&]tempos(=|&|$)/.test(location.search)) return;
  var T = { gate: null, carregando: null, longas: 0, maiorLonga: 0, visto: false };
  var s = function(ms){ return ms == null ? '—' : (ms / 1000).toFixed(1).replace('.', ',') + ' s'; };
  try {
    new PerformanceObserver(function(l){ l.getEntries().forEach(function(e){ T.longas += e.duration; if(e.duration > T.maiorLonga) T.maiorLonga = e.duration; }); }).observe({ type: 'longtask', buffered: true });
  } catch(e){}
  function curto(u){ try { var x = new URL(u); return (x.hostname === location.hostname ? '' : x.hostname + '/') + x.pathname.split('/').slice(-2).join('/'); } catch(e){ return u; } }
  function monta(){
    var nav = (performance.getEntriesByType('navigation')[0]) || {};
    var fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime;
    var res = performance.getEntriesByType('resource').slice().sort(function(a, b){ return b.duration - a.duration; }).slice(0, 6);
    var linhas = [
      'MEDIÇÃO DE ABERTURA · ' + location.pathname,
      'primeira imagem na tela: ' + s(fcp),
      'página carregada (todos os arquivos): ' + s(nav.loadEventEnd || null),
      'tela de acesso liberada: ' + s(T.gate),
      'texto "Carregando" sumiu: ' + s(T.carregando),
      'processador travado (soma): ' + s(T.longas) + ' · maior trava: ' + s(T.maiorLonga),
      'agora: ' + s(performance.now()),
      '— mais lentos —'
    ];
    res.forEach(function(r){ linhas.push(s(r.duration) + '  ' + curto(r.name)); });
    return linhas.join('\n');
  }
  function painel(){
    var el = document.getElementById('ldmTempos');
    if(!el){
      el = document.createElement('pre'); el.id = 'ldmTempos';
      el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;margin:0;max-width:min(560px,96vw);background:#0B1230;color:#DDE3FA;border:2px solid #FE5000;border-radius:10px;padding:10px 12px;font:12px/1.45 Consolas,monospace;white-space:pre-wrap;box-shadow:0 10px 30px rgba(0,0,0,.5)';
      document.body.appendChild(el);
    }
    el.textContent = monta();
  }
  function observa(){
    var g = document.getElementById('telaAcesso');
    var temGate = !!g;
    var vigia = setInterval(function(){
      var agora = performance.now();
      if(temGate && T.gate == null && (g.classList.contains('escondida') || getComputedStyle(g).display === 'none')) T.gate = agora;
      var txt = document.body ? document.body.innerText : '';
      if(/Carregando/i.test(txt)) T.visto = true;
      else if(T.visto && T.carregando == null) T.carregando = agora;
      painel();
      if(agora > 60000) clearInterval(vigia);
    }, 300);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observa); else observa();
})();
