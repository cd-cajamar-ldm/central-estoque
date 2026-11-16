import { useState } from 'react';
import type { Aba } from '@/lib/rota';

declare const __VERSAO__: string;

const MOBILE_QUERY = '(max-width:639px)';

const NAV: { id: Aba; rotulo: string; icone: JSX.Element }[] = [
  {
    id: 'quadros', rotulo: 'Quadros',
    icone: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="9.5" y="4" width="5" height="10" rx="1"/><rect x="16" y="4" width="5" height="13" rx="1"/></svg>,
  },
  {
    id: 'pessoas', rotulo: 'Pessoas',
    icone: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  },
];

/* Mesmo menu lateral da Oficina LDM (navy #0B1230, selo laranja da logo,
   pílula laranja no item ativo) usado em Inventário Rotativo — todo app
   novo da Central segue este layout, não o cabeçalho com abas que o
   módulo de Projetos usa. */
export default function Sidebar({ aba, onNavigate, mobileOpen, onFecharMobile }: {
  aba: Aba; onNavigate: (a: Aba) => void; mobileOpen: boolean; onFecharMobile: () => void;
}) {
  const [recolhido, setRecolhido] = useState(false);

  function alternar() {
    if (window.matchMedia(MOBILE_QUERY).matches) onFecharMobile();
    else setRecolhido((v) => !v);
  }

  const escondeQuandoRecolhido = recolhido ? 'sm:hidden' : '';

  return (
    <>
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[230px] flex-col overflow-hidden bg-navy text-white
          transition-transform duration-200 sm:static sm:z-auto sm:transition-[width]
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} sm:translate-x-0
          ${recolhido ? 'sm:w-14' : 'sm:w-[230px]'}`}
      >
        {/* Topo do menu com foto de planejamento (post-its num quadro), como o
            menu do Inventario Rotativo: marca em cima, nome do modulo embaixo.
            Recolhido, a foto vira so a faixa da logo. */}
        <div
          className={`relative flex shrink-0 flex-col justify-between bg-cover ${recolhido ? 'sm:h-auto' : ''} h-[170px]`}
          style={{
            backgroundImage: 'linear-gradient(180deg, rgba(0,18,82,.35) 0%, rgba(11,18,48,1) 100%), url(./fotos/projetos-menu.jpg)',
            backgroundPosition: 'center 35%',
          }}
        >
          <div className={`flex items-center gap-2.5 px-3.5 py-4 ${recolhido ? 'sm:flex-col sm:justify-center sm:gap-2 sm:py-3' : ''}`}>
            <button
              type="button" aria-label="Loja do Mecânico"
              className={`relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border-none p-0
                bg-[linear-gradient(145deg,#FF8A4C,#FE5000_55%,#C83812)] shadow-[0_10px_22px_-6px_rgba(254,80,0,.6)]`}
            >
              <img src="./brand/Logo_LDM_icon.png" alt="" className="relative z-[1] h-[86%] w-[86%] object-contain" />
            </button>
            <div className={`min-w-0 flex-1 ${escondeQuandoRecolhido}`}>
              <div className="font-titulo text-[15px] font-extrabold leading-tight text-white">OFICINA LDM</div>
              <div className="mt-0.5 whitespace-nowrap text-[10.5px] text-[#DCE1F7]">lugar de quem faz</div>
            </div>
            <button
              type="button" onClick={alternar} title="Recolher menu"
              className="ml-auto shrink-0 p-1 text-white/80 hover:text-white"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
          </div>
          <div className={`flex flex-col gap-0.5 px-4 pb-3.5 ${escondeQuandoRecolhido}`}>
            <b className="font-titulo text-lg font-bold text-white">Tarefas</b>
            <span className="text-xs text-[#DCE1F7]">CD Cajamar</span>
          </div>
        </div>

        <a
          href="../" className={`mx-3.5 mb-2 mt-2 flex shrink-0 items-center gap-2 rounded-[9px] px-2.5 py-1.5 text-xs font-semibold text-[#9BA2CC] hover:bg-white/5 hover:text-white ${escondeQuandoRecolhido}`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          <span>Voltar para a Central</span>
        </a>

        <nav className={`flex-1 space-y-0.5 overflow-y-auto px-3.5 pb-5 pt-1 ${recolhido ? 'sm:px-0' : ''}`}>
          {NAV.map((n) => (
            <button
              key={n.id} type="button"
              onClick={() => { onNavigate(n.id); onFecharMobile(); }}
              className={`flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2.5 text-left font-texto text-[13px] font-semibold transition
                ${aba === n.id ? 'bg-laranja/[.16] text-white' : 'text-[#9BA2CC] hover:bg-white/5 hover:text-white'}
                ${recolhido ? 'sm:justify-center sm:gap-0 sm:px-0 sm:py-2.5' : ''}`}
            >
              <span className={aba === n.id ? 'shrink-0 text-laranja opacity-100' : 'shrink-0 opacity-85'}>{n.icone}</span>
              <span className={escondeQuandoRecolhido}>{n.rotulo}</span>
            </button>
          ))}
        </nav>

        <div className={`mt-auto shrink-0 border-t border-white/10 px-4 py-4 text-[11px] text-[#6B74A8] ${escondeQuandoRecolhido}`}>
          Loja do Mecânico · CD Cajamar
          <div className="mt-0.5">versão {__VERSAO__}</div>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-[39] bg-black/40 sm:hidden" onClick={onFecharMobile} />
      )}
    </>
  );
}
