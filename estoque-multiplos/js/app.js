/* Estoque de Múltiplos — tela. As contas ficam em regras.js. */
(function(){
  'use strict';
  const R = window.EM_REGRAS;
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const num = n => Math.round(n || 0).toLocaleString('pt-BR');
  const pct = x => (x == null || isNaN(x)) ? '—' : (Math.round(x * 1000) / 10).toLocaleString('pt-BR') + '%';
  const brl = n => (n || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL', maximumFractionDigits: 0});
  function brlCurto(n){
    n = n || 0;
    if (Math.abs(n) >= 1e6) return 'R$ ' + (n / 1e6).toLocaleString('pt-BR', {maximumFractionDigits: 2}) + ' mi';
    if (Math.abs(n) >= 1e4) return 'R$ ' + Math.round(n / 1e3).toLocaleString('pt-BR') + ' mil';
    return brl(n);
  }
  const nomeRestr = r => (R.RESTR_NOME[r] || r) + ' (' + r + ')';

  const E = {
    painel: null, estrutura: null, custos: null, historico: [],
    ajustes: lerLocal('em-ajustes', {}),
    aba: lerLocal('em-aba', 'visao'),
    tipo: '', fornecedor: '', peso: '',
    status: '', busca: '', abertos: new Set(), abertosOp: new Set(),
    ordF: {col: 'descasados', dir: -1}, filtroOp: 'todos', limiteOp: 30, verTudoOp: {}, tiposTodos: false, limiteM: 50
  };
  const valor = n => E.painel && E.painel.temCusto ? brl(n) : '—';
  const valorCurto = n => E.painel && E.painel.temCusto ? brlCurto(n) : '—';

  /* ---------- guarda local ---------- */
  function lerLocal(k, padrao){ try { const v = localStorage.getItem(k); return v == null ? padrao : JSON.parse(v); } catch (e){ return padrao; } }
  function gravarLocal(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch (e){ /* sem espaço */ } }
  function banco(){
    return new Promise((ok, falha) => {
      const r = indexedDB.open('estoque-multiplos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('dados');
      r.onsuccess = () => ok(r.result); r.onerror = () => falha(r.error);
    });
  }
  async function guardar(chave, v){ try { const db = await banco(); db.transaction('dados', 'readwrite').objectStore('dados').put(v, chave); } catch (e){ /* segue */ } }
  async function buscar(chave){
    try {
      const db = await banco();
      return await new Promise(ok => { const r = db.transaction('dados').objectStore('dados').get(chave); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); });
    } catch (e){ return null; }
  }

  /* ---------- dados ---------- */
  let todos = [];
  function aplicarAjustes(){
    todos = E.painel.conjuntos.map(c => { const a = E.ajustes[c.pai]; return a ? Object.assign({}, c, a, {manual: true}) : c; });
  }
  const filtrados = () => todos.filter(c => (!E.tipo || c.tipo === E.tipo) && (!E.fornecedor || c.fornecedor === E.fornecedor) && (!E.peso || c.peso === E.peso));
  function agrega(lista){
    const s = {multiplos: lista.length, comDesc: 0, casados: 0, casadosVenda: 0, foraVenda: 0, descasados: 0, descSemS: 0,
      pecasTotal: 0, pecasSemPar: 0, valorCasado: 0, valorForaVenda: 0, valorParado: 0, valorRisco: 0};
    lista.forEach(c => {
      for (const k in s) if (k !== 'multiplos' && k !== 'comDesc') s[k] += c[k] || 0;
      if (c.descasados > 0) s.comDesc++;
    });
    s.indice = s.pecasTotal ? (s.pecasTotal - s.pecasSemPar) / s.pecasTotal : null;
    s.taxaDesc = (s.casados + s.descasados) ? s.descasados / (s.casados + s.descasados) : 0;
    return s;
  }
  function agruparPor(lista, chave){
    const m = new Map();
    lista.forEach(c => { const k = typeof chave === 'function' ? chave(c) : c[chave]; let g = m.get(k); if (!g) m.set(k, g = []); g.push(c); });
    return m;
  }
  function somaPor(linhas, chaveFn, campo){
    const m = new Map();
    linhas.forEach(x => { const k = chaveFn(x); const g = m.get(k) || {q: 0, v: 0}; g.q += x[campo || 'q']; g.v += x.valor || 0; m.set(k, g); });
    return [...m.entries()].sort((a, b) => b[1].q - a[1].q);
  }
  const ordemPeso = (a, b) => (a.pesoKg || 1e12) - (b.pesoKg || 1e12);
  const semParDe = lista => [].concat(...lista.map(c => c.semPar));
  const moverDe = lista => [].concat(...lista.map(c => c.mover));

  /* ---------- pedaços de tela ---------- */
  function kpi(rotulo, grande, pequeno, classe){
    return '<div class="kpi ' + (classe || '') + '"><span>' + rotulo + '</span><strong>' + grande + '</strong><small>' + pequeno + '</small></div>';
  }
  function barraDupla(a, b){
    const t = a + b || 1;
    return '<div class="duo" title="' + num(a) + ' casados · ' + num(b) + ' descasados"><i class="c" style="width:' + (a / t * 100) + '%"></i><i class="d" style="width:' + (b / t * 100) + '%"></i></div>';
  }
  function listaBarras(itens, opts){
    // itens: [[rótulo, {q, v}]]
    if (!itens.length) return '<p class="vazio">Nada aqui com esses filtros.</p>';
    const max = Math.max(...itens.map(x => x[1].q)) || 1, tot = itens.reduce((s, x) => s + x[1].q, 0) || 1;
    return '<div class="barras">' + itens.map(([rot, g]) =>
      '<div class="barra-linha"><span class="rot">' + esc(rot) + '</span><span class="trilho"><i class="' + (opts && opts.cor || '') + '" style="width:' + (g.q / max * 100) + '%"></i></span>' +
      '<span class="n">' + num(g.q) + ' <small>' + pct(g.q / tot) + '</small></span>' +
      (opts && opts.valor ? '<span class="n v">' + valorCurto(g.v) + '</span>' : '') + '</div>').join('') + '</div>';
  }
  function bloco(titulo, dica, corpo, extra){
    return '<section class="bloco ' + (extra || '') + '"><div class="bloco-cab"><h2>' + titulo + '</h2>' + (dica ? '<p class="dica">' + dica + '</p>' : '') + '</div>' + corpo + '</section>';
  }
  function selo(c){
    return c.status === 'Descasado' ? '<span class="selo d">Descasado</span>' : c.foraVenda ? '<span class="selo f">Casado fora da venda</span>' : '<span class="selo c">Casado</span>';
  }

  /* ---------- VISÃO GERAL ---------- */
  function vistaVisao(){
    const lista = filtrados(), s = agrega(lista);
    let h = '<div class="kpis">' +
      kpi('Conjuntos casados', num(s.casados), num(s.casadosVenda) + ' à venda · ' + valorCurto(s.valorCasado), 'azul') +
      kpi('Conjuntos descasados', num(s.descasados), 'em ' + num(s.comDesc) + ' múltiplos · ' + num(s.pecasSemPar) + ' peças sem par', 'laranja') +
      kpi('Índice de casamento', pct(s.indice), 'das ' + num(s.pecasTotal) + ' peças no CD formam conjunto inteiro') +
      kpi('Valor parado', valorCurto(s.valorParado), 'peça que vale (S) sem o par no CD', 'laranja') +
      kpi('Valor em risco', valorCurto(s.valorRisco), num(s.descSemS) + ' conjuntos sem a peça que vale (S)') +
      kpi('Casados fora da venda', num(s.foraVenda), 'inteiros no CD, mas com peça fora do vendável · ' + valorCurto(s.valorForaVenda)) +
      '</div>';

    // panorama fornecedor x peso quando há um tipo escolhido
    if (E.tipo) h += bloco(esc(E.tipo) + ' — casados por fornecedor e peso', 'Número grande = conjuntos casados. Em laranja, os descasados. Clique para filtrar.', panorama(lista), 'largo');

    const porTipo = [...agruparPor(lista, 'tipo').entries()].map(([t, l]) => [t, agrega(l)]).sort((a, b) => b[1].descasados - a[1].descasados || b[1].casados - a[1].casados);
    h += '<div class="duas">';
    h += bloco('Casados × descasados por tipo', 'Clique em um tipo para filtrar o painel.',
      '<div class="rolagem"><table><thead><tr><th>Tipo</th><th class="n">Casados</th><th class="n">Descasados</th><th></th><th class="n">Índice</th><th class="n">Valor parado</th></tr></thead><tbody>' +
      porTipo.slice(0, E.tiposTodos ? 1e9 : 12).map(([t, a]) => '<tr class="clicavel" data-filtro-tipo="' + esc(t) + '"><td>' + esc(t) + '</td><td class="n">' + num(a.casados) + '</td><td class="n forte-l">' + num(a.descasados) + '</td><td class="w-barra">' + barraDupla(a.casados, a.descasados) + '</td><td class="n">' + pct(a.indice) + '</td><td class="n">' + valor(a.valorParado) + '</td></tr>').join('') +
      '</tbody></table></div>' + (porTipo.length > 12 ? '<p class="mais"><button type="button" class="link" data-tipos-todos="1">' + (E.tiposTodos ? 'Mostrar só os 12 principais' : 'Mostrar todos os ' + porTipo.length + ' tipos') + '</button></p>' : ''));
    const ofens = [...agruparPor(lista, 'fornecedor').entries()].map(([f, l]) => [f, agrega(l)])
      .filter(x => x[1].descasados > 0).sort((a, b) => E.painel.temCusto ? (b[1].valorParado + b[1].valorRisco) - (a[1].valorParado + a[1].valorRisco) || b[1].descasados - a[1].descasados : b[1].descasados - a[1].descasados).slice(0, 10);
    h += bloco('Fornecedores ofensores', E.painel.temCusto ? 'Top 10 por valor parado + em risco.' : 'Top 10 por conjuntos descasados.',
      listaBarras(ofens.map(([f, a]) => [f, {q: a.descasados, v: a.valorParado + a.valorRisco}]), {cor: 'laranja', valor: true}) +
      '<p class="mais"><button type="button" class="link" data-ir="fornecedores">Ver ranking completo →</button></p>');
    h += '</div>';

    const sp = semParDe(lista);
    h += '<div class="duas">' +
      bloco('Onde estão as peças sem par', 'Restrição em que a peça descasada está hoje.', listaBarras(somaPor(sp, x => nomeRestr(x.r)), {cor: 'laranja', valor: true})) +
      bloco('Qual peça mais falta', 'Peças que faltam para completar os conjuntos descasados.', listaBarras(faltas(lista)), '') +
      '</div>';
    return h;
  }
  function faltas(lista){
    const m = new Map();
    lista.forEach(c => c.comps.forEach(p => { if (p.falta > 0){ const g = m.get(p.papel) || {q: 0, v: 0}; g.q += p.falta; m.set(p.papel, g); } }));
    return [...m.entries()].sort((a, b) => b[1].q - a[1].q).slice(0, 12);
  }
  function panorama(lista){
    const pesos = [...new Map(lista.map(c => [c.peso, c])).values()].sort(ordemPeso).map(c => c.peso);
    const forn = [...agruparPor(lista, 'fornecedor').entries()].map(([f, l]) => {
      const cel = {}; l.forEach(c => { const k = cel[c.peso] || (cel[c.peso] = {c: 0, d: 0}); k.c += c.casados; k.d += c.descasados; });
      return [f, cel, agrega(l)];
    }).sort((a, b) => b[2].casados - a[2].casados);
    const cel = (k, f, p) => !k ? '<td class="nada">·</td>' :
      '<td class="cel' + (E.fornecedor === f && E.peso === p ? ' sel' : '') + '" data-f="' + esc(f) + '" data-p="' + esc(p) + '"><b>' + num(k.c) + '</b>' + (k.d ? '<span class="aviso">' + num(k.d) + '</span>' : '') + '</td>';
    const totP = p => { const k = {c: 0, d: 0}; forn.forEach(([, x]) => { if (x[p]){ k.c += x[p].c; k.d += x[p].d; } }); return k; };
    const tot = agrega(lista);
    return '<div class="rolagem"><table class="matriz"><thead><tr><th>Fornecedor</th>' + pesos.map(p => '<th>' + esc(p) + '</th>').join('') + '<th>Total</th></tr></thead><tbody>' +
      forn.map(([f, x, a]) => '<tr><td>' + esc(f) + '</td>' + pesos.map(p => cel(x[p], f, p)).join('') + cel({c: a.casados, d: a.descasados}, f, '').replace('class="cel', 'class="cel tot') + '</tr>').join('') +
      '</tbody><tfoot><tr><td>Total</td>' + pesos.map(p => { const k = totP(p); return '<td><b>' + num(k.c) + '</b>' + (k.d ? '<span class="aviso">' + num(k.d) + '</span>' : '') + '</td>'; }).join('') +
      '<td><b>' + num(tot.casados) + '</b>' + (tot.descasados ? '<span class="aviso">' + num(tot.descasados) + '</span>' : '') + '</td></tr></tfoot></table></div>';
  }

  /* ---------- FORNECEDORES ---------- */
  const COLS_F = [
    ['fornecedor', 'Fornecedor', 0], ['multiplos', 'Múltiplos', 1], ['casados', 'Casados', 1], ['descasados', 'Descasados', 1],
    ['taxaDesc', '% descasado', 1], ['pecasSemPar', 'Peças sem par', 1], ['valorParado', 'Valor parado', 1], ['valorRisco', 'Valor em risco', 1],
    ['foraVenda', 'Casados fora da venda', 1]
  ];
  function vistaFornecedores(){
    const lista = filtrados();
    const linhas = [...agruparPor(lista, 'fornecedor').entries()].map(([f, l]) => {
      const a = agrega(l); a.fornecedor = f;
      const sp = semParDe(l);
      a.gargalo = (somaPor(sp, x => R.RESTR_NOME[x.r] || x.r)[0] || [''])[0];
      a.falta = (faltas(l)[0] || [''])[0];
      return a;
    });
    const {col, dir} = E.ordF;
    linhas.sort((a, b) => col === 'fornecedor' ? dir * a.fornecedor.localeCompare(b.fornecedor) : dir * ((a[col] || 0) - (b[col] || 0)) || b.descasados - a.descasados);
    const maxD = Math.max(1, ...linhas.map(a => a.descasados));
    const th = ([k, r, n]) => '<th class="ord' + (n ? ' n' : '') + '" data-ord="' + k + '">' + r + (col === k ? (dir < 0 ? ' ▾' : ' ▴') : '') + '</th>';
    return bloco('Ranking de fornecedores', 'Clique no título da coluna para ordenar e no fornecedor para ver os múltiplos dele.',
      '<div class="rolagem"><table><thead><tr>' + COLS_F.map(th).join('') + '<th>Principal gargalo</th><th>Peça que mais falta</th></tr></thead><tbody>' +
      linhas.map(a => '<tr class="clicavel" data-ver-forn="' + esc(a.fornecedor) + '"><td><strong>' + esc(a.fornecedor) + '</strong></td><td class="n">' + num(a.multiplos) + '</td><td class="n">' + num(a.casados) + '</td>' +
        '<td class="n"><span class="mini"><i style="width:' + (a.descasados / maxD * 100) + '%"></i></span><b class="forte-l">' + num(a.descasados) + '</b></td><td class="n">' + pct(a.taxaDesc) + '</td><td class="n">' + num(a.pecasSemPar) + '</td>' +
        '<td class="n">' + valor(a.valorParado) + '</td><td class="n">' + valor(a.valorRisco) + '</td><td class="n">' + num(a.foraVenda) + '</td>' +
        '<td>' + esc(a.gargalo || '—') + '</td><td>' + esc(a.falta || '—') + '</td></tr>').join('') +
      '</tbody></table></div>', 'largo');
  }

  /* ---------- GARGALOS ---------- */
  function faixaIdade(d){
    if (d == null) return 'Sem data';
    if (d <= 7) return 'Até 7 dias'; if (d <= 30) return '8 a 30 dias'; if (d <= 90) return '31 a 90 dias';
    if (d <= 180) return '91 a 180 dias'; return 'Mais de 180 dias';
  }
  const ORDEM_IDADE = ['Até 7 dias', '8 a 30 dias', '31 a 90 dias', '91 a 180 dias', 'Mais de 180 dias', 'Sem data'];
  function vistaGargalos(){
    const lista = filtrados(), sp = semParDe(lista), mv = moverDe(lista);
    const idade = somaPor(sp, x => faixaIdade(x.idade)).sort((a, b) => ORDEM_IDADE.indexOf(a[0]) - ORDEM_IDADE.indexOf(b[0]));
    const area = somaPor(sp, x => x.cl ? x.cl + (x.clNome ? ' — ' + x.clNome : '') : '(sem área)').slice(0, 12);
    const inv = sp.filter(x => x.inv).reduce((s, x) => s + x.q, 0);
    return '<div class="duas">' +
      bloco('Peças sem par por restrição', 'Onde a peça descasada está parada.', listaBarras(somaPor(sp, x => nomeRestr(x.r)), {cor: 'laranja', valor: true})) +
      bloco('Peças sem par por área', 'Classe do local (armazenagem, reversa, avaria, doca…).', listaBarras(area, {cor: 'laranja', valor: true})) +
      bloco('Há quanto tempo estão paradas', 'Pela data da última situação do endereço na QRY0390.', listaBarras(idade, {cor: 'laranja', valor: true})) +
      bloco('Qual peça mais falta', 'Quantas peças faltam para fechar os conjuntos descasados.', listaBarras(faltas(lista))) +
      bloco('Conjuntos inteiros presos fora da venda', 'Peças de conjuntos já casados que estão em outra restrição — juntá-las no vendável libera a venda.', listaBarras(somaPor(mv, x => nomeRestr(x.r)), {cor: 'azul'})) +
      bloco('Descasados por tipo de problema', '',
        listaBarras([
          ['Falta peça N (a S está no CD)', {q: agrega(lista).descasados - agrega(lista).descSemS, v: agrega(lista).valorParado}],
          ['Falta a peça S (investigar)', {q: agrega(lista).descSemS, v: agrega(lista).valorRisco}]
        ].filter(x => x[1].q > 0), {cor: 'laranja', valor: true}) +
        (inv ? '<p class="dica pad">' + num(inv) + ' peças sem par estão em local em inventário agora.</p>' : '')) +
      '</div>';
  }

  /* ---------- OPORTUNIDADES ---------- */
  function resumoPecas(linhas){
    const m = new Map();
    linhas.forEach(x => { const k = x.papel + '|' + x.r; m.set(k, (m.get(k) || 0) + x.q); });
    return [...m.entries()].map(([k, q]) => { const [p, r] = k.split('|'); return num(q) + ' ' + p + ' em ' + (R.RESTR_NOME[r] || r); }).join(' · ');
  }
  function enderecos(linhas){
    const m = new Map();
    linhas.forEach(x => { const k = [x.item, x.r, x.cl, x.end || x.local, x.inv].join('|'); const g = m.get(k); if (g) g.q += x.q; else m.set(k, Object.assign({}, x)); });
    linhas = [...m.values()].sort((a, b) => b.q - a.q);
    return '<table class="enderecos"><thead><tr><th>Peça</th><th>Item</th><th>Restrição</th><th>Área</th><th>Endereço</th><th class="n">Qtde</th></tr></thead><tbody>' +
      linhas.map(x => '<tr><td>' + esc(x.papel) + (x.principal ? ' <span class="principal">S</span>' : '') + '</td><td>' + esc(x.item) + '</td><td>' + esc(nomeRestr(x.r)) + '</td><td>' + esc(x.cl || '—') + '</td><td>' + esc(x.end || x.local || '—') + (x.inv ? ' <span class="inv">em inventário</span>' : '') + '</td><td class="n">' + num(x.q) + '</td></tr>').join('') +
      '</tbody></table>';
  }
  function vistaOportunidades(){
    const lista = filtrados();
    const juntar = lista.filter(c => c.foraVenda > 0).sort((a, b) => b.valorForaVenda - a.valorForaVenda || b.foraVenda - a.foraVenda);
    const compl = lista.filter(c => c.descasados > 0).sort((a, b) => (b.valorParado + b.valorRisco) - (a.valorParado + a.valorRisco) || b.descasados - a.descasados);
    const ja = agrega(juntar), co = agrega(compl);
    const lim = E.limiteOp, mais = (n, k) => n > lim ? '<p class="mais"><button type="button" class="link" data-mais-op="' + k + '">Mostrar todos (' + num(n) + ')</button></p>' : '';
    const linhaOp = (c, colunas) => {
      const ab = E.abertosOp.has(c.pai);
      return '<tr class="clicavel' + (ab ? ' aberta' : '') + '" data-op="' + esc(c.pai) + '"><td><span class="seta">▸</span></td>' + colunas + '</tr>' +
        (ab ? '<tr class="sub"><td></td><td colspan="6">' + enderecos(colunas.includes('data-j') ? c.mover : c.semPar) + '</td></tr>' : '');
    };
    let h = '<div class="kpis tres">' +
      kpi('Juntar no vendável', num(ja.foraVenda) + ' conj.', valorCurto(ja.valorForaVenda) + ' que já podem virar venda', 'azul') +
      kpi('Falta peça N', num(co.descasados - co.descSemS) + ' conj.', valorCurto(co.valorParado) + ' parados esperando o par', 'laranja') +
      kpi('Falta a peça S', num(co.descSemS) + ' conj.', valorCurto(co.valorRisco) + ' em risco — investigar') +
      '</div>';
    h += bloco('1. Juntar no vendável — conjuntos inteiros fora da venda', 'O conjunto está todo no CD, mas alguma peça está em outra restrição. Clique para ver os endereços.',
      juntar.length ? '<div class="rolagem"><table><thead><tr><th></th><th>Múltiplo</th><th>Fornecedor</th><th class="n">Conjuntos a liberar</th><th class="n">Valor</th><th>O que mover para o vendável</th></tr></thead><tbody>' +
      juntar.slice(0, E.verTudoOp.j ? 1e9 : lim).map(c => linhaOp(c, '<td data-j>' + esc(c.nome) + '<small>Item pai ' + esc(c.pai) + ' · ' + esc(c.tipo) + '</small></td><td>' + esc(c.fornecedor) + '</td><td class="n forte">' + num(c.foraVenda) + '</td><td class="n">' + valor(c.valorForaVenda) + '</td><td>' + esc(resumoPecas(c.mover)) + '</td>')).join('') +
      '</tbody></table></div>' + (E.verTudoOp.j ? '' : mais(juntar.length, 'j')) : '<p class="vazio">Nenhum conjunto inteiro fora da venda.</p>', 'largo');
    const f = E.filtroOp;
    const comp = compl.filter(c => f === 'todos' || (f === 'n' ? c.descasados > c.descSemS : c.descSemS > 0));
    h += bloco('2. Completar ou investigar — conjuntos descasados',
      '<span class="chips">' + [['todos', 'Todos'], ['n', 'Falta peça N (cobrar/receber)'], ['s', 'Falta a peça S (investigar)']].map(([k, r]) => '<button type="button" class="chip' + (f === k ? ' ativo' : '') + '" data-fop="' + k + '">' + r + '</button>').join('') + '</span>',
      comp.length ? '<div class="rolagem"><table><thead><tr><th></th><th>Múltiplo</th><th>Fornecedor</th><th class="n">Descasados</th><th>O que falta</th><th class="n">Valor parado / risco</th><th class="n">Parado há</th></tr></thead><tbody>' +
      comp.slice(0, E.verTudoOp.c ? 1e9 : lim).map(c => linhaOp(c, '<td>' + esc(c.nome) + '<small>Item pai ' + esc(c.pai) + ' · ' + esc(c.tipo) + '</small></td><td>' + esc(c.fornecedor) + '</td><td class="n forte-l">' + num(c.descasados) + '</td>' +
        '<td>' + c.comps.filter(p => p.falta > 0).map(p => num(p.falta) + ' ' + esc(p.papel) + (p.principal ? ' <span class="principal">S</span>' : '')).join(' · ') + '</td>' +
        '<td class="n">' + valor(c.valorParado + c.valorRisco) + '</td><td class="n">' + (c.idadeSemPar == null ? '—' : num(c.idadeSemPar) + ' d') + '</td>')).join('') +
      '</tbody></table></div>' + (E.verTudoOp.c ? '' : mais(comp.length, 'c')) : '<p class="vazio">Nenhum conjunto descasado aqui.</p>', 'largo');
    return h;
  }

  /* ---------- MÚLTIPLOS ---------- */
  function vistaMultiplos(){
    const b = E.busca.trim().toUpperCase();
    const lista = filtrados().filter(c => (!E.status || (E.status === 'Fora' ? c.foraVenda > 0 : c.status === E.status)) &&
      (!b || (c.nome + ' ' + c.modelo + ' ' + c.pai + ' ' + c.fornecedor + ' ' + c.comps.map(x => x.item + ' ' + x.nome).join(' ')).toUpperCase().includes(b)))
      .sort((a, b2) => b2.descasados - a.descasados || b2.casados - a.casados);
    const fil = '<div class="filtros"><select id="mStatus"><option value="">Toda situação</option>' +
      [['Casado', 'Casado'], ['Descasado', 'Descasado'], ['Fora', 'Casado fora da venda']].map(([v, r]) => '<option value="' + v + '"' + (E.status === v ? ' selected' : '') + '>' + r + '</option>').join('') +
      '</select><input type="search" id="mBusca" placeholder="Buscar nome, modelo ou código" value="' + esc(E.busca) + '"></div>';
    const corpo = !lista.length ? '<p class="vazio">Nada encontrado.</p>' :
      '<div class="rolagem"><table><thead><tr><th></th><th>Múltiplo</th><th>Fornecedor</th><th>Peso · Modelo</th><th class="n">Casados</th><th class="n">À venda</th><th class="n">Descasados</th><th class="n">Peças sem par</th><th class="n">Valor parado</th><th>Situação</th><th></th></tr></thead><tbody>' +
      lista.slice(0, E.limiteM).map(c => {
        const ab = E.abertos.has(c.pai);
        return '<tr class="clicavel' + (ab ? ' aberta' : '') + '" data-pai="' + esc(c.pai) + '"><td><span class="seta">▸</span></td><td>' + esc(c.nome) + (c.manual ? ' <span class="manual">corrigido</span>' : '') + '<small>Item pai ' + esc(c.pai) + ' · ' + esc(c.tipo) + ' · ' + c.comps.length + ' peças</small></td>' +
          '<td>' + esc(c.fornecedor) + '</td><td>' + esc(c.peso) + ' · ' + esc(c.modelo) + '</td><td class="n forte">' + num(c.casados) + '</td><td class="n">' + num(c.casadosVenda) + '</td>' +
          '<td class="n' + (c.descasados ? ' forte-l' : '') + '">' + num(c.descasados) + '</td><td class="n">' + num(c.pecasSemPar) + '</td><td class="n">' + valor(c.valorParado) + '</td><td>' + selo(c) + '</td>' +
          '<td><button type="button" class="link" data-editar="' + esc(c.pai) + '">corrigir</button></td></tr>' +
          (ab ? '<tr class="sub"><td></td><td colspan="10">' + detalheComps(c) + '</td></tr>' : '');
      }).join('') + '</tbody></table></div>' + (lista.length > E.limiteM ? '<p class="mais"><button type="button" class="link" data-mais-m="1">Mostrar mais (' + num(E.limiteM) + ' de ' + num(lista.length) + ')</button></p>' : '');
    return bloco('Múltiplos (' + num(lista.length) + ')', fil, corpo, 'largo');
  }
  function detalheComps(c){
    const restr = [...new Set([].concat(...c.comps.map(p => Object.keys(p.saldo))))].sort((a, b) => (a === 'WN' ? -1 : b === 'WN' ? 1 : a.localeCompare(b)));
    return '<table class="comps"><thead><tr><th>Peça</th><th>Item</th><th>Descrição</th><th>Valor</th><th class="n">Por conj.</th><th class="n">No CD</th>' +
      restr.map(r => '<th class="n" title="' + esc(R.RESTR_NOME[r] || r) + '">' + esc(r) + '</th>').join('') + '<th class="n">Sem par</th><th class="n">Falta</th></tr></thead><tbody>' +
      c.comps.map(p => '<tr><td>' + esc(p.papel) + '</td><td>' + esc(p.item) + '</td><td>' + (p.nome ? esc(p.nome) : '<em>sem saldo no CD</em>') + '</td>' +
        '<td>' + (p.principal ? '<span class="principal">S</span> ' + (p.custo ? brl(p.custo) : '') : 'N · zero') + '</td><td class="n">' + num(p.qtde) + '</td><td class="n">' + num(p.total) + '</td>' +
        restr.map(r => '<td class="n">' + (p.saldo[r] ? num(p.saldo[r]) : '·') + '</td>').join('') +
        '<td class="n' + (p.sobra ? ' forte-l' : '') + '">' + num(p.sobra) + '</td><td class="n' + (p.falta ? ' forte-l' : '') + '">' + num(p.falta) + '</td></tr>').join('') +
      '</tbody></table>' + (c.semPar.length ? '<p class="sub-tit">Onde estão as peças sem par</p>' + enderecos(c.semPar) : '') +
      (c.mover.length ? '<p class="sub-tit">Peças de conjuntos casados fora do vendável</p>' + enderecos(c.mover) : '');
  }

  /* ---------- EVOLUÇÃO ---------- */
  function fotoDe(lista){
    const a = agrega(lista);
    return {casados: a.casados, casadosVenda: a.casadosVenda, descasados: a.descasados, pecasSemPar: a.pecasSemPar, pecasTotal: a.pecasTotal,
      valorParado: a.valorParado, valorRisco: a.valorRisco, foraVenda: a.foraVenda, indice: a.indice};
  }
  function tirarFoto(){
    if (!E.painel) return;
    const f = {data: E.painel.dataBase || new Date().toLocaleDateString('pt-BR'), quando: Date.now(), temCusto: E.painel.temCusto,
      geral: fotoDe(todos), tipo: {}, fornecedor: {}};
    agruparPor(todos, 'tipo').forEach((l, k) => { f.tipo[k] = fotoDe(l); });
    agruparPor(todos, 'fornecedor').forEach((l, k) => { f.fornecedor[k] = fotoDe(l); });
    E.historico = E.historico.filter(x => x.data !== f.data).concat(f);
    E.historico.sort((a, b) => ordData(a.data) - ordData(b.data));
    guardar('historico', E.historico);
  }
  function ordData(t){ const m = String(t).match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? +(m[3] + m[2] + m[1]) : 0; }
  function vistaEvolucao(){
    const recorte = E.fornecedor ? ['fornecedor', E.fornecedor] : E.tipo ? ['tipo', E.tipo] : null;
    const pontos = E.historico.map(f => ({data: f.data, temCusto: f.temCusto, v: recorte ? f[recorte[0]][recorte[1]] : f.geral})).filter(p => p.v);
    const titulo = 'Evolução — ' + (recorte ? esc(recorte[1]) : 'CD inteiro');
    if (pontos.length < 2){
      return bloco(titulo, '', '<p class="vazio">A cada carga da QRY0390 o painel guarda uma foto do dia. ' +
        (pontos.length ? 'Já há 1 foto (' + esc(pontos[0].data) + '). ' : '') + 'Com duas ou mais datas, aqui aparece a evolução de casados, descasados e valor parado.</p>' + tabelaEvolucao(pontos), 'largo');
    }
    return bloco(titulo, 'Uma foto por data de estoque. O filtro de peso não vale aqui.',
      '<div class="graf-duplo">' + linha(pontos, p => p.v.indice * 100, 'Índice de casamento (%)', 'azul', v => (Math.round(v * 10) / 10).toLocaleString('pt-BR') + '%') +
      linha(pontos, p => p.v.descasados, 'Conjuntos descasados', 'laranja', num) + '</div>' + tabelaEvolucao(pontos), 'largo');
  }
  function tabelaEvolucao(pontos){
    if (!pontos.length) return '';
    return '<div class="rolagem"><table><thead><tr><th>Data do estoque</th><th class="n">Casados</th><th class="n">À venda</th><th class="n">Descasados</th><th class="n">Peças sem par</th><th class="n">Índice</th><th class="n">Valor parado</th><th class="n">Valor em risco</th><th></th></tr></thead><tbody>' +
      pontos.slice().reverse().map(p => '<tr><td>' + esc(p.data) + '</td><td class="n">' + num(p.v.casados) + '</td><td class="n">' + num(p.v.casadosVenda) + '</td><td class="n forte-l">' + num(p.v.descasados) + '</td><td class="n">' + num(p.v.pecasSemPar) + '</td><td class="n">' + pct(p.v.indice) + '</td>' +
        '<td class="n">' + (p.temCusto ? brl(p.v.valorParado) : '—') + '</td><td class="n">' + (p.temCusto ? brl(p.v.valorRisco) : '—') + '</td><td><button type="button" class="link" data-apagar-foto="' + esc(p.data) + '">apagar</button></td></tr>').join('') +
      '</tbody></table></div>';
  }
  function linha(pontos, fn, titulo, cor, fmt){
    const W = 520, H = 180, m = {l: 8, r: 8, t: 20, b: 26};
    const vs = pontos.map(fn), min = Math.min(...vs), max = Math.max(...vs), faixa = (max - min) || 1;
    const x = i => m.l + (pontos.length === 1 ? 0 : i * (W - m.l - m.r) / (pontos.length - 1));
    const y = v => m.t + (H - m.t - m.b) * (1 - (v - min) / faixa);
    const pts = vs.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
    return '<figure class="graf"><figcaption>' + titulo + '</figcaption><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(titulo) + '">' +
      '<polyline class="l-' + cor + '" points="' + pts + '"/>' +
      vs.map((v, i) => '<circle class="p-' + cor + '" cx="' + x(i) + '" cy="' + y(v) + '" r="4"><title>' + esc(pontos[i].data) + ': ' + fmt(v) + '</title></circle>' +
        ((i === vs.length - 1 || i === 0) ? '<text x="' + x(i) + '" y="' + (y(v) - 8) + '" text-anchor="' + (i === 0 ? 'start' : 'end') + '">' + fmt(v) + '</text>' : '') +
        '<text class="eixo" x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === vs.length - 1 ? 'end' : 'middle') + '">' + esc(pontos[i].data.slice(0, 5)) + '</text>').join('') +
      '</svg></figure>';
  }

  /* ---------- montagem da tela ---------- */
  const VISTAS = {visao: vistaVisao, fornecedores: vistaFornecedores, gargalos: vistaGargalos, oportunidades: vistaOportunidades, multiplos: vistaMultiplos, evolucao: vistaEvolucao};
  function desenhar(){
    $('importar').hidden = true; $('painel').hidden = false; $('acoes').hidden = false; $('abas').hidden = false;
    $('dataBase').textContent = E.painel.dataBase ? '· estoque de ' + E.painel.dataBase : '';
    if (!VISTAS[E.aba]) E.aba = 'visao';
    document.querySelectorAll('#abas [data-aba]').forEach(b => b.classList.toggle('ativo', b.dataset.aba === E.aba));
    desenharFiltros();
    $('faixaCusto').hidden = E.painel.temCusto && !E.painel.semCusto;
    $('faixaCusto').innerHTML = !E.painel.temCusto
      ? 'Sem a base de custo os valores em R$ ficam em branco. Clique em <b>Atualizar bases</b> e carregue a QRY0278 (ou outra planilha com Item e Preço de custo).'
      : num(E.painel.semCusto) + ' múltiplos estão sem custo na peça S — o valor deles fica zerado.';
    $('vista').innerHTML = VISTAS[E.aba]() + '<p class="rodape">' + num(E.painel.totalPais) + ' múltiplos cadastrados na ZBIQ0051 · ' + num(todos.length) +
      ' com peça no CD · ' + num(E.painel.semEstoque) + ' sem nenhuma peça (fora do painel). Fornecedor, tipo, peso e modelo são lidos do nome do item; corrija na aba Múltiplos quando errar.</p>';
  }
  function desenharFiltros(){
    const base = todos;
    const tipos = [...agruparPor(base, 'tipo').entries()].sort((a, b) => b[1].length - a[1].length);
    const noTipo = base.filter(c => !E.tipo || c.tipo === E.tipo);
    const forn = [...new Set(noTipo.map(c => c.fornecedor))].sort((a, b) => a.localeCompare(b));
    if (E.fornecedor && !forn.includes(E.fornecedor)) E.fornecedor = '';
    const pesos = [...new Map(noTipo.filter(c => !E.fornecedor || c.fornecedor === E.fornecedor).map(c => [c.peso, c])).values()].sort(ordemPeso).map(c => c.peso);
    if (E.peso && !pesos.includes(E.peso)) E.peso = '';
    const op = (v, sel, rot) => '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(rot || v) + '</option>';
    $('gTipo').innerHTML = op('', E.tipo, 'Todos (' + base.length + ')') + tipos.map(([t, l]) => op(t, E.tipo, t + ' (' + l.length + ')')).join('');
    $('gFornecedor').innerHTML = op('', E.fornecedor, 'Todos') + forn.map(f => op(f, E.fornecedor)).join('');
    $('gPeso').innerHTML = op('', E.peso, 'Todos') + pesos.map(p => op(p, E.peso)).join('');
    $('lbPeso').hidden = !E.tipo;
    $('gLimpar').hidden = !(E.tipo || E.fornecedor || E.peso);
    const n = filtrados().length;
    $('gResumo').textContent = (E.tipo || E.fornecedor || E.peso) ? num(n) + ' múltiplos no filtro' : '';
  }
  function irPara(aba){ E.aba = aba; gravarLocal('em-aba', aba); desenhar(); window.scrollTo({top: 0}); }

  /* ---------- importação ---------- */
  const arq = {f390: null, f051: null, fCusto: null};
  function abrirImportar(){
    $('importar').hidden = false; $('painel').hidden = true; $('abas').hidden = true;
    $('btCancelar').hidden = !E.painel;
    $('st051').textContent = E.estrutura ? 'Já guardada — só envie se a composição mudou' : 'Obrigatória na primeira vez';
    $('stCusto').textContent = E.custos && E.custos.length ? 'Já guardada (' + num(E.custos.length) + ' itens) — envie para atualizar' : 'Opcional — libera os valores em R$';
    $('erro').hidden = true; $('progresso').hidden = true;
    conferirBotao();
  }
  function conferirBotao(){ $('btProcessar').disabled = !(arq.f390 && (arq.f051 || E.estrutura)); }
  function escolher(id, caixa, rotulo){
    $(id).addEventListener('change', e => {
      arq[id] = e.target.files[0] || null;
      $(rotulo).textContent = arq[id] ? arq[id].name : 'Escolher arquivo';
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
      const bufCusto = arq.fCusto ? await arq.fCusto.arrayBuffer() : null;
      const w = new Worker('./js/worker.js');
      w.onerror = () => { falhar('Não consegui abrir o leitor de planilhas. Verifique a internet e tente de novo.'); w.terminate(); };
      w.onmessage = ev => {
        const m = ev.data;
        if (m.tipo === 'progresso') prog(m.texto, m.pct);
        else if (m.tipo === 'erro'){ falhar(m.texto); w.terminate(); }
        else if (m.tipo === 'pronto'){
          w.terminate();
          E.painel = m.painel; E.estrutura = m.estrutura; E.custos = m.custos;
          guardar('painel', m.painel); guardar('estrutura', m.estrutura); guardar('custos', m.custos);
          aplicarAjustes(); tirarFoto(); desenhar();
        }
      };
      const transf = [buf390, buf051, bufCusto].filter(Boolean);
      w.postMessage({buf390, buf051, bufCusto, estrutura: buf051 ? null : E.estrutura, custos: bufCusto ? null : E.custos}, transf);
    } catch (e){ falhar(e.message || String(e)); }
  }
  function falhar(t){ $('erro').textContent = t; $('erro').hidden = false; $('progresso').hidden = true; conferirBotao(); }

  /* ---------- correção manual ---------- */
  let editando = null;
  function abrirEdicao(pai){
    const c = todos.find(x => x.pai === pai); if (!c) return;
    editando = pai;
    $('dlgNome').textContent = c.nome + ' (item pai ' + c.pai + ')';
    $('eFornecedor').value = c.fornecedor; $('eTipo').value = c.tipo;
    $('ePeso').value = c.pesoKg ? c.peso : ''; $('eModelo').value = c.modelo === 'Sem modelo' ? '' : c.modelo;
    $('lsFornecedor').innerHTML = [...new Set(todos.map(x => x.fornecedor))].sort().map(v => '<option value="' + esc(v) + '">').join('');
    $('lsTipo').innerHTML = [...new Set(todos.map(x => x.tipo).concat(R.TIPOS.map(t => t[0])))].sort().map(v => '<option value="' + esc(v) + '">').join('');
    $('dlgRestaurar').hidden = !E.ajustes[pai];
    $('dlg').showModal();
  }
  function salvarEdicao(){
    const txt = $('ePeso').value.trim(), kg = txt ? (R.pesosDoNome(txt)[0] || 0) : 0;
    E.ajustes[editando] = {
      fornecedor: $('eFornecedor').value.trim().toUpperCase() || 'Sem fornecedor',
      tipo: $('eTipo').value.trim() || 'Outros',
      pesoKg: kg, peso: kg ? R.rotuloPeso(kg) : (txt || 'Sem peso'),
      modelo: $('eModelo').value.trim().toUpperCase() || 'Sem modelo'
    };
    gravarLocal('em-ajustes', E.ajustes); aplicarAjustes(); desenhar();
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
    const lista = filtrados(), tc = E.painel.temCusto, v = n => tc ? Math.round(n * 100) / 100 : '';
    const forn = [...agruparPor(lista, 'fornecedor').entries()].map(([f, l]) => { const a = agrega(l); return {'Fornecedor': f, 'Múltiplos': a.multiplos, 'Casados': a.casados, 'Casados à venda': a.casadosVenda,
      'Descasados': a.descasados, '% descasado': Math.round(a.taxaDesc * 1000) / 10, 'Peças sem par': a.pecasSemPar, 'Valor parado': v(a.valorParado), 'Valor em risco': v(a.valorRisco), 'Casados fora da venda': a.foraVenda}; })
      .sort((a, b) => b['Descasados'] - a['Descasados']);
    const mult = lista.map(c => ({'Item pai': c.pai, 'Múltiplo': c.nome, 'Tipo': c.tipo, 'Fornecedor': c.fornecedor, 'Peso': c.peso, 'Modelo': c.modelo,
      'Casados': c.casados, 'Casados à venda': c.casadosVenda, 'Casados fora da venda': c.foraVenda, 'Descasados': c.descasados, 'Descasados sem a peça S': c.descSemS,
      'Peças no CD': c.pecasTotal, 'Peças sem par': c.pecasSemPar, 'Valor do conjunto': v(c.valorConj), 'Valor casado': v(c.valorCasado), 'Valor parado': v(c.valorParado), 'Valor em risco': v(c.valorRisco), 'Situação': c.status}));
    const linhaEnd = (c, x) => ({'Item pai': c.pai, 'Múltiplo': c.nome, 'Fornecedor': c.fornecedor, 'Peça': x.papel, 'Item': x.item, 'S/N': x.principal ? 'S' : 'N',
      'Restrição': x.r, 'Área': x.cl, 'Endereço': x.end, 'Local': x.local, 'Qtde': x.q});
    const sp = [].concat(...lista.map(c => c.semPar.map(x => Object.assign(linhaEnd(c, x), {'Valor': v(x.valor), 'Parado há (dias)': x.idade == null ? '' : x.idade}))));
    const mv = [].concat(...lista.map(c => c.mover.map(x => linhaEnd(c, x))));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(forn), 'Fornecedores');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mult), 'Múltiplos');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sp), 'Peças sem par');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mv), 'Juntar no vendável');
    const d = new Date(), p = n => String(n).padStart(2, '0');
    XLSX.writeFile(wb, 'estoque-multiplos-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.xlsx');
  }

  /* ---------- eventos ---------- */
  escolher('f390', 'cx390', 'nm390'); escolher('f051', 'cx051', 'nm051'); escolher('fCusto', 'cxCusto', 'nmCusto');
  $('btProcessar').addEventListener('click', processar);
  $('btCancelar').addEventListener('click', desenhar);
  $('btAtualizar').addEventListener('click', abrirImportar);
  $('btExcel').addEventListener('click', exportar);
  $('btImprimir').addEventListener('click', () => window.print());
  $('abas').addEventListener('click', e => { const b = e.target.closest('[data-aba]'); if (b) irPara(b.dataset.aba); });
  $('gTipo').addEventListener('change', e => { E.tipo = e.target.value; E.peso = ''; desenhar(); });
  $('gFornecedor').addEventListener('change', e => { E.fornecedor = e.target.value; desenhar(); });
  $('gPeso').addEventListener('change', e => { E.peso = e.target.value; desenhar(); });
  $('gLimpar').addEventListener('click', () => { E.tipo = E.fornecedor = E.peso = ''; desenhar(); });
  $('vista').addEventListener('click', e => {
    const t = e.target;
    let x;
    if ((x = t.closest('[data-editar]'))){ abrirEdicao(x.dataset.editar); return; }
    if ((x = t.closest('[data-ir]'))){ irPara(x.dataset.ir); return; }
    if ((x = t.closest('[data-filtro-tipo]'))){ E.tipo = x.dataset.filtroTipo; E.peso = ''; desenhar(); return; }
    if ((x = t.closest('[data-ver-forn]'))){ E.fornecedor = x.dataset.verForn; E.status = ''; irPara('multiplos'); return; }
    if ((x = t.closest('td.cel'))){
      const mesmo = E.fornecedor === x.dataset.f && E.peso === x.dataset.p;
      E.fornecedor = mesmo ? '' : x.dataset.f; E.peso = mesmo ? '' : x.dataset.p; desenhar(); return;
    }
    if ((x = t.closest('[data-ord]'))){
      const k = x.dataset.ord; E.ordF = {col: k, dir: E.ordF.col === k ? -E.ordF.dir : (k === 'fornecedor' ? 1 : -1)}; desenhar(); return;
    }
    if ((x = t.closest('[data-mais-op]'))){ E.verTudoOp[x.dataset.maisOp] = true; desenhar(); return; }
    if ((x = t.closest('[data-mais-m]'))){ E.limiteM += 100; desenhar(); return; }
    if ((x = t.closest('[data-tipos-todos]'))){ E.tiposTodos = !E.tiposTodos; desenhar(); return; }
    if ((x = t.closest('[data-fop]'))){ E.filtroOp = x.dataset.fop; desenhar(); return; }
    if ((x = t.closest('[data-apagar-foto]'))){
      if (!confirm('Apagar a foto de ' + x.dataset.apagarFoto + ' da evolução?')) return;
      E.historico = E.historico.filter(f => f.data !== x.dataset.apagarFoto); guardar('historico', E.historico); desenhar(); return;
    }
    if ((x = t.closest('tr[data-op]'))){ const k = x.dataset.op; E.abertosOp.has(k) ? E.abertosOp.delete(k) : E.abertosOp.add(k); desenhar(); return; }
    if ((x = t.closest('tr[data-pai]'))){ const k = x.dataset.pai; E.abertos.has(k) ? E.abertos.delete(k) : E.abertos.add(k); desenhar(); }
  });
  $('vista').addEventListener('change', e => { if (e.target.id === 'mStatus'){ E.status = e.target.value; desenhar(); } });
  $('vista').addEventListener('input', e => {
    if (e.target.id !== 'mBusca') return;
    E.busca = e.target.value; desenhar();
    const i = $('mBusca'); i.focus(); i.setSelectionRange(i.value.length, i.value.length);
  });
  $('dlgForm').addEventListener('submit', salvarEdicao);
  $('dlgFechar').addEventListener('click', () => $('dlg').close());
  $('dlgRestaurar').addEventListener('click', () => { delete E.ajustes[editando]; gravarLocal('em-ajustes', E.ajustes); aplicarAjustes(); $('dlg').close(); desenhar(); });

  /* ---------- início ---------- */
  (async function(){
    const [p, est, cus, hist] = await Promise.all([buscar('painel'), buscar('estrutura'), buscar('custos'), buscar('historico')]);
    E.estrutura = est || null; E.custos = cus || null; E.historico = hist || [];
    // painel salvo por uma versão antiga (sem "semPar") não serve: pede as bases de novo
    if (p && p.conjuntos && p.conjuntos.every(c => c.semPar)){ E.painel = p; aplicarAjustes(); desenhar(); }
    else abrirImportar();
  })();
})();
