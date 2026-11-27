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
    abertos: {}, filtro: 'todas', busca: '', pacs: [],
    // Automação do PC: horários (editáveis aqui) e o que o script fez com cada Excel.
    auto: null, editados: null, sujo: false
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
  var CURTO = { inventario:'Inventário', transitorios:'Transitórios', multiplos:'Múltiplos', elevadores:'Equalização', estoque:'Gestão de Estoque', estoquemultiplos:'Estoque de Múltiplos', checkvolume:'Check Volume' };
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

  /* ---------- horários (mesma regra do script do PC) ---------- */
  var RE_HORA = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  function normHora(h){ var m = RE_HORA.exec(String(h).trim()); return m ? dois(+m[1]) + ':' + m[2] : null; }
  function emData(base, hhmm){ var p = hhmm.split(':'); var d = new Date(base); d.setHours(+p[0], +p[1], 0, 0); return d; }
  // O horário marcado mais recente que já passou (hoje; senão o último de ontem).
  function horaDaVez(lista, agora){
    var hs = lista.map(normHora).filter(Boolean).sort();
    if(!hs.length) return null;
    var passados = hs.map(function(h){ return emData(agora, h); }).filter(function(d){ return d <= agora; });
    if(passados.length) return passados[passados.length - 1];
    var ontem = new Date(agora); ontem.setDate(ontem.getDate() - 1);
    return emData(ontem, hs[hs.length - 1]);
  }
  function proximaHora(lista, agora){
    var hs = lista.map(normHora).filter(Boolean).sort();
    if(!hs.length) return null;
    var futuros = hs.map(function(h){ return emData(agora, h); }).filter(function(d){ return d > agora; });
    if(futuros.length) return futuros[0];
    var amanha = new Date(agora); amanha.setDate(amanha.getDate() + 1);
    return emData(amanha, hs[0]);
  }
  // O Excel de uma query (só os .xlsx são atualizados pelo script do PC).
  function excelDe(p){
    var a = p.arquivos.filter(function(x){ return /\.xls[xm]$/i.test(x.nome); })[0];
    return a ? a.nome.replace(/\.xls[xm]$/i, '') : null;
  }
  function horariosDe(chave){
    var ed = estado.editados || {};
    if(ed[chave]) return { lista: ed[chave], padrao: false };
    return { lista: (estado.auto && estado.auto.padrao) || ['06:00'], padrao: true };
  }
  function infoAuto(p){
    var chave = excelDe(p);
    if(!chave) return null;
    var e = (estado.auto && estado.auto.estado && estado.auto.estado[chave]) || null;
    var h = horariosDe(chave);
    var ultimaOk = e && e.ultimaOk ? new Date(e.ultimaOk).getTime() : null;
    var agora = new Date();
    var vez = horaDaVez(h.lista, agora);
    var sit;
    // "Atualizando" só vale por 20 min: se o PC travou no meio, a linha não fica girando para sempre.
    if(e && e.status === 'atualizando' && e.inicio && agora - new Date(e.inicio) < 20 * 60000) sit = 'atualizando';
    else if(e && e.status === 'erro') sit = 'erro';
    else if(!vez) sit = 'sem-horario';
    else if(ultimaOk && ultimaOk >= vez.getTime()) sit = 'em-dia';
    else if(agora - vez < 30 * 60000) sit = 'na-fila';
    else sit = 'atrasada';
    return { chave: chave, e: e, h: h, ultimaOk: ultimaOk, sit: sit, proxima: proximaHora(h.lista, agora) };
  }

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
        '<tr class="grupo"><th colspan="4">Relatório</th><th colspan="2">Atualização</th><th colspan="3">Uso</th></tr>' +
        '<tr class="cols"><th></th><th>Origem</th><th>Código</th><th>Nome</th><th>Horários</th><th>Última</th>' +
        '<th class="n">Linhas</th><th>Usada por</th><th>Situação</th></tr>' +
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

  var ICONE_RELOGIO = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

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
      // "Últ. atualização": a mais recente feita pelo script do PC (ou, sem ele,
      // o arquivo mais novo da pasta). Um horário só para tudo.
      var infos = estado.pacs.map(infoAuto).filter(Boolean);
      var ult = infos.reduce(function(m, i){ return Math.max(m, i.ultimaOk || 0); }, 0);
      if(!ult) ult = estado.pacs.reduce(function(m, p){ return Math.max(m, p.arquivos.length ? p.dadosDe : 0); }, 0);
      var prox = null;
      infos.forEach(function(i){ if(i.proxima && (!prox || i.proxima < prox.d)) prox = { d: i.proxima, q: i.chave }; });
      var d = ult ? new Date(ult) : null;
      titulo = '<span class="alx-ult-rot">Últ. atualização</span>' +
        (d ? '<span class="alx-ult">' + hora(ult) + ' <small>' + dois(d.getDate()) + '/' + dois(d.getMonth() + 1) + '/' + d.getFullYear() + '</small></span>' : '<span class="alx-ult">—</span>');
      var auto = estado.auto;
      texto = 'Pasta ' + esc(estado.handle.name) +
        (auto && auto.instalada ? ' · automação do PC instalada' : ' · <strong>automação do PC não encontrada</strong> (pasta _automacao)') +
        (prox ? ' · próxima: <strong>' + hora(prox.d.getTime()) + '</strong> (' + esc(prox.q) + ')' : '') +
        (estado.sujo ? ' · <strong class="alx-sujo">horários alterados, falta salvar</strong>' : '');
      botoes = (estado.sujo ? '<button type="button" class="btn-primary" data-acao="salvar">Salvar horários</button>' : '') +
               '<button type="button" class="' + (estado.sujo ? 'btn-secondary' : 'btn-primary') + '" data-acao="ler">Buscar novidades</button>' +
               '<button type="button" class="btn-secondary" data-acao="conectar">Trocar pasta</button>';
    }
    var ligada = estado.handle && estado.perm === 'granted';
    elPasta.innerHTML =
      '<div class="alx-pasta-ico' + (ligada ? ' on' : '') + '">' + (ligada ? ICONE_RELOGIO : ICONE_PASTA) + '</div>' +
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
  // Excel do PC: pelos horários; o resto (CSV do Power Automate): pela idade do arquivo.
  function atrasada(p){
    var i = infoAuto(p);
    if(i) return i.sit === 'atrasada';
    var s = A.situacao(p); return s === 'atrasada' || s === 'antiga';
  }
  function renderChips(){
    var c = contarFontes();
    var atrasadas = estado.pacs.filter(atrasada).length;
    var chips = [['todas', 'Todas', estado.pacs.length]];
    ORDEM_FONTES.forEach(function(f){ if(c[f]) chips.push([f, FONTE[f].rotulo, c[f]]); });
    if(atrasadas) chips.push(['atrasadas', 'Atrasadas', atrasadas]);
    var comErro = estado.pacs.filter(function(p){ var i = infoAuto(p); return i && i.sit === 'erro'; }).length;
    if(comErro) chips.push(['erro', 'Com erro', comErro]);
    if(!chips.some(function(x){ return x[0] === estado.filtro; })) estado.filtro = 'todas';
    elChips.innerHTML = chips.map(function(x){
      return '<button type="button" class="alx-chip' + (x[0] === estado.filtro ? ' on' : '') + '" data-filtro="' + x[0] + '">' +
        esc(x[1]) + ' <b>' + x[2] + '</b></button>';
    }).join('');
  }
  function passa(p, apps){
    var f = estado.filtro;
    if(f === 'erro'){ var ie = infoAuto(p); if(!ie || ie.sit !== 'erro') return false; }
    else if(f === 'atrasadas'){ if(!atrasada(p)) return false; }
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
    var ia = infoAuto(p);
    var horariosHtml, ultimaHtml, sitHtml;
    if(ia){
      horariosHtml = (ia.h.lista.length
          ? ia.h.lista.map(function(h){
              return '<span class="alx-hr' + (ia.h.padrao ? ' padrao' : '') + '" data-rm="' + esc(ia.chave) + '|' + esc(h) + '" title="' +
                (ia.h.padrao ? 'Horário padrão. Clique em + para escolher os deste relatório' : 'Clique para tirar este horário') + '">' + esc(h) + '</span>';
            }).join('')
          : '<span class="alx-nada">sem horário</span>') +
        '<span class="alx-hr add" data-add="' + esc(ia.chave) + '" title="Adicionar horário">+</span>';
      var quando = ia.ultimaOk || (tem ? p.dadosDe : null);
      ultimaHtml = quando ? dataHora(quando) : '—';
      var SIT = { 'atualizando': ['atualizando', 'Atualizando…'], 'em-dia': ['em-dia', 'Em dia'], 'na-fila': ['vazia', 'Na fila'], 'atrasada': ['atrasada', 'Atrasada'],
                  'sem-horario': ['vazia', 'Sem horário'],
                  'erro': ['atrasada', 'Erro ' + (ia.e && ia.e.ultima ? hora(new Date(ia.e.ultima).getTime()) : '')] };
      var sx = SIT[ia.sit];
      sitHtml = '<span class="alx-st ' + sx[0] + '"' + (ia.sit === 'erro' && ia.e ? ' title="' + esc(ia.e.mensagem) + '"' : '') + '>' + sx[1] + '</span>';
    } else {
      horariosHtml = tem ? '<span class="alx-nada">Power Automate</span>' : '<span class="alx-nada">—</span>';
      ultimaHtml = tem ? dataHora(p.dadosDe) : '—';
      sitHtml = '<span class="alx-st ' + sit + '">' + SITUACAO[sit] + '</span>';
    }
    var linhas = p.linhas != null && tem ? p.linhas : (ia && ia.e && ia.e.linhas != null ? ia.e.linhas : null);
    var html =
      '<tr class="alx-lin' + (aberto ? ' aberta' : '') + '" data-id="' + esc(p.id) + '" title="Clique para ver os arquivos">' +
        '<td class="alx-tc">' + (aberto ? '▾' : '▸') + '</td>' +
        '<td><span class="alx-org ' + fonte.css + '">' + fonte.rotulo + '</span></td>' +
        '<td class="alx-cod">' + esc(f.rotulo || p.id) + '</td>' +
        '<td class="alx-nome">' + (f.nome ? esc(f.nome) : '<span class="alx-nada">—</span>') + '</td>' +
        '<td class="alx-hrs">' + horariosHtml + '</td>' +
        '<td class="mono">' + ultimaHtml + '</td>' +
        '<td class="mono n">' + (linhas != null ? milhar(linhas) : '—') + '</td>' +
        '<td class="alx-usa">' + usaHtml + '</td>' +
        '<td>' + sitHtml + '</td>' +
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
      if(ia && ia.e && ia.e.status === 'erro') info += '<span class="alx-info alx-erro">Último erro: ' + esc(ia.e.mensagem) + '</span>';
      html += '<tr class="alx-det"><td></td><td colspan="8">' + arqs + info + '</td></tr>';
    }
    return html;
  }

  function renderTabela(){
    var apps = appsDoHub();
    var vis = estado.pacs.filter(function(p){ return passa(p, apps); });
    elCorpo.innerHTML = vis.length
      ? vis.map(function(p){ return linha(p, apps); }).join('')
      : '<tr><td colspan="9" class="alx-sem">' + (estado.pacs.length ? 'Nenhuma query encontrada.' : 'Nenhum relatório ainda. Conecte a pasta Bases.') + '</td></tr>';
    var ign = (estado.ultima && estado.ultima.ignorados) || [];
    elNota.textContent = ign.length
      ? 'Na pasta também há ' + ign.length + (ign.length === 1 ? ' arquivo que não é planilha e ficou de fora: ' : ' arquivos que não são planilhas e ficaram de fora: ') + ign.join(', ') + '.'
      : '';
  }

  function render(){
    var lerAuto = (estado.handle && estado.perm === 'granted') ? A.lerAutomacao(estado.handle) : Promise.resolve(null);
    return Promise.all([A.pacotes(), lerAuto]).then(function(r){
      var pacs = r[0];
      if(r[1]){
        estado.auto = r[1];
        if(!estado.sujo) estado.editados = JSON.parse(JSON.stringify(r[1].relatorios || {}));
      }
      // Só o que existe na pasta: o cadastro sem arquivo não vira linha vazia.
      estado.pacs = pacs.filter(function(p){ return p.arquivos.length || p.deFora.length; });
      renderPasta();
      renderMigracao();
      renderChips();
      renderTabela();
    }).catch(function(e){
      renderPasta();
      elCorpo.innerHTML = '<tr><td colspan="9" class="alx-sem">Não consegui abrir o Almoxarifado neste navegador (' + esc(e && e.message || e) + ').</td></tr>';
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
    var hx = ev.target.closest('[data-add],[data-rm]');
    if(hx){
      ev.stopPropagation();
      if(!estado.editados) estado.editados = {};
      if(hx.dataset.add){
        var chave = hx.dataset.add;
        var novo = normHora(prompt('Novo horário para ' + chave + ' (ex.: 14:00):', '') || '');
        if(!novo){ return; }
        var atual = horariosDe(chave).lista.slice();
        if(atual.indexOf(novo) < 0) atual.push(novo);
        estado.editados[chave] = atual.sort();
      } else {
        var partes = hx.dataset.rm.split('|');
        var h0 = horariosDe(partes[0]);
        if(h0.padrao) { aviso('Esse é o horário padrão. Use o + para escolher os horários deste relatório.'); return; }
        estado.editados[partes[0]] = h0.lista.filter(function(h){ return h !== partes[1]; });
      }
      estado.sujo = true;
      renderPasta(); renderTabela();
      return;
    }
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
      else if(acao === 'salvar'){
        var padrao = (estado.auto && estado.auto.padrao) || ['06:00'];
        A.gravarHorarios(estado.handle, padrao, estado.editados || {}).then(function(){
          estado.sujo = false;
          aviso('Horários salvos. O PC passa a usar na próxima conferência (até 15 min).');
          return render();
        }).catch(function(e){ aviso('Não deu para salvar: ' + (e && e.message || e)); });
      }
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
  setInterval(function(){
    if(raiz.hidden || document.hidden || !estado.handle || estado.perm !== 'granted' || estado.lendo) return;
    A.lerAutomacao(estado.handle).then(function(auto){
      if(!auto) return;
      var antes = JSON.stringify(estado.auto && estado.auto.estado);
      estado.auto = auto;
      if(!estado.sujo) estado.editados = JSON.parse(JSON.stringify(auto.relatorios || {}));
      if(JSON.stringify(auto.estado) !== antes){
        // Algum relatório terminou: busca os arquivos novos; senão só redesenha.
        var terminou = Object.keys(auto.estado || {}).some(function(k){
          var v = auto.estado[k], a = (JSON.parse(antes || '{}') || {})[k];
          return a && a.status === 'atualizando' && v.status !== 'atualizando';
        });
        if(terminou) ler(); else { renderPasta(); renderChips(); renderTabela(); }
      }
    });
  }, 30000);

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
