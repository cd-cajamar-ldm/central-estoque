/* A pagina virando um arquivo que se manda para quem nao entra aqui.

   Quem escreve a documentacao precisa mostra-la a fornecedor, ao time do
   BSeller, a quem nao tem login neste modulo. Ate agora a saida era o
   Word do documento de proposta, que tem outro proposito e outro formato.
   Aqui sai a pagina como ela e: o texto e os fluxogramas, na ordem em que
   foram escritos, num unico HTML que abre em qualquer navegador sem
   internet, sem login e sem anexo separado — o fluxo vai desenhado
   dentro do arquivo, em SVG, e o print colado vai dentro do SVG. */
import { fluxoParaSvg, lerFluxo } from '@/dominio/fluxo';
import type { Bloco } from '@/dominio/tipos';

export interface PaginaParaCompartilhar {
  titulo: string;
  blocos: Bloco[];
  projeto?: string;
  situacao?: string;
  atualizadoEm?: string;
  atualizadoPor?: string | null;
  geradoEm?: Date;
}

export function escaparTexto(texto: string): string {
  return texto
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* O nome do arquivo sai do titulo da pagina, sem acento e sem o que o
   Windows recusa em nome de arquivo. */
export function nomeDoArquivoHtml(titulo: string): string {
  const limpo = titulo
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${limpo || 'pagina'}.html`;
}

/* O estilo vai embutido: o arquivo viaja por e-mail e tem de abrir igual
   na maquina de quem recebe, sem buscar folha de estilo nenhuma. */
const ESTILO = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 20px 64px;
    font-family: Inter, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    color: #161933; background: #F6F7FB; line-height: 1.6;
  }
  .folha { max-width: 900px; margin: 0 auto; background: #FFFFFF;
    border: 1px solid #E7E8F5; border-radius: 16px; padding: 32px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .dados { color: #6A6F94; font-size: 13px; margin: 0 0 24px; }
  .bloco { margin: 24px 0; }
  .bloco:first-child { margin-top: 0; }
  .prosa { max-width: 72ch; }
  .prosa h1, .prosa h2, .prosa h3 { margin: 24px 0 8px; line-height: 1.3; }
  .prosa p, .prosa ul, .prosa ol, .prosa blockquote { margin: 0 0 12px; }
  .prosa img { max-width: 100%; height: auto; border-radius: 8px; }
  .prosa table { border-collapse: collapse; width: 100%; margin: 0 0 12px; }
  .prosa th, .prosa td { border: 1px solid #E7E8F5; padding: 6px 8px; text-align: left; }
  .prosa th { background: #F6F7FB; }
  .prosa blockquote { border-left: 3px solid #E7E8F5; padding-left: 12px; color: #6A6F94; }
  .prosa code, pre { font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
  pre { background: #F6F7FB; padding: 12px; border-radius: 8px; overflow-x: auto; }
  .fluxo { overflow-x: auto; border: 1px solid #E7E8F5; border-radius: 12px; padding: 8px; }
  .fluxo svg { max-width: 100%; height: auto; display: block; }
  .rodape { max-width: 900px; margin: 16px auto 0; color: #6A6F94; font-size: 12px; text-align: center; }
  @media print {
    body { background: #FFFFFF; padding: 0; }
    .folha { border: 0; padding: 0; }
  }
`;

/* A limpeza do HTML do texto entra de fora (`src/lib/html.ts`), que
   precisa do DOM do navegador: assim esta funcao continua pura e o que
   sai no arquivo passa pelo mesmo filtro da tela. */
export function paginaParaHtml(
  pagina: PaginaParaCompartilhar,
  limparTexto: (html: string) => string,
): string {
  const quando = pagina.geradoEm ?? new Date();
  const blocos = pagina.blocos.map((b) => {
    if (b.tipo === 'texto') {
      return `<div class="bloco prosa">${limparTexto(b.conteudo)}</div>`;
    }
    const fluxo = lerFluxo(b.conteudo);
    /* Fluxo no formato antigo, escrito em texto, vai como texto: melhor
       do que sumir do arquivo. */
    if (!fluxo) {
      return b.conteudo.trim()
        ? `<div class="bloco"><pre>${escaparTexto(b.conteudo)}</pre></div>`
        : '';
    }
    return `<div class="bloco fluxo">${fluxoParaSvg(fluxo)}</div>`;
  }).join('\n');

  const linhaDeDados = [
    pagina.projeto,
    pagina.situacao,
    pagina.atualizadoEm && `atualizada em ${pagina.atualizadoEm}`,
    pagina.atualizadoPor,
  ].filter(Boolean).map((t) => escaparTexto(String(t))).join(' · ');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escaparTexto(pagina.titulo)}</title>
<style>${ESTILO}</style>
</head>
<body>
<article class="folha">
<h1>${escaparTexto(pagina.titulo)}</h1>
${linhaDeDados ? `<p class="dados">${linhaDeDados}</p>` : ''}
${blocos}
</article>
<p class="rodape">Central de Estoque · Projetos · Loja do Mecânico — gerado em ${
    escaparTexto(quando.toLocaleString('pt-BR'))
  }</p>
</body>
</html>`;
}
