import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { coresPrioridade, coresStatus } from '@/config/tokens';
import { rotuloPrioridade, rotuloStatus } from '@/dominio/tipos';
import type { Prioridade, StatusTarefa } from '@/dominio/tipos';

export function Selo({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
      style={{ backgroundColor: `${cor}1A`, color: cor }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: cor }} />
      {children}
    </span>
  );
}

export const SeloStatus = ({ status }: { status: StatusTarefa }) => (
  <Selo cor={coresStatus[status]}>{rotuloStatus[status]}</Selo>
);

export const SeloPrioridade = ({ prioridade }: { prioridade: Prioridade }) => (
  <Selo cor={coresPrioridade[prioridade]}>{rotuloPrioridade[prioridade]}</Selo>
);

export function Modal({ titulo, aberto, aoFechar, children, largura = 'max-w-2xl' }: {
  titulo: string; aberto: boolean; aoFechar: () => void; children: ReactNode; largura?: string;
}) {
  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar(); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [aberto, aoFechar]);

  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy/40 p-4 backdrop-blur-sm" onClick={aoFechar}>
      <div className={`cartao my-8 w-full ${largura} p-5`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-titulo text-lg font-extrabold">{titulo}</h2>
          <button className="text-tinta-suave hover:text-tinta" onClick={aoFechar} aria-label="Fechar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="rotulo">{rotulo}</span>
      {children}
    </label>
  );
}

export function Aviso({ tipo = 'erro', children }: {
  tipo?: 'erro' | 'info' | 'sucesso' | 'atencao'; children: ReactNode;
}) {
  const estilo = {
    erro: 'border-vermelho/30 bg-vermelho/5 text-vermelho',
    info: 'border-verde/30 bg-verde-suave text-verde-escuro',
    sucesso: 'border-verde/30 bg-verde/5 text-verde-escuro',
    atencao: 'border-ambar/40 bg-ambar/10 text-ambar',
  }[tipo];
  return <div className={`rounded-lg border px-3 py-2 text-sm ${estilo}`}>{children}</div>;
}

export const Vazio = ({ children }: { children: ReactNode }) => (
  <p className="py-8 text-center text-sm text-tinta-suave">{children}</p>
);

export const Carregando = () => <Vazio>Carregando…</Vazio>;
