import { useMemo, useState } from 'react';
import Quadro from '@/componentes/Quadro';
import type { CartaoDoQuadro, ColunaDoQuadro } from '@/componentes/Quadro';
import { Aviso, Campo, Carregando, Modal, SeloPrioridade, SeloStatus, Vazio } from '@/componentes/ui';
import { coresStatus } from '@/config/tokens';
import {
  excluirGrupo, excluirTarefa, mensagemDeErro, moverTarefa, reordenarTarefa, salvarGrupo, salvarTarefa,
} from '@/estado/dados';
import { useDetalheQuadro } from '@/estado/dados';
import { usePermissoes } from '@/estado/sessao';
import {
  PRIORIDADES, STATUS_ENCERRADOS, STATUS_TAREFA, rotuloPrioridade, rotuloStatus,
} from '@/dominio/tipos';
import type { Grupo, Pessoa, Prioridade, Quadro as TipoQuadro, StatusTarefa, Tarefa } from '@/dominio/tipos';

type Visao = 'quadro' | 'tabela';
const CHAVE_VISAO = 'tarefas.visao';

interface Props {
  quadro: TipoQuadro;
  pessoas: Pessoa[];
  aoVoltar: () => void;
}

export default function DetalheQuadro({ quadro, pessoas, aoVoltar }: Props) {
  const { grupos, tarefas, carregando, erro, recarregar } = useDetalheQuadro(quadro.id);
  const permissoes = usePermissoes();
  const [visao, setVisao] = useState<Visao>(() => {
    try { return (localStorage.getItem(CHAVE_VISAO) as Visao) || 'quadro'; } catch { return 'quadro'; }
  });
  const [tarefaEmEdicao, setTarefaEmEdicao] = useState<Tarefa | 'nova' | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  function mudarVisao(nova: Visao) {
    setVisao(nova);
    try { localStorage.setItem(CHAVE_VISAO, nova); } catch { /* só não lembra */ }
  }

  const pessoaPorId = useMemo(() => new Map(pessoas.map((p) => [p.id, p])), [pessoas]);

  async function agir<T>(acao: () => Promise<T>) {
    try {
      await acao();
      await recarregar();
    } catch (falha) {
      setErroAcao(mensagemDeErro(falha));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className="text-sm font-bold text-laranja-escuro hover:underline" onClick={aoVoltar}>← Quadros</button>
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: quadro.cor }} />
        <h2 className="font-titulo text-lg font-extrabold">{quadro.nome}</h2>
        {quadro.descricao && <p className="text-sm text-tinta-suave">{quadro.descricao}</p>}

        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-lg border border-linha bg-white p-0.5">
            <button
              className={`rounded px-3 py-1 text-xs font-bold ${visao === 'quadro' ? 'bg-laranja-escuro text-white' : 'text-tinta-suave'}`}
              onClick={() => mudarVisao('quadro')}
            >Quadro</button>
            <button
              className={`rounded px-3 py-1 text-xs font-bold ${visao === 'tabela' ? 'bg-laranja-escuro text-white' : 'text-tinta-suave'}`}
              onClick={() => mudarVisao('tabela')}
            >Tabela</button>
          </div>
          {permissoes.podeCriar && (
            <button className="botao-primario" onClick={() => setTarefaEmEdicao('nova')}>+ Nova tarefa</button>
          )}
        </div>
      </div>

      {erro && <Aviso>{erro}</Aviso>}
      {erroAcao && <Aviso>{erroAcao}</Aviso>}

      {carregando ? <Carregando /> : visao === 'quadro' ? (
        <QuadroKanban
          tarefas={tarefas} grupos={grupos} pessoaPorId={pessoaPorId}
          aoAbrir={(t) => setTarefaEmEdicao(t)}
          aoMover={(t, status) => agir(() => moverTarefa(t, status as StatusTarefa))}
          aoReordenarCartao={(t, status, antesDeId) => agir(() => reordenarTarefa(t, tarefas, status as StatusTarefa, antesDeId))}
        />
      ) : (
        <TabelaDeTarefas
          tarefas={tarefas} grupos={grupos} pessoas={pessoas} permissoes={permissoes}
          aoAbrir={(t) => setTarefaEmEdicao(t)}
          aoCriarGrupo={(nome) => agir(() => salvarGrupo({ quadro_id: quadro.id, nome, ordem: grupos.length }))}
          aoExcluirGrupo={(id) => agir(() => excluirGrupo(id))}
          aoCriarTarefaRapida={(grupoId, titulo) => agir(() => salvarTarefa({ quadro_id: quadro.id, grupo_id: grupoId, titulo }))}
        />
      )}

      <FormularioTarefa
        tarefa={tarefaEmEdicao} quadroId={quadro.id} grupos={grupos} pessoas={pessoas}
        aoFechar={() => setTarefaEmEdicao(null)} recarregar={recarregar}
      />
    </div>
  );
}

