/* ============================================================
   Estado global e persistencia local (secao 4 do brief).
   Os dados importados ficam no IndexedDB via localforage, entao
   sobrevivem entre sessoes sem servidor nenhum.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import localforage from 'localforage';
import type { Componente, Acao } from '../domain/tipos';
import type { DivergenciaSAC } from '../domain/divergencias';
import { lerArquivo, lerArquivoFotos, lerArquivoPrecos, lerArquivoSaldo390 } from '../parsers/planilha';
import { agruparConjuntos, resumirEqualizacao } from '../domain/equalizacao';
import { auditarValoracao, resumirValoracao } from '../domain/valoracao';
import { calcularMetricas, derivarAcoes } from '../domain/projeto';
import { marcoDe, registrarMarco } from '../domain/historico';
import type { Marco } from '../domain/historico';
import { migrarAjustes, registrarAjuste, removerAjuste } from '../domain/ajustes';
import type { AjusteCaso } from '../domain/ajustes';

const store = localforage.createInstance({
  name: 'equalizacao_elevadores',
  storeName: 'dados_v1',
});

const CHAVE_DADOS = 'importacao';
/* O historico fica em chave propria: trocar a planilha em uso nao pode
   apagar o que ja foi medido nas importacoes anteriores. */
const CHAVE_HISTORICO = 'historico';
/* Os ajustes de responsavel tambem ficam fora da importacao: eles sao
   apuracao de quem trabalha o caso, e trocar a planilha do mes nao
   pode apagar a decisao ja tomada sobre uma entrega. */
const CHAVE_AJUSTES = 'ajustes_responsavel';

export interface Importacao {
  componentes: Componente[];
  acoes: Acao[];
  divergencias: DivergenciaSAC[];
  fotos: [string, string][]; // Map serializado
  /* Preco de custo do item pai (SIGEQ278), so quando importado -
     dashboard exibe R$ 0 sem ele, nunca quebra por falta do arquivo. */
  precos: [string, number][]; // Map serializado
  /* Valor unitario por componente (QRY0390), so quando importado -
     manda sobre o preco do pai quando vier preenchido (ver
     precoComponente em domain/fornecedores.ts). */
  saldo390: [string, number][]; // Map serializado
  arquivo: string;
  importadoEm: string; // ISO
  /* Marca os dados de exemplo, para a tela avisar que nao sao do CD. */
  demonstracao?: boolean;
  /* Verdadeiro quando o navegador nao deixou gravar (janela anonima ou
     armazenamento bloqueado): os dados valem so para esta sessao. */
  semPersistencia?: boolean;
}

/* Datas viram string ao passar pelo IndexedDB; reidrata na volta. */
function reidratarAcoes(acoes: Acao[]): Acao[] {
  const campos = ['inicio', 'fim', 'reagendamento', 'dataConclusao', 'prazoValido'] as const;
  return acoes.map((a) => {
    const copia = { ...a } as Record<string, unknown>;
    for (const campo of campos) {
      const v = copia[campo];
      if (typeof v === 'string') copia[campo] = new Date(v);
    }
    return copia as unknown as Acao;
  });
}

/* A data tambem vira string no IndexedDB. Importacao antiga, gravada
   antes da aba de divergencias existir, volta sem o campo: por isso o
   valor padrao.

   dataPelaSaida nao existia nas importacoes anteriores a coluna Data
   Saida entrar na planilha. Nelas a data veio mesmo da emissao do
   pedido, entao falso e o valor correto, e nao so um preenchimento:
   a tela vai marcar essas linhas ate a proxima importacao. */
function reidratarDivergencias(lista: DivergenciaSAC[] | undefined): DivergenciaSAC[] {
  return (lista ?? []).map((d) => ({
    ...d,
    data: typeof d.data === 'string' ? new Date(d.data) : d.data,
    dataPelaSaida: d.dataPelaSaida === true,
    /* Importacao anterior a coluna "Considerar ?" nao tem o campo.
       Ausencia vale como Sim: o painel nao pode sumir com devolucao
       por causa de um dado que nem existia quando ela foi lida. */
    considerar: d.considerar !== false,
  }));
}

/* Grava o retrato do plano no historico. Falhar aqui nunca pode
   impedir a importacao: o historico e um extra, os dados sao o
   principal. */
async function guardarMarco(acoes: Acao[], arquivo: string, hoje: Date): Promise<Marco[]> {
  try {
    const metricas = calcularMetricas(derivarAcoes(acoes, hoje));
    const anterior = (await store.getItem<Marco[]>(CHAVE_HISTORICO)) ?? [];
    const atualizado = registrarMarco(anterior, marcoDe(metricas, arquivo, hoje));
    await store.setItem(CHAVE_HISTORICO, atualizado);
    return atualizado;
  } catch {
    return [];
  }
}

