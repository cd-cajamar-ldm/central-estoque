import { formatarData } from './regras';
import type { Marco, Projeto, Tarefa } from './tipos';
import type { DadosDoDocumento, Par } from './documento';

/* Monta o rascunho das 15 secoes a partir do que a pessoa escreveu nos
   quatro campos essenciais (objetivo, dor, TO BE e problema central) e
   do que o projeto ja sabe.

   Isto nao inventa conteudo: recombina o texto da propria pessoa e
   aplica as formulas fixas do padrao. Onde nao ha base, escreve a
   marcacao de pendencia em vez de encher linguica - um documento com
   frase bonita e falsa e pior do que um com "a definir" honesto.

   So preenche campo vazio: o que ja foi escrito nunca e sobrescrito. */

function frases(texto: string): string[] {
  return texto
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((f) => f.trim())
    .filter((f) => f.length > 3);
}

function primeiraFrase(texto: string): string {
  return frases(texto)[0] ?? '';
}

/* "A contagem demora." vira "a contagem demora", para caber no meio de
   outra frase sem ponto final nem maiuscula solta. */
function encaixar(texto: string): string {
  const limpo = texto.trim().replace(/\.$/, '');
  if (!limpo) return '';
  const inicial = limpo[0];
  /* Sigla e nome proprio continuam como estao: "WMS" nao vira "wMS". */
  const ehSigla = limpo.slice(0, 3) === limpo.slice(0, 3).toUpperCase();
  return ehSigla ? limpo : inicial.toLowerCase() + limpo.slice(1);
}

const vazio = (v: string) => !v.trim();

export interface ContextoDoRascunho {
  projeto: Projeto;
  marcos: Marco[];
  tarefas: Tarefa[];
}

