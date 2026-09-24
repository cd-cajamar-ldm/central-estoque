import { useEffect, useMemo, useState } from 'react';
import FiltrosAtividades from '@/componentes/FiltrosAtividades';
import Quadro from '@/componentes/Quadro';
import type { CartaoDoQuadro, ColunaDoQuadro } from '@/componentes/Quadro';
import { Aviso, Barra, SeloPrioridade, SeloSaude, SeloStatus, Vazio } from '@/componentes/ui';
import { mensagemDeErro, salvarProjeto } from '@/estado/dados';
import { conteudoDe, useConteudoDosProjetos } from '@/estado/conteudo';
import { usePermissoes } from '@/estado/sessao';
import ConfigStatus from '@/componentes/ConfigStatus';
import { salvarSituacoes, useSituacoes } from '@/estado/configuracao';
import { moverSituacao, ordemDaSituacao, situacaoDe, situacoesVisiveis } from '@/dominio/situacoes';
import type { ConteudoDoProjeto } from '@/estado/conteudo';
import { CONTEUDOS, aplicarFiltros, filtrosVazios } from '@/dominio/filtros';
import Esteira from '@/componentes/Esteira';
import { cobertura } from '@/dominio/cobertura';
import {
  avancoPorConclusao, filhosDe, generoDoRotulo, percentualEfetivo, porPrioridade,
  rotuloDosFilhos, singularDoRotulo,
} from '@/dominio/arvore';
import { atrasado, diasDeAtraso, formatarData, percentualEsperado, saude } from '@/dominio/regras';
import type { Pessoa, Prioridade, Projeto, StatusProjeto } from '@/dominio/tipos';
import { PRIORIDADES, rotuloPrioridade } from '@/dominio/tipos';

interface Props {
  pai: Projeto;
  projetos: Projeto[];
  pessoas: Pessoa[];
  aoAbrir: (p: Projeto) => void;
  recarregar: () => Promise<void>;
  recarregarConfig: () => Promise<void>;
  /* Verdadeiro quando este projeto tem esteira propria; falso quando
     esta usando a do modulo. Muda onde a configuracao e gravada. */
  esteiraPropria?: boolean;
}



interface CartaoDeAtividade extends CartaoDoQuadro {
  projeto: Projeto;
}

/* O conteudo de um projeto sao suas atividades: abrir o projeto mostra
   esta lista, e o trabalho de verdade (marcos, tarefas, paginas, anexos
   e documento) vive dentro de cada atividade.

   A lista e a visao padrao porque e onde cabem prazo, prioridade,
   situacao e avanco lado a lado; o quadro fica a um clique para quem
   quiser arrastar. O nome das atividades vem do proprio projeto:
   "Melhorias" no Bseller, "Frentes" ou "Etapas" em outro. */
