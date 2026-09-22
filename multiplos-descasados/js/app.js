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
  equalizado:'nao',     // 'todos' | 'sim' (já casado) | 'nao' (precisa de ajuste)
  busca:'',
  ordem:'valor',
  pivotExpandido:new Set(),
  tela:'descasados',
  regrasClasse:{},        // classe (CLAL) -> [siglas de restrição permitidas]
  classesSelecionadas:null, // null = todas; Set() = só as marcadas
  f051:null, f390:null, f278:null,
  proc:{'051':false,'390':false,'278':false},
  progresso:{'051':{stage:'',pct:0},'390':{stage:'',pct:0},'278':{stage:'',pct:0}},
  initErro:null,
  _cache:null, _cacheBase:null, _plano:null, _planoBase:null
};

const MD_ZOOM_MIN = 70, MD_ZOOM_MAX = 150, MD_ZOOM_STEP = 10;

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
  const ordens = {
    valor: (a,b)=>b.sobraValor - a.sobraValor || acoes(b) - acoes(a),
    pecas: (a,b)=>acoes(b) - acoes(a) || b.sobraValor - a.sobraValor,
    completos: (a,b)=>a.completos - b.completos || b.sobraValor - a.sobraValor,
    item: (a,b)=>a.pai.localeCompare(b.pai)
  };
  return lista.slice().sort(ordens[MD.ordem] || ordens.valor);
}

/* ============================================================
   TELA — DESCASADOS
   ============================================================ */
function mdTemDados(){ return !!(MD.estrutura && MD.estrutura.length && MD.saldos && MD.saldos.length); }

function mdSetBase(base){ MD.base = base; mdInvalidarCache(); irRenderView(); }
function mdSetOrdem(o){ MD.ordem = o; irRenderView(); }
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
  </div>` + mdAvisoPreco(resumo);
}

/* O valor da tela só é o valor de verdade se as peças descasadas tiverem preço.
   Hoje a QRY0390 traz VALOR_UNITARIO zerado na quase totalidade dos componentes
   de múltiplo — sem a SIGEQ278, o total sai muito abaixo do real. Em vez de
   esconder o número atrás de um travessão (que some com os R$ que EXISTEM), a
   tela mostra o total e diz, com número, o quanto dele não pôde ser valorado. */
function mdAvisoPreco(resumo){
  if(!resumo.componentesSemPreco) return '';
  const semBase = !(MD.precos && MD.precos.length);
  return `<div class="panel md-aviso">
    <strong>${irFmtInt(resumo.componentesSemPreco)}</strong> dos ${irFmtInt(resumo.componentesComSobra)} componentes descasados estão sem preço${semBase ? '' : ' mesmo com a SIGEQ278 importada'} —
    o valor acima é o piso, não o total. ${semBase ? 'Importe a SIGEQ278 para valorar pelo preço de custo do item pai.' : ''}
  </div>`;
}

function mdBarraFiltros(){
  const chip = (ativo, onclick, texto)=>`<button class="chip ${ativo?'active':''}" onclick="${onclick}">${irEsc(texto)}</button>`;
  return `<div class="panel">
    <div class="md-filtros">
      <input id="mdBusca" class="md-busca" type="search" placeholder="Buscar item pai, componente ou descrição..."
             value="${irEsc(MD.busca)}" oninput="mdBuscar(this.value)">
      <div class="md-chips">
        ${chip(MD.base==='qtde', "mdSetBase('qtde')", 'Estoque total')}
        ${chip(MD.base==='qtdeDisp', "mdSetBase('qtdeDisp')", 'Só disponível')}
      </div>
      <div class="md-chips">
        ${chip(MD.equalizado==='todos', "mdSetEqualizado('todos')", 'Equalizado: Todos')}
        ${chip(MD.equalizado==='sim', "mdSetEqualizado('sim')", 'Equalizado: Sim')}
        ${chip(MD.equalizado==='nao', "mdSetEqualizado('nao')", 'Equalizado: Não')}
      </div>
      <div class="md-chips">
        ${chip(MD.ordem==='valor', "mdSetOrdem('valor')", 'Por valor')}
        ${chip(MD.ordem==='pecas', "mdSetOrdem('pecas')", 'Por peças')}
        ${chip(MD.ordem==='completos', "mdSetOrdem('completos')", 'Menos completos')}
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
    return `<th class="${cls}" title="${irEsc(mdCodRestricao(s)+' — '+mdNomeRestricao(s))}">${irEsc(mdCodRestricao(s))}</th>`;
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
/* Matriz classe local (CLAL) × restrição, no mesmo espírito da matriz que o
   usuário usa no PuTTY (linhas = classe, colunas = restrição, valor =
   quantidade) — só que aqui é o recorte deste módulo: só os componentes de
   múltiplo, não o estoque vendável inteiro. A tabela linha a linha (endereço
   por endereço, pronta pra colar no coletor) fica só na planilha exportada —
   aqui é só a visão gerencial. */
