import { documentoVazio } from './documento';
import type { DadosDoDocumento, Par } from './documento';

/* Preencher o documento a partir de um texto corrido.

   O caminho do JSON continua existindo para quem escreve com ajuda do
   chat, mas o pedido nasce quase sempre como texto solto: um e-mail, a
   descricao de um chamado, o rascunho que a pessoa ja escreveu no Word.
   Reescrever isso campo a campo e trabalho repetido.

   Aqui o texto e quebrado pelos titulos que quem escreve ja usa
   ("Objetivo da melhoria:", "Comportamento atual:", "Justificativa:") e
   cada bloco vai para o campo correspondente. Nada e inventado: o que
   nao tem titulo conhecido continua no documento, como regra de
   negocio, com o titulo original na frente, em vez de ser jogado fora. */

/* Titulo e linha curta terminada em dois pontos, ou cabecalho de
   markdown. O limite de palavras evita confundir com frase de abertura
   de lista ("Com essas informacoes, sera possivel:"), que e texto. */
function ehTitulo(linha: string): boolean {
  const t = linha.trim();
  if (/^#{1,6}\s+\S/.test(t)) return true;
  if (!t.endsWith(':')) return false;
  const corpo = t.slice(0, -1).trim();
  return !!corpo && corpo.length <= 60 && corpo.split(/\s+/).length <= 6;
}

function limparTitulo(linha: string): string {
  return linha.trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/[:：]\s*$/, '')
    .replace(/^\*+|\*+$/g, '')
    .trim();
}

const MARCADOR = /^\s*(?:[-*•·]|\d+[.)])\s+/;

/* Item de lista: com marcador, terminado em ponto e virgula, ou linha
   curta sem pontuacao final. A ultima regra e o que faz "LOTE_TERCEIRO"
   virar item sozinho; em compensacao, texto colado com quebra de linha
   no meio do paragrafo pode ser lido como lista. Vale a troca: o
   formulario mostra o resultado antes de gerar o Word. */
function ehItem(linha: string): boolean {
  const t = linha.trim();
  if (MARCADOR.test(t)) return true;
  if (t.endsWith(';')) return true;
  return t.length <= 100 && !/[.!?:,]$/.test(t);
}

const semMarcador = (linha: string) => linha.trim().replace(MARCADOR, '').replace(/[;.]$/, '').trim();

interface Bloco {
  titulo: string;
  paragrafos: string[];
  itens: string[];
}

/* Uma linha curta solta e paragrafo, nao lista de um item so: e o caso
   do titulo de uma frase, comum na abertura do pedido. */
function separar(linhas: string[]): { paragrafos: string[]; itens: string[] } {
  const paragrafos: string[] = [];
  const itens: string[] = [];
  let fila: string[] = [];

  const descarregar = () => {
    if (fila.length >= 2 || (fila.length === 1 && MARCADOR.test(fila[0]))) {
      itens.push(...fila.map(semMarcador));
    } else {
      paragrafos.push(...fila.map((l) => l.trim()));
    }
    fila = [];
  };

  for (const linha of linhas) {
    /* Linha em branco fecha a lista: e o que separa os itens do
       paragrafo que vem depois deles. */
    if (!linha.trim()) { descarregar(); continue; }
    if (ehItem(linha)) { fila.push(linha); continue; }
    /* Ultimo item de lista costuma vir com ponto final no lugar do
       ponto e virgula. Se a lista ja comecou, ele ainda e item. */
    if (fila.length && fila[fila.length - 1].trim().endsWith(';') && linha.trim().length <= 100) {
      fila.push(linha);
      descarregar();
      continue;
    }
    descarregar();
    paragrafos.push(linha.trim());
  }
  descarregar();

  return { paragrafos: paragrafos.filter(Boolean), itens: itens.filter(Boolean) };
}

