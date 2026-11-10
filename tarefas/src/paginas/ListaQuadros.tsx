import { useEffect, useState } from 'react';
import { Aviso, Campo, Modal, Vazio } from '@/componentes/ui';
import { excluirQuadro, mensagemDeErro, salvarQuadro } from '@/estado/dados';
import { usePermissoes } from '@/estado/sessao';
import { CORES_QUADRO } from '@/dominio/tipos';
import IlustracaoQuadro, { temaDoQuadro } from '@/componentes/IlustracaoQuadro';
import type { Quadro } from '@/dominio/tipos';

/* Ate duas iniciais do nome, para o selo branco sobre a capa. Pula
   "de", "da", "do"...: "Relatorios da Controladoria" vira RC, nao RD. */
const MIUDAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
function iniciais(nome: string): string {
  return nome.trim().split(/\s+/)
    .filter((p) => !MIUDAS.has(p.toLowerCase()))
    .slice(0, 2).map((p) => p[0] ?? '').join('').toUpperCase();
}

const CHAVE_ORDEM = 'tarefas.ordemQuadros';
function lerOrdem(): string[] {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_ORDEM) ?? '[]');
    return Array.isArray(salvo) ? salvo.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

interface Props {
  quadros: Quadro[];
  aoAbrir: (quadro: Quadro) => void;
  recarregar: () => Promise<void>;
}