function mdMatrizClasses(){
  const campo = MD.base==='qtdeDisp' ? 'qtdeDisp' : 'qtde';
  const porClasse = new Map();
  for(const s of (MD.saldos||[])){
    for(const loc of (s.locais||[])){
      const v = loc[campo] || 0;
      if(!v) continue;
      const classe = loc.clal || '—';
      if(!porClasse.has(classe)) porClasse.set(classe, {});
      const bucket = porClasse.get(classe);
      bucket[loc.restricao] = (bucket[loc.restricao] || 0) + v;
    }
  }
  return porClasse;
}

/* Restrição fora da regra configurada em Configurações (Configurações →
   Restrições permitidas por classe). Sem regra salva pra essa classe, não dá
   pra dizer se está certo ou errado — não valida. */
function mdRestricaoPermitida(classe, sigla){
  const regra = MD.regrasClasse && MD.regrasClasse[classe];
  if(!regra || !regra.length) return true;
  return regra.includes(sigla);
}

function mdClasseMarcada(classe){
  return MD.classesSelecionadas === null || MD.classesSelecionadas.has(classe);
}
function mdToggleClasse(classe){
  if(MD.classesSelecionadas === null) MD.classesSelecionadas = new Set(mdMatrizClasses().keys());
  if(MD.classesSelecionadas.has(classe)) MD.classesSelecionadas.delete(classe);
  else MD.classesSelecionadas.add(classe);
  irRenderView();
}
function mdMarcarTodasClasses(){ MD.classesSelecionadas = null; irRenderView(); }
function mdDesmarcarTodasClasses(){ MD.classesSelecionadas = new Set(); irRenderView(); }