export function blocosDoTexto(bruto: string): Bloco[] {
  const linhas = bruto.replace(/\r\n?/g, '\n').split('\n');
  const blocos: Bloco[] = [];
  let titulo = '';
  let corpo: string[] = [];

  const fechar = () => {
    const { paragrafos, itens } = separar(corpo);
    if (titulo || paragrafos.length || itens.length) blocos.push({ titulo, paragrafos, itens });
    corpo = [];
  };

  for (const linha of linhas) {
    if (!linha.trim()) { corpo.push(''); continue; }
    if (ehTitulo(linha)) { fechar(); titulo = limparTitulo(linha); continue; }
    corpo.push(linha);
  }
  fechar();

  return blocos.filter((b) => b.titulo || b.paragrafos.length || b.itens.length);
}

/* Para onde cada titulo conhecido vai. A comparacao e sem acento e sem
   maiuscula, e por comeco do texto: "Objetivo da melhoria" e
   "Objetivo:" caem no mesmo lugar. */
type Destino =
  | 'objetivo' | 'dor' | 'to_be' | 'problema_central' | 'exemplo_pratico'
  | 'justificativa' | 'regras_negocio' | 'criterios_aceite' | 'cenarios_validacao'
  | 'pontos_aberto' | 'impactos' | 'riscos' | 'kpis' | 'ganhos'
  | 'resumo_executivo' | 'titulo' | 'subtitulo';

const SINONIMOS: { chave: string; destino: Destino }[] = [
  { chave: 'titulo', destino: 'titulo' },
  { chave: 'assunto', destino: 'titulo' },
  { chave: 'subtitulo', destino: 'subtitulo' },
  { chave: 'objetivo', destino: 'objetivo' },
  { chave: 'finalidade', destino: 'objetivo' },
  { chave: 'solicitacao', destino: 'objetivo' },
  { chave: 'o que precisamos', destino: 'objetivo' },
  { chave: 'comportamento atual', destino: 'dor' },
  { chave: 'situacao atual', destino: 'dor' },
  { chave: 'cenario atual', destino: 'dor' },
  { chave: 'como funciona hoje', destino: 'dor' },
  { chave: 'como e hoje', destino: 'dor' },
  { chave: 'as is', destino: 'dor' },
  { chave: 'dor', destino: 'dor' },
  { chave: 'problema atual', destino: 'dor' },
  { chave: 'problema central', destino: 'problema_central' },
  { chave: 'comportamento esperado', destino: 'to_be' },
  { chave: 'situacao esperada', destino: 'to_be' },
  { chave: 'resultado esperado', destino: 'to_be' },
  { chave: 'como deve ficar', destino: 'to_be' },
  { chave: 'to be', destino: 'to_be' },
  { chave: 'solucao', destino: 'to_be' },
  { chave: 'proposta', destino: 'to_be' },
  { chave: 'o que muda', destino: 'to_be' },
  { chave: 'justificativa', destino: 'justificativa' },
  { chave: 'beneficio', destino: 'justificativa' },
  { chave: 'ganho', destino: 'ganhos' },
  { chave: 'exemplo', destino: 'exemplo_pratico' },
  { chave: 'caso de uso', destino: 'exemplo_pratico' },
  { chave: 'regra', destino: 'regras_negocio' },
  { chave: 'requisito', destino: 'regras_negocio' },
  { chave: 'criterio de aceite', destino: 'criterios_aceite' },
  { chave: 'criterios de aceite', destino: 'criterios_aceite' },
  { chave: 'aceite', destino: 'criterios_aceite' },
  { chave: 'cenario de validacao', destino: 'cenarios_validacao' },
  { chave: 'cenarios de validacao', destino: 'cenarios_validacao' },
  { chave: 'teste', destino: 'cenarios_validacao' },
  { chave: 'ponto em aberto', destino: 'pontos_aberto' },
  { chave: 'pontos em aberto', destino: 'pontos_aberto' },
  { chave: 'duvida', destino: 'pontos_aberto' },
  { chave: 'pendencia', destino: 'pontos_aberto' },
  { chave: 'impacto', destino: 'impactos' },
  { chave: 'risco', destino: 'riscos' },
  { chave: 'dependencia', destino: 'riscos' },
  { chave: 'kpi', destino: 'kpis' },
  { chave: 'indicador', destino: 'kpis' },
  { chave: 'resumo', destino: 'resumo_executivo' },
];