export function useDados() {
  const [dados, setDados] = useState<Importacao | null>(null);
  const [historico, setHistorico] = useState<Marco[]>([]);
  const [ajustes, setAjustes] = useState<AjusteCaso[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void store
      .getItem<Marco[]>(CHAVE_HISTORICO)
      .then((h) => vivo && setHistorico(h ?? []))
      .catch(() => undefined);
    void store
      .getItem<unknown>(CHAVE_AJUSTES)
      /* migrarAjustes aceita o formato antigo, de quando o ajuste so
         sabia trocar o responsavel. */
      .then((a) => vivo && setAjustes(migrarAjustes(a)))
      .catch(() => undefined);
    store
      .getItem<Importacao>(CHAVE_DADOS)
      .then((salvo) => {
        if (!vivo) return;
        if (salvo) {
          setDados({
            ...salvo,
            acoes: reidratarAcoes(salvo.acoes),
            divergencias: reidratarDivergencias(salvo.divergencias),
          });
        }
      })
      .catch(() => undefined)
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, []);

  const importar = useCallback(async (
    arquivo: File,
    arquivoFotos?: File | null,
    arquivoPrecos?: File | null,
    arquivoSaldo390?: File | null
  ) => {
    setErro(null);
    try {
      const buffer = new Uint8Array(await arquivo.arrayBuffer());
      const { componentes, acoes, divergencias } = lerArquivo(buffer);
      if (componentes.length === 0 && acoes.length === 0) {
        throw new Error(
          'Nao encontrei as abas Multiplos e Projeto nesta planilha. Confira se e o arquivo de equalizacao.'
        );
      }

      let fotos: [string, string][] = [];
      if (arquivoFotos) {
        const bufFotos = new Uint8Array(await arquivoFotos.arrayBuffer());
        fotos = [...lerArquivoFotos(bufFotos).entries()];
      }

      let precos: [string, number][] = [];
      if (arquivoPrecos) {
        const bufPrecos = new Uint8Array(await arquivoPrecos.arrayBuffer());
        precos = [...lerArquivoPrecos(bufPrecos).entries()];
      }

      let saldo390: [string, number][] = [];
      if (arquivoSaldo390) {
        const buf390 = new Uint8Array(await arquivoSaldo390.arrayBuffer());
        saldo390 = [...lerArquivoSaldo390(buf390).entries()];
      }

      const novo: Importacao = {
        componentes,
        acoes,
        divergencias,
        fotos,
        precos,
        saldo390,
        arquivo: arquivo.name,
        importadoEm: new Date().toISOString(),
      };

      // Mostrar a planilha importada nao pode depender de conseguir gravar.
      // Em janela anonima ou com armazenamento bloqueado, o app segue
      // funcionando: so avisa que os dados nao ficam salvos.
      try {
        await store.setItem(CHAVE_DADOS, novo);
      } catch {
        novo.semPersistencia = true;
      }

      /* Cada importacao vira um ponto na evolucao do projeto. E o unico
         momento em que da para registrar o que se sabia: reagendamento
         reescreve o prazo e apaga o atraso que existia antes. */
      setHistorico(await guardarMarco(acoes, arquivo.name, new Date()));

      setDados(novo);
      return novo;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao ler a planilha.';
      setErro(msg);
      throw e;
    }
  }, []);

  /* Carrega dados de demonstracao para conhecer as telas sem a planilha.
     Fica so na memoria: nao grava no IndexedDB, para nunca ser confundido
     com uma importacao de verdade. */
  const carregarDemo = useCallback(async () => {
    const { componentesDemo, acoesDemo, historicoDemo, divergenciasDemo } = await import('../demo/dadosDemo');
    setErro(null);
    /* Marcos sinteticos, so na memoria: a evolucao precisa de mais de
       uma medicao para aparecer, e o exemplo nao tem como esperar. */
    setHistorico(historicoDemo());
    setDados({
      componentes: componentesDemo(),
      acoes: acoesDemo(),
      divergencias: divergenciasDemo(),
      fotos: [],
      precos: [],
      saldo390: [],
      arquivo: 'dados de exemplo',
      importadoEm: new Date().toISOString(),
      demonstracao: true,
    });
  }, []);

  const limpar = useCallback(async () => {
    try {
      await store.removeItem(CHAVE_DADOS);
    } catch {
      // Sem armazenamento nao ha o que apagar; volta para a tela inicial.
    }
    setDados(null);
  }, []);

  /* Ajuste manual do responsavel por uma entrega. Grava antes de
     devolver o controle: se o navegador nao deixar gravar, a tela
     continua funcionando na sessao, como no resto do app. */
  const ajustarResponsavel = useCallback(async (ajuste: AjusteCaso) => {
    setAjustes((atuais) => {
      const novo = registrarAjuste(atuais, ajuste);
      void store.setItem(CHAVE_AJUSTES, novo).catch(() => undefined);
      return novo;
    });
  }, []);

  const desfazerAjuste = useCallback(async (caso: string) => {
    setAjustes((atuais) => {
      const novo = removerAjuste(atuais, caso);
      void store.setItem(CHAVE_AJUSTES, novo).catch(() => undefined);
      return novo;
    });
  }, []);

  return {
    dados, historico, ajustes, carregando, erro,
    importar, carregarDemo, limpar, ajustarResponsavel, desfazerAjuste,
  };
}

/* Derivados de equalizacao e valoracao a partir dos componentes. */
export function useEqualizacao(componentes: Componente[] | undefined) {
  return useMemo(() => {
    const lista = componentes ?? [];
    const conjuntos = agruparConjuntos(lista);
    const resumo = resumirEqualizacao(conjuntos);
    const valoracoes = auditarValoracao(lista);
    const resumoValoracao = resumirValoracao(valoracoes);
    return { conjuntos, resumo, valoracoes, resumoValoracao };
  }, [componentes]);
}

/* Acoes com os derivados de prazo calculados para a data de hoje. */
export function useAcoes(acoes: Acao[] | undefined, hoje: Date) {
  return useMemo(() => derivarAcoes(acoes ?? [], hoje), [acoes, hoje]);
}
