import { Suspense, lazy, useEffect, useState } from 'react';
import FormularioProjeto from './FormularioProjeto';
import Anexos from '@/componentes/Anexos';
import Atividades from '@/componentes/Atividades';
import Quadro from '@/componentes/Quadro';
import { coresStatusTarefa } from '@/config/tokens';
import { avancoPorConclusao, ehRaiz, percentualEfetivo, rotuloDosFilhos, singularDoRotulo } from '@/dominio/arvore';

/* O editor de texto e o desenhista de fluxograma somam alguns MB. Quem
   so consulta o painel nao deve baixar isso: entram sob demanda, quando
   o detalhe do projeto abre. */
const Paginas = lazy(() => importarModulo(() => import('@/componentes/paginas/Paginas')));
/* O gerador de .docx tambem so desce quando o projeto e aberto. */
const Documentos = lazy(() => importarModulo(() => import('@/componentes/documentos/Documentos')));
import { Aviso, Barra, Campo, Carregando, Modal, SeloStatus, Vazio } from '@/componentes/ui';
import {
  enviarAnexo, excluirAtualizacao, excluirMarco, excluirProjeto, excluirTarefa,
  lancarAtualizacao, mensagemDeErro, salvarMarco, salvarProjeto, salvarTarefa,
  urlDoAnexo, useDetalheProjeto,
} from '@/estado/dados';
import { usePermissoes } from '@/estado/sessao';
import { importarModulo } from '@/lib/importar';
import {
  formatarData, isoDeHoje, marcoAtrasado, percentualEsperado, progressoDeTarefas, tarefaAtrasada,
} from '@/dominio/regras';
import type { Marco, Pessoa, Projeto, StatusProjeto, StatusTarefa, Tarefa } from '@/dominio/tipos';
import { STATUS_TAREFA, rotuloStatusTarefa } from '@/dominio/tipos';
import { ContextoSituacoes, useSituacoes, useSituacoesDoProjeto } from '@/estado/configuracao';
import { situacoesVisiveis } from '@/dominio/situacoes';

interface Props {
  projeto: Projeto;
  /* A carteira inteira: e dela que saem as melhorias deste projeto e o
     nome do grupo a que ele pertence. */
  projetos: Projeto[];
  pessoas: Pessoa[];
  aoVoltar: () => void;
  aoAbrir: (p: Projeto) => void;
  recarregar: () => Promise<void>;
  /* A configuracao das situacoes e editada de dentro da lista de
     atividades, que e onde elas viram coluna. */
  recarregarConfig: () => Promise<void>;
}

