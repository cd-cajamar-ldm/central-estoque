import { describe, expect, it } from 'vitest';
import { documentoVazio } from '../src/dominio/documento';
import { faltamCamposParaRascunho, montarRascunho } from '../src/dominio/rascunho';
import type { Marco, Projeto, Tarefa } from '../src/dominio/tipos';

const projeto: Projeto = {
  id: 'j1', codigo: 'PRJ-001', nome: 'Inventário com OM', descricao: null, area: 'Inventário',
  responsavel_id: null, status: 'em_andamento', prioridade: 'alta',
  inicio_previsto: '2026-08-01', fim_previsto: '2026-10-01', inicio_real: null, fim_real: null,
  percentual: 40, criado_por: null, criado_em: '', atualizado_em: '',
};

const marcos: Marco[] = [
  { id: 'm1', projeto_id: 'j1', nome: 'Piloto', descricao: null, data_prevista: '2026-09-01', data_real: null, concluido: false, ordem: 0 },
];

const tarefas: Tarefa[] = [
  { id: 't1', projeto_id: 'j1', marco_id: null, titulo: 'Abrir inventário', descricao: null, responsavel_id: null, status: 'pendente', inicio: null, prazo: null, concluida_em: null, ordem: 0 },
];

const preenchido = () => ({
  ...documentoVazio(3),
  titulo: 'Abertura automática de inventário',
  objetivo: 'Reduzir o tempo entre a tarefa e a contagem.',
  dor: 'A contagem só começa quando alguém percebe a divergência. Isso leva dias.',
  to_be: 'A tarefa abre o inventário na hora. O endereço fica bloqueado até a contagem.',
});

const contexto = { projeto, marcos, tarefas };

describe('faltamCamposParaRascunho', () => {
  it('cobra os quatro campos essenciais', () => {
    expect(faltamCamposParaRascunho(documentoVazio(1)))
      .toEqual(['título', 'objetivo', 'dor atual', 'o que muda']);
  });

  it('não cobra nada quando os quatro estão preenchidos', () => {
    expect(faltamCamposParaRascunho(preenchido())).toEqual([]);
  });
});

describe('montarRascunho', () => {
  it('tira o problema central da primeira frase da dor', () => {
    const r = montarRascunho(preenchido(), contexto);
    expect(r.problema_central).toBe('A contagem só começa quando alguém percebe a divergência.');
  });

  it('escreve o resumo executivo com as palavras da própria pessoa', () => {
    const r = montarRascunho(preenchido(), contexto);
    expect(r.resumo_executivo).toContain('Esta proposta trata de abertura automática de inventário.');
    /* A frase de quem escreveu entra inteira, depois de dois pontos: o
       pedido costuma vir em primeira pessoa e costurar no meio da nossa
       frase quebrava o texto. */
    expect(r.resumo_executivo).toContain('Situação de hoje: A contagem só começa quando alguém percebe a divergência.');
    expect(r.resumo_executivo).toContain('prioridade é média');
  });

  it('transforma o TO BE em critérios de aceite e regras', () => {
    const r = montarRascunho(preenchido(), contexto);
    expect(r.criterios_aceite).toEqual([
      'A tarefa abre o inventário na hora.',
      'O endereço fica bloqueado até a contagem.',
    ]);
    expect(r.regras_negocio).toHaveLength(2);
  });

  it('usa os marcos do projeto como fases do rollout', () => {
    const r = montarRascunho(preenchido(), contexto);
    expect(r.rollout[0].a).toBe('Fase 1 | Piloto');
    expect(r.rollout[0].b).toContain('01/09/2026');
  });

  it('cai na sequência padrão quando o projeto não tem marcos', () => {
    const r = montarRascunho(preenchido(), { ...contexto, marcos: [] });
    expect(r.rollout).toHaveLength(3);
    expect(r.rollout[0].a).toBe('Fase 1 | Piloto');
  });

  it('nunca sobrescreve o que já foi escrito', () => {
    const meu = { ...preenchido(), problema_central: 'Minha frase.', kpis: [{ a: 'X', b: 'Y' }] };
    const r = montarRascunho(meu, contexto);
    expect(r.problema_central).toBe('Minha frase.');
    expect(r.kpis).toEqual([{ a: 'X', b: 'Y' }]);
  });

  it('marca o fluxo como pendente de revisão em vez de inventar', () => {
    const r = montarRascunho(preenchido(), contexto);
    expect(r.fluxo[0].a).toBe('Abrir inventário');
    expect(r.fluxo[0].b).toContain('a revisar');
  });

  it('não quebra com sigla no começo da frase', () => {
    const r = montarRascunho({ ...preenchido(), dor: 'WMS não devolve o saldo.' }, contexto);
    expect(r.resumo_executivo).toContain('WMS não devolve o saldo');
  });
});
