import { useState } from 'react';
import { Aviso, Campo, Modal, Vazio } from '@/componentes/ui';
import { excluirQuadro, mensagemDeErro, salvarQuadro } from '@/estado/dados';
import { usePermissoes } from '@/estado/sessao';
import { CORES_QUADRO } from '@/dominio/tipos';
import type { Quadro } from '@/dominio/tipos';

interface Props {
  quadros: Quadro[];
  aoAbrir: (quadro: Quadro) => void;
  recarregar: () => Promise<void>;
}

export default function ListaQuadros({ quadros, aoAbrir, recarregar }: Props) {
  const permissoes = usePermissoes();
  const [emEdicao, setEmEdicao] = useState<Quadro | 'novo' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const visiveis = quadros.filter((q) => !q.arquivado);

  return (
    <div className="space-y-4">
      {erro && <Aviso>{erro}</Aviso>}

      <div className="flex items-center justify-between">
        <h2 className="font-titulo text-lg font-extrabold">Quadros</h2>
        {permissoes.podeCriar && (
          <button className="botao-primario" onClick={() => setEmEdicao('novo')}>+ Novo quadro</button>
        )}
      </div>

      {visiveis.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visiveis.map((q) => (
            <div key={q.id} className="cartao group relative overflow-hidden">
              <div className="h-1.5" style={{ backgroundColor: q.cor }} />
              <button className="w-full p-4 text-left" onClick={() => aoAbrir(q)}>
                <h3 className="font-titulo text-base font-extrabold">{q.nome}</h3>
                <p className="mt-1 line-clamp-2 min-h-[2.5em] text-sm text-tinta-suave">
                  {q.descricao || 'Sem descrição.'}
                </p>
              </button>
              {permissoes.podeEditarQuadro(q) && (
                <div className="absolute right-3 top-3 hidden gap-2 group-hover:flex">
                  <button
                    className="rounded-full bg-white/90 px-2 py-1 text-xs font-bold text-tinta-suave shadow-card hover:text-laranja-escuro"
                    onClick={() => setEmEdicao(q)}
                  >Editar</button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="cartao">
          <Vazio>
            {permissoes.podeCriar
              ? 'Nenhum quadro ainda — crie o primeiro para organizar as tarefas da equipe.'
              : 'Nenhum quadro foi criado ainda.'}
          </Vazio>
        </div>
      )}

      <FormularioQuadro
        quadro={emEdicao} aoFechar={() => setEmEdicao(null)} recarregar={recarregar}
        aoExcluir={async (id) => {
          try { await excluirQuadro(id); await recarregar(); setEmEdicao(null); }
          catch (falha) { setErro(mensagemDeErro(falha)); }
        }}
      />
    </div>
  );
}

function FormularioQuadro({ quadro, aoFechar, recarregar, aoExcluir }: {
  quadro: Quadro | 'novo' | null; aoFechar: () => void; recarregar: () => Promise<void>;
  aoExcluir: (id: string) => Promise<void>;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [cor, setCor] = useState(CORES_QUADRO[0]);
  const atual = quadro === 'novo' ? null : quadro;

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await salvarQuadro({
        nome: String(f.get('nome')),
        descricao: String(f.get('descricao')) || null,
        cor: atual?.cor ?? cor,
      }, atual?.id);
      await recarregar();
      aoFechar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  return (
    <Modal aberto={!!quadro} aoFechar={aoFechar} titulo={atual ? 'Editar quadro' : 'Novo quadro'} largura="max-w-lg">
      <form key={atual?.id ?? 'novo'} onSubmit={enviar} className="space-y-3">
        <Campo rotulo="Nome *">
          <input name="nome" required defaultValue={atual?.nome ?? ''} className="campo" placeholder="Ex.: Manutenção predial" />
        </Campo>
        <Campo rotulo="Descrição">
          <textarea name="descricao" defaultValue={atual?.descricao ?? ''} className="campo" rows={2} />
        </Campo>
        <Campo rotulo="Cor">
          <div className="flex flex-wrap gap-2">
            {CORES_QUADRO.map((c) => (
              <button
                type="button" key={c} onClick={() => setCor(c)}
                className={`h-7 w-7 rounded-full border-2 ${(atual?.cor ?? cor) === c ? 'border-tinta' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
                aria-label={`Cor ${c}`}
              />
            ))}
          </div>
        </Campo>
        {erro && <Aviso>{erro}</Aviso>}
        <div className="flex items-center justify-between gap-2">
          {atual && (
            <button
              type="button" className="botao-perigo"
              onClick={() => { if (confirm(`Excluir o quadro "${atual.nome}" e todas as suas tarefas?`)) void aoExcluir(atual.id); }}
            >Excluir quadro</button>
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