export default function DetalheProjeto({
  projeto, projetos, pessoas, aoVoltar, aoAbrir, recarregar, recarregarConfig,
}: Props) {
  const dados = useDetalheProjeto(projeto.id);
  const [editando, setEditando] = useState(false);
  const [marcoEmEdicao, setMarcoEmEdicao] = useState<Marco | 'novo' | null>(null);
  const [tarefaEmEdicao, setTarefaEmEdicao] = useState<Tarefa | 'nova' | null>(null);
  const [reportando, setReportando] = useState(false);
  const [tarefasEmQuadro, setTarefasEmQuadro] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const nomePessoa = (id: string | null) => pessoas.find((p) => p.id === id)?.nome ?? '—';
  const pai = projeto.projeto_pai_id
    ? projetos.find((p) => p.id === projeto.projeto_pai_id)
    : undefined;
  /* Projeto de topo e a pasta das atividades: abrir mostra a lista do
     que ha para fazer. Marcos, tarefas, paginas, anexos e documento
     pertencem a cada atividade, e so aparecem la dentro. */
  const grupo = ehRaiz(projeto);
  const permissoes = usePermissoes();
  /* A esteira deste projeto: a propria, se ele tiver, senao a do
     modulo. Um estudo e uma melhoria do BSeller nao percorrem as mesmas
     etapas, e cada projeto pode ter a sua fila. */
  const globais = useSituacoes();
  const esteira = useSituacoesDoProjeto(projeto.id, globais);
  const podeMexer = permissoes.podeEditar(projeto);
  /* Com atividades dentro, o avanco vem da conclusao delas: percentual
     digitado no projeto envelhece e ninguem lembra de corrigir. */
  const avanco = avancoPorConclusao(projetos, projeto.id);
  /* Projeto antigo pode ter conteudo proprio de antes desta estrutura.
     Ele continua visivel para nada se perder, mas o novo vai para as
     atividades. */
  const temConteudoAntigo = !!dados.marcos.length || !!dados.tarefas.length || !!dados.anexos.length;
  const mostrarTrabalho = !grupo || temConteudoAntigo;

  async function comErro(acao: () => Promise<void>) {
    try {
      setErro(null);
      await acao();
      await dados.recarregar();
      await recarregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  return (
    /* Tudo o que esta dentro do projeto enxerga a esteira dele. */
    <ContextoSituacoes.Provider value={esteira.situacoes}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button className="font-bold text-roxo-escuro hover:underline" onClick={aoVoltar}>← Voltar</button>
        {pai && (
          <>
            <span className="text-tinta-suave">·</span>
            <button className="font-bold text-tinta-suave hover:text-tinta" onClick={() => aoAbrir(pai)}>
              {pai.nome}
            </button>
          </>
        )}
      </div>

      <div className="cartao p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              {/* Situacao, prioridade e saude saem do cabecalho: repetem o
                  que a linha da atividade e o formulario ja mostram, e o
                  espaco de cima vale mais para os numeros da esteira. */}
              {projeto.codigo && <span className="text-xs font-bold text-tinta-suave">{projeto.codigo}</span>}
            </div>
            <h1 className="font-titulo text-xl font-extrabold">{projeto.nome}</h1>
            {projeto.descricao && <p className="mt-1 max-w-3xl text-sm text-tinta-suave">{projeto.descricao}</p>}
            {grupo && (
              <p className="mt-1 text-xs text-tinta-suave">
                O trabalho deste projeto está em {rotuloDosFilhos(projeto).toLowerCase()}: marcos,
                tarefas, páginas, anexos e documento ficam dentro de cada
                {' '}{singularDoRotulo(projeto).toLowerCase()}.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="botao-neutro"
              onClick={() => void comErro(async () => {
                /* A biblioteca de planilha pesa quase metade do bundle:
                   so e baixada quando alguem exporta de fato. */
                const { exportarProjeto } = await importarModulo(() => import('@/exportar/excel'));
                exportarProjeto(
                  projeto, pessoas, dados.marcos, dados.tarefas, dados.atualizacoes,
                  dados.anexos, projetos,
                );
              })}
            >
              Exportar Excel
            </button>
            {/* Quem nao criou este item so consulta: o botao some em vez
                de existir para depois o banco recusar. */}
            {podeMexer && (
              <>
                <button className="botao-neutro" onClick={() => setReportando(true)}>Lançar acompanhamento</button>
                <button className="botao-primario" onClick={() => setEditando(true)}>Editar</button>
              </>
            )}
            {permissoes.ehAdmin && (
              <button
                  className="botao-perigo"
                  onClick={() => {
                    if (!confirm(`Excluir "${projeto.nome}"? Marcos, tarefas e histórico serão apagados junto.`)) return;
                    void comErro(async () => { await excluirProjeto(projeto.id); aoVoltar(); });
                  }}
              >Excluir</button>
            )}
            {!podeMexer && (
              <span className="self-center rounded-lg bg-papel px-3 py-1.5 text-xs font-bold text-tinta-suave">
                Somente leitura
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="rotulo">Responsável</p>{nomePessoa(projeto.responsavel_id)}</div>
          <div><p className="rotulo">Área</p>{projeto.area ?? '—'}</div>
          <div><p className="rotulo">Previsto</p>{formatarData(projeto.inicio_previsto)} → {formatarData(projeto.fim_previsto)}</div>
          <div><p className="rotulo">Real</p>{formatarData(projeto.inicio_real)} → {formatarData(projeto.fim_real)}</div>
          {/* O numero do chamado se descobre depois de abrir a melhoria,
              e e aqui que a pessoa esta quando ele chega: o campo fica na
              propria tela, sem precisar voltar para a lista nem abrir o
              formulario inteiro.

              Projeto que agrupa outros nao tem chamado proprio: quem
              pede e cada atividade de dentro. No guarda-chuva o campo so
              ocupava espaco e convidava a preencher no lugar errado. */}
          {!grupo && (
          <div>
            <p className="rotulo">Chamado</p>
            {podeMexer ? (
              <div className="flex flex-wrap items-center gap-2">
                <CampoDoCabecalho
                  valor={projeto.chamado} espaco="Nº do chamado" largura="w-28"
                  aoConfirmar={(v) => void comErro(async () => {
                    await salvarProjeto({ nome: projeto.nome, chamado: v }, projeto.id);
                  })}
                />
                <CampoDoCabecalho
                  valor={projeto.ticket_jira} espaco="Jira" largura="w-24"
                  aoConfirmar={(v) => void comErro(async () => {
                    await salvarProjeto({ nome: projeto.nome, ticket_jira: v }, projeto.id);
                  })}
                />
                {projeto.chamado_url && (
                  <a
                    href={projeto.chamado_url} target="_blank" rel="noreferrer"
                    className="text-xs font-bold text-roxo-escuro hover:underline"
                  >abrir</a>
                )}
              </div>
            ) : (
              <span>
                {projeto.chamado ? `#${projeto.chamado.replace(/^#/, '')}` : '—'}
                {projeto.ticket_jira && <span className="text-tinta-suave"> · Jira {projeto.ticket_jira}</span>}
              </span>
            )}
          </div>
          )}
        </div>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-xs font-bold text-tinta-suave">
            <span>{avanco ? 'Avanço pelas atividades concluídas' : 'Avanço pela situação'}</span>
            <span>
              {percentualEfetivo(projetos, projeto)}%
              {avanco && ` · ${avanco.concluidas} de ${avanco.total}`}
              {percentualEsperado(projeto) !== null && ` · esperado pelo prazo ${percentualEsperado(projeto)}%`}
              {!avanco && dados.tarefas.length > 0 && ` · tarefas concluídas ${progressoDeTarefas(dados.tarefas)}%`}
            </span>
          </div>
          <Barra valor={percentualEfetivo(projetos, projeto)} esperado={percentualEsperado(projeto)} />
        </div>
      </div>

      {erro && <Aviso>{erro}</Aviso>}
      {dados.erro && <Aviso>{dados.erro}</Aviso>}

      {grupo && (
        <Atividades
          pai={projeto} projetos={projetos} pessoas={pessoas}
          aoAbrir={aoAbrir} recarregar={recarregar}
          esteiraPropria={esteira.propria}
          recarregarConfig={async () => { await esteira.recarregar(); await recarregarConfig(); }}
        />
      )}

      {mostrarTrabalho && (
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="cartao overflow-hidden">
          <div className="flex items-center justify-between border-b border-linha px-4 py-3">
            <h2 className="font-titulo text-sm font-extrabold">
              Marcos <span className="font-normal text-tinta-suave">(checklist de entregas)</span>
            </h2>
            {podeMexer && (
              <button className="text-sm font-bold text-roxo-escuro" onClick={() => setMarcoEmEdicao('novo')}>+ Novo marco</button>
            )}
          </div>
          {dados.marcos.length ? (
            <ul className="divide-y divide-linha">
              {dados.marcos.map((m) => (
                <li key={m.id} className="flex items-start gap-3 px-4 py-3">
                  <input
                    type="checkbox" checked={m.concluido} className="mt-1"
                    onChange={(e) => void comErro(() => salvarMarco(
                      { projeto_id: projeto.id, nome: m.nome, concluido: e.target.checked, data_real: e.target.checked ? (m.data_real ?? isoDeHoje()) : null },
                      m.id,
                    ))}
                  />
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${m.concluido ? 'text-tinta-suave line-through' : ''}`}>{m.nome}</p>
                    <p className="text-xs text-tinta-suave">
                      Previsto {formatarData(m.data_prevista)}
                      {m.data_real && ` · concluído ${formatarData(m.data_real)}`}
                      {marcoAtrasado(m) && <span className="ml-1 font-bold text-vermelho">atrasado</span>}
                    </p>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <button className="font-bold text-roxo-escuro" onClick={() => setMarcoEmEdicao(m)}>Editar</button>
                    <button className="font-bold text-vermelho" onClick={() => { if (confirm('Excluir marco?')) void comErro(() => excluirMarco(m.id)); }}>Excluir</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : <Vazio>Nenhum marco cadastrado.</Vazio>}
        </section>

        {!tarefasEmQuadro && (
        <section className="cartao overflow-hidden">
          <div className="flex items-center justify-between border-b border-linha px-4 py-3">
            <h2 className="font-titulo text-sm font-extrabold">
              Tarefas {dados.tarefas.length > 0 && <span className="text-tinta-suave">({progressoDeTarefas(dados.tarefas)}% concluídas)</span>}
            </h2>
            <div className="flex items-center gap-2">
              <button className="text-xs font-bold text-tinta-suave hover:text-tinta" onClick={() => setTarefasEmQuadro(true)}>
                Ver em quadro
              </button>
              {podeMexer && (
                <button className="text-sm font-bold text-roxo-escuro" onClick={() => setTarefaEmEdicao('nova')}>+ Nova tarefa</button>
              )}
            </div>
          </div>
          {dados.tarefas.length ? (
            <ul className="divide-y divide-linha">
              {dados.tarefas.map((t) => (
                  <li key={t.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="flex-1">
                      <p className="text-sm font-semibold">{t.titulo}</p>
                      <p className="text-xs text-tinta-suave">
                        {nomePessoa(t.responsavel_id)} · prazo {formatarData(t.prazo)}
                        {tarefaAtrasada(t) && <span className="ml-1 font-bold text-vermelho">atrasada</span>}
                      </p>
                    </div>
                    <select
                      className="campo w-36 py-1 text-xs" value={t.status}
                      onChange={(e) => {
                        const novo = e.target.value as StatusTarefa;
                        void comErro(() => salvarTarefa(
                          { projeto_id: projeto.id, titulo: t.titulo, status: novo, concluida_em: novo === 'concluida' ? (t.concluida_em ?? isoDeHoje()) : null },
                          t.id,
                        ));
                      }}
                    >
                      {STATUS_TAREFA.map((s) => <option key={s} value={s}>{rotuloStatusTarefa[s]}</option>)}
                    </select>
                    <div className="flex gap-2 pt-1 text-xs">
                      <button className="font-bold text-roxo-escuro" onClick={() => setTarefaEmEdicao(t)}>Editar</button>
                      <button className="font-bold text-vermelho" onClick={() => { if (confirm('Excluir tarefa?')) void comErro(() => excluirTarefa(t.id)); }}>Excluir</button>
                    </div>
                  </li>
              ))}
            </ul>
          ) : <Vazio>Nenhuma tarefa cadastrada.</Vazio>}
        </section>
        )}
      </div>
      )}

      {mostrarTrabalho && tarefasEmQuadro && (
        <section className="cartao overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-linha px-4 py-3">
            <h2 className="font-titulo text-sm font-extrabold">
              Tarefas {dados.tarefas.length > 0 && <span className="text-tinta-suave">({progressoDeTarefas(dados.tarefas)}% concluídas)</span>}
            </h2>
            <div className="flex items-center gap-2">
              <button className="text-xs font-bold text-tinta-suave hover:text-tinta" onClick={() => setTarefasEmQuadro(false)}>
                Ver em lista
              </button>
              {podeMexer && (
                <button className="text-sm font-bold text-roxo-escuro" onClick={() => setTarefaEmEdicao('nova')}>+ Nova tarefa</button>
              )}
            </div>
          </div>
          {dados.tarefas.length ? (
            <Quadro
              colunas={STATUS_TAREFA.map((s) => ({ id: s, rotulo: rotuloStatusTarefa[s], cor: coresStatusTarefa[s] }))}
              itens={dados.tarefas.map((t) => ({ id: t.id, coluna: t.status, tarefa: t }))}
              aoAbrir={(c) => setTarefaEmEdicao(c.tarefa)}
              aoMover={(c, coluna) => comErro(() => salvarTarefa(
                {
                  projeto_id: projeto.id,
                  titulo: c.tarefa.titulo,
                  status: coluna as StatusTarefa,
                  concluida_em: coluna === 'concluida' ? (c.tarefa.concluida_em ?? isoDeHoje()) : null,
                },
                c.tarefa.id,
              ))}
              cartao={(c) => (
                <>
                  <p className="text-sm font-semibold leading-snug">{c.tarefa.titulo}</p>
                  <p className="mt-1 truncate text-[11px] text-tinta-suave">
                    {nomePessoa(c.tarefa.responsavel_id)}
                    {c.tarefa.prazo && ` · ${formatarData(c.tarefa.prazo)}`}
                    {tarefaAtrasada(c.tarefa) && <span className="ml-1 font-bold text-vermelho">atrasada</span>}
                  </p>
                </>
              )}
            />
          ) : <Vazio>Nenhuma tarefa cadastrada.</Vazio>}
        </section>
      )}


      {mostrarTrabalho && (
        <>
          <Suspense fallback={<div className="cartao"><Carregando /></div>}>
            <Paginas projetoId={projeto.id} pessoas={pessoas} />
          </Suspense>

          <Anexos
            projetoId={projeto.id} anexos={dados.anexos} marcos={dados.marcos}
            pessoas={pessoas} recarregar={dados.recarregar}
          />

          <Suspense fallback={<div className="cartao"><Carregando /></div>}>
            <Documentos
              projeto={projeto} pessoas={pessoas} marcos={dados.marcos}
              tarefas={dados.tarefas} anexos={dados.anexos}
              recarregarAnexos={dados.recarregar}
            />
          </Suspense>
        </>
      )}

      <section className="cartao overflow-hidden">
        <div className="border-b border-linha px-4 py-3">
          <h2 className="font-titulo text-sm font-extrabold">Acompanhamento</h2>
        </div>
        {dados.atualizacoes.length ? (
          <ul className="divide-y divide-linha">
            {dados.atualizacoes.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-tinta-suave">
                  <strong className="text-tinta">{formatarData(a.data)}</strong>
                  {a.status_reportado && <SeloStatus status={a.status_reportado} />}
                  {a.percentual !== null && <span>{a.percentual}%</span>}
                  {a.autor_nome && <span>por {a.autor_nome}</span>}
                  <button className="ml-auto font-bold text-vermelho" onClick={() => { if (confirm('Excluir lançamento?')) void comErro(() => excluirAtualizacao(a.id)); }}>Excluir</button>
                </div>
                <p className="whitespace-pre-wrap text-sm">{a.texto}</p>
                {a.riscos && <p className="mt-1 text-sm text-ambar"><strong>Riscos:</strong> {a.riscos}</p>}
                {a.proximos_passos && <p className="mt-1 text-sm text-tinta-suave"><strong>Próximos passos:</strong> {a.proximos_passos}</p>}
                {dados.anexos.some((x) => x.atualizacao_id === a.id) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {dados.anexos.filter((x) => x.atualizacao_id === a.id).map((x) => (
                      <a key={x.id} href={urlDoAnexo(x.caminho)} target="_blank" rel="noreferrer" title={x.nome_arquivo}>
                        {x.tipo_mime?.startsWith('image/') ? (
                          <img src={urlDoAnexo(x.caminho)} alt={x.legenda ?? x.nome_arquivo} loading="lazy"
                            className="h-20 w-20 rounded-lg border border-linha object-cover" />
                        ) : (
                          <span className="inline-block rounded-lg border border-linha px-3 py-2 text-xs font-bold text-roxo-escuro">
                            {x.nome_arquivo}
                          </span>
                        )}
                      </a>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : <Vazio>Nenhum acompanhamento lançado.</Vazio>}
      </section>

      <FormularioProjeto
        aberto={editando} projeto={projeto} projetos={projetos} pessoas={pessoas}
        aoFechar={() => setEditando(false)} aoSalvar={async () => { await recarregar(); await dados.recarregar(); }}
      />

      <FormularioMarco
        projetoId={projeto.id} marco={marcoEmEdicao} ordemSugerida={dados.marcos.length}
        aoFechar={() => setMarcoEmEdicao(null)} recarregar={dados.recarregar}
      />

      <FormularioTarefa
        projetoId={projeto.id} tarefa={tarefaEmEdicao} marcos={dados.marcos} pessoas={pessoas}
        ordemSugerida={dados.tarefas.length}
        aoFechar={() => setTarefaEmEdicao(null)} recarregar={dados.recarregar}
      />

      <FormularioAcompanhamento
        projeto={projeto} pessoas={pessoas} aberto={reportando} aoFechar={() => setReportando(false)}
        recarregar={async () => { await dados.recarregar(); await recarregar(); }}
      />
    </div>
    </ContextoSituacoes.Provider>
  );
}

/* ---------------- Marcos ---------------- */

function FormularioMarco({ projetoId, marco, ordemSugerida, aoFechar, recarregar }: {
  projetoId: string; marco: Marco | 'novo' | null; ordemSugerida: number;
  aoFechar: () => void; recarregar: () => Promise<void>;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const atual = marco === 'novo' ? null : marco;

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await salvarMarco({
        projeto_id: projetoId,
        nome: String(f.get('nome')),
        descricao: String(f.get('descricao')) || null,
        data_prevista: String(f.get('data_prevista')) || null,
        ordem: Number(f.get('ordem')),
      }, atual?.id);
      await recarregar();
      aoFechar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  return (
    <Modal aberto={!!marco} aoFechar={aoFechar} titulo={atual ? 'Editar marco' : 'Novo marco'} largura="max-w-lg">
      <form onSubmit={enviar} className="space-y-3">
        <Campo rotulo="Nome *"><input name="nome" required defaultValue={atual?.nome ?? ''} className="campo" /></Campo>
        <Campo rotulo="Descrição"><textarea name="descricao" rows={2} defaultValue={atual?.descricao ?? ''} className="campo" /></Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Data prevista"><input name="data_prevista" type="date" defaultValue={atual?.data_prevista ?? ''} className="campo" /></Campo>
          <Campo rotulo="Ordem"><input name="ordem" type="number" defaultValue={atual?.ordem ?? ordemSugerida} className="campo" /></Campo>
        </div>
        {erro && <Aviso>{erro}</Aviso>}
        <div className="flex justify-end gap-2">
          <button type="button" className="botao-neutro" onClick={aoFechar}>Cancelar</button>
          <button type="submit" className="botao-primario">Salvar</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Tarefas ---------------- */

function FormularioTarefa({ projetoId, tarefa, marcos, pessoas, ordemSugerida, aoFechar, recarregar }: {
  projetoId: string; tarefa: Tarefa | 'nova' | null; marcos: Marco[]; pessoas: Pessoa[];
  ordemSugerida: number; aoFechar: () => void; recarregar: () => Promise<void>;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const atual = tarefa === 'nova' ? null : tarefa;

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const status = f.get('status') as StatusTarefa;
    try {
      await salvarTarefa({
        projeto_id: projetoId,
        titulo: String(f.get('titulo')),
        descricao: String(f.get('descricao')) || null,
        marco_id: String(f.get('marco_id')) || null,
        responsavel_id: String(f.get('responsavel_id')) || null,
        status,
        inicio: String(f.get('inicio')) || null,
        prazo: String(f.get('prazo')) || null,
        concluida_em: status === 'concluida' ? (atual?.concluida_em ?? isoDeHoje()) : null,
        ordem: Number(f.get('ordem')),
      }, atual?.id);
      await recarregar();
      aoFechar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  return (
    <Modal aberto={!!tarefa} aoFechar={aoFechar} titulo={atual ? 'Editar tarefa' : 'Nova tarefa'} largura="max-w-lg">
      <form onSubmit={enviar} className="space-y-3">
        <Campo rotulo="Título *"><input name="titulo" required defaultValue={atual?.titulo ?? ''} className="campo" /></Campo>
        <Campo rotulo="Descrição"><textarea name="descricao" rows={2} defaultValue={atual?.descricao ?? ''} className="campo" /></Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Marco">
            <select name="marco_id" defaultValue={atual?.marco_id ?? ''} className="campo">
              <option value="">Sem marco</option>
              {marcos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Responsável">
            <select name="responsavel_id" defaultValue={atual?.responsavel_id ?? ''} className="campo">
              <option value="">Sem responsável</option>
              {pessoas.filter((p) => p.ativo).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </Campo>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Campo rotulo="Situação">
            <select name="status" defaultValue={atual?.status ?? 'pendente'} className="campo">
              {STATUS_TAREFA.map((s) => <option key={s} value={s}>{rotuloStatusTarefa[s]}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Início"><input name="inicio" type="date" defaultValue={atual?.inicio ?? ''} className="campo" /></Campo>
          <Campo rotulo="Prazo"><input name="prazo" type="date" defaultValue={atual?.prazo ?? ''} className="campo" /></Campo>
          <Campo rotulo="Ordem"><input name="ordem" type="number" defaultValue={atual?.ordem ?? ordemSugerida} className="campo" /></Campo>
        </div>
        {erro && <Aviso>{erro}</Aviso>}
        <div className="flex justify-end gap-2">
          <button type="button" className="botao-neutro" onClick={aoFechar}>Cancelar</button>
          <button type="submit" className="botao-primario">Salvar</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Acompanhamento ---------------- */

function FormularioAcompanhamento({ projeto, pessoas, aberto, aoFechar, recarregar }: {
  projeto: Projeto; pessoas: Pessoa[]; aberto: boolean; aoFechar: () => void; recarregar: () => Promise<void>;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  useSituacoes();
  const disponiveis = situacoesVisiveis([projeto.status]);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const status = f.get('status_reportado') as StatusProjeto;
    const autor = String(f.get('autor_nome')) || null;
    const fotos = (f.getAll('fotos') as File[]).filter((a) => a.size > 0);
    setEnviando(true);
    try {
      const atualizacaoId = await lancarAtualizacao({
        projeto_id: projeto.id,
        data: String(f.get('data')),
        texto: String(f.get('texto')),
        status_reportado: status,
        riscos: String(f.get('riscos')) || null,
        proximos_passos: String(f.get('proximos_passos')) || null,
        autor_nome: autor,
      });

      /* As fotos ficam penduradas no lancamento: e assim que a
         evidencia da semana nao se perde no meio das outras. */
      for (const foto of fotos) {
        await enviarAnexo(foto, {
          projetoId: projeto.id,
          atualizacaoId,
          momento: 'evidencia',
          enviadoPor: autor,
        });
      }
      /* O lancamento e a fonte do status: sem espelhar no projeto, a
         lista e o painel continuariam mostrando o quadro antigo. */
      if (f.get('espelhar')) {
        await salvarProjeto({ nome: projeto.nome, status }, projeto.id);
      }
      await recarregar();
      aoFechar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo="Lançar acompanhamento" largura="max-w-lg">
      <form onSubmit={enviar} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Data"><input name="data" type="date" defaultValue={isoDeHoje()} className="campo" /></Campo>
          <Campo rotulo="Situação">
            <select name="status_reportado" defaultValue={projeto.status} className="campo">
              {disponiveis.map((s) => <option key={s.chave} value={s.chave}>{s.rotulo}</option>)}
            </select>
          </Campo>
        </div>
        <Campo rotulo="Reportado por">
          <select name="autor_nome" className="campo" defaultValue="">
            <option value="">Não informado</option>
            {pessoas.map((p) => <option key={p.id} value={p.nome}>{p.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="O que aconteceu *"><textarea name="texto" required rows={3} className="campo" /></Campo>
        <Campo rotulo="Riscos"><textarea name="riscos" rows={2} className="campo" /></Campo>
        <Campo rotulo="Próximos passos"><textarea name="proximos_passos" rows={2} className="campo" /></Campo>
        <Campo rotulo="Fotos deste acompanhamento">
          <input
            name="fotos" type="file" multiple className="campo py-1.5"
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
          />
        </Campo>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="espelhar" defaultChecked />
          Atualizar a situação do projeto com a situação reportada
        </label>
        {erro && <Aviso>{erro}</Aviso>}
        <div className="flex justify-end gap-2">
          <button type="button" className="botao-neutro" onClick={aoFechar}>Cancelar</button>
          <button type="submit" className="botao-primario" disabled={enviando}>
            {enviando ? 'Enviando…' : 'Lançar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* Campo curto do cabecalho: grava quando se sai dele, como na linha da
   lista. Gravar a cada tecla dispararia uma escrita e uma recarga da
   tela por letra digitada. */
function CampoDoCabecalho({ valor, espaco, largura, aoConfirmar }: {
  valor: string | null;
  espaco: string;
  largura: string;
  aoConfirmar: (valor: string | null) => void;
}) {
  const [texto, setTexto] = useState(valor ?? '');

  useEffect(() => { setTexto(valor ?? ''); }, [valor]);

  return (
    <input
      className={`campo ${largura} py-1 text-sm`}
      value={texto} placeholder={espaco}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => { if ((texto.trim() || null) !== (valor ?? null)) aoConfirmar(texto.trim() || null); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}
