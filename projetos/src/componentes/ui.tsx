import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useSituacoes } from '@/estado/configuracao';
import { situacaoDe } from '@/dominio/situacoes';
import { coresPrioridade } from '@/config/tokens';
import { coresSaude, rotuloSaude } from '@/dominio/regras';
import type { Saude } from '@/dominio/regras';
import type { Prioridade, StatusProjeto } from '@/dominio/tipos';
import { rotuloPrioridade } from '@/dominio/tipos';

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

/* Nome e cor da situacao vem da configuracao da equipe; sem ela (ou
   antes de carregar) valem os de fabrica. */
export const SeloStatus = ({ status }: { status: StatusProjeto }) => {
  /* A leitura do contexto e so para redesenhar quando a configuracao
     muda; o valor em si vem do registro do dominio. */
  useSituacoes();
  const s = situacaoDe(status);
  return <Selo cor={s.cor}>{s.rotulo}</Selo>;
};

export const SeloPrioridade = ({ prioridade }: { prioridade: Prioridade }) => (
  <Selo cor={coresPrioridade[prioridade]}>{rotuloPrioridade[prioridade]}</Selo>
);

export const SeloSaude = ({ saude }: { saude: Saude }) => (
  <Selo cor={coresSaude[saude]}>{rotuloSaude[saude]}</Selo>
);

export function Barra({ valor, cor = '#6D28D9', esperado }: { valor: number; cor?: string; esperado?: number | null }) {
  return (
    <div className="relative h-2 w-full rounded-full bg-linha">
      <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(100, valor)}%`, backgroundColor: cor }} />
      {/* Marca do ritmo esperado: o quanto do prazo ja passou. */}
      {esperado != null && (
        <span
          className="absolute -top-0.5 h-3 w-0.5 rounded bg-tinta-suave"
          style={{ left: `calc(${Math.min(100, esperado)}% - 1px)` }}
          title={`Esperado pelo prazo: ${esperado}%`}
        />
      )}
    </div>
  );
}

export function Indicador({ titulo, valor, detalhe, cor }: { titulo: string; valor: ReactNode; detalhe?: string; cor?: string }) {
  return (
    <div className="cartao p-4">
      <p className="rotulo">{titulo}</p>
      <p className="font-titulo text-2xl font-extrabold" style={{ color: cor ?? '#161933' }}>{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-tinta-suave">{detalhe}</p>}
    </div>
  );
}

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
    info: 'border-roxo/30 bg-roxo-suave text-roxo-escuro',
    sucesso: 'border-verde/30 bg-verde/5 text-verde',
    /* Nem erro nem tudo certo: "deu para preencher, mas falta coisa". */
    atencao: 'border-ambar/40 bg-ambar/10 text-ambar',
  }[tipo];
  return <div className={`rounded-lg border px-3 py-2 text-sm ${estilo}`}>{children}</div>;
}

export const Vazio = ({ children }: { children: ReactNode }) => (
  <p className="py-8 text-center text-sm text-tinta-suave">{children}</p>
);

export const Carregando = () => <Vazio>Carregando…</Vazio>;
