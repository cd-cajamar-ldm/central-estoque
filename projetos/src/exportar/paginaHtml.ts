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
    color: #161933; background: #F6F7FB;
    font-size: 16px; line-height: 1.65;
    -webkit-text-size-adjust: 100%; text-rendering: optimizeLegibility;
  }
  .folha { max-width: 1120px; margin: 0 auto; background: #FFFFFF;
    border: 1px solid #E7E8F5; border-radius: 16px; padding: 40px; }
  h1 { font-size: 28px; line-height: 1.25; margin: 0 0 6px; }
  .dados { color: #6A6F94; font-size: 14px; margin: 0 0 32px; }
  .bloco { margin: 32px 0; }
  .bloco:first-child { margin-top: 0; }
  /* A coluna de texto para em ~80 caracteres, como na tela: numa folha
     de 1120 px a linha inteira faria o olho perder o comeco da proxima.
     O fluxo, que nao e leitura corrida, usa a largura toda. */
  .prosa { max-width: 80ch; }
  .prosa h1, .prosa h2, .prosa h3 { margin: 32px 0 10px; line-height: 1.3; }
  .prosa h2 { font-size: 21px; }
  .prosa h3 { font-size: 18px; }
  .prosa p, .prosa ul, .prosa ol, .prosa blockquote { margin: 0 0 14px; }
  .prosa img { max-width: 100%; height: auto; border-radius: 8px; }
  .prosa table { border-collapse: collapse; width: 100%; margin: 0 0 14px; font-size: 15px; }
  .prosa th, .prosa td { border: 1px solid #E7E8F5; padding: 8px 10px; text-align: left; }
  .prosa th { background: #F6F7FB; }
  .prosa blockquote { border-left: 3px solid #E7E8F5; padding-left: 14px; color: #6A6F94; }
  .prosa code, pre { font-family: ui-monospace, Consolas, monospace; font-size: 14px; }
  pre { background: #F6F7FB; padding: 14px; border-radius: 8px; overflow-x: auto; }

  /* Fluxograma.

     Ele nasce grande: encolhido para caber na folha, o texto dentro das
     caixas fica ilegivel. Por isso o desenho vem em tamanho real, com
     rolagem lateral quando nao cabe, e o controle ao lado o ajusta a
     largura da folha para quem prefere ver o todo. O desenho e vetorial:
     nos dois tamanhos ele continua nitido, sem borrar como uma foto
     esticada. */
  .quadro { margin: 32px 0; }
  /* O controle e um checkbox escondido com um rotulo em forma de botao:
     assim o estado fica no proprio HTML, sem uma linha de script — o
     arquivo viaja por e-mail e abre em navegador de terceiro, as vezes
     com script bloqueado. */
  .ajustar { position: absolute; opacity: 0; pointer-events: none; }
  .controle {
    display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
    font-size: 13px; font-weight: 600; color: #6A6F94;
    border: 1px solid #E7E8F5; border-radius: 999px; padding: 6px 14px;
    background: #FFFFFF; user-select: none;
  }
  .controle::before {
    content: ''; width: 12px; height: 12px; border-radius: 3px;
    border: 1.5px solid #C9CCE4; background: #FFFFFF;
  }
  .controle:hover { border-color: #7C3AED; color: #4C1D95; }
  .ajustar:focus-visible + .controle { outline: 2px solid #7C3AED; outline-offset: 2px; }
  .ajustar:checked + .controle {
    border-color: #7C3AED; color: #4C1D95; background: #F5F3FF;
  }
  .ajustar:checked + .controle::before { background: #7C3AED; border-color: #7C3AED; }
  .fluxo {
    margin-top: 8px; overflow-x: auto; background: #FFFFFF;
    border: 1px solid #E7E8F5; border-radius: 12px; padding: 12px;
  }
  .fluxo svg { display: block; height: auto; max-width: none; }
  .ajustar:checked ~ .fluxo svg { max-width: 100%; }
  .rodape { max-width: 1120px; margin: 16px auto 0; color: #6A6F94; font-size: 13px; text-align: center; }

  @media (max-width: 760px) {
    body { padding: 16px 12px 40px; }
    .folha { padding: 20px; border-radius: 12px; }
    h1 { font-size: 23px; }
  }
  /* No papel nao ha rolagem lateral: ali o fluxo tem de caber na folha. */
  @media print {
    body { background: #FFFFFF; padding: 0; font-size: 12pt; }
    .folha { border: 0; padding: 0; max-width: none; }
    .controle { display: none; }
    .fluxo { border: 0; padding: 0; overflow: visible; }
    .fluxo svg { max-width: 100% !important; }
    .bloco, .quadro { break-inside: avoid; }
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
  const blocos = pagina.blocos.map((b, indice) => {
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
    const id = `ajustar-${indice}`;
    return `<div class="bloco quadro">`
      + `<input class="ajustar" type="checkbox" id="${id}">`
      + `<label class="controle" for="${id}">Ajustar à largura da página</label>`
      + `<div class="fluxo">${fluxoParaSvg(fluxo, { justo: true })}</div>`
      + '</div>';
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

/* Print do bloco de texto entrando no arquivo.

   A imagem do texto mora no Storage e aparece por uma URL. Num arquivo
   que vai por e-mail isso e uma imagem quebrada assim que quem abre
   estiver sem rede, ou no dia em que o endereco mudar — e "abre em
   qualquer navegador, sem internet" era a razao de existir do botao.
   Entao cada imagem e baixada e entra embutida no proprio arquivo.

   Falha de rede nao derruba o compartilhar: a imagem fica com a URL que
   tinha, que ao menos funciona para quem esta conectado. */
export async function embutirImagens(html: string, buscar = fetch): Promise<string> {
  const enderecos = [...html.matchAll(/<img[^>]+src="(https?:\/\/[^"]+)"/gi)]
    .map((achado) => achado[1]);
  if (!enderecos.length) return html;

  const unicos = [...new Set(enderecos)];
  const embutidas = await Promise.all(unicos.map(async (endereco) => {
    try {
      const resposta = await buscar(endereco);
      if (!resposta.ok) return null;
      const dados = await resposta.blob();
      const bytes = new Uint8Array(await dados.arrayBuffer());
      /* Em pedacos: `String.fromCharCode(...bytes)` de uma imagem inteira
         passa do limite de argumentos da funcao e estoura. */
      let binario = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        binario += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      const uri = `data:${dados.type || 'image/png'};base64,${btoa(binario)}`;
      return [endereco, uri] as const;
    } catch {
      return null;
    }
  }));

  let saida = html;
  for (const par of embutidas) {
    if (!par) continue;
    /* Troca literal, e nao por expressao regular montada com a URL: o
       endereco tem barras e pontos que virariam curinga. */
    saida = saida.split(`"${par[0]}"`).join(`"${par[1]}"`);
  }
  return saida;
}