function corGrupo(g: Grupo | undefined) {
  return g?.cor ?? '#6A6F94';
}

interface TarefaCartao extends CartaoDoQuadro, Tarefa {}

function QuadroKanban({ tarefas, grupos, pessoaPorId, aoAbrir, aoMover, aoReordenarCartao }: {
  tarefas: Tarefa[]; grupos: Grupo[]; pessoaPorId: Map<string, Pessoa>;
  aoAbrir: (t: Tarefa) => void;
  aoMover: (t: Tarefa, status: string) => void;
  aoReordenarCartao: (t: Tarefa, status: string, antesDeId: string | null) => void;
}) {
  const colunas: ColunaDoQuadro[] = STATUS_TAREFA.map((s) => ({ id: s, rotulo: rotuloStatus[s], cor: coresStatus[s] }));
  const grupoPorId = useMemo(() => new Map(grupos.map((g) => [g.id, g])), [grupos]);
  const itens: TarefaCartao[] = tarefas
    .slice().sort((a, b) => (a.ordem ?? Infinity) - (b.ordem ?? Infinity))
    .map((t) => ({ ...t, coluna: t.status }));

  return (
    <Quadro
      colunas={colunas}
      itens={itens}
      aoAbrir={aoAbrir}
      aoMover={aoMover}
      aoReordenarCartao={aoReordenarCartao}
      cartao={(t) => {
        const responsavel = t.responsavel_id ? pessoaPorId.get(t.responsavel_id) : undefined;
        const grupo = t.grupo_id ? grupoPorId.get(t.grupo_id) : undefined;
        const atrasada = !!t.prazo && !STATUS_ENCERRADOS.includes(t.status) && t.prazo < new Date().toISOString().slice(0, 10);
        return (
          <div className="space-y-1.5">
            <p className="text-sm font-bold leading-snug">{t.titulo}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <SeloPrioridade prioridade={t.prioridade} />
              {grupo && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-tinta-suave">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: corGrupo(grupo) }} />
                  {grupo.nome}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between text-[11px] text-tinta-suave">
              <span>{responsavel?.nome ?? 'Sem responsável'}</span>
              {t.prazo && <span className={atrasada ? 'font-bold text-vermelho' : ''}>{formatarData(t.prazo)}</span>}
            </div>
          </div>
        );
      }}
    />
  );
}

function TabelaDeTarefas({
  tarefas, grupos, pessoas, permissoes, aoAbrir, aoCriarGrupo, aoExcluirGrupo, aoCriarTarefaRapida,
}: {
  tarefas: Tarefa[]; grupos: Grupo[]; pessoas: Pessoa[];
  permissoes: ReturnType<typeof usePermissoes>;
  aoAbrir: (t: Tarefa) => void;
  aoCriarGrupo: (nome: string) => void;
  aoExcluirGrupo: (id: string) => void;
  aoCriarTarefaRapida: (grupoId: string | null, titulo: string) => void;
}) {
  const pessoaPorId = useMemo(() => new Map(pessoas.map((p) => [p.id, p])), [pessoas]);
  const grupinhos: (Grupo | null)[] = [...grupos, ...(tarefas.some((t) => !t.grupo_id) ? [null] : [])];
  const [novoGrupo, setNovoGrupo] = useState('');

  return (
    <div className="space-y-4">
      {grupinhos.map((g) => {
        const daLista = tarefas.filter((t) => (t.grupo_id ?? null) === (g?.id ?? null));
        return (
          <div key={g?.id ?? 'sem-grupo'} className="cartao overflow-hidden">
            <div className="flex items-center gap-2 border-b border-linha px-4 py-2.5" style={{ borderLeft: `4px solid ${corGrupo(g ?? undefined)}` }}>
              <h3 className="font-titulo text-sm font-extrabold">{g?.nome ?? 'Sem grupo'}</h3>
              <span className="text-xs text-tinta-suave">{daLista.length}</span>
              {g && permissoes.podeCriar && (
                <button
                  className="ml-auto text-xs font-bold text-vermelho"
                  onClick={() => { if (confirm(`Excluir o grupo "${g.nome}"? As tarefas não são apagadas.`)) aoExcluirGrupo(g.id); }}
                >Excluir grupo</button>
              )}
            </div>
            <table className="w-full text-sm">
              <tbody>
                {daLista.map((t) => {
                  const responsavel = t.responsavel_id ? pessoaPorId.get(t.responsavel_id) : undefined;
                  const atrasada = !!t.prazo && !STATUS_ENCERRADOS.includes(t.status) && t.prazo < new Date().toISOString().slice(0, 10);
                  return (
                    <tr key={t.id} className="cursor-pointer border-t border-linha hover:bg-papel" onClick={() => aoAbrir(t)}>
                      <td className="px-4 py-2 font-semibold">{t.titulo}</td>
                      <td className="px-4 py-2 text-tinta-suave">{responsavel?.nome ?? '—'}</td>
                      <td className="px-4 py-2"><SeloStatus status={t.status} /></td>
                      <td className="px-4 py-2"><SeloPrioridade prioridade={t.prioridade} /></td>
                      <td className={`px-4 py-2 ${atrasada ? 'font-bold text-vermelho' : 'text-tinta-suave'}`}>
                        {t.prazo ? formatarData(t.prazo) : '—'}
                      </td>
                    </tr>
                  );
                })}
                {!daLista.length && (
                  <tr><td colSpan={5}><Vazio>Nenhuma tarefa neste grupo.</Vazio></td></tr>
                )}
                {permissoes.podeCriar && g && (
                  <tr className="border-t border-linha">
                    <td colSpan={5} className="px-4 py-2">
                      <LinhaNovaTarefa aoCriar={(titulo) => aoCriarTarefaRapida(g.id, titulo)} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })}

      {permissoes.podeCriar && (
        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); if (novoGrupo.trim()) { aoCriarGrupo(novoGrupo.trim()); setNovoGrupo(''); } }}
        >
          <input
            className="campo max-w-xs" placeholder="Nome do novo grupo"
            value={novoGrupo} onChange={(e) => setNovoGrupo(e.target.value)}
          />
          <button type="submit" className="botao-neutro">+ Grupo</button>
        </form>
      )}
    </div>
  );
}

function LinhaNovaTarefa({ aoCriar }: { aoCriar: (titulo: string) => void }) {
  const [titulo, setTitulo] = useState('');
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => { e.preventDefault(); if (titulo.trim()) { aoCriar(titulo.trim()); setTitulo(''); } }}
    >
      <input
        className="w-full rounded-lg border border-dashed border-linha bg-transparent px-2 py-1.5 text-sm outline-none focus:border-laranja"
        placeholder="+ Adicionar tarefa"
        value={titulo} onChange={(e) => setTitulo(e.target.value)}
      />
    </form>
  );
}