export function montarRascunho(
  dados: DadosDoDocumento, contexto: ContextoDoRascunho,
): DadosDoDocumento {
  const { projeto, marcos, tarefas } = contexto;
  const r: DadosDoDocumento = { ...dados };
  const temObjetivo = !vazio(r.objetivo);
  const temDor = !vazio(r.dor);
  const temToBe = !vazio(r.to_be);

  if (vazio(r.subtitulo) && temToBe) {
    r.subtitulo = primeiraFrase(r.to_be).replace(/\.$/, '');
  }

  if (vazio(r.problema_central) && temDor) {
    r.problema_central = primeiraFrase(r.dor);
  }

  if (vazio(r.categoria) && projeto.area) r.categoria = projeto.area;

  /* 2.3 Ganho direto: uma linha por frase do TO BE, ate tres, porque a
     tabela vira ilegivel com mais do que isso. */
  if (!r.ganhos.length && temToBe) {
    r.ganhos = frases(r.to_be).slice(0, 3).map((f, i) => ({
      a: ['Operação', 'Controle', 'Prazo'][i] ?? 'Operação',
      b: f,
    }));
  }

  if (!r.impactos.length) {
    const linhas: Par[] = [];
    if (temToBe) linhas.push({ a: 'Operação no CD', b: primeiraFrase(r.to_be) });
    if (temDor) linhas.push({ a: 'Retrabalho', b: `Deixa de existir o retrabalho de hoje: ${primeiraFrase(r.dor)}` });
    linhas.push({ a: 'Rastreabilidade', b: 'O que foi feito fica registrado no acompanhamento do projeto.' });
    r.impactos = linhas;
  }

  if (!r.riscos.length) {
    r.riscos = [
      { a: 'Dependência técnica', b: 'A implantação depende da agenda do time técnico do Bseller.' },
      { a: 'Mudança de rotina', b: 'A equipe do CD precisa ser orientada antes da virada.' },
    ];
  }

  /* Criterios de aceite saem do TO BE: cada frase do funcionamento
     proposto e, na pratica, um comportamento a validar. */
  if (!r.criterios_aceite.length && temToBe) {
    r.criterios_aceite = frases(r.to_be).slice(0, 5);
  }

  if (!r.cenarios_validacao.length && !vazio(r.exemplo_pratico)) {
    r.cenarios_validacao = frases(r.exemplo_pratico).slice(0, 3);
  }

  if (!r.kpis.length) {
    r.kpis = [
      { a: 'Tempo do processo', b: 'Medir o tempo atual e comparar após a entrega' },
      { a: 'Ocorrências do problema', b: 'Reduzir em relação ao volume de hoje' },
    ];
  }

  /* Rollout vem dos marcos do projeto; sem marcos, fica a sequencia
     padrao de piloto, ajuste e virada. */
  if (!r.rollout.length) {
    r.rollout = marcos.length
      ? marcos.map((m, i) => ({
        a: `Fase ${i + 1} | ${m.nome}`,
        b: m.data_prevista ? `Previsto para ${formatarData(m.data_prevista)}` : 'Data a definir',
      }))
      : [
        { a: 'Fase 1 | Piloto', b: 'Validar o comportamento com um grupo pequeno no CD Cajamar.' },
        { a: 'Fase 2 | Ajustes', b: 'Corrigir o que o piloto apontar.' },
        { a: 'Fase 3 | Virada', b: 'Liberar para toda a operação.' },
      ];
  }

  if (!r.roi_bullets.length) {
    const ganhos = r.ganhos.map((g) => `${g.a}: ${encaixar(g.b)}.`);
    r.roi_bullets = ganhos.length ? ganhos : ['Retorno a quantificar com o time de Controle de Estoque.'];
  }

  if (vazio(r.roi_fechamento) && temObjetivo) {
    /* Sem costurar a frase de quem escreveu no meio da nossa: o pedido
       costuma vir em primeira pessoa ("solicito a inclusao..."), e
       colado depois de "porque" virava frase quebrada. */
    r.roi_fechamento = 'O retorno aparece já no primeiro mês de uso, com o ganho medido pelos indicadores desta proposta.';
  }

  if (vazio(r.esforco_justificativa)) {
    r.esforco_justificativa = 'O esforço será confirmado pelo time técnico do Bseller na análise da proposta.';
  }

  if (vazio(r.prioridade_justificativa)) {
    const porQue = temDor ? ` ${primeiraFrase(r.dor)}` : '';
    r.prioridade_justificativa = `Prioridade ${r.prioridade.toLowerCase()} por causa do impacto na rotina do CD.${porQue}`;
  }

  if (!r.pontos_aberto.length) {
    r.pontos_aberto = ['Confirmar com o time técnico o comportamento em situações de exceção.'];
  }

  if (!r.regras_negocio.length && temToBe) {
    r.regras_negocio = frases(r.to_be).slice(0, 4);
  }

  /* Fluxo AS IS x TO BE: as tarefas do projeto dao as etapas; o que
     muda em cada uma so a pessoa sabe, entao fica marcado. */
  if (!r.fluxo.length && tarefas.length) {
    r.fluxo = tarefas.slice(0, 6).map((t) => ({
      a: t.titulo,
      b: 'Como é hoje: a revisar',
      c: 'Como fica: a revisar',
    }));
  }

  if (vazio(r.resumo_executivo)) {
    r.resumo_executivo = [
      `Esta proposta trata de ${encaixar(r.titulo || projeto.nome)}.`,
      temDor ? `Situação de hoje: ${primeiraFrase(r.dor)}` : '',
      temToBe ? `A melhoria propõe o seguinte: ${primeiraFrase(r.to_be)}` : '',
      temObjetivo ? `Objetivo: ${primeiraFrase(r.objetivo)}` : '',
      `A prioridade é ${r.prioridade.toLowerCase()} e o esforço está classificado como ${r.esforco.toLowerCase()}.`,
      'O documento detalha o cenário atual, a proposta, as regras de negócio, os riscos, os critérios de aceite e os indicadores de sucesso.',
    ].filter(Boolean).join(' ');
  }

  return r;
}

/* O rascunho so tem o que montar se estes campos existirem. */
export function faltamCamposParaRascunho(dados: DadosDoDocumento): string[] {
  const faltando: string[] = [];
  if (vazio(dados.titulo)) faltando.push('título');
  if (vazio(dados.objetivo)) faltando.push('objetivo');
  if (vazio(dados.dor)) faltando.push('dor atual');
  if (vazio(dados.to_be)) faltando.push('o que muda');
  return faltando;
}
