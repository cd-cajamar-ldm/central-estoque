/* Ilustracao da capa de cada quadro na lista de Quadros. O tema sai do
   nome e da descricao do quadro (palavras-chave), entao nao ha nada para
   cadastrar: "Controle Estoque" ganha prateleiras com caixas, "Projetos"
   ganha um cronograma, e assim por diante. Desenhos em linha branca
   para assentar sobre o degrade colorido da capa, em qualquer cor. */

export type TemaQuadro =
  | 'estoque' | 'projetos' | 'relatorios' | 'transporte'
  | 'manutencao' | 'pessoas' | 'tarefas';

/* Ordem importa: o primeiro tema com palavra encontrada vence. */
const PALAVRAS: [TemaQuadro, string[]][] = [
  ['estoque', ['estoque', 'inventario', 'armazem', 'deposito', 'almox', 'contagem', 'endereco', 'picking', 'acuracia', 'transitorio', 'descasad', 'net']],
  ['transporte', ['transporte', 'expedicao', 'recebimento', 'entrega', 'doca', 'frete', 'carga', 'caminhao', 'logistica', 'coleta']],
  ['manutencao', ['manutencao', 'oficina', 'elevador', 'equipamento', 'empilhadeira', 'reparo', 'conserto', 'predial']],
  ['relatorios', ['relatorio', 'report', 'analise', 'indicador', 'kpi', 'dashboard', 'painel', 'grafico', 'perda', 'ganho']],
  ['projetos', ['projeto', 'apresentacao', 'planejamento', 'cronograma', 'iniciativa', 'melhoria', 'implantacao']],
  ['pessoas', ['pessoa', 'equipe', 'time', 'treinamento', 'rh', 'escala', 'turno', 'reuniao']],
];

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function temaDoQuadro(nome: string, descricao?: string | null): TemaQuadro {
  const texto = semAcento(`${nome} ${descricao ?? ''}`);
  for (const [tema, palavras] of PALAVRAS) {
    if (palavras.some((p) => new RegExp(`\\b${p}`).test(texto))) return tema;
  }
  return 'tarefas';
}

