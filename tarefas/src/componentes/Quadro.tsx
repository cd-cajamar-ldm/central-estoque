import { useState } from 'react';
import type { ReactNode } from 'react';

export interface ColunaDoQuadro {
  id: string;
  rotulo: string;
  cor: string;
}

export interface CartaoDoQuadro {
  id: string;
  coluna: string;
}

interface Props<T extends CartaoDoQuadro> {
  colunas: ColunaDoQuadro[];
  itens: T[];
  aoMover: (item: T, coluna: string) => void | Promise<void>;
  aoAbrir?: (item: T) => void;
  cartao: (item: T) => ReactNode;
  rodape?: (coluna: ColunaDoQuadro) => ReactNode;
  /* Soltar um cartao antes de outro (ou no fim, com antesDeId nulo) —
     tanto reorganizar dentro da mesma coluna quanto trocar de coluna numa
     posicao especifica. Sem isto, soltar so muda a coluna (aoMover). */
  aoReordenarCartao?: (item: T, coluna: string, antesDeId: string | null) => void | Promise<void>;
}

/* Quadro de colunas com arrastar e soltar, no espirito do Jira — a mesma
   peca ja usada no quadro de atividades do modulo de Projetos. Usa a API
   de arrastar do proprio navegador em vez de biblioteca: sao poucas
   dezenas de linhas e nada para manter atualizado.

   No celular nao ha arrastar - por isso todo cartao tambem tem o seletor
   de situacao na propria lista, que continua sendo o caminho garantido. */
const CHAVE_RECOLHIDAS = 'tarefas.colunas-recolhidas';
const CHAVE_ZOOM = 'tarefas.quadro-zoom';
const ZOOM_MINIMO = 0.5;
const ZOOM_MAXIMO = 1.5;
const ZOOM_PASSO = 0.1;

