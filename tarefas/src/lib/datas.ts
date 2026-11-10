/* Datas do modulo sao texto AAAA-MM-DD (colunas date do banco). As
   contas aqui usam o dia LOCAL de quem esta na tela: com toISOString()
   uma tarefa feita as 22h em Sao Paulo cairia no dia seguinte (UTC). */

export function paraIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dia}`;
}

export const hojeIso = () => paraIso(new Date());

/* "2026-11-10T13:05:00Z" (timestamptz) -> dia local "2026-11-10". */
export const diaLocalDe = (timestamp: string) => paraIso(new Date(timestamp));

export function deIso(iso: string): Date {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d);
}

export function somarDias(iso: string, dias: number): string {
  const d = deIso(iso);
  d.setDate(d.getDate() + dias);
  return paraIso(d);
}

/* Dias corridos de a ate b (b - a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((deIso(b).getTime() - deIso(a).getTime()) / 86_400_000);
}

export function formatarData(iso: string, anoCurto = true): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${anoCurto ? ano.slice(2) : ano}`;
}
