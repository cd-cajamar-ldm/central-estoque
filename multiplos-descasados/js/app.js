/* ============================================================
   MÚLTIPLOS DESCASADOS — app
   ============================================================
   Controle do item descasado no estoque: o componente que sobrou sem o par e
   por isso não pode virar pedido. A tela responde quatro coisas, nessa ordem —
   qual a dimensão do problema (peças e R$), onde ele está (pai, componente,
   endereço), o que bloquear em 86 e o que já pode voltar de 86 para venda.

   O eixo é a RESTRIÇÃO: só WN (0) vende, então só WN casa. O 86 (AI) é onde
   fica o descasado, e não é destino final — quando a peça que faltava aparece,
   o conjunto casa de novo e o 86 volta pra WN.

   Banco próprio (multiplos_descasados_v1). O módulo não lê nem escreve no banco
   do Inventário: as bases são as mesmas (QRY0390, ZBIQ0051, SIGEQ278), mas o
   recorte guardado aqui é só o dos componentes de múltiplo.
   ============================================================ */
const MD_APP_VERSION = 'v2';
const MD = {
  estrutura:null, saldos:null, precos:null,
  estruturaMeta:null, saldoMeta:null, precoMeta:null,
  base:'qtde',          // 'qtde' = tudo que existe | 'qtdeDisp' = só o disponível
  equalizado:'nao',     // 'sim' (já casado) | 'nao' (precisa de ajuste)
  busca:'',
  pivotExpandido:new Set(),
  tela:'descasados',
  regras:{clal:{}, x1:{}},        // dimensão -> valor -> [siglas de restrição permitidas]
  selecionadas:{clal:null, x1:null}, // dimensão -> null (todas) | Set() (só as marcadas)
  restricoesSel:null,             // null = todas as colunas | Set() = só estas siglas
  restricoesAberto:false,         // lista de restrições aberta ou recolhida
  // Ordenação de cada matriz: por total (padrão), pela descrição da dimensão,
  // ou por uma coluna de restrição. asc/desc alterna no mesmo cabeçalho.
  ordemMatriz:{clal:{col:'total', dir:'desc'}, x1:{col:'total', dir:'desc'}},
  f051:null, f390:null, f278:null,
  proc:{'051':false,'390':false,'278':false},
  progresso:{'051':{stage:'',pct:0},'390':{stage:'',pct:0},'278':{stage:'',pct:0}},
  initErro:null,
  _cache:null, _cacheBase:null, _plano:null, _planoBase:null
};

const MD_ZOOM_MIN = 70, MD_ZOOM_MAX = 150, MD_ZOOM_STEP = 10;

/* As duas dimensões de local usadas nas matrizes de Ajustes e Configurações —
   mesma lógica pras duas, só troca o valor do endereço que a QRY0390 traz.
   X1 (setor) e X2 (rua) andam juntos num endereço físico — "PP 001" é um
   setor só, não dois — por isso viram uma dimensão combinada só, em vez de
   duas matrizes separadas. Chave de config própria por dimensão pra não
   perder a regra de classe (CLAL) já salva quando X1/X2 foram adicionados
   depois. */
const MD_DIMENSOES = [
  {chave:'clal', titulo:'Classe', valor:o=>o.clal || '—'},
  {chave:'x1', titulo:'X1/X2', valor:o=>[o.x1, o.x2].filter(Boolean).join(' ') || '—'}
];
const MD_DIM_POR_CHAVE = {};
MD_DIMENSOES.forEach(d=>{ MD_DIM_POR_CHAVE[d.chave] = d; });
const MD_CONFIG_KEY_POR_DIM = {clal:'regras-classe', x1:'regras-x1'};

