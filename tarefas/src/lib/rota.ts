/* Onde a pessoa esta, guardado no endereco.

   O modulo e uma tela so, entao antes o F5 devolvia todo mundo a lista
   de quadros: quem estava dentro de um quadro perdia o lugar a cada
   atualizacao. Guardar a posicao no proprio endereco resolve e ainda
   deixa o link do quadro colavel numa conversa.

   Fica no trecho depois do "#" porque o site e estatico no GitHub
   Pages: caminho de verdade exigiria servidor que devolvesse o index
   para qualquer rota. */

export type Aba = 'quadros' | 'pessoas';

const ABAS: Aba[] = ['quadros', 'pessoas'];

export interface Rota {
  aba: Aba;
  quadroId: string | null;
}

export const ROTA_INICIAL: Rota = { aba: 'quadros', quadroId: null };

export function lerRota(hash: string): Rota {
  const limpo = hash.replace(/^#\/?/, '').trim();
  if (!limpo) return ROTA_INICIAL;

  const [primeiro, segundo] = limpo.split('/');
  if (primeiro === 'quadro' && segundo) {
    return { aba: 'quadros', quadroId: decodeURIComponent(segundo) };
  }
  const aba = ABAS.find((a) => a === primeiro);
  return aba ? { aba, quadroId: null } : ROTA_INICIAL;
}

export function escreverRota(rota: Rota): string {
  return rota.quadroId ? `#/quadro/${encodeURIComponent(rota.quadroId)}` : `#/${rota.aba}`;
}
