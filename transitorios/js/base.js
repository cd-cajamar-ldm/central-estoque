/* ============================================================
   BASE DE TRANSITÓRIOS — aba de análise
   ============================================================
   Aba à parte de propósito: o report (tela Transitórios e o boletim por e-mail)
   não lê NADA daqui. Aqui é a lista inteira, um transitório por linha, com X1 e
   X2 em colunas separadas — pra olhar um a um, ordenar e filtrar por qualquer
   coluna sem mexer no que vai pros gestores.

   O de-para (sentido, setor, responsável e gestor) ainda não sai do WMS: até sair,
   ele mora aqui como lista fixa, que foi o que a operação conseguiu levantar.
   Transitório que aparece na base importada e não está na lista fica com traço
   nas colunas de cadastro — é o sinal de que falta cadastrar, não erro de leitura.
   Pra achar todos de uma vez, é só filtrar Sentido = "—".
   ============================================================ */
/* [chave (X1 + X2), sentido, setor, responsável, gestor] */
const IR_BASE_DEPARA = [
  ['AIR LOG','TRANSITORIO','CD','CONTROLE','BRUNO SOUZA'],
  ['ANE INB','VIRTUAL','CD','ESTOQUE','RUI'],
  ['ANE OUT','VIRTUAL','CD','ESTOQUE','EVERTON'],
  ['ANE TSF','VIRTUAL','CD','ESTOQUE','MARCELO'],
  ['ARI AVA','TRANSITORIO','CD','RECEBIMENTO','RUI'],
  ['ARI ELE','TRANSITORIO','CD','RECEBIMENTO','RUI'],
  ['ARI LIT','TRANSITORIO','CD','RECEBIMENTO','RUI'],
  ['ARI REC','TRANSITORIO','CD','RECEBIMENTO','RUI'],
  ['AVA EST','TRANSITORIO','CD','ESTOQUE','RUI'],
  ['AVA EXP','TRANSITORIO','CD','EXPEDIÇÃO','EVERTON'],
  ['AVA INB','TRANSITORIO','CD','ESTOQUE','RUI'],
  ['AVA OUT','TRANSITORIO','CD','PIC/PAC/EXP','EVERTON'],
  ['AVA LJM','TRANSITORIO','CD','ESTOQUE','GUSTAVO'],
  ['AVA PAC','TRANSITORIO','CD','PACKING','EVERTON'],
  ['AVA PIC','TRANSITORIO','CD','PICKING','EVERTON'],
  ['AVA REC','TRANSITORIO','CD','RECEBIMENTO','RUI'],
  ['AVA TRA','TRANSITORIO','CD','TRANSPORTE','NATALIA'],
  ['AVA TSF','TRANSITORIO','CD','TRANSFERENCIA','MARCELO'],
  ['CAN 001','TRANSITORIO','CD','ESTOQUE','RUI'],
  ['CAN MCL','TRANSITORIO','CD','MERCADO LIVRE','EVERTON'],
  ['CAN PAR','TRANSITORIO','CD','ESTOQUE','RUI'],
  ['CAN SAC','TRANSITORIO','CD','PACKING','EVERTON'],
  ['DEV 001','TRANSITORIO','CD','ESTOQUE','RUI'],
  ['DEV 002','TRANSITORIO','CD','ESTOQUE','RUI'],
  ['EPI ARM','TRANSITORIO','INSUMO','INSUMOS','NATALY'],
  ['INS REC','TRANSITORIO','CD','RECEBIMENTO','RUI'],
  ['LIT GIO','VIRTUAL','CD','TRANSFERENCIA','MARCELO'],
  ['MOV LOG','VIRTUAL','CD','ESTOQUE','RUI'],
  ['OPE AUX','VIRTUAL','CD','ESTOQUE','RUI'],
  ['OPE EMP','VIRTUAL','CD','ESTOQUE','RUI'],
  ['PAL LET','TRANSITORIO','INSUMO','INSUMOS','RUI'],
  ['QBR CD','TRANSITORIO','CD','REVENDA','BRUNO SOUZA'],
  ['QBR LIQ','TRANSITORIO','CD','REVENDA','BRUNO SOUZA'],
  ['REC INV','TRANSITORIO','REVERSA','REVERSA','WILLIAN'],
  ['REC STK','TRANSITORIO','CD','ESTOQUE','MARCELO'],
  ['RES SUP','TRANSITORIO','CD','ESTOQUE','MARCELO'],
  ['REV STK','TRANSITORIO','REVERSA','REVERSA','WILLIAN'],
  ['ROT ATI','TRANSITORIO','CD','ESTOQUE','BRUNO SOUZA'],
  ['SEG URO','TRANSITORIO','CD','ESTOQUE','RUI'],
  ['UMA 01','VIRTUAL','CD','ESTOQUE','RUI'],
  ['PER DAS','VIRTUAL','CD','ESTOQUE','CD'],
  ['NFS ETR','VIRTUAL','CD','ESTOQUE','CD'],
  ['RES FUL','TRANSITORIO','CD','ESTOQUE','CD'],
  ['REC ELV','TRANSITORIO','CD','ESTOQUE','CD'],
  ['REC LIT','TRANSITORIO','CD','ESTOQUE','CD'],
  ['REV LIT','TRANSITORIO','REVERSA','REVERSA','WILLIAN'],
  ['TRI AGE','TRANSITORIO','REVERSA','REVERSA','WILLIAN'],
  ['ARP REV','TRANSITORIO','REVERSA','REVERSA','WILLIAN'],
  ['PIC REV','TRANSITORIO','REVERSA','REVERSA','WILLIAN'],
  ['FAT REV','TRANSITORIO','REVERSA','REVERSA','WILLIAN'],
  ['REC PAR','TRANSITORIO','REVERSA','REVERSA','WILLIAN'],
  ['AEE 001','TRANSITORIO','CD','CONTROLE','BRUNO SOUZA'],
  ['AEE 002','TRANSITORIO','CD','CONTROLE','BRUNO SOUZA'],
  ['BCK LOG','TRANSITORIO','CD','ESTOQUE','RUI'],
  ['RML 00','TRANSITORIO','REVERSA','REVERSA','WILLIAN']
];
/* A chave do de-para é o X1 + X2 do WMS escrito com um espaço. A base importada
   nem sempre vem assim (espaço duplo, minúscula), então tudo passa por aqui antes
   de casar — senão "Ava Tsf" viraria transitório sem cadastro. */