function mdRenderMatrizClasses(){
  const porClasse = mdMatrizClasses();
  const restricoes = mdRestricoesPresentes();
  const totalDe = c => Object.values(porClasse.get(c)).reduce((a,v)=>a+v, 0);
  const termo = MD.busca.trim().toLowerCase();
  let classes = Array.from(porClasse.keys());
  if(termo) classes = classes.filter(c=>c.toLowerCase().includes(termo));
  classes.sort((a,b)=>totalDe(b)-totalDe(a));

  if(!classes.length){
    return { html: `<div class="panel"><p class="field-hint">Nenhuma classe bate com o filtro atual.</p></div>`, classesComErro: 0 };
  }

  const headerCols = restricoes.map(s=>{
    const cls = s===MD_SIGLA_VENDAVEL ? 'md-col-wn' : (s===MD_SIGLA_BLOQUEIO ? 'md-col-86' : '');
    return `<th class="${cls}" title="${irEsc(mdCodRestricao(s)+' — '+mdNomeRestricao(s))}">${irEsc(mdCodRestricao(s))}</th>`;
  }).join('');

  const totalPorRestricao = {};
  for(const s of restricoes) totalPorRestricao[s] = 0;
  let totalGeral = 0, classesComErro = 0;

  const linhas = classes.map(c=>{
    const bucket = porClasse.get(c);
    let temErro = false;
    const cels = restricoes.map(s=>{
      const v = bucket[s] || 0;
      totalPorRestricao[s] += v;
      const erro = v > 0 && !mdRestricaoPermitida(c, s);
      if(erro) temErro = true;
      const cls = erro ? 'md-cel-erro' : (s===MD_SIGLA_VENDAVEL ? 'md-col-wn' : (s===MD_SIGLA_BLOQUEIO ? 'md-col-86' : ''));
      const titulo = erro ? ` title="${irEsc('Restrição '+mdCodRestricao(s)+' ('+s+') não está nas restrições permitidas de '+c+' — configure em Configurações')}"` : '';
      return `<td class="${cls}"${titulo}>${v ? irFmtInt(v) : ''}</td>`;
    }).join('');
    if(temErro) classesComErro++;
    const total = totalDe(c);
    totalGeral += total;
    const marcado = mdClasseMarcada(c);
    return `<tr>
      <td class="md-piv-check"><input type="checkbox" ${marcado?'checked':''} onchange="mdToggleClasse('${irEsc(c)}')"></td>
      <td class="md-left mono">${irEsc(c)}</td>${cels}<td class="md-piv-total">${irFmtInt(total)}</td>
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
        <th></th>
        <th class="md-left">Classe</th>
        ${headerCols}
        <th class="md-piv-total">Total Geral</th>
      </tr></thead>
      <tbody>${linhas}${rodape}</tbody>
    </table>
  </div>`;
  return { html, classesComErro };
}

function mdRenderAjustes(){
  if(!mdTemDados()){
    return irEmptyState('Sem bases importadas', 'Importe a ZBIQ0051 e a QRY0390 para montar o plano de ajuste.', "irSwitchTab('importacao')", 'Ir para a importação');
  }
  const chip = (ativo, onclick, texto)=>`<button class="chip ${ativo?'active':''}" onclick="${onclick}">${irEsc(texto)}</button>`;
  const plano = mdPlano();
  const bloquear = plano.filter(l=>l.sentido==='bloquear').reduce((a,l)=>a+l.quantidade, 0);
  const liberar = plano.filter(l=>l.sentido==='liberar').reduce((a,l)=>a+l.quantidade, 0);
  const semEndereco = plano.filter(l=>l.semEndereco).length;
  const matriz = mdRenderMatrizClasses();

  return `<div class="panel">
    <div class="md-head">
      <h3>Restrição por classe</h3>
      <div class="md-piv-acoes">
        <button class="btn-link" onclick="mdMarcarTodasClasses()">Marcar todas</button>
        <button class="btn-link" onclick="mdDesmarcarTodasClasses()">Desmarcar todas</button>
        <button class="btn btn-primary" onclick="mdExportarAjusteClasses()">Baixar relatório de ajuste</button>
      </div>
    </div>
    <div class="md-filtros">
      <input id="mdBusca" class="md-busca" type="search" placeholder="Buscar classe..."
             value="${irEsc(MD.busca)}" oninput="mdBuscar(this.value)">
      <div class="md-chips">
        ${chip(MD.base==='qtde', "mdSetBase('qtde')", 'Estoque total')}
        ${chip(MD.base==='qtdeDisp', "mdSetBase('qtdeDisp')", 'Só disponível')}
      </div>
    </div>
    <p class="field-hint">
      ${plano.length
        ? `${irFmtInt(bloquear)} peças a bloquear (0 → 86) e ${irFmtInt(liberar)} a liberar (86 → 0) — a planilha traz isso endereço por endereço, pronta pro coletor (tela 12.MOVI), só das classes marcadas.`
        : `Nenhum múltiplo precisa de ajuste na base ${MD.base==='qtdeDisp'?'disponível':'total'} agora.`}
      ${semEndereco ? ` <strong class="neg">${irFmtInt(semEndereco)} linha(s) sem endereço</strong> na planilha: o saldo da restrição não fechou com a soma dos endereços na 390.` : ''}
      ${matriz.classesComErro ? ` <strong class="neg">${irFmtInt(matriz.classesComErro)} classe(s)</strong> com restrição fora da regra configurada — célula em vermelho.` : ''}
    </p>
    ${matriz.html}
  </div>`;
}

/* Descasados: respeita a busca, o base (total/disponível) e o filtro
   Equalizado da tela — exporta só o que está sendo mostrado ali. */
function mdExportarAjustePivot(){
  mdGerarCsvAjuste(mdPlanoAjuste(mdPaisFiltrados(), MD.base));
}
/* Ajustes: respeita as classes marcadas na matriz (checkbox por linha). */
function mdExportarAjusteClasses(){
  mdGerarCsvAjuste(mdPlano().filter(l=>mdClasseMarcada(l.clal)));
}

function mdGerarCsvAjuste(lista){
  if(!lista.length){ irShowToast('Não há ajuste para exportar.'); return; }
  // As quatro primeiras colunas são, na ordem, o que se digita no coletor:
  // local (5000+id), restrição de origem, restrição de destino e quantidade.
  // O resto é conferência, e fica depois justamente pra não atrapalhar quem
  // copia a faixa e cola.
  const cab = ['Local (coletor)','EAN','Orig','Dest','Qtde',
    'Sentido','Sigla origem','Sigla destino','Item pai','Descrição do pai','Componente','Descrição',
    'Carrega valor','Por múltiplo','Saldo WN','Saldo 86','Alvo WN','Múltiplos vendáveis','Múltiplos possíveis',
    'Id do local','Endereço','Prédio','Saldo no endereço','Preço unitário','Valor'];
  const cel = v=>{
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  };
  const num = n=>String((n||0).toFixed(2)).replace('.', ',');
  const linhas = lista.map(l=>[
    l.localColetor, l.ean, l.codDe, l.codPara, irFmtInt(l.quantidade),
    l.sentido==='bloquear' ? 'Bloquear' : 'Liberar', l.de, l.para,
    l.pai, l.nomePai, l.componente, l.nome,
    l.inInterface==='S' ? 'Sim' : 'Não', irFmtInt(l.qtdePorMultiplo),
    irFmtInt(l.wn), irFmtInt(l.bloqueado), irFmtInt(l.alvoWn),
    irFmtInt(l.completos), irFmtInt(l.completosPotencial),
    l.local, l.endereco, l.predio, irFmtInt(l.saldoLocal),
    num(l.preco), num(l.valor)
  ].map(cel).join(';'));
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
   Regra por classe local (CLAL): quais restrições podem existir ali. É a
   base da validação da matriz em Ajustes de Restrição — sem marcar nada pra
   uma classe, ela não é validada (não dá pra saber o que é errado sem
   regra). Persistido no banco do módulo (config), não se perde ao reimportar. */
function mdClassesConhecidas(){
  const set = new Set();
  for(const s of (MD.saldos||[])) for(const loc of (s.locais||[])) if(loc.clal) set.add(loc.clal);
  for(const c in (MD.regrasClasse||{})) set.add(c);
  return Array.from(set).sort();
}
function mdSetRegraClasse(classe, sigla, permitido){
  if(!MD.regrasClasse) MD.regrasClasse = {};
  const atual = new Set(MD.regrasClasse[classe] || []);
  if(permitido) atual.add(sigla); else atual.delete(sigla);
  MD.regrasClasse[classe] = Array.from(atual);
  mdSetConfig('regras-classe', MD.regrasClasse);
  irRenderView();
}
function mdRenderConfiguracoes(){
  const classes = mdClassesConhecidas();
  if(!classes.length){
    return irEmptyState('Sem classes ainda', 'Importe a QRY0390 para ver as classes de local (CLAL) dos componentes de múltiplo.', "irSwitchTab('importacao')", 'Ir para a importação');
  }
  const headerCols = MD_RESTRICOES.map(r=>
    `<th title="${irEsc(r.sigla+' — '+r.nome)}">${irEsc(r.cod)}</th>`
  ).join('');
  const linhas = classes.map(c=>{
    const regra = MD.regrasClasse[c] || [];
    const cels = MD_RESTRICOES.map(r=>{
      const marcado = regra.includes(r.sigla);
      return `<td><input type="checkbox" ${marcado?'checked':''} onchange="mdSetRegraClasse('${irEsc(c)}','${r.sigla}', this.checked)"></td>`;
    }).join('');
    return `<tr><td class="md-left mono">${irEsc(c)}</td>${cels}</tr>`;
  }).join('');
  return `<div class="panel">
    <div class="md-head"><h3>Restrições permitidas por classe</h3></div>
    <p class="field-hint">
      Marque, por classe local (CLAL), quais restrições podem existir ali. O que uma classe tiver fora
      disso aparece em vermelho na matriz da aba Ajustes de Restrição. Classe sem nenhuma marcação não é validada.
    </p>
    <div class="md-piv-wrap">
      <table class="md-piv md-config-table">
        <thead><tr><th class="md-left">Classe</th>${headerCols}</tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
  </div>`;
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
function irRenderView(){
  const raiz = document.getElementById('viewRoot');
  if(!raiz) return;
  if(MD.initErro){
    raiz.innerHTML = irEmptyState('Não consegui abrir o banco do navegador', MD.initErro, null, null);
    return;
  }
  raiz.innerHTML = MD.tela==='importacao'    ? mdRenderImportacao()
                 : MD.tela==='ajustes'       ? mdRenderAjustes()
                 : MD.tela==='configuracoes' ? mdRenderConfiguracoes()
                 : mdRenderDescasados();
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
  MD.regrasClasse = (await mdGetConfig('regras-classe')) || {};
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
  if(versao) versao.textContent = MD_APP_VERSION;
  try{
    await mdRecarregar();
  }catch(e){
    console.error('Falha ao iniciar', e);
    MD.initErro = (e && (e.name ? e.name+': '+e.message : e.message)) || String(e);
  }
  irRenderView();
}