export default function Quadro<T extends CartaoDoQuadro>({
  colunas, itens, aoMover, aoAbrir, cartao, rodape, aoReordenarCartao,
}: Props<T>) {
  const [arrastado, setArrastado] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [alvoCartao, setAlvoCartao] = useState<{ id: string; pos: 'antes' | 'depois' } | null>(null);
  const [recolhidas, setRecolhidas] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(CHAVE_RECOLHIDAS) ?? '[]') as string[]; }
    catch { return []; }
  });
  const [zoom, setZoom] = useState<number>(() => {
    try { return Number(localStorage.getItem(CHAVE_ZOOM)) || 1; }
    catch { return 1; }
  });

  function mudarZoom(novo: number) {
    const limitado = Math.round(Math.min(ZOOM_MAXIMO, Math.max(ZOOM_MINIMO, novo)) * 100) / 100;
    setZoom(limitado);
    try { localStorage.setItem(CHAVE_ZOOM, String(limitado)); } catch { /* só não lembra */ }
  }

  function alternarRecolhida(id: string) {
    setRecolhidas((atual) => {
      const nova = atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id];
      try { localStorage.setItem(CHAVE_RECOLHIDAS, JSON.stringify(nova)); } catch { /* só não lembra */ }
      return nova;
    });
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-end gap-1">
        <button
          className="rounded px-1.5 py-0.5 text-sm font-bold text-tinta-suave hover:bg-papel hover:text-laranja-escuro disabled:opacity-30"
          disabled={zoom <= ZOOM_MINIMO}
          onClick={() => mudarZoom(zoom - ZOOM_PASSO)}
          title="Diminuir o quadro"
        >−</button>
        <button
          className="w-11 rounded px-1 py-0.5 text-[11px] font-bold text-tinta-suave hover:bg-papel hover:text-laranja-escuro"
          onClick={() => mudarZoom(1)}
          title="Voltar ao tamanho normal"
        >{Math.round(zoom * 100)}%</button>
        <button
          className="rounded px-1.5 py-0.5 text-sm font-bold text-tinta-suave hover:bg-papel hover:text-laranja-escuro disabled:opacity-30"
          disabled={zoom >= ZOOM_MAXIMO}
          onClick={() => mudarZoom(zoom + ZOOM_PASSO)}
          title="Aumentar o quadro"
        >+</button>
      </div>
      <div data-quadro="colunas" className="max-h-[70vh] overflow-auto">
      <div
        className="flex min-w-max gap-3 p-3"
        style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: `${100 / zoom}%` }}
      >
        {colunas.map((coluna) => {
          const daColuna = itens.filter((i) => i.coluna === coluna.id);
          const recolhida = recolhidas.includes(coluna.id);

          if (recolhida) {
            return (
              <div
                key={coluna.id}
                onDragOver={(e) => { e.preventDefault(); setAlvo(coluna.id); }}
                onDragLeave={() => setAlvo((atual) => (atual === coluna.id ? null : atual))}
                onDrop={(e) => {
                  e.preventDefault();
                  setAlvo(null);
                  const item = itens.find((i) => i.id === arrastado);
                  setArrastado(null);
                  if (!item || item.coluna === coluna.id) return;
                  if (aoReordenarCartao) void aoReordenarCartao(item, coluna.id, null);
                  else void aoMover(item, coluna.id);
                }}
                onClick={() => alternarRecolhida(coluna.id)}
                title={`Abrir ${coluna.rotulo}`}
                className={`flex w-10 shrink-0 cursor-pointer flex-col items-center gap-2 rounded-xl border py-2 transition ${
                  alvo === coluna.id ? 'border-laranja bg-laranja/10' : 'border-coluna-borda bg-coluna hover:border-laranja/50'
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: coluna.cor }} />
                <span className="text-[11px] font-bold text-tinta-suave">{daColuna.length}</span>
                <span className="flex-1 text-[11px] font-extrabold uppercase tracking-wider text-tinta-suave [writing-mode:vertical-rl]">
                  {coluna.rotulo}
                </span>
                <span className="text-[11px] font-bold text-tinta-suave" aria-hidden>»</span>
              </div>
            );
          }

          return (
            <div
              key={coluna.id}
              onDragOver={(e) => { e.preventDefault(); setAlvo(coluna.id); }}
              onDragLeave={() => setAlvo((atual) => (atual === coluna.id ? null : atual))}
              onDrop={(e) => {
                e.preventDefault();
                setAlvo(null);
                setAlvoCartao(null);
                const item = itens.find((i) => i.id === arrastado);
                setArrastado(null);
                if (!item) return;
                if (aoReordenarCartao) void aoReordenarCartao(item, coluna.id, null);
                else if (item.coluna !== coluna.id) void aoMover(item, coluna.id);
              }}
              /* A coluna tem fundo proprio, mais escuro que o da pagina
                 (papel), e uma faixa no topo com a cor da situacao: com o
                 mesmo papel da pagina ela sumia e o quadro parecia vazio. */
              style={{ borderTopColor: alvo === coluna.id ? undefined : coluna.cor }}
              className={`flex w-64 shrink-0 flex-col rounded-xl border border-t-[3px] p-2 shadow-card transition ${
                alvo === coluna.id ? 'border-laranja bg-laranja/10' : 'border-coluna-borda bg-coluna'
              }`}
            >
              <div className="sticky top-0 z-10 mb-2 flex items-center gap-2 rounded-lg bg-coluna/95 px-1 py-1 backdrop-blur">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: coluna.cor }} />
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-tinta">
                  {coluna.rotulo}
                </span>
                <span className="ml-auto text-[11px] font-bold text-tinta-suave">{daColuna.length}</span>
                <button
                  className="rounded px-1 text-xs font-bold text-tinta-suave hover:bg-white hover:text-laranja-escuro"
                  onClick={() => alternarRecolhida(coluna.id)}
                  title={`Recolher ${coluna.rotulo}`}
                >«</button>
              </div>

              <div className="flex-1 space-y-2">
                {daColuna.map((item, indiceCartao) => (
                  <div key={item.id}>
                    {alvoCartao?.id === item.id && alvoCartao.pos === 'antes' && (
                      <div className="mb-2 h-1 rounded-full bg-laranja" />
                    )}
                    <div
                      draggable
                      onDragStart={() => setArrastado(item.id)}
                      onDragEnd={() => { setArrastado(null); setAlvo(null); setAlvoCartao(null); }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (!aoReordenarCartao || arrastado === item.id) return;
                        const retangulo = e.currentTarget.getBoundingClientRect();
                        const meio = retangulo.top + retangulo.height / 2;
                        setAlvoCartao({ id: item.id, pos: e.clientY < meio ? 'antes' : 'depois' });
                      }}
                      onDragLeave={() => setAlvoCartao((atual) => (atual?.id === item.id ? null : atual))}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const arrastadoItem = itens.find((i) => i.id === arrastado);
                        const pos = alvoCartao?.id === item.id ? alvoCartao.pos : 'antes';
                        setArrastado(null);
                        setAlvo(null);
                        setAlvoCartao(null);
                        if (!arrastadoItem || arrastadoItem.id === item.id) return;
                        if (aoReordenarCartao) {
                          const antesDeId = pos === 'antes' ? item.id : (daColuna[indiceCartao + 1]?.id ?? null);
                          void aoReordenarCartao(arrastadoItem, coluna.id, antesDeId);
                        } else if (arrastadoItem.coluna !== coluna.id) {
                          void aoMover(arrastadoItem, coluna.id);
                        }
                      }}
                      onClick={() => aoAbrir?.(item)}
                      className={`cursor-grab rounded-lg border border-linha bg-white p-2.5 shadow-card transition active:cursor-grabbing ${
                        arrastado === item.id ? 'opacity-50' : 'hover:shadow-alto'
                      }`}
                    >
                      {cartao(item)}
                    </div>
                    {alvoCartao?.id === item.id && alvoCartao.pos === 'depois' && (
                      <div className="mt-2 h-1 rounded-full bg-laranja" />
                    )}
                  </div>
                ))}
                {!daColuna.length && (
                  <p className="rounded-lg border border-dashed border-coluna-tracejado bg-white/60 py-4 text-center text-[11px] text-tinta-suave">
                    Arraste um cartão para cá
                  </p>
                )}
              </div>

              {rodape && <div className="pt-2">{rodape(coluna)}</div>}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