const traco = { fill: 'none', stroke: 'white', strokeWidth: 2.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const cheio = { fill: 'white', fillOpacity: 0.22 };

const DESENHOS: Record<TemaQuadro, JSX.Element> = {
  /* Porta-palete de dois niveis com caixas e uma empilhadeira de mao. */
  estoque: (
    <g>
      <path {...traco} d="M24 86V14M104 86V14M24 50h80M24 84h80" />
      <rect {...cheio} {...traco} x="30" y="26" width="22" height="22" rx="2" />
      <path {...traco} d="M41 26v8" />
      <rect {...cheio} {...traco} x="56" y="32" width="18" height="16" rx="2" />
      <rect {...cheio} {...traco} x="78" y="22" width="22" height="26" rx="2" />
      <path {...traco} d="M89 22v8" />
      <rect {...cheio} {...traco} x="30" y="58" width="30" height="24" rx="2" />
      <path {...traco} d="M45 58v8" />
      <rect {...cheio} {...traco} x="64" y="64" width="16" height="18" rx="2" />
      <rect {...cheio} {...traco} x="84" y="60" width="16" height="22" rx="2" />
      <path {...traco} d="M126 30v52M126 82h22M120 82h6M126 40l-10 6" />
      <circle {...traco} cx="132" cy="86" r="3" />
      <circle {...traco} cx="146" cy="86" r="3" />
    </g>
  ),
  /* Cronograma: barras de Gantt e bandeira de entrega. */
  projetos: (
    <g>
      <path {...traco} d="M22 18v70M22 88h128" />
      <rect {...cheio} {...traco} x="30" y="24" width="44" height="10" rx="5" />
      <rect {...cheio} {...traco} x="56" y="42" width="52" height="10" rx="5" />
      <rect {...cheio} {...traco} x="90" y="60" width="34" height="10" rx="5" />
      <path {...traco} d="M138 78V30" />
      <path {...cheio} {...traco} d="M138 30h18l-5 7 5 7h-18" />
      <path {...traco} d="M30 76l6 6 10-12" />
    </g>
  ),
  /* Grafico de barras com lupa. */
  relatorios: (
    <g>
      <path {...traco} d="M22 88h120" />
      <rect {...cheio} {...traco} x="30" y="58" width="16" height="30" rx="2" />
      <rect {...cheio} {...traco} x="54" y="40" width="16" height="48" rx="2" />
      <rect {...cheio} {...traco} x="78" y="50" width="16" height="38" rx="2" />
      <rect {...cheio} {...traco} x="102" y="24" width="16" height="64" rx="2" />
      <path {...traco} d="M30 44l26-16 22 10 30-24" />
      <circle {...cheio} {...traco} cx="138" cy="40" r="13" />
      <path {...traco} d="M147 50l11 11" strokeWidth={4} />
    </g>
  ),
  /* Caminhao bau. */
  transporte: (
    <g>
      <rect {...cheio} {...traco} x="20" y="26" width="76" height="46" rx="3" />
      <path {...traco} d="M38 26v46M58 26v46M78 26v46" strokeOpacity={0.5} />
      <path {...cheio} {...traco} d="M96 40h26l14 16v16H96z" />
      <path {...traco} d="M104 46h14l8 10h-22z" />
      <circle {...cheio} {...traco} cx="42" cy="78" r="8" />
      <circle {...cheio} {...traco} cx="118" cy="78" r="8" />
      <path {...traco} d="M8 88h150" strokeOpacity={0.6} />
    </g>
  ),
  /* Engrenagem e chave inglesa cruzadas. */
  manutencao: (
    <g>
      <circle {...cheio} {...traco} cx="62" cy="50" r="22" />
      <circle {...traco} cx="62" cy="50" r="8" />
      <path {...traco} d="M62 20v8M62 72v8M32 50h8M84 50h8M41 29l6 6M77 65l6 6M41 71l6-6M77 35l6-6" strokeWidth={5} />
      <path {...cheio} {...traco} d="M104 82l30-30a12 12 0 0 1 16-16l-8 8 4 6 6 2 8-8a12 12 0 0 1-16 16l-30 30a5 5 0 0 1-7 0l-3-3a5 5 0 0 1 0-7z" />
    </g>
  ),
  /* Tres pessoas. */
  pessoas: (
    <g>
      <circle {...cheio} {...traco} cx="80" cy="34" r="12" />
      <path {...cheio} {...traco} d="M58 82c0-16 10-26 22-26s22 10 22 26" />
      <circle {...cheio} {...traco} cx="42" cy="42" r="9" />
      <path {...cheio} {...traco} d="M26 82c0-12 7-20 16-20 5 0 9 2 12 5" />
      <circle {...cheio} {...traco} cx="118" cy="42" r="9" />
      <path {...cheio} {...traco} d="M134 82c0-12-7-20-16-20-5 0-9 2-12 5" />
    </g>
  ),
  /* Prancheta com lista de afazeres (quadro sem tema reconhecido). */
  tarefas: (
    <g>
      <rect {...cheio} {...traco} x="44" y="16" width="70" height="72" rx="6" />
      <rect {...traco} x="66" y="10" width="26" height="12" rx="4" />
      <path {...traco} d="M56 36l4 4 8-8M76 36h26M56 54l4 4 8-8M76 54h26M58 70h8M76 72h18" />
      <path {...traco} d="M128 70l18-18 6 6-18 18-8 2z" />
    </g>
  ),
};

export default function IlustracaoQuadro({ tema, className }: { tema: TemaQuadro; className?: string }) {
  return (
    <svg viewBox="0 0 170 96" className={className} aria-hidden="true">
      {DESENHOS[tema]}
    </svg>
  );
}
