import { useMemo, useState } from 'react';
import { Aviso, Carregando, Vazio } from '@/componentes/ui';
import { progressoDoChecklist } from '@/componentes/Checklist';
import { useTodasTarefas } from '@/estado/dados';
import { deIso, diaLocalDe, diasEntre, formatarData, hojeIso, paraIso, somarDias } from '@/lib/datas';
import type { Pessoa, Quadro, Tarefa } from '@/dominio/tipos';

/* Balanco do periodo: o que foi entregue (e se no prazo), o que entrou,
   o que esta em aberto e atrasado agora, por pessoa e por quadro, e a
   lista de entregas com as datas. A ideia e ter numero e evidencia na
   mao para reuniao, e-mail ou cobranca — por isso o botao de copiar. */

type Periodo = 'dia' | 'semana' | 'mes' | 'ano';
const PERIODOS: { id: Periodo; rotulo: string }[] = [
  { id: 'dia', rotulo: 'Dia' }, { id: 'semana', rotulo: 'Semana' },
  { id: 'mes', rotulo: 'Mês' }, { id: 'ano', rotulo: 'Ano' },
];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const ABERTAS = ['pendente', 'em_andamento', 'bloqueada'];

/* Intervalo [inicio, fim] (inclusive) do periodo que contem a data. Semana de segunda a domingo. */
function intervalo(periodo: Periodo, ref: string): [string, string] {
  const d = deIso(ref);
  if (periodo === 'dia') return [ref, ref];
  if (periodo === 'semana') {
    const seg = somarDias(ref, -((d.getDay() + 6) % 7));
    return [seg, somarDias(seg, 6)];
  }
  if (periodo === 'mes') {
    return [paraIso(new Date(d.getFullYear(), d.getMonth(), 1)), paraIso(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
  }
  return [`${d.getFullYear()}-01-01`, `${d.getFullYear()}-12-31`];
}

function deslocar(periodo: Periodo, ref: string, passo: number): string {
  const d = deIso(ref);
  if (periodo === 'dia') return somarDias(ref, passo);
  if (periodo === 'semana') return somarDias(ref, 7 * passo);
  if (periodo === 'mes') return paraIso(new Date(d.getFullYear(), d.getMonth() + passo, 1));
  return paraIso(new Date(d.getFullYear() + passo, 0, 1));
}

function rotuloPeriodo(periodo: Periodo, [ini, fim]: [string, string]): string {
  const d = deIso(ini);
  if (periodo === 'dia') {
    return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  if (periodo === 'semana') return `${formatarData(ini)} a ${formatarData(fim, false)}`;
  if (periodo === 'mes') return `${MESES[d.getMonth()]} de ${d.getFullYear()}`;
  return String(d.getFullYear());
}

const pct = (parte: number, todo: number) => (todo ? Math.round((parte / todo) * 100) : 0);
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/* Resultado de uma entrega frente ao prazo. */
function resultado(t: Tarefa): { tipo: 'prazo' | 'atraso' | 'sem'; dias: number } {
  if (!t.prazo || !t.concluida_em) return { tipo: 'sem', dias: 0 };
  const dias = diasEntre(t.prazo, t.concluida_em);
  return dias > 0 ? { tipo: 'atraso', dias } : { tipo: 'prazo', dias };
}

export default function Resumo({ quadros, pessoas }: { quadros: Quadro[]; pessoas: Pessoa[] }) {
  const { tarefas, carregando, erro } = useTodasTarefas();
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [ref, setRef] = useState(hojeIso());
  const [quadroId, setQuadroId] = useState('todos');
  const [pessoaId, setPessoaId] = useState('todos');
  const [copiado, setCopiado] = useState(false);

  const hoje = hojeIso();
  const faixa = intervalo(periodo, ref);
  const [ini, fim] = faixa;
  const dentro = (iso: string | null | undefined) => !!iso && iso >= ini && iso <= fim;

  const nomeQuadro = useMemo(() => new Map(quadros.map((q) => [q.id, q.nome])), [quadros]);
  const corQuadro = useMemo(() => new Map(quadros.map((q) => [q.id, q.cor])), [quadros]);
  const nomePessoa = useMemo(() => new Map(pessoas.map((p) => [p.id, p.nome])), [pessoas]);

  const base = tarefas.filter((t) =>
    (quadroId === 'todos' || t.quadro_id === quadroId) &&
    (pessoaId === 'todos' || (pessoaId === 'sem' ? !t.responsavel_id : t.responsavel_id === pessoaId)));

  const entregues = base.filter((t) => t.status === 'concluida' && dentro(t.concluida_em))
    .sort((a, b) => (a.concluida_em! < b.concluida_em! ? -1 : 1));
  const noPrazo = entregues.filter((t) => resultado(t).tipo === 'prazo');
  const comAtraso = entregues.filter((t) => resultado(t).tipo === 'atraso');
  const comPrazo = noPrazo.length + comAtraso.length;
  const criadas = base.filter((t) => dentro(diaLocalDe(t.criado_em)));
  const abertas = base.filter((t) => ABERTAS.includes(t.status));
  const atrasadasAgora = abertas.filter((t) => t.prazo && t.prazo < hoje)
    .sort((a, b) => (a.prazo! < b.prazo! ? -1 : 1));
  const vencemNoPeriodo = abertas.filter((t) => dentro(t.prazo));
  const duracoes = entregues.map((t) => diasEntre(t.inicio ?? diaLocalDe(t.criado_em), t.concluida_em!)).filter((d) => d >= 0);
  const tempoMedio = duracoes.length ? duracoes.reduce((a, b) => a + b, 0) / duracoes.length : null;
  const itensChecklist = entregues.reduce((soma, t) => soma + progressoDoChecklist(t.checklist).feitos, 0);

  /* Barras de entregas: por dia (semana e mes) ou por mes (ano). */
  const barras = useMemo(() => {
    if (periodo === 'dia') return [];
    const porChave = (t: Tarefa) => (periodo === 'ano' ? t.concluida_em!.slice(0, 7) : t.concluida_em!);
    const chaves: { chave: string; rotulo: string; fimDeSemana?: boolean }[] = [];
    if (periodo === 'ano') {
      for (let m = 0; m < 12; m++) chaves.push({ chave: `${ini.slice(0, 4)}-${String(m + 1).padStart(2, '0')}`, rotulo: MESES_CURTOS[m] });
    } else {
      for (let dia = ini; dia <= fim; dia = somarDias(dia, 1)) {
        const d = deIso(dia);
        chaves.push({
          chave: dia,
          rotulo: periodo === 'semana' ? `${DIAS_SEMANA[d.getDay()]} ${d.getDate()}` : String(d.getDate()),
          fimDeSemana: d.getDay() === 0 || d.getDay() === 6,
        });
      }
    }
    return chaves.map((c) => {
      const doDia = entregues.filter((t) => porChave(t) === c.chave);
      return {
        ...c,
        prazo: doDia.filter((t) => resultado(t).tipo === 'prazo').length,
        atraso: doDia.filter((t) => resultado(t).tipo === 'atraso').length,
        sem: doDia.filter((t) => resultado(t).tipo === 'sem').length,
      };
    });
  }, [periodo, ini, fim, entregues]);
  const maiorBarra = Math.max(1, ...barras.map((b) => b.prazo + b.atraso + b.sem));

  /* Quebra por responsavel e por quadro. */
  function quebra(chave: (t: Tarefa) => string) {
    const linhas = new Map<string, { entregues: number; noPrazo: number; comPrazo: number; abertas: number; atrasadas: number }>();
    const linha = (k: string) => {
      if (!linhas.has(k)) linhas.set(k, { entregues: 0, noPrazo: 0, comPrazo: 0, abertas: 0, atrasadas: 0 });
      return linhas.get(k)!;
    };
    for (const t of entregues) {
      const l = linha(chave(t)); const r = resultado(t).tipo;
      l.entregues++; if (r !== 'sem') l.comPrazo++; if (r === 'prazo') l.noPrazo++;
    }
    for (const t of abertas) { const l = linha(chave(t)); l.abertas++; if (t.prazo && t.prazo < hoje) l.atrasadas++; }
    return [...linhas.entries()].sort((a, b) => b[1].entregues - a[1].entregues || b[1].abertas - a[1].abertas);
  }
  const porPessoa = quebra((t) => t.responsavel_id ?? '');
  const porQuadro = quebra((t) => t.quadro_id);

  const filtroTexto = [
    quadroId !== 'todos' && `quadro ${nomeQuadro.get(quadroId)}`,
    pessoaId !== 'todos' && (pessoaId === 'sem' ? 'sem responsável' : `responsável ${nomePessoa.get(pessoaId)}`),
  ].filter(Boolean).join(', ');

  function textoParaCopiar(): string {
    const linhas = [
      `Resumo de tarefas — ${rotuloPeriodo(periodo, faixa)}${filtroTexto ? ` (${filtroTexto})` : ''}`,
      '',
      `• Entregues: ${entregues.length}${comPrazo ? ` — ${pct(noPrazo.length, comPrazo)}% no prazo (${noPrazo.length} no prazo, ${comAtraso.length} com atraso)` : ''}`,
      `• Novas tarefas no período: ${criadas.length}`,
      `• Em aberto hoje: ${abertas.length}, sendo ${atrasadasAgora.length} atrasadas`,
      tempoMedio != null ? `• Tempo médio do início à conclusão: ${tempoMedio.toFixed(1).replace('.', ',')} dias` : '',
      '',
      entregues.length ? 'Entregas:' : '',
      ...entregues.map((t) => {
        const r = resultado(t);
        const sit = r.tipo === 'prazo' ? 'no prazo' : r.tipo === 'atraso' ? `${plural(r.dias, 'dia', 'dias')} de atraso` : 'sem prazo';
        return `  - ${formatarData(t.concluida_em!)} · ${t.titulo} (${nomeQuadro.get(t.quadro_id) ?? ''}${t.responsavel_id ? `, ${nomePessoa.get(t.responsavel_id)}` : ''}) — ${sit}`;
      }),
      atrasadasAgora.length ? '' : '',
      atrasadasAgora.length ? 'Atrasadas hoje:' : '',
      ...atrasadasAgora.map((t) => `  - ${t.titulo} — prazo ${formatarData(t.prazo!)} (${plural(diasEntre(t.prazo!, hoje), 'dia', 'dias')})${t.responsavel_id ? `, ${nomePessoa.get(t.responsavel_id)}` : ''}`),
    ];
    return linhas.filter((l, i, todas) => !(l === '' && todas[i - 1] === '')).join('\n').trim();
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(textoParaCopiar());
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      window.prompt('Copie o resumo:', textoParaCopiar());
    }
  }

  if (carregando) return <Carregando />;

  return (
    <div className="space-y-5">
      {erro && <Aviso>{erro}</Aviso>}

      {/* Filtros */}
      <div className="cartao flex flex-wrap items-center gap-3 p-3">
        <div className="flex rounded-lg bg-papel p-1">
          {PERIODOS.map((p) => (
            <button
              key={p.id} type="button" onClick={() => setPeriodo(p.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-bold transition ${periodo === p.id ? 'bg-marca text-white' : 'text-tinta-suave hover:text-tinta'}`}
            >{p.rotulo}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="botao-neutro px-2.5 py-1.5" onClick={() => setRef(deslocar(periodo, ref, -1))} aria-label="Período anterior">‹</button>
          <span className="min-w-[11rem] text-center font-titulo text-sm font-extrabold first-letter:uppercase">{rotuloPeriodo(periodo, faixa)}</span>
          <button type="button" className="botao-neutro px-2.5 py-1.5" onClick={() => setRef(deslocar(periodo, ref, 1))} aria-label="Próximo período">›</button>
          {!dentro(hoje) && (
            <button type="button" className="ml-1 text-xs font-bold text-laranja-escuro hover:underline" onClick={() => setRef(hoje)}>Hoje</button>
          )}
        </div>
        <select className="campo w-auto py-1.5" value={quadroId} onChange={(e) => setQuadroId(e.target.value)} aria-label="Quadro">
          <option value="todos">Todos os quadros</option>
          {quadros.filter((q) => !q.arquivado).map((q) => <option key={q.id} value={q.id}>{q.nome}</option>)}
        </select>
        <select className="campo w-auto py-1.5" value={pessoaId} onChange={(e) => setPessoaId(e.target.value)} aria-label="Responsável">
          <option value="todos">Todas as pessoas</option>
          <option value="sem">Sem responsável</option>
          {pessoas.filter((p) => p.ativo).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        <button type="button" className="botao-primario ml-auto" onClick={() => void copiar()}>
          {copiado ? 'Copiado ✓' : 'Copiar resumo'}
        </button>
      </div>

      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Entregues no período" valor={entregues.length} cor="#1F8A52"
          detalhe={comPrazo ? `${pct(noPrazo.length, comPrazo)}% no prazo` : entregues.length ? 'nenhuma tinha prazo' : 'nenhuma entrega'} />
        <Indicador rotulo="Entregues com atraso" valor={comAtraso.length} cor="#D2453A"
          detalhe={comAtraso.length ? `média de ${(comAtraso.reduce((s, t) => s + resultado(t).dias, 0) / comAtraso.length).toFixed(1).replace('.', ',')} dias` : 'nenhuma'} />
        <Indicador rotulo="Novas no período" valor={criadas.length} cor="#2F6FE0"
          detalhe={vencemNoPeriodo.length ? `${plural(vencemNoPeriodo.length, 'aberta vence', 'abertas vencem')} no período` : 'tarefas cadastradas'} />
        <Indicador rotulo="Atrasadas hoje" valor={atrasadasAgora.length} cor="#FE5000"
          detalhe={`de ${plural(abertas.length, 'tarefa em aberto', 'tarefas em aberto')}`} />
      </div>
      <p className="-mt-2 text-xs text-tinta-suave">
        {tempoMedio != null && <>Tempo médio do início à conclusão: <strong className="text-tinta">{tempoMedio.toFixed(1).replace('.', ',')} dias</strong>. </>}
        {itensChecklist > 0 && <>Itens de checklist feitos nas entregas: <strong className="text-tinta">{itensChecklist}</strong>. </>}
        "Atrasadas hoje" e "em aberto" mostram a situação de agora, qualquer que seja o período.
      </p>

      {/* Grafico de entregas */}
      {periodo !== 'dia' && (
        <section className="cartao p-4">
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            <h2 className="font-titulo text-base font-extrabold">Entregas {periodo === 'ano' ? 'por mês' : 'por dia'}</h2>
            <Legenda cor="#1F8A52" texto="No prazo" />
            <Legenda cor="#D2453A" texto="Com atraso" />
            <Legenda cor="#9AA0C2" texto="Sem prazo" />
          </div>
          <div className="overflow-x-auto">
            <div className="flex h-40 min-w-full items-end gap-1" style={{ minWidth: `${barras.length * 22}px` }}>
              {barras.map((b) => {
                const total = b.prazo + b.atraso + b.sem;
                return (
                  <div key={b.chave} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                    title={`${b.rotulo}: ${total} entregue(s) — ${b.prazo} no prazo, ${b.atraso} com atraso, ${b.sem} sem prazo`}>
                    {total > 0 && <span className="text-[10px] font-bold tabular-nums text-tinta">{total}</span>}
                    <div className="flex w-full max-w-[34px] flex-col-reverse overflow-hidden rounded-t" style={{ height: `${(total / maiorBarra) * 100}%` }}>
                      <div style={{ flex: b.prazo, background: '#1F8A52' }} />
                      <div style={{ flex: b.atraso, background: '#D2453A' }} />
                      <div style={{ flex: b.sem, background: '#9AA0C2' }} />
                    </div>
                    {!total && <div className={`h-px w-full max-w-[34px] ${b.fimDeSemana ? 'bg-linha' : 'bg-tinta-suave/30'}`} />}
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex gap-1" style={{ minWidth: `${barras.length * 22}px` }}>
              {barras.map((b) => (
                <span key={b.chave} className={`min-w-0 flex-1 text-center text-[10px] tabular-nums ${b.fimDeSemana ? 'text-tinta-suave/60' : 'text-tinta-suave'}`}>{b.rotulo}</span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Quebras */}
      <div className="grid gap-4 lg:grid-cols-2">
        <TabelaQuebra titulo="Por responsável" linhas={porPessoa} nome={(k) => (k ? nomePessoa.get(k) ?? '—' : 'Sem responsável')} />
        <TabelaQuebra titulo="Por quadro" linhas={porQuadro} nome={(k) => nomeQuadro.get(k) ?? '—'} cor={(k) => corQuadro.get(k)} />
      </div>

      {/* Entregas */}
      <section className="cartao overflow-hidden">
        <h2 className="border-b border-linha px-4 py-3 font-titulo text-base font-extrabold">
          Entregas do período <span className="text-sm font-bold text-tinta-suave">({entregues.length})</span>
        </h2>
        {entregues.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-papel text-left text-[11px] font-bold uppercase tracking-wider text-tinta-suave">
                <tr>
                  <th className="px-4 py-2">Conclusão</th><th className="px-4 py-2">Tarefa</th><th className="px-4 py-2">Responsável</th>
                  <th className="px-4 py-2">Início</th><th className="px-4 py-2">Prazo</th><th className="px-4 py-2">Resultado</th><th className="px-4 py-2">Checklist</th>
                </tr>
              </thead>
              <tbody>
                {entregues.map((t) => {
                  const r = resultado(t); const c = progressoDoChecklist(t.checklist);
                  return (
                    <tr key={t.id} className="border-t border-linha">
                      <td className="px-4 py-2 font-semibold tabular-nums">{formatarData(t.concluida_em!)}</td>
                      <td className="px-4 py-2">
                        <span className="font-semibold">{t.titulo}</span>
                        <span className="ml-2 inline-flex items-center gap-1 text-xs text-tinta-suave">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: corQuadro.get(t.quadro_id) }} />{nomeQuadro.get(t.quadro_id)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-tinta-suave">{t.responsavel_id ? nomePessoa.get(t.responsavel_id) : '—'}</td>
                      <td className="px-4 py-2 tabular-nums text-tinta-suave">{t.inicio ? formatarData(t.inicio) : '—'}</td>
                      <td className="px-4 py-2 tabular-nums text-tinta-suave">{t.prazo ? formatarData(t.prazo) : '—'}</td>
                      <td className="px-4 py-2">
                        {r.tipo === 'prazo' && <span className="rounded bg-sucesso-suave px-1.5 py-0.5 text-xs font-bold text-sucesso">No prazo</span>}
                        {r.tipo === 'atraso' && <span className="rounded bg-vermelho/10 px-1.5 py-0.5 text-xs font-bold text-vermelho">{plural(r.dias, 'dia', 'dias')} de atraso</span>}
                        {r.tipo === 'sem' && <span className="text-xs text-tinta-suave">Sem prazo</span>}
                      </td>
                      <td className="px-4 py-2 text-xs tabular-nums text-tinta-suave">{c.total ? `${c.feitos}/${c.total}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Vazio>Nenhuma tarefa foi concluída neste período.</Vazio>}
      </section>

      {/* Atrasadas agora */}
      {atrasadasAgora.length > 0 && (
        <section className="cartao overflow-hidden">
          <h2 className="border-b border-linha px-4 py-3 font-titulo text-base font-extrabold">
            Atrasadas hoje <span className="text-sm font-bold text-tinta-suave">({atrasadasAgora.length})</span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <tbody>
                {atrasadasAgora.map((t) => (
                  <tr key={t.id} className="border-t border-linha first:border-t-0">
                    <td className="px-4 py-2 font-semibold">{t.titulo}</td>
                    <td className="px-4 py-2 text-tinta-suave">{nomeQuadro.get(t.quadro_id)}</td>
                    <td className="px-4 py-2 text-tinta-suave">{t.responsavel_id ? nomePessoa.get(t.responsavel_id) : 'Sem responsável'}</td>
                    <td className="px-4 py-2 tabular-nums text-tinta-suave">prazo {formatarData(t.prazo!)}</td>
                    <td className="px-4 py-2 text-right font-bold text-vermelho">{plural(diasEntre(t.prazo!, hoje), 'dia', 'dias')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Indicador({ rotulo, valor, detalhe, cor }: { rotulo: string; valor: number; detalhe: string; cor: string }) {
  return (
    <div className="cartao relative overflow-hidden p-4">
      <div className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: cor }} />
      <p className="text-[11px] font-bold uppercase tracking-wider text-tinta-suave">{rotulo}</p>
      <p className="mt-1 font-titulo text-3xl font-extrabold tabular-nums text-tinta">{valor}</p>
      <p className="text-xs text-tinta-suave">{detalhe}</p>
    </div>
  );
}

function Legenda({ cor, texto }: { cor: string; texto: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-tinta-suave">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: cor }} />{texto}
    </span>
  );
}

function TabelaQuebra({ titulo, linhas, nome, cor }: {
  titulo: string;
  linhas: [string, { entregues: number; noPrazo: number; comPrazo: number; abertas: number; atrasadas: number }][];
  nome: (chave: string) => string;
  cor?: (chave: string) => string | undefined;
}) {
  return (
    <section className="cartao overflow-hidden">
      <h2 className="border-b border-linha px-4 py-3 font-titulo text-base font-extrabold">{titulo}</h2>
      {linhas.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="bg-papel text-left text-[11px] font-bold uppercase tracking-wider text-tinta-suave">
              <tr>
                <th className="px-4 py-2" />
                <th className="px-3 py-2 text-right">Entregues</th>
                <th className="px-3 py-2 text-right">No prazo</th>
                <th className="px-3 py-2 text-right">Em aberto</th>
                <th className="px-4 py-2 text-right">Atrasadas</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(([chave, l]) => (
                <tr key={chave || 'sem'} className="border-t border-linha">
                  <td className="px-4 py-2 font-semibold">
                    <span className="flex items-center gap-2">
                      {cor && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cor(chave) }} />}
                      {nome(chave)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">{l.entregues}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-tinta-suave">{l.comPrazo ? `${pct(l.noPrazo, l.comPrazo)}%` : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.abertas}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${l.atrasadas ? 'font-bold text-vermelho' : 'text-tinta-suave'}`}>{l.atrasadas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Vazio>Nada no período.</Vazio>}
    </section>
  );
}