function irEsc(v){ if(v===undefined||v===null) return ''; return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function irFmtInt(n){ return Math.round(n||0).toLocaleString('pt-BR'); }
function irFmtMoney(n){ return (n||0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'}); }
function irFmtDate(s){
  if(!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}
function irFmtDataHora(s){
  const d = new Date(s);
  if(isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
}
function irShowToast(msg, isError){
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.className = 'toast'+(isError?' error':'');
  clearTimeout(window.__mdToastTimer);
  window.__mdToastTimer = setTimeout(()=>{ t.className='toast hidden'; }, 2600);
}
function irEmptyState(title, desc, onclickFn, btnLabel){
  return `<div class="empty-state panel"><div class="eicon">🧩</div><h3>${irEsc(title)}</h3><p>${irEsc(desc)}</p>
    ${onclickFn ? `<button class="btn btn-primary" onclick="${onclickFn}">${irEsc(btnLabel)}</button>` : ''}</div>`;
}

/* ---------- Chrome (zoom, tema, menu) ---------- */
function irApplyZoom(pct){
  const v = Math.min(MD_ZOOM_MAX, Math.max(MD_ZOOM_MIN, pct||100));
  document.documentElement.style.setProperty('--zoom', v/100);
  document.documentElement.style.fontSize = (16*v/100)+'px';
  localStorage.setItem('ir-zoom', String(v));
  const el = document.getElementById('zoomLabel');
  if(el) el.textContent = v+'%';
}
function irZoomIn(){ irApplyZoom((parseInt(localStorage.getItem('ir-zoom'),10)||100) + MD_ZOOM_STEP); }
function irZoomOut(){ irApplyZoom((parseInt(localStorage.getItem('ir-zoom'),10)||100) - MD_ZOOM_STEP); }
function irToggleTheme(){
  const atual = document.documentElement.getAttribute('data-theme')==='light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', atual);
  localStorage.setItem('ir-theme', atual);
  irUpdateThemeLabel();
}
function irUpdateThemeLabel(){
  const el = document.getElementById('themeToggleLabel');
  if(el) el.textContent = document.documentElement.getAttribute('data-theme')==='light' ? 'Modo escuro' : 'Modo claro';
}
/* No celular o menu é um overlay (classe mobile-open, largura 0 -> 230px); no
   computador ele encolhe pra faixa de ícones (collapsed). São classes
   diferentes no theme.css — usar a errada deixa o botão do menu sem efeito
   nenhum no celular. */
const MD_MOBILE_QUERY = '(max-width:640px)';
function irToggleSidebar(){
  const sb = document.getElementById('sidebar');
  if(!sb) return;
  if(window.matchMedia(MD_MOBILE_QUERY).matches) sb.classList.toggle('mobile-open');
  else sb.classList.toggle('collapsed');
}
function irCloseSidebarMobile(){
  const sb = document.getElementById('sidebar');
  if(sb && window.matchMedia(MD_MOBILE_QUERY).matches) sb.classList.remove('mobile-open');
}

/* ============================================================
   CÁLCULO
   ============================================================ */
function mdPais(){
  if(MD._cache && MD._cacheBase === MD.base) return MD._cache;
  if(!MD.estrutura || !MD.saldos) return [];
  const saldos = new Map(MD.saldos.map(s=>[s.item, s]));
  const precos = new Map((MD.precos||[]).map(p=>[p.item, p.preco]));
  MD._cache = mdCalcularPais(MD.estrutura, saldos, precos, MD.base);
  MD._cacheBase = MD.base;
  return MD._cache;
}
function mdInvalidarCache(){ MD._cache = null; MD._cacheBase = null; MD._plano = null; MD._planoBase = null; }

function mdPaisFiltrados(){
  const termo = MD.busca.trim().toLowerCase();
  let lista = mdPais();
  if(MD.equalizado === 'sim') lista = lista.filter(p=>!p.descasado);
  else if(MD.equalizado === 'nao') lista = lista.filter(p=>p.descasado);
  if(termo){
    lista = lista.filter(p=>
      p.pai.includes(termo) ||
      (p.nome||'').toLowerCase().includes(termo) ||
      p.componentes.some(c=>c.componente.includes(termo) || (c.nome||'').toLowerCase().includes(termo))
    );
  }
  const acoes = p=>p.bloquearPecas + p.liberarPecas;
  return lista.slice().sort((a,b)=>b.sobraValor - a.sobraValor || acoes(b) - acoes(a));
}

/* ============================================================
   TELA — DESCASADOS
   ============================================================ */
function mdTemDados(){ return !!(MD.estrutura && MD.estrutura.length && MD.saldos && MD.saldos.length); }

function mdSetBase(base){ MD.base = base; mdInvalidarCache(); irRenderView(); }
function mdSetEqualizado(v){ MD.equalizado = v; irRenderView(); }
function mdBuscar(v){
  MD.busca = v;
  clearTimeout(window.__mdBuscaTimer);
  window.__mdBuscaTimer = setTimeout(()=>{ irRenderView(); document.getElementById('mdBusca')?.focus(); }, 220);
}
function mdKpis(resumo){
  return `<div class="kpi-grid">
    <div class="kpi-card bad"><div class="num">${irFmtInt(resumo.paisDescasados)}</div><div class="label">Múltiplos a ajustar</div></div>
    <div class="kpi-card bad"><div class="num">${irFmtInt(resumo.bloquearPecas)}</div><div class="label">Peças a bloquear (0 → 86)</div></div>
    <div class="kpi-card good"><div class="num">${irFmtInt(resumo.liberarPecas)}</div><div class="label">Peças a liberar (86 → 0)</div></div>
    <div class="kpi-card bad"><div class="num num-money">${irFmtMoney(resumo.sobraValor)}</div><div class="label">Valor descasado</div></div>
    <div class="kpi-card good"><div class="num num-money">${irFmtMoney(resumo.liberarValor)}</div><div class="label">Valor a liberar</div></div>
  </div>`;
}

function mdBarraFiltros(){
  const chip = (ativo, onclick, texto)=>`<button class="chip ${ativo?'active':''}" onclick="${onclick}">${irEsc(texto)}</button>`;
  return `<div class="panel">
    <div class="md-filtros">
      <input id="mdBusca" class="md-busca" type="search" placeholder="Buscar item pai, componente ou descrição..."
             value="${irEsc(MD.busca)}" oninput="mdBuscar(this.value)">
      <div class="md-chips">
        ${chip(MD.equalizado==='sim', "mdSetEqualizado('sim')", 'Equalizado: Sim')}
        ${chip(MD.equalizado==='nao', "mdSetEqualizado('nao')", 'Equalizado: Não')}
      </div>
    </div>
  </div>`;
}

/* Colunas de restrição da tela: as que realmente aparecem no estoque destes
   componentes, na ordem da legenda. Restrição sem nenhuma peça não vira coluna
   vazia — a tabela já é larga. */
function mdRestricoesPresentes(){
  const pais = mdPais();
  const vistas = new Set();
  for(const p of pais) for(const c of p.componentes) for(const s in c.porRestricao) vistas.add(s);
  const ordenadas = MD_ORDEM_RESTRICOES.filter(s=>vistas.has(s));
  for(const s of vistas) if(!ordenadas.includes(s)) ordenadas.push(s);
  return ordenadas;
}

/* Colunas que a matriz mostra de fato: as presentes no estoque, menos as que
   o filtro de restrições desmarcou. A seleção é só de VISÃO — não muda saldo,
   plano nem exportação; serve pra tirar da frente as restrições que não
   interessam naquele momento, porque com 10 colunas a tabela rola na
   horizontal e o que importa sai da tela. */
function mdRestricoesVisiveis(){
  const presentes = mdRestricoesPresentes();
  if(MD.restricoesSel === null) return presentes;
  const visiveis = presentes.filter(s=>MD.restricoesSel.has(s));
  // Desmarcar tudo deixaria a matriz sem nenhuma coluna de número: sem isso a
  // tela vira só a lista de valores, e parece quebrada em vez de filtrada.
  return visiveis.length ? visiveis : presentes;
}
function mdToggleRestricaoCol(sigla){
  if(MD.restricoesSel === null) MD.restricoesSel = new Set(mdRestricoesPresentes());
  if(MD.restricoesSel.has(sigla)) MD.restricoesSel.delete(sigla); else MD.restricoesSel.add(sigla);
  irRenderView();
}
function mdTodasRestricoes(){ MD.restricoesSel = null; irRenderView(); }
function mdSoRestricoesDoModulo(){ MD.restricoesSel = new Set([MD_SIGLA_VENDAVEL, MD_SIGLA_BLOQUEIO]); irRenderView(); }
function mdToggleListaRestricoes(){ MD.restricoesAberto = !MD.restricoesAberto; irRenderView(); }

/* Lista de restrições em forma de filtro: uma linha por restrição, com o
   código, a sigla e o nome da legenda — o mesmo vocabulário do coletor, pra
   quem lembra do número e não da sigla (e vice-versa). */
function mdRenderFiltroRestricoes(){
  const presentes = mdRestricoesPresentes();
  if(!presentes.length) return '';
  const sel = MD.restricoesSel;
  const marcadas = sel === null ? presentes.length : presentes.filter(s=>sel.has(s)).length;
  const itens = presentes.map(s=>{
    const marcado = sel === null || sel.has(s);
    return `<label class="md-restr-item ${marcado?'':'off'}">
      <input type="checkbox" ${marcado?'checked':''} onchange="mdToggleRestricaoCol('${s}')">
      <span class="md-restr-cod">${irEsc(mdCodRestricao(s))}</span>
      <span class="md-restr-sigla mono">${irEsc(s)}</span>
      <span class="md-restr-nome">${irEsc(mdNomeRestricao(s))}</span>
    </label>`;
  }).join('');
  return `<div class="md-restr-filtro ${MD.restricoesAberto?'aberto':''}">
    <button class="chip md-restr-botao" onclick="mdToggleListaRestricoes()">
      Restrições: ${marcadas === presentes.length ? 'todas' : irFmtInt(marcadas)+' de '+irFmtInt(presentes.length)}
      <span class="md-seta">${MD.restricoesAberto ? '▴' : '▾'}</span>
    </button>
    ${MD.restricoesAberto ? `<div class="md-restr-lista">
      <div class="md-restr-acoes">
        <button class="btn-link" onclick="mdTodasRestricoes()">Todas</button>
        <button class="btn-link" onclick="mdSoRestricoesDoModulo()">Só 0 e 86</button>
      </div>
      ${itens}
    </div>` : ''}
  </div>`;
}

/* Ordenação da matriz. Clicar no mesmo cabeçalho inverte; clicar em outro
   começa pelo mais útil daquela coluna — a descrição em ordem alfabética
   (A→Z), os números do maior pro menor, que é como se procura o volume. */
function mdOrdenarMatriz(chave, col){
  const atual = MD.ordemMatriz[chave] || {col:'total', dir:'desc'};
  const dir = atual.col === col ? (atual.dir === 'asc' ? 'desc' : 'asc') : (col === 'valor' ? 'asc' : 'desc');
  MD.ordemMatriz[chave] = {col, dir};
  irRenderView();
}
function mdSetaOrdem(chave, col){
  const atual = MD.ordemMatriz[chave] || {col:'total', dir:'desc'};
  if(atual.col !== col) return '<span class="md-seta md-seta-off">↕</span>';
  return `<span class="md-seta">${atual.dir === 'asc' ? '↑' : '↓'}</span>`;
}

/* Nome comprido não cabe numa linha compacta: mostra o início e o fim, que é
   o trecho que costuma diferenciar um item do outro (cor, medida, modelo). */
function mdTruncarNome(nome, max){
  if(!nome || nome.length <= max) return nome || '';
  const inicio = nome.slice(0, Math.ceil(max*0.65));
  const fim = nome.slice(-Math.floor(max*0.28));
  return inicio.trim() + '…' + fim.trim();
}

/* Soma por restrição no nível do pai: cada componente já traz o próprio total
   (porRestricao, no corte de base escolhido); aqui só agrega os componentes. */
function mdPaiTotaisPorSigla(p, restricoes){
  const out = {};
  for(const s of restricoes) out[s] = p.componentes.reduce((a,c)=>a+(c.porRestricao[s]||0),0);
  return out;
}

function mdPivColunas(totais, restricoes, total){
  return restricoes.map(s=>{
    const v = totais[s] || 0;
    const cls = s===MD_SIGLA_VENDAVEL ? 'md-col-wn' : (s===MD_SIGLA_BLOQUEIO ? 'md-col-86' : '');
    return `<td class="${cls}">${v ? irFmtInt(v) : ''}</td>`;
  }).join('') + `<td class="md-piv-total">${irFmtInt(total)}</td>`;
}

function mdPivToggle(id){
  if(MD.pivotExpandido.has(id)) MD.pivotExpandido.delete(id); else MD.pivotExpandido.add(id);
  irRenderView();
}
function mdPivExpandirTudo(){
  for(const p of mdPaisFiltrados()){
    MD.pivotExpandido.add('p-'+p.pai);
    for(const c of p.componentes) MD.pivotExpandido.add('p-'+p.pai+'-c-'+c.componente);
  }
  irRenderView();
}
function mdPivRecolherTudo(){ MD.pivotExpandido.clear(); irRenderView(); }

/* Pivô item pai → componente → endereço, no estilo tabela dinâmica: uma
   coluna por restrição — o CÓDIGO do WMS, não a sigla, porque é o que se
   digita no coletor. WN e AI destacados. Recolhido por padrão: um múltiplo
   grande pode ter dezenas de endereços por componente, e abrir tudo de cara
   afoga a tela. */
function mdRenderPivot(){
  const lista = mdPaisFiltrados();
  if(!lista.length){
    return `<div class="panel"><p class="field-hint">Nenhum múltiplo bate com o filtro atual.</p></div>`;
  }
  const restricoes = mdRestricoesPresentes();
  const campo = MD.base==='qtdeDisp' ? 'qtdeDisp' : 'qtde';

  let linhas = '';
  for(const p of lista){
    const idPai = 'p-'+p.pai;
    const paiAberto = MD.pivotExpandido.has(idPai);
    const alerta = p.faltantes > 0
      ? `<span class="md-tag md-tag-bad">${p.faltantes} sem peça</span>`
      : (p.completos === 0 ? `<span class="md-tag md-tag-bad">0 vendáveis</span>` : '');
    linhas += `<tr class="md-piv-pai">
      <td class="md-left"><button class="md-piv-toggle" onclick="mdPivToggle('${idPai}')">${paiAberto?'−':'+'}</button><span class="mono">${irEsc(p.pai)}</span> ${irEsc(mdTruncarNome(p.nome,46))} ${alerta}</td>
      ${mdPivColunas(mdPaiTotaisPorSigla(p, restricoes), restricoes, p.pecasTotal)}
    </tr>`;
    if(!paiAberto) continue;
    for(const c of p.componentes){
      const idComp = idPai+'-c-'+c.componente;
      const compAberto = MD.pivotExpandido.has(idComp);
      const tagValor = c.inInterface==='S' ? ' <span class="md-tag md-tag-info" title="Carrega o valor do múltiplo (in_interface = S)">valor</span>' : '';
      linhas += `<tr class="md-piv-comp">
        <td class="md-left"><button class="md-piv-toggle" onclick="mdPivToggle('${idComp}')">${compAberto?'−':'+'}</button><span class="mono">${irEsc(c.componente)}</span> ${irEsc(mdTruncarNome(c.nome,46))}${tagValor}</td>
        ${mdPivColunas(c.porRestricao, restricoes, c.total)}
      </tr>`;
      if(!compAberto) continue;
      for(const loc of (c.locais||[])){
        const v = loc[campo] || 0;
        if(!v) continue;
        linhas += `<tr class="md-piv-leaf">
          <td class="md-left">${irEsc(loc.desc || loc.local)}</td>
          ${mdPivColunas({[loc.restricao]: v}, restricoes, v)}
        </tr>`;
      }
    }
  }

  const headerCols = restricoes.map(s=>{
    const cls = s===MD_SIGLA_VENDAVEL ? 'md-col-wn' : (s===MD_SIGLA_BLOQUEIO ? 'md-col-86' : '');
    return `<th class="${cls} md-th-ord" onclick="mdOrdenarMatriz('${chave}','${s}')"
      title="${irEsc(mdCodRestricao(s)+' — '+mdNomeRestricao(s)+' · clique para ordenar')}">${irEsc(mdCodRestricao(s))}${mdSetaOrdem(chave, s)}</th>`;
  }).join('');

  return `<div class="panel">
    <div class="md-head">
      <h3>Múltiplos por item pai</h3>
      <div class="md-piv-acoes">
        <button class="btn-link" onclick="mdPivExpandirTudo()">Expandir tudo</button>
        <button class="btn-link" onclick="mdPivRecolherTudo()">Recolher tudo</button>
        <button class="btn btn-primary" onclick="mdExportarAjustePivot()">Baixar planilha de ajuste</button>
      </div>
    </div>
    <p class="field-hint">${irFmtInt(lista.length)} ${lista.length===1?'múltiplo':'múltiplos'} · item pai → componente → endereço, clique em + para expandir</p>
    <div class="md-piv-wrap">
      <table class="md-piv">
        <thead><tr>
          <th class="md-left">Item pai / Componente / Endereço</th>
          ${headerCols}
          <th class="md-piv-total">Total Geral</th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
  </div>`;
}

function mdRenderDescasados(){
  if(!mdTemDados()){
    const falta = !(MD.estrutura && MD.estrutura.length)
      ? 'Comece pela ZBIQ0051: é ela que diz quais itens são componentes de múltiplo. Depois importe a QRY0390 com o saldo.'
      : 'A estrutura já está aqui. Falta a QRY0390 com o saldo dos componentes.';
    return irEmptyState('Sem bases importadas', falta, "irSwitchTab('importacao')", 'Ir para a importação');
  }
  return mdKpis(mdResumo(mdPais())) + mdBarraFiltros() + mdRenderPivot();
}

/* ============================================================
   TELA — AJUSTES DE RESTRIÇÃO
   ============================================================
   A execução no coletor (12.MOVI: Altera Rest) é uma linha por vez: local,
   restrição de origem, restrição de destino, quantidade. Esta tela é essa
   digitação já resolvida — inclusive de qual endereço sai cada peça, porque o
   sistema só aceita a baixa se o saldo estiver mesmo naquele endereço e
   naquela restrição.

   Os dois sentidos convivem na mesma lista: bloquear (0 -> 86) primeiro, que é
   o que impede venda de item incompleto, e liberar (86 -> 0) depois, que é
   estoque bom voltando pra venda. */
function mdPlano(){
  if(MD._plano && MD._planoBase === MD.base) return MD._plano;
  MD._plano = mdPlanoAjuste(mdPais(), MD.base);
  MD._planoBase = MD.base;
  return MD._plano;
}
/* Matriz por dimensão de local (classe/X1/X2) × restrição, no mesmo espírito
   da matriz que o usuário usa no PuTTY (linhas = valor da dimensão, colunas =
   restrição, valor = quantidade) — só que aqui é o recorte deste módulo: só
   os componentes de múltiplo, não o estoque vendável inteiro. A tabela linha
   a linha (endereço por endereço, pronta pra colar no coletor) fica só na
   planilha exportada — aqui é só a visão gerencial. As duas dimensões
   compartilham a mesma lógica, só troca o valor do endereço. */
function mdMatrizPor(chave){
  const dim = MD_DIM_POR_CHAVE[chave];
  const campo = MD.base==='qtdeDisp' ? 'qtdeDisp' : 'qtde';
  const porValor = new Map();
  for(const s of (MD.saldos||[])){
    for(const loc of (s.locais||[])){
      const v = loc[campo] || 0;
      if(!v) continue;
      const valor = dim.valor(loc);
      if(!porValor.has(valor)) porValor.set(valor, {});
      const bucket = porValor.get(valor);
      bucket[loc.restricao] = (bucket[loc.restricao] || 0) + v;
    }
  }
  return porValor;
}

function mdRegraDe(chave, valor){
  const regra = MD.regras[chave] && MD.regras[chave][valor];
  return (regra && regra.length) ? regra : null;
}
/* Restrição fora da regra configurada em Configurações. Sem regra salva pra
   esse valor, não dá pra dizer se está certo ou errado — não valida. */
function mdRestricaoPermitidaEm(chave, valor, sigla){
  const regra = mdRegraDe(chave, valor);
  return !regra || regra.includes(sigla);
}

/* Plano de correção de restrição (aba Ajustes de Restrição) — não confundir
   com o plano de pareamento de múltiplos descasados (aba Descasados, outra
   lógica, outro botão). Aqui o problema é a REGRA configurada em
   Configurações: peça numa restrição que não está marcada como permitida
   pra aquela classe/X1+X2 volta pra uma que está. WN é o destino sempre que
   WN estiver entre as permitidas (é o normal — 86 fica de fora da correção
   de propósito, porque quem decide o que vai pra 86 é o pareamento da aba
   Descasados, não esta tela); com WN fora e mais de uma restrição permitida
   ao mesmo tempo não dá pra escolher sem chute — a linha fica de fora até o
   cadastro em Configurações ter só uma opção certa. Sem regra pro valor,
   nada é corrigido (mesmo critério da validação da matriz). */
function mdPlanoCorrecaoRestricao(){
  const campo = MD.base==='qtdeDisp' ? 'qtdeDisp' : 'qtde';
  const out = [];
  for(const s of (MD.saldos||[])){
    for(const loc of (s.locais||[])){
      let regra = null;
      for(const dim of MD_DIMENSOES){
        const r = mdRegraDe(dim.chave, dim.valor(loc));
        if(r && !r.includes(loc.restricao)){ regra = r; break; }
      }
      if(!regra) continue;
      const destino = regra.includes(MD_SIGLA_VENDAVEL) ? MD_SIGLA_VENDAVEL
        : (regra.length===1 ? regra[0] : null);
      if(!destino) continue;
      const refs = (loc.refs && loc.refs.length) ? loc.refs : [{qtde: loc.qtde, qtdeDisp: loc.qtdeDisp}];
      const preco = s.valorUnitario || 0;
      for(const ref of refs){
        const quantidade = ref[campo] || 0;
        if(!quantidade) continue;
        out.push({
          de: loc.restricao, para: destino,
          codDe: mdCodRestricao(loc.restricao), codPara: mdCodRestricao(destino),
          localColetor: mdLocalColetor(loc.local),
          local: loc.local, endereco: loc.desc, predio: loc.predio,
          clal: loc.clal, x1: loc.x1, x2: loc.x2,
          componente: s.item, ean: s.ean, quantidade,
          preco, valor: quantidade * preco
        });
      }
    }
  }
  return out;
}

/* KPIs da aba Ajustes de Restrição, mesma lógica dos cartões de Descasados
   (contagem + peças + valor), mas olhando só pro estoque vendável (WN)
   bloqueado por engano numa restrição fora da regra. 86 fica de fora da
   conta de propósito: é normal um componente estar lá num momento e não
   estar no outro — quem decide isso é o pareamento da aba Descasados, não
   é erro de configuração desta tela. */
function mdResumoCorrecao(){
  const plano = mdPlanoCorrecaoRestricao().filter(l=>l.de !== MD_SIGLA_BLOQUEIO);
  return {
    itens: new Set(plano.map(l=>l.componente)).size,
    pecas: plano.reduce((a,l)=>a+l.quantidade, 0),
    valor: plano.reduce((a,l)=>a+l.valor, 0)
  };
}
/* Sem nenhuma regra salva em Configurações, os três cartões ficam em zero
   por construção: a correção compara o que existe contra o que é PERMITIDO
   naquela classe/X1, e sem régua não há o que comparar. Três zeros sem
   explicação passam a mensagem oposta — "está tudo certo" — então a tela diz
   o motivo e aponta pra onde resolver. */
function mdAvisoSemRegra(){
  const comRegra = MD_DIMENSOES.reduce((a,dim)=>a + Object.keys(MD.regras[dim.chave] || {}).filter(v=>(MD.regras[dim.chave][v]||[]).length).length, 0);
  if(comRegra) return '';
  return `<div class="panel md-aviso">
    Os cartões acima estão zerados porque <strong>nenhuma regra foi configurada ainda</strong>.
    Esta tela compara o que existe no estoque contra as restrições permitidas em cada classe e X1/X2 —
    sem essa régua, nada pode ser apontado como errado.
    <button class="btn-link" onclick="irSwitchTab('configuracoes')">Configurar agora</button>
  </div>`;
}
function mdKpisCorrecao(resumo){
  return `<div class="kpi-grid" style="margin-bottom:18px;">
    <div class="kpi-card bad"><div class="num">${irFmtInt(resumo.itens)}</div><div class="label">Itens com restrição a corrigir</div></div>
    <div class="kpi-card good"><div class="num">${irFmtInt(resumo.pecas)}</div><div class="label">Peças vendáveis bloqueadas a liberar</div></div>
    <div class="kpi-card good"><div class="num num-money">${irFmtMoney(resumo.valor)}</div><div class="label">Valor bloqueado a liberar</div></div>
  </div>`;
}

function mdValorMarcado(chave, valor){
  const sel = MD.selecionadas[chave];
  return sel === null || sel.has(valor);
}
function mdToggleValor(chave, valor){
  if(MD.selecionadas[chave] === null) MD.selecionadas[chave] = new Set(mdMatrizPor(chave).keys());
  const sel = MD.selecionadas[chave];
  if(sel.has(valor)) sel.delete(valor); else sel.add(valor);
  irRenderView();
}
function mdMarcarTodosValores(chave){ MD.selecionadas[chave] = null; irRenderView(); }
function mdDesmarcarTodosValores(chave){ MD.selecionadas[chave] = new Set(); irRenderView(); }
/* Checkbox único no cabeçalho da tabela: marca/desmarca tudo de uma vez, sem
   precisar desmarcar linha por linha pra sobrar só o que interessa. */
function mdToggleCabecalhoSelecao(chave, marcarTudo){
  if(marcarTudo) mdMarcarTodosValores(chave); else mdDesmarcarTodosValores(chave);
}

function mdRenderMatrizPor(chave){
  const dim = MD_DIM_POR_CHAVE[chave];
  const porValor = mdMatrizPor(chave);
  const restricoes = mdRestricoesVisiveis();
  const totalDe = v => Object.values(porValor.get(v)).reduce((a,x)=>a+x, 0);
  const termo = MD.busca.trim().toLowerCase();
  let valores = Array.from(porValor.keys());
  if(termo) valores = valores.filter(v=>v.toLowerCase().includes(termo));

  // Ordenação escolhida no cabeçalho. O desempate é sempre a descrição, pra
  // que duas linhas com o mesmo número não troquem de lugar a cada render.
  // Ordenar por uma coluna que o filtro escondeu deixaria a tabela numa ordem
  // que a tela não explica — nesse caso volta pro total.
  let ordem = MD.ordemMatriz[chave] || {col:'total', dir:'desc'};
  if(ordem.col !== 'total' && ordem.col !== 'valor' && !restricoes.includes(ordem.col)){
    ordem = {col:'total', dir:'desc'};
    MD.ordemMatriz[chave] = ordem;
  }
  const sinal = ordem.dir === 'asc' ? 1 : -1;
  const valorDe = v => ordem.col === 'total' ? totalDe(v) : ((porValor.get(v) || {})[ordem.col] || 0);
  valores.sort((a,b)=>{
    if(ordem.col === 'valor') return sinal * a.localeCompare(b, 'pt-BR');
    return sinal * (valorDe(a) - valorDe(b)) || a.localeCompare(b, 'pt-BR');
  });

  if(!valores.length){
    return { html: `<p class="field-hint">Nenhum valor de ${dim.titulo.toLowerCase()} bate com o filtro atual.</p>`, comErro: 0 };
  }

  const headerCols = restricoes.map(s=>{
    const cls = s===MD_SIGLA_VENDAVEL ? 'md-col-wn' : (s===MD_SIGLA_BLOQUEIO ? 'md-col-86' : '');
    return `<th class="${cls} md-th-ord" onclick="mdOrdenarMatriz('${chave}','${s}')"
      title="${irEsc(mdCodRestricao(s)+' — '+mdNomeRestricao(s)+' · clique para ordenar')}">${irEsc(mdCodRestricao(s))}${mdSetaOrdem(chave, s)}</th>`;
  }).join('');

  // Com o filtro de restrições ligado, a soma das colunas na tela não fecha
  // com o Total Geral (que continua sendo o de todas) — o cabeçalho avisa.
  const filtrando = restricoes.length < mdRestricoesPresentes().length;
  const totalPorRestricao = {};
  for(const s of restricoes) totalPorRestricao[s] = 0;
  let totalGeral = 0, comErro = 0;
  const todosMarcados = valores.every(v=>mdValorMarcado(chave, v));

  const linhas = valores.map(v=>{
    const bucket = porValor.get(v);
    let temErro = false;
    const cels = restricoes.map(s=>{
      const qtd = bucket[s] || 0;
      totalPorRestricao[s] += qtd;
      const erro = qtd > 0 && !mdRestricaoPermitidaEm(chave, v, s);
      if(erro) temErro = true;
      const cls = erro ? 'md-cel-erro' : (s===MD_SIGLA_VENDAVEL ? 'md-col-wn' : (s===MD_SIGLA_BLOQUEIO ? 'md-col-86' : ''));
      const titulo = erro ? ` title="${irEsc('Restrição '+mdCodRestricao(s)+' ('+s+') não está nas restrições permitidas de '+v+' — configure em Configurações')}"` : '';
      return `<td class="${cls}"${titulo}>${qtd ? irFmtInt(qtd) : ''}</td>`;
    }).join('');
    if(temErro) comErro++;
    const total = totalDe(v);
    totalGeral += total;
    const marcado = mdValorMarcado(chave, v);
    return `<tr>
      <td class="md-piv-check"><input type="checkbox" ${marcado?'checked':''} onchange="mdToggleValor('${chave}','${irEsc(v)}')"></td>
      <td class="md-left mono">${irEsc(v)}</td>${cels}<td class="md-piv-total">${irFmtInt(total)}</td>
    </tr>`;
  }).join('');

  const rodape = `<tr class="md-piv-pai">
    <td></td>
    <td class="md-left">Total Geral</td>
    ${restricoes.map(s=>{
      const cls = s===MD_SIGLA_VENDAVEL ? 'md-col-wn' : (s===MD_SIGLA_BLOQUEIO ? 'md-col-86' : '');
      return `<td class="${cls}">${irFmtInt(totalPorRestricao[s])}</td>`;
    }).join('')}
    <td class="md-piv-total">${irFmtInt(totalGeral)}</td>
  </tr>`;

  const html = `<div class="md-piv-wrap">
    <table class="md-piv">
      <thead><tr>
        <th class="md-piv-check"><input type="checkbox" ${todosMarcados?'checked':''} onchange="mdToggleCabecalhoSelecao('${chave}', this.checked)" title="Marcar/desmarcar todas as linhas"></th>
        <th class="md-left md-th-ord" onclick="mdOrdenarMatriz('${chave}','valor')"
            title="Ordenar pela descrição de ${irEsc(dim.titulo)}">${irEsc(dim.titulo)}${mdSetaOrdem(chave, 'valor')}</th>
        ${headerCols}
        <th class="md-piv-total md-th-ord" onclick="mdOrdenarMatriz('${chave}','total')"
            title="${irEsc(filtrando ? 'Soma de TODAS as restrições, inclusive as escondidas pelo filtro — clique para ordenar' : 'Ordenar pelo total')}">${filtrando ? 'Total (todas)' : 'Total Geral'}${mdSetaOrdem(chave, 'total')}</th>
      </tr></thead>
      <tbody>${linhas}${rodape}</tbody>
    </table>
  </div>`;
  return { html, comErro };
}

function mdRenderAjustes(){
  if(!mdTemDados()){
    return irEmptyState('Sem bases importadas', 'Importe a ZBIQ0051 e a QRY0390 para montar o plano de ajuste.', "irSwitchTab('importacao')", 'Ir para a importação');
  }
  const chip = (ativo, onclick, texto)=>`<button class="chip ${ativo?'active':''}" onclick="${onclick}">${irEsc(texto)}</button>`;

  const blocosMatriz = MD_DIMENSOES.map(dim=>{
    const m = mdRenderMatrizPor(dim.chave);
    return `<div class="md-head" style="margin-top:18px;"><h3>Restrição por ${irEsc(dim.titulo)}</h3></div>${m.html}`;
  }).join('');

  return `<div class="panel">
    <div class="md-head">
      <h3>Ajustes de Restrição</h3>
      <button class="btn btn-primary" onclick="mdExportarAjusteClasses()">Baixar relatório de ajuste</button>
    </div>
    ${mdKpisCorrecao(mdResumoCorrecao())}
    ${mdAvisoSemRegra()}
    <div class="md-filtros">
      <input id="mdBusca" class="md-busca" type="search" placeholder="Buscar classe, X1 ou X2..."
             value="${irEsc(MD.busca)}" oninput="mdBuscar(this.value)">
      ${mdRenderFiltroRestricoes()}
      <div class="md-chips">
        ${chip(MD.base==='qtde', "mdSetBase('qtde')", 'Estoque total')}
        ${chip(MD.base==='qtdeDisp', "mdSetBase('qtdeDisp')", 'Só disponível')}
      </div>
    </div>
    ${blocosMatriz}
  </div>`;
}

/* Descasados: respeita a busca, o base (total/disponível) e o filtro
   Equalizado da tela — exporta só o que está sendo mostrado ali. */
function mdExportarAjustePivot(){
  mdGerarCsvAjuste(mdPlanoAjuste(mdPaisFiltrados(), MD.base));
}
/* Ajustes de Restrição: corrige as células fora da regra (não é o plano de
   pareamento da aba Descasados — ver mdPlanoCorrecaoRestricao), respeitando
   classe e X1/X2 marcados nas duas matrizes. */
function mdExportarAjusteClasses(){
  mdGerarCsvAjuste(mdPlanoCorrecaoRestricao().filter(l=>
    MD_DIMENSOES.every(dim=>mdValorMarcado(dim.chave, dim.valor(l)))
  ));
}

/* Só o que vai pro coletor: local, item, restrição de/para, quantidade,
   endereço (pra achar a peça) e o alerta de estoque duplo. O resto (pai,
   descrição, saldo, preço...) é conferência que já está na tela — não
   precisa duplicar na planilha. */
function mdGerarCsvAjuste(lista){
  if(!lista.length){ irShowToast('Não há ajuste para exportar.'); return; }
  const cab = ['Local (coletor)','EAN','Orig','Dest','Qtde','Endereço'];
  const cel = v=>{
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  };
  // Local (coletor) e EAN são só dígitos compridos (10 e 13 casas) — sem
  // forçar texto o Excel "adivinha" que é número e mostra em notação
  // científica (5E+09, 7,89862E+12), cortando dígitos de verdade. A aspa
  // simples na frente força texto e some da visualização — mesmo truque de
  // qualquer exportador de CSV com código/EAN comprido.
  const celTexto = v=>{ const s = String(v ?? ''); return s ? cel("'"+s) : ''; };
  const linhas = lista.map(l=>[
    celTexto(l.localColetor), celTexto(l.ean), cel(l.codDe), cel(l.codPara), cel(irFmtInt(l.quantidade)), cel(l.endereco)
  ].join(';'));
  // BOM na frente: sem ele o Excel em pt-BR abre o arquivo como Latin-1 e come
  // todos os acentos das descrições.
  const csv = '﻿' + [cab.map(cel).join(';'), ...linhas].join('\r\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const hoje = new Date().toISOString().slice(0,10);
  a.href = url; a.download = `ajuste-restricao-multiplos-${hoje}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
  irShowToast(irFmtInt(lista.length)+' linhas exportadas.');
}

/* ============================================================
   TELA — IMPORTAÇÃO
   ============================================================ */
const MD_BASES = [
  {id:'051', icone:'🧩', titulo:'ZBIQ0051', sub:'Estrutura do múltiplo', botao:'Processar estrutura',
   obrigatoria:true, msg:'process051', buf:'buf051'},
  {id:'390', icone:'📦', titulo:'QRY0390', sub:'Saldo por endereço', botao:'Processar saldo',
   obrigatoria:true, msg:'process390', buf:'buf390'},
  {id:'278', icone:'💰', titulo:'SIGEQ278', sub:'Preço de custo (opcional)', botao:'Processar preços',
   obrigatoria:false, msg:'process278', buf:'buf278'}
];
function mdArquivo(id){ return id==='051' ? MD.f051 : id==='390' ? MD.f390 : MD.f278; }
function mdSetArquivo(id, f){
  if(id==='051') MD.f051 = f; else if(id==='390') MD.f390 = f; else MD.f278 = f;
  irRenderView();
}
function mdOnFile(id, f){ if(f) mdSetArquivo(id, f); }
function mdOnDrop(id, e){ e.preventDefault(); const f = e.dataTransfer.files[0]; if(f) mdSetArquivo(id, f); }
function mdRemoveFile(id){ mdSetArquivo(id, null); }

function mdNovoWorker(){ return new Worker('js/worker.js?v=' + MD_APP_VERSION); }
function mdAtualizarProgresso(id){
  const st = document.getElementById('md-'+id+'-stage'), fi = document.getElementById('md-'+id+'-fill');
  const p = MD.progresso[id];
  if(st && fi){ st.textContent = p.stage; fi.style.width = p.pct+'%'; }
}
function mdProcessar(id){
  const base = MD_BASES.find(b=>b.id===id);
  const arq = mdArquivo(id);
  if(MD.proc[id] || !arq) return;
  MD.proc[id] = true;
  MD.progresso[id] = {stage:'Lendo arquivo...', pct:0};
  irRenderView();
  arq.arrayBuffer().then(buf=>{
    const worker = mdNovoWorker();
    worker.onmessage = async ev=>{
      const msg = ev.data;
      if(msg.type === 'progress'){
        MD.progresso[id] = {stage:msg.stage, pct:msg.pct};
        mdAtualizarProgresso(id);
        return;
      }
      if(msg.type === 'erro'){
        MD.proc[id] = false; worker.terminate();
        irShowToast(base.titulo+': '+msg.message, true);
        irRenderView();
        return;
      }
      MD.proc[id] = false; worker.terminate();
      mdSetArquivo(id, null);
      await mdRecarregar();
      if(msg.type === 'done051'){
        irShowToast(irFmtInt(msg.pais)+' múltiplos e '+irFmtInt(msg.componentes)+' componentes na estrutura.');
      } else if(msg.type === 'done390'){
        irShowToast(irFmtInt(msg.itens)+' componentes com saldo'+(msg.semSaldo ? ' · '+irFmtInt(msg.semSaldo)+' sem saldo' : '')+'.');
      } else if(msg.type === 'done278'){
        irShowToast(irFmtInt(msg.pais)+' pais de múltiplo com preço.');
      }
      irRenderView();
    };
    worker.onerror = ()=>{
      worker.terminate(); MD.proc[id] = false;
      irShowToast('Falha ao processar a '+base.titulo+'.', true);
      irRenderView();
    };
    const payload = {type: base.msg};
    payload[base.buf] = buf;
    worker.postMessage(payload, [buf]);
  }).catch(err=>{
    MD.proc[id] = false;
    irShowToast('Erro ao ler a '+base.titulo+': '+err.message, true);
    irRenderView();
  });
}

function mdEstadoBase(id){
  if(id==='051'){
    const m = MD.estruturaMeta;
    return m ? irFmtInt(m.pais)+' múltiplos · '+irFmtInt(m.componentes)+' componentes · '+irFmtDate(m.importadoEm) : 'nunca importada';
  }
  if(id==='390'){
    const m = MD.saldoMeta;
    if(!m) return 'nunca importada';
    const partes = [irFmtInt(m.itens)+' componentes com saldo'];
    if(m.semSaldo) partes.push(irFmtInt(m.semSaldo)+' sem saldo');
    if(m.atualizadoEm) partes.push('estoque de '+irFmtDate(m.atualizadoEm));
    partes.push('lida '+irFmtDataHora(m.importadoEm));
    return partes.join(' · ');
  }
  const m = MD.precoMeta;
  return m ? irFmtInt(m.pais)+' pais com preço · '+irFmtDate(m.importadoEm) : 'nunca importada';
}

function mdRenderImportacao(){
  const temEstrutura = !!(MD.estrutura && MD.estrutura.length);
  const cartao = b=>{
    const arq = mdArquivo(b.id), rodando = MD.proc[b.id], prog = MD.progresso[b.id];
    const inputId = 'md-file-'+b.id;
    return `<div class="av-card ${arq?'has-file':''}" ondrop="mdOnDrop('${b.id}', event)" ondragover="event.preventDefault()">
      <div class="av-top">
        <span class="av-icone">${b.icone}</span>
        <div class="av-nome"><strong>${irEsc(b.titulo)}</strong><span>${irEsc(b.sub)}</span></div>
      </div>
      <div class="av-estado">${irEsc(mdEstadoBase(b.id))}</div>
      <input type="file" id="${inputId}" accept=".xlsx,.xls" style="display:none" onchange="mdOnFile('${b.id}', this.files[0])">
      ${rodando ? `
        <div class="progress-wrap av-prog">
          <div class="progress-stage" id="md-${b.id}-stage">${irEsc(prog.stage)}</div>
          <div class="progress-track"><div class="progress-fill orange" id="md-${b.id}-fill" style="width:${prog.pct}%"></div></div>
        </div>`
      : arq ? `
        <div class="av-arquivo mono">${irEsc(arq.name)}</div>
        <div class="av-acoes">
          <button class="btn btn-primary" onclick="mdProcessar('${b.id}')">${irEsc(b.botao)}</button>
          <button class="btn-link" onclick="mdRemoveFile('${b.id}')">Remover</button>
        </div>`
      : `<div class="av-acoes"><button class="btn btn-secondary" onclick="document.getElementById('${inputId}').click()">Selecionar</button></div>`}
      ${b.id!=='051' && !temEstrutura ? `<p class="av-aviso">Importe a ZBIQ0051 antes: é ela que define quem é múltiplo.</p>` : ''}
    </div>`;
  };
  return `<div class="panel">
    <div class="ofe-head"><h3>Bases do módulo</h3></div>
    <p class="field-hint" style="margin-bottom:12px;">
      A ZBIQ0051 vem primeiro e define o universo: item que não está nela não é múltiplo.
      A QRY0390 traz o saldo, e só dos componentes dessa estrutura é guardado algo.
      A SIGEQ278 é opcional e serve para valorar — hoje a 390 vem com VALOR_UNITARIO zerado nos componentes,
      e o preço do conjunto está no item pai, que não tem estoque próprio.
    </p>
    <div class="av-grid">${MD_BASES.map(cartao).join('')}</div>
  </div>`;
}

/* ============================================================
   TELA — CONFIGURAÇÕES
   ============================================================
   Regra por valor de classe/X1/X2: quais restrições podem existir ali. É a
   base da validação das matrizes em Ajustes de Restrição — sem marcar nada
   pra um valor, ele não é validado (não dá pra saber o que é errado sem
   regra). Persistido no banco do módulo (config), não se perde ao reimportar. */
function mdValoresConhecidos(chave){
  const dim = MD_DIM_POR_CHAVE[chave];
  const set = new Set();
  for(const s of (MD.saldos||[])) for(const loc of (s.locais||[])){ const v = dim.valor(loc); if(v && v!=='—') set.add(v); }
  for(const v in (MD.regras[chave]||{})) set.add(v);
  return Array.from(set).sort();
}
function mdSetRegra(chave, valor, sigla, permitido){
  if(!MD.regras[chave]) MD.regras[chave] = {};
  const atual = new Set(MD.regras[chave][valor] || []);
  if(permitido) atual.add(sigla); else atual.delete(sigla);
  MD.regras[chave][valor] = Array.from(atual);
  mdSetConfig(MD_CONFIG_KEY_POR_DIM[chave], MD.regras[chave]);
  irRenderView();
}
function mdRenderConfiguracoes(){
  const secoes = MD_DIMENSOES.map(dim=>{
    const valores = mdValoresConhecidos(dim.chave);
    if(!valores.length) return '';
    const headerCols = MD_RESTRICOES.map(r=>
      `<th title="${irEsc(r.sigla+' — '+r.nome)}">${irEsc(r.cod)}</th>`
    ).join('');
    const linhas = valores.map(v=>{
      const regra = MD.regras[dim.chave][v] || [];
      const cels = MD_RESTRICOES.map(r=>{
        const marcado = regra.includes(r.sigla);
        return `<td><input type="checkbox" ${marcado?'checked':''} onchange="mdSetRegra('${dim.chave}','${irEsc(v)}','${r.sigla}', this.checked)"></td>`;
      }).join('');
      return `<tr><td class="md-left mono">${irEsc(v)}</td>${cels}</tr>`;
    }).join('');
    return `<div class="panel">
      <div class="md-head"><h3>Restrições permitidas por ${irEsc(dim.titulo)}</h3></div>
      <div class="md-piv-wrap">
        <table class="md-piv md-config-table">
          <thead><tr><th class="md-left">${irEsc(dim.titulo)}</th>${headerCols}</tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
    </div>`;
  }).filter(Boolean).join('');

  if(!secoes){
    return irEmptyState('Sem valores ainda', 'Importe a QRY0390 para ver as classes de local (CLAL, X1, X2) dos componentes de múltiplo.', "irSwitchTab('importacao')", 'Ir para a importação');
  }
  return `<p class="field-hint" style="margin-bottom:14px;">
    Marque, por classe/X1/X2, quais restrições podem existir ali. O que estiver fora disso aparece em vermelho
    nas matrizes da aba Ajustes de Restrição. Sem marcação nenhuma, não é validado.
  </p>${secoes}`;
}

/* ============================================================
   SHELL
   ============================================================ */
const MD_TELAS = {
  descasados:['Múltiplos Descasados','Componente sem par no estoque: dimensão, onde está e quanto vale.'],
  ajustes:['Ajustes de Restrição','O que bloquear em 86 e o que devolver para venda, linha a linha.'],
  configuracoes:['Configurações','Restrições permitidas por classe local — a régua do que está errado.'],
  importacao:['Importação','ZBIQ0051, QRY0390 e SIGEQ278 — as bases do módulo.']
};
let irUltimaTelaRenderizada = null;
function irRenderView(){
  const raiz = document.getElementById('viewRoot');
  if(!raiz) return;
  // Expandir/recolher uma linha do pivô (ou qualquer outra ação que force um
  // re-render dentro da MESMA aba) troca o innerHTML inteiro — e sem isso a
  // rolagem interna da tabela (.md-piv-wrap tem overflow próprio) voltava pro
  // topo, jogando fora o lugar onde a pessoa tinha acabado de abrir algo. Numa
  // troca de aba os wraps são de outra tabela — não faz sentido herdar scroll.
  const mesmaTela = irUltimaTelaRenderizada === MD.tela;
  const scrolls = mesmaTela ? Array.from(raiz.querySelectorAll('.md-piv-wrap')).map(el=>el.scrollTop) : [];
  irUltimaTelaRenderizada = MD.tela;
  if(MD.initErro){
    raiz.innerHTML = irEmptyState('Não consegui abrir o banco do navegador', MD.initErro, null, null);
    return;
  }
  raiz.innerHTML = MD.tela==='importacao'    ? mdRenderImportacao()
                 : MD.tela==='ajustes'       ? mdRenderAjustes()
                 : MD.tela==='configuracoes' ? mdRenderConfiguracoes()
                 : mdRenderDescasados();
  if(mesmaTela) raiz.querySelectorAll('.md-piv-wrap').forEach((el, i)=>{ if(scrolls[i]) el.scrollTop = scrolls[i]; });
}
function irSwitchTab(tela){
  MD.tela = MD_TELAS[tela] ? tela : 'descasados';
  document.querySelectorAll('.nav-item[data-tab]').forEach(b=>b.classList.toggle('active', b.dataset.tab===MD.tela));
  const [titulo, sub] = MD_TELAS[MD.tela];
  const t = document.getElementById('tabTitle'), s = document.getElementById('tabSubtitle');
  if(t) t.textContent = titulo;
  if(s) s.textContent = sub;
  irCloseSidebarMobile();
  irRenderView();
}
async function mdRecarregar(){
  MD.estrutura = await mdGetEstrutura();
  MD.saldos = await mdGetSaldo();
  MD.precos = await mdGetPrecos();
  MD.estruturaMeta = await mdGetEstruturaMeta();
  MD.saldoMeta = await mdGetSaldoMeta();
  MD.precoMeta = await mdGetPrecoMeta();
  MD.regras = {
    clal: (await mdGetConfig(MD_CONFIG_KEY_POR_DIM.clal)) || {},
    x1: (await mdGetConfig(MD_CONFIG_KEY_POR_DIM.x1)) || {}
  };
  mdInvalidarCache();
}
async function irInit(){
  const temaSalvo = localStorage.getItem('ir-theme');
  if(temaSalvo) document.documentElement.setAttribute('data-theme', temaSalvo);
  const temaApp = localStorage.getItem('ir-app-theme');
  if(temaApp && temaApp!=='padrao') document.documentElement.setAttribute('data-app-theme', temaApp);
  irUpdateThemeLabel();
  irApplyZoom(parseInt(localStorage.getItem('ir-zoom'), 10) || 100);
  const versao = document.getElementById('sidebarVersao');
  if(versao){
    const build = window.MD_BUILD;
    versao.textContent = (build && build.commit && build.commit!=='local')
      ? `${MD_APP_VERSION} · ${build.commit} · ${build.data}`
      : MD_APP_VERSION;
  }
  try{
    await mdRecarregar();
  }catch(e){
    console.error('Falha ao iniciar', e);
    MD.initErro = (e && (e.name ? e.name+': '+e.message : e.message)) || String(e);
  }
  irRenderView();
}
