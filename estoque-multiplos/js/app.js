/* Estoque de Múltiplos — tela. As contas ficam em regras.js. */
(function(){
  'use strict';
  const R = window.EM_REGRAS;
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const num = n => Math.round(n || 0).toLocaleString('pt-BR');

  const E = {
    painel: null, estrutura: null, conjuntos: [],
    ajustes: lerAjustes(),
    tipo: null, fornecedor: '', peso: '', status: '', busca: '',
    abertos: new Set()
  };

  /* ---------- guarda local (IndexedDB) ---------- */
  function banco(){
    return new Promise((ok, falha) => {
      const r = indexedDB.open('estoque-multiplos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('dados');
      r.onsuccess = () => ok(r.result); r.onerror = () => falha(r.error);
    });
  }
  async function guardar(chave, valor){
    try { const db = await banco(); db.transaction('dados', 'readwrite').objectStore('dados').put(valor, chave); } catch (e){ /* segue sem guardar */ }
  }
  async function buscar(chave){
    try {
      const db = await banco();
      return await new Promise(ok => { const r = db.transaction('dados').objectStore('dados').get(chave); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); });
    } catch (e){ return null; }
  }
  function lerAjustes(){ try { return JSON.parse(localStorage.getItem('em-ajustes') || '{}'); } catch (e){ return {}; } }
  function salvarAjustes(){ try { localStorage.setItem('em-ajustes', JSON.stringify(E.ajustes)); } catch (e){ /* sem espaço */ } }

  /* ---------- dados ---------- */
  function aplicarAjustes(){
    E.conjuntos = E.painel.conjuntos.map(c => {
      const a = E.ajustes[c.pai];
      return a ? Object.assign({}, c, a, {manual: true}) : c;
    });
  }
  const noTipo = () => E.conjuntos.filter(c => !E.tipo || c.tipo === E.tipo);
  function filtrados(){
    const b = E.busca.trim().toUpperCase();
    return noTipo().filter(c =>
      (!E.fornecedor || c.fornecedor === E.fornecedor) &&
      (!E.peso || c.peso === E.peso) &&
      (!E.status || c.status === E.status) &&
      (!b || (c.nome + ' ' + c.modelo + ' ' + c.pai + ' ' + c.fornecedor + ' ' + c.comps.map(x => x.item + ' ' + x.nome).join(' ')).toUpperCase().includes(b)));
  }
  function somar(lista){
    const s = {modelos: lista.length, completos: 0, descasados: 0, sobra: 0, foraVenda: 0, comEstoque: 0};
    lista.forEach(c => {
      s.completos += c.completos; s.sobra += c.sobra; s.foraVenda += c.foraVenda;
      if (c.status === 'Descasado') s.descasados++;
      if (c.completos > 0) s.comEstoque++;
    });
    return s;
  }
  const ordemPeso = (a, b) => (a.pesoKg || 1e12) - (b.pesoKg || 1e12);

  /* ---------- desenho ---------- */
  function desenhar(){
    $('importar').hidden = true; $('painel').hidden = false; $('acoes').hidden = false;
    $('dataBase').textContent = E.painel.dataBase ? '· estoque de ' + E.painel.dataBase : '';
    desenharTipos(); desenharKpis(); desenharPanorama(); desenharFiltros(); desenharDetalhe();
    $('rodape').textContent = num(E.painel.totalPais) + ' múltiplos cadastrados na ZBIQ0051 · ' + num(E.conjuntos.length) +
      ' com alguma peça no CD · ' + num(E.painel.semEstoque) + ' sem nenhuma peça no estoque (não aparecem). ' +
      'Fornecedor, tipo, peso e modelo são lidos do nome do item — use "corrigir" quando a leitura errar.';
  }

  function desenharTipos(){
    const cont = new Map();
    E.conjuntos.forEach(c => cont.set(c.tipo, (cont.get(c.tipo) || 0) + 1));
    const lista = [...cont.entries()].sort((a, b) => (a[0] === 'Outros') - (b[0] === 'Outros') || b[1] - a[1]);
    // Só os 10 maiores ficam à vista; o resto abre em "mais tipos" (o escolhido nunca some).
    const visiveis = E.todosTipos ? lista : lista.filter(([t], i) => i < 10 || t === E.tipo);
    const resto = lista.length - visiveis.length;
    $('tipos').innerHTML = '<button type="button" class="tipo' + (!E.tipo ? ' ativo' : '') + '" data-tipo="">Todos<b>' + num(E.conjuntos.length) + '</b></button>' +
      visiveis.map(([t, n]) => '<button type="button" class="tipo' + (E.tipo === t ? ' ativo' : '') + '" data-tipo="' + esc(t) + '">' + esc(t) + '<b>' + num(n) + '</b></button>').join('') +
      (resto > 0 ? '<button type="button" class="tipo mais" data-mais="1">+ ' + resto + ' tipos</button>' : E.todosTipos && lista.length > 10 ? '<button type="button" class="tipo mais" data-mais="1">menos tipos</button>' : '');
  }

  function desenharKpis(){
    const s = somar(filtrados());
    $('kpis').innerHTML =
      '<div class="kpi destaque"><span>Completos à venda</span><strong>' + num(s.completos) + '</strong><small>conjuntos inteiros, prontos pra vender</small></div>' +
      '<div class="kpi"><span>Modelos com estoque</span><strong>' + num(s.comEstoque) + '</strong><small>de ' + num(s.modelos) + ' com alguma peça no CD</small></div>' +
      '<div class="kpi"><span>Descasados</span><strong>' + num(s.descasados) + '</strong><small>' + num(s.sobra) + ' peças à venda sem par</small></div>' +
      '<div class="kpi"><span>Peças fora de venda</span><strong>' + num(s.foraVenda) + '</strong><small>reversa, triagem, incompleto etc.</small></div>';
  }

  function desenharPanorama(){
    const lista = noTipo();
    if (!E.tipo){
      $('tituloPanorama').textContent = 'Panorama por tipo';
      $('dicaPanorama').textContent = 'Clique em um tipo para abrir por fornecedor e peso.';
      const g = new Map();
      lista.forEach(c => { let x = g.get(c.tipo); if (!x) g.set(c.tipo, x = []); x.push(c); });
      const linhas = [...g.entries()].map(([t, l]) => [t, somar(l)]).sort((a, b) => b[1].completos - a[1].completos);
      const tot = somar(lista);
      const col = s => '<td class="n">' + num(s.modelos) + '</td><td class="n forte">' + num(s.completos) + '</td><td class="n">' + num(s.descasados) + '</td><td class="n">' + num(s.sobra) + '</td><td class="n">' + num(s.foraVenda) + '</td>';
      $('panorama').innerHTML = '<table><thead><tr><th>Tipo</th><th class="n">Modelos</th><th class="n">Completos à venda</th><th class="n">Descasados</th><th class="n">Peças sem par</th><th class="n">Peças fora de venda</th></tr></thead><tbody>' +
        linhas.map(([t, s]) => '<tr class="linha" data-tipo="' + esc(t) + '"><td><strong>' + esc(t) + '</strong></td>' + col(s) + '</tr>').join('') +
        '</tbody><tfoot><tr class="matriz"><td><strong>Total</strong></td>' + col(tot) + '</tr></tfoot></table>';
      return;
    }
    $('tituloPanorama').textContent = E.tipo + ' — completos à venda por fornecedor e peso';
    $('dicaPanorama').textContent = 'Clique em um número para ver os modelos. O sinal laranja mostra quantos estão descasados.';
    const pesos = [...new Map(lista.map(c => [c.peso, c])).values()].sort(ordemPeso).map(c => c.peso);
    const forn = new Map();
    lista.forEach(c => {
      let f = forn.get(c.fornecedor); if (!f) forn.set(c.fornecedor, f = {total: 0, desc: 0, cel: {}});
      const k = f.cel[c.peso] || (f.cel[c.peso] = {n: 0, desc: 0});
      k.n += c.completos; f.total += c.completos;
      if (c.status === 'Descasado'){ k.desc++; f.desc++; }
    });
    const linhas = [...forn.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
    const totCol = p => linhas.reduce((s, [, f]) => s + (f.cel[p] ? f.cel[p].n : 0), 0);
    const av = n => n ? '<span class="aviso" title="' + n + ' descasado(s)">▲' + n + '</span>' : '';
    $('panorama').innerHTML = '<table class="matriz"><thead><tr><th>Fornecedor</th>' + pesos.map(p => '<th>' + esc(p) + '</th>').join('') + '<th>Total</th></tr></thead><tbody>' +
      linhas.map(([nome, f]) => '<tr><td>' + esc(nome) + '</td>' + pesos.map(p => {
        const k = f.cel[p];
        if (!k) return '<td class="nada">·</td>';
        const sel = E.fornecedor === nome && E.peso === p ? ' sel' : '';
        return '<td class="cel' + (k.n ? '' : ' zero') + sel + '" data-f="' + esc(nome) + '" data-p="' + esc(p) + '">' + num(k.n) + av(k.desc) + '</td>';
      }).join('') + '<td class="cel tot" data-f="' + esc(nome) + '" data-p="">' + num(f.total) + av(f.desc) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td>Total</td>' + pesos.map(p => '<td>' + num(totCol(p)) + '</td>').join('') + '<td>' + num(somar(lista).completos) + '</td></tr></tfoot></table>';
  }

  function desenharFiltros(){
    const lista = noTipo();
    const forn = [...new Set(lista.map(c => c.fornecedor))].sort((a, b) => a.localeCompare(b));
    const pesos = [...new Map(lista.map(c => [c.peso, c])).values()].sort(ordemPeso).map(c => c.peso);
    if (E.fornecedor && !forn.includes(E.fornecedor)) E.fornecedor = '';
    if (E.peso && !pesos.includes(E.peso)) E.peso = '';
    const op = (v, sel) => '<option' + (v === sel ? ' selected' : '') + '>' + esc(v) + '</option>';
    $('fFornecedor').innerHTML = '<option value="">Todo fornecedor</option>' + forn.map(v => op(v, E.fornecedor)).join('');
    $('fPeso').innerHTML = '<option value="">Todo peso</option>' + pesos.map(v => op(v, E.peso)).join('');
    $('fStatus').value = E.status; $('fBusca').value = E.busca;
  }

  function seloStatus(s){ return '<span class="selo ' + (s === 'Fora de venda' ? 'Fora' : s) + '">' + esc(s) + '</span>'; }

  function desenharDetalhe(){
    const lista = filtrados().sort((a, b) => a.fornecedor.localeCompare(b.fornecedor) || ordemPeso(a, b) || a.modelo.localeCompare(b.modelo) || a.nome.localeCompare(b.nome));
    if (!lista.length){ $('detalhe').innerHTML = '<p class="vazio">Nada encontrado com esses filtros.</p>'; return; }
    let html = '<table><thead><tr><th>Peso</th><th>Modelo</th><th>Conjunto</th>' + (E.tipo ? '' : '<th>Tipo</th>') +
      '<th class="n">Completos à venda</th><th class="n">Peças sem par</th><th class="n">Fora de venda</th><th>Situação</th><th></th></tr></thead><tbody>';
    const colunas = E.tipo ? 8 : 9;
    let atual = null;
    lista.forEach(c => {
      if (c.fornecedor !== atual){
        atual = c.fornecedor;
        const s = somar(lista.filter(x => x.fornecedor === atual));
        html += '<tr class="grupo"><td colspan="' + (colunas - 5) + '">' + esc(atual) + '</td><td class="n">' + num(s.completos) + '</td><td class="n">' + num(s.sobra) + '</td><td class="n">' + num(s.foraVenda) + '</td><td colspan="2" class="n">' + num(s.modelos) + ' modelo(s)</td></tr>';
      }
      const aberto = E.abertos.has(c.pai);
      html += '<tr class="linha' + (aberto ? ' aberta' : '') + '" data-pai="' + esc(c.pai) + '">' +
        '<td><span class="seta">▸</span> ' + esc(c.peso) + '</td><td>' + esc(c.modelo) + '</td>' +
        '<td class="nome">' + esc(c.nome) + (c.manual ? '<span class="manual">corrigido</span>' : '') + '<small>Item pai ' + esc(c.pai) + ' · ' + c.comps.length + ' peças</small></td>' +
        (E.tipo ? '' : '<td>' + esc(c.tipo) + '</td>') +
        '<td class="n forte">' + num(c.completos) + '</td><td class="n' + (c.sobra ? ' sobra' : '') + '">' + num(c.sobra) + '</td><td class="n">' + num(c.foraVenda) + '</td>' +
        '<td>' + seloStatus(c.status) + '</td><td><button type="button" class="editar" data-editar="' + esc(c.pai) + '">corrigir</button></td></tr>';
      if (aberto) html += '<tr class="comps"><td colspan="' + colunas + '">' + tabelaComps(c) + '</td></tr>';
    });
    $('detalhe').innerHTML = html + '</tbody></table>';
  }

  function tabelaComps(c){
    return '<table><thead><tr><th>Peça</th><th>Descrição</th><th>Valor</th><th class="n">Por conjunto</th><th class="n">À venda</th><th class="n">Sem par</th><th>Fora de venda</th></tr></thead><tbody>' +
      c.comps.map(x => {
        const fora = Object.keys(x.saldo).filter(r => r !== R.RESTR_VENDA && x.saldo[r]).map(r => num(x.saldo[r]) + ' ' + (R.RESTR_NOME[r] || r)).join(' · ');
        return '<tr><td>' + esc(x.item) + '</td><td>' + (x.nome ? esc(x.nome) : '<em>sem saldo no CD</em>') + '</td>' +
          '<td>' + (x.principal ? '<span class="principal" title="in_interface = S: é a peça que carrega o valor do conjunto">S · principal</span>' : 'N · zero') + '</td>' +
          '<td class="n">' + num(x.qtde) + '</td><td class="n">' + num(x.venda) + '</td><td class="n' + (x.sobra ? ' sobra' : '') + '">' + num(x.sobra) + '</td><td>' + (esc(fora) || '—') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function redesenharFiltro(){ desenharKpis(); desenharPanorama(); desenharFiltros(); desenharDetalhe(); }

  /* ---------- importação ---------- */
  const arq = {f390: null, f051: null};
  function abrirImportar(){
    $('importar').hidden = false; $('painel').hidden = true;
    $('btCancelar').hidden = !E.painel; $('dica051').hidden = !E.estrutura;
    $('erro').hidden = true; $('progresso').hidden = true;
    conferirBotao();
  }
  function conferirBotao(){ $('btProcessar').disabled = !(arq.f390 && (arq.f051 || E.estrutura)); }
  function escolher(id, caixa, rotulo){
    $(id).addEventListener('change', e => {
      arq[id] = e.target.files[0] || null;
      $(rotulo).textContent = arq[id] ? arq[id].name : 'Escolher arquivo .xlsx';
      $(caixa).classList.toggle('ok', !!arq[id]);
      conferirBotao();
    });
  }
  async function processar(){
    $('erro').hidden = true; $('progresso').hidden = false; $('btProcessar').disabled = true;
    const prog = (t, p) => { $('progTexto').textContent = t; $('barra').style.width = p + '%'; };
    prog('Abrindo os arquivos…', 4);
    try {
      const buf390 = await arq.f390.arrayBuffer();
      const buf051 = arq.f051 ? await arq.f051.arrayBuffer() : null;
      const w = new Worker('./js/worker.js');
      w.onerror = () => { falhar('Não consegui abrir o leitor de planilhas. Verifique a internet e tente de novo.'); w.terminate(); };
      w.onmessage = ev => {
        const m = ev.data;
        if (m.tipo === 'progresso') prog(m.texto, m.pct);
        else if (m.tipo === 'erro'){ falhar(m.texto); w.terminate(); }
        else if (m.tipo === 'pronto'){
          w.terminate();
          E.painel = m.painel; E.estrutura = m.estrutura;
          guardar('painel', m.painel); guardar('estrutura', m.estrutura);
          iniciarPainel();
        }
      };
      w.postMessage({buf390, buf051, estrutura: buf051 ? null : E.estrutura}, buf051 ? [buf390, buf051] : [buf390]);
    } catch (e){ falhar(e.message || String(e)); }
  }
  function falhar(texto){
    $('erro').textContent = texto; $('erro').hidden = false; $('progresso').hidden = true; conferirBotao();
  }
  function iniciarPainel(){
    aplicarAjustes();
    if (E.tipo === null) E.tipo = E.conjuntos.some(c => c.tipo === 'Elevador') ? 'Elevador' : '';
    desenhar();
  }

  /* ---------- correção manual ---------- */
  let editando = null;
  function abrirEdicao(pai){
    const c = E.conjuntos.find(x => x.pai === pai); if (!c) return;
    editando = pai;
    $('dlgNome').textContent = c.nome + ' (item pai ' + c.pai + ')';
    $('eFornecedor').value = c.fornecedor; $('eTipo').value = c.tipo;
    $('ePeso').value = c.pesoKg ? c.peso : ''; $('eModelo').value = c.modelo === 'Sem modelo' ? '' : c.modelo;
    $('lsFornecedor').innerHTML = [...new Set(E.conjuntos.map(x => x.fornecedor))].sort().map(v => '<option value="' + esc(v) + '">').join('');
    $('lsTipo').innerHTML = [...new Set(E.conjuntos.map(x => x.tipo).concat(R.TIPOS.map(t => t[0])))].sort().map(v => '<option value="' + esc(v) + '">').join('');
    $('dlgRestaurar').hidden = !E.ajustes[pai];
    $('dlg').showModal();
  }
  function salvarEdicao(){
    const txt = $('ePeso').value.trim();
    const kg = txt ? (R.pesosDoNome(txt)[0] || 0) : 0;
    E.ajustes[editando] = {
      fornecedor: $('eFornecedor').value.trim().toUpperCase() || 'Sem fornecedor',
      tipo: $('eTipo').value.trim() || 'Outros',
      pesoKg: kg, peso: kg ? R.rotuloPeso(kg) : (txt || 'Sem peso'),
      modelo: $('eModelo').value.trim().toUpperCase() || 'Sem modelo'
    };
    salvarAjustes(); aplicarAjustes(); desenhar();
  }

  /* ---------- Excel ---------- */
  function carregarXlsx(){
    if (window.XLSX) return Promise.resolve();
    return new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = ok; s.onerror = () => falha(new Error('Sem acesso ao gerador de Excel. Verifique a internet.'));
      document.head.appendChild(s);
    });
  }
  async function exportar(){
    try { await carregarXlsx(); } catch (e){ alert(e.message); return; }
    const lista = filtrados().sort((a, b) => a.tipo.localeCompare(b.tipo) || a.fornecedor.localeCompare(b.fornecedor) || ordemPeso(a, b));
    const conj = lista.map(c => ({'Tipo': c.tipo, 'Fornecedor': c.fornecedor, 'Peso': c.peso, 'Modelo': c.modelo, 'Item pai': c.pai, 'Conjunto': c.nome,
      'Completos à venda': c.completos, 'Peças sem par': c.sobra, 'Peças fora de venda': c.foraVenda, 'Situação': c.status}));
    const pecas = [];
    lista.forEach(c => c.comps.forEach(x => pecas.push({'Tipo': c.tipo, 'Fornecedor': c.fornecedor, 'Peso': c.peso, 'Modelo': c.modelo, 'Item pai': c.pai,
      'Peça': x.item, 'Descrição': x.nome, 'Valor (S/N)': x.principal ? 'S' : 'N', 'Por conjunto': x.qtde, 'À venda': x.venda, 'Sem par': x.sobra,
      'Fora de venda': x.total - x.venda, 'Total no CD': x.total})));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(conj), 'Conjuntos');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pecas), 'Peças');
    const d = new Date(), p = n => String(n).padStart(2, '0');
    XLSX.writeFile(wb, 'estoque-multiplos-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.xlsx');
  }

  /* ---------- eventos ---------- */
  escolher('f390', 'cx390', 'nm390'); escolher('f051', 'cx051', 'nm051');
  $('btProcessar').addEventListener('click', processar);
  $('btCancelar').addEventListener('click', desenhar);
  $('btAtualizar').addEventListener('click', abrirImportar);
  $('btExcel').addEventListener('click', exportar);
  $('btImprimir').addEventListener('click', () => window.print());
  $('tipos').addEventListener('click', e => {
    if (e.target.closest('[data-mais]')){ E.todosTipos = !E.todosTipos; desenharTipos(); return; }
    const b = e.target.closest('[data-tipo]'); if (!b) return;
    E.tipo = b.dataset.tipo; E.fornecedor = ''; E.peso = ''; desenharTipos(); redesenharFiltro();
  });
  $('panorama').addEventListener('click', e => {
    const t = e.target.closest('tr[data-tipo]');
    if (t){ E.tipo = t.dataset.tipo; E.fornecedor = ''; E.peso = ''; desenharTipos(); redesenharFiltro(); return; }
    const c = e.target.closest('td.cel'); if (!c) return;
    const mesmo = E.fornecedor === c.dataset.f && E.peso === c.dataset.p;
    E.fornecedor = mesmo ? '' : c.dataset.f; E.peso = mesmo ? '' : c.dataset.p;
    redesenharFiltro();
    $('detalhe').scrollIntoView({behavior: 'smooth', block: 'nearest'});
  });
  $('fFornecedor').addEventListener('change', e => { E.fornecedor = e.target.value; redesenharFiltro(); });
  $('fPeso').addEventListener('change', e => { E.peso = e.target.value; redesenharFiltro(); });
  $('fStatus').addEventListener('change', e => { E.status = e.target.value; redesenharFiltro(); });
  $('fBusca').addEventListener('input', e => { E.busca = e.target.value; desenharKpis(); desenharDetalhe(); });
  $('btLimpar').addEventListener('click', () => { E.fornecedor = E.peso = E.status = E.busca = ''; redesenharFiltro(); });
  $('detalhe').addEventListener('click', e => {
    const ed = e.target.closest('[data-editar]');
    if (ed){ abrirEdicao(ed.dataset.editar); return; }
    const l = e.target.closest('tr[data-pai]'); if (!l) return;
    const pai = l.dataset.pai;
    if (E.abertos.has(pai)) E.abertos.delete(pai); else E.abertos.add(pai);
    desenharDetalhe();
  });
  $('dlgForm').addEventListener('submit', salvarEdicao);
  $('dlgFechar').addEventListener('click', () => $('dlg').close());
  $('dlgRestaurar').addEventListener('click', () => { delete E.ajustes[editando]; salvarAjustes(); aplicarAjustes(); $('dlg').close(); desenhar(); });

  /* ---------- início ---------- */
  (async function(){
    E.painel = await buscar('painel'); E.estrutura = await buscar('estrutura');
    if (E.painel && E.painel.conjuntos) iniciarPainel(); else { E.painel = null; abrirImportar(); }
  })();
})();
