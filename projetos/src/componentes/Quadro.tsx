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
  /* Rodape opcional da coluna, para o "+ Adicionar" de cada situacao. */
  rodape?: (coluna: ColunaDoQuadro) => ReactNode;
  /* Trocar a coluna de lugar. Quando existe, o cabecalho ganha as setas
     — e a ordem do quadro deixa de exigir uma ida a configuracao. */
  aoReordenar?: (coluna: ColunaDoQuadro, direcao: -1 | 1) => void | Promise<void>;
  /* Soltar um cartao antes de outro (ou no fim, com antesDeId nulo) —
     tanto reorganizar dentro da mesma coluna quanto trocar de coluna numa
     posicao especifica. Sem isto, soltar so muda a coluna (aoMover). */
  aoReordenarCartao?: (item: T, coluna: string, antesDeId: string | null) => void | Promise<void>;
}

/* Quadro de colunas com arrastar e soltar, no espirito do Jira. Usa a
   API de arrastar do proprio navegador em vez de biblioteca: sao poucas
   dezenas de linhas e nada para manter atualizado.

   No celular nao ha arrastar - por isso todo cartao tambem tem o seletor
   de situacao na propria lista, que continua sendo o caminho garantido. */
const CHAVE_RECOLHIDAS = 'projetos.colunas-recolhidas';

export default function Quadro<T extends CartaoDoQuadro>({
  colunas, itens, aoMover, aoAbrir, cartao, rodape, aoReordenar, aoReordenarCartao,
}: Props<T>) {
  const [arrastado, setArrastado] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  /* Cartao sobre o qual se esta arrastando, e se o solto entra antes ou
     depois dele — e o que desenha a linha indicando onde o cartao vai
     parar. */
  const [alvoCartao, setAlvoCartao] = useState<{ id: string; pos: 'antes' | 'depois' } | null>(null);
  /* Coluna recolhida vira uma faixa fina com o nome em pe e a contagem.
     Com muitas situacoes, encolher "Cancelado" e "Concluido" e o que
     faz as colunas do meio caberem na tela sem rolagem lateral. A
     escolha e de quem esta olhando, entao fica no navegador. */
  const [recolhidas, setRecolhidas] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(CHAVE_RECOLHIDAS) ?? '[]') as string[]; }
    catch { return []; }
  });

  function alternarRecolhida(id: string) {
    setRecolhidas((atual) => {
      const nova = atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id];
      try { localStorage.setItem(CHAVE_RECOLHIDAS, JSON.stringify(nova)); } catch { /* só não lembra */ }
      return nova;
    });
  }

  return (
    /* A altura da caixa e limitada de proposito: com o quadro inteiro
       rolando na pagina, a barra de rolagem lateral ficava la embaixo, e
       ver a coluna da direita exigia descer, rolar e subir de novo.
       Presa a 70% da altura da tela, a barra fica sempre a vista e as
       colunas rolam por dentro. */
    <div data-quadro="colunas" className="max-h-[70vh] overflow-auto">
      <div className="flex min-w-max gap-3 p-3">
        {colunas.map((coluna, indice) => {
          const daColuna = itens.filter((i) => i.coluna === coluna.id);
          const recolhida = recolhidas.includes(coluna.id);

          /* Recolhida, a coluna continua aceitando cartao arrastado: e
             comum querer jogar algo em "Concluido" sem precisar abrir a
             coluna de novo. */
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
                  alvo === coluna.id ? 'border-roxo bg-roxo-suave' : 'border-linha bg-papel hover:border-roxo-claro'
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
                /* Disparado so quando o solto cai no fundo da coluna, fora de
                   qualquer cartao — sobre um cartao quem responde e o proprio
                   cartao, que impede isto de rodar tambem (stopPropagation). */
                if (aoReordenarCartao) void aoReordenarCartao(item, coluna.id, null);
                else if (item.coluna !== coluna.id) void aoMover(item, coluna.id);
              }}
              className={`flex w-64 shrink-0 flex-col rounded-xl border p-2 transition ${
                alvo === coluna.id ? 'border-roxo bg-roxo-suave' : 'border-linha bg-papel'
              }`}
            >
              {/* O titulo da coluna acompanha a rolagem de cima para
                  baixo: com muitos cartoes, saber em que coluna se esta
                  e metade da leitura do quadro. */}
              <div className="sticky top-0 z-10 mb-2 flex items-center gap-2 rounded-lg bg-papel/95 px-1 py-1 backdrop-blur">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: coluna.cor }} />
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-tinta-suave">
                  {coluna.rotulo}
                </span>
                <span className="ml-auto text-[11px] font-bold text-tinta-suave">{daColuna.length}</span>
                <button
                  className="rounded px-1 text-xs font-bold text-tinta-suave hover:bg-white hover:text-roxo-escuro"
                  onClick={() => alternarRecolhida(coluna.id)}
                  title={`Recolher ${coluna.rotulo}`}
                >«</button>
                {aoReordenar && (
                  <span className="flex items-center gap-0.5">
                    <button
                      className="rounded px-1 text-xs font-bold text-tinta-suave hover:bg-white hover:text-roxo-escuro disabled:opacity-30"
                      disabled={indice === 0}
                      onClick={() => void aoReordenar(coluna, -1)}
                      title={`Mover ${coluna.rotulo} para a esquerda`}
                    >‹</button>
                    <button
                      className="rounded px-1 text-xs font-bold text-tinta-suave hover:bg-white hover:text-roxo-escuro disabled:opacity-30"
                      disabled={indice === colunas.length - 1}
                      onClick={() => void aoReordenar(coluna, 1)}
                      title={`Mover ${coluna.rotulo} para a direita`}
                    >›</button>
                  </span>
                )}
              </div>

              <div className="flex-1 space-y-2">
                {daColuna.map((item, indiceCartao) => (
                  <div key={item.id}>
                    {alvoCartao?.id === item.id && alvoCartao.pos === 'antes' && (
                      <div className="mb-2 h-1 rounded-full bg-roxo" />
                    )}
                    <div
                      draggable
                      onDragStart={() => setArrastado(item.id)}
                      onDragEnd={() => { setArrastado(null); setAlvo(null); setAlvoCartao(null); }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        /* Sem aoReordenarCartao (quadro de tarefas) nao ha onde
                           gravar a posicao — a linha so apareceria e nunca
                           surtiria efeito. */
                        if (!aoReordenarCartao || arrastado === item.id) return;
                        const retangulo = e.currentTarget.getBoundingClientRect();
                        const meio = retangulo.top + retangulo.height / 2;
                        setAlvoCartao({ id: item.id, pos: e.clientY < meio ? 'antes' : 'depois' });
                      }}
                      onDragLeave={() => setAlvoCartao((atual) => (atual?.id === item.id ? null : atual))}
                      onDrop={(e) => {
                        e.preventDefault();
                        /* Para o drop da coluna (que so acrescenta no fim) nao
                           rodar tambem e desfazer a posicao escolhida aqui. */
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
                      <div className="mt-2 h-1 rounded-full bg-roxo" />
                    )}
                  </div>
                ))}
                {!daColuna.length && (
                  <p className="rounded-lg border border-dashed border-linha py-4 text-center text-[11px] text-tinta-suave">
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
  );
}
