/* ============================================================
   Inventário Rotativo — Regras e fórmulas compartilhadas
   (usado tanto pelo Web Worker quanto pela UI principal)
   ============================================================ */
const IR_META_ACURACIA = 0.97;

const IR_STATUS_LOCAL = {
  nao_iniciado:        {label:'Não iniciado',            cor:'#6B7280'},
  em_contagem:         {label:'Em contagem',              cor:'#FA4616'},
  convergido:          {label:'Convergido',               cor:'#1F8A52'},
  encerrado_sem_convergencia: {label:'Encerrado sem convergência (5ª rodada)', cor:'#C83812'}
};

// Legenda de motivos da QRY410 (Perdas e Ganhos no CD) — define quem entra no cálculo
// de NET. Códigos que não aparecerem aqui contam como SIM por padrão (regra do usuário:
// "o que não tiver na legenda, pode considerar"). Ordenados do mais específico (2
// palavras) pro mais genérico, pra "ARI LOT" não ser confundido com "ARI". Isso aqui é
// só a SEMENTE/padrão de fábrica — a lista de verdade fica no IndexedDB
// (net410_legenda), editável em Configurações, pra não precisar mexer em código toda
// vez que aparecer um motivo novo ou a classificação mudar.
const IR_410_LEGENDA = [
  {id:'ARI LOT', legenda:'Ajuste de Lote', considerarNet:true},
  {id:'INS', legenda:'Baixa Insumo', considerarNet:false},
  {id:'AIR', legenda:'Inventário Rotativo', considerarNet:true},
  {id:'TID', legenda:'Troca de Identidade', considerarNet:true},
  {id:'AIN', legenda:'Não Localizado', considerarNet:true},
  {id:'INV', legenda:'Inversão de etiqueta', considerarNet:true},
  {id:'ANF', legenda:'Nota Fiscal', considerarNet:false},
  {id:'PAR', legenda:'Recebimento Parcial', considerarNet:true},
  {id:'ARI', legenda:'Recebimento invertido', considerarNet:true},
  {id:'API', legenda:'Ajuste MCL Reversa', considerarNet:true},
  {id:'AEE', legenda:'Itens Localizados', considerarNet:true},
  {id:'LOJA', legenda:'Ajuste Loja', considerarNet:true},
  {id:'QBR', legenda:'Quebra CD', considerarNet:false},
  {id:'EPI', legenda:'Baixa EPI', considerarNet:false},
  {id:'IMP', legenda:'Ajuste Importação', considerarNet:true},
  {id:'ASR', legenda:'Sobra Recebimento', considerarNet:true},
  {id:'BAI', legenda:'Baixa Insumo', considerarNet:false},
  {id:'INP', legenda:'Ajuste Pallets', considerarNet:false},
  {id:'LIT', legenda:'Ajuste Litigio', considerarNet:true},
  {id:'AUD', legenda:'Auditoria KPMG', considerarNet:true},
  {id:'AIP', legenda:'Inventário Pontual', considerarNet:true},
  {id:'ADE', legenda:'Auditorias', considerarNet:true},
  {id:'AIC', legenda:'Inventário de Curvas', considerarNet:true},
  {id:'AIT', legenda:'Inventario de Transitorios', considerarNet:true},
  {id:'AII', legenda:'Inventário de Insumos', considerarNet:false}
];
// legendaList opcional = a lista editável do usuário (carregada do IndexedDB); sem
// ela, cai no padrão de fábrica (IR_410_LEGENDA) — mantém retrocompatibilidade com
// qualquer chamada antiga que não passe o segundo argumento.
function irLegenda410(id, legendaList){
  if(id==='(sem observação)') return 'Sem observação';
  const lista = legendaList || IR_410_LEGENDA;
  const item = lista.find(l=>l.id===id);
  return item ? item.legenda : id;
}
// Mesma lógica de "match" usada em classificar410 (worker.js), mas parametrizada pela
// lista de legenda — pra rodar tanto com a lista padrão quanto com a editada pelo
// usuário em Configurações.
function irClassificarMotivo410(obsWmsRaw, legendaList){
  const texto = String(obsWmsRaw||'').trim().toUpperCase();
  const lista = legendaList || IR_410_LEGENDA;
  if(!texto) return {id:'(sem observação)', legenda:'', considerarNet:true};
  for(const item of lista){
    if(texto===item.id || texto.startsWith(item.id+' ') || texto.startsWith(item.id+'-')){
      return {id:item.id, legenda:item.legenda, considerarNet:item.considerarNet};
    }
  }
  const codigo = (texto.split(/[\s-]/)[0]||texto.slice(0,10)).trim();
  return {id:codigo||'(sem observação)', legenda:'', considerarNet:true};
}

/* Dias úteis até o fim do ciclo — feriados nacionais + estado de SP + município de
   Cajamar (sede do CD). "Dias Restantes" antes era baseado no ritmo médio de
   contagem, que cai perto do fim do ciclo (menos locais sobrando pra dividir entre
   a equipe) e fazia a métrica piorar sem motivo real — trocado por uma contagem
   fixa de dias úteis até a data prevista de término, sem depender do ritmo.
   Só considera feriados oficiais (não pontos facultativos, que não são fechamento
   obrigatório do CD).
   Fontes: Prefeitura de Cajamar (cajamar.sp.gov.br/cidade/feriados) — aniversário
   da cidade em 18/02 (emancipação, Lei Estadual nº 5.285/1959) e São Sebastião
   (padroeiro) em 20/01. */