export default function ListaQuadros({ quadros, aoAbrir, recarregar }: Props) {
  const permissoes = usePermissoes();
  const [emEdicao, setEmEdicao] = useState<Quadro | 'novo' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /* Ordem pessoal dos quadros: guardada neste navegador, so para quem
     esta usando — cada pessoa poe na frente os quadros que mais usa,
     sem mudar a lista dos outros. Quadro novo (fora da lista salva)
     entra no fim, na ordem de sempre. */
  const [ordem, setOrdem] = useState<string[]>(lerOrdem);
  const [organizando, setOrganizando] = useState(false);
  const [arrastado, setArrastado] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const posicao = new Map(ordem.map((id, i) => [id, i]));
  const visiveis = quadros
    .filter((q) => !q.arquivado)
    .map((q, i) => ({ q, i }))
    .sort((a, b) => (posicao.get(a.q.id) ?? 1e6 + a.i) - (posicao.get(b.q.id) ?? 1e6 + b.i))
    .map(({ q }) => q);

  function salvarOrdem(ids: string[]) {
    setOrdem(ids);
    try { localStorage.setItem(CHAVE_ORDEM, JSON.stringify(ids)); } catch { /* so nao lembra */ }
  }
  /* Tira o quadro de onde esta e poe na posicao de destino. */
  function mover(id: string, destino: number) {
    const ids = visiveis.map((q) => q.id).filter((x) => x !== id);
    ids.splice(Math.max(0, Math.min(destino, ids.length)), 0, id);
    salvarOrdem(ids);
  }

  return (
    <div className="space-y-4">
      {erro && <Aviso>{erro}</Aviso>}

      <div className="flex items-center justify-between">
        <h2 className="font-titulo text-lg font-extrabold">Quadros</h2>
        <div className="flex items-center gap-2">
          {visiveis.length > 1 && (
            <button
              className={organizando ? 'botao bg-marca text-white hover:bg-marca/90' : 'botao-neutro'}
              onClick={() => setOrganizando((v) => !v)}
              title="Mudar a ordem dos quadros (só para você)"
            >{organizando ? 'Concluir' : '⇅ Organizar'}</button>
          )}
          {permissoes.podeCriar && !organizando && (
            <button className="botao-primario" onClick={() => setEmEdicao('novo')}>+ Novo quadro</button>
          )}
        </div>
      </div>
      {organizando && (
        <p className="-mt-1 text-sm text-tinta-suave">
          Arraste os quadros ou use as setas para mudar a ordem. A ordem fica salva só para você, neste navegador.
        </p>
      )}

      {visiveis.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visiveis.map((q, i) => (
            <div
              key={q.id}
              style={{ animationDelay: `${i * 70}ms` }}
              draggable={organizando}
              onDragStart={(e) => { setArrastado(q.id); e.dataTransfer.effectAllowed = 'move'; }}
              onDragEnd={() => { setArrastado(null); setAlvo(null); }}
              onDragOver={(e) => { if (!arrastado) return; e.preventDefault(); setAlvo(q.id); }}
              onDragLeave={() => setAlvo((atual) => (atual === q.id ? null : atual))}
              onDrop={(e) => {
                e.preventDefault();
                if (arrastado && arrastado !== q.id) mover(arrastado, i);
                setArrastado(null); setAlvo(null);
              }}
              className={`cartao group relative animate-entra overflow-hidden transition ${
                organizando
                  ? `cursor-grab ring-2 active:cursor-grabbing ${alvo === q.id && arrastado !== q.id ? 'ring-laranja' : 'ring-transparent'} ${arrastado === q.id ? 'opacity-40' : ''}`
                  : 'hover:-translate-y-1 hover:shadow-alto'
              }`}
            >
              {organizando && (
                <div className="absolute inset-x-0 top-0 z-[2] flex items-center justify-between bg-marca/85 px-2 py-1.5 text-white backdrop-blur-sm">
                  <button
                    type="button" disabled={i === 0} onClick={() => mover(q.id, i - 1)}
                    className="rounded-md px-2.5 py-1 text-sm font-bold hover:bg-white/20 disabled:opacity-30"
                    aria-label={`Mover ${q.nome} para a esquerda`}
                  >◀</button>
                  <span className="flex items-center gap-1.5 text-xs font-bold">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
                    {i + 1}º · arraste
                  </span>
                  <button
                    type="button" disabled={i === visiveis.length - 1} onClick={() => mover(q.id, i + 1)}
                    className="rounded-md px-2.5 py-1 text-sm font-bold hover:bg-white/20 disabled:opacity-30"
                    aria-label={`Mover ${q.nome} para a direita`}
                  >▶</button>
                </div>
              )}
              <button className="block w-full text-left" onClick={() => { if (!organizando) aoAbrir(q); }}>
                {/* Capa: degrade da cor do quadro para o azul da marca, listras
                    finas e uma ilustracao do assunto do quadro. */}
                <div
                  className="relative h-24 overflow-hidden"
                  style={{ backgroundImage: `linear-gradient(135deg, ${q.cor}, color-mix(in srgb, ${q.cor} 55%, #001A72))` }}
                >
                  <div className="absolute inset-0 bg-[repeating-linear-gradient(-45deg,rgba(255,255,255,.10)_0_2px,transparent_2px_14px)] transition-transform duration-700 group-hover:translate-x-7" />
                  <IlustracaoQuadro
                    tema={temaDoQuadro(q.nome, q.descricao)}
                    className="absolute -bottom-1 right-3 h-[92px] w-auto opacity-90 transition-transform duration-500 group-hover:-translate-y-1 group-hover:scale-105"
                  />
                </div>
                <span
                  className="absolute left-4 top-[74px] z-[1] grid h-11 w-11 place-items-center rounded-xl bg-white font-titulo text-sm font-extrabold shadow-card"
                  style={{ color: q.cor }}
                >{iniciais(q.nome)}</span>
                <div className="px-4 pb-4 pt-7">
                  <h3 className="font-titulo text-base font-extrabold">{q.nome}</h3>
                  <p className={`mt-1 line-clamp-2 min-h-[2.5em] text-sm text-tinta-suave ${q.descricao ? '' : 'italic opacity-75'}`}>
                    {q.descricao || 'Sem descrição.'}
                  </p>
                </div>
              </button>
              {permissoes.podeEditarQuadro(q) && !organizando && (
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

  /* A cor escolhida e o estado do formulario: ao abrir, comeca na cor
     atual do quadro (ou na primeira da paleta, num quadro novo). Antes
     a edicao sempre gravava a cor antiga e ignorava o clique. */
  useEffect(() => {
    if (quadro) setCor(atual?.cor ?? CORES_QUADRO[0]);
    setErro(null);
  }, [quadro]);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await salvarQuadro({
        nome: String(f.get('nome')),
        descricao: String(f.get('descricao')) || null,
        cor,
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
          <div className="flex flex-wrap items-center gap-2">
            {CORES_QUADRO.map((c) => (
              <button
                type="button" key={c} onClick={() => setCor(c)}
                className={`h-7 w-7 rounded-full transition hover:scale-110 ${
                  cor.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-tinta ring-offset-2' : ''
                }`}
                style={{ backgroundColor: c }}
                aria-label={`Cor ${c}`}
                aria-pressed={cor.toLowerCase() === c.toLowerCase()}
              />
            ))}
            {/* Qualquer outra cor, pelo seletor do proprio navegador. */}
            <label
              className={`relative flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-linha bg-white pl-1 pr-2.5 text-xs font-bold text-tinta-suave hover:border-laranja ${
                CORES_QUADRO.some((c) => c.toLowerCase() === cor.toLowerCase()) ? '' : 'ring-2 ring-tinta ring-offset-2'
              }`}
              title="Escolher outra cor"
            >
              <span className="h-5 w-5 rounded-full bg-[conic-gradient(#FE5000,#C79212,#16A34A,#0891B2,#2F6FE0,#7C3AED,#DB2777,#FE5000)]" />
              Outra
              <input
                type="color" value={cor} onChange={(e) => setCor(e.target.value.toUpperCase())}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                aria-label="Escolher outra cor"
              />
            </label>
          </div>
          {/* Previa: a capa do cartao com a cor escolhida. */}
          <div
            className="mt-3 flex h-10 items-center rounded-lg px-3 text-xs font-bold text-white"
            style={{ backgroundImage: `linear-gradient(135deg, ${cor}, color-mix(in srgb, ${cor} 55%, #001A72))` }}
          >Prévia da capa · {cor}</div>
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
