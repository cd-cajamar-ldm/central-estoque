/* ============================================================
   ALMOXARIFADO — a tela dentro da Oficina (index.html da raiz)
   Mostra cada prateleira (base), de quando são os dados, quem usa,
   e cuida da pasta conectada. A lógica de guardar fica em almox-db.js.
   ============================================================ */
(function(){
  'use strict';
  var A = window.LDM_ALMOX;
  var raiz = document.getElementById('view-almox');
  if(!A || !raiz) return;

  var estado = { handle: null, perm: null, lendo: null, ultima: null, iniciado: false, abertos: {} };

  var ROTULO = { 'em-dia': 'Em dia', 'atrasada': 'Atrasada', 'antiga': 'Antiga', 'vazia': 'Vazia' };
  var RITMO = { auto: 'a cada 2 h', diario: '1x ao dia', manual: 'manual' };

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
    if(b < 1024) return b + ' B';
    if(b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1048576).toFixed(1).replace('.', ',') + ' MB';
  }
  function milhar(n){ return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

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
    '<div class="alx-pasta" id="alxPasta"></div>' +
    '<div class="alx-resumo" id="alxResumo"></div>' +
    '<p class="section-label">Prateleiras</p>' +
    '<div class="alx-grid" id="alxGrid"></div>' +
    '<div id="alxSoltos"></div>' +
    '<input type="file" id="alxArquivo" multiple hidden accept=".csv,.txt,.xlsx,.xlsm,.xls">';
  var elPasta = document.getElementById('alxPasta');
  var elResumo = document.getElementById('alxResumo');
  var elGrid = document.getElementById('alxGrid');
  var elSoltos = document.getElementById('alxSoltos');
  var elArquivo = document.getElementById('alxArquivo');

  var ICONE_PASTA = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

  /* ---------------- quadro da pasta ---------------- */
  function renderPasta(){
    var botaoMao = '<button type="button" class="btn-secondary" data-acao="manual">Adicionar arquivo à mão</button>';
    var titulo, texto, botoes;
    if(estado.lendo){
      titulo = 'Lendo a pasta…';
      texto = esc(estado.lendo);
      botoes = '';
    } else if(!A.suportaPasta){
      titulo = 'Pasta conectada indisponível neste navegador';
      texto = 'Para ler a pasta sozinho, abra a Oficina no <strong>Chrome</strong> ou no <strong>Edge</strong>. Aqui dá para adicionar os arquivos à mão.';
      botoes = botaoMao;
    } else if(!estado.handle){
      titulo = 'Nenhuma pasta conectada';
      texto = 'Conecte a pasta <strong>Bases</strong> (a do SharePoint, sincronizada no computador). O Almoxarifado lê os relatórios dela e cada app pega daqui o que precisa.';
      botoes = '<button type="button" class="btn-primary" data-acao="conectar">Conectar pasta</button>' + botaoMao;
    } else if(estado.perm !== 'granted'){
      titulo = 'Pasta ' + esc(estado.handle.name) + ' conectada';
      texto = 'Por segurança, o navegador pede um clique para liberar a leitura a cada vez que a Oficina é aberta.';
      botoes = '<button type="button" class="btn-primary" data-acao="permitir">Permitir acesso</button>' +
               '<button type="button" class="btn-secondary" data-acao="conectar">Trocar pasta</button>';
    } else {
      var u = estado.ultima;
      titulo = 'Pasta ' + esc(estado.handle.name) + ' conectada';
      texto = u
        ? 'Lida às <strong>' + hora(u.lidoEm) + '</strong> · ' +
          (u.novos ? '<strong>' + u.novos + (u.novos === 1 ? ' novidade' : ' novidades') + '</strong>' : 'nada novo') +
          (u.removidos && u.removidos.length ? ' · ' + u.removidos.length + ' saíram da pasta' : '')
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

  /* ---------------- prateleiras ---------------- */
  function cartao(pac, apps){
    var p = pac.prateleira;
    var sit = A.situacao(pac);
    var chips = p.apps.map(function(k){
      var a = apps[k];
      if(!a) return '';
      return '<span class="alx-app" style="--c:' + esc(a.color) + '">' + esc(a.name) + '</span>';
    }).join('');
    var corpo;
    if(!pac.arquivos.length){
      corpo = '<div class="alx-vazia">Ainda vazia. Salve ' + (p.dicaNome ? esc(p.dicaNome) : 'o arquivo <strong>' + esc(p.id) + '</strong>') + ' na pasta Bases' +
              (A.suportaPasta ? '' : ' ou adicione à mão') + '.</div>';
    } else {
      var partes = pac.arquivos.length > 1 ? pac.arquivos.length + ' partes' : '1 arquivo';
      var meta = [partes];
      if(pac.linhas != null) meta.push(milhar(pac.linhas) + ' linhas');
      meta.push(tamanho(pac.tamanho));
      corpo =
        '<div class="alx-data"><strong>Dados de ' + dataHora(pac.dadosDe) + '</strong><span>' + idade(pac.dadosDe) + '</span></div>' +
        '<div class="alx-meta">' + meta.join(' · ') + '</div>';
    }
    var todos = pac.arquivos.concat(pac.deFora);
    var lista = '';
    if(todos.length){
      lista = '<details class="alx-arqs" data-id="' + esc(p.id) + '"' + (estado.abertos[p.id] ? ' open' : '') + '>' +
        '<summary>Ver arquivos (' + todos.length + ')</summary><ul>' +
        todos.map(function(a){
          var fora = pac.deFora.indexOf(a) >= 0;
          return '<li' + (fora ? ' class="fora" title="Versão mais antiga: não está sendo usada"' : '') + '>' +
            '<span class="alx-arq-nome">' + esc(a.nome) + '</span>' +
            '<span class="alx-arq-info">' + dataHora(a.modificado) + ' · ' + tamanho(a.tamanho) +
            (a.origem === 'manual' ? ' · à mão' : '') + (fora ? ' · não usado' : '') + '</span>' +
            '<button type="button" class="alx-arq-x" data-remover="' + esc(a.nome) + '" aria-label="Tirar ' + esc(a.nome) + ' da prateleira">&#10005;</button>' +
            '</li>';
        }).join('') + '</ul></details>';
    }
    return '<article class="alx-card alx-s-' + sit + '">' +
      '<header><span class="alx-cod">' + esc(p.rotulo || p.id) + '</span><span class="alx-badge">' + ROTULO[sit] + '</span></header>' +
      '<h3>' + esc(p.nome) + '</h3>' +
      corpo +
      '<p class="alx-origem"><span class="alx-ritmo">' + RITMO[p.ritmo] + '</span>' + esc(p.origem) + '</p>' +
      (chips ? '<div class="alx-usada"><span>Usada por</span><div class="alx-apps">' + chips + '</div></div>' : '') +
      lista +
      '</article>';
  }

  function renderPrateleiras(){
    return A.pacotes().then(function(pacs){
      var apps = appsDoHub();
      var cont = { 'em-dia': 0, 'atrasada': 0, 'antiga': 0, 'vazia': 0 };
      pacs.forEach(function(p){ cont[A.situacao(p)]++; });
      var atencao = cont.atrasada + cont.antiga;
      elResumo.innerHTML =
        '<span class="alx-chip alx-s-em-dia"><b>' + cont['em-dia'] + '</b> em dia</span>' +
        '<span class="alx-chip alx-s-atrasada"><b>' + atencao + '</b> precisando de atenção</span>' +
        '<span class="alx-chip alx-s-vazia"><b>' + cont.vazia + '</b> vazias</span>';
      elGrid.innerHTML = pacs.map(function(p){ return cartao(p, apps); }).join('');
    }).catch(function(e){
      elGrid.innerHTML = '<div class="alx-vazia">Não consegui abrir o Almoxarifado neste navegador (' + esc(e && e.message || e) + ').</div>';
    });
  }

  function renderSoltos(){
    var ign = (estado.ultima && estado.ultima.ignorados) || [];
    if(!ign.length || !estado.handle){ elSoltos.innerHTML = ''; return; }
    elSoltos.innerHTML =
      '<p class="section-label">Na pasta, mas sem prateleira</p>' +
      '<div class="alx-soltos"><p>Estes arquivos estão na pasta, mas o nome não diz de qual relatório são. ' +
      'Se for um relatório que os apps usam, renomeie com o código (ex.: <strong>QRY0390</strong>) ou peça uma prateleira nova.</p>' +
      '<ul>' + ign.map(function(n){ return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></div>';
  }

  function render(){
    renderPasta();
    renderSoltos();
    return renderPrateleiras();
  }

  /* ---------------- ações ---------------- */
  function ler(){
    if(!estado.handle || estado.lendo) return Promise.resolve();
    estado.lendo = 'Procurando relatórios…';
    renderPasta();
    return A.lerPasta(estado.handle, function(feitos, total, nome){
      estado.lendo = 'Conferindo ' + feitos + ' de ' + total + ': ' + nome;
      renderPasta();
    }).then(function(res){
      estado.ultima = res;
      estado.lendo = null;
      if(res.novos) aviso(res.novos === 1 ? '1 relatório novo guardado' : res.novos + ' relatórios novos guardados');
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
    var b = ev.target.closest('[data-acao],[data-remover]');
    if(!b) return;
    if(b.dataset.remover){
      var nome = b.dataset.remover;
      if(!confirm('Tirar "' + nome + '" do Almoxarifado?\n\nSe ele ainda estiver na pasta, volta na próxima leitura.')) return;
      A.remover(nome).then(render);
      return;
    }
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
  });

  // Lembra quais listas de arquivos estão abertas entre um desenho e outro.
  raiz.addEventListener('toggle', function(ev){
    var d = ev.target;
    if(d.classList && d.classList.contains('alx-arqs')) estado.abertos[d.dataset.id] = d.open;
  }, true);

  elArquivo.addEventListener('change', function(){
    var arqs = Array.prototype.slice.call(elArquivo.files || []);
    if(!arqs.length) return;
    A.guardarArquivos(arqs, 'manual').then(function(res){
      var msg = res.guardados.length
        ? (res.guardados.length === 1 ? '1 arquivo guardado' : res.guardados.length + ' arquivos guardados')
        : 'Nenhum arquivo guardado';
      if(res.ignorados.length) msg += ' · sem prateleira: ' + res.ignorados.join(', ');
      aviso(msg);
      return render();
    }).catch(function(e){ aviso('Não deu para guardar: ' + (e && e.message || e)); });
  });

  // Outra aba (ou um app) mexeu no Almoxarifado → redesenha.
  A.aoAtualizar(function(){ if(!raiz.hidden) renderPrateleiras(); });

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