function irCalcularPascoa(ano){
  // Algoritmo de Meeus/Jones/Butcher (calendário gregoriano) — retorna Date da Páscoa.
  const a = ano % 19, b = Math.floor(ano/100), c = ano % 100;
  const d = Math.floor(b/4), e = b % 4, f = Math.floor((b+8)/25);
  const g = Math.floor((b-f+1)/3), h = (19*a+b-d-g+15) % 30;
  const i = Math.floor(c/4), k = c % 4, l = (32+2*e+2*i-h-k) % 7;
  const m = Math.floor((a+11*h+22*l)/451);
  const mes = Math.floor((h+l-7*m+114)/31), dia = ((h+l-7*m+114) % 31) + 1;
  return new Date(ano, mes-1, dia);
}
function irFeriadosCajamar(ano){
  const add = (dias, base)=>{ const d = new Date(base); d.setDate(d.getDate()+dias); return d; };
  const pascoa = irCalcularPascoa(ano);
  return [
    new Date(ano,0,1),         // Confraternização Universal
    new Date(ano,0,20),        // São Sebastião (padroeiro de Cajamar)
    new Date(ano,1,18),        // Aniversário de emancipação de Cajamar
    add(-2, pascoa),           // Sexta-feira Santa
    add(60, pascoa),           // Corpus Christi
    new Date(ano,3,21),        // Tiradentes
    new Date(ano,4,1),         // Dia do Trabalho
    new Date(ano,6,9),         // Revolução Constitucionalista de 1932 (SP)
    new Date(ano,8,7),         // Independência do Brasil
    new Date(ano,9,12),        // Nossa Senhora Aparecida
    new Date(ano,10,2),        // Finados
    new Date(ano,10,15),       // Proclamação da República
    new Date(ano,10,20),       // Consciência Negra
    new Date(ano,11,25)        // Natal
  ];
}
function irEhFeriadoCajamar(data, cachePorAno){
  const ano = data.getFullYear();
  if(!cachePorAno.has(ano)) cachePorAno.set(ano, new Set(irFeriadosCajamar(ano).map(d=>d.toDateString())));
  return cachePorAno.get(ano).has(data.toDateString());
}
// Conta dias úteis entre "de" e "ate" (ambos inclusive, se forem dias úteis) —
// exclui sábado, domingo e feriados de Cajamar.
function irDiasUteisEntre(de, ate){
  if(!de || !ate) return null;
  const cache = new Map();
  const cur = new Date(de.getFullYear(), de.getMonth(), de.getDate());
  const fim = new Date(ate.getFullYear(), ate.getMonth(), ate.getDate());
  if(cur>fim) return 0;
  let dias = 0;
  while(cur<=fim){
    const diaSemana = cur.getDay();
    if(diaSemana!==0 && diaSemana!==6 && !irEhFeriadoCajamar(cur, cache)) dias++;
    cur.setDate(cur.getDate()+1);
  }
  return dias;
}

const IR_KPI_FORMULAS = {
  acuraciaPecas: 'Acurácia Peças = 1 − (Σ|Diferença| ÷ Σ Peças físicas contadas), tudo derivado da QRY0843 (Rodada 1 = sistêmico x rodada final = físico)',
  acuraciaLocal: 'Acurácia Local = 1 − (Locais com pelo menos 1 item divergente ÷ Locais contados no ciclo)',
  acuraciaValor: 'Acurácia Valor = 1 − (Σ|Vl. Divergência| ÷ Σ Vl. Físico), valorado pela SIGEQ278 (preço de custo) cruzada com a ZBIQ0051 (S/N do componente no kit)',
  andamentoCiclo: 'Andamento do Ciclo = Locais concluídos ÷ Locais congelados',
  qtdRecontagens: 'Locais que precisaram de mais de 2 rodadas de contagem',
  tempoMedioContagem: 'Média de (Data Fim Contagem − Data Início Contagem) por conferência, excluindo a contagem 1 (abertura)',
  diasRestantes: 'Dias úteis entre hoje e a data prevista de término, excluindo sábados, domingos e feriados de Cajamar-SP (nacionais, estaduais e municipais)',
  eficiencia: 'Eficiência = 60% × (Acurácia Local ÷ Meta) + 40% × (Locais concluídos ÷ Locais esperados até hoje, considerando ritmo linear até a data prevista de término)'
};

function irNormKey(s){
  if(s===undefined || s===null) return '';
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'')
    .trim();
}

/* Índice de Prioridade de Auditoria (0-100), pesos configuráveis.
   Cada componente já deve vir normalizado 0-1 antes de chamar esta função.
   Valor financeiro agora vem da SIGEQ278 + ZBIQ0051 (não mais da QRY0114). */
function irCalcularPrioridade(pesos, nValor, nQtd, nRecontagens, nReincidencia){
  const score = (nValor*pesos.valor + nQtd*pesos.quantidade + nRecontagens*pesos.recontagens + nReincidencia*pesos.reincidencia) * 100;
  return Math.round(Math.max(0, Math.min(100, score)));
}
function irPrioridadeCor(score){
  if(score>=70) return '#C83812';
  if(score>=40) return '#FA4616';
  return '#33488E';
}