function formatarData(iso: string) {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano.slice(2)}`;
}

function FormularioTarefa({ tarefa, quadroId, grupos, pessoas, aoFechar, recarregar }: {
  tarefa: Tarefa | 'nova' | null; quadroId: string; grupos: Grupo[]; pessoas: Pessoa[];
  aoFechar: () => void; recarregar: () => Promise<void>;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const atual = tarefa === 'nova' ? null : tarefa;
  const permissoes = usePermissoes();
  const responsavelAtual = atual?.responsavel_id ? pessoas.find((p) => p.id === atual.responsavel_id) : undefined;
  const podeEditar = !atual || permissoes.podeEditarTarefa(atual, responsavelAtual);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const texto = (campo: string) => { const v = f.get(campo); return v ? String(v) : null; };
    try {
      /* Campo desabilitado nao entra no FormData: quem so pode mudar a
         situacao (responsavel sem papel de editor) manda so a situacao,
         sem arriscar apagar titulo/grupo/etc. com um valor vazio. */
      const dados = podeEditar
        ? {
            quadro_id: quadroId,
            titulo: texto('titulo') ?? '',
            descricao: texto('descricao'),
            grupo_id: texto('grupo_id'),
            responsavel_id: texto('responsavel_id'),
            status: f.get('status') as StatusTarefa,
            prioridade: texto('prioridade') as Prioridade,
            prazo: texto('prazo'),
          }
        : { quadro_id: quadroId, titulo: atual!.titulo, status: f.get('status') as StatusTarefa };
      await salvarTarefa(dados, atual?.id);
      await recarregar();
      aoFechar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  return (
    <Modal aberto={!!tarefa} aoFechar={aoFechar} titulo={atual ? 'Tarefa' : 'Nova tarefa'} largura="max-w-lg">
      <form key={atual?.id ?? 'nova'} onSubmit={enviar} className="space-y-3">
        <Campo rotulo="Título *">
          <input name="titulo" required defaultValue={atual?.titulo ?? ''} className="campo" disabled={!podeEditar} />
        </Campo>
        <Campo rotulo="Descrição">
          <textarea name="descricao" defaultValue={atual?.descricao ?? ''} className="campo" rows={3} disabled={!podeEditar} />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Grupo">
            <select name="grupo_id" defaultValue={atual?.grupo_id ?? grupos[0]?.id ?? ''} className="campo" disabled={!podeEditar}>
              <option value="">Sem grupo</option>
              {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Responsável">
            <select name="responsavel_id" defaultValue={atual?.responsavel_id ?? ''} className="campo" disabled={!podeEditar}>
              <option value="">Sem responsável</option>
              {pessoas.filter((p) => p.ativo).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Situação">
            <select name="status" defaultValue={atual?.status ?? 'pendente'} className="campo">
              {STATUS_TAREFA.map((s) => <option key={s} value={s}>{rotuloStatus[s]}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Prioridade">
            <select name="prioridade" defaultValue={atual?.prioridade ?? 'media'} className="campo" disabled={!podeEditar}>
              {PRIORIDADES.map((p) => <option key={p} value={p}>{rotuloPrioridade[p]}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Prazo">
            <input type="date" name="prazo" defaultValue={atual?.prazo ?? ''} className="campo" disabled={!podeEditar} />
          </Campo>
        </div>
        {!podeEditar && (
          <Aviso tipo="atencao">
            Você só pode mudar a situação desta tarefa — ela é de outro responsável.
          </Aviso>
        )}
        {erro && <Aviso>{erro}</Aviso>}
        <div className="flex items-center justify-between gap-2">
          {atual && podeEditar && (
            <button
              type="button" className="botao-perigo"
              onClick={async () => {
                if (!confirm('Excluir esta tarefa?')) return;
                try { await excluirTarefa(atual.id); await recarregar(); aoFechar(); }
                catch (falha) { setErro(mensagemDeErro(falha)); }
              }}
            >Excluir</button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" className="botao-neutro" onClick={aoFechar}>Cancelar</button>
            <button type="submit" className="botao-primario">Salvar</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
