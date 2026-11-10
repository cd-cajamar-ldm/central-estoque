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
              '</div>' +
              '<div class="mp-door reset" data-r="door"><div class="mp-plate">' + rivets() + '<small>ETAPA</small><strong data-r="dn">01</strong><span data-r="dt"></span><em data-r="dp"></em></div></div>' +
              '<div class="mp-paused">PAUSADO · clique para continuar</div>' +
              '<div class="mp-done" data-r="done"><div class="mp-done-card">' +
                '<svg viewBox="0 0 74 74"><circle cx="37" cy="37" r="37" fill="#1F8A52"/><path d="M22 38 L33 49 L53 27" fill="none" stroke="#fff" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                '<h4>Serviço concluído!</h4><p data-r="doneMsg"></p>' +
                '<button class="mp-btn pri" type="button" data-r="again">' + IC.again + 'Ver de novo</button>' +
              '</div></div>' +
            '</div>' +
            '<div class="mp-ctrl">' +
              '<div class="mp-now"><span class="mp-now-ic">' + IC.wrench + '</span><span class="mp-now-box"><span class="mp-now-txt" data-r="say" aria-live="polite">Preparando…</span><span class="mp-now-det" data-r="det" hidden></span></span></div>' +
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
    function typeBox(a) {
      var el = fx('mp-type', a, .6);
      el.style.left = a[0] + '%'; el.style.top = a[1] + '%'; el.style.width = a[2] + '%'; el.style.height = a[3] + '%';
      return el;
    }
    function checkBox(a) {
      var el = fx('mp-chk', a, .62);
      el.style.left = (a[0] + .15) + '%'; el.style.top = (a[1] + a[3] / 2) + '%';
      return el;
    }

    /* ---------- ações ---------- */
    function run(acao) {
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
        default:
          return check();
      }
    }

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
      if (t) setTela(t.id, true);
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
    R.stage.onclick = function (e) { if (e.target.closest('.mp-done')) return; setPaused(!paused); };
    R.prev.onclick = function () { setPaused(false); playStep(Math.max(0, current - 1)); };
    R.next.onclick = function () { setPaused(false); playStep(Math.min(passos.length - 1, current + 1)); };
    R.replay.onclick = function () { setPaused(false); playStep(current); };
    R.again.onclick = function (e) { e.stopPropagation(); setPaused(false); playStep(0); };
    R.steps.onclick = function (e) { var b = e.target.closest('.mp-step'); if (b) { setPaused(false); playStep(+b.getAttribute('data-i')); } };
    root.querySelectorAll('[data-sp]').forEach(function (b) {
      b.onclick = function () {
        speed = +b.getAttribute('data-sp');
        root.querySelectorAll('[data-sp]').forEach(function (x) { x.classList.toggle('on', x === b); });
        paintRegua();
      };
    });
    function onKey(e) {
      if (/INPUT|TEXTAREA/.test((e.target || {}).tagName || '')) return;
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

  global.LDMPlayer = { mount: mount, esc: esc, aplicarFundo: aplicarFundo };
})(window);