function irBaseNorm(v){
  return String(v==null?'':v).normalize('NFD').replace(/[̀-ͯ]/g,'')
    .toUpperCase().replace(/\s+/g,' ').trim();
}
function irBaseDeParaMapa(){
  if(IR._baseDeParaMapa) return IR._baseDeParaMapa;
  const m = new Map();
  for(const [chave, sentido, setor, responsavel, gestor] of IR_BASE_DEPARA){
    m.set(irBaseNorm(chave), {sentido, setor, responsavel, gestor});
  }
  IR._baseDeParaMapa = m;
  return m;
}

const IR_BASE_COLS = [
  {key:'x1',          lbl:'X1',            tipo:'txt'},
  {key:'x2',          lbl:'X2',            tipo:'txt'},
  {key:'nome',        lbl:'Descrição',     tipo:'txt'},
  {key:'sentido',     lbl:'Sentido',       tipo:'opc'},
  {key:'setor',       lbl:'Setor',         tipo:'opc'},
  {key:'responsavel', lbl:'Responsável',   tipo:'opc'},
  {key:'gestor',      lbl:'Gestor',        tipo:'opc'},
  {key:'clal',        lbl:'Classe WMS',    tipo:'opc'},
  {key:'setorReport', lbl:'Setor no report', tipo:'opc'},
  {key:'situacao',    lbl:'Situação',      tipo:'opc'},
  {key:'nEnd',        lbl:'Endereços',     tipo:'num', fmt:irFmtInt},
  {key:'qtd',         lbl:'Peças',         tipo:'num', fmt:irFmtInt},
  {key:'valor',       lbl:'Valor',         tipo:'num', fmt:irFmtMoney},
  {key:'idade',       lbl:'Idade máx (d)', tipo:'num', fmt:n=>irFmtInt(n)}
];
const IR_BASE_SITUACOES = {comSaldo:'Com saldo', semSaldo:'Sem saldo', foraDaBase:'Fora da base'};

/* Uma linha por transitório: o que a base importada tem, mais o que está no
   de-para e não apareceu na importação (esse entra zerado, como "Fora da base" —
   some da tela seria o mesmo que não conferir). */
