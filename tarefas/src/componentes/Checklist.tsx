import { useState } from 'react';
import type { ItemChecklist } from '@/dominio/tipos';

/* Quantos itens estao feitos, para a barra do formulario e o selo do
   cartao ("2/5"). Sem itens, total 0: quem chama decide nao mostrar. */
export function progressoDoChecklist(itens: ItemChecklist[] | null | undefined) {
  const lista = itens ?? [];
  return { feitos: lista.filter((i) => i.feito).length, total: lista.length };
}

const novoId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/* Checklist da tarefa: marcar, editar e remover itens, e adicionar um
   por vez (Enter) ou varios de uma vez colando uma lista com um item
   por linha — do e-mail, do Excel ou do ClickUp. Quem so pode marcar
   (responsavel sem papel de editor) nao edita nem remove texto. */
export default function Checklist({ itens, aoMudar, podeEditarTexto }: {
  itens: ItemChecklist[]; aoMudar: (itens: ItemChecklist[]) => void; podeEditarTexto: boolean;
}) {
  const [novo, setNovo] = useState('');
  const { feitos, total } = progressoDoChecklist(itens);

  function adicionar(textos: string[]) {
    /* Tira marcadores comuns de lista colada: "-", "*", "•", "1.", "[ ]". */
    const limpos = textos
      .map((t) => t.replace(/^\s*(?:[-*•]|\d+[.)]|\[\s?[xX]?\s?\])\s*/, '').trim())
      .filter(Boolean);
    if (!limpos.length) return;
    aoMudar([...itens, ...limpos.map((texto) => ({ id: novoId(), texto, feito: false }))]);
    setNovo('');
  }

  const mudar = (id: string, parte: Partial<ItemChecklist>) =>
    aoMudar(itens.map((i) => (i.id === id ? { ...i, ...parte } : i)));

  return (
    <div className="rounded-lg border border-linha bg-white p-3">
      {total > 0 && (
        <div className="mb-2.5 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-linha">
            <div
              className="h-full rounded-full bg-sucesso transition-[width] duration-300"
              style={{ width: `${(feitos / total) * 100}%` }}
            />
          </div>
          <span className="text-xs font-bold tabular-nums text-tinta-suave">{feitos} de {total}</span>
        </div>
      )}

      <ul className="space-y-1">
        {itens.map((item) => (
          <li key={item.id} className="group flex items-center gap-2 rounded-md px-1 hover:bg-papel">
            <input
              type="checkbox" checked={item.feito}
              onChange={(e) => mudar(item.id, { feito: e.target.checked })}
              className="h-4 w-4 shrink-0 cursor-pointer accent-[#1F8A52]"
              aria-label={`Marcar "${item.texto}"`}
            />
            <input
              value={item.texto} disabled={!podeEditarTexto}
              onChange={(e) => mudar(item.id, { texto: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
              className={`min-w-0 flex-1 bg-transparent py-1 text-sm outline-none disabled:cursor-default ${
                item.feito ? 'text-tinta-suave line-through' : 'text-tinta'
              }`}
            />
            {podeEditarTexto && (
              <button
                type="button" onClick={() => aoMudar(itens.filter((i) => i.id !== item.id))}
                className="shrink-0 px-1 text-tinta-suave opacity-0 transition hover:text-vermelho group-hover:opacity-100 focus:opacity-100"
                aria-label={`Remover "${item.texto}"`}
              >✕</button>
            )}
          </li>
        ))}
      </ul>

      {podeEditarTexto && (
        <input
          value={novo} onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault(); /* Enter aqui adiciona o item, nao salva a tarefa */
            adicionar([novo]);
          }}
          onPaste={(e) => {
            const colado = e.clipboardData.getData('text');
            if (!colado.includes('\n')) return;
            e.preventDefault();
            adicionar(colado.split(/\r?\n/));
          }}
          placeholder={total ? '+ Adicionar item' : '+ Adicionar item (Enter) — ou cole uma lista, um item por linha'}
          className="mt-1.5 w-full rounded-md border border-dashed border-linha px-2 py-1.5 text-sm outline-none placeholder:text-tinta-suave focus:border-laranja"
        />
      )}
    </div>
  );
}
