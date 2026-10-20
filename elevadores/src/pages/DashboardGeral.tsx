/* ============================================================
   Pagina 1: Dashboard Geral (secao 11 do brief).
   Saude do estoque, KPIs de direcionamento, graficos, plano de
   acao e auditoria de valoracao.
   ============================================================ */
import { useMemo, useState } from 'react';
import { FotoAoPassar } from '../components/ui/FotoAoPassar';
import { ItensPorFornecedor } from '../components/ItensPorFornecedor';
import { InversoesSAC } from '../components/InversoesSAC';
import { SaudeDoEstoque } from '../components/SaudeDoEstoque';
import type { DivergenciaSAC } from '../domain/divergencias';
import type { AjusteCaso } from '../domain/ajustes';
import type { ChartConfiguration } from 'chart.js';
import type { Componente, Conjunto, Valoracao } from '../domain/tipos';
import { agruparConjuntos, resumirEqualizacao } from '../domain/equalizacao';
import { listarPorFornecedor } from '../domain/fornecedores';
import type { MapaPrecos } from '../domain/fornecedores';
import { auditarValoracao, resumirValoracao } from '../domain/valoracao';
import { cores, coresStatus } from '../config/tokens';
import { Grafico } from '../components/charts/Grafico';
import {
  Barra, BarraFiltros, Botao, Busca, Cartao, Kpi, Selecao, SeloStatus,
  SeloValoracao, Tabela, Td, Th, Vazio,
} from '../components/ui';
import { baixarPlanoEqualizacao, baixarBaseCompleta, baixarCorrecoesValoracao } from '../export/exportExcel';

/* Quantas barras cabem no grafico de compras sem virar parede de
   texto. O resto continua no detalhe por fornecedor, logo abaixo. */
const LINHAS_DO_GRAFICO = 12;

