/* =============================================================
   MANUAIS — biblioteca, editor e exportação
   Os manuais ficam no IndexedDB deste navegador (os prints pesam
   demais pro localStorage). Para levar a outro computador ou outra
   pessoa: "Salvar projeto (.json)" e "Importar projeto".
   O manual final é um .html único, com o player e os prints embutidos.
   ============================================================= */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid(p) { return (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function pad(n) { return String(n).padStart(2, '0'); }

  var toastEl = $('#toast'), toastT;
  function toast(msg, err) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('err', !!err);
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('show'); }, err ? 4200 : 2200);
  }

  /* ---------- tema (mesma chave do Painel) ---------- */
  var themeSw = $('#themeSwitch');
  function setTema(dark) {
    document.body.classList.toggle('theme-dark', dark);
    themeSw.classList.toggle('on', dark);
    try { localStorage.setItem('ldm-theme', dark ? 'dark' : 'light'); } catch (e) {}
  }
  try { setTema(localStorage.getItem('ldm-theme') === 'dark'); } catch (e) {}
  themeSw.onclick = function () { setTema(!document.body.classList.contains('theme-dark')); };
  $('#menuBtn').onclick = function () { document.body.classList.toggle('menu-open'); };

  /* ---------- armazenamento (IndexedDB) ---------- */
  var DB = null;
  function db() {
    if (DB) return Promise.resolve(DB);
    return new Promise(function (res, rej) {
      var r = indexedDB.open('ldm-manuais', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('manuais', { keyPath: 'id' }); };
      r.onsuccess = function () { DB = r.result; res(DB); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction('manuais', mode), st = t.objectStore('manuais'), out;
        var req = fn(st);
        if (req) req.onsuccess = function () { out = req.result; };
        t.oncomplete = function () { res(out); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  var store = {
    all: function () { return tx('readonly', function (s) { return s.getAll(); }); },
    get: function (id) { return tx('readonly', function (s) { return s.get(id); }); },
    put: function (m) { return tx('readwrite', function (s) { return s.put(m); }); },
    del: function (id) { return tx('readwrite', function (s) { return s.delete(id); }); }
  };

  /* ---------- imagens ---------- */
  function blobToDataURL(b) {
    return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(b); });
  }
  function urlToDataURL(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url); return r.blob(); }).then(blobToDataURL);
  }
  /* Prints grandes são reduzidos a 1600 px de largura e salvos em WebP
     (no Safari, que não gera WebP, sai PNG). */
  function prepararImagem(file) {
    return blobToDataURL(file).then(function (src) {
      return new Promise(function (res, rej) {
        var im = new Image();
        im.onload = function () {
          var max = 1600, w = im.naturalWidth, h = im.naturalHeight;
          if (w > max) { h = Math.round(h * max / w); w = max; }
          var c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(im, 0, 0, w, h);
          var out = c.toDataURL('image/webp', .9);
          if (out.indexOf('data:image/webp') !== 0) out = c.toDataURL('image/png');
          res(out);
        };
        im.onerror = function () { rej(new Error('Imagem inválida')); };
        im.src = src;
      });
    });
  }

  /* ---------- verificação de senha (política LDM) ---------- */
  var MARCADOR = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
  function senhasSuspeitas(m) {
    var achados = [];
    function olha(txt, onde) {
      if (!txt) return;
      var s = String(txt), r, regs = [
        /(?:^|\s)-(?:pw|pass|-password)\s+["']?([^\s"']+)/gi,
        /\b(?:senha|password|pwd|passwd)\s*[:=]\s*["']?([^\s"']+)/gi
      ];
      regs.forEach(function (re) {
        while ((r = re.exec(s))) {
          var v = r[1];
          if (MARCADOR.test(v) || v.indexOf('{{') >= 0) continue;
          achados.push(onde);
          return;
        }
      });
    }
    ['titulo', 'descricao', 'conclusao'].forEach(function (k) { olha(m[k], 'Dados do manual'); });
    (m.passos || []).forEach(function (p, i) {
      var onde = 'Etapa ' + (i + 1) + (p.titulo ? ' — ' + p.titulo : '');
      (p.instrucoes || []).forEach(function (t) { olha(t, onde + ' (o que fazer)'); });
      (p.valores || []).forEach(function (v) { olha(v.valor, onde + ' (valor “' + (v.rotulo || '') + '”)'); });
      olha(p.observacao, onde + ' (observação)');
      (p.acoes || []).forEach(function (a, k) { olha(a.texto, onde + ' (ação ' + (k + 1) + ')'); olha(a.balao, onde + ' (ação ' + (k + 1) + ')'); olha(a.legenda, onde + ' (ação ' + (k + 1) + ')'); });
    });
    return achados.filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  /* ---------- exportação ---------- */
  var assets = null;
  function carregarAssets() {
    if (assets) return Promise.resolve(assets);
    return Promise.all([
      fetch('css/player.css').then(function (r) { return r.text(); }),
      fetch('js/player.js').then(function (r) { return r.text(); }),
      urlToDataURL('brand/Logo_LDM_icon.png').catch(function () { return ''; })
    ]).then(function (a) { assets = { css: a[0], js: a[1], logo: a[2] }; return assets; });
  }
  function soImagensUsadas(m) {
    var usadas = {};
    (m.passos || []).forEach(function (p) { (p.acoes || []).forEach(function (a) { if (a.tipo === 'tela' && m.imagens[a.img]) usadas[a.img] = m.imagens[a.img]; }); });
    var c = clone(m); c.imagens = usadas; return c;
  }
  function montarHtml(m, opts) {
    opts = opts || {};
    return carregarAssets().then(function (A) {
      var dados = soImagensUsadas(m);
      delete dados.criadoEm;
      var json = JSON.stringify(dados).replace(/</g, '\\u003c');
      var cfg = JSON.stringify({ logo: A.logo, inicio: opts.inicio || 0 }).replace(/</g, '\\u003c');
      return '<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
        '<title>' + esc(m.titulo || 'Manual') + '</title>\n<meta name="generator" content="Oficina LDM · Manuais">\n<meta name="theme-color" content="#0B1230">\n' +
        '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Poppins:wght@600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">\n' +
        '<style>html,body{margin:0;}\n' + A.css + '</style>\n</head>\n<body>\n<div id="manual"></div>\n' +
        '<script>' + A.js + '<\/script>\n' +
        '<script>LDMPlayer.mount(document.getElementById("manual"),' + json + ',' + cfg + ');<\/script>\n</body>\n</html>\n';
    });
  }
  function nomeArquivo(m, ext) {
    var base = (m.titulo || 'manual').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'manual';
    return 'Manual_' + base.replace(/^Manual_?/i, '') + ext;
  }
  function baixar(nome, conteudo, tipo) {
    var url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    var a = document.createElement('a'); a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }
  function bloqueadoPorSenha(m) {
    var s = senhasSuspeitas(m);
    if (s.length) { toast('Exportação bloqueada: tem senha no manual. Troque por um marcador (ex.: SENHA_STG).', true); return true; }
    return false;
  }
  function exportarHtml(m) {
    if (bloqueadoPorSenha(m)) return;
    montarHtml(m).then(function (h) { baixar(nomeArquivo(m, '.html'), h, 'text/html'); toast('Manual exportado.'); })
      .catch(function () { toast('Não consegui montar o arquivo. Abra o app pelo endereço da Central (não pelo arquivo local).', true); });
  }
  function exportarJson(m) {
    if (bloqueadoPorSenha(m)) return;
    var d = soImagensUsadas(m);
    d.formato = 'ldm-manual@1';
    baixar(nomeArquivo(m, '.json'), JSON.stringify(d), 'application/json');
    toast('Projeto salvo. Use "Importar projeto" para abrir em outro computador.');
  }

  /* ---------- pré-visualização ---------- */
  var preview = $('#preview'), frame = $('#previewFrame');
  function assistir(m, inicio) {
    montarHtml(m, { inicio: inicio || 0 }).then(function (h) {
      $('#previewTitle').textContent = m.titulo || 'Pré-visualização';
      frame.srcdoc = h;
      preview.hidden = false;
      document.body.style.overflow = 'hidden';
    }).catch(function () { toast('Não consegui abrir a pré-visualização.', true); });
  }
  function fecharPreview() { preview.hidden = true; frame.srcdoc = ''; document.body.style.overflow = ''; }
  $('#previewClose').onclick = fecharPreview;
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !preview.hidden) fecharPreview(); });

  /* ---------- modelo ---------- */
  function novoManual() {
    return {
      id: uid('m'), titulo: 'Novo manual', sistema: '', ambiente: '', autor: '', descricao: '', conclusao: '',
      imagens: {}, passos: [novoPasso()], criadoEm: Date.now(), atualizadoEm: Date.now()
    };
  }
  function novoPasso() { return { titulo: 'Nova etapa', caminho: [], instrucoes: [], valores: [], observacao: '', acoes: [] }; }
  function normalizar(m) {
    m.imagens = m.imagens || {};
    m.passos = (m.passos || []).map(function (p) {
      p.caminho = p.caminho || []; p.instrucoes = p.instrucoes || []; p.valores = p.valores || []; p.acoes = p.acoes || [];
      return p;
    });
    if (!m.passos.length) m.passos.push(novoPasso());
    return m;
  }
  /* Imagens referenciadas por caminho (o exemplo do repositório) viram
     dataURL, para o manual ficar independente dos arquivos. */
  function embutirImagens(m) {
    var ids = Object.keys(m.imagens || {});
    return Promise.all(ids.map(function (id) {
      var v = m.imagens[id];
      if (/^data:/.test(v)) return null;
      return urlToDataURL(v).then(function (d) { m.imagens[id] = d; });
    })).then(function () { return m; });
  }
  function carregarExemplo() {
    return fetch('exemplos/putty-stg.json').then(function (r) { return r.json(); }).then(function (m) {
      m.imagens = Object.keys(m.imagens).reduce(function (o, k) { o[k] = 'exemplos/' + m.imagens[k].replace(/^exemplos\//, ''); return o; }, {});
      return embutirImagens(m);
    }).then(function (m) {
      m = normalizar(m); m.criadoEm = m.atualizadoEm = Date.now();
      return store.put(m).then(function () { return m; });
    });
  }

  /* ---------- navegação ---------- */
  var atual = null; // manual em edição
  var VIEW = { biblioteca: ['Biblioteca de manuais', 'Passo a passo animado sobre prints reais das telas.'], editor: ['Editor de manual', 'Monte as etapas: cole os prints, marque onde clicar e o que digitar.'] };
  function go(v) {
    if (v === 'editor' && !atual) return;
    $$('.view').forEach(function (s) { s.hidden = s.id !== 'view-' + v; });
    $$('.nav-item').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-go') === v); });
    $('#viewTitle').textContent = v === 'editor' && atual ? (atual.titulo || VIEW.editor[0]) : VIEW[v][0];
    $('#viewSub').textContent = VIEW[v][1];
    document.body.classList.remove('menu-open');
    if (v === 'biblioteca') renderBiblioteca();
    window.scrollTo(0, 0);
  }
  $$('[data-go]').forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-go')); }; });

  /* ---------- biblioteca ---------- */
  var lista = [];
  function primeiraImagem(m) {
    for (var i = 0; i < (m.passos || []).length; i++) {
      var ac = m.passos[i].acoes || [];
      for (var j = 0; j < ac.length; j++) if (ac[j].tipo === 'tela' && m.imagens[ac[j].img]) return m.imagens[ac[j].img];
    }
    return '';
  }
  function renderBiblioteca() {
    return store.all().then(function (ms) {
      lista = (ms || []).sort(function (a, b) { return (b.atualizadoEm || 0) - (a.atualizadoEm || 0); });
      var q = $('#libSearch').value.trim().toLowerCase();
      var vis = lista.filter(function (m) { return !q || [m.titulo, m.sistema, m.ambiente, m.autor].join(' ').toLowerCase().indexOf(q) >= 0; });
      $('#libEmpty').hidden = vis.length > 0;
      $('#libGrid').innerHTML = vis.map(function (m) {
        var img = primeiraImagem(m);
        var n = (m.passos || []).length;
        var dt = m.atualizadoEm ? new Date(m.atualizadoEm).toLocaleDateString('pt-BR') : '';
        return '<article class="card mcard" data-id="' + esc(m.id) + '"><i class="rivet tl"></i><i class="rivet tr"></i>' +
          '<button class="mcard-thumb" type="button" data-act="ver" aria-label="Assistir">' + (img ? '<img src="' + img + '" alt="">' : '<span class="mcard-empty">sem prints ainda</span>') +
          '<span class="play"><svg width="14" height="14" viewBox="0 0 16 16"><path d="M4.5 3v10l8-5z" fill="currentColor"/></svg></span></button>' +
          '<div class="mcard-body"><div class="mcard-chips">' + (m.sistema ? '<span class="chip hot">' + esc(m.sistema) + '</span>' : '') + (m.ambiente ? '<span class="chip">' + esc(m.ambiente) + '</span>' : '') + '<span class="chip">' + n + ' etapa' + (n === 1 ? '' : 's') + '</span></div>' +
          '<h3>' + esc(m.titulo || 'Sem título') + '</h3><p>' + esc(m.descricao || '') + '</p>' +
          '<div class="mcard-foot"><button class="btn sm pri" type="button" data-act="editar">Editar</button><button class="btn sm" type="button" data-act="html">Exportar</button><button class="btn sm" type="button" data-act="dup">Duplicar</button><span class="grow"></span><button class="btn sm icon danger" type="button" data-act="del" title="Excluir">✕</button></div>' +
          '<small style="font-size:10.5px;color:var(--ink-soft)">Atualizado em ' + dt + '</small></div></article>';
      }).join('');
    });
  }
  $('#libSearch').oninput = renderBiblioteca;
  $('#libGrid').onclick = function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var id = b.closest('[data-id]').getAttribute('data-id');
    var m = lista.filter(function (x) { return x.id === id; })[0]; if (!m) return;
    var act = b.getAttribute('data-act');
    if (act === 'ver') assistir(m);
    else if (act === 'editar') abrirEditor(m);
    else if (act === 'html') exportarHtml(m);
    else if (act === 'dup') { var c = clone(m); c.id = uid('m'); c.titulo = (m.titulo || '') + ' (cópia)'; c.atualizadoEm = Date.now(); store.put(c).then(renderBiblioteca); }
    else if (act === 'del') {
      if (!confirm('Excluir o manual "' + (m.titulo || '') + '"? Isso não pode ser desfeito (a não ser que você tenha o .json).')) return;
      store.del(id).then(function () { if (atual && atual.id === id) { atual = null; syncNav(); } renderBiblioteca(); toast('Manual excluído.'); });
    }
  };
  $('#btnNovo').onclick = function () { var m = novoManual(); store.put(m).then(function () { abrirEditor(m); }); };
  $('#btnExemplo').onclick = function () {
    carregarExemplo().then(function () { renderBiblioteca(); toast('Exemplo do PuTTY STG restaurado.'); }).catch(function () { toast('Não consegui carregar o exemplo.', true); });
  };
  $('#btnImportar').onclick = function () { $('#fileImportar').click(); };
  $('#fileImportar').onchange = function (e) {
    var f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    f.text().then(function (t) {
      var m = normalizar(JSON.parse(t));
      if (!m.passos) throw new Error();
      delete m.formato;
      if (!m.id || lista.some(function (x) { return x.id === m.id; }) && !confirm('Já existe um manual com este projeto. Substituir? (Cancelar cria uma cópia)')) m.id = uid('m');
      m.atualizadoEm = Date.now();
      return embutirImagens(m).then(function () { return store.put(m); }).then(function () { renderBiblioteca(); toast('Projeto importado.'); });
    }).catch(function () { toast('Arquivo inválido: use um .json salvo por este app.', true); });
  };

  /* ---------- editor ---------- */
  var sIdx = 0;        // etapa selecionada
  var aIdx = -1;       // ação selecionada
  var tool = null;     // ferramenta ativa (clique, clique-dir, digitar, destacar) ou 'reposicionar'
  var saveT = null;

  function syncNav() {
    $('#navEditor').disabled = !atual;
    $('#navEditorSub').textContent = atual ? (atual.titulo || 'sem título') : 'nenhum manual aberto';
  }
  function abrirEditor(m) {
    atual = normalizar(m);
    sIdx = 0; aIdx = -1; tool = null;
    syncNav();
    $$('[data-m]').forEach(function (el) { el.value = atual[el.getAttribute('data-m')] || ''; });
    renderTudo();
    go('editor');
    estadoSalvo('ok');
  }
  function passo() { return atual.passos[sIdx]; }

  function estadoSalvo(s) {
    var el = $('#saveState');
    el.className = 'save-state' + (s === 'pend' ? ' pending' : s === 'blocked' ? ' blocked' : '');
    el.textContent = s === 'pend' ? 'Salvando…' : s === 'blocked' ? 'Não salvo — remova a senha' : 'Salvo';
  }
  function checarSenha() {
    var s = senhasSuspeitas(atual);
    $('#alertSenha').hidden = !s.length;
    $('#alertSenhaLista').innerHTML = s.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
    return s.length > 0;
  }
  function mudou() {
    atual.atualizadoEm = Date.now();
    if (checarSenha()) { clearTimeout(saveT); estadoSalvo('blocked'); return; }
    estadoSalvo('pend');
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      store.put(atual).then(function () { estadoSalvo('ok'); }).catch(function () { estadoSalvo('blocked'); toast('Não consegui salvar no navegador (espaço cheio?). Salve o projeto em .json.', true); });
    }, 500);
  }

  /* dados do manual */
  $$('[data-m]').forEach(function (el) {
    el.addEventListener('input', function () {
      atual[el.getAttribute('data-m')] = el.value;
      if (el.getAttribute('data-m') === 'titulo') { $('#viewTitle').textContent = el.value || VIEW.editor[0]; syncNav(); }
      mudou();
    });
  });
  $('#btnPreview').onclick = function () { assistir(atual, 0); };
  $('#btnTestStep').onclick = function () { assistir(atual, sIdx); };
  $('#btnExpHtml').onclick = function () { exportarHtml(atual); };
  $('#btnExpJson').onclick = function () { exportarJson(atual); };

  function renderTudo() { renderEtapas(); renderPasso(); checarSenha(); }

  /* lista de etapas */
  function renderEtapas() {
    $('#stepList').innerHTML = atual.passos.map(function (p, i) {
      var nt = (p.acoes || []).length;
      return '<li><button class="sitem' + (i === sIdx ? ' on' : '') + '" type="button" data-i="' + i + '"><span class="sitem-n">' + pad(i + 1) + '</span><span><b>' + esc(p.titulo || 'Sem título') + '</b><small>' + nt + ' aç' + (nt === 1 ? 'ão' : 'ões') + '</small></span></button></li>';
    }).join('');
  }
  $('#stepList').onclick = function (e) {
    var b = e.target.closest('.sitem'); if (!b) return;
    sIdx = +b.getAttribute('data-i'); aIdx = -1; setTool(null);
    renderEtapas(); renderPasso();
  };
  $('#btnAddStep').onclick = function () {
    atual.passos.splice(sIdx + 1, 0, novoPasso()); sIdx++; aIdx = -1;
    renderEtapas(); renderPasso(); mudou();
    $('[data-s="titulo"]').select();
  };
  function moverEtapa(d) {
    var j = sIdx + d; if (j < 0 || j >= atual.passos.length) return;
    var p = atual.passos.splice(sIdx, 1)[0]; atual.passos.splice(j, 0, p); sIdx = j;
    renderEtapas(); mudou();
  }
  $('#stUp').onclick = function () { moverEtapa(-1); };
  $('#stDown').onclick = function () { moverEtapa(1); };
  $('#stDup').onclick = function () {
    var c = clone(passo()); c.titulo = (c.titulo || '') + ' (cópia)';
    atual.passos.splice(sIdx + 1, 0, c); sIdx++; renderEtapas(); renderPasso(); mudou();
  };
  $('#stDel').onclick = function () {
    if (atual.passos.length === 1) { toast('O manual precisa de pelo menos uma etapa.'); return; }
    if (!confirm('Excluir a etapa "' + (passo().titulo || '') + '"?')) return;
    atual.passos.splice(sIdx, 1); sIdx = Math.max(0, sIdx - 1); aIdx = -1;
    renderEtapas(); renderPasso(); mudou();
  };

  /* campos da etapa */
  function renderPasso() {
    var p = passo();
    $('[data-s="titulo"]').value = p.titulo || '';
    $('[data-s="caminho"]').value = (p.caminho || []).join(' > ');
    $('[data-s="instrucoes"]').value = (p.instrucoes || []).join('\n');
    $('[data-s="observacao"]').value = p.observacao || '';
    $('#stUp').disabled = sIdx === 0;
    $('#stDown').disabled = sIdx === atual.passos.length - 1;
    renderValores();
    var on = !!p.campo;
    $('#campoOn').checked = on;
    $('#campoGrid').hidden = !on;
    $$('[data-c]').forEach(function (el) { el.value = on ? (p.campo[el.getAttribute('data-c')] || '') : ''; });
    renderAcoes();
  }
  $('[data-s="titulo"]').oninput = function (e) { passo().titulo = e.target.value; renderEtapas(); mudou(); };
  $('[data-s="caminho"]').oninput = function (e) { passo().caminho = e.target.value.split(/\s*[>›]\s*/).map(function (s) { return s.trim(); }).filter(Boolean); mudou(); };
  $('[data-s="instrucoes"]').oninput = function (e) { passo().instrucoes = e.target.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); mudou(); };
  $('[data-s="observacao"]').oninput = function (e) { passo().observacao = e.target.value; mudou(); };
  $('#campoOn').onchange = function (e) {
    var p = passo();
    if (e.target.checked) p.campo = p.campo || { chave: 'pasta', rotulo: 'Cole aqui o caminho da pasta onde você guardou os arquivos', exemplo: '', marcador: 'CAMINHO_DA_SUA_PASTA' };
    else delete p.campo;
    renderPasso(); mudou();
  };
  $$('[data-c]').forEach(function (el) {
    el.oninput = function () {
      var k = el.getAttribute('data-c'), v = el.value;
      if (k === 'chave') v = v.replace(/[^\w-]/g, '');
      passo().campo[k] = v; mudou();
    };
  });

  function renderValores() {
    var vs = passo().valores;
    $('#valRows').innerHTML = vs.map(function (v, i) {
      return '<div class="vrow"><input type="text" data-vi="' + i + '" data-vk="rotulo" placeholder="Campo (ex.: Port)" value="' + esc(v.rotulo) + '"><input type="text" data-vi="' + i + '" data-vk="valor" placeholder="Valor (ex.: 2222)" value="' + esc(v.valor) + '" spellcheck="false"><button class="btn sm icon danger" type="button" data-vdel="' + i + '" title="Remover">✕</button></div>';
    }).join('') || '<p class="help" style="margin:0">Nenhum valor. Adicione o que o leitor precisa digitar ou colar.</p>';
  }
  $('#valRows').oninput = function (e) {
    var i = e.target.getAttribute('data-vi'); if (i == null) return;
    passo().valores[+i][e.target.getAttribute('data-vk')] = e.target.value; mudou();
  };
  $('#valRows').onclick = function (e) {
    var b = e.target.closest('[data-vdel]'); if (!b) return;
    passo().valores.splice(+b.getAttribute('data-vdel'), 1); renderValores(); mudou();
  };
  $('#btnAddVal').onclick = function () { passo().valores.push({ rotulo: '', valor: '' }); renderValores(); $$('#valRows [data-vk="rotulo"]').pop().focus(); mudou(); };

  /* ---------- roteiro: ações e canvas ---------- */
  var TIPOS = {
    tela: { nome: 'Tela', ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="21 15 16 10 5 21"/></svg>' },
    clique: { nome: 'Clique', ic: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>' },
    digitar: { nome: 'Digitar', ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>' },
    destacar: { nome: 'Destacar', ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="4 3"/></svg>' }
  };
  var HINT = {
    'clique': 'Clique (ou arraste) sobre o botão/campo que o leitor deve clicar.',
    'clique-dir': 'Clique (ou arraste) sobre o item do clique com o botão direito.',
    'digitar': 'Arraste um retângulo exatamente sobre o campo onde o texto será digitado.',
    'destacar': 'Arraste um retângulo em volta da área que quer destacar.',
    'reposicionar': 'Desenhe de novo a área da ação selecionada.'
  };
  function setTool(t) {
    tool = t;
    $$('#toolbar [data-tool]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tool') === t); });
    $('#canvas').classList.toggle('mode-draw', !!t && t !== 'tela');
    $('#toolHint').innerHTML = t && HINT[t] ? HINT[t] + ' <b>Esc</b> cancela.' : 'Cole um print com <b>Ctrl+V</b> ou use <b>Nova tela</b>.';
  }
  $('#toolbar').onclick = function (e) {
    var b = e.target.closest('[data-tool]'); if (!b) return;
    var t = b.getAttribute('data-tool');
    if (t === 'tela') { pedirTela = null; $('#fileTela').click(); return; }
    if (!telaVigente()) { toast('Primeiro coloque um print: Ctrl+V ou "Nova tela".'); return; }
    setTool(tool === t ? null : t);
  };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && tool && preview.hidden) setTool(null);
  });

  /* tela vigente para a ação selecionada (ou para o fim da etapa) */
  function telaVigente(idx) {
    var ac = passo().acoes, ate = idx == null ? (aIdx >= 0 ? aIdx : ac.length - 1) : idx;
    for (var j = ate; j >= 0; j--) if (ac[j] && ac[j].tipo === 'tela') return { img: ac[j].img, idx: j };
    for (var k = sIdx - 1; k >= 0; k--) {
      var a2 = atual.passos[k].acoes || [];
      for (var j2 = a2.length - 1; j2 >= 0; j2--) if (a2[j2].tipo === 'tela') return { img: a2[j2].img, idx: -1, herdada: k };
    }
    return null;
  }
  function inserirAcao(a) {
    var ac = passo().acoes;
    var pos = aIdx >= 0 ? aIdx + 1 : ac.length;
    ac.splice(pos, 0, a);
    aIdx = pos;
    renderEtapas(); renderAcoes(); mudou();
  }

  /* adicionar print: Ctrl+V, botão ou arrastar */
  var pedirTela = null; // índice da ação 'tela' cuja imagem será trocada
  function receberImagem(file) {
    if (!atual || $('#view-editor').hidden) return;
    prepararImagem(file).then(function (d) {
      var id = uid('i');
      atual.imagens[id] = d;
      if (pedirTela != null && passo().acoes[pedirTela]) {
        passo().acoes[pedirTela].img = id; aIdx = pedirTela; pedirTela = null;
        renderAcoes(); mudou(); toast('Print trocado.');
      } else {
        inserirAcao({ tipo: 'tela', img: id, legenda: '' });
        toast('Print adicionado. Agora marque os cliques e campos.');
      }
    }).catch(function () { toast('Não consegui ler essa imagem.', true); });
  }
  $('#fileTela').onchange = function (e) { var f = e.target.files[0]; e.target.value = ''; if (f) receberImagem(f); };
  document.addEventListener('paste', function (e) {
    if (!atual || $('#view-editor').hidden || !preview.hidden) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && /^image\//.test(items[i].type)) { e.preventDefault(); pedirTela = null; receberImagem(items[i].getAsFile()); return; }
    }
  });
  var cv = $('#canvas');
  cv.addEventListener('dragover', function (e) { e.preventDefault(); cv.classList.add('drop'); });
  cv.addEventListener('dragleave', function () { cv.classList.remove('drop'); });
  cv.addEventListener('drop', function (e) {
    e.preventDefault(); cv.classList.remove('drop');
    var f = e.dataTransfer.files[0]; if (f && /^image\//.test(f.type)) { pedirTela = null; receberImagem(f); }
  });

  function resumo(a) {
    if (a.tipo === 'tela') return a.legenda ? '<i>' + esc(a.legenda) + '</i>' : '<i>troca o print</i>';
    var extra = a.tipo === 'digitar' && a.texto ? ' “' + esc(a.texto) + '”' : '';
    return (a.legenda ? esc(a.legenda) : '<i>sem legenda</i>') + extra;
  }
  function renderAcoes() {
    var ac = passo().acoes;
    if (aIdx >= ac.length) aIdx = ac.length - 1;
    $('#actionList').innerHTML = ac.length ? ac.map(function (a, i) {
      var T = TIPOS[a.tipo] || TIPOS.clique, sel = i === aIdx;
      var nome = a.tipo === 'clique' && a.dir ? 'Botão direito' : T.nome;
      var h = '<li class="aitem' + (sel ? ' sel' : '') + (a.tipo === 'tela' ? ' tela' : '') + '" data-a="' + i + '">' +
        '<div class="ahead" data-pick="' + i + '"><span class="anum">' + (i + 1) + '</span><span class="aic ' + a.tipo + '">' + T.ic + '</span><span class="atxt"><b>' + nome + '</b> · ' + resumo(a) + '</span>' +
        '<span class="abtns"><button type="button" data-mv="-1" title="Subir">↑</button><button type="button" data-mv="1" title="Descer">↓</button><button type="button" class="del" data-rm title="Remover">✕</button></span></div>';
      if (sel) {
        h += '<div class="abody">';
        if (a.tipo === 'tela') {
          h += (atual.imagens[a.img] ? '<img class="athumb" src="' + atual.imagens[a.img] + '" alt="">' : '') +
            '<button class="btn sm" type="button" data-troca>Trocar print</button>';
        }
        h += '<label class="f">Legenda (aparece embaixo da tela)<input type="text" data-af="legenda" value="' + esc(a.legenda) + '" placeholder="Ex.: Clique em Save"></label>';
        if (a.tipo === 'digitar') h += '<label class="f">Texto digitado<input type="text" data-af="texto" value="' + esc(a.texto) + '" spellcheck="false" placeholder="Ex.: 2222 ou {{pasta}}"></label>';
        if (a.tipo !== 'tela') {
          h += '<label class="f">Etiqueta (opcional)<input type="text" data-af="balao" value="' + esc(a.balao) + '" placeholder="Ex.: SSH ✓"></label>';
          h += '<div class="ackrow">';
          if (a.tipo === 'clique') h += '<label><input type="checkbox" data-ak="realce"' + (a.realce ? ' checked' : '') + '> Destacar depois do clique</label><label><input type="checkbox" data-ak="dir"' + (a.dir ? ' checked' : '') + '> Botão direito</label>';
          h += '</div><button class="btn sm" type="button" data-repos>Redesenhar área</button>';
        }
        h += '</div>';
      }
      return h + '</li>';
    }).join('') : '<li class="alist-empty">Nenhuma ação ainda.<br>1. Cole o print da tela (<b>Ctrl+V</b>).<br>2. Escolha <b>Clique</b>, <b>Digitar</b> ou <b>Destacar</b> e marque no print.<br>3. Escreva a legenda de cada ação.</li>';
    renderCanvas();
  }
  $('#actionList').addEventListener('click', function (e) {
    var li = e.target.closest('[data-a]'); if (!li) return;
    var i = +li.getAttribute('data-a'), ac = passo().acoes;
    if (e.target.closest('[data-rm]')) {
      ac.splice(i, 1); if (aIdx >= i) aIdx--; renderEtapas(); renderAcoes(); mudou(); return;
    }
    var mv = e.target.closest('[data-mv]');
    if (mv) {
      var j = i + +mv.getAttribute('data-mv'); if (j < 0 || j >= ac.length) return;
      var x = ac.splice(i, 1)[0]; ac.splice(j, 0, x); aIdx = j; renderAcoes(); mudou(); return;
    }
    if (e.target.closest('[data-troca]')) { pedirTela = i; $('#fileTela').click(); return; }
    if (e.target.closest('[data-repos]')) { setTool('reposicionar'); return; }
    if (e.target.closest('[data-pick]')) { aIdx = aIdx === i ? -1 : i; setTool(null); renderAcoes(); }
  });
  $('#actionList').addEventListener('input', function (e) {
    var li = e.target.closest('[data-a]'); if (!li) return;
    var a = passo().acoes[+li.getAttribute('data-a')];
    var f = e.target.getAttribute('data-af');
    if (f) {
      a[f] = e.target.value;
      var t = li.querySelector('.atxt'); if (t) t.innerHTML = '<b>' + (a.tipo === 'clique' && a.dir ? 'Botão direito' : TIPOS[a.tipo].nome) + '</b> · ' + resumo(a);
      mudou();
    }
  });
  $('#actionList').addEventListener('change', function (e) {
    var li = e.target.closest('[data-a]'); if (!li) return;
    var k = e.target.getAttribute('data-ak'); if (!k) return;
    passo().acoes[+li.getAttribute('data-a')][k] = e.target.checked;
    renderAcoes(); mudou();
  });

  function renderCanvas() {
    var t = telaVigente();
    var ac = passo().acoes;
    if (!t || !atual.imagens[t.img]) {
      cv.innerHTML = '<div class="canvas-empty"><b>Cole aqui o print da tela</b><span>Tire o print (Win+Shift+S), volte aqui e aperte <b>Ctrl+V</b>.<br>Ou arraste uma imagem, ou clique em <b>Nova tela</b>.</span></div>';
      $('#canvasInfo').textContent = '';
      return;
    }
    /* caixas das ações que acontecem sobre este print */
    var fim = ac.length;
    for (var j = t.idx + 1; j < ac.length; j++) if (ac[j].tipo === 'tela') { fim = j; break; }
    var boxes = '';
    for (var k = Math.max(0, t.idx + 1); k < fim; k++) {
      var a = ac[k]; if (!a.area) continue;
      boxes += '<div class="abox t-' + a.tipo + (k === aIdx ? ' sel' : '') + '" data-box="' + k + '" style="left:' + a.area[0] + '%;top:' + a.area[1] + '%;width:' + a.area[2] + '%;height:' + a.area[3] + '%"><span>' + (k + 1) + '</span></div>';
    }
    cv.innerHTML = '<img src="' + atual.imagens[t.img] + '" alt="">' + boxes;
    $('#canvasInfo').textContent = t.herdada != null ? 'Print herdado da etapa ' + (t.herdada + 1) + ' — cole outro se a tela mudou.' : 'Print da ação ' + (t.idx + 1);
  }

  /* desenhar área no print */
  var drag = null;
  function pct(e) {
    var r = cv.getBoundingClientRect();
    return [Math.min(100, Math.max(0, (e.clientX - r.left) / r.width * 100)), Math.min(100, Math.max(0, (e.clientY - r.top) / r.height * 100))];
  }
  cv.addEventListener('pointerdown', function (e) {
    if (!cv.querySelector('img')) return;
    if (!tool) {
      var b = e.target.closest('[data-box]');
      if (b) { aIdx = +b.getAttribute('data-box'); renderAcoes(); }
      return;
    }
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    var p = pct(e);
    var rb = document.createElement('div'); rb.className = 'rubber'; cv.appendChild(rb);
    drag = { x: p[0], y: p[1], el: rb };
    mover(e);
  });
  function mover(e) {
    if (!drag) return;
    var p = pct(e);
    drag.w = p[0] - drag.x; drag.h = p[1] - drag.y;
    var x = Math.min(drag.x, p[0]), y = Math.min(drag.y, p[1]);
    Object.assign(drag.el.style, { left: x + '%', top: y + '%', width: Math.abs(drag.w) + '%', height: Math.abs(drag.h) + '%' });
  }
  cv.addEventListener('pointermove', mover);
  cv.addEventListener('pointerup', function (e) {
    if (!drag) return;
    var p = pct(e), d = drag; drag = null; d.el.remove();
    var x = Math.min(d.x, p[0]), y = Math.min(d.y, p[1]), w = Math.abs(p[0] - d.x), h = Math.abs(p[1] - d.y);
    if (w < 1.2 && h < 1.2) {
      /* clique simples: área pequena centrada no ponto (campo de texto mais largo) */
      var dw = tool === 'digitar' ? 22 : 5, dh = tool === 'digitar' ? 4.5 : 4;
      x = Math.max(0, d.x - (tool === 'digitar' ? 2 : dw / 2)); y = Math.max(0, d.y - dh / 2); w = dw; h = dh;
    }
    var area = [x, y, w, h].map(function (v) { return Math.round(v * 100) / 100; });
    if (tool === 'reposicionar') {
      var a = passo().acoes[aIdx]; if (a) a.area = area;
      setTool(null); renderAcoes(); mudou(); return;
    }
    var nova;
    if (tool === 'digitar') nova = { tipo: 'digitar', area: area, texto: '', legenda: '', balao: '' };
    else if (tool === 'destacar') nova = { tipo: 'destacar', area: area, legenda: '', balao: '' };
    else nova = { tipo: 'clique', area: area, dir: tool === 'clique-dir', realce: false, legenda: '', balao: '' };
    setTool(null);
    inserirAcao(nova);
    var foco = $('#actionList .aitem.sel [data-af="' + (nova.tipo === 'digitar' ? 'texto' : 'legenda') + '"]');
    if (foco) foco.focus();
  });

  /* ---------- início ---------- */
  store.all().then(function (ms) {
    var jaSemeou = false;
    try { jaSemeou = localStorage.getItem('ldm-manuais-exemplo') === '1'; } catch (e) {}
    if ((!ms || !ms.length) && !jaSemeou) {
      try { localStorage.setItem('ldm-manuais-exemplo', '1'); } catch (e) {}
      return carregarExemplo().catch(function () {});
    }
  }).then(renderBiblioteca).catch(function () {
    toast('Este navegador bloqueou o armazenamento local — os manuais não serão guardados.', true);
  });
  carregarAssets().catch(function () {});
})();
