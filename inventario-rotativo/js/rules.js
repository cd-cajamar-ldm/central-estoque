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
  {id:'AII', legenda:'Inventário de Insumos', considerarNet:false},
  /* Sem código na frente: a observação vem escrita por extenso. Entra na legenda
     como frase, e é por isso que a classificação precisa procurar o texto dentro
     da observação e não só no começo dela. */
  {id:'SALDO INCLUIDO INDEVIDAMENTE', legenda:'Saldo incluído indevidamente via NF', considerarNet:false}
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
  /* O código casa quando a observação é ele sozinho ou quando ele vem seguido de
     qualquer caractere que não seja letra nem número. Antes só espaço e hífen
     valiam, então "AIR." e "AIR/2" viravam códigos próprios ("AIR.", "AIR/2") e
     ficavam de fora do recorte do ciclo rotativo — contagem boa descartada por
     causa de pontuação. Continua exigindo um separador depois do código, pra
     "AIRTON" não virar AIR. Espaço em volta e minúscula já eram tratados pelo
     trim/uppercase acima. */
  for(const item of lista){
    const cod = String(item.id||'').trim().toUpperCase();
    if(!cod) continue;
    if(texto===cod || (texto.startsWith(cod) && /[^A-Z0-9]/.test(texto.charAt(cod.length)))){
      return {id:item.id, legenda:item.legenda, considerarNet:item.considerarNet};
    }
  }
  /* Segunda passada, por texto contido. Nem toda observação começa com código:
     "SALDO INCLUIDO INDEVIDAMENTE VIA NF" é escrita por extenso, não casava com
     nada e caía no padrão "considera no NET" — sozinha ela deslocou o NET de
     março em R$ 279.734,88.

     Só vale pra entrada com 6 caracteres ou mais, que é o tamanho de uma frase.
     Com código de três letras, procurar em qualquer posição casaria "AIR" dentro
     de outra palavra e classificaria errado o que hoje está certo. */
  for(const item of lista){
    const chave = String(item.id||'').trim().toUpperCase();
    if(chave.length >= 6 && texto.includes(chave)){
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

/* Catálogo COMPLETO das regras e lógicas de negócio do módulo — a fonte única
   usada tanto pela aba "Exportar" (exibição e planilha) quanto como referência
   documental. Cada item: {categoria, regra, detalhe, fonte}. "fonte" diz de qual
   planilha/coluna o dado vem, pra quem for conferir na origem. Mantido aqui, em
   rules.js, pra viver junto das fórmulas e constantes que descreve. */
const IR_REGRAS_CATALOGO = [
  // ---- Bases / planilhas de entrada ----
  {categoria:'Bases de entrada', regra:'QRY0843 — Produtividade', detalhe:'Fonte de peças, locais, itens e divergências do ciclo rotativo. Traz, por par (local, item), a contagem de cada rodada (Id Conferência) e as datas de início/fim de contagem.', fonte:'QRY0843'},
  {categoria:'Bases de entrada', regra:'Base Congelada', detalhe:'Locais congelados do ciclo (planilha manual). Define o universo de locais orçados e a RUA (X1 + X2) e o SETOR (X1) de cada endereço.', fonte:'Base Congelada'},
  {categoria:'Bases de entrada', regra:'SIGEQ278 — Preço', detalhe:'Preço de custo/compra por item. Usada pra valorar a divergência (Acurácia Valor) e dar nome a item sem saldo.', fonte:'SIGEQ278'},
  {categoria:'Bases de entrada', regra:'ZBIQ0051 — Kits/Múltiplos', detalhe:'Item pai × componente, com S/N de quem carrega o valor (in_interface). Evita contar o valor do kit em mais de um componente.', fonte:'ZBIQ0051'},
  {categoria:'Bases de entrada', regra:'QRY0390 — Estoque atual (opcional)', detalhe:'Saldo atual por item/local. Opcional: o estoque é rotativo e não entra em nenhum indicador de acurácia; alimenta EAN/descrição e a foto de estoque.', fonte:'QRY0390'},
  {categoria:'Bases de entrada', regra:'QRY410 — Perdas e Ganhos (NET)', detalhe:'Movimentos de ajuste do CD, por ano. Independente do ciclo rotativo — processada por ano extraído de Dt.Mov.', fonte:'QRY410'},

  // ---- Rodadas de contagem ----
  {categoria:'Rodadas de contagem', regra:'Rodada 1 = sistêmico', detalhe:'A primeira rodada (Id Conferência 1) é o congelamento automático do sistema na abertura do inventário — é o saldo SISTÊMICO de referência, não uma contagem física.', fonte:'QRY0843 · Id Conferência'},
  {categoria:'Rodadas de contagem', regra:'Rodada final = físico', detalhe:'A contagem física de cada local é a da ÚLTIMA rodada (maior Id Conferência). Nunca soma rodadas — sempre a última fecha o número do local.', fonte:'QRY0843 · Id Conferência'},
  {categoria:'Rodadas de contagem', regra:'Recontagem', detalhe:'Local que precisou de MAIS de 2 rodadas pra fechar. Não confundir com cancelamento.', fonte:'QRY0843 · Id Conferência'},
  {categoria:'Rodadas de contagem', regra:'Cancelamento', detalhe:'Local cuja contagem começou e foi interrompida antes de fechar (ex.: precisava coletar). É outra coisa, não é recontagem.', fonte:'QRY0843'},
  {categoria:'Rodadas de contagem', regra:'Local concluído', detalhe:'Só locais "convergido" (rodadas bateram) ou "encerrado sem convergência" (fechou na 5ª rodada sem bater) entram em Acurácia Peças/Valor e Divergência. Local pendente/em contagem ainda pode mudar de rodada, então fica de fora desses indicadores.', fonte:'QRY0843'},

  // ---- Acurácia: denominador ----
  {categoria:'Acurácia', regra:'Denominador da Acurácia Peças = SISTEMA', detalhe:'Acurácia Peças = 1 − (Σ|Diferença| ÷ Σ saldo SISTÊMICO dos locais concluídos). O denominador é a quantidade do sistema (rodada 1), NÃO a física contada. Item que sumiu inteiro (sistema 500, físico 0) põe 500 no erro e 500 na base = 100% de erro, sem estourar.', fonte:'QRY0843'},
  {categoria:'Acurácia', regra:'Lado cego aceito', detalhe:'Item ACHADO do nada (sistema 0, físico 500) entra no numerador do erro com base zero — pesa no erro sem somar na base. O resultado é travado entre 0% e 100%.', fonte:'QRY0843'},
  {categoria:'Acurácia', regra:'Acurácia Local', detalhe:'1 − (locais com pelo menos 1 item divergente ÷ locais contados no ciclo).', fonte:'QRY0843 + Base Congelada'},
  {categoria:'Acurácia', regra:'Acurácia Valor', detalhe:'1 − (Σ|Vl. Divergência| ÷ Σ Vl. sistêmico). Valor de cada item vem da SIGEQ278 (preço de custo) cruzada com a ZBIQ0051 (só o componente marcado S carrega o valor do kit).', fonte:'SIGEQ278 × ZBIQ0051'},
  {categoria:'Acurácia', regra:'Meta de acurácia', detalhe:'Meta padrão de '+(IR_META_ACURACIA*100).toFixed(0)+'% para as três acurácias.', fonte:'Configuração'},
  {categoria:'Acurácia', regra:'Ciclos legados 1 e 2 de 2026', detalhe:'Os ciclos 1 e 2 de 2026 fecharam por qualquer motivo (não só AIR) e usam a base FÍSICA como denominador da Acurácia Peças, não o saldo sistêmico — régua da época, preservada pra não reescrever o histórico.', fonte:'Regra de transição'},

  // ---- Produtividade ----
  {categoria:'Produtividade', regra:'Local contado (esforço)', detalhe:'Na Produtividade, a métrica é "local CONTADO" (esforço de quem contou), não "local fechado". Um local recontado por mais de uma pessoa conta pra todas — a soma das linhas pode passar do total único de locais do ciclo, de propósito.', fonte:'QRY0843'},
  {categoria:'Produtividade', regra:'Hora do bloco = Data Fim Contagem', detalhe:'O bloco de hora-homem usa a Data Fim Contagem (quando o local foi finalizado), não o Início — o Início pode ficar aberto além do expediente de quem abriu.', fonte:'QRY0843 · Data Fim Contagem'},
  {categoria:'Produtividade', regra:'Acertividade', detalhe:'Por colaborador: visitas (local + Nº Inventário) que fecharam SEM divergência ÷ total de visitas dele. É o complemento da taxa de erro (1 − erro). Verde ≥97% · amarelo ≥93% · vermelho <93%.', fonte:'QRY0843'},
  {categoria:'Produtividade', regra:'Taxa de recontagem', detalhe:'Por colaborador: visitas em que veio outra rodada depois da dele ÷ total de visitas. Verde ≤8% · amarelo ≤15% · vermelho >15%.', fonte:'QRY0843'},

  // ---- Setor / Rua ----
  {categoria:'Setor / Rua', regra:'Rua = X1 + X2', detalhe:'A RUA de um endereço é a junção X1 + X2 (separados por espaço), não o X1 sozinho — ruas diferentes com o mesmo prefixo X1 não podem cair na mesma linha.', fonte:'Base Congelada · X1, X2'},
  {categoria:'Setor / Rua', regra:'Setor = X1', detalhe:'O SETOR é só o X1 (sem o X2) — agrupa várias ruas, pra comparar rápido qual setor está pior antes de abrir a rua específica.', fonte:'Base Congelada · X1'},
  {categoria:'Setor / Rua', regra:'Local pendente', detalhe:'Local da base congelada sem nenhuma rodada física (Id Conferência ≥ 2) — foi aberto/liquidado sem ninguém contar. Local só com rodada 1 continua pendente.', fonte:'QRY0843 + Base Congelada'},

  // ---- NET (QRY410) ----
  {categoria:'NET (QRY410)', regra:'Id Depósito 21 excluído', detalhe:'Toda linha com Id Depósito = 21 fica de fora de tudo no NET (regra explícita do usuário).', fonte:'QRY410 · Id Depósito'},
  {categoria:'NET (QRY410)', regra:'Sinal do movimento', detalhe:'Saída = valor negativo, Entrada = valor positivo. NET = Entradas + Saídas.', fonte:'QRY410 · Sentido, Vl.Mov.'},
  {categoria:'NET (QRY410)', regra:'Ano do movimento em UTC', detalhe:'O ano/mês vem dos componentes UTC da célula de data (convenção do leitor de planilha), não da hora local — senão lançamentos do dia 1º caíam no mês anterior em fuso negativo (Brasil, UTC−3).', fonte:'QRY410 · Dt.Mov.'},
  {categoria:'NET (QRY410)', regra:'Classificação por Observação', detalhe:'O motivo vem da "Observação WMS"; se vazia, cai na coluna "Observacao". O código casa quando é a observação inteira ou vem seguido de um caractere não-alfanumérico (pra "AIR." e "AIR/2" contarem como AIR, mas "AIRTON" não).', fonte:'QRY410 · Observação WMS / Observacao'},
  {categoria:'NET (QRY410)', regra:'Observação por extenso (≥6 letras)', detalhe:'Observação escrita por extenso (ex.: "SALDO INCLUIDO INDEVIDAMENTE VIA NF") é procurada em qualquer posição do texto, mas só pra chaves de 6+ caracteres — código de 3 letras buscado em qualquer posição classificaria errado.', fonte:'QRY410'},
  {categoria:'NET (QRY410)', regra:'Sem legenda = considera', detalhe:'Motivo que não está na legenda conta como "considerar NET = SIM" por padrão. A legenda é editável em Configurações (não precisa mexer em código a cada motivo novo).', fonte:'Legenda editável'},
  {categoria:'NET (QRY410)', regra:'Detalhe por Lógica 301/302', detalhe:'A tabela de detalhe linha a linha da NET lista só as Lógicas 301 e 302 (visão crua, não agregada). Net Ano/Mês de cada linha é o saldo do item no período somando todos os motivos considerados pro NET, não só aquela linha.', fonte:'QRY410 · Logica'},

  // ---- Datas / dias úteis ----
  {categoria:'Datas', regra:'Dias úteis (Cajamar-SP)', detalhe:'"Dias Restantes" conta dias úteis entre hoje e a data prevista de término, excluindo sábados, domingos e feriados nacionais, estaduais de SP e municipais de Cajamar (São Sebastião 20/01, emancipação 18/02).', fonte:'Calendário'},

  // ---- Prioridade de Auditoria ----
  {categoria:'Prioridade de Auditoria', regra:'Fórmula do score', detalhe:'Índice (0-100) = (valor×peso_valor + qtd×peso_qtd + recontagens×peso_reconta + reincidência×peso_reinc) × 100. Cada componente normalizado 0-1. Pesos configuráveis em Configurações (somam 100%).', fonte:'Configuração de pesos'},
  {categoria:'Prioridade de Auditoria', regra:'Faixas de cor', detalhe:'Score ≥70 vermelho, ≥40 laranja, abaixo azul.', fonte:'Regra fixa'}
];

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