function irBaseLinhas(){
  const hoje = Date.parse(new Date().toISOString().slice(0,10)+'T00:00:00');
  const temData = irTransTemData();
  const dePara = irBaseDeParaMapa();
  const porChave = new Map();
  const novo = (chave, x1, x2) => ({
    chave, x1, x2, nome:irTransNome(chave), clalSet:new Set(), setorSet:new Set(),
    nEnd:0, qtd:0, valor:0, idade:null
  });
  for(const l of (IR.est390Locais||[])){
    const chave = irTransChave(l);
    const k = irBaseNorm(chave);
    if(!porChave.has(k)) porChave.set(k, novo(chave, String(l.x1||'').trim(), String(l.x2||'').trim()));
    const r = porChave.get(k);
    if(l.clal) r.clalSet.add(String(l.clal).trim());
    r.setorSet.add(irTransSetorDe(l) || '');
    if(!l.qtd && !l.valor) continue;
    r.nEnd++; r.qtd += l.qtd; r.valor += l.valor;
    if(temData) for(const dia in (l.porDia||{})){
      if(!l.porDia[dia]) continue;
      const d = Math.max(0, Math.round((hoje - Date.parse(dia+'T00:00:00')) / 86400000));
      if(r.idade===null || d>r.idade) r.idade = d;
    }
  }
  // O que está no de-para e a importação não trouxe: entra zerado pra ser conferido.
  for(const chave of dePara.keys()){
    if(porChave.has(chave)) continue;
    const partes = chave.split(' ');
    porChave.set(chave, novo(chave, partes[0]||'', partes.slice(1).join(' ')));
  }
  return Array.from(porChave.values()).map(r=>{
    const cad = dePara.get(irBaseNorm(r.chave)) || {};
    const setores = Array.from(r.setorSet).filter(Boolean)
      .map(s=>IR_TRANS_SETOR_NOME[s]||s).sort();
    return {
      chave:r.chave, x1:r.x1, x2:r.x2, nome:r.nome,
      sentido: cad.sentido || '—', setor: cad.setor || '—',
      responsavel: cad.responsavel || '—', gestor: cad.gestor || '—',
      clal: Array.from(r.clalSet).sort().join(', ') || '—',
      setorReport: setores.join(', ') || (r.setorSet.size ? 'Não classificado' : '—'),
      situacao: (r.qtd || r.valor) ? IR_BASE_SITUACOES.comSaldo
        : (r.setorSet.size ? IR_BASE_SITUACOES.semSaldo : IR_BASE_SITUACOES.foraDaBase),
      nEnd:r.nEnd, qtd:r.qtd, valor:r.valor, idade:r.idade
    };
  });
}
function irBaseFiltrar(linhas){
  const f = IR.baseFiltros || {};
  return linhas.filter(r=>{
    for(const c of IR_BASE_COLS){
      const v = f[c.key];
      if(v===undefined || v===null || v==='') continue;
      if(c.tipo==='num'){
        const min = Number(String(v).replace(',', '.'));
        if(!isNaN(min) && !(Number(r[c.key]||0) >= min)) return false;
      }else if(c.tipo==='opc'){
        if(String(r[c.key]) !== String(v)) return false;
      }else if(!irBaseNorm(r[c.key]).includes(irBaseNorm(v))) return false;
    }
    return true;
  });
}
function irBaseOrdenar(linhas){
  const s = IR.baseSort || {col:'valor', dir:'desc'};
  const col = IR_BASE_COLS.find(c=>c.key===s.col) || IR_BASE_COLS[0];
  const dir = s.dir==='desc' ? -1 : 1;
  return linhas.slice().sort((a,b)=>{
    if(col.tipo==='num'){
      // Sem valor (idade de quem não tem data) fica sempre no fim da ordenação.
      const x = a[col.key]==null ? -1 : Number(a[col.key]||0);
      const y = b[col.key]==null ? -1 : Number(b[col.key]||0);
      if(x!==y) return dir*(x-y);
    }else{
      const c = String(a[col.key]||'').localeCompare(String(b[col.key]||''), 'pt-BR');
      if(c) return dir*c;
    }
    return String(a.chave).localeCompare(String(b.chave), 'pt-BR');
  });
}
function irBaseSort(col){
  const s = IR.baseSort || {col:'valor', dir:'desc'};
  // Coluna de texto começa em A-Z; número começa do maior, que é o que se procura.
  const tipo = (IR_BASE_COLS.find(c=>c.key===col)||{}).tipo;
  IR.baseSort = (s.col===col) ? {col, dir: s.dir==='desc'?'asc':'desc'}
    : {col, dir: tipo==='num' ? 'desc' : 'asc'};
  irBaseRedesenhar();
}
function irBaseSetFiltro(col, valor){
  IR.baseFiltros = Object.assign({}, IR.baseFiltros||{}, {[col]: valor});
  irBaseRedesenhar();
}
function irBaseLimparFiltros(){
  IR.baseFiltros = {};
  irRenderView();
}
function irBaseTemFiltro(){
  const f = IR.baseFiltros || {};
  return Object.keys(f).some(k=>f[k]!==undefined && f[k]!==null && f[k]!=='');
}