const ROTULOS: Record<Destino, string> = {
  titulo: 'Título',
  subtitulo: 'Subtítulo',
  objetivo: 'Objetivo',
  dor: 'Dor atual (AS IS)',
  to_be: 'O que muda (TO BE)',
  problema_central: 'Problema central',
  exemplo_pratico: 'Exemplo prático',
  justificativa: 'ROI e justificativa',
  ganhos: 'Ganhos diretos',
  regras_negocio: 'Regras de negócio',
  criterios_aceite: 'Critérios de aceite',
  cenarios_validacao: 'Cenários de validação',
  pontos_aberto: 'Pontos em aberto',
  impactos: 'Impactos',
  riscos: 'Riscos e dependências',
  kpis: 'KPIs',
  resumo_executivo: 'Resumo executivo',
};

const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

function destinoDe(titulo: string): Destino | null {
  const alvo = semAcento(titulo);
  if (!alvo) return null;
  /* A chave mais longa ganha: "criterio de aceite" antes de "criterio". */
  const achado = [...SINONIMOS]
    .sort((a, b) => b.chave.length - a.chave.length)
    .find((s) => alvo.startsWith(s.chave) || alvo.includes(` ${s.chave}`));
  return achado?.destino ?? null;
}

/* "Tempo de auditoria | 2 horas", "Tempo de auditoria: 2 horas" e
   "Tempo de auditoria - 2 horas" viram a mesma dupla. Sem separador, o
   texto inteiro fica na segunda coluna. */
function dupla(item: string, colunaA: string): Par {
  const corte = item.match(/^(.{2,60}?)\s*(?:\||:|\s-\s)\s*(.+)$/);
  if (corte) return { a: corte[1].trim(), b: corte[2].trim() };
  return { a: colunaA, b: item };
}

export interface LeituraDeTexto {
  dados: DadosDoDocumento;
  /* O que foi para onde, para a tela mostrar antes de gerar o Word. */
  mapa: { titulo: string; destino: string }[];
}

/* Pedido escrito sem titulo nenhum, que e como a maioria das pessoas
   escreve: "solicito tal coisa / hoje acontece assim / com isso passa a
   funcionar assado". A ordem dos paragrafos ja conta essa historia,
   entao o primeiro vira o objetivo, o ultimo vira o que muda e o que
   estiver no meio vira a dor de hoje.

   Sem isso, o texto inteiro caia num campo so e o documento saia com
   metade das secoes escritas como "a definir" — que foi o que
   aconteceu na primeira proposta escrita assim. */
function distribuirTextoSemTitulo(r: DadosDoDocumento): string[] {
  const partes = r.objetivo.split('\n\n').map((t) => t.trim()).filter(Boolean);
  if (partes.length < 2) return [];

  r.objetivo = partes[0];
  if (partes.length === 2) {
    r.dor = partes[1];
    return ['Objetivo', 'Dor atual (AS IS)'];
  }
  r.dor = partes.slice(1, -1).join('\n\n');
  r.to_be = partes[partes.length - 1];
  return ['Objetivo', 'Dor atual (AS IS)', 'O que muda (TO BE)'];
}

