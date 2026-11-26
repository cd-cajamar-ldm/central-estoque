/* =============================================================
   PLAYER DE MANUAL — Oficina LDM
   Lê um manual (JSON) e anima cada etapa sobre os prints reais:
   cursor, clique, digitação, destaque e etiqueta. Vai embutido
   em cada manual exportado, então não depende de nada externo.

   Formato das ações (coordenadas em % do print: [x, y, larg, alt]):
     {tipo:'tela',     img, legenda}
     {tipo:'clique',   area, dir, realce, balao, legenda}
     {tipo:'digitar',  area, texto, balao, legenda}
     {tipo:'destacar', area, balao, legenda}
     {tipo:'escolher', area, opcoes, escolhida, balao, legenda}  (lista suspensa)
     {tipo:'tecla',    tecla, area?, balao, legenda}  (ENTER, F4, Ctrl+V…)
     {tipo:'cena',     modelo: separar|bipar|conferir, …}  (animação sem print)
   Toda ação aceita 'detalhe' (explicação longa). 'clique' aceita
   'marcar' (desenha a caixa marcada depois do clique).
   Textos aceitam {{chave}} — trocado pelo que o leitor preencheu no
   campo da etapa (ou pelo exemplo, na animação).
   ============================================================= */
(function (global) {
  'use strict';

  var GEAR = 'M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z';
  var IC = {
    prev: '<svg viewBox="0 0 16 16"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    next: '<svg viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pause: '<svg viewBox="0 0 16 16"><rect x="3.5" y="3" width="3" height="10" rx="1" fill="currentColor"/><rect x="9.5" y="3" width="3" height="10" rx="1" fill="currentColor"/></svg>',
    play: '<svg viewBox="0 0 16 16"><path d="M4.5 3v10l8-5z" fill="currentColor"/></svg>',
    again: '<svg viewBox="0 0 16 16"><path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5v2.8h2.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    wrench: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    back: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    cursor: '<svg width="24" height="30" viewBox="0 0 22 28"><path d="M2 2 L2 22 L7.5 17 L11 25 L14.5 23.5 L11 15.8 L18 15.8 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /* Marcadores tipo SENHA_STG / CAMINHO_DA_SUA_PASTA ficam destacados:
     é o que o leitor precisa trocar. */
  var MARCADOR = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
  function marca(htmlEscapado) {
    return htmlEscapado.replace(MARCADOR, function (m) { return '<span class="mp-mark">' + m + '</span>'; });
  }
  /* **negrito** e `código`, depois de escapar. */
  function inline(s) {
    var h = esc(s);
    h = h.replace(/`([^`]+)`/g, function (_, c) { return '<code>' + marca(c) + '</code>'; });
    h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    return h;
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function gear(cls) { return '<svg class="' + cls + '" viewBox="0 0 24 24" fill="currentColor"><path d="' + GEAR + '"/></svg>'; }
  function rivets() { return '<i class="mp-rv tl"></i><i class="mp-rv tr"></i><i class="mp-rv bl"></i><i class="mp-rv br"></i>'; }

  function mount(root, manual, opts) {
    opts = opts || {};
    var passos = (manual.passos || []).filter(Boolean);
    var imgs = manual.imagens || {};
    var leitor = {};           // valores que o leitor digitou nos campos
    var marcados = {};         // checklist: { 'passo:item': true }
    var speed = 1, paused = false, RUN = 0, current = 0;
    var T = 0;              // tempo do manual já decorrido na etapa atual (ms a 1x)
    var modo = opts.modo === 'treinar' ? 'treinar' : 'assistir';
    var DUR = [], BASE = [], TOTAL = 1;
    var CANCEL = {};
    var reduce = global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var temaKey = 'ldm-theme';

    /* ---------- estrutura ---------- */
    var logo = opts.logo ? '<img src="' + esc(opts.logo) + '" alt="">' : '<b>LDM</b>';
    root.innerHTML =
      '<div class="mp"><div class="mp-shell">' +
        '<aside class="mp-side">' +
          '<div class="mp-brand"><div class="mp-logo">' + logo + '</div><div><div class="mp-brand-name">OFICINA LDM</div><div class="mp-brand-sub">manual passo a passo</div></div></div>' +
          (opts.voltar ? '<a class="mp-back" href="' + esc(opts.voltar) + '">' + IC.back + '<span>' + esc(opts.voltarTexto || 'Voltar') + '</span></a>' : '') +
          '<div class="mp-side-label"><span>Ordem de serviço</span><span data-r="count"></span></div>' +
          '<ol class="mp-steps" data-r="steps"></ol>' +
          '<button class="mp-quiz-side" type="button" data-r="quizSide" hidden><span>🧠</span><b>Quiz final</b></button>' +
          '<div class="mp-side-foot">' +
            '<div>Loja do Mecânico &middot; Lugar de quem faz</div>' +
          '</div>' +
        '</aside>' +
        '<main class="mp-main">' +
          '<header class="mp-top">' +
            '<div class="mp-top-txt"><div class="mp-chips" data-r="chips"></div><h1 data-r="title"></h1><p data-r="desc"></p></div>' +
            '<div class="mp-top-act"><div class="mp-gears" aria-hidden="true">' + gear('mp-g1') + gear('mp-g2') + '</div>' +
            '<button class="mp-theme" type="button" data-r="theme" aria-label="Alternar tema claro/escuro"><i></i></button></div>' +
          '</header>' +
          '<div class="mp-regua" aria-hidden="true"><div class="mp-regua-ticks"></div><div class="mp-regua-fill" data-r="fill"></div><div class="mp-regua-marks" data-r="marks"></div></div>' +
          '<section class="mp-card mp-bench">' + rivets() +
            '<div class="mp-stage" data-r="stage" title="Clique para pausar ou continuar">' +
              '<div class="mp-frame" data-r="frame">' +
                '<div class="mp-ov" data-r="ov"><div class="mp-spot" data-r="spot"></div><div class="mp-tag" data-r="tag"></div><div class="mp-cursor" data-r="cursor">' + IC.cursor + '</div></div>' +
                '<div class="mp-hit" data-r="hit"></div>' +
              '</div>' +
              '<div class="mp-sua" data-r="sua">🎯 Sua vez!</div>' +
              '<div class="mp-fb" data-r="fb"></div>' +
              '<div class="mp-quiz" data-r="quiz"><div class="mp-quiz-card" data-r="quizCard"></div></div>' +
              '<div class="mp-door reset" data-r="door"><div class="mp-plate">' + rivets() + '<small>ETAPA</small><strong data-r="dn">01</strong><span data-r="dt"></span><em data-r="dp"></em></div></div>' +
              '<div class="mp-paused">PAUSADO · clique para continuar</div>' +
              '<div class="mp-done" data-r="done"><div class="mp-done-card">' +
                '<svg viewBox="0 0 74 74"><circle cx="37" cy="37" r="37" fill="#1F8A52"/><path d="M22 38 L33 49 L53 27" fill="none" stroke="#fff" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                '<h4>Serviço concluído!</h4><p data-r="doneMsg"></p><p class="mp-score" data-r="score" hidden></p>' +
                '<div class="mp-qbtns"><button class="mp-btn pri" type="button" data-r="toQuiz" hidden>🧠 Fazer o quiz</button>' +
                '<button class="mp-btn" type="button" data-r="again">' + IC.again + 'Ver de novo</button></div>' +
              '</div></div>' +
            '</div>' +
            '<div class="mp-ctrl">' +
              '<div class="mp-now"><span class="mp-now-ic">' + IC.wrench + '</span><span class="mp-now-box"><span class="mp-now-txt" data-r="say" aria-live="polite">Preparando…</span><span class="mp-now-det" data-r="det" hidden></span></span></div>' +
              '<div class="mp-mode" role="group" aria-label="Modo"><button type="button" data-modo="assistir">▶ Assistir</button><button type="button" data-modo="treinar">🎯 Treinar</button></div>' +
              '<div class="mp-speed" role="group" aria-label="Velocidade"><span>Velocidade</span>' +
                [['0.5', '0,5x'], ['0.75', '0,75x'], ['1', '1x'], ['1.5', '1,5x'], ['2', '2x']].map(function (v) {
                  return '<button type="button" data-sp="' + v[0] + '"' + (v[0] === '1' ? ' class="on"' : '') + '>' + v[1] + '</button>';
                }).join('') + '</div>' +
              '<span class="mp-time" data-r="time">0:00 / 0:00</span>' +
              '<div class="mp-btns">' +
                '<button class="mp-btn" type="button" data-r="prev" aria-label="Etapa anterior">' + IC.prev + '</button>' +
                '<button class="mp-btn pri" type="button" data-r="play"><span data-r="playIco">' + IC.pause + '</span><span data-r="playTxt">Pausar</span></button>' +
                '<button class="mp-btn" type="button" data-r="next" aria-label="Próxima etapa">' + IC.next + '</button>' +
                '<button class="mp-btn" type="button" data-r="replay">' + IC.again + '<span class="mp-lbl">Repetir etapa</span></button>' +
                '<button class="mp-btn" type="button" data-r="som" title="Som do bip">🔊</button>' +
              '</div>' +
            '</div>' +
          '</section>' +
          '<div class="mp-grid">' +
            '<section class="mp-card mp-box">' + rivets() + '<h3 data-r="k"></h3><h2 data-r="t"></h2><div class="mp-path" data-r="path"></div><ul class="mp-check" data-r="todo"></ul></section>' +
            '<section class="mp-card mp-box">' + rivets() + '<h3>Valores para copiar</h3><div class="mp-vals" data-r="vals"></div></section>' +
          '</div>' +
          '<footer class="mp-foot"><span><b>Loja do Mecânico</b> · Lugar de quem faz</span><span data-r="footR"></span></footer>' +
        '</main>' +
      '</div></div>';

    var R = {};
    root.querySelectorAll('[data-r]').forEach(function (el) { R[el.getAttribute('data-r')] = el; });
    var mp = root.querySelector('.mp');

    /* tema — mesma chave do Painel da Oficina */
    function setTema(dark) { mp.classList.toggle('mp-dark', dark); try { localStorage.setItem(temaKey, dark ? 'dark' : 'light'); } catch (e) {} }
    try { setTema(localStorage.getItem(temaKey) === 'dark'); } catch (e) {}
    R.theme.onclick = function () { setTema(!mp.classList.contains('mp-dark')); };

    /* cabeçalho */
    var chips = [];
    if (manual.sistema) chips.push('<span class="mp-chip hot">' + esc(manual.sistema) + '</span>');
    if (manual.ambiente) chips.push('<span class="mp-chip">Ambiente ' + esc(manual.ambiente) + '</span>');
    chips.push('<span class="mp-chip">' + passos.length + ' etapa' + (passos.length === 1 ? '' : 's') + '</span>');
    R.chips.innerHTML = chips.join('');
    aplicarFundo(R.stage, manual);
    R.title.textContent = manual.titulo || 'Manual sem título';
    R.desc.textContent = manual.descricao || '';
    R.desc.hidden = !manual.descricao;
    R.doneMsg.textContent = manual.conclusao || 'Todas as etapas foram feitas.';
    R.footR.textContent = 'Manual' + (manual.sistema ? ' · ' + manual.sistema : '') + (manual.ambiente ? ' ' + manual.ambiente : '') + (manual.autor ? ' · ' + manual.autor : '');
    R.count.textContent = passos.length;
    if (typeof document !== 'undefined' && manual.titulo && opts.setTitle !== false) document.title = manual.titulo;

    R.steps.innerHTML = passos.map(function (s, i) {
      return '<li><button class="mp-step" type="button" data-i="' + i + '"><span class="mp-step-n">' + pad(i + 1) + '</span><span><b>' + esc(s.titulo || 'Etapa ' + (i + 1)) + '</b><small>' + esc((s.caminho || []).join(' › ')) + '</small></span><span class="mp-step-ok">✓</span></button></li>';
    }).join('');
    R.marks.innerHTML = passos.map(function (_, i) { return '<span>' + (i + 1) + '</span>'; }).join('');

    if (!passos.length) {
      R.say.textContent = 'Este manual ainda não tem etapas.';
      return { destroy: function () { root.innerHTML = ''; } };
    }

    /* ---------- campos do leitor e textos ---------- */
    function campos() {
      var c = {};
      passos.forEach(function (p) { if (p.campo && p.campo.chave) c[p.campo.chave] = p.campo; });
      return c;
    }
    var CAMPOS = campos();
    function resolve(txt, paraAnimacao) {
      return String(txt == null ? '' : txt).replace(/\{\{\s*([\w-]+)\s*\}\}/g, function (_, k) {
        var v = (leitor[k] || '').trim().replace(/^"|"$/g, '').replace(/[\\\/]+$/, '');
        if (v) return v;
        var c = CAMPOS[k] || {};
        if (paraAnimacao) return c.exemplo || c.marcador || k.toUpperCase();
        return c.marcador || k.toUpperCase();
      });
    }

    /* ---------- motor de tempo ---------- */
    /* Cada wait(ms) consome ms de "tempo do manual" (medido a 1x). A
       velocidade só muda quão rápido esse tempo passa; é por ele que a
       régua anda, então ela acompanha a animação exatamente. */
    function wait(ms) {
      var id = RUN;
      return new Promise(function (res, rej) {
        var left = ms, last = performance.now();
        (function f(now) {
          if (id !== RUN) return rej(CANCEL);
          if (!paused) { var d = Math.min(left, (now - last) * speed); left -= d; T += d; }
          last = now;
          paintRegua();
          if (left <= 0) return res();
          requestAnimationFrame(f);
        })(last);
      });
    }
    function check() { /* lança se a etapa foi trocada */ return wait(0); }

    var CX = 92, CY = 92;
    function center(a, fx, fy) { return [a[0] + a[2] * (fx == null ? .5 : fx), a[1] + a[3] * (fy == null ? .5 : fy)]; }
    function moveTo(x, y) {
      CX = x; CY = y;
      R.cursor.style.left = x + '%'; R.cursor.style.top = y + '%';
      return wait(reduce ? 250 : 760);
    }
    function click(dir) {
      R.cursor.classList.add('down');
      var rp = document.createElement('div');
      rp.className = 'mp-rip' + (dir ? ' dir' : '');
      rp.style.left = CX + '%'; rp.style.top = CY + '%';
      R.ov.appendChild(rp);
      setTimeout(function () { rp.remove(); }, 700);
      return wait(170).then(function () { R.cursor.classList.remove('down'); return wait(170); });
    }
    function spot(a) {
      if (!a) { R.spot.classList.remove('on'); return; }
      var p = .6;
      R.spot.style.left = (a[0] - p) + '%'; R.spot.style.top = (a[1] - p * 1.5) + '%';
      R.spot.style.width = (a[2] + p * 2) + '%'; R.spot.style.height = (a[3] + p * 3) + '%';
      R.spot.classList.add('on');
    }
    function tag(a, text) {
      if (!a || !text) { R.tag.classList.remove('on'); return; }
      var below = a[1] < 14;
      R.tag.textContent = text;
      R.tag.classList.toggle('below', below);
      R.tag.style.left = Math.min(84, Math.max(16, a[0] + a[2] / 2)) + '%';
      R.tag.style.top = (below ? a[1] + a[3] : a[1]) + '%';
      R.tag.classList.remove('on'); void R.tag.offsetWidth; R.tag.classList.add('on');
    }
    /* Legenda curta + explicação detalhada opcional. Com explicação, a
       animação espera o tempo de leitura (aprox. 35 ms por letra). */
    function say(t, det) {
      spot(null); tag(null);
      if (!t && !det) return check();
      R.say.textContent = t || '';
      R.say.classList.remove('pop'); void R.say.offsetWidth; R.say.classList.add('pop');
      det = resolve(det || '', true).trim();
      R.det.textContent = det;
      R.det.hidden = !det;
      return wait(custoSay(t, det));
    }

    /* ---------- duração de cada ação (mesmos números das animações) ---------- */
    var MV = reduce ? 250 : 760, CL = 340;
    function custoSay(t, det) {
      if (!t && !det) return 0;
      det = resolve(det || '', true).trim();
      return 480 + (det ? Math.min(7000, 900 + det.length * 35) : 0);
    }
    function opcoesDe(acao) {
      var ops = Array.isArray(acao.opcoes) ? acao.opcoes.slice() : String(acao.opcoes || '').split('\n');
      ops = ops.map(function (o) { return String(o).trim(); }).filter(Boolean);
      var esc0 = String(acao.escolhida || '').trim() || ops[0] || '';
      var idx = ops.indexOf(esc0);
      if (idx < 0 && esc0) { ops.push(esc0); idx = ops.length - 1; }
      return { ops: ops, idx: Math.max(0, idx), valor: esc0 };
    }
    function custo(acao) {
      var s = custoSay(acao.legenda, acao.detalhe);
      switch (acao.tipo) {
        case 'tela': return s + 650;
        case 'clique': return s + MV + CL + ((acao.realce || acao.balao || acao.marcar) ? (acao.balao ? 1300 : 900) : 250);
        case 'digitar':
          var txt = resolve(acao.texto, true);
          return s + MV + CL + txt.length * (txt.length > 30 ? 26 : 55) + 350 + (acao.balao ? 1300 : 300);
        case 'destacar': return s + 1500;
        case 'escolher': return s + MV + CL + 350 + (opcoesDe(acao).idx + 1) * 220 + 300 + MV + CL + (acao.balao ? 1300 : 600);
        case 'tecla': return s + 1300 + (acao.balao ? 900 : 0);
        case 'cena': return s + custoCena(acao);
        default: return 0;
      }
    }
    function custoPasso(i) {
      var acoes = passos[i].acoes || [], t = primeiraTela(i), ini = t ? t.skip : 0;
      var total = reduce ? 250 : 2400;
      if (ini) total += custoSay(acoes[0].legenda, acoes[0].detalhe);
      acoes.slice(ini).forEach(function (a) { total += custo(a); });
      if (i < passos.length - 1) total += 1000;
      return total;
    }
    function medir() {
      var acc = 0;
      DUR = passos.map(function (_, i) { return custoPasso(i); });
      BASE = DUR.map(function (d) { var b = acc; acc += d; return b; });
      TOTAL = acc || 1;
      R.marks.querySelectorAll('span').forEach(function (s, i) { s.style.flex = DUR[i] + ' 1 0'; });
    }
    function mmss(ms) { var s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

    /* ---------- tela (print) ---------- */
    var imgEl = null;
    function setTela(id, instant) {
      var src = imgs[id];
      R.ov.querySelectorAll('.mp-fx').forEach(function (e) { e.remove(); });
      if (!src) return;
      var novo = new Image();
      novo.alt = '';
      novo.draggable = false;
      novo.src = src;
      var aplicar = function () {
        if (novo.naturalWidth) R.frame.style.setProperty('--ar', (novo.naturalWidth / novo.naturalHeight).toFixed(4));
      };
      if (novo.complete) aplicar(); else novo.onload = aplicar;
      var velho = imgEl;
      R.frame.insertBefore(novo, R.ov);
      imgEl = novo;
      if (velho) {
        if (instant || reduce) velho.remove();
        else { velho.classList.add('mp-old'); velho.style.opacity = '0'; setTimeout(function () { velho.remove(); }, 380); }
      }
    }
    function blurTypes() { R.ov.querySelectorAll('.mp-type').forEach(function (e) { e.classList.add('blur'); }); }
    /* Elementos que "transformam" o print (texto digitado, caixa marcada,
       lista aberta, opção escolhida). data-h/data-k guardam a altura (%) e o
       fator da fonte, para recalcular quando a janela muda de tamanho. */
    function fx(cls, a, k) {
      var el = document.createElement('div');
      el.className = 'mp-fx ' + cls;
      el.setAttribute('data-h', a[3]); el.setAttribute('data-k', k);
      el.style.fontSize = Math.max(8, R.frame.clientHeight * a[3] / 100 * k) + 'px';
      R.ov.insertBefore(el, R.spot);
      return el;
    }
    /* Cor do campo no print (amostra alguns pontos da área): o texto
       digitado aparece com o mesmo fundo — branco no Windows, cinza ou
       preto na tela do coletor. */
    var corCv = null;
    function corFundo(a) {
      if (!imgEl || !imgEl.naturalWidth) return null;
      try {
        corCv = corCv || document.createElement('canvas'); corCv.width = corCv.height = 1;
        var ctx = corCv.getContext('2d', { willReadFrequently: true }), cont = {}, melhor = null;
        [[.02, .2], [.5, .15], [.98, .2], [.02, .85], [.98, .85], [.75, .5]].forEach(function (f) {
          var sx = (a[0] + a[2] * f[0]) / 100 * imgEl.naturalWidth, sy = (a[1] + a[3] * f[1]) / 100 * imgEl.naturalHeight;
          ctx.clearRect(0, 0, 1, 1); ctx.drawImage(imgEl, sx, sy, 1, 1, 0, 0, 1, 1);
          var d = ctx.getImageData(0, 0, 1, 1).data, k = [d[0] >> 4, d[1] >> 4, d[2] >> 4].join(',');
          cont[k] = (cont[k] || 0) + 1;
          if (!melhor || cont[k] > cont[melhor.k]) melhor = { k: k, rgb: [d[0], d[1], d[2]] };
        });
        var c = melhor.rgb, lum = .299 * c[0] + .587 * c[1] + .114 * c[2];
        return { bg: 'rgb(' + c.join(',') + ')', fg: lum < 140 ? '#fff' : '#000', escuro: lum < 70 };
      } catch (e) { return null; }
    }
    function typeBox(a) {
      var el = fx('mp-type', a, .6);
      el.style.left = a[0] + '%'; el.style.top = a[1] + '%'; el.style.width = a[2] + '%'; el.style.height = a[3] + '%';
      var cor = corFundo(a);
      if (cor) { el.style.background = cor.bg; el.style.color = cor.fg; if (cor.escuro) el.classList.add('mp-term'); }
      return el;
    }
    function checkBox(a) {
      var el = fx('mp-chk', a, .62);
      el.style.left = (a[0] + .15) + '%'; el.style.top = (a[1] + a[3] / 2) + '%';
      return el;
    }

    /* ---------- ações ---------- */
    function run(acao) {
      if (modo === 'treinar' && INTERATIVO[acao.tipo]) return treinar(acao);
      var a = acao.area;
      switch (acao.tipo) {
        case 'tela':
          return say(acao.legenda, acao.detalhe).then(function () { setTela(acao.img); return wait(650); });
        case 'clique':
          return say(acao.legenda, acao.detalhe).then(function () {
            var c = center(a, acao.dir ? .25 : .5);
            return moveTo(c[0], c[1]);
          }).then(function () { blurTypes(); return click(acao.dir); }).then(function () {
            if (acao.marcar) checkBox(a);
            if (acao.realce || acao.balao || acao.marcar) { spot(a); tag(a, resolve(acao.balao, true)); return wait(acao.balao ? 1300 : 900); }
            return wait(250);
          });
        case 'escolher':
          var op = opcoesDe(acao), lista, ih = a[3] * .9;
          var acima = a[1] + a[3] + op.ops.length * ih > 98;
          var topo = acima ? a[1] - op.ops.length * ih : a[1] + a[3];
          return say(acao.legenda, acao.detalhe).then(function () {
            var c = center(a, .9);
            return moveTo(c[0], c[1]);
          }).then(function () { blurTypes(); return click(); }).then(function () {
            lista = fx('mp-ddl', a, .55);
            lista.style.left = a[0] + '%'; lista.style.top = topo + '%';
            lista.style.width = a[2] + '%'; lista.style.height = (op.ops.length * ih) + '%';
            lista.innerHTML = op.ops.map(function (o) { return '<div>' + esc(o) + '</div>'; }).join('');
            return wait(350);
          }).then(function () {
            var itens = lista.children, k = 0;
            function passo() {
              if (k > op.idx) return wait(300);
              for (var j = 0; j < itens.length; j++) itens[j].classList.toggle('hi', j === k);
              k++;
              return wait(220).then(passo);
            }
            return passo();
          }).then(function () {
            return moveTo(a[0] + a[2] * .4, topo + (op.idx + .5) * ih);
          }).then(function () { return click(); }).then(function () {
            lista.remove();
            var box = typeBox(a);
            box.classList.add('blur', 'mp-sel');
            box.innerHTML = '<span>' + esc(op.valor) + '</span><i>▾</i>';
            spot(a); tag(a, resolve(acao.balao, true));
            return wait(acao.balao ? 1300 : 600);
          });
        case 'digitar':
          var txt = resolve(acao.texto, true), box;
          return say(acao.legenda, acao.detalhe).then(function () {
            var c = center(a, .3);
            return moveTo(c[0], c[1]);
          }).then(function () { blurTypes(); return click(); }).then(function () {
            spot(a);
            box = typeBox(a);
            var per = txt.length > 30 ? 26 : 55, i = 0;
            function next() {
              if (i >= txt.length) return wait(350);
              box.textContent += txt[i++];
              box.scrollLeft = 1e4;
              return wait(per).then(next);
            }
            return next();
          }).then(function () {
            if (acao.balao) { tag(a, resolve(acao.balao, true)); return wait(1300); }
            return wait(300);
          });
        case 'destacar':
          return say(acao.legenda, acao.detalhe).then(function () {
            blurTypes(); spot(a); tag(a, resolve(acao.balao, true));
            return wait(1500);
          });
        case 'tecla':
          var kb, ka = a || [40, 68, 20, 8];
          return say(acao.legenda, acao.detalhe).then(function () {
            blurTypes();
            if (a) spot(a);
            kb = fx('mp-keys', [0, 0, 0, 7], .6);
            var embaixo = ka[1] + ka[3] + 14 < 98;
            kb.style.left = Math.min(85, Math.max(15, ka[0] + ka[2] / 2)) + '%';
            kb.style.top = (a ? (embaixo ? ka[1] + ka[3] + 2 : ka[1] - 13) : 72) + '%';
            kb.innerHTML = String(acao.tecla || 'ENTER').split('+').map(function (t) { return '<kbd>' + esc(t.trim()) + '</kbd>'; }).join('<b>+</b>');
            return wait(350);
          }).then(function () { kb.classList.add('down'); bip(900, .03); return wait(180); })
            .then(function () { kb.classList.remove('down'); return wait(170); })
            .then(function () { return wait(600); })
            .then(function () {
              if (acao.balao) { tag(a || [ka[0], 72, ka[2], 8], resolve(acao.balao, true)); return wait(900); }
            }).then(function () { kb.remove(); });
        case 'cena':
          return say(acao.legenda, acao.detalhe).then(function () {
            blurTypes(); spot(null); tag(null);
            R.ov.querySelectorAll('.mp-cena').forEach(function (e) { e.remove(); });
            if (!imgEl) R.frame.style.setProperty('--ar', '1.6');
            var el = fx('mp-cena', [0, 0, 100, 100], .035);
            return montarCena(el, acao, wait, bip);
          });
        default:
          return check();
      }
    }

    /* som do bip (Web Audio). O navegador só libera depois de um clique. */
    var AC = null, som = true;
    try { som = localStorage.getItem('ldm-manual-som') !== '0'; } catch (e) {}
    function audio() {
      if (!som) return null;
      try { AC = AC || new (global.AudioContext || global.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); return AC; } catch (e) { return null; }
    }
    function bip(freq, dur) {
      var ac = audio(); if (!ac || ac.state !== 'running') return;
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.value = freq || 2300; g.gain.value = .04;
      o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + (dur || .07));
    }
    function pintaSom() { R.som.textContent = som ? '🔊' : '🔇'; R.som.title = som ? 'Som ligado' : 'Som desligado'; }
    pintaSom();
    R.som.onclick = function () { som = !som; try { localStorage.setItem('ldm-manual-som', som ? '1' : '0'); } catch (e) {} pintaSom(); if (som) audio(); };
    root.addEventListener('pointerdown', function () { audio(); });

    /* ---------- painéis ---------- */
    function paintRegua() {
      var feito = current >= passos.length ? TOTAL : (BASE[current] || 0) + Math.min(T, DUR[current] || 0);
      R.fill.style.width = Math.min(100, feito / TOTAL * 100) + '%';
      R.marks.querySelectorAll('span').forEach(function (s, i) { s.classList.toggle('on', BASE[i] + DUR[i] <= feito + 1); });
      R.time.textContent = mmss(feito / speed) + ' / ' + mmss(TOTAL / speed);
    }
    function renderVals() {
      var s = passos[current];
      var h = '';
      if (s.campo && s.campo.chave) {
        h += '<div class="mp-val"><label class="mp-val-k" for="mp-campo">' + esc(s.campo.rotulo || 'Preencha') + '</label>' +
          '<input id="mp-campo" class="mp-input" type="text" spellcheck="false" data-chave="' + esc(s.campo.chave) + '" placeholder="' + esc(s.campo.exemplo ? 'ex.: ' + s.campo.exemplo : '') + '" value="' + esc(leitor[s.campo.chave] || '') + '">' +
          '<span class="mp-hint">Os valores abaixo se ajustam ao que você preencher.</span></div>';
      }
      var vals = s.valores || [];
      h += vals.map(function (v, k) {
        return '<div class="mp-val"><span class="mp-val-k">' + esc(v.rotulo) + '</span><div class="mp-val-v"><code data-vcode="' + k + '">' + marca(esc(resolve(v.valor))) + '</code><button class="mp-copy" type="button" data-copy="' + k + '">Copiar</button></div></div>';
      }).join('');
      if (!vals.length && !(s.campo && s.campo.chave)) h += '<p class="mp-empty">Nesta etapa não há valores para digitar.</p>';
      if (s.observacao) h += '<p class="mp-note">' + inline(s.observacao) + '</p>';
      R.vals.innerHTML = h;
    }
    function renderInfo() {
      var s = passos[current];
      R.k.textContent = 'Etapa ' + (current + 1) + ' de ' + passos.length;
      R.t.textContent = s.titulo || '';
      R.path.innerHTML = (s.caminho || []).map(function (p) { return '<span>' + esc(p) + '</span>'; }).join('<i>›</i>');
      R.path.hidden = !(s.caminho || []).length;
      R.todo.innerHTML = (s.instrucoes || []).map(function (t, k) {
        var key = current + ':' + k;
        return '<li><label><input type="checkbox" data-ck="' + key + '"' + (marcados[key] ? ' checked' : '') + '><span>' + inline(t) + '</span></label></li>';
      }).join('') || '<li class="mp-empty">Sem instruções escritas para esta etapa.</li>';
      renderVals();
      R.steps.querySelectorAll('.mp-step').forEach(function (b, k) {
        b.classList.toggle('on', k === current);
        b.classList.toggle('done', k < current);
      });
      var on = R.steps.querySelector('.mp-step.on');
      if (on && on.scrollIntoView && global.innerWidth <= 820) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
    R.todo.addEventListener('change', function (e) {
      var k = e.target.getAttribute('data-ck');
      if (k) marcados[k] = e.target.checked;
    });
    R.vals.addEventListener('click', function (e) {
      var b = e.target.closest('[data-copy]');
      if (!b) return;
      var txt = resolve(passos[current].valores[+b.getAttribute('data-copy')].valor);
      var ok = function () { b.textContent = 'Copiado'; b.classList.add('ok'); };
      var falha = function () {
        var r = document.createRange(); r.selectNodeContents(b.previousElementSibling);
        var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); b.textContent = 'Ctrl+C';
      };
      try { navigator.clipboard.writeText(txt).then(ok, falha); } catch (err) { falha(); }
      setTimeout(function () { b.textContent = 'Copiar'; b.classList.remove('ok'); }, 1600);
    });
    R.vals.addEventListener('input', function (e) {
      var k = e.target.getAttribute('data-chave');
      if (!k) return;
      leitor[k] = e.target.value;
      R.vals.querySelectorAll('[data-vcode]').forEach(function (c) {
        c.innerHTML = marca(esc(resolve(passos[current].valores[+c.getAttribute('data-vcode')].valor)));
      });
    });

    /* ---------- execução ---------- */
    function primeiraTela(i) {
      /* tela inicial da etapa: a 1ª ação 'tela' dela, senão a última das anteriores */
      var ac0 = passos[i].acoes || [];
      if (ac0[0] && ac0[0].tipo === 'tela') return { id: ac0[0].img, skip: 1 };
      if (ac0[0] && ac0[0].tipo === 'cena') return { limpar: true, skip: 0 };
      for (var k = i - 1; k >= 0; k--) {
        var ac = passos[k].acoes || [];
        for (var j = ac.length - 1; j >= 0; j--) if (ac[j].tipo === 'tela') return { id: ac[j].img, skip: 0 };
      }
      return null;
    }
    function resetStage(i) {
      spot(null); tag(null);
      R.done.classList.remove('on');
      var t = primeiraTela(i);
      if (t && t.limpar) {
        R.ov.querySelectorAll('.mp-fx').forEach(function (e) { e.remove(); });
        if (imgEl) { imgEl.remove(); imgEl = null; }
        R.frame.style.setProperty('--ar', '1.6');
      } else if (t) setTela(t.id, true);
      R.cursor.classList.add('jump');
      CX = 92; CY = 92; R.cursor.style.left = CX + '%'; R.cursor.style.top = CY + '%';
      void R.cursor.offsetWidth; R.cursor.classList.remove('jump');
      return t;
    }
    function intro(i) {
      var s = passos[i];
      R.dn.textContent = pad(i + 1);
      R.dt.textContent = s.titulo || '';
      R.dp.textContent = (s.caminho || []).join(' › ');
      R.dp.hidden = !(s.caminho || []).length;
      if (reduce) return wait(250);
      R.door.className = 'mp-door reset'; void R.door.offsetWidth; R.door.className = 'mp-door';
      return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }).then(function () {
        R.door.classList.add('down');
        return wait(1750);
      }).then(function () {
        R.door.classList.remove('down');
        return wait(650);
      });
    }
    function playStep(i) {
      RUN++;
      current = i; T = 0;
      var acoes = passos[i].acoes || [];
      medir();
      var t = resetStage(i);
      renderInfo(); paintRegua();
      var inicio = t ? t.skip : 0;
      var p = intro(i);
      if (inicio && (acoes[0].legenda || acoes[0].detalhe)) p = p.then(function () { return say(acoes[0].legenda, acoes[0].detalhe); });
      acoes.slice(inicio).forEach(function (a) { p = p.then(function () { return run(a); }); });
      p.then(function () {
        spot(null); tag(null);
        if (i < passos.length - 1) {
          R.say.textContent = 'Indo para a próxima etapa…'; R.det.hidden = true;
          return wait(1000).then(function () { playStep(i + 1); });
        }
        T = DUR[i]; current = passos.length; paintRegua(); current = i;
        R.steps.querySelectorAll('.mp-step').forEach(function (b) { b.classList.add('done'); b.classList.remove('on'); });
        R.say.textContent = 'Manual concluído.'; R.det.hidden = true;
        R.score.hidden = !(modo === 'treinar' && placar.total);
        R.score.innerHTML = 'Treino: <b>' + placar.certas + ' de ' + placar.total + '</b> ações certas de primeira.';
        R.toQuiz.hidden = !quiz.length;
        R.done.classList.add('on');
      }).catch(function (e) { if (e !== CANCEL) console.error(e); });
    }

    /* ---------- controles ---------- */
    function setPaused(p) {
      paused = p;
      R.stage.classList.toggle('paused', p);
      R.playIco.innerHTML = p ? IC.play : IC.pause;
      R.playTxt.textContent = p ? 'Continuar' : 'Pausar';
    }
    R.play.onclick = function () { setPaused(!paused); };
    R.stage.onclick = function (e) { if (aguardando || Date.now() - engole < 700 || e.target.closest('.mp-done, .mp-quiz, .mp-hit')) return; setPaused(!paused); };
    R.prev.onclick = function () { setPaused(false); playStep(Math.max(0, current - 1)); };
    R.next.onclick = function () { setPaused(false); playStep(Math.min(passos.length - 1, current + 1)); };
    R.replay.onclick = function () { setPaused(false); playStep(current); };
    R.again.onclick = function (e) { e.stopPropagation(); setPaused(false); placar = { certas: 0, total: 0 }; playStep(0); };
    R.steps.onclick = function (e) { var b = e.target.closest('.mp-step'); if (b) { fecharQuiz(); setPaused(false); playStep(+b.getAttribute('data-i')); } };
    ['prev', 'next', 'replay'].forEach(function (k) { var f = R[k].onclick; R[k].onclick = function () { fecharQuiz(); f(); }; });

    /* =============================================================
       MODO TREINAMENTO ("faça você"): nas ações de clique, lista,
       digitação e tecla a animação para e espera a pessoa fazer.
       Erros dão aviso; no 2º erro aparece a dica. Conta acertos de
       primeira para mostrar no fim.
       ============================================================= */
    var placar = { certas: 0, total: 0 }, aguardando = false, fbT = null, engole = 0, enterPendente = false;
    var INTERATIVO = { clique: 1, digitar: 1, escolher: 1, tecla: 1 };
    function feedback(txt, tipo) {
      R.fb.textContent = txt;
      R.fb.className = 'mp-fb on ' + (tipo || 'erro');
      clearTimeout(fbT);
      fbT = setTimeout(function () { R.fb.className = 'mp-fb'; }, tipo === 'ok' ? 900 : 2200);
    }
    function esperar(setup) {
      var id = RUN;
      return new Promise(function (res, rej) {
        var fim = false, limpa = null;
        function encerra() { fim = true; if (limpa) limpa(); aguardando = false; R.hit.classList.remove('on'); R.hit.innerHTML = ''; R.sua.classList.remove('on'); }
        limpa = setup(function (v) { if (fim) return; encerra(); res(v); });
        aguardando = true; R.sua.classList.add('on');
        (function vigia() { if (fim) return; if (id !== RUN) { encerra(); return rej(CANCEL); } requestAnimationFrame(vigia); })();
      });
    }
    function pctEv(e) { var r = R.frame.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * 100, (e.clientY - r.top) / r.height * 100]; }
    function dentro(a, p) { return p[0] >= a[0] - 1 && p[0] <= a[0] + a[2] + 1 && p[1] >= a[1] - 1.5 && p[1] <= a[1] + a[3] + 1.5; }
    function marcaPonto(p, cls) {
      var rp = document.createElement('div');
      rp.className = 'mp-rip ' + (cls || '');
      rp.style.left = p[0] + '%'; rp.style.top = p[1] + '%';
      R.ov.appendChild(rp); setTimeout(function () { rp.remove(); }, 700);
    }
    function esperarClique(a) {
      return esperar(function (ok) {
        var n = 0;
        R.hit.classList.add('on');
        function h(e) {
          e.stopPropagation(); engole = Date.now();
          var p = pctEv(e);
          if (dentro(a, p)) { marcaPonto(p); ok(n); return; }
          n++; marcaPonto(p, 'erro');
          feedback(n >= 2 ? 'Dica: clique na área destacada.' : 'Não é aí. Tente de novo.');
          if (n >= 2) spot(a);
        }
        function nada(e) { e.preventDefault(); }
        R.hit.addEventListener('pointerdown', h);
        R.hit.addEventListener('contextmenu', nada);
        return function () { R.hit.removeEventListener('pointerdown', h); R.hit.removeEventListener('contextmenu', nada); };
      });
    }
    function norm(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
    function esperarTexto(a, esperado, livre) {
      return esperar(function (ok) {
        var n = 0;
        R.hit.classList.add('on');
        var inp = document.createElement('input');
        inp.type = 'text'; inp.className = 'mp-tin'; inp.spellcheck = false; inp.autocomplete = 'off';
        inp.placeholder = 'digite e aperte ENTER';
        inp.style.left = a[0] + '%'; inp.style.top = a[1] + '%'; inp.style.width = a[2] + '%'; inp.style.height = a[3] + '%';
        inp.style.fontSize = Math.max(11, R.frame.clientHeight * a[3] / 100 * .6) + 'px';
        var cor = corFundo(a); if (cor) { inp.style.background = cor.bg; inp.style.color = cor.fg; }
        R.hit.appendChild(inp);
        setTimeout(function () { inp.focus(); }, 30);
        inp.addEventListener('pointerdown', function (e) { e.stopPropagation(); engole = Date.now(); });
        inp.addEventListener('keydown', function (e) {
          e.stopPropagation();
          if (e.key !== 'Enter') return;
          e.preventDefault();
          var v = inp.value;
          if (livre ? v.trim() : norm(v) === norm(esperado)) { enterPendente = true; ok({ n: n, v: v }); return; }
          n++;
          inp.classList.remove('shake'); void inp.offsetWidth; inp.classList.add('shake');
          feedback(n >= 2 ? 'Dica: digite ' + esperado : 'Não confere. Confira e tente de novo.');
          if (n >= 2) inp.placeholder = esperado;
        });
        return null;
      });
    }
    var TECLA_NOME = { Enter: 'ENTER', Escape: 'ESC', Tab: 'TAB', ' ': 'ESPAÇO', Backspace: 'BACKSPACE', Delete: 'DEL', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
    var ALIAS = { CONTROL: 'CTRL', ESCAPE: 'ESC', RETURN: 'ENTER', SPACE: 'ESPAÇO', DELETE: 'DEL' };
    function normCombo(s) { return String(s || 'ENTER').split('+').map(function (p) { p = p.trim().toUpperCase(); return ALIAS[p] || p; }).filter(Boolean).sort().join('+'); }
    function comboDe(e) {
      var k = TECLA_NOME[e.key] || (e.key.length === 1 ? e.key.toUpperCase() : e.key.toUpperCase());
      var p = [];
      if (e.ctrlKey) p.push('CTRL');
      if (e.shiftKey) p.push('SHIFT');
      if (e.altKey) p.push('ALT');
      p.push(k);
      return p.sort().join('+');
    }
    function esperarTecla(acao, a) {
      var alvo = normCombo(acao.tecla);
      var rotulo = String(acao.tecla || 'ENTER').toUpperCase();
      return esperar(function (ok) {
        var n = 0;
        R.hit.classList.add('on');
        var kb = document.createElement('button');
        kb.type = 'button'; kb.className = 'mp-keys mp-keys-btn';
        var ka = a || [40, 68, 20, 8];
        kb.style.left = Math.min(85, Math.max(15, ka[0] + ka[2] / 2)) + '%';
        kb.style.top = (a ? (ka[1] + ka[3] + 14 < 98 ? ka[1] + ka[3] + 2 : ka[1] - 13) : 72) + '%';
        kb.style.fontSize = Math.max(10, R.frame.clientHeight * .042) + 'px';
        kb.innerHTML = String(acao.tecla || 'ENTER').split('+').map(function (t) { return '<kbd>' + esc(t.trim()) + '</kbd>'; }).join('<b>+</b>') + '<em>aperte no teclado ou toque aqui</em>';
        R.hit.appendChild(kb);
        setTimeout(function () { try { kb.focus({ preventScroll: true }); } catch (e) {} }, 30);
        kb.addEventListener('pointerdown', function (e) { e.stopPropagation(); engole = Date.now(); });
        kb.addEventListener('click', function (e) { e.stopPropagation(); ok(n); });
        function tecla(e) {
          if (/^(Shift|Control|Alt|Meta|CapsLock)$/.test(e.key) || e.repeat) return;
          e.preventDefault(); e.stopPropagation();
          var c = comboDe(e);
          if (c === alvo) { kb.classList.add('down'); bip(900, .03); ok(n); return; }
          n++;
          feedback(n >= 2 ? 'Dica: aperte ' + rotulo : 'Você apertou ' + c.split('+').join(' + ') + '. Não é essa tecla.');
        }
        document.addEventListener('keydown', tecla, true);
        return function () { document.removeEventListener('keydown', tecla, true); };
      });
    }
    function treinar(acao) {
      var a = acao.area, base = custoSay(acao.legenda, acao.detalhe), erros = 0;
      /* O ENTER que confirmou o texto digitado já vale para a ação "Tecla ENTER" logo em seguida. */
      var jaApertou = enterPendente && acao.tipo === 'tecla' && normCombo(acao.tecla) === 'ENTER';
      enterPendente = false;
      var p = say(acao.legenda, acao.detalhe).then(function () { blurTypes(); });
      if (acao.tipo === 'clique') {
        p = p.then(function () { return esperarClique(a); }).then(function (n) {
          erros = n;
          if (acao.marcar) checkBox(a);
          if (acao.realce || acao.balao || acao.marcar) { spot(a); tag(a, resolve(acao.balao, true)); }
        });
      } else if (acao.tipo === 'escolher') {
        var op = opcoesDe(acao), ih = a[3] * .9, acima = a[1] + a[3] + op.ops.length * ih > 98;
        var topo = acima ? a[1] - op.ops.length * ih : a[1] + a[3], lista;
        p = p.then(function () { return esperarClique(a); }).then(function (n) {
          erros = n;
          lista = fx('mp-ddl', a, .55);
          lista.style.left = a[0] + '%'; lista.style.top = topo + '%';
          lista.style.width = a[2] + '%'; lista.style.height = (op.ops.length * ih) + '%';
          lista.innerHTML = op.ops.map(function (o) { return '<div>' + esc(o) + '</div>'; }).join('');
          R.say.textContent = 'Agora escolha: ' + op.valor;
          return esperarClique([a[0], topo + op.idx * ih, a[2], ih]);
        }).then(function (n) {
          erros += n; lista.remove();
          var box = typeBox(a); box.classList.add('blur', 'mp-sel');
          box.innerHTML = '<span>' + esc(op.valor) + '</span><i>▾</i>';
          spot(a); tag(a, resolve(acao.balao, true));
        });
      } else if (acao.tipo === 'digitar') {
        var livre = /\{\{/.test(acao.texto || '');
        p = p.then(function () { spot(a); return esperarTexto(a, resolve(acao.texto, true), livre); }).then(function (r) {
          erros = r.n;
          var box = typeBox(a); box.classList.add('blur'); box.textContent = r.v;
          if (acao.balao) tag(a, resolve(acao.balao, true));
        });
      } else if (acao.tipo === 'tecla') {
        p = p.then(function () {
          if (jaApertou) { feedback('ENTER ✓ (você já apertou ao confirmar)', 'ok'); return 0; }
          if (a) spot(a); return esperarTecla(acao, a);
        }).then(function (n) { erros = n; });
      }
      return p.then(function () {
        placar.total++;
        if (!erros) placar.certas++;
        feedback(erros ? 'Certo ✓' : 'Isso! ✓', 'ok');
        T += Math.max(0, custo(acao) - base - 500);
        return wait(500);
      });
    }
    function setModo(m) {
      modo = m;
      root.querySelectorAll('[data-modo]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-modo') === m); });
      mp.classList.toggle('mp-treino', m === 'treinar');
      placar = { certas: 0, total: 0 };
    }
    root.querySelectorAll('[data-modo]').forEach(function (b) {
      b.onclick = function () { setModo(b.getAttribute('data-modo')); fecharQuiz(); setPaused(false); playStep(modo === 'treinar' ? 0 : current); };
    });

    /* =============================================================
       QUIZ FINAL: perguntas de múltipla escolha com explicação.
       ============================================================= */
    var quiz = (manual.quiz || []).filter(function (q) { return q && q.pergunta && (q.opcoes || []).filter(function (o) { return String(o || '').trim(); }).length >= 2; });
    var qi = 0, qAcertos = 0, qRespondida = false;
    R.quizSide.hidden = !quiz.length;
    function abrirQuiz() {
      RUN++; setPaused(false);
      R.done.classList.remove('on');
      qi = 0; qAcertos = 0;
      R.quiz.classList.add('on');
      R.say.textContent = 'Quiz final'; R.det.hidden = true;
      renderQ();
    }
    function fecharQuiz() { R.quiz.classList.remove('on'); }
    function renderQ() {
      var c = R.quizCard;
      if (qi >= quiz.length) {
        var pct = Math.round(qAcertos / quiz.length * 100);
        c.innerHTML = '<small>Resultado do quiz</small><div class="mp-qscore ' + (pct >= 70 ? 'ok' : 'baixo') + '">' + qAcertos + '<span>/' + quiz.length + '</span></div>' +
          '<p>' + (pct >= 70 ? 'Mandou bem! Você está pronto para a operação.' : 'Revise o manual e tente de novo.') + '</p>' +
          '<div class="mp-qbtns"><button class="mp-btn pri" type="button" data-q="refazer">Refazer o quiz</button><button class="mp-btn" type="button" data-q="manual">Voltar ao manual</button></div>';
        return;
      }
      var q = quiz[qi];
      qRespondida = false;
      c.innerHTML = '<small>Pergunta ' + (qi + 1) + ' de ' + quiz.length + '</small><h4>' + inline(q.pergunta) + '</h4><div class="mp-qops">' +
        (q.opcoes || []).map(function (o, k) { return String(o || '').trim() ? '<button type="button" class="mp-qop" data-k="' + k + '"><i>' + 'ABCD'[k] + '</i><span>' + inline(o) + '</span></button>' : ''; }).join('') +
        '</div><p class="mp-qexp" hidden></p><div class="mp-qbtns"><button class="mp-btn pri" type="button" data-q="prox" hidden>' + (qi + 1 < quiz.length ? 'Próxima' : 'Ver resultado') + '</button></div>';
    }
    R.quiz.addEventListener('click', function (e) {
      e.stopPropagation();
      var op = e.target.closest('.mp-qop');
      if (op && !qRespondida) {
        qRespondida = true;
        var q = quiz[qi], k = +op.getAttribute('data-k'), certa = +q.correta || 0;
        if (k === certa) { qAcertos++; bip(1800, .08); }
        R.quizCard.querySelectorAll('.mp-qop').forEach(function (b) {
          var kk = +b.getAttribute('data-k');
          b.classList.add(kk === certa ? 'certa' : kk === k ? 'errada' : 'apagada');
          b.disabled = true;
        });
        var ex = R.quizCard.querySelector('.mp-qexp');
        ex.innerHTML = (k === certa ? '<b>Certo!</b> ' : '<b>Não é essa.</b> ') + (q.explicacao ? inline(q.explicacao) : 'Resposta certa: ' + inline(q.opcoes[certa]));
        ex.hidden = false;
        R.quizCard.querySelector('[data-q="prox"]').hidden = false;
        return;
      }
      var b = e.target.closest('[data-q]'); if (!b) return;
      var acao = b.getAttribute('data-q');
      if (acao === 'prox') { qi++; renderQ(); }
      else if (acao === 'refazer') { qi = 0; qAcertos = 0; renderQ(); }
      else if (acao === 'manual') { fecharQuiz(); playStep(0); }
    });
    R.quizSide.onclick = abrirQuiz;
    R.toQuiz.onclick = function (e) { e.stopPropagation(); abrirQuiz(); };

    setModo(modo);
    root.querySelectorAll('[data-sp]').forEach(function (b) {
      b.onclick = function () {
        speed = +b.getAttribute('data-sp');
        root.querySelectorAll('[data-sp]').forEach(function (x) { x.classList.toggle('on', x === b); });
        paintRegua();
      };
    });
    function onKey(e) {
      if (aguardando || /INPUT|TEXTAREA/.test((e.target || {}).tagName || '')) return;
      if (e.key === ' ') { e.preventDefault(); setPaused(!paused); }
      else if (e.key === 'ArrowRight') R.next.click();
      else if (e.key === 'ArrowLeft') R.prev.click();
    }
    document.addEventListener('keydown', onKey);
    function onResize() {
      R.ov.querySelectorAll('[data-h]').forEach(function (el) {
        el.style.fontSize = Math.max(8, R.frame.clientHeight * parseFloat(el.getAttribute('data-h')) / 100 * parseFloat(el.getAttribute('data-k'))) + 'px';
      });
    }
    global.addEventListener('resize', onResize);

    playStep(Math.min(Math.max(0, opts.inicio || 0), passos.length - 1));

    return {
      destroy: function () {
        RUN++;
        document.removeEventListener('keydown', onKey);
        global.removeEventListener('resize', onResize);
        root.innerHTML = '';
      }
    };
  }

  /* Fundo atrás do print: bancada (padrão), claro, branco, laranja,
     grafite, sem fundo ou uma cor escolhida (manual.fundoCor). */
  var FUNDOS = ['bancada', 'claro', 'branco', 'laranja', 'grafite', 'nenhum', 'cor'];
  function aplicarFundo(el, manual) {
    var f = FUNDOS.indexOf(manual.fundo) >= 0 ? manual.fundo : 'bancada';
    FUNDOS.forEach(function (x) { el.classList.remove('mp-bg-' + x); });
    el.classList.add('mp-bg-' + f);
    el.style.backgroundColor = f === 'cor' && /^#[0-9a-f]{6}$/i.test(manual.fundoCor || '') ? manual.fundoCor : '';
  }


  /* =============================================================
     CENAS ANIMADAS (sem print): treinamento do físico
       separar  — palete misturado → pilhas por SKU
       bipar    — coletor bipando unidade por unidade, com contador
       conferir — físico x bipado, mostra se confere
     Cada cena recebe W (função de espera do player) e B (bip). Sem W,
     desenha direto o estado final (prévia no editor).
     ============================================================= */
  var CORES = ['#FE5000', '#001A72', '#1F8A52', '#7C3AED'];
  function inteiro(v, def, min, max) { v = parseInt(v, 10); if (isNaN(v)) v = def; return Math.max(min, Math.min(max, v)); }
  function listaSkus(a) {
    var s = String(a.skus || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 4);
    return s.length ? s : ['SKU A', 'SKU B', 'SKU C'];
  }
  function custoCena(a) {
    if (a.modelo === 'bipar') return 700 + inteiro(a.qtd, 6, 1, 30) * 600 + 800;
    if (a.modelo === 'conferir') return 3200;
    return 600 + listaSkus(a).length * inteiro(a.caixas, 3, 1, 4) * 450 + 800;
  }
  function pos(el, x, y, w, h) { el.style.left = x + '%'; el.style.top = y + '%'; if (w != null) { el.style.width = w + '%'; el.style.height = h + '%'; } }
  function div(cls, html) { var d = document.createElement('div'); d.className = cls; if (html != null) d.innerHTML = html; return d; }

  function cenaSeparar(el, a, W) {
    var skus = listaSkus(a), por = inteiro(a.caixas, 3, 1, 4), k = skus.length;
    var bw = 8, bh = 12.8, chao = 80;
    el.appendChild(div('cn-palete')); el.appendChild(div('cn-rot', 'Palete misturado'));
    var colW = 46 / k;
    skus.forEach(function (s, j) {
      var p = div('cn-placa', esc(s)); p.style.setProperty('--c', CORES[j]);
      p.style.left = (50 + j * colW + colW / 2) + '%'; el.appendChild(p);
    });
    var ordem = [];
    for (var r = 0; r < por; r++) for (var j = 0; j < k; j++) ordem.push((j + r) % k);
    var nivel = skus.map(function () { return 0; });
    var caixas = ordem.map(function (j, i) {
      var c = div('cn-box', esc(skus[j])); c.style.setProperty('--c', CORES[j]);
      var col = i % 4, row = Math.floor(i / 4);
      var x0 = 5.75 + col * (bw + 1.5), y0 = chao - bh * (row + 1);
      var x1 = 50 + j * colW + (colW - bw) / 2, y1 = chao - bh * (nivel[j]++ + 1);
      c.dataset.f = x1 + ',' + y1;
      pos(c, W ? x0 : x1, W ? y0 : y1, bw, bh);
      el.appendChild(c);
      return c;
    });
    if (!W) return null;
    var p = W(600);
    caixas.slice().reverse().forEach(function (c) {
      p = p.then(function () { var f = c.dataset.f.split(','); c.classList.add('vai'); pos(c, +f[0], +f[1]); return W(450); });
    });
    return p.then(function () { el.classList.add('cn-fim'); return W(800); });
  }

  function cenaBipar(el, a, W, B) {
    var n = inteiro(a.qtd, 6, 1, 30), cols = n <= 8 ? 4 : n <= 18 ? 6 : 8;
    var rows = Math.ceil(n / cols), uw = cols === 8 ? 5 : 6.5, uh = uw * 1.6, gx = 1.4, gy = 2.2;
    var larg = cols * uw + (cols - 1) * gx, alt = rows * uh + (rows - 1) * gy;
    var x0 = 6 + (50 - larg) / 2, y0 = 14 + (70 - alt) / 2;
    el.appendChild(div('cn-rot cn-rot-un', 'Unidades do SKU ' + esc(a.sku || '')));
    var un = [];
    for (var i = 0; i < n; i++) {
      var u = div('cn-un', '<span class="cn-v">✓</span>');
      pos(u, x0 + (i % cols) * (uw + gx), y0 + Math.floor(i / cols) * (uh + gy), uw, uh);
      el.appendChild(u); un.push(u);
    }
    var col = div('cn-col',
      '<div class="cn-head"></div><div class="cn-tela">' +
      (a.local ? '<div>LOCAL: ' + esc(a.local) + '</div>' : '') +
      '<div>SKU: ' + esc(a.sku || '—') + '</div><div>QTD:</div><div class="cn-q">0</div></div>' +
      '<div class="cn-teclas">' + new Array(13).join('<i></i>') + '</div>');
    pos(col, 64, 10, 25, 82);
    el.appendChild(col);
    var q = col.querySelector('.cn-q'), head = col.querySelector('.cn-head');
    if (!W) { un.forEach(function (u) { u.classList.add('ok'); }); q.textContent = n; return null; }
    var p = W(700);
    un.forEach(function (u, i) {
      p = p.then(function () { u.classList.add('scan'); head.classList.add('on'); return W(250); })
        .then(function () { u.classList.remove('scan'); u.classList.add('ok'); head.classList.remove('on'); q.textContent = i + 1; q.classList.remove('pop'); void q.offsetWidth; q.classList.add('pop'); B(2300, .07); return W(350); });
    });
    return p.then(function () { return W(800); });
  }

  function cenaConferir(el, a, W) {
    var f = inteiro(a.fisico, 6, 0, 9999), b = inteiro(a.bipado, f, 0, 9999), ok = f === b;
    var c1 = div('cn-card', '<small>Contagem física</small><b data-n="' + f + '">0</b><span>unidades no palete</span>');
    var c2 = div('cn-card', '<small>Bipado no coletor</small><b data-n="' + b + '">0</b><span>unidades bipadas</span>');
    pos(c1, 8, 12, 38, 48); pos(c2, 54, 12, 38, 48);
    var dif = b - f;
    var res = div('cn-res ' + (ok ? 'ok' : 'erro'), ok ? '✓ Confere — pode seguir' :
      '✗ Divergência: ' + Math.abs(dif) + (dif > 0 ? ' a mais' : ' a menos') + ' no coletor — conte de novo');
    pos(res, 8, 68, 84, 18);
    [c1, c2, res].forEach(function (x) { el.appendChild(x); });
    var nums = [c1.querySelector('b'), c2.querySelector('b')];
    if (!W) { nums.forEach(function (x) { x.textContent = x.dataset.n; }); el.classList.add('cn-in', 'cn-fim'); return null; }
    var p = W(0).then(function () { el.classList.add('cn-in'); return W(600); });
    for (var s = 1; s <= 10; s++) (function (s) {
      p = p.then(function () { nums.forEach(function (x) { x.textContent = Math.round(x.dataset.n * s / 10); }); return W(90); });
    })(s);
    return p.then(function () { el.classList.add('cn-fim'); return W(600); }).then(function () { return W(1100); });
  }

  function montarCena(el, a, W, B) {
    el.innerHTML = '';
    el.className = (el.className.replace(/\bcn-\S+/g, '') + ' mp-cena cn-' + (a.modelo || 'separar')).trim();
    B = B || function () {};
    if (a.modelo === 'bipar') return cenaBipar(el, a, W, B);
    if (a.modelo === 'conferir') return cenaConferir(el, a, W, B);
    return cenaSeparar(el, a, W, B);
  }
  /* Prévia estática (editor): desenha o estado final dentro de el. */
  function cenaEstatica(el, a) {
    montarCena(el, a, null);
    var ajusta = function () { el.style.fontSize = Math.max(7, el.clientHeight * .035) + 'px'; };
    ajusta(); requestAnimationFrame(ajusta);
  }

  global.LDMPlayer = { mount: mount, esc: esc, aplicarFundo: aplicarFundo, cenaEstatica: cenaEstatica };
})(window);