function irBaseCel(c, r){
  const v = r[c.key];
  if(c.tipo==='num') return v===null || v===undefined ? '—' : c.fmt(v);
  return irEsc(v||'—');
}
function irBaseCorpo(linhas){
  if(!linhas.length) return `<tr><td colspan="${IR_BASE_COLS.length}" class="bt-vazio">Nenhum transitório com esse filtro.</td></tr>`;
  return linhas.map(r=>`<tr>${IR_BASE_COLS.map(c=>{
    const classe = c.tipo==='num' ? 'mono' : (c.key==='x1'||c.key==='x2' ? 'bt-cod' : '');
    const semCad = c.key==='sentido' && r.sentido==='—';
    return `<td class="${classe}${semCad?' bt-sem-cad':''}">${irBaseCel(c, r)}</td>`;
  }).join('')}</tr>`).join('');
}
function irBaseRodape(linhas){
  const t = linhas.reduce((s,r)=>({nEnd:s.nEnd+r.nEnd, qtd:s.qtd+r.qtd, valor:s.valor+r.valor}), {nEnd:0, qtd:0, valor:0});
  return `<tr>
    <td colspan="10"><strong>Total${irBaseTemFiltro()?' (filtrado)':''}</strong></td>
    <td class="mono"><strong>${irFmtInt(t.nEnd)}</strong></td>
    <td class="mono"><strong>${irFmtInt(t.qtd)}</strong></td>
    <td class="mono"><strong>${irFmtMoney(t.valor)}</strong></td>
    <td class="mono">—</td>
  </tr>`;
}
function irBaseResumo(linhas){
  const semCad = linhas.filter(r=>r.sentido==='—').length;
  const comSaldo = linhas.filter(r=>r.situacao===IR_BASE_SITUACOES.comSaldo).length;
  const cell = (rot, val, sub) => `<div class="ofe-num"><span class="ofe-num-lbl">${irEsc(rot)}</span>
    <strong class="mono">${val}</strong><span class="ofe-num-sub">${irEsc(sub)}</span></div>`;
  return cell('Transitórios', irFmtInt(linhas.length), comSaldo+' com saldo hoje')
    + cell('Peças paradas', irFmtInt(linhas.reduce((s,r)=>s+r.qtd,0)), irFmtInt(linhas.reduce((s,r)=>s+r.nEnd,0))+' endereços')
    + cell('Valor parado', irFmtMoney(linhas.reduce((s,r)=>s+r.valor,0)), 'soma das linhas em tela')
    + cell('Sem cadastro', irFmtInt(semCad), semCad ? 'fora do de-para' : 'todos no de-para');
}
// Redesenha só o miolo: o cabeçalho (com os campos de filtro) fica de pé, senão o
// campo perdia o foco a cada letra digitada.
function irBaseRedesenhar(){
  const linhas = irBaseOrdenar(irBaseFiltrar(irBaseLinhas()));
  const corpo = document.getElementById('btCorpo');
  const rodape = document.getElementById('btRodape');
  const resumo = document.getElementById('btResumo');
  if(corpo) corpo.innerHTML = irBaseCorpo(linhas);
  if(rodape) rodape.innerHTML = irBaseRodape(linhas);
  if(resumo) resumo.innerHTML = irBaseResumo(linhas);
  const s = IR.baseSort || {col:'valor', dir:'desc'};
  document.querySelectorAll('.bt-th-lbl[data-col]').forEach(el=>{
    const c = IR_BASE_COLS.find(x=>x.key===el.dataset.col) || {};
    el.textContent = (c.lbl||'') + (s.col===c.key ? (s.dir==='desc'?' ▼':' ▲') : '');
  });
  const lim = document.getElementById('btLimpar');
  if(lim) lim.hidden = !irBaseTemFiltro();
}
function irBaseBaixarCSV(){
  const linhas = irBaseOrdenar(irBaseFiltrar(irBaseLinhas()));
  const val = (c, r) => {
    const v = r[c.key];
    if(c.tipo!=='num') return String(v||'');
    if(v===null || v===undefined) return '';
    // Ponto-e-vírgula e vírgula decimal: é assim que o Excel em pt-BR abre sem pedir nada.
    return String(v).replace('.', ',');
  };
  const csv = [IR_BASE_COLS.map(c=>c.lbl).join(';')]
    .concat(linhas.map(r=>IR_BASE_COLS.map(c=>val(c, r)).join(';'))).join('\r\n');
  const blob = new Blob(['﻿'+csv], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'base-transitorios-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function irBaseCabecalho(todas){
  const s = IR.baseSort || {col:'valor', dir:'desc'};
  const f = IR.baseFiltros || {};
  return IR_BASE_COLS.map(c=>{
    const seta = s.col===c.key ? (s.dir==='desc'?' ▼':' ▲') : '';
    let campo;
    if(c.tipo==='opc'){
      const vistos = Array.from(new Set(todas.map(r=>String(r[c.key]||'—')))).sort((a,b)=>a.localeCompare(b,'pt-BR'));
      campo = `<select class="bt-f" onchange="irBaseSetFiltro('${c.key}', this.value)">
        <option value="">Todos</option>
        ${vistos.map(v=>`<option value="${irEsc(v)}"${f[c.key]===v?' selected':''}>${irEsc(v)}</option>`).join('')}
      </select>`;
    }else if(c.tipo==='num'){
      campo = `<input class="bt-f" type="number" inputmode="numeric" placeholder="mín." value="${irEsc(f[c.key]||'')}"
        oninput="irBaseSetFiltro('${c.key}', this.value)">`;
    }else{
      campo = `<input class="bt-f" type="search" placeholder="filtrar" value="${irEsc(f[c.key]||'')}"
        oninput="irBaseSetFiltro('${c.key}', this.value)">`;
    }
    return `<th class="bt-th${c.tipo==='num'?' num':''}">
      <span class="bt-th-lbl" data-col="${c.key}" title="Clique para ordenar" onclick="irBaseSort('${c.key}')">${irEsc(c.lbl)}${seta}</span>
      ${campo}</th>`;
  }).join('');
}
function irRenderBaseTransitorios(){
  if(!IR.est390Locais){ irCarregarEstoque390(); return irDivCarregando(); }
  if(!IR.est390Locais.length){
    return irEmptyState('Sem estoque importado',
      'Importe a QRY0390 (ficha dos itens) e depois a QRY0160 (saldo com data de movimento) na aba Importação.',
      "irSwitchTab('importacao')", 'Ir para Importação');
  }
  const todas = irBaseLinhas();
  const linhas = irBaseOrdenar(irBaseFiltrar(todas));
  return `<div class="panel">
    <div class="ofe-head">
      <h3>Base de transitórios</h3>
      <div class="ofe-acoes">
        <button class="btn-link" id="btLimpar" onclick="irBaseLimparFiltros()"${irBaseTemFiltro()?'':' hidden'}>Limpar filtros</button>
        <button class="btn btn-secondary" onclick="irBaseBaixarCSV()">Baixar CSV</button>
      </div>
    </div>
    <div class="ofe-resumo" id="btResumo">${irBaseResumo(linhas)}</div>
    <p class="field-hint">Clique no título da coluna para ordenar; o campo abaixo do título filtra aquela coluna.
    Esta aba é só de consulta — ela não entra no report por setor nem no boletim por e-mail.
    ${irTransTemData() ? '' : 'A idade máxima só aparece com a QRY0160 importada.'}</p>
    <div class="table-wrap"><div class="table-scroll" style="max-height:min(68vh,760px);">
      <table class="bt-table">
        <thead><tr>${irBaseCabecalho(todas)}</tr></thead>
        <tbody id="btCorpo">${irBaseCorpo(linhas)}</tbody>
        <tfoot id="btRodape">${irBaseRodape(linhas)}</tfoot>
      </table>
    </div></div>
  </div>`;
}