export function lerTextoCorrido(bruto: string, base: DadosDoDocumento): LeituraDeTexto {
  if (!bruto.trim()) throw new Error('Cole o texto do pedido antes de preencher.');

  const blocos = blocosDoTexto(bruto);
  if (!blocos.length) throw new Error('Não encontrei conteúdo no texto colado.');

  const r: DadosDoDocumento = { ...base, ...estruturasVazias() };
  const mapa: { titulo: string; destino: string }[] = [];
  const juntar = (partes: string[]) => partes.join('\n\n').trim();

  for (const bloco of blocos) {
    const destino = destinoDe(bloco.titulo);
    const texto = juntar(bloco.paragrafos);
    const todos = [...bloco.paragrafos, ...bloco.itens];

    /* Abertura sem titulo: e o pedido em uma frase. Vira objetivo se
       nenhum bloco trouxer objetivo, senao vira resumo executivo. */
    if (!bloco.titulo) {
      const temObjetivo = blocos.some((b) => destinoDe(b.titulo) === 'objetivo');
      if (temObjetivo) r.resumo_executivo = juntar([r.resumo_executivo, texto]);
      else r.objetivo = juntar([r.objetivo, texto]);
      if (todos.length) mapa.push({ titulo: 'Abertura', destino: temObjetivo ? ROTULOS.resumo_executivo : ROTULOS.objetivo });
      if (bloco.itens.length) r.regras_negocio.push(...bloco.itens);
      continue;
    }

    if (!destino) {
      /* Titulo que o app nao conhece: o conteudo continua no documento,
         nas regras de negocio, com o titulo na frente para nao perder o
         sentido ("Novas colunas solicitadas: LOTE_TERCEIRO"). */
      r.regras_negocio.push(...todos.map((i) => `${bloco.titulo}: ${i}`));
      mapa.push({ titulo: bloco.titulo, destino: ROTULOS.regras_negocio });
      continue;
    }

    mapa.push({ titulo: bloco.titulo, destino: ROTULOS[destino] });

    switch (destino) {
      case 'titulo': r.titulo = todos.join(' ').trim() || r.titulo; break;
      case 'subtitulo': r.subtitulo = todos.join(' ').trim(); break;
      case 'problema_central': r.problema_central = todos.join(' ').trim(); break;
      case 'objetivo': r.objetivo = juntar([r.objetivo, texto]); r.regras_negocio.push(...bloco.itens); break;
      case 'dor': r.dor = juntar([r.dor, texto]); r.regras_negocio.push(...bloco.itens); break;
      case 'to_be':
        r.to_be = juntar([r.to_be, texto]);
        /* Lista dentro do "como deve ficar" e comportamento obrigatorio:
           vira criterio de aceite, que e o que o time tecnico valida. */
        r.criterios_aceite.push(...bloco.itens);
        break;
      case 'exemplo_pratico': r.exemplo_pratico = juntar([r.exemplo_pratico, texto]); break;
      case 'resumo_executivo': r.resumo_executivo = juntar([r.resumo_executivo, texto]); break;
      case 'justificativa':
        r.roi_bullets.push(...bloco.itens);
        if (bloco.paragrafos.length) {
          r.prioridade_justificativa = bloco.paragrafos[0];
          if (bloco.paragrafos.length > 1) r.roi_fechamento = bloco.paragrafos[bloco.paragrafos.length - 1];
        }
        break;
      case 'ganhos': r.ganhos.push(...todos.map((i) => dupla(i, 'Operação'))); break;
      case 'impactos': r.impactos.push(...todos.map((i) => dupla(i, 'Operação'))); break;
      case 'riscos': r.riscos.push(...todos.map((i) => dupla(i, 'Item'))); break;
      case 'kpis': r.kpis.push(...todos.map((i) => {
        const par = dupla(i, '');
        return par.a ? par : { a: i, b: 'Meta a definir' };
      })); break;
      default: r[destino].push(...todos); break;
    }
  }

  /* So quando a leitura por titulo nao achou nem a dor nem o TO BE: se
     a pessoa escreveu os titulos, manda o que ela escreveu. */
  if (!r.dor.trim() && !r.to_be.trim()) {
    const destinos = distribuirTextoSemTitulo(r);
    if (destinos.length) {
      const semAbertura = mapa.filter((m) => m.titulo !== 'Abertura');
      mapa.length = 0;
      mapa.push({ titulo: 'Abertura', destino: destinos.join(', ') }, ...semAbertura);
    }
  }

  return { dados: r, mapa };
}

/* O texto colado manda no documento: as listas comecam vazias para nao
   somar item novo em cima do que a leitura anterior deixou. Os campos
   de identificacao (numero, data, imagens) nao vem do texto e ficam. */
function estruturasVazias() {
  const v = documentoVazio(0);
  return {
    ganhos: [] as Par[],
    regras_negocio: [] as string[],
    pontos_aberto: [] as string[],
    criterios_aceite: [] as string[],
    cenarios_validacao: [] as string[],
    impactos: v.impactos,
    riscos: v.riscos,
    kpis: v.kpis,
    roi_bullets: [] as string[],
  };
}