function PlanoDeAcao({
  conjuntos,
  buscaGlobal,
}: {
  conjuntos: Conjunto[];
  buscaGlobal: string;
}) {
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState('');

  const filtrados = useMemo(() => {
    const b = `${buscaGlobal} ${busca}`.trim().toLowerCase();
    return conjuntos
      .filter((c) => !b || c.chave.toLowerCase().includes(b))
      .filter((c) => !status || c.status === status)
      .sort((a, b2) => b2.comprarColuna + b2.comprarBase - (a.comprarColuna + a.comprarBase));
  }, [conjuntos, busca, buscaGlobal, status]);

  return (
    <Cartao
      titulo="Plano de ação — equalização"
      descricao={`${filtrados.length} de ${conjuntos.length} conjuntos`}
      acoes={<Botao variante="secundario" aoClicar={() => baixarPlanoEqualizacao(filtrados)}>Exportar Excel</Botao>}
    >
      <BarraFiltros>
        <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar conjunto…" />
        <Selecao valor={status} aoMudar={setStatus} opcoes={Object.keys(coresStatus)} rotuloTodos="Todos os status" />
      </BarraFiltros>
      {filtrados.length === 0 ? (
        <Vazio>Nenhum conjunto para os filtros escolhidos.</Vazio>
      ) : (
        <Tabela>
          <thead>
            <tr>
              <Th>Conjunto (Chave)</Th>
              <Th>Ton.</Th>
              <Th alinha="right">Ratio</Th>
              <Th alinha="right">Base CD</Th>
              <Th alinha="right">Col. CD</Th>
              <Th alinha="right">Déficit</Th>
              <Th alinha="right">Kits</Th>
              <Th alinha="right">Reversa</Th>
              <Th>Status</Th>
              <Th alinha="right">Ação sugerida</Th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((c) => (
              <tr key={c.chave}>
                <Td>{c.chave}</Td>
                <Td>{c.toneladaFixa}</Td>
                <Td alinha="right" numerico>1:{c.ratio}</Td>
                <Td alinha="right" numerico>{c.baseCD}</Td>
                <Td alinha="right" numerico>{c.colCD}</Td>
                <Td alinha="right" numerico>{c.deficit > 0 ? `+${c.deficit}` : c.deficit}</Td>
                <Td alinha="right" numerico>{c.kits}</Td>
                <Td alinha="right" numerico>{c.reversa || '—'}</Td>
                <Td><SeloStatus status={c.status} /></Td>
                <Td alinha="right">
                  {c.status === 'CASADO' ? (
                    <span style={{ color: cores.semantico.verde }}>— equalizado —</span>
                  ) : c.status === 'SEM ESTOQUE' ? (
                    <span style={{ color: 'var(--ink-soft)' }}>sem estoque</span>
                  ) : (
                    <span className="num">
                      {c.comprarColuna > 0 && (
                        <b style={{ color: cores.laranja.base }}>+{c.comprarColuna} coluna</b>
                      )}
                      {c.comprarColuna > 0 && c.comprarBase > 0 && ' · '}
                      {c.comprarBase > 0 && <b style={{ color: cores.navy.base }}>+{c.comprarBase} base</b>}
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}
    </Cartao>
  );
}

function AuditoriaValoracao({
  valoracoes,
  fotos,
}: {
  valoracoes: Valoracao[];
  fotos: Map<string, string>;
}) {
  const resumo = useMemo(() => resumirValoracao(valoracoes), [valoracoes]);
  const aCorrigir = useMemo(
    () => valoracoes.filter((v) => v.diagnostico === 'CORRIGIR' || v.diagnostico === 'DUPLICADO'),
    [valoracoes]
  );
  const maximo = resumo.porMarca[0]?.corrigir ?? 1;

  return (
    <Cartao
      titulo="Auditoria de valoração"
      descricao="campo “in interface” · o valor do kit fica na COLUNA"
      acoes={
        <Botao variante="secundario" aoClicar={() => baixarCorrecoesValoracao(aCorrigir)}>
          Exportar correções
        </Botao>
      }
    >
      {/* Antes daqui so havia contagem, e contagem sozinha nao diz se
          o trabalho esta no comeco ou no fim. A proporcao responde
          "de quantos modelos, quantos ainda faltam". */}
      <div className="eq-avanco">
        <div className="eq-avanco-num">
          <b style={{ color: cores.semantico.verde }}>{resumo.pctAjustado.toFixed(0)}%</b>
          <span className="eq-avanco-rot">já valoram na coluna</span>
          <span className="eq-avanco-det">
            {resumo.ok} de {resumo.total} modelos
          </span>
        </div>
        <div className="eq-avanco-num">
          <b style={{ color: cores.laranja.base }}>{resumo.pctFalta.toFixed(0)}%</b>
          <span className="eq-avanco-rot">ainda falta ajustar</span>
          <span className="eq-avanco-det">
            {resumo.faltaAjuste} modelo(s) · {resumo.comSNaBase} com o S preso na base
          </span>
        </div>
        <div className="eq-avanco-barra" title={`${resumo.ok} de ${resumo.total} modelos já valoram na coluna`}>
          <span style={{ width: `${resumo.pctAjustado}%`, background: cores.semantico.verde }} />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <Kpi rotulo="Corretos" valor={resumo.ok} cor={cores.semantico.verde} />
        <Kpi rotulo="A corrigir" valor={resumo.corrigir} dica="S na base" cor={cores.laranja.base} />
        <Kpi rotulo="Sem S" valor={resumo.semS} cor={cores.semantico.ambar} />
        <Kpi rotulo="Duplicado" valor={resumo.duplicado} cor={cores.navy.base} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-2.5 text-[13px] uppercase tracking-wide" style={{ color: 'var(--ink-soft)' }}>
            Concentração por marca
          </h3>
          {resumo.porMarca.length === 0 ? (
            <Vazio>Nenhuma correção pendente.</Vazio>
          ) : (
            resumo.porMarca.slice(0, 8).map((m) => (
              <Barra key={m.marca} nome={m.marca || '—'} valor={m.corrigir} maximo={maximo} cor={cores.laranja.base} />
            ))
          )}
        </div>
        <div>
          <h3 className="mb-2.5 text-[13px] uppercase tracking-wide" style={{ color: 'var(--ink-soft)' }}>
            Correções prontas para o Bseller
          </h3>
          <div className="max-h-80 overflow-y-auto pr-1">
            {aCorrigir.length === 0 ? (
              <Vazio>Nada a corrigir.</Vazio>
            ) : (
              aCorrigir.slice(0, 40).map((v) => (
                <div
                  key={v.itemVolMultiplo}
                  className="mb-2 rounded-lg px-3 py-2.5 font-mono text-[12px]"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                >
                  <div className="mb-1 font-sans text-[11px]" style={{ color: 'var(--ink-soft)' }}>
                    <FotoAoPassar item={v.itemVolMultiplo} url={fotos.get(String(v.itemVolMultiplo))} />{' '}
                    · {v.marca} <SeloValoracao diagnostico={v.diagnostico} />
                  </div>
                  {v.correcoes.map((c) => (
                    <div key={c}>{c}</div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Cartao>
  );
}

export function DashboardGeral({
  componentes,
  fotos,
  precos,
  saldo390,
  busca: buscaGlobal = '',
  divergencias = [],
  ajustes = [],
  aoAjustar,
  aoDesfazer,
}: {
  componentes: Componente[];
  fotos: Map<string, string>;
  /* Preco de custo do item pai (SIGEQ278), para o R$ parado na saude
     do estoque. Mapa vazio quando nao foi importado. */
  precos?: MapaPrecos;
  /* Valor unitario por componente (QRY0390), mesmo KPI - manda sobre
     o preco do pai quando vier preenchido. Mapa vazio quando nao
     importado. */
  saldo390?: MapaPrecos;
  /* Texto da busca da barra de topo, que vale para todas as telas. */
  busca?: string;
  /* Devolucoes registradas pelo SAC (aba Divergencias SAC). */
  divergencias?: DivergenciaSAC[];
  /* Reclassificacoes de responsavel feitas a mao. */
  ajustes?: AjusteCaso[];
  aoAjustar?: (a: AjusteCaso) => void;
  aoDesfazer?: (caso: string) => void;
}) {
  const conjuntos = useMemo(() => agruparConjuntos(componentes), [componentes]);
  const resumo = useMemo(() => resumirEqualizacao(conjuntos), [conjuntos]);
  const valoracoes = useMemo(() => auditarValoracao(componentes), [componentes]);

  /* O grafico de compras sai da mesma fonte da tabela de saude logo
     acima: fornecedor -> tonelada, montado pela composicao de cada
     item pai.

     Antes ele vinha do agrupamento por Chave, que e outro caminho e
     por isso podia discordar da tabela. Duas divergencias possiveis,
     as duas silenciosas: linha com a coluna Chave em branco nunca
     entra em conjunto nenhum, e o corte dos maiores empurrava para
     fora quem precisa de pouco. Fornecedor descasado na tabela e
     ausente no grafico logo acima dela e a pior forma de perder a
     confianca do numero. */
  const compras = useMemo(() => {
    const linhas = listarPorFornecedor(componentes).flatMap((g) =>
      g.toneladas.map((t) => ({
        rotulo: `${g.fornecedor} · ${t.tonelada}`,
        colunas: t.comprarColuna,
        bases: t.comprarBase,
      }))
    );
    const comFalta = linhas.filter((l) => l.colunas + l.bases > 0);
    /* Desempate pelo nome: sem ele a ordem entre iguais mudava a cada
       importacao e um fornecedor sumia sem motivo aparente. */
    const ordenadas = [...comFalta].sort(
      (a, b) => b.colunas + b.bases - (a.colunas + a.bases) || a.rotulo.localeCompare(b.rotulo, 'pt-BR')
    );
    const top = ordenadas.slice(0, LINHAS_DO_GRAFICO);
    return {
      top,
      total: ordenadas.length,
      colunas: comFalta.reduce((s, l) => s + l.colunas, 0),
      bases: comFalta.reduce((s, l) => s + l.bases, 0),
    };
  }, [componentes]);

  const configCompras: ChartConfiguration = useMemo(
    () => ({
      type: 'bar',
      data: {
        labels: compras.top.map((l) => l.rotulo),
        datasets: [
          { label: 'Colunas', data: compras.top.map((l) => l.colunas), backgroundColor: cores.laranja.base, borderRadius: 4 },
          { label: 'Bases', data: compras.top.map((l) => l.bases), backgroundColor: cores.navy.base, borderRadius: 4 },
        ],
      },
      options: {
        indexAxis: 'y',
        scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true, ticks: { font: { size: 10 } } } },
        plugins: {
          legend: { display: true, position: 'bottom', labels: { boxWidth: 12 } },
          datalabels: { display: (c) => (c.dataset.data[c.dataIndex] as number) > 0, anchor: 'center', align: 'center', color: '#fff' },
        },
      },
    }),
    [compras]
  );

  return (
    <div className="flex flex-col gap-4.5" style={{ gap: 18 }}>
      {/* A saude do estoque abre a pagina: e a leitura que responde
          "quanto do que esta parado vira venda", que e por onde a
          reuniao comeca. Os totais de compra e o detalhe por conjunto
          vem depois, para quem quer saber o que fazer a respeito. */}
      <SaudeDoEstoque componentes={componentes} precos={precos} saldo390={saldo390} />

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Kpi rotulo="Colunas a comprar" valor={resumo.totalComprarColuna} dica="para casar as bases existentes" cor={cores.laranja.base} />
        <Kpi rotulo="Bases a comprar" valor={resumo.totalComprarBase} dica="onde sobram colunas sem base" cor={cores.navy.base} />
        <Kpi
          rotulo="Travado na reversa"
          valor={`${resumo.pctReversa.toFixed(0)}%`}
          /* A porcentagem vem primeiro porque 53 unidades nao dizem
             nada sem o estoque ao lado: 53 de 700 e outra conversa. */
          dica={
            <>
              {resumo.totalReversa} un de {resumo.totalCD + resumo.totalReversa} no estoque
              {resumo.travadosPelaReversa > 0 && (
                <>
                  {' · '}
                  <b>{resumo.travadosPelaReversa}</b> conjunto(s) só esperam por ela
                </>
              )}
            </>
          }
          cor={cores.semantico.ambar}
        />
        <Kpi
          rotulo="Conjuntos casados"
          valor={`${resumo.comConjuntoNoCD > 0 ? Math.round((resumo.casados / resumo.comConjuntoNoCD) * 100) : 0}%`}
          dica={`${resumo.casados} de ${resumo.comConjuntoNoCD} conjuntos · meta: 100%`}
          cor={cores.semantico.verde}
        />
      </div>

      <Cartao
        titulo="Colunas × bases a comprar"
        descricao={
          compras.total === 0
            ? 'nada a comprar: todos os conjuntos estão equalizados'
            : `${compras.top.length} de ${compras.total} grupos com compra pendente · ` +
              `${compras.colunas} coluna(s) e ${compras.bases} base(s) no total`
        }
      >
        {compras.top.length === 0 ? (
          <Vazio>Nenhuma compra pendente.</Vazio>
        ) : (
          <Grafico
            config={configCompras}
            /* A altura acompanha o numero de barras: com altura fixa,
               as ultimas ficavam espremidas e ilegiveis. */
            altura={Math.max(240, 34 * compras.top.length + 70)}
            rotulo="Colunas e bases a comprar por fornecedor e tonelada"
          />
        )}
      </Cartao>

      <ItensPorFornecedor componentes={componentes} fotos={fotos} busca={buscaGlobal} />

      <InversoesSAC
        divergencias={divergencias}
        componentes={componentes}
        ajustes={ajustes}
        aoAjustar={aoAjustar}
        aoDesfazer={aoDesfazer}
      />

      <PlanoDeAcao conjuntos={conjuntos} buscaGlobal={buscaGlobal} />
      <AuditoriaValoracao valoracoes={valoracoes} fotos={fotos} />

      <Cartao titulo="Base mestre" descricao={`${componentes.length} linhas importadas`}
        acoes={<Botao variante="secundario" aoClicar={() => baixarBaseCompleta(componentes, conjuntos, valoracoes)}>Exportar base completa</Botao>}>
        <p className="text-[12.5px]" style={{ color: 'var(--ink-soft)' }}>
          A exportação traz as 18 colunas originais da aba Multiplos, na mesma ordem, mais as colunas
          de análise ao final: ratio, saldos do conjunto, kits, déficit, status, ação sugerida e
          diagnóstico de valoração.
        </p>
      </Cartao>
    </div>
  );
}
