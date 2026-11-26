/* ============================================================
   ALMOXARIFADO — a tela dentro da Oficina (index.html da raiz)
   Uma linha por query (compacta, no padrão das tabelas do Inventário),
   com a origem na frente, de quando são os dados, tamanho, quem usa e a
   situação. A lógica de guardar fica em almox-db.js.
   ============================================================ */
(function(){
  'use strict';
  var A = window.LDM_ALMOX;
  var raiz = document.getElementById('view-almox');
  if(!A || !raiz) return;

  var estado = {
    handle: null, perm: null, lendo: null, ultima: null, iniciado: false,
    abertos: {}, filtro: 'todas', busca: '', pacs: []
  };

  var FONTE = {
    snowflake:  { rotulo: 'Snowflake',      css: 'sf' },
    fluxo:      { rotulo: 'Fluxo de dados', css: 'fd' },
    manual:     { rotulo: 'Manual',         css: 'mn' },
    indefinida: { rotulo: 'A definir',      css: 'nd' }
  };
  var ORDEM_FONTES = ['snowflake', 'fluxo', 'manual', 'indefinida'];
  var SITUACAO = { 'em-dia': 'Em dia', 'atrasada': 'Atrasada', 'antiga': 'Antiga', 'vazia': 'Vazia' };
  // Nome curto do app na linha (o nome completo aparece ao abrir a query).
  var CURTO = { inventario:'Inventário', transitorios:'Transitórios', multiplos:'Múltiplos', elevadores:'Equalização', estoque:'Gestão de Estoque', estoquemultiplos:'Estoque de Múltiplos' };
  var RITMO = { auto: 'deveria chegar a cada 2 h', diario: 'a origem só atualiza 1x ao dia, de madrugada', manual: 'chega à mão' };

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function dois(n){ return (n < 10 ? '0' : '') + n; }
  function dataHora(ms){
    var d = new Date(ms);
    return dois(d.getDate()) + '/' + dois(d.getMonth() + 1) + ' ' + dois(d.getHours()) + ':' + dois(d.getMinutes());
  }
  function hora(ms){ var d = new Date(ms); return dois(d.getHours()) + ':' + dois(d.getMinutes()); }
  function idade(ms){
    var min = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if(min < 1) return 'agora';
    if(min < 60) return 'há ' + min + ' min';
    var h = Math.round(min / 60);
    if(h < 48) return 'há ' + h + ' h';
    return 'há ' + Math.round(h / 24) + ' dias';
  }
  function tamanho(b){
    if(b < 1048576) return Math.max(1, Math.round(b / 1024)) + ' KB';
    return (b / 1048576).toFixed(1).replace('.', ',') + ' MB';
  }
  function milhar(n){ return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function sem(s){ return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  var toastEl = document.getElementById('toast'), toastT;
  function aviso(msg){
    if(!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function(){ toastEl.classList.remove('show'); }, 2600);
  }
  function appsDoHub(){
    var mapa = {};
    (window.LDM_HUB_APPS || []).forEach(function(a){ mapa[a.key] = a; });
    return mapa;
  }

  /* ---------------- esqueleto ---------------- */
  raiz.innerHTML =
    '<div class="alx-topo"><div class="alx-pasta" id="alxPasta"></div><div class="alx-mig" id="alxMig"></div></div>' +
    '<div class="alx-filtros" id="alxFiltros">' +
      '<input type="search" class="alx-busca" id="alxBusca" placeholder="Buscar query ou app…" autocomplete="off">' +
      '<div class="alx-chips" id="alxChips"></div>' +
    '</div>' +
    '<div class="alx-wrap"><table class="alx-tab">' +
      '<thead>' +
        '<tr class="grupo"><th colspan="4">Query</th><th colspan="2">Dados de</th><th colspan="3">Arquivo</th><th colspan="2">Uso</th></tr>' +
        '<tr class="cols"><th></th><th>Origem</th><th>Código</th><th>Nome</th><th>Data</th><th>Idade</th>' +
        '<th class="n">Partes</th><th class="n">Linhas</th><th class="n">Tamanho</th><th>Usada por</th><th>Situação</th></tr>' +
      '</thead><tbody id="alxCorpo"></tbody>' +
    '</table></div>' +
    '<p class="alx-nota" id="alxNota"></p>' +
    '<input type="file" id="alxArquivo" multiple hidden accept=".csv,.txt,.xlsx,.xlsm,.xls">';
  var elPasta = document.getElementById('alxPasta');
  var elMig = document.getElementById('alxMig');
  var elChips = document.getElementById('alxChips');
  var elBusca = document.getElementById('alxBusca');
  var elCorpo = document.getElementById('alxCorpo');
  var elNota = document.getElementById('alxNota');
  var elArquivo = document.getElementById('alxArquivo');

  var ICONE_PASTA = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

  /* ---------------- quadro da pasta ---------------- */
  function renderPasta(){
    var botaoMao = '<button type="button" class="btn-secondary" data-acao="manual">Adicionar à mão</button>';
    var titulo, texto, botoes;
    if(estado.lendo){
      titulo = 'Lendo a pasta…'; texto = esc(estado.lendo); botoes = '';
    } else if(!A.suportaPasta){
      titulo = 'Este navegador não conecta pastas';
      texto = 'Para ler a pasta sozinho, abra a Oficina no <strong>Chrome</strong> ou no <strong>Edge</strong>.';
      botoes = botaoMao;
    } else if(!estado.handle){
      titulo = 'Nenhuma pasta conectada';
      texto = 'Conecte a pasta <strong>Bases</strong> (a do SharePoint, sincronizada no computador).';
      botoes = '<button type="button" class="btn-primary" data-acao="conectar">Conectar pasta</button>' + botaoMao;
    } else if(estado.perm !== 'granted'){
      titulo = 'Pasta ' + esc(estado.handle.name) + ' conectada';
      texto = 'O navegador pede um clique para liberar a leitura.';
      botoes = '<button type="button" class="btn-primary" data-acao="permitir">Permitir acesso</button>' +
               '<button type="button" class="btn-secondary" data-acao="conectar">Trocar pasta</button>';
    } else {
      var u = estado.ultima;
      var nq = estado.pacs.filter(function(p){ return p.arquivos.length; }).length;
      titulo = 'Pasta ' + esc(estado.handle.name) + ' conectada';
      texto = u
        ? 'Lida às <strong>' + hora(u.lidoEm) + '</strong> · ' +
          (u.novos ? '<strong>' + u.novos + (u.novos === 1 ? ' novidade' : ' novidades') + '</strong>' : 'nada novo') +
          ' · ' + nq + (nq === 1 ? ' query' : ' queries')
        : 'Ainda não lida.';
      botoes = '<button type="button" class="btn-primary" data-acao="ler">Buscar novidades</button>' +
               '<button type="button" class="btn-secondary" data-acao="conectar">Trocar pasta</button>' + botaoMao;
    }
    var ligada = estado.handle && estado.perm === 'granted';
    elPasta.innerHTML =
      '<div class="alx-pasta-ico' + (ligada ? ' on' : '') + '">' + ICONE_PASTA + '</div>' +
      '<div class="alx-pasta-txt"><h3>' + titulo + '</h3><p>' + texto + '</p></div>' +
      '<div class="alx-pasta-acoes">' + botoes + '</div>';
  }

  /* ---------------- migração para o Snowflake ---------------- */
  function contarFontes(){
    var c = { snowflake: 0, fluxo: 0, manual: 0, indefinida: 0 };
    estado.pacs.forEach(function(p){ c[p.prateleira.fonte] = (c[p.prateleira.fonte] || 0) + 1; });
    return c;
  }
  function renderMigracao(){
    var c = contarFontes();
    var total = estado.pacs.length || 1;
    var barras = ORDEM_FONTES.filter(function(f){ return c[f]; }).map(function(f){
      return '<i class="' + FONTE[f].css + '" style="width:' + (c[f] / total * 100) + '%"></i>';
    }).join('');
    var leg = ORDEM_FONTES.filter(function(f){ return c[f]; }).map(function(f){
      return '<span class="' + FONTE[f].css + '">' + FONTE[f].rotulo + ' ' + c[f] + '</span>';
    }).join('');
    elMig.innerHTML =
      '<h3>Migração para o Snowflake</h3>' +
      '<div class="alx-mig-n"><b>' + c.snowflake + '</b> de ' + estado.pacs.length + ' queries já vêm do Snowflake</div>' +
      '<div class="alx-barra">' + barras + '</div>' +
      '<div class="alx-leg">' + leg + '</div>';
  }

  /* ---------------- filtros ---------------- */
  function renderChips(){
    var c = contarFontes();
    var atrasadas = estado.pacs.filter(function(p){ var s = A.situacao(p); return s === 'atrasada' || s === 'antiga'; }).length;
    var chips = [['todas', 'Todas', estado.pacs.length]];
    ORDEM_FONTES.forEach(function(f){ if(c[f]) chips.push([f, FONTE[f].rotulo, c[f]]); });
    if(atrasadas) chips.push(['atrasadas', 'Atrasadas', atrasadas]);
    if(!chips.some(function(x){ return x[0] === estado.filtro; })) estado.filtro = 'todas';
    elChips.innerHTML = chips.map(function(x){
      return '<button type="button" class="alx-chip' + (x[0] === estado.filtro ? ' on' : '') + '" data-filtro="' + x[0] + '">' +
        esc(x[1]) + ' <b>' + x[2] + '</b></button>';
    }).join('');
  }
  function passa(p, apps){
    var f = estado.filtro;
    if(f === 'atrasadas'){ var s = A.situacao(p); if(s !== 'atrasada' && s !== 'antiga') return false; }
    else if(f !== 'todas' && p.prateleira.fonte !== f) return false;
    if(!estado.busca) return true;
    var q = sem(estado.busca);
    var texto = [p.id, p.prateleira.rotulo, p.prateleira.nome].concat(p.prateleira.apps.map(function(k){ return apps[k] ? apps[k].name : k; }))
      .concat(p.arquivos.map(function(a){ return a.nome; })).join(' ');
    return sem(texto).indexOf(q) >= 0;
  }

  /* ---------------- tabela ---------------- */
  function linha(p, apps){
    var f = p.prateleira;
    var fonte = FONTE[f.fonte] || FONTE.indefinida;
    var sit = A.situacao(p);
    var aberto = !!estado.abertos[p.id];
    var tem = p.arquivos.length > 0;
    var usa = f.apps.filter(function(k){ return apps[k]; });
    var usaHtml = usa.length
      ? usa.slice(0, 2).map(function(k){
          return '<span class="alx-app" style="--c:' + esc(apps[k].color) + '" title="' + esc(apps[k].name) + '">' + esc(CURTO[k] || apps[k].name) + '</span>';
        }).join('') + (usa.length > 2 ? '<span class="alx-mais" title="' + esc(usa.slice(2).map(function(k){ return apps[k].name; }).join(', ')) + '">+' + (usa.length - 2) + '</span>' : '')
      : '<span class="alx-nada">nenhum app ainda</span>';
    var html =
      '<tr class="alx-lin' + (aberto ? ' aberta' : '') + '" data-id="' + esc(p.id) + '" title="Clique para ver os arquivos">' +
        '<td class="alx-tc">' + (aberto ? '▾' : '▸') + '</td>' +
        '<td><span class="alx-org ' + fonte.css + '">' + fonte.rotulo + '</span></td>' +
        '<td class="alx-cod">' + esc(f.rotulo || p.id) + '</td>' +
        '<td class="alx-nome">' + (f.nome ? esc(f.nome) : '<span class="alx-nova">query nova</span>') + '</td>' +
        '<td class="mono">' + (tem ? dataHora(p.dadosDe) : '—') + '</td>' +
        '<td class="alx-h' + (sit === 'atrasada' || sit === 'antiga' ? ' at' : '') + '">' + (tem ? idade(p.dadosDe) : '') + '</td>' +
        '<td class="mono n">' + (tem ? p.arquivos.length : '—') + '</td>' +
        '<td class="mono n">' + (p.linhas != null && tem ? milhar(p.linhas) : '—') + '</td>' +
        '<td class="mono n">' + (tem ? tamanho(p.tamanho) : '—') + '</td>' +
        '<td class="alx-usa">' + usaHtml + '</td>' +
        '<td><span class="alx-st ' + sit + '">' + SITUACAO[sit] + '</span></td>' +
      '</tr>';
    if(aberto){
      var todos = p.arquivos.concat(p.deFora);
      var arqs = todos.length ? todos.map(function(a){
        var fora = p.deFora.indexOf(a) >= 0;
        return '<span class="alx-arq' + (fora ? ' fora' : '') + '"><b>' + esc(a.nome) + '</b> · ' + dataHora(a.modificado) +
          (a.linhas != null ? ' · ' + milhar(a.linhas) + ' linhas' : '') + ' · ' + tamanho(a.tamanho) +
          (a.origem === 'manual' ? ' · à mão' : '') + (fora ? ' · versão antiga, não usada' : '') +
          '<button type="button" class="alx-arq-x" data-remover="' + esc(a.nome) + '" aria-label="Tirar ' + esc(a.nome) + '">&#10005;</button></span>';
      }).join('') : '<span class="alx-arq vazio">Nenhum arquivo ainda. Salve um arquivo com <b>' + esc(f.rotulo || p.id) + '</b> no nome na pasta Bases.</span>';
      var info = '<span class="alx-info">' + fonte.rotulo + ' · ' + RITMO[f.ritmo] +
        (usa.length ? ' · usada por ' + usa.map(function(k){ return esc(apps[k].name); }).join(', ') : '') + '</span>';
      html += '<tr class="alx-det"><td></td><td colspan="10">' + arqs + info + '</td></tr>';
    }
    return html;
  }

  function renderTabela(){
    var apps = appsDoHub();
    var vis = estado.pacs.filter(function(p){ return passa(p, apps); });
    elCorpo.innerHTML = vis.length
      ? vis.map(function(p){ return linha(p, apps); }).join('')
      : '<tr><td colspan="11" class="alx-sem">Nenhuma query encontrada.</td></tr>';
    var ign = (estado.ultima && estado.ultima.ignorados) || [];
    elNota.textContent = ign.length
      ? 'Na pasta também há ' + ign.length + (ign.length === 1 ? ' arquivo que não é planilha e ficou de fora: ' : ' arquivos que não são planilhas e ficaram de fora: ') + ign.join(', ') + '.'
      : '';
  }

  function render(){
    return A.pacotes().then(function(pacs){
      estado.pacs = pacs;
      renderPasta();
      renderMigracao();
      renderChips();
      renderTabela();
    }).catch(function(e){
      renderPasta();
      elCorpo.innerHTML = '<tr><td colspan="11" class="alx-sem">Não consegui abrir o Almoxarifado neste navegador (' + esc(e && e.message || e) + ').</td></tr>';
    });
  }

  /* ---------------- ações ---------------- */
  function ler(){
    if(!estado.handle || estado.lendo) return Promise.resolve();
    estado.lendo = 'Procurando queries…';
    renderPasta();
    return A.lerPasta(estado.handle, function(feitos, total, nome){
      estado.lendo = 'Conferindo ' + feitos + ' de ' + total + ': ' + nome;
      renderPasta();
    }).then(function(res){
      estado.ultima = res;
      estado.lendo = null;
      if(res.novos) aviso(res.novos === 1 ? '1 arquivo novo guardado' : res.novos + ' arquivos novos guardados');
      return render();
    }).catch(function(e){
      estado.lendo = null;
      // Pasta apagada/renomeada no computador ou permissão retirada no meio.
      if(e && (e.name === 'NotFoundError' || e.name === 'NotAllowedError')) estado.perm = 'prompt';
      aviso('Não consegui ler a pasta: ' + (e && e.message || e));
      return render();
    });
  }

  raiz.addEventListener('click', function(ev){
    var b = ev.target.closest('[data-acao],[data-remover],[data-filtro]');
    if(b && b.dataset.remover){
      var nome = b.dataset.remover;
      if(!confirm('Tirar "' + nome + '" do Almoxarifado?\n\nSe ele ainda estiver na pasta, volta na próxima leitura.')) return;
      A.remover(nome).then(render);
      return;
    }
    if(b && b.dataset.filtro){ estado.filtro = b.dataset.filtro; renderChips(); renderTabela(); return; }
    if(b && b.dataset.acao){
      var acao = b.dataset.acao;
      if(acao === 'manual'){ elArquivo.value = ''; elArquivo.click(); }
      else if(acao === 'conectar'){
        A.conectarPasta().then(function(h){
          estado.handle = h; estado.perm = 'granted'; estado.ultima = null;
          return ler();
        }).catch(function(e){ if(!e || e.name !== 'AbortError') aviso('Não deu para conectar: ' + (e && e.message || e)); });
      }
      else if(acao === 'permitir'){
        A.permissao(estado.handle, true).then(function(st){
          estado.perm = st;
          if(st === 'granted') return ler();
          aviso('O navegador não liberou a pasta.');
          renderPasta();
        });
      }
      else if(acao === 'ler') ler();
      return;
    }
    var tr = ev.target.closest('tr.alx-lin');
    if(tr){
      var id = tr.dataset.id;
      estado.abertos[id] = !estado.abertos[id];
      renderTabela();
    }
  });

  elBusca.addEventListener('input', function(){ estado.busca = elBusca.value.trim(); renderTabela(); });

  elArquivo.addEventListener('change', function(){
    var arqs = Array.prototype.slice.call(elArquivo.files || []);
    if(!arqs.length) return;
    A.guardarArquivos(arqs, 'manual').then(function(res){
      var msg = res.guardados.length
        ? (res.guardados.length === 1 ? '1 arquivo guardado' : res.guardados.length + ' arquivos guardados')
        : 'Nenhum arquivo guardado';
      if(res.ignorados.length) msg += ' · não são planilhas: ' + res.ignorados.join(', ');
      aviso(msg);
      return render();
    }).catch(function(e){ aviso('Não deu para guardar: ' + (e && e.message || e)); });
  });

  // Outra aba (ou um app) mexeu no Almoxarifado → redesenha.
  A.aoAtualizar(function(){ if(!raiz.hidden && !estado.lendo) render(); });

  /* Chamado pela navegação da Oficina ao abrir a aba. Na primeira vez lê a pasta
     sozinho se o navegador já liberou; depois, a cada 10 min com a aba aberta. */
  var ultimoAuto = 0;
  window.renderAlmoxarifado = function(){
    var primeira = !estado.iniciado;
    estado.iniciado = true;
    var prep = primeira
      ? Promise.all([A.pastaSalva(), A.ultimaLeitura()]).then(function(r){
          estado.handle = r[0]; estado.ultima = r[1];
          return estado.handle ? A.permissao(estado.handle, false) : null;
        }).then(function(st){ estado.perm = st; })
      : Promise.resolve();
    return prep.then(render).then(function(){
      if(estado.handle && estado.perm === 'granted' && Date.now() - ultimoAuto > 10 * 60 * 1000){
        ultimoAuto = Date.now();
        return ler();
      }
    });
  };
})();