export default function Atividades({
  pai, projetos, pessoas, aoAbrir, recarregar, recarregarConfig, esteiraPropria = false,
}: Props) {
  const permissoes = usePermissoes();
  const configSituacoes = useSituacoes();
  const [configAberta, setConfigAberta] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /* Lista ou quadro e preferencia de quem trabalha, nao estado da tela:
     quem prefere o quadro nao quer reescolher a cada projeto aberto. */
  const [emQuadro, setEmQuadro] = useState(() => localStorage.getItem('projetos.visao') === 'quadro');
  const [criando, setCriando] = useState<StatusProjeto | null>(null);
  const [nome, setNome] = useState('');
  const [ordem, setOrdem] = useState<'prioridade' | 'prazo' | 'situacao' | 'nome'>('prioridade');
  const [filtros, setFiltros] = useState(filtrosVazios);
  /* A barra nasce fechada e a escolha fica no proprio navegador: quem
     filtra o dia inteiro nao quer reabrir a cada visita, e quem so
     olha o quadro nao quer perder a largura. */
  const [painelAberto, setPainelAberto] = useState(
    () => localStorage.getItem('projetos.filtros') === 'aberto',
  );

  /* Prioridade manda na ordem: o que e critico aparece primeiro, e o
     prazo desempata. Quem preferir outra ordem troca no seletor. */
  const filhos = useMemo(() => {
    const lista = [...filhosDe(projetos, pai.id)];
    if (ordem === 'prioridade') return lista.sort(porPrioridade);
    if (ordem === 'prazo') {
      return lista.sort((a, b) => (a.fim_previsto ?? '9999').localeCompare(b.fim_previsto ?? '9999'));
    }
    /* A ordem e a da configuracao: e a sequencia do processo da
       equipe, que e quem sabe o que vem antes do que. */
    if (ordem === 'situacao') return lista.sort((a, b) => ordemDaSituacao(a.status) - ordemDaSituacao(b.status));
    return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [projetos, pai.id, ordem]);
  /* Quanta coisa cada atividade tem dentro: e o que responde "quais
     ainda estao sem documentacao". Uma consulta por tabela, so das
     atividades deste projeto. */
  const carteiraDeConteudo = useConteudoDosProjetos(useMemo(() => filhos.map((f) => f.id), [filhos]));
  const visiveis = useMemo(
    () => aplicarFiltros(filhos, carteiraDeConteudo.conteudo, filtros),
    [filhos, carteiraDeConteudo.conteudo, filtros],
  );

  /* Situacao desligada na configuracao some das colunas e do seletor —
     menos quando ainda ha atividade nela, que senao o cartao sumiria da
     tela sem ninguem entender para onde foi. */
  const disponiveis = useMemo(
    () => situacoesVisiveis(filhos.map((f) => f.status)),
    [configSituacoes, filhos],
  );
  const colunas: ColunaDoQuadro[] = disponiveis.map((s) => ({
    id: s.chave, rotulo: s.rotulo, cor: s.cor,
  }));

  const plural = rotuloDosFilhos(pai);
  const singular = singularDoRotulo(pai);
  const artigo = generoDoRotulo(pai) === 'f' ? 'a' : 'o';
  const avanco = avancoPorConclusao(projetos, pai.id);
  const nomePessoa = (id: string | null) => pessoas.find((p) => p.id === id)?.nome ?? '—';

  const cartoes: CartaoDeAtividade[] = visiveis.map((p) => ({ id: p.id, coluna: p.status, projeto: p }));

  async function criar(status: StatusProjeto) {
    const limpo = nome.trim();
    if (!limpo) return;
    try {
      await salvarProjeto({
        nome: limpo,
        projeto_pai_id: pai.id,
        /* A atividade herda area e responsavel do projeto: quase sempre
           e o mesmo, e quem quiser troca na propria linha. */
        area: pai.area,
        responsavel_id: pai.responsavel_id,
        status,
        prioridade: 'media',
      });
      setNome('');
      setCriando(null);
      await recarregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  /* Trocar a coluna de lugar no proprio quadro. A ordem vale para todo
     mundo — e configuracao da equipe, nao preferencia de quem olha —,
     por isso so administrador move, e a gravacao e a mesma da tela de
     situacoes. */
  async function reordenar(chave: string, direcao: -1 | 1) {
    try {
      setErro(null);
      await salvarSituacoes(moverSituacao(configSituacoes, chave, direcao), esteiraPropria ? pai.id : null);
      await recarregarConfig();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  /* Mudar situacao, prioridade ou responsavel direto na linha: e o que
     se faz o dia inteiro, e nao deveria exigir abrir a atividade. */
  async function alterar(projeto: Projeto, mudanca: Partial<Projeto>) {
    /* O quadro arrasta qualquer cartao; a recusa vem antes da ida ao
       banco para a pessoa entender o motivo em vez de ver o cartao
       voltar sozinho. */
    if (!permissoes.podeEditar(projeto)) {
      setErro(`Só quem criou "${projeto.nome}" (ou um administrador) pode alterá-la.`);
      return;
    }
    try {
      await salvarProjeto({ nome: projeto.nome, ...mudanca }, projeto.id);
      await recarregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  return (
    <section data-guia="atividades" className="cartao overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-linha px-4 py-3">
        <h2 className="font-titulo text-sm font-extrabold">
          {plural} {filhos.length > 0 && (
            <span className="text-tinta-suave">
              ({visiveis.length === filhos.length ? filhos.length : `${visiveis.length} de ${filhos.length}`})
            </span>
          )}
          {avanco && (
            <span className="ml-2 text-xs font-normal text-tinta-suave">
              {avanco.concluidas} de {avanco.total} concluídas · {avanco.percentual}%
            </span>
          )}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="campo w-36 py-1 text-xs" value={ordem}
            onChange={(e) => setOrdem(e.target.value as typeof ordem)}
            title="Ordenar a lista"
          >
            <option value="prioridade">Por prioridade</option>
            <option value="prazo">Por data de fim</option>
            <option value="situacao">Por situação</option>
            <option value="nome">Por nome</option>
          </select>
          <div data-guia="visao" className="flex rounded-lg border border-linha p-0.5 text-xs font-bold">
            <button
              className={`rounded px-2 py-1 ${!emQuadro ? 'bg-roxo-suave text-roxo-escuro' : 'text-tinta-suave'}`}
              onClick={() => { setEmQuadro(false); localStorage.setItem('projetos.visao', 'lista'); }}
            >Lista</button>
            <button
              className={`rounded px-2 py-1 ${emQuadro ? 'bg-roxo-suave text-roxo-escuro' : 'text-tinta-suave'}`}
              onClick={() => { setEmQuadro(true); localStorage.setItem('projetos.visao', 'quadro'); }}
            >Quadro</button>
          </div>
          {permissoes.ehAdmin && (
            <button
              data-guia="situacoes"
              className="rounded-lg border border-linha px-2 py-1 text-xs font-bold text-tinta-suave hover:border-roxo hover:text-roxo-escuro"
              onClick={() => setConfigAberta(true)}
              title="Configurar as situações"
            >⚙ Situações</button>
          )}
          {permissoes.podeCriar && (
            <button className="botao-primario py-1 text-xs" onClick={() => { setCriando('nao_iniciado'); setNome(''); }}>
              + Nov{artigo} {singular.toLowerCase()}
            </button>
          )}
        </div>
      </div>

      {filhos.length > 0 && (
        <div className="border-b border-linha bg-papel px-4 py-3">
          <Esteira numeros={cobertura(filhos, carteiraDeConteudo.conteudo)} plural={plural.toLowerCase()} />
        </div>
      )}

      {erro && <div className="p-4"><Aviso>{erro}</Aviso></div>}

      {criando && (
        <form
          className="flex flex-wrap items-end gap-2 border-b border-linha bg-papel px-4 py-3"
          onSubmit={(e) => { e.preventDefault(); void criar(criando); }}
        >
          <label className="min-w-[240px] flex-1">
            <span className="rotulo">Nome d{artigo} {singular.toLowerCase()}</span>
            <input
              className="campo" value={nome} autoFocus
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Trava sistêmica para transferência de paletes"
            />
          </label>
          <label>
            <span className="rotulo">Situação</span>
            <select className="campo" value={criando} onChange={(e) => setCriando(e.target.value as StatusProjeto)}>
              {disponiveis.map((s) => <option key={s.chave} value={s.chave}>{s.rotulo}</option>)}
            </select>
          </label>
          <button type="submit" className="botao-primario">Criar</button>
          <button type="button" className="botao-neutro" onClick={() => { setCriando(null); setNome(''); }}>
            Cancelar
          </button>
        </form>
      )}

      {!filhos.length ? (
        <Vazio>
          Nenhum item em {plural.toLowerCase()} ainda. Cada {singular.toLowerCase()} tem marcos,
          tarefas, páginas, anexos e gera o próprio documento em Word.
        </Vazio>
      ) : (
      <div className="lg:flex">
        <FiltrosAtividades
          filtros={filtros} aoMudar={setFiltros} pessoas={pessoas}
          aberto={painelAberto}
          aoAlternar={() => setPainelAberto((a) => {
            localStorage.setItem('projetos.filtros', a ? 'fechado' : 'aberto');
            return !a;
          })}
          mostrando={visiveis.length} total={filhos.length}
        />

        <div className="min-w-0 flex-1">
        {carteiraDeConteudo.erro && <div className="p-4"><Aviso>{carteiraDeConteudo.erro}</Aviso></div>}
        {!visiveis.length ? (
          <Vazio>
            Nenhum item com esses filtros.{' '}
            <button className="font-bold text-roxo-escuro" onClick={() => setFiltros(filtrosVazios())}>
              Limpar filtros
            </button>
          </Vazio>
        ) : emQuadro ? (
        <Quadro
          colunas={colunas}
          itens={cartoes}
          aoMover={(c, coluna) => alterar(c.projeto, { status: coluna as StatusProjeto })}
          aoAbrir={(c) => aoAbrir(c.projeto)}
          /* Situacao que nao esta na configuracao (renomeada ou de antes
             da mudanca) nao tem para onde ser movida: sem seta nela. */
          aoReordenar={permissoes.ehAdmin
            ? (coluna, direcao) => void reordenar(coluna.id, direcao)
            : undefined}
          rodape={(coluna) => (
            <button
              className="w-full rounded-lg border border-dashed border-linha py-1.5 text-[11px] font-bold text-tinta-suave hover:border-roxo hover:text-roxo-escuro"
              onClick={() => { setCriando(coluna.id as StatusProjeto); setNome(''); }}
            >+ Adicionar</button>
          )}
          cartao={(c) => (
            <>
              <p className="text-sm font-semibold leading-snug">{c.projeto.nome}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <SeloPrioridade prioridade={c.projeto.prioridade} />
                {atrasado(c.projeto) && (
                  <span className="text-[11px] font-bold text-vermelho">+{diasDeAtraso(c.projeto)}d</span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Barra valor={percentualEfetivo(projetos, c.projeto)} />
                <span className="text-[11px] font-bold text-tinta-suave">
                  {percentualEfetivo(projetos, c.projeto)}%
                </span>
              </div>
              <div className="mt-1.5">
                <MarcasDeConteudo conteudo={conteudoDe(carteiraDeConteudo.conteudo, c.projeto.id)} discreto />
              </div>
              <p className="mt-1.5 truncate text-[11px] text-tinta-suave">
                {nomePessoa(c.projeto.responsavel_id)}
                {c.projeto.fim_previsto && ` · ${formatarData(c.projeto.fim_previsto)}`}
              </p>
            </>
          )}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-papel text-left text-[11px] uppercase tracking-wider text-tinta-suave">
              <tr>
                <th className="px-4 py-2 font-bold">{singular}</th>
                <th className="px-3 py-2 font-bold">Responsável</th>
                <th className="px-3 py-2 font-bold">Situação</th>
                <th className="px-3 py-2 font-bold">Prioridade</th>
                <th className="px-3 py-2 font-bold">Chamado</th>
                <th className="px-3 py-2 font-bold">Início</th>
                <th className="px-3 py-2 font-bold">Fim</th>
                <th className="px-3 py-2 font-bold">Saúde</th>
                <th className="px-3 py-2 font-bold">Conteúdo</th>
                <th className="px-3 py-2 font-bold w-40">Avanço</th>
                <th className="px-3 py-2 font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((p) => (
                <tr key={p.id} className="border-t border-linha hover:bg-papel">
                  <td className="px-4 py-2">
                    <button
                      className="text-left font-semibold hover:text-roxo-escuro hover:underline"
                      onClick={() => aoAbrir(p)}
                    >{p.nome}</button>
                  </td>

                  <td className="px-3 py-2">
                    <select
                      className="campo w-36 py-1 text-xs" value={p.responsavel_id ?? ''}
                      disabled={!permissoes.podeEditar(p)}
                      onChange={(e) => void alterar(p, { responsavel_id: e.target.value || null })}
                    >
                      <option value="">Sem responsável</option>
                      {pessoas.filter((q) => q.ativo).map((q) => (
                        <option key={q.id} value={q.id}>{q.nome}</option>
                      ))}
                    </select>
                  </td>

                  <td className="px-3 py-2">
                    <select
                      className="campo w-36 py-1 text-xs" value={p.status}
                      disabled={!permissoes.podeEditar(p)}
                      onChange={(e) => void alterar(p, { status: e.target.value as StatusProjeto })}
                    >
                      {/* A propria situacao da linha entra na lista mesmo se
                          estiver desligada: sem ela o seletor mostraria outro
                          valor e uma troca sem querer viraria escrita. */}
                      {Array.from(new Set([...disponiveis.map((s) => s.chave), p.status])).map((chave) => (
                        <option key={chave} value={chave}>{situacaoDe(chave).rotulo}</option>
                      ))}
                    </select>
                  </td>

                  <td className="px-3 py-2">
                    <select
                      className="campo w-28 py-1 text-xs" value={p.prioridade}
                      disabled={!permissoes.podeEditar(p)}
                      onChange={(e) => void alterar(p, { prioridade: e.target.value as Prioridade })}
                    >
                      {PRIORIDADES.map((s) => <option key={s} value={s}>{rotuloPrioridade[s]}</option>)}
                    </select>
                  </td>

                  {/* O numero do chamado no BSeller: e por ele que se
                      cruza o que esta aqui com o que esta la. */}
                  <td className="px-3 py-2">
                    <CampoTexto
                      valor={p.chamado} desabilitado={!permissoes.podeEditar(p)}
                      largura="w-24" espaco="145537"
                      aoConfirmar={(v) => void alterar(p, { chamado: v })}
                    />
                    {p.chamado && p.chamado_url && (
                      <a
                        href={p.chamado_url} target="_blank" rel="noreferrer"
                        className="ml-1 text-[11px] font-bold text-roxo-escuro hover:underline"
                        title="Abrir o chamado"
                      >↗</a>
                    )}
                  </td>

                  {/* Inicio e a data que quem trabalha digita — quando a
                      documentacao foi feita. O fim vem do Bseller, nao
                      daqui, por isso so ele carrega o aviso de atraso. */}
                  <td className="px-3 py-2">
                    <CampoData
                      valor={p.inicio_real} desabilitado={!permissoes.podeEditar(p)}
                      aoConfirmar={(v) => void alterar(p, { inicio_real: v })}
                    />
                  </td>

                  <td className="px-3 py-2">
                    <CampoData
                      valor={p.fim_previsto} desabilitado={!permissoes.podeEditar(p)}
                      aoConfirmar={(v) => void alterar(p, { fim_previsto: v })}
                    />
                    {diasDeAtraso(p) > 0 && (
                      <span className="ml-1 text-[11px] font-bold text-vermelho">+{diasDeAtraso(p)}d</span>
                    )}
                  </td>

                  <td className="px-3 py-2"><SeloSaude saude={saude(p, projetos)} /></td>

                  <td className="px-3 py-2">
                    <MarcasDeConteudo conteudo={conteudoDe(carteiraDeConteudo.conteudo, p.id)} />
                  </td>

                  <td className="px-3 py-2">
                    {/* Sem campo para digitar: o avanco e consequencia da
                        situacao, entao muda pelo seletor ao lado. */}
                    <div className="flex items-center gap-2">
                      <Barra valor={percentualEfetivo(projetos, p)} esperado={percentualEsperado(p)} />
                      <span className="w-9 text-right text-xs font-bold">{percentualEfetivo(projetos, p)}%</span>
                    </div>
                  </td>

                  <td className="px-3 py-2"><SeloStatus status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          {permissoes.podeCriar && (
            <div className="border-t border-linha px-4 py-2">
              <button
                className="text-xs font-bold text-tinta-suave hover:text-roxo-escuro"
                onClick={() => { setCriando('nao_iniciado'); setNome(''); }}
              >+ Adicionar {singular.toLowerCase()}</button>
            </div>
          )}
        </div>
        )}
        </div>
      </div>
      )}

      <ConfigStatus
        aberto={configAberta} situacoes={configSituacoes}
        emUso={Array.from(new Set(filhos.map((f) => f.status)))}
        projeto={pai} propria={esteiraPropria}
        aoFechar={() => setConfigAberta(false)} recarregar={recarregarConfig}
      />

      {/* Situação do projeto inteiro, num selo só, para quem chega pela lista. */}
      {filhos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-linha px-4 py-2 text-[11px] text-tinta-suave">
          {disponiveis.filter((s) => filhos.some((f) => f.status === s.chave)).map((s) => (
            <span key={s.chave} className="flex items-center gap-1">
              <SeloStatus status={s.chave} />
              <span className="font-bold">{filhos.filter((f) => f.status === s.chave).length}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

const SIGLAS: Record<keyof ConteudoDoProjeto, string> = {
  paginas: 'Pág', documentos: 'Doc', tarefas: 'Tar', marcos: 'Mar', anexos: 'Anx',
};

/* O que a atividade ja tem dentro, em tres letras. Sem isso o filtro
   "sem documentacao" acha o item mas a linha nao explica por que, e
   abrir uma a uma para conferir e o que se queria evitar. */
function MarcasDeConteudo({ conteudo, discreto }: { conteudo: ConteudoDoProjeto; discreto?: boolean }) {
  const marcas = CONTEUDOS.filter(({ campo }) => conteudo[campo] > 0);
  if (!marcas.length) {
    return discreto ? null : <span className="text-[11px] text-tinta-suave">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {marcas.map(({ campo, rotulo }) => (
        <span
          key={campo}
          title={`${conteudo[campo]} · ${rotulo}`}
          className="rounded border border-linha px-1.5 py-0.5 text-[11px] font-bold text-tinta-suave"
        >{SIGLAS[campo]} {conteudo[campo]}</span>
      ))}
    </div>
  );
}

/* Data que so grava quando a pessoa sai do campo.

   Digitando "18/08/2026" o navegador dispara mudanca a cada pedaco, e
   as incompletas chegam como texto vazio. Gravando na hora, cada
   digito virava uma escrita no banco seguida de recarga da lista — a
   tela piscava, o campo voltava ao valor antigo e o cursor saia dali.
   Guardar em estado proprio e confirmar no blur (ou no Enter) resolve;
   o valor de fora volta a mandar assim que ele muda de verdade. */
function CampoData({ valor, desabilitado, aoConfirmar }: {
  valor: string | null;
  desabilitado?: boolean;
  aoConfirmar: (valor: string | null) => void;
}) {
  const [texto, setTexto] = useState(valor ?? '');

  useEffect(() => { setTexto(valor ?? ''); }, [valor]);

  return (
    <input
      type="date" className="campo w-36 py-1 text-xs"
      value={texto} disabled={desabilitado}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => { if ((texto || null) !== (valor ?? null)) aoConfirmar(texto || null); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

/* Texto curto que so grava ao sair do campo — mesma disciplina do campo
   de data: gravar a cada tecla dispararia uma escrita e uma recarga da
   lista por letra digitada. */
function CampoTexto({ valor, desabilitado, largura, espaco, aoConfirmar }: {
  valor: string | null;
  desabilitado?: boolean;
  largura: string;
  espaco?: string;
  aoConfirmar: (valor: string | null) => void;
}) {
  const [texto, setTexto] = useState(valor ?? '');

  useEffect(() => { setTexto(valor ?? ''); }, [valor]);

  return (
    <input
      className={`campo ${largura} py-1 text-xs`}
      value={texto} disabled={desabilitado} placeholder={espaco}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => { if ((texto.trim() || null) !== (valor ?? null)) aoConfirmar(texto.trim() || null); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}
