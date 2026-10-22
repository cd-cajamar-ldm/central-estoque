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
const MD_APP_VERSION = 'v6';
const MD = {
  estrutura:null, saldos:null, precos:null,
  estruturaMeta:null, saldoMeta:null, precoMeta:null,
  base:'qtde',          // 'qtde' = tudo que existe | 'qtdeDisp' = só o disponível
  equalizado:'nao',     // 'sim' (já casado) | 'nao' (precisa de ajuste)
  busca:'',
  buscaAuditoria:'',
  pivotExpandido:new Set(),
  tela:'descasados',
  regras:{clal:{}, x1:{}},        // dimensão -> valor -> [siglas de restrição permitidas] — valendo de verdade (salvo)
  // Rascunho da tela de Configurações: o que está marcado na hora só entra em
  // MD.regras (e passa a valer no pareamento/Ajustes/Auditoria) quando a
  // pessoa clica em "Salvar Configuração" — clique errado no meio de uma
  // conferência não pode mudar o resultado sozinho.
  regrasRascunho:{clal:{}, x1:{}},
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
  // Só o PREFIXO do X1: na extração real o campo X1 já vem como "BLC 001",
  // "BLM 011" etc. (não é X1="BLC" + X2="001" separados) — usar o campo
  // inteiro continuava dando uma linha por sub-endereço. A primeira palavra
  // é o bloco de verdade (BLC, BLM, BIN...), que é o nível que importa pra
  // essa régua.
  {chave:'x1', titulo:'X1', valor:o=>(o.x1 || '').trim().split(/\s+/)[0] || '—'}
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
  // Mapa completo (preço E nome), não só o preço — a SIGEQ278 traz o nome do
  // PRÓPRIO item pai, a fonte mais confiável que existe pra esse nome: é
  // keyed pelo código do pai direto, sem depender de a 390 repetir um nome de
  // componente na coluna NOME_ITEM_PAI (nem sempre vem preenchida).
  const precos = new Map((MD.precos||[]).map(p=>[p.item, p]));
  // mdRestricaoPermitida aplica a regra de classe/X1 (Configurações) ANTES de
  // parear: WN ou 86 num endereço fora da regra (ex.: reversa cadastrada como
  // WN) não conta como vendável/múltiplo incompleto de verdade.
  MD._cache = mdCalcularPais(MD.estrutura, saldos, precos, MD.base, mdRestricaoPermitida);
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
  // Item pai com menos peça no total é quem corre mais risco de cancelamento
  // se for romaneado sem ter como atender o pedido — aparece primeiro, tanto
  // aqui na tela quanto na planilha exportada (mdGerarXlsxAjuste).
  return lista.slice().sort((a,b)=>a.pecasTotal - b.pecasTotal || b.sobraValor - a.sobraValor);
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
/* LOG (LOG_ITEM da 390) é a linha de produto/responsável do item — diferente
   da classe física do endereço (CLAL/X1/X2). Agrupa o valor bloqueado
   (mesma sobra vendável do KPI "Valor descasado") por essa linha pra apontar
   qual LOG concentra mais descasamento, não só o total geral. */
/* Agrupa os componentes com sobra bloqueada (mesmo critério do KPI "Valor
   descasado") por uma chave qualquer — usado tanto pelo "LOG mais divergente"
   dos KPIs quanto pelos rankings da aba Indicadores. Ordenado do maior valor
   pro menor. */
function mdAgruparComponentesBloqueados(pais, chaveFn){
  const porChave = new Map();
  for(const p of pais){
    for(const c of p.componentes){
      if(!(c.bloquear > 0)) continue;
      const chave = chaveFn(c) || '—';
      if(!porChave.has(chave)) porChave.set(chave, {chave, valor:0, pecas:0, pais:new Set()});
      const acc = porChave.get(chave);
      acc.valor += c.valorBloquear || 0;
      acc.pecas += c.bloquear;
      acc.pais.add(p.pai);
    }
  }
  return Array.from(porChave.values())
    .map(a=>({chave:a.chave, valor:a.valor, pecas:a.pecas, nPais:a.pais.size}))
    .sort((a,b)=>b.valor - a.valor);
}
/* Não existe campo de fornecedor em nenhuma base importada (ZBIQ0051,
   QRY0390, SIGEQ278) — a última palavra do nome do componente é o jeito que
   tem hoje de aproximar isso, já que no cadastro ela costuma ser a marca/
   fabricante (ex. "...DOBRAVEL EQUIPAMENTOS", "...8T 26PC 4003-P MARCON"). */
function mdUltimaPalavra(nome){
  if(!nome) return '';
  const palavras = nome.trim().split(/\s+/);
  return palavras[palavras.length - 1] || '';
}
function mdRankingPorLog(pais){ return mdAgruparComponentesBloqueados(pais, c=>c.log || '(sem LOG)'); }
function mdRankingPorFornecedor(pais){ return mdAgruparComponentesBloqueados(pais, c=>mdUltimaPalavra(c.nome) || '(sem nome)'); }
function mdLogMaisDivergente(pais){
  const topo = mdRankingPorLog(pais)[0];
  return topo ? {log: topo.chave, valor: topo.valor, pecas: topo.pecas, nPais: topo.nPais} : null;
}
function mdKpis(resumo, pais){
  const divergente = mdLogMaisDivergente(pais || []);
  const cardLog = divergente
    ? `<div class="kpi-card bad"><div class="num">${irEsc(divergente.log)}</div>
        <div class="label">LOG mais divergente — ${irFmtMoney(divergente.valor)} em ${irFmtInt(divergente.nPais)} ${divergente.nPais===1?'múltiplo':'múltiplos'}</div></div>`
    : `<div class="kpi-card good"><div class="num">—</div><div class="label">LOG mais divergente — nenhum descasado agora</div></div>`;
  return `<div class="kpi-grid">
    <div class="kpi-card bad"><div class="num">${irFmtInt(resumo.paisDescasados)}</div><div class="label">Múltiplos a ajustar</div></div>
    <div class="kpi-card bad"><div class="num">${irFmtInt(resumo.bloquearPecas)}</div><div class="label">Peças a bloquear (0 → 86)</div></div>
    <div class="kpi-card good"><div class="num">${irFmtInt(resumo.liberarPecas)}</div><div class="label">Peças a liberar (86 → 0)</div></div>
    <div class="kpi-card bad"><div class="num num-money">${irFmtMoney(resumo.sobraValor)}</div><div class="label">Valor descasado</div></div>
    <div class="kpi-card good"><div class="num num-money">${irFmtMoney(resumo.liberarValor)}</div><div class="label">Valor a liberar</div></div>
    ${cardLog}
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

/* Cabeçalho de coluna de restrição, nos dois tamanhos: uma palavra curta em
   cima (pra não precisar do tooltip só pra saber o que é) e o código do WMS
   embaixo, que é o que se digita no coletor. */
function mdRotuloColunaHtml(sigla){
  return `<span class="md-col-rotulo">${irEsc(mdRotuloCurto(sigla))}</span><span class="md-col-codigo">${irEsc(mdCodRestricao(sigla))}</span>`;
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
/* Só a primeira e a última palavra da descrição — o meio (tamanho, cor,
   variação...) não ajuda a identificar o item na lista e só empurrava o fim
   do nome (geralmente a marca ou o diferencial) pra fora da linha. */
function mdTruncarNome(nome){
  if(!nome) return '';
  const palavras = nome.trim().split(/\s+/);
  if(palavras.length <= 2) return nome.trim();
  return palavras[0] + ' … ' + palavras[palavras.length - 1];
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
      ? `<span class="md-tag md-tag-falta">${p.faltantes} falta componente${p.faltantes>1?'s':''}</span>`
      : (p.completos === 0 ? `<span class="md-tag md-tag-bad">0 vendáveis</span>` : '');
    linhas += `<tr class="md-piv-pai">
      <td class="md-left"><span class="md-piv-nome"><button class="md-piv-toggle" onclick="mdPivToggle('${idPai}')">${paiAberto?'−':'+'}</button><span class="mono">${irEsc(p.pai)}</span> ${irEsc(mdTruncarNome(p.nome))}</span>${alerta}</td>
      ${mdPivColunas(mdPaiTotaisPorSigla(p, restricoes), restricoes, p.pecasTotal)}
    </tr>`;
    if(!paiAberto) continue;
    for(const c of p.componentes){
      const idComp = idPai+'-c-'+c.componente;
      const compAberto = MD.pivotExpandido.has(idComp);
      const tagValor = c.inInterface==='S' ? ' <span class="md-tag md-tag-info" title="Carrega o valor do múltiplo (in_interface = S)">valor</span>' : '';
      linhas += `<tr class="md-piv-comp">
        <td class="md-left"><button class="md-piv-toggle" onclick="mdPivToggle('${idComp}')">${compAberto?'−':'+'}</button><span class="mono">${irEsc(c.componente)}</span> ${irEsc(mdTruncarNome(c.nome))}${tagValor}</td>
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
    return `<th class="${cls}" title="${irEsc(mdCodRestricao(s)+' — '+mdNomeRestricao(s))}">${mdRotuloColunaHtml(s)}</th>`;
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
  const pais = mdPais();
  return mdKpis(mdResumo(pais), pais) + mdBarraFiltros() + mdRenderPivot();
}

/* ============================================================
   TELA — INDICADORES
   ============================================================
   Painel só de leitura, pra mostrar ao setor como estão os múltiplos
   descasados agora — mesmos números da aba Descasados, organizados por LOG,
   por fornecedor aproximado (sem campo próprio nas bases, usa a última
   palavra do nome) e pelos itens pai mais críticos. Nada clicável, nada de
   filtro — é retrato, não ferramenta de trabalho. */
function mdRenderRanking(titulo, labelColuna, ranking, limite){
  const linhas = (ranking || []).slice(0, limite || 10);
  if(!linhas.length){
    return `<div class="panel"><h3>${irEsc(titulo)}</h3><p class="field-hint">Nenhum descasamento no momento.</p></div>`;
  }
  const corpo = linhas.map((l,i)=>`<tr>
    <td class="md-left">${i+1}</td>
    <td class="md-left">${irEsc(l.chave)}</td>
    <td>${irFmtInt(l.pecas)}</td>
    <td>${irFmtInt(l.nPais)}</td>
    <td>${irFmtMoney(l.valor)}</td>
  </tr>`).join('');
  return `<div class="panel">
    <h3>${irEsc(titulo)}</h3>
    <div class="md-piv-wrap">
      <table class="md-piv">
        <thead><tr>
          <th class="md-left">#</th>
          <th class="md-left">${irEsc(labelColuna)}</th>
          <th>Peças a bloquear</th>
          <th>Múltiplos</th>
          <th>Valor descasado</th>
        </tr></thead>
        <tbody>${corpo}</tbody>
      </table>
    </div>
  </div>`;
}
function mdRenderTopPais(pais, limite){
  const lista = pais.filter(p=>p.sobraValor > 0).sort((a,b)=>b.sobraValor - a.sobraValor).slice(0, limite || 10);
  if(!lista.length){
    return `<div class="panel"><h3>Itens pai mais críticos</h3><p class="field-hint">Nenhum múltiplo descasado no momento.</p></div>`;
  }
  const corpo = lista.map((p,i)=>`<tr>
    <td class="md-left">${i+1}</td>
    <td class="md-left"><span class="mono">${irEsc(p.pai)}</span> ${irEsc(mdTruncarNome(p.nome))}</td>
    <td>${irFmtInt(p.bloquearPecas)}</td>
    <td>${irFmtMoney(p.sobraValor)}</td>
  </tr>`).join('');
  return `<div class="panel">
    <h3>Itens pai mais críticos</h3>
    <div class="md-piv-wrap">
      <table class="md-piv">
        <thead><tr>
          <th class="md-left">#</th>
          <th class="md-left">Item pai</th>
          <th>Peças a bloquear</th>
          <th>Valor descasado</th>
        </tr></thead>
        <tbody>${corpo}</tbody>
      </table>
    </div>
  </div>`;
}
function mdRenderIndicadores(){
  if(!mdTemDados()){
    return irEmptyState('Sem bases importadas', 'Importe a ZBIQ0051 e a QRY0390 pra ver os indicadores.', "irSwitchTab('importacao')", 'Ir para a importação');
  }
  const pais = mdPais();
  return mdKpis(mdResumo(pais), pais)
    + `<p class="field-hint" style="margin:14px 0;">Panorama pra mostrar ao setor como estão os múltiplos descasados agora.</p>`
    + mdRenderRanking('Por LOG', 'LOG', mdRankingPorLog(pais))
    + mdRenderRanking('Por fornecedor (aproximado pela última palavra do nome)', 'Fornecedor', mdRankingPorFornecedor(pais))
    + mdRenderTopPais(pais);
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
  MD._plano = mdPlanoAjuste(mdPais(), MD.base, mdRestricaoPermitida);
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

/* Restrição de um endereço batendo com a regra configurada pra classe/X1 dele
   — a mesma checagem usada pra corrigir (abaixo) e pra decidir, antes de
   parear (mdPais em mdPais/mdCalcularPais), se um WN ou 86 mal classificado
   (ex.: endereço de reversa cadastrado como WN) deve ou não contar como
   vendável/múltiplo incompleto de verdade.

   X1 manda primeiro, por ser mais específico que a classe (o endereço físico
   importa mais que a categoria geral do item); a classe só é olhada quando o
   X1 não resolve — sem regra pra ele, ou com regra que não inclui a
   restrição atual. Se a classe permitir ali, vale a classe (ex.: X1=GAI só
   permite WN, mas a classe CARGA permite Reversa — um item CARGA num
   endereço GAI em Reversa está certo, não é descasamento de verdade). Sem
   regra pra nenhuma das duas, não dá pra dizer se está errado — conta como
   permitida. */
function mdRegraViolada(loc){
  const regraX1 = mdRegraDe('x1', MD_DIM_POR_CHAVE.x1.valor(loc));
  const regraClasse = mdRegraDe('clal', MD_DIM_POR_CHAVE.clal.valor(loc));
  if(regraX1 && regraX1.includes(loc.restricao)) return null;
  if(regraClasse && regraClasse.includes(loc.restricao)) return null;
  return regraX1 || regraClasse || null;
}
function mdRestricaoPermitida(loc){ return mdRegraViolada(loc) === null; }

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
  // Um componente pode estar em mais de um múltiplo (ver PR #373) — junta
  // todos os pais pra não perder referência nenhuma na planilha exportada.
  const paisPorComponente = new Map();
  for(const e of (MD.estrutura||[])){
    if(!paisPorComponente.has(e.componente)) paisPorComponente.set(e.componente, []);
    paisPorComponente.get(e.componente).push(e.pai);
  }
  const out = [];
  for(const s of (MD.saldos||[])){
    for(const loc of (s.locais||[])){
      const regra = mdRegraViolada(loc);
      if(!regra) continue;
      // 86 nunca é destino de correção, nem como única restrição permitida
      // cadastrada por engano — quem decide o que vai pra 86 é sempre o
      // pareamento da aba Descasados, nunca esta correção de restrição.
      const destino = regra.includes(MD_SIGLA_VENDAVEL) ? MD_SIGLA_VENDAVEL
        : (regra.length===1 && regra[0] !== MD_SIGLA_BLOQUEIO ? regra[0] : null);
      if(!destino) continue;
      const refs = (loc.refs && loc.refs.length) ? loc.refs : [{qtde: loc.qtde, qtdeDisp: loc.qtdeDisp}];
      const preco = s.valorUnitario || 0;
      // Mesmo item+local+restrição em mais de um lote (duas "entradas de
      // estoque" separadas, mesma linha podendo até repetir a quantidade) trava
      // a 10.MOVI Alt.Restrição Local (altera tudo do local de uma vez, sem
      // conseguir escolher qual estoque) com erro — tem que ir por
      // Alt.Restrição Estoque (Shift+F6), igual já é feito pra 86. Não vale pra
      // linha que SAI de 86: essa já é sempre por quantidade específica, nunca
      // em massa por local, então o erro nunca aparece ali.
      const quebrado = loc.lotes > 1 && loc.restricao !== MD_SIGLA_BLOQUEIO;
      for(const ref of refs){
        // Quantidade romaneada (QTDE_ROM) já está separada pra um pedido —
        // abate do que dá pra corrigir, igual ao plano de pareamento.
        const quantidade = Math.max(0, (ref[campo] || 0) - (ref.qtdeRom || 0));
        if(!quantidade) continue;
        out.push({
          de: loc.restricao, para: destino,
          codDe: mdCodRestricao(loc.restricao), codPara: mdCodRestricao(destino),
          localColetor: mdLocalColetor(loc.local),
          local: loc.local, endereco: loc.desc, predio: loc.predio,
          clal: loc.clal, x1: loc.x1, x2: loc.x2,
          componente: s.item, nome: s.nome, pai: (paisPorComponente.get(s.item) || []).join('/'),
          ean: s.ean, quantidade, quebrado,
          preco, valor: quantidade * preco,
          totalComponente: s[campo]
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
      title="${irEsc(mdCodRestricao(s)+' — '+mdNomeRestricao(s)+' · clique para ordenar')}">${mdRotuloColunaHtml(s)}${mdSetaOrdem(chave, s)}</th>`;
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
   Equalizado da tela — exporta só o que está sendo mostrado ali. Duas abas,
   pelo sentido do movimento: bloquear (0 → 86) e liberar (86 → 0) nunca se
   misturam na digitação do coletor, então não fazia sentido numa lista só. */
function mdExportarAjustePivot(){
  const plano = mdPlanoAjuste(mdPaisFiltrados(), MD.base, mdRestricaoPermitida);
  mdGerarXlsxAjuste([
    {titulo:'Bloquear (0 para 86)', linhas: plano.filter(l=>l.sentido==='bloquear')},
    {titulo:'Liberar (86 para 0)', linhas: plano.filter(l=>l.sentido==='liberar')}
  ]);
}
/* Ajustes de Restrição: corrige as células fora da regra (não é o plano de
   pareamento da aba Descasados — ver mdPlanoCorrecaoRestricao), respeitando
   classe e X1/X2 marcados nas duas matrizes. Separado por destino pelo mesmo
   motivo do pivô: quase tudo vai pra 0 (WN), mas a rara linha com um destino
   diferente (só uma restrição cadastrada, sem WN) não deve se misturar. */
function mdExportarAjusteClasses(){
  const plano = mdPlanoCorrecaoRestricao().filter(l=>
    MD_DIMENSOES.every(dim=>mdValorMarcado(dim.chave, dim.valor(l)))
  );
  mdGerarXlsxAjuste([
    {titulo:'Para 0 (WN)', linhas: plano.filter(l=>l.para===MD_SIGLA_VENDAVEL)},
    {titulo:'Para outras restrições', linhas: plano.filter(l=>l.para!==MD_SIGLA_VENDAVEL)}
  ]);
}

/* Só o que vai pro coletor: local, item, restrição de/para, quantidade e
   endereço (pra achar a peça). O resto (pai, descrição, saldo, preço...) é
   conferência que já está na tela — não precisa duplicar na planilha.

   .xlsx de verdade (não CSV): é o único jeito de ter mais de uma aba e de
   marcar Local/EAN como NÚMERO com formato "sem decimal" ao mesmo tempo —
   um CSV não carrega esse tipo de informação por célula. CSV também foi o
   que obrigava forçar texto com aspa simples na frente pra fugir da notação
   científica do Excel (5E+09, 7,89862E+12), e a aspa acabava colando junto
   quando alguém copiava o valor pro coletor, que não entende e barra com
   "FORMATO INVÁLIDO". Número de verdade, com formato de inteiro, resolve as
   duas coisas de uma vez: sem notação científica e sem símbolo estranho.

   xlsx-js-style (carregada só no index.html, não no worker) em vez da xlsx
   comum: a versão livre do SheetJS não grava estilo nenhum no arquivo — cor
   de cabeçalho, zebra etc. saem sempre em branco. */
function mdGerarXlsxAjuste(blocos, prefixoArquivo){
  const COR_LARANJA = 'FE5000', COR_AZUL = '001A72', COR_BRANCO = 'FFFFFF', COR_ZEBRA = 'FFF4EE';
  // Item pai (o código do múltiplo, não do componente) entra só como
  // referência pra achar o item certo em caso de EAN duplicado entre SKUs
  // diferentes — não é campo que se cola no coletor, por isso fica no fim,
  // fora da sequência Local/EAN/Orig/Dest/Qtde que é exatamente a ordem dos
  // campos na tela.
  const cab = ['Local (coletor)','EAN','Orig','Dest','Qtde','Endereço','Obs','Item pai'];
  const colNumerica = new Set([0,1,2,3,4]); // tudo menos Endereço, Obs e Item pai

  function construirAba(linhas){
    const dados = linhas.map(l=>[
      Number(l.localColetor) || 0, Number(l.ean) || 0, Number(l.codDe) || 0,
      Number(l.codPara) || 0, Math.round(l.quantidade) || 0, l.endereco || '',
      l.quebrado ? 'Alt.Restrição Estoque (Shift+F6) — 2 estoques' : '', String(l.pai || '')
    ]);
    const ws = XLSX.utils.aoa_to_sheet([cab, ...dados]);
    cab.forEach((_, c)=>{
      const cel = ws[XLSX.utils.encode_cell({r:0, c})];
      if(cel) cel.s = {
        fill: {fgColor:{rgb:COR_LARANJA}},
        font: {bold:true, color:{rgb:COR_BRANCO}},
        alignment: {horizontal:'center', vertical:'center'},
        border: {bottom:{style:'thin', color:{rgb:COR_AZUL}}}
      };
    });
    dados.forEach((_, ri)=>{
      const zebra = ri % 2 === 1;
      for(let c=0; c<cab.length; c++){
        const cel = ws[XLSX.utils.encode_cell({r:ri+1, c})];
        if(!cel) continue;
        cel.s = {alignment:{vertical:'center'}, ...(zebra ? {fill:{fgColor:{rgb:COR_ZEBRA}}} : {})};
        if(colNumerica.has(c)) cel.z = '0';
      }
    });
    ws['!cols'] = [{wch:14},{wch:16},{wch:7},{wch:7},{wch:8},{wch:28},{wch:34},{wch:12}];
    return ws;
  }

  // Linha marcada `quebrado` trava a Alt.Restrição Local em massa — fica por
  // último na aba pra fazer as em massa primeiro, sem interrupção, e deixar
  // só as de Alt.Restrição Estoque (Shift+F6) pro final. Dentro de cada grupo,
  // item com menos saldo total é o que corre mais risco de cancelamento se for
  // romaneado sem ter peça pra atender o pedido — sai primeiro, pra ser
  // resolvido antes. Critério por item (WN+86+outras), não pela quantidade da
  // própria linha: duas linhas do mesmo item comprado ficam juntas, ordenadas
  // pelo item, não espalhadas pela tabela.
  const comLinhas = blocos
    .map(b=>({...b, linhas: b.linhas.slice().sort((a,c)=>
      (a.quebrado?1:0) - (c.quebrado?1:0) || (a.totalComponente ?? 0) - (c.totalComponente ?? 0))}))
    .filter(b=>b.linhas.length);
  if(!comLinhas.length){ irShowToast('Não há ajuste para exportar.'); return; }
  const wb = XLSX.utils.book_new();
  for(const bloco of comLinhas) XLSX.utils.book_append_sheet(wb, construirAba(bloco.linhas), bloco.titulo);

  const hoje = new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb, `${prefixoArquivo || 'ajuste-restricao-multiplos'}-${hoje}.xlsx`);
  const total = comLinhas.reduce((a,b)=>a+b.linhas.length, 0);
  irShowToast(irFmtInt(total)+' linhas exportadas.');
}

/* ============================================================
   TELA — AUDITORIA DE RESTRIÇÃO
   ============================================================
   Mesmo cálculo de Ajustes de Restrição (mdPlanoCorrecaoRestricao, já olhando
   pra toda peça do CD) — só muda a apresentação: ali é pivô por Classe/X1 com
   checkbox de seleção, aqui é lista linha a linha (item+endereço), mais fácil
   de buscar e conferir um caso específico sem abrir a matriz inteira. */
const MD_LIMITE_AUDITORIA = 300;
function mdRenderAuditoria(){
  if(!mdTemDados()){
    return irEmptyState('Sem bases importadas', 'Importe a ZBIQ0051 e a QRY0390 para auditar a restrição de todos os itens.', "irSwitchTab('importacao')", 'Ir para a importação');
  }
  let plano = mdPlanoCorrecaoRestricao();
  const termo = (MD.buscaAuditoria || '').trim().toLowerCase();
  if(termo) plano = plano.filter(l =>
    l.componente.toLowerCase().includes(termo) || (l.nome||'').toLowerCase().includes(termo) ||
    (l.local||'').toLowerCase().includes(termo) || (l.clal||'').toLowerCase().includes(termo) ||
    (l.x1||'').toLowerCase().includes(termo));
  // Quebrado (2+ estoques no mesmo item+local+restrição) trava a Alt.Restrição
  // Local em massa — fica por último, igual na planilha exportada, pra fazer
  // as em massa primeiro e deixar só as de Shift+F6 pro final.
  plano.sort((a,b)=>(a.quebrado?1:0) - (b.quebrado?1:0) || b.valor - a.valor);

  const resumo = mdResumoCorrecao();

  const linhas = plano.slice(0, MD_LIMITE_AUDITORIA).map(l=>`<tr>
    <td class="md-left mono">${irEsc(l.componente)}</td>
    <td class="md-left">${irEsc(l.nome)}</td>
    <td class="md-left mono">${irEsc(l.local)}</td>
    <td class="md-left mono">${irEsc(l.clal)}</td>
    <td class="md-left mono">${irEsc(l.x1)}</td>
    <td class="md-cel-erro">${irEsc(mdCodRestricao(l.de)+' '+l.de)}</td>
    <td class="md-col-wn">${irEsc(mdCodRestricao(l.para)+' '+l.para)}</td>
    <td>${irFmtInt(l.quantidade)}</td>
    <td class="num-money">${irFmtMoney(l.valor)}</td>
    <td class="md-left">${l.quebrado ? '<span class="md-badge-aviso" title="2+ estoques no mesmo item/local/restrição — não dá pra fazer em massa, use Alt.Restrição Estoque (Shift+F6)">Shift+F6 (2 estoques)</span>' : ''}</td>
  </tr>`).join('');

  return `<div class="panel">
    <div class="md-head">
      <h3>Auditoria de Restrição</h3>
      <button class="btn btn-primary" onclick="mdExportarAuditoria()">Baixar relatório</button>
    </div>
    <p class="field-hint" style="margin-bottom:12px;">
      Toda peça do CD com restrição fora da regra configurada em Configurações — mesmo cálculo de Ajustes de Restrição, em lista por item e endereço.
    </p>
    ${mdKpisCorrecao(resumo)}
    ${mdAvisoSemRegra()}
    <div class="md-filtros">
      <input id="mdBuscaAuditoria" class="md-busca" type="search" placeholder="Buscar item, local, classe ou X1..."
             value="${irEsc(MD.buscaAuditoria)}" oninput="mdBuscarAuditoria(this.value)">
    </div>
    ${!plano.length ? '<p class="field-hint">Nenhuma restrição fora da regra encontrada.</p>' : `
    <div class="md-piv-wrap">
      <table class="md-piv">
        <thead><tr>
          <th class="md-left">Item</th><th class="md-left">Descrição</th><th class="md-left">Local</th>
          <th class="md-left">Classe</th><th class="md-left">X1</th>
          <th>Restrição atual</th><th>Sugestão</th><th>Quantidade</th><th>Valor</th><th class="md-left">Obs</th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
    ${plano.length > MD_LIMITE_AUDITORIA ? `<p class="field-hint" style="margin-top:8px;">Mostrando as ${irFmtInt(MD_LIMITE_AUDITORIA)} maiores por valor, de ${irFmtInt(plano.length)} linhas. Baixe o relatório pra ver tudo.</p>` : ''}
    `}
  </div>`;
}
function mdBuscarAuditoria(v){
  MD.buscaAuditoria = v;
  clearTimeout(window.__mdBuscaAuditoriaTimer);
  window.__mdBuscaAuditoriaTimer = setTimeout(()=>{ irRenderView(); document.getElementById('mdBuscaAuditoria')?.focus(); }, 220);
}
function mdExportarAuditoria(){
  const plano = mdPlanoCorrecaoRestricao();
  mdGerarXlsxAjuste([
    {titulo:'Para 0 (WN)', linhas: plano.filter(l=>l.para===MD_SIGLA_VENDAVEL)},
    {titulo:'Para outras restrições', linhas: plano.filter(l=>l.para!==MD_SIGLA_VENDAVEL)}
  ], 'auditoria-restricao');
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
        irShowToast(irFmtInt(msg.pais)+' múltiplos e '+irFmtInt(msg.componentes)+' componentes na estrutura.'
          +(msg.compartilhados ? ' · '+irFmtInt(msg.compartilhados)+' componentes usados em mais de um múltiplo' : ''));
      } else if(msg.type === 'done390'){
        irShowToast(irFmtInt(msg.itens)+' itens com saldo no CD'+(msg.semSaldo ? ' · '+irFmtInt(msg.semSaldo)+' componentes de múltiplo sem saldo' : '')+'.');
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
    if(!m) return 'nunca importada';
    return irFmtInt(m.pais)+' múltiplos · '+irFmtInt(m.componentes)+' componentes · '+irFmtDate(m.importadoEm)
      +(m.compartilhados ? ' · '+irFmtInt(m.compartilhados)+' componentes em mais de um múltiplo' : '');
  }
  if(id==='390'){
    const m = MD.saldoMeta;
    if(!m) return 'nunca importada';
    const partes = [irFmtInt(m.itens)+' itens com saldo no CD'];
    if(m.semSaldo) partes.push(irFmtInt(m.semSaldo)+' componentes de múltiplo sem saldo');
    if(m.atualizadoEm) partes.push('estoque de '+irFmtDate(m.atualizadoEm));
    partes.push('lida '+irFmtDataHora(m.importadoEm));
    return partes.join(' · ');
  }
  const m = MD.precoMeta;
  return m ? irFmtInt(m.pais)+' pais com preço · '+irFmtDate(m.importadoEm) : 'nunca importada';
}

/* Restrição no estoque real que não está na legenda (MD_RESTRICOES) — sem
   isso ela fica muda (sem nome, sem entrar nas regras de Configurações) e
   ninguém percebe. Varre TODO saldo (já é o CD inteiro, não só componente de
   múltiplo) em vez de confiar só na legenda cadastrada à mão. */
function mdRestricoesDesconhecidas(){
  const conhecidas = new Set(MD_RESTRICOES.map(r=>r.sigla));
  const porSigla = new Map();
  for(const s of (MD.saldos||[])){
    for(const loc of (s.locais||[])){
      if(!loc.restricao || conhecidas.has(loc.restricao)) continue;
      const atual = porSigla.get(loc.restricao) || {sigla: loc.restricao, enderecos: 0, qtde: 0};
      atual.enderecos++;
      atual.qtde += loc.qtde || 0;
      porSigla.set(loc.restricao, atual);
    }
  }
  return Array.from(porSigla.values()).sort((a,b)=>b.qtde - a.qtde);
}
function mdAvisoRestricoesDesconhecidas(){
  const desconhecidas = mdRestricoesDesconhecidas();
  if(!desconhecidas.length) return '';
  const itens = desconhecidas.map(d=>
    `<strong>${irEsc(d.sigla)}</strong> (${irFmtInt(d.enderecos)} endereço${d.enderecos===1?'':'s'}, ${irFmtInt(d.qtde)} peças)`
  ).join(', ');
  return `<div class="panel md-aviso">
    Restrição não cadastrada na legenda: ${itens}. Sem cadastrar, ela fica sem nome
    e não entra nas regras de Configurações. Avise o código e o significado pra eu adicionar.
  </div>`;
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
      A ZBIQ0051 vem primeiro e define o universo de múltiplos: item que não está nela não entra no pareamento.
      A QRY0390 traz o saldo de todo item do CD — componente de múltiplo ou não — usado tanto em Descasados
      (só os componentes) quanto em Ajustes/Auditoria de Restrição (tudo).
      A SIGEQ278 é opcional e serve para valorar — hoje a 390 vem com VALOR_UNITARIO zerado nos componentes,
      e o preço do conjunto está no item pai, que não tem estoque próprio.
    </p>
    <div class="av-grid">${MD_BASES.map(cartao).join('')}</div>
  </div>
  ${mdAvisoRestricoesDesconhecidas()}`;
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
/* Só mexe no RASCUNHO (MD.regrasRascunho) — não salva, não invalida cache, não
   afeta pareamento nem Ajustes/Auditoria. Só "Salvar Configuração" (abaixo)
   promove o rascunho pra valer de verdade; clicar errado no meio de uma
   conferência não muda resultado nenhum sozinho. */
function mdSetRegra(chave, valor, sigla, permitido){
  if(!MD.regrasRascunho[chave]) MD.regrasRascunho[chave] = {};
  const atual = new Set(MD.regrasRascunho[chave][valor] || []);
  if(permitido) atual.add(sigla); else atual.delete(sigla);
  MD.regrasRascunho[chave][valor] = Array.from(atual);
  irRenderView();
  // irRenderView troca o innerHTML da tabela inteira e derruba o foco — sem
  // devolver pro mesmo checkbox, marcar várias casas em sequência com teclado
  // (seta + espaço) perderia a posição a cada tecla.
  for(const cb of document.querySelectorAll('input[type="checkbox"][data-chave]')){
    if(cb.dataset.chave === chave && cb.dataset.valor === valor && cb.dataset.sigla === sigla){ cb.focus(); break; }
  }
}
/* Navegação por seta na matriz de Configurações — marcar casa a casa com o
   mouse é lento numa tabela com dezenas de X1/X2. Espaço já marca/desmarca
   sozinho (comportamento nativo do checkbox); só falta mover o foco. */
function mdConfigNav(e, el){
  const tecla = e.key;
  if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(tecla)) return;
  e.preventDefault();
  const td = el.closest('td');
  const tr = td.closest('tr');
  if(tecla === 'ArrowLeft' || tecla === 'ArrowRight'){
    const dir = tecla === 'ArrowRight' ? 1 : -1;
    let alvo = td;
    do { alvo = dir > 0 ? alvo.nextElementSibling : alvo.previousElementSibling; }
    while(alvo && !alvo.querySelector('input[type="checkbox"]'));
    if(alvo) alvo.querySelector('input[type="checkbox"]').focus();
    return;
  }
  const colIdx = Array.from(tr.children).indexOf(td);
  const alvoTr = tecla === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
  const alvoTd = alvoTr && alvoTr.children[colIdx];
  const cb = alvoTd && alvoTd.querySelector('input[type="checkbox"]');
  if(cb) cb.focus();
}
function mdRascunhoAlterado(){
  return JSON.stringify(MD.regrasRascunho) !== JSON.stringify(MD.regras);
}
function mdSalvarConfiguracao(){
  MD.regras = { clal: {...MD.regrasRascunho.clal}, x1: {...MD.regrasRascunho.x1} };
  mdSetConfig(MD_CONFIG_KEY_POR_DIM.clal, MD.regras.clal);
  mdSetConfig(MD_CONFIG_KEY_POR_DIM.x1, MD.regras.x1);
  // Só agora o pareamento de Descasados e Ajustes/Auditoria de Restrição
  // passam a enxergar a mudança (ver mdPais/mdPlanoCorrecaoRestricao).
  mdInvalidarCache();
  irRenderView();
  irShowToast('Configuração salva.');
}
function mdDescartarRascunho(){
  MD.regrasRascunho = { clal: {...MD.regras.clal}, x1: {...MD.regras.x1} };
  irRenderView();
  irShowToast('Alterações descartadas.');
}
/* 0 (WN) e 86 (AI) são as duas restrições que todo mundo mexe o tempo
   inteiro — ficam lado a lado, igual já é no pivô (MD_ORDEM_RESTRICOES),
   em vez do 86 isolado lá no fim da tabela depois de mais 13 colunas. */
const MD_RESTRICOES_CONFIG = MD_ORDEM_RESTRICOES.map(sigla=>MD_RESTRICOES.find(r=>r.sigla===sigla));
function mdRenderConfiguracoes(){
  const secoes = MD_DIMENSOES.map(dim=>{
    const valores = mdValoresConhecidos(dim.chave);
    if(!valores.length) return '';
    const headerCols = MD_RESTRICOES_CONFIG.map(r=>
      `<th title="${irEsc(r.sigla+' — '+r.nome)}">${mdRotuloColunaHtml(r.sigla)}</th>`
    ).join('');
    const linhas = valores.map(v=>{
      const regra = MD.regrasRascunho[dim.chave][v] || [];
      const cels = MD_RESTRICOES_CONFIG.map(r=>{
        const marcado = regra.includes(r.sigla);
        return `<td><input type="checkbox" ${marcado?'checked':''} data-chave="${irEsc(dim.chave)}" data-valor="${irEsc(v)}" data-sigla="${r.sigla}" onchange="mdSetRegra('${dim.chave}','${irEsc(v)}','${r.sigla}', this.checked)" onkeydown="mdConfigNav(event, this)"></td>`;
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
  const alterado = mdRascunhoAlterado();
  return `<div class="panel md-head" style="position:sticky; top:0; z-index:5; margin-bottom:14px;">
    <div>
      <strong>${alterado ? 'Há marcações não salvas' : 'Nada pendente de salvar'}</strong>
      <p class="field-hint" style="margin:4px 0 0;">
        Marcar/desmarcar aqui não muda nada ainda — só depois de clicar em "Salvar Configuração"
        o pareamento de múltiplos e os Ajustes/Auditoria de Restrição passam a usar a regra nova.
      </p>
    </div>
    <div class="md-chips">
      ${alterado ? `<button class="btn-link" onclick="mdDescartarRascunho()">Descartar alterações</button>` : ''}
      <button class="btn btn-primary" onclick="mdSalvarConfiguracao()" ${alterado ? '' : 'disabled'}>Salvar Configuração</button>
      <button class="chip" onclick="mdExportarConfiguracao()">Exportar configuração</button>
      <button class="chip" onclick="document.getElementById('mdImportarConfigInput').click()">Importar configuração</button>
      <input type="file" id="mdImportarConfigInput" accept=".json" style="display:none" onchange="mdImportarConfiguracao(this.files[0]); this.value='';">
    </div>
  </div>${secoes}`;
}
/* Configuração é só local (IndexedDB do navegador) — troca de pessoa, de
   navegador, ou cache limpo (ver conversa sobre apagar cache) perde tudo e
   obriga a remarcar do zero. Exportar/importar um arquivinho com as regras
   resolve isso sem precisar construir nada no servidor (não tem servidor). */
function mdExportarConfiguracao(){
  const payload = JSON.stringify({ versao: 1, clal: MD.regras.clal, x1: MD.regras.x1 }, null, 2);
  const blob = new Blob([payload], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'configuracao-restricao-multiplos-' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
  irShowToast('Configuração exportada.');
}
function mdImportarConfiguracao(file){
  if(!file) return;
  file.text().then(texto=>{
    let dados;
    try{ dados = JSON.parse(texto); }
    catch(e){ irShowToast('Arquivo inválido: não é um JSON de configuração.', true); return; }
    if(!dados || typeof dados !== 'object' || (!dados.clal && !dados.x1)){
      irShowToast('Arquivo inválido: não tem regras de classe nem de X1.', true);
      return;
    }
    // Cai no rascunho, igual uma marcação manual — só "Salvar Configuração"
    // promove pra valer de verdade (ver mdSetRegra/mdSalvarConfiguracao).
    MD.regrasRascunho = { clal: dados.clal || {}, x1: dados.x1 || {} };
    irRenderView();
    irShowToast('Configuração importada — clique em "Salvar Configuração" pra valer.');
  }).catch(()=>irShowToast('Erro ao ler o arquivo.', true));
}

/* ============================================================
   SHELL
   ============================================================ */
const MD_TELAS = {
  descasados:['Múltiplos Descasados','Componente sem par no estoque: dimensão, onde está e quanto vale.'],
  ajustes:['Ajustes de Restrição','Toda peça do CD com restrição fora da regra, por Classe e X1.'],
  auditoria:['Auditoria de Restrição','A mesma correção de Ajustes de Restrição, em lista por item e endereço.'],
  indicadores:['Indicadores','Panorama dos múltiplos descasados pra mostrar ao setor.'],
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
                 : MD.tela==='auditoria'     ? mdRenderAuditoria()
                 : MD.tela==='indicadores'   ? mdRenderIndicadores()
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
  MD.regrasRascunho = { clal: {...MD.regras.clal}, x1: {...MD.regras.x1} };
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
